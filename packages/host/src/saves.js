/**
 * Game Save persistence (PRD §8.3/§8.6.5, contracts.js `SaveEnvelope`).
 *
 * Files: `saves/<gameId>/current.json` + `saves/<gameId>/meta.json`.
 * The platform never interprets `values`; it enforces key/value/total limits
 * and revision CAS, then writes atomically through `HostStorage`.
 */

import { LIMITS } from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import { GM_STORE_READONLY, hostError } from './errors.js';
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

export function createSavesService({ storage, catalog, logger = null, now }) {
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

  /** Lightweight metadata for list/Continue; falls back to current.json. */
  async function meta(gameId) {
    validateGameId(gameId);
    const stored = await readMeta(gameId);
    if (stored) return stored;
    const current = await readCurrent(gameId);
    return current ? deriveMeta(gameId, current) : null;
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
    if (!current) {
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

    const savedAt = now().toISOString();
    const reason = validateReason(body.reason);
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

    const metaValue = {
      schemaVersion: 1,
      gameId,
      hasSave: true,
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
      keys: Object.keys(values).length,
      revision: revisionValue,
    };

    const files = paths(gameId);
    await storage.writeJson(files.current, envelope);
    try {
      await storage.writeJson(files.meta, metaValue);
    } catch (error) {
      // current.json is already durable; meta.json is a derived summary.
      if (error && error.code === GM.SCHEMA_READ_TOO_NEW) throw error;
      if (error && error.code === GM_STORE_READONLY) throw error;
      logger?.warn?.('[game-market/host] save-meta-write-failed', `code=${error?.code || 'E_UNKNOWN'}`);
    }

    return {
      gameId,
      keys: Object.keys(values).length,
      bytes: valuesBytes,
      revision: revisionValue,
      updatedAt: savedAt,
    };
  }

  return { get, save, meta, revision, paths, readCurrent };
}
