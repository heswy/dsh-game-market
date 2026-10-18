/**
 * Trusted-side bridge (PRD §8.4 postMessage protocol).
 *
 * Pure message routing: source identity is injected by the controller; all
 * timers and the outgoing `send` are injected so this module is testable
 * without a DOM.
 *
 * Responsibilities:
 *   - validate envelope structure, per-10s invalid budget, per-second rate;
 *   - route game -> Runtime requests to `onRequest`, with per-method timeouts;
 *   - serialize the documented write methods;
 *   - send Runtime -> game requests (`ping`) and match responses by id;
 *   - emit events (`init`, `pause`, `before-save`, ...).
 */

import { PROTOCOL_VERSION } from '../../shared/src/constants.js';
import { GM, isGmCode } from '../../shared/src/errors.js';
import { EVENTS, GAME_TO_RUNTIME_METHODS, MAX_INFLIGHT_REQUESTS, MAX_INVALID_MESSAGES_PER_10S, MAX_MESSAGES_PER_SECOND, METHODS, createErrorResponse, createEvent, createRequest, createResponse, isPlainObject, validateBridgeMessage } from '../../shared/src/protocol.js';

export const BRIDGE_METHOD_TIMEOUTS = Object.freeze({
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

const WRITE_METHODS = Object.freeze([
  METHODS.STORAGE_SAVE,
  METHODS.STORAGE_REMOVE,
  METHODS.SESSION_START,
  METHODS.SESSION_END,
  METHODS.SCORE_SUBMIT,
]);

function bridgeError(code, message, retryable) {
  return { code: isGmCode(code) ? code : GM.INTERNAL, message, retryable: retryable === true };
}

function normalizeError(error) {
  if (error && isGmCode(error.code)) {
    return bridgeError(error.code, error.message || 'Bridge request failed', error.retryable === true);
  }
  return bridgeError(GM.INTERNAL, 'Bridge request failed', false);
}

/**
 * @param {{
 *   instanceId: string,
 *   nonce: string,
 *   isTrustedSource: (source: unknown) => boolean,
 *   send: (message: object) => void,
 *   onRequest: (method: string, params: object) => Promise<unknown>|unknown,
 *   onHello: (data: object) => void,
 *   onFatal?: (error: {code:string,message:string,retryable:boolean}) => void,
 *   timers?: {setTimeout: Function, clearTimeout: Function},
 *   now?: () => number,
 * }} options
 */
export function createRuntimeBridge(options = {}) {
  const instanceId = options.instanceId;
  const nonce = options.nonce;
  const isTrustedSource =
    typeof options.isTrustedSource === 'function' ? options.isTrustedSource : function alwaysFalse() { return false; };
  const send = typeof options.send === 'function' ? options.send : function noop() {};
  const onRequest = typeof options.onRequest === 'function' ? options.onRequest : function notFound() {};
  const onHello = typeof options.onHello === 'function' ? options.onHello : function noop() {};
  const onFatal = typeof options.onFatal === 'function' ? options.onFatal : function noop() {};
  const timers = options.timers || globalThis;
  const now = typeof options.now === 'function' ? options.now : Date.now;

  let initialized = false;
  let readyAcknowledged = false;
  let destroyed = false;
  let fatalSent = false;
  let sequence = 0;
  let writeTail = Promise.resolve();
  const pending = new Map();
  let invalidTimestamps = [];
  let rateTimestamps = [];

  function pruneWindow(list, windowMs, timestamp) {
    const cutoff = timestamp - windowMs;
    let index = 0;
    while (index < list.length && list[index] <= cutoff) index += 1;
    if (index > 0) list.splice(0, index);
    return list;
  }

  function noteInvalid(code, message) {
    if (destroyed) return;
    const timestamp = now();
    pruneWindow(invalidTimestamps, 10000, timestamp);
    invalidTimestamps.push(timestamp);
    if (invalidTimestamps.length > MAX_INVALID_MESSAGES_PER_10S && !fatalSent) {
      fatalSent = true;
      onFatal(bridgeError(GM.MESSAGE_INVALID, 'Too many invalid bridge messages', false));
    }
    return { code, message };
  }

  function trackRate() {
    const timestamp = now();
    pruneWindow(rateTimestamps, 1000, timestamp);
    if (rateTimestamps.length >= MAX_MESSAGES_PER_SECOND) return false;
    rateTimestamps.push(timestamp);
    return true;
  }

  function sendResponse(id, result, error) {
    const message = error ? createErrorResponse(id, error) : createResponse(id, result);
    send(message);
    return message;
  }

  function withTimeout(work, timeoutMs, method) {
    return new Promise(function executor(resolve, reject) {
      let settled = false;
      const timer = timers.setTimeout(function onTimeout() {
        if (settled) return;
        settled = true;
        reject(bridgeError(GM.BRIDGE_TIMEOUT, `Bridge request timed out: ${method}`, true));
      }, timeoutMs);
      Promise.resolve()
        .then(work)
        .then(
          function onOk(value) {
            if (settled) return;
            settled = true;
            timers.clearTimeout(timer);
            resolve(value);
          },
          function onError(error) {
            if (settled) return;
            settled = true;
            timers.clearTimeout(timer);
            reject(error);
          }
        );
    });
  }

  function enqueueWrite(work) {
    const run = writeTail.then(work, work);
    writeTail = run.then(function ignore() {}, function ignore() {});
    return run;
  }

  function handleResponse(message) {
    const entry = pending.get(message.id);
    if (!entry) return null;
    pending.delete(message.id);
    timers.clearTimeout(entry.timer);
    if (message.ok === true) {
      entry.resolve(message.result === undefined ? null : message.result);
    } else {
      const error = message.error || {};
      entry.reject(bridgeError(error.code || GM.INTERNAL, error.message || 'Bridge error', error.retryable === true));
    }
    return null;
  }

  function handleEvent(message) {
    if (message.event !== EVENTS.HELLO) return null; // unknown game -> Runtime events are ignored
    const data = message.data;
    if (!isPlainObject(data) || data.instanceId !== instanceId || data.nonce !== nonce) {
      noteInvalid(GM.MESSAGE_INVALID, 'Invalid hello identity');
      return null;
    }
    onHello(data);
    return null;
  }

  function handleRequest(message) {
    if (!initialized) {
      return Promise.resolve(
        sendResponse(message.id, null, bridgeError(GM.NOT_READY, 'Handshake has not started', false))
      );
    }
    if (!readyAcknowledged && message.method !== METHODS.READY) {
      return Promise.resolve(sendResponse(message.id, null, bridgeError(GM.NOT_READY, 'Game is not ready', false)));
    }
    if (!GAME_TO_RUNTIME_METHODS.includes(message.method)) {
      return Promise.resolve(
        sendResponse(message.id, null, bridgeError(GM.UNKNOWN_METHOD, 'Unknown bridge method', false))
      );
    }
    const params = message.params && typeof message.params === 'object' ? message.params : {};
    const timeoutMs = BRIDGE_METHOD_TIMEOUTS[message.method] || 5000;
    const run = function run() {
      return withTimeout(function work() {
        return onRequest(message.method, params);
      }, timeoutMs, message.method);
    };
    const promise = WRITE_METHODS.includes(message.method) ? enqueueWrite(run) : run();
    return promise.then(
      function onResult(result) {
        return sendResponse(message.id, result === undefined ? null : result);
      },
      function onFailure(error) {
        return sendResponse(message.id, null, normalizeError(error));
      }
    );
  }

  function handleIncoming(data, source) {
    if (destroyed) return Promise.resolve(null);
    if (!isTrustedSource(source)) {
      noteInvalid(GM.MESSAGE_INVALID, 'Untrusted bridge source');
      return Promise.resolve(null);
    }
    if (!trackRate()) {
      noteInvalid(GM.RATE_LIMITED, 'Bridge message rate exceeded');
      return Promise.resolve(null);
    }
    const checked = validateBridgeMessage(data);
    if (!checked.ok) {
      noteInvalid(checked.code || GM.MESSAGE_INVALID, checked.message);
      return Promise.resolve(null);
    }
    const message = checked.message;
    try {
      if (message.kind === 'res') return Promise.resolve(handleResponse(message));
      if (message.kind === 'evt') return Promise.resolve(handleEvent(message));
      return handleRequest(message).then(undefined, function ignore() { return null; });
    } catch (_error) {
      noteInvalid(GM.MESSAGE_INVALID, 'Bridge handler threw');
      return Promise.resolve(null);
    }
  }

  function sendRequest(method, params, timeoutMs) {
    if (destroyed) return Promise.reject(bridgeError(GM.NO_RUNTIME, 'Game Runtime was closed', false));
    if (pending.size >= MAX_INFLIGHT_REQUESTS) {
      return Promise.reject(bridgeError(GM.BACKPRESSURE, 'Too many in-flight bridge requests', true));
    }
    const ms = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : BRIDGE_METHOD_TIMEOUTS[method] || 5000;
    return new Promise(function executor(resolve, reject) {
      sequence += 1;
      const id = `rt-${sequence}`;
      const timer = timers.setTimeout(function onTimeout() {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(bridgeError(GM.BRIDGE_TIMEOUT, `Bridge request timed out: ${method}`, true));
      }, ms);
      pending.set(id, { resolve, reject, timer });
      send(createRequest(id, method, params));
    });
  }

  function sendEvent(event, data) {
    if (destroyed) return false;
    send(createEvent(event, data));
    return true;
  }

  function markInitialized() {
    initialized = true;
  }

  function isInitialized() {
    return initialized;
  }

  function markReady() {
    readyAcknowledged = true;
  }

  function isReadyAcknowledged() {
    return readyAcknowledged;
  }

  function getInvalidCount() {
    return invalidTimestamps.length;
  }

  function getPendingCount() {
    return pending.size;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const entry of pending.values()) {
      timers.clearTimeout(entry.timer);
      entry.reject(bridgeError(GM.NO_RUNTIME, 'Game Runtime was closed', false));
    }
    pending.clear();
    invalidTimestamps = [];
    rateTimestamps = [];
  }

  return {
    handleIncoming,
    sendRequest,
    sendEvent,
    markInitialized,
    isInitialized,
    markReady,
    isReadyAcknowledged,
    getInvalidCount,
    getPendingCount,
    destroy,
  };
}
