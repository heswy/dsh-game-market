/**
 * Error codes shared by Host API, Runtime bridge and Client UI.
 *
 * External contract (PRD §8.13 / D-030): only `GM-*` codes cross the
 * API/bridge boundary. Internal `E_*` names never reach the Client.
 */

export const GM = Object.freeze({
  INTERNAL: 'GM-5000',
  INVALID_JSON: 'GM-4001',
  INVALID_PARAM: 'GM-4002',
  UNKNOWN_METHOD: 'GM-4004',
  BAD_GAME_ID: 'GM-4005',
  SCORE_OUT_OF_RANGE: 'GM-4006',
  NOT_READY: 'GM-4031',
  CAPABILITY_DENIED: 'GM-4032',
  SESSION_NOT_BOUND: 'GM-4033',
  SAVE_NOT_FOUND: 'GM-4041',
  GAME_NOT_FOUND: 'GM-4042',
  ASSET_NOT_FOUND: 'GM-4043',
  INSTALL_IN_PROGRESS: 'GM-4091',
  STORAGE_CONFLICT: 'GM-4092',
  SESSION_STATE_CONFLICT: 'GM-4093',
  SCHEMA_READ_TOO_NEW: 'GM-4098',
  SAVE_SCHEMA_TOO_NEW: 'GM-4099',
  SAVE_TOO_LARGE: 'GM-4131',
  STORAGE_QUOTA: 'GM-4132',
  STORAGE_KEY_INVALID: 'GM-4133',
  VALUE_NOT_SERIALIZABLE: 'GM-4134',
  UNSUPPORTED_MEDIA_TYPE: 'GM-4150',
  MANIFEST_INVALID: 'GM-4221',
  RUNTIME_INCOMPATIBLE: 'GM-4260',
  SDK_INCOMPATIBLE: 'GM-4261',
  RATE_LIMITED: 'GM-4290',
  BACKPRESSURE: 'GM-4291',
  HANDSHAKE_TIMEOUT: 'GM-5001',
  PROTOCOL_MISMATCH: 'GM-5002',
  NO_RUNTIME: 'GM-5003',
  MESSAGE_INVALID: 'GM-5004',
  BRIDGE_TIMEOUT: 'GM-5005',
  LOAD_TIMEOUT: 'GM-5011',
  IFRAME_UNRESPONSIVE: 'GM-5012',
  IFRAME_CRASHED: 'GM-5013',
  ASSET_INTEGRITY: 'GM-5014',
  SAVE_WRITE_FAILED: 'GM-5021',
  SAVE_CORRUPT: 'GM-5022',
  HOST_EPOCH_STALE: 'GM-5023',
  HOST_UNAVAILABLE: 'GM-5031',
  REGISTRY_UNAVAILABLE: 'GM-5032',
  INSTALL_FAILED: 'GM-5033',
});

const DEFAULT_MESSAGES = Object.freeze({
  [GM.INTERNAL]: 'Internal error',
  [GM.INVALID_JSON]: 'Request body must be valid JSON',
  [GM.INVALID_PARAM]: 'Invalid parameter',
  [GM.UNKNOWN_METHOD]: 'Unknown method',
  [GM.BAD_GAME_ID]: 'Invalid game id',
  [GM.SCORE_OUT_OF_RANGE]: 'Score is outside the declared range',
  [GM.NOT_READY]: 'Game is not ready',
  [GM.CAPABILITY_DENIED]: 'Capability not declared',
  [GM.SESSION_NOT_BOUND]: 'No Agent Session is bound',
  [GM.SAVE_NOT_FOUND]: 'Save not found',
  [GM.GAME_NOT_FOUND]: 'Game not found',
  [GM.ASSET_NOT_FOUND]: 'Asset not found',
  [GM.INSTALL_IN_PROGRESS]: 'Another install is in progress',
  [GM.STORAGE_CONFLICT]: 'Storage revision conflict',
  [GM.SESSION_STATE_CONFLICT]: 'Session state conflict',
  [GM.SCHEMA_READ_TOO_NEW]: 'Stored data needs a newer Game Market',
  [GM.SAVE_SCHEMA_TOO_NEW]: 'Save needs a newer game version',
  [GM.SAVE_TOO_LARGE]: 'Save exceeds the 1 MiB limit',
  [GM.STORAGE_QUOTA]: 'Storage quota exceeded',
  [GM.STORAGE_KEY_INVALID]: 'Invalid storage key',
  [GM.VALUE_NOT_SERIALIZABLE]: 'Value is not JSON-serializable',
  [GM.UNSUPPORTED_MEDIA_TYPE]: 'Unsupported media type',
  [GM.MANIFEST_INVALID]: 'Invalid game manifest',
  [GM.RUNTIME_INCOMPATIBLE]: 'Game requires a different Runtime version',
  [GM.SDK_INCOMPATIBLE]: 'Game requires a different SDK version',
  [GM.RATE_LIMITED]: 'Too many requests',
  [GM.BACKPRESSURE]: 'Too many in-flight requests',
  [GM.HANDSHAKE_TIMEOUT]: 'Game handshake timed out',
  [GM.PROTOCOL_MISMATCH]: 'Game protocol version mismatch',
  [GM.NO_RUNTIME]: 'Game Runtime is not available',
  [GM.MESSAGE_INVALID]: 'Invalid bridge message',
  [GM.BRIDGE_TIMEOUT]: 'Bridge request timed out',
  [GM.LOAD_TIMEOUT]: 'Game failed to load in time',
  [GM.IFRAME_UNRESPONSIVE]: 'Game is not responding',
  [GM.IFRAME_CRASHED]: 'Game crashed',
  [GM.ASSET_INTEGRITY]: 'Game files failed integrity check',
  [GM.SAVE_WRITE_FAILED]: 'Could not write save',
  [GM.SAVE_CORRUPT]: 'Save file is corrupt',
  [GM.HOST_EPOCH_STALE]: 'Host restarted; refresh state',
  [GM.HOST_UNAVAILABLE]: 'Game Market Host is unavailable',
  [GM.REGISTRY_UNAVAILABLE]: 'Game registry is unavailable',
  [GM.INSTALL_FAILED]: 'Install failed',
});

/** HTTP status for a GM code (PRD §8.5 mapping). */
export function httpStatusFor(gmCode) {
  const num = Number(String(gmCode).slice(3));
  if (!Number.isFinite(num)) return 500;
  if (gmCode === GM.INTERNAL) return 500;
  if (gmCode === GM.MANIFEST_INVALID) return 422;
  if (num >= 5000 && num < 6000) return num >= 5030 ? 503 : 500;
  if (num >= 4000 && num < 5000) return Math.floor(num / 100) * 100;
  return 500;
}

export function isGmCode(value) {
  return typeof value === 'string' && /^GM-\d{4}$/.test(value);
}

/**
 * Create a plain error object for Host responses and bridge failures.
 * Never include paths, stack traces or user content in `details`.
 */
export function makeGameError(code, message, options = {}) {
  const gmCode = isGmCode(code) ? code : GM.INTERNAL;
  return {
    code: gmCode,
    message: message || DEFAULT_MESSAGES[gmCode] || DEFAULT_MESSAGES[GM.INTERNAL],
    retryable: options.retryable === true,
    ...(options.details === undefined ? {} : { details: options.details }),
  };
}

export function errorResponseBody(code, message, options = {}) {
  return { ok: false, error: makeGameError(code, message, options) };
}

export function defaultMessageFor(code) {
  return DEFAULT_MESSAGES[code] || DEFAULT_MESSAGES[GM.INTERNAL];
}

/** SDK/bridge error codes are the same GM codes; aliases keep call sites readable. */
export const SDK_ERROR_CODES = Object.freeze(Object.values(GM));
