/**
 * Built-in game catalog and GameRecord projection (PRD §8.2/§8.5, V0-01).
 *
 * Display metadata always comes from `games/<id>/game.json` when that file is
 * readable. `BUILTIN_GAMES` only supplies the lookup directory and a fallback
 * label so a missing/broken built-in remains visible and explainable.
 */

import { promises as fs, statSync } from 'node:fs';
import path from 'node:path';

import {
  ASSET_ZIP_V2,
  DEFAULT_PACKAGE_FORMAT,
  DESCRIPTOR_FILE,
  LIMITS,
} from '../../shared/src/constants.js';
import { BUILTIN_GAMES } from '../../shared/src/builtin-games.js';
import { GM, INTERNAL_TO_GM } from '../../shared/src/errors.js';
import { checkZipEntryType, fileManifestDigest, validateDescriptor } from '../../shared/src/package-v2.js';
import { installationView } from './installations.js';
import { hostError } from './errors.js';
import { sha256Hex } from './ids.js';
import { compatibilityFor, compareVersions, parseRange, parseVersion } from './semver.js';
import {
  isInside,
  isPlainObject,
  safeRelativePath,
  validateGameId,
} from './validation.js';

const MANIFEST_MAX_BYTES = 64 * 1024;
const CATEGORIES = Object.freeze([
  'arcade',
  'puzzle',
  'card',
  'idle',
  'action',
  'strategy',
  'trivia',
  'sandbox',
]);
const CATEGORY_SET = new Set(CATEGORIES);
const DEFAULT_PAGE_LIMIT = 20;
const DEFAULT_VIEWPORT = Object.freeze({ width: 960, height: 540, fit: 'contain' });
const SUPPORTED_CAPABILITIES = new Set(['storage', 'score']);
const PREVIEW_TYPES = Object.freeze({
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
});

/**
 * M2: built-in `asset-zip-v2` packages are validated with the *same* descriptor +
 * file-manifest rules as installed ZIP packages (docs/V1.5-CONTRACTS §1/§4/§7).
 * A built-in tree is trusted input, but "trusted" still means fail closed: a
 * tampered/missing file must never be served or launched.
 *
 * Full content hashing of every file is cached by a filesystem fingerprint
 * (path/size/mtime/inode). Every load still re-stats all files and re-verifies
 * the descriptor, entry and `game.json`, so an in-place edit invalidates the
 * cache and re-hashes the whole tree.
 */
const packageFileValidationCache = new Map();

function packageLayoutError(message) {
  return hostError(GM.DESCRIPTOR_MISMATCH, message || 'Built-in package does not match its file manifest', {
    retryable: false,
  });
}

/** Resolve a normalized package-relative path under its package root. */
function resolveInsidePackage(packageRoot, relPath) {
  const target = path.resolve(packageRoot, ...String(relPath).split('/'));
  if (!isInside(packageRoot, target)) throw packageLayoutError('Package path escapes its root');
  return target;
}

/**
 * Verify `files[]` against the on-disk package tree (size + sha256 for every
 * entry, bounded by the §3 limits). Successful full verification is cached by a
 * stat fingerprint so repeated catalog loads do not re-hash megabytes.
 */
async function verifyPackageFiles({ packageRoot, files }) {
  const fingerprint = [];
  const absolutePaths = [];
  let totalBytes = 0;
  for (const file of files) {
    const absPath = resolveInsidePackage(packageRoot, file.path);
    let stats;
    try {
      stats = await fs.lstat(absPath);
    } catch (_error) {
      throw packageLayoutError('Package file is missing');
    }
    if (stats.isSymbolicLink() || !stats.isFile()) throw packageLayoutError('Package file is not a regular file');
    if (stats.size !== file.size) throw packageLayoutError('Package file size does not match the manifest');
    const typeCheck = checkZipEntryType(file.path);
    if (!typeCheck.ok) {
      throw hostError(GM.ASSET_TYPE_UNSUPPORTED, 'Built-in package contains an unsupported asset type', {
        retryable: false,
      });
    }
    totalBytes += file.size;
    if (totalBytes > LIMITS.zip.zipUnpackedBytes) {
      throw hostError(GM.ZIP_LIMIT, 'Built-in package exceeds the unpacked size limit', {
        retryable: false,
        details: { kind: 'zipUnpackedBytes', limit: LIMITS.zip.zipUnpackedBytes },
      });
    }
    absolutePaths.push(absPath);
    fingerprint.push(`${file.path}\u0000${file.size}\u0000${stats.mtimeMs}\u0000${stats.ino}`);
  }
  const signature = fingerprint.join('\n');
  const cached = packageFileValidationCache.get(packageRoot);
  if (cached && cached.signature === signature) return;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    let bytes;
    try {
      bytes = await fs.readFile(absolutePaths[index]);
    } catch (_error) {
      throw packageLayoutError('Package file is unreadable');
    }
    if (bytes.length !== file.size || sha256Hex(bytes) !== file.sha256) {
      throw packageLayoutError('Package file content does not match the manifest');
    }
  }
  packageFileValidationCache.set(packageRoot, { signature });
}

function manifestError(field, message) {
  return hostError(GM.MANIFEST_INVALID, message || 'Invalid game manifest', {
    details: { field },
  });
}

function normalizeViewport(value) {
  if (value === undefined || value === null) return { ...DEFAULT_VIEWPORT };
  if (!isPlainObject(value)) throw manifestError('viewport', 'viewport must be an object');
  const width = value.width;
  const height = value.height;
  const fit = value.fit === undefined ? 'contain' : value.fit;
  if (!Number.isInteger(width) || width < 1 || width > 3840) throw manifestError('viewport.width');
  if (!Number.isInteger(height) || height < 1 || height > 3840) throw manifestError('viewport.height');
  if (fit !== 'contain') throw manifestError('viewport.fit');
  return { width, height, fit: 'contain' };
}

function normalizeCategories(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw manifestError('categories', 'categories must be an array');
  if (value.length > 3) throw manifestError('categories', 'Too many categories');
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 32) {
      throw manifestError('categories', 'Invalid category');
    }
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function normalizeCapabilities(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw manifestError('capabilities', 'capabilities must be an array');
  const out = [];
  for (const item of value) {
    if (typeof item !== 'string' || !SUPPORTED_CAPABILITIES.has(item)) {
      throw manifestError('capabilities', 'Invalid capability');
    }
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function normalizeScore(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) throw manifestError('score', 'score must be an object');
  const direction = value.direction === undefined ? 'higher-better' : value.direction;
  if (direction !== 'higher-better' && direction !== 'lower-better') {
    throw manifestError('score.direction', 'Invalid score direction');
  }
  const min = value.min;
  const max = value.max;
  if (typeof min !== 'number' || !Number.isFinite(min)) throw manifestError('score.min');
  if (typeof max !== 'number' || !Number.isFinite(max)) throw manifestError('score.max');
  if (!(min < max) || max - min > 1e9) throw manifestError('score.range');
  const integer = value.integer === undefined ? true : value.integer;
  if (typeof integer !== 'boolean') throw manifestError('score.integer');
  return { direction, min, max, integer };
}

function normalizeSave(value) {
  if (value === undefined || value === null) return { schemaVersion: 1 };
  if (!isPlainObject(value)) throw manifestError('save', 'save must be an object');
  const schemaVersion = value.schemaVersion === undefined ? 1 : value.schemaVersion;
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 2 ** 31 - 1) {
    throw manifestError('save.schemaVersion');
  }
  return { schemaVersion };
}

function normalizeVersionRange(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || parseRange(value) === null) {
    throw manifestError(field, `Unsupported ${field} range`);
  }
  return value;
}

function normalizeDeclaredFile(value, field) {
  if (value === undefined || value === null) return null;
  const safe = safeRelativePath(value);
  if (safe === null) throw manifestError(field, `Invalid ${field} path`);
  return safe;
}

/**
 * Normalise a `game.json` object into the V0 runtime shape.
 * Missing optional fields get documented defaults; wrong types are rejected.
 */
export function normalizeManifest(raw, expected = null) {
  if (!isPlainObject(raw)) throw manifestError('manifest', 'game.json must be an object');
  const manifestVersion = raw.manifestVersion === undefined ? 1 : raw.manifestVersion;
  if (manifestVersion !== 1) throw manifestError('manifestVersion', 'Unsupported manifestVersion');

  const id = raw.id === undefined && expected ? expected.id : raw.id;
  validateGameId(id, 'manifest id');
  if (expected && id !== expected.id) throw manifestError('id', 'Manifest id does not match its directory');

  const name = raw.name === undefined && expected ? expected.name : raw.name;
  if (typeof name !== 'string') throw manifestError('name');
  const normalizedName = name.trim();
  if (normalizedName.length === 0 || [...normalizedName].length > 64) throw manifestError('name');

  const version = raw.version === undefined && expected ? expected.version : raw.version;
  if (parseVersion(version) === null) throw manifestError('version', 'Invalid game version');

  const entry = safeRelativePath(
    raw.entry === undefined && expected ? expected.entryFile : raw.entry
  );
  if (entry === null || !entry.endsWith('.html')) throw manifestError('entry');

  let author = '';
  if (typeof raw.author === 'string') author = raw.author.trim().slice(0, 64);
  else if (isPlainObject(raw.author) && typeof raw.author.name === 'string') {
    author = raw.author.name.trim().slice(0, 64);
  }

  let description = '';
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string' || [...raw.description].length > 280) {
      throw manifestError('description');
    }
    description = raw.description.replace(/\s+/g, ' ').trim();
  }

  const icon = normalizeDeclaredFile(raw.icon, 'icon');
  const cover = normalizeDeclaredFile(raw.cover, 'cover');
  let screenshots = [];
  if (raw.screenshots !== undefined && raw.screenshots !== null) {
    if (!Array.isArray(raw.screenshots) || raw.screenshots.length > 5) {
      throw manifestError('screenshots');
    }
    screenshots = raw.screenshots.map((item, index) => {
      const safe = normalizeDeclaredFile(item, `screenshots.${index}`);
      if (safe === null) throw manifestError('screenshots');
      return safe;
    });
  }

  return {
    manifestVersion: 1,
    id,
    name: normalizedName,
    version,
    author,
    description,
    entry,
    icon,
    cover,
    screenshots,
    categories: normalizeCategories(raw.categories),
    capabilities: normalizeCapabilities(raw.capabilities),
    runtimeVersion: normalizeVersionRange(raw.runtimeVersion, 'runtimeVersion'),
    sdkVersion: normalizeVersionRange(raw.sdkVersion, 'sdkVersion'),
    viewport: normalizeViewport(raw.viewport),
    score: normalizeScore(raw.score),
    save: normalizeSave(raw.save),
  };
}

function placeholderManifest(catalogEntry) {
  return {
    manifestVersion: 1,
    id: catalogEntry.id,
    name: catalogEntry.name,
    version: catalogEntry.version,
    author: '',
    description: '',
    entry: catalogEntry.entryFile,
    icon: null,
    cover: null,
    screenshots: [],
    categories: [],
    capabilities: [],
    runtimeVersion: null,
    sdkVersion: null,
    viewport: { ...catalogEntry.viewport },
    score: null,
    save: { schemaVersion: 1 },
  };
}

/**
 * Synchronous "is this built-in package shipped in this tree?" probe.
 *
 * CR8-04: shipped means the extracted package **directory** exists
 * (`games/<id>/dist/`), *not* that the package is healthy. A shipped-but-broken
 * package (descriptor missing/invalid, file manifest mismatch, unreadable files)
 * must stay registered so the catalog shows `issue='package-invalid'` and
 * `install.js#isBuiltinGame` keeps rejecting install/uninstall for that id.
 *
 * Three outcomes per candidate path:
 *   - stat fails with ENOENT/ENOTDIR -> not shipped in this tree shape;
 *   - stat succeeds (directory, or even a corrupt non-directory `dist`) -> shipped;
 *   - stat fails with any other error (EACCES/EPERM/EIO/...) -> shipped but not
 *     inspectable; never silently treated as absent.
 *
 * Only a tree that genuinely does not ship the package is filtered out (dev/test
 * fixture roots). Production bundles missing the package fail `scripts/check.mjs`
 * at build time. The probe runs once at catalog construction (host activation).
 */
function builtinPackageShipped(root, catalogEntry) {
  if (!catalogEntry || catalogEntry.format !== ASSET_ZIP_V2) return true;
  const directoryCandidates = [
    path.resolve(root, path.basename(String(catalogEntry.dir || ''))),
    path.resolve(root, String(catalogEntry.dir || '')),
  ];
  const packageRel = typeof catalogEntry.packageDir === 'string' && catalogEntry.packageDir.length > 0
    ? catalogEntry.packageDir
    : path.posix.dirname(String(catalogEntry.entryFile || ''));
  for (const directory of directoryCandidates) {
    if (!isInside(root, directory)) continue;
    const packageRoot = path.resolve(directory, String(packageRel));
    if (!isInside(directory, packageRoot) || !isInside(root, packageRoot)) continue;
    try {
      statSync(packageRoot);
      return true;
    } catch (error) {
      const code = error && typeof error.code === 'string' ? error.code : '';
      if (code === 'ENOENT' || code === 'ENOTDIR') continue;
      // Permission/IO errors must not hide a shipped package (CR8-04).
      return true;
    }
  }
  return false;
}

/**
 * Probe one package path without collapsing "absent" into "inaccessible".
 * @returns {Promise<{state:'ok', stats:import('node:fs').Stats}|{state:'absent'}|{state:'inaccessible', code:string}>}
 */
async function probePackagePath(absPath) {
  try {
    return { state: 'ok', stats: await fs.lstat(absPath) };
  } catch (error) {
    const code = error && typeof error.code === 'string' ? error.code : '';
    if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'absent' };
    return { state: 'inaccessible', code: code || 'EIO' };
  }
}

/**
 * Reads built-in manifests from `builtinGamesRoot`.
 *
 * @param {{root: string, entries?: readonly object[], logger?: object}} options
 */
export function createGameCatalog({ root, entries = BUILTIN_GAMES, logger = null }) {
  // M2/CR8-04: an `asset-zip-v2` built-in is registered when its package tree is
  // *shipped* — healthy or broken (see builtinPackageShipped). `snake` (html-v1)
  // keeps the V1 behaviour of remaining visible even when broken so diagnostics
  // can explain it.
  const catalogEntries = entries.filter((entry) => builtinPackageShipped(root, entry));
  const entryMap = new Map(catalogEntries.map((entry) => [entry.id, entry]));

  async function resolveDirectory(catalogEntry) {
    // `builtinGamesRoot` is the `games/` directory, while BUILTIN_GAMES.dir is
    // repo-relative (`games/snake`). Accept either root shape defensively.
    const candidates = [
      path.resolve(root, path.basename(catalogEntry.dir)),
      path.resolve(root, catalogEntry.dir),
    ];
    for (const candidate of candidates) {
      if (!isInside(root, candidate)) continue;
      try {
        const stats = await fs.stat(candidate);
        if (stats.isDirectory()) return candidate;
      } catch (_error) {
        // Try the next shape.
      }
    }
    return candidates[0];
  }

  async function load(gameId) {
    const catalogEntry = entryMap.get(gameId);
    if (!catalogEntry) return null;
    const directory = await resolveDirectory(catalogEntry);
    const format = catalogEntry.format === ASSET_ZIP_V2 ? ASSET_ZIP_V2 : DEFAULT_PACKAGE_FORMAT;
    const info = {
      gameId,
      catalogEntry,
      directory,
      format,
      manifest: null,
      placeholder: placeholderManifest(catalogEntry),
      issue: null,
      entryRel: catalogEntry.entryFile,
      entry: null,
      entryPath: null,
      entryExists: false,
      packageRoot: null,
      filesDigest: null,
      fileCount: null,
      packageError: null,
    };
    if (!isInside(root, directory)) {
      info.issue = 'path-escape';
      return info;
    }
    if (format === ASSET_ZIP_V2) {
      // `false` means "this tree does not ship the package at all" (dev tree /
      // missing build artifact): the game is skipped rather than shown broken.
      // A present-but-invalid package is fail-closed below.
      const bundled = await loadZipBuiltin(info, catalogEntry);
      return bundled ? info : null;
    }
    let raw;
    try {
      raw = await fs.readFile(path.join(directory, 'game.json'), 'utf8');
    } catch (error) {
      info.issue = error && error.code === 'ENOENT' ? 'manifest-missing' : 'manifest-unreadable';
      return info;
    }
    if (Buffer.byteLength(raw, 'utf8') > MANIFEST_MAX_BYTES) {
      info.issue = 'manifest-too-large';
      return info;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_error) {
      info.issue = 'manifest-invalid';
      return info;
    }
    try {
      info.manifest = normalizeManifest(parsed, catalogEntry);
    } catch (_error) {
      info.issue = 'manifest-invalid';
      return info;
    }
    info.entryRel = info.manifest.entry;
    info.entry = info.manifest.entry;
    info.entryPath = path.resolve(directory, info.entryRel);
    if (!isInside(directory, info.entryPath)) {
      info.issue = 'path-escape';
      info.manifest = null;
      return info;
    }
    try {
      const stats = await fs.lstat(info.entryPath);
      info.entryExists = stats.isFile();
    } catch (_error) {
      info.entryExists = false;
    }
    if (!info.entryExists) info.issue = 'entry-missing';
    return info;
  }

  /**
   * Load a built-in `asset-zip-v2` package into `info` (M2-B).
   *
   * Returns `false` when the package is not present in this tree at all
   * (missing directory / missing descriptor = not built here), and `true`
   * otherwise — including the fail-closed `issue='package-invalid'` state, which
   * is visible in listings and rejected at launch with a GM-* error.
   */
  async function loadZipBuiltin(info, catalogEntry) {
    const packageRel = typeof catalogEntry.packageDir === 'string' && catalogEntry.packageDir.length > 0
      ? catalogEntry.packageDir
      : path.posix.dirname(String(catalogEntry.entryFile || ''));
    const packageRoot = path.resolve(info.directory, String(packageRel));
    if (!isInside(info.directory, packageRoot) || !isInside(root, packageRoot)) {
      info.issue = 'package-invalid';
      info.packageError = GM.DESCRIPTOR_INVALID;
      return true;
    }
    info.packageRoot = packageRoot;
    try {
      const packageRootState = await probePackagePath(packageRoot);
      if (packageRootState.state === 'absent') return false;
      if (packageRootState.state === 'inaccessible') {
        throw hostError(GM.DESCRIPTOR_INVALID, 'Built-in package directory is not readable', {
          retryable: false,
        });
      }
      if (!packageRootState.stats.isDirectory()) {
        throw packageLayoutError('Built-in package path is not a directory');
      }
      const descriptorPath = path.join(packageRoot, DESCRIPTOR_FILE);
      // CR8-04: a shipped package with a missing/unreadable descriptor is
      // *damaged*, not undelivered — it must surface as package-invalid instead
      // of making the built-in (and its id protection) disappear.
      const descriptorState = await probePackagePath(descriptorPath);
      if (descriptorState.state !== 'ok') {
        throw hostError(GM.DESCRIPTOR_INVALID, 'Built-in package descriptor is missing or unreadable', {
          retryable: false,
        });
      }
      const descriptorStats = descriptorState.stats;
      if (descriptorStats.isSymbolicLink() || !descriptorStats.isFile()) {
        throw packageLayoutError('Built-in package descriptor is not a regular file');
      }
      if (descriptorStats.size > LIMITS.zip.descriptorBytes) {
        throw hostError(GM.ZIP_LIMIT, 'Built-in package descriptor is too large', {
          retryable: false,
          details: { kind: 'descriptorBytes', limit: LIMITS.zip.descriptorBytes },
        });
      }
      let parsed;
      try {
        parsed = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));
      } catch (_error) {
        throw hostError(GM.DESCRIPTOR_INVALID, 'Built-in package descriptor is not valid JSON', {
          retryable: false,
        });
      }
      const validation = validateDescriptor(parsed);
      if (!validation.ok) {
        throw hostError(INTERNAL_TO_GM[validation.code] || GM.DESCRIPTOR_INVALID, 'Built-in package descriptor is invalid', {
          retryable: false,
        });
      }
      const descriptor = validation.value;
      const entryPath = resolveInsidePackage(packageRoot, descriptor.entry);
      const expectedEntryPath = path.resolve(info.directory, String(catalogEntry.entryFile || ''));
      if (entryPath !== expectedEntryPath) {
        throw hostError(GM.DESCRIPTOR_MISMATCH, 'Built-in package entry does not match its catalog entry', {
          retryable: false,
        });
      }
      const digest = fileManifestDigest(descriptor.files, sha256Hex);
      await verifyPackageFiles({ packageRoot, files: descriptor.files });

      // Display metadata: `game.json` is one of the verified `files[]`.
      const manifestPath = path.join(packageRoot, catalogEntry.manifestFile || descriptor.gameManifest || 'game.json');
      let manifestStats;
      try {
        manifestStats = await fs.lstat(manifestPath);
      } catch (_error) {
        throw hostError(GM.MANIFEST_INVALID, 'Built-in package manifest is missing', { retryable: false });
      }
      if (!manifestStats.isFile() || manifestStats.size > MANIFEST_MAX_BYTES) {
        throw hostError(GM.MANIFEST_INVALID, 'Built-in package manifest is invalid', { retryable: false });
      }
      let parsedManifest;
      try {
        parsedManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      } catch (_error) {
        throw hostError(GM.MANIFEST_INVALID, 'Built-in package manifest is not valid JSON', { retryable: false });
      }
      const manifest = normalizeManifest(parsedManifest, catalogEntry);
      if (manifest.version !== catalogEntry.version) {
        throw hostError(GM.INSTALL_VERSION_MISMATCH, 'Built-in package version does not match BUILTIN_GAMES', {
          retryable: false,
          details: { field: 'version' },
        });
      }
      // The descriptor is the serving authority for the entry path; keep the
      // normalized display manifest consistent with it.
      manifest.entry = descriptor.entry;
      info.manifest = manifest;
      info.entry = descriptor.entry;
      info.entryRel = descriptor.entry;
      info.entryPath = entryPath;
      info.entryExists = true;
      info.filesDigest = digest;
      info.fileCount = descriptor.files.length;
      info.issue = null;
      return true;
    } catch (error) {
      const gmCode = error && typeof error.code === 'string' && /^GM-\d{4}$/.test(error.code)
        ? error.code
        : GM.DESCRIPTOR_INVALID;
      info.issue = 'package-invalid';
      info.packageError = gmCode;
      info.manifest = null;
      info.entry = null;
      info.entryPath = null;
      info.entryExists = false;
      info.filesDigest = null;
      info.fileCount = null;
      logger?.warn?.('[game-market/host] builtin-package-invalid', `gameId=${info.gameId}`, `code=${gmCode}`);
      return true;
    }
  }

  async function list() {
    const result = [];
    for (const entry of catalogEntries) {
      if (!entryMap.has(entry.id)) continue;
      const info = await load(entry.id);
      if (info) result.push(info);
    }
    return result;
  }

  async function get(gameId) {
    validateGameId(gameId);
    if (!entryMap.has(gameId)) throw hostError(GM.GAME_NOT_FOUND, 'Game not found');
    const info = await load(gameId);
    if (!info) throw hostError(GM.GAME_NOT_FOUND, 'Game not found');
    if (!info.manifest) {
      if (info.issue === 'package-invalid' && typeof info.packageError === 'string') {
        throw hostError(info.packageError, 'Built-in package is invalid', {
          retryable: false,
          details: { reason: 'package-invalid' },
        });
      }
      if (info.issue === 'manifest-missing' || info.issue === 'manifest-unreadable') {
        throw hostError(GM.GAME_NOT_FOUND, 'Game not found');
      }
      throw hostError(GM.MANIFEST_INVALID, 'Game manifest is invalid');
    }
    return info;
  }

  async function diagnostics() {
    const items = await list();
    return {
      root,
      items: items.map((info) => ({
        gameId: info.gameId,
        format: info.format || DEFAULT_PACKAGE_FORMAT,
        issue: info.issue,
        entryAvailable: info.entryExists,
        installed: Boolean(info.manifest),
      })),
    };
  }

  async function getPreview(gameId, file) {
    const info = await get(gameId);
    const manifest = info.manifest;
    const declared = [manifest.icon, manifest.cover, ...manifest.screenshots].filter(Boolean);
    if (!declared.includes(file)) throw hostError(GM.ASSET_NOT_FOUND, 'Asset not found');
    const target = path.resolve(info.directory, file);
    if (!isInside(info.directory, target)) throw hostError(GM.ASSET_NOT_FOUND, 'Asset not found');
    const extension = path.extname(file).toLowerCase();
    const contentType = PREVIEW_TYPES[extension];
    if (!contentType) throw hostError(GM.ASSET_NOT_FOUND, 'Asset not found');
    let stats;
    try {
      stats = await fs.lstat(target);
    } catch (_error) {
      throw hostError(GM.ASSET_NOT_FOUND, 'Asset not found');
    }
    if (!stats.isFile()) throw hostError(GM.ASSET_NOT_FOUND, 'Asset not found');
    if (stats.size > LIMITS.previewBytes) {
      throw hostError(GM.SAVE_TOO_LARGE, 'Preview image exceeds the size limit');
    }
    let bytes;
    try {
      bytes = await fs.readFile(target);
    } catch (_error) {
      throw hostError(GM.ASSET_NOT_FOUND, 'Asset not found');
    }
    return { bytes, contentType, size: bytes.length };
  }

  return { root, entries: catalogEntries, list, get, diagnostics, getPreview, load };
}

const PREVIEW_BASE = '/api/game-market/preview';

function previewQuery(gameId, version, file) {
  const params = new URLSearchParams({ gameId, version, file });
  return `${PREVIEW_BASE}?${params.toString()}`;
}

function normaliseViewport(value) {
  if (!isPlainObject(value)) return { width: 960, height: 540, fit: 'contain' };
  const width = Number.isInteger(value.width) && value.width >= 1 && value.width <= 3840 ? value.width : 960;
  const height = Number.isInteger(value.height) && value.height >= 1 && value.height <= 3840 ? value.height : 540;
  return { width, height, fit: 'contain' };
}

function authorOf(manifest) {
  if (!manifest) return { name: '' };
  if (typeof manifest.author === 'string') return { name: manifest.author };
  if (isPlainObject(manifest.author) && typeof manifest.author.name === 'string') {
    return {
      name: manifest.author.name,
      ...(typeof manifest.author.url === 'string' ? { url: manifest.author.url } : {}),
    };
  }
  return { name: '' };
}

function compatibilityView(compatibility) {
  if (!compatibility) return { ok: false, reason: GM.INSTALL_CORRUPT };
  if (compatibility.status === 'ok') return { ok: true, reason: null };
  const reason = Array.isArray(compatibility.reasons) && compatibility.reasons.length > 0
    ? compatibility.reasons[0]
    : null;
  return { ok: false, reason };
}

function tagsOf(manifest, entry) {
  if (manifest && Array.isArray(manifest.tags)) return manifest.tags.slice();
  if (entry && Array.isArray(entry.tags)) return entry.tags.slice();
  return [];
}

/** GameSummary / GameDetail projection for Market and My Games (V1-CONTRACTS §7.3). */
export function createGamesService({
  catalog,
  devCatalog = null,
  installations,
  registry,
  storage,
  saves,
  sessions,
  scores,
  now,
}) {
  async function activityFor(gameId) {
    const [meta, running, lastSessionAt, best] = await Promise.all([
      saves.meta(gameId).catch(() => null),
      sessions.findRunning(gameId).catch(() => null),
      sessions.lastPlayedAt(gameId).catch(() => null),
      scores.bestValue(gameId).catch(() => null),
    ]);
    return {
      meta,
      running,
      lastPlayedAt: lastSessionAt,
      bestScore: best && Number.isFinite(best.value) ? best.value : null,
    };
  }

  async function previewUrls(gameId, version) {
    if (!version) return { icon: null, cover: null, screenshots: [] };
    try {
      return await registry.previewUrls(gameId, version);
    } catch (_error) {
      return { icon: null, cover: null, screenshots: [] };
    }
  }

  async function buildBuiltin(info, activity) {
    const manifest = info.manifest || info.placeholder;
    const id = manifest.id;
    const version = manifest.version;
    const entry = registry.findEntry(id);
    const canonical = info.manifest ? manifest : null;
    const compatibility = compatibilityFor(canonical || manifest, now().toISOString());
    return {
      id,
      name: manifest.name,
      version,
      description: manifest.description,
      author: authorOf(canonical || manifest),
      categories: (canonical ? canonical.categories : []).slice(),
      tags: tagsOf(canonical, entry),
      capabilities: (canonical ? canonical.capabilities : []).slice(),
      sdkVersion: canonical && typeof canonical.sdkVersion === 'string' ? canonical.sdkVersion : null,
      runtimeVersion: canonical && typeof canonical.runtimeVersion === 'string' ? canonical.runtimeVersion : null,
      icon: canonical && canonical.icon ? previewQuery(id, version, 'icon') : null,
      cover: canonical && canonical.cover ? previewQuery(id, version, 'cover') : null,
      screenshots: canonical && Array.isArray(canonical.screenshots)
        ? canonical.screenshots.map((_value, index) => previewQuery(id, version, `screenshot-${index + 1}`))
        : [],
      homepage: canonical ? canonical.homepage || null : null,
      repository: canonical ? canonical.repository || null : null,
      license: canonical ? canonical.license || null : null,
      changelog: entry ? entry.changelog || null : null,
      featured: entry ? entry.featured === true : false,
      quickPlay: entry ? entry.quickPlay === true : false,
      publishedAt: null,
      updatedAt: null,
      source: 'builtin',
      dev: false,
      installedVersion: info.manifest ? version : null,
      updateAvailable: false,
      canContinue: Boolean(info.manifest && activity.running && activity.meta && activity.meta.revision > 0),
      bestScore: activity.bestScore,
      lastPlayedAt: activity.lastPlayedAt,
      compatibility: compatibilityView(compatibility),
      preferredTheme: canonical ? canonical.preferredTheme || 'system' : 'system',
      i18n: entry ? entry.i18n || null : null,
      // Legacy V0 fields kept additively for older consumers.
      builtin: true,
      installed: Boolean(info.manifest),
      viewport: normaliseViewport(canonical && canonical.viewport),
      entryAvailable: info.entryExists,
      issue: info.issue,
      // M2: built-in package projection. `asset-zip-v2` builtins expose the
      // validated descriptor entry / file-manifest digest / file count so the
      // Client and diagnostics can reason about them; `html-v1` keeps nulls.
      format: info.format || DEFAULT_PACKAGE_FORMAT,
      entry: info.entry || info.entryRel || null,
      filesDigest: info.filesDigest ?? null,
      fileCount: info.fileCount ?? null,
    };
  }

  async function buildInstalled(record, entry, activity) {
    const manifest = isPlainObject(record.manifest) ? record.manifest : null;
    const version = record.version;
    const compatibility = record.compatibility || compatibilityFor(manifest || {}, now().toISOString());
    let updateAvailable = false;
    let latestVersion = null;
    if (entry && typeof entry.version === 'string') {
      latestVersion = entry.version;
      const latestCompatibility = compatibilityFor(
        { capabilities: entry.capabilities, sdkVersion: entry.sdkVersion, runtimeVersion: entry.runtimeVersion },
        now().toISOString()
      );
      updateAvailable = compareVersions(entry.version, version) > 0 && latestCompatibility.status === 'ok';
    }
    const installedPreviews = await previewUrls(record.id, version);
    const latestPreviews = entry && latestVersion && latestVersion !== version
      ? await previewUrls(record.id, latestVersion)
      : { icon: null, cover: null, screenshots: [] };
    const inlineIcon = manifest && typeof manifest.icon === 'string' && manifest.icon.startsWith('data:image/')
      ? previewQuery(record.id, version, 'icon')
      : null;
    const icon = installedPreviews.icon || inlineIcon || latestPreviews.icon;
    const cover = installedPreviews.cover || latestPreviews.cover;
    const screenshots = installedPreviews.screenshots.length > 0
      ? installedPreviews.screenshots
      : latestPreviews.screenshots;
    return {
      id: record.id,
      name: manifest ? manifest.name : record.id,
      version,
      description: manifest ? manifest.description : '',
      author: authorOf(manifest),
      categories: manifest && Array.isArray(manifest.categories) ? manifest.categories.slice() : [],
      tags: tagsOf(manifest, entry),
      capabilities: manifest && Array.isArray(manifest.capabilities) ? manifest.capabilities.slice() : [],
      sdkVersion: manifest && typeof manifest.sdkVersion === 'string' ? manifest.sdkVersion : null,
      runtimeVersion: manifest && typeof manifest.runtimeVersion === 'string' ? manifest.runtimeVersion : null,
      icon,
      cover,
      screenshots,
      homepage: (manifest && manifest.homepage) || (entry && entry.homepage) || null,
      repository: (manifest && manifest.repository) || (entry && entry.repository) || null,
      license: (manifest && manifest.license) || (entry && entry.license) || null,
      changelog: entry ? entry.changelog || null : null,
      featured: entry ? entry.featured === true : false,
      quickPlay: entry ? entry.quickPlay === true : false,
      publishedAt: entry ? entry.publishedAt || null : null,
      updatedAt: entry ? entry.updatedAt || null : record.updatedAt || null,
      source: record.source,
      dev: record.source === 'dev',
      installedVersion: version,
      updateAvailable,
      canContinue: Boolean(activity.running && activity.meta && activity.meta.revision > 0),
      bestScore: activity.bestScore,
      lastPlayedAt:
        (typeof record.lastPlayedAt === 'string' ? record.lastPlayedAt : null) || activity.lastPlayedAt,
      compatibility: compatibilityView(compatibility),
      preferredTheme: manifest ? manifest.preferredTheme || 'system' : 'system',
      i18n: (manifest && manifest.i18n) || (entry && entry.i18n) || null,
      // Legacy V0 fields kept additively for older consumers.
      builtin: false,
      installed: true,
      viewport: normaliseViewport(manifest && manifest.viewport),
      entryAvailable: true,
      issue: null,
      latestVersion,
    };
  }

  async function buildRegistry(entry) {
    const compatibility = compatibilityFor(
      { capabilities: entry.capabilities, sdkVersion: entry.sdkVersion, runtimeVersion: entry.runtimeVersion },
      now().toISOString()
    );
    const previews = await previewUrls(entry.id, entry.version);
    return {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      description: entry.description,
      author: authorOf({ author: entry.author }),
      categories: Array.isArray(entry.categories) ? entry.categories.slice() : [],
      tags: Array.isArray(entry.tags) ? entry.tags.slice() : [],
      capabilities: Array.isArray(entry.capabilities) ? entry.capabilities.slice() : [],
      sdkVersion: entry.sdkVersion || null,
      runtimeVersion: entry.runtimeVersion || null,
      icon: previews.icon,
      cover: previews.cover,
      screenshots: previews.screenshots,
      homepage: entry.homepage || null,
      repository: entry.repository || null,
      license: entry.license || null,
      changelog: entry.changelog || null,
      featured: entry.featured === true,
      quickPlay: entry.quickPlay === true,
      publishedAt: entry.publishedAt || null,
      updatedAt: entry.updatedAt || null,
      source: 'registry',
      dev: false,
      installedVersion: null,
      updateAvailable: false,
      canContinue: false,
      bestScore: null,
      lastPlayedAt: null,
      compatibility: compatibilityView(compatibility),
      preferredTheme: entry.preferredTheme || 'system',
      i18n: entry.i18n || null,
      // Legacy V0 fields kept additively for older consumers.
      builtin: false,
      installed: false,
      viewport: { width: 960, height: 540, fit: 'contain' },
      entryAvailable: false,
      issue: null,
    };
  }

  async function buildDev(item, activity) {
    const manifest = item.manifest;
    const compatibility = item.compatibility || compatibilityFor(manifest, now().toISOString());
    const previews = await previewUrls(item.id, item.version);
    return {
      id: item.id,
      name: manifest.name,
      version: item.version,
      description: manifest.description,
      author: authorOf(manifest),
      categories: Array.isArray(manifest.categories) ? manifest.categories.slice() : [],
      tags: tagsOf(manifest, null),
      capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities.slice() : [],
      sdkVersion: typeof manifest.sdkVersion === 'string' ? manifest.sdkVersion : null,
      runtimeVersion: typeof manifest.runtimeVersion === 'string' ? manifest.runtimeVersion : null,
      icon: previews.icon,
      cover: previews.cover,
      screenshots: previews.screenshots,
      homepage: manifest.homepage || null,
      repository: manifest.repository || null,
      license: manifest.license || null,
      changelog: null,
      featured: false,
      quickPlay: false,
      publishedAt: null,
      updatedAt: null,
      source: 'dev',
      dev: true,
      installedVersion: null,
      updateAvailable: false,
      canContinue: Boolean(activity.running && activity.meta && activity.meta.revision > 0),
      bestScore: activity.bestScore,
      lastPlayedAt: activity.lastPlayedAt,
      compatibility: compatibilityView(compatibility),
      preferredTheme: manifest.preferredTheme || 'system',
      i18n: manifest.i18n || null,
      // Legacy V0 fields kept additively for older consumers.
      builtin: false,
      installed: false,
      viewport: normaliseViewport(manifest.viewport),
      entryAvailable: true,
      issue: null,
    };
  }

  function sortSummaries(items) {
    return items.sort((left, right) => {
      if (left.featured !== right.featured) return left.featured ? -1 : 1;
      if (left.quickPlay !== right.quickPlay) return left.quickPlay ? -1 : 1;
      if (left.installed !== right.installed) return left.installed ? -1 : 1;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
  }

  async function buildAll() {
    if (registry && typeof registry.localReady === 'function') await registry.localReady();
    const [infos, records, devItems] = await Promise.all([
      catalog.list(),
      installations.records(),
      devCatalog ? devCatalog.list() : Promise.resolve([]),
    ]);
    const summaries = new Map();
    const builtinIds = new Set();
    for (const info of infos) {
      if (!info) continue;
      const activity = await activityFor(info.gameId);
      summaries.set(info.gameId, await buildBuiltin(info, activity));
      builtinIds.add(info.gameId);
    }
    for (const record of records) {
      if (!record || builtinIds.has(record.id) || summaries.has(record.id)) continue;
      const activity = await activityFor(record.id);
      summaries.set(record.id, await buildInstalled(record, registry.findEntry(record.id), activity));
    }
    for (const entry of registry.games()) {
      if (!entry || summaries.has(entry.id)) continue;
      summaries.set(entry.id, await buildRegistry(entry));
    }
    for (const item of devItems) {
      if (!item) continue;
      const activity = await activityFor(item.id);
      summaries.set(item.id, await buildDev(item, activity));
    }
    return sortSummaries([...summaries.values()]);
  }

  function filterSummaries(items, { q = null, category = null, limit = null, cursor = null } = {}) {
    let filtered = items;
    if (typeof q === 'string' && q.length > 0) {
      const needle = q.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.name.toLowerCase().includes(needle) ||
          item.description.toLowerCase().includes(needle) ||
          item.id.includes(needle) ||
          item.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    }
    if (typeof category === 'string' && category.length > 0) {
      if (!CATEGORY_SET.has(category)) {
        throw hostError(GM.INVALID_PARAM, 'Invalid category');
      }
      filtered = filtered.filter((item) => item.categories.includes(category));
    }
    let start = 0;
    if (typeof cursor === 'string' && cursor.length > 0) {
      if (!/^\d+$/.test(cursor)) throw hostError(GM.INVALID_PARAM, 'Invalid cursor');
      start = Number(cursor);
      if (!Number.isSafeInteger(start)) throw hostError(GM.INVALID_PARAM, 'Invalid cursor');
    }
    const effectiveLimit = Number.isInteger(limit) ? limit : DEFAULT_PAGE_LIMIT;
    const page = filtered.slice(start, start + effectiveLimit);
    const nextCursor = start + effectiveLimit < filtered.length ? String(start + effectiveLimit) : null;
    return { items: page, nextCursor };
  }

  function marketSource(items) {
    const registryCount = registry.games().length;
    if (registryCount === 0) return 'builtin';
    const hasOther = items.some((item) => item.source !== 'registry');
    return hasOther ? 'merged' : 'market';
  }

  async function list(options = {}) {
    const all = await buildAll();
    const { items, nextCursor } = filterSummaries(all, options);
    return {
      items,
      nextCursor,
      source: marketSource(all),
      refreshedAt: now().toISOString(),
      registry: await registry.snapshot(),
    };
  }

  async function installed() {
    const all = await buildAll();
    const items = all.filter((item) => item.installed === true || item.builtin === true);
    return { items };
  }

  async function get(gameId) {
    validateGameId(gameId);
    const all = await buildAll();
    const summary = all.find((item) => item.id === gameId);
    if (!summary) throw hostError(GM.GAME_NOT_FOUND, 'Game not found', { retryable: false });
    if (summary.source === 'builtin' && summary.issue) {
      if (summary.issue === 'manifest-invalid' || summary.issue === 'manifest-too-large') {
        throw hostError(GM.MANIFEST_INVALID, 'Game manifest is invalid', { retryable: false });
      }
      if (summary.issue === 'manifest-missing' || summary.issue === 'manifest-unreadable') {
        throw hostError(GM.GAME_NOT_FOUND, 'Game not found', { retryable: false });
      }
    }
    const [record, activity] = await Promise.all([
      installations.get(gameId),
      activityFor(gameId),
    ]);
    const entry = registry.findEntry(gameId);
    const running = activity.running;
    const detail = {
      ...summary,
      activePlaySession: running
        ? { playSessionId: running.playSessionId, startedAt: running.startedAt }
        : null,
      saveInfo: activity.meta
        ? {
            saveSchemaVersion: activity.meta.saveSchemaVersion,
            savedAt: activity.meta.savedAt || null,
          }
        : null,
      preferredTheme: summary.preferredTheme || 'system',
      i18n: summary.i18n || null,
    };
    return {
      game: detail,
      installed: record ? installationView(record) : null,
      canContinue: summary.canContinue,
      bestScore: summary.bestScore,
      activePlaySession: detail.activePlaySession,
      registry: entry,
      // Legacy V0 flat fields (kept additively; `installed` above is the V1 view).
      id: summary.id,
      name: summary.name,
      version: summary.version,
      description: summary.description,
      author: summary.author,
      categories: summary.categories,
      capabilities: summary.capabilities,
      builtin: summary.builtin,
      entryAvailable: summary.entryAvailable,
      issue: summary.issue,
      viewport: summary.viewport,
      lastPlayedAt: summary.lastPlayedAt,
    };
  }

  async function readInstallations() {
    try {
      const result = await installations.read();
      return result && isPlainObject(result.games) ? result : null;
    } catch (_error) {
      return null;
    }
  }

  return { list, installed, get, buildAll, filterSummaries, readInstallations, activityFor };
}
