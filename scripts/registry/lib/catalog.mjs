/**
 * Content-repository catalog pipeline (V1.2 community publishing MVP).
 *
 * The content repo only stores per-game source records (`catalog/<id>.json`),
 * ownership (`owners/<id>.json`) and review records (`reviews/<id>/<version>.json`).
 * `registry/games.json` is generated from those sources and must be committed in
 * the same PR; CI verifies it is fresh.
 *
 * Pure Node built-ins; no npm install. The runtime Registry remains validated by
 * `packages/shared/src/registry.js` (no second validation dialect).
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  CATALOG_SCHEMA_VERSION,
  OWNER_SCHEMA_VERSION,
  catalogEntryFromSubmission,
  generateRegistryIndex,
  validateCatalogEntry,
  validateOwner,
  validateReview,
} from '../../../packages/shared/src/community.js';

export const REGISTRY_DIRS = Object.freeze({
  catalog: 'catalog',
  owners: 'owners',
  reviews: 'reviews',
  registry: 'registry',
});
export const REGISTRY_FILE = 'registry/games.json';

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
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
    const validation = validateCatalogEntry(parsed, { gameId: expectedId });
    if (!validation.ok) {
      errors.push(...formatErrors(validation.errors, `catalog/${file}`));
      continue;
    }
    entries.push({ file, entry: parsed, digest: sha256(JSON.stringify(parsed)) });
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

/** Load the stored review for one catalog entry and bind it to the published bytes. */
export async function loadReviewForEntry(root, entry, fileLabel) {
  const file = path.join(root, REGISTRY_DIRS.reviews, entry.gameId, `${entry.game.version}.json`);
  let review;
  try {
    review = await readJson(file);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { review: null, errors: [{ code: 'E_REVIEW_MISSING', field: `reviews/${entry.gameId}/${entry.game.version}.json`, message: 'approved review record is missing' }] };
    }
    return { review: null, errors: [{ code: 'E_REVIEW_JSON', field: `reviews/${entry.gameId}/${entry.game.version}.json`, message: `invalid JSON: ${error.message}` }] };
  }
  const errors = [];
  const validation = validateReview(review);
  if (!validation.ok) errors.push(...formatErrors(validation.errors, `reviews/${entry.gameId}/${entry.game.version}.json`));
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
  return { review, errors };
}

/**
 * Build (and optionally check/write) `registry/games.json`.
 * @param {string} root content repository root
 * @param {{write?: boolean, check?: boolean, generatedAt?: string}} [options]
 */
export async function buildRegistry(root, options = {}) {
  const errors = [];
  const loaded = await loadEntries(root);
  errors.push(...loaded.errors);

  const ownerResult = await loadOwners(root);
  errors.push(...ownerResult.errors);

  const entryIds = new Set();
  const entries = [];
  for (const item of loaded.entries) {
    const { file, entry } = item;
    if (entryIds.has(entry.gameId)) {
      errors.push({ code: 'E_CATALOG_DUPLICATE', field: `catalog/${file}`, message: `duplicate gameId: ${entry.gameId}` });
      continue;
    }
    entryIds.add(entry.gameId);

    const owner = ownerResult.owners.get(entry.gameId);
    if (!owner) {
      errors.push({ code: 'E_OWNER_MISSING', field: `owners/${entry.gameId}.json`, message: 'catalog entry has no owner record' });
    } else if (owner.owner.githubUserId !== entry.author.githubUserId || owner.owner.login.toLowerCase() !== entry.author.login.toLowerCase()) {
      errors.push({ code: 'E_OWNER_MISMATCH', field: `owners/${entry.gameId}.json`, message: 'owner identity does not match catalog author' });
    }

    const review = await loadReviewForEntry(root, entry, file);
    errors.push(...review.errors);
    entries.push(entry);
  }

  if (errors.length === 0) {
    const generatedAt = options.generatedAt || maxUpdatedAt(entries);
    const generated = generateRegistryIndex(entries, { generatedAt });
    if (!generated.ok) {
      errors.push(...generated.errors);
    } else {
      const output = path.join(root, REGISTRY_FILE);
      const text = `${JSON.stringify(generated.index, null, 2)}\n`;
      let changed = true;
      try {
        const existing = await fs.readFile(output, 'utf8');
        changed = existing !== text;
      } catch (_error) {
        changed = true;
      }
      if (options.write === true && changed) {
        await fs.mkdir(path.dirname(output), { recursive: true });
        const temporary = `${output}.tmp-${process.pid}`;
        await fs.writeFile(temporary, text, { mode: 0o644 });
        await fs.rename(temporary, output);
      }
      if (options.check === true && changed) {
        errors.push({ code: 'E_REGISTRY_STALE', field: REGISTRY_FILE, message: `${REGISTRY_FILE} is not up to date; run generate-catalog.mjs` });
      }
      return { ok: errors.length === 0, errors, index: generated.index, entries, changed, generatedAt };
    }
  }
  return { ok: false, errors, index: null, entries, changed: false, generatedAt: null };
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

export { CATALOG_SCHEMA_VERSION, OWNER_SCHEMA_VERSION };
