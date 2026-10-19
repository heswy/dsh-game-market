import { createHash } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REVIEW_SCHEMA_VERSION,
  catalogEntryFromSubmission,
  validateSubmission,
} from '../../../packages/shared/src/community.js';
import { buildRegistry, initContentRepo } from '../lib/catalog.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const TEMPLATE_DIR = path.join(ROOT, 'templates', 'registry');
const PACKAGE_SHA = 'a'.repeat(64);
const COVER_SHA = 'b'.repeat(64);
const SHOT_SHA = 'c'.repeat(64);

export function fixtureSubmission(overrides = {}) {
  return {
    schemaVersion: 1,
    submissionType: 'new',
    game: {
      id: 'orbit-catch',
      name: 'Orbit Catch',
      version: '1.0.0',
      description: 'A tiny arcade game for catalog tests.',
      categories: ['arcade'],
      tags: ['example'],
      capabilities: ['storage', 'score'],
      sdkVersion: '^1.0.0',
      runtimeVersion: '^1.0.0',
      license: 'MIT',
    },
    author: {
      login: 'example-author',
      githubUserId: 123456,
      sourceRepo: 'https://github.com/example-author/orbit-catch',
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
      buildInstructions: 'npm run build',
    },
    package: {
      url: 'https://github.com/example-author/orbit-catch/releases/download/orbit-catch-v1.0.0/orbit-catch-1.0.0.html',
      sha256: PACKAGE_SHA,
      sha256Url: 'https://github.com/example-author/orbit-catch/releases/download/orbit-catch-v1.0.0/orbit-catch-1.0.0.html.sha256',
      size: 120000,
    },
    media: {
      cover: { url: 'https://example.com/cover.png', sha256: COVER_SHA, size: 50000, type: 'png' },
      screenshots: [{ url: 'https://example.com/shot.png', sha256: SHOT_SHA, size: 40000, type: 'png' }],
    },
    licensing: { codeLicense: 'MIT', assetLicense: 'CC-BY-4.0', archivePermission: true },
    selfTest: {
      ready: true, pauseResume: true, beforeSave: true, continuePlay: true, keyboard: true,
      narrowWindow: true, theme: true, fullBleed: true, safeArea: true, noNetwork: true,
    },
    ...overrides,
  };
}

export function fixtureReview(overrides = {}) {
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    gameId: 'orbit-catch',
    version: '1.0.0',
    decision: 'approved',
    reviewer: { login: 'maintainer', githubUserId: 654321 },
    reviewedAt: '2026-10-19T12:00:00.000Z',
    source: { issueUrl: 'https://github.com/example/registry/issues/1' },
    sourceCommit: '0123456789abcdef0123456789abcdef01234567',
    package: { sha256: PACKAGE_SHA, size: 120000 },
    media: { coverSha256: COVER_SHA, screenshotSha256s: [SHOT_SHA] },
    testEvidence: [{ kind: 'manual', note: 'played 5 minutes' }],
    ...overrides,
  };
}

export function fixtureCatalogEntry() {
  const submission = fixtureSubmission();
  const review = fixtureReview();
  const validation = validateSubmission(submission);
  if (!validation.ok) throw new Error(JSON.stringify(validation.errors));
  return catalogEntryFromSubmission({
    submission,
    review,
    release: {
      tag: 'orbit-catch-v1.0.0',
      releasedAt: '2026-10-19T12:00:00.000Z',
      packageUrl: submission.package.url,
      packageSha256: PACKAGE_SHA,
      packageSize: 120000,
      cover: { url: submission.media.cover.url },
      screenshots: [{ url: submission.media.screenshots[0].url }],
    },
  });
}

export async function makeContentRepo({ withEntry = true } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-registry-test-'));
  await initContentRepo({
    target: directory,
    templateDir: TEMPLATE_DIR,
    platformRepo: 'example/platform',
    platformCommit: '0123456789abcdef0123456789abcdef01234567',
    platformVersion: '1.1.0',
    generatedAt: '2026-10-19T12:00:00.000Z',
  });
  if (withEntry) {
    const entry = fixtureCatalogEntry();
    const review = fixtureReview();
    await fs.writeFile(path.join(directory, 'catalog', 'orbit-catch.json'), JSON.stringify(entry, null, 2) + '\n');
    await fs.writeFile(path.join(directory, 'owners', 'orbit-catch.json'), JSON.stringify({
      schemaVersion: 1,
      gameId: 'orbit-catch',
      owner: { login: 'example-author', githubUserId: 123456 },
      createdAt: '2026-10-19T12:00:00.000Z',
    }, null, 2) + '\n');
    await fs.mkdir(path.join(directory, 'reviews', 'orbit-catch'), { recursive: true });
    await fs.writeFile(path.join(directory, 'reviews', 'orbit-catch', '1.0.0.json'), JSON.stringify(review, null, 2) + '\n');
  }
  return directory;
}

export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

/** Submission/review fixture matching docs/verification/v1/fixtures/packages/jump-1.0.0.html. */
export async function prepareFixtures() {
  const fs = await import('node:fs/promises');
  const pkg = await fs.readFile(path.join(ROOT, 'docs/verification/v1/fixtures/packages/jump-1.0.0.html'));
  const pkgSha = createHash('sha256').update(pkg).digest('hex');
  const mediaSha = createHash('sha256').update(PNG_1X1).digest('hex');
  const submission = {
    schemaVersion: 1,
    submissionType: 'new',
    game: {
      id: 'jump',
      name: 'Jump',
      version: '1.0.0',
      description: 'Vertical platformer fixture used by the publishing-tool tests.',
      categories: ['arcade', 'action'],
      tags: ['jump'],
      capabilities: ['storage', 'score'],
      sdkVersion: '^1.0.0',
      runtimeVersion: '^1.0.0',
      license: 'MIT',
    },
    author: {
      login: 'example-author',
      githubUserId: 123456,
      sourceRepo: 'https://github.com/example-author/jump',
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
      buildInstructions: 'npm run build',
    },
    package: {
      url: 'https://github.com/example-author/jump/releases/download/jump-v1.0.0/jump-1.0.0.html',
      sha256: pkgSha,
      sha256Url: 'https://github.com/example-author/jump/releases/download/jump-v1.0.0/jump-1.0.0.html.sha256',
      size: pkg.length,
    },
    media: {
      cover: { url: 'https://example.com/cover.png', sha256: mediaSha, size: PNG_1X1.length, type: 'png' },
      screenshots: [
        { url: 'https://example.com/shot-1.png', sha256: mediaSha, size: PNG_1X1.length, type: 'png' },
      ],
    },
    licensing: { codeLicense: 'MIT', assetLicense: 'CC-BY-4.0', archivePermission: true },
    selfTest: {
      ready: true, pauseResume: true, beforeSave: true, continuePlay: true, keyboard: true,
      narrowWindow: true, theme: true, fullBleed: true, safeArea: true, noNetwork: true,
    },
  };
  const review = {
    schemaVersion: 1,
    gameId: 'jump',
    version: '1.0.0',
    decision: 'approved',
    reviewer: { login: 'maintainer', githubUserId: 654321 },
    reviewedAt: '2026-10-19T12:00:00.000Z',
    source: { issueUrl: 'https://github.com/example/registry/issues/1' },
    sourceCommit: submission.author.sourceCommit,
    package: { sha256: pkgSha, size: pkg.length },
    media: { coverSha256: mediaSha, screenshotSha256s: [mediaSha] },
    testEvidence: [{ kind: 'manual', note: 'played 5 minutes in an isolated Runtime' }],
  };
  return { submission, review, pkg, pkgSha, mediaSha };
}

export function makeHttpMock(urls) {
  return {
    fetch: async (url) => {
      const body = urls.get(url);
      if (!body) return new Response('missing', { status: 404 });
      return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
    },
    resolveHost: async () => [{ address: '203.0.113.7', family: 4 }],
    retries: 0,
  };
}

export function makeFakeGit({ repo = 'https://github.com/example/registry.git', clean = true, branch = 'main', ancestor = true, failCommit = false, failReset = false } = {}) {
  const calls = [];
  let current = branch;
  const branches = new Set([branch]);
  return {
    calls,
    isRepo: () => true,
    remoteUrl: () => repo,
    hasCleanWorktree: () => clean,
    currentBranch: () => current,
    fetchOrigin(name) { calls.push(['fetchOrigin', name]); },
    remoteHead: () => 'head-with-latest-base',
    head: () => 'head-with-latest-base',
    branchExists: (name) => branches.has(name),
    isAncestor: () => ancestor,
    checkout(name) { calls.push(['checkout', name]); current = name; },
    createBranch(name) { calls.push(['createBranch', name]); branches.add(name); current = name; },
    add(paths) { calls.push(['add', paths]); },
    commit(message) { calls.push(['commit', message]); if (failCommit) throw Object.assign(new Error('simulated commit hook rejection'), { code: 'E_PUBLISH_GIT' }); },
    push(name) { calls.push(['push', name]); },
    resetPaths(paths) { calls.push(['resetPaths', paths]); if (failReset) throw new Error('simulated index lock'); return 0; },
    deleteBranch(name) { calls.push(['deleteBranch', name]); return 0; },
  };
}

export function makeFakeGithub({ failOnUpload = false, failVerifyOnce = false, failPullRequestOnce = false, draftAssets = null } = {}) {
  const releases = new Map();
  const prs = [];
  const calls = [];
  let verifyFailures = failVerifyOnce ? 1 : 0;
  let prFailures = failPullRequestOnce ? 1 : 0;
  if (draftAssets && draftAssets.tag) {
    releases.set(draftAssets.tag, {
      draft: true,
      assets: (draftAssets.assets || []).map((asset, index) => ({ id: index + 1, name: asset.name, bytes: Buffer.from(asset.bytes) })),
    });
  }
  return {
    repo: 'example/registry',
    calls,
    releases,
    prs,
    checkAuth() { calls.push(['checkAuth']); return true; },
    repoInfo() { return { nameWithOwner: 'example/registry', isPrivate: false, visibility: 'PUBLIC', defaultBranchRef: { name: 'main' } }; },
    releaseView(tag) {
      const release = releases.get(tag);
      return release ? { tagName: tag, isDraft: release.draft, assets: release.assets.map((item) => ({ id: item.id, name: item.name, size: item.bytes ? item.bytes.length : 0 })) } : null;
    },
    async createDraftRelease({ tag }) { calls.push(['createDraftRelease', tag]); releases.set(tag, { draft: true, assets: [] }); },
    uploadAssets(tag, files) {
      calls.push(['uploadAssets', tag, files.length]);
      if (failOnUpload) throw Object.assign(new Error('simulated upload failure'), { code: 'E_PUBLISH_GH' });
      const release = releases.get(tag);
      for (const file of files) {
        const name = path.basename(file);
        const bytes = readFileSync(file);
        release.assets.push({ id: release.assets.length + 1, name, bytes });
      }
    },
    inspectDraftAsset(tag, name) {
      const release = releases.get(tag);
      const asset = release && release.assets.find((item) => item.name === name);
      return asset ? { id: asset.id, name: asset.name, size: asset.bytes.length } : null;
    },
    downloadAsset(asset) {
      const all = [...releases.values()].flatMap((release) => release.assets);
      const found = all.find((item) => item.name === asset.name) || all.find((item) => item.id === asset.id);
      if (found) return found.bytes;
      throw Object.assign(new Error('missing fake asset'), { code: 'E_PUBLISH_GH' });
    },
    publishRelease(tag) { calls.push(['publishRelease', tag]); releases.get(tag).draft = false; },
    listOpenPullRequests(head) { return prs.filter((pr) => pr.branch === head); },
    async createPullRequest({ head }) {
      calls.push(['createPullRequest', head]);
      if (prFailures > 0) { prFailures -= 1; throw Object.assign(new Error('simulated PR failure'), { code: 'E_PUBLISH_GH' }); }
      const url = `https://github.com/example/registry/pull/${prs.length + 1}`;
      prs.push({ branch: head, url });
      return url;
    },
    async verifyPublicAsset(url) { calls.push(['verifyPublicAsset', url]); if (verifyFailures > 0) { verifyFailures -= 1; throw Object.assign(new Error('simulated public asset failure'), { code: 'E_PUBLISH_PUBLIC_ASSET' }); } return { finalUrl: url }; },
  };
}

export async function makeEmptyContentRepo() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-registry-empty-'));
  await initContentRepo({
    target: directory,
    templateDir: TEMPLATE_DIR,
    platformRepo: 'example/dsh-game-market',
    platformCommit: '0123456789abcdef0123456789abcdef01234567',
    platformVersion: '1.2.0',
    generatedAt: '2026-10-19T12:00:00.000Z',
  });
  const generated = await buildRegistry(directory, { write: true });
  if (!generated.ok) throw new Error(JSON.stringify(generated.errors));
  return directory;
}
