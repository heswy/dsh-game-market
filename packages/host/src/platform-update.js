/**
 * Official platform update discovery (docs/V1.5-CONTRACTS.md §9,
 * m3-decisions §2–§3).
 *
 * One fixed HTTPS index URL, one in-flight check, strict format-1 validation and
 * target binding, an atomic JSON cache that always keeps the last successful
 * target, and an honest discovery state (never/checking/ready/stale/offline/
 * invalid). Discovery failures are *data*, never a thrown Host failure and never
 * a game/market blocker: GET /platform-update always answers 200.
 *
 * Production transport is the global `fetch` wired by `plugin.js`. A code-level
 * transport seam (`http.platformUpdateFetch` + `http.platformUpdateResolveHost`
 * + `http.platformUpdateTiming`) exists for unit tests and isolated probes only;
 * it is not a product configuration surface and cannot change the index URL.
 */

import { GM } from '../../shared/src/errors.js';
import {
  PLATFORM_UPDATE_CACHE_FILE,
  PLATFORM_UPDATE_DEFAULT_CHANNEL,
  PLATFORM_UPDATE_INDEX_MAX_BYTES,
  PLATFORM_UPDATE_INDEX_URL,
  PLATFORM_UPDATE_REASON_KEYS,
  PLATFORM_UPDATE_SCHEMA_VERSION,
  PLATFORM_UPDATE_TIMING,
  detectUpdateTargetAnomaly,
  isUpdateTargetId,
  normaliseUpdateChannel,
  parsePluginMarketIndex,
  selectOfficialUpdateTarget,
} from '../../shared/src/platform-update.js';
import { BUNDLE_ID } from '../../shared/src/constants.js';
import { fetchBytes } from './download.js';
import { hostError } from './errors.js';
import { sha256Hex } from './ids.js';

const LOG = '[game-market/host]';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isoOrNull(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function sanitisedTarget(value) {
  if (!isPlainObject(value)) return null;
  if (typeof value.id !== 'string' || !isUpdateTargetId(value.id)) return null;
  if (typeof value.version !== 'string' || typeof value.commit !== 'string') return null;
  if (typeof value.spec !== 'string' || !/^[0-9a-f]{40}$/.test(value.commit)) return null;
  return {
    id: value.id,
    version: value.version,
    commit: value.commit,
    channel: value.channel === 'test' ? 'test' : 'stable',
    publishedAt: isoOrNull(value.publishedAt),
    spec: value.spec,
  };
}

function sanitisedCache(value, indexUrl) {
  if (!isPlainObject(value) || value.schemaVersion !== PLATFORM_UPDATE_SCHEMA_VERSION) return null;
  if (value.indexUrl !== indexUrl) return null;
  const target = sanitisedTarget(value.target);
  if (value.target !== null && target === null) return null;
  return {
    schemaVersion: PLATFORM_UPDATE_SCHEMA_VERSION,
    indexUrl,
    indexHash: typeof value.indexHash === 'string' ? value.indexHash : null,
    channel: normaliseUpdateChannel(value.channel) || PLATFORM_UPDATE_DEFAULT_CHANNEL,
    fetchedAt: isoOrNull(value.fetchedAt),
    checkedAt: isoOrNull(value.checkedAt),
    target,
    previousTarget: sanitisedTarget(value.previousTarget),
  };
}

/**
 * Pure capability decision (contract §9.2/§9.5, m3-decisions §2). Exported so
 * the branch matrix is unit-testable without a live plugin manager; the Host
 * calls it with the adapter's current probe result.
 *
 * @param {{
 *   adapter: {available?:boolean, hmr?:string, reasonKey?:string|null},
 *   devRowShadow?: boolean,
 *   hasTarget: boolean,
 *   hasAnomaly: boolean,
 * }} context
 * @returns {{hmr:'present'|'absent'|'unknown', updatePath:string, canBeginUpdate:boolean, reasonKey:string|null}}
 */
export function deriveUpdateCapability({ adapter, devRowShadow = false, hasTarget, hasAnomaly }) {
  const source = isPlainObject(adapter) ? adapter : {};
  const hmr = source.hmr === 'present' || source.hmr === 'absent' ? source.hmr : 'unknown';
  let updatePath = 'unsupported';
  let canBeginUpdate = false;
  let reasonKey = null;
  if (source.available !== true) {
    reasonKey = PLATFORM_UPDATE_REASON_KEYS.ADAPTER_UNAVAILABLE;
  } else if (devRowShadow === true) {
    updatePath = hmr === 'present' ? 'in-place-hmr' : hmr === 'absent' ? 'restart-required' : 'unsupported';
    reasonKey = PLATFORM_UPDATE_REASON_KEYS.DEV_SOURCE;
  } else if (hmr === 'unknown') {
    reasonKey = PLATFORM_UPDATE_REASON_KEYS.HMR_UNKNOWN;
  } else {
    updatePath = hmr === 'present' ? 'in-place-hmr' : 'restart-required';
    if (hasTarget !== true) reasonKey = PLATFORM_UPDATE_REASON_KEYS.NO_TARGET;
    else if (hasAnomaly === true) reasonKey = PLATFORM_UPDATE_REASON_KEYS.VERSION_COMMIT_ANOMALY;
    else canBeginUpdate = true;
  }
  return { hmr, updatePath, canBeginUpdate, reasonKey: reasonKey ?? (typeof source.reasonKey === 'string' ? source.reasonKey : null) };
}

/**
 * @param {{
 *   storage: object,
 *   settings?: object,
 *   logger?: object,
 *   now?: () => Date,
 *   http?: object,
 *   identity?: object|null,
 *   getAdapterInfo?: (() => Promise<object>)|null,
 *   getOperation?: (() => object|null)|null,
 * }} options
 */
export function createPlatformUpdateService({
  storage,
  settings = {},
  logger = null,
  now = () => new Date(),
  http = {},
  identity = null,
  getAdapterInfo = null,
  getOperation = null,
  hostEpoch = null,
}) {
  const platformSettings = isPlainObject(settings.platformUpdate) ? settings.platformUpdate : {};
  const channel = normaliseUpdateChannel(platformSettings.channel) || PLATFORM_UPDATE_DEFAULT_CHANNEL;
  const startupCheckEnabled = platformSettings.startupCheck !== false;
  const indexUrl = PLATFORM_UPDATE_INDEX_URL;
  const timing = { ...PLATFORM_UPDATE_TIMING, ...(isPlainObject(http.platformUpdateTiming) ? http.platformUpdateTiming : {}) };
  const fetchImpl = typeof http.platformUpdateFetch === 'function' ? http.platformUpdateFetch : null;
  const resolveHost =
    typeof http.platformUpdateResolveHost === 'function'
      ? http.platformUpdateResolveHost
      : typeof http.resolveHost === 'function'
        ? http.resolveHost
        : null;

  let cache = null;
  let cacheLoaded = false;
  let cacheReady = null;
  let autoCheck = null;
  let inflight = null;
  let checking = false;
  let lastAttemptCompletedAtMs = null;
  let lastAttemptOk = null;
  /** `{kind:'network'|'invalid'|'unavailable', reason:string, at:string}` */
  let lastFailure = null;

  function nowMs() {
    return now().getTime();
  }

  function cacheFilePath() {
    return storage.filePath(PLATFORM_UPDATE_CACHE_FILE);
  }

  function currentTarget() {
    return cache === null ? null : cache.target;
  }

  function previousTarget() {
    return cache === null ? null : cache.previousTarget;
  }

  function manualRefreshAllowedMs() {
    if (lastAttemptCompletedAtMs === null) return 0;
    return lastAttemptCompletedAtMs + timing.manualRefreshThrottleMs;
  }

  function autoNextCheckMs() {
    if (lastAttemptCompletedAtMs === null) return nowMs();
    const backoff =
      lastFailure !== null && lastFailure.kind !== 'unavailable'
        ? timing.failureRetryMs
        : timing.startupCheckMs;
    return lastAttemptCompletedAtMs + backoff;
  }

  /** Discovery fields exactly as frozen in m3-decisions §2. */
  function snapshot({ installedVersion = null, installedCommit = null } = {}) {
    const stamp = nowMs();
    let state;
    if (checking || inflight !== null) state = 'checking';
    else if (lastFailure !== null && lastFailure.kind === 'network') state = 'offline';
    else if (lastFailure !== null && (lastFailure.kind === 'invalid' || lastFailure.kind === 'unavailable')) state = 'invalid';
    else if (cache !== null) state = stamp - (Date.parse(cache.checkedAt || cache.fetchedAt) || stamp) >= timing.startupCheckMs ? 'stale' : 'ready';
    else state = 'never';
    const refreshAt = manualRefreshAllowedMs();
    const canRefresh = refreshAt <= stamp && inflight === null;
    const nextMs = canRefresh ? autoNextCheckMs() : refreshAt;
    const target = currentTarget();
    const anomaly = detectUpdateTargetAnomaly({
      target,
      previousTarget: previousTarget(),
      installedVersion,
      installedCommit,
    });
    return {
      channel,
      indexUrl,
      state,
      fetchedAt: cache?.fetchedAt ?? null,
      checkedAt: cache?.checkedAt ?? (lastAttemptCompletedAtMs === null ? null : new Date(lastAttemptCompletedAtMs).toISOString()),
      nextCheckAt: new Date(Math.max(stamp, nextMs)).toISOString(),
      lastError:
        lastFailure === null
          ? null
          : {
              code: GM.UPDATE_INDEX_UNAVAILABLE,
              message: lastFailure.message,
              retryable: lastFailure.kind !== 'invalid',
              at: lastFailure.at,
              reason: lastFailure.reason,
            },
      canRefresh,
      anomaly,
    };
  }

  function diskFailure(kind, reason, message) {
    lastFailure = { kind, reason, message, retryable: kind !== 'invalid', at: now().toISOString() };
  }

  async function loadCache() {
    try {
      const stored = await storage.readJson(cacheFilePath(), { schemaVersion: PLATFORM_UPDATE_SCHEMA_VERSION });
      if (stored !== null) {
        const parsed = sanitisedCache(stored.value, indexUrl);
        if (parsed !== null) {
          cache = parsed;
          lastAttemptCompletedAtMs = parsed.checkedAt === null ? null : Date.parse(parsed.checkedAt);
        }
      }
    } catch (error) {
      logger?.warn?.(LOG, 'platform-update-cache-unreadable', `code=${error?.code || 'E_UNKNOWN'}`);
    } finally {
      cacheLoaded = true;
    }
  }

  async function persistCache(next) {
    try {
      await storage.writeJson(cacheFilePath(), next);
    } catch (error) {
      // Keep the in-memory cache; the discovery result must never be lost to an
      // unwritable storage root (and must never block game/market routes).
      logger?.warn?.(LOG, 'platform-update-cache-write-failed', `code=${error?.code || 'E_UNKNOWN'}`);
    }
  }

  async function fetchIndexRaw() {
    if (fetchImpl === null) {
      throw hostError(GM.UPDATE_INDEX_UNAVAILABLE, 'Update index transport is unavailable', {
        retryable: true,
        details: { reason: 'transport-unavailable' },
      });
    }
    return fetchBytes(indexUrl, {
      fetchImpl,
      ...(resolveHost === null ? {} : { resolveHost }),
      maxBytes: PLATFORM_UPDATE_INDEX_MAX_BYTES,
      maxRedirects: timing.maxRedirects,
      connectMs: timing.indexConnectMs,
      totalMs: timing.indexTotalMs,
      idleMs: timing.indexIdleMs,
      headers: { accept: 'application/json' },
    });
  }

  function classifyFetchFailure(error) {
    const code = error !== null && typeof error === 'object' ? error.code : null;
    if (code === GM.UPDATE_INDEX_UNAVAILABLE) {
      const reason = error?.details?.reason;
      if (reason === 'transport-unavailable') {
        return { kind: 'unavailable', reason: 'transport-unavailable', message: 'Update index transport is unavailable', retryable: true };
      }
      return { kind: 'network', reason: 'network', message: 'Update index is unreachable', retryable: true };
    }
    if (code === GM.INSTALL_DOWNLOAD_TIMEOUT) {
      return { kind: 'network', reason: 'timeout', message: 'Update index check timed out', retryable: true };
    }
    if (code === GM.PACKAGE_TOO_LARGE) {
      return { kind: 'invalid', reason: 'too-large', message: 'Update index is larger than the allowed size', retryable: false };
    }
    if (code === GM.INSTALL_URL_REJECTED) {
      return { kind: 'invalid', reason: 'redirect', message: 'Update index redirect was rejected', retryable: false };
    }
    if (code === GM.INVALID_JSON) {
      return { kind: 'invalid', reason: 'json', message: 'Update index is not valid JSON', retryable: false };
    }
    return { kind: 'network', reason: 'network', message: 'Update index is unreachable', retryable: true };
  }

  function parseIndexBytes(bytes) {
    let text;
    try {
      text = Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(0)).toString('utf8');
    } catch (_error) {
      return { ok: false, reason: 'decoding' };
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (_error) {
      return { ok: false, reason: 'json' };
    }
  }

  async function performCheck() {
    const result = await fetchIndexRaw();
    const raw = result.bytes instanceof Uint8Array ? result.bytes : new Uint8Array(result.bytes || []);
    if (raw.length > PLATFORM_UPDATE_INDEX_MAX_BYTES) {
      return { ok: false, kind: 'invalid', reason: 'too-large', message: 'Update index is larger than the allowed size' };
    }
    const parsed = parseIndexBytes(raw);
    if (!parsed.ok) {
      return { ok: false, kind: 'invalid', reason: parsed.reason, message: 'Update index is not valid JSON' };
    }
    const validated = parsePluginMarketIndex(parsed.value, { indexUrl });
    if (!validated.ok) {
      return {
        ok: false,
        kind: 'invalid',
        reason: 'format',
        message: 'Update index does not match format 1',
      };
    }
    const selection = selectOfficialUpdateTarget(validated.value, { channel });
    if (!selection.ok) {
      return {
        ok: false,
        kind: 'invalid',
        reason: selection.code === 'E_UPDATE_TARGET_INVALID' ? 'channel' : 'binding',
        message:
          selection.code === 'E_UPDATE_TARGET_INVALID'
            ? 'Update channel is not supported'
            : 'Update index is not bound to the official repository',
      };
    }
    return {
      ok: true,
      target: selection.target,
      indexHash: sha256Hex(raw),
      bytes: raw.length,
    };
  }

  function runCheck() {
    if (inflight !== null) return inflight;
    checking = true;
    const startedAt = now().toISOString();
    inflight = (async () => {
      let outcome;
      try {
        outcome = await performCheck();
      } catch (error) {
        outcome = { ok: false, ...classifyFetchFailure(error) };
      }
      lastAttemptCompletedAtMs = nowMs();
      if (outcome.ok) {
        lastFailure = null;
        lastAttemptOk = true;
        const previous = cache === null ? null : cache.target;
        const unchangedPrevious =
          previous !== null && outcome.target !== null && previous.version === outcome.target.version && previous.commit === outcome.target.commit;
        const fetchedAt = startedAt;
        const next = {
          schemaVersion: PLATFORM_UPDATE_SCHEMA_VERSION,
          indexUrl,
          indexHash: outcome.indexHash,
          channel,
          fetchedAt,
          checkedAt: new Date(lastAttemptCompletedAtMs).toISOString(),
          target: outcome.target,
          // Only a *different* previous pin is retained for anomaly detection.
          previousTarget: unchangedPrevious ? (cache?.previousTarget ?? null) : previous,
        };
        cache = next;
        await persistCache(next);
        logger?.info?.(LOG, 'platform-update-checked', `target=${outcome.target === null ? 'none' : outcome.target.version}`, `bytes=${outcome.bytes}`);
      } else {
        lastAttemptOk = false;
        diskFailure(outcome.kind === 'invalid' ? 'invalid' : 'network', outcome.reason || 'network', outcome.message || 'Update index check failed');
        logger?.warn?.(LOG, 'platform-update-check-failed', `reason=${lastFailure.reason}`);
      }
      return { ok: outcome.ok === true, target: outcome.ok === true ? outcome.target : null };
    })().finally(() => {
      checking = false;
      inflight = null;
    });
    return inflight;
  }

  /** Manual refresh (POST /platform-update/refresh): throttle returns `throttled`, never an error. */
  async function refresh() {
    await cacheReady.catch(() => undefined);
    if (inflight !== null) {
      const settled = await inflight.catch(() => ({ ok: false }));
      return { refreshed: settled?.ok === true, throttled: false, discovery: snapshot() };
    }
    const stamp = nowMs();
    if (manualRefreshAllowedMs() > stamp) {
      return { refreshed: false, throttled: true, discovery: snapshot() };
    }
    const settled = await runCheck().catch(() => ({ ok: false }));
    return { refreshed: settled?.ok === true, throttled: false, discovery: snapshot() };
  }

  async function start() {
    if (cacheReady === null) cacheReady = loadCache();
    await cacheReady.catch(() => undefined);
    if (!startupCheckEnabled) return;
    const stamp = nowMs();
    const due = lastAttemptCompletedAtMs === null || stamp - lastAttemptCompletedAtMs >= timing.startupCheckMs;
    if (!due) return;
    // Silent: never awaited by activation, never allowed to reject.
    autoCheck = runCheck().catch(() => undefined);
  }

  /** Wait only for the cache load (never for the silent startup network check). */
  async function whenReady() {
    if (cacheReady === null) cacheReady = loadCache();
    await cacheReady.catch(() => undefined);
  }

  async function ready() {
    await whenReady();
    if (autoCheck !== null) await autoCheck.catch(() => undefined);
  }

  async function stop() {
    if (inflight === null) return;
    await Promise.race([inflight.catch(() => undefined), new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      if (typeof timer.unref === 'function') timer.unref();
    })]);
  }

  async function adapterInfo() {
    const defaults = {
      available: false,
      hmr: 'unknown',
      enabled: null,
      diskVersion: null,
      devRowShadow: false,
      reasonKey: PLATFORM_UPDATE_REASON_KEYS.ADAPTER_UNAVAILABLE,
    };
    if (typeof getAdapterInfo !== 'function') return defaults;
    try {
      const info = await getAdapterInfo();
      return { ...defaults, ...(isPlainObject(info) ? info : {}) };
    } catch (error) {
      logger?.warn?.(LOG, 'platform-update-adapter-inspect-failed', `code=${error?.code || 'E_UNKNOWN'}`);
      return defaults;
    }
  }

  function capabilityFor(context) {
    return deriveUpdateCapability(context);
  }

  /** Full GET /platform-update payload (frozen shape; always 200). */
  async function inspect() {
    if (cacheReady === null) cacheReady = loadCache();
    await cacheReady.catch(() => undefined);
    const adapter = await adapterInfo();
    const base = identity === null ? null : identity.snapshot();
    const installed = {
      bundleId: BUNDLE_ID,
      spec: base === null ? null : base.spec,
      specShape: base === null ? 'unknown' : base.specShape,
      version: adapter.diskVersion !== null && adapter.diskVersion !== undefined ? adapter.diskVersion : base === null ? null : base.version,
      enabled: adapter.enabled === undefined ? null : adapter.enabled,
      loadedVersion: identity === null ? null : identity.loadedVersion,
      loadedCommit: identity === null ? null : identity.buildCommit,
      devRowShadow: adapter.devRowShadow === true || (base !== null && base.devRowShadow === true),
    };
    const installedCommitForAnomaly = base === null ? null : base.specCommit;
    const discovery = snapshot({
      installedVersion: installed.version,
      installedCommit: installedCommitForAnomaly,
    });
    const capability = deriveUpdateCapability({
      adapter,
      devRowShadow: installed.devRowShadow,
      hasTarget: currentTarget() !== null,
      hasAnomaly: discovery.anomaly !== null,
    });
    return {
      schemaVersion: PLATFORM_UPDATE_SCHEMA_VERSION,
      host: {
        version: identity === null ? null : identity.loadedVersion,
        commit: identity === null ? null : identity.buildCommit,
        hostEpoch,
        loadedAt: identity === null ? null : identity.loadedAt,
      },
      installed,
      target: currentTarget(),
      discovery,
      capability,
      operation: typeof getOperation === 'function' ? getOperation() ?? null : null,
    };
  }

  /** Resolve a caller-supplied targetId against the current validated record. */
  function resolveTarget(targetId) {
    const target = currentTarget();
    if (target === null) return null;
    if (typeof targetId !== 'string' || !isUpdateTargetId(targetId)) return null;
    return target.id === targetId ? target : null;
  }

  return {
    start,
    ready,
    whenReady,
    stop,
    refresh,
    inspect,
    snapshot,
    resolveTarget,
    currentTarget,
    previousTarget,
    manualRefreshAllowedMs,
    get channel() {
      return channel;
    },
    get indexUrl() {
      return indexUrl;
    },
    get lastFailure() {
      return lastFailure;
    },
  };
}
