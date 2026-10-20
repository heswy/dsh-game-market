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

import {
  ASSET_ZIP_V2,
  DEFAULT_PACKAGE_FORMAT,
  DESCRIPTOR_FILE,
  LIMITS,
  PACKAGE_ZIP_EXTENSION,
  RUNTIME_VERSION,
  TIMING,
} from '../../shared/src/constants.js';
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
import { isPackageFormat, normalizePackageFormat, packageFileNameForFormat } from '../../shared/src/package-v2.js';
import { allowedHostSet, validatePackageUrl } from '../../shared/src/registry.js';
import { downloadToFile } from './download.js';
import { hostError } from './errors.js';
import { queryValue } from './http.js';
import { createJobId, randomHex, sha256Hex } from './ids.js';
import { installationView } from './installations.js';
import { checkCompatibility, compatibilityFor, compareVersions, parseVersion } from './semver.js';
import { isInside, isPlainObject, validateGameId, validateOperationId } from './validation.js';
import {
  assertZipMagic,
  extractPackageArchive,
  sealPackageDirectory,
  unsealPackageDirectory,
  verifyPackageDirectory,
} from './zip.js';

const OPERATION_TTL_MS = 10 * 60 * 1000;
const OPERATION_LIMIT = 200;
const JOB_HISTORY = 20;
const PACKAGE_TIMEOUTS = Object.freeze({
  connectMs: TIMING.downloadConnectMs,
  idleMs: TIMING.downloadIdleMs,
  totalMs: TIMING.downloadTotalMs,
});

/** Staged outer ZIP file name inside `staging/<jobId>/` (kept out of `packages/`). */
const ZIP_STAGED_FILE = `package${PACKAGE_ZIP_EXTENSION}`;
/** Raw upload content types accepted by the local install entry (§1.8). */
const LOCAL_ZIP_CONTENT_TYPES = Object.freeze(['application/zip', 'application/x-zip-compressed']);

function formatOf(record) {
  return record && record.format === ASSET_ZIP_V2 ? ASSET_ZIP_V2 : DEFAULT_PACKAGE_FORMAT;
}

function outerLimitForFormat(format) {
  return format === ASSET_ZIP_V2 ? LIMITS.zip.zipOuterBytes : LIMITS.packageBytes;
}

function assertKnownFormat(format) {
  if (isPackageFormat(format)) return;
  throw hostError(GM.FORMAT_POLICY, 'Package format is not supported', { retryable: false });
}

/**
 * §5.4 item 2: a format change requires a new game version. The same id+version
 * may never switch between `html-v1` and `asset-zip-v2`.
 */
function assertFormatPolicy(installed, version, format) {
  if (!installed || installed.version !== version) return;
  if (normalizePackageFormat(installed.format) !== format) {
    throw hostError(GM.FORMAT_POLICY, 'Package format cannot change without a new game version', {
      retryable: false,
    });
  }
}

/** §1.1 step 4 / §1.8: ZIP magic, used to reject content-type spoofing. */
function looksLikeZip(bytes) {
  if (!bytes || bytes.length < 4) return false;
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  return (bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06);
}

/** Media type of a raw upload request (lowercase, parameters stripped). */
function mediaTypeOf(request) {
  const contentType = request.headers.get('content-type') || '';
  return contentType.split(';', 1)[0].trim().toLowerCase();
}

/**
 * §1.2/§5.2 ZIP package URL admission.
 *
 * `shared/registry.js#validatePackageUrl` is the V1 HTML validator (its last
 * path segment rule hard-codes `<id>-<version>.html`). The contract keeps the
 * same admission rules for ZIP (https, no credentials, allowlist / same host,
 * exact last segment `<id>-<version>.dshgame.zip`) so we mirror them here
 * without changing the shared V1 validator's semantics.
 */
const RELATIVE_ZIP_URL = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function validateZipPackageUrl(value, options = {}) {
  const { id, version, sourceType = 'https', sourceUrl, allowedHosts } = options;
  const expectedFile = packageFileNameForFormat(id, version, ASSET_ZIP_V2);
  if (typeof value !== 'string' || value.length === 0 || value.length > 1000) {
    return { ok: false, url: null, message: 'package.url must be a non-empty string' };
  }
  if (sourceType === 'file') {
    if (!RELATIVE_ZIP_URL.test(value)) {
      return { ok: false, url: null, message: 'file registry packages must use a safe relative path' };
    }
    if (value.split('/').pop() !== expectedFile) {
      return { ok: false, url: null, message: `package file name must be ${expectedFile}` };
    }
    return { ok: true, url: value, message: 'ok' };
  }
  let absolute;
  try {
    absolute = new URL(value, sourceUrl || undefined);
  } catch (_error) {
    return { ok: false, url: null, message: 'package.url is not a valid URL' };
  }
  if (absolute.protocol !== 'https:') return { ok: false, url: null, message: 'package.url must use https' };
  if (absolute.username || absolute.password) {
    return { ok: false, url: null, message: 'package.url must not contain credentials' };
  }
  if (absolute.pathname.split('/').pop() !== expectedFile) {
    return { ok: false, url: null, message: `package file name must be ${expectedFile}` };
  }
  if (!allowedHostSet({ allowedHosts, sourceUrl }).has(absolute.hostname.toLowerCase())) {
    return { ok: false, url: null, message: `package host is not allowed: ${absolute.hostname}` };
  }
  return { ok: true, url: absolute.toString(), message: 'ok' };
}

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

/** A record the startup recovery marked unusable (§6.5): Play disabled, reinstall needed. */
function isBrokenRecord(record) {
  return Boolean(record && record.compatibility && record.compatibility.status === 'broken');
}

/**
 * §3 staging disk budget: `zipOuterBytes + zipUnpackedBytes` (≤ 120 MiB).
 * Best effort — platforms without `statfs` keep the ENOSPC error path.
 */
async function assertStagingCapacity(directory, requiredBytes) {
  let stats;
  try {
    stats = await fs.statfs(directory);
  } catch (_error) {
    return;
  }
  const available = Number(stats.bavail) * Number(stats.bsize);
  if (!Number.isFinite(available) || available <= 0) return;
  if (available >= requiredBytes) return;
  throw hostError(GM.INSTALL_DISK_FULL, 'Not enough disk space for this install', { retryable: true });
}

function timestampSlug() {
  return new Date().toISOString().replace(/[-:.]/g, '');
}

async function pathExists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    // Only "missing" is a negative result. EACCES/EPERM etc. must surface so
    // deleteData cannot silently skip data it failed to inspect (CR-02).
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return false;
    throw fsIoError(error, 'Could not inspect data path');
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

  /**
   * A record marked `broken` by startup recovery must be reinstallable (§6.5):
   * move the unusable version directory to trash first so the fresh install can
   * take its place instead of tripping over the conflict check.
   */
  async function prepareBrokenReinstall(id, installed, targetVersion) {
    if (!isBrokenRecord(installed) || installed.version !== targetVersion) return;
    await moveVersionDirectoryToTrash(storage.filePath(PACKAGES_DIR, id, installed.version), id);
  }

  /** Whether a version directory still holds its format-specific marker file. */
  async function versionArtifactExists(id, version, format) {
    const marker = format === ASSET_ZIP_V2 ? DESCRIPTOR_FILE : ENTRY_FILE;
    return pathExists(storage.filePath(PACKAGES_DIR, id, version, marker));
  }

  /** §6.2 `previousFormat`: from the record, else probed from the version directory. */
  async function previousFormatFor(id, installed) {
    if (!installed) return null;
    if (installed.format === ASSET_ZIP_V2 || installed.format === DEFAULT_PACKAGE_FORMAT) {
      return normalizePackageFormat(installed.format);
    }
    const directory = storage.filePath(PACKAGES_DIR, id, installed.version);
    if (await pathExists(path.join(directory, DESCRIPTOR_FILE))) return ASSET_ZIP_V2;
    return DEFAULT_PACKAGE_FORMAT;
  }

  /**
   * "Running" means a live Runtime instance, not an unfinished Play Session: an
   * unfinished session is what enables Continue and may stay open for days, so
   * it must not block update/uninstall (user-reported 2026-10-18). The Client
   * releases the instance when the user leaves the Runtime.
   */
  async function isRunning(gameId) {
    return Boolean(entry && typeof entry.hasActiveInstance === 'function' && entry.hasActiveInstance(gameId));
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

  async function resolvePackageTarget(entry, format = DEFAULT_PACKAGE_FORMAT) {
    const source = registry.source || null;
    if (!source) {
      throw hostError(GM.INSTALL_URL_REJECTED, 'No registry source is configured', { retryable: false });
    }
    const urlOptions = {
      id: entry.id,
      version: entry.version,
      sourceType: source.kind,
      sourceUrl: registry.sourceUrl,
      allowedHosts: registry.allowedHosts,
    };
    const result = format === ASSET_ZIP_V2
      ? validateZipPackageUrl(entry.package.url, urlOptions)
      : validatePackageUrl(entry.package.url, urlOptions);
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

  async function fetchPackageInto(target, partPath, entry, { maxOuterBytes = LIMITS.packageBytes } = {}) {
    if (target.kind === 'file') {
      if (target.size > maxOuterBytes) {
        throw hostError(GM.PACKAGE_TOO_LARGE, 'Game package exceeds the size limit', {
          retryable: false,
          details: { limitBytes: maxOuterBytes },
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
        maxBytes: maxOuterBytes,
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

  /**
   * `asset-zip-v2` verification + extraction (§4.1 steps 1–10).
   *
   * The outer ZIP has already been size/sha256 checked by the download step;
   * `zip.js` owns everything else (magic, EOCD, per-entry policy, conflicts,
   * descriptor, measured extraction, local-header comparison, game.json,
   * content scans). The extraction target stays inside `staging/<jobId>/` and
   * is only promoted after every check passed (§6.3 step 10).
   */
  async function extractStagedZip(stagedPath, treePath, { expected, registryFilesDigest = null }) {
    await assertZipMagic(stagedPath);
    const extraction = await extractPackageArchive({
      zipPath: stagedPath,
      outDir: treePath,
      expected,
      now: () => now().getTime(),
    });
    if (typeof registryFilesDigest === 'string' && registryFilesDigest !== extraction.fileManifestDigest) {
      throw hostError(GM.DESCRIPTOR_MISMATCH, 'Package file manifest does not match the registry digest', {
        retryable: false,
      });
    }
    checkCompatibility(extraction.manifest);
    return extraction;
  }

  /**
   * Atomically promote an extracted tree to `packages/<id>/<version>/`
   * (§6.1 item 4: directory first, then the record). The tree is sealed
   * read-only afterwards (§6.1 item 1, best effort).
   * (§6.1 item 4: directory first, then the record).
   *
   * CR7-02: a retained **previous** version directory (current + 1 rollback
   * window) may be the exact package being installed again (rollback or an
   * idempotent reinstall). In that case the directory is *reused* — never
   * renamed over, re-extracted or re-sealed — but only after its measured
   * content equals the freshly verified target:
   *   - the descriptor must be valid and its `fileManifestDigest` must equal the
   *     digest of the package we just extracted;
   *   - every listed file is re-hashed (`verifyContents: true`), so a single
   *     tampered resource byte is detected even though the manifest digest
   *     itself would not change.
   * Anything else (missing/corrupt/format-mismatched/hash-mismatched) remains a
   * `GM-4094` conflict: same id+version may never silently change bytes.
   */
  async function placePackageTree({ id, version, treePath, entry, fileManifestDigest }) {
    const idDirectory = storage.filePath(PACKAGES_DIR, id);
    const targetDirectory = path.join(idDirectory, version);
    if (await pathExists(targetDirectory)) {
      const hasDescriptor = await pathExists(path.join(targetDirectory, DESCRIPTOR_FILE));
      if (!hasDescriptor) {
        // A directory without a descriptor is either html-v1 (format mismatch)
        // or corrupt: neither may be reused as an `asset-zip-v2` version.
        throw hostError(GM.INSTALL_VERSION_CONFLICT, 'Installed version has a different or invalid package format', {
          retryable: false,
        });
      }
      const verification = await verifyPackageDirectory({
        directory: targetDirectory,
        record: { fileManifestDigest, entry },
        verifyContents: true,
      });
      if (!verification.ok) {
        throw hostError(GM.INSTALL_VERSION_CONFLICT, 'Installed version contents differ from this install', {
          retryable: false,
        });
      }
      return {
        directory: targetDirectory,
        entryPath: path.join(targetDirectory, entry),
        created: false,
        replaced: false,
        reused: true,
      };
    }
    try {
      await fs.mkdir(idDirectory, { recursive: true, mode: 0o755 });
      await fs.rename(treePath, targetDirectory);
      await syncDirectory(idDirectory);
    } catch (error) {
      throw fsIoError(error, 'Could not place the installed package');
    }
    const sealed = await sealPackageDirectory(targetDirectory);
    if (!sealed.ok) {
      logger?.warn?.('[game-market/host] package-seal-failed', `gameId=${id}`, `failures=${sealed.failures}`);
    }
    return {
      directory: targetDirectory,
      entryPath: path.join(targetDirectory, entry),
      created: true,
      replaced: false,
      reused: false,
    };
  }

  async function placePackage({ id, version, stagedPath, sha256, sizeBytes }) {
    const targetDirectory = storage.filePath(PACKAGES_DIR, id, version);
    const entryPath = path.join(targetDirectory, ENTRY_FILE);
    const directoryExisted = await pathExists(targetDirectory);
    if (directoryExisted && (await pathExists(path.join(targetDirectory, DESCRIPTOR_FILE)))) {
      // An `asset-zip-v2` tree cannot be reused as an html-v1 version (and the
      // reverse is handled in placePackageTree). Format policy for a *recorded*
      // version is enforced by assertFormatPolicy (GM-4282); a directory holding
      // the other format is a conflict.
      throw hostError(GM.INSTALL_VERSION_CONFLICT, 'Installed version has a different package format', {
        retryable: false,
      });
    }
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
      // CR7-02 boundary: the record's sha256 may be null (local html-v1
      // installs keep a non-trust-anchor digest), so compare the bytes we hold
      // against the bytes already on disk — always possible for html-v1.
      const existing = await hashFile(entryPath);
      const sameSize = !Number.isFinite(sizeBytes) || stats.size === sizeBytes;
      if (typeof sha256 === 'string' && existing === sha256 && sameSize) {
        return { entryPath, created: false, replaced: false, reused: true };
      }
      throw hostError(GM.INSTALL_VERSION_CONFLICT, 'Installed version contents differ from this install', {
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

  /**
   * Remove an installed version tree. Trees are sealed read-only while live
   * (§6.1 item 1), so restore owner write permission before the recursive
   * delete; the move itself only needs write access to the parent.
   */
  async function moveVersionDirectoryToTrash(targetPath, id) {
    if (!(await pathExists(targetPath))) return null;
    await unsealPackageDirectory(targetPath);
    return moveToTrash(targetPath, id);
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
      await moveVersionDirectoryToTrash(path.join(idDirectory, item.name), id).catch((error) => {
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
    format = DEFAULT_PACKAGE_FORMAT,
    entry = ENTRY_FILE,
    fileManifestDigest = null,
    fileCount = null,
    unpackedBytes = null,
    previousFormat = null,
  }) {
    const stamp = now().toISOString();
    return {
      id,
      version,
      source,
      format,
      entry,
      fileManifestDigest,
      fileCount,
      unpackedBytes,
      previousFormat,
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
    const installedFormat = formatOf(installed);
    if (!(await versionArtifactExists(id, installed.version, installedFormat))) return null;
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

  /**
   * Shared tail of every install path: persist the installation record, clean up
   * the promoted tree if the record cannot be written, prune old versions and
   * report the job (§6.3 steps 10–12).
   */
  async function finaliseInstall({
    jobId,
    id,
    version,
    source,
    format,
    entry,
    sha256,
    sizeBytes,
    previousVersion,
    manifest,
    installed,
    placed,
    iconFromRegistry = true,
    fileManifestDigest = null,
    fileCount = null,
    unpackedBytes = null,
  }) {
    const warnings = await saveWarnings(id, manifest, installed);
    const previousFormat = await previousFormatFor(id, installed);
    const iconPath = iconFromRegistry
      ? await registry.previewRelativePath(id, version, 'icon').catch(() => null)
      : null;
    const record = buildRecord({
      id,
      version,
      source,
      format,
      entry,
      sha256,
      sizeBytes,
      previousVersion,
      previousFormat,
      manifest,
      installed,
      iconPath,
      compatibility: compatibilityFor(manifest, now().toISOString()),
      fileManifestDigest,
      fileCount,
      unpackedBytes,
    });
    try {
      await installations.put(record);
    } catch (error) {
      // CR7-02: only a directory THIS attempt created may be cleaned up. A
      // `reused` directory is an earlier install's retained rollback version —
      // deleting it on a record-write failure would destroy user data (and the
      // still-current record may point at it).
      if (placed && placed.created === true && placed.reused !== true) {
        const cleanupDirectory =
          placed.directory || (placed.entryPath ? path.dirname(placed.entryPath) : null);
        if (cleanupDirectory) {
          await moveVersionDirectoryToTrash(cleanupDirectory, id).catch(() => undefined);
        }
      }
      throw error;
    }
    await pruneVersions(id, version, previousVersion);
    recordJob(jobId, 'installed', { gameId: id, version, format, source });
    logger?.info?.(
      '[game-market/host] installed',
      `gameId=${id}`,
      `version=${version}`,
      `source=${source}`,
      `format=${format}`
    );
    return installedResult(record, { changed: true, warnings, source });
  }

  async function installRegistryLocked({ gameId, requestedVersion }) {
    const jobId = createJobId();
    const jobDirectory = storage.filePath(STAGING_DIR, jobId);
    recordJob(jobId, 'queued', { gameId });
    let placed = null;
    try {
      const rawEntry = await registry.resolveForInstall(gameId);
      // §1.1 step 1: the index declares the format; a missing value means V1 HTML.
      const format = rawEntry.package && rawEntry.package.format !== undefined
        ? rawEntry.package.format
        : DEFAULT_PACKAGE_FORMAT;
      assertKnownFormat(format);
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
      // A broken record (startup recovery, §6.5) is always reinstalled instead of
      // being reported as a no-op.
      if (installed && installed.version === targetVersion && !isBrokenRecord(installed)) {
        // §5.4 item 2: a format change requires a new game version.
        assertFormatPolicy(installed, targetVersion, format);
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
      if (format === ASSET_ZIP_V2) {
        // §1.2: the URL's last path segment must be the format-specific name.
        const expectedName = packageFileNameForFormat(entry.id, entry.version, format);
        if (!String(entry.package.url).endsWith(`/${expectedName}`)) {
          throw hostError(GM.FORMAT_POLICY, 'Package file name does not match the package format', {
            retryable: false,
          });
        }
      }

      const target = await resolvePackageTarget(entry, format);
      recordJob(jobId, 'downloading', { gameId, version: targetVersion, format });
      try {
        await fs.mkdir(jobDirectory, { recursive: true, mode: 0o700 });
      } catch (error) {
        throw fsIoError(error, 'Could not create the install staging directory');
      }
      const previousVersion = await previousVersionFor(gameId, installed, targetVersion);

      if (format === ASSET_ZIP_V2) {
        const partPath = path.join(jobDirectory, `${ZIP_STAGED_FILE}.part`);
        const stagedPath = path.join(jobDirectory, ZIP_STAGED_FILE);
        const fetched = await fetchPackageInto(target, partPath, entry, {
          maxOuterBytes: outerLimitForFormat(format),
        });
        try {
          await fs.rename(partPath, stagedPath);
        } catch (error) {
          throw fsIoError(error, 'Could not finalise the downloaded package');
        }
        recordJob(jobId, 'verifying', { gameId, version: targetVersion, format });
        await assertStagingCapacity(
          jobDirectory,
          fetched.bytes + LIMITS.zip.zipUnpackedBytes
        );
        const treePath = path.join(jobDirectory, 'tree');
        const extraction = await extractStagedZip(stagedPath, treePath, {
          expected: { id: entry.id, version: entry.version },
          registryFilesDigest:
            typeof rawEntry.package.filesDigest === 'string' ? rawEntry.package.filesDigest : null,
        });
        recordJob(jobId, 'installing', { gameId, version: targetVersion, format });
        await prepareBrokenReinstall(gameId, installed, targetVersion);
        placed = await placePackageTree({
          id: gameId,
          version: targetVersion,
          treePath,
          entry: extraction.entry,
          fileManifestDigest: extraction.fileManifestDigest,
        });
        return await finaliseInstall({
          jobId,
          id: gameId,
          version: targetVersion,
          source: 'registry',
          format,
          entry: extraction.entry,
          sha256: fetched.sha256,
          sizeBytes: fetched.bytes,
          previousVersion,
          manifest: extraction.manifest,
          installed,
          placed,
          fileManifestDigest: extraction.fileManifestDigest,
          fileCount: extraction.fileCount,
          unpackedBytes: extraction.unpackedBytes,
        });
      }

      const partPath = path.join(jobDirectory, 'package.html.part');
      const stagedPath = path.join(jobDirectory, ENTRY_FILE);
      const fetched = await fetchPackageInto(target, partPath, entry, {
        maxOuterBytes: outerLimitForFormat(DEFAULT_PACKAGE_FORMAT),
      });
      try {
        await fs.rename(partPath, stagedPath);
      } catch (error) {
        throw fsIoError(error, 'Could not finalise the downloaded package');
      }

      recordJob(jobId, 'verifying', { gameId, version: targetVersion, format });
      const { manifest } = await validateStagedPackage(stagedPath, {
        expectedId: entry.id,
        expectedVersion: entry.version,
      });

      recordJob(jobId, 'installing', { gameId, version: targetVersion, format });
      await prepareBrokenReinstall(gameId, installed, targetVersion);
      placed = await placePackage({
        id: gameId,
        version: targetVersion,
        stagedPath,
        sha256: fetched.sha256,
        sizeBytes: fetched.bytes,
      });
      return await finaliseInstall({
        jobId,
        id: gameId,
        version: targetVersion,
        source: 'registry',
        format,
        entry: ENTRY_FILE,
        sha256: fetched.sha256,
        sizeBytes: fetched.bytes,
        previousVersion,
        manifest,
        installed,
        placed,
      });
    } catch (error) {
      recordJob(jobId, 'failed', { gameId, code: error?.code || 'E_UNKNOWN' });
      throw error;
    } finally {
      await fs.rm(jobDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Read a raw upload body with a Content-Length pre-check and a streamed
   * ceiling (§1.8 / §3 rule 4: reject before/while receiving, never after).
   */
  async function readRequestBody(request, { allowedMediaTypes, limitBytes }) {
    const mediaType = mediaTypeOf(request);
    if (!allowedMediaTypes.includes(mediaType)) {
      throw hostError(GM.UNSUPPORTED_MEDIA_TYPE, `Expected ${allowedMediaTypes.join(' or ')}`, {
        retryable: false,
      });
    }
    const declared = request.headers.get('content-length');
    if (declared !== null && declared !== '') {
      const value = Number(declared);
      if (Number.isFinite(value) && value > limitBytes) {
        throw hostError(GM.PACKAGE_TOO_LARGE, 'Game package exceeds the size limit', {
          retryable: false,
          details: { limitBytes },
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
      if (bytes > limitBytes) {
        await reader.cancel().catch(() => undefined);
        throw hostError(GM.PACKAGE_TOO_LARGE, 'Game package exceeds the size limit', {
          retryable: false,
          details: { limitBytes },
        });
      }
      chunks.push(chunk);
    }
    if (bytes === 0) {
      throw hostError(GM.PACKAGE_INVALID, 'Package file is empty', { retryable: false });
    }
    return Buffer.concat(chunks);
  }

  async function installLocalHtmlLocked({ manifest, bytes, sha256 }) {
    const gameId = manifest.id;
    const version = manifest.version;
    if (isBuiltinGame(gameId)) {
      throw hostError(GM.INVALID_PARAM, 'Built-in games cannot be replaced by a local package', {
        retryable: false,
      });
    }
    const installed = await installations.get(gameId);
    assertFormatPolicy(installed, version, DEFAULT_PACKAGE_FORMAT);
    if (installed && installed.version !== version && (await isRunning(gameId))) {
      throw hostError(GM.UPDATE_GAME_RUNNING, 'Exit the game before updating', { retryable: true });
    }
    const jobId = createJobId();
    const jobDirectory = storage.filePath(STAGING_DIR, jobId);
    let placed = null;
    recordJob(jobId, 'installing', { gameId, version, source: 'local', format: DEFAULT_PACKAGE_FORMAT });
    try {
      await fs.mkdir(jobDirectory, { recursive: true, mode: 0o700 });
      const stagedPath = path.join(jobDirectory, ENTRY_FILE);
      await fs.writeFile(stagedPath, bytes, { mode: 0o644, flag: 'wx' });
      const previousVersion = await previousVersionFor(gameId, installed, version);
      await prepareBrokenReinstall(gameId, installed, version);
      placed = await placePackage({ id: gameId, version, stagedPath, sha256, sizeBytes: bytes.length });
      return await finaliseInstall({
        jobId,
        id: gameId,
        version,
        source: 'local',
        format: DEFAULT_PACKAGE_FORMAT,
        entry: ENTRY_FILE,
        sha256: null,
        sizeBytes: bytes.length,
        previousVersion,
        manifest,
        installed,
        placed,
        iconFromRegistry: false,
      });
    } catch (error) {
      recordJob(jobId, 'failed', { gameId, code: error?.code || 'E_UNKNOWN' });
      throw error;
    } finally {
      await fs.rm(jobDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Local `asset-zip-v2` upload (§1.8): separate `Content-Type`, ≤ 20 MiB,
   * `source:'local'`, measured outer sha256 recorded for rollback/diagnostics
   * but NEVER used as a trust anchor (the UI still has to confirm explicitly).
   */
  async function installLocalZipLocked({ bytes, sha256 }) {
    // Re-installing the same outer ZIP is a no-op; the record's sha256 is the
    // measured outer digest, so this does not depend on the file name.
    const records = await installations.records();
    const existing = records.find(
      (record) => formatOf(record) === ASSET_ZIP_V2 && record.sha256 === sha256
    );
    if (
      existing
      && !isBrokenRecord(existing)
      && (await versionArtifactExists(existing.id, existing.version, ASSET_ZIP_V2))
    ) {
      return installedResult(existing, { changed: false, source: 'local' });
    }

    const jobId = createJobId();
    const jobDirectory = storage.filePath(STAGING_DIR, jobId);
    let placed = null;
    let gameId = null;
    recordJob(jobId, 'installing', { source: 'local', format: ASSET_ZIP_V2 });
    try {
      await fs.mkdir(jobDirectory, { recursive: true, mode: 0o700 });
      await assertStagingCapacity(jobDirectory, bytes.length + LIMITS.zip.zipUnpackedBytes);
      const stagedPath = path.join(jobDirectory, ZIP_STAGED_FILE);
      await fs.writeFile(stagedPath, bytes, { mode: 0o644, flag: 'wx' });

      const treePath = path.join(jobDirectory, 'tree');
      const extraction = await extractStagedZip(stagedPath, treePath, { expected: null });
      gameId = extraction.manifest.id;
      const version = extraction.manifest.version;
      recordJob(jobId, 'verifying', { gameId, version, source: 'local', format: ASSET_ZIP_V2 });

      if (isBuiltinGame(gameId)) {
        throw hostError(GM.INVALID_PARAM, 'Built-in games cannot be replaced by a local package', {
          retryable: false,
        });
      }
      const installed = await installations.get(gameId);
      assertFormatPolicy(installed, version, ASSET_ZIP_V2);
      if (installed && installed.version !== version && (await isRunning(gameId))) {
        throw hostError(GM.UPDATE_GAME_RUNNING, 'Exit the game before updating', { retryable: true });
      }
      const previousVersion = await previousVersionFor(gameId, installed, version);
      await prepareBrokenReinstall(gameId, installed, version);
      placed = await placePackageTree({
        id: gameId,
        version,
        treePath,
        entry: extraction.entry,
        fileManifestDigest: extraction.fileManifestDigest,
      });
      return await finaliseInstall({
        jobId,
        id: gameId,
        version,
        source: 'local',
        format: ASSET_ZIP_V2,
        entry: extraction.entry,
        sha256,
        sizeBytes: bytes.length,
        previousVersion,
        manifest: extraction.manifest,
        installed,
        placed,
        iconFromRegistry: false,
        fileManifestDigest: extraction.fileManifestDigest,
        fileCount: extraction.fileCount,
        unpackedBytes: extraction.unpackedBytes,
      });
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

  /**
   * Raw local upload entry (§1.8). `html-v1` keeps V1 behaviour; `asset-zip-v2`
   * has its own `Content-Type` and a completely separate validation pipeline.
   */
  async function installLocal(request, url) {
    await awaitMaintenance();
    const operationId = validateOperationId(queryValue(url, 'operationId', { required: false, maxLength: 128 }));
    const mediaType = mediaTypeOf(request);
    if (mediaType === 'text/html') return installLocalHtml(request, operationId);
    if (LOCAL_ZIP_CONTENT_TYPES.includes(mediaType)) return installLocalZip(request, operationId);
    throw hostError(GM.UNSUPPORTED_MEDIA_TYPE, 'Expected text/html or application/zip', {
      retryable: false,
    });
  }

  async function installLocalHtml(request, operationId) {
    const bytes = await readRequestBody(request, {
      allowedMediaTypes: ['text/html'],
      limitBytes: LIMITS.packageBytes,
    });
    // §14: the ZIP must never travel through the raw text/html upload path.
    if (looksLikeZip(bytes)) {
      throw hostError(GM.UNSUPPORTED_MEDIA_TYPE, 'ZIP packages must use application/zip', {
        retryable: false,
      });
    }
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
        const value = await installLocalHtmlLocked({ manifest, bytes, sha256: digest });
        storeOperation('install-local', operationId, params, value);
        return value;
      },
      { waitMs: installLockWaitMs, busyCode: GM.INSTALL_IN_PROGRESS }
    );
    return result;
  }

  async function installLocalZip(request, operationId) {
    const bytes = await readRequestBody(request, {
      allowedMediaTypes: LOCAL_ZIP_CONTENT_TYPES,
      limitBytes: LIMITS.zip.zipOuterBytes,
    });
    // §1.8: Content-Type and magic must agree; a mismatch is a media-type error.
    if (!looksLikeZip(bytes)) {
      throw hostError(GM.UNSUPPORTED_MEDIA_TYPE, 'Request body is not a ZIP archive', {
        retryable: false,
      });
    }
    // Measured outer sha256: used for rollback comparison and diagnostics only,
    // never as a trust anchor (the UI must still confirm; §1.8).
    const digest = sha256Hex(bytes);
    const params = JSON.stringify({ sha256: digest });
    const cached = lookupOperation('install-local-zip', operationId, params);
    if (cached) return cached;
    const result = await lock.run(
      async () => {
        const again = lookupOperation('install-local-zip', operationId, params);
        if (again) return again;
        const value = await installLocalZipLocked({ bytes, sha256: digest });
        storeOperation('install-local-zip', operationId, params, value);
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

  /**
   * Best-effort unseal of a package version tree that was already verified to be
   * a real directory inside `packages/<gameId>/`. Unlike the generic sealer it
   * never follows symlinks: only real directories are walked and only symlink
   * entries are skipped (the later rename/rm removes the link itself, never its
   * target). CR8-01.
   */
  async function unsealVerifiedPackageTree(rootPath) {
    let rootStat;
    try {
      rootStat = await fs.lstat(rootPath);
    } catch (_error) {
      return;
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return;
    const stack = [rootPath];
    while (stack.length > 0) {
      const current = stack.pop();
      let entries;
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch (_error) {
        continue;
      }
      try {
        await fs.chmod(current, 0o755);
      } catch (_error) {
        // Best effort; deletion only needs the parent to be writable.
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const target = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(target);
        else if (entry.isFile()) {
          try {
            await fs.chmod(target, 0o644);
          } catch (_error) {
            // Best effort.
          }
        }
      }
    }
  }

  /**
   * Remove every on-disk package entry owned by one game: `packages/<gameId>/`
   * may hold the current version, the retained previous version, and (after a
   * crash or manual tampering) unexpected files/symlinks. All of them belong to
   * this game and are moved to trash one by one.
   *
   * Safety (§6.4, CR8-01): `storage.filePath()` only checks lexically, so the
   * real path is verified segment by segment before anything is enumerated:
   *   - `packages/` and `packages/<gameId>/` must be real directories (a
   *     symlink at either segment is never traversed; the game root entry is
   *     renamed as a link only, and an ancestor link is left untouched);
   *   - `realpath(packages/<gameId>)` must stay inside `realpath(packages/)`,
   *     and every enumerated entry is re-checked the same way before use;
   *   - symlink entries are renamed as links only — their targets are never
   *     followed, read, chmod'd or deleted;
   *   - other game ids are never enumerated.
   * Failures are reported through `logger.warn` + the caller's `warnings[]`
   * (the record is already gone, so the uninstall still succeeds and
   * maintenance can retry the cleanup).
   */
  async function removeGamePackageDirectories(gameId) {
    const warnings = [];
    const seen = new Set();
    function warnOnce(token, error) {
      if (!seen.has(token)) {
        seen.add(token);
        warnings.push(token);
      }
      logger?.warn?.(
        '[game-market/host] uninstall-package-cleanup-failed',
        `gameId=${gameId}`,
        `token=${token}`,
        `code=${error && typeof error.code === 'string' ? error.code : 'E_UNKNOWN'}`,
      );
    }
    async function lstatOrNull(target) {
      try {
        return await fs.lstat(target);
      } catch (error) {
        if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
        throw error;
      }
    }
    async function realpathOrNull(target) {
      try {
        return await fs.realpath(target);
      } catch (error) {
        if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
        throw error;
      }
    }
    // Resolve the storage root first: every later containment check is against
    // its real path, never against the lexical configured data root.
    let storageReal;
    try {
      storageReal = await fs.realpath(storage.root);
    } catch (error) {
      warnOnce('package-path-escaped', error);
      return warnings;
    }
    const packagesDirectory = storage.filePath(PACKAGES_DIR);
    const packageRoot = storage.filePath(PACKAGES_DIR, gameId);

    // (1) Ancestor segment: `packages/` itself. A link here would make the game
    //     directory resolution follow it, so it is never traversed. It is also
    //     shared with every other game, so it is never moved either.
    let packagesStat;
    try {
      packagesStat = await lstatOrNull(packagesDirectory);
    } catch (error) {
      warnOnce('package-list-failed', error);
      return warnings;
    }
    if (!packagesStat) return warnings;
    if (packagesStat.isSymbolicLink() || !packagesStat.isDirectory()) {
      warnOnce('package-path-symlink');
      return warnings;
    }
    let packagesReal;
    try {
      packagesReal = await realpathOrNull(packagesDirectory);
    } catch (error) {
      warnOnce('package-path-escaped', error);
      return warnings;
    }
    if (!packagesReal || !isInside(storageReal, packagesReal)) {
      warnOnce('package-path-escaped');
      return warnings;
    }
    // Re-read after realpath: a concurrent swap to a link must stop traversal.
    const packagesAfter = await lstatOrNull(packagesDirectory).catch(() => null);
    if (!packagesAfter || packagesAfter.isSymbolicLink() || !packagesAfter.isDirectory()) {
      warnOnce('package-path-symlink');
      return warnings;
    }

    // (2) The game directory itself: must be a real directory strictly inside
    //     the verified `packages/` real path. A link/non-directory is handled as
    //     a single entry (renamed as a link only), never enumerated.
    let rootStat;
    try {
      rootStat = await lstatOrNull(packageRoot);
    } catch (error) {
      warnOnce('package-list-failed', error);
      return warnings;
    }
    if (!rootStat) return warnings;
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      try {
        await moveToTrash(packageRoot, gameId);
      } catch (error) {
        warnOnce('package-entry-cleanup-failed', error);
        return warnings;
      }
      warnOnce('package-root-not-directory');
      return warnings;
    }
    let rootReal;
    try {
      rootReal = await realpathOrNull(packageRoot);
    } catch (error) {
      warnOnce('package-path-escaped', error);
      return warnings;
    }
    if (!rootReal || !isInside(packagesReal, rootReal)) {
      warnOnce('package-path-escaped');
      return warnings;
    }

    // (3) Enumerate only after the root was proven to be a real in-boundary
    //     directory, then re-verify its identity so a swap cannot redirect the
    //     enumeration into an external tree.
    let entries;
    try {
      entries = await fs.readdir(packageRoot, { withFileTypes: true });
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return warnings;
      warnOnce('package-list-failed', error);
      return warnings;
    }
    const rootAfter = await lstatOrNull(packageRoot).catch(() => null);
    if (
      !rootAfter
      || rootAfter.isSymbolicLink()
      || !rootAfter.isDirectory()
      || rootAfter.dev !== rootStat.dev
      || rootAfter.ino !== rootStat.ino
    ) {
      warnOnce('package-path-changed');
      return warnings;
    }

    for (const item of entries) {
      let target;
      try {
        // Lexical containment first (validated game id + plain directory entry).
        target = storage.filePath(PACKAGES_DIR, gameId, item.name);
      } catch (error) {
        warnOnce('package-path-rejected', error);
        continue;
      }
      if (item.isSymbolicLink()) {
        // Rename the link itself; never traverse into its target.
        try {
          await moveToTrash(target, gameId);
        } catch (error) {
          warnOnce('package-entry-cleanup-failed', error);
        }
        continue;
      }
      if (item.isDirectory()) {
        let childReal;
        try {
          childReal = await realpathOrNull(target);
        } catch (error) {
          warnOnce('package-entry-cleanup-failed', error);
          continue;
        }
        // A directory that resolves outside this game's root is never touched.
        if (!childReal || !isInside(rootReal, childReal)) {
          warnOnce('package-path-escaped');
          continue;
        }
        try {
          // Unseal with a symlink-safe walker, then rename; `moveToTrash` never
          // follows links while moving/deleting the tree.
          await unsealVerifiedPackageTree(target);
          await moveToTrash(target, gameId);
        } catch (error) {
          warnOnce('package-entry-cleanup-failed', error);
        }
        continue;
      }
      try {
        await moveToTrash(target, gameId);
      } catch (error) {
        warnOnce('package-entry-cleanup-failed', error);
      }
    }
    try {
      await fs.rmdir(packageRoot);
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return warnings;
      warnOnce('package-directory-remove-failed', error);
    }
    return warnings;
  }

  async function uninstallLocked({ gameId, deleteData }) {
    const record = await installations.get(gameId);
    if (!record) {
      return { gameId, removed: false, dataDeleted: false, ignored: true };
    }
    if (await isRunning(gameId)) {
      throw hostError(GM.UPDATE_GAME_RUNNING, 'Exit the game before uninstalling', { retryable: true });
    }
    let dataDeleted = false;
    if (deleteData) {
      // Delete the complete data set BEFORE the package so a partial failure
      // keeps the game installed and retryable. `.bak` siblings must go too:
      // the storage layer can recover primary files from them.
      const dataPaths = [
        storage.filePath(SAVES_DIR, gameId),
        storage.filePath(SCORES_DIR, `${gameId}.json`),
        storage.filePath(SCORES_DIR, `${gameId}.json.bak`),
        storage.filePath(SESSIONS_DIR, `${gameId}.json`),
        storage.filePath(SESSIONS_DIR, `${gameId}.json.bak`),
        storage.filePath(PREVIEW_CACHE_DIR, gameId),
      ];
      // Preflight every path so a permission error cannot delete half the
      // data and still report a clean failure.
      const failures = [];
      for (const target of dataPaths) {
        try {
          await pathExists(target);
        } catch (_error) {
          failures.push(target);
        }
      }
      if (failures.length > 0) {
        throw hostError(GM.INSTALL_IO, 'Some game data could not be deleted', {
          retryable: true,
          details: { failedPaths: failures.length, phase: 'preflight' },
        });
      }
      for (const target of dataPaths) {
        try {
          await moveToTrash(target, gameId);
        } catch (_error) {
          failures.push(target);
        }
      }
      if (failures.length > 0) {
        throw hostError(GM.INSTALL_IO, 'Some game data could not be deleted', {
          retryable: true,
          details: { failedPaths: failures.length, phase: 'delete' },
        });
      }
      dataDeleted = true;
    }
    // M2-FIX (§6.4/§6.8): the retained current+1 window exists for upgrade
    // rollback; uninstall has no reason to keep it, so every version directory
    // of THIS game (the current one and the retained previous one) is removed.
    // Order matters: commit the record removal first, then clean the package
    // trees. A record-write failure must stay a retryable failure with the
    // package trees untouched, so the UI can never report "uninstalled" while
    // the game is still registered; a cleanup failure after the record is gone
    // is surfaced as a warning instead of silently leaking the directories.
    try {
      await installations.remove(gameId);
    } catch (error) {
      logger?.warn?.('[game-market/host] uninstall-record-failed', `gameId=${gameId}`, `code=${error?.code || 'E_UNKNOWN'}`);
      if (error && typeof error.code === 'string' && error.code.startsWith('GM-')) throw error;
      throw fsIoError(error, 'Could not update the installation record');
    }
    const warnings = await removeGamePackageDirectories(gameId);
    if (entry && typeof entry.invalidateGame === 'function') entry.invalidateGame(gameId);
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
    return {
      gameId,
      removed: true,
      dataDeleted,
      ignored: false,
      // Keep the success shape unchanged; warnings are additive and only
      // present when a post-commit cleanup step failed.
      ...(warnings.length > 0 ? { warnings: warnings.slice() } : {}),
    };
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
