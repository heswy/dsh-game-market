/**
 * Maintainer publishing orchestration (dry-run by default).
 *
 * Local-first: validates the submission/review, downloads and verifies the
 * author's exact bytes, shows the planned release/catalog changes and only in
 * `--execute` mode performs GitHub mutations. The catalog PR is the switch.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ASSET_ZIP_V2,
  PACKAGE_FORMATS,
} from '../../../packages/shared/src/constants.js';
import { packageFileNameForFormat } from '../../../packages/shared/src/package-v2.js';
import {
  CATALOG_V2_SCHEMA_VERSION,
  upgradeCatalogV1ToV2,
} from '../../../packages/shared/src/catalog-v2.js';
import { compareVersions } from '../../../packages/host/src/semver.js';
import {
  REGISTRY_V2_FILE,
  buildRegistry,
  catalogEntryFromSubmissionSafe,
  readJson,
} from './catalog.mjs';
import {
  downloadShaFile,
  downloadVerified,
  extensionForType,
  sha256,
  validateMediaBytes,
  validatePackageBytes,
} from './assets.mjs';
import { createGit } from './git.mjs';
import { createGithub, parseGitHubRepo } from './github.mjs';

const DEFAULT_BASE = 'main';

function cleanError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function assert(condition, code, message, details) {
  if (!condition) throw cleanError(code, message, details);
}

function safeBranchPart(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function readOwner(root, id) {
  return readJson(path.join(root, 'owners', `${id}.json`));
}

function releaseUrl(repo, tag, name) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

function buildAssetPlan(repo, submission, tag, hashes, format = 'html-v1') {
  const id = submission.game.id;
  const version = submission.game.version;
  const packageName = packageFileNameForFormat(id, version, format);
  const shaName = `${packageName}.sha256`;
  const coverName = `cover-${version}.${extensionForType(submission.media.cover.type)}`;
  const screenshotNames = submission.media.screenshots.map((shot, index) => `screenshot-${index + 1}-${version}.${extensionForType(shot.type)}`);
  const packageUrl = releaseUrl(repo, tag, packageName);
  const shaUrl = releaseUrl(repo, tag, shaName);
  const coverUrl = releaseUrl(repo, tag, coverName);
  const screenshotUrls = screenshotNames.map((name) => releaseUrl(repo, tag, name));
  return {
    tag,
    packageName,
    shaName,
    coverName,
    screenshotNames,
    packageUrl,
    shaUrl,
    coverUrl,
    screenshotUrls,
    hashes,
  };
}

function planFiles(id, version) {
  return {
    catalog: `catalog/${id}.json`,
    owner: `owners/${id}.json`,
    review: `reviews/${id}/${version}.json`,
    registry: 'registry/games.json',
    registryV2: REGISTRY_V2_FILE,
  };
}

/**
 * Package format of a submission.
 *
 * V1 submissions have no `format` field and end in `.html`; V1.5 ZIP
 * submissions must declare `package.format` (or use the `.dshgame.zip` suffix).
 * The two are cross-checked so a package cannot be mislabelled: §1.2/§5.4
 * (GM-4282 `E_FORMAT_POLICY`).
 */
function submissionFormat(submission) {
  const pkg = submission && submission.package;
  const declared = pkg && pkg.format;
  if (declared !== undefined && declared !== null) {
    if (!PACKAGE_FORMATS.includes(declared)) {
      return { ok: false, format: null, message: `unsupported package.format: ${String(declared)}` };
    }
  }
  const url = pkg && typeof pkg.url === 'string' ? pkg.url.split('?')[0] : '';
  const inferred = url.endsWith('.dshgame.zip') ? ASSET_ZIP_V2 : url.endsWith('.html') ? 'html-v1' : null;
  if (declared !== undefined && declared !== null && inferred !== null && declared !== inferred) {
    return { ok: false, format: null, message: `package.format ${declared} does not match the package URL` };
  }
  const format = declared !== undefined && declared !== null ? declared : inferred;
  if (!format) return { ok: false, format: null, message: 'package.format or a matching package URL is required' };
  const expectedFileName = packageFileNameForFormat(submission.game.id, submission.game.version, format);
  if (!url.endsWith(`/${expectedFileName}`)) {
    return { ok: false, format, message: `package URL file name must be ${expectedFileName}` };
  }
  const declaredFilesDigest = pkg && pkg.filesDigest;
  if (declaredFilesDigest !== undefined && declaredFilesDigest !== null) {
    if (format !== ASSET_ZIP_V2) {
      return { ok: false, format, message: 'package.filesDigest only applies to asset-zip-v2 packages' };
    }
    if (typeof declaredFilesDigest !== 'string' || !/^[a-f0-9]{64}$/.test(declaredFilesDigest)) {
      return { ok: false, format, message: 'package.filesDigest must be 64 lowercase hex characters' };
    }
  }
  return { ok: true, format, message: 'ok' };
}

/** Every published release of a catalog (V1.2 single release or V1.5 releases[]). */
function catalogReleases(entry) {
  if (!entry) return [];
  if (Array.isArray(entry.releases)) return entry.releases;
  if (!entry.release || !entry.game) return [];
  return [{
    version: entry.game.version,
    format: 'html-v1',
    tag: entry.release.tag,
    package: { url: entry.release.packageUrl, sha256: entry.release.packageSha256, size: entry.release.packageSize },
    releasedAt: entry.release.releasedAt,
  }];
}

function latestCatalogRelease(entry) {
  let newest = null;
  for (const release of catalogReleases(entry)) {
    if (!newest || compareVersions(release.version, newest.version) > 0) newest = release;
  }
  return newest;
}

function findCatalogRelease(entry, version) {
  return catalogReleases(entry).find((release) => release.version === version) || null;
}

/** True when the catalog already generated a V1.5 (append-only releases) record. */
function isCatalogV2(entry) {
  return Boolean(entry) && entry.schemaVersion === CATALOG_V2_SCHEMA_VERSION;
}


async function loadExistingCatalog(root) {
  const result = await buildRegistry(root, { check: true });
  return result;
}

async function downloadSubmissionAssets(submission, http, format) {
  const packageResult = await downloadVerified(submission.package.url, { sha256: submission.package.sha256, size: submission.package.size }, http, 'package');
  await downloadShaFile(submission.package.sha256Url, submission.package.sha256, http);
  const coverResult = await downloadVerified(submission.media.cover.url, submission.media.cover, http, 'cover');
  const screenshots = [];
  for (let index = 0; index < submission.media.screenshots.length; index += 1) {
    screenshots.push(await downloadVerified(submission.media.screenshots[index].url, submission.media.screenshots[index], http, `screenshot-${index + 1}`));
  }
  // §1.4/§1.5: ZIP packages are validated by the same archive pipeline the Host
  // install uses; the returned filesDigest binds the inner file manifest.
  const packageValidation = await validatePackageBytes({
    bytes: packageResult.bytes,
    id: submission.game.id,
    version: submission.game.version,
    format,
  });
  const declaredFilesDigest = submission.package && submission.package.filesDigest;
  if (typeof declaredFilesDigest === 'string' && declaredFilesDigest !== packageValidation.filesDigest) {
    throw cleanError(
      'E_PUBLISH_FILES_DIGEST',
      'package.filesDigest does not match the archive file manifest',
      { declared: declaredFilesDigest, actual: packageValidation.filesDigest },
    );
  }
  validateMediaBytes({ bytes: coverResult.bytes, media: submission.media.cover, label: 'cover' });
  for (let index = 0; index < screenshots.length; index += 1) {
    validateMediaBytes({ bytes: screenshots[index].bytes, media: submission.media.screenshots[index], label: `screenshot-${index + 1}` });
  }
  return {
    packageBytes: packageResult.bytes,
    packageManifest: packageValidation.manifest,
    packageValidation,
    filesDigest: packageValidation.filesDigest,
    coverBytes: coverResult.bytes,
    screenshotBytes: screenshots.map((item) => item.bytes),
  };
}

function buildCatalogV2FromPlan({ submission, review, release, format, filesDigest, existingEntry, existingReviewText, historicalReviewText, nowIso }) {
  const game = submission.game;
  const reviewText = `${JSON.stringify(review, null, 2)}\n`;
  const reviewDigest = sha256(Buffer.from(reviewText, 'utf8'));
  const newRelease = {
    version: game.version,
    format,
    tag: release.tag,
    package: {
      url: release.packageUrl,
      sha256: submission.package.sha256,
      size: submission.package.size,
      ...(format === ASSET_ZIP_V2 && typeof filesDigest === 'string' ? { filesDigest } : {}),
    },
    media: {
      cover: {
        url: release.cover.url,
        sha256: submission.media.cover.sha256,
        size: submission.media.cover.size,
        type: submission.media.cover.type,
      },
      screenshots: release.screenshots.map((shot, index) => ({
        url: shot.url,
        sha256: submission.media.screenshots[index].sha256,
        size: submission.media.screenshots[index].size,
        type: submission.media.screenshots[index].type,
      })),
    },
    sourceCommit: submission.author.sourceCommit,
    reviewSha256: reviewDigest,
    releasedAt: release.releasedAt,
  };

  let priorReleases = [];
  let owner = { login: submission.author.login, githubUserId: submission.author.githubUserId };
  let createdAt = release.releasedAt;
  let withdrawnAt = null;
  if (existingEntry) {
    if (isCatalogV2(existingEntry)) {
      priorReleases = existingEntry.releases.map((item) => JSON.parse(JSON.stringify(item)));
      owner = existingEntry.owner ? { ...existingEntry.owner } : owner;
      createdAt = existingEntry.createdAt || createdAt;
      withdrawnAt = existingEntry.withdrawnAt ?? null;
    } else {
      const upgraded = upgradeCatalogV1ToV2(existingEntry);
      if (upgraded) {
        // V1 has no V2 `reviewSha256`: derive it from the stored review of the
        // *historical* release version (not the new one, whose review file does
        // not exist yet). Falling back to a fabricated digest would make the
        // upgraded release fail the E_REVIEW_BINDING check.
        const storedHistoricalReview = typeof historicalReviewText === 'string'
          ? historicalReviewText
          : (isCatalogV2(existingEntry) ? null : existingReviewText);
        const existingReviewDigest = typeof storedHistoricalReview === 'string'
          ? sha256(Buffer.from(storedHistoricalReview, 'utf8'))
          : null;
        priorReleases = upgraded.releases.map((item) => ({
          ...item,
          package: { ...item.package },
          media: {
            cover: existingEntry.release && existingEntry.release.cover ? { ...existingEntry.release.cover } : item.media.cover,
            screenshots: Array.isArray(existingEntry.release && existingEntry.release.screenshots)
              ? existingEntry.release.screenshots.map((shot) => ({ ...shot }))
              : item.media.screenshots,
          },
          sourceCommit: existingEntry.source && /^[a-f0-9]{7,40}$/.test(String(existingEntry.source.commit))
            ? existingEntry.source.commit
            : item.sourceCommit,
          reviewSha256: existingReviewDigest || item.reviewSha256,
        }));
      }
      createdAt = existingEntry.publishedAt || createdAt;
    }
  }

  const replaying = priorReleases.some((item) => item.version === newRelease.version);
  return {
    schemaVersion: CATALOG_V2_SCHEMA_VERSION,
    gameId: game.id,
    owner,
    game: {
      id: game.id,
      name: game.name,
      version: game.version,
      description: game.description,
      author: { name: submission.author.login },
      categories: game.categories.slice(),
      tags: Array.isArray(game.tags) ? game.tags.slice() : [],
      capabilities: game.capabilities.slice(),
      sdkVersion: game.sdkVersion,
      runtimeVersion: game.runtimeVersion,
      ...(game.preferredTheme ? { preferredTheme: game.preferredTheme } : {}),
      ...(game.homepage ? { homepage: game.homepage } : {}),
      ...(game.repository ? { repository: game.repository } : {}),
      ...(game.license ? { license: game.license } : {}),
    },
    // Idempotent replay of an already-published version/bytes: the historical
    // release record is append-only, so keep it untouched instead of appending a
    // duplicate version (catalog validation forbids duplicate versions).
    releases: replaying ? priorReleases : [...priorReleases, newRelease],
    withdrawnAt,
    createdAt,
    // A replay must not perturb the generated indexes either: keep the recorded
    // updatedAt so re-running the same publish is byte-deterministic.
    updatedAt: replaying && existingEntry && typeof existingEntry.updatedAt === 'string'
      ? existingEntry.updatedAt
      : nowIso,
  };
}

function buildPlan({ repo, submission, review, assets, existingEntry, existingReviewText, historicalReviewText, baseBranch, format = 'html-v1', catalogSchema = 1 }) {
  const id = submission.game.id;
  const version = submission.game.version;
  const tag = `${id}-v${version}`;
  const hashes = {
    package: submission.package.sha256,
    cover: submission.media.cover.sha256,
    screenshots: submission.media.screenshots.map((shot) => shot.sha256),
    sourceCommit: review.sourceCommit,
  };
  const assetPlan = buildAssetPlan(repo, submission, tag, hashes, format);
  const nowIso = new Date().toISOString();
  const release = {
    tag,
    releasedAt: nowIso,
    packageUrl: assetPlan.packageUrl,
    packageSha256: submission.package.sha256,
    packageSize: submission.package.size,
    cover: { url: assetPlan.coverUrl },
    screenshots: assetPlan.screenshotUrls.map((url) => ({ url })),
    ...(review.source && review.source.issueUrl ? { issueUrl: review.source.issueUrl } : {}),
    ...(review.source && review.source.prUrl ? { prUrl: review.source.prUrl } : {}),
    updatedAt: nowIso,
  };
  const catalogEntry = catalogSchema === 2
    ? buildCatalogV2FromPlan({ submission, review, release, format, filesDigest: assets.filesDigest, existingEntry, existingReviewText, historicalReviewText, nowIso })
    : catalogEntryFromSubmissionSafe({ submission, review, release });
  assert(catalogEntry, 'E_PUBLISH_INTERNAL', 'could not build the catalog entry');
  return {
    repo,
    baseBranch: baseBranch || DEFAULT_BASE,
    game: { id, version, name: submission.game.name },
    tag,
    release,
    catalogEntry,
    assetPlan,
    files: planFiles(id, version),
    existingEntry,
    manifest: assets.packageManifest,
    package: {
      format,
      filesDigest: assets.filesDigest || null,
      fileCount: assets.packageValidation ? assets.packageValidation.fileCount : null,
      unpackedBytes: assets.packageValidation ? assets.packageValidation.unpackedBytes : null,
      entry: assets.packageValidation ? assets.packageValidation.entry : null,
    },
    selfTest: submission.selfTest,
    review: { reviewedAt: review.reviewedAt, reviewer: review.reviewer, sourceCommit: review.sourceCommit },
  };
}

async function writeAtomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temp, text, { mode: 0o644 });
  await fs.rename(temp, file);
}

async function snapshotFile(file) {
  try { return await fs.readFile(file, 'utf8'); } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function restoreFiles(entries) {
  for (const [file, content] of entries) {
    if (content === null) await fs.rm(file, { force: true });
    else await writeAtomic(file, content);
  }
}

function releaseExpectedAssets(plan, assets) {
  const shaBytes = Buffer.from(`${plan.assetPlan.hashes.package}  ${plan.assetPlan.packageName}\n`);
  return [
    { url: plan.assetPlan.packageUrl, sha256: plan.assetPlan.hashes.package, size: assets.packageBytes.length },
    { url: plan.assetPlan.shaUrl, sha256: sha256(shaBytes), size: shaBytes.length },
    { url: plan.assetPlan.coverUrl, sha256: plan.assetPlan.hashes.cover, size: assets.coverBytes.length },
    ...plan.assetPlan.screenshotUrls.map((url, index) => ({ url, sha256: plan.assetPlan.hashes.screenshots[index], size: assets.screenshotBytes[index].length })),
  ];
}

function draftAssetExpectations(plan, assets) {
  const shaBytes = Buffer.from(`${plan.assetPlan.hashes.package}  ${plan.assetPlan.packageName}\n`);
  return [
    { name: plan.assetPlan.packageName, sha256: plan.assetPlan.hashes.package, size: assets.packageBytes.length, bytes: assets.packageBytes },
    { name: plan.assetPlan.shaName, sha256: sha256(shaBytes), size: shaBytes.length, bytes: shaBytes },
    { name: plan.assetPlan.coverName, sha256: plan.assetPlan.hashes.cover, size: assets.coverBytes.length, bytes: assets.coverBytes },
    ...plan.assetPlan.screenshotNames.map((name, index) => ({ name, sha256: plan.assetPlan.hashes.screenshots[index], size: assets.screenshotBytes[index].length, bytes: assets.screenshotBytes[index] })),
  ];
}

/**
 * Verify a resumed draft before publishing it. A same-name asset is only
 * reused when authenticated bytes match exactly; otherwise the draft stays
 * unpublished and the tool fails before any catalog mutation.
 */
async function inspectDraftAssets({ github, plan, assets, requireAll = false }) {
  const existing = new Map(((github.releaseView(plan.tag) || {}).assets || []).map((asset) => [asset.name, asset]));
  const reused = [];
  for (const expected of draftAssetExpectations(plan, assets)) {
    const listed = existing.get(expected.name);
    if (!listed) continue;
    let actual = null;
    if (typeof github.downloadAsset === 'function') {
      const inspector = typeof github.inspectDraftAsset === 'function' ? github.inspectDraftAsset(plan.tag, expected.name) : null;
      if (!inspector) throw cleanError('E_PUBLISH_DRAFT_UNVERIFIABLE', `resumed draft asset ${expected.name} could not be resolved through the authenticated API`);
      actual = await github.downloadAsset(inspector);
    } else if (typeof github.verifyDraftAsset === 'function') {
      await github.verifyDraftAsset(plan.tag, expected);
      reused.push(expected.name);
      continue;
    } else {
      throw cleanError('E_PUBLISH_DRAFT_UNVERIFIABLE', 'resumed draft assets cannot be verified by this GitHub adapter; refusing to publish');
    }
    if (!actual || actual.length !== expected.size || sha256(actual) !== expected.sha256) {
      throw cleanError('E_PUBLISH_DRAFT_ASSET_MISMATCH', `draft asset ${expected.name} does not match the approved bytes; delete/fix the draft before publishing`, { asset: expected.name });
    }
    reused.push(expected.name);
  }
  if (requireAll) {
    const expectedNames = draftAssetExpectations(plan, assets).map((item) => item.name);
    const missing = expectedNames.filter((name) => !reused.includes(name));
    if (missing.length > 0) throw cleanError('E_PUBLISH_DRAFT_INCOMPLETE', `draft release is missing assets: ${missing.join(', ')}`);
  }
  return reused;
}

async function uploadRelease({ github, plan, assets, http, transactionDir }) {
  let release = github.releaseView(plan.tag);
  if (release && release.isDraft !== true) {
    // Published release: verify existing assets instead of re-uploading.
    for (const expected of releaseExpectedAssets(plan, assets)) {
      await github.verifyPublicAsset(expected.url, expected, http);
    }
    return { reused: true, release };
  }
  const reusedDraftAssets = release ? await inspectDraftAssets({ github, plan, assets }) : [];
  if (!release) {
    await github.createDraftRelease({
      tag: plan.tag,
      title: `${plan.game.id} v${plan.game.version}`,
      notes: `Community game ${plan.game.id} ${plan.game.version}. Source: ${plan.review.sourceCommit}.`,
    });
    release = github.releaseView(plan.tag);
  }
  const existingAssets = new Set(reusedDraftAssets);
  const packagePath = path.join(transactionDir, plan.assetPlan.packageName);
  const shaPath = path.join(transactionDir, plan.assetPlan.shaName);
  const coverPath = path.join(transactionDir, plan.assetPlan.coverName);
  await fs.writeFile(packagePath, assets.packageBytes);
  await fs.writeFile(shaPath, `${plan.assetPlan.hashes.package}  ${plan.assetPlan.packageName}\n`);
  await fs.writeFile(coverPath, assets.coverBytes);
  const upload = [];
  if (!existingAssets.has(plan.assetPlan.packageName)) upload.push(packagePath);
  if (!existingAssets.has(plan.assetPlan.shaName)) upload.push(shaPath);
  if (!existingAssets.has(plan.assetPlan.coverName)) upload.push(coverPath);
  for (let index = 0; index < plan.assetPlan.screenshotNames.length; index += 1) {
    const target = path.join(transactionDir, plan.assetPlan.screenshotNames[index]);
    await fs.writeFile(target, assets.screenshotBytes[index]);
    if (!existingAssets.has(plan.assetPlan.screenshotNames[index])) upload.push(target);
  }
  github.uploadAssets(plan.tag, upload);
  // Re-read the draft through the authenticated API before publishing so a
  // partial/failed upload can never be published as if it were complete.
  if (typeof github.downloadAsset === 'function') {
    await inspectDraftAssets({ github, plan, assets, requireAll: true });
  }
  github.publishRelease(plan.tag);
  for (const expected of releaseExpectedAssets(plan, assets)) {
    await github.verifyPublicAsset(expected.url, expected, http);
  }
  return { reused: false };
}

/**
 * Build the full candidate content repository in a throwaway copy. This must
 * happen before any remote mutation so an invalid generated index/tag/owner
 * cannot leave a published Release behind.
 */
async function stageCandidate({ registryDir, files, review, catalogText, ownerText, transactionDir, historyBaseDir }) {
  const candidateDir = path.join(transactionDir, 'candidate');
  await fs.cp(registryDir, candidateDir, { recursive: true, filter: (source) => !source.split(path.sep).includes('.git') });
  await writeAtomic(path.join(candidateDir, files.review), `${JSON.stringify(review, null, 2)}\n`);
  await writeAtomic(path.join(candidateDir, files.catalog), catalogText);
  if (ownerText) await writeAtomic(path.join(candidateDir, files.owner), ownerText);
  const candidate = await buildRegistry(candidateDir, { write: true });
  assert(candidate.ok, 'E_PUBLISH_REGISTRY_INVALID', 'generated candidate registry is invalid', candidate.errors);
  if (typeof historyBaseDir === 'string' && historyBaseDir.length > 0) {
    const { validateAgainstBase } = await import('./catalog.mjs');
    const history = await validateAgainstBase(candidateDir, historyBaseDir);
    assert(history.ok, 'E_PUBLISH_HISTORY_INVALID', 'candidate violates trusted catalog history', history.errors);
  }
  return { candidateDir, candidate };
}

/**
 * @param {object} options
 * @param {string} options.submissionPath
 * @param {string} options.reviewPath
 * @param {string} options.registryDir
 * @param {boolean} [options.execute]
 * @param {string} [options.repo]
 * @param {object} [options.github]
 * @param {object} [options.git]
 * @param {object} [options.http]
 * @param {string} [options.baseBranch]
 */
export async function preparePublish(options) {
  const submission = await readJson(options.submissionPath);
  const review = await readJson(options.reviewPath);
  const { validateSubmission, validateReview } = await import('../../../packages/shared/src/community.js');
  // V1.5: package format is explicit and must match the package URL/file name
  // (§1.2). A mismatch is a format policy violation (GM-4282), rejected in the
  // dry-run before anything is downloaded or mutated.
  const submissionFormatResult = submissionFormat(submission);
  if (!submissionFormatResult.ok) throw cleanError('E_FORMAT_POLICY', submissionFormatResult.message);
  const format = submissionFormatResult.format;
  // M2: `validateSubmission` understands both formats natively (it honours
  // `package.format` for the file-name suffix, size ceiling and filesDigest),
  // so the submission is validated exactly as the author wrote it. The previous
  // "validation view" rewrote a `.dshgame.zip` URL to `.html` to satisfy an
  // HTML-only validator; that shim would now hide a real format mismatch.
  const submissionResult = validateSubmission(submission);
  if (!submissionResult.ok) throw cleanError('E_PUBLISH_SUBMISSION', 'submission failed validation', submissionResult.errors);
  const reviewResult = validateReview(review, { submission });
  if (!reviewResult.ok) throw cleanError('E_PUBLISH_REVIEW', 'review failed validation/binding', reviewResult.errors);

  const registryDir = path.resolve(options.registryDir);
  const git = options.git || createGit({ cwd: registryDir });
  assert(git.isRepo(), 'E_PUBLISH_NOT_GIT', 'registry-dir is not a git repository');
  const repo = options.repo || parseGitHubRepo(git.remoteUrl()) || (options.github && options.github.repo);
  assert(repo && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo), 'E_PUBLISH_REPO', 'could not determine the content repository (owner/name)');
  const baseBranch = options.baseBranch || DEFAULT_BASE;
  const existing = await loadExistingCatalog(registryDir);
  assert(existing.ok, 'E_PUBLISH_REGISTRY_INVALID', 'existing content repository is invalid', existing.errors);

  const id = submission.game.id;
  const version = submission.game.version;
  let owner = null;
  try {
    owner = await readOwner(registryDir, id);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  if (owner) {
    const { validateOwner } = await import('../../../packages/shared/src/community.js');
    const ownerCheck = validateOwner(owner, { gameId: id });
    assert(ownerCheck.ok, 'E_PUBLISH_OWNER_INVALID', 'owner record is invalid', ownerCheck.errors);
    assert(owner.owner.githubUserId === submission.author.githubUserId && owner.owner.login.toLowerCase() === submission.author.login.toLowerCase(),
      'E_PUBLISH_OWNER_MISMATCH', 'submission author does not match the registered owner');
  }
  let existingEntry = null;
  let existingSource = null;
  try {
    existingSource = await readJson(path.join(registryDir, 'catalog', `${id}.json`));
    existingEntry = existingSource;
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  const existingLatest = latestCatalogRelease(existingSource);
  if (existingSource) {
    assert(existingLatest, 'E_PUBLISH_REGISTRY_INVALID', 'existing catalog entry has no release');
    const cmp = compareVersions(version, existingLatest.version);
    const sameVersionRelease = findCatalogRelease(existingSource, version);
    const sameBytes = Boolean(sameVersionRelease)
      && sameVersionRelease.package.sha256 === submission.package.sha256
      && sameVersionRelease.package.size === submission.package.size;
    // §5.4.2: a published format cannot be replaced at the same game version
    // (GM-4282). Checked before the generic same-version immutability error so
    // the maintainer gets the actionable message.
    if (sameVersionRelease && sameVersionRelease.format && sameVersionRelease.format !== format) {
      throw cleanError(
        'E_FORMAT_POLICY',
        `package format ${format} cannot replace ${sameVersionRelease.format} at version ${version}; bump the game version`,
      );
    }
    if (cmp === 0 && sameBytes) {
      // Idempotent replay is allowed regardless of submissionType.
    } else {
      assert(submission.submissionType === 'update', 'E_PUBLISH_VERSION_CONFLICT', 'existing game requires an update submission');
      assert(cmp >= 0, 'E_PUBLISH_VERSION_CONFLICT', `new version ${version} must be greater than current ${existingLatest.version}`);
      assert(cmp !== 0, 'E_PUBLISH_VERSION_IMMUTABLE', 'same version with different bytes is not allowed; bump the version');
    }
    // Version rollback (also across generations) is rejected here; the CI
    // history check repeats it against the trusted base.
    assert(cmp >= 0, 'E_PUBLISH_VERSION_CONFLICT', `new version ${version} must be greater than current ${existingLatest.version}`);
  } else {
    assert(submission.submissionType === 'new', 'E_PUBLISH_VERSION_CONFLICT', 'update submission requires an existing catalog entry');
  }
  // V1.5 catalogs are append-only `releases[]` records. ZIP submissions and
  // updates of an existing V1.5 catalog always write the V1.5 shape; a new HTML
  // game keeps the legacy V1.2 shape so existing content repositories and their
  // tests stay byte-compatible.
  const catalogSchema = options.catalogSchema === 2 || isCatalogV2(existingSource) || format === ASSET_ZIP_V2 ? 2 : 1;

  const reviewPath = path.join(registryDir, 'reviews', id, `${version}.json`);
  let existingReview = null;
  let existingReviewText = null;
  try {
    existingReviewText = await fs.readFile(reviewPath, 'utf8');
    existingReview = JSON.parse(existingReviewText);
  } catch (_error) {
    existingReview = null;
  }
  if (existingReview) {
    assert(JSON.stringify(existingReview) === JSON.stringify(review), 'E_PUBLISH_REVIEW_IMMUTABLE', 'review record already exists with different content');
  }
  // Upgrading a V1 (single `release`) catalog to V2 needs the stored review of
  // the historical release to derive its `reviewSha256` binding.
  let historicalReviewText = null;
  if (existingSource && !isCatalogV2(existingSource) && existingLatest) {
    try {
      historicalReviewText = await fs.readFile(
        path.join(registryDir, 'reviews', id, `${existingLatest.version}.json`),
        'utf8',
      );
    } catch (_error) {
      historicalReviewText = null;
    }
  }

  const assets = await downloadSubmissionAssets(submission, options.http || {}, format);
  const plan = buildPlan({
    repo,
    submission,
    review,
    assets,
    existingEntry,
    existingReviewText,
    historicalReviewText,
    baseBranch,
    format,
    catalogSchema,
  });
  const intendedBranch = `catalog/${safeBranchPart(id)}-v${safeBranchPart(version)}-${submission.package.sha256.slice(0, 8)}`;

  const mutations = [];
  const currentBranch = git.currentBranch();
  const cleanWorktree = git.hasCleanWorktree();
  const resumingBranch = currentBranch === intendedBranch && cleanWorktree;
  const onPublishedBase = currentBranch === baseBranch && cleanWorktree;
  const publishedRelease = existingSource ? findCatalogRelease(existingSource, version) : null;
  if (publishedRelease && publishedRelease.package.sha256 === submission.package.sha256 && publishedRelease.package.size === submission.package.size && (!options.execute || onPublishedBase)) {
    return {
      ok: true,
      mode: options.execute ? 'execute' : 'dry-run',
      alreadyPublished: true,
      repo,
      plan,
      mutations,
      message: 'this exact version/bytes is already in the catalog; nothing to publish',
    };
  }

  const transactionDir = await fs.mkdtemp(path.join(options.tempRoot || os.tmpdir(), 'dsh-publish-'));
  const files = plan.files;
  const catalogText = `${JSON.stringify(plan.catalogEntry, null, 2)}\n`;
  const ownerText = owner ? null : `${JSON.stringify({
    schemaVersion: 1,
    gameId: id,
    owner: { login: submission.author.login, githubUserId: submission.author.githubUserId },
    createdAt: plan.release.releasedAt,
  }, null, 2)}\n`;
  try {
    if (!options.execute) {
      // Dry-run still validates the complete candidate so an invalid tag or
      // index fails here, never on the remote.
      await stageCandidate({ registryDir, files, review, catalogText, ownerText, transactionDir, historyBaseDir: options.historyBaseDir });
      await fs.rm(transactionDir, { recursive: true, force: true });
      return { ok: true, mode: 'dry-run', alreadyPublished: false, repo, plan, mutations, downloadedBytes: assets.packageBytes.length };
    }
  } catch (error) {
    await fs.rm(transactionDir, { recursive: true, force: true });
    throw error;
  }

  const github = options.github || createGithub({ repo });
  github.checkAuth();
  const repoInfo = github.repoInfo();
  assert(repoInfo && repoInfo.isPrivate !== true, 'E_PUBLISH_PRIVATE_REPO', 'the content repository must be public');
  assert(cleanWorktree, 'E_PUBLISH_DIRTY', 'content repository has uncommitted changes; commit/stash them before publishing');
  assert(resumingBranch || currentBranch === baseBranch, 'E_PUBLISH_BRANCH', `content repository must be checked out on ${baseBranch} (or the resumable catalog branch)`);
  // Always refresh the trusted base, including resuming an existing branch, so
  // a stale branch cannot silently withdraw/roll back newer catalog entries.
  if (typeof git.fetchOrigin === 'function') git.fetchOrigin(baseBranch);
  if (typeof git.remoteHead === 'function' && typeof git.head === 'function') {
    const remoteHead = git.remoteHead(baseBranch);
    if (remoteHead) {
      if (resumingBranch) {
        if (typeof git.isAncestor === 'function') {
          assert(git.isAncestor(remoteHead, git.head()), 'E_PUBLISH_STALE_BASE', `resumable branch is not based on the latest origin/${baseBranch}; rebase before publishing`);
        }
      } else {
        assert(git.head() === remoteHead, 'E_PUBLISH_STALE_BASE', `local ${baseBranch} is not the latest origin/${baseBranch}; pull/rebase before publishing`);
      }
    }
  }
  let historyBaseDir = options.historyBaseDir;
  let materializedBase = null;
  if (!historyBaseDir && typeof git.materializeRef === 'function') {
    const target = path.join(transactionDir, 'trusted-base');
    try {
      git.materializeRef(`origin/${baseBranch}`, target);
      historyBaseDir = target;
      materializedBase = target;
    } catch (_error) {
      throw cleanError('E_PUBLISH_STALE_BASE', `could not materialize trusted origin/${baseBranch}; refusing to publish without a history baseline`);
    }
  }

  let snapshots = null;
  let committed = false;
  let branchCreated = false;
  let branchSwitched = false;
  let previousBranch = currentBranch;
  const trackedPaths = [files.catalog, ...(ownerText ? [files.owner] : []), files.review, files.registry, files.registryV2];
  async function rollbackLocal(branch) {
    const problems = [];
    try {
      if (snapshots) await restoreFiles(snapshots);
    } catch (error) {
      problems.push(`files: ${error.message}`);
    }
    try {
      if (typeof git.resetPaths === 'function') git.resetPaths(trackedPaths);
      else if (typeof git.run === 'function') git.run(['reset', '-q', '--', ...trackedPaths]);
    } catch (error) {
      problems.push(`index: ${error.message}`);
    }
    try {
      if ((branchCreated || branchSwitched) && typeof git.checkout === 'function') {
        git.checkout(previousBranch);
        if (branchCreated && typeof git.deleteBranch === 'function') git.deleteBranch(branch);
      }
    } catch (error) {
      problems.push(`branch: ${error.message}`);
    }
    if (problems.length > 0) {
      throw cleanError('E_PUBLISH_ROLLBACK_FAILED', `local rollback failed: ${problems.join('; ')}`);
    }
  }
  try {
    await stageCandidate({ registryDir, files, review, catalogText, ownerText, transactionDir, historyBaseDir });
    const draft = await uploadRelease({ github, plan, assets, http: options.http || {}, transactionDir });
    const touched = [files.review, files.catalog, ...(ownerText ? [files.owner] : []), files.registry, files.registryV2].map((relative) => path.join(registryDir, relative));
    snapshots = await Promise.all(touched.map(async (file) => [file, await snapshotFile(file)]));
    await writeAtomic(path.join(registryDir, files.review), `${JSON.stringify(review, null, 2)}\n`);
    await writeAtomic(path.join(registryDir, files.catalog), catalogText);
    if (ownerText) await writeAtomic(path.join(registryDir, files.owner), ownerText);
    const regenerated = await buildRegistry(registryDir, { write: true });
    assert(regenerated.ok, 'E_PUBLISH_REGISTRY_INVALID', 'generated registry is invalid', regenerated.errors);

    const branch = intendedBranch;
    if (typeof git.branchExists === 'function' && git.branchExists(branch)) {
      git.checkout(branch);
      if (branch !== previousBranch) branchSwitched = true;
    } else {
      git.createBranch(branch);
      branchCreated = true;
    }
    git.add(trackedPaths);
    try {
      git.commit(`feat(catalog): publish ${id} ${version}`);
    } catch (error) {
      // A retried transaction may already have committed identical files.
      if (!/nothing to commit|no changes added/i.test(String(error.message || ''))) throw error;
    }
    committed = true;
    git.push(branch);
    let prUrl = '';
    const openPrs = github.listOpenPullRequests(branch);
    if (openPrs.length > 0) prUrl = openPrs[0].url;
    else {
      const body = [
        `## Publish ${submission.game.name} \`${id}@${version}\``,
        '',
        `- Source: ${submission.author.sourceRepo}@${submission.author.sourceCommit}`,
        `- Package SHA-256: \`${submission.package.sha256}\` (${submission.package.size} bytes)`,
        ...(format === ASSET_ZIP_V2 ? [`- File manifest digest: \`${plan.package.filesDigest}\``] : []),
        `- Cover SHA-256: \`${submission.media.cover.sha256}\``,
        `- Screenshots: ${submission.media.screenshots.map((shot) => `\`${shot.sha256}\``).join(', ')}`,
        `- Review: ${review.reviewer.login} at ${review.reviewedAt}`,
        `- Release: ${plan.tag}`,
        `- Format: \`${format}\``,
        `- Files: ${[files.catalog, ...(ownerText ? [files.owner] : []), files.review, files.registry, files.registryV2].join(', ')}`,
        '',
        'Generated by `scripts/registry/prepare.mjs --execute`; merge only after `validate-catalog` passes.',
      ].join('\n');
      prUrl = await github.createPullRequest({ base: baseBranch, head: branch, title: `Publish ${id} ${version}`, body });
    }
    mutations.push('release', 'catalog', 'registry', 'pr');
    return {
      ok: true,
      mode: 'execute',
      alreadyPublished: false,
      repo,
      plan,
      releaseUrl: `https://github.com/${repo}/releases/tag/${encodeURIComponent(plan.tag)}`,
      prUrl,
      branch,
      reusedRelease: draft.reused === true,
      mutations,
      files: [files.catalog, ...(ownerText ? [files.owner] : []), files.review, files.registry, files.registryV2],
    };
  } catch (error) {
    // Before a commit exists, restore files *and* the git index/branch so the
    // transaction can be retried directly. After commit the branch is a
    // resumable transaction and is intentionally kept.
    if (!committed && snapshots) {
      try {
        await rollbackLocal(intendedBranch);
      } catch (rollbackError) {
        throw cleanError('E_PUBLISH_ROLLBACK_FAILED', `publish failed (${error.code || 'E_PUBLISH'}) and rollback failed: ${rollbackError.message}`, {
          original: error.code || 'E_PUBLISH',
          originalMessage: error.message,
          rollback: rollbackError.message,
        });
      }
    }
    throw error;
  } finally {
    if (materializedBase && typeof git.removeWorktree === 'function') git.removeWorktree(materializedBase);
    await fs.rm(transactionDir, { recursive: true, force: true });
  }
}
