/**
 * SDK-side instance resource URL builder (V1.5 contract §1.10 / §7.6).
 *
 * Why this is a small local module instead of importing the shared
 * `resources.js` implementation: the SDK is inlined into single-file game HTML
 * and the package validator scans that HTML text for external references and
 * network APIs. Inlining the full shared validator would trip those heuristics
 * on unrelated code text and make every game fail validation. The
 * normalization rules here are the request-side subset of contract §4.2 and
 * MUST stay aligned with `packages/shared/src/resources.js#assetUrl`; the
 * parity is pinned by `tests/v1.5-runtime-resources.test.js`.
 *
 * The base is `<origin>/res/<instanceId>/<resourceToken>`; the returned value
 * is an absolute URL string. This module is pure string manipulation on
 * purpose: no browser globals, no network-capable text in the inlined bundle.
 */

const LOOPBACK_BASE_RE = /^http:\/\/(127(?:\.\d{1,3}){3}|\[::1\]):(\d{1,5})\/res\/([a-f0-9]{32})\/([a-f0-9]{32})\/?$/;
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/;
const DRIVE_LETTER_RE = /^[A-Za-z]:/;
const ENCODED_TRAVERSAL_RE = /%(?:2e|2f|5c|00)/i;
const WINDOWS_RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);
const NON_SERVABLE = new Set(['dsh-package.json', 'game.json']);
const MAX_PATH_CHARS = 240;
const MAX_PATH_DEPTH = 12;

/** Validate + canonicalize a resource base; returns the base or `null`. */
export function normalizeResourceBase(resourceBase) {
  if (typeof resourceBase !== 'string' || resourceBase.length === 0 || resourceBase.length > 300) return null;
  if (CONTROL_CHARS_RE.test(resourceBase) || resourceBase.includes(' ')) return null;
  if (!LOOPBACK_BASE_RE.test(resourceBase)) return null;
  return resourceBase.endsWith('/') ? resourceBase.slice(0, -1) : resourceBase;
}

/**
 * Normalize a package-relative path (request side of contract §4.2).
 * Returns `null` for anything that is not a safe, in-package path.
 */
export function normalizeAssetPath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) return null;
  if (relativePath.length > MAX_PATH_CHARS * 4) return null;
  if (CONTROL_CHARS_RE.test(relativePath) || relativePath.includes('\\')) return null;
  if (relativePath.includes('?') || relativePath.includes('#')) return null;
  if (relativePath.startsWith('/') || relativePath.startsWith('//')) return null;
  if (DRIVE_LETTER_RE.test(relativePath)) return null;
  if (ENCODED_TRAVERSAL_RE.test(relativePath)) return null;

  const segments = relativePath.split('/');
  const stack = [];
  for (const segment of segments) {
    if (segment.length === 0) return null;
    if (segment === '.') continue;
    if (segment === '..') {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    if (/[ .]$/.test(segment)) return null;
    const stem = segment.split('.')[0].toLowerCase();
    if (WINDOWS_RESERVED.has(stem)) return null;
    stack.push(segment);
  }
  if (stack.length === 0 || stack.length > MAX_PATH_DEPTH) return null;
  const normalized = stack.join('/');
  if (normalized.length > MAX_PATH_CHARS) return null;
  if (NON_SERVABLE.has(normalized)) return null;
  return normalized;
}

/**
 * Build `${resourceBase}/${normalize(relativePath)}`.
 * @returns {{ok:true, value:string} | {ok:false}}
 */
export function buildResourceHref(resourceBase, relativePath) {
  const base = normalizeResourceBase(resourceBase);
  if (!base) return { ok: false };
  const normalized = normalizeAssetPath(relativePath);
  if (!normalized) return { ok: false };
  return { ok: true, value: `${base}/${normalized}` };
}
