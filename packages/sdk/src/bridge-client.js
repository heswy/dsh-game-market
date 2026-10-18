/**
 * iframe-side bridge client (PRD §8.4 postMessage protocol).
 *
 * Runs inside the sandboxed game iframe. It only knows `window.parent` and
 * `location.search`; it never touches host DOM, storage or network.
 *
 * Handshake:
 *   hello (every 250ms, at most 30 times) -> init -> ready request -> ready.
 */

import { PROTOCOL_VERSION, SDK_VERSION, TIMING } from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import { EVENTS, MAX_INFLIGHT_REQUESTS, METHODS, createErrorResponse, createEvent, createRequest, createResponse, isPlainObject, parseLaunchQuery, validateBridgeMessage } from '../../shared/src/protocol.js';
import { createGameError, toGameError } from './errors.js';
import { negotiateSdkRange } from './version.js';

export const SDK_METHOD_TIMEOUTS = Object.freeze({
  ready: 10000,
  ping: 2000,
  'storage.save': 6000,
  'storage.load': 3000,
  'storage.remove': 3000,
  'session.start': 4000,
  'session.end': 6000,
  'score.submit': 4000,
  'score.getBest': 3000,
  'agent.getStatus': 2000,
});

const HELLO_INTERVAL_MS = 250;
const MAX_HELLO_COUNT = 30;
const READY_EVENT_NAMES = Object.freeze([EVENTS.PAUSE, EVENTS.RESUME, EVENTS.HIDDEN, EVENTS.VISIBLE, EVENTS.BEFORE_SAVE]);

export function createBridgeClient(options = {}) {
  const win = options.window || null;
  const parent = options.parent || null;
  const location = options.location || null;
  const timers = options.timers || globalThis;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const cryptoApi = options.crypto || (win && win.crypto) || null;
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : function noop() {};
  const onInit = typeof options.onInit === 'function' ? options.onInit : function noop() {};
  const onFatal = typeof options.onFatal === 'function' ? options.onFatal : function noop() {};

  const launchQuery = parseLaunchQuery(location && location.search);
  const available = Boolean(
    win &&
      parent &&
      parent !== win &&
      typeof parent.postMessage === 'function' &&
      launchQuery
  );

  let started = false;
  let disposed = false;
  let readySettled = false;
  let ready = false;
  let fatalError = null;
  let helloCount = 0;
  let helloTimer = null;
  let deadlineTimer = null;
  let listenerAttached = false;
  let initData = null;
  let readyResult = null;
  let requestSeq = 0;
  let invalidMessages = 0;
  let sdkAhead = false;
  let readyTimeoutMs = TIMING.handshakeTimeoutMs;
  const pending = new Map();

  let resolveReady = null;
  let rejectReady = null;
  const readyPromise = new Promise(function executor(resolve, reject) {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // The promise may be observed later (or never); keep the rejection handled.
  readyPromise.then(undefined, function ignore() {});

  function isAvailable() {
    return available;
  }

  function attachListener() {
    if (listenerAttached || !win || typeof win.addEventListener !== 'function') return;
    win.addEventListener('message', handleMessage);
    listenerAttached = true;
  }

  function detachListener() {
    if (!listenerAttached || !win || typeof win.removeEventListener !== 'function') return;
    win.removeEventListener('message', handleMessage);
    listenerAttached = false;
  }

  function nextId() {
    requestSeq += 1;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
      try {
        return cryptoApi.randomUUID();
      } catch (_error) {
        // fall through
      }
    }
    return `m-${requestSeq}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function post(message) {
    if (disposed || !parent) return;
    try {
      parent.postMessage(message, '*');
    } catch (_error) {
      fail(createGameError(GM.NO_RUNTIME, 'Cannot reach the Game Runtime'));
    }
  }

  function clearHandshakeTimers() {
    if (helloTimer !== null) {
      timers.clearTimeout(helloTimer);
      helloTimer = null;
    }
    if (deadlineTimer !== null) {
      timers.clearTimeout(deadlineTimer);
      deadlineTimer = null;
    }
  }

  function clearPending(error) {
    for (const entry of pending.values()) {
      timers.clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  }

  function settleResolve(value) {
    if (readySettled) return;
    readySettled = true;
    clearHandshakeTimers();
    resolveReady(value);
  }

  function fail(error) {
    const gameError = toGameError(error);
    if (disposed) return;
    fatalError = gameError;
    if (!readySettled) {
      readySettled = true;
      clearHandshakeTimers();
      clearPending(gameError);
      rejectReady(gameError);
    }
    onFatal(gameError);
  }

  function start() {
    if (started || disposed) return;
    started = true;
    if (!available) {
      fail(createGameError(GM.NO_RUNTIME, 'Game Runtime is not available (not running inside a sandbox iframe)'));
      return;
    }
    attachListener();
    deadlineTimer = timers.setTimeout(function onDeadline() {
      deadlineTimer = null;
      fail(createGameError(GM.HANDSHAKE_TIMEOUT, 'Game handshake timed out'));
    }, readyTimeoutMs);
    sendHello();
  }

  function sendHello() {
    if (disposed || readySettled || ready) return;
    if (!available) return;
    if (helloCount >= MAX_HELLO_COUNT) {
      fail(createGameError(GM.HANDSHAKE_TIMEOUT, 'Game handshake timed out'));
      return;
    }
    helloCount += 1;
    post(
      createEvent(EVENTS.HELLO, {
        instanceId: launchQuery.instanceId,
        nonce: launchQuery.nonce,
        sdkVersion: SDK_VERSION,
        protocolVersion: PROTOCOL_VERSION,
      })
    );
    helloTimer = timers.setTimeout(sendHello, HELLO_INTERVAL_MS);
  }

  function handleInit(data) {
    if (!isPlainObject(data)) {
      invalidMessages += 1;
      return;
    }
    if (data.instanceId !== launchQuery.instanceId || data.nonce !== launchQuery.nonce) {
      invalidMessages += 1;
      return;
    }
    if (initData) return; // duplicate init after a successful handshake
    if (data.protocolVersion !== PROTOCOL_VERSION) {
      fail(createGameError(GM.PROTOCOL_MISMATCH, 'Unsupported bridge protocol version'));
      return;
    }
    const sdkRange = negotiateSdkRange(SDK_VERSION, data.supportedSdkRange);
    if (!sdkRange.ok) {
      fail(createGameError(GM.PROTOCOL_MISMATCH, 'Game SDK version is not supported by this Runtime'));
      return;
    }
    sdkAhead = sdkRange.ahead;
    initData = data;
    if (helloTimer !== null) {
      timers.clearTimeout(helloTimer);
      helloTimer = null;
    }
    onInit(data);
    dispatchRequest(METHODS.READY, { sdkVersion: SDK_VERSION, protocolVersion: PROTOCOL_VERSION }, readyTimeoutMs).then(
      function onReady(result) {
        if (readySettled || disposed) return;
        if (result !== null && result !== undefined && !isPlainObject(result)) {
          fail(createGameError(GM.PROTOCOL_MISMATCH, 'Invalid ready result'));
          return;
        }
        if (result && result.protocolVersion !== undefined && result.protocolVersion !== PROTOCOL_VERSION) {
          fail(createGameError(GM.PROTOCOL_MISMATCH, 'Unsupported runtime protocol version'));
          return;
        }
        ready = true;
        readyResult = result || {};
        settleResolve({ init: initData, result: readyResult });
      },
      function onReadyError(error) {
        fail(error);
      }
    );
  }

  function handleResponse(message) {
    const entry = pending.get(message.id);
    if (!entry) {
      invalidMessages += 1;
      return;
    }
    pending.delete(message.id);
    timers.clearTimeout(entry.timer);
    if (message.ok === true) {
      entry.resolve(message.result === undefined ? null : message.result);
      return;
    }
    const errorPayload = message.error || {};
    entry.reject(
      createGameError(errorPayload.code || GM.INTERNAL, errorPayload.message, {
        retryable: errorPayload.retryable === true,
        details: errorPayload.details,
      })
    );
  }

  function handleEvent(message) {
    if (message.event === EVENTS.INIT) {
      handleInit(message.data);
      return;
    }
    if (!initData) return;
    if (message.event === EVENTS.AGENT_STATUS) {
      onEvent('agent-status', message.data);
      return;
    }
    if (message.event === EVENTS.THEME) {
      onEvent('theme', message.data);
      return;
    }
    if (message.event === EVENTS.VIEWPORT) {
      onEvent('viewport', message.data);
      return;
    }
    if (READY_EVENT_NAMES.includes(message.event)) {
      onEvent(message.event, message.data || {});
      return;
    }
    // Unknown events are ignored by contract (forward compatibility).
  }

  function handleRequest(message) {
    if (message.method === METHODS.PING) {
      const requestAt = message.params && Number.isFinite(message.params.at) ? message.params.at : now();
      post(createResponse(message.id, { at: requestAt }));
      return;
    }
    post(createErrorResponse(message.id, { code: GM.UNKNOWN_METHOD, message: 'Unknown game method', retryable: false }));
  }

  function handleMessage(event) {
    if (disposed || !event) return;
    if (event.source !== parent) {
      invalidMessages += 1;
      return;
    }
    const checked = validateBridgeMessage(event.data);
    if (!checked.ok) {
      invalidMessages += 1;
      return;
    }
    const message = checked.message;
    try {
      if (message.kind === 'evt') handleEvent(message);
      else if (message.kind === 'req') handleRequest(message);
      else if (message.kind === 'res') handleResponse(message);
    } catch (_error) {
      invalidMessages += 1;
    }
  }

  function dispatchRequest(method, params, timeoutMs) {
    if (disposed) return Promise.reject(createGameError(GM.NO_RUNTIME, 'Game Runtime is not available'));
    if (fatalError) return Promise.reject(fatalError);
    if (pending.size >= MAX_INFLIGHT_REQUESTS) {
      return Promise.reject(createGameError(GM.BACKPRESSURE, 'Too many in-flight bridge requests'));
    }
    const ms = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : SDK_METHOD_TIMEOUTS[method] || 5000;
    return new Promise(function executor(resolve, reject) {
      const id = nextId();
      const timer = timers.setTimeout(function onTimeout() {
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        reject(createGameError(GM.BRIDGE_TIMEOUT, `Bridge request timed out: ${method}`, { retryable: true }));
      }, ms);
      pending.set(id, { resolve, reject, timer });
      post(createRequest(id, method, params));
    });
  }

  function readyWithTimeout(timeoutMs) {
    if (!started && typeof timeoutMs === 'number' && timeoutMs > 0 && timeoutMs < readyTimeoutMs) {
      readyTimeoutMs = timeoutMs;
    }
    start();
    return readyPromise;
  }

  function request(method, params, timeoutMs) {
    if (fatalError) return Promise.reject(fatalError);
    if (!ready) return Promise.reject(createGameError(GM.NOT_READY, 'Game is not ready'));
    return dispatchRequest(method, params, timeoutMs);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearHandshakeTimers();
    detachListener();
    const error = createGameError(GM.NO_RUNTIME, 'Game Runtime was closed');
    clearPending(error);
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
  }

  return Object.freeze({
    isAvailable,
    isReady: function isReady() {
      return ready;
    },
    getFatalError: function getFatalError() {
      return fatalError;
    },
    getInfo: function getInfo() {
      return { init: initData, result: readyResult };
    },
    getDiagnostics: function getDiagnostics() {
      return { helloCount, invalidMessages, pending: pending.size, sdkAhead };
    },
    start,
    ready: readyWithTimeout,
    request,
    dispose,
  });
}
