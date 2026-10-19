/**
 * Client-side guards around Runtime launch data and loading deadlines.
 * The Runtime owns the iframe, but the Client still refuses obviously unsafe
 * entry URLs or incomplete launch descriptors before rendering anything.
 */
import { INSTANCE_ID_PATTERN, NONCE_PATTERN, TIMING } from '../../shared/src/constants.js';
import { GM, makeGameError } from '../../shared/src/errors.js';

const ENTRY_PATH = 'api/game-market/entry';

/**
 * Entry URLs must stay a same-origin relative API path. Schemes, protocol
 * relative hosts, backslashes, encoded separators and traversal are rejected.
 */
export function isSafeEntryUrl(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 4096) return false;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return false;
  if (value.charAt(0) === '/' && value.charAt(1) === '/') return false;
  if (value.indexOf('#') !== -1 || value.indexOf('..') !== -1) return false;

  const lower = value.toLowerCase();
  if (lower.indexOf('%2e') !== -1 || lower.indexOf('%2f') !== -1 || lower.indexOf('%5c') !== -1) return false;

  let path = value;
  while (path.charAt(0) === '/') path = path.slice(1);
  if (path.startsWith('//')) return false;
  const queryIndex = path.indexOf('?');
  const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex);
  return pathname === ENTRY_PATH;
}

function launchError(code, retryable) {
  return { ok: false, error: makeGameError(code, null, { retryable: retryable === true }) };
}

/**
 * Validate the `POST launch` payload before handing it to the Runtime.
 * Returns `{ok:true, info}` or `{ok:false, error}` (GM code only).
 */
export function validateLaunchInfo(info) {
  if (!info || typeof info !== 'object') return launchError(GM.INVALID_PARAM, false);
  if (!isSafeEntryUrl(info.entryUrl)) return launchError(GM.ASSET_INTEGRITY, false);
  if (typeof info.instanceId !== 'string' || !INSTANCE_ID_PATTERN.test(info.instanceId)) {
    return launchError(GM.INVALID_PARAM, false);
  }
  if (typeof info.nonce !== 'string' || !NONCE_PATTERN.test(info.nonce)) {
    return launchError(GM.INVALID_PARAM, false);
  }
  if (info.mode !== undefined && info.mode !== 'start' && info.mode !== 'resume-paused') {
    return launchError(GM.INVALID_PARAM, false);
  }
  if (info.viewport !== undefined && info.viewport !== null) {
    const viewport = info.viewport;
    const valid =
      viewport &&
      typeof viewport === 'object' &&
      typeof viewport.width === 'number' &&
      viewport.width > 0 &&
      typeof viewport.height === 'number' &&
      viewport.height > 0;
    if (!valid) return launchError(GM.INVALID_PARAM, false);
  }
  return { ok: true, info: info };
}

/** Loading deadline phases used by the Runtime view (PRD 9.6.5). */
export function deriveLoadPhase(elapsedMs) {
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs) || elapsedMs < 0) return 'loading';
  if (elapsedMs >= TIMING.loadErrorMs) return 'timeout';
  if (elapsedMs >= TIMING.loadSlowMs) return 'slow';
  return 'loading';
}

/** True while the Runtime is still starting and the spinner/overlay applies. */
export function isRuntimeLoadingState(state) {
  return state === 'launching' || state === 'loading' || state === 'ready';
}

/** True once the game can receive keyboard input. */
/** A runtime instance id is required to release only our own launch binding. */
export function hasRuntimeInstanceId(value) {
  return typeof value === 'string' && value.length > 0;
}

export function shouldReleaseRuntimeInstance(gameId, instanceId) {
  return typeof gameId === 'string' && gameId.length > 0 && hasRuntimeInstanceId(instanceId);
}

export function isRuntimeInteractiveState(state) {
  return state === 'playing' || state === 'paused' || state === 'saving';
}
