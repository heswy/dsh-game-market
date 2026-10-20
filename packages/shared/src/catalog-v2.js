/**
 * V1.5 two-generation catalog / registry (docs/V1.5-CONTRACTS.md §5).
 *
 * One reviewed source of truth (`catalog/<id>.json`, schemaVersion 2) projects
 * into two registry indexes:
 *   - v1: `/registry/games.json`            — html-v1 only, V1 schema unchanged
 *   - v2: `/registry/v2/games.json`         — html-v1 | asset-zip-v2, format explicit
 *
 * The projection is deliberately asymmetric: v1 keeps the newest *HTML* release
 * rather than a degraded form of the newest release, so an old client can still
 * install something that really exists (§5.5 rationale).
 *
 * Pure JS: shared by the Host (reading both indexes), the content tooling
 * (generating them) and the tests.
 */

import {
  LIMITS,
  PACKAGE_FORMATS,
  REGISTRY_CACHE_V2_FILE,
  REGISTRY_CACHE_V2_SCHEMA_VERSION,
  REGISTRY_V2_VERSION,
} from './constants.js';
import { validateRegistryGame } from './registry.js';
import { codePointCompare } from './package-v2.js';

export const CATALOG_V2_SCHEMA_VERSION = 2;
export const REGISTRY_V2_BYTES_MAX = LIMITS.registryBytes;
export const REGISTRY_V2_GAMES_MAX = LIMITS.registryGames;

const SHA256_RE = /^[a-f0-9]{64}$/;
const SOURCE_COMMIT_RE = /^[a-f0-9]{7,40}$/;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function regError(code, message, extra) {
  return { code, message, ...(extra === undefined ? {} : extra) };
}

function checkString(errors, value, field, { max = 200, min = 1 } = {}) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    errors.push(regError('E_CATALOG_INVALID', `${field} must be a string of ${min}..${max} characters`, { field }));
    return false;
  }
  return true;
}

function checkAbsoluteUrl(errors, value, field, code = 'E_CATALOG_INVALID') {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    errors.push(regError(code, `${field} must be a URL`, { field }));
    return false;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      errors.push(regError(code, `${field} must be https`, { field }));
      return false;
    }
    return true;
  } catch {
    errors.push(regError(code, `${field} must be a valid URL`, { field }));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Catalog v2 (§5.5)
// ---------------------------------------------------------------------------

/**
 * Validate one `catalog/<id>.json` in the V1.5 shape.
 *
 * @param {unknown} input Parsed catalog JSON.
 * @param {{gameId?: string}} [options]
 * @returns {{ok:boolean, catalog:object|null, errors:object[]}}
 */
export function validateCatalogV2(input, options = {}) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, catalog: null, errors: [regError('E_CATALOG_INVALID', 'catalog must be a JSON object')] };
  }
  if (input.schemaVersion !== CATALOG_V2_SCHEMA_VERSION) {
    errors.push(regError('E_CATALOG_INVALID', 'schemaVersion must be 2', { field: 'schemaVersion' }));
  }
  const expectedGameId = options.gameId;
  if (!checkString(errors, input.gameId, 'gameId', { max: 48 })) {
    // keep going: a bad id should not hide the release errors below
  } else if (expectedGameId !== undefined && input.gameId !== expectedGameId) {
    errors.push(regError('E_CATALOG_INVALID', 'gameId does not match its file name', { field: 'gameId' }));
  }

  if (!isPlainObject(input.owner)) {
    errors.push(regError('E_CATALOG_INVALID', 'owner must be an object', { field: 'owner' }));
  } else {
    if (!LOGIN_RE.test(String(input.owner.login ?? ''))) {
      errors.push(regError('E_CATALOG_INVALID', 'owner.login is invalid', { field: 'owner.login' }));
    }
    if (!Number.isSafeInteger(input.owner.githubUserId) || input.owner.githubUserId < 1) {
      errors.push(regError('E_CATALOG_INVALID', 'owner.githubUserId is invalid', { field: 'owner.githubUserId' }));
    }
  }

  if (!isIsoDate(input.createdAt)) {
    errors.push(regError('E_CATALOG_INVALID', 'createdAt must be an ISO timestamp', { field: 'createdAt' }));
  }
  if (!isIsoDate(input.updatedAt)) {
    errors.push(regError('E_CATALOG_INVALID', 'updatedAt must be an ISO timestamp', { field: 'updatedAt' }));
  }
  if (input.withdrawnAt !== undefined && input.withdrawnAt !== null && !isIsoDate(input.withdrawnAt)) {
    errors.push(regError('E_CATALOG_INVALID', 'withdrawnAt must be an ISO timestamp or null', { field: 'withdrawnAt' }));
  }

  if (!Array.isArray(input.releases)) {
    return { ok: false, catalog: null, errors: [...errors, regError('E_CATALOG_INVALID', 'releases must be an array', { field: 'releases' })] };
  }
  if (input.releases.length === 0) {
    errors.push(regError('E_CATALOG_INVALID', 'releases must not be empty', { field: 'releases' }));
  }

  const seenVersions = new Set();
  const releases = [];
  input.releases.forEach((release, index) => {
    const field = `releases[${index}]`;
    if (!isPlainObject(release)) {
      errors.push(regError('E_CATALOG_INVALID', 'release must be an object', { field }));
      return;
    }
    if (!checkString(errors, release.version, `${field}.version`, { max: 64 })) return;
    if (seenVersions.has(release.version)) {
      errors.push(regError('E_CATALOG_INVALID', `duplicate release version: ${release.version}`, { field }));
    }
    seenVersions.add(release.version);

    if (!PACKAGE_FORMATS.includes(release.format)) {
      errors.push(regError('E_CATALOG_INVALID', 'release.format must be html-v1 or asset-zip-v2', { field: `${field}.format` }));
    }
    checkString(errors, release.tag, `${field}.tag`, { max: 120 });
    if (!isIsoDate(release.releasedAt)) {
      errors.push(regError('E_CATALOG_INVALID', 'releasedAt must be an ISO timestamp', { field: `${field}.releasedAt` }));
    }
    if (typeof release.sourceCommit !== 'string' || !SOURCE_COMMIT_RE.test(release.sourceCommit)) {
      errors.push(regError('E_CATALOG_INVALID', 'sourceCommit must be 7..40 lowercase hex', { field: `${field}.sourceCommit` }));
    }
    if (typeof release.reviewSha256 !== 'string' || !SHA256_RE.test(release.reviewSha256)) {
      errors.push(regError('E_CATALOG_INVALID', 'reviewSha256 must be a sha256 hex', { field: `${field}.reviewSha256` }));
    }

    if (!isPlainObject(release.package)) {
      errors.push(regError('E_CATALOG_INVALID', 'release.package must be an object', { field: `${field}.package` }));
    } else {
      checkAbsoluteUrl(errors, release.package.url, `${field}.package.url`);
      if (typeof release.package.sha256 !== 'string' || !SHA256_RE.test(release.package.sha256)) {
        errors.push(regError('E_CATALOG_INVALID', 'package.sha256 must be a sha256 hex', { field: `${field}.package.sha256` }));
      }
      const sizeLimit = release.format === 'asset-zip-v2' ? LIMITS.zip.zipOuterBytes : LIMITS.packageBytes;
      if (!Number.isSafeInteger(release.package.size) || release.package.size < 1 || release.package.size > sizeLimit) {
        errors.push(regError('E_CATALOG_INVALID', 'package.size is out of range', { field: `${field}.package.size` }));
      }
      if (release.format === 'asset-zip-v2') {
        if (release.package.filesDigest !== undefined && (typeof release.package.filesDigest !== 'string' || !SHA256_RE.test(release.package.filesDigest))) {
          errors.push(regError('E_CATALOG_INVALID', 'package.filesDigest must be a sha256 hex', { field: `${field}.package.filesDigest` }));
        }
      }
    }

    if (!isPlainObject(release.media)) {
      errors.push(regError('E_CATALOG_INVALID', 'release.media must be an object', { field: `${field}.media` }));
    } else {
      if (!isPlainObject(release.media.cover)) {
        errors.push(regError('E_CATALOG_INVALID', 'release.media.cover must be an object', { field: `${field}.media.cover` }));
      } else {
        checkAbsoluteUrl(errors, release.media.cover.url, `${field}.media.cover.url`);
      }
      if (!Array.isArray(release.media.screenshots) || release.media.screenshots.length < 1 || release.media.screenshots.length > 5) {
        errors.push(regError('E_CATALOG_INVALID', 'release.media.screenshots must have 1..5 items', { field: `${field}.media.screenshots` }));
      }
    }

    releases.push(release);
  });

  if (errors.length > 0) return { ok: false, catalog: null, errors };
  return { ok: true, catalog: input, errors: [] };
}

/**
 * Upgrade a V1 catalog (single `release`) to the V2 shape in memory.
 *
 * Existing content repositories are schemaVersion 1; the generator must read
 * them without a flag day. This never writes anything back — it only lets one
 * projection implementation serve both.
 *
 * @param {object} catalog V1 catalog entry.
 * @returns {object|null} V2-shaped catalog, or null when not derivable.
 */
export function upgradeCatalogV1ToV2(catalog) {
  if (!isPlainObject(catalog) || !isPlainObject(catalog.release) || !isPlainObject(catalog.game)) return null;
  const v1 = catalog.release;
  const game = catalog.game;
  // A V1 catalog stores the id and the author at the TOP level; V2 moves them
  // into `gameId` / `owner` / `game.author`. Accept both spellings so an
  // existing content repository needs no flag day.
  const gameId = catalog.gameId ?? game.id;
  const v1Author = isPlainObject(catalog.author) ? catalog.author : null;
  const owner = isPlainObject(catalog.owner) ? catalog.owner : {
    login: v1Author?.login ?? v1Author?.name ?? 'unknown',
    githubUserId: Number.isSafeInteger(v1Author?.githubUserId) ? v1Author.githubUserId : 1,
  };
  const version = game.version ?? v1.version;
  return {
    schemaVersion: CATALOG_V2_SCHEMA_VERSION,
    gameId,
    owner,
    game: {
      ...game,
      id: gameId,
      // `releaseToRegistryGame` reads `game.author`; V1 keeps it at the top.
      author: isPlainObject(game.author) ? game.author : { name: v1Author?.name ?? owner.login },
      publishedAt: game.publishedAt ?? catalog.publishedAt ?? v1.releasedAt,
    },
    releases: [{
      version,
      format: 'html-v1',
      tag: v1.tag,
      package: {
        url: v1.packageUrl,
        sha256: v1.packageSha256,
        size: v1.packageSize,
      },
      media: {
        cover: v1.cover,
        screenshots: Array.isArray(v1.screenshots) ? v1.screenshots : [],
      },
      sourceCommit: typeof v1.sourceCommit === 'string'
        ? v1.sourceCommit
        : (typeof catalog.source?.commit === 'string' ? catalog.source.commit : '0000000'),
      reviewSha256: typeof v1.reviewSha256 === 'string' ? v1.reviewSha256 : '0'.repeat(64),
      releasedAt: v1.releasedAt,
    }],
    withdrawnAt: catalog.withdrawnAt ?? null,
    createdAt: catalog.createdAt ?? v1.releasedAt,
    updatedAt: catalog.updatedAt ?? catalog.publishedAt ?? v1.releasedAt,
  };
}

/** Compare two strict semver subset versions (same rules as the Host's). */
function compareVersion(a, b) {
  const pa = String(a).split('-')[0].split('.').map(Number);
  const pb = String(b).split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // A prerelease sorts before its release; the Registry only publishes releases.
  return 0;
}

/**
 * Pick the release each generation should project (§5.5 projection algorithm).
 *
 * @param {object} catalog V2 catalog.
 * @returns {{v1: object|null, v2: object|null}} Projected releases.
 */
export function selectProjectedReleases(catalog) {
  if (!isPlainObject(catalog)) return { v1: null, v2: null };
  if (catalog.withdrawnAt !== undefined && catalog.withdrawnAt !== null) return { v1: null, v2: null };
  const active = Array.isArray(catalog.releases) ? catalog.releases : [];
  let newestAny = null;
  let newestHtml = null;
  for (const release of active) {
    if (newestAny === null || compareVersion(release.version, newestAny.version) > 0) newestAny = release;
    if (release.format === 'html-v1' && (newestHtml === null || compareVersion(release.version, newestHtml.version) > 0)) {
      newestHtml = release;
    }
  }
  return { v1: newestHtml, v2: newestAny };
}

/** Project one catalog release into a registry game entry for the given generation. */
export function releaseToRegistryGame(catalog, release, generation) {
  const game = isPlainObject(catalog.game) ? catalog.game : {};
  const base = {
    id: game.id,
    name: game.name,
    version: release.version,
    description: game.description,
    author: game.author,
    categories: game.categories,
    tags: Array.isArray(game.tags) ? game.tags : [],
    capabilities: Array.isArray(game.capabilities) ? game.capabilities : [],
    sdkVersion: game.sdkVersion,
    runtimeVersion: game.runtimeVersion,
    package: {
      url: release.package.url,
      sha256: release.package.sha256,
      size: release.package.size,
      releasedAt: release.releasedAt,
    },
    cover: release.media.cover.url,
    screenshots: release.media.screenshots.map((shot) => shot.url),
    publishedAt: game.publishedAt ?? release.releasedAt,
    updatedAt: release.releasedAt,
  };
  if (generation === 'v2') {
    base.package.format = release.format;
    if (typeof release.package.filesDigest === 'string') base.package.filesDigest = release.package.filesDigest;
  }
  return base;
}

/**
 * Project a set of V2 catalogs into both registry indexes (§5.5 step 1–5).
 *
 * Deterministic: games are sorted by `id` (code point order) and `generatedAt`
 * is the largest fixed timestamp in the sources, never the build clock, so the
 * same inputs always produce byte-identical files.
 *
 * @param {object[]} catalogs V2 catalogs (or V1 catalogs; upgraded in memory).
 * @param {{gamesBytesLimit?:number, gamesLimit?:number}} [options]
 * @returns {{ok:boolean, errors:object[], v1:object|null, v2:object|null}}
 */
export function projectRegistryEntries(catalogs, options = {}) {
  const errors = [];
  if (!Array.isArray(catalogs)) {
    return { ok: false, errors: [regError('E_CATALOG_INVALID', 'catalogs must be an array')], v1: null, v2: null };
  }
  const gamesLimit = options.gamesLimit ?? REGISTRY_V2_GAMES_MAX;

  const v1Games = [];
  const v2Games = [];
  let generatedAt = null;
  const seenIds = new Set();

  for (const raw of catalogs) {
    const upgraded = raw && raw.schemaVersion === 1 ? upgradeCatalogV1ToV2(raw) : raw;
    const result = validateCatalogV2(upgraded);
    if (!result.ok) {
      errors.push(...result.errors.map((error) => ({ ...error, catalog: upgraded && upgraded.gameId })));
      continue;
    }
    const catalog = result.catalog;
    if (seenIds.has(catalog.gameId)) {
      errors.push(regError('E_CATALOG_INVALID', `duplicate catalog gameId: ${catalog.gameId}`, { field: 'gameId' }));
      continue;
    }
    seenIds.add(catalog.gameId);

    for (const stamp of [catalog.createdAt, catalog.updatedAt, ...catalog.releases.map((release) => release.releasedAt)]) {
      if (isIsoDate(stamp) && (generatedAt === null || stamp > generatedAt)) generatedAt = stamp;
    }

    const projected = selectProjectedReleases(catalog);
    if (projected.v1 !== null) v1Games.push(releaseToRegistryGame(catalog, projected.v1, 'v1'));
    if (projected.v2 !== null) v2Games.push(releaseToRegistryGame(catalog, projected.v2, 'v2'));
  }

  if (errors.length > 0) return { ok: false, errors, v1: null, v2: null };
  if (v1Games.length > gamesLimit || v2Games.length > gamesLimit) {
    return { ok: false, errors: [regError('E_REGISTRY_V2_INVALID', `more than ${gamesLimit} games in a generation`)], v1: null, v2: null };
  }

  const stamp = generatedAt ?? '1970-01-01T00:00:00.000Z';
  const sortById = (left, right) => codePointCompare(left.id, right.id);
  const v1 = v1Games.length === 0 ? null : { registryVersion: 1, generatedAt: stamp, games: v1Games.sort(sortById) };
  const v2 = v2Games.length === 0 ? null : { registryVersion: REGISTRY_V2_VERSION, generatedAt: stamp, games: v2Games.sort(sortById) };
  return { ok: true, errors: [], v1, v2 };
}

// ---------------------------------------------------------------------------
// Registry v2 index (§5.2)
// ---------------------------------------------------------------------------

/**
 * Validate `/registry/v2/games.json`.
 *
 * Every entry's `package.format` is mandatory so a v2 client never has to guess;
 * one bad entry rejects the whole index (§5.2), which keeps a partial catalog
 * from silently hiding games.
 *
 * @param {unknown} input Parsed index JSON.
 * @param {{sourceType?:string, sourceUrl?:string, allowedHosts?:string[]}} [options]
 * @returns {{ok:boolean, registry:object|null, errors:object[], warnings:object[]}}
 */
export function validateRegistryV2(input, options = {}) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(input)) {
    return { ok: false, registry: null, errors: [regError('E_REGISTRY_V2_INVALID', 'registry must be a JSON object')], warnings };
  }
  if (input.registryVersion !== REGISTRY_V2_VERSION) {
    errors.push(regError('E_REGISTRY_V2_INVALID', 'registryVersion must be 2', { field: 'registryVersion' }));
  }
  if (!isIsoDate(input.generatedAt)) {
    errors.push(regError('E_REGISTRY_V2_INVALID', 'generatedAt must be an ISO timestamp', { field: 'generatedAt' }));
  }
  if (input.truncated !== undefined && typeof input.truncated !== 'boolean') {
    errors.push(regError('E_REGISTRY_V2_INVALID', 'truncated must be a boolean', { field: 'truncated' }));
  }
  if (!Array.isArray(input.games)) {
    errors.push(regError('E_REGISTRY_V2_INVALID', 'games must be an array', { field: 'games' }));
    return { ok: false, registry: null, errors, warnings };
  }
  if (input.games.length > REGISTRY_V2_GAMES_MAX) {
    errors.push(regError('E_REGISTRY_V2_INVALID', `registry has more than ${REGISTRY_V2_GAMES_MAX} games`, { field: 'games' }));
  }

  const seen = new Set();
  const games = [];
  input.games.forEach((entry, index) => {
    // Reuse the V1 field rules: a v2 entry is a V1 entry plus `package.format`.
    const result = validateRegistryGame(entry, {
      ...options,
      id: entry && entry.id,
      version: entry && entry.version,
    });
    errors.push(...result.errors.map((error) => ({ ...error, index })));
    warnings.push(...result.warnings.map((warning) => ({ ...warning, index })));

    const format = entry && isPlainObject(entry.package) ? entry.package.format : undefined;
    if (!PACKAGE_FORMATS.includes(format)) {
      errors.push(regError('E_REGISTRY_V2_INVALID', 'package.format is required in a v2 index', { field: 'package.format', index }));
    }
    if (entry && typeof entry.id === 'string') {
      if (seen.has(entry.id)) {
        errors.push(regError('E_REGISTRY_V2_INVALID', `duplicate game id: ${entry.id}`, { field: 'games', index }));
      }
      seen.add(entry.id);
    }
    games.push(entry);
  });

  return {
    ok: errors.length === 0,
    registry: errors.length === 0
      ? {
        registryVersion: REGISTRY_V2_VERSION,
        generatedAt: input.generatedAt,
        games,
        ...(input.truncated === true ? { truncated: true } : {}),
      }
      : null,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Registry v2 cache (§5.3)
// ---------------------------------------------------------------------------

/**
 * Validate `registry-cache-v2.json`.
 *
 * The v1 cache file must never be reused for v2: the schema tag and the
 * `registryVersion` are both checked, so a v1 cache is treated as "no cache"
 * rather than as a stale v2 catalog.
 *
 * @param {unknown} input Parsed cache JSON.
 * @param {{sourceUrl?:string}} [options]
 * @returns {{ok:boolean, cache:object|null, errors:object[]}}
 */
export function validateRegistryCacheV2(input, options = {}) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [regError('E_REGISTRY_V2_INVALID', 'registry cache must be a JSON object')], cache: null };
  }
  if (input.schemaVersion !== REGISTRY_CACHE_V2_SCHEMA_VERSION) {
    errors.push(regError('E_REGISTRY_V2_INVALID', `schemaVersion must be ${REGISTRY_CACHE_V2_SCHEMA_VERSION}`, { field: 'schemaVersion' }));
  }
  if (input.registryVersion !== REGISTRY_V2_VERSION) {
    errors.push(regError('E_REGISTRY_V2_INVALID', 'registryVersion must be 2', { field: 'registryVersion' }));
  }
  if (!isIsoDate(input.fetchedAt)) {
    errors.push(regError('E_REGISTRY_V2_INVALID', 'fetchedAt must be an ISO timestamp', { field: 'fetchedAt' }));
  }
  if (typeof input.sourceUrl !== 'string' || input.sourceUrl.length === 0) {
    errors.push(regError('E_REGISTRY_V2_INVALID', 'sourceUrl is required', { field: 'sourceUrl' }));
  } else if (options.sourceUrl !== undefined && input.sourceUrl !== options.sourceUrl) {
    errors.push(regError('E_REGISTRY_V2_INVALID', 'cached sourceUrl does not match the configured source', { field: 'sourceUrl' }));
  }
  for (const field of ['etag', 'lastModified']) {
    if (input[field] !== undefined && input[field] !== null && typeof input[field] !== 'string') {
      errors.push(regError('E_REGISTRY_V2_INVALID', `${field} must be a string or null`, { field }));
    }
  }
  if (typeof input.truncated !== 'boolean') {
    errors.push(regError('E_REGISTRY_V2_INVALID', 'truncated must be a boolean', { field: 'truncated' }));
  }
  if (!Array.isArray(input.games)) {
    errors.push(regError('E_REGISTRY_V2_INVALID', 'games must be an array', { field: 'games' }));
  }
  return { ok: errors.length === 0, errors, cache: errors.length === 0 ? input : null };
}

/** File name the Host writes its v2 cache under (§5.3). */
export function registryCacheV2FileName() {
  return REGISTRY_CACHE_V2_FILE;
}
