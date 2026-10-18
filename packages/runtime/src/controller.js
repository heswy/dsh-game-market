/**
 * Game Runtime controller (PRD §8.4 / §9.6).
 *
 * Owns the single sandbox iframe, the bridge, the autosave scheduler and the
 * page state machine. The DOM layer is deliberately thin: tests inject a fake
 * `window` / `document` / clock into this same controller.
 *
 * Security invariants:
 *   - exactly one iframe, `sandbox="allow-scripts"` (never allow-same-origin);
 *   - no game data is placed in host DOM attributes;
 *   - the game never receives DSH objects, paths or credentials.
 */

import { INSTANCE_ID_PATTERN, LIMITS, NONCE_PATTERN, RUNTIME_VERSION, SDK_VERSION, TIMING } from '../../shared/src/constants.js';
import { GM, defaultMessageFor, isGmCode, makeGameError } from '../../shared/src/errors.js';
import { BRIDGE_VERSION, EVENTS, METHODS, isPlainObject } from '../../shared/src/protocol.js';
import { createRuntimeBridge } from './bridge.js';
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
  let iframeWindow = null;
  let iframeLoaded = false;
  let bridge = null;
  let scheduler = null;
  let requests = null;
  let destroyed = false;
  let generation = 0;
  let viewport = { width: 0, height: 0, dpr: 1 };
  let agentSnapshot = null;

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
      ready: true,
    };
  }

  function handleSaveOutcome(outcome) {
    if (scheduler && scheduler.noteSave(outcome)) return;
    emit({ type: 'save-status', status: outcome && outcome.ok ? 'saved' : 'failed', at: now() });
  }

  function handleHello() {
    if (!bridge) return;
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
      fail(GM.LOAD_TIMEOUT, 'Game failed to load in time', true);
    }, TIMING.loadErrorMs);
  }

  function onIframeLoad() {
    iframeLoaded = true;
    loadSlowTimer = clearTimer(loadSlowTimer);
    loadErrorTimer = clearTimer(loadErrorTimer);
    if (bridge && bridge.isReadyAcknowledged()) startPing();
    if (iframe && typeof iframe.focus === 'function') {
      try {
        iframe.focus();
      } catch (_error) {
        // focus can fail if the element was detached
      }
    }
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

  function pause(reason) {
    const pauseReason = PAUSE_REASONS.includes(reason) ? reason : 'user';
    if (pausePromise) return pausePromise;
    if (!launchInfo || !bridge || machine.get() !== 'playing') {
      return Promise.resolve({ ok: true, saveStale: false });
    }
    const token = generation;
    scheduler.stop();
    enterState('paused');
    bridge.sendEvent(EVENTS.PAUSE, { reason: pauseReason, at: now() });
    if (!launchInfo.capabilities.includes('storage')) {
      return Promise.resolve({ ok: true, saveStale: false });
    }
    enterState('saving');
    pausePromise = scheduler.save(pauseSaveReason(pauseReason)).then(
      function onSaved(result) {
        pausePromise = null;
        if (token !== generation || destroyed) return { ok: Boolean(result.ok), saveStale: result.saveStale };
        if (machine.get() === 'saving') enterState('paused');
        return { ok: Boolean(result.ok), saveStale: result.saveStale };
      },
      function onSaveError() {
        pausePromise = null;
        if (token !== generation || destroyed) return { ok: false, saveStale: true };
        if (machine.get() === 'saving') enterState('paused');
        return { ok: false, saveStale: true };
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

    if (iframe) {
      if (iframeLoadHandler && typeof iframe.removeEventListener === 'function') {
        iframe.removeEventListener('load', iframeLoadHandler);
      }
      if (iframeErrorHandler && typeof iframe.removeEventListener === 'function') {
        iframe.removeEventListener('error', iframeErrorHandler);
      }
      try {
        if (typeof iframe.remove === 'function') iframe.remove();
        else if (iframe.parentNode && typeof iframe.parentNode.removeChild === 'function') {
          iframe.parentNode.removeChild(iframe);
        }
      } catch (_error) {
        // detached already
      }
    }
    iframe = null;
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

  function createIframe(info) {
    if (!doc || typeof doc.createElement !== 'function') {
      throw new Error('Game Runtime needs a document to create the iframe');
    }
    const frame = doc.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('allow', 'autoplay');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('loading', 'eager');
    frame.setAttribute('title', `Game: ${info.gameId}`);
    frame.setAttribute('src', info.entryUrl);
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
    container.appendChild(frame);
    iframe = frame;
    iframeWindow = frame.contentWindow || null;
  }

  async function launch(info) {
    if (destroyed) throw makeGameError(GM.NO_RUNTIME, 'Game Runtime was destroyed');
    const normalized = normalizeLaunchInfo(info);
    if (iframe || bridge) cleanupDom();
    machine.reset('idle');
    launchInfo = normalized;
    pausePromise = null;

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
        emit({ type: 'save-status', status, at });
      },
    });

    bridge = createRuntimeBridge({
      instanceId: normalized.instanceId,
      nonce: normalized.nonce,
      isTrustedSource: function isTrustedSource(source) {
        return Boolean(iframeWindow && source === iframeWindow);
      },
      send: sendToGame,
      onRequest: handleBridgeRequest,
      onHello: handleHello,
      onFatal: function onFatal(error) {
        fail(error.code, error.message, error.retryable);
        if (error.code === GM.MESSAGE_INVALID) cleanupDom();
      },
      timers,
      now,
    });

    try {
      createIframe(normalized);
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
    handshakeTimer = timers.setTimeout(function handshakeTimeout() {
      handshakeTimer = null;
      if (!bridge || bridge.isReadyAcknowledged() || destroyed) return;
      fail(GM.HANDSHAKE_TIMEOUT, 'Game handshake timed out');
    }, TIMING.handshakeTimeoutMs);
    startLoadTimers();
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
    pause,
    resume,
    destroy,
    getState,
    handleAgentState,
    updateEnvironment,
  });
}
