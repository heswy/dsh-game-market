/**
 * Input validation shared by the Host services.
 *
 * All failures are `HostError`s carrying only public GM codes and field names.
 */

import path from 'node:path';
import {
  DSH_SESSION_ID_PATTERN,
  GAME_ID_PATTERN,
  INSTANCE_ID_PATTERN,
  NONCE_PATTERN,
  PLAY_SESSION_ID_PATTERN,
} from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import { isPlainObject, isValidStorageKey } from '../../shared/src/protocol.js';
import { hostError } from './errors.js';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DEFAULT_MAX_DEPTH = 32;
const DEFAULT_MAX_OBJECT_KEYS = 1000;
const DEFAULT_MAX_KEY_LENGTH = 128;

export { isPlainObject, isValidStorageKey };

function invalid(message) {
  return hostError(GM.INVALID_PARAM, message);
}

/** Validate a game id; returns the id or throws GM-4005. */
export function validateGameId(value, field = 'gameId') {
  if (
    typeof value !== 'string' ||
    value.length < 3 ||
    value.length > 48 ||
    !GAME_ID_PATTERN.test(value) ||
    value.includes('--')
  ) {
    throw hostError(GM.BAD_GAME_ID, `Invalid ${field}`);
  }
  return value;
}

/** Null/undefined allowed (unbound); otherwise a conservative DSH Session id. */
export function validateDshSessionId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !DSH_SESSION_ID_PATTERN.test(value)) {
    throw invalid('Invalid dshSessionId');
  }
  return value;
}

export function validateDshSessionIdRequired(value) {
  const id = validateDshSessionId(value);
  if (id === null) throw invalid('sessionId is required');
  return id;
}

export function validatePlaySessionId(value) {
  if (typeof value !== 'string' || !PLAY_SESSION_ID_PATTERN.test(value)) {
    throw invalid('Invalid playSessionId');
  }
  return value;
}

export function validateInstanceId(value) {
  if (typeof value !== 'string' || !INSTANCE_ID_PATTERN.test(value)) {
    throw invalid('Invalid instance id');
  }
  return value;
}

export function validateNonce(value) {
  if (typeof value !== 'string' || !NONCE_PATTERN.test(value)) {
    throw invalid('Invalid nonce');
  }
  return value;
}

export function validateOperationId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw invalid('Invalid operationId');
  }
  return value;
}

export function validateFiniteNumber(value, field = 'value') {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) {
    throw invalid(`Invalid ${field}`);
  }
  return value;
}

export function validateOptionalString(value, field, { maxLength = 256 } = {}) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > maxLength) throw invalid(`Invalid ${field}`);
  return value;
}

export function validateBoolean(value, field) {
  if (typeof value !== 'boolean') throw invalid(`Invalid ${field}`);
  return value;
}

/**
 * Deep-validate a JSON value: finite numbers, plain objects/arrays, bounded
 * depth, safe keys. Returns a cloned tree (no shared references).
 */
export function validateStoredValue(
  value,
  {
    depth = 0,
    maxDepth = DEFAULT_MAX_DEPTH,
    maxObjectKeys = DEFAULT_MAX_OBJECT_KEYS,
    maxKeyLength = DEFAULT_MAX_KEY_LENGTH,
  } = {}
) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw hostError(GM.VALUE_NOT_SERIALIZABLE, 'Number must be finite');
    }
    return value;
  }
  if (depth >= maxDepth) {
    throw hostError(GM.VALUE_NOT_SERIALIZABLE, 'Value nesting is too deep');
  }
  if (Array.isArray(value)) {
    return value.map((item) => validateStoredValue(item, { depth: depth + 1, maxDepth, maxObjectKeys, maxKeyLength }));
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > maxObjectKeys) {
      throw hostError(GM.VALUE_NOT_SERIALIZABLE, 'Object has too many keys');
    }
    const out = {};
    for (const key of keys) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw hostError(GM.VALUE_NOT_SERIALIZABLE, `Forbidden key: ${key}`);
      }
      if (key.length > maxKeyLength) {
        throw hostError(GM.VALUE_NOT_SERIALIZABLE, 'Object key is too long');
      }
      out[key] = validateStoredValue(value[key], { depth: depth + 1, maxDepth, maxObjectKeys, maxKeyLength });
    }
    return out;
  }
  throw hostError(GM.VALUE_NOT_SERIALIZABLE, 'Value is not JSON-serializable');
}

export function jsonByteLength(value) {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) throw new Error('undefined');
    return Buffer.byteLength(text, 'utf8');
  } catch (error) {
    if (error && error.code === GM.VALUE_NOT_SERIALIZABLE) throw error;
    throw hostError(GM.VALUE_NOT_SERIALIZABLE, 'Value is not JSON-serializable');
  }
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function isIsoTimestamp(value) {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

/** True when `target` is the root or a descendant of `root` (after resolve). */
export function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Validate a relative resource path declared by a manifest. */
export function safeRelativePath(value, { maxLength = 180 } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return null;
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) return null;
  if (value.includes('?') || value.includes('#')) return null;
  if (path.isAbsolute(value)) return null;
  const segments = value.split('/');
  if (segments.length > 6) return null;
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.' || segment === '..') return null;
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) return null;
  }
  return value;
}

