/**
 * V1 static Registry contract (PRD §8.8, D-013 / D-035).
 *
 * The Registry is one static JSON file (`registry/games.json`) plus static
 * single-file packages. There is no server. Host fetches, validates, caches and
 * merges the index with local installs; the Client never fetches GitHub.
 *
 * Pure JS: no Node built-ins, no network. Used by Host (fetch/validate/cache),
 * CLI `publish` (emit registry entries) and tests.
 */

import { LIMITS, TIMING } from './constants.js';
import {
  CAPABILITIES,
  CATEGORIES,
  PREFERRED_THEMES,
  codePointLength,
  isValidRange,
  isValidVersion,
  packageFileName,
} from './manifest.js';

export const REGISTRY_FILE = 'games.json';
export const REGISTRY_CACHE_FILE = 'registry-cache.json';
export const REGISTRY_VERSION = 1;
export const REGISTRY_CACHE_SCHEMA_VERSION = 1;
export const REGISTRY_BYTES_MAX = LIMITS.registryBytes;
export const REGISTRY_GAMES_MAX = LIMITS.registryGames;
export const REGISTRY_TTL_MS = TIMING.registryTtlMs;
export const REGISTRY_STALE_MS = TIMING.registryStaleMs;
export const REGISTRY_REFRESH_THROTTLE_MS = TIMING.registryRefreshThrottleMs;
export const PACKAGE_REDIRECTS_MAX = 5;

/** Hosts allowed for remote package/preview downloads by default (PRD §8.8.2). */
export const DEFAULT_ALLOWED_HOSTS = Object.freeze([
  'github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
]);

export const SHA256_RE = /^[a-f0-9]{64}$/;
const HTTPS_RE = /^https:\/\//i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
const LICENSE_RE = /^[A-Za-z0-9.+-]{1,64}$/;
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** A relative package path is only legal for a local file Registry. */
const RELATIVE_PACKAGE_RE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function regError(code, message, extra) {
  const error = { code, message };
  if (extra && typeof extra === 'object') {
    for (const key of Object.keys(extra)) {
      if (extra[key] !== undefined) error[key] = extra[key];
    }
  }
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === 'string' && ISO_DATE_RE.test(value) && !Number.isNaN(Date.parse(value));
}

function checkString(errors, value, field, { min = 1, max, pattern, allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    errors.push(regError('E_REGISTRY_FIELD_TYPE', `${field} must be a string`, { field }));
    return false;
  }
  const length = codePointLength(value);
  if ((!allowEmpty && length < min) || (max !== undefined && length > max)) {
    errors.push(regError('E_REGISTRY_FIELD_RANGE', `${field} length is out of range`, { field }));
    return false;
  }
  if (CONTROL_CHARS_RE.test(value)) {
    errors.push(regError('E_REGISTRY_FIELD_RANGE', `${field} contains control characters`, { field }));
    return false;
  }
  if (pattern && !pattern.test(value)) {
    errors.push(regError('E_REGISTRY_FIELD_RANGE', `${field} has an unsupported format`, { field }));
    return false;
  }
  return true;
}

function checkHttpsUrl(errors, value, field, max = 300) {
  if (typeof value !== 'string' || !HTTPS_RE.test(value) || value.length > max) {
    errors.push(regError('E_REGISTRY_FIELD_RANGE', `${field} must be an https URL`, { field }));
  }
}

/**
 * Validate one RegistryGame entry. Package URL rules depend on the Registry
 * source (https index vs local file index), see `validateRegistry`.
 */
export function validateRegistryGame(input, options = {}) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [regError('E_REGISTRY_FIELD_TYPE', 'registry game must be an object')],
      warnings,
      game: null,
    };
  }
  const game = input;

  checkString(errors, game.id, 'id', { max: 48 });
  checkString(errors, game.name, 'name', { max: 64 });
  if (typeof game.version !== 'string' || !isValidVersion(game.version)) {
    errors.push(regError('E_REGISTRY_FIELD_RANGE', 'version must be a strict semver subset', { field: 'version' }));
  }
  checkString(errors, game.description, 'description', { max: 280 });

  if (!isPlainObject(game.author)) {
    errors.push(regError('E_REGISTRY_FIELD_TYPE', 'author must be an object', { field: 'author' }));
  } else {
    checkString(errors, game.author.name, 'author.name', { max: 64 });
    if (game.author.url !== undefined) checkHttpsUrl(errors, game.author.url, 'author.url');
  }

  const categorySet = new Set(CATEGORIES);
  if (!Array.isArray(game.categories) || game.categories.length < 1 || game.categories.length > 3) {
    errors.push(regError('E_REGISTRY_FIELD_RANGE', 'categories must have 1..3 items', { field: 'categories' }));
  } else {
    for (const category of game.categories) {
      if (!categorySet.has(category)) {
        errors.push(regError('E_REGISTRY_FIELD_RANGE', `unknown category: ${String(category)}`, { field: 'categories' }));
      }
    }
  }

  if (game.tags !== undefined) {
    if (!Array.isArray(game.tags) || game.tags.length > 8) {
      errors.push(regError('E_REGISTRY_FIELD_RANGE', 'tags must be an array of <= 8 items', { field: 'tags' }));
    } else {
      for (const tag of game.tags) {
        if (typeof tag !== 'string' || !TAG_RE.test(tag)) {
          errors.push(regError('E_REGISTRY_FIELD_RANGE', 'tags item has an unsupported format', { field: 'tags' }));
        }
      }
    }
  }

  if (!Array.isArray(game.capabilities)) {
    errors.push(regError('E_REGISTRY_FIELD_TYPE', 'capabilities must be an array', { field: 'capabilities' }));
  } else {
    const capabilitySet = new Set(CAPABILITIES);
    for (const capability of game.capabilities) {
      if (!capabilitySet.has(capability)) {
        errors.push(regError('E_REGISTRY_FIELD_RANGE', `unsupported capability: ${String(capability)}`, {
          field: 'capabilities',
        }));
      }
    }
  }

  for (const field of ['sdkVersion', 'runtimeVersion']) {
    if (typeof game[field] !== 'string' || !isValidRange(game[field])) {
      errors.push(regError('E_REGISTRY_FIELD_RANGE', `${field} must be a valid range`, { field }));
    }
  }

  if (game.preferredTheme !== undefined && !PREFERRED_THEMES.includes(game.preferredTheme)) {
    errors.push(regError('E_REGISTRY_FIELD_RANGE', 'preferredTheme is invalid', { field: 'preferredTheme' }));
  }

  // package
  if (!isPlainObject(game.package)) {
    errors.push(regError('E_REGISTRY_FIELD_TYPE', 'package must be an object', { field: 'package' }));
  } else {
    const pkg = game.package;
    if (typeof pkg.sha256 !== 'string' || !SHA256_RE.test(pkg.sha256)) {
      errors.push(regError('E_REGISTRY_FIELD_RANGE', 'package.sha256 must be 64 lowercase hex', { field: 'package.sha256' }));
    }
    if (!Number.isInteger(pkg.size) || pkg.size < 1 || pkg.size > LIMITS.packageBytes) {
      errors.push(regError('E_REGISTRY_FIELD_RANGE', 'package.size is out of range', { field: 'package.size' }));
    }
    if (!isIsoDate(pkg.releasedAt)) {
      errors.push(regError('E_REGISTRY_FIELD_RANGE', 'package.releasedAt must be an ISO timestamp', {
        field: 'package.releasedAt',
      }));
    }
    const urlResult = validatePackageUrl(pkg.url, {
      id: game.id,
      version: game.version,
      sourceType: options.sourceType,
      sourceUrl: options.sourceUrl,
      allowedHosts: options.allowedHosts,
    });
    if (!urlResult.ok) {
      errors.push(regError('E_REGISTRY_INVALID', urlResult.message, { field: 'package.url' }));
    }
  }

  // Preview assets are Registry-only in V1 (packages are single-file).
  // `cover` is required for listing; `icon`/`screenshots` are optional.
  if (game.cover === undefined) {
    errors.push(regError('E_REGISTRY_FIELD_MISSING', 'cover is required for a listed game', { field: 'cover' }));
  } else {
    checkPreviewAsset(errors, game.cover, 'cover');
  }
  if (game.icon !== undefined) checkPreviewAsset(errors, game.icon, 'icon');
  if (game.screenshots !== undefined) {
    if (!Array.isArray(game.screenshots) || game.screenshots.length > 5) {
      errors.push(regError('E_REGISTRY_FIELD_RANGE', 'screenshots must be an array of <= 5 items', {
        field: 'screenshots',
      }));
    } else {
      game.screenshots.forEach((item, index) => checkPreviewAsset(errors, item, `screenshots[${index}]`));
    }
  }

  for (const field of ['homepage', 'repository']) {
    if (game[field] !== undefined) checkHttpsUrl(errors, game[field], field);
  }
  if (game.license !== undefined && (typeof game.license !== 'string' || !LICENSE_RE.test(game.license))) {
    errors.push(regError('E_REGISTRY_FIELD_RANGE', 'license must be an SPDX-like identifier', { field: 'license' }));
  }
  if (game.changelog !== undefined && (typeof game.changelog !== 'string' || codePointLength(game.changelog) > 2000)) {
    errors.push(regError('E_REGISTRY_FIELD_RANGE', 'changelog must be <= 2000 characters', { field: 'changelog' }));
  }
  for (const field of ['featured', 'quickPlay']) {
    if (game[field] !== undefined && typeof game[field] !== 'boolean') {
      errors.push(regError('E_REGISTRY_FIELD_TYPE', `${field} must be a boolean`, { field }));
    }
  }
  for (const field of ['publishedAt', 'updatedAt']) {
    if (!isIsoDate(game[field])) {
      errors.push(regError('E_REGISTRY_FIELD_RANGE', `${field} must be an ISO timestamp`, { field }));
    }
  }

  const known = new Set([
    'id', 'name', 'version', 'description', 'author', 'categories', 'tags', 'capabilities',
    'sdkVersion', 'runtimeVersion', 'preferredTheme', 'package', 'icon', 'cover', 'screenshots',
    'homepage', 'repository', 'license', 'changelog', 'featured', 'quickPlay', 'publishedAt',
    'updatedAt',
  ]);
  for (const key of Object.keys(game)) {
    if (known.has(key)) continue;
    warnings.push({ code: 'W_REGISTRY_UNKNOWN_FIELD', message: `unknown registry field: ${key}`, field: key });
  }

  return { ok: errors.length === 0, errors, warnings, game };
}

function checkPreviewAsset(errors, value, field) {
  // V1 Registry preview assets are absolute https URLs; the Host downloads and
  // caches them (PRD §8.8.1/§8.8.2). Packages themselves carry no images except
  // the manifest `icon` data URI.
  if (typeof value !== 'string' || value.length > 1000 || !HTTPS_RE.test(value)) {
    errors.push(regError('E_REGISTRY_FIELD_RANGE', `${field} must be an absolute https URL`, { field }));
  }
}

/** Host names allowed to serve packages/previews (PRD §8.8.2 + D-035). */
export function allowedHostSet(options = {}) {
  const hosts = new Set((options.allowedHosts || DEFAULT_ALLOWED_HOSTS).map((host) => String(host).toLowerCase()));
  if (options.sourceUrl) {
    try {
      const parsed = new URL(options.sourceUrl);
      hosts.add(parsed.hostname.toLowerCase());
    } catch (_error) {
      // A file path source has no host; relative package URLs cover it.
    }
  }
  return hosts;
}

export function isAllowedHost(hostname, options = {}) {
  if (typeof hostname !== 'string' || hostname.length === 0) return false;
  return allowedHostSet(options).has(hostname.toLowerCase());
}

/**
 * Validate a package URL against the Registry source.
 * - https Registry: absolute https URL on an allowed host, or a relative URL
 *   resolved against the index (same host rule still applies);
 * - file Registry: relative path inside the Registry directory only.
 * In all cases the last path segment must be `<id>-<version>.html`.
 *
 * @returns {{ok:boolean, url:string|null, message:string}}
 */
export function validatePackageUrl(value, options = {}) {
  const id = options.id;
  const version = options.version;
  const sourceType = options.sourceType || 'https';
  if (typeof value !== 'string' || value.length === 0 || value.length > 1000) {
    return { ok: false, url: null, message: 'package.url must be a non-empty string' };
  }
  const expectedFile = packageFileName(id, version);

  if (sourceType === 'file') {
    if (!RELATIVE_PACKAGE_RE.test(value)) {
      return { ok: false, url: null, message: 'file registry packages must use a safe relative path' };
    }
    const fileName = value.split('/').pop();
    if (fileName !== expectedFile) {
      return { ok: false, url: null, message: `package file name must be ${expectedFile}` };
    }
    return { ok: true, url: value, message: 'ok' };
  }

  let absolute;
  try {
    absolute = new URL(value, options.sourceUrl || undefined);
  } catch (_error) {
    return { ok: false, url: null, message: 'package.url is not a valid URL' };
  }
  if (absolute.protocol !== 'https:') {
    return { ok: false, url: null, message: 'package.url must use https' };
  }
  if (absolute.username || absolute.password) {
    return { ok: false, url: null, message: 'package.url must not contain credentials' };
  }
  const fileName = absolute.pathname.split('/').pop();
  if (fileName !== expectedFile) {
    return { ok: false, url: null, message: `package file name must be ${expectedFile}` };
  }
  if (!isAllowedHost(absolute.hostname, options)) {
    return { ok: false, url: null, message: `package host is not allowed: ${absolute.hostname}` };
  }
  return { ok: true, url: absolute.toString(), message: 'ok' };
}

/**
 * Validate a Registry index document.
 * @param {unknown} input parsed JSON
 * @param {{sourceType?:'https'|'file', sourceUrl?:string, allowedHosts?:string[]}} [options]
 */
export function validateRegistry(input, options = {}) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(input)) {
    return {
      ok: false,
      registry: null,
      errors: [regError('E_REGISTRY_INVALID', 'registry must be a JSON object')],
      warnings,
    };
  }
  if (input.registryVersion !== REGISTRY_VERSION) {
    errors.push(regError('E_REGISTRY_INVALID', 'registryVersion must be 1', { field: 'registryVersion' }));
  }
  if (!isIsoDate(input.generatedAt)) {
    errors.push(regError('E_REGISTRY_INVALID', 'generatedAt must be an ISO timestamp', { field: 'generatedAt' }));
  }
  if (input.truncated !== undefined && typeof input.truncated !== 'boolean') {
    errors.push(regError('E_REGISTRY_INVALID', 'truncated must be a boolean', { field: 'truncated' }));
  }
  if (!Array.isArray(input.games)) {
    errors.push(regError('E_REGISTRY_INVALID', 'games must be an array', { field: 'games' }));
    return { ok: false, registry: null, errors, warnings };
  }
  if (input.games.length > REGISTRY_GAMES_MAX) {
    errors.push(regError('E_REGISTRY_INVALID', `registry has more than ${REGISTRY_GAMES_MAX} games`, { field: 'games' }));
  }

  const seen = new Set();
  const games = [];
  input.games.forEach((entry, index) => {
    const result = validateRegistryGame(entry, { ...options, id: entry && entry.id, version: entry && entry.version });
    errors.push(...result.errors.map((error) => ({ ...error, index })));
    warnings.push(...result.warnings.map((warning) => ({ ...warning, index })));
    if (entry && typeof entry.id === 'string') {
      if (seen.has(entry.id)) {
        errors.push(regError('E_REGISTRY_INVALID', `duplicate game id: ${entry.id}`, { field: 'games', index }));
      }
      seen.add(entry.id);
    }
    games.push(entry);
  });

  return {
    ok: errors.length === 0,
    registry: errors.length === 0 ? { registryVersion: REGISTRY_VERSION, generatedAt: input.generatedAt, games, ...(input.truncated === true ? { truncated: true } : {}) } : null,
    errors,
    warnings,
  };
}

/** Validate `registry-cache.json` (PRD §8.8.3). */
export function validateRegistryCache(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [regError('E_REGISTRY_INVALID', 'registry cache must be a JSON object')], cache: null };
  }
  if (input.schemaVersion !== REGISTRY_CACHE_SCHEMA_VERSION) {
    errors.push(regError('E_REGISTRY_INVALID', 'schemaVersion must be 1', { field: 'schemaVersion' }));
  }
  if (!isIsoDate(input.fetchedAt)) {
    errors.push(regError('E_REGISTRY_INVALID', 'fetchedAt must be an ISO timestamp', { field: 'fetchedAt' }));
  }
  if (typeof input.sourceUrl !== 'string' || input.sourceUrl.length === 0) {
    errors.push(regError('E_REGISTRY_INVALID', 'sourceUrl is required', { field: 'sourceUrl' }));
  }
  for (const field of ['etag', 'lastModified']) {
    if (input[field] !== undefined && input[field] !== null && typeof input[field] !== 'string') {
      errors.push(regError('E_REGISTRY_INVALID', `${field} must be a string or null`, { field }));
    }
  }
  if (typeof input.truncated !== 'boolean') {
    errors.push(regError('E_REGISTRY_INVALID', 'truncated must be a boolean', { field: 'truncated' }));
  }
  if (!Array.isArray(input.games)) {
    errors.push(regError('E_REGISTRY_INVALID', 'games must be an array', { field: 'games' }));
  }
  return { ok: errors.length === 0, errors, cache: errors.length === 0 ? input : null };
}

/** True when a Registry game needs a different package file than the installed one. */
export function isUpdateAvailable(registryVersion, installedVersion) {
  if (typeof registryVersion !== 'string' || typeof installedVersion !== 'string') return false;
  return registryVersion !== installedVersion;
}

/** Human-readable host for diagnostics (no URLs with credentials). */
export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_error) {
    return null;
  }
}

export { packageFileName };
