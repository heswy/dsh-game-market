/**
 * Runtime-side request service (PRD §8.3 methods table).
 *
 * Pure logic: maps bridge methods onto the injected Host API client, applies
 * save limits and capability checks, and turns everything into plain
 * `{ code, message, retryable }` errors. No DOM, no timers.
 */

import { AGENT_LABELS_ZH, LIMITS, SESSION_OUTCOMES } from '../../shared/src/constants.js';
import { GM, isGmCode, makeGameError } from '../../shared/src/errors.js';
import { METHODS, isValidStorageKey } from '../../shared/src/protocol.js';

const STORAGE_METHODS = Object.freeze([METHODS.STORAGE_SAVE, METHODS.STORAGE_LOAD, METHODS.STORAGE_REMOVE]);
const SCORE_METHODS = Object.freeze([METHODS.SCORE_SUBMIT, METHODS.SCORE_GET_BEST]);
const MAX_SCORE_ABS = 1e12;

function errorOf(code, message, options) {
  return makeGameError(code, message, options);
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

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function idleSnapshot(timestamp) {
  return {
    state: 'idle',
    label: AGENT_LABELS_ZH.idle,
    labelKey: null,
    sessionId: null,
    updatedAt: timestamp,
    source: 'lifecycle',
    seq: 0,
    since: timestamp,
    turnId: null,
  };
}

/** Validate the JSON value once more on the Runtime side (defense in depth). */
function checkSerializable(value) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch (_error) {
    throw errorOf(GM.VALUE_NOT_SERIALIZABLE, 'Value is not JSON-serializable');
  }
  if (text === undefined) throw errorOf(GM.VALUE_NOT_SERIALIZABLE, 'Value is not JSON-serializable');
  return text;
}

function rejectUnsafeProto(value, depth) {
  if (depth > 32 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) rejectUnsafeProto(item, depth + 1);
    return;
  }
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw errorOf(GM.VALUE_NOT_SERIALIZABLE, `Forbidden key: ${key}`);
    }
    rejectUnsafeProto(value[key], depth + 1);
  }
}

/**
 * @param {{
 *   api: object,
 *   getGameId: () => string,
 *   getAgentSnapshot: () => object|null,
 *   onSaveOutcome?: (outcome: {ok: boolean, error?: object}) => void,
 *   capabilities?: string[],
 *   limits?: object,
 *   now?: () => number,
 * }} options
 */
export function createRequestService(options = {}) {
  const api = options.api;
  const getGameId = typeof options.getGameId === 'function' ? options.getGameId : function noGame() { return null; };
  const getAgentSnapshot =
    typeof options.getAgentSnapshot === 'function' ? options.getAgentSnapshot : function noAgent() { return null; };
  const onSaveOutcome =
    typeof options.onSaveOutcome === 'function' ? options.onSaveOutcome : function noop() {};
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const capabilities = Array.isArray(options.capabilities) ? options.capabilities.slice() : [];
  const limits = normalizeLimits(options.limits);
  const keySizes = new Map();
  let playSessionId = null;
  let revision = 0;

  function requireCapability(name) {
    if (!capabilities.includes(name)) {
      throw errorOf(GM.CAPABILITY_DENIED, `Game did not declare the "${name}" capability`);
    }
  }

  function requireGameId() {
    const gameId = getGameId();
    if (typeof gameId !== 'string' || gameId.length === 0) {
      throw errorOf(GM.INVALID_PARAM, 'Game instance has no gameId');
    }
    return gameId;
  }

  function totalBytes() {
    let total = 0;
    for (const bytes of keySizes.values()) total += bytes;
    return total;
  }

  function assertStorageKey(key) {
    if (!isValidStorageKey(key)) throw errorOf(GM.STORAGE_KEY_INVALID, 'Invalid storage key');
  }

  async function storageSave(params) {
    requireCapability('storage');
    const gameId = requireGameId();
    const key = params.key;
    assertStorageKey(key);
    if (!hasOwn(params, 'data')) throw errorOf(GM.INVALID_PARAM, 'storage.save requires data');
    const data = params.data;
    rejectUnsafeProto(data, 0);
    const serialized = checkSerializable(data);
    const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(serialized).length : serialized.length;
    if (bytes > LIMITS.saveValueBytes) {
      throw errorOf(GM.SAVE_TOO_LARGE, `Value exceeds ${LIMITS.saveValueBytes} bytes`);
    }
    const previous = keySizes.has(key) ? keySizes.get(key) : 0;
    if (!keySizes.has(key) && keySizes.size >= limits.saveKeys) {
      throw errorOf(GM.STORAGE_QUOTA, `Save has more than ${limits.saveKeys} keys`);
    }
    if (totalBytes() - previous + bytes > limits.saveBytes) {
      throw errorOf(GM.STORAGE_QUOTA, `Save exceeds ${limits.saveBytes} bytes`);
    }

    try {
      const result = await api.setSave({ gameId, key, data });
      keySizes.set(key, bytes);
      if (result && typeof result.revision === 'number') revision = result.revision;
      onSaveOutcome({ ok: true });
      return {
        key,
        bytes,
        revision: result && typeof result.revision === 'number' ? result.revision : revision,
        updatedAt: result && result.updatedAt ? result.updatedAt : null,
      };
    } catch (error) {
      onSaveOutcome({ ok: false, error: normalizeApiError(error) });
      throw error;
    }
  }

  async function storageLoad(params) {
    requireCapability('storage');
    const gameId = requireGameId();
    const key = params.key;
    assertStorageKey(key);
    let save;
    try {
      save = await api.getSave(gameId, { includeData: true });
    } catch (error) {
      if (error && error.code === GM.SAVE_NOT_FOUND) return null;
      throw error;
    }
    if (!save || typeof save !== 'object') return null;
    if (typeof save.revision === 'number') revision = save.revision;
    const values = save.values && typeof save.values === 'object' ? save.values : {};
    if (!hasOwn(values, key)) return null;
    return {
      key,
      data: values[key],
      revision: typeof save.revision === 'number' ? save.revision : revision,
      updatedAt: save.updatedAt || null,
    };
  }

  async function storageRemove(params) {
    requireCapability('storage');
    const gameId = requireGameId();
    const key = params.key;
    assertStorageKey(key);
    if (typeof api.removeSave !== 'function') {
      throw errorOf(GM.HOST_UNAVAILABLE, 'Host API does not support save removal');
    }
    let result;
    try {
      result = await api.removeSave({ gameId, key });
    } catch (error) {
      onSaveOutcome({ ok: false, error: normalizeApiError(error) });
      throw error;
    }
    keySizes.delete(key);
    if (result && typeof result.revision === 'number') revision = result.revision;
    onSaveOutcome({ ok: true });
    return {
      key,
      removed: true,
      revision: result && typeof result.revision === 'number' ? result.revision : revision,
    };
  }

  async function sessionStart() {
    const gameId = requireGameId();
    const result = await api.startSession({ gameId });
    playSessionId = result && result.playSessionId ? result.playSessionId : null;
    return {
      playSessionId: result && result.playSessionId ? result.playSessionId : null,
      startedAt: result && result.startedAt ? result.startedAt : null,
      adopted: Boolean(result && result.adopted),
    };
  }

  async function sessionEnd(params) {
    const gameId = requireGameId();
    const outcome = params.outcome === undefined ? 'completed' : params.outcome;
    if (!SESSION_OUTCOMES.includes(outcome)) throw errorOf(GM.INVALID_PARAM, 'Invalid session outcome');
    let score = null;
    if (params.score !== undefined && params.score !== null) {
      if (typeof params.score !== 'number' || !Number.isFinite(params.score) || Math.abs(params.score) > MAX_SCORE_ABS) {
        throw errorOf(GM.INVALID_PARAM, 'Invalid session score');
      }
      score = params.score;
    }
    if (!playSessionId) return null;
    const activePlaySessionId = playSessionId;
    const result = await api.endSession({ gameId, playSessionId: activePlaySessionId, outcome, score });
    playSessionId = null;
    return result || null;
  }

  async function scoreSubmit(params) {
    requireCapability('score');
    const gameId = requireGameId();
    const score = params.score;
    if (typeof score !== 'number' || !Number.isFinite(score) || Math.abs(score) > MAX_SCORE_ABS) {
      throw errorOf(GM.INVALID_PARAM, 'Score must be a finite number');
    }
    let meta = params.meta === undefined ? null : params.meta;
    if (meta !== null) {
      rejectUnsafeProto(meta, 0);
      const text = checkSerializable(meta);
      const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length;
      if (bytes > limits.scoreMetaBytes) throw errorOf(GM.INVALID_PARAM, 'Score meta is too large');
    }
    const result = await api.submitScore({ gameId, score, meta, playSessionId });
    const best = result && result.best && typeof result.best === 'object' ? result.best.value : result && result.best;
    return {
      best: typeof best === 'number' ? best : null,
      isBest: Boolean(result && result.isBest),
      submittedAt: result && result.submittedAt ? result.submittedAt : null,
    };
  }

  async function scoreGetBest() {
    requireCapability('score');
    const gameId = requireGameId();
    const result = await api.getScores(gameId);
    const best = result && result.best ? result.best : null;
    if (!best) return null;
    return {
      score: typeof best.value === 'number' ? best.value : 0,
      achievedAt: best.achievedAt || null,
      meta: best.meta === undefined ? null : best.meta,
    };
  }

  function agentGetStatus() {
    const snapshot = getAgentSnapshot();
    if (!snapshot || typeof snapshot !== 'object') {
      return idleSnapshot(new Date(now()).toISOString());
    }
    return snapshot;
  }

  async function handle(method, params) {
    const input = params && typeof params === 'object' ? params : {};
    if (STORAGE_METHODS.includes(method)) return handleStorage(method, input);
    if (SCORE_METHODS.includes(method)) return handleScore(method, input);
    if (method === METHODS.SESSION_START) return sessionStart();
    if (method === METHODS.SESSION_END) return sessionEnd(input);
    if (method === METHODS.AGENT_GET_STATUS) return agentGetStatus();
    throw errorOf(GM.UNKNOWN_METHOD, `Unknown method: ${String(method)}`);
  }

  function handleStorage(method, params) {
    if (method === METHODS.STORAGE_SAVE) return storageSave(params);
    if (method === METHODS.STORAGE_LOAD) return storageLoad(params);
    return storageRemove(params);
  }

  function handleScore(method, params) {
    if (method === METHODS.SCORE_SUBMIT) return scoreSubmit(params);
    return scoreGetBest();
  }

  return {
    handle,
    getPlaySessionId: function getPlaySessionId() {
      return playSessionId;
    },
    getRevision: function getRevision() {
      return revision;
    },
    getKeyCount: function getKeyCount() {
      return keySizes.size;
    },
    getTotalBytes: totalBytes,
  };
}

/** Turn a GameMarketApiError / GM-shaped object into the bridge error payload. */
export function normalizeApiError(error) {
  if (error && isGmCode(error.code)) {
    return { code: error.code, message: error.message || 'Game Market request failed', retryable: error.retryable === true };
  }
  return { code: GM.INTERNAL, message: 'Game Market request failed', retryable: false };
}
