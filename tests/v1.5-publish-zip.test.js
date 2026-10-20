/**
 * M2-D: end-to-end tests for publishing an `asset-zip-v2` game.
 *
 * Covers the M1 gap (the publishing toolchain only understood single-file HTML)
 * across the full chain: download → archive validation (real Host ZIP pipeline)
 * → catalog v2 with outer sha256 + inner `filesDigest` → both generated indexes.
 *
 * Falsifiability: the archive checks are exercised with *valid* ZIP fixtures that
 * publish successfully and with mutated archives that must be rejected by the
 * same code path, so a "rejected" assertion cannot pass just because the ZIP
 * pipeline was never attempted.
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { REVIEW_SCHEMA_VERSION } from '../packages/shared/src/community.js';
import { fileManifestDigest } from '../packages/shared/src/package-v2.js';
import { preparePublish } from '../scripts/registry/lib/prepare.mjs';
import {
  buildRegistry,
  readRegistryIndex,
  readRegistryV2Index,
  validateAgainstBase,
} from '../scripts/registry/lib/catalog.mjs';
import { validateAssets } from '../scripts/registry/validate-assets.mjs';
import {
  makeEmptyContentRepo,
  makeFakeGit,
  makeFakeGithub,
  makeHttpMock,
  PNG_1X1,
  prepareFixtures,
} from '../scripts/registry/test/helpers.mjs';
import { buildZip } from './helpers/zip-builder.mjs';
import {
  buildGameManifest,
  buildPackage,
  defaultFiles,
  packageEntries,
  sha256Hex,
} from './helpers/zip-package.mjs';

const GAME_ID = 'jump';
const ZIP_VERSION = '1.1.0';
const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const MEDIA_SHA = sha256Hex(PNG_1X1);

/** Digest of the descriptor's file manifest (the catalog `filesDigest`). */
function filesDigestOf(pkg) {
  return fileManifestDigest(pkg.descriptor.files, (text) => sha256Hex(Buffer.from(text, 'utf8')));
}

/** Deterministic valid `asset-zip-v2` package. */
function zipPackage(version, { scriptContent } = {}) {
  const files = defaultFiles();
  files.set(
    'game.json',
    Buffer.from(JSON.stringify(buildGameManifest({ id: GAME_ID, name: 'Jump', version }), null, 2)),
  );
  if (scriptContent !== undefined) files.set('scripts/main.js', Buffer.from(scriptContent));
  return buildPackage(files);
}

function releaseBaseUrl(version) {
  return `https://github.com/example-author/${GAME_ID}/releases/download/${GAME_ID}-v${version}`;
}

function zipSubmission({ version = ZIP_VERSION, zip, declaredFilesDigest, submissionType = 'update' } = {}) {
  const sha256 = sha256Hex(zip);
  const base = releaseBaseUrl(version);
  const fileName = `${GAME_ID}-${version}.dshgame.zip`;
  return {
    schemaVersion: 1,
    submissionType,
    ...(submissionType === 'update'
      ? { update: { changelog: `${GAME_ID} ${version} asset-zip-v2 release`, saveCompatibility: 'compatible' } }
      : {}),
    game: {
      id: GAME_ID,
      name: 'Jump',
      version,
      description: 'Vertical platformer fixture used by the ZIP publishing-tool tests.',
      categories: ['arcade'],
      tags: ['jump', 'zip'],
      capabilities: ['storage', 'score'],
      sdkVersion: '^1.0.0',
      runtimeVersion: '^1.0.0',
      license: 'MIT',
    },
    author: {
      login: 'example-author',
      githubUserId: 123456,
      sourceRepo: `https://github.com/example-author/${GAME_ID}`,
      sourceCommit: SOURCE_COMMIT,
      buildInstructions: 'npm run build && dsh-game pack',
    },
    package: {
      format: 'asset-zip-v2',
      url: `${base}/${fileName}`,
      sha256,
      sha256Url: `${base}/${fileName}.sha256`,
      size: zip.length,
      ...(declaredFilesDigest === undefined ? {} : { filesDigest: declaredFilesDigest }),
    },
    media: {
      cover: { url: `${base}/cover-${version}.png`, sha256: MEDIA_SHA, size: PNG_1X1.length, type: 'png' },
      screenshots: [
        {
          url: `${base}/screenshot-1-${version}.png`,
          sha256: MEDIA_SHA,
          size: PNG_1X1.length,
          type: 'png',
        },
      ],
    },
    licensing: { codeLicense: 'MIT', assetLicense: 'CC-BY-4.0', archivePermission: true },
    selfTest: {
      ready: true,
      pauseResume: true,
      beforeSave: true,
      continuePlay: true,
      keyboard: true,
      narrowWindow: true,
      theme: true,
      fullBleed: true,
      safeArea: true,
      noNetwork: true,
    },
  };
}

function reviewFor(submission) {
  const fileName = path.basename(new URL(submission.package.url).pathname);
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    gameId: submission.game.id,
    version: submission.game.version,
    decision: 'approved',
    reviewer: { login: 'maintainer', githubUserId: 654321 },
    reviewedAt: '2026-10-20T12:00:00.000Z',
    source: { issueUrl: 'https://github.com/example/registry/issues/7' },
    sourceCommit: submission.author.sourceCommit,
    package: { sha256: submission.package.sha256, size: submission.package.size },
    media: { coverSha256: submission.media.cover.sha256, screenshotSha256s: submission.media.screenshots.map((shot) => shot.sha256) },
    testEvidence: [{ kind: 'manual', note: `played ${fileName} for 5 minutes in an isolated Runtime` }],
  };
}

function httpFor(submission, { packageBytes = null } = {}) {
  const urls = new Map();
  const fileName = path.basename(new URL(submission.package.url).pathname);
  urls.set(submission.package.url, packageBytes || Buffer.alloc(0));
  urls.set(submission.package.sha256Url, Buffer.from(`${submission.package.sha256}  ${fileName}\n`));
  urls.set(submission.media.cover.url, PNG_1X1);
  for (const shot of submission.media.screenshots) urls.set(shot.url, PNG_1X1);
  return makeHttpMock(urls);
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function snapshot(root) {
  const output = [];
  async function walk(directory) {
    for (const name of (await fs.readdir(directory)).sort()) {
      if (name === '.git') continue;
      const target = path.join(directory, name);
      const stat = await fs.stat(target);
      if (stat.isDirectory()) await walk(target);
      else output.push([path.relative(root, target), sha256Hex(await fs.readFile(target))]);
    }
  }
  await walk(root);
  return output;
}

async function tempDir(t, prefix) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

/** Valid ZIP submission context on an empty content repository. */
async function zipContext(t, { version = ZIP_VERSION, declaredFilesDigest, zipOverrides } = {}) {
  const base = await tempDir(t, 'dsh-publish-zip-test-');
  const pkg = zipPackage(version);
  const submission = zipSubmission({
    version,
    zip: pkg.zip,
    submissionType: 'new',
    ...(declaredFilesDigest === undefined ? {} : { declaredFilesDigest }),
    ...(zipOverrides || {}),
  });
  const review = reviewFor(submission);
  const submissionPath = path.join(base, 'submission.json');
  const reviewPath = path.join(base, 'review.json');
  await writeJson(submissionPath, submission);
  await writeJson(reviewPath, review);
  const content = await makeEmptyContentRepo();
  t.after(() => fs.rm(content, { recursive: true, force: true }));
  return {
    base,
    content,
    pkg,
    submission,
    review,
    submissionPath,
    reviewPath,
    filesDigest: filesDigestOf(pkg),
    http: httpFor(submission, { packageBytes: pkg.zip }),
  };
}

/** Publish the shared HTML fixture (jump 1.0.0) so a repo has an HTML release. */
async function publishHtmlFixture(t) {
  const content = await makeEmptyContentRepo();
  t.after(() => fs.rm(content, { recursive: true, force: true }));
  const fixtures = await prepareFixtures();
  const base = await tempDir(t, 'dsh-publish-zip-html-fixture-');
  const submissionPath = path.join(base, 'submission.json');
  const reviewPath = path.join(base, 'review.json');
  await writeJson(submissionPath, fixtures.submission);
  await writeJson(reviewPath, fixtures.review);
  const urls = new Map([
    [fixtures.submission.package.url, fixtures.pkg],
    [fixtures.submission.package.sha256Url, Buffer.from(`${fixtures.pkgSha}  jump-1.0.0.html\n`)],
    [fixtures.submission.media.cover.url, PNG_1X1],
    [fixtures.submission.media.screenshots[0].url, PNG_1X1],
  ]);
  const result = await publish({
    submissionPath,
    reviewPath,
    registryDir: content,
    execute: true,
    git: makeFakeGit(),
    github: makeFakeGithub(),
    http: makeHttpMock(urls),
  });
  assert.equal(result.mode, 'execute');
  return { content, fixtures };
}

function publish(options) {
  return preparePublish({ repo: 'example/registry', ...options });
}

/** Publish one valid ZIP release into `content` and return its filesDigest. */
async function publishZip(t, content, { version = ZIP_VERSION, submissionType = 'new' } = {}) {
  const pkg = zipPackage(version, { scriptContent: `document.body.textContent = '${version}';\n` });
  const submission = zipSubmission({ version, zip: pkg.zip, submissionType });
  const review = reviewFor(submission);
  const base = await tempDir(t, 'dsh-publish-zip-run-');
  const submissionPath = path.join(base, 'submission.json');
  const reviewPath = path.join(base, 'review.json');
  await writeJson(submissionPath, submission);
  await writeJson(reviewPath, review);
  const result = await publish({
    submissionPath,
    reviewPath,
    registryDir: content,
    execute: true,
    git: makeFakeGit(),
    github: makeFakeGithub(),
    http: httpFor(submission, { packageBytes: pkg.zip }),
  });
  return { result, pkg, submission, filesDigest: filesDigestOf(pkg) };
}

// ---------------------------------------------------------------------------
// Dry-run: complete archive validation, zero remote/local mutation
// ---------------------------------------------------------------------------

test('dry-run validates the ZIP archive and plans filesDigest with zero mutation', async (t) => {
  const ctx = await zipContext(t);
  const before = await snapshot(ctx.content);
  const git = makeFakeGit();
  const github = makeFakeGithub();
  const result = await publish({
    submissionPath: ctx.submissionPath,
    reviewPath: ctx.reviewPath,
    registryDir: ctx.content,
    execute: false,
    git,
    github,
    http: ctx.http,
  });
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.alreadyPublished, false);
  assert.equal(git.calls.length, 0);
  assert.equal(github.calls.length, 0);
  assert.deepEqual(await snapshot(ctx.content), before, 'dry-run must not touch the content repository');

  // Release asset naming (§1.2) and inner manifest binding.
  assert.equal(result.plan.assetPlan.packageName, 'jump-1.1.0.dshgame.zip');
  assert.equal(result.plan.assetPlan.shaName, 'jump-1.1.0.dshgame.zip.sha256');
  assert.equal(result.plan.assetPlan.hashes.package, sha256Hex(ctx.pkg.zip));
  assert.equal(result.plan.package.format, 'asset-zip-v2');
  assert.equal(result.plan.package.fileCount, ctx.pkg.descriptor.files.length);
  assert.equal(result.plan.package.filesDigest, ctx.filesDigest);
  assert.match(result.plan.assetPlan.coverUrl, /cover-1\.1\.0\.png$/);
  assert.match(result.plan.assetPlan.screenshotUrls[0], /screenshot-1-1\.1\.0\.png$/);

  // Catalog v2 release binds outer sha256 AND the inner file-manifest digest.
  assert.equal(result.plan.catalogEntry.schemaVersion, 2);
  const release = result.plan.catalogEntry.releases.find((item) => item.version === '1.1.0');
  assert.ok(release, 'planned catalog must contain the new release');
  assert.equal(release.format, 'asset-zip-v2');
  assert.equal(release.package.sha256, sha256Hex(ctx.pkg.zip));
  assert.equal(release.package.size, ctx.pkg.zip.length);
  assert.equal(release.package.filesDigest, ctx.filesDigest);
  assert.equal(
    release.package.url,
    'https://github.com/example/registry/releases/download/jump-v1.1.0/jump-1.1.0.dshgame.zip',
  );
  assert.equal(result.plan.assetPlan.packageUrl, release.package.url);
});

// ---------------------------------------------------------------------------
// Execute: download -> archive validation -> catalog v2 -> both indexes
// ---------------------------------------------------------------------------

test('execute publishes a ZIP: exact bytes uploaded, catalog v2 bound, both indexes generated', async (t) => {
  const ctx = await zipContext(t);
  const git = makeFakeGit();
  const github = makeFakeGithub();
  const result = await publish({
    submissionPath: ctx.submissionPath,
    reviewPath: ctx.reviewPath,
    registryDir: ctx.content,
    execute: true,
    git,
    github,
    http: ctx.http,
  });
  assert.equal(result.mode, 'execute');
  assert.equal(result.plan.assetPlan.packageName, 'jump-1.1.0.dshgame.zip');
  assert.match(result.releaseUrl, /releases\/tag\/jump-v1\.1\.0/);
  assert.match(result.prUrl, /\/pull\/1$/);
  assert.equal(github.prs.length, 1);

  // The published release asset is exactly the author's ZIP bytes, and the
  // .sha256 companion file references that digest + file name.
  const release = github.releases.get('jump-v1.1.0');
  assert.equal(release.draft, false);
  const uploads = new Map(release.assets.map((asset) => [asset.name, asset.bytes]));
  assert.deepEqual(uploads.get('jump-1.1.0.dshgame.zip'), ctx.pkg.zip);
  assert.deepEqual(
    uploads.get('jump-1.1.0.dshgame.zip.sha256'),
    Buffer.from(`${sha256Hex(ctx.pkg.zip)}  jump-1.1.0.dshgame.zip\n`),
  );

  // Catalog v2 is append-only + bound to outer sha256 and filesDigest.
  const catalog = JSON.parse(await fs.readFile(path.join(ctx.content, 'catalog', 'jump.json'), 'utf8'));
  assert.equal(catalog.schemaVersion, 2);
  assert.equal(catalog.gameId, 'jump');
  assert.equal(catalog.releases.length, 1);
  assert.equal(catalog.releases[0].format, 'asset-zip-v2');
  assert.equal(catalog.releases[0].package.sha256, sha256Hex(ctx.pkg.zip));
  assert.equal(catalog.releases[0].package.filesDigest, ctx.filesDigest);
  assert.equal(catalog.releases[0].sourceCommit, SOURCE_COMMIT);
  assert.match(catalog.releases[0].reviewSha256, /^[a-f0-9]{64}$/);

  // Projections: no HTML release yet -> absent from the v1 index, present in v2.
  const v1 = await readRegistryIndex(ctx.content);
  const v2 = await readRegistryV2Index(ctx.content);
  assert.deepEqual(v1.games, []);
  assert.equal(v2.registryVersion, 2);
  assert.equal(v2.games.length, 1);
  assert.equal(v2.games[0].id, 'jump');
  assert.equal(v2.games[0].version, '1.1.0');
  assert.equal(v2.games[0].package.format, 'asset-zip-v2');
  assert.equal(v2.games[0].package.filesDigest, ctx.filesDigest);

  // Generated indexes are current and deterministic (regenerating is a no-op).
  assert.equal((await buildRegistry(ctx.content, { check: true })).ok, true);
  const v1Bytes = await fs.readFile(path.join(ctx.content, 'registry', 'games.json'));
  const v2Bytes = await fs.readFile(path.join(ctx.content, 'registry', 'v2', 'games.json'));
  assert.equal((await buildRegistry(ctx.content, { write: true })).ok, true);
  assert.deepEqual(await fs.readFile(path.join(ctx.content, 'registry', 'games.json')), v1Bytes);
  assert.deepEqual(await fs.readFile(path.join(ctx.content, 'registry', 'v2', 'games.json')), v2Bytes);

  // Same version + same bytes is a resume, not a duplicate release/PR.
  const replay = await publish({
    submissionPath: ctx.submissionPath,
    reviewPath: ctx.reviewPath,
    registryDir: ctx.content,
    execute: true,
    git,
    github,
    http: ctx.http,
  });
  assert.equal(replay.prUrl, result.prUrl);
  assert.equal(github.prs.length, 1);
  const replayedCatalog = JSON.parse(await fs.readFile(path.join(ctx.content, 'catalog', 'jump.json'), 'utf8'));
  assert.equal(replayedCatalog.releases.length, 1, 'replay must not append a duplicate version');
  assert.deepEqual(
    await fs.readFile(path.join(ctx.content, 'registry', 'v2', 'games.json')),
    v2Bytes,
    'replay must not perturb the generated index',
  );
});

// ---------------------------------------------------------------------------
// Double projection: newest ZIP, v1 keeps the previous HTML release
// ---------------------------------------------------------------------------

test('a newer ZIP projects to v2 while v1 keeps the previous HTML release', async (t) => {
  // Start from a repo that already published jump 1.0.0 as html-v1.
  const { content } = await publishHtmlFixture(t);
  assert.equal((await buildRegistry(content, { check: true })).ok, true);
  const baseHTML = await tempDir(t, 'dsh-publish-zip-base-');
  await fs.cp(content, baseHTML, { recursive: true });
  const catalogBefore = JSON.parse(await fs.readFile(path.join(content, 'catalog', 'jump.json'), 'utf8'));
  const htmlReleaseBefore = catalogBefore.release || catalogBefore.releases.find((item) => item.version === '1.0.0');

  const published = await publishZip(t, content, { submissionType: 'update' });
  assert.equal(published.result.mode, 'execute');
  assert.equal(published.result.plan.assetPlan.packageName, 'jump-1.1.0.dshgame.zip');

  const catalog = JSON.parse(await fs.readFile(path.join(content, 'catalog', 'jump.json'), 'utf8'));
  assert.equal(catalog.schemaVersion, 2);
  assert.deepEqual(catalog.releases.map((release) => release.version), ['1.0.0', '1.1.0']);
  // Append-only: the historical HTML release is untouched.
  const htmlRelease = catalog.releases[0];
  assert.equal(htmlRelease.format, 'html-v1');
  assert.equal(htmlRelease.package.sha256, htmlReleaseBefore.packageSha256 || htmlReleaseBefore.package.sha256);
  assert.equal(htmlRelease.package.size, htmlReleaseBefore.packageSize || htmlReleaseBefore.package.size);
  assert.equal(htmlRelease.package.filesDigest, undefined);
  assert.equal(catalog.releases[1].format, 'asset-zip-v2');
  assert.equal(catalog.releases[1].package.filesDigest, published.filesDigest);

  const v1 = await readRegistryIndex(content);
  const v2 = await readRegistryV2Index(content);
  const v1Game = v1.games.find((game) => game.id === 'jump');
  const v2Game = v2.games.find((game) => game.id === 'jump');
  assert.ok(v1Game, 'v1 index must keep the previous HTML release');
  assert.equal(v1Game.version, '1.0.0');
  assert.match(v1Game.package.url, /jump-1\.0\.0\.html$/);
  assert.equal(v1Game.package.format, undefined, 'v1 index must stay HTML-only (no package.format)');
  assert.ok(v2Game, 'v2 index must expose the newest release');
  assert.equal(v2Game.version, '1.1.0');
  assert.equal(v2Game.package.format, 'asset-zip-v2');
  assert.equal(v2Game.package.filesDigest, published.filesDigest);
  assert.equal((await buildRegistry(content, { check: true })).ok, true);

  // CI history rules accept the append-only update against the trusted base.
  const history = await validateAgainstBase(content, baseHTML);
  assert.equal(history.ok, true, JSON.stringify(history.errors));
});

// ---------------------------------------------------------------------------
// Withdrawal removes both projections but keeps the audit trail
// ---------------------------------------------------------------------------

test('withdrawing a ZIP game removes both projections and keeps owner/review audit', async (t) => {
  const { content } = await publishHtmlFixture(t);
  await publishZip(t, content, { submissionType: 'update' });
  const base = await tempDir(t, 'dsh-publish-zip-withdraw-base-');
  await fs.cp(content, base, { recursive: true });

  const catalogPath = path.join(content, 'catalog', 'jump.json');
  const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  catalog.withdrawnAt = '2026-10-22T00:00:00.000Z';
  catalog.updatedAt = '2026-10-22T00:00:00.000Z';
  await writeJson(catalogPath, catalog);
  assert.equal((await buildRegistry(content, { write: true })).ok, true);

  const v1 = await readRegistryIndex(content);
  const v2 = await readRegistryV2Index(content);
  assert.equal(v1.games.some((game) => game.id === 'jump'), false);
  assert.equal(v2.games.some((game) => game.id === 'jump'), false);
  // Audit records are never deleted by withdrawal.
  assert.equal(await fs.stat(path.join(content, 'owners', 'jump.json')).then(() => true), true);
  assert.equal(await fs.stat(path.join(content, 'reviews', 'jump', '1.0.0.json')).then(() => true), true);
  assert.equal(await fs.stat(path.join(content, 'reviews', 'jump', '1.1.0.json')).then(() => true), true);

  const history = await validateAgainstBase(content, base);
  assert.equal(history.ok, true, JSON.stringify(history.errors));
  assert.ok(history.removed.includes('jump'));
});

// ---------------------------------------------------------------------------
// Immutability and format policy
// ---------------------------------------------------------------------------

test('same version with different ZIP bytes or a format swap is rejected', async (t) => {
  const ctx = await zipContext(t);
  const published = await publish({
    submissionPath: ctx.submissionPath,
    reviewPath: ctx.reviewPath,
    registryDir: ctx.content,
    execute: true,
    git: makeFakeGit(),
    github: makeFakeGithub(),
    http: ctx.http,
  });
  assert.equal(published.mode, 'execute');

  // (a) same version, different inner bytes.
  const changedPkg = zipPackage(ZIP_VERSION, { scriptContent: "document.body.textContent = 'different';\n" });
  const changedSubmission = zipSubmission({ version: ZIP_VERSION, zip: changedPkg.zip, submissionType: 'update' });
  const changedReview = reviewFor(changedSubmission);
  const changedPath = path.join(ctx.base, 'submission-changed.json');
  const changedReviewPath = path.join(ctx.base, 'review-changed.json');
  await writeJson(changedPath, changedSubmission);
  await writeJson(changedReviewPath, changedReview);
  await assert.rejects(
    () => publish({
      submissionPath: changedPath,
      reviewPath: changedReviewPath,
      registryDir: ctx.content,
      execute: false,
      git: makeFakeGit(),
      github: makeFakeGithub(),
      http: httpFor(changedSubmission, { packageBytes: changedPkg.zip }),
    }),
    (error) => error.code === 'E_PUBLISH_VERSION_IMMUTABLE',
  );

  // (b) same version, format swap HTML -> ZIP on a repository that published 1.0.0 HTML.
  const { content: htmlContent } = await publishHtmlFixture(t);
  const formatPkg = zipPackage('1.0.0');
  const formatSubmission = zipSubmission({ version: '1.0.0', zip: formatPkg.zip, submissionType: 'update' });
  const formatReview = reviewFor(formatSubmission);
  const base = await tempDir(t, 'dsh-publish-zip-format-');
  const formatSubmissionPath = path.join(base, 'submission.json');
  const formatReviewPath = path.join(base, 'review.json');
  await writeJson(formatSubmissionPath, formatSubmission);
  await writeJson(formatReviewPath, formatReview);
  await assert.rejects(
    () => publish({
      submissionPath: formatSubmissionPath,
      reviewPath: formatReviewPath,
      registryDir: htmlContent,
      execute: false,
      git: makeFakeGit(),
      github: makeFakeGithub(),
      http: httpFor(formatSubmission, { packageBytes: formatPkg.zip }),
    }),
    (error) => error.code === 'E_FORMAT_POLICY',
  );

  // (c) a declared filesDigest must match the archive's inner manifest.
  const mismatch = await zipContext(t, { declaredFilesDigest: 'f'.repeat(64) });
  await assert.rejects(
    () => publish({
      submissionPath: mismatch.submissionPath,
      reviewPath: mismatch.reviewPath,
      registryDir: mismatch.content,
      execute: false,
      git: makeFakeGit(),
      github: makeFakeGithub(),
      http: mismatch.http,
    }),
    (error) => error.code === 'E_PUBLISH_FILES_DIGEST',
  );

  // (d) filesDigest is meaningless for html-v1 and rejected as a format policy error.
  const htmlOnly = await makeEmptyContentRepo();
  t.after(() => fs.rm(htmlOnly, { recursive: true, force: true }));
  const fixtures = await prepareFixtures();
  fixtures.submission.package.filesDigest = 'a'.repeat(64);
  const htmlBase = await tempDir(t, 'dsh-publish-zip-html-');
  const htmlSubmissionPath = path.join(htmlBase, 'submission.json');
  const htmlReviewPath = path.join(htmlBase, 'review.json');
  await writeJson(htmlSubmissionPath, fixtures.submission);
  await writeJson(htmlReviewPath, fixtures.review);
  await assert.rejects(
    () => publish({
      submissionPath: htmlSubmissionPath,
      reviewPath: htmlReviewPath,
      registryDir: htmlOnly,
      execute: false,
      git: makeFakeGit(),
      github: makeFakeGithub(),
      http: makeHttpMock(new Map()),
    }),
    (error) => error.code === 'E_FORMAT_POLICY',
  );
});

test('trusted-history checks reject changed ZIP bytes or a format swap of a release', async (t) => {
  const { content } = await publishHtmlFixture(t);
  await publishZip(t, content, { submissionType: 'update' });
  const base = await tempDir(t, 'dsh-publish-zip-history-base-');
  await fs.cp(content, base, { recursive: true });

  // (a) change the inner filesDigest of the published ZIP release -> immutable.
  const changed = await tempDir(t, 'dsh-publish-zip-history-candidate-');
  await fs.cp(content, changed, { recursive: true });
  const catalog = JSON.parse(await fs.readFile(path.join(changed, 'catalog', 'jump.json'), 'utf8'));
  const zipRelease = catalog.releases.find((release) => release.version === '1.1.0');
  zipRelease.package.filesDigest = 'f'.repeat(64);
  await writeJson(path.join(changed, 'catalog', 'jump.json'), catalog);
  const immutable = await validateAgainstBase(changed, base);
  assert.equal(immutable.ok, false);
  assert.ok(immutable.errors.some((error) => error.code === 'E_CATALOG_IMMUTABLE'), JSON.stringify(immutable.errors));

  // (b) flip the published ZIP release to html-v1 (keeping the catalog itself
  //     valid, i.e. the URL matches the claimed format) -> format policy.
  const swapped = await tempDir(t, 'dsh-publish-zip-history-swapped-');
  await fs.cp(content, swapped, { recursive: true });
  const swappedCatalog = JSON.parse(await fs.readFile(path.join(swapped, 'catalog', 'jump.json'), 'utf8'));
  const swappedRelease = swappedCatalog.releases.find((release) => release.version === '1.1.0');
  swappedRelease.format = 'html-v1';
  swappedRelease.package.url = swappedRelease.package.url.replace(/\.dshgame\.zip$/, '.html');
  await writeJson(path.join(swapped, 'catalog', 'jump.json'), swappedCatalog);
  const formatPolicy = await validateAgainstBase(swapped, base);
  assert.equal(formatPolicy.ok, false);
  assert.ok(formatPolicy.errors.some((error) => error.code === 'E_FORMAT_POLICY'), JSON.stringify(formatPolicy.errors));
});

// ---------------------------------------------------------------------------
// Failure recovery: no half-published state, existing catalog untouched
// ---------------------------------------------------------------------------

test('invalid archives are rejected before any mutation', async (t) => {
  const files = defaultFiles();
  files.set('game.json', Buffer.from(JSON.stringify(buildGameManifest({ id: GAME_ID, name: 'Jump', version: ZIP_VERSION }), null, 2)));
  const entries = packageEntries(files).entries;

  const cases = [
    {
      label: 'path traversal entry',
      zip: buildZip([...entries, { name: '../evil.js', data: Buffer.from('x') }]),
      code: 'E_PUBLISH_PACKAGE_INVALID',
      gm: 'GM-4273',
    },
    {
      label: 'forged CRC',
      zip: buildZip(entries.map((entry) => (entry.name === 'index.html' ? { ...entry, crc32: 0xdeadbeef } : entry))),
      code: 'E_PUBLISH_PACKAGE_INVALID',
      gm: 'GM-4276',
    },
    {
      label: 'descriptor sha256 mismatch',
      zip: (() => {
        const pkg = buildPackage(files);
        const descriptor = JSON.parse(pkg.descriptorText);
        descriptor.files = descriptor.files.map((file) => (file.path === 'index.html' ? { ...file, sha256: 'a'.repeat(64) } : file));
        const descriptorText = `${JSON.stringify(descriptor, null, 2)}\n`;
        return buildZip([
          { name: 'dsh-package.json', data: Buffer.from(descriptorText) },
          ...[...files.entries()].map(([name, data]) => ({ name, data })),
        ]);
      })(),
      code: 'E_PUBLISH_PACKAGE_INVALID',
      gm: 'GM-4278',
    },
  ];

  for (const item of cases) {
    const base = await tempDir(t, 'dsh-publish-zip-invalid-');
    const submission = zipSubmission({ zip: item.zip });
    submission.submissionType = 'new';
    const review = reviewFor(submission);
    const submissionPath = path.join(base, 'submission.json');
    const reviewPath = path.join(base, 'review.json');
    await writeJson(submissionPath, submission);
    await writeJson(reviewPath, review);
    const content = await makeEmptyContentRepo();
    t.after(() => fs.rm(content, { recursive: true, force: true }));
    const before = await snapshot(content);
    const github = makeFakeGithub();
    await assert.rejects(
      () => publish({
        submissionPath,
        reviewPath,
        registryDir: content,
        execute: false,
        git: makeFakeGit(),
        github,
        http: httpFor(submission, { packageBytes: item.zip }),
      }),
      (error) => error.code === item.code && error.details && error.details.gm === item.gm,
      item.label,
    );
    assert.equal(github.calls.length, 0, `${item.label}: no remote calls`);
    assert.deepEqual(await snapshot(content), before, `${item.label}: content repository unchanged`);
  }
});

test('download, upload, commit and write failures leave no half-published catalog', async (t) => {
  // (a) download failure.
  {
    const ctx = await zipContext(t);
    const before = await snapshot(ctx.content);
    const github = makeFakeGithub();
    await assert.rejects(
      () => publish({
        submissionPath: ctx.submissionPath,
        reviewPath: ctx.reviewPath,
        registryDir: ctx.content,
        execute: false,
        git: makeFakeGit(),
        github,
        http: makeHttpMock(new Map()),
      }),
      (error) => error.code === 'E_PUBLISH_DOWNLOAD_FAILED',
    );
    assert.equal(github.calls.length, 0);
    assert.deepEqual(await snapshot(ctx.content), before);
  }

  // (b) upload failure: catalog/index untouched, no PR.
  {
    const ctx = await zipContext(t);
    const before = await snapshot(ctx.content);
    const github = makeFakeGithub({ failOnUpload: true });
    await assert.rejects(
      () => publish({
        submissionPath: ctx.submissionPath,
        reviewPath: ctx.reviewPath,
        registryDir: ctx.content,
        execute: true,
        git: makeFakeGit(),
        github,
        http: ctx.http,
      }),
      (error) => error.code === 'E_PUBLISH_GH',
    );
    assert.equal(github.prs.length, 0);
    assert.deepEqual(await snapshot(ctx.content), before);
  }

  // (c) commit failure rolls local files/index back so the publish can be retried.
  {
    const ctx = await zipContext(t);
    const before = await snapshot(ctx.content);
    const github = makeFakeGithub();
    await assert.rejects(
      () => publish({
        submissionPath: ctx.submissionPath,
        reviewPath: ctx.reviewPath,
        registryDir: ctx.content,
        execute: true,
        git: makeFakeGit({ failCommit: true }),
        github,
        http: ctx.http,
      }),
      (error) => error.code === 'E_PUBLISH_GIT',
    );
    assert.equal(github.prs.length, 0);
    assert.deepEqual(await snapshot(ctx.content), before, 'rollback must restore catalog and indexes');
  }

  // (d) a trusted-history conflict (version rollback against the trusted base)
  //     fails before any remote mutation.
  {
    const publishedContent = await makeEmptyContentRepo();
    t.after(() => fs.rm(publishedContent, { recursive: true, force: true }));
    await publishZip(t, publishedContent); // trusted base already has jump 1.1.0
    const older = await zipContext(t, { version: '1.0.0' });
    const before = await snapshot(older.content);
    const github = makeFakeGithub();
    await assert.rejects(
      () => publish({
        submissionPath: older.submissionPath,
        reviewPath: older.reviewPath,
        registryDir: older.content,
        execute: false,
        git: makeFakeGit(),
        github,
        http: older.http,
        historyBaseDir: publishedContent,
      }),
      (error) => error.code === 'E_PUBLISH_HISTORY_INVALID',
    );
    assert.equal(github.calls.length, 0);
    assert.deepEqual(await snapshot(older.content), before);
  }
});

// ---------------------------------------------------------------------------
// CI asset validation uses the real archive pipeline, not just the outer sha
// ---------------------------------------------------------------------------

test('validate-assets re-validates ZIP contents and the recorded filesDigest', async (t) => {
  const content = await makeEmptyContentRepo();
  t.after(() => fs.rm(content, { recursive: true, force: true }));
  const published = await publishZip(t, content);
  const catalog = JSON.parse(await fs.readFile(path.join(content, 'catalog', 'jump.json'), 'utf8'));
  const zipRelease = catalog.releases.find((release) => release.version === '1.1.0');
  const serveValid = () => makeHttpMock(new Map([
    [zipRelease.package.url, published.pkg.zip],
    [zipRelease.media.cover.url, PNG_1X1],
    [zipRelease.media.screenshots[0].url, PNG_1X1],
  ]));

  const ok = await validateAssets(content, serveValid());
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.count, 1);
  assert.equal(ok.entries[0].format, 'asset-zip-v2');
  assert.equal(ok.entries[0].filesDigest, published.filesDigest);
  assert.equal(ok.entries[0].fileCount, published.pkg.descriptor.files.length);

  // (a) a wrong recorded filesDigest fails even though the outer bytes match.
  const wrongDigest = await tempDir(t, 'dsh-publish-zip-assets-digest-');
  await fs.cp(content, wrongDigest, { recursive: true });
  const wrongCatalog = JSON.parse(JSON.stringify(catalog));
  wrongCatalog.releases.find((release) => release.version === '1.1.0').package.filesDigest = 'f'.repeat(64);
  await writeJson(path.join(wrongDigest, 'catalog', 'jump.json'), wrongCatalog);
  const digestResult = await validateAssets(wrongDigest, serveValid());
  assert.equal(digestResult.ok, false);
  assert.equal(digestResult.errors[0].code, 'E_PUBLISH_FILES_DIGEST');

  // (b) outer sha256 matches a syntactically valid ZIP whose *contents* are
  //     invalid: an outer-only check would pass, the archive validator must not.
  const files = defaultFiles();
  files.set('game.json', Buffer.from(JSON.stringify(buildGameManifest({ id: GAME_ID, name: 'Jump', version: ZIP_VERSION }), null, 2)));
  const badZip = buildZip([...packageEntries(files).entries, { name: '../evil.js', data: Buffer.from('x') }]);
  const badCatalog = JSON.parse(JSON.stringify(catalog));
  const badRelease = badCatalog.releases.find((release) => release.version === '1.1.0');
  badRelease.package.sha256 = sha256Hex(badZip);
  badRelease.package.size = badZip.length;
  const badDir = await tempDir(t, 'dsh-publish-zip-assets-bad-');
  await fs.cp(content, badDir, { recursive: true });
  await writeJson(path.join(badDir, 'catalog', 'jump.json'), badCatalog);
  const badResult = await validateAssets(badDir, makeHttpMock(new Map([
    [zipRelease.package.url, badZip],
    [zipRelease.media.cover.url, PNG_1X1],
    [zipRelease.media.screenshots[0].url, PNG_1X1],
  ])));
  assert.equal(badResult.ok, false);
  assert.equal(badResult.errors[0].code, 'E_PUBLISH_PACKAGE_INVALID');
  assert.equal(badResult.errors[0].details.gm, 'GM-4273');
});

// ---------------------------------------------------------------------------
// Content-repository template teaches both package formats
// ---------------------------------------------------------------------------

test('content-repo template documents and validates both package formats', async () => {
  const templateRoot = path.join(import.meta.dirname, '..', 'templates', 'registry');
  const workflow = await fs.readFile(path.join(templateRoot, '.github', 'workflows', 'validate-catalog.yml'), 'utf8');
  assert.match(workflow, /working-directory: \.toolchain/);
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /validate-assets\.mjs/);

  const readme = await fs.readFile(path.join(templateRoot, 'README.md'), 'utf8');
  assert.match(readme, /\.dshgame\.zip/);
  assert.match(readme, /filesDigest/);
  const operations = await fs.readFile(path.join(templateRoot, 'OPERATIONS.md'), 'utf8');
  assert.match(operations, /filesDigest/);
  assert.match(operations, /host.*archive|archive validation/i);
  const contributing = await fs.readFile(path.join(templateRoot, 'CONTRIBUTING.md'), 'utf8');
  assert.match(contributing, /\.dshgame\.zip/);
  assert.match(contributing, /package\.format/);
  assert.match(contributing, /filesDigest/);
  const prTemplate = await fs.readFile(path.join(templateRoot, '.github', 'PULL_REQUEST_TEMPLATE.md'), 'utf8');
  assert.match(prTemplate, /package format/i);
  assert.match(prTemplate, /filesDigest/);
  assert.match(prTemplate, /registry\/v2\/games\.json/);

  const zipExample = JSON.parse(await fs.readFile(path.join(templateRoot, 'examples', 'submission-zip.example.json'), 'utf8'));
  assert.equal(zipExample.package.format, 'asset-zip-v2');
  assert.match(zipExample.package.url, /\.dshgame\.zip$/);
  assert.match(zipExample.package.sha256Url, /\.dshgame\.zip\.sha256$/);
  assert.match(zipExample.package.filesDigest, /^[a-f0-9]{64}$/);
  const catalogExample = JSON.parse(await fs.readFile(path.join(templateRoot, 'examples', 'catalog-v2.example.json'), 'utf8'));
  const zipRelease = catalogExample.releases.find((release) => release.format === 'asset-zip-v2');
  assert.ok(zipRelease);
  assert.match(zipRelease.package.filesDigest, /^[a-f0-9]{64}$/);
});
