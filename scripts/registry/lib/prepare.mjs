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

import { compareVersions } from '../../../packages/host/src/semver.js';
import {
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

function buildAssetPlan(repo, submission, tag, hashes) {
  const id = submission.game.id;
  const version = submission.game.version;
  const packageName = `${id}-${version}.html`;
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
  };
}

async function loadExistingCatalog(root) {
  const result = await buildRegistry(root, { check: true });
  return result;
}

async function downloadSubmissionAssets(submission, http) {
  const packageResult = await downloadVerified(submission.package.url, { sha256: submission.package.sha256, size: submission.package.size }, http, 'package');
  await downloadShaFile(submission.package.sha256Url, submission.package.sha256, http);
  const coverResult = await downloadVerified(submission.media.cover.url, submission.media.cover, http, 'cover');
  const screenshots = [];
  for (let index = 0; index < submission.media.screenshots.length; index += 1) {
    screenshots.push(await downloadVerified(submission.media.screenshots[index].url, submission.media.screenshots[index], http, `screenshot-${index + 1}`));
  }
  const packageManifest = validatePackageBytes({
    bytes: packageResult.bytes,
    id: submission.game.id,
    version: submission.game.version,
  });
  validateMediaBytes({ bytes: coverResult.bytes, media: submission.media.cover, label: 'cover' });
  for (let index = 0; index < screenshots.length; index += 1) {
    validateMediaBytes({ bytes: screenshots[index].bytes, media: submission.media.screenshots[index], label: `screenshot-${index + 1}` });
  }
  return { packageBytes: packageResult.bytes, packageManifest, coverBytes: coverResult.bytes, screenshotBytes: screenshots.map((item) => item.bytes) };
}

function buildPlan({ repo, submission, review, assets, existingIndex, existingEntry, baseBranch }) {
  const id = submission.game.id;
  const version = submission.game.version;
  const tag = `${id}-v${version}`;
  const hashes = {
    package: submission.package.sha256,
    cover: submission.media.cover.sha256,
    screenshots: submission.media.screenshots.map((shot) => shot.sha256),
    sourceCommit: review.sourceCommit,
  };
  const assetPlan = buildAssetPlan(repo, submission, tag, hashes);
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
  const catalogEntry = catalogEntryFromSubmissionSafe({ submission, review, release });
  assert(catalogEntry, 'E_PUBLISH_INTERNAL', 'could not build the catalog entry');
  const entries = (existingIndex && Array.isArray(existingIndex.games) ? existingIndex.games.map((game) => {
    // Reconstruct source entries from the generated index is lossy; the caller
    // passes existing catalog source entries separately in execute mode.
    return game;
  }) : []);
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
    selfTest: submission.selfTest,
    review: { reviewedAt: review.reviewedAt, reviewer: review.reviewer, sourceCommit: review.sourceCommit },
    entriesToMerge: entries,
  };
}

async function writeAtomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temp, text, { mode: 0o644 });
  await fs.rename(temp, file);
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

async function uploadRelease({ github, plan, assets, http, transactionDir }) {
  let release = github.releaseView(plan.tag);
  if (release && release.isDraft !== true) {
    // Published release: verify existing assets instead of re-uploading.
    for (const expected of releaseExpectedAssets(plan, assets)) {
      await github.verifyPublicAsset(expected.url, expected, http);
    }
    return { reused: true, release };
  }
  if (!release) {
    await github.createDraftRelease({
      tag: plan.tag,
      title: `${plan.game.id} v${plan.game.version}`,
      notes: `Community game ${plan.game.id} ${plan.game.version}. Source: ${plan.review.sourceCommit}.`,
    });
  }
  const existingAssets = new Set(((release && release.assets) || []).map((asset) => asset && asset.name).filter(Boolean));
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
  github.publishRelease(plan.tag);
  for (const expected of releaseExpectedAssets(plan, assets)) {
    await github.verifyPublicAsset(expected.url, expected, http);
  }
  return { reused: false };
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
  if (existingSource) {
    const cmp = compareVersions(version, existingSource.game.version);
    const sameBytes = existingSource.release.packageSha256 === submission.package.sha256 && existingSource.release.packageSize === submission.package.size;
    if (cmp === 0 && sameBytes) {
      // Idempotent replay is allowed regardless of submissionType.
    } else {
      assert(submission.submissionType === 'update', 'E_PUBLISH_VERSION_CONFLICT', 'existing game requires an update submission');
      assert(cmp >= 0, 'E_PUBLISH_VERSION_CONFLICT', `new version ${version} must be greater than current ${existingSource.game.version}`);
      assert(cmp !== 0, 'E_PUBLISH_VERSION_IMMUTABLE', 'same version with different bytes is not allowed; bump the version');
    }
  } else {
    assert(submission.submissionType === 'new', 'E_PUBLISH_VERSION_CONFLICT', 'update submission requires an existing catalog entry');
  }

  const assets = await downloadSubmissionAssets(submission, options.http || {});
  const plan = buildPlan({ repo, submission, review, assets, existingIndex: existing.index, existingEntry, baseBranch });
  const intendedBranch = `catalog/${safeBranchPart(id)}-v${safeBranchPart(version)}-${submission.package.sha256.slice(0, 8)}`;
  const reviewPath = path.join(registryDir, 'reviews', id, `${version}.json`);
  let existingReview = null;
  try { existingReview = await readJson(reviewPath); } catch (_error) { /* missing is expected */ }
  if (existingReview) {
    assert(JSON.stringify(existingReview) === JSON.stringify(review), 'E_PUBLISH_REVIEW_IMMUTABLE', 'review record already exists with different content');
  }

  const mutations = [];
  const currentBranch = git.currentBranch();
  const cleanWorktree = git.hasCleanWorktree();
  const resumingBranch = currentBranch === intendedBranch && cleanWorktree;
  const onPublishedBase = currentBranch === baseBranch && cleanWorktree;
  if (existingSource && existingSource.release.packageSha256 === submission.package.sha256 && (!options.execute || onPublishedBase)) {
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

  if (!options.execute) {
    return { ok: true, mode: 'dry-run', alreadyPublished: false, repo, plan, mutations, downloadedBytes: assets.packageBytes.length };
  }

  const github = options.github || createGithub({ repo });
  github.checkAuth();
  const repoInfo = github.repoInfo();
  assert(repoInfo && repoInfo.isPrivate !== true, 'E_PUBLISH_PRIVATE_REPO', 'the content repository must be public');
  assert(cleanWorktree, 'E_PUBLISH_DIRTY', 'content repository has uncommitted changes; commit/stash them before publishing');
  assert(resumingBranch || currentBranch === baseBranch, 'E_PUBLISH_BRANCH', `content repository must be checked out on ${baseBranch} (or the resumable catalog branch)`);
  if (!resumingBranch) {
    if (typeof git.fetchOrigin === 'function') git.fetchOrigin(baseBranch);
    if (typeof git.remoteHead === 'function' && typeof git.head === 'function') {
      const remoteHead = git.remoteHead(baseBranch);
      if (remoteHead) assert(git.head() === remoteHead, 'E_PUBLISH_STALE_BASE', `local ${baseBranch} is not the latest origin/${baseBranch}; pull/rebase before publishing`);
    }
  }

  const transactionDir = await fs.mkdtemp(path.join(options.tempRoot || os.tmpdir(), 'dsh-publish-'));
  try {
    const draft = await uploadRelease({ github, plan, assets, http: options.http || {}, transactionDir });
    const files = plan.files;
    const catalogText = `${JSON.stringify(plan.catalogEntry, null, 2)}\n`;
    const ownerText = owner ? null : `${JSON.stringify({
      schemaVersion: 1,
      gameId: id,
      owner: { login: submission.author.login, githubUserId: submission.author.githubUserId },
      createdAt: plan.release.releasedAt,
    }, null, 2)}\n`;
    await writeAtomic(path.join(registryDir, files.review), `${JSON.stringify(review, null, 2)}\n`);
    await writeAtomic(path.join(registryDir, files.catalog), catalogText);
    if (ownerText) await writeAtomic(path.join(registryDir, files.owner), ownerText);
    const regenerated = await buildRegistry(registryDir, { write: true });
    assert(regenerated.ok, 'E_PUBLISH_REGISTRY_INVALID', 'generated registry is invalid', regenerated.errors);

    const branch = intendedBranch;
    if (typeof git.branchExists === 'function' && git.branchExists(branch)) git.checkout(branch);
    else git.createBranch(branch);
    git.add([files.catalog, ...(ownerText ? [files.owner] : []), files.review, files.registry]);
    try {
      git.commit(`feat(catalog): publish ${id} ${version}`);
    } catch (error) {
      // A retried transaction may already have committed identical files.
      if (!/nothing to commit|no changes added/i.test(String(error.message || ''))) throw error;
    }
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
        `- Cover SHA-256: \`${submission.media.cover.sha256}\``,
        `- Screenshots: ${submission.media.screenshots.map((shot) => `\`${shot.sha256}\``).join(', ')}`,
        `- Review: ${review.reviewer.login} at ${review.reviewedAt}`,
        `- Release: ${plan.tag}`,
        `- Files: ${[files.catalog, ...(ownerText ? [files.owner] : []), files.review, files.registry].join(', ')}`,
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
      files: [files.catalog, ...(ownerText ? [files.owner] : []), files.review, files.registry],
    };
  } finally {
    await fs.rm(transactionDir, { recursive: true, force: true });
  }
}
