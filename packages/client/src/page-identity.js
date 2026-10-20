/**
 * Per-tab identity used by the V1.5 M3 update protocol
 * (m3-decisions §2/§4: client-report and coordinate are window scoped).
 *
 * - `windowId`   identifies one browser tab and survives a page reload
 *                (sessionStorage), so the Host can tell a refreshed page from a
 *                second window.
 * - `clientId`   identifies one loaded Client instance (new on every page load).
 * - `pageToken`  identifies one page lifecycle; coordinate/client-report use it
 *                to deduplicate reports per page load (multi-window safe).
 *
 * Tokens are 32 lowercase hex characters. Generation never throws: a browser
 * without crypto falls back to Math.random, and a blocked sessionStorage just
 * degrades windowId to per-page scope.
 */
const STORAGE_KEY = 'dgm.platform-update.window-id';
/** Same shape as Runtime instance ids: 32 lowercase hex characters (16 bytes). */
const TOKEN_HEX_CHARS = 32;
const TOKEN_BYTES = TOKEN_HEX_CHARS / 2;
const TOKEN_RE = /^[a-f0-9]{32}$/;

function randomBytes(cryptoImpl, length) {
  const bytes = new Uint8Array(length);
  const impl = cryptoImpl && typeof cryptoImpl.getRandomValues === 'function' ? cryptoImpl : null;
  if (impl) {
    try {
      impl.getRandomValues(bytes);
      return bytes;
    } catch (_error) {
      // fall through to Math.random
    }
  }
  for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

/** Generate a 32-hex token (same alphabet/size as Runtime instance ids). */
export function createToken(cryptoImpl, length) {
  const size = typeof length === 'number' && length > 0 ? Math.floor(length) : TOKEN_BYTES;
  const bytes = randomBytes(cryptoImpl, size);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** True for the token format this module issues. */
export function isPageToken(value) {
  return typeof value === 'string' && TOKEN_RE.test(value);
}

function safeSessionStorage() {
  try {
    const storage = globalThis.sessionStorage;
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') return null;
    return storage;
  } catch (_error) {
    return null;
  }
}

function readStoredWindowId(storage) {
  if (!storage) return null;
  try {
    const value = storage.getItem(STORAGE_KEY);
    return isPageToken(value) ? value : null;
  } catch (_error) {
    return null;
  }
}

function storeWindowId(storage, value) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, value);
  } catch (_error) {
    // Quota/private mode: windowId simply becomes page scoped.
  }
}

/**
 * Build one page identity.
 * @param {{storage?: object|null, crypto?: object, now?: Function}} [options]
 */
export function createPageIdentity(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const cryptoImpl = opts.crypto || globalThis.crypto;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const storage = Object.prototype.hasOwnProperty.call(opts, 'storage') ? opts.storage : safeSessionStorage();
  let windowId = readStoredWindowId(storage);
  if (windowId === null) {
    windowId = createToken(cryptoImpl);
    storeWindowId(storage, windowId);
  }
  const startedAtMs = now();
  let startedAt = '';
  try {
    startedAt = new Date(typeof startedAtMs === 'number' ? startedAtMs : Date.now()).toISOString();
  } catch (_error) {
    startedAt = new Date().toISOString();
  }
  return Object.freeze({
    windowId: windowId,
    clientId: createToken(cryptoImpl),
    pageToken: createToken(cryptoImpl),
    startedAt: startedAt,
  });
}

let identity = null;

/** Plugin-wide page identity (one per loaded Client page). */
export function getPageIdentity() {
  if (identity === null) identity = createPageIdentity();
  return identity;
}

/** Test seam: replace/reset the singleton. */
export function configurePageIdentity(next) {
  identity = next && typeof next === 'object' ? next : null;
  return function reset() {
    identity = null;
  };
}
