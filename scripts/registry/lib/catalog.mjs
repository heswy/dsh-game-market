/**
 * Content-repository catalog pipeline (V1.2 community publishing MVP +
 * V1.5 two-generation Registry, docs/V1.5-CONTRACTS.md §5).
 *
 * The content repo only stores per-game source records (`catalog/<id>.json`),
 * ownership (`owners/<id>.json`) and review records (`reviews/<id>/<version>.json`).
 * Both runtime indexes are generated from those sources and must be committed in
 * the same PR; CI verifies they are fresh.
 *
 * Two catalog shapes are read:
 *   - `schemaVersion: 1` (V1.2, single `release`) — upgraded in memory through
 *     the shared `upgradeCatalogV1ToV2`, so one projection implementation serves
 *     both without a flag day;
 *   - `schemaVersion: 2` (V1.5, append-only `releases[]` + `withdrawnAt`).
 *
 * The projection itself (newest release for v2; newest **HTML** release for v1;
 * withdrawal removes both; deterministic `generatedAt`) is the shared
 * `projectRegistryEntries` implementation from `packages/shared/src/catalog-v2.js`
 * — the scripts never keep a second copy of those rules.
 *
 * Pure Node built-ins; no npm install.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_OFFICIAL_REGISTRY_URL,
  DEFAULT_OFFICIAL_REGISTRY_V2_URL,
  REGISTRY_V2_VERSION,
} from '../../../packages/shared/src/constants.js';
import { compareVersions } from '../../../packages/host/src/semver.js';
import {
  CATALOG_SCHEMA_VERSION,
  OWNER_SCHEMA_VERSION,
  catalogEntryFromSubmission,
  generateRegistryIndex,
  validateCatalogEntry,
  validateOwner,
  validateReview,
} from '../../../packages/shared/src/community.js';
import { validateRegistry } from '../../../packages/shared/src/registry.js';
import {
  projectRegistryEntries,
  selectProjectedReleases,
  upgradeCatalogV1ToV2,
  validateCatalogV2,
  validateRegistryV2,
} from '../../../packages/shared/src/catalog-v2.js';
import { resolveMediaBinding } from './media.mjs';

export const REGISTRY_DIRS = Object.freeze({
  catalog: 'catalog',
  owners: 'owners',
  reviews: 'reviews',
  registry: 'registry',
});
/** Root-relative paths of the two generated indexes (§5.1/§5.2). */
export const REGISTRY_FILE = 'registry/games.json';
export const REGISTRY_V2_FILE = 'registry/v2/games.json';
/** Shared projection helper re-exported for callers that only need the module. */
export { CATALOG_SCHEMA_VERSION, OWNER_SCHEMA_VERSION, REGISTRY_V2_VERSION };

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** Package format implied by a package URL's file name (§1.2), or null. */
export function classifyPackageFormat(url) {
  if (typeof url !== 'string') return null;
  const pathname = url.split('?')[0];
  if (pathname.endsWith('.dshgame.zip')) return 'asset-zip-v2';
  if (pathname.endsWith('.html')) return 'html-v1';
  return null;
}

export async function readJson(file) {
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function listFiles(directory, extension) {
  let names;
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
  return names.filter((name) => name.endsWith(extension) && !name.startsWith('.')).sort();
}

function formatErrors(errors, prefix = '') {
  return errors.map((item) => ({
    ...item,
    field: prefix ? `${prefix}.${item.field}` : item.field,
  }));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

// ---------------------------------------------------------------------------
// Source loading
// ---------------------------------------------------------------------------

/** Load and validate `catalog/*.json`, accepting both schema versions. */
async function loadEntries(root) {
  const directory = path.join(root, REGISTRY_DIRS.catalog);
  const files = await listFiles(directory, '.json');
  const entries = [];
  const errors = [];
  for (const file of files) {
    const expectedId = file.slice(0, -'.json'.length);
    let parsed;
    try {
      parsed = await readJson(path.join(directory, file));
    } catch (error) {
      errors.push({ code: 'E_CATALOG_JSON', field: `catalog/${file}`, message: `invalid JSON: ${error.message}` });
      continue;
    }
    const schemaVersion = isPlainObject(parsed) ? parsed.schemaVersion : undefined;
    if (schemaVersion === 2) {
      const validation = validateCatalogV2(parsed, { gameId: expectedId });
      if (!validation.ok) {
        errors.push(...formatErrors(validation.errors, `catalog/${file}`));
        continue;
      }
      entries.push({ file, entry: parsed, schemaVersion: 2, digest: sha256(JSON.stringify(parsed)) });
      continue;
    }
    // Legacy (V1.2) catalog: the V1 validator stays authoritative for this shape.
    const validation = validateCatalogEntry(parsed, { gameId: expectedId });
    if (!validation.ok) {
      errors.push(...formatErrors(validation.errors, `catalog/${file}`));
      continue;
    }
    entries.push({ file, entry: parsed, schemaVersion: 1, digest: sha256(JSON.stringify(parsed)) });
  }
  return { entries, files, errors };
}

async function loadOwners(root) {
  const directory = path.join(root, REGISTRY_DIRS.owners);
  const files = await listFiles(directory, '.json');
  const owners = new Map();
  const errors = [];
  for (const file of files) {
    const expectedId = file.slice(0, -'.json'.length);
    let parsed;
    try {
      parsed = await readJson(path.join(directory, file));
    } catch (error) {
      errors.push({ code: 'E_OWNER_JSON', field: `owners/${file}`, message: `invalid JSON: ${error.message}` });
      continue;
    }
    const validation = validateOwner(parsed, { gameId: expectedId });
    if (!validation.ok) {
      errors.push(...formatErrors(validation.errors, `owners/${file}`));
      continue;
    }
    owners.set(expectedId, parsed);
  }
  return { owners, errors };
}

/** Load the stored review for one V1 catalog entry and bind it to the published bytes. */
export async function loadReviewForEntry(root, entry, fileLabel) {
  const file = path.join(root, REGISTRY_DIRS.reviews, entry.gameId, `${entry.game.version}.json`);
  const relative = `reviews/${entry.gameId}/${entry.game.version}.json`;
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { review: null, digest: null, errors: [{ code: 'E_REVIEW_MISSING', field: relative, message: 'approved review record is missing' }] };
    }
    return { review: null, digest: null, errors: [{ code: 'E_REVIEW_JSON', field: relative, message: `invalid JSON: ${error.message}` }] };
  }
  let review;
  try {
    review = JSON.parse(raw);
  } catch (error) {
    return { review: null, digest: null, errors: [{ code: 'E_REVIEW_JSON', field: relative, message: `invalid JSON: ${error.message}` }] };
  }
  const digest = sha256(raw);
  const errors = [];
  const validation = validateReview(review);
  if (!validation.ok) errors.push(...formatErrors(validation.errors, relative));
  if (validation.ok) {
    if (review.gameId !== entry.gameId || review.version !== entry.game.version) {
      errors.push({ code: 'E_REVIEW_MISMATCH', field: 'reviews', message: 'review does not belong to this catalog version' });
    }
    if (review.package.sha256 !== entry.release.packageSha256 || review.package.size !== entry.release.packageSize) {
      errors.push({ code: 'E_REVIEW_BINDING', field: 'review.package', message: 'review package hash/size does not match catalog release' });
    }
    if (review.media.coverSha256 !== entry.release.cover.sha256) {
      errors.push({ code: 'E_REVIEW_BINDING', field: 'review.media.coverSha256', message: 'review cover hash does not match catalog release' });
    }
    const reviewShots = review.media.screenshotSha256s || [];
    const catalogShots = (entry.release.screenshots || []).map((shot) => shot.sha256);
    if (reviewShots.length !== catalogShots.length || reviewShots.some((sha, index) => sha !== catalogShots[index])) {
      errors.push({ code: 'E_REVIEW_BINDING', field: 'review.media.screenshotSha256s', message: 'review screenshot hashes do not match catalog release' });
    }
    if (review.sourceCommit !== entry.source.commit) {
      errors.push({ code: 'E_REVIEW_BINDING', field: 'review.sourceCommit', message: 'review source commit does not match catalog source' });
    }
    if (review.reviewer.githubUserId !== entry.review.reviewer.githubUserId || review.reviewer.login !== entry.review.reviewer.login) {
      errors.push({ code: 'E_REVIEW_BINDING', field: 'review.reviewer', message: 'review reviewer does not match catalog review record' });
    }
    if (review.reviewedAt !== entry.review.reviewedAt) {
      errors.push({ code: 'E_REVIEW_BINDING', field: 'review.reviewedAt', message: 'review time does not match catalog record' });
    }
  }
  return { review, digest, errors };
}

/**
 * Load and bind every `reviews/<id>/<version>.json` referenced by a V1.5
 * catalog's append-only `releases[]`.
 *
 * `release.reviewSha256` is the sha256 of the exact review file bytes, so the
 * reviewed package bytes and the published release stay bound. A catalog cannot
 * silently rewrite an old release: the hash lives inside the immutable release
 * record.
 */
async function loadV2Reviews(root, catalog) {
  const errors = [];
  const digests = new Map();
  for (const release of catalog.releases) {
    const relative = `reviews/${catalog.gameId}/${release.version}.json`;
    let raw;
    try {
      raw = await fs.readFile(path.join(root, REGISTRY_DIRS.reviews, catalog.gameId, `${release.version}.json`), 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        errors.push({ code: 'E_REVIEW_MISSING', field: relative, message: 'approved review record is missing' });
        continue;
      }
      errors.push({ code: 'E_REVIEW_JSON', field: relative, message: `invalid JSON: ${error.message}` });
      continue;
    }
    let review;
    try {
      review = JSON.parse(raw);
    } catch (error) {
      errors.push({ code: 'E_REVIEW_JSON', field: relative, message: `invalid JSON: ${error.message}` });
      continue;
    }
    const digest = sha256(raw);
    digests.set(release.version, digest);
    const validation = validateReview(review);
    if (!validation.ok) {
      errors.push(...formatErrors(validation.errors, relative));
      continue;
    }
    if (review.gameId !== catalog.gameId || review.version !== release.version) {
      errors.push({ code: 'E_REVIEW_MISMATCH', field: relative, message: 'review does not belong to this catalog release' });
    }
    if (review.package.sha256 !== release.package.sha256 || review.package.size !== release.package.size) {
      errors.push({ code: 'E_REVIEW_BINDING', field: `${relative}#package`, message: 'review package hash/size does not match the release' });
    }
    if (isSha256(release.reviewSha256) && release.reviewSha256 !== digest) {
      errors.push({ code: 'E_REVIEW_BINDING', field: `${relative}#reviewSha256`, message: 'release.reviewSha256 does not match the stored review file' });
    }
    if (typeof release.sourceCommit === 'string' && release.sourceCommit !== review.sourceCommit) {
      errors.push({ code: 'E_REVIEW_BINDING', field: `${relative}#sourceCommit`, message: 'review source commit does not match the release' });
    }
    // CR8-02: deleting a media digest from the catalog must not disable the
    // binding. The catalog has to stay bound to the approved review: `url` and
    // `size` always come from the catalog, `sha256` may be recovered from the
    // trusted review (and is then still verified against the downloaded bytes
    // by validate-assets). A missing size — which the review schema cannot
    // supply — or a review that also lacks the digest rejects the release.
    const media = isPlainObject(release.media) ? release.media : {};
    const reviewMedia = isPlainObject(review.media) ? review.media : {};
    const mediaBinding = (asset, reviewSha256, field) => {
      try {
        resolveMediaBinding({ asset, reviewSha256, label: `${catalog.gameId}@${release.version} ${field}` });
      } catch (error) {
        errors.push({
          code: error.code || 'E_REVIEW_BINDING',
          field: `${relative}#${field}`,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        });
      }
    };
    mediaBinding(media.cover, reviewMedia.coverSha256, 'cover');
    const releaseShots = Array.isArray(media.screenshots) ? media.screenshots : [];
    const reviewShots = Array.isArray(reviewMedia.screenshotSha256s) ? reviewMedia.screenshotSha256s : [];
    if (releaseShots.length !== reviewShots.length) {
      errors.push({
        code: 'E_REVIEW_BINDING',
        field: `${relative}#screenshots`,
        message: 'review screenshot count does not match the release media',
      });
    }
    releaseShots.forEach((shot, index) => {
      // A digest at the same index is what the reviewer approved; a count
      // mismatch is reported above, the binding check still fails closed.
      mediaBinding(shot, reviewShots[index], `screenshots[${index}]`);
    });
  }
  return { errors, digests };
}

// ---------------------------------------------------------------------------
// Provenance-preserving normalization for the shared projection
// ---------------------------------------------------------------------------

/**
 * Normalize one loaded catalog into the V1.5 source shape consumed by
 * `projectRegistryEntries`, without dropping display metadata.
 *
 * Legacy (schemaVersion 1) records cannot express `owner`, `game.id` or
 * `game.author`; the shared `upgradeCatalogV1ToV2` provides the shape and this
 * function fills the fields a legacy record keeps outside `game` (numeric owner
 * identity, display author, source commit, review digest). Everything else stays
 * inside the shared projection rules.
 */
function normalizeCatalog(item, owner, reviewDigest) {
  const { entry, schemaVersion } = item;
  if (schemaVersion === 2) {
    const catalog = {
      ...entry,
      game: {
        ...entry.game,
        author: entry.game && entry.game.author
          ? entry.game.author
          : { name: entry.owner && entry.owner.login ? entry.owner.login : entry.gameId },
      },
    };
    return catalog;
  }
  const upgraded = upgradeCatalogV1ToV2(entry);
  if (!upgraded) return null;
  // `upgradeCatalogV1ToV2` keeps the V2 envelope; fill the legacy-only fields.
  upgraded.gameId = entry.gameId;
  upgraded.game = {
    ...upgraded.game,
    id: entry.gameId,
    author: entry.author && entry.author.name
      ? { name: entry.author.name }
      : { name: (owner && owner.owner && owner.owner.login) || entry.gameId },
  };
  upgraded.owner = entry.author && typeof entry.author.login === 'string'
    ? { login: entry.author.login, githubUserId: entry.author.githubUserId }
    : (owner && owner.owner) || { login: entry.gameId, githubUserId: 0 };
  const release = upgraded.releases[0];
  if (entry.source && typeof entry.source.commit === 'string' && /^[a-f0-9]{7,40}$/.test(entry.source.commit)) {
    release.sourceCommit = entry.source.commit;
  }
  if (typeof reviewDigest === 'string' && isSha256(reviewDigest)) release.reviewSha256 = reviewDigest;
  return upgraded;
}

/**
 * Preserve V1 index fields the shared projection does not carry.
 *
 * The shared `releaseToRegistryGame` is the frozen common projection; the V1
 * index additionally keeps display/optional fields from the source record
 * (preferredTheme/homepage/repository/license/changelog and the original
 * published/updated timestamps). This is what keeps a legacy content repository's
 * regenerated v1 index equivalent to the pre-V1.5 output.
 */
function enrichV1Entry(gameEntry, catalog, rawEntry) {
  const game = isPlainObject(catalog.game) ? catalog.game : {};
  const out = { ...gameEntry };
  for (const field of ['preferredTheme', 'homepage', 'repository', 'license']) {
    if (game[field] !== undefined) out[field] = game[field];
  }
  if (rawEntry && typeof rawEntry.changelog === 'string' && rawEntry.changelog.length > 0) {
    out.changelog = rawEntry.changelog;
  } else if (typeof game.changelog === 'string' && game.changelog.length > 0) {
    out.changelog = game.changelog;
  }
  if (rawEntry && typeof rawEntry.publishedAt === 'string') out.publishedAt = rawEntry.publishedAt;
  else if (typeof game.publishedAt === 'string') out.publishedAt = game.publishedAt;
  if (rawEntry && typeof rawEntry.updatedAt === 'string') out.updatedAt = rawEntry.updatedAt;
  return out;
}

/** Largest fixed timestamp in the sources; never the build clock (§5.5 step 5). */
function maxSourceTimestamp(catalogs) {
  let latest = null;
  for (const catalog of catalogs) {
    const stamps = [catalog.createdAt, catalog.updatedAt];
    for (const release of Array.isArray(catalog.releases) ? catalog.releases : []) {
      stamps.push(release.releasedAt);
    }
    for (const stamp of stamps) {
      if (typeof stamp !== 'string' || Number.isNaN(Date.parse(stamp))) continue;
      if (latest === null || stamp > latest) latest = stamp;
    }
  }
  return latest || new Date(0).toISOString();
}

function withGeneratedAt(index, generatedAt) {
  if (!index) return null;
  return { ...index, generatedAt };
}

/**
 * Validate the two projected indexes with the same validators the Host uses
 * (no second dialect). `sourceType: 'https'` matches a public content repo.
 */
function validateProjectedIndexes(v1Index, v2Index) {
  const errors = [];
  const v1 = validateRegistry(v1Index, { sourceType: 'https', sourceUrl: DEFAULT_OFFICIAL_REGISTRY_URL });
  if (!v1.ok) errors.push(...v1.errors.map((error) => ({ ...error, index: 'v1' })));
  const v2 = validateRegistryV2(v2Index, { sourceType: 'https', sourceUrl: DEFAULT_OFFICIAL_REGISTRY_V2_URL });
  if (!v2.ok) errors.push(...v2.errors.map((error) => ({ ...error, index: 'v2' })));
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Build (and optionally check/write) both generated indexes.
 *
 * @param {string} root content repository root
 * @param {{write?:boolean, check?:boolean, generatedAt?:string}} [options]
 */
export async function buildRegistry(root, options = {}) {
  const errors = [];
  const loaded = await loadEntries(root);
  errors.push(...loaded.errors);

  const ownerResult = await loadOwners(root);
  errors.push(...ownerResult.errors);

  const entryIds = new Set();
  const entries = [];
  const catalogs = [];
  for (const item of loaded.entries) {
    const { file, entry, schemaVersion } = item;
    const gameId = entry.gameId;
    if (entryIds.has(gameId)) {
      errors.push({ code: 'E_CATALOG_DUPLICATE', field: `catalog/${file}`, message: `duplicate gameId: ${gameId}` });
      continue;
    }
    entryIds.add(gameId);

    const owner = ownerResult.owners.get(gameId);
    if (!owner) {
      errors.push({ code: 'E_OWNER_MISSING', field: `owners/${gameId}.json`, message: 'catalog entry has no owner record' });
    } else if (schemaVersion === 1) {
      if (owner.owner.githubUserId !== entry.author.githubUserId || owner.owner.login.toLowerCase() !== entry.author.login.toLowerCase()) {
        errors.push({ code: 'E_OWNER_MISMATCH', field: `owners/${gameId}.json`, message: 'owner identity does not match catalog author' });
      }
    } else if (owner.owner.githubUserId !== entry.owner.githubUserId || owner.owner.login.toLowerCase() !== entry.owner.login.toLowerCase()) {
      errors.push({ code: 'E_OWNER_MISMATCH', field: `owners/${gameId}.json`, message: 'owner identity does not match catalog owner' });
    }

    let reviewDigest = null;
    if (schemaVersion === 1) {
      const review = await loadReviewForEntry(root, entry, file);
      errors.push(...review.errors);
      reviewDigest = review.digest;
    } else {
      const reviews = await loadV2Reviews(root, entry);
      errors.push(...reviews.errors);
    }

    entries.push(entry);
    const normalized = normalizeCatalog(item, owner, reviewDigest);
    if (!normalized) {
      errors.push({ code: 'E_CATALOG_INVALID', field: `catalog/${file}`, message: 'catalog cannot be normalized to schemaVersion 2' });
      continue;
    }
    catalogs.push(normalized);
  }

  if (errors.length > 0) {
    return { ok: false, errors, index: null, indexV2: null, indexes: { v1: null, v2: null }, entries, catalogs, changed: false, changedV2: false, generatedAt: null };
  }

  const projection = projectRegistryEntries(catalogs);
  if (!projection.ok) {
    return { ok: false, errors: projection.errors, index: null, indexV2: null, indexes: { v1: null, v2: null }, entries, catalogs, changed: false, changedV2: false, generatedAt: null };
  }

  const generatedAt = options.generatedAt || projection.v1?.generatedAt || projection.v2?.generatedAt || maxSourceTimestamp(catalogs);
  const rawById = new Map(loaded.entries.map((item) => [item.entry.gameId, item]));
  const selectedV1 = new Map();
  for (const catalog of catalogs) {
    const picked = selectProjectedReleases(catalog);
    if (picked.v1) selectedV1.set(catalog.gameId, picked.v1);
  }
  const v1Games = (projection.v1 ? projection.v1.games : []).map((game) => {
    const raw = rawById.get(game.id);
    return enrichV1Entry(game, raw ? (raw.schemaVersion === 1 ? raw.entry : raw.entry) : {}, raw ? raw.entry : null);
  });
  const index = v1Games.length === 0
    ? { registryVersion: 1, generatedAt, games: [] }
    : withGeneratedAt({ ...projection.v1, games: v1Games }, generatedAt);
  const indexV2 = withGeneratedAt(projection.v2, generatedAt) || { registryVersion: REGISTRY_V2_VERSION, generatedAt, games: [] };

  const validation = validateProjectedIndexes(index, indexV2);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, index: null, indexV2: null, indexes: { v1: null, v2: null }, entries, catalogs, changed: false, changedV2: false, generatedAt };
  }

  let changed = true;
  let changedV2 = true;
  const output = path.join(root, REGISTRY_FILE);
  const outputV2 = path.join(root, REGISTRY_V2_FILE);
  const text = `${JSON.stringify(index, null, 2)}\n`;
  const textV2 = `${JSON.stringify(indexV2, null, 2)}\n`;
  try {
    changed = (await fs.readFile(output, 'utf8')) !== text;
  } catch (_error) {
    changed = true;
  }
  try {
    changedV2 = (await fs.readFile(outputV2, 'utf8')) !== textV2;
  } catch (_error) {
    changedV2 = true;
  }
  if (options.write === true) {
    if (changed) await writeAtomic(output, text);
    if (changedV2) await writeAtomic(outputV2, textV2);
  }
  if (options.check === true) {
    if (changed) {
      errors.push({ code: 'E_REGISTRY_STALE', field: REGISTRY_FILE, message: `${REGISTRY_FILE} is not up to date; run generate-catalog.mjs` });
    }
    if (changedV2) {
      errors.push({ code: 'E_REGISTRY_STALE', field: REGISTRY_V2_FILE, message: `${REGISTRY_V2_FILE} is not up to date; run generate-catalog.mjs` });
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    index,
    indexV2,
    indexes: { v1: index, v2: indexV2 },
    entries,
    catalogs,
    changed,
    changedV2,
    generatedAt,
  };
}

async function writeAtomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temporary, text, { mode: 0o644 });
  await fs.rename(temporary, file);
}

// ---------------------------------------------------------------------------
// History validation (immutability + append-only releases + format policy)
// ---------------------------------------------------------------------------

/** Normalized release list of one raw catalog, for history comparisons. */
function releasesOf(entry) {
  if (!isPlainObject(entry)) return [];
  if (Array.isArray(entry.releases)) {
    return entry.releases.map((release) => ({
      version: release.version,
      format: release.format,
      tag: release.tag,
      sha256: release.package && release.package.sha256,
      size: release.package && release.package.size,
      filesDigest: release.package && release.package.filesDigest,
      sourceCommit: release.sourceCommit,
      reviewSha256: release.reviewSha256,
      releasedAt: release.releasedAt,
      media: release.media,
    }));
  }
  if (!isPlainObject(entry.release) || !isPlainObject(entry.game)) return [];
  return [{
    version: entry.game.version,
    format: 'html-v1',
    tag: entry.release.tag,
    sha256: entry.release.packageSha256,
    size: entry.release.packageSize,
    filesDigest: undefined,
    sourceCommit: entry.source && entry.source.commit,
    reviewSha256: undefined,
    releasedAt: entry.release.releasedAt,
    // Normalized to the V1.5 media shape so a legitimate V1.2 -> V1.5 catalog
    // migration does not trip the media fingerprint (history compares the
    // binding fields, not the envelope).
    media: {
      cover: entry.release.cover
        ? { url: entry.release.cover.url, sha256: entry.release.cover.sha256, size: entry.release.cover.size }
        : entry.release.cover,
      screenshots: (entry.release.screenshots || []).map((shot) => (shot
        ? { url: shot.url, sha256: shot.sha256, size: shot.size }
        : shot)),
    },
  }];
}

function newestRelease(releases) {
  let newest = null;
  for (const release of releases) {
    if (newest === null || compareVersions(release.version, newest.version) > 0) newest = release;
  }
  return newest;
}

/**
 * Fingerprint of a release's approved media (cover + screenshots). Only the
 * binding fields are compared: a catalog cannot swap media URLs or rewrites at
 * an already published version without tripping the history check.
 */
function mediaFingerprint(media) {
  if (!isPlainObject(media)) return JSON.stringify(media === undefined ? null : media);
  const normalize = (asset) => (isPlainObject(asset)
    ? { url: asset.url, sha256: asset.sha256, size: asset.size }
    : asset === undefined ? null : asset);
  const shots = Array.isArray(media.screenshots) ? media.screenshots.map(normalize) : media.screenshots;
  return JSON.stringify({ cover: normalize(media.cover), screenshots: shots });
}

function releaseBytesEqual(left, right) {
  return left.sha256 === right.sha256
    && left.size === right.size
    && left.filesDigest === right.filesDigest
    && mediaFingerprint(left.media) === mediaFingerprint(right.media);
}

function isWithdrawn(entry) {
  return isPlainObject(entry) && entry.withdrawnAt !== undefined && entry.withdrawnAt !== null;
}

/**
 * Compare a candidate content-repository snapshot against a trusted base ref
 * (normally `origin/main`). CI uses this so the current tree cannot silently
 * roll back a version, replace an owner, or rewrite an existing release/review
 * binding just by regenerating the index.
 *
 * V1.5 adds the catalog-level rules (§5.4):
 *   - every historical `releases[]` entry is append-only and byte-immutable
 *     (`E_CATALOG_IMMUTABLE` / `E_FORMAT_POLICY` on a format change);
 *   - the newest release version may never go backwards
 *     (`E_CATALOG_VERSION_ROLLBACK`);
 *   - a withdrawn game can be re-listed only with its original owner and a
 *     strictly newer version.
 */
export async function validateAgainstBase(candidateRoot, baseRoot) {
  const errors = [];
  const candidate = await buildRegistry(candidateRoot, { check: false });
  if (!candidate.ok) return { ok: false, errors: candidate.errors };
  const base = await buildRegistry(baseRoot, { check: false });
  if (!base.ok) return { ok: false, errors: base.errors };

  const baseEntries = new Map(base.entries.map((entry) => [entry.gameId, entry]));
  const candidateEntries = new Map(candidate.entries.map((entry) => [entry.gameId, entry]));
  const removed = [];

  /** Every owner/review audit record in the trusted base is immutable, even
   * after the game has been withdrawn from `catalog/`. */
  const baseOwnerIds = new Set();
  for (const file of await listJsonFiles(path.join(baseRoot, REGISTRY_DIRS.owners))) {
    const id = file.slice(0, -'.json'.length);
    baseOwnerIds.add(id);
    const baseOwner = await readJson(path.join(baseRoot, REGISTRY_DIRS.owners, file)).catch(() => null);
    const candidateOwner = await readJson(path.join(candidateRoot, REGISTRY_DIRS.owners, file)).catch(() => null);
    if (!candidateOwner) {
      errors.push({ code: 'E_CATALOG_OWNER_IMMUTABLE', field: `owners/${file}`, message: 'owner audit record is missing' });
    } else if (baseOwner && JSON.stringify(baseOwner.owner) !== JSON.stringify(candidateOwner.owner)) {
      errors.push({ code: 'E_CATALOG_OWNER_IMMUTABLE', field: `owners/${file}`, message: 'owner identity is immutable, including after withdrawal' });
    }
  }

  const maxReviewedVersion = new Map();
  const baseReviewRoot = path.join(baseRoot, REGISTRY_DIRS.reviews);
  for (const id of await listDirectories(baseReviewRoot)) {
    for (const file of await listJsonFiles(path.join(baseReviewRoot, id))) {
      const version = file.slice(0, -'.json'.length);
      const previous = compareVersions(version, maxReviewedVersion.get(id) || '0.0.0') > 0 ? version : maxReviewedVersion.get(id);
      maxReviewedVersion.set(id, previous);
      const before = await readJson(path.join(baseReviewRoot, id, file));
      let after = null;
      try { after = await readJson(path.join(candidateRoot, REGISTRY_DIRS.reviews, id, file)); } catch (_error) { after = null; }
      if (!after || JSON.stringify(before) !== JSON.stringify(after)) {
        errors.push({ code: 'E_CATALOG_REVIEW_IMMUTABLE', field: `reviews/${id}/${file}`, message: 'historical review record was removed or modified, including after withdrawal' });
      }
    }
  }

  for (const [id, previous] of baseEntries) {
    const next = candidateEntries.get(id);
    if (!next) {
      // Withdrawal is the documented way to remove a game from the index; its
      // owner/review audit records are protected above.
      removed.push(id);
      continue;
    }
    const baseReleases = releasesOf(previous);
    const nextReleases = releasesOf(next);
    // V1.5 withdrawal keeps the catalog file: both generations then drop it.
    if (!isWithdrawn(previous) && isWithdrawn(next)) {
      removed.push(id);
      continue;
    }
    if (!previous.game) continue; // already reported by the generator
    if (isWithdrawn(previous) && !isWithdrawn(next)) {
      // Re-listing after withdrawal: keep the owner (checked below) and the
      // version must be strictly newer than every previously reviewed version.
      const previousVersion = maxReviewedVersion.get(id);
      const nextNewest = newestRelease(nextReleases);
      if (previousVersion && nextNewest && compareVersions(nextNewest.version, previousVersion) <= 0) {
        errors.push({
          code: 'E_CATALOG_VERSION_ROLLBACK',
          field: `catalog/${id}.json`,
          message: `re-listed version ${nextNewest.version} must be newer than the withdrawn ${previousVersion}`,
        });
      }
      const baseOwner = await readJson(path.join(baseRoot, REGISTRY_DIRS.owners, `${id}.json`)).catch(() => null);
      const nextAuthor = next.owner || next.author;
      if (baseOwner && nextAuthor && (nextAuthor.login !== baseOwner.owner.login || nextAuthor.githubUserId !== baseOwner.owner.githubUserId)) {
        errors.push({ code: 'E_CATALOG_OWNER_IMMUTABLE', field: `catalog/${id}.json`, message: 're-listed game must keep the withdrawn owner identity' });
      }
      continue;
    }

    const previousNewest = newestRelease(baseReleases);
    const nextNewest = newestRelease(nextReleases);
    if (previousNewest && nextNewest) {
      const cmp = compareVersions(nextNewest.version, previousNewest.version);
      if (cmp < 0) {
        errors.push({
          code: 'E_CATALOG_VERSION_ROLLBACK',
          field: `catalog/${id}.json`,
          message: `version ${nextNewest.version} is older than trusted ${previousNewest.version}`,
        });
        continue;
      }
      if (cmp === 0) {
        if (previousNewest.format !== nextNewest.format) {
          errors.push({
            code: 'E_FORMAT_POLICY',
            field: `catalog/${id}.json`,
            message: `format ${nextNewest.format} cannot replace ${previousNewest.format} at the same version ${nextNewest.version}; bump the game version`,
          });
        } else if (!releaseBytesEqual(previousNewest, nextNewest)) {
          errors.push({
            code: 'E_CATALOG_IMMUTABLE',
            field: `catalog/${id}.json`,
            message: `same version ${nextNewest.version} cannot change its package bytes`,
          });
        }
      }
    }
    // Append-only: every trusted release version must still be present and
    // byte-identical (an update can only add a newer release).
    const nextByVersion = new Map(nextReleases.map((release) => [release.version, release]));
    for (const before of baseReleases) {
      const after = nextByVersion.get(before.version);
      if (!after) {
        errors.push({
          code: 'E_CATALOG_IMMUTABLE',
          field: `catalog/${id}.json`,
          message: `release ${before.version} was removed; releases[] is append-only`,
        });
        continue;
      }
      if (before.format !== after.format) {
        errors.push({
          code: 'E_FORMAT_POLICY',
          field: `catalog/${id}.json`,
          message: `release ${before.version} cannot change format ${before.format} -> ${after.format}`,
        });
      } else if (!releaseBytesEqual(before, after)) {
        errors.push({
          code: 'E_CATALOG_IMMUTABLE',
          field: `catalog/${id}.json`,
          message: `release ${before.version} package bytes are immutable`,
        });
      }
    }
    // V1 catalogs additionally pin their source/review/author metadata.
    if (!Array.isArray(previous.releases) && !Array.isArray(next.releases)) {
      const cmp = compareVersions(next.game.version, previous.game.version);
      if (cmp === 0) {
        for (const field of ['release', 'source', 'author', 'publishedAt']) {
          if (JSON.stringify(next[field]) !== JSON.stringify(previous[field])) {
            errors.push({ code: 'E_CATALOG_IMMUTABLE', field: `catalog/${id}.json`, message: `same version cannot change ${field}` });
          }
        }
      }
    }
  }

  // A brand-new id may only appear when it has never been published before;
  // re-listing a withdrawn id is handled above.
  for (const [id, next] of candidateEntries) {
    if (baseEntries.has(id)) continue;
    if (!baseOwnerIds.has(id)) continue;
    const baseOwner = await readJson(path.join(baseRoot, REGISTRY_DIRS.owners, `${id}.json`)).catch(() => null);
    const nextAuthor = next.owner || next.author;
    if (baseOwner && nextAuthor && (nextAuthor.login !== baseOwner.owner.login || nextAuthor.githubUserId !== baseOwner.owner.githubUserId)) {
      errors.push({ code: 'E_CATALOG_OWNER_IMMUTABLE', field: `catalog/${id}.json`, message: 're-listed game must keep the withdrawn owner identity' });
    }
    const previousVersion = maxReviewedVersion.get(id);
    const nextNewest = newestRelease(releasesOf(next));
    if (previousVersion && nextNewest && compareVersions(nextNewest.version, previousVersion) <= 0) {
      errors.push({ code: 'E_CATALOG_VERSION_ROLLBACK', field: `catalog/${id}.json`, message: `re-listed version ${nextNewest.version} must be newer than the withdrawn ${previousVersion}` });
    }
  }

  return { ok: errors.length === 0, errors, removed, baseCount: base.entries.length, candidateCount: candidate.entries.length };
}

async function listDirectories(directory) {
  try {
    const names = await fs.readdir(directory, { withFileTypes: true });
    return names.filter((name) => name.isDirectory()).map((name) => name.name).sort();
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function listJsonFiles(directory) {
  try {
    const names = await fs.readdir(directory);
    return names.filter((name) => name.endsWith('.json') && !name.startsWith('.')).sort();
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function maxUpdatedAt(entries) {
  let latest = null;
  for (const entry of entries) {
    for (const value of [entry.updatedAt, entry.publishedAt, entry.release && entry.release.releasedAt]) {
      if (typeof value !== 'string') continue;
      const ms = Date.parse(value);
      if (!Number.isFinite(ms)) continue;
      if (latest === null || ms > Date.parse(latest)) latest = value;
    }
  }
  return latest || new Date(0).toISOString();
}

export async function readRegistryIndex(root) {
  return readJson(path.join(root, REGISTRY_FILE));
}

export async function readRegistryV2Index(root) {
  return readJson(path.join(root, REGISTRY_V2_FILE));
}

/** Initialise a content repo from `templates/registry` with concrete placeholders. */
export async function initContentRepo(options) {
  const target = path.resolve(options.target);
  const templateDir = path.resolve(options.templateDir);
  const repo = options.platformRepo;
  const commit = options.platformCommit;
  const version = options.platformVersion || '0.0.0';
  const generatedAt = options.generatedAt || new Date(0).toISOString();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || '')) throw new Error('platformRepo must be owner/name');
  if (!/^[a-f0-9]{7,40}$/.test(commit || '')) throw new Error('platformCommit must be a fixed hex commit');
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      const names = await fs.readdir(target);
      if (names.length > 0) throw new Error(`target directory is not empty: ${target}`);
    }
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error;
  }
  await fs.mkdir(target, { recursive: true });
  await copyTree(templateDir, target);
  const replacements = {
    '__PLATFORM_REPO__': repo,
    '__PLATFORM_COMMIT__': commit,
    '__PLATFORM_VERSION__': version,
    '__GENERATED_AT__': generatedAt,
  };
  await replacePlaceholders(target, replacements);
  await fs.mkdir(path.join(target, REGISTRY_DIRS.catalog), { recursive: true });
  await fs.mkdir(path.join(target, REGISTRY_DIRS.owners), { recursive: true });
  await fs.mkdir(path.join(target, REGISTRY_DIRS.reviews), { recursive: true });
  await fs.mkdir(path.join(target, REGISTRY_DIRS.registry), { recursive: true });
  await fs.mkdir(path.join(target, REGISTRY_DIRS.registry, 'v2'), { recursive: true });
  return { target, repo, commit, version };
}

async function copyTree(source, target) {
  const names = await fs.readdir(source, { withFileTypes: true });
  for (const name of names) {
    if (name.name === '.git' || name.name === '.DS_Store' || name.name === 'node_modules') continue;
    const from = path.join(source, name.name);
    const to = path.join(target, name.name);
    if (name.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      await copyTree(from, to);
    } else if (name.isFile()) {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
    }
  }
}

async function replacePlaceholders(root, replacements) {
  const names = await fs.readdir(root, { withFileTypes: true });
  for (const name of names) {
    const target = path.join(root, name.name);
    if (name.isDirectory()) {
      if (name.name === '.git') continue;
      await replacePlaceholders(target, replacements);
      continue;
    }
    if (!name.isFile() || name.name.endsWith('.png') || name.name.endsWith('.jpg')) continue;
    let text = await fs.readFile(target, 'utf8');
    let changed = false;
    for (const [key, value] of Object.entries(replacements)) {
      if (text.includes(key)) {
        text = text.split(key).join(value);
        changed = true;
      }
    }
    if (changed) await fs.writeFile(target, text);
  }
}

export function catalogEntryFromSubmissionSafe(options) {
  return catalogEntryFromSubmission(options);
}

export { generateRegistryIndex, maxUpdatedAt };
