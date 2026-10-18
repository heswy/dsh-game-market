/**
 * `installations.json` store + installation projections (V1-CONTRACTS §6.2).
 *
 * The file is the single authority for installed games. Reads are defensive:
 * a record the shared validator rejects is ignored for listing (and reported as
 * broken on strict reads), never trusted.
 */

import {
  INSTALLATIONS_FILE,
  INSTALLATIONS_SCHEMA_VERSION,
  installationPackagePath,
  validateInstallationsFile,
} from '../../shared/src/installation.js';
import { GM } from '../../shared/src/errors.js';
import { hostError } from './errors.js';
import { createKeyedSerialiser } from './serial.js';
import { compareVersions } from './semver.js';
import { isPlainObject } from './validation.js';

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

/** Public `InstallationView` shape (V1-CONTRACTS §7.3). */
export function installationView(record, { warnings = [] } = {}) {
  if (!record) return null;
  return {
    id: record.id,
    version: record.version,
    source: record.source,
    packagePath: installationPackagePath(record.id, record.version),
    sha256: record.sha256,
    sizeBytes: record.sizeBytes,
    previousVersion: record.previousVersion ?? null,
    installedAt: record.installedAt || record.updatedAt || null,
    updatedAt: record.updatedAt || record.installedAt || null,
    manifest: record.manifest || null,
    compatibility: record.compatibility,
    update: record.update,
    warnings: warnings.slice(),
  };
}

function recordWithIdPassesValidation(id, record) {
  const result = validateInstallationsFile({
    schemaVersion: INSTALLATIONS_SCHEMA_VERSION,
    updatedAt: '1970-01-01T00:00:00.000Z',
    games: { [id]: record },
  });
  return result.ok;
}

export function createInstallationsStore({ storage, logger = null, now = () => new Date() }) {
  const serialiseInstallations = createKeyedSerialiser();

  function filePath() {
    return storage.filePath(INSTALLATIONS_FILE);
  }

  function empty() {
    return emptyInstallationsFile(now().toISOString());
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
    if (validation.ok) return value;

    const validGames = {};
    if (isPlainObject(value.games)) {
      for (const [id, record] of Object.entries(value.games)) {
        if (recordWithIdPassesValidation(id, record)) validGames[id] = record;
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
      games: file.games || {},
    };
    const validation = validateInstallationsFile(document);
    if (!validation.ok) {
      const first = validation.errors[0] || {};
      throw hostError(GM.INSTALL_CORRUPT, 'Refusing to write an invalid installation record', {
        retryable: false,
        details: { field: typeof first.field === 'string' ? first.field : undefined },
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
    return update((file) => {
      file.games[record.id] = record;
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
      file.games[gameId] = { ...current, ...patchValue };
      return file;
    });
  }

  return { filePath, empty, read, write, update, get, records, put, remove, patch };
}
