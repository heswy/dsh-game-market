/**
 * GM-* code to user-facing copy mapping (PRD 8.13 / 9.8, D-030).
 *
 * The Host only ever sends `GM-*` codes; message strings are diagnostics and are
 * never shown. Every known code maps to a locale key; unknown codes degrade to a
 * generic key instead of leaking the raw message.
 */
import { GM } from '../../shared/src/errors.js';

const ERROR_KEYS = Object.freeze({
  [GM.INTERNAL]: 'error.gm.unknown',
  [GM.INVALID_JSON]: 'error.gm.badRequest',
  [GM.INVALID_PARAM]: 'error.gm.badRequest',
  [GM.UNKNOWN_METHOD]: 'error.gm.unknownMethod',
  [GM.BAD_GAME_ID]: 'error.gm.invalidGame',
  [GM.SCORE_OUT_OF_RANGE]: 'error.gm.scoreRange',
  [GM.NOT_READY]: 'error.gm.unknown',
  [GM.CAPABILITY_DENIED]: 'error.gm.capability',
  [GM.SESSION_NOT_BOUND]: 'error.gm.unknown',
  [GM.SAVE_NOT_FOUND]: 'error.gm.unknown',
  [GM.GAME_NOT_FOUND]: 'error.gm.notFound',
  [GM.ASSET_NOT_FOUND]: 'error.gm.notFound',
  [GM.INSTALL_IN_PROGRESS]: 'error.gm.installBusy',
  [GM.STORAGE_CONFLICT]: 'error.gm.unknown',
  [GM.SESSION_STATE_CONFLICT]: 'error.gm.unknown',
  [GM.SCHEMA_READ_TOO_NEW]: 'error.gm.storageTooNew',
  [GM.SAVE_SCHEMA_TOO_NEW]: 'error.gm.saveCorrupt',
  [GM.SAVE_TOO_LARGE]: 'error.gm.storage',
  [GM.STORAGE_QUOTA]: 'error.gm.storage',
  [GM.STORAGE_KEY_INVALID]: 'error.gm.badRequest',
  [GM.VALUE_NOT_SERIALIZABLE]: 'error.gm.unknown',
  [GM.UNSUPPORTED_MEDIA_TYPE]: 'error.gm.unsupportedMedia',
  [GM.MANIFEST_INVALID]: 'error.gm.manifest',
  [GM.RUNTIME_INCOMPATIBLE]: 'error.gm.compat',
  [GM.SDK_INCOMPATIBLE]: 'error.gm.compat',
  [GM.RATE_LIMITED]: 'error.gm.throttled',
  [GM.BACKPRESSURE]: 'error.gm.installBusy',
  [GM.HANDSHAKE_TIMEOUT]: 'error.gm.unknown',
  [GM.PROTOCOL_MISMATCH]: 'error.gm.compat',
  [GM.NO_RUNTIME]: 'error.gm.compat',
  [GM.MESSAGE_INVALID]: 'error.gm.unknown',
  [GM.BRIDGE_TIMEOUT]: 'error.gm.unknown',
  [GM.LOAD_TIMEOUT]: 'error.gm.unknown',
  [GM.IFRAME_UNRESPONSIVE]: 'error.gm.unknown',
  [GM.IFRAME_CRASHED]: 'error.gm.unknown',
  [GM.ASSET_INTEGRITY]: 'error.gm.integrity',
  [GM.SAVE_WRITE_FAILED]: 'error.gm.storage',
  [GM.SAVE_CORRUPT]: 'error.gm.saveCorrupt',
  [GM.HOST_EPOCH_STALE]: 'error.gm.host',
  [GM.STORE_IO]: 'error.gm.storage',
  [GM.STORE_READONLY]: 'error.gm.storageReadOnly',
  [GM.HOST_UNAVAILABLE]: 'error.gm.host',
  [GM.REGISTRY_UNAVAILABLE]: 'error.gm.registry',
  [GM.INSTALL_FAILED]: 'error.gm.unknown',
  [GM.PACKAGE_INVALID]: 'error.gm.packageInvalid',
  [GM.ENTRY_NOT_SELF_CONTAINED]: 'error.gm.notSelfContained',
  [GM.MANIFEST_TOO_LARGE]: 'error.gm.manifest',
  [GM.PACKAGE_TOO_LARGE]: 'error.gm.packageTooLarge',
  [GM.INSTALL_URL_REJECTED]: 'error.gm.installUrl',
  [GM.MARKET_DISABLED]: 'error.gm.compat',
  [GM.STORE_PATH_ESCAPE]: 'error.gm.storage',
  [GM.UNINSTALL_BUILTIN]: 'error.gm.uninstallBuiltin',
  [GM.NOT_IN_REGISTRY]: 'error.gm.notFound',
  [GM.INSTALL_VERSION_CONFLICT]: 'error.gm.installVersion',
  [GM.INSTALL_VERSION_MISMATCH]: 'error.gm.installVersionMismatch',
  [GM.UPDATE_GAME_RUNNING]: 'error.gm.installRunning',
  [GM.UNINSTALL_BUSY]: 'error.gm.installBusy',
  [GM.INSTALL_DISK_FULL]: 'error.gm.diskFull',
  [GM.INSTALL_HASH_MISMATCH]: 'error.gm.integrity',
  [GM.INSTALL_DOWNLOAD_FAILED]: 'error.gm.download',
  [GM.INSTALL_DOWNLOAD_TIMEOUT]: 'error.gm.downloadTimeout',
  [GM.INSTALL_IO]: 'error.gm.write',
  [GM.INSTALL_CORRUPT]: 'error.gm.verify',
});

const DOWNLOAD_STAGE_ERRORS = Object.freeze([
  GM.INSTALL_DOWNLOAD_FAILED,
  GM.INSTALL_DOWNLOAD_TIMEOUT,
  GM.HOST_UNAVAILABLE,
  GM.REGISTRY_UNAVAILABLE,
  GM.INSTALL_URL_REJECTED,
  GM.RATE_LIMITED,
]);

const VERIFY_STAGE_ERRORS = Object.freeze([
  GM.INSTALL_HASH_MISMATCH,
  GM.INSTALL_CORRUPT,
  GM.MANIFEST_INVALID,
  GM.PACKAGE_INVALID,
  GM.ENTRY_NOT_SELF_CONTAINED,
  GM.INSTALL_VERSION_MISMATCH,
  GM.PACKAGE_TOO_LARGE,
  GM.NOT_IN_REGISTRY,
]);

const WRITE_STAGE_ERRORS = Object.freeze([
  GM.INSTALL_IO,
  GM.INSTALL_DISK_FULL,
  GM.STORE_IO,
  GM.STORE_READONLY,
]);

const OFFLINE_ERRORS = Object.freeze([GM.HOST_UNAVAILABLE, GM.REGISTRY_UNAVAILABLE]);

const BUSY_ERRORS = Object.freeze([GM.INSTALL_IN_PROGRESS, GM.UNINSTALL_BUSY, GM.BACKPRESSURE]);

function includes(list, value) {
  return list.indexOf(value) !== -1;
}

/** Locale key for any GM code; unknown codes never leak the raw message. */
export function errorTextKey(code) {
  if (typeof code !== 'string') return 'error.gm.unknown';
  if (Object.prototype.hasOwnProperty.call(ERROR_KEYS, code)) return ERROR_KEYS[code];
  // Manifest field-level codes (GM-4228, GM-4230..GM-4248) are all package problems.
  if (/^GM-42(2[8-9]|[3-4]\d)$/.test(code)) return 'error.gm.manifest';
  if (/^GM-\d{4}$/.test(code)) return 'error.gm.unknown';
  return 'error.gm.badRequest';
}

/** Install failure bucket used for stage copy (PRD 9.5.3). */
export function installFailureStage(code) {
  if (includes(DOWNLOAD_STAGE_ERRORS, code)) return 'download';
  if (includes(VERIFY_STAGE_ERRORS, code)) return 'verify';
  if (includes(WRITE_STAGE_ERRORS, code)) return 'write';
  return 'unknown';
}

/** Locale key describing why the install failed. */
export function installFailureReasonKey(code) {
  const stage = installFailureStage(code);
  if (stage === 'download') return 'detail.install.failed.download';
  if (stage === 'verify') return 'detail.install.failed.verify';
  if (stage === 'write') return 'detail.install.failed.write';
  return 'detail.install.failed.unknown';
}

/** Stage label key for the progress row (queued/downloading/verifying/installing). */
export function installStageTextKey(stage, percent) {
  switch (stage) {
    case 'queued':
      return 'detail.install.stage.queued';
    case 'downloading':
      return typeof percent === 'number' ? 'detail.install.stage.downloading' : 'detail.install.stage.downloadingUnknown';
    case 'verifying':
      return 'detail.install.stage.verifying';
    case 'installing':
      return 'detail.install.stage.installing';
    case 'installed':
      return 'detail.install.stage.installed';
    case 'failed':
      return 'detail.install.stage.failed';
    case 'cancelled':
      return 'detail.install.stage.cancelled';
    default:
      return 'detail.install.stage.preparing';
  }
}

/** Whether the operation failed because the Host/registry is unreachable. */
export function isOfflineError(code) {
  return includes(OFFLINE_ERRORS, code);
}

/** Whether another install/uninstall currently holds the Host lock. */
export function isBusyError(code) {
  return includes(BUSY_ERRORS, code);
}

/** Install failures that are worth an automatic retry once the lock clears. */
export function isInstallRetryable(code) {
  return isBusyError(code);
}
