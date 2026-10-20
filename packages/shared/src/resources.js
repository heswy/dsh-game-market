/**
 * V1.5 instance-bound resource URLs (docs/V1.5-CONTRACTS.md §7.1–§7.6).
 *
 * Pure JS: shared by Host (URL construction + request admission), Runtime and
 * Client (validating `LaunchInfo` URLs), and the SDK (`assetUrl`). The actual
 * serving and credential lifetime live in the Host; this module only defines
 * the address shape so both sides cannot drift.
 *
 * Address shape:
 *   http://127.0.0.1:<port>/res/<instanceId>/<resourceToken>/<relativePath>
 *
 * The path prefix is what lets a package's own relative URLs (`./scripts/main.js`,
 * `../assets/coin.png`) resolve naturally without a `<base>` element or rewriting
 * the author's HTML (contract §7.1).
 */

import { INSTANCE_ID_PATTERN, RESOURCE_ORIGIN_PATH } from './constants.js';
import { normalizeZipPath } from './package-v2.js';

/** Resource credentials are opaque, URL-safe, 32 lowercase hex characters. */
export const RESOURCE_TOKEN_PATTERN = Object.freeze(/^[a-f0-9]{32}$/);

/** Paths that are valid archive entries but must never be served (§7.3). */
const NON_SERVABLE = new Set(['dsh-package.json', 'game.json']);

function fail(code, details) {
  return { ok: false, code, ...(details === undefined ? {} : { details }) };
}

/**
 * A resource origin must be an absolute `http://` loopback URL with no path,
 * credentials, query or fragment. Anything else is rejected: the runtime builds
 * URLs from it and MUST NOT be redirectable to another host.
 *
 * @param {unknown} value Candidate origin.
 * @returns {{ok:true, value:string} | {ok:false, code:string, details?:object}}
 */
export function normalizeResourceOrigin(value) {
  if (typeof value !== 'string' || value.length === 0) return fail('E_RESOURCE_SCOPE_DENIED');
  if (value.length > 200) return fail('E_RESOURCE_SCOPE_DENIED');
  let url;
  try {
    url = new URL(value);
  } catch {
    return fail('E_RESOURCE_SCOPE_DENIED');
  }
  if (url.protocol !== 'http:') return fail('E_RESOURCE_SCOPE_DENIED');
  if (url.username !== '' || url.password !== '') return fail('E_RESOURCE_SCOPE_DENIED');
  if (url.search !== '' || url.hash !== '') return fail('E_RESOURCE_SCOPE_DENIED');
  if (url.pathname !== '/' && url.pathname !== '') return fail('E_RESOURCE_SCOPE_DENIED');
  const host = url.hostname;
  const isLoopback = host === '127.0.0.1' || host === '[::1]' || host === '::1';
  if (!isLoopback) return fail('E_RESOURCE_SCOPE_DENIED');
  return { ok: true, value: `http://${url.host}` };
}

/** True when `value` is an absolute http(s) URL (no other scheme accepted). */
export function isAbsoluteHttpUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Resource base for one instance: `<origin>/res/<instanceId>/<token>`.
 *
 * @param {{resourceOrigin:string, instanceId:string, resourceToken:string}} input
 * @returns {{ok:true, value:string} | {ok:false, code:string, details?:object}}
 */
export function buildResourceBase({ resourceOrigin, instanceId, resourceToken }) {
  const origin = normalizeResourceOrigin(resourceOrigin);
  if (!origin.ok) return origin;
  if (typeof instanceId !== 'string' || !INSTANCE_ID_PATTERN.test(instanceId)) {
    return fail('E_RESOURCE_SCOPE_DENIED');
  }
  if (typeof resourceToken !== 'string' || !RESOURCE_TOKEN_PATTERN.test(resourceToken)) {
    return fail('E_RESOURCE_CREDENTIAL_INVALID');
  }
  return { ok: true, value: `${origin.value}${RESOURCE_ORIGIN_PATH}/${instanceId}/${resourceToken}` };
}

/** Decode one URL path segment, mapping malformed percent-encoding to `null`. */
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Parse a resource request pathname into its three parts (§7.3).
 *
 * Admission order matches the contract: prefix, then instance id shape, then
 * token shape, then a path that is already normalized and cannot escape. The
 * *authorization* decisions (does this token match a live instance, is the path
 * in the installed manifest) belong to the Host.
 *
 * @param {string} pathname Request pathname, e.g. `/res/<id>/<token>/scripts/main.js`.
 * @returns {{ok:true, value:{instanceId:string, resourceToken:string, relativePath:string}}
 *          | {ok:false, code:string, details?:object}}
 */
export function validateAssetRequest(pathname) {
  if (typeof pathname !== 'string' || pathname.length === 0) return fail('E_RESOURCE_CREDENTIAL_INVALID');
  if (!pathname.startsWith(`${RESOURCE_ORIGIN_PATH}/`)) return fail('E_RESOURCE_CREDENTIAL_INVALID');

  const rest = pathname.slice(RESOURCE_ORIGIN_PATH.length + 1);
  const slash = rest.indexOf('/');
  if (slash <= 0) return fail('E_RESOURCE_CREDENTIAL_INVALID');
  const rawInstance = rest.slice(0, slash);
  const afterInstance = rest.slice(slash + 1);
  const slash2 = afterInstance.indexOf('/');
  if (slash2 <= 0) return fail('E_RESOURCE_CREDENTIAL_INVALID');
  const rawToken = afterInstance.slice(0, slash2);
  const rawPath = afterInstance.slice(slash2 + 1);

  const instanceId = decodeSegment(rawInstance);
  if (instanceId === null || !INSTANCE_ID_PATTERN.test(instanceId)) {
    return fail('E_RESOURCE_CREDENTIAL_INVALID');
  }
  const resourceToken = decodeSegment(rawToken);
  if (resourceToken === null || !RESOURCE_TOKEN_PATTERN.test(resourceToken)) {
    return fail('E_RESOURCE_CREDENTIAL_INVALID');
  }
  if (rawPath === '' || rawPath.endsWith('/')) return fail('E_RESOURCE_SCOPE_DENIED');

  // Reject percent-encoded separators before decoding: `%2f` (or `%5c`) inside a
  // path segment is a classic way to smuggle a second path component past a
  // checker that decodes first and validates later (contract §7.3).
  if (/%2f|%5c/i.test(rawPath)) return fail('E_RESOURCE_SCOPE_DENIED');

  // Decode before policy checks so `%2e%2e` cannot slip through as a literal.
  const decodedPath = decodeSegment(rawPath);
  if (decodedPath === null) return fail('E_RESOURCE_SCOPE_DENIED');
  const normalized = normalizeZipPath(decodedPath);
  if (!normalized.ok) return fail('E_RESOURCE_SCOPE_DENIED');
  if (NON_SERVABLE.has(normalized.value)) return fail('E_RESOURCE_SCOPE_DENIED');

  return {
    ok: true,
    value: { instanceId, resourceToken, relativePath: normalized.value },
  };
}

/** Extract just the resource token from a resource pathname, or `null`. */
export function resourceCredentialOf(pathname) {
  const parsed = validateAssetRequest(pathname);
  return parsed.ok ? parsed.value.resourceToken : null;
}

/** True when a relative path is safe to append under a resource base. */
export function isResourcePathSafe(relativePath) {
  return typeof relativePath === 'string' && normalizeZipPath(relativePath).ok;
}

/**
 * Build a resource URL for an SDK/author call (§1.10).
 *
 * Resolved with URL semantics so callers may write the same spellings that work
 * in a browser (`./levels/x.json`, `levels/x.json`); the result is then pinned
 * to `<base>/` so a `..` cannot escape the instance prefix.
 *
 * @param {string} resourceBase `<origin>/res/<instanceId>/<token>`.
 * @param {string} relativePath Package-relative path.
 * @returns {{ok:true, value:string} | {ok:false, code:string, details?:object}}
 */
export function assetUrl(resourceBase, relativePath) {
  if (typeof resourceBase !== 'string' || resourceBase.length === 0) {
    return fail('E_RESOURCE_SCOPE_DENIED');
  }
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return fail('E_RESOURCE_SCOPE_DENIED');
  }
  if (relativePath.includes('\\') || relativePath.includes('\u0000')) {
    return fail('E_RESOURCE_SCOPE_DENIED');
  }
  const base = resourceBase.endsWith('/') ? resourceBase.slice(0, -1) : resourceBase;
  let baseUrl;
  try {
    baseUrl = new URL(base);
  } catch {
    return fail('E_RESOURCE_SCOPE_DENIED');
  }
  const prefix = `${baseUrl.pathname}/`;
  if (!prefix.endsWith('/') || baseUrl.pathname.split('/').filter(Boolean).length !== 3) {
    return fail('E_RESOURCE_SCOPE_DENIED');
  }
  const segments = baseUrl.pathname.split('/').filter(Boolean);
  if (`/${segments[0]}` !== RESOURCE_ORIGIN_PATH) return fail('E_RESOURCE_SCOPE_DENIED');
  if (!INSTANCE_ID_PATTERN.test(segments[1]) || !RESOURCE_TOKEN_PATTERN.test(segments[2])) {
    return fail('E_RESOURCE_SCOPE_DENIED');
  }

  let resolved;
  try {
    resolved = new URL(relativePath, `${base}/`);
  } catch {
    return fail('E_RESOURCE_SCOPE_DENIED');
  }
  if (resolved.origin !== baseUrl.origin) return fail('E_RESOURCE_SCOPE_DENIED');
  if (!resolved.pathname.startsWith(prefix)) return fail('E_RESOURCE_SCOPE_DENIED');
  const rest = resolved.pathname.slice(prefix.length);
  if (rest === '' || resolved.pathname.endsWith('/')) return fail('E_RESOURCE_SCOPE_DENIED');
  const normalized = normalizeZipPath(decodeSegment(rest) ?? '\u0000');
  if (!normalized.ok) return fail('E_RESOURCE_SCOPE_DENIED');
  if (NON_SERVABLE.has(normalized.value)) return fail('E_RESOURCE_SCOPE_DENIED');
  return { ok: true, value: `${base}/${normalized.value}` };
}

/**
 * Compare two URLs' origins, used by Runtime/Client to confirm a wrapper or
 * resource URL belongs to the advertised resource origin.
 */
export function sharesOrigin(candidate, origin) {
  if (!isAbsoluteHttpUrl(candidate) || typeof origin !== 'string') return false;
  try {
    return new URL(candidate).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}
