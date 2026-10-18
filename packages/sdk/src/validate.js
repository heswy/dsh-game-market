/**
 * Client-side pre-flight checks. The Host is authoritative; the SDK runs the
 * same cheap checks locally so obvious mistakes fail with a precise GM code
 * before a message is posted (PRD §8.3).
 */

import { LIMITS, SESSION_OUTCOMES } from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import { MAX_BRIDGE_DEPTH, cloneJsonValue, isValidStorageKey, jsonByteLength } from '../../shared/src/protocol.js';
import { createGameError } from './errors.js';

const MAX_OBJECT_KEYS = 1000;
const MAX_KEY_LENGTH = 128;
const MAX_SCORE_ABS = 1e12;

export function assertStorageKey(key) {
  if (!isValidStorageKey(key)) {
    throw createGameError(GM.STORAGE_KEY_INVALID, `Invalid storage key: ${String(key).slice(0, 64)}`);
  }
}

function cloneValue(value) {
  try {
    return cloneJsonValue(value);
  } catch (error) {
    throw createGameError(GM.VALUE_NOT_SERIALIZABLE, error && error.message ? error.message : 'Value is not JSON-serializable');
  }
}

/** Extra shape rules from PRD §8.3 (depth / object size) that cloneJsonValue does not cover. */
function assertJsonShape(value, depth) {
  if (depth > MAX_BRIDGE_DEPTH) {
    throw createGameError(GM.VALUE_NOT_SERIALIZABLE, 'Value nesting is too deep');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw createGameError(GM.VALUE_NOT_SERIALIZABLE, 'Number must be finite');
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonShape(item, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length > MAX_OBJECT_KEYS) {
      throw createGameError(GM.VALUE_NOT_SERIALIZABLE, 'Object has too many keys');
    }
    for (const key of keys) {
      if (key.length > MAX_KEY_LENGTH) throw createGameError(GM.VALUE_NOT_SERIALIZABLE, 'Object key is too long');
      assertJsonShape(value[key], depth + 1);
    }
    return;
  }
  throw createGameError(GM.VALUE_NOT_SERIALIZABLE, `Unsupported value type: ${typeof value}`);
}

/**
 * @returns {{value: unknown, bytes: number}}
 */
export function prepareStorageValue(data) {
  const value = cloneValue(data);
  assertJsonShape(value, 0);
  const bytes = jsonByteLength(value);
  if (bytes > LIMITS.saveValueBytes) {
    throw createGameError(GM.SAVE_TOO_LARGE, `Value exceeds ${LIMITS.saveValueBytes} bytes`);
  }
  return { value, bytes };
}

/** `meta` is optional; `undefined`/`null` become `null`, never `undefined`. */
export function prepareScoreMeta(meta) {
  if (meta === undefined || meta === null) return null;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    throw createGameError(GM.INVALID_PARAM, 'Score meta must be a JSON object');
  }
  const value = cloneValue(meta);
  assertJsonShape(value, 0);
  const bytes = jsonByteLength(value);
  if (bytes > LIMITS.scoreMetaBytes) {
    throw createGameError(GM.INVALID_PARAM, `Score meta exceeds ${LIMITS.scoreMetaBytes} bytes`);
  }
  return value;
}

export function assertScoreValue(score) {
  if (typeof score !== 'number' || !Number.isFinite(score) || Math.abs(score) > MAX_SCORE_ABS) {
    throw createGameError(GM.INVALID_PARAM, 'Score must be a finite number within ±1e12');
  }
}

export function assertSessionOutcome(outcome) {
  if (!SESSION_OUTCOMES.includes(outcome)) {
    throw createGameError(GM.INVALID_PARAM, `Invalid session outcome: ${String(outcome)}`);
  }
}
