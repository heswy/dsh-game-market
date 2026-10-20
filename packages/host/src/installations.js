/**
 * `installations.json` store + installation projections (V1-CONTRACTS §6.2,
 * V1.5-CONTRACTS §6.2/§6.5).
 *
 * The file is the single authority for installed games. Reads are defensive:
 * a record the shared validator rejects is ignored for listing (and reported as
 * broken on strict reads), never trusted.
 *
 * V1.5 fields (`format`/`entry`/`fileManifestDigest`/`fileCount`/
 * `unpackedBytes`/`previousFormat`) are optional and `schemaVersion` stays 1.
 * They are normalized on read and persisted on the next write (§6.2 item 4).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { ASSET_ZIP_V2 } from '../../shared/src/constants.js';
import {
  ENTRY_FILE,
  INSTALLATIONS_FILE,
  INSTALLATIONS_SCHEMA_VERSION,
  PACKAGES_DIR,
  installationPackagePath,
  normalizeInstallationRecord,
  validateInstallationRecordV15,
  validateInstallationsFile,
} from '../../shared/src/installation.js';
import { GM } from '../../shared/src/errors.js';
import { hostError } from './errors.js';
import { sha256Hex } from './ids.js';
import { createKeyedSerialiser } from './serial.js';
import { compareVersions } from './semver.js';
import { isInside, isPlainObject } from './validation.js';
import { verifyPackageDirectory } from './zip.js';

export function emptyInstallationsFile(nowIso) {
  return {
    schemaVersion: INSTALLATIONS_SCHEMA_VERSION,
    updatedAt: nowIso,
    games: {},
  };
}

/** Deterministic newest-first ordering using strict semver comparison. */
export function sortVersionsDesc(versions) {
  return versions
    .filter((version) => typeof version === 'string')
    .sort((left, right) => compareVersions(right, left));
}

/** Public `InstallationView` shape (V1-CONTRACTS §7.3 + V1.5 §6.2). */
export function installationView(record, { warnings = [] } = {}) {
  if (!record) return null;
  const normalized = normalizeInstallationRecord(record);
  return {
    id: normalized.id,
    version: normalized.version,
    source: normalized.source,
    packagePath: installationPackagePath(normalized.id, normalized.version),
    sha256: normalized.sha256,
    sizeBytes: normalized.sizeBytes,
    format: normalized.format,
    entry: normalized.entry,
    fileManifestDigest: normalized.fileManifestDigest,
    fileCount: normalized.fileCount,
    unpackedBytes: normalized.unpackedBytes,
    previousVersion: normalized.previousVersion ?? null,
    previousFormat: normalized.previousFormat,
    installedAt: normalized.installedAt || normalized.updatedAt || null,
    updatedAt: normalized.updatedAt || normalized.installedAt || null,
    manifest: normalized.manifest || null,
    compatibility: normalized.compatibility,
    update: normalized.update,
    warnings: warnings.slice(),
  };
}

/** Validate one record against both the V1 and the optional V1.5 field rules. */
function recordValuePassesValidation(id, record) {
  if (!isPlainObject(record)) return false;
  const result = validateInstallationsFile({
    schemaVersion: INSTALLATIONS_SCHEMA_VERSION,
    updatedAt: '1970-01-01T00:00:00.000Z',
    games: { [id]: record },
  });
  if (!result.ok) return false;
  return validateInstallationRecordV15(record).ok;
}

function firstRecordError(id, record) {
  const base = validateInstallationsFile({
    schemaVersion: INSTALLATIONS_SCHEMA_VERSION,
    updatedAt: '1970-01-01T00:00:00.000Z',
    games: { [id]: record },
  });
  if (!base.ok) return base.errors[0] || {};
  return validateInstallationRecordV15(record).errors[0] || {};
}

export function createInstallationsStore({ storage, logger = null, now = () => new Date() }) {
  const serialiseInstallations = createKeyedSerialiser();

  function filePath() {
    return storage.filePath(INSTALLATIONS_FILE);
  }

  function empty() {
    return emptyInstallationsFile(now().toISOString());
  }

  /** Fill V1.5 defaults for every record before it is handed to callers. */
  function normaliseGames(games) {
    const next = {};
    for (const [id, record] of Object.entries(games || {})) {
      next[id] = normalizeInstallationRecord(record);
    }
    return next;
  }

  function assertRecordV15(id, record) {
    const result = validateInstallationRecordV15(record);
    if (result.ok) return;
    const first = result.errors[0] || {};
    throw hostError(GM.INSTALL_CORRUPT, 'installations.json is invalid', {
      retryable: false,
      details: { field: typeof first.field === 'string' ? first.field : `games.${id}` },
    });
  }

  /**
   * @param {{strict?: boolean}} [options]
   * @returns {Promise<{schemaVersion:number, updatedAt:string, games:object}>}
   */
  async function read({ strict = false } = {}) {
    let result;
    try {
      result = await storage.readJson(filePath(), { schemaVersion: INSTALLATIONS_SCHEMA_VERSION });
    } catch (error) {
      if (error && error.code === GM.SCHEMA_READ_TOO_NEW) throw error;
      throw error;
    }
    if (!result) return empty();
    const value = result.value;
    const validation = validateInstallationsFile(value);
    if (validation.ok) {
      const games = normaliseGames(value.games);
      for (const [id, record] of Object.entries(games)) {
        if (!validateInstallationRecordV15(record).ok) {
          if (strict) {
            const first = validateInstallationRecordV15(record).errors[0] || {};
            throw hostError(GM.INSTALL_CORRUPT, 'installations.json is invalid', {
              retryable: false,
              details: { field: typeof first.field === 'string' ? first.field : `games.${id}` },
            });
          }
          logger?.warn?.('[game-market/host] installations-invalid', 'records=1');
          delete games[id];
        }
      }
      return { ...value, games };
    }

    const validGames = {};
    if (isPlainObject(value.games)) {
      for (const [id, record] of Object.entries(value.games)) {
        if (recordValuePassesValidation(id, record)) validGames[id] = normalizeInstallationRecord(record);
      }
    }
    if (strict) {
      const first = validation.errors[0] || {};
      throw hostError(GM.INSTALL_CORRUPT, 'installations.json is invalid', {
        retryable: false,
        details: { field: typeof first.field === 'string' ? first.field : undefined },
      });
    }
    logger?.warn?.('[game-market/host] installations-invalid', `records=${validation.errors.length}`);
    return {
      schemaVersion: INSTALLATIONS_SCHEMA_VERSION,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now().toISOString(),
      games: validGames,
    };
  }

  async function write(file) {
    const document = {
      schemaVersion: INSTALLATIONS_SCHEMA_VERSION,
      updatedAt: now().toISOString(),
      // §6.2 item 4: read-time normalization is persisted on the next write.
      games: normaliseGames(file.games),
    };
    const validation = validateInstallationsFile(document);
    if (!validation.ok) {
      const first = validation.errors[0] || {};
      throw hostError(GM.INSTALL_CORRUPT, 'Refusing to write an invalid installation record', {
        retryable: false,
        details: { field: typeof first.field === 'string' ? first.field : undefined },
      });
    }
    for (const [id, record] of Object.entries(document.games)) {
      if (recordValuePassesValidation(id, record)) continue;
      throw hostError(GM.INSTALL_CORRUPT, 'Refusing to write an invalid installation record', {
        retryable: false,
        details: { field: firstRecordError(id, record).field },
      });
    }
    await storage.writeJson(filePath(), document);
    return document;
  }

  function update(mutator) {
    return serialiseInstallations('installations', async () => {
      const file = await read();
      const next = (await mutator(file)) || file;
      return write(next);
    });
  }

  async function get(gameId) {
    if (typeof gameId !== 'string') return null;
    const file = await read();
    return file.games[gameId] || null;
  }

  async function records() {
    const file = await read();
    return Object.values(file.games);
  }

  async function put(record) {
    const normalized = normalizeInstallationRecord(record);
    return update((file) => {
      file.games[normalized.id] = normalized;
      return file;
    });
  }

  async function remove(gameId) {
    return update((file) => {
      delete file.games[gameId];
      return file;
    });
  }

  /** Persist a modified record without bumping other fields' semantics. */
  async function patch(gameId, patchValue) {
    return update((file) => {
      const current = file.games[gameId];
      if (!current) return file;
      file.games[gameId] = normalizeInstallationRecord({ ...current, ...patchValue });
      return file;
    });
  }

  return { filePath, empty, read, write, update, get, records, put, remove, patch };
}

/**
 * Startup-recovery consistency check for one installed record
 * (V1.5-CONTRACTS §6.5). Never mutates or deletes anything: the caller decides
 * whether to mark `compatibility.status = 'broken'`.
 *
 * - `html-v1`: entry file exists; when the record carries an outer `sha256`
 *   (registry installs) the file bytes must hash to it.
 * - `asset-zip-v2`: entry exists, `dsh-package.json` exists and its
 *   `fileManifestDigest` equals the record's.
 *
 * @param {object} record Installation record.
 * @param {{storage?: object, directory?: string}} [options]
 * @returns {Promise<{ok:boolean, reason:string|null}>}
 */
export async function verifyInstalledRecord(record, { storage = null, directory = null } = {}) {
  if (!isPlainObject(record)) return { ok: false, reason: 'record-invalid' };
  const normalized = normalizeInstallationRecord(record);
  let versionDirectory = directory;
  if (!versionDirectory) {
    if (!storage || typeof storage.filePath !== 'function') {
      throw new TypeError('verifyInstalledRecord requires a storage root or an explicit directory');
    }
    versionDirectory = storage.filePath(PACKAGES_DIR, normalized.id, normalized.version);
  }
  const entryPath = path.join(versionDirectory, normalized.entry);
  if (!isInside(versionDirectory, entryPath)) return { ok: false, reason: 'entry-missing' };
  let stats;
  try {
    stats = await fs.lstat(entryPath);
  } catch (_error) {
    return { ok: false, reason: 'entry-missing' };
  }
  if (!stats.isFile()) return { ok: false, reason: 'entry-missing' };

  if (normalized.format === ASSET_ZIP_V2) {
    const result = await verifyPackageDirectory({ directory: versionDirectory, record: normalized });
    return { ok: result.ok === true, reason: result.reason || null };
  }

  // html-v1: registry installs record the outer sha256; local installs do not
  // have a trusted digest (V1 contract), so existence is the only check.
  if (typeof normalized.sha256 === 'string') {
    let bytes;
    try {
      bytes = await fs.readFile(entryPath);
    } catch (_error) {
      return { ok: false, reason: 'entry-missing' };
    }
    if (sha256Hex(bytes) !== normalized.sha256) return { ok: false, reason: 'sha256-mismatch' };
  }
  return { ok: true, reason: null };
}
