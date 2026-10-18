/**
 * Built-in game catalog and GameRecord projection (PRD §8.2/§8.5, V0-01).
 *
 * Display metadata always comes from `games/<id>/game.json` when that file is
 * readable. `BUILTIN_GAMES` only supplies the lookup directory and a fallback
 * label so a missing/broken built-in remains visible and explainable.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { BUILTIN_GAMES, LIMITS } from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import { hostError } from './errors.js';
import { parseRange, parseVersion } from './semver.js';
import {
  isInside,
  isPlainObject,
  safeRelativePath,
  validateGameId,
} from './validation.js';

const MANIFEST_MAX_BYTES = 64 * 1024;
const DEFAULT_VIEWPORT = Object.freeze({ width: 960, height: 540, fit: 'contain' });
const SUPPORTED_CAPABILITIES = new Set(['storage', 'score']);
const PREVIEW_TYPES = Object.freeze({
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
});

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
 * Reads built-in manifests from `builtinGamesRoot`.
 *
 * @param {{root: string, entries?: readonly object[], logger?: object}} options
 */
export function createGameCatalog({ root, entries = BUILTIN_GAMES, logger = null }) {
  const entryMap = new Map(entries.map((entry) => [entry.id, entry]));

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
    const info = {
      gameId,
      catalogEntry,
      directory,
      manifest: null,
      placeholder: placeholderManifest(catalogEntry),
      issue: null,
      entryRel: catalogEntry.entryFile,
      entryPath: null,
      entryExists: false,
    };
    if (!isInside(root, directory)) {
      info.issue = 'path-escape';
      return info;
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

  async function list() {
    const result = [];
    for (const entry of entries) {
      if (!entryMap.has(entry.id)) continue;
      result.push(await load(entry.id));
    }
    return result;
  }

  async function get(gameId) {
    validateGameId(gameId);
    if (!entryMap.has(gameId)) throw hostError(GM.GAME_NOT_FOUND, 'Game not found');
    const info = await load(gameId);
    if (!info) throw hostError(GM.GAME_NOT_FOUND, 'Game not found');
    if (!info.manifest) {
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

  return { root, entries, list, get, diagnostics, getPreview, load };
}

/**
 * GameRecord projection for Market / My Games (contracts.js `GameRecord`).
 */
export function createGamesService({ catalog, storage, saves, sessions, scores, now }) {
  async function readInstallations() {
    try {
      const file = storage.filePath('installations.json');
      const result = await storage.readJson(file, { schemaVersion: 1 });
      const value = result && result.value;
      if (value && isPlainObject(value.games)) return value;
      return null;
    } catch (_error) {
      return null;
    }
  }

  async function buildRecord(info, installations) {
    const manifest = info.manifest || info.placeholder;
    const [meta, running, lastSessionAt, best] = await Promise.all([
      info.manifest ? saves.meta(info.gameId).catch(() => null) : Promise.resolve(null),
      info.manifest ? sessions.findRunning(info.gameId).catch(() => null) : Promise.resolve(null),
      info.manifest ? sessions.lastPlayedAt(info.gameId).catch(() => null) : Promise.resolve(null),
      info.manifest ? scores.bestValue(info.gameId).catch(() => null) : Promise.resolve(null),
    ]);
    const installation = installations && installations.games ? installations.games[info.gameId] : null;
    const installedAt =
      installation && typeof installation.lastPlayedAt === 'string'
        ? installation.lastPlayedAt
        : lastSessionAt;
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      categories: manifest.categories.slice(),
      capabilities: manifest.capabilities.slice(),
      builtin: true,
      installed: Boolean(info.manifest),
      canContinue: Boolean(info.manifest && running && meta && meta.revision > 0),
      bestScore: best && Number.isFinite(best.value) ? best.value : null,
      lastPlayedAt: typeof installedAt === 'string' ? installedAt : null,
      viewport: { ...manifest.viewport },
      // V0 diagnostics: lets the Client explain a broken built-in instead of hiding it.
      entryAvailable: info.entryExists,
      issue: info.issue,
    };
  }

  async function list({ q = null, category = null, limit = null, cursor = null } = {}) {
    const installations = await readInstallations();
    const infos = await catalog.list();
    let items = [];
    for (const info of infos) items.push(await buildRecord(info, installations));
    if (typeof q === 'string' && q.length > 0) {
      const needle = q.toLowerCase();
      items = items.filter(
        (item) =>
          item.name.toLowerCase().includes(needle) ||
          item.description.toLowerCase().includes(needle) ||
          item.id.includes(needle)
      );
    }
    if (typeof category === 'string' && category.length > 0) {
      items = items.filter((item) => item.categories.includes(category));
    }
    let start = 0;
    if (typeof cursor === 'string' && cursor.length > 0) {
      const parsed = Number(cursor);
      if (Number.isSafeInteger(parsed) && parsed >= 0) start = parsed;
    }
    if (Number.isInteger(limit)) items = items.slice(start, start + limit);
    else if (start > 0) items = items.slice(start);
    return {
      items,
      nextCursor: null,
      source: 'builtin',
      refreshedAt: now().toISOString(),
    };
  }

  async function installed() {
    const result = await list({});
    return { items: result.items };
  }

  async function get(gameId) {
    const info = await catalog.get(gameId);
    const installations = await readInstallations();
    const record = await buildRecord(info, installations);
    let activePlaySession = null;
    if (info.manifest) {
      const running = await sessions.findRunning(gameId).catch(() => null);
      if (running) {
        activePlaySession = { playSessionId: running.playSessionId, startedAt: running.startedAt };
      }
    }
    return { ...record, activePlaySession };
  }

  return { list, installed, get, buildRecord, readInstallations };
}
