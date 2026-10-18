/**
 * postMessage bridge protocol helpers shared by Runtime and SDK (PRD §8.4).
 *
 * Runtime is the trusted side; SDK is the iframe-side client. Both must accept
 * only the exact envelope shapes below and reject everything else.
 */

import { GM } from './errors.js';
import { LIMITS, PROTOCOL_VERSION } from './constants.js';

export const BRIDGE_VERSION = PROTOCOL_VERSION;
export const MAX_BRIDGE_MESSAGE_BYTES = LIMITS.saveTotalBytes + 64 * 1024;
export const MAX_BRIDGE_DEPTH = 32;
export const MAX_INFLIGHT_REQUESTS = 32;
export const MAX_INVALID_MESSAGES_PER_10S = 50;
export const MAX_MESSAGES_PER_SECOND = 200;

export const METHODS = Object.freeze({
  READY: 'ready',
  PING: 'ping',
  STORAGE_SAVE: 'storage.save',
  STORAGE_LOAD: 'storage.load',
  STORAGE_REMOVE: 'storage.remove',
  SESSION_START: 'session.start',
  SESSION_END: 'session.end',
  SCORE_SUBMIT: 'score.submit',
  SCORE_GET_BEST: 'score.getBest',
  AGENT_GET_STATUS: 'agent.getStatus',
});

export const EVENTS = Object.freeze({
  HELLO: 'hello',
  INIT: 'init',
  PAUSE: 'pause',
  RESUME: 'resume',
  HIDDEN: 'hidden',
  VISIBLE: 'visible',
  BEFORE_SAVE: 'before-save',
  AGENT_STATUS: 'agent-status',
  THEME: 'theme',
  VIEWPORT: 'viewport',
});

/** Runtime → game methods list (SDK side handles these). */
export const RUNTIME_TO_GAME_METHODS = Object.freeze(['ping']);
/** Game → Runtime methods list (Runtime side handles these). */
export const GAME_TO_RUNTIME_METHODS = Object.freeze([
  METHODS.READY,
  METHODS.STORAGE_SAVE,
  METHODS.STORAGE_LOAD,
  METHODS.STORAGE_REMOVE,
  METHODS.SESSION_START,
  METHODS.SESSION_END,
  METHODS.SCORE_SUBMIT,
  METHODS.SCORE_GET_BEST,
  METHODS.AGENT_GET_STATUS,
]);

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** 32 lowercase hex chars from the platform CSPRNG; works in browser + Node. */
export function randomHex32() {
  const bytes = new Uint8Array(16);
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues is unavailable');
  }
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createInstanceId() {
  return randomHex32();
}

export function createNonce() {
  return randomHex32();
}

/** UTF-8 byte length of the JSON serialization; throws on non-JSON values. */
export function jsonByteLength(value) {
  return byteLength(JSON.stringify(value));
}

export function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

/**
 * Validate a JSON value: finite numbers, plain objects/arrays, depth-bounded,
 * no prototype-pollution keys. Returns a cloned plain value.
 */
export function cloneJsonValue(value, depth = 0) {
  if (depth > MAX_BRIDGE_DEPTH) {
    throw protocolError(GM.VALUE_NOT_SERIALIZABLE, 'Value nesting is too deep');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw protocolError(GM.VALUE_NOT_SERIALIZABLE, 'Number must be finite');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => cloneJsonValue(item, depth + 1));
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw protocolError(GM.VALUE_NOT_SERIALIZABLE, `Forbidden key: ${key}`);
      }
      out[key] = cloneJsonValue(value[key], depth + 1);
    }
    return out;
  }
  throw protocolError(GM.VALUE_NOT_SERIALIZABLE, `Unsupported value type: ${typeof value}`);
}

export function isValidStorageKey(key) {
  return typeof key === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(key) && !FORBIDDEN_KEYS.has(key);
}

export function protocolError(code, message) {
  return { code, message, retryable: false };
}

export function createRequest(id, method, params) {
  return { v: BRIDGE_VERSION, id, kind: 'req', method, params: params === undefined ? {} : params };
}

export function createResponse(id, result) {
  return { v: BRIDGE_VERSION, id, kind: 'res', ok: true, result };
}

export function createErrorResponse(id, error) {
  return { v: BRIDGE_VERSION, id, kind: 'res', ok: false, error };
}

export function createEvent(event, data) {
  return { v: BRIDGE_VERSION, kind: 'evt', event, ...(data === undefined ? {} : { data }) };
}

export function envelopeByteSize(message) {
  try {
    return jsonByteLength(message);
  } catch (_error) {
    return Infinity;
  }
}

/**
 * Structural validation. Sender/source identity and nonce matching stay with
 * the caller because they are transport-specific.
 *
 * @returns {{ok: true, message: object} | {ok: false, code: string, message: string}}
 */
export function validateBridgeMessage(raw) {
  if (!isPlainObject(raw)) return invalid('Message must be a plain object');
  if (raw.v !== BRIDGE_VERSION) return invalid(`Unsupported protocol version: ${String(raw.v)}`, GM.PROTOCOL_MISMATCH);
  if (raw.kind === 'req') {
    if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 64) return invalid('Invalid request id');
    if (typeof raw.method !== 'string' || raw.method.length === 0 || raw.method.length > 64) return invalid('Invalid method');
    if (raw.params !== undefined && !isPlainObject(raw.params)) return invalid('params must be an object');
    if (envelopeByteSize(raw) > MAX_BRIDGE_MESSAGE_BYTES) return invalid('Message too large');
    return { ok: true, message: raw };
  }
  if (raw.kind === 'res') {
    if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 64) return invalid('Invalid response id');
    if (raw.ok === true) return { ok: true, message: raw };
    if (raw.ok === false && isPlainObject(raw.error) && typeof raw.error.code === 'string') {
      return { ok: true, message: raw };
    }
    return invalid('Invalid error response');
  }
  if (raw.kind === 'evt') {
    if (typeof raw.event !== 'string' || raw.event.length === 0 || raw.event.length > 64) return invalid('Invalid event name');
    if (envelopeByteSize(raw) > MAX_BRIDGE_MESSAGE_BYTES) return invalid('Message too large');
    return { ok: true, message: raw };
  }
  return invalid(`Unknown message kind: ${String(raw.kind)}`);
}

function invalid(message, code = GM.MESSAGE_INVALID) {
  return { ok: false, code, message };
}

/**
 * SDK handshake inputs come from the URL query. Runtime puts them there.
 * @returns {{instanceId: string, nonce: string} | null}
 */
export function parseLaunchQuery(search) {
  try {
    const params = new URLSearchParams(search || '');
    const instanceId = params.get('instance') || '';
    const nonce = params.get('nonce') || '';
    if (!/^[a-f0-9]{32}$/.test(instanceId) || !/^[a-f0-9]{32}$/.test(nonce)) return null;
    return { instanceId, nonce };
  } catch (_error) {
    return null;
  }
}

/** Narrow runtime info handed to the game in `init`. */
export function createRuntimeInfo(fields) {
  return {
    sdkVersion: fields.sdkVersion,
    protocolVersion: BRIDGE_VERSION,
    runtimeVersion: fields.runtimeVersion,
    gameId: fields.gameId,
    gameVersion: fields.gameVersion,
    locale: fields.locale || 'zh',
    theme: fields.theme === 'dark' ? 'dark' : 'light',
    reducedMotion: fields.reducedMotion === true,
    capabilities: Array.isArray(fields.capabilities) ? fields.capabilities.slice() : [],
    viewport: {
      width: Number(fields.viewport?.width) || 0,
      height: Number(fields.viewport?.height) || 0,
      dpr: Number(fields.viewport?.dpr) || 1,
    },
    ready: fields.ready === true,
  };
}
