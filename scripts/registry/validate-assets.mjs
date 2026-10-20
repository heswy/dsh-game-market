#!/usr/bin/env node
/**
 * Read-only CI check: every published catalog asset is still byte-identical to
 * its approved package/media hashes. This downloads from the official HTTPS
 * URLs but never executes author code or mutates a repository.
 *
 * Both catalog shapes are verified (`docs/V1.5-CONTRACTS.md` §5.5):
 *   - `schemaVersion: 1` — the single V1.2 `release`;
 *   - `schemaVersion: 2` — every entry of the append-only `releases[]`, so an
 *     old HTML release and a newer ZIP release are both re-downloaded and
 *     re-hashed on every PR.
 *
 * Both package formats are validated with the same code the Host install uses:
 * `html-v1` through the shared single-file validator, `asset-zip-v2` through
 * the Host archive pipeline (`packages/host/src/zip.js`, §1.4/§1.5/§3/§4) —
 * limits, path/type/content rules, CRC, inner file manifest and
 * `fileManifestDigest`. A ZIP release must also still match its recorded
 * `package.filesDigest`; an outer sha256 match alone is not sufficient.
 *
 * Media is re-verified the same way (CR8-02): a cover/screenshot digest deleted
 * from the catalog may be recovered from the approved review record, but the
 * bytes are still downloaded and re-hashed. If neither the catalog nor the
 * review carries a digest — or the catalog lost the URL/size — the release is
 * rejected as `E_PUBLISH_MEDIA_UNBOUND` instead of being skipped.
 *
 *   node scripts/registry/validate-assets.mjs --registry-dir .
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { LIMITS } from '../../packages/shared/src/constants.js';
import {
  downloadVerified,
  publishError,
  validatePackageBytes,
} from './lib/assets.mjs';
import { classifyPackageFormat } from './lib/catalog.mjs';
import { MEDIA_UNBOUND, verifyMediaAsset } from './lib/media.mjs';

async function listCatalog(root) {
  const directory = path.join(root, 'catalog');
  let names;
  try { names = await fs.readdir(directory); } catch (_error) { return []; }
  return names.filter((name) => name.endsWith('.json') && !name.startsWith('.')).sort();
}

/** Every release record of a catalog, normalized across both shapes. */
function releasesOf(entry) {
  if (Array.isArray(entry.releases)) {
    return entry.releases.map((release) => ({
      version: release.version,
      format: release.format,
      package: release.package,
      media: release.media,
    }));
  }
  if (!entry.release || !entry.game) return [];
  return [{
    version: entry.game.version,
    format: 'html-v1',
    package: {
      url: entry.release.packageUrl,
      sha256: entry.release.packageSha256,
      size: entry.release.packageSize,
    },
    media: {
      cover: entry.release.cover,
      screenshots: entry.release.screenshots,
    },
  }];
}

/** Approved review record for this release, or null when absent/unreadable. */
async function loadReviewRecord(registryDir, id, version) {
  try {
    const raw = await fs.readFile(path.join(registryDir, 'reviews', id, `${version}.json`), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function verifyRelease({ id, registryDir, release, http }) {
  const label = `${id}@${release.version}`;
  const format = release.format || classifyPackageFormat(release.package && release.package.url);
  const pkg = await downloadVerified(release.package.url, {
    sha256: release.package.sha256,
    size: release.package.size,
  }, http, `${label} package`);
  const validation = await validatePackageBytes({ bytes: pkg.bytes, id, version: release.version, format });
  if (format === 'asset-zip-v2') {
    if (pkg.bytes.length > LIMITS.zip.zipOuterBytes) {
      const error = new Error(`${label} package exceeds zipOuterBytes`);
      error.code = 'E_PUBLISH_TOO_LARGE';
      throw error;
    }
    const recorded = release.package && release.package.filesDigest;
    if (typeof recorded === 'string' && recorded !== validation.filesDigest) {
      const error = new Error(`${label} package.filesDigest does not match the archive file manifest`);
      error.code = 'E_PUBLISH_FILES_DIGEST';
      error.details = { recorded, actual: validation.filesDigest };
      throw error;
    }
  }

  // CR8-02: never skip a media asset because its digest is missing. The digest
  // may be supplied by the approved review record, but then the bytes are still
  // downloaded and re-hashed. `url`/`size` must come from the catalog.
  const media = isPlainObject(release.media) ? release.media : null;
  if (media === null) {
    throw publishError(MEDIA_UNBOUND, `${label} release.media must be an object`, { label });
  }
  if (!Array.isArray(media.screenshots)) {
    throw publishError(MEDIA_UNBOUND, `${label} release.media.screenshots must be an array`, { label });
  }
  const review = await loadReviewRecord(registryDir, id, release.version);
  const reviewMedia = isPlainObject(review && review.media) ? review.media : {};
  const reviewShots = Array.isArray(reviewMedia.screenshotSha256s) ? reviewMedia.screenshotSha256s : [];
  const boundFromReview = [];

  const cover = await verifyMediaAsset({
    asset: media.cover,
    reviewSha256: reviewMedia.coverSha256,
    label: `${label} cover`,
    http,
  });
  if (cover.digestSource === 'review') boundFromReview.push('cover');
  const screenshots = [];
  for (let index = 0; index < media.screenshots.length; index += 1) {
    const shot = await verifyMediaAsset({
      asset: media.screenshots[index],
      reviewSha256: reviewShots[index],
      label: `${label} screenshot ${index + 1}`,
      http,
    });
    if (shot.digestSource === 'review') boundFromReview.push(`screenshot-${index + 1}`);
    screenshots.push(shot);
  }
  return {
    gameId: id,
    version: release.version,
    format,
    filesDigest: validation.filesDigest,
    fileCount: validation.fileCount,
    media: {
      cover: cover.digestSource,
      screenshots: screenshots.length,
      boundFromReview,
    },
  };
}

export async function validateAssets(registryDir, http = {}) {
  const errors = [];
  const entries = [];
  for (const file of await listCatalog(registryDir)) {
    const id = file.slice(0, -'.json'.length);
    let entry;
    try {
      entry = JSON.parse(await fs.readFile(path.join(registryDir, 'catalog', file), 'utf8'));
    } catch (error) {
      errors.push({ code: 'E_CATALOG_JSON', field: `catalog/${file}`, message: error.message });
      continue;
    }
    const releases = releasesOf(entry);
    if (releases.length === 0) {
      errors.push({ code: 'E_CATALOG_RELEASE', field: `catalog/${file}`, message: 'catalog has no release record' });
      continue;
    }
    const gameId = entry.gameId || id;
    for (const release of releases) {
      try {
        entries.push(await verifyRelease({ id: gameId, registryDir, release, http }));
      } catch (error) {
        errors.push({
          code: error.code || 'E_PUBLISH_ASSET_INVALID',
          field: `catalog/${file}#${release.version}`,
          message: error.message,
          details: error.details || null,
        });
      }
    }
  }
  return { ok: errors.length === 0, count: entries.length, entries, errors };
}

export async function main(argv = process.argv.slice(2)) {
  let registryDir = null;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--registry-dir') { registryDir = argv[index + 1] || null; index += 1; }
    else if (argv[index] === '--json') json = true;
    else { console.error(`[assets] unknown argument: ${argv[index]}`); return 2; }
  }
  if (!registryDir) {
    console.error('usage: node scripts/registry/validate-assets.mjs --registry-dir <dir> [--json]');
    return 2;
  }
  const result = await validateAssets(registryDir);
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) console.log(`[assets] OK releases=${result.count}`);
  else {
    console.error('[assets] FAILED');
    for (const error of result.errors) console.error(`  - ${error.code} ${error.field || ''}: ${error.message}`);
  }
  return result.ok ? 0 : 1;
}

const __isMain = typeof process.argv[1] === 'string' && pathToFileURL(process.argv[1]).href === import.meta.url;
if (__isMain) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`[assets] ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  });
}
