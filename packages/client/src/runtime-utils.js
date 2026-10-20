/**
 * Client-side guards around Runtime launch data and loading deadlines.
 * The Runtime owns the iframe, but the Client still refuses obviously unsafe
 * entry URLs or incomplete launch descriptors before rendering anything.
 *
 * V1.5: `LaunchInfo` may additionally carry the instance resource fields
 * (contract §7.6). They are validated here so a malformed Host response fails
 * with a precise GM code before any iframe is created.
 */
import { INSTANCE_ID_PATTERN, NONCE_PATTERN, PACKAGE_FORMATS, TIMING } from '../../shared/src/constants.js';
import { GM, makeGameError } from '../../shared/src/errors.js';
import { normalizeZipPath } from '../../shared/src/package-v2.js';
import { isAbsoluteHttpUrl, normalizeResourceOrigin, sharesOrigin } from '../../shared/src/resources.js';
import { isEntryResourceUrl, isResourceBase, isSafeEntryUrl as isSafeEntryUrlImpl } from '../../runtime/src/launch-url.js';

/**
 * Entry URLs must stay a same-origin relative API path (html-v1) or an absolute
 * http(s) URL on the instance resource origin (asset-zip-v2). Schemes,
 * protocol-relative hosts, backslashes, encoded separators and traversal are
 * rejected.
 */
export function isSafeEntryUrl(value) {
  if (!isSafeEntryUrlImpl(value)) return false;
  // Absolute entry URLs must point at a loopback resource origin; the legacy
  // relative `/api/game-market/entry` form has no origin at all.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    try {
      if (!normalizeResourceOrigin(new URL(value).origin).ok) return false;
    } catch (_error) {
      return false;
    }
  }
  return true;
}

function launchError(code, retryable) {
  return { ok: false, error: makeGameError(code, null, { retryable: retryable === true }) };
}

function validViewport(viewport) {
  return Boolean(
    viewport &&
      typeof viewport === 'object' &&
      typeof viewport.width === 'number' &&
      viewport.width > 0 &&
      typeof viewport.height === 'number' &&
      viewport.height > 0
  );
}

/**
 * Validate the V1.5 instance-resource extension. Missing fields keep the V1
 * html-v1 launch working unchanged; a partial or contradictory set fails
 * closed (an asset-zip-v2 package without a resource credential can never load
 * its own files).
 *
 * @returns {{ok:true} | {ok:false, error: object}}
 */
function validateLaunchResources(info) {
  const hasAny =
    info.resourceOrigin !== undefined ||
    info.resourceBase !== undefined ||
    info.entryResourceUrl !== undefined ||
    info.resourceTtlMs !== undefined ||
    info.package !== undefined ||
    info.wrapperUrl !== undefined ||
    info.wrapperResourceUrl !== undefined;
  if (!hasAny) return { ok: true };

  const pkg = info.package;
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) return launchError(GM.INVALID_PARAM, false);
  if (!PACKAGE_FORMATS.includes(pkg.format)) return launchError(GM.INVALID_PARAM, false);
  const entryPath = normalizeZipPath(pkg.entry);
  if (!entryPath.ok) return launchError(GM.INVALID_PARAM, false);
  if (pkg.filesDigest !== null && (typeof pkg.filesDigest !== 'string' || !/^[a-f0-9]{64}$/.test(pkg.filesDigest))) {
    return launchError(GM.INVALID_PARAM, false);
  }

  if (typeof info.resourceOrigin !== 'string' || !normalizeResourceOrigin(info.resourceOrigin).ok) {
    return launchError(GM.INVALID_PARAM, false);
  }
  if (typeof info.resourceBase !== 'string' || !isResourceBase(info.resourceBase)) {
    return launchError(GM.INVALID_PARAM, false);
  }
  if (!sharesOrigin(info.resourceBase, info.resourceOrigin)) return launchError(GM.INVALID_PARAM, false);
  if (typeof info.entryResourceUrl !== 'string' || !isEntryResourceUrl(info.entryResourceUrl, info.resourceBase)) {
    return launchError(GM.INVALID_PARAM, false);
  }
  if (
    info.resourceTtlMs !== undefined &&
    (typeof info.resourceTtlMs !== 'number' || !Number.isFinite(info.resourceTtlMs) || info.resourceTtlMs <= 0)
  ) {
    return launchError(GM.INVALID_PARAM, false);
  }
  for (const field of ['wrapperUrl', 'wrapperResourceUrl']) {
    const value = info[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || !isAbsoluteHttpUrl(value) || !sharesOrigin(value, info.resourceOrigin)) {
      return launchError(GM.INVALID_PARAM, false);
    }
  }
  if (pkg.format === 'asset-zip-v2') {
    // The wrapped game document must live on the advertised resource origin.
    if (typeof info.entryUrl !== 'string' || !isAbsoluteHttpUrl(info.entryUrl)) {
      return launchError(GM.ASSET_INTEGRITY, false);
    }
    if (!sharesOrigin(info.entryUrl, info.resourceOrigin)) return launchError(GM.ASSET_INTEGRITY, false);
  }
  return { ok: true };
}

/**
 * Validate the `POST launch` payload before handing it to the Runtime.
 * Returns `{ok:true, info}` or `{ok:false, error}` (GM code only).
 */
export function validateLaunchInfo(info) {
  if (!info || typeof info !== 'object' || Array.isArray(info)) return launchError(GM.INVALID_PARAM, false);
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
  if (info.viewport !== undefined && info.viewport !== null && !validViewport(info.viewport)) {
    return launchError(GM.INVALID_PARAM, false);
  }
  const resources = validateLaunchResources(info);
  if (!resources.ok) return resources;
  return { ok: true, info: info };
}

/**
 * True when this launch can be reloaded in place with its instance resource
 * credential (V1.5). Legacy V1 html-v1 launches must ask the Host for a fresh
 * one-shot launch instead of replaying the consumed URL.
 */
export function canReloadRuntime(launchInfo) {
  return Boolean(
    launchInfo &&
      typeof launchInfo === 'object' &&
      typeof launchInfo.entryResourceUrl === 'string' &&
      launchInfo.entryResourceUrl.length > 0 &&
      typeof launchInfo.instanceId === 'string' &&
      launchInfo.instanceId.length > 0
  );
}

/** Runtime failures that a resource-credential reload can plausibly fix. */
const RELOADABLE_RUNTIME_ERRORS = Object.freeze([
  GM.LOAD_TIMEOUT,
  GM.HANDSHAKE_TIMEOUT,
  GM.ENTRY_LAUNCH_CONSUMED,
]);

export function shouldReloadRuntime(error, launchInfo) {
  if (!canReloadRuntime(launchInfo)) return false;
  if (!error || typeof error !== 'object') return false;
  return RELOADABLE_RUNTIME_ERRORS.includes(error.code);
}

/** Renew failures that mean the Host instance/credential is gone for good. */
const TERMINAL_RESOURCE_ERRORS = Object.freeze([
  GM.RESOURCE_CREDENTIAL_INVALID,
  GM.RESOURCE_CREDENTIAL_EXPIRED,
  GM.ENTRY_CREDENTIAL_CONSUMED,
  GM.ENTRY_LAUNCH_CONSUMED,
  GM.RESOURCE_SCOPE_DENIED,
  GM.GAME_NOT_FOUND,
]);

export function isTerminalResourceError(error) {
  if (!error || typeof error !== 'object') return false;
  return TERMINAL_RESOURCE_ERRORS.includes(error.code);
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
