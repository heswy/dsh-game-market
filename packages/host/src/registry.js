/**
 * Static Registry client (V1-CONTRACTS §5, PRD §8.8).
 *
 * Responsibilities:
 *   - resolve the configured source (https index or local file index);
 *   - single-flight refresh with ETag/If-None-Match, 6h TTL, 14d stale cap and
 *     offline fallback to `registry-cache.json`;
 *   - strict whole-index validation through `packages/shared/src/registry.js`
 *     (a single bad entry rejects the whole document and keeps the old cache);
 *   - manual refresh throttling (5 min, `GM-4290`);
 *   - preview asset caching into `preview-cache/<id>/<version>/` for `/preview`.
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { API_BASE, LIMITS, TIMING } from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import { PREVIEW_CACHE_DIR, previewCachePath } from '../../shared/src/installation.js';
import {
  DEFAULT_ALLOWED_HOSTS,
  REGISTRY_CACHE_FILE,
  REGISTRY_CACHE_SCHEMA_VERSION,
  REGISTRY_REFRESH_THROTTLE_MS,
  REGISTRY_STALE_MS,
  REGISTRY_TTL_MS,
  validateRegistry,
  validateRegistryCache,
} from '../../shared/src/registry.js';
import { fetchBytes } from './download.js';
import { hostError } from './errors.js';
import { isPlainObject } from './validation.js';

const PREVIEW_FILES = Object.freeze(['icon', 'cover']);
const PREVIEW_SCREENSHOT_RE = /^screenshot-[1-5]$/;
const PREVIEW_EXTENSIONS = Object.freeze(['png', 'webp', 'jpg', 'jpeg']);
const PREVIEW_TYPES = Object.freeze({
  png: 'image/png',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
});

const GAME_ID_RE = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function isPreviewFile(file) {
  return typeof file === 'string' && (PREVIEW_FILES.includes(file) || PREVIEW_SCREENSHOT_RE.test(file));
}

/** Magic-byte sniffing; content-type headers alone are not trusted. */
export function sniffImageType(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'png';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

function headOk(contentType, sniffed) {
  if (!contentType) return true;
  const media = contentType.split(';', 1)[0].trim().toLowerCase();
  if (media.length === 0 || media === 'application/octet-stream') return true;
  if (!media.startsWith('image/')) return false;
  return media === PREVIEW_TYPES[sniffed === 'jpeg' ? 'jpeg' : sniffed];
}

function registryUnavailable(message, details) {
  return hostError(GM.REGISTRY_UNAVAILABLE, message || 'Game registry is unavailable', {
    retryable: true,
    details,
  });
}

function decodeUtf8(bytes) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) return null;
    return text;
  } catch (_error) {
    return null;
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return undefined;
  }
}

/**
 * @param {{
 *   storage: object,
 *   settings: object,
 *   logger?: object,
 *   now?: () => Date,
 *   http?: {fetch?: Function, sleep?: Function, resolveHost?: Function, retries?: number}
 * }} options
 */
export function createRegistryService({ storage, settings = {}, logger = null, now = () => new Date(), http = {} }) {
  const registrySettings = isPlainObject(settings.registry) ? settings.registry : {};
  const source = registrySettings.source || null;
  const sourceUrl =
    registrySettings.sourceUrl ||
    (source ? (source.kind === 'file' ? source.path : source.url) : null);
  const configuredHosts = Array.isArray(registrySettings.allowedHosts) ? registrySettings.allowedHosts : [];
  const allowedHosts = [...new Set([...DEFAULT_ALLOWED_HOSTS, ...configuredHosts])];
  const devMode = settings.devMode === true;
  const fetchImpl = typeof http.fetch === 'function' ? http.fetch : null;
  const sleep = typeof http.sleep === 'function' ? http.sleep : undefined;
  const resolveHost = typeof http.resolveHost === 'function' ? http.resolveHost : undefined;
  const retries = Number.isInteger(http.retries) && http.retries >= 0 ? http.retries : 0;
  const cacheFileName =
    typeof registrySettings.cacheFile === 'string' && registrySettings.cacheFile.length > 0
      ? registrySettings.cacheFile
      : REGISTRY_CACHE_FILE;
  const persistCache = registrySettings.persistCache !== false;

  let cache = null;
  let loaded = false;
  let loadPromise = null;
  let refreshPromise = null;
  let startupPromise = null;
  let lastManualRefreshAt = 0;
  let lastError = null;
  let offline = false;

  function cacheFilePath() {
    return storage.filePath(cacheFileName);
  }

  function cacheMatchesSource(value) {
    return isPlainObject(value) && typeof value.sourceUrl === 'string' && value.sourceUrl === sourceUrl;
  }

  function cacheAgeMs() {
    if (!cache) return Number.POSITIVE_INFINITY;
    const fetched = Date.parse(cache.fetchedAt);
    if (!Number.isFinite(fetched)) return Number.POSITIVE_INFINITY;
    return Math.max(0, now().getTime() - fetched);
  }

  function ttlState() {
    if (!cache) return 'missing';
    const age = cacheAgeMs();
    if (age <= REGISTRY_TTL_MS) return 'fresh';
    if (age <= REGISTRY_STALE_MS) return 'stale';
    return 'expired';
  }

  function state() {
    const base = ttlState();
    if (base === 'missing' || base === 'expired') return base;
    return offline ? 'offline' : base;
  }

  /** Games usable for the Market list (expired caches no longer show remote data). */
  function games() {
    return ttlState() === 'expired' || !cache ? [] : cache.games;
  }

  function findEntry(gameId) {
    if (typeof gameId !== 'string') return null;
    return games().find((game) => game && game.id === gameId) || null;
  }

  async function ensureLoaded() {
    if (loaded) return;
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          const result = await storage.readJson(cacheFilePath(), {
            schemaVersion: REGISTRY_CACHE_SCHEMA_VERSION,
          });
          if (result) {
            const validation = validateRegistryCache(result.value);
            if (validation.ok && cacheMatchesSource(result.value)) {
              cache = validation.cache;
              lastError = null;
            } else {
              // A cache from another source is ignored (registryUrl changed).
              lastError = GM.REGISTRY_UNAVAILABLE;
            }
          }
        } catch (error) {
          lastError = error && error.code === GM.SCHEMA_READ_TOO_NEW ? GM.REGISTRY_UNAVAILABLE : GM.REGISTRY_UNAVAILABLE;
          logger?.warn?.('[game-market/host] registry-cache-unreadable', `code=${lastError}`);
        }
        loaded = true;
      })();
    }
    await loadPromise;
  }

  async function persist(nextCache) {
    if (!persistCache) return;
    try {
      await storage.writeJson(cacheFilePath(), nextCache);
    } catch (error) {
      // Keep the in-memory cache; the previous file stays on disk (§5.3).
      logger?.warn?.('[game-market/host] registry-cache-write-failed', `code=${error?.code || 'E_UNKNOWN'}`);
    }
  }

  function rejects(message, details) {
    return hostError(GM.REGISTRY_UNAVAILABLE, message, { retryable: false, details });
  }

  function normaliseFetchError(error) {
    if (error && error.name === 'HostError') {
      if (error.code === GM.REGISTRY_UNAVAILABLE) return error;
      return registryUnavailable('Registry request failed', {
        reason: error.code === GM.INSTALL_DOWNLOAD_TIMEOUT ? 'timeout' : 'network',
      });
    }
    return registryUnavailable('Registry request failed', { reason: 'network' });
  }

  async function refreshFromFile() {
    let stats;
    try {
      stats = await fs.stat(source.path);
    } catch (_error) {
      throw registryUnavailable('Registry index is not available', { reason: 'missing' });
    }
    if (!stats.isFile()) throw rejects('Registry index is not a file', { reason: 'missing' });
    if (stats.size > LIMITS.registryBytes) {
      throw rejects('Registry index exceeds the size limit', { reason: 'size' });
    }
    let bytes;
    try {
      bytes = await fs.readFile(source.path);
    } catch (_error) {
      throw registryUnavailable('Registry index cannot be read', { reason: 'io' });
    }
    if (bytes.length > LIMITS.registryBytes) {
      throw rejects('Registry index exceeds the size limit', { reason: 'size' });
    }
    const text = decodeUtf8(bytes);
    if (text === null) throw rejects('Registry index is not UTF-8 without BOM', { reason: 'encoding' });
    const parsed = parseJson(text);
    if (parsed === undefined) throw rejects('Registry index is not valid JSON', { reason: 'json' });
    const validation = validateRegistry(parsed, {
      sourceType: 'file',
      sourceUrl: source.path,
      allowedHosts,
    });
    if (!validation.ok) {
      logger?.warn?.(
        '[game-market/host] registry-invalid',
        `entries=${Array.isArray(parsed.games) ? parsed.games.length : 0}`,
        `errors=${validation.errors.length}`
      );
      throw rejects('Registry index failed validation', { reason: 'schema' });
    }
    const fetchedAt = now().toISOString();
    const nextCache = {
      schemaVersion: REGISTRY_CACHE_SCHEMA_VERSION,
      fetchedAt,
      sourceUrl: source.path,
      etag: null,
      lastModified: stats.mtime.toISOString(),
      truncated: validation.registry.truncated === true,
      games: validation.registry.games,
    };
    const changed = !cache || JSON.stringify(cache.games) !== JSON.stringify(nextCache.games);
    await persist(nextCache);
    cache = nextCache;
    return { ...nextCache, changed };
  }

  async function refreshFromRemote() {
    const headers = {};
    if (cache && typeof cache.etag === 'string') headers['if-none-match'] = cache.etag;
    if (cache && typeof cache.lastModified === 'string') headers['if-modified-since'] = cache.lastModified;
    let response;
    try {
      response = await fetchBytes(source.url, {
        fetchImpl,
        sleep,
        resolveHost,
        devMode,
        allowHttp: source.url.startsWith('http:'),
        headers,
        maxBytes: LIMITS.registryBytes,
        connectMs: TIMING.downloadConnectMs,
        idleMs: TIMING.downloadIdleMs,
        totalMs: TIMING.downloadTotalMs,
        retries,
        errorCodes: {
          rejected: GM.REGISTRY_UNAVAILABLE,
          fetch: GM.REGISTRY_UNAVAILABLE,
          timeout: GM.REGISTRY_UNAVAILABLE,
          tooLarge: GM.REGISTRY_UNAVAILABLE,
        },
      });
    } catch (error) {
      throw normaliseFetchError(error);
    }
    if (response.status === 304) {
      if (!cache) throw rejects('Registry returned 304 without a cached copy', { reason: 'not-modified' });
      const fetchedAt = now().toISOString();
      const lastModified = response.headers.get('last-modified');
      const nextCache = {
        ...cache,
        fetchedAt,
        lastModified: typeof lastModified === 'string' ? lastModified : cache.lastModified,
      };
      await persist(nextCache);
      cache = nextCache;
      return { ...nextCache, changed: false };
    }
    const text = decodeUtf8(Buffer.from(response.bytes || new Uint8Array(0)));
    if (text === null) throw rejects('Registry index is not UTF-8 without BOM', { reason: 'encoding' });
    const parsed = parseJson(text);
    if (parsed === undefined) throw rejects('Registry index is not valid JSON', { reason: 'json' });
    const validation = validateRegistry(parsed, {
      sourceType: 'https',
      sourceUrl: source.url,
      allowedHosts,
    });
    if (!validation.ok) {
      logger?.warn?.(
        '[game-market/host] registry-invalid',
        `entries=${Array.isArray(parsed.games) ? parsed.games.length : 0}`,
        `errors=${validation.errors.length}`
      );
      throw rejects('Registry index failed validation', { reason: 'schema' });
    }
    const fetchedAt = now().toISOString();
    const etag = response.headers.get('etag');
    const lastModified = response.headers.get('last-modified');
    const nextCache = {
      schemaVersion: REGISTRY_CACHE_SCHEMA_VERSION,
      fetchedAt,
      sourceUrl: source.url,
      etag: typeof etag === 'string' ? etag : null,
      lastModified: typeof lastModified === 'string' ? lastModified : null,
      truncated: validation.registry.truncated === true,
      games: validation.registry.games,
    };
    const changed = !cache || JSON.stringify(cache.games) !== JSON.stringify(nextCache.games);
    await persist(nextCache);
    cache = nextCache;
    return { ...nextCache, changed };
  }

  async function doRefresh() {
    if (!source || !sourceUrl) throw registryUnavailable('No registry source is configured');
    try {
      const result =
        source.kind === 'file' ? await refreshFromFile() : await refreshFromRemote();
      lastError = null;
      offline = false;
      // Local file registries are offline by design: their preview URLs are not
      // fetched (a dev registry must stay usable without network).
      if (source.kind === 'https') await cachePreviewAssets(result.games);
      return {
        refreshedAt: result.fetchedAt,
        count: Array.isArray(result.games) ? result.games.length : 0,
        etag: result.etag ?? null,
        source: sourceUrl,
        truncated: result.truncated === true,
        changed: result.changed !== false,
      };
    } catch (error) {
      offline = Boolean(cache);
      lastError = error && typeof error.code === 'string' ? error.code : GM.REGISTRY_UNAVAILABLE;
      throw error;
    }
  }

  /**
   * Refresh the index. Concurrent callers share one request. Manual refreshes
   * are throttled to one per 5 minutes unless `force:true` (GM-4290).
   */
  async function refresh(options = {}) {
    const manual = options.manual === true;
    const force = options.force === true;
    await ensureLoaded();
    if (refreshPromise) return refreshPromise;
    if (manual && !force) {
      const elapsed = now().getTime() - lastManualRefreshAt;
      if (lastManualRefreshAt > 0 && elapsed < REGISTRY_REFRESH_THROTTLE_MS) {
        throw hostError(GM.RATE_LIMITED, 'Registry refresh was requested too recently', {
          retryable: true,
          details: { retryAfterMs: Math.max(0, REGISTRY_REFRESH_THROTTLE_MS - elapsed) },
        });
      }
    }
    if (manual) lastManualRefreshAt = now().getTime();
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  /** Background refresh on Host start; never throws. */
  function start() {
    if (startupPromise) return startupPromise;
    startupPromise = (async () => {
      await ensureLoaded();
      const current = ttlState();
      if (current === 'fresh') return;
      try {
        await refresh({});
      } catch (error) {
        logger?.warn?.(
          '[game-market/host] registry-startup-refresh-failed',
          `code=${error?.code || 'E_UNKNOWN'}`
        );
      }
    })();
    return startupPromise;
  }

  function ready() {
    return startupPromise || start();
  }

  async function snapshot() {
    await ensureLoaded();
    return {
      state: state(),
      sourceUrl,
      fetchedAt: cache ? cache.fetchedAt : null,
      truncated: cache ? cache.truncated === true : false,
      count: games().length,
      lastError,
    };
  }

  /**
   * Resolve an install target. Missing/expired caches are refreshed once;
   * a stale (6h–14d) cache remains usable but a refresh is attempted first.
   */
  async function resolveForInstall(gameId) {
    await ensureLoaded();
    let current = ttlState();
    if (current === 'missing' || current === 'expired' || current === 'stale') {
      try {
        await refresh({});
        current = ttlState();
      } catch (_error) {
        if (current !== 'stale') {
          throw registryUnavailable('Registry is unavailable; try again later', { reason: 'offline' });
        }
      }
    }
    if (current === 'missing' || current === 'expired') {
      throw registryUnavailable('Registry is unavailable; try again later', { reason: 'offline' });
    }
    const entry = findEntry(gameId);
    if (!entry) {
      throw hostError(GM.NOT_IN_REGISTRY, 'Game is not in the registry', { retryable: false });
    }
    return entry;
  }

  async function findPreviewFile(gameId, version, file) {
    if (!GAME_ID_RE.test(String(gameId)) || !VERSION_RE.test(String(version)) || !isPreviewFile(file)) {
      return null;
    }
    const directory = storage.filePath(previewCachePath(gameId, version));
    let names;
    try {
      names = await fs.readdir(directory);
    } catch (_error) {
      return null;
    }
    for (const extension of PREVIEW_EXTENSIONS) {
      const candidate = `${file}.${extension}`;
      if (!names.includes(candidate)) continue;
      const target = path.join(directory, candidate);
      try {
        const stats = await fs.lstat(target);
        if (!stats.isFile() || stats.isSymbolicLink() || stats.size > LIMITS.previewBytes) return null;
      } catch (_error) {
        return null;
      }
      return { path: target, extension };
    }
    return null;
  }

  async function hasPreview(gameId, version, file) {
    return Boolean(await findPreviewFile(gameId, version, file));
  }

  /** Relative path inside `preview-cache/` (for `installations.json#iconPath`). */
  async function previewRelativePath(gameId, version, file) {
    const found = await findPreviewFile(gameId, version, file);
    if (!found) return null;
    return `${gameId}/${version}/${path.basename(found.path)}`;
  }

  /** Same-origin `/preview` URL for a cached asset, or null. */
  async function previewUrl(gameId, version, file) {
    if (!(await hasPreview(gameId, version, file))) return null;
    const query = new URLSearchParams({ gameId, version, file });
    return `${API_BASE}/preview?${query.toString()}`;
  }

  function cacheUrl(gameId, version, file) {
    const query = new URLSearchParams({ gameId, version, file });
    return `${API_BASE}/preview?${query.toString()}`;
  }

  /**
   * All cached preview URLs for one version with a single directory read.
   * Used by the Market list (up to 500 entries per refresh).
   */
  async function previewUrls(gameId, version) {
    const empty = { icon: null, cover: null, screenshots: [] };
    if (!GAME_ID_RE.test(String(gameId)) || !VERSION_RE.test(String(version))) return empty;
    let names;
    try {
      names = await fs.readdir(storage.filePath(previewCachePath(gameId, version)));
    } catch (_error) {
      return empty;
    }
    const available = new Set(names);
    const find = (file) => {
      for (const extension of PREVIEW_EXTENSIONS) {
        if (available.has(`${file}.${extension}`)) return cacheUrl(gameId, version, file);
      }
      return null;
    };
    const screenshots = [];
    for (let index = 1; index <= 5; index += 1) {
      const url = find(`screenshot-${index}`);
      if (!url) break;
      screenshots.push(url);
    }
    return { icon: find('icon'), cover: find('cover'), screenshots };
  }

  async function getPreview(gameId, version, file) {
    const found = await findPreviewFile(gameId, version, file);
    if (!found) return null;
    let bytes;
    try {
      bytes = await fs.readFile(found.path);
    } catch (_error) {
      return null;
    }
    if (bytes.length > LIMITS.previewBytes) return null;
    const contentType = PREVIEW_TYPES[found.extension];
    if (!contentType) return null;
    const digest = createHash('sha256').update(bytes).digest('hex');
    return {
      bytes,
      contentType,
      size: bytes.length,
      etag: `"${digest.slice(0, 32)}"`,
    };
  }

  async function ensurePreviewAsset({ gameId, version, file, url }) {
    if (!GAME_ID_RE.test(gameId) || !VERSION_RE.test(version) || !isPreviewFile(file)) return;
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_error) {
      return;
    }
    if (parsed.protocol !== 'https:') return;
    if (await hasPreview(gameId, version, file)) return;
    let response;
    try {
      response = await fetchBytes(parsed.toString(), {
        fetchImpl,
        sleep,
        resolveHost,
        devMode,
        maxBytes: LIMITS.previewBytes,
        // Preview art is non-critical: fail fast instead of holding a refresh.
        connectMs: 5000,
        idleMs: 5000,
        totalMs: 15000,
        retries: 0,
        errorCodes: {
          rejected: GM.INSTALL_URL_REJECTED,
          fetch: GM.INSTALL_DOWNLOAD_FAILED,
          timeout: GM.INSTALL_DOWNLOAD_TIMEOUT,
          tooLarge: GM.PACKAGE_TOO_LARGE,
        },
      });
    } catch (error) {
      logger?.warn?.(
        '[game-market/host] preview-cache-skipped',
        `gameId=${gameId}`,
        `code=${error?.code || 'E_UNKNOWN'}`
      );
      return;
    }
    const bytes = Buffer.from(response.bytes || new Uint8Array(0));
    if (bytes.length === 0 || bytes.length > LIMITS.previewBytes) return;
    const sniffed = sniffImageType(bytes);
    if (sniffed === null) {
      logger?.warn?.('[game-market/host] preview-cache-skipped', `gameId=${gameId}`, 'code=GM-4043');
      return;
    }
    if (!headOk(response.headers.get('content-type'), sniffed)) {
      logger?.warn?.('[game-market/host] preview-cache-skipped', `gameId=${gameId}`, 'code=GM-4043');
      return;
    }
    const extension = sniffed === 'jpeg' ? 'jpg' : sniffed;
    const directory = storage.filePath(previewCachePath(gameId, version));
    const target = path.join(directory, `${file}.${extension}`);
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o755 });
      const temporary = path.join(directory, `.${file}.${process.pid}.${Date.now()}.tmp`);
      await fs.writeFile(temporary, bytes, { mode: 0o644 });
      await fs.rename(temporary, target);
    } catch (error) {
      logger?.warn?.(
        '[game-market/host] preview-cache-write-failed',
        `gameId=${gameId}`,
        `code=${error?.code || 'E_UNKNOWN'}`
      );
    }
  }

  async function cachePreviewAssets(entries) {
    const tasks = [];
    for (const entry of entries) {
      if (!entry || !GAME_ID_RE.test(String(entry.id)) || !VERSION_RE.test(String(entry.version))) continue;
      if (typeof entry.icon === 'string') tasks.push({ gameId: entry.id, version: entry.version, file: 'icon', url: entry.icon });
      if (typeof entry.cover === 'string') tasks.push({ gameId: entry.id, version: entry.version, file: 'cover', url: entry.cover });
      if (Array.isArray(entry.screenshots)) {
        entry.screenshots.forEach((url, index) => {
          if (typeof url === 'string' && index < 5) {
            tasks.push({ gameId: entry.id, version: entry.version, file: `screenshot-${index + 1}`, url });
          }
        });
      }
    }
    if (tasks.length === 0) return;
    let cursor = 0;
    const workerCount = Math.min(4, tasks.length);
    const workers = [];
    for (let index = 0; index < workerCount; index += 1) {
      workers.push(
        (async () => {
          for (;;) {
            const task = tasks[cursor];
            cursor += 1;
            if (!task) return;
            await ensurePreviewAsset(task);
          }
        })()
      );
    }
    await Promise.all(workers);
  }

  /** Remove cached previews for versions outside the install rollback window. */
  async function prunePreviews(gameId, keepVersions) {
    if (!GAME_ID_RE.test(String(gameId))) return;
    const directory = storage.filePath(PREVIEW_CACHE_DIR, gameId);
    let versions;
    try {
      versions = await fs.readdir(directory, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    const keep = new Set(keepVersions);
    for (const entry of versions) {
      if (!entry.isDirectory() || keep.has(entry.name)) continue;
      await fs.rm(path.join(directory, entry.name), { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Test/diagnostics hook. */
  function peek() {
    return { cache, loaded, lastError, offline, source, sourceUrl };
  }

  return {
    source,
    sourceUrl,
    allowedHosts,
    start,
    ready,
    refresh,
    snapshot,
    state,
    games,
    findEntry,
    resolveForInstall,
    getPreview,
    hasPreview,
    previewUrl,
    previewUrls,
    previewRelativePath,
    prunePreviews,
    peek,
    cacheFilePath,
  };
}
