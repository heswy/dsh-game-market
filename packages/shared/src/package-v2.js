/**
 * V1.5 `asset-zip-v2` package policy (docs/V1.5-CONTRACTS.md §1, §3, §4).
 *
 * Pure JS: no Node built-ins, no browser globals, no third-party imports — the
 * Host, the CLI, the content-repository tooling and the tests all share these
 * rules, and the same module is bundled for the browser side.
 *
 * Everything here is *policy*: given already-decoded strings and numbers it
 * decides what is acceptable. Byte-level work (ZIP container parsing, CRC,
 * streaming counters, local-header comparison) lives in
 * `packages/host/src/zip.js` because it needs Node built-ins.
 *
 * All failures carry an internal `E_*` code; the Host translates to `GM-*`
 * through `errors.js#INTERNAL_TO_GM` at the boundary (D-030).
 */

import {
  DESCRIPTOR_FILE,
  LIMITS,
  PACKAGE_FORMATS,
  ZIP_GAME_MANIFEST_FILE,
} from './constants.js';

const ZIP_LIMITS = LIMITS.zip;

// ---------------------------------------------------------------------------
// Path rules (contract §4.2 / §4.3)
// ---------------------------------------------------------------------------

/** Windows device names are rejected on every segment: they alias on Windows. */
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const DRIVE_LETTER = /^[A-Za-z]:/;

/** Compare two strings by Unicode code point (equivalently by UTF-8 byte order). */
export function codePointCompare(a, b) {
  const left = Array.from(a);
  const right = Array.from(b);
  const max = Math.min(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    const diff = left[i].codePointAt(0) - right[i].codePointAt(0);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

function fail(code, details) {
  return { ok: false, code, ...(details === undefined ? {} : { details }) };
}

/**
 * Normalize and validate one archive entry path (contract §4.2 steps 2–9).
 *
 * The caller MUST have already decoded the raw bytes as strict UTF-8; this
 * function only sees text. It never returns a path that could escape a
 * directory: the result has no `..`, no leading `/`, no backslash, no empty
 * segment and no trailing space/dot segment.
 *
 * @param {unknown} rawPath Entry name as text.
 * @returns {{ok:true, value:string} | {ok:false, code:string, details?:object}}
 */
export function normalizeZipPath(rawPath) {
  if (typeof rawPath !== 'string') return fail('E_ZIP_PATH_INVALID', { field: 'path' });
  if (rawPath.length === 0) return fail('E_ZIP_PATH_INVALID', { field: 'path' });
  if (CONTROL_CHARS.test(rawPath)) return fail('E_ZIP_PATH_INVALID', { field: 'path' });
  // ZIP uses `/`. A backslash is the usual Windows traversal carrier.
  if (rawPath.includes('\\')) return fail('E_ZIP_PATH_INVALID', { field: 'path' });
  if (rawPath.startsWith('/')) return fail('E_ZIP_PATH_INVALID', { field: 'path' });
  if (DRIVE_LETTER.test(rawPath)) return fail('E_ZIP_PATH_INVALID', { field: 'path' });

  const segments = rawPath.split('/');
  for (const segment of segments) {
    if (segment === '') return fail('E_ZIP_PATH_INVALID', { field: 'path' });
    if (segment === '.' || segment === '..') return fail('E_ZIP_PATH_INVALID', { field: 'path' });
    // Windows silently strips a trailing space/dot, which can turn two distinct
    // entries into one file on disk.
    if (/[ .]$/.test(segment)) return fail('E_ZIP_PATH_INVALID', { field: 'path' });
    const stem = segment.split('.')[0].toLowerCase();
    if (WINDOWS_RESERVED.has(stem)) return fail('E_ZIP_PATH_INVALID', { field: 'path' });
  }

  const normalized = segments.join('/');
  // Second line of defence (§4.2 step 7): never trust the loop above alone.
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    return fail('E_ZIP_PATH_INVALID', { field: 'path' });
  }

  const chars = Array.from(normalized).length;
  if (chars > ZIP_LIMITS.zipPathChars) {
    return fail('E_ZIP_LIMIT_EXCEEDED', { kind: 'zipPathChars', limit: ZIP_LIMITS.zipPathChars, actual: chars });
  }
  if (segments.length > ZIP_LIMITS.zipPathDepth) {
    return fail('E_ZIP_LIMIT_EXCEEDED', { kind: 'zipPathDepth', limit: ZIP_LIMITS.zipPathDepth, actual: segments.length });
  }
  return { ok: true, value: normalized };
}

/** Allowed static asset extensions per contract §4.6. */
const TYPE_BY_EXTENSION = Object.freeze({
  '.html': 'document',
  '.js': 'script',
  '.mjs': 'script',
  '.css': 'style',
  '.png': 'image',
  '.webp': 'image',
  '.jpeg': 'image',
  '.jpg': 'image',
  '.gif': 'image',
  '.svg': 'image',
  '.ogg': 'audio',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio',
  '.woff2': 'font',
  '.woff': 'font',
  '.json': 'data',
  '.txt': 'data',
  '.csv': 'data',
});

/** Extensions an `asset-zip-v2` entry may have (§4.6). */
export const ALLOWED_ZIP_EXTENSIONS = Object.freeze(Object.keys(TYPE_BY_EXTENSION));

/**
 * Check that a normalized path uses an allowed static-asset type (§4.6).
 *
 * The descriptor and `game.json` are handled explicitly: they are valid archive
 * entries but are never served as resources (§7.3).
 *
 * @param {string} normalizedPath Result of {@link normalizeZipPath}.
 * @returns {{ok:true, kind:string} | {ok:false, code:string, details?:object}}
 */
export function checkZipEntryType(normalizedPath) {
  if (typeof normalizedPath !== 'string' || normalizedPath.length === 0) {
    return fail('E_ASSET_TYPE_UNSUPPORTED', { field: 'path' });
  }
  if (normalizedPath === DESCRIPTOR_FILE) return { ok: true, kind: 'descriptor' };
  if (normalizedPath === ZIP_GAME_MANIFEST_FILE) return { ok: true, kind: 'manifest' };
  const lower = normalizedPath.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot <= lower.lastIndexOf('/')) {
    return fail('E_ASSET_TYPE_UNSUPPORTED', { path: normalizedPath });
  }
  const kind = TYPE_BY_EXTENSION[lower.slice(dot)];
  if (kind === undefined) return fail('E_ASSET_TYPE_UNSUPPORTED', { path: normalizedPath });
  return { ok: true, kind };
}

/** True when the path is the root descriptor or the root manifest. */
export function isReservedPackageFile(normalizedPath) {
  return normalizedPath === DESCRIPTOR_FILE || normalizedPath === ZIP_GAME_MANIFEST_FILE;
}

/**
 * Combined entry-path check: normalize, reject reserved names, then type-check.
 *
 * This is the single call an archive reader should make per central-directory
 * entry; {@link normalizeZipPath} and {@link checkZipEntryType} stay public so
 * URL construction and tests can reuse the pieces independently.
 *
 * @param {unknown} rawPath Entry name as decoded text.
 * @returns {{ok:true, value:string, kind:string} | {ok:false, code:string, details?:object}}
 */
export function checkZipEntryPath(rawPath) {
  const normalized = normalizeZipPath(rawPath);
  if (!normalized.ok) return normalized;
  const path = normalized.value;
  // A descriptor anywhere but the archive root is a second authoritative
  // manifest attempt (§4.3), not a normal entry.
  if (path !== DESCRIPTOR_FILE && path.endsWith(`/${DESCRIPTOR_FILE}`)) {
    return fail('E_DESCRIPTOR_INVALID', { path });
  }
  const type = checkZipEntryType(path);
  if (!type.ok) return type;
  return { ok: true, value: path, kind: type.kind };
}

// ---------------------------------------------------------------------------
// Descriptor (§1.4)
// ---------------------------------------------------------------------------

const SHA256_HEX = /^[a-f0-9]{64}$/;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownDescriptorFields(descriptor) {
  const known = new Set(['formatVersion', 'entry', 'gameManifest', 'files']);
  const warnings = [];
  for (const key of Object.keys(descriptor)) {
    if (known.has(key) || key.startsWith('x-')) continue;
    warnings.push({ code: 'W_DESCRIPTOR_UNKNOWN_FIELD', field: key });
  }
  return warnings;
}

/**
 * Validate a parsed `dsh-package.json` (contract §1.4).
 *
 * @param {unknown} input Parsed JSON value.
 * @returns {{ok:true, value:{formatVersion:2, entry:string, gameManifest:string, files:Array<{path:string,size:number,sha256:string}>}, warnings:Array<object>}
 *          | {ok:false, code:string, details?:object}}
 */
export function validateDescriptor(input) {
  if (!isPlainObject(input)) return fail('E_DESCRIPTOR_INVALID', { field: 'descriptor' });
  if (input.formatVersion !== 2) return fail('E_DESCRIPTOR_INVALID', { field: 'formatVersion' });

  const warnings = unknownDescriptorFields(input);

  const entry = input.entry;
  if (typeof entry !== 'string' || entry.length === 0) {
    return fail('E_DESCRIPTOR_INVALID', { field: 'entry' });
  }
  const entryPath = normalizeZipPath(entry);
  if (!entryPath.ok) return fail('E_DESCRIPTOR_INVALID', { field: 'entry' });
  if (!entryPath.value.toLowerCase().endsWith('.html')) {
    return fail('E_DESCRIPTOR_INVALID', { field: 'entry' });
  }

  if (input.gameManifest !== ZIP_GAME_MANIFEST_FILE) {
    return fail('E_DESCRIPTOR_INVALID', { field: 'gameManifest' });
  }

  const files = input.files;
  if (!Array.isArray(files) || files.length === 0) {
    return fail('E_DESCRIPTOR_INVALID', { field: 'files' });
  }
  // Rule 0 (§3): the descriptor occupies one of the 512 central-directory slots.
  if (files.length > ZIP_LIMITS.zipEntries - 1) {
    return fail('E_ZIP_LIMIT_EXCEEDED', {
      kind: 'zipEntries',
      limit: ZIP_LIMITS.zipEntries,
      actual: files.length + 1,
    });
  }

  const seen = new Set();
  let previous = null;
  const normalizedFiles = [];
  for (let index = 0; index < files.length; index += 1) {
    const item = files[index];
    if (!isPlainObject(item)) return fail('E_DESCRIPTOR_INVALID', { field: `files[${index}]` });

    const pathResult = normalizeZipPath(item.path);
    if (!pathResult.ok) return fail('E_ZIP_PATH_INVALID', { path: String(item.path) });
    const path = pathResult.value;
    if (path === DESCRIPTOR_FILE) {
      // The descriptor must never list itself: a self-reference cannot be verified.
      return fail('E_DESCRIPTOR_INVALID', { field: `files[${index}].path` });
    }
    if (seen.has(path)) return fail('E_ZIP_PATH_CONFLICT', { path });
    seen.add(path);

    if (typeof item.size !== 'number' || !Number.isSafeInteger(item.size) || item.size < 0) {
      return fail('E_DESCRIPTOR_INVALID', { field: `files[${index}].size` });
    }
    if (typeof item.sha256 !== 'string' || !SHA256_HEX.test(item.sha256)) {
      return fail('E_DESCRIPTOR_INVALID', { field: `files[${index}].sha256` });
    }
    // §1.4: files[] is sorted by path in UTF-8 byte order (== code point order).
    if (previous !== null && codePointCompare(previous, path) >= 0) {
      return fail('E_DESCRIPTOR_INVALID', { field: `files[${index}].path` });
    }
    previous = path;
    normalizedFiles.push({ path, size: item.size, sha256: item.sha256 });
  }

  if (!seen.has(entryPath.value)) return fail('E_DESCRIPTOR_INVALID', { field: 'entry' });
  if (!seen.has(ZIP_GAME_MANIFEST_FILE)) return fail('E_DESCRIPTOR_INVALID', { field: 'gameManifest' });

  const entryType = checkZipEntryType(entryPath.value);
  if (!entryType.ok || entryType.kind !== 'document') {
    return fail('E_DESCRIPTOR_INVALID', { field: 'entry' });
  }

  return {
    ok: true,
    value: {
      formatVersion: 2,
      entry: entryPath.value,
      gameManifest: ZIP_GAME_MANIFEST_FILE,
      files: normalizedFiles,
    },
    warnings,
  };
}

/**
 * Canonical serialization of the file manifest (contract §1.5 item 5).
 * Key order is fixed, so two equal manifests always hash identically.
 */
export function canonicalFileManifest(files) {
  return JSON.stringify(files.map((file) => ({ path: file.path, size: file.size, sha256: file.sha256 })));
}

/**
 * `fileManifestDigest` (contract §1.5 item 5).
 *
 * The canonical form is hashed with an injected SHA-256 implementation: this
 * module stays free of Node built-ins so the browser bundle can import it, and
 * we avoid shipping a second cryptographic implementation. Host, CLI and tests
 * pass `node:crypto`-backed `(text) => hex`.
 *
 * @param {Array<{path:string,size:number,sha256:string}>} files Descriptor files.
 * @param {(text:string) => string} sha256Hex SHA-256 of the UTF-8 text, lowercase hex.
 * @returns {string} 64 lowercase hex characters.
 */
export function fileManifestDigest(files, sha256Hex) {
  if (!Array.isArray(files)) throw new TypeError('fileManifestDigest: files must be an array');
  if (typeof sha256Hex !== 'function') {
    throw new TypeError('fileManifestDigest: a sha256Hex(text) function is required');
  }
  const digest = sha256Hex(canonicalFileManifest(files));
  if (typeof digest !== 'string' || !SHA256_HEX.test(digest)) {
    throw new TypeError('fileManifestDigest: sha256Hex must return 64 lowercase hex characters');
  }
  return digest;
}

// ---------------------------------------------------------------------------
// Manifest / entry set consistency (§1.5, §1.6)
// ---------------------------------------------------------------------------

/**
 * Compare the descriptor file manifest against the archive's real entry set.
 *
 * The caller passes paths that have already been normalized and (if needed)
 * checked for conflicts; this function only compares sets and sizes.
 *
 * @param {Array<{path:string,size:number}>} files Descriptor files.
 * @param {Array<{path:string,size:number}>} entries Real archive entries (descriptor excluded).
 * @returns {{ok:true} | {ok:false, code:string, details?:object}}
 */
export function compareFileManifest(files, entries) {
  const expected = new Map(files.map((file) => [file.path, file.size]));
  const actual = new Map(entries.map((entry) => [entry.path, entry.size]));
  for (const [path, size] of expected) {
    if (!actual.has(path)) return fail('E_DESCRIPTOR_MISMATCH', { path, reason: 'missing' });
    if (size !== actual.get(path)) return fail('E_DESCRIPTOR_MISMATCH', { path, reason: 'size' });
  }
  for (const path of actual.keys()) {
    if (!expected.has(path)) return fail('E_DESCRIPTOR_MISMATCH', { path, reason: 'extra' });
  }
  return { ok: true };
}

/**
 * Reject descriptor-shaped names outside the archive root (contract §4.3).
 *
 * @param {string[]} normalizedPaths Every entry path in the archive.
 * @returns {{ok:true} | {ok:false, code:string, details?:object}}
 */
export function checkReservedNames(normalizedPaths) {
  for (const path of normalizedPaths) {
    if (path === DESCRIPTOR_FILE) continue;
    if (path.endsWith(`/${DESCRIPTOR_FILE}`) || path.toLowerCase() === DESCRIPTOR_FILE) {
      return fail('E_DESCRIPTOR_INVALID', { path });
    }
  }
  return { ok: true };
}

/**
 * Detect duplicate / case-folded / NFC-folded / directory-vs-file conflicts
 * (contract §4.3). Must run before anything is written to disk.
 *
 * @param {string[]} normalizedPaths Normalized entry paths.
 * @returns {{ok:true} | {ok:false, code:string, details?:object}}
 */
export function checkPathConflicts(normalizedPaths) {
  const exact = new Set();
  const folded = new Map();
  for (const path of normalizedPaths) {
    if (exact.has(path)) return fail('E_ZIP_PATH_CONFLICT', { path, reason: 'duplicate' });
    exact.add(path);

    const key = path.normalize('NFC').toLowerCase();
    const previous = folded.get(key);
    if (previous !== undefined && previous !== path) {
      return fail('E_ZIP_PATH_CONFLICT', { path, reason: 'folded' });
    }
    folded.set(key, path);
  }

  // `a` as a file and `a/b` as a file cannot coexist.
  for (const path of exact) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i += 1) {
      const prefix = segments.slice(0, i).join('/');
      if (exact.has(prefix)) return fail('E_ZIP_PATH_CONFLICT', { path, reason: 'file-directory' });
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Static content scanning (§4.7 — defence in depth, NOT a security proof)
// ---------------------------------------------------------------------------

/**
 * Markup patterns that must never appear in a package.
 *
 * The runtime CSP is the actual network/host boundary (contract §4.7 and
 * §7.5); these checks exist so an author gets an early, precise error and so
 * obviously-hostile packages never reach a version directory.
 */
const FORBIDDEN_MARKUP = Object.freeze([
  { code: 'base', pattern: /<\s*base[\s>]/i },
  { code: 'iframe', pattern: /<\s*iframe[\s>]/i },
  { code: 'external-url', pattern: /\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i },
  { code: 'external-import', pattern: /@import\s+(?:url\()?["']?\s*(?:https?:)?\/\//i },
  { code: 'eval', pattern: /\beval\s*\(/ },
  { code: 'new-function', pattern: /\bnew\s+Function\s*\(/ },
  { code: 'service-worker', pattern: /\bserviceWorker\b/ },
  { code: 'window-open', pattern: /\bwindow\s*\.\s*open\s*\(/ },
]);

const INLINE_FORBIDDEN = Object.freeze([
  { code: 'inline-script', pattern: /<\s*script\b(?![^>]*\bsrc\s*=)[^>]*>/i },
  { code: 'inline-style', pattern: /<\s*style\b[^>]*>/i },
  { code: 'inline-handler', pattern: /\son[a-z]+\s*=/i },
  { code: 'javascript-url', pattern: /\bjavascript\s*:/i },
]);

/**
 * Scan one HTML document for forbidden constructs (contract §4.7).
 *
 * @param {string} html Document text.
 * @param {{inlineForbidden?: boolean}} options `inlineForbidden` is true for
 *   `asset-zip-v2` (decision D-C) and false for `html-v1` (unchanged V1 rules).
 * @returns {{ok:true} | {ok:false, code:string, details?:object}}
 */
export function checkHtmlContent(html, { inlineForbidden = false } = {}) {
  if (typeof html !== 'string') return fail('E_ASSET_TYPE_UNSUPPORTED', { field: 'html' });
  for (const rule of FORBIDDEN_MARKUP) {
    if (rule.pattern.test(html)) return fail('E_ASSET_TYPE_UNSUPPORTED', { rule: rule.code });
  }
  if (inlineForbidden) {
    for (const rule of INLINE_FORBIDDEN) {
      if (rule.pattern.test(html)) return fail('E_ASSET_INLINE_FORBIDDEN', { rule: rule.code });
    }
  }
  return { ok: true };
}

/** URLs that reference a scheme or an authority are rejected in package CSS. */
const CSS_EXTERNAL = /\b(?:@import\s+(?:url\()?["']?\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\/)/i;

/**
 * Scan one CSS file for external references (contract §4.6/§4.7).
 *
 * @param {string} css Stylesheet text.
 * @returns {{ok:true} | {ok:false, code:string, details?:object}}
 */
export function checkCssContent(css) {
  if (typeof css !== 'string') return fail('E_ASSET_TYPE_UNSUPPORTED', { field: 'css' });
  if (CSS_EXTERNAL.test(css)) return fail('E_ASSET_TYPE_UNSUPPORTED', { rule: 'external-css-url' });
  return { ok: true };
}

/**
 * Reject a second authoritative manifest declaration anywhere in the package
 * (contract §1.6). An inline `<script id="dsh-game-manifest">` is the V1
 * declaration, and a ZIP package must not carry a second one.
 *
 * @param {string} html Any HTML document from the package.
 * @returns {{ok:true} | {ok:false, code:string, details?:object}}
 */
export function checkManifestConflict(html) {
  if (typeof html !== 'string') return { ok: true };
  if (/type\s*=\s*["']application\/json["']\s+id\s*=\s*["']dsh-game-manifest["']/i.test(html)) {
    return fail('E_MANIFEST_CONFLICT', { rule: 'inline-manifest' });
  }
  if (/id\s*=\s*["']dsh-game-manifest["']/i.test(html)) {
    return fail('E_MANIFEST_CONFLICT', { rule: 'inline-manifest' });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** True when `format` is one of the frozen V1.5 package formats. */
export function isPackageFormat(value) {
  return typeof value === 'string' && PACKAGE_FORMATS.includes(value);
}

/** Normalize a possibly-missing format; V1 records default to `html-v1` (§6.2). */
export function normalizePackageFormat(value) {
  return isPackageFormat(value) ? value : 'html-v1';
}

/** Package file name for a `format`: HTML keeps V1's, ZIP gets `.dshgame.zip`. */
export function packageFileNameForFormat(id, version, format) {
  return format === 'asset-zip-v2' ? `${id}-${version}.dshgame.zip` : `${id}-${version}.html`;
}
