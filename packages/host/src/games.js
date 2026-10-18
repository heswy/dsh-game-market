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
import { installationView } from './installations.js';
import { hostError } from './errors.js';
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
