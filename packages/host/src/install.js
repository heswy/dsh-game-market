/**
 * Install / update / uninstall / local install (V1-CONTRACTS §6.3–§6.6, §6.8).
 *
 * Safety model:
 *   - everything happens inside the managed storage root;
 *   - package bytes are downloaded into `staging/<jobId>/entry.html.part`,
 *     hashed while streaming, verified against the Registry, parsed and
 *     validated before anything is placed under `packages/`;
 *   - placement is a same-directory rename; `installations.json` is written
 *     atomically; any failure removes the new version and keeps the old one;
 *   - installs/uninstalls are globally serialised (process mutex + cross-
 *     process lock file).
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { LIMITS, RUNTIME_VERSION, TIMING } from '../../shared/src/constants.js';
import { GM, gmForInternal } from '../../shared/src/errors.js';
import {
  ENTRY_FILE,
  PACKAGES_DIR,
  PREVIEW_CACHE_DIR,
  SAVES_DIR,
  SCORES_DIR,
  SESSIONS_DIR,
  STAGING_DIR,
  TRASH_DIR,
  installationPackagePath,
} from '../../shared/src/installation.js';
import { validatePackageHtml } from '../../shared/src/manifest.js';
import { allowedHostSet, validatePackageUrl } from '../../shared/src/registry.js';
import { downloadToFile } from './download.js';
import { hostError } from './errors.js';
import { queryValue } from './http.js';
import { createJobId, randomHex, sha256Hex } from './ids.js';
import { installationView } from './installations.js';
import { checkCompatibility, compatibilityFor, compareVersions, parseVersion } from './semver.js';
import { isInside, isPlainObject, validateGameId, validateOperationId } from './validation.js';

const OPERATION_TTL_MS = 10 * 60 * 1000;
const OPERATION_LIMIT = 200;
const JOB_HISTORY = 20;
const PACKAGE_TIMEOUTS = Object.freeze({
  connectMs: TIMING.downloadConnectMs,
  idleMs: TIMING.downloadIdleMs,
  totalMs: TIMING.downloadTotalMs,
});

function sleepDefault(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodePackageText(bytes) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return text;
  } catch (_error) {
    throw hostError(GM.UNSUPPORTED_MEDIA_TYPE, 'Package is not valid UTF-8 HTML', { retryable: false });
  }
}

function packageValidationError(validation) {
  const first = (validation && validation.errors && validation.errors[0]) || null;
  if (!first) return hostError(GM.MANIFEST_INVALID, 'Invalid game package');
  const code = gmForInternal(first.code);
  const details = {};
  if (typeof first.field === 'string') details.field = first.field;
  return hostError(code, typeof first.message === 'string' ? first.message : 'Invalid game package', {
    retryable: false,
    details: Object.keys(details).length > 0 ? details : undefined,
  });
}

function fsIoError(error, message) {
  if (error && error.code === 'ENOSPC') {
    return hostError(GM.INSTALL_DISK_FULL, 'Not enough disk space for this install', { retryable: true });
  }
  if (error && error.code === GM.STORE_PATH_ESCAPE) return error;
  return hostError(GM.INSTALL_IO, message || 'Install write failed', { retryable: true });
}

function timestampSlug() {
  return new Date().toISOString().replace(/[-:.]/g, '');
}

async function pathExists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (_error) {
    return false;
  }
}

async function hashFile(target) {
  const bytes = await fs.readFile(target);
  return sha256Hex(bytes);
}

async function syncDirectory(directory) {
  let handle = null;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (_error) {
    // Not supported on every platform; rename is still atomic.
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}

/**
 * @param {{
 *   storage: object,
 *   settings: object,
 *   registry: object,
 *   catalog: object,
 *   installations: object,
 *   sessions: object,
 *   saves: object,
 *   preferences?: object,
 *   entry: object,
 *   lock: object,
 *   logger?: object,
 *   now?: () => Date,
 *   http?: object
 * }} options
 */
export function createInstallService({
  storage,
  settings = {},
  registry,
  catalog,
  installations,
  sessions,
  saves,
  preferences = null,
  entry,
  lock,
  maintenance = null,
  logger = null,
  now = () => new Date(),
  http = {},
}) {
  const devMode = settings.devMode === true;
  const installLockWaitMs =
    Number.isFinite(http.installLockWaitMs) && http.installLockWaitMs >= 0
      ? http.installLockWaitMs
      : TIMING.installLockWaitMs;
  const fetchImpl = typeof http.fetch === 'function' ? http.fetch : null;
  const sleep = typeof http.sleep === 'function' ? http.sleep : sleepDefault;
  const resolveHost = typeof http.resolveHost === 'function' ? http.resolveHost : undefined;
  const retries = Number.isInteger(http.retries) && http.retries >= 0 ? http.retries : 2;
  const retryDelaysMs = Array.isArray(http.retryDelaysMs) ? http.retryDelaysMs : [1000, 3000];

  const operations = new Map();
  const jobs = [];

  function recordJob(jobId, state, extra = {}) {
    const current = jobs.find((job) => job.jobId === jobId);
    const stamp = now().toISOString();
    if (current) {
      Object.assign(current, { state, updatedAt: stamp, ...extra });
    } else {
      jobs.push({ jobId, state, startedAt: stamp, updatedAt: stamp, ...extra });
      if (jobs.length > JOB_HISTORY) jobs.shift();
    }
  }

  function lookupOperation(scope, operationId, params) {
    if (!operationId) return null;
    const key = `${scope}:${operationId}`;
    const hit = operations.get(key);
    if (!hit) return null;
    if (now().getTime() - hit.at > OPERATION_TTL_MS) {
      operations.delete(key);
      return null;
    }
    if (hit.params !== params) {
      throw hostError(GM.INVALID_PARAM, 'operationId was reused with different parameters', {
        retryable: false,
      });
    }
    operations.delete(key);
    operations.set(key, hit);
    return hit.result;
  }

  function storeOperation(scope, operationId, params, result) {
    if (!operationId) return;
    const key = `${scope}:${operationId}`;
    operations.delete(key);
    operations.set(key, { params, result, at: now().getTime() });
    while (operations.size > OPERATION_LIMIT) {
      const oldest = operations.keys().next().value;
      if (oldest === undefined) break;
      operations.delete(oldest);
    }
  }

  function isBuiltinGame(gameId) {
    return Array.isArray(catalog?.entries) && catalog.entries.some((item) => item && item.id === gameId);
  }

  async function isRunning(gameId) {
    if (entry && typeof entry.hasActiveInstance === 'function' && entry.hasActiveInstance(gameId)) {
      return true;
    }
    const running = await sessions.findRunning(gameId).catch(() => null);
    return Boolean(running);
  }

  function compatibilityCode(compatibility) {
    const reasons = Array.isArray(compatibility.reasons) ? compatibility.reasons : [];
    if (reasons.includes(GM.SDK_INCOMPATIBLE)) return GM.SDK_INCOMPATIBLE;
    if (reasons.includes(GM.RUNTIME_INCOMPATIBLE)) return GM.RUNTIME_INCOMPATIBLE;
    return GM.MANIFEST_INVALID;
  }

  async function registryEntry(entry) {
    const compatibility = compatibilityFor(
      {
        capabilities: entry.capabilities,
        sdkVersion: entry.sdkVersion,
        runtimeVersion: entry.runtimeVersion,
      },
      now().toISOString()
    );
    if (compatibility.status !== 'ok') {
      throw hostError(compatibilityCode(compatibility), 'Game is not compatible with this Runtime', {
        retryable: false,
        details: { required: compatibility.sdkRange || compatibility.runtimeRange, actual: RUNTIME_VERSION },
      });
    }
    return entry;
  }

  async function resolvePackageTarget(entry) {
    const source = registry.source || null;
    if (!source) {
      throw hostError(GM.INSTALL_URL_REJECTED, 'No registry source is configured', { retryable: false });
    }
    const result = validatePackageUrl(entry.package.url, {
      id: entry.id,
      version: entry.version,
      sourceType: source.kind,
      sourceUrl: registry.sourceUrl,
      allowedHosts: registry.allowedHosts,
    });
    if (!result.ok) {
      throw hostError(GM.INSTALL_URL_REJECTED, 'Package URL is not allowed', {
        retryable: false,
        details: { reason: 'url' },
      });
    }
    if (source.kind === 'file') {
      const baseDirectory = path.dirname(source.path);
      let realBase;
      try {
        realBase = await fs.realpath(baseDirectory);
      } catch (_error) {
        throw hostError(GM.INSTALL_DOWNLOAD_FAILED, 'Registry directory is not readable', { retryable: true });
      }
      const candidate = path.resolve(realBase, result.url);
      if (!isInside(realBase, candidate)) {
        throw hostError(GM.INSTALL_URL_REJECTED, 'Package path escapes the registry directory', {
          retryable: false,
        });
      }
      let realTarget;
      try {
        realTarget = await fs.realpath(candidate);
      } catch (_error) {
        throw hostError(GM.INSTALL_DOWNLOAD_FAILED, 'Package file is not available', { retryable: true });
      }
      if (!isInside(realBase, realTarget)) {
        throw hostError(GM.INSTALL_URL_REJECTED, 'Package path escapes the registry directory', {
          retryable: false,
        });
      }
      let stats;
      try {
        stats = await fs.stat(realTarget);
      } catch (_error) {
        throw hostError(GM.INSTALL_DOWNLOAD_FAILED, 'Package file is not available', { retryable: true });
      }
      if (!stats.isFile()) {
        throw hostError(GM.INSTALL_DOWNLOAD_FAILED, 'Package file is not available', { retryable: true });
      }
      return { kind: 'file', path: realTarget, size: stats.size };
    }
    return { kind: 'https', url: result.url };
  }

  async function fetchPackageInto(target, partPath, entry) {
    if (target.kind === 'file') {
      if (target.size > LIMITS.packageBytes) {
        throw hostError(GM.PACKAGE_TOO_LARGE, 'Game package exceeds the size limit', {
          retryable: false,
          details: { limitBytes: LIMITS.packageBytes },
        });
      }
      if (target.size !== entry.package.size) {
        throw hostError(GM.INSTALL_CORRUPT, 'Installed package is incomplete', {
          retryable: true,
          details: { reason: 'size' },
        });
      }
      let bytes;
      try {
        bytes = await fs.readFile(target.path);
      } catch (_error) {
        throw hostError(GM.INSTALL_DOWNLOAD_FAILED, 'Package file could not be read', { retryable: true });
      }
      if (bytes.length !== entry.package.size) {
        throw hostError(GM.INSTALL_CORRUPT, 'Installed package is incomplete', {
          retryable: true,
          details: { reason: 'size' },
        });
      }
      const digest = sha256Hex(bytes);
      if (digest !== entry.package.sha256) {
        throw hostError(GM.INSTALL_HASH_MISMATCH, 'Package SHA-256 does not match the registry', {
          retryable: true,
          details: { reason: 'sha256' },
        });
      }
      try {
        await fs.writeFile(partPath, bytes, { mode: 0o644, flag: 'wx' });
      } catch (error) {
        throw fsIoError(error, 'Could not stage the package');
      }
      return { sha256: digest, bytes: bytes.length };
    }

    const allowed = allowedHostSet({
      allowedHosts: registry.allowedHosts,
      sourceUrl: registry.sourceUrl,
    });
    let result;
    try {
      result = await downloadToFile(target.url, partPath, {
        fetchImpl,
        sleep,
        resolveHost,
        devMode,
        maxBytes: LIMITS.packageBytes,
        connectMs: PACKAGE_TIMEOUTS.connectMs,
        idleMs: PACKAGE_TIMEOUTS.idleMs,
        totalMs: PACKAGE_TIMEOUTS.totalMs,
        retries,
        retryDelaysMs,
        validateHop: (url) => {
          if (url.protocol !== 'https:') {
            throw hostError(GM.INSTALL_URL_REJECTED, 'Package URL must use https', { retryable: false });
          }
          if (url.username || url.password) {
            throw hostError(GM.INSTALL_URL_REJECTED, 'Package URL must not contain credentials', {
              retryable: false,
            });
          }
          if (!allowed.has(url.hostname.toLowerCase())) {
            throw hostError(GM.INSTALL_URL_REJECTED, 'Package host is not allowed', { retryable: false });
          }
          if (url.toString().length > 1000) {
            throw hostError(GM.INSTALL_URL_REJECTED, 'Package URL is too long', { retryable: false });
          }
        },
        errorCodes: {
          rejected: GM.INSTALL_URL_REJECTED,
          fetch: GM.INSTALL_DOWNLOAD_FAILED,
          timeout: GM.INSTALL_DOWNLOAD_TIMEOUT,
          tooLarge: GM.PACKAGE_TOO_LARGE,
        },
      });
    } catch (error) {
      if (error && error.name === 'HostError') throw error;
      throw hostError(GM.INSTALL_DOWNLOAD_FAILED, 'Package download failed', { retryable: true });
    }
    if (result.bytes !== entry.package.size) {
      throw hostError(GM.INSTALL_CORRUPT, 'Installed package is incomplete', {
        retryable: true,
        details: { reason: 'size' },
      });
    }
    if (result.sha256 !== entry.package.sha256) {
      throw hostError(GM.INSTALL_HASH_MISMATCH, 'Package SHA-256 does not match the registry', {
        retryable: true,
        details: { reason: 'sha256' },
      });
    }
    return { sha256: result.sha256, bytes: result.bytes };
  }

  async function validateStagedPackage(stagedPath, { expectedId, expectedVersion }) {
    let bytes;
    try {
      bytes = await fs.readFile(stagedPath);
    } catch (_error) {
      throw hostError(GM.INSTALL_CORRUPT, 'Installed package is incomplete', { retryable: true });
    }
    if (bytes.length > LIMITS.packageBytes) {
      throw hostError(GM.PACKAGE_TOO_LARGE, 'Game package exceeds the size limit', {
        retryable: false,
        details: { limitBytes: LIMITS.packageBytes },
      });
    }
    const text = decodePackageText(bytes);
    const validation = validatePackageHtml(text, { packageBytes: LIMITS.packageBytes });
    if (!validation.ok || !validation.manifest) throw packageValidationError(validation);
    const manifest = validation.manifest;
    if (expectedId !== undefined && manifest.id !== expectedId) {
      throw hostError(GM.INSTALL_VERSION_MISMATCH, 'Package id does not match the registry entry', {
        retryable: false,
      });
    }
    if (expectedVersion !== undefined && manifest.version !== expectedVersion) {
      throw hostError(GM.INSTALL_VERSION_MISMATCH, 'Package version does not match the registry entry', {
        retryable: false,
      });
    }
    checkCompatibility(manifest);
    return { manifest, bytes, warnings: validation.warnings };
  }

  async function placePackage({ id, version, stagedPath, sha256, sizeBytes }) {
    const targetDirectory = storage.filePath(PACKAGES_DIR, id, version);
    const entryPath = path.join(targetDirectory, ENTRY_FILE);
    const directoryExisted = await pathExists(targetDirectory);
    if (await pathExists(entryPath)) {
      let stats;
      try {
        stats = await fs.lstat(entryPath);
      } catch (_error) {
        stats = null;
      }
      if (!stats || stats.isSymbolicLink() || !stats.isFile()) {
        throw hostError(GM.STORE_PATH_ESCAPE, 'Package entry is not a regular file', { retryable: false });
      }
      const existing = await hashFile(entryPath);
      if (existing === sha256) return { entryPath, created: false, replaced: false };
      throw hostError(GM.INSTALL_VERSION_CONFLICT, 'Installed version conflicts with this install', {
        retryable: false,
      });
    }
    const temporary = path.join(targetDirectory, `.entry.${process.pid}.${randomHex(6)}.tmp`);
    try {
      await fs.mkdir(targetDirectory, { recursive: true, mode: 0o755 });
      await fs.copyFile(stagedPath, temporary);
      await fs.chmod(temporary, 0o644);
      await fs.rename(temporary, entryPath);
      await syncDirectory(targetDirectory);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw fsIoError(error, 'Could not place the installed package');
    }
    return { entryPath, created: !directoryExisted, replaced: directoryExisted };
  }

  async function trashPathFor(id) {
    const base = `${id}-${timestampSlug()}`;
    let target = storage.filePath(TRASH_DIR, base);
    if (await pathExists(target)) target = storage.filePath(TRASH_DIR, `${base}-${randomHex(2)}`);
    return target;
  }

  async function moveToTrash(targetPath, id) {
    if (!(await pathExists(targetPath))) return null;
    const target = await trashPathFor(id);
    try {
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.rename(targetPath, target);
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw fsIoError(error, 'Could not move data to trash');
    }
    try {
      await fs.rm(target, { recursive: true, force: true });
    } catch (_error) {
      // Kept for the 7-day startup cleanup window.
    }
    return target;
  }

  async function pruneVersions(id, currentVersion, previousVersion) {
    const idDirectory = storage.filePath(PACKAGES_DIR, id);
    let entries;
    try {
      entries = await fs.readdir(idDirectory, { withFileTypes: true });
    } catch (_error) {
      entries = [];
    }
    const keep = new Set([currentVersion, previousVersion].filter((value) => typeof value === 'string'));
    for (const item of entries) {
      if (!item.isDirectory() || keep.has(item.name)) continue;
      if (parseVersion(item.name) === null) continue;
      await moveToTrash(path.join(idDirectory, item.name), id).catch((error) => {
        logger?.warn?.('[game-market/host] version-prune-failed', `gameId=${id}`, `code=${error?.code || 'E_UNKNOWN'}`);
      });
    }
    const keepVersions = previousVersion ? [currentVersion, previousVersion] : [currentVersion];
    await registry.prunePreviews(id, keepVersions).catch(() => undefined);
  }

  async function saveWarnings(gameId, manifest, installed) {
    const warnings = [];
    const nextSchema =
      Number.isInteger(manifest?.save?.schemaVersion) && manifest.save.schemaVersion >= 1
        ? manifest.save.schemaVersion
        : null;
    const previousSchema =
      Number.isInteger(installed?.manifest?.save?.schemaVersion) && installed.manifest.save.schemaVersion >= 1
        ? installed.manifest.save.schemaVersion
        : null;
    let meta = null;
    try {
      meta = await saves.meta(gameId);
    } catch (_error) {
      meta = null;
    }
    if (meta && Number.isInteger(meta.saveSchemaVersion) && nextSchema !== null) {
      if (meta.saveSchemaVersion > nextSchema) warnings.push('save-schema-too-new');
      else if (previousSchema !== null && nextSchema > previousSchema) warnings.push('save-schema-upgrade');
    } else if (previousSchema !== null && nextSchema !== null && nextSchema > previousSchema) {
      warnings.push('save-schema-upgrade');
    }
    return warnings;
  }

  function buildRecord({
    id,
    version,
    source,
    sha256,
    sizeBytes,
    previousVersion,
    manifest,
    installed,
    iconPath,
    compatibility,
  }) {
    const stamp = now().toISOString();
    return {
      id,
      version,
      source,
      packagePath: installationPackagePath(id, version),
      sha256,
      sizeBytes,
      previousVersion,
      compatibility,
      update: {
        available: false,
        latestVersion: version,
        checkedAt: stamp,
        reason: null,
      },
      lastPlayedAt: installed && typeof installed.lastPlayedAt === 'string' ? installed.lastPlayedAt : null,
      playCount: installed && Number.isInteger(installed.playCount) ? installed.playCount : 0,
      totalPlayMinutes:
        installed && typeof installed.totalPlayMinutes === 'number' ? installed.totalPlayMinutes : 0,
      installedAt: installed && typeof installed.installedAt === 'string' ? installed.installedAt : stamp,
      updatedAt: stamp,
      manifest,
      iconPath: iconPath || null,
    };
  }

  async function previousVersionFor(id, installed, targetVersion) {
    if (!installed || installed.version === targetVersion) {
      return installed && typeof installed.previousVersion === 'string' ? installed.previousVersion : null;
    }
    const previousDirectory = storage.filePath(PACKAGES_DIR, id, installed.version);
    if (!(await pathExists(path.join(previousDirectory, ENTRY_FILE)))) return null;
    return installed.version;
  }

  function installedResult(record, { changed = false, warnings = [], source } = {}) {
    return {
      gameId: record.id,
      version: record.version,
      sha256: record.sha256,
      installedAt: record.installedAt || record.updatedAt,
      changed,
      source: source || record.source,
      warnings: warnings.slice(),
      installation: installationView(record, { warnings }),
    };
  }

  async function installRegistryLocked({ gameId, requestedVersion }) {
    const jobId = createJobId();
    const jobDirectory = storage.filePath(STAGING_DIR, jobId);
    recordJob(jobId, 'queued', { gameId });
    let placed = null;
    try {
      const rawEntry = await registry.resolveForInstall(gameId);
      const entry = await registryEntry(rawEntry);
      const targetVersion = entry.version;
      const installed = await installations.get(gameId);

      if (requestedVersion !== null && requestedVersion !== targetVersion) {
        if (installed && installed.version === requestedVersion) {
          return installedResult(installed, { changed: false, source: 'registry' });
        }
        throw hostError(GM.INSTALL_VERSION_CONFLICT, 'Requested version is not available in the registry', {
          retryable: false,
        });
      }
      if (installed && installed.version === targetVersion) {
        if (typeof installed.sha256 === 'string' && installed.sha256 === entry.package.sha256) {
          return installedResult(installed, { changed: false, source: 'registry' });
        }
        throw hostError(GM.INSTALL_VERSION_CONFLICT, 'Installed version conflicts with this install', {
          retryable: false,
        });
      }
      if (installed) {
        if (compareVersions(targetVersion, installed.version) < 0 && targetVersion !== installed.previousVersion) {
          throw hostError(GM.INSTALL_VERSION_CONFLICT, 'Downgrades are only allowed to the previous version', {
            retryable: false,
          });
        }
        if (await isRunning(gameId)) {
          throw hostError(GM.UPDATE_GAME_RUNNING, 'Exit the game before updating', { retryable: true });
        }
      }
      if (isBuiltinGame(gameId)) {
        throw hostError(GM.INVALID_PARAM, 'Built-in games cannot be installed from the registry', {
          retryable: false,
        });
      }

      const target = await resolvePackageTarget(entry);
      recordJob(jobId, 'downloading', { gameId, version: targetVersion });
      try {
        await fs.mkdir(jobDirectory, { recursive: true, mode: 0o700 });
      } catch (error) {
        throw fsIoError(error, 'Could not create the install staging directory');
      }
      const partPath = path.join(jobDirectory, 'package.html.part');
      const stagedPath = path.join(jobDirectory, 'entry.html');
      const fetched = await fetchPackageInto(target, partPath, entry);
      try {
        await fs.rename(partPath, stagedPath);
      } catch (error) {
        throw fsIoError(error, 'Could not finalise the downloaded package');
      }

      recordJob(jobId, 'verifying', { gameId, version: targetVersion });
      const { manifest } = await validateStagedPackage(stagedPath, {
        expectedId: entry.id,
        expectedVersion: entry.version,
      });

      recordJob(jobId, 'installing', { gameId, version: targetVersion });
      const previousVersion = await previousVersionFor(gameId, installed, targetVersion);
      placed = await placePackage({
        id: gameId,
        version: targetVersion,
        stagedPath,
        sha256: fetched.sha256,
        sizeBytes: fetched.bytes,
      });
      const warnings = await saveWarnings(gameId, manifest, installed);
      const iconPath = await registry.previewRelativePath(gameId, targetVersion, 'icon').catch(() => null);
      const record = buildRecord({
        id: gameId,
        version: targetVersion,
        source: 'registry',
        sha256: fetched.sha256,
        sizeBytes: fetched.bytes,
        previousVersion,
        manifest,
        installed,
        iconPath,
        compatibility: compatibilityFor(manifest, now().toISOString()),
      });
      try {
        await installations.put(record);
      } catch (error) {
        if (placed.created) {
          await moveToTrash(placed.entryPath ? path.dirname(placed.entryPath) : null, gameId).catch(() => undefined);
        }
        throw error;
      }
      await pruneVersions(gameId, targetVersion, previousVersion);
      recordJob(jobId, 'installed', { gameId, version: targetVersion });
      logger?.info?.('[game-market/host] installed', `gameId=${gameId}`, `version=${targetVersion}`, `source=registry`);
      return installedResult(record, { changed: true, warnings, source: 'registry' });
    } catch (error) {
      recordJob(jobId, 'failed', { gameId, code: error?.code || 'E_UNKNOWN' });
      throw error;
    } finally {
      await fs.rm(jobDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async function readHtmlBody(request) {
    const contentType = request.headers.get('content-type') || '';
    const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();
    if (mediaType !== 'text/html') {
      throw hostError(GM.UNSUPPORTED_MEDIA_TYPE, 'Expected text/html', { retryable: false });
    }
    const declared = request.headers.get('content-length');
    if (declared !== null && declared !== '') {
      const value = Number(declared);
      if (Number.isFinite(value) && value > LIMITS.packageBytes) {
        throw hostError(GM.PACKAGE_TOO_LARGE, 'Game package exceeds the size limit', {
          retryable: false,
          details: { limitBytes: LIMITS.packageBytes },
        });
      }
    }
    if (!request.body) {
      throw hostError(GM.PACKAGE_INVALID, 'Package file is empty', { retryable: false });
    }
    const reader = request.body.getReader();
    const chunks = [];
    let bytes = 0;
    for (;;) {
      let result;
      try {
        result = await reader.read();
      } catch (_error) {
        throw hostError(GM.PACKAGE_INVALID, 'Package file could not be read', { retryable: false });
      }
      if (result.done) break;
      const chunk = result.value;
      if (!chunk || chunk.length === 0) continue;
      bytes += chunk.length;
      if (bytes > LIMITS.packageBytes) {
        await reader.cancel().catch(() => undefined);
        throw hostError(GM.PACKAGE_TOO_LARGE, 'Game package exceeds the size limit', {
          retryable: false,
          details: { limitBytes: LIMITS.packageBytes },
        });
      }
      chunks.push(chunk);
    }
    if (bytes === 0) {
      throw hostError(GM.PACKAGE_INVALID, 'Package file is empty', { retryable: false });
    }
    return Buffer.concat(chunks);
  }

  async function installLocalLocked({ manifest, bytes, sha256 }) {
    const gameId = manifest.id;
    const version = manifest.version;
    if (isBuiltinGame(gameId)) {
      throw hostError(GM.INVALID_PARAM, 'Built-in games cannot be replaced by a local package', {
        retryable: false,
      });
    }
    const installed = await installations.get(gameId);
    if (installed && installed.version !== version && (await isRunning(gameId))) {
      throw hostError(GM.UPDATE_GAME_RUNNING, 'Exit the game before updating', { retryable: true });
    }
    const jobId = createJobId();
    const jobDirectory = storage.filePath(STAGING_DIR, jobId);
    let placed = null;
    recordJob(jobId, 'installing', { gameId, version, source: 'local' });
    try {
      await fs.mkdir(jobDirectory, { recursive: true, mode: 0o700 });
      const stagedPath = path.join(jobDirectory, 'entry.html');
      await fs.writeFile(stagedPath, bytes, { mode: 0o644, flag: 'wx' });
      const previousVersion = await previousVersionFor(gameId, installed, version);
      placed = await placePackage({ id: gameId, version, stagedPath, sha256, sizeBytes: bytes.length });
      const warnings = await saveWarnings(gameId, manifest, installed);
      const record = buildRecord({
        id: gameId,
        version,
        source: 'local',
        sha256: null,
        sizeBytes: bytes.length,
        previousVersion,
        manifest,
        installed,
        iconPath: null,
        compatibility: compatibilityFor(manifest, now().toISOString()),
      });
      try {
        await installations.put(record);
      } catch (error) {
        if (placed.created) {
          await moveToTrash(path.dirname(placed.entryPath), gameId).catch(() => undefined);
        }
        throw error;
      }
      await pruneVersions(gameId, version, previousVersion);
      recordJob(jobId, 'installed', { gameId, version, source: 'local' });
      logger?.info?.('[game-market/host] installed', `gameId=${gameId}`, `version=${version}`, 'source=local');
      return installedResult(record, { changed: true, warnings, source: 'local' });
    } catch (error) {
      recordJob(jobId, 'failed', { gameId, code: error?.code || 'E_UNKNOWN' });
      throw error;
    } finally {
      await fs.rm(jobDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async function awaitMaintenance() {
    if (maintenance && typeof maintenance.ready === 'function') {
      await maintenance.ready().catch(() => undefined);
    }
  }

  async function install(body) {
    if (!isPlainObject(body)) throw hostError(GM.INVALID_PARAM, 'Request body must be a JSON object');
    const gameId = validateGameId(body.gameId);
    let requestedVersion = null;
    if (body.version !== undefined && body.version !== null) {
      if (typeof body.version !== 'string' || parseVersion(body.version) === null) {
        throw hostError(GM.INVALID_PARAM, 'Invalid game version');
      }
      requestedVersion = body.version;
    }
    const operationId = validateOperationId(body.operationId);
    const params = JSON.stringify({ gameId, version: requestedVersion });
    const cached = lookupOperation('install', operationId, params);
    if (cached) return cached;
    await awaitMaintenance();
    const result = await lock.run(
      async () => {
        const again = lookupOperation('install', operationId, params);
        if (again) return again;
        const value = await installRegistryLocked({ gameId, requestedVersion });
        storeOperation('install', operationId, params, value);
        return value;
      },
      { waitMs: installLockWaitMs, busyCode: GM.INSTALL_IN_PROGRESS }
    );
    return result;
  }

  async function installLocal(request, url) {
    await awaitMaintenance();
    const operationId = validateOperationId(queryValue(url, 'operationId', { required: false, maxLength: 128 }));
    const bytes = await readHtmlBody(request);
    const text = decodePackageText(bytes);
    const validation = validatePackageHtml(text, { packageBytes: LIMITS.packageBytes });
    if (!validation.ok || !validation.manifest) throw packageValidationError(validation);
    const manifest = validation.manifest;
    checkCompatibility(manifest);
    const digest = sha256Hex(bytes);
    const params = JSON.stringify({ sha256: digest });
    const cached = lookupOperation('install-local', operationId, params);
    if (cached) return cached;
    const result = await lock.run(
      async () => {
        const again = lookupOperation('install-local', operationId, params);
        if (again) return again;
        const value = await installLocalLocked({ manifest, bytes, sha256: digest });
        storeOperation('install-local', operationId, params, value);
        return value;
      },
      { waitMs: installLockWaitMs, busyCode: GM.INSTALL_IN_PROGRESS }
    );
    return result;
  }

  async function uninstall(body) {
    if (!isPlainObject(body)) throw hostError(GM.INVALID_PARAM, 'Request body must be a JSON object');
    const gameId = validateGameId(body.gameId);
    const operationId = validateOperationId(body.operationId);
    const deleteData = body.deleteData === true;
    const confirmDataDeletion = body.confirmDataDeletion === true;
    if (body.deleteData !== undefined && typeof body.deleteData !== 'boolean') {
      throw hostError(GM.INVALID_PARAM, 'Invalid deleteData');
    }
    if (deleteData && !confirmDataDeletion) {
      throw hostError(GM.INVALID_PARAM, 'Deleting game data requires explicit confirmation', {
        retryable: false,
      });
    }
    if (isBuiltinGame(gameId)) {
      throw hostError(GM.UNINSTALL_BUILTIN, 'Built-in games cannot be uninstalled', {
        retryable: false,
        details: { reason: 'builtin' },
      });
    }
    const params = JSON.stringify({ gameId, deleteData });
    const cached = lookupOperation('uninstall', operationId, params);
    if (cached) return cached;
    await awaitMaintenance();
    const result = await lock.run(
      async () => {
        const again = lookupOperation('uninstall', operationId, params);
        if (again) return again;
        const value = await uninstallLocked({ gameId, deleteData });
        storeOperation('uninstall', operationId, params, value);
        return value;
      },
      { waitMs: 0, busyCode: GM.UNINSTALL_BUSY }
    );
    return result;
  }

  async function uninstallLocked({ gameId, deleteData }) {
    const record = await installations.get(gameId);
    if (!record) {
      return { gameId, removed: false, dataDeleted: false, ignored: true };
    }
    if (await isRunning(gameId)) {
      throw hostError(GM.UPDATE_GAME_RUNNING, 'Exit the game before uninstalling', { retryable: true });
    }
    const versionDirectory = storage.filePath(PACKAGES_DIR, gameId, record.version);
    await moveToTrash(versionDirectory, gameId);
    await fs.rmdir(storage.filePath(PACKAGES_DIR, gameId)).catch(() => undefined);
    await installations.remove(gameId);
    if (entry && typeof entry.invalidateGame === 'function') entry.invalidateGame(gameId);
    let dataDeleted = false;
    if (deleteData) {
      await moveToTrash(storage.filePath(SAVES_DIR, gameId), gameId).catch(() => undefined);
      await moveToTrash(storage.filePath(SCORES_DIR, `${gameId}.json`), gameId).catch(() => undefined);
      await moveToTrash(storage.filePath(SESSIONS_DIR, `${gameId}.json`), gameId).catch(() => undefined);
      await moveToTrash(storage.filePath(PREVIEW_CACHE_DIR, gameId), gameId).catch(() => undefined);
      dataDeleted = true;
    }
    if (preferences && typeof preferences.read === 'function') {
      try {
        const current = await preferences.read();
        if (current && current.lastPlayedGameId === gameId) {
          await preferences.update({ lastPlayedGameId: null });
        }
      } catch (error) {
        logger?.warn?.('[game-market/host] uninstall-preferences-failed', `code=${error?.code || 'E_UNKNOWN'}`);
      }
    }
    logger?.info?.('[game-market/host] uninstalled', `gameId=${gameId}`, `deleteData=${deleteData}`);
    return { gameId, removed: true, dataDeleted, ignored: false };
  }

  function diagnostics() {
    return jobs.map((job) => ({ ...job }));
  }

  return {
    install,
    installLocal,
    uninstall,
    diagnostics,
    operations,
    installLockWaitMs,
    isRunning,
  };
}
