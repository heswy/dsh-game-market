/**
 * Layered Registry source (V1.2 community publishing + V1.5 two generations).
 *
 * Default (no explicit configuration), in priority order:
 *   1. official Registry v2  `/registry/v2/games.json`  (V1.5 default, §5.2)
 *   2. official Registry v1  `/registry/games.json`     (migration fallback while
 *      the content repository has not regenerated the v2 projection yet)
 *   3. bundled file seed on cold-start when neither remote is usable.
 *
 * The two official generations have **separate services and separate cache
 * files** (`registry-cache-v2.json` / `registry-cache.json`), so a v1 cache is
 * never accepted as a v2 snapshot and vice versa (§5.3). The authoritative
 * remote snapshot is never merged with the seed: a fresh or stale remote cache
 * keeps the remote as the only source; the bundled seed is used only when no
 * remote generation has a usable snapshot. Explicit `DSH_GAME_REGISTRY_URL` or
 * `config.registry.url` keeps the existing single-source behavior and is
 * handled by `createRegistryService` directly (no fallback).
 */
import { DEFAULT_OFFICIAL_REGISTRY_V2_URL } from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
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

/** Layered default: v2 first, then the v1 index, then the bundled seed. */
export function createLayeredRegistryService({ storage, settings, logger, now, http = {} }) {
  const registrySettings = settings.registry || {};
  const officialV2Url = registrySettings.officialV2Url || DEFAULT_OFFICIAL_REGISTRY_V2_URL;
  const officialV1Url = registrySettings.officialUrl;
  const seedSource = registrySettings.seedSource;

  const officialV2 = createRegistryService({
    storage,
    settings: singleSettings(
      settings,
      { kind: 'https', url: officialV2Url, origin: new URL(officialV2Url).origin },
      { cacheFile: undefined, persistCache: true, protocol: 'v2' }
    ),
    logger,
    now,
    http,
  });
  const officialV1 = createRegistryService({
    storage,
    settings: singleSettings(
      settings,
      { kind: 'https', url: officialV1Url, origin: new URL(officialV1Url).origin },
      { cacheFile: undefined, persistCache: true, protocol: 'v1' }
    ),
    logger,
    now,
    http,
  });
  const seed = createRegistryService({
    storage,
    settings: singleSettings(settings, seedSource, {
      cacheFile: 'seed-registry-cache.json',
      persistCache: false,
      protocol: 'v1',
    }),
    logger,
    now,
    http: { ...http, retries: 0 },
  });

  /** `'official' | 'seed'` — the public source class (V1 health shape). */
  let active = 'seed';
  /** `'v2' | 'v1' | null` — which official generation is authoritative. */
  let activeGeneration = null;
  let startupPromise = null;
  let seedStartPromise = null;

  function ensureSeedStarted() {
    if (!seedStartPromise) seedStartPromise = seed.start();
    return seedStartPromise;
  }

  function installedService(generation) {
    return generation === 'v2' ? officialV2 : officialV1;
  }

  function delegate() {
    if (active === 'official' && activeGeneration) return installedService(activeGeneration);
    return seed;
  }

  /**
   * A successfully loaded official snapshot is authoritative even when it is
   * empty: an empty index is how maintainers withdraw every game. The seed is
   * only chosen when neither remote generation could be loaded/validated at all.
   * v2 wins over v1 when both are loaded (§5.2 default generation).
   */
  function officialLoaded(service) {
    if (!service || typeof service.isLoaded !== 'function' || !service.isLoaded()) return false;
    const state = service.state();
    return state === 'fresh' || state === 'stale' || state === 'offline';
  }

  function chooseSource() {
    if (officialLoaded(officialV2)) {
      active = 'official';
      activeGeneration = 'v2';
      return;
    }
    if (officialLoaded(officialV1)) {
      active = 'official';
      activeGeneration = 'v1';
      return;
    }
    active = 'seed';
    activeGeneration = null;
  }

  function preferOfficial() {
    return installedService(activeGeneration || 'v2');
  }

  /**
   * Startup is local-first: load the bundled seed immediately, then refresh both
   * official generations in the background. `ready()` must not block on hanging
   * remote requests; callers get usable seed content right away. The v2 index is
   * the default; the v1 index is only a migration fallback for content
   * repositories that have not generated the v2 projection yet.
   */
  function start() {
    if (startupPromise) return startupPromise;
    startupPromise = (async () => {
      await seed.start().catch(() => undefined);
      chooseSource();
      // Both official generations are started in parallel so a hanging v2
      // request can never delay the v1 fallback (and vice versa). Each service
      // resolves when its own cache/refresh settles; neither throws.
      const officialStart = Promise.all([
        officialV2.start(),
        officialV1.start(),
      ]).then(() => {
        chooseSource();
        return delegate().snapshot().catch(() => null);
      }).catch(() => undefined);
      let timer;
      const settle = new Promise((resolve) => { timer = setTimeout(resolve, 250); });
      try {
        await Promise.race([officialStart, settle]);
      } finally {
        clearTimeout(timer);
      }
      chooseSource();
      // A late official settle still flips the active source as soon as it
      // lands, so callers that only awaited `ready()` observe it shortly after.
      officialStart.then(() => chooseSource()).catch(() => undefined);
    })();
    return startupPromise;
  }

  function ready() {
    return startupPromise || start();
  }

  async function ensureActive() {
    await ready();
    chooseSource();
    if (active === 'seed') await ensureSeedStarted();
  }

  /** Resolve once the bundled seed is loaded; never waits for the remote. */
  async function localReady() {
    await ensureSeedStarted();
  }

  async function refresh(options = {}) {
    await ready();
    let primaryError = null;
    // v2 is the default generation; a network/validation failure falls through
    // to the v1 index. Throttling is a user-facing semantic, not a source
    // failure, so it propagates immediately instead of trying the next source.
    try {
      const result = await officialV2.refresh(options);
      active = 'official';
      activeGeneration = 'v2';
      return { ...result, activeSource: 'official', generation: 'v2', fallback: false };
    } catch (error) {
      if (error && error.code === GM.RATE_LIMITED) throw error;
      primaryError = error;
    }
    try {
      const result = await officialV1.refresh(options);
      active = 'official';
      activeGeneration = 'v1';
      return { ...result, activeSource: 'official', generation: 'v1', fallback: false };
    } catch (error) {
      if (error && error.code === GM.RATE_LIMITED) throw error;
      // Keep a usable official cache/snapshot if one exists; otherwise expose seed.
      if (officialLoaded(officialV2)) {
        active = 'official';
        activeGeneration = 'v2';
        throw primaryError;
      }
      if (officialLoaded(officialV1)) {
        active = 'official';
        activeGeneration = 'v1';
        throw error;
      }
      await ensureSeedStarted();
      active = 'seed';
      activeGeneration = null;
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
          generation: 'v1',
          fallback: true,
          lastError: error && error.code ? error.code : 'GM-5032',
        };
      }
      throw error;
    }
  }

  async function snapshot() {
    await ready();
    // The background official refreshes may have completed after startup; prefer
    // a valid v2 snapshot, then a valid v1 snapshot, once they are available.
    chooseSource();
    const base = await delegate().snapshot();
    const officialV2Snap = await officialV2.snapshot().catch(() => null);
    const officialV1Snap = await officialV1.snapshot().catch(() => null);
    const seedSnap = await seed.snapshot().catch(() => null);
    const activeOfficial =
      active === 'official' && activeGeneration
        ? activeGeneration === 'v2'
          ? officialV2Snap
          : officialV1Snap
        : officialV2Snap || officialV1Snap;
    return {
      ...base,
      state: active === 'seed' ? 'seed' : base.state,
      activeSource: active,
      fallback: active === 'seed',
      generation: active === 'seed' ? null : activeGeneration,
      official: activeOfficial,
      officialV2: officialV2Snap,
      officialV1: officialV1Snap,
      seed: {
        state: seedSnap ? seedSnap.state : 'missing',
        count: seed.games().length,
        sourceUrl: seedSnap ? seedSnap.sourceUrl : null,
      },
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
    await Promise.all([
      officialV2.prunePreviews(gameId, keepVersions),
      officialV1.prunePreviews(gameId, keepVersions),
    ]);
  }

  function peek() {
    return {
      activeSource: active,
      generation: activeGeneration,
      official: preferOfficial().peek(),
      officialV2: officialV2.peek(),
      officialV1: officialV1.peek(),
      seed: seed.peek(),
    };
  }

  function cacheFilePath() {
    return (activeGeneration === 'v1' ? officialV1 : officialV2).cacheFilePath();
  }

  /** Loaded/settled generation of the active source: `'v1' | 'v2' | null`. */
  function generation() {
    return active === 'official' ? activeGeneration : null;
  }

  return {
    get source() { return delegate().source; },
    get sourceUrl() { return delegate().sourceUrl; },
    get allowedHosts() { return delegate().allowedHosts; },
    start,
    ready,
    localReady,
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
    generation,
    /** Explicitly expose both official services for diagnostics/tests. */
    officialV2,
    officialV1,
    seed,
  };
}
