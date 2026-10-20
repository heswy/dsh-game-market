/**
 * V1.5 instance resource origin (docs/V1.5-CONTRACTS.md §7).
 *
 * The resource service is a *separate loopback HTTP origin* the plugin owns:
 *
 *   GET|HEAD http://127.0.0.1:<port>/res/<instanceId>/<resourceToken>/<relativePath>
 *
 * Why it exists (S-A1, `docs/verification/v1.5/resources.md` §4): DSH's
 * `connection.fetch.register` only accepts `/api/*` and the `/api` prefix is
 * fenced by the platform's Origin / `sec-fetch-site` checks, so an opaque-origin
 * sandboxed iframe (Origin: null) can never read subresources from it. The M0
 * probe validated an independent loopback origin end to end; this module is the
 * production implementation of exactly that design.
 *
 * This origin serves **only** instance resources and the platform wrapper
 * document (§7.5.1). It has no Host routes, no writes, no diagnostics:
 *
 *   - `GET|HEAD /res/<id>/<token>/<path>` — one file from the instance's
 *     validated manifest (`html-v1`: the single `entry.html`; `asset-zip-v2`:
 *     the package descriptor's `files[]`). Nothing else can be addressed.
 *   - `GET|HEAD /wrapper?src=<resource-url>` — static, uncredentialed,
 *     game-content-free platform document whose CSP pins `frame-src`/`child-src`
 *     to this origin, closing the CR-P1 self-navigation gap.
 *
 * Credentials:
 *   - the instance-bound resource credential is the token path segment; it is
 *     repeatable (GET/HEAD), renewed by `POST /runtime-renew` and invalidated by
 *     `POST /runtime-release` or TTL expiry (§7.2);
 *   - the one-shot launch credential rides on the entry document request as
 *     `?launch=<nonce>`: the first 200 consumes it, a replay is 410, and the
 *     bare resource-credential URL stays readable for reload/retry (§7.2).
 *
 * Response headers are the S-A1 frozen set (§7.3/§7.4, `resources.md` §3):
 * exact MIME + `nosniff`, `content-length`, `cache-control: no-store`,
 * `referrer-policy: no-referrer`, anonymous `access-control-allow-origin: *`,
 * never `Set-Cookie` / `Access-Control-Allow-Credentials` / redirects, and a CSP
 * only on the entry document (explicit resource origin, never `'self'`).
 */

import { timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import {
  ASSET_ZIP_V2,
  DEFAULT_PACKAGE_FORMAT,
  DESCRIPTOR_FILE,
  INSTANCE_ID_PATTERN,
  LIMITS,
  PACKAGE_FORMATS,
  RESOURCE_ORIGIN_PATH,
  RESOURCE_WRAPPER_PATH,
  RESOURCE_WRAPPER_QUERY,
  TIMING,
} from '../../shared/src/constants.js';
import { GM, INTERNAL_TO_GM, defaultMessageFor } from '../../shared/src/errors.js';
import {
  checkZipEntryType,
  fileManifestDigest,
  normalizeZipPath,
  validateDescriptor,
} from '../../shared/src/package-v2.js';
import { buildResourceBase, sharesOrigin, validateAssetRequest } from '../../shared/src/resources.js';
import { DEFAULT_FRAME_ANCESTORS } from './config.js';
import { buildContentSecurityPolicy } from './entry.js';
import { hostError, statusForGm } from './errors.js';
import { randomHex, sha256Hex } from './ids.js';

const LOOPBACK_HOST = '127.0.0.1';
const RESOURCE_ID_PATTERN = INSTANCE_ID_PATTERN;
const PACKAGE_FORMATS_SET = new Set(PACKAGE_FORMATS);
const MAX_ANCESTOR_ENTRIES = 16;
const MAX_WRAPPER_TARGET_LENGTH = 2048;

/**
 * The loopback origin reuses the Host's single GM -> HTTP authority
 * (`errors.js#statusForGm`) so the resource surface and `/api` cannot drift.
 * Resource errors are JSON `{ok:false,error:{code,message}}` (§7.3):
 * GM-4010 -> 401, GM-4011 -> 403, GM-4012 -> 400, GM-4013 -> 410,
 * GM-4039 -> 403, GM-4043 -> 404.
 */
function statusFor(code) {
  return statusForGm(code);
}

/** Textual asset types get `charset=utf-8`; everything else is byte-exact. */
const TEXT_MIME_BY_EXT = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
});

const BINARY_MIME_BY_EXT = Object.freeze({
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
});

const TEXT_EXTENSIONS = new Set(Object.keys(TEXT_MIME_BY_EXT));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/** Structural magic checks for binary assets (§4.6 type = extension + magic). */
function binaryMagicValid(extension, bytes) {
  switch (extension) {
    case '.png':
      return bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE);
    case '.jpeg':
    case '.jpg':
      return bytes.length >= 3 && bytes.subarray(0, 3).equals(JPEG_SIGNATURE);
    case '.gif': {
      const head = bytes.subarray(0, 6).toString('latin1');
      return head === 'GIF87a' || head === 'GIF89a';
    }
    case '.webp':
      return (
        bytes.length >= 12 &&
        bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
        bytes.subarray(8, 12).toString('latin1') === 'WEBP'
      );
    case '.ogg':
      return bytes.length >= 4 && bytes.subarray(0, 4).toString('latin1') === 'OggS';
    case '.wav':
      return (
        bytes.length >= 12 &&
        bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
        bytes.subarray(8, 12).toString('latin1') === 'WAVE'
      );
    case '.m4a':
      return bytes.length >= 8 && bytes.subarray(4, 8).toString('latin1') === 'ftyp';
    case '.woff':
      return bytes.length >= 4 && bytes.subarray(0, 4).toString('latin1') === 'wOFF';
    case '.woff2':
      return bytes.length >= 4 && bytes.subarray(0, 4).toString('latin1') === 'wOF2';
    case '.mp3': {
      if (bytes.length >= 3 && bytes.subarray(0, 3).toString('latin1') === 'ID3') return true;
      // MPEG audio frame sync: 0xFFE (11 bits set).
      return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
    }
    default:
      return false;
  }
}

/** Exact MIME for a manifest path; `null` when the extension is not servable. */
export function mimeForResource(relPath) {
  const lower = String(relPath || '').toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot <= lower.lastIndexOf('/')) return null;
  const extension = lower.slice(dot);
  return TEXT_MIME_BY_EXT[extension] || BINARY_MIME_BY_EXT[extension] || null;
}

function extensionOf(relPath) {
  const lower = String(relPath || '').toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot <= lower.lastIndexOf('/')) return null;
  return lower.slice(dot);
}

/**
 * Verify that served bytes match their declared type (extension + magic,
 * contract §4.6). A `.js` whose bytes are a nested archive is exactly the
 * "disguised container" case this rejects.
 */
function checkServedContent(relPath, bytes) {
  const extension = extensionOf(relPath);
  if (extension === null) return { ok: false, code: GM.ASSET_TYPE_UNSUPPORTED };
  // No asset may be a ZIP/archive smuggled in under a static extension.
  if (bytes.length >= 4) {
    const head = bytes.subarray(0, 4);
    if (head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05)) {
      return { ok: false, code: GM.ASSET_TYPE_UNSUPPORTED };
    }
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (_error) {
      return { ok: false, code: GM.ASSET_TYPE_UNSUPPORTED };
    }
    if (text.includes('\u0000')) return { ok: false, code: GM.ASSET_TYPE_UNSUPPORTED };
    if (extension === '.svg' && !/<svg[\s>]/i.test(text)) {
      return { ok: false, code: GM.ASSET_TYPE_UNSUPPORTED };
    }
    return { ok: true };
  }
  if (!binaryMagicValid(extension, bytes)) {
    return { ok: false, code: GM.ASSET_TYPE_UNSUPPORTED };
  }
  return { ok: true };
}

function nowMsOf(now) {
  const value = now();
  if (value instanceof Date) return value.getTime();
  if (Number.isFinite(value)) return value;
  return Date.now();
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''), 'utf8');
  const b = Buffer.from(String(right ?? ''), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The DSH web origin used as the *exact* `frame-ancestors` entry for
 * `asset-zip-v2` entry documents (§7.5 as landed: the wrapper is a second
 * ancestor on the resource origin, so both must be listed). Explicit origins
 * only: no wildcards, no credentials, no path.
 */
function normaliseWebOrigin(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return null;
  let url;
  try {
    url = new URL(value);
  } catch (_error) {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.search !== '' || url.hash !== '') return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  return url.origin;
}

function normaliseFrameAncestors(candidates) {
  const list = Array.isArray(candidates) && candidates.length > 0 ? candidates : DEFAULT_FRAME_ANCESTORS;
  const out = [];
  for (const candidate of list.slice(0, 32)) {
    if (typeof candidate !== 'string') continue;
    const value = candidate.trim();
    if (value.length === 0 || value.length > 256 || /[\s;]/.test(value)) continue;
    if (value === '*' || /^(?:data|blob):/i.test(value)) continue;
    if (!out.includes(value) && out.length < MAX_ANCESTOR_ENTRIES) out.push(value);
  }
  return out.length > 0 ? out : [...DEFAULT_FRAME_ANCESTORS];
}

// ---------------------------------------------------------------------------
// CSP builders (§7.5 / §7.5.1)
// ---------------------------------------------------------------------------

/**
 * `asset-zip-v2` entry-document CSP (§7.5): explicit resource origin, no
 * `'self'`, no `'unsafe-inline'`, no `upgrade-insecure-requests` (the resource
 * origin is loopback http). `frame-ancestors` carries the configured V1
 * allowlist **and** the resource origin: inside the §7.5.1 wrapper the wrapper
 * document is an additional ancestor, and `frame-ancestors` checks every
 * ancestor, so omitting it would break the documented runtime path.
 */
export function buildAssetContentSecurityPolicy({ resourceOrigin, frameAncestors }) {
  // `'self'` can never match: the game document runs in a sandboxed opaque
  // origin (§7.5 S-A1-23), so the zip CSP always names concrete origins.
  const ancestors = normaliseFrameAncestors(frameAncestors).filter((entry) => entry !== "'self'");
  if (!ancestors.includes(resourceOrigin)) ancestors.push(resourceOrigin);
  return [
    "default-src 'none'",
    `script-src ${resourceOrigin}`,
    `style-src ${resourceOrigin}`,
    `img-src ${resourceOrigin} data:`,
    `media-src ${resourceOrigin}`,
    `font-src ${resourceOrigin}`,
    `connect-src ${resourceOrigin}`,
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${ancestors.join(' ')}`,
  ].join('; ');
}

/**
 * Wrapper CSP (§7.5.1): the wrapper is the only document that may frame a game,
 * and it may frame nothing but this resource origin. The one script the wrapper
 * runs is its point-to-point relay, admitted by a per-response nonce (the
 * wrapper never needs `'unsafe-inline'`); inline style is allowed for a
 * full-bleed iframe only. `frame-src`/`child-src` are the directives the CR-P1
 * proof relied on.
 */
export function buildWrapperContentSecurityPolicy(resourceOrigin, nonce = null, frameAncestors = null) {
  const scriptSource = typeof nonce === 'string' && nonce.length > 0 ? `'nonce-${nonce}'` : "'none'";
  // The wrapper is a trusted platform document on the resource origin and may
  // only be embedded by the DSH page: it must not be frameable by an arbitrary
  // website. `dshWebOrigin` (when known) is the exact value; otherwise the V1
  // configured allowlist is used (§7.5 `config.security.frameAncestors`).
  const ancestors = normaliseFrameAncestors(frameAncestors);
  return [
    "default-src 'none'",
    `frame-src ${resourceOrigin}`,
    `child-src ${resourceOrigin}`,
    `script-src ${scriptSource}`,
    "style-src 'unsafe-inline'",
    "img-src 'none'",
    "media-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${ancestors.join(' ')}`,
  ].join('; ');
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Point-to-point bridge relay (§7.5.1 / M1-D). The game runs in the wrapper's
 * child iframe, so `window.parent` seen by the game is the wrapper. The wrapper
 * forwards a message to exactly one destination based on its real `event.source`
 * and never parses, rewrites or stores the payload:
 *
 *   - message from `window.parent` (the host page / Runtime) -> game iframe;
 *   - message from the game iframe -> `window.parent`;
 *   - anything else is dropped (no broadcast, no echo back to the sender).
 */
function wrapperRelayScript() {
  return [
    '(function () {',
    "  var frame = document.getElementById('dsh-game-frame');",
    '  if (!frame || !frame.contentWindow) return;',
    "  window.addEventListener('message', function (event) {",
    '    try {',
    '      if (event.source === window.parent) {',
    "        frame.contentWindow.postMessage(event.data, '*');",
    '      } else if (event.source === frame.contentWindow) {',
    "        window.parent.postMessage(event.data, '*');",
    '      }',
    '    } catch (_error) {',
    '      // A closed frame must never break the relay for later messages.',
    '    }',
    '  });',
    '})();',
  ].join('\n');
}

/**
 * Static wrapper document template. It contains no game bytes and no
 * credentials: the optional `src` query only selects which same-origin resource
 * URL the child iframe points at.
 *
 * Sandbox layering (M1 real-browser finding, `raw/m1/blocker-wrapper-frame-
 * ancestors-*.json`): the wrapper document itself is a *trusted platform
 * document* served by the resource origin and is embedded by the Runtime
 * without a `sandbox` attribute (an embedding-side attribute; never put it on
 * this document). The **only** sandboxed layer is the inner game iframe below:
 * `sandbox="allow-scripts"` keeps the game in an opaque origin with no
 * `allow-same-origin`. If the outer wrapper frame were sandboxed, the wrapper
 * would become an opaque-origin ancestor and Chrome could never match it
 * against the game document's `frame-ancestors` list (§7.5), which is exactly
 * the failure this layering avoids.
 */
function wrapperHtml(target, nonce) {
  const src = typeof target === 'string' ? escapeHtmlAttribute(target) : 'about:blank';
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><title>Game</title>',
    '<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#000}',
    'iframe{display:block;width:100%;height:100%;border:0}</style>',
    '</head><body>',
    `<iframe id="dsh-game-frame" sandbox="allow-scripts" allow="autoplay" referrerpolicy="no-referrer" src="${src}"></iframe>`,
    `<script nonce="${escapeHtmlAttribute(nonce)}">${wrapperRelayScript()}</script>`,
    '</body></html>',
  ].join('');
}

// ---------------------------------------------------------------------------
// Package loading / verification
// ---------------------------------------------------------------------------

async function lstatFile(absPath, failureCode, message) {
  let stats;
  try {
    stats = await fs.lstat(absPath);
  } catch (_error) {
    throw hostError(failureCode, message, { retryable: false });
  }
  if (stats.isSymbolicLink()) {
    throw hostError(failureCode, message, { retryable: false, details: { reason: 'symlink' } });
  }
  if (!stats.isFile()) throw hostError(failureCode, message, { retryable: false });
  return stats;
}

function resolveInside(root, relPath) {
  const target = path.resolve(root, ...relPath.split('/'));
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(rootPrefix)) {
    throw hostError(GM.RESOURCE_SCOPE_DENIED, 'Resource path escapes the package root', { retryable: false });
  }
  return target;
}

function manifestError(code) {
  const gmCode = typeof code === 'string' && INTERNAL_TO_GM[code] ? INTERNAL_TO_GM[code] : GM.DESCRIPTOR_INVALID;
  return hostError(gmCode, defaultMessageFor(gmCode), { retryable: false });
}

/** Read and validate `dsh-package.json`, returning the normalized manifest. */
async function loadZipManifest({ packageRoot, expectedDigest = null }) {
  const root = path.resolve(packageRoot);
  const descriptorPath = path.join(root, DESCRIPTOR_FILE);
  const stats = await lstatFile(descriptorPath, GM.DESCRIPTOR_INVALID, 'Package descriptor is missing');
  if (stats.size > LIMITS.zip.descriptorBytes) {
    throw hostError(GM.DESCRIPTOR_INVALID, defaultMessageFor(GM.DESCRIPTOR_INVALID), {
      retryable: false,
      details: { field: 'descriptor' },
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));
  } catch (_error) {
    throw hostError(GM.DESCRIPTOR_INVALID, defaultMessageFor(GM.DESCRIPTOR_INVALID), { retryable: false });
  }
  const validation = validateDescriptor(parsed);
  if (!validation.ok) throw manifestError(validation.code);

  let digest = null;
  try {
    digest = fileManifestDigest(validation.value.files, sha256Hex);
  } catch (_error) {
    throw hostError(GM.DESCRIPTOR_INVALID, defaultMessageFor(GM.DESCRIPTOR_INVALID), { retryable: false });
  }
  if (typeof expectedDigest === 'string' && expectedDigest.length > 0 && digest !== expectedDigest) {
    throw hostError(GM.DESCRIPTOR_MISMATCH, defaultMessageFor(GM.DESCRIPTOR_MISMATCH), { retryable: false });
  }

  const files = new Map();
  for (const file of validation.value.files) {
    files.set(file.path, {
      rel: file.path,
      size: file.size,
      sha256: file.sha256,
      absPath: resolveInside(root, file.path),
      mime: mimeForResource(file.path),
      kind: checkZipEntryType(file.path),
    });
  }
  return { descriptor: validation.value, files, digest };
}

async function loadHtmlV1Manifest({ entryPath, entryRel, entrySha256 }) {
  const normalized = normalizeZipPath(entryRel);
  if (!normalized.ok || !normalized.value.toLowerCase().endsWith('.html')) {
    throw hostError(GM.DESCRIPTOR_INVALID, defaultMessageFor(GM.DESCRIPTOR_INVALID), { retryable: false });
  }
  const absPath = path.resolve(entryPath);
  const stats = await lstatFile(absPath, GM.ASSET_NOT_FOUND, 'Game entry file is missing');
  if (stats.size > LIMITS.entryBytes) {
    throw hostError(GM.PACKAGE_TOO_LARGE, 'Game entry exceeds the size limit', {
      retryable: false,
      details: { limitBytes: LIMITS.entryBytes },
    });
  }
  const bytes = await fs.readFile(absPath);
  const digest = sha256Hex(bytes);
  if (typeof entrySha256 === 'string' && entrySha256.length > 0 && digest !== entrySha256) {
    throw hostError(GM.ASSET_INTEGRITY, defaultMessageFor(GM.ASSET_INTEGRITY), {
      retryable: true,
      details: { reason: 'sha256' },
    });
  }
  const files = new Map();
  files.set(normalized.value, {
    rel: normalized.value,
    size: bytes.length,
    sha256: digest,
    absPath,
    mime: 'text/html; charset=utf-8',
    kind: { ok: true, kind: 'document' },
  });
  return { files, digest, entry: normalized.value };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Create the loopback resource origin service.
 *
 * The factory owns the instance-bound credentials and the HTTP server; the Host
 * composition (`host.js` / `plugin.js`, owned by the Lead) creates one service,
 * passes it to `createEntryService`, and closes it on plugin disposal.
 *
 * @param {{
 *   storage?: object,
 *   installations?: object,
 *   logger?: object|null,
 *   now?: () => Date|number,
 *   timing?: object,
 *   port?: number,
 *   frameAncestors?: string[],
 * }} [options]
 */
export function createResourceService({
  storage = null,
  installations = null,
  logger = null,
  now = () => new Date(),
  timing = {},
  port = 0,
  frameAncestors = null,
  dshWebOrigin = null,
} = {}) {
  // Resolution stays in entry.js; this service only serves (the parameters are
  // kept in the factory surface so the Host composition has one stable shape).
  void storage;
  void installations;

  const instances = new Map();
  const tokenIndex = new Map();
  const configuredTtl = Number.isFinite(timing.resourceCredentialTtlMs) && timing.resourceCredentialTtlMs > 0
    ? timing.resourceCredentialTtlMs
    : TIMING.resourceCredentialTtlMs;
  const configuredPort = Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 0;
  const ancestors = normaliseFrameAncestors(frameAncestors);
  const webOrigin = normaliseWebOrigin(dshWebOrigin);
  const maxBindings = 64;

  let server = null;
  let actualPort = null;
  let starting = null;
  let sweepTimer = null;
  let closed = false;

  function origin() {
    return actualPort === null ? null : `http://${LOOPBACK_HOST}:${actualPort}`;
  }

  function requireOrigin() {
    const value = origin();
    if (value === null) {
      throw hostError(GM.HOST_UNAVAILABLE, 'Resource origin is not available', { retryable: true });
    }
    return value;
  }

  function stamp() {
    return nowMsOf(now);
  }

  function dropInstance(instanceId) {
    const instance = instances.get(instanceId);
    if (!instance) return null;
    instances.delete(instanceId);
    if (tokenIndex.get(instance.token) === instanceId) tokenIndex.delete(instance.token);
    return instance;
  }

  /**
   * Drop dead credentials and trim capacity; returns how many went.
   *
   * Release/TTL must stay observable as GM-4011 for a while after they happen
   * (§7.2), so a dead instance is kept as a tombstone for one TTL window before
   * it is forgotten. Capacity trimming drops tombstones first, then the oldest
   * live binding (bounded memory, never unbounded history).
   */
  function pruneExpiredInstances() {
    const current = stamp();
    let removed = 0;
    for (const [instanceId, instance] of instances) {
      const releasedLongAgo = instance.released && current - instance.releasedAt > instance.ttlMs;
      const expiredLongAgo = instance.expiresAt <= current && current - instance.expiresAt > instance.ttlMs;
      if (releasedLongAgo || expiredLongAgo) {
        dropInstance(instanceId);
        removed += 1;
      }
    }
    while (instances.size > maxBindings) {
      let victim = null;
      for (const [instanceId, instance] of instances) {
        if (instance.released || instance.expiresAt <= current) {
          victim = instanceId;
          break;
        }
      }
      if (victim === null) victim = instances.keys().next().value;
      if (victim === undefined) break;
      dropInstance(victim);
      removed += 1;
    }
    return removed;
  }

  function scheduleSweep() {
    if (sweepTimer !== null) return;
    const interval = Math.max(1000, Math.floor(configuredTtl / 4));
    sweepTimer = setInterval(() => {
      try {
        pruneExpiredInstances();
      } catch (_error) {
        // A sweep must never crash the origin.
      }
    }, interval);
    if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
  }

  function redactPath(pathname) {
    let out = typeof pathname === 'string' ? pathname : '';
    for (const instance of instances.values()) {
      if (out.includes(instance.instanceId)) out = out.replaceAll(instance.instanceId, '<instance>');
      if (out.includes(instance.token)) out = out.replaceAll(instance.token, '<token>');
    }
    return out.replace(/launch=[^&]+/g, 'launch=<redacted>');
  }

  function logWarning(event, pathname) {
    if (!logger || typeof logger.warn !== 'function') return;
    try {
      logger.warn('[game-market/host] resource', event, `path=${redactPath(pathname)}`);
    } catch (_error) {
      // Diagnostics must never break serving.
    }
  }

  const SECURITY_HEADERS = Object.freeze({
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'access-control-allow-origin': '*',
  });

  function writeResponse(res, method, status, headers, body) {
    const payload = body === null || body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
    const outgoing = { ...headers };
    if (payload !== null) outgoing['content-length'] = String(payload.length);
    res.writeHead(status, outgoing);
    if (method === 'HEAD' || payload === null) res.end();
    else res.end(payload);
  }

  function sendError(res, method, code, { extraHeaders = {} } = {}) {
    const gmCode = typeof code === 'string' && /^GM-\d{4}$/.test(code) ? code : GM.INTERNAL;
    const message = defaultMessageFor(gmCode);
    const body = JSON.stringify({ ok: false, error: { code: gmCode, message } });
    writeResponse(res, method, statusFor(gmCode), {
      ...SECURITY_HEADERS,
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders,
    }, body);
  }

  function sendMethodNotAllowed(res, method) {
    const body = JSON.stringify({ ok: false, error: { code: GM.UNKNOWN_METHOD, message: defaultMessageFor(GM.UNKNOWN_METHOD) } });
    writeResponse(res, method, 405, {
      ...SECURITY_HEADERS,
      allow: 'GET, HEAD',
      'content-type': 'application/json; charset=utf-8',
    }, method === 'HEAD' ? null : body);
  }

  function sendPlainNotFound(res, method) {
    writeResponse(res, method, 404, {
      ...SECURITY_HEADERS,
      'content-type': 'text/plain; charset=utf-8',
    }, 'not found');
  }

  async function readVerifiedFile(instance, file) {
    const stats = await lstatFile(file.absPath, GM.ASSET_NOT_FOUND, 'Asset not found');
    const limit = Number.isFinite(file.size) && file.size >= 0 ? file.size : LIMITS.zip.zipEntryBytes;
    if (stats.size > limit) {
      throw hostError(GM.ASSET_INTEGRITY, defaultMessageFor(GM.ASSET_INTEGRITY), {
        retryable: true,
        details: { reason: 'size' },
      });
    }
    let bytes;
    try {
      bytes = await fs.readFile(file.absPath);
    } catch (_error) {
      throw hostError(GM.ASSET_NOT_FOUND, 'Asset not found', { retryable: false });
    }
    if (Number.isFinite(file.size) && bytes.length !== file.size) {
      throw hostError(GM.ASSET_INTEGRITY, defaultMessageFor(GM.ASSET_INTEGRITY), {
        retryable: true,
        details: { reason: 'size' },
      });
    }
    if (typeof file.sha256 === 'string' && sha256Hex(bytes) !== file.sha256) {
      throw hostError(GM.ASSET_INTEGRITY, defaultMessageFor(GM.ASSET_INTEGRITY), {
        retryable: true,
        details: { reason: 'sha256' },
      });
    }
    const typeCheck = checkServedContent(file.rel, bytes);
    if (!typeCheck.ok) {
      throw hostError(typeCheck.code, defaultMessageFor(typeCheck.code), { retryable: false });
    }
    if (!file.mime) {
      throw hostError(GM.ASSET_TYPE_UNSUPPORTED, defaultMessageFor(GM.ASSET_TYPE_UNSUPPORTED), { retryable: false });
    }
    return bytes;
  }

  /**
   * Consume the one-shot launch credential for an instance (§7.2).
   * Throws the contract error so the HTTP handler and Runtime-side callers share
   * one decision path. Returns `true` when this call consumed it.
   */
  function consumeLaunch(instanceId, nonce) {
    const instance = instances.get(instanceId);
    if (!instance) throw hostError(GM.RESOURCE_CREDENTIAL_INVALID, defaultMessageFor(GM.RESOURCE_CREDENTIAL_INVALID));
    if (instance.released) {
      throw hostError(GM.RESOURCE_CREDENTIAL_EXPIRED, defaultMessageFor(GM.RESOURCE_CREDENTIAL_EXPIRED));
    }
    if (instance.expiresAt <= stamp()) {
      throw hostError(GM.RESOURCE_CREDENTIAL_EXPIRED, defaultMessageFor(GM.RESOURCE_CREDENTIAL_EXPIRED));
    }
    if (instance.launchConsumedAt !== null) {
      throw hostError(GM.ENTRY_LAUNCH_CONSUMED, defaultMessageFor(GM.ENTRY_LAUNCH_CONSUMED));
    }
    if (!safeEqual(nonce, instance.nonce)) {
      throw hostError(GM.ENTRY_CREDENTIAL_CONSUMED, defaultMessageFor(GM.ENTRY_CREDENTIAL_CONSUMED));
    }
    instance.launchConsumedAt = stamp();
    return true;
  }

  async function handleResource(res, method, pathname, search) {
    const parsed = validateAssetRequest(pathname);
    if (!parsed.ok) {
      const gmCode = INTERNAL_TO_GM[parsed.code] || GM.RESOURCE_SCOPE_DENIED;
      return sendError(res, method, gmCode);
    }
    const { instanceId, resourceToken, relativePath } = parsed.value;

    const instance = instances.get(instanceId);
    if (!instance) return sendError(res, method, GM.RESOURCE_CREDENTIAL_INVALID);
    if (instance.released) return sendError(res, method, GM.RESOURCE_CREDENTIAL_EXPIRED);
    if (instance.expiresAt <= stamp()) return sendError(res, method, GM.RESOURCE_CREDENTIAL_EXPIRED);
    if (!safeEqual(resourceToken, instance.token)) {
      // A well-formed token that belongs to a *different* live instance is a
      // cross-instance attempt (GM-4039); anything else is an invalid
      // credential (GM-4010). Both are checked without echoing the token.
      const other = tokenIndex.get(resourceToken);
      return sendError(res, method, other ? GM.RESOURCE_SCOPE_DENIED : GM.RESOURCE_CREDENTIAL_INVALID);
    }

    const file = instance.files.get(relativePath);
    if (!file) return sendError(res, method, GM.ASSET_NOT_FOUND);

    const isEntry = relativePath === instance.entry;
    if (isEntry) {
      const launch = new URLSearchParams(search).get('launch');
      if (launch !== null) {
        try {
          consumeLaunch(instanceId, launch);
        } catch (error) {
          const code = error && typeof error.code === 'string' ? error.code : GM.INTERNAL;
          return sendError(res, method, code);
        }
      }
    }

    let bytes;
    try {
      bytes = await readVerifiedFile(instance, file);
    } catch (error) {
      const code = error && typeof error.code === 'string' ? error.code : GM.INTERNAL;
      if (code === GM.ASSET_INTEGRITY) logWarning('asset-integrity-failed', pathname);
      return sendError(res, method, code);
    }

    const headers = {
      ...SECURITY_HEADERS,
      'content-type': file.mime,
      'access-control-allow-methods': 'GET, HEAD',
    };
    // CR7-01: any package document can be *navigated to as a document* (a
    // same-origin navigation inside the game iframe), not just the entry. A
    // document without a policy can exfiltrate via subresources, and the
    // wrapper's `frame-src` only constrains cross-origin navigation. HTML pages
    // and SVG can both run script when loaded as a document, so `asset-zip-v2`
    // sends the same asset CSP on `text/html` and `image/svg+xml` responses.
    // Other subresources (`*.js`, `*.css`, `*.json`, images, audio, fonts) never
    // repeat the CSP — they are not executable documents and stay nosniff/typed.
    // `html-v1` keeps the V1 entry-only behaviour (it has exactly one file).
    const isExecutableDocument = typeof file.mime === 'string'
      && (file.mime.startsWith('text/html') || file.mime === 'image/svg+xml');
    const sendsAssetCsp = instance.format === ASSET_ZIP_V2 && isExecutableDocument;
    if (isEntry || sendsAssetCsp) {
      const entryAncestors = webOrigin !== null ? [webOrigin, requireOrigin()] : ancestors;
      headers['content-security-policy'] = instance.format === ASSET_ZIP_V2
        ? buildAssetContentSecurityPolicy({ resourceOrigin: requireOrigin(), frameAncestors: entryAncestors })
        : buildContentSecurityPolicy(requireOrigin(), { frameAncestors: ancestors });
    }
    // The entry hash header keeps its V1 semantics: entry document only.
    if (isEntry) headers['x-entry-sha256'] = file.sha256;
    writeResponse(res, method, 200, headers, bytes);
    return undefined;
  }

  /**
   * Admit a wrapper `?src=` target. The wrapper is served by the resource
   * origin, so it only ever embeds URLs from that *same* origin and only under
   * the instance resource prefix — otherwise an attacker could use it as an
   * open framing hop. A rejected target renders `about:blank`, never the input.
   */
  function wrapperTargetFrom(src) {
    if (typeof src !== 'string' || src.length === 0 || src.length > MAX_WRAPPER_TARGET_LENGTH) return null;
    let parsed;
    try {
      parsed = new URL(src);
    } catch (_error) {
      return null;
    }
    if (!sharesOrigin(parsed.href, requireOrigin())) return null;
    if (!parsed.pathname.startsWith(`${RESOURCE_ORIGIN_PATH}/`)) return null;
    const admission = validateAssetRequest(parsed.pathname);
    if (!admission.ok) return null;
    // Keep the query (it may carry the one-shot `launch` nonce); the wrapper
    // never validates or consumes it — the game document request does that.
    return parsed.href;
  }

  function serveWrapper(res, method, search) {
    const src = new URLSearchParams(search).get(RESOURCE_WRAPPER_QUERY);
    const target = wrapperTargetFrom(src);
    // Nonce admits only the wrapper's own relay script; no `'unsafe-inline'`.
    const nonce = randomHex(16);
    const body = wrapperHtml(target, nonce);
    // Exact DSH web origin when the composition knows it; otherwise the V1
    // configured allowlist (loopback wildcards by default) covers the DSH page.
    const wrapperAncestors = webOrigin !== null ? [webOrigin] : ancestors;
    writeResponse(res, method, 200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': buildWrapperContentSecurityPolicy(requireOrigin(), nonce, wrapperAncestors),
    }, body);
  }

  /** True for `/res/<32-hex instance>/<32-hex token>/…` (decoded segments). */
  function looksLikeResourceRoute(pathname) {
    if (!pathname.startsWith(`${RESOURCE_ORIGIN_PATH}/`)) return false;
    const rest = pathname.slice(RESOURCE_ORIGIN_PATH.length + 1);
    const parts = rest.split('/');
    if (parts.length < 3) return false;
    let instanceId;
    let token;
    try {
      instanceId = decodeURIComponent(parts[0]);
      token = decodeURIComponent(parts[1]);
    } catch (_error) {
      return false;
    }
    return RESOURCE_ID_PATTERN.test(instanceId) && RESOURCE_ID_PATTERN.test(token);
  }

  async function handleRequest(req, res) {
    const method = String(req.method || 'GET').toUpperCase();
    const rawUrl = typeof req.url === 'string' && req.url.length > 0 ? req.url : '/';
    const queryIndex = rawUrl.indexOf('?');
    const pathname = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
    const search = queryIndex === -1 ? '' : rawUrl.slice(queryIndex + 1);

    try {
      if (method !== 'GET' && method !== 'HEAD') {
        return sendMethodNotAllowed(res, method);
      }
      if (pathname === RESOURCE_WRAPPER_PATH) {
        return serveWrapper(res, method, search);
      }
      // Unmatched paths are plain 404s: this origin routes instance resources
      // and the wrapper only, so nothing else is even parsed as a credential.
      if (!looksLikeResourceRoute(pathname)) {
        return sendPlainNotFound(res, method);
      }
      // Percent-encoded dot or separator can only be an escape attempt here:
      // manifest paths are served from their literal POSIX form.
      if (/%(?:2e|2f|5c|00)/i.test(pathname)) {
        return sendError(res, method, GM.RESOURCE_SCOPE_DENIED);
      }
      return await handleResource(res, method, pathname, search);
    } catch (error) {
      const code = error && typeof error.code === 'string' ? error.code : GM.INTERNAL;
      if (statusFor(code) >= 500) logWarning('request-failed', pathname);
      return sendError(res, method, code);
    }
  }

  function listen() {
    return new Promise((resolve, reject) => {
      const candidate = http.createServer((req, res) => {
        handleRequest(req, res).catch(() => {
          try {
            if (!res.headersSent) sendError(res, String(req.method || 'GET').toUpperCase(), GM.INTERNAL);
            else res.destroy();
          } catch (_error) {
            // The socket is already gone.
          }
        });
      });
      candidate.on('error', (error) => {
        server = null;
        actualPort = null;
        reject(hostError(GM.HOST_UNAVAILABLE, defaultMessageFor(GM.HOST_UNAVAILABLE), {
          retryable: true,
          cause: error,
        }));
      });
      candidate.listen(configuredPort, LOOPBACK_HOST, () => {
        // `close()` racing `start()` must not leave a listening socket behind.
        if (closed) {
          candidate.close(() => undefined);
          actualPort = null;
          reject(hostError(GM.HOST_UNAVAILABLE, 'Resource origin is closed', { retryable: false }));
          return;
        }
        server = candidate;
        actualPort = candidate.address().port;
        // An idle resource origin must not keep a short-lived test/CLI process
        // alive; the DSH host has its own long-lived handles.
        if (typeof candidate.unref === 'function') candidate.unref();
        scheduleSweep();
        resolve({ port: actualPort, origin: origin() });
      });
    });
  }

  /** Start the loopback server (idempotent). */
  async function start() {
    if (closed) throw hostError(GM.HOST_UNAVAILABLE, 'Resource origin is closed', { retryable: false });
    if (server !== null) return { port: actualPort, origin: origin() };
    if (starting === null) {
      starting = listen().finally(() => {
        starting = null;
      });
    }
    return starting;
  }

  /** Create the instance-bound credential and return its LaunchInfo fragment. */
  async function issue(input) {
    const {
      instanceId,
      nonce,
      gameId,
      version,
      format = DEFAULT_PACKAGE_FORMAT,
      entry,
      entryPath,
      packageRoot = null,
      entrySha256 = null,
      filesDigest = null,
      ttlMs,
    } = input && typeof input === 'object' ? input : {};

    if (typeof instanceId !== 'string' || !RESOURCE_ID_PATTERN.test(instanceId)) {
      throw hostError(GM.INVALID_PARAM, 'Invalid instanceId for the resource origin', { retryable: false });
    }
    if (typeof nonce !== 'string' || !RESOURCE_ID_PATTERN.test(nonce)) {
      throw hostError(GM.INVALID_PARAM, 'Invalid launch nonce for the resource origin', { retryable: false });
    }
    if (typeof gameId !== 'string' || gameId.length === 0) {
      throw hostError(GM.INVALID_PARAM, 'Invalid gameId for the resource origin', { retryable: false });
    }
    if (typeof version !== 'string' || version.length === 0) {
      throw hostError(GM.INVALID_PARAM, 'Invalid version for the resource origin', { retryable: false });
    }
    if (!PACKAGE_FORMATS_SET.has(format)) {
      throw hostError(GM.INVALID_PARAM, 'Invalid package format for the resource origin', { retryable: false });
    }

    await start();

    let loaded;
    if (format === ASSET_ZIP_V2) {
      if (packageRoot === null || typeof packageRoot !== 'string') {
        throw hostError(GM.DESCRIPTOR_INVALID, 'Package root is required for asset-zip-v2', { retryable: false });
      }
      loaded = await loadZipManifest({ packageRoot, expectedDigest: filesDigest });
      if (typeof entry === 'string' && entry.length > 0 && loaded.descriptor.entry !== entry) {
        throw hostError(GM.DESCRIPTOR_MISMATCH, defaultMessageFor(GM.DESCRIPTOR_MISMATCH), { retryable: false });
      }
      if (typeof entryPath === 'string' && entryPath.length > 0) {
        const expected = resolveInside(path.resolve(packageRoot), loaded.descriptor.entry);
        if (path.resolve(entryPath) !== expected) {
          throw hostError(GM.DESCRIPTOR_MISMATCH, defaultMessageFor(GM.DESCRIPTOR_MISMATCH), { retryable: false });
        }
      }
    } else {
      const entryRel = typeof entry === 'string' && entry.length > 0 ? entry : 'entry.html';
      loaded = await loadHtmlV1Manifest({
        entryPath: typeof entryPath === 'string' && entryPath.length > 0 ? entryPath : path.join(String(packageRoot || ''), entryRel),
        entryRel,
        entrySha256,
      });
    }

    const ttl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : configuredTtl;
    const createdAt = stamp();
    const resourceToken = randomHex(16);
    const instance = {
      instanceId,
      token: resourceToken,
      nonce,
      gameId,
      version,
      format,
      entry: format === ASSET_ZIP_V2 ? loaded.descriptor.entry : loaded.entry,
      files: loaded.files,
      filesDigest: format === ASSET_ZIP_V2 ? loaded.digest : null,
      entrySha256: format === ASSET_ZIP_V2 ? loaded.files.get(loaded.descriptor.entry).sha256 : loaded.digest,
      createdAt,
      expiresAt: createdAt + ttl,
      ttlMs: ttl,
      launchConsumedAt: null,
      released: false,
    };
    pruneExpiredInstances();
    instances.set(instanceId, instance);
    tokenIndex.set(resourceToken, instanceId);

    const base = buildResourceBase({
      resourceOrigin: requireOrigin(),
      instanceId,
      resourceToken,
    });
    if (!base.ok) throw hostError(GM.INTERNAL, 'Failed to build the resource base URL', { retryable: false });
    const entryUrlPath = encodePathSegments(instance.entry);
    const entryResourceUrl = `${base.value}/${entryUrlPath}`;
    const entryLaunchUrl = `${entryResourceUrl}?launch=${encodeURIComponent(nonce)}`;
    const wrapperFor = (target) => `${requireOrigin()}${RESOURCE_WRAPPER_PATH}?${RESOURCE_WRAPPER_QUERY}=${encodeURIComponent(target)}`;

    return {
      resourceOrigin: requireOrigin(),
      resourceBase: base.value,
      entryResourceUrl,
      wrapperUrl: wrapperFor(`${entryResourceUrl}?launch=${encodeURIComponent(nonce)}`),
      wrapperResourceUrl: wrapperFor(entryResourceUrl),
      ttlMs: ttl,
    };
  }

  function encodePathSegments(relPath) {
    return String(relPath)
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
  }

  /** Extend one live instance; returns the new TTL window or `null`. */
  function renew(instanceId) {
    if (typeof instanceId !== 'string') return null;
    const instance = instances.get(instanceId);
    if (!instance) return null;
    if (instance.released) return null;
    const current = stamp();
    if (instance.expiresAt <= current) return null;
    instance.expiresAt = current + instance.ttlMs;
    return {
      instanceId,
      gameId: instance.gameId,
      version: instance.version,
      expiresAt: instance.expiresAt,
      resourceTtlMs: instance.ttlMs,
    };
  }

  /** Release one instance immediately (§7.2). Returns the number released. */
  function release(instanceId, gameId = null) {
    if (typeof instanceId !== 'string') return 0;
    const instance = instances.get(instanceId);
    if (!instance || instance.released) return 0;
    if (typeof gameId === 'string' && gameId.length > 0 && instance.gameId !== gameId) return 0;
    instance.released = true;
    instance.releasedAt = stamp();
    return 1;
  }

  /** Release every live instance of one game (uninstall / game invalidation). */
  function releaseGame(gameId) {
    if (typeof gameId !== 'string') return 0;
    let released = 0;
    for (const instance of instances.values()) {
      if (instance.gameId === gameId && !instance.released) {
        instance.released = true;
        instance.releasedAt = stamp();
        released += 1;
      }
    }
    return released;
  }

  function ttlOf(instanceId) {
    const instance = instances.get(instanceId);
    if (!instance || instance.released) return null;
    const remaining = instance.expiresAt - stamp();
    return remaining > 0 ? remaining : 0;
  }

  function has(instanceId) {
    const instance = instances.get(instanceId);
    return Boolean(instance && !instance.released && instance.expiresAt > stamp());
  }

  /** Introspection for tests/diagnostics; never exposed over HTTP. */
  function describe(instanceId) {
    const instance = instances.get(instanceId);
    if (!instance) return null;
    return {
      instanceId: instance.instanceId,
      gameId: instance.gameId,
      version: instance.version,
      format: instance.format,
      entry: instance.entry,
      expiresAt: instance.expiresAt,
      launchConsumed: instance.launchConsumedAt !== null,
    };
  }

  function address() {
    if (server === null) return null;
    return server.address();
  }

  async function close() {
    closed = true;
    if (sweepTimer !== null) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
    for (const instanceId of [...instances.keys()]) dropInstance(instanceId);
    if (server === null) return;
    const closing = server;
    server = null;
    actualPort = null;
    await new Promise((resolve) => {
      closing.close(() => resolve());
      if (typeof closing.closeAllConnections === 'function') closing.closeAllConnections();
    });
  }

  /** Await origin readiness (idempotent). */
  function ready() {
    return start().then((result) => ({ ...result, ready: true }));
  }

  return {
    start,
    ready,
    close,
    issue,
    renew,
    release,
    releaseGame,
    ttlOf,
    has,
    consumeLaunch,
    pruneExpired: pruneExpiredInstances,
    describe,
    address,
    get origin() {
      return origin();
    },
    get port() {
      return actualPort;
    },
    get instanceCount() {
      return instances.size;
    },
  };
}

/** Exported for tests and the runtime client: the static package formats. */
export const RESOURCE_PACKAGE_FORMATS = PACKAGE_FORMATS;
