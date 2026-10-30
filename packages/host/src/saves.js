/**
 * Game Save persistence (PRD §8.3/§8.6.5, contracts.js `SaveEnvelope`).
 *
 * Files: `saves/<gameId>/current.json` + `saves/<gameId>/meta.json`.
 * The platform never interprets `values`; it enforces key/value/total limits
 * and revision CAS, then writes atomically through `HostStorage`.
 */

import { portableSave, validatePortableSave } from './save-transfer.js';
import { LIMITS } from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import { hostError } from './errors.js';
import { createKeyedSerialiser } from './serial.js';
import {
  isPlainObject,
  isValidStorageKey,
  jsonByteLength,
  validateGameId,
  validateOperationId,
  validateStoredValue,
} from './validation.js';

const SAVE_REASONS = new Set(['auto', 'pause', 'exit', 'agent-complete', 'manual']);

function corruptSave(message) {
  return hostError(GM.SAVE_CORRUPT, message || 'Save file is corrupt', { retryable: false });
}

function validateReason(value) {
  if (value === undefined || value === null) return 'manual';
  return SAVE_REASONS.has(value) ? value : 'manual';
}

export function createSavesService({ storage, catalog, logger = null, now, withInactiveGame = null }) {
  const serialiseSave = createKeyedSerialiser();

  function paths(gameId) {
    const directory = storage.filePath('saves', gameId);
    return {
      directory,
      current: storage.filePath('saves', gameId, 'current.json'),
      meta: storage.filePath('saves', gameId, 'meta.json'),
    };
  }

  async function readCurrent(gameId) {
    const result = await storage.readJson(paths(gameId).current, { schemaVersion: 1 });
    if (!result) return null;
    if (result.recovered) logger?.warn?.('[game-market/host] save-recovered', `gameId=${gameId}`);
    const value = result.value;
    if (!isPlainObject(value) || value.gameId !== gameId || !isPlainObject(value.values)) {
      throw corruptSave();
    }
    if (!Number.isInteger(value.saveSchemaVersion) || value.saveSchemaVersion < 1) {
      throw corruptSave();
    }
    return value;
  }

  async function readMeta(gameId) {
    const result = await storage.readJson(paths(gameId).meta, { schemaVersion: 1 });
    if (!result) return null;
    const value = result.value;
    if (!isPlainObject(value) || value.gameId !== gameId) return null;
    if (value.hasSave !== true) return null;
    if (!Number.isInteger(value.revision) || value.revision < 1) return null;
    return value;
  }

  function deriveMeta(gameId, current) {
    const values = current.values;
    return {
      schemaVersion: 1,
      gameId,
      hasSave: true,
      saveSchemaVersion: current.saveSchemaVersion,
      savedAt: current.savedAt,
      bytes: current.bytes,
      reason: current.reason,
      lastPlaySessionId: null,
      saveCount: 1,
      keys: Object.keys(values).length,
      revision: Number.isInteger(current.revision) ? current.revision : 1,
    };
  }

  /**
   * Metadata for list/Continue. `meta.json` is preferred, but the current save
   * is still validated because Continue must never point at a quarantined or
   * corrupt save. V0 keeps one built-in game, so the extra read is cheap.
   */
  async function meta(gameId) {
    validateGameId(gameId);
    const current = await readCurrent(gameId);
    if (!current || Object.keys(current.values).length === 0) return null;
    const stored = await readMeta(gameId);
    return stored || deriveMeta(gameId, current);
  }

  async function revision(gameId) {
    const value = await meta(gameId);
    return value && Number.isInteger(value.revision) ? value.revision : 0;
  }

  function saveSchemaVersionFor(info) {
    const schemaVersion = info?.manifest?.save?.schemaVersion;
    return Number.isInteger(schemaVersion) && schemaVersion >= 1 ? schemaVersion : 1;
  }

  function checkSchema(current, info) {
    const expected = saveSchemaVersionFor(info);
    if (current.saveSchemaVersion > expected) {
      throw hostError(GM.SAVE_SCHEMA_TOO_NEW, 'Save needs a newer game version', {
        retryable: false,
        details: { savedSchemaVersion: current.saveSchemaVersion, gameSchemaVersion: expected },
      });
    }
  }

  function copyValues(current) {
    const values = {};
    if (!current) return values;
    for (const key of Object.keys(current.values)) {
      if (!isValidStorageKey(key)) throw corruptSave('Save contains an invalid key');
      values[key] = current.values[key];
    }
    return values;
  }

  async function get(gameId, { includeData = false } = {}) {
    validateGameId(gameId);
    const info = await catalog.get(gameId);
    const current = await readCurrent(gameId);
    if (!current || Object.keys(current.values).length === 0) {
      throw hostError(GM.SAVE_NOT_FOUND, 'Save not found', { retryable: false });
    }
    checkSchema(current, info);
    const storedMeta = await readMeta(gameId);
    const revisionValue = Number.isInteger(current.revision)
      ? current.revision
      : storedMeta && Number.isInteger(storedMeta.revision)
        ? storedMeta.revision
        : 1;
    const values = copyValues(current);
    return {
      gameId,
      keys: Object.keys(values).length,
      bytes: Number.isInteger(current.bytes) ? current.bytes : jsonByteLength(values),
      revision: revisionValue,
      updatedAt:
        typeof current.savedAt === 'string'
          ? current.savedAt
          : storedMeta && typeof storedMeta.savedAt === 'string'
            ? storedMeta.savedAt
            : now().toISOString(),
      ...(includeData ? { values } : {}),
    };
  }

  async function save(body) {
    if (!isPlainObject(body)) throw hostError(GM.INVALID_PARAM, 'Request body must be an object');
    const gameId = validateGameId(body.gameId);
    return serialiseSave(gameId, () => saveLocked(gameId, body));
  }

  async function saveLocked(gameId, body) {
    const info = await catalog.get(gameId);
    if (!Array.isArray(info.manifest.capabilities) || !info.manifest.capabilities.includes('storage')) {
      throw hostError(GM.CAPABILITY_DENIED, 'Game did not declare the storage capability');
    }
    if (!Object.prototype.hasOwnProperty.call(body, 'data')) {
      throw hostError(GM.INVALID_PARAM, 'data is required');
    }
    if (!isValidStorageKey(body.key)) {
      throw hostError(GM.STORAGE_KEY_INVALID, 'Invalid storage key');
    }
    validateOperationId(body.operationId);
    const data = validateStoredValue(body.data);
    const valueBytes = jsonByteLength(data);
    if (valueBytes > LIMITS.saveValueBytes) {
      throw hostError(GM.SAVE_TOO_LARGE, 'A single save value exceeds 256 KiB', {
        details: { bytes: valueBytes, limitBytes: LIMITS.saveValueBytes },
      });
    }

    let expectedRevision;
    if (body.expectedRevision !== undefined && body.expectedRevision !== null) {
      if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
        throw hostError(GM.INVALID_PARAM, 'Invalid expectedRevision');
      }
      expectedRevision = body.expectedRevision;
    }

    const current = await readCurrent(gameId);
    if (current) checkSchema(current, info);
    const storedMeta = current ? await readMeta(gameId) : null;
    const currentRevision = current
      ? Number.isInteger(current.revision)
        ? current.revision
        : storedMeta && Number.isInteger(storedMeta.revision)
          ? storedMeta.revision
          : 1
      : 0;
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw hostError(GM.STORAGE_CONFLICT, 'Storage revision conflict', {
        retryable: false,
        details: { expectedRevision, actualRevision: currentRevision },
      });
    }

    const values = copyValues(current);
    const keyExists = Object.prototype.hasOwnProperty.call(values, body.key);
    if (!keyExists && Object.keys(values).length >= LIMITS.saveKeys) {
      throw hostError(GM.STORAGE_QUOTA, 'Save exceeds 32 keys', {
        details: { keys: Object.keys(values).length, limitKeys: LIMITS.saveKeys },
      });
    }
    values[body.key] = data;
    return writeValues({ gameId, info, currentRevision, storedMeta, values, reason: validateReason(body.reason) });
  }

  /** Durable write shared by save and remove (envelope + derived meta.json). */
  async function writeValues({ gameId, info, currentRevision, storedMeta, values, reason }) {
    const savedAt = now().toISOString();
    const saveSchemaVersion = saveSchemaVersionFor(info);
    const revisionValue = currentRevision + 1;
    const valuesBytes = jsonByteLength(values);
    const envelope = {
      schemaVersion: 1,
      gameId,
      saveSchemaVersion,
      savedAt,
      reason,
      bytes: valuesBytes,
      revision: revisionValue,
      values,
    };
    const envelopeBytes = jsonByteLength(envelope);
    if (valuesBytes > LIMITS.saveTotalBytes || envelopeBytes > LIMITS.saveTotalBytes) {
      throw hostError(GM.STORAGE_QUOTA, 'Save exceeds the 1 MiB limit', {
        details: {
          bytes: Math.max(valuesBytes, envelopeBytes),
          limitBytes: LIMITS.saveTotalBytes,
        },
      });
    }

    const keys = Object.keys(values).length;
    const metaValue = {
      schemaVersion: 1,
      gameId,
      hasSave: keys > 0,
      saveSchemaVersion,
      savedAt,
      bytes: valuesBytes,
      reason,
      lastPlaySessionId:
        storedMeta && typeof storedMeta.lastPlaySessionId === 'string'
          ? storedMeta.lastPlaySessionId
          : null,
      saveCount:
        (storedMeta && Number.isInteger(storedMeta.saveCount) ? storedMeta.saveCount : 0) + 1,
      keys,
      revision: revisionValue,
    };

    const files = paths(gameId);
    await storage.writeJson(files.current, envelope);
    let metaWritten = true;
    try {
      await storage.writeJson(files.meta, metaValue);
    } catch (error) {
      // current.json is already durable and authoritative; meta.json is only a
      // derived summary (PRD §8.6.5). Reporting a failure here while the new
      // save is committed made importers see "failed" yet find the imported
      // progress on disk. Keep the success result and report the partial
      // failure explicitly (read-only stores included).
      metaWritten = false;
      logger?.warn?.('[game-market/host] save-meta-write-failed', `code=${error?.code || 'E_UNKNOWN'}`);
    }

    return {
      gameId,
      keys,
      bytes: valuesBytes,
      revision: revisionValue,
      updatedAt: savedAt,
      ...(metaWritten ? {} : { warnings: ['save-meta-write-failed'] }),
    };
  }

  /**
   * Delete one key. A real delete (not `data:null`): the key disappears from
   * the envelope, its bytes are released, and an empty save is reported as
   * "no save" so Continue cannot point at it.
   */
  async function remove(body) {
    if (!isPlainObject(body)) throw hostError(GM.INVALID_PARAM, 'Request body must be an object');
    const gameId = validateGameId(body.gameId);
    return serialiseSave(gameId, () => removeLocked(gameId, body));
  }

  async function removeLocked(gameId, body) {
    const info = await catalog.get(gameId);
    if (!Array.isArray(info.manifest.capabilities) || !info.manifest.capabilities.includes('storage')) {
      throw hostError(GM.CAPABILITY_DENIED, 'Game did not declare the storage capability');
    }
    if (!isValidStorageKey(body.key)) {
      throw hostError(GM.STORAGE_KEY_INVALID, 'Invalid storage key');
    }
    validateOperationId(body.operationId);
    let expectedRevision;
    if (body.expectedRevision !== undefined && body.expectedRevision !== null) {
      if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
        throw hostError(GM.INVALID_PARAM, 'Invalid expectedRevision');
      }
      expectedRevision = body.expectedRevision;
    }

    const current = await readCurrent(gameId);
    const storedMeta = current ? await readMeta(gameId) : null;
    const currentRevision = current
      ? Number.isInteger(current.revision)
        ? current.revision
        : storedMeta && Number.isInteger(storedMeta.revision)
          ? storedMeta.revision
          : 1
      : 0;
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw hostError(GM.STORAGE_CONFLICT, 'Storage revision conflict', {
        retryable: false,
        details: { expectedRevision, actualRevision: currentRevision },
      });
    }
    if (!current) {
      return { gameId, key: body.key, removed: false, revision: 0, updatedAt: now().toISOString() };
    }
    checkSchema(current, info);
    const values = copyValues(current);
    if (!Object.prototype.hasOwnProperty.call(values, body.key)) {
      return {
        gameId,
        key: body.key,
        removed: false,
        revision: currentRevision,
        updatedAt: current.savedAt || now().toISOString(),
      };
    }
    delete values[body.key];
    const result = await writeValues({ gameId, info, currentRevision, storedMeta, values, reason: validateReason(body.reason) });
    return { gameId, key: body.key, removed: true, revision: result.revision, updatedAt: result.updatedAt };
  }

  async function exportTransfer(gameId, {backup = false} = {}) {
    validateGameId(gameId);
    if(backup){
      const record=await storage.readJson(storage.filePath('saves',gameId,'transfer-backup.json'),{schemaVersion:1});
      if(!record)throw hostError(GM.SAVE_NOT_FOUND,'No import backup');
      return validatePortableSave(record.value.portable);
    }
    const info=await catalog.get(gameId);
    const current=await readCurrent(gameId);
    if(!current || !Object.keys(current.values).length)throw hostError(GM.SAVE_NOT_FOUND,'No saved progress');
    checkSchema(current,info);
    return portableSave({gameId,gameVersion:info.manifest.version,saveSchemaVersion:current.saveSchemaVersion,values:copyValues(current)});
  }

  async function importTransfer(body) {
    if(!isPlainObject(body))throw hostError(GM.INVALID_PARAM,'Invalid transfer request');
    const gameId=validateGameId(body.gameId);
    const portable=validatePortableSave(body.portable);
    if(portable.gameId!==gameId)throw hostError(GM.INVALID_PARAM,'Portable save belongs to another game');
    if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)throw hostError(GM.INVALID_PARAM,'expectedRevision is required');
    if(typeof withInactiveGame!=='function')throw hostError(GM.HOST_UNAVAILABLE,'Import coordination unavailable');
    return serialiseSave(gameId,()=>withInactiveGame(gameId,async()=>{
      const info=await catalog.get(gameId);
      if(!info.manifest.capabilities?.includes('storage'))throw hostError(GM.CAPABILITY_DENIED,'Game has no storage capability');
      if(portable.saveSchemaVersion!==saveSchemaVersionFor(info))throw hostError(GM.SAVE_SCHEMA_TOO_NEW,'Install a game with the same save schema before importing');
      const current=await readCurrent(gameId);
      const storedMeta=current ? await readMeta(gameId) : null;
      const currentRevision=current ? (Number.isInteger(current.revision)?current.revision:Number.isInteger(storedMeta?.revision)?storedMeta.revision:1) : 0;
      if(body.expectedRevision!==currentRevision)throw hostError(GM.STORAGE_CONFLICT,'Progress changed; review before importing again');
      if(current && Object.keys(current.values).length){
        const before=portableSave({gameId,gameVersion:info.manifest.version,saveSchemaVersion:current.saveSchemaVersion,values:copyValues(current)});
        await storage.writeJson(storage.filePath('saves',gameId,'transfer-backup.json'),{schemaVersion:1,portable:before});
      }
      return writeValues({gameId,info,currentRevision,storedMeta,values:portable.values,reason:'manual'});
    }));
  }

  return { get, save, remove, meta, revision, paths, readCurrent, exportTransfer, importTransfer };

}
