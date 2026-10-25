/**
 * Game Runtime controller (PRD §8.4 / §9.6; V1.5 resource-wrapper §7.5.1).
 *
 * Owns the game iframe — and, for V1.5 asset-zip-v2 packages, the trusted
 * platform wrapper iframe that hosts it — plus the bridge, the autosave
 * scheduler and the page state machine. The DOM layer is deliberately thin:
 * tests inject a fake `window` / `document` / clock into this same controller.
 *
 * Security invariants:
 *   - one game iframe. V1 html-v1: the Runtime's single iframe is
 *     `sandbox="allow-scripts"` (never allow-same-origin). V1.5 asset-zip-v2:
 *     the Runtime's outer iframe is the **trusted platform wrapper** on the
 *     resource origin and is deliberately NOT sandboxed (a sandboxed,
 *     opaque-origin ancestor can never satisfy the game document's
 *     `frame-ancestors` ancestor-chain check — measured, Lead decision
 *     2026-10-20); the wrapper itself creates the **sandboxed opaque game
 *     iframe**. `allow-same-origin` is never granted anywhere;
 *   - no game data is placed in host DOM attributes;
 *   - the game never receives DSH objects, paths or credentials;
 *   - V1.5: the iframe points at the platform-served **wrapper** on the
 *     resource origin, which embeds the sandboxed game document. The wrapper
 *     relays `postMessage` traffic point-to-point, so the only window allowed
 *     to speak the bridge protocol is the wrapper iframe's own window proxy.
 *   - If the wrapper URL is missing/foreign (origin mismatch) the Runtime fails
 *     closed with a real error; it never falls back to embedding the game
 *     document directly, because that would drop the navigation boundary.
 *
 * Credential model (contract §7.2): the first navigation uses the one-shot
 * `entryUrl`; every later navigation (reload/retry/iframe rebuild) uses the
 * instance-bound `entryResourceUrl`. A consumed launch URL is remembered at
 * module scope so a Client retry that reuses the same LaunchInfo cannot replay
 * it (the Host would answer 410 GM-4013 and the frame would stay blank).
 */

import { INSTANCE_ID_PATTERN, LIMITS, NONCE_PATTERN, PACKAGE_FORMATS, RUNTIME_VERSION, SDK_VERSION, TIMING } from '../../shared/src/constants.js';
import { GM, defaultMessageFor, isGmCode, makeGameError } from '../../shared/src/errors.js';
import { normalizeZipPath } from '../../shared/src/package-v2.js';
import { BRIDGE_VERSION, EVENTS, METHODS, isPlainObject } from '../../shared/src/protocol.js';
import { isAbsoluteHttpUrl, normalizeResourceOrigin, sharesOrigin } from '../../shared/src/resources.js';
import { createRuntimeBridge } from './bridge.js';
import { buildWrapperFrameUrl, isEntryResourceUrl, isResourceBase, isSafeEntryUrl, withLaunchQuery } from './launch-url.js';
import { createRequestService } from './requests.js';
import { createSaveScheduler } from './scheduler.js';
import { createStateMachine } from './state-machine.js';

/**
 * V1 = SDK 1.x. The lower bound keeps V0 games (SDK 0.1.x) runnable — the V0
 * public surface is a subset of v1 (V1-07).
 */
const SUPPORTED_SDK_RANGE = '>=0.1.0 <2.0.0';
const PAUSE_REASONS = Object.freeze(['user', 'hidden', 'leave', 'waiting-user']);
const VIEWPORT_THROTTLE_MS = 200;
const PING_TIMEOUT_MS = 2000;
const MAX_PING_MISSES = 3;
const MAX_CONSUMED_LAUNCH_URLS = 64;

/**
 * One-shot entry URLs already fetched anywhere in this page lifetime. A Client
 * retry may hand the Runtime the same LaunchInfo again; navigating the launch
 * URL a second time would be a 410 replay, so the credential must be known
 * consumed before the retry even starts.
 */
const consumedLaunchUrls = new Set();

function rememberConsumedLaunchUrl(entryUrl) {
  if (typeof entryUrl !== 'string' || entryUrl.length === 0) return;
  consumedLaunchUrls.add(entryUrl);
  while (consumedLaunchUrls.size > MAX_CONSUMED_LAUNCH_URLS) {
    const oldest = consumedLaunchUrls.values().next().value;
    if (oldest === undefined) break;
    consumedLaunchUrls.delete(oldest);
  }
}


function noop() {}

function pauseSaveReason(reason) {
  if (reason === 'hidden') return 'hidden';
  if (reason === 'leave' || reason === 'waiting-user') return 'leave';
  return 'pause';
}

function readEntryQuery(entryUrl) {
  try {
    const base = typeof location !== 'undefined' && location && location.href ? location.href : 'http://dsh-game.local/';
    return new URL(entryUrl, base).searchParams;
  } catch (_error) {
    try {
      return new URLSearchParams(String(entryUrl).split('?')[1] || '');
    } catch (_error2) {
      return new URLSearchParams('');
    }
  }
}

function normalizeLimits(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    saveBytes: positiveInt(source.saveBytes, LIMITS.saveTotalBytes),
    saveKeys: positiveInt(source.saveKeys, LIMITS.saveKeys),
    scoreMetaBytes: positiveInt(source.scoreMetaBytes, LIMITS.scoreMetaBytes),
  };
}

function positiveInt(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function normalizeResourceFields(info) {
  const hasAny =
    info.resourceOrigin !== undefined ||
    info.resourceBase !== undefined ||
    info.entryResourceUrl !== undefined ||
    info.resourceTtlMs !== undefined ||
    info.package !== undefined ||
    info.wrapperUrl !== undefined ||
    info.wrapperResourceUrl !== undefined;
  if (!hasAny) {
    return {
      useWrapper: false,
      resourceOrigin: null,
      resourceBase: null,
      resourceTtlMs: null,
      entryResourceUrl: null,
      packageFormat: null,
      packageEntry: null,
      filesDigest: null,
      wrapperUrl: null,
      wrapperResourceUrl: null,
    };
  }
  // Contract §7.6: the V1.5 fields are issued together. A partial set means the
  // Host and Runtime disagree; fail closed instead of silently dropping the
  // resource credential (a ZIP game would then load without its resources).
  const origin = normalizeResourceOrigin(info.resourceOrigin);
  if (!origin.ok) {
    throw makeGameError(GM.INVALID_PARAM, 'LaunchInfo.resourceOrigin must be an absolute http loopback origin');
  }
  if (typeof info.resourceBase !== 'string' || !isResourceBase(info.resourceBase)) {
    throw makeGameError(GM.INVALID_PARAM, 'LaunchInfo.resourceBase must be an instance /res/ prefix');
  }
  if (typeof info.entryResourceUrl !== 'string' || !isEntryResourceUrl(info.entryResourceUrl, info.resourceBase)) {
    throw makeGameError(GM.INVALID_PARAM, 'LaunchInfo.entryResourceUrl must live under resourceBase');
  }
  if (
    info.resourceTtlMs !== undefined &&
    (typeof info.resourceTtlMs !== 'number' || !Number.isFinite(info.resourceTtlMs) || info.resourceTtlMs <= 0)
  ) {
    throw makeGameError(GM.INVALID_PARAM, 'LaunchInfo.resourceTtlMs must be a positive number');
  }
  const pkg = info.package;
  if (!isPlainObject(pkg)) {
    throw makeGameError(GM.INVALID_PARAM, 'LaunchInfo.package must be an object');
  }
  if (!PACKAGE_FORMATS.includes(pkg.format)) {
    throw makeGameError(GM.INVALID_PARAM, 'LaunchInfo.package.format is not supported');
  }
  const entryPath = normalizeZipPath(pkg.entry);
  if (!entryPath.ok) {
    throw makeGameError(GM.INVALID_PARAM, 'LaunchInfo.package.entry must be a normalized relative path');
  }
  if (pkg.filesDigest !== null && (typeof pkg.filesDigest !== 'string' || !/^[a-f0-9]{64}$/.test(pkg.filesDigest))) {
    throw makeGameError(GM.INVALID_PARAM, 'LaunchInfo.package.filesDigest must be null or 64 lowercase hex');
  }
  // Optional wrapper URLs (Lead decision 2026-10-20): the Host may pre-build
  // them; the Runtime still overwrites `?src=` (see buildWrapperFrameUrl).
  const wrapperUrl = normalizeWrapperField(info.wrapperUrl, origin.value, 'wrapperUrl');
  const wrapperResourceUrl = normalizeWrapperField(info.wrapperResourceUrl, origin.value, 'wrapperResourceUrl');
  // html-v1 keeps the V1 direct `/api/.../entry` navigation; only
  // asset-zip-v2 needs the wrapper (Lead decision, M1 scope).
  const useWrapper = pkg.format === 'asset-zip-v2';
  return {
    useWrapper,
    resourceOrigin: origin.value,
    resourceBase: info.resourceBase,
    resourceTtlMs: info.resourceTtlMs === undefined ? null : info.resourceTtlMs,
    entryResourceUrl: info.entryResourceUrl,
    packageFormat: pkg.format,
    packageEntry: entryPath.value,
    filesDigest: pkg.filesDigest === undefined ? null : pkg.filesDigest,
    wrapperUrl,
    wrapperResourceUrl,
  };
}

function normalizeWrapperField(value, resourceOrigin, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !isAbsoluteHttpUrl(value) || !sharesOrigin(value, resourceOrigin)) {
    throw makeGameError(GM.INVALID_PARAM, `LaunchInfo.${field} must be an absolute URL on the resource origin`);
  }
  return value;
}

function normalizeLaunchInfo(info) {
  if (!isPlainObject(info)) throw makeGameError(GM.INVALID_PARAM, 'launch requires a LaunchInfo object');
  if (typeof info.entryUrl !== 'string' || info.entryUrl.length === 0) {
    throw makeGameError(GM.INVALID_PARAM, 'LaunchInfo.entryUrl must be a non-empty string');
  }
  if (typeof info.instanceId !== 'string' || !INSTANCE_ID_PATTERN.test(info.instanceId)) {
    throw makeGameError(GM.INVALID_PARAM, 'LaunchInfo.instanceId must be 32 lowercase hex characters');
  }
  if (typeof info.nonce !== 'string' || !NONCE_PATTERN.test(info.nonce)) {
    throw makeGameError(GM.INVALID_PARAM, 'LaunchInfo.nonce must be 32 lowercase hex characters');
  }
  const query = readEntryQuery(info.entryUrl);
  // LaunchInfo (shared contract) has no gameId/gameVersion fields; the Host puts
  // them in entryUrl. Accept explicit fields too, for forward compatibility.
  const gameId = typeof info.gameId === 'string' && info.gameId ? info.gameId : query.get('gameId');
  if (!gameId) throw makeGameError(GM.INVALID_PARAM, 'LaunchInfo is missing gameId (entryUrl query)');
  const gameVersion =
    (typeof info.gameVersion === 'string' && info.gameVersion) ||
    query.get('version') ||
    query.get('gameVersion') ||
    '0.0.0';
  const resources = normalizeResourceFields(info);
  if (resources.useWrapper) {
    // Inside the wrapper the game URL must be an absolute resource-origin URL:
    // a same-origin relative path would resolve against the wrapper origin, and
    // a foreign URL would let the Host redirect the instance elsewhere.
    if (!isSafeEntryUrl(info.entryUrl) || !isAbsoluteHttpUrl(info.entryUrl) || !sharesOrigin(info.entryUrl, resources.resourceOrigin)) {
      throw makeGameError(GM.INVALID_PARAM, 'LaunchInfo.entryUrl must be an absolute resource-origin URL for asset-zip-v2');
    }
  }
  return {
    gameId,
    gameVersion,
    entryUrl: info.entryUrl,
    instanceId: info.instanceId,
    nonce: info.nonce,
    mode: info.mode === 'resume-paused' ? 'resume-paused' : 'start',
    capabilities: Array.isArray(info.capabilities) ? info.capabilities.slice() : [],
    limits: normalizeLimits(info.limits),
    viewport: info.viewport && typeof info.viewport === 'object' ? info.viewport : { width: 960, height: 540, fit: 'contain' },
    runtimeVersion: typeof info.runtimeVersion === 'string' ? info.runtimeVersion : RUNTIME_VERSION,
    sdkVersion: typeof info.sdkVersion === 'string' ? info.sdkVersion : SDK_VERSION,
    ...resources,
  };
}

function normalizeEnvironment(input) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    theme: source.theme === 'dark' ? 'dark' : 'light',
    reducedMotion: source.reducedMotion === true,
    locale: typeof source.locale === 'string' && source.locale ? source.locale : 'zh',
  };
}

/**
 * @param {{
 *   container: object,
 *   api: object,
 *   environment?: {theme: string, reducedMotion: boolean, locale: string},
 *   onEvent?: (event: object) => void,
 *   window?: object,
 *   document?: object,
 *   timers?: {setTimeout: Function, clearTimeout: Function},
 *   now?: () => number,
 * }} options
 */
export function createGameController(options = {}) {
  const container = options.container;
  const api = options.api;
  if (!container || typeof container.appendChild !== 'function') {
    throw new Error('createGameRuntime requires a container element');
  }
  if (!api || typeof api.setSave !== 'function' || typeof api.getSave !== 'function') {
    throw new Error('createGameRuntime requires an API client');
  }
  const win = options.window || (typeof window !== 'undefined' ? window : null);
  const doc = options.document || (win && win.document) || (typeof document !== 'undefined' ? document : null);
  const timers = options.timers || globalThis;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const emitRaw = typeof options.onEvent === 'function' ? options.onEvent : noop;

  let environment = normalizeEnvironment(options.environment);
  let launchInfo = null;
  let iframe = null;
  /** Set the moment the element is created; teardown uses it as a fallback. */
  let createdFrame = null;
  let iframeWindow = null;
  let iframeLoaded = false;
  let bridge = null;
  let scheduler = null;
  let requests = null;
  let destroyed = false;
  let generation = 0;
  let viewport = { width: 0, height: 0, dpr: 1 };
  let agentSnapshot = null;
  /** V1.5 credential/navigation state. */
  let expectedFrameLoads = 0;
  let navigationUsesLaunchCredential = false;
  let capabilitiesRevoked = false;
  /**
   * True only while we are inserting the iframe into the DOM. Chrome may fire a
   * synchronous `load` for the iframe's initial empty document at insertion
   * time; that is not a navigation and MUST NOT be counted as one (it released
   * live instances in the M1 A02 browser probe, Lead 2026-10-20).
   */
  let insertingFrame = false;

  let handshakeTimer = null;
  let loadSlowTimer = null;
  let loadErrorTimer = null;
  let readyFinalizeTimer = null;
  let pingTimer = null;
  let pingActive = false;
  let viewportTimer = null;
  let pingMisses = 0;
  let pausePromise = null;
  let hiddenPaused = false;
  let hiddenPausePromise = null;
  /**
   * V1.5 AUD-02: paused != saved. `saveStale` records whether the latest
   * storage write for THIS generation failed (or never completed). pause() must
   * never claim success for an already-paused instance whose progress was not
   * persisted; a real successful save clears it. Relaunch/destroy resets it.
   */
  let saveStale = false;
  let saveStaleGeneration = -1;

  let resizeObserver = null;
  let messageHandler = null;
  let visibilityHandler = null;
  let resizeHandler = null;
  let iframeLoadHandler = null;
  let iframeErrorHandler = null;

  const machine = createStateMachine({ initial: 'idle' });

  function emit(event) {
    try {
      emitRaw(event);
    } catch (_error) {
      // Consumer callbacks must never break the runtime loop.
    }
  }

  function emitError(code, message, retryable) {
    const error = {
      code: isGmCode(code) ? code : GM.INTERNAL,
      message: message || defaultMessageFor(code) || 'Runtime error',
      retryable: retryable === true,
    };
    emit({ type: 'error', error });
    return error;
  }

  function clearTimer(timer) {
    if (timer !== null && timer !== undefined) timers.clearTimeout(timer);
    return null;
  }

  function enterState(next) {
    if (!machine.transition(next)) return false;
    emit({ type: 'state', state: next });
    if (scheduler) {
      if (next === 'playing') scheduler.start();
      else scheduler.stop();
    }
    return true;
  }

  function measureViewport() {
    let width = 0;
    let height = 0;
    if (container && typeof container.getBoundingClientRect === 'function') {
      const rect = container.getBoundingClientRect();
      width = Math.round(rect && Number.isFinite(rect.width) ? rect.width : 0);
      height = Math.round(rect && Number.isFinite(rect.height) ? rect.height : 0);
    }
    if ((!width || !height) && container) {
      width = width || Number(container.clientWidth) || 0;
      height = height || Number(container.clientHeight) || 0;
    }
    const dpr = win && typeof win.devicePixelRatio === 'number' && win.devicePixelRatio > 0 ? win.devicePixelRatio : 1;
    return { width, height, dpr };
  }

  function sendToGame(message) {
    if (!iframeWindow || typeof iframeWindow.postMessage !== 'function') return;
    try {
      iframeWindow.postMessage(message, '*');
    } catch (_error) {
      // The iframe may have navigated away; heartbeat/load error handling covers it.
    }
  }

  function buildInitData() {
    return {
      protocolVersion: BRIDGE_VERSION,
      instanceId: launchInfo.instanceId,
      nonce: launchInfo.nonce,
      gameId: launchInfo.gameId,
      gameVersion: launchInfo.gameVersion,
      runtimeVersion: launchInfo.runtimeVersion,
      sdkVersion: launchInfo.sdkVersion,
      supportedSdkRange: SUPPORTED_SDK_RANGE,
      launchMode: launchInfo.mode,
      locale: environment.locale,
      theme: environment.theme,
      reducedMotion: environment.reducedMotion,
      capabilities: launchInfo.capabilities.slice(),
      limits: {
        saveBytes: launchInfo.limits.saveBytes,
        saveKeys: launchInfo.limits.saveKeys,
        scoreMetaBytes: launchInfo.limits.scoreMetaBytes,
      },
      viewport: { width: viewport.width, height: viewport.height, dpr: viewport.dpr },
      // V1.5 (contract §1.10/§7.6): the SDK builds game.runtime.assetUrl() from
      // this instance prefix. `null` on legacy/html-v1 Hosts keeps old games
      // byte-compatible; old SDKs ignore unknown init fields.
      resourceBase: launchInfo.resourceBase,
      packageFormat: launchInfo.packageFormat,
    };
  }

  function buildRuntimeInfo() {
    return {
      sdkVersion: launchInfo.sdkVersion,
      protocolVersion: BRIDGE_VERSION,
      runtimeVersion: launchInfo.runtimeVersion,
      gameId: launchInfo.gameId,
      gameVersion: launchInfo.gameVersion,
      locale: environment.locale,
      theme: environment.theme,
      reducedMotion: environment.reducedMotion,
      capabilities: launchInfo.capabilities.slice(),
      viewport: { width: viewport.width, height: viewport.height, dpr: viewport.dpr },
      resourceBase: launchInfo.resourceBase,
      packageFormat: launchInfo.packageFormat,
      ready: true,
    };
  }

  /** Mark the current generation's last storage write as failed/unverified. */
  function markSaveStale() {
    saveStale = true;
    saveStaleGeneration = generation;
  }

  /** A real successful write clears staleness (only for the current generation). */
  function clearSaveStale() {
    if (saveStaleGeneration === generation) {
      saveStale = false;
      saveStaleGeneration = -1;
    }
  }

  /** True when progress may not be on disk for the current launch generation. */
  function saveIsStale() {
    return saveStale === true && saveStaleGeneration === generation;
  }

  function noteSaveOutcome(outcome) {
    if (outcome && outcome.ok === true) clearSaveStale();
    else markSaveStale();
  }

  function handleSaveOutcome(outcome) {
    // Any storage write outcome (save or remove) updates the paused != saved
    // ledger before the scheduler resolves a pending pause.
    noteSaveOutcome(outcome);
    if (scheduler && scheduler.noteSave(outcome)) return;
    emit({ type: 'save-status', status: outcome && outcome.ok ? 'saved' : 'failed', at: now() });
  }

  function handleHello() {
    if (!bridge) return;
    // The game document was fetched and its SDK is running: the one-shot launch
    // credential (if this navigation used it) is now consumed for good.
    markGameDocumentLoaded();
    bridge.markInitialized();
    bridge.sendEvent(EVENTS.INIT, buildInitData());
    if (agentSnapshot) bridge.sendEvent(EVENTS.AGENT_STATUS, agentSnapshot);
  }

  function handleReady(params) {
    if (!bridge || !launchInfo) throw makeGameError(GM.NOT_READY, 'Game Runtime is not launched');
    const protocolVersion = params ? params.protocolVersion : undefined;
    if (protocolVersion !== undefined && protocolVersion !== BRIDGE_VERSION) {
      fail(GM.PROTOCOL_MISMATCH, 'Game protocol version is not supported');
      throw makeGameError(GM.PROTOCOL_MISMATCH, 'Game protocol version is not supported');
    }
    if (bridge.isReadyAcknowledged()) return buildRuntimeInfo();
    handshakeTimer = clearTimer(handshakeTimer);
    markGameDocumentLoaded();
    bridge.markReady();
    enterState('ready');
    if (iframeLoaded) startPing();
    readyFinalizeTimer = timers.setTimeout(function finalize() {
      readyFinalizeTimer = null;
      finalizeReadyState();
    }, 0);
    return buildRuntimeInfo();
  }

  function finalizeReadyState() {
    if (destroyed || !bridge || !launchInfo || machine.get() !== 'ready') return;
    if (launchInfo.mode === 'resume-paused') {
      bridge.sendEvent(EVENTS.PAUSE, { reason: 'user', at: now() });
      enterState('paused');
    } else {
      enterState('playing');
    }
  }

  function handleBridgeRequest(method, params) {
    if (method === METHODS.READY) return handleReady(params);
    if (!requests) throw makeGameError(GM.NO_RUNTIME, 'Game Runtime is not available');
    return requests.handle(method, params);
  }

  function handleMessage(event) {
    if (!event || !bridge) return;
    try {
      const result = bridge.handleIncoming(event.data, event.source);
      if (result && typeof result.catch === 'function') result.catch(noop);
    } catch (_error) {
      // Malformed events never escape the listener.
    }
  }

  function startPing() {
    if (pingActive) return;
    pingActive = true;
    pingMisses = 0;
    sendPing();
    schedulePingTick();
  }

  function schedulePingTick() {
    if (destroyed || !bridge) return;
    pingTimer = timers.setTimeout(function pingTick() {
      pingTimer = null;
      if (destroyed || !bridge) return;
      sendPing();
      schedulePingTick();
    }, TIMING.iframePingMs);
  }

  function sendPing() {
    if (!bridge) return;
    bridge.sendRequest(METHODS.PING, { at: now() }, PING_TIMEOUT_MS).then(
      function onPong() {
        pingMisses = 0;
      },
      function onMiss() {
        pingMisses += 1;
        if (pingMisses >= MAX_PING_MISSES && !destroyed) {
          stopPing();
          fail(GM.IFRAME_UNRESPONSIVE, 'Game is not responding');
        }
      }
    );
  }

  function stopPing() {
    pingActive = false;
    pingTimer = clearTimer(pingTimer);
  }

  function fail(code, message, retryable) {
    if (destroyed) return;
    handshakeTimer = clearTimer(handshakeTimer);
    loadSlowTimer = clearTimer(loadSlowTimer);
    loadErrorTimer = clearTimer(loadErrorTimer);
    stopPing();
    readyFinalizeTimer = clearTimer(readyFinalizeTimer);
    emitError(code, message, retryable);
    if (machine.get() !== 'error' && machine.get() !== 'exited') enterState('error');
  }

  /**
   * Security teardown (contract §7.5.1 depth defense): after an unexpected
   * navigation or a dead heartbeat the Runtime stops the bridge (no more SDK
   * calls), releases the Host instance (the resource credential can no longer
   * be renewed or used) and surfaces a real error.
   */
  function revokeCapabilities(code, message) {
    if (destroyed || capabilitiesRevoked) return;
    capabilitiesRevoked = true;
    stopPing();
    if (bridge) {
      try {
        bridge.destroy();
      } catch (_error) {
        // already destroyed
      }
      bridge = null;
    }
    requests = null;
    if (launchInfo && api && typeof api.releaseRuntime === 'function') {
      try {
        Promise.resolve(api.releaseRuntime({ gameId: launchInfo.gameId, instanceId: launchInfo.instanceId })).catch(
          noop
        );
      } catch (_error) {
        // Release is best-effort; the Host TTL still reclaims the instance.
      }
    }
    fail(code, message, false);
    // Tear the sandbox down like V1 did for fatal protocol violations: after a
    // capability revocation there is nothing left to talk to.
    cleanupDom();
  }

  function startHandshakeTimer() {
    handshakeTimer = clearTimer(handshakeTimer);
    handshakeTimer = timers.setTimeout(function handshakeTimeout() {
      handshakeTimer = null;
      if (!bridge || bridge.isReadyAcknowledged() || destroyed) return;
      // A wrapper navigation with the one-shot launch URL that never handshakes
      // is the observable symptom of a replayed/consumed launch credential
      // (Host answers 410 GM-4013 and the nested frame stays blank). Show the
      // real error, then retry with the instance resource credential instead of
      // leaving a silent blank frame.
      if (recoverWithResourceCredential('handshake-timeout')) return;
      if (launchInfo && launchInfo.useWrapper && launchInfo.entryResourceUrl) {
        // A wrapped instance that still cannot reach the game after the
        // resource-credential fallback is a load failure (retryable with the
        // resource URL); the Client shows this error instead of a blank frame.
        fail(GM.LOAD_TIMEOUT, 'Game failed to load in time', true);
        return;
      }
      fail(GM.HANDSHAKE_TIMEOUT, 'Game handshake timed out');
    }, TIMING.handshakeTimeoutMs);
  }

  function startLoadTimers() {
    if (iframeLoaded) return;
    loadSlowTimer = timers.setTimeout(function slowLoad() {
      loadSlowTimer = null;
      if (destroyed || iframeLoaded) return;
      emitError(GM.LOAD_TIMEOUT, 'Game is taking longer than usual to load', true);
    }, TIMING.loadSlowMs);
    loadErrorTimer = timers.setTimeout(function abortedLoad() {
      loadErrorTimer = null;
      if (destroyed || iframeLoaded) return;
      if (recoverWithResourceCredential('load-timeout')) return;
      fail(GM.LOAD_TIMEOUT, 'Game failed to load in time', true);
    }, TIMING.loadErrorMs);
  }

  /**
   * The game document was fetched and is executing. In wrapper mode the
   * iframe's `load` event only proves the wrapper document loaded, so the SDK
   * handshake is the first trustworthy signal for the nested game document.
   */
  function markGameDocumentLoaded() {
    if (!launchInfo || !launchInfo.useWrapper) return; // legacy: iframe load = entry load
    if (iframeLoaded) return;
    iframeLoaded = true;
    loadSlowTimer = clearTimer(loadSlowTimer);
    loadErrorTimer = clearTimer(loadErrorTimer);
    if (navigationUsesLaunchCredential) rememberConsumedLaunchUrl(launchInfo.entryUrl);
    navigationUsesLaunchCredential = false;
  }

  /**
   * Decide where the next navigation must go (contract §7.2). The first
   * navigation carries the one-shot launch credential; every later one uses the
   * instance resource credential. Returns `null` when no credential is usable.
   *
   * Plan first, apply later: `createIframe()` needs the initial `src` BEFORE
   * inserting the frame so Chrome never starts an interim about:blank
   * navigation (Lead P0, 2026-10-20).
   */
  function planGameDocumentNavigation(mode) {
    if (!launchInfo) return null;
    let gameUrl;
    let wrapperMode = 'launch';
    const launchConsumedAlready = launchInfo.useWrapper && consumedLaunchUrls.has(launchInfo.entryUrl);
    if (mode === 'initial' && !launchConsumedAlready) {
      gameUrl = withLaunchQuery(launchInfo.entryUrl, launchInfo.instanceId, launchInfo.nonce);
      navigationUsesLaunchCredential = true;
    } else if (launchInfo.entryResourceUrl) {
      gameUrl = withLaunchQuery(launchInfo.entryResourceUrl, launchInfo.instanceId, launchInfo.nonce);
      navigationUsesLaunchCredential = false;
      wrapperMode = 'resource';
      // The launch credential is spent after the first reachable navigation,
      // even when this Runtime instance never fetched it itself.
      rememberConsumedLaunchUrl(launchInfo.entryUrl);
    } else {
      return null;
    }
    const frameUrl = launchInfo.useWrapper ? buildWrapperFrameUrl(launchInfo, gameUrl, wrapperMode) : gameUrl;
    if (!frameUrl) return null;
    return { frameUrl, wrapperMode };
  }

  /** Apply a planned navigation to the existing iframe. */
  function applyGameDocumentNavigation(plan) {
    // Every navigation we perform is expected to produce exactly one `load`.
    // Extra `load` events are non-ours navigations and end the instance.
    expectedFrameLoads += 1;
    if (!iframe) return;
    iframeLoaded = false;
    iframe.setAttribute('src', plan.frameUrl);
  }

  /**
   * One-shot navigation helper for reload/retry paths (the iframe already
   * exists): plan + apply, or `null` when no usable credential exists.
   */
  function navigateToGameDocument(mode) {
    const plan = planGameDocumentNavigation(mode);
    if (!plan) return null;
    applyGameDocumentNavigation(plan);
    return plan.frameUrl;
  }

  function canRecoverWithResourceCredential() {
    return Boolean(
      !destroyed &&
        !capabilitiesRevoked &&
        launchInfo &&
        launchInfo.entryResourceUrl &&
        navigationUsesLaunchCredential
    );
  }

  function recoverWithResourceCredential(reason) {
    if (!canRecoverWithResourceCredential()) return false;
    emitError(
      GM.ENTRY_LAUNCH_CONSUMED,
      'The one-shot launch credential was already used; reloading with the instance resource URL',
      true
    );
    resetForNavigation();
    const frameUrl = navigateToGameDocument('reload');
    if (!frameUrl) {
      fail(GM.ENTRY_LAUNCH_CONSUMED, 'No instance resource credential is available', true);
      return true;
    }
    startHandshakeTimer();
    startLoadTimers();
    emit({ type: 'navigation', mode: 'resource-credential', reason: reason });
    return true;
  }

  /** Prepare the same iframe for another navigation without a fresh launch. */
  function resetForNavigation() {
    handshakeTimer = clearTimer(handshakeTimer);
    loadSlowTimer = clearTimer(loadSlowTimer);
    loadErrorTimer = clearTimer(loadErrorTimer);
    readyFinalizeTimer = clearTimer(readyFinalizeTimer);
    stopPing();
    pausePromise = null;
    hiddenPausePromise = null;
    hiddenPaused = false;
    saveStale = false;
    saveStaleGeneration = -1;
    iframeLoaded = false;
    if (scheduler) scheduler.stop();
    generation += 1;
    if (bridge) {
      try {
        bridge.destroy();
      } catch (_error) {
        // already destroyed
      }
    }
    bridge = createControllerBridge();
    machine.reset('loading');
    emit({ type: 'state', state: 'loading' });
  }

  function focusFrame() {
    if (iframe && typeof iframe.focus === 'function') {
      try {
        iframe.focus();
      } catch (_error) {
        // focus can fail if the element was detached
      }
    }
  }

  function onIframeLoad() {
    if (destroyed) return;
    // Loads that are not a navigation we initiated are not ours to judge:
    //   - the synchronous initial empty-document load Chrome fires while the
    //     iframe is being inserted (src not committed yet);
    //   - a load arriving after teardown started (iframe already detached).
    // Counting these as "unexpected navigation" released live instances in the
    // real-path browser probe (Lead P0, 2026-10-20).
    if (insertingFrame) return;
    if (!iframe) return;
    const currentSrc = typeof iframe.getAttribute === 'function' ? iframe.getAttribute('src') : null;
    if (currentSrc === null || currentSrc === '' || currentSrc === 'about:blank') return;
    if (expectedFrameLoads <= 0) {
      // A real navigation we never requested: the frame document moved (evil
      // navigation / wrapper violation). Revoke the instance and stop granting
      // capabilities (contract §7.5.1 depth defence).
      revokeCapabilities(GM.IFRAME_CRASHED, 'Unexpected game navigation was blocked');
      return;
    }
    expectedFrameLoads -= 1;
    if (launchInfo && launchInfo.useWrapper) {
      // Wrapper document loaded; the nested game document is still loading, so
      // load timers keep running until the SDK handshake arrives.
      focusFrame();
      return;
    }
    // Legacy html-v1 direct navigation: the iframe load is the entry document.
    // No credential registry here: V0/V1 navigation semantics stay unchanged.
    iframeLoaded = true;
    loadSlowTimer = clearTimer(loadSlowTimer);
    loadErrorTimer = clearTimer(loadErrorTimer);
    navigationUsesLaunchCredential = false;
    if (bridge && bridge.isReadyAcknowledged()) startPing();
    focusFrame();
  }

  function scheduleViewport() {
    if (viewportTimer !== null || destroyed) return;
    viewportTimer = timers.setTimeout(function flushViewport() {
      viewportTimer = null;
      if (destroyed) return;
      const next = measureViewport();
      const changed = next.width !== viewport.width || next.height !== viewport.height || next.dpr !== viewport.dpr;
      viewport = next;
      if (changed && bridge && bridge.isInitialized()) bridge.sendEvent(EVENTS.VIEWPORT, viewport);
    }, VIEWPORT_THROTTLE_MS);
  }

  function observeViewport() {
    viewport = measureViewport();
    if (win && typeof win.ResizeObserver === 'function') {
      try {
        resizeObserver = new win.ResizeObserver(function onResize() {
          scheduleViewport();
        });
        resizeObserver.observe(container);
        return;
      } catch (_error) {
        resizeObserver = null;
      }
    }
    if (win && typeof win.addEventListener === 'function') {
      resizeHandler = function onWindowResize() {
        scheduleViewport();
      };
      win.addEventListener('resize', resizeHandler);
    }
  }

  function handleVisibilityChange() {
    if (!doc || typeof doc.hidden !== 'boolean') return;
    if (doc.hidden) {
      if (bridge && bridge.isInitialized()) bridge.sendEvent(EVENTS.HIDDEN, { at: now() });
      if (machine.get() === 'playing') {
        hiddenPaused = true;
        hiddenPausePromise = pause('hidden');
      }
      return;
    }
    if (bridge && bridge.isInitialized()) bridge.sendEvent(EVENTS.VISIBLE, { at: now() });
    if (!hiddenPaused) return;
    const resumeAfterPause = function resumeAfterPause() {
      hiddenPaused = false;
      hiddenPausePromise = null;
      if (machine.get() === 'paused') resumeWithReason('visible');
    };
    if (hiddenPausePromise) hiddenPausePromise.then(resumeAfterPause, resumeAfterPause);
    else resumeAfterPause();
  }

  /**
   * Finish one pause save for `token` generation.
   * Success is only reported for a real `{ok:true}` scheduler result; failures
   * keep the per-generation stale ledger set (AUD-02).
   */
  function finishPauseSave(token, result) {
    pausePromise = null;
    const ok = Boolean(result && result.ok === true);
    if (token === generation && !destroyed) {
      if (ok) clearSaveStale();
      else markSaveStale();
      if (machine.get() === 'saving') enterState('paused');
    }
    return { ok: ok, saveStale: !ok };
  }

  function failPauseSave(token) {
    pausePromise = null;
    if (token === generation && !destroyed) {
      markSaveStale();
      if (machine.get() === 'saving') enterState('paused');
    }
    return { ok: false, saveStale: true };
  }

  /**
   * AUD-02: a coordination pause of an ALREADY-PAUSED instance must perform a
   * REAL save when the previous save failed. Returning `{ok:true}` here let a
   * retried update replace the plugin while progress was still only in memory.
   * No duplicate PAUSE event is sent: the game is already paused.
   */
  function retryStalePause(pauseReason) {
    if (!scheduler || !bridge || typeof bridge.isInitialized !== 'function' || !bridge.isInitialized()) {
      // No live game to save through: fail closed instead of claiming saved.
      return Promise.resolve({ ok: false, saveStale: true });
    }
    const token = generation;
    enterState('saving');
    pausePromise = scheduler.save(pauseSaveReason(pauseReason)).then(
      function onSaved(result) {
        return finishPauseSave(token, result);
      },
      function onSaveError() {
        return failPauseSave(token);
      }
    );
    return pausePromise;
  }

  function pause(reason) {
    const pauseReason = PAUSE_REASONS.includes(reason) ? reason : 'user';
    if (pausePromise) return pausePromise;
    if (destroyed) {
      // The Runtime was torn down: nothing can be verified as saved anymore.
      return Promise.resolve({ ok: false, saveStale: true });
    }
    if (!launchInfo || !bridge) return Promise.resolve({ ok: true, saveStale: false });
    const currentState = machine.get();
    if (currentState === 'error' || currentState === 'exited') {
      // The frame is gone; the in-memory progress can no longer be verified as
      // saved, so report an honest stale result instead of success.
      return Promise.resolve({ ok: false, saveStale: true });
    }
    const storageCapable = launchInfo.capabilities.includes('storage');
    if (currentState === 'paused') {
      if (!storageCapable) return Promise.resolve({ ok: true, saveStale: false });
      if (!saveIsStale()) return Promise.resolve({ ok: true, saveStale: false });
      // The previous pause save failed and no successful save happened since:
      // run a real forced save retry and report its true outcome.
      return retryStalePause(pauseReason);
    }
    if (currentState !== 'playing') {
      // ready/loading: nothing has been played yet, so there is no pending
      // in-memory progress to flush.
      return Promise.resolve({ ok: true, saveStale: false });
    }
    const token = generation;
    scheduler.stop();
    enterState('paused');
    bridge.sendEvent(EVENTS.PAUSE, { reason: pauseReason, at: now() });
    if (!storageCapable) return Promise.resolve({ ok: true, saveStale: false });
    enterState('saving');
    pausePromise = scheduler.save(pauseSaveReason(pauseReason)).then(
      function onSaved(result) {
        return finishPauseSave(token, result);
      },
      function onSaveError() {
        return failPauseSave(token);
      }
    );
    return pausePromise;
  }

  function resumeWithReason(reason) {
    if (!launchInfo || !bridge) return;
    if (machine.get() !== 'paused') return;
    enterState('playing');
    bridge.sendEvent(EVENTS.RESUME, { reason: reason === 'visible' ? 'visible' : 'user', at: now() });
  }

  function resume() {
    resumeWithReason('user');
  }

  function cleanupDom() {
    insertingFrame = false;
    generation += 1;
    handshakeTimer = clearTimer(handshakeTimer);
    loadSlowTimer = clearTimer(loadSlowTimer);
    loadErrorTimer = clearTimer(loadErrorTimer);
    readyFinalizeTimer = clearTimer(readyFinalizeTimer);
    viewportTimer = clearTimer(viewportTimer);
    stopPing();
    pausePromise = null;
    hiddenPausePromise = null;
    hiddenPaused = false;

    if (win && messageHandler && typeof win.removeEventListener === 'function') {
      win.removeEventListener('message', messageHandler);
    }
    messageHandler = null;
    if (doc && visibilityHandler && typeof doc.removeEventListener === 'function') {
      doc.removeEventListener('visibilitychange', visibilityHandler);
    }
    visibilityHandler = null;
    if (win && resizeHandler && typeof win.removeEventListener === 'function') {
      win.removeEventListener('resize', resizeHandler);
    }
    resizeHandler = null;
    if (resizeObserver && typeof resizeObserver.disconnect === 'function') {
      try {
        resizeObserver.disconnect();
      } catch (_error) {
        // already disconnected
      }
    }
    resizeObserver = null;

    const frameToRemove = iframe || createdFrame;
    if (frameToRemove) {
      if (iframeLoadHandler && typeof frameToRemove.removeEventListener === 'function') {
        frameToRemove.removeEventListener('load', iframeLoadHandler);
      }
      if (iframeErrorHandler && typeof frameToRemove.removeEventListener === 'function') {
        frameToRemove.removeEventListener('error', iframeErrorHandler);
      }
      try {
        if (typeof frameToRemove.remove === 'function') frameToRemove.remove();
        else if (frameToRemove.parentNode && typeof frameToRemove.parentNode.removeChild === 'function') {
          frameToRemove.parentNode.removeChild(frameToRemove);
        }
      } catch (_error) {
        // detached already
      }
    }
    iframe = null;
    createdFrame = null;
    iframeWindow = null;
    iframeLoaded = false;
    iframeLoadHandler = null;
    iframeErrorHandler = null;

    if (bridge) bridge.destroy();
    if (scheduler) scheduler.destroy();
    bridge = null;
    scheduler = null;
    requests = null;
  }

  /**
   * Create and insert the Runtime's iframe. The navigation target is written to
   * `src` BEFORE the element is inserted: an iframe inserted without `src`
   * starts an initial about:blank navigation, and Chrome dispatches a `load`
   * event for it — which the depth-defence path must not mistake for an
   * unexpected game navigation (Lead P0, 2026-10-20).
   *
   * @param {object} info normalized LaunchInfo
   * @param {string} initialFrameUrl first navigation target (wrapper or entry)
   */
  function createIframe(info, initialFrameUrl) {
    if (!doc || typeof doc.createElement !== 'function') {
      throw new Error('Game Runtime needs a document to create the iframe');
    }
    if (typeof initialFrameUrl !== 'string' || initialFrameUrl.length === 0) {
      throw new Error('Game Runtime needs a navigation target before creating the iframe');
    }
    const frame = doc.createElement('iframe');
    if (info.useWrapper) {
      // Trusted platform wrapper document (resource origin, platform-served,
      // no game bytes/credentials). It MUST stay un-sandboxed: a sandboxed
      // ancestor has an opaque origin, and Chromium's frame-ancestors check on
      // the nested game document matches against every ancestor — an opaque
      // ancestor matches no host-source, so the game would be blocked before
      // any CSS/JS loaded (M1 browser probe, Lead decision 2026-10-20).
      // The wrapper hosts the sandboxed game iframe; the game never gains
      // allow-same-origin, so the sandbox isolation is unchanged.
      frame.setAttribute('allow', 'autoplay');
      frame.setAttribute('referrerpolicy', 'no-referrer');
    } else {
      // V1 html-v1 single-layer sandbox (unchanged).
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.setAttribute('allow', 'autoplay');
      frame.setAttribute('referrerpolicy', 'no-referrer');
    }
    frame.setAttribute('loading', 'eager');
    frame.setAttribute('title', `Game: ${info.gameId}`);
    if (frame.style) {
      frame.style.width = '100%';
      frame.style.height = '100%';
      frame.style.border = '0';
      frame.style.display = 'block';
      frame.style.background = '#000';
    }
    iframeLoadHandler = onIframeLoad;
    iframeErrorHandler = function onIframeError() {
      fail(GM.IFRAME_CRASHED, 'Game crashed');
    };
    if (typeof frame.addEventListener === 'function') {
      frame.addEventListener('load', iframeLoadHandler);
      frame.addEventListener('error', iframeErrorHandler);
    }
    // One expected load for this navigation, and the navigation target exists
    // before insertion so no about:blank document is loaded.
    expectedFrameLoads += 1;
    frame.setAttribute('src', initialFrameUrl);
    // Expose the element to the load handler and to teardown BEFORE it can fire
    // any event, so a failure during insertion can always remove it (no leak).
    iframe = frame;
    createdFrame = frame;
    insertingFrame = true;
    try {
      container.appendChild(frame);
    } catch (error) {
      insertingFrame = false;
      iframe = null;
      throw error;
    }
    insertingFrame = false;
    iframeWindow = frame.contentWindow || null;
  }

  async function launch(info) {
    if (destroyed) throw makeGameError(GM.NO_RUNTIME, 'Game Runtime was destroyed');
    const normalized = normalizeLaunchInfo(info);
    if (iframe || bridge) cleanupDom();
    machine.reset('idle');
    launchInfo = normalized;
    pausePromise = null;
    saveStale = false;
    saveStaleGeneration = -1;
    expectedFrameLoads = 0;
    navigationUsesLaunchCredential = false;
    capabilitiesRevoked = false;

    requests = createRequestService({
      api,
      limits: normalized.limits,
      capabilities: normalized.capabilities,
      getGameId: function getGameId() {
        return launchInfo ? launchInfo.gameId : null;
      },
      getAgentSnapshot: function getAgentSnapshot() {
        return agentSnapshot;
      },
      onSaveOutcome: handleSaveOutcome,
      now,
    });

    scheduler = createSaveScheduler({
      timers,
      now,
      sendBeforeSave: function sendBeforeSave(reason, meta) {
        if (bridge && bridge.isInitialized()) {
          bridge.sendEvent(EVENTS.BEFORE_SAVE, {
            reason,
            deadlineMs: meta && typeof meta.deadlineMs === 'number' ? meta.deadlineMs : TIMING.saveTimeoutMs,
          });
        }
      },
      onStatus: function onStatus(status, at) {
        // A save that timed out or failed leaves progress unpersisted; a
        // successful save clears the stale ledger (AUD-02).
        if (status === 'saved') clearSaveStale();
        else if (status === 'failed') markSaveStale();
        emit({ type: 'save-status', status, at });
      },
    });

    bridge = createControllerBridge();

    const initialPlan = planGameDocumentNavigation('initial');
    if (!initialPlan) {
      cleanupDom();
      const code = launchInfo.entryUrl && consumedLaunchUrls.has(launchInfo.entryUrl)
        ? GM.ENTRY_LAUNCH_CONSUMED
        : GM.INVALID_PARAM;
      throw makeGameError(code, 'LaunchInfo has no navigable entry URL');
    }

    try {
      createIframe(normalized, initialPlan.frameUrl);
    } catch (error) {
      cleanupDom();
      throw error;
    }
    if (win && typeof win.addEventListener === 'function') {
      messageHandler = handleMessage;
      win.addEventListener('message', messageHandler);
    }
    if (doc && typeof doc.addEventListener === 'function') {
      visibilityHandler = handleVisibilityChange;
      doc.addEventListener('visibilitychange', visibilityHandler);
    }
    observeViewport();
    enterState('loading');
    emit({ type: 'save-status', status: 'idle', at: null });
    startHandshakeTimer();
    startLoadTimers();
  }

  /**
   * Build the trusted-side bridge for the current launch. `isTrustedSource` is
   * the heart of the V1.5 wrapper model:
   *
   *   - the game runs in a sandboxed nested iframe created by the trusted
   *     platform wrapper (the Runtime's outer iframe);
   *   - the wrapper relays messages point-to-point, so every game message
   *     reaches this window with `event.source === wrapper iframe window`;
   *   - we accept that window proxy ONLY (an opaque-origin WindowProxy is a
   *     capability-like reference we created ourselves: no other tab/window,
   *     no message relayed from a different frame, and no direct `window.top`
   *     post from the nested game can match it);
   *   - instance identity is bound twice: the hello must carry this instance's
   *     `instanceId` + `nonce`, and the game was launched with that nonce in
   *     its URL; responses must match request ids this Runtime generated.
   *
   * `targetOrigin: '*'` is unavoidable (sandboxed documents have an opaque
   * origin, serialized as "null"), but it is not a broadcast: postMessage is
   * addressed to one WindowProxy (the wrapper we created), and it only relaxes
   * the *recipient origin* check. Incoming messages never trust `event.origin`.
   */
  function createControllerBridge() {
    return createRuntimeBridge({
      instanceId: launchInfo.instanceId,
      nonce: launchInfo.nonce,
      isTrustedSource: function isTrustedSource(source) {
        return Boolean(iframeWindow && source === iframeWindow);
      },
      send: sendToGame,
      onRequest: handleBridgeRequest,
      onHello: handleHello,
      onFatal: function onFatal(error) {
        if (error.code === GM.MESSAGE_INVALID) {
          // Message-flood / structural attack: stop granting capabilities.
          revokeCapabilities(error.code, error.message);
          return;
        }
        fail(error.code, error.message, error.retryable);
      },
      timers,
      now,
    });
  }

  /**
   * Reload/retry the current instance with the resource-credential URL
   * (contract §7.2 reload state machine). Never navigates the launch URL again.
   * @returns {Promise<{ok: boolean, error?: object}>}
   */
  function reload() {
    if (destroyed) {
      return Promise.reject(makeGameError(GM.NO_RUNTIME, 'Game Runtime was destroyed'));
    }
    if (!launchInfo) {
      return Promise.reject(makeGameError(GM.NOT_READY, 'Game Runtime is not launched'));
    }
    if (capabilitiesRevoked) {
      return Promise.reject(makeGameError(GM.NO_RUNTIME, 'Game Runtime capabilities were revoked'));
    }
    if (!launchInfo.entryResourceUrl) {
      // A legacy V1 Host has no instance resource credential; the Client must
      // request a fresh launch instead of replaying the one-shot URL.
      const error = makeGameError(GM.ENTRY_LAUNCH_CONSUMED, 'No instance resource credential is available', {
        retryable: true,
      });
      fail(error.code, error.message, true);
      return Promise.resolve({ ok: false, error: error });
    }
    resetForNavigation();
    const frameUrl = navigateToGameDocument('reload');
    if (!frameUrl) {
      const error = makeGameError(GM.ENTRY_LAUNCH_CONSUMED, 'No instance resource credential is available', {
        retryable: true,
      });
      fail(error.code, error.message, true);
      return Promise.resolve({ ok: false, error: error });
    }
    startHandshakeTimer();
    startLoadTimers();
    emit({ type: 'navigation', mode: 'resource-credential', reason: 'reload' });
    return Promise.resolve({ ok: true });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cleanupDom();
    if (machine.get() !== 'exited') {
      if (!machine.transition('exited')) machine.reset('exited');
      emit({ type: 'state', state: 'exited' });
    }
    emit({ type: 'exit', reason: 'destroy' });
  }

  function getState() {
    return {
      state: machine.get(),
      gameId: launchInfo ? launchInfo.gameId : null,
    };
  }

  function handleAgentState(snapshot) {
    if (snapshot === null || snapshot === undefined) {
      agentSnapshot = null;
      return;
    }
    if (!isPlainObject(snapshot)) return;
    const previous = agentSnapshot;
    agentSnapshot = snapshot;
    if (bridge && bridge.isInitialized()) bridge.sendEvent(EVENTS.AGENT_STATUS, snapshot);
    emit({ type: 'agent-state', snapshot: snapshot });
    const justCompleted = snapshot.state === 'completed' && (!previous || previous.state !== 'completed');
    if (
      justCompleted &&
      scheduler &&
      launchInfo &&
      launchInfo.capabilities.includes('storage') &&
      machine.get() === 'playing'
    ) {
      scheduler.save('agent-complete');
    }
  }

  function updateEnvironment(info) {
    if (!info || typeof info !== 'object') return;
    if (info.theme === 'light' || info.theme === 'dark') environment.theme = info.theme;
    if (typeof info.reducedMotion === 'boolean') environment.reducedMotion = info.reducedMotion;
    if (bridge && bridge.isInitialized()) {
      bridge.sendEvent(EVENTS.THEME, {
        theme: environment.theme,
        reducedMotion: environment.reducedMotion,
      });
    }
  }

  return Object.freeze({
    launch,
    reload,
    pause,
    resume,
    destroy,
    getState,
    handleAgentState,
    updateEnvironment,
  });
}
