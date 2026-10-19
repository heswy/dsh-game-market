/**
 * Layered Registry source (V1.2 community publishing).
 *
 * Default (no explicit configuration):
 *   official HTTPS `registry/games.json`  ->  bundled file seed on cold-start
 *   network/invalid-index failure.
 *
 * The authoritative remote snapshot is never merged with the seed. A fresh or
 * stale remote cache keeps the remote as the only source; the bundled seed is
 * used only when the remote has no usable snapshot. Explicit `DSH_GAME_REGISTRY_URL`
 * or `config.registry.url` keeps the existing single-source behavior and is
 * handled by `createRegistryService` directly (no fallback).
 */
import { createRegistryService } from './registry.js';

function singleSettings(settings, source, extra) {
  const registry = settings.registry || {};
  return {
    ...settings,
    registry: {
      ...registry,
      source,
      sourceUrl: source.kind === 'file' ? source.path : source.url,
      allowLocalFile: true,
      ...extra,
    },
  };
}

export function createLayeredRegistryService({ storage, settings, logger, now, http = {} }) {
  const registrySettings = settings.registry || {};
  const officialSource = { kind: 'https', url: registrySettings.officialUrl, origin: new URL(registrySettings.officialUrl).origin };
  const seedSource = registrySettings.seedSource;
  const official = createRegistryService({
    storage,
    settings: singleSettings(settings, officialSource, { cacheFile: 'registry-cache.json', persistCache: true }),
    logger,
    now,
    http,
  });
  const seed = createRegistryService({
    storage,
    settings: singleSettings(settings, seedSource, { cacheFile: 'seed-registry-cache.json', persistCache: false }),
    logger,
    now,
    http: { ...http, retries: 0 },
  });

  let active = 'seed';
  let startupPromise = null;
  let seedStartPromise = null;

  function ensureSeedStarted() {
    if (!seedStartPromise) seedStartPromise = seed.start();
    return seedStartPromise;
  }

  function delegate() {
    return active === 'official' ? official : seed;
  }

  async function chooseSource() {
    const snap = await official.snapshot().catch(() => null);
    const officialGames = official.games();
    const usableRemote = Array.isArray(officialGames) && officialGames.length > 0 &&
      snap && (snap.state === 'fresh' || snap.state === 'stale' || snap.state === 'offline');
    if (usableRemote) {
      active = 'official';
      return;
    }
    active = 'seed';
    await ensureSeedStarted();
  }

  function start() {
    if (startupPromise) return startupPromise;
    startupPromise = (async () => {
      await seed.start().catch(() => undefined);
      await official.start().catch(() => undefined);
      await chooseSource();
    })();
    return startupPromise;
  }

  function ready() {
    return startupPromise || start();
  }

  async function ensureActive() {
    await ready();
    if (active === 'seed') await ensureSeedStarted();
  }

  async function refresh(options = {}) {
    await ready();
    try {
      const result = await official.refresh(options);
      if (official.games().length > 0) {
        active = 'official';
        return { ...result, activeSource: 'official', fallback: false };
      }
      throw Object.assign(new Error('Official registry returned no games'), { code: 'GM-5032' });
    } catch (error) {
      // Keep a usable remote cache if one exists; otherwise expose the seed.
      const officialGames = official.games();
      if (officialGames.length > 0) {
        active = 'official';
        throw error;
      }
      await ensureSeedStarted();
      active = 'seed';
      const snap = await seed.snapshot().catch(() => null);
      if (snap && seed.games().length > 0) {
        return {
          refreshedAt: snap.fetchedAt,
          count: seed.games().length,
          etag: null,
          source: snap.sourceUrl,
          truncated: false,
          changed: false,
          activeSource: 'seed',
          fallback: true,
          lastError: error && error.code ? error.code : 'GM-5032',
        };
      }
      throw error;
    }
  }

  async function snapshot() {
    await ready();
    const base = await delegate().snapshot();
    const officialSnap = await official.snapshot().catch(() => null);
    const seedSnap = await seed.snapshot().catch(() => null);
    return {
      ...base,
      state: active === 'seed' ? 'seed' : base.state,
      activeSource: active,
      fallback: active === 'seed',
      official: officialSnap,
      seed: { state: seedSnap ? seedSnap.state : 'missing', count: seed.games().length, sourceUrl: seedSnap ? seedSnap.sourceUrl : null },
    };
  }

  function state() {
    if (active === 'seed') return 'seed';
    return delegate().state();
  }

  function games() {
    return delegate().games();
  }

  function findEntry(gameId) {
    return delegate().findEntry(gameId);
  }

  async function resolveForInstall(gameId) {
    await ensureActive();
    return delegate().resolveForInstall(gameId);
  }

  async function getPreview(gameId, version, file) {
    await ensureActive();
    return delegate().getPreview(gameId, version, file);
  }

  async function hasPreview(gameId, version, file) {
    await ensureActive();
    return delegate().hasPreview(gameId, version, file);
  }

  async function previewUrl(gameId, version, file) {
    await ensureActive();
    return delegate().previewUrl(gameId, version, file);
  }

  async function previewUrls(gameId, version) {
    await ensureActive();
    return delegate().previewUrls(gameId, version);
  }

  async function previewRelativePath(gameId, version, file) {
    await ensureActive();
    return delegate().previewRelativePath(gameId, version, file);
  }

  async function prunePreviews(gameId, keepVersions) {
    await official.prunePreviews(gameId, keepVersions);
  }

  function peek() {
    return {
      activeSource: active,
      official: official.peek(),
      seed: seed.peek(),
    };
  }

  function cacheFilePath() {
    return official.cacheFilePath();
  }

  return {
    get source() { return delegate().source; },
    get sourceUrl() { return delegate().sourceUrl; },
    get allowedHosts() { return delegate().allowedHosts; },
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
