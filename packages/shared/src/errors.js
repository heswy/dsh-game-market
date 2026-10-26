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
  // Manifest field-level errors (PRD §8.13.2)
  MANIFEST_JSON: 'GM-4228',
  MANIFEST_VERSION: 'GM-4230',
  FIELD_MISSING: 'GM-4231',
  FIELD_TYPE: 'GM-4232',
  FIELD_RANGE: 'GM-4233',
  ID_INVALID: 'GM-4234',
  ID_RESERVED: 'GM-4235',
  VERSION_INVALID: 'GM-4236',
  LEGACY_FIELD: 'GM-4237',
  CATEGORY_UNKNOWN: 'GM-4238',
  CAPABILITY_UNKNOWN: 'GM-4239',
  CAPABILITY_UNSUPPORTED: 'GM-4240',
  CAPABILITY_DUPLICATE: 'GM-4241',
  PERMISSION_UNSUPPORTED: 'GM-4242',
  SCORE_RANGE: 'GM-4243',
  SAVE_SCHEMA: 'GM-4244',
  RANGE_SYNTAX: 'GM-4245',
  ICON_FORMAT: 'GM-4247',
  ICON_TOO_LARGE: 'GM-4248',
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
  STORE_IO: 'GM-5024',
  STORE_READONLY: 'GM-5025',
  HOST_UNAVAILABLE: 'GM-5031',
  REGISTRY_UNAVAILABLE: 'GM-5032',
  INSTALL_FAILED: 'GM-5033',
  // V1 package / registry / install (PRD §8.13.2 / §8.13.3)
  PACKAGE_INVALID: 'GM-4222',
  ENTRY_NOT_SELF_CONTAINED: 'GM-4225',
  MANIFEST_TOO_LARGE: 'GM-4229',
  PACKAGE_TOO_LARGE: 'GM-4135',
  INSTALL_URL_REJECTED: 'GM-4034',
  REGISTRY_URL: 'GM-4035',
  MARKET_DISABLED: 'GM-4036',
  STORE_PATH_ESCAPE: 'GM-4037',
  UNINSTALL_BUILTIN: 'GM-4038',
  NOT_IN_REGISTRY: 'GM-4044',
  INSTALL_VERSION_CONFLICT: 'GM-4094',
  INSTALL_VERSION_MISMATCH: 'GM-4095',
  UPDATE_GAME_RUNNING: 'GM-4096',
  UNINSTALL_BUSY: 'GM-4097',
  INSTALL_DISK_FULL: 'GM-4142',
  INSTALL_HASH_MISMATCH: 'GM-5015',
  INSTALL_DOWNLOAD_FAILED: 'GM-5034',
  INSTALL_DOWNLOAD_TIMEOUT: 'GM-5035',
  INSTALL_IO: 'GM-5036',
  INSTALL_CORRUPT: 'GM-5037',
  // V1.5 package / archive / catalog / inline semantics (V1.5-CONTRACTS §8.1)
  ZIP_INVALID: 'GM-4270',
  ZIP_UNSUPPORTED: 'GM-4271',
  ZIP_LIMIT: 'GM-4272',
  ZIP_PATH_INVALID: 'GM-4273',
  ZIP_PATH_CONFLICT: 'GM-4274',
  ZIP_HEADER_MISMATCH: 'GM-4275',
  ZIP_CRC_MISMATCH: 'GM-4276',
  DESCRIPTOR_INVALID: 'GM-4277',
  DESCRIPTOR_MISMATCH: 'GM-4278',
  MANIFEST_CONFLICT: 'GM-4279',
  ASSET_TYPE_UNSUPPORTED: 'GM-4280',
  CATALOG_IMMUTABLE: 'GM-4281',
  FORMAT_POLICY: 'GM-4282',
  ASSET_INLINE_FORBIDDEN: 'GM-4283',
  // V1.5 resource credentials (§7.2)
  RESOURCE_CREDENTIAL_INVALID: 'GM-4010',
  RESOURCE_CREDENTIAL_EXPIRED: 'GM-4011',
  ENTRY_CREDENTIAL_CONSUMED: 'GM-4012',
  ENTRY_LAUNCH_CONSUMED: 'GM-4013',
  RESOURCE_SCOPE_DENIED: 'GM-4039',
  // V1.5 platform update adapter (§9; adapter is ours, not a DSH API)
  UPDATE_TARGET_INVALID: 'GM-4090',
  UPDATE_ADAPTER_UNAVAILABLE: 'GM-5038',
  UPDATE_OBSERVE_TIMEOUT: 'GM-5040',
  // V1.5 official update index: unreachable, oversized, malformed or not bound
  // to the official repository (m3-decisions §3; contracts §8.1).
  UPDATE_INDEX_UNAVAILABLE: 'GM-5039',
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
  [GM.MANIFEST_JSON]: 'Inline manifest JSON is invalid',
  [GM.MANIFEST_VERSION]: 'Unsupported manifestVersion',
  [GM.FIELD_MISSING]: 'A required manifest field is missing',
  [GM.FIELD_TYPE]: 'A manifest field has the wrong type',
  [GM.FIELD_RANGE]: 'A manifest field is out of range',
  [GM.ID_INVALID]: 'Invalid game id',
  [GM.ID_RESERVED]: 'Game id is reserved',
  [GM.VERSION_INVALID]: 'Invalid game version',
  [GM.LEGACY_FIELD]: 'Manifest uses a legacy field',
  [GM.CATEGORY_UNKNOWN]: 'Unknown category',
  [GM.CAPABILITY_UNKNOWN]: 'Unknown capability',
  [GM.CAPABILITY_UNSUPPORTED]: 'Capability is not supported in V1',
  [GM.CAPABILITY_DUPLICATE]: 'Duplicate capability',
  [GM.PERMISSION_UNSUPPORTED]: 'Permissions are not supported in V1',
  [GM.SCORE_RANGE]: 'Invalid score range',
  [GM.SAVE_SCHEMA]: 'Invalid save schemaVersion',
  [GM.RANGE_SYNTAX]: 'Unsupported version range syntax',
  [GM.ICON_FORMAT]: 'Icon data URI format is not supported',
  [GM.ICON_TOO_LARGE]: 'Icon exceeds the size limit',
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
  [GM.STORE_IO]: 'Storage read/write failed',
  [GM.STORE_READONLY]: 'Storage is read-only',
  [GM.HOST_UNAVAILABLE]: 'Game Market Host is unavailable',
  [GM.REGISTRY_UNAVAILABLE]: 'Game registry is unavailable',
  [GM.INSTALL_FAILED]: 'Install failed',
  [GM.PACKAGE_INVALID]: 'Package file is not valid UTF-8 HTML',
  [GM.ENTRY_NOT_SELF_CONTAINED]: 'Game entry must be a self-contained single file',
  [GM.MANIFEST_TOO_LARGE]: 'Inline manifest is too large',
  [GM.PACKAGE_TOO_LARGE]: 'Game package exceeds the size limit',
  [GM.INSTALL_URL_REJECTED]: 'Package URL is not allowed',
  [GM.MARKET_DISABLED]: 'Game Market is disabled',
  [GM.STORE_PATH_ESCAPE]: 'Path escapes the managed storage root',
  [GM.UNINSTALL_BUILTIN]: 'Built-in games cannot be uninstalled',
  [GM.NOT_IN_REGISTRY]: 'Game is not in the registry',
  [GM.INSTALL_VERSION_CONFLICT]: 'Installed version conflicts with this install',
  [GM.INSTALL_VERSION_MISMATCH]: 'Package version does not match the registry entry',
  [GM.UPDATE_GAME_RUNNING]: 'Exit the game before updating',
  [GM.UNINSTALL_BUSY]: 'Another install or uninstall is in progress',
  [GM.INSTALL_DISK_FULL]: 'Not enough disk space for this install',
  [GM.INSTALL_HASH_MISMATCH]: 'Package SHA-256 does not match the registry',
  [GM.INSTALL_DOWNLOAD_FAILED]: 'Package download failed',
  [GM.INSTALL_DOWNLOAD_TIMEOUT]: 'Package download timed out',
  [GM.INSTALL_IO]: 'Install write failed',
  [GM.INSTALL_CORRUPT]: 'Installed package is incomplete',
  // V1.5 archive / descriptor / catalog
  [GM.ZIP_INVALID]: 'Package archive is not a valid ZIP',
  [GM.ZIP_UNSUPPORTED]: 'Package archive uses an unsupported ZIP feature',
  [GM.ZIP_LIMIT]: 'Package archive exceeds an extraction limit',
  [GM.ZIP_PATH_INVALID]: 'Package archive contains an invalid path',
  [GM.ZIP_PATH_CONFLICT]: 'Package archive contains conflicting paths',
  [GM.ZIP_HEADER_MISMATCH]: 'Package archive headers are inconsistent',
  [GM.ZIP_CRC_MISMATCH]: 'Package archive entry failed its CRC check',
  [GM.DESCRIPTOR_INVALID]: 'Package descriptor is missing or invalid',
  [GM.DESCRIPTOR_MISMATCH]: 'Package file manifest does not match the archive',
  [GM.MANIFEST_CONFLICT]: 'Package declares more than one authoritative manifest',
  [GM.ASSET_TYPE_UNSUPPORTED]: 'Package contains an unsupported or unsafe asset',
  [GM.CATALOG_IMMUTABLE]: 'Published package bytes cannot change for this version',
  [GM.FORMAT_POLICY]: 'Package format change requires a new game version',
  [GM.ASSET_INLINE_FORBIDDEN]: 'Resource packages cannot use inline scripts, styles, handlers or javascript: URLs',
  // V1.5 resource credentials
  [GM.RESOURCE_CREDENTIAL_INVALID]: 'Resource credential is invalid',
  [GM.RESOURCE_CREDENTIAL_EXPIRED]: 'Resource credential has expired',
  [GM.ENTRY_CREDENTIAL_CONSUMED]: 'Credential was used in the wrong place',
  [GM.ENTRY_LAUNCH_CONSUMED]: 'Launch credential has already been used',
  [GM.RESOURCE_SCOPE_DENIED]: 'Resource does not belong to this instance',
  // V1.5 update adapter
  [GM.UPDATE_TARGET_INVALID]: 'Update target is not acceptable to the plugin manager',
  [GM.UPDATE_ADAPTER_UNAVAILABLE]: 'Plugin update capability is unavailable',
  [GM.UPDATE_OBSERVE_TIMEOUT]: 'Plugin update state could not be confirmed in time',
  [GM.UPDATE_INDEX_UNAVAILABLE]: 'The official plugin update index is unavailable',
});

/** HTTP status for a GM code (PRD §8.5 mapping). */
export function httpStatusFor(gmCode) {
  const num = Number(String(gmCode).slice(3));
  if (!Number.isFinite(num)) return 500;
  if (gmCode === GM.INTERNAL) return 500;
  // V1.5 archive/descriptor/catalog/inline semantics (GM-4270..GM-4289) are 422.
  // Without this explicit window the numeric derivation below would yield 427.
  if (num >= 4270 && num <= 4289) return 422;
  // V1.5 resource credentials: S-A1 measured 403 for an expired/released
  // instance and 410 for a replayed launch URL. The numeric rule would give 401.
  if (gmCode === GM.RESOURCE_CREDENTIAL_EXPIRED) return 403;
  if (gmCode === GM.ENTRY_LAUNCH_CONSUMED) return 410;
  // V1.5 update observation timeout keeps the documented 504 (contract §8.3);
  // the generic 5xxx band would otherwise report 503.
  if (gmCode === GM.UPDATE_OBSERVE_TIMEOUT) return 504;
  // Package/manifest semantics (GM-422x–424x) are 422, size/quota (413x–414x) are 413.
  if (num >= 4220 && num <= 4249) return 422;
  if (num >= 4130 && num <= 4149) return 413;
  if (num >= 5000 && num < 6000) return num >= 5030 ? 503 : 500;
  if (num >= 4000 && num < 5000) return Math.floor(num / 10);
  return 500;
}

export function isGmCode(value) {
  return typeof value === 'string' && /^GM-\d{4}$/.test(value);
}

/**
 * Internal `E_*` -> public `GM-*` map (PRD §8.13.2 / §8.13.3 / D-030).
 * Shared validators (manifest/registry/installation) emit `E_*`; the Host and
 * CLI must translate before crossing an API/bridge/user-visible boundary.
 * Retired V1 codes (zip archive rules) are intentionally absent.
 */
export const INTERNAL_TO_GM = Object.freeze({
  // Package / manifest (PRD §8.13.2) — names follow PRD v2.2 (single-file).
  E_PKG_HTML_INVALID: GM.PACKAGE_INVALID,
  E_PKG_MANIFEST_MISSING: GM.MANIFEST_INVALID,
  E_PKG_MANIFEST_DUPLICATE: GM.MANIFEST_INVALID,
  E_PKG_MANIFEST_JSON: GM.MANIFEST_JSON,
  E_PKG_MANIFEST_TOO_LARGE: GM.MANIFEST_TOO_LARGE,
  E_PKG_MANIFEST_VERSION: GM.MANIFEST_VERSION,
  E_PKG_FIELD_MISSING: GM.FIELD_MISSING,
  E_PKG_FIELD_TYPE: GM.FIELD_TYPE,
  E_PKG_FIELD_RANGE: GM.FIELD_RANGE,
  E_PKG_ID_INVALID: GM.ID_INVALID,
  E_PKG_ID_RESERVED: GM.ID_RESERVED,
  E_PKG_VERSION_INVALID: GM.VERSION_INVALID,
  E_PKG_LEGACY_FIELD: GM.LEGACY_FIELD,
  E_PKG_CATEGORY_UNKNOWN: GM.CATEGORY_UNKNOWN,
  E_PKG_CAPABILITY_UNKNOWN: GM.CAPABILITY_UNKNOWN,
  E_PKG_CAPABILITY_UNSUPPORTED: GM.CAPABILITY_UNSUPPORTED,
  E_PKG_CAPABILITY_DUPLICATE: GM.CAPABILITY_DUPLICATE,
  E_PKG_PERMISSION_UNSUPPORTED: GM.PERMISSION_UNSUPPORTED,
  E_PKG_SCORE_RANGE: GM.SCORE_RANGE,
  E_PKG_SAVE_SCHEMA: GM.SAVE_SCHEMA,
  E_PKG_RANGE_SYNTAX: GM.RANGE_SYNTAX,
  E_PKG_ICON_FORMAT: GM.ICON_FORMAT,
  E_PKG_ICON_TOO_LARGE: GM.ICON_TOO_LARGE,
  E_PKG_ENTRY_NOT_SELF_CONTAINED: GM.ENTRY_NOT_SELF_CONTAINED,
  E_PKG_TOO_LARGE: GM.PACKAGE_TOO_LARGE,
  // Registry / install (PRD §8.13.3)
  E_REGISTRY_INVALID: GM.REGISTRY_UNAVAILABLE,
  E_REGISTRY_URL: GM.REGISTRY_URL,
  E_MARKET_DISABLED: GM.MARKET_DISABLED,
  E_NOT_IN_REGISTRY: GM.NOT_IN_REGISTRY,
  E_UNINSTALL_BUILTIN: GM.UNINSTALL_BUILTIN,
  E_INSTALL_URL_REJECTED: GM.INSTALL_URL_REJECTED,
  E_INSTALL_DISK_FULL: GM.INSTALL_DISK_FULL,
  E_INSTALL_VERSION_CONFLICT: GM.INSTALL_VERSION_CONFLICT,
  E_INSTALL_VERSION_MISMATCH: GM.INSTALL_VERSION_MISMATCH,
  E_UPDATE_GAME_RUNNING: GM.UPDATE_GAME_RUNNING,
  E_UNINSTALL_BUSY: GM.UNINSTALL_BUSY,
  E_INSTALL_HASH_MISMATCH: GM.INSTALL_HASH_MISMATCH,
  E_INSTALL_DOWNLOAD_FAILED: GM.INSTALL_DOWNLOAD_FAILED,
  E_INSTALL_DOWNLOAD_TIMEOUT: GM.INSTALL_DOWNLOAD_TIMEOUT,
  E_INSTALL_IO: GM.INSTALL_IO,
  E_INSTALL_CORRUPT: GM.INSTALL_CORRUPT,
  // Storage / compatibility (PRD §8.13.4)
  E_STORE_SCHEMA: GM.SCHEMA_READ_TOO_NEW,
  E_STORE_SCHEMA_NEWER: GM.SCHEMA_READ_TOO_NEW,
  E_STORE_PATH_ESCAPE: GM.STORE_PATH_ESCAPE,
  E_COMPAT_SDK: GM.SDK_INCOMPATIBLE,
  E_COMPAT_RUNTIME: GM.RUNTIME_INCOMPATIBLE,
  // V1.5 archive / descriptor / catalog / inline (V1.5-CONTRACTS §8.2)
  E_ZIP_STRUCTURE: GM.ZIP_INVALID,
  E_ZIP_UNSUPPORTED_FEATURE: GM.ZIP_UNSUPPORTED,
  E_ZIP_LIMIT_EXCEEDED: GM.ZIP_LIMIT,
  E_ZIP_PATH_INVALID: GM.ZIP_PATH_INVALID,
  E_ZIP_PATH_CONFLICT: GM.ZIP_PATH_CONFLICT,
  E_ZIP_HEADER_MISMATCH: GM.ZIP_HEADER_MISMATCH,
  E_ZIP_CRC_MISMATCH: GM.ZIP_CRC_MISMATCH,
  E_DESCRIPTOR_INVALID: GM.DESCRIPTOR_INVALID,
  E_DESCRIPTOR_MISSING: GM.DESCRIPTOR_INVALID,
  E_DESCRIPTOR_MISMATCH: GM.DESCRIPTOR_MISMATCH,
  E_MANIFEST_CONFLICT: GM.MANIFEST_CONFLICT,
  E_ASSET_TYPE_UNSUPPORTED: GM.ASSET_TYPE_UNSUPPORTED,
  E_CATALOG_IMMUTABLE: GM.CATALOG_IMMUTABLE,
  E_FORMAT_POLICY: GM.FORMAT_POLICY,
  E_ASSET_INLINE_FORBIDDEN: GM.ASSET_INLINE_FORBIDDEN,
  // V1.5 resource credentials (§7.2)
  E_RESOURCE_CREDENTIAL_INVALID: GM.RESOURCE_CREDENTIAL_INVALID,
  E_RESOURCE_CREDENTIAL_EXPIRED: GM.RESOURCE_CREDENTIAL_EXPIRED,
  E_ENTRY_CREDENTIAL_CONSUMED: GM.ENTRY_CREDENTIAL_CONSUMED,
  E_ENTRY_LAUNCH_CONSUMED: GM.ENTRY_LAUNCH_CONSUMED,
  E_RESOURCE_SCOPE_DENIED: GM.RESOURCE_SCOPE_DENIED,
  // V1.5 registry v2: a bad v2 index means the catalog is unavailable.
  E_REGISTRY_V2_INVALID: GM.REGISTRY_UNAVAILABLE,
  // V1.5 update adapter (§9)
  E_UPDATE_TARGET_INVALID: GM.UPDATE_TARGET_INVALID,
  E_UPDATE_ADAPTER_UNAVAILABLE: GM.UPDATE_ADAPTER_UNAVAILABLE,
  E_UPDATE_OBSERVE_TIMEOUT: GM.UPDATE_OBSERVE_TIMEOUT,
  E_UPDATE_INDEX_UNAVAILABLE: GM.UPDATE_INDEX_UNAVAILABLE,
});

/** Translate an internal `E_*` code to its public `GM-*` code (fallback: GM-5000). */
export function gmForInternal(code) {
  if (isGmCode(code)) return code;
  return INTERNAL_TO_GM[code] || GM.INTERNAL;
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
