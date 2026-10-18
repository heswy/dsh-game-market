/**
 * V1 installation model + on-disk layout (PRD §8.6 / §8.7, D-035).
 *
 * Storage root: `$DSH_HOME/storages/dsh-game-market/`.
 * Installed packages live at `packages/<id>/<version>/entry.html`; package
 * bytes are never executed during install and no path from inside the package
 * is ever used to build a filesystem path.
 *
 * Pure JS: path helpers return POSIX-style relative paths; Host joins them
 * with its own storage root.
 */

import { LIMITS } from './constants.js';
import { isValidVersion } from './manifest.js';

export const STORAGE_DIR_NAME = 'dsh-game-market';
export const INSTALLATIONS_FILE = 'installations.json';
export const PREFERENCES_FILE = 'preferences.json';
export const PACKAGES_DIR = 'packages';
export const ENTRY_FILE = 'entry.html';
export const SAVES_DIR = 'saves';
export const SESSIONS_DIR = 'sessions';
export const SCORES_DIR = 'scores';
export const PREVIEW_CACHE_DIR = 'preview-cache';
export const STAGING_DIR = 'staging';
export const TRASH_DIR = 'trash';
export const LOGS_DIR = 'logs';
export const LOG_FILE = 'market.log';
export const INSTALLATIONS_SCHEMA_VERSION = 1;
export const SUPPORTED_INSTALL_SCHEMA_VERSION = 1;

export const INSTALL_SOURCES = Object.freeze(['registry', 'local', 'dev', 'builtin']);
export const INSTALL_JOB_STATES = Object.freeze([
  'queued',
  'downloading',
  'verifying',
  'installing',
  'installed',
  'failed',
]);
export const COMPAT_STATUSES = Object.freeze(['ok', 'incompatible', 'broken']);

/** Keep the current version + one previous version for rollback (PRD §8.7.6). */
export const KEPT_PREVIOUS_VERSIONS = 1;

/** Relative to the storage root: `packages/<id>/<version>/entry.html`. */
export function entryStoragePath(id, version) {
  return `${PACKAGES_DIR}/${id}/${version}/${ENTRY_FILE}`;
}

/** Relative to the storage root: `packages/<id>/<version>`. */
export function packageStoragePath(id, version) {
  return `${PACKAGES_DIR}/${id}/${version}`;
}

/** Stored in installations.json#packagePath: `<id>/<version>` (under packages/). */
export function installationPackagePath(id, version) {
  return `${id}/${version}`;
}

export function savesPath(id) {
  return `${SAVES_DIR}/${id}`;
}

export function sessionRecordPath(id) {
  return `${SESSIONS_DIR}/${id}.json`;
}

export function scoreRecordPath(id) {
  return `${SCORES_DIR}/${id}.json`;
}

export function previewCachePath(id, version) {
  return `${PREVIEW_CACHE_DIR}/${id}/${version}`;
}

export function stagingPath(jobId) {
  return `${STAGING_DIR}/${jobId}`;
}

export function trashPath(id, timestamp) {
  return `${TRASH_DIR}/${id}-${timestamp}`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/**
 * Validate `installations.json`. Unknown fields inside a record are preserved
 * by callers; this only rejects shapes the Host cannot reason about.
 * @returns {{ok:boolean, errors:object[]}}
 */
export function validateInstallationsFile(input) {
  const errors = [];
  const fail = (code, message, field) => errors.push({ code, message, ...(field ? { field } : {}) });
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ code: 'E_STORE_SCHEMA', message: 'installations must be an object' }] };
  }
  if (input.schemaVersion !== INSTALLATIONS_SCHEMA_VERSION) {
    fail('E_STORE_SCHEMA_NEWER', 'unsupported installations schemaVersion', 'schemaVersion');
  }
  if (!isIsoDate(input.updatedAt)) fail('E_STORE_SCHEMA', 'updatedAt must be an ISO timestamp', 'updatedAt');
  if (!isPlainObject(input.games)) {
    fail('E_STORE_SCHEMA', 'games must be an object', 'games');
    return { ok: false, errors };
  }
  for (const [id, record] of Object.entries(input.games)) {
    if (!isPlainObject(record)) {
      fail('E_INSTALL_CORRUPT', 'installation record must be an object', `games.${id}`);
      continue;
    }
    if (record.id !== id) fail('E_INSTALL_CORRUPT', 'record id must match its key', `games.${id}.id`);
    if (typeof record.version !== 'string' || !isValidVersion(record.version)) {
      fail('E_INSTALL_CORRUPT', 'record version must be semver', `games.${id}.version`);
    }
    if (!INSTALL_SOURCES.includes(record.source)) {
      fail('E_INSTALL_CORRUPT', 'record source is invalid', `games.${id}.source`);
    }
    if (record.packagePath !== `${id}/${record.version}`) {
      fail('E_INSTALL_CORRUPT', 'packagePath must be "<id>/<version>"', `games.${id}.packagePath`);
    }
    if (record.sha256 !== null && (typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256))) {
      fail('E_INSTALL_CORRUPT', 'record sha256 must be 64 lowercase hex or null', `games.${id}.sha256`);
    }
    if (!Number.isInteger(record.sizeBytes) || record.sizeBytes < 0 || record.sizeBytes > LIMITS.packageBytes) {
      fail('E_INSTALL_CORRUPT', 'record sizeBytes is out of range', `games.${id}.sizeBytes`);
    }
    if (record.previousVersion !== null && (typeof record.previousVersion !== 'string' || !isValidVersion(record.previousVersion))) {
      fail('E_INSTALL_CORRUPT', 'record previousVersion must be a semver or null', `games.${id}.previousVersion`);
    }
    if (!isPlainObject(record.compatibility) || !COMPAT_STATUSES.includes(record.compatibility.status)) {
      fail('E_INSTALL_CORRUPT', 'record compatibility is invalid', `games.${id}.compatibility`);
    }
    if (!isPlainObject(record.update) || typeof record.update.available !== 'boolean') {
      fail('E_INSTALL_CORRUPT', 'record update is invalid', `games.${id}.update`);
    }
    if (record.lastPlayedAt !== null && !isIsoDate(record.lastPlayedAt)) {
      fail('E_INSTALL_CORRUPT', 'record lastPlayedAt must be an ISO timestamp or null', `games.${id}.lastPlayedAt`);
    }
    if (!Number.isInteger(record.playCount) || record.playCount < 0) {
      fail('E_INSTALL_CORRUPT', 'record playCount must be a non-negative integer', `games.${id}.playCount`);
    }
    if (typeof record.totalPlayMinutes !== 'number' || record.totalPlayMinutes < 0) {
      fail('E_INSTALL_CORRUPT', 'record totalPlayMinutes must be a non-negative number', `games.${id}.totalPlayMinutes`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Registry versions that exceed the rollback window (cleanup candidates).
 * `versions` must be sorted newest-first; the current version and the newest
 * `keep` other versions are retained (PRD §8.7.6: current + 1 previous).
 */
export function versionsToPrune(versions, currentVersion, keep = KEPT_PREVIOUS_VERSIONS) {
  if (!Array.isArray(versions)) return [];
  const unique = [...new Set(versions.filter((version) => typeof version === 'string' && isValidVersion(version)))];
  const others = unique.filter((version) => version !== currentVersion);
  return others.slice(Math.max(0, keep));
}
