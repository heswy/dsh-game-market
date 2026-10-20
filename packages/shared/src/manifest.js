/**
 * V1 Game Package + manifest v1 contract (single-file, self-contained HTML).
 *
 * PRD §8.2 / D-034. A V1 package is exactly one UTF-8 HTML file (<= 20 MiB)
 * whose document contains exactly one inline manifest:
 *
 *   <script type="application/json" id="dsh-game-manifest">{ ... }</script>
 *
 * The manifest text is <= 64 KiB. There is no archive, no `entry` field and no
 * package file list: the file itself is the game. `icon` is a data URI; cover
 * and screenshots are Registry-only fields (see registry.js).
 *
 * Pure JS: no Node built-ins, no browser globals at import time. Used by Host
 * (install/launch validation), CLI, Client (Registry rendering) and tests.
 *
 * Error entries use internal `E_*` constants; the public `GM-*` mapping lives
 * in shared/errors.js (`INTERNAL_TO_GM`).
 */

import { GAME_ID_PATTERN, LIMITS, PACKAGE_ZIP_EXTENSION } from './constants.js';

export const MANIFEST_SCRIPT_ID = 'dsh-game-manifest';
export const MANIFEST_VERSION = 1;
export const PACKAGE_EXTENSION = '.html';
export const MANIFEST_BYTES_MAX = LIMITS.manifestBytes;
export const PACKAGE_BYTES_MAX = LIMITS.packageBytes;

export const CATEGORIES = Object.freeze([
  'arcade',
  'puzzle',
  'card',
  'idle',
  'action',
  'strategy',
  'trivia',
  'sandbox',
]);

/** V1 grants exactly two capabilities (PRD §8.2.5, D-011). */
export const CAPABILITIES = Object.freeze(['storage', 'score']);

/** Known but intentionally disabled in V1; must be rejected as unsupported. */
export const KNOWN_UNSUPPORTED_CAPABILITIES = Object.freeze([
  'network',
  'workspace-context',
  'clipboard',
  'audio-capture',
  'notifications',
]);

export const PREFERRED_THEMES = Object.freeze(['system', 'light', 'dark', 'game-defined']);
export const SCORE_DIRECTIONS = Object.freeze(['higher-better', 'lower-better']);

/** Reserved ids (PRD §8.1 / §8.2.4). */
export const RESERVED_GAME_IDS = Object.freeze([
  'conversation',
  'plugins',
  'schedules',
  'dsh-game-market',
  'game-market',
  'main',
  'sidebar',
  'api',
  'assets',
  'static',
  'health',
  'launch',
  'dsh',
]);

const VERSION_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const LOCALIZED_TAG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
const LICENSE_RE = /^[A-Za-z0-9.+-]{1,64}$/;
const ICON_RE = /^data:image\/(png|webp|jpeg);base64,([A-Za-z0-9+/=\s]+)$/;
const HTTPS_URL_RE = /^https:\/\/[^\s]{1,290}$/;
const MANIFEST_SCRIPT_RE =
  /<script\b[^>]*\bid\s*=\s*["']dsh-game-manifest["'][^>]*>([\s\S]*?)<\/script\s*>/gi;

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Fields removed from the package manifest in V1 (registry-only or implicit). */
const REMOVED_MANIFEST_FIELDS = Object.freeze(['entry', 'cover', 'screenshots']);

function pkgError(code, message, extra) {
  const error = { code, message };
  if (extra && typeof extra === 'object') {
    for (const key of Object.keys(extra)) {
      if (extra[key] !== undefined) error[key] = extra[key];
    }
  }
  return error;
}

/** UTF-8 byte length without relying on Node's Buffer. */
export function utf8ByteLength(text) {
  const value = String(text);
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
  // Deterministic fallback for exotic runtimes.
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/** Unicode code-point length (manifest length limits are code points, not bytes). */
export function codePointLength(text) {
  return Array.from(String(text)).length;
}

export function isValidVersion(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  const match = VERSION_RE.exec(value);
  if (!match) return false;
  const pre = match[4] ? match[4].split('.') : [];
  for (const identifier of pre) {
    if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0')) return false;
  }
  return true;
}

/**
 * Range syntax accepted by the V1 contract:
 *   `^1.0.0`, `~1.0.0`, `1.0.0`, `>=1.0.0 <2.0.0`.
 * Satisfaction is Host-owned (packages/host/src/semver.js); this only freezes
 * the grammar so the CLI and Host agree on what is a manifest error (GM-4221).
 */
export function isValidRange(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text.length === 0 || text.length > 120) return false;
  if (text.startsWith('^') || text.startsWith('~')) return isValidVersion(text.slice(1).trim());
  const bounded = /^>=([^\s]+)\s+<([^\s]+)$/.exec(text);
  if (bounded) return isValidVersion(bounded[1]) && isValidVersion(bounded[2]);
  return isValidVersion(text);
}

export function isDataImageUri(value) {
  return typeof value === 'string' && ICON_RE.test(value);
}

/** `snake` + `1.2.0` -> `snake-1.2.0.html` (Registry package file name). */
export function packageFileName(id, version) {
  return `${id}-${version}${PACKAGE_EXTENSION}`;
}

export function isPackageFileName(fileName, id, version) {
  return typeof fileName === 'string' && fileName === packageFileName(id, version);
}

/** `snake` + `1.2.0` -> `snake-1.2.0.dshgame.zip` (V1.5 asset package). */
export function zipPackageFileName(id, version) {
  return `${id}-${version}${PACKAGE_ZIP_EXTENSION}`;
}

export function isZipPackageFileName(fileName, id, version) {
  return typeof fileName === 'string' && fileName === zipPackageFileName(id, version);
}

function checkString(errors, value, field, { min = 1, max, pattern, control = true } = {}) {
  if (typeof value !== 'string') {
    errors.push(pkgError('E_PKG_FIELD_TYPE', `${field} must be a string`, { field: field }));
    return false;
  }
  const length = codePointLength(value);
  if (length < min || (max !== undefined && length > max)) {
    errors.push(pkgError('E_PKG_FIELD_RANGE', `${field} length is out of range`, { field: field }));
    return false;
  }
  if (control && CONTROL_CHARS_RE.test(value)) {
    errors.push(pkgError('E_PKG_FIELD_RANGE', `${field} contains control characters`, { field: field }));
    return false;
  }
  if (pattern && !pattern.test(value)) {
    errors.push(pkgError('E_PKG_FIELD_RANGE', `${field} has an unsupported format`, { field: field }));
    return false;
  }
  return true;
}

function checkAuthor(errors, author) {
  if (!author || typeof author !== 'object' || Array.isArray(author)) {
    errors.push(pkgError('E_PKG_FIELD_TYPE', 'author must be an object', { field: 'author' }));
    return;
  }
  checkString(errors, author.name, 'author.name', { max: 64 });
  if (author.url !== undefined) {
    if (typeof author.url !== 'string' || !HTTPS_URL_RE.test(author.url)) {
      errors.push(pkgError('E_PKG_FIELD_RANGE', 'author.url must be an https URL', { field: 'author.url' }));
    }
  }
}

function checkStringArray(errors, value, field, { min = 0, max = Infinity, itemPattern, unique = true, enumSet } = {}) {
  if (!Array.isArray(value)) {
    errors.push(pkgError('E_PKG_FIELD_TYPE', `${field} must be an array`, { field: field }));
    return;
  }
  if (value.length < min || value.length > max) {
    errors.push(pkgError('E_PKG_FIELD_RANGE', `${field} length is out of range`, { field: field }));
    return;
  }
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string') {
      errors.push(pkgError('E_PKG_FIELD_TYPE', `${field} items must be strings`, { field: field }));
      return;
    }
    if (enumSet) {
      if (!enumSet.has(item)) {
        const code =
          field === 'categories' ? 'E_PKG_CATEGORY_UNKNOWN' : 'E_PKG_CAPABILITY_UNKNOWN';
        errors.push(pkgError(code, `${field} contains an unsupported value`, { field: field, value: item }));
      }
    } else if (itemPattern && !itemPattern.test(item)) {
      errors.push(pkgError('E_PKG_FIELD_RANGE', `${field} item has an unsupported format`, { field: field }));
    }
    if (unique) {
      if (seen.has(item)) {
        const code =
          field === 'capabilities' ? 'E_PKG_CAPABILITY_DUPLICATE' : 'E_PKG_FIELD_RANGE';
        errors.push(pkgError(code, `${field} contains a duplicate value`, { field: field, value: item }));
      }
      seen.add(item);
    }
  }
}

function checkCapabilities(errors, capabilities) {
  if (!Array.isArray(capabilities)) {
    errors.push(pkgError('E_PKG_FIELD_TYPE', 'capabilities must be an array', { field: 'capabilities' }));
    return false;
  }
  const seen = new Set();
  let grantedStorage = false;
  let grantedScore = false;
  for (const capability of capabilities) {
    if (typeof capability !== 'string') {
      errors.push(pkgError('E_PKG_FIELD_TYPE', 'capabilities items must be strings', { field: 'capabilities' }));
      return false;
    }
    if (CAPABILITIES.includes(capability)) {
      if (capability === 'storage') grantedStorage = true;
      if (capability === 'score') grantedScore = true;
    } else if (KNOWN_UNSUPPORTED_CAPABILITIES.includes(capability)) {
      errors.push(
        pkgError('E_PKG_CAPABILITY_UNSUPPORTED', `capability is known but unsupported in V1: ${capability}`, {
          field: 'capabilities',
          value: capability,
        }),
      );
    } else {
      errors.push(
        pkgError('E_PKG_CAPABILITY_UNKNOWN', `unknown capability: ${capability}`, {
          field: 'capabilities',
          value: capability,
        }),
      );
    }
    if (seen.has(capability)) {
      errors.push(
        pkgError('E_PKG_CAPABILITY_DUPLICATE', `duplicate capability: ${capability}`, {
          field: 'capabilities',
          value: capability,
        }),
      );
    }
    seen.add(capability);
  }
  return grantedStorage && grantedScore;
}

function checkScore(errors, score) {
  if (!score || typeof score !== 'object' || Array.isArray(score)) {
    errors.push(pkgError('E_PKG_FIELD_TYPE', 'score must be an object', { field: 'score' }));
    return;
  }
  if (score.direction !== undefined && !SCORE_DIRECTIONS.includes(score.direction)) {
    errors.push(pkgError('E_PKG_SCORE_RANGE', 'score.direction is invalid', { field: 'score.direction' }));
  }
  const min = score.min;
  const max = score.max;
  if (typeof min !== 'number' || !Number.isFinite(min) || typeof max !== 'number' || !Number.isFinite(max)) {
    errors.push(pkgError('E_PKG_SCORE_RANGE', 'score.min/max must be finite numbers', { field: 'score' }));
    return;
  }
  if (!(min < max) || max - min > 1e9) {
    errors.push(pkgError('E_PKG_SCORE_RANGE', 'score range is invalid', { field: 'score' }));
  }
  if (score.integer !== undefined && typeof score.integer !== 'boolean') {
    errors.push(pkgError('E_PKG_FIELD_TYPE', 'score.integer must be a boolean', { field: 'score.integer' }));
  }
}

function checkSave(errors, save) {
  if (!save || typeof save !== 'object' || Array.isArray(save)) {
    errors.push(pkgError('E_PKG_FIELD_TYPE', 'save must be an object', { field: 'save' }));
    return;
  }
  const schemaVersion = save.schemaVersion;
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 2147483647) {
    errors.push(pkgError('E_PKG_SAVE_SCHEMA', 'save.schemaVersion is invalid', { field: 'save.schemaVersion' }));
  }
}

function checkViewport(errors, viewport) {
  if (!viewport || typeof viewport !== 'object' || Array.isArray(viewport)) {
    errors.push(pkgError('E_PKG_FIELD_TYPE', 'viewport must be an object', { field: 'viewport' }));
    return;
  }
  for (const key of ['width', 'height']) {
    const value = viewport[key];
    if (!Number.isInteger(value) || value < 1 || value > 3840) {
      errors.push(pkgError('E_PKG_FIELD_RANGE', `viewport.${key} must be 1..3840`, { field: `viewport.${key}` }));
    }
  }
  if (viewport.fit !== undefined && viewport.fit !== 'contain') {
    errors.push(pkgError('E_PKG_FIELD_RANGE', 'viewport.fit must be "contain"', { field: 'viewport.fit' }));
  }
}

function checkI18n(errors, i18n) {
  if (!i18n || typeof i18n !== 'object' || Array.isArray(i18n)) {
    errors.push(pkgError('E_PKG_FIELD_TYPE', 'i18n must be an object', { field: 'i18n' }));
    return;
  }
  const locales = i18n.locales;
  if (!locales || typeof locales !== 'object' || Array.isArray(locales)) {
    errors.push(pkgError('E_PKG_FIELD_TYPE', 'i18n.locales must be an object', { field: 'i18n.locales' }));
    return;
  }
  const tags = Object.keys(locales);
  if (tags.length > 16) {
    errors.push(pkgError('E_PKG_FIELD_RANGE', 'i18n.locales has too many entries', { field: 'i18n.locales' }));
  }
  if (typeof i18n.default !== 'string' || !tags.includes(i18n.default)) {
    errors.push(pkgError('E_PKG_FIELD_RANGE', 'i18n.default must be one of i18n.locales', { field: 'i18n.default' }));
  }
  for (const tag of tags) {
    if (!LOCALIZED_TAG_RE.test(tag)) {
      errors.push(pkgError('E_PKG_FIELD_RANGE', 'i18n locale tag is invalid', { field: 'i18n.locales' }));
      continue;
    }
    const entry = locales[tag];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(pkgError('E_PKG_FIELD_TYPE', 'i18n locale entry must be an object', { field: 'i18n.locales' }));
      continue;
    }
    if (entry.name !== undefined) checkString(errors, entry.name, `i18n.locales.${tag}.name`, { max: 64 });
    if (entry.description !== undefined) {
      checkString(errors, entry.description, `i18n.locales.${tag}.description`, { max: 280 });
    }
  }
}

/**
 * Validate a parsed manifest object (manifest v1).
 * @returns {{ok:boolean, errors:object[], warnings:object[], manifest:object|null}}
 */
export function validateManifest(input) {
  const errors = [];
  const warnings = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ok: false,
      errors: [pkgError('E_PKG_MANIFEST_JSON', 'manifest must be a JSON object')],
      warnings,
      manifest: null,
    };
  }
  const manifest = input;

  // Legacy V0 manifest carries `author` as a string; reject it explicitly.
  if (typeof manifest.author === 'string') {
    errors.push(pkgError('E_PKG_LEGACY_FIELD', 'author must be an object, not a string', { field: 'author' }));
  }
  if (manifest.category !== undefined && manifest.categories === undefined) {
    errors.push(pkgError('E_PKG_LEGACY_FIELD', 'use categories[] instead of category', { field: 'category' }));
  }
  for (const removed of REMOVED_MANIFEST_FIELDS) {
    if (manifest[removed] !== undefined) {
      errors.push(
        pkgError('E_PKG_LEGACY_FIELD', `manifest field "${removed}" is not part of V1 manifests`, {
          field: removed,
        }),
      );
    }
  }

  if (manifest.manifestVersion !== MANIFEST_VERSION) {
    const code = Number.isInteger(manifest.manifestVersion) ? 'E_PKG_MANIFEST_VERSION' : 'E_PKG_FIELD_TYPE';
    errors.push(pkgError(code, 'manifestVersion must be the integer 1', { field: 'manifestVersion' }));
  }

  // id
  if (typeof manifest.id !== 'string' || !GAME_ID_PATTERN.test(manifest.id)) {
    errors.push(pkgError('E_PKG_ID_INVALID', 'id must match ^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$', { field: 'id' }));
  } else if (manifest.id.includes('--')) {
    errors.push(pkgError('E_PKG_ID_INVALID', 'id must not contain consecutive hyphens', { field: 'id' }));
  } else if (RESERVED_GAME_IDS.includes(manifest.id)) {
    errors.push(pkgError('E_PKG_ID_RESERVED', `id is reserved: ${manifest.id}`, { field: 'id' }));
  }

  checkString(errors, manifest.name, 'name', { max: 64 });
  if (typeof manifest.version !== 'string' || !isValidVersion(manifest.version)) {
    errors.push(pkgError('E_PKG_VERSION_INVALID', 'version must be a strict semver subset', { field: 'version' }));
  }
  checkAuthor(errors, manifest.author);
  checkString(errors, manifest.description, 'description', { max: 280 });

  const categorySet = new Set(CATEGORIES);
  checkStringArray(errors, manifest.categories, 'categories', { min: 1, max: 3, enumSet: categorySet });
  const capabilitiesOk = checkCapabilities(errors, manifest.capabilities);

  if (typeof manifest.sdkVersion !== 'string' || !isValidRange(manifest.sdkVersion)) {
    errors.push(pkgError('E_PKG_RANGE_SYNTAX', 'sdkVersion must be ^/~ of a semver or a bounded range', {
      field: 'sdkVersion',
    }));
  }
  if (typeof manifest.runtimeVersion !== 'string' || !isValidRange(manifest.runtimeVersion)) {
    errors.push(pkgError('E_PKG_RANGE_SYNTAX', 'runtimeVersion must be ^/~ of a semver or a bounded range', {
      field: 'runtimeVersion',
    }));
  }

  if (manifest.icon !== undefined) {
    if (!isDataImageUri(manifest.icon)) {
      errors.push(pkgError('E_PKG_ICON_FORMAT', 'icon must be a png/webp/jpeg data URI', { field: 'icon' }));
    } else {
      const match = ICON_RE.exec(manifest.icon);
      const base64 = match ? match[2].replace(/\s+/g, '') : '';
      const decodedBytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
      if (decodedBytes > LIMITS.iconBytes) {
        errors.push(pkgError('E_PKG_ICON_TOO_LARGE', 'icon exceeds 256 KiB', { field: 'icon' }));
      }
    }
  }

  if (manifest.tags !== undefined) {
    checkStringArray(errors, manifest.tags, 'tags', { max: 8, itemPattern: TAG_RE });
  }
  if (manifest.preferredTheme !== undefined && !PREFERRED_THEMES.includes(manifest.preferredTheme)) {
    errors.push(pkgError('E_PKG_FIELD_RANGE', 'preferredTheme is invalid', { field: 'preferredTheme' }));
  }
  if (manifest.viewport !== undefined) checkViewport(errors, manifest.viewport);

  const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  const declaresScore = capabilities.includes('score');
  const declaresStorage = capabilities.includes('storage');
  if (declaresScore && manifest.score === undefined) {
    errors.push(pkgError('E_PKG_FIELD_MISSING', 'score is required when capabilities includes "score"', {
      field: 'score',
    }));
  } else if (manifest.score !== undefined && declaresScore) {
    checkScore(errors, manifest.score);
  } else if (manifest.score !== undefined && !declaresScore) {
    warnings.push({ code: 'W_PKG_IGNORED_FIELD', message: 'score is ignored without the "score" capability', field: 'score' });
  }
  if (declaresStorage && manifest.save === undefined) {
    errors.push(pkgError('E_PKG_FIELD_MISSING', 'save is required when capabilities includes "storage"', {
      field: 'save',
    }));
  } else if (manifest.save !== undefined && declaresStorage) {
    checkSave(errors, manifest.save);
  } else if (manifest.save !== undefined && !declaresStorage) {
    warnings.push({ code: 'W_PKG_IGNORED_FIELD', message: 'save is ignored without the "storage" capability', field: 'save' });
  }

  if (manifest.permissions !== undefined) {
    const permissions = manifest.permissions;
    if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions) || Object.keys(permissions).length > 0) {
      errors.push(pkgError('E_PKG_PERMISSION_UNSUPPORTED', 'permissions is not supported in V1', { field: 'permissions' }));
    }
  }
  for (const key of ['homepage', 'repository']) {
    if (manifest[key] !== undefined && (typeof manifest[key] !== 'string' || !HTTPS_URL_RE.test(manifest[key]))) {
      errors.push(pkgError('E_PKG_FIELD_RANGE', `${key} must be an https URL`, { field: key }));
    }
  }
  if (manifest.license !== undefined && (typeof manifest.license !== 'string' || !LICENSE_RE.test(manifest.license))) {
    errors.push(pkgError('E_PKG_FIELD_RANGE', 'license must be an SPDX-like identifier', { field: 'license' }));
  }
  if (manifest.i18n !== undefined) checkI18n(errors, manifest.i18n);

  const known = new Set([
    'manifestVersion', 'id', 'name', 'version', 'author', 'description', 'categories', 'capabilities',
    'sdkVersion', 'runtimeVersion', 'icon', 'tags', 'preferredTheme', 'viewport', 'score', 'save',
    'permissions', 'homepage', 'repository', 'license', 'i18n',
  ]);
  for (const key of Object.keys(manifest)) {
    if (known.has(key) || key.startsWith('x-')) continue;
    warnings.push({ code: 'W_PKG_UNKNOWN_FIELD', message: `unknown manifest field: ${key}`, field: key });
  }

  // `capabilitiesOk` is only informational: unknown capability already errored.
  void capabilitiesOk;
  return { ok: errors.length === 0, errors, warnings, manifest };
}

/**
 * Extract the inline manifest JSON from a package HTML string.
 * @returns {{ok:boolean, jsonText:string|null, span:[number,number]|null, errors:object[]}}
 */
export function extractManifest(html) {
  if (typeof html !== 'string' || html.length === 0) {
    return { ok: false, jsonText: null, span: null, errors: [pkgError('E_PKG_HTML_INVALID', 'package must be a non-empty HTML string')] };
  }
  MANIFEST_SCRIPT_RE.lastIndex = 0;
  const matches = [];
  let match;
  while ((match = MANIFEST_SCRIPT_RE.exec(html)) !== null) {
    matches.push({ json: match[1], index: match.index, length: match[0].length });
    if (matches.length > 1) break;
  }
  if (matches.length === 0) {
    return {
      ok: false,
      jsonText: null,
      span: null,
      errors: [
        pkgError('E_PKG_MANIFEST_MISSING', `missing inline manifest script (id="${MANIFEST_SCRIPT_ID}")`, {
          field: 'manifest',
        }),
      ],
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      jsonText: null,
      span: null,
      errors: [
        pkgError('E_PKG_MANIFEST_DUPLICATE', 'package contains more than one inline manifest script', {
          field: 'manifest',
        }),
      ],
    };
  }
  const jsonText = matches[0].json.trim();
  if (jsonText.length === 0) {
    return {
      ok: false,
      jsonText: null,
      span: null,
      errors: [pkgError('E_PKG_MANIFEST_JSON', 'inline manifest script is empty')],
    };
  }
  if (utf8ByteLength(jsonText) > MANIFEST_BYTES_MAX) {
    return {
      ok: false,
      jsonText: null,
      span: null,
      errors: [pkgError('E_PKG_MANIFEST_TOO_LARGE', `inline manifest exceeds ${MANIFEST_BYTES_MAX} bytes`)],
    };
  }
  return {
    ok: true,
    jsonText,
    span: [matches[0].index, matches[0].index + matches[0].length],
    errors: [],
  };
}

function violation(label) {
  return pkgError('E_PKG_ENTRY_NOT_SELF_CONTAINED', `package is not self-contained: ${label}`, {
    field: 'entry',
  });
}

/**
 * Static self-containment checks (PRD §8.2.4 / D-023). Heuristic by design:
 * the Host repeats these checks at install/launch, the sandbox CSP is the
 * runtime backstop.
 * @returns {object[]} violations (empty when the HTML is self-contained)
 */
export function checkSelfContained(html) {
  const violations = [];
  if (typeof html !== 'string') return [violation('package must be an HTML string')];

  if (/<iframe\b/i.test(html)) violations.push(violation('nested <iframe>'));
  if (/@import\s/i.test(html)) violations.push(violation('CSS @import'));

  const resourceTags = /<(script|link|img|audio|video|source|track|input|use)\b([^>]*)>/gi;
  let match;
  while ((match = resourceTags.exec(html)) !== null) {
    const attrs = match[2] || '';
    const attrMatch = /\b(?:src|href|xlink:href)\s*=\s*(["'])(.*?)\1/i.exec(attrs);
    if (!attrMatch) continue;
    const value = attrMatch[2].trim();
    if (value === '' || value.startsWith('data:') || value.startsWith('#')) continue;
    violations.push(violation(`external ${match[1]} resource (${value.slice(0, 64)})`));
  }

  const cssUrl = /url\(\s*["']?([^)'"\s]+)["']?\s*\)/gi;
  while ((match = cssUrl.exec(html)) !== null) {
    const value = match[1].trim();
    if (value.startsWith('data:') || value.startsWith('#')) continue;
    violations.push(violation(`external CSS url() (${value.slice(0, 64)})`));
  }

  const networkApis = [
    [/\bfetch\s*\(/, 'fetch()'],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
    [/\bWebSocket\s*\(/, 'WebSocket'],
    [/\bEventSource\s*\(/, 'EventSource'],
    [/\bsendBeacon\s*\(/, 'sendBeacon()'],
    [/\bserviceWorker\b/, 'serviceWorker'],
  ];
  for (const [re, label] of networkApis) {
    if (re.test(html)) violations.push(violation(`network API ${label}`));
  }
  return violations;
}

/**
 * Full package validation used by CLI `validate`, Host install and Runtime
 * launch re-checks (PRD §8.2.7).
 *
 * @param {string} html package bytes decoded as UTF-8
 * @param {{packageBytes?:number, skipSelfContained?:boolean}} [options]
 * @returns {{ok:boolean, bytes:number, manifest:object|null, errors:object[], warnings:object[]}}
 */
export function validatePackageHtml(html, options = {}) {
  const errors = [];
  const warnings = [];
  const packageBytes = options.packageBytes || PACKAGE_BYTES_MAX;

  if (typeof html !== 'string' || html.length === 0) {
    return {
      ok: false,
      bytes: 0,
      manifest: null,
      errors: [pkgError('E_PKG_HTML_INVALID', 'package must be a non-empty HTML string')],
      warnings,
    };
  }
  const bytes = utf8ByteLength(html);
  if (bytes > packageBytes) {
    errors.push(pkgError('E_PKG_TOO_LARGE', `package exceeds ${packageBytes} bytes`, { bytes }));
  }
  if (html.startsWith('\uFEFF')) {
    errors.push(pkgError('E_PKG_HTML_INVALID', 'package must be UTF-8 without BOM'));
  }
  if (!/<html\b/i.test(html)) {
    errors.push(pkgError('E_PKG_HTML_INVALID', 'package must be an HTML document'));
  }

  const extracted = extractManifest(html);
  errors.push(...extracted.errors);
  let manifest = null;
  if (extracted.ok) {
    let parsed;
    try {
      parsed = JSON.parse(extracted.jsonText);
    } catch (error) {
      errors.push(
        pkgError('E_PKG_MANIFEST_JSON', `inline manifest is not valid JSON: ${error.message}`, {
          field: 'manifest',
        }),
      );
    }
    if (parsed !== undefined) {
      const manifestResult = validateManifest(parsed);
      errors.push(...manifestResult.errors);
      warnings.push(...manifestResult.warnings);
      manifest = manifestResult.manifest;
    }
  }

  if (options.skipSelfContained !== true) {
    const scanHtml = extracted.ok && extracted.span
      ? html.slice(0, extracted.span[0]) + html.slice(extracted.span[1])
      : html;
    errors.push(...checkSelfContained(scanHtml));
  }

  return { ok: errors.length === 0, bytes, manifest, errors, warnings };
}
