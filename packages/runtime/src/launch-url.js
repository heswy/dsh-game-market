/**
 * Instance-resource URL helpers (V1.5-CONTRACTS §7.2, §7.5.1, §7.6).
 *
 * Two credentials exist per Runtime instance:
 *   1. the one-shot launch URL (`LaunchInfo.entryUrl`) — first navigation only;
 *   2. the instance-bound resource credential (`LaunchInfo.entryResourceUrl`,
 *      prefixed by `LaunchInfo.resourceBase`) — every reload/retry/iframe rebuild.
 *
 * Path normalization, origin validation and `assetUrl` live in
 * `packages/shared/src/resources.js` (single source of truth, M1 Lead-owned).
 * This module only adds the wrapper-navigation rules layered on top of it, and
 * stays pure (no DOM) so the Runtime, the Client guard and tests share it.
 */

import { GM } from '../../shared/src/errors.js';
import { RESOURCE_WRAPPER_PATH, RESOURCE_WRAPPER_QUERY } from '../../shared/src/constants.js';
import { isAbsoluteHttpUrl, normalizeResourceOrigin as normalizeOrigin, sharesOrigin } from '../../shared/src/resources.js';

const DRIVE_RE = /^[A-Za-z]:/;
const CONTROL_RE = /[\u0000-\u001F\u007F]/;
const ENCODED_TRAVERSAL_RE = /%(?:2e|2f|5c|00)/i;

/** Legacy `/api/game-market/entry?...` relative URL (V0/V1 Host). */
export function isSafeLegacyEntryUrl(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 4096) return false;
  if (CONTROL_RE.test(value) || value.includes('\\')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return false;
  if (value.charAt(0) === '/' && value.charAt(1) === '/') return false;
  if (value.indexOf('#') !== -1 || value.indexOf('..') !== -1) return false;
  const lower = value.toLowerCase();
  if (ENCODED_TRAVERSAL_RE.test(lower)) return false;
  let path = value;
  while (path.charAt(0) === '/') path = path.slice(1);
  if (path.startsWith('//')) return false;
  const queryIndex = path.indexOf('?');
  const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex);
  return pathname === 'api/game-market/entry';
}

/**
 * Entry URL is either the legacy same-origin API path (html-v1) or an absolute
 * loopback resource-origin URL (asset-zip-v2). Neither may be a
 * `javascript:`/`data:`/external URL or carry traversal.
 */
export function isSafeEntryUrl(value) {
  if (isSafeLegacyEntryUrl(value)) return true;
  if (!isAbsoluteHttpUrl(value)) return false;
  try {
    const url = new URL(value);
    if (url.pathname === '' || url.pathname === '/' || url.hash !== '') return false;
    if (url.pathname.includes('..')) return false;
    if (CONTROL_RE.test(value) || value.includes('\\')) return false;
    if (ENCODED_TRAVERSAL_RE.test(value)) return false;
    return true;
  } catch (_error) {
    return false;
  }
}

/** Normalize a resource origin (`http://127.0.0.1:<port>`); null when invalid. */
export function resourceOriginOf(value) {
  const normalized = normalizeOrigin(value);
  return normalized.ok ? normalized.value : null;
}

/** True when `value` is an instance resource prefix `/res/<instance>/<token>`. */
export function isResourceBase(value) {
  if (!isAbsoluteHttpUrl(value)) return false;
  try {
    const url = new URL(value);
    if (url.search || url.hash) return false;
    if (!/^\/res\/[a-f0-9]{32}\/[a-f0-9]{32}\/?$/.test(url.pathname)) return false;
    return normalizeOrigin(url.origin).ok;
  } catch (_error) {
    return false;
  }
}

/** True when `value` is an entry URL under the given resource base. */
export function isEntryResourceUrl(value, resourceBase) {
  if (!isAbsoluteHttpUrl(value) || typeof resourceBase !== 'string') return false;
  if (!sharesOrigin(value, resourceBase)) return false;
  let url;
  let base;
  try {
    url = new URL(value);
    base = new URL(resourceBase);
  } catch (_error) {
    return false;
  }
  if (url.hash) return false;
  const basePath = base.pathname.replace(/\/+$/, '');
  if (!url.pathname.startsWith(`${basePath}/`)) return false;
  if (url.pathname.includes('..')) return false;
  return true;
}

/**
 * Append the launch identity query to a game-document URL. The one-shot launch
 * URL already carries it; resource-credential reload URLs must gain it because
 * the game SDK reads `instance`/`nonce` from `location.search`.
 */
export function withLaunchQuery(gameUrl, instanceId, nonce) {
  if (!isAbsoluteHttpUrl(gameUrl)) return gameUrl;
  let url;
  try {
    url = new URL(gameUrl);
  } catch (_error) {
    return gameUrl;
  }
  let changed = false;
  if (typeof instanceId === 'string' && instanceId && url.searchParams.get('instance') !== instanceId) {
    url.searchParams.set('instance', instanceId);
    changed = true;
  }
  if (typeof nonce === 'string' && nonce && url.searchParams.get('nonce') !== nonce) {
    url.searchParams.set('nonce', nonce);
    changed = true;
  }
  return changed ? url.toString() : gameUrl;
}

/**
 * Build the wrapper document URL for one navigation.
 *
 * The wrapper is a platform-served trusted static document on the resource
 * origin (no game bytes, no credential carrier). The Runtime embeds it without
 * a `sandbox` attribute — a sandboxed ancestor is opaque-origin and would make
 * the nested game document fail its `frame-ancestors` ancestor-chain check
 * (Lead decision 2026-10-20, browser-probed). The wrapper itself creates the
 * sandboxed game iframe. The game-document URL travels in the `?src=` parameter
 * and the wrapper relays bridge traffic point-to-point (contract §7.5.1: the
 * wrapper carries no capability). The Runtime always writes `src` itself, so a
 * Host that hands back a stale/foreign `src` cannot redirect this instance.
 *
 * @param {{resourceOrigin:string, wrapperUrl?:string|null}} launchInfo
 * @param {string} gameUrl exact game-document URL to embed
 * @param {'launch'|'resource'} mode which optional wrapper field to prefer
 * @returns {string|null} absolute wrapper URL, or null when the LaunchInfo is inconsistent
 */
export function buildWrapperFrameUrl(launchInfo, gameUrl, mode) {
  if (!launchInfo || typeof launchInfo !== 'object' || typeof gameUrl !== 'string' || gameUrl.length === 0) {
    return null;
  }
  const origin = resourceOriginOf(launchInfo.resourceOrigin);
  if (!origin) return null;
  const explicit =
    mode === 'resource'
      ? typeof launchInfo.wrapperResourceUrl === 'string' && launchInfo.wrapperResourceUrl.length > 0
        ? launchInfo.wrapperResourceUrl
        : null
      : typeof launchInfo.wrapperUrl === 'string' && launchInfo.wrapperUrl.length > 0
        ? launchInfo.wrapperUrl
        : null;
  let wrapper;
  if (explicit !== null) {
    // Fail closed: a provided wrapper URL that is not an absolute URL on the
    // advertised resource origin is a contract violation, not something to fix
    // up silently.
    if (!isAbsoluteHttpUrl(explicit) || !sharesOrigin(explicit, origin)) return null;
    try {
      wrapper = new URL(explicit);
    } catch (_error) {
      return null;
    }
  } else {
    wrapper = new URL(`${origin}${RESOURCE_WRAPPER_PATH}`);
  }
  wrapper.searchParams.set(RESOURCE_WRAPPER_QUERY, gameUrl);
  return wrapper.toString();
}

export function resourceScopeError(message) {
  return { code: GM.RESOURCE_SCOPE_DENIED, message: message || 'Resource path is outside this instance' };
}
