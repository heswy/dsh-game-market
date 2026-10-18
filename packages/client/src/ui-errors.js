/** Normalize boundary errors for the UI and map GM codes to copy keys. */
import { GM, isGmCode, makeGameError } from '../../shared/src/errors.js';

/** Turn any thrown value into the small error shape the store keeps. */
export function normalizeUiError(error, fallbackCode) {
  if (error && isGmCode(error.code)) {
    return { code: error.code, retryable: error.retryable === true, unresponsive: false };
  }
  const fallback = isGmCode(fallbackCode) ? fallbackCode : GM.INTERNAL;
  return { code: fallback, retryable: false, unresponsive: false };
}

/** Build a UI error from a GM code without leaking the original message. */
export function uiError(code, options) {
  const error = makeGameError(code, null, options);
  return { code: error.code, retryable: error.retryable === true, unresponsive: false };
}

/** Error card title key for a runtime failure code. */
export function runtimeErrorTitleKey(code) {
  switch (code) {
    case GM.GAME_NOT_FOUND:
    case GM.ASSET_NOT_FOUND:
    case GM.MANIFEST_INVALID:
    case GM.ASSET_INTEGRITY:
      return 'runtime.error.package';
    case GM.RUNTIME_INCOMPATIBLE:
    case GM.SDK_INCOMPATIBLE:
      return 'runtime.error.incompatible';
    case GM.LOAD_TIMEOUT:
    case GM.HANDSHAKE_TIMEOUT:
      return 'runtime.error.loadTimeout';
    case GM.IFRAME_CRASHED:
    case GM.IFRAME_UNRESPONSIVE:
      return 'runtime.error.crashed';
    case GM.SAVE_CORRUPT:
    case GM.SAVE_SCHEMA_TOO_NEW:
      return 'runtime.error.saveCorrupt';
    case GM.NO_RUNTIME:
      return 'runtime.error.noRuntime';
    default:
      return 'runtime.error.generic';
  }
}

/** Optional explanation line for a runtime failure code. */
export function runtimeErrorBodyKey(code) {
  switch (code) {
    case GM.GAME_NOT_FOUND:
    case GM.ASSET_NOT_FOUND:
    case GM.MANIFEST_INVALID:
    case GM.ASSET_INTEGRITY:
      return 'runtime.error.package.body';
    case GM.LOAD_TIMEOUT:
    case GM.HANDSHAKE_TIMEOUT:
      return 'runtime.error.loadTimeout.body';
    case GM.IFRAME_CRASHED:
    case GM.IFRAME_UNRESPONSIVE:
      return 'runtime.error.crashed.body';
    case GM.SAVE_CORRUPT:
    case GM.SAVE_SCHEMA_TOO_NEW:
      return 'runtime.error.saveCorrupt.body';
    case GM.NO_RUNTIME:
      return 'runtime.error.noRuntime.body';
    case GM.RUNTIME_INCOMPATIBLE:
    case GM.SDK_INCOMPATIBLE:
      return null;
    default:
      return 'runtime.error.generic.body';
  }
}

/** Whether the retry button makes sense for this failure. */
export function runtimeErrorRetryable(error) {
  if (!error || typeof error !== 'object') return false;
  return error.retryable === true || error.code === GM.NO_RUNTIME;
}
