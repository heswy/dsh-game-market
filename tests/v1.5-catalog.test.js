/**
 * M1-B: two-generation Registry / catalog contract tests (docs/V1.5-CONTRACTS §5).
 *
 * Covers:
 *   - §5.5 projection selection: v2 = newest release of any format, v1 = newest
 *     **HTML** release (so a ZIP-only game disappears from v1, and "newest is
 *     ZIP" keeps the previous HTML release installable for old clients);
 *   - withdrawal removes a game from both projections while owner/review audit
 *     records stay;
 *   - byte immutability, version monotonicity and the html-v1 -> asset-zip-v2
 *     "must bump the version" format policy (GM-4281 / GM-4282), including the
 *     publishing tool's dry-run rejection before any download/mutation;
 *   - v2 cache isolation (a v1 cache is never accepted as a v2 cache);
 *   - strict whole-index rejection of a bad v2 entry;
 *   - the bundled seed: both generated indexes are consistent and contain HTML
 *     only (V1.5-CONTRACTS §5.3).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DEFAULT_OFFICIAL_REGISTRY_URL,
  DEFAULT_OFFICIAL_REGISTRY_V2_URL,
  LIMITS,
  REGISTRY_V2_FILE,
  REGISTRY_V2_VERSION,
} from '../packages/shared/src/constants.js';
import { validateRegistry } from '../packages/shared/src/registry.js';
import {
  projectRegistryEntries,
  validateRegistryCacheV2,
  validateRegistryV2,
} from '../packages/shared/src/catalog-v2.js';
import {
  buildRegistry,
  validateAgainstBase,
} from '../scripts/registry/lib/catalog.mjs';
import { preparePublish } from '../scripts/registry/lib/prepare.mjs';
import { validateAssets } from '../scripts/registry/validate-assets.mjs';
import { PNG_BYTES, buildManifest, buildPackage } from '../packages/host/test/support/packages.js';
import { fileManifestDigest } from '../packages/shared/src/package-v2.js';
import {
  buildGameManifest,
  buildPackage as buildZipPackage,
  defaultFiles as defaultZipFiles,
} from './helpers/zip-package.mjs';

const COVER_SHA = 'b'.repeat(64);
const SHOT_SHA = 'c'.repeat(64);
const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const OWNER = { login: 'example-author', githubUserId: 123456 };
const ROOT = path.resolve(import.meta.dirname, '..');
/** `REGISTRY_V2_FILE` is relative to the Registry root; repos root it at `registry/`. */
const REGISTRY_V2_INDEX = 'registry/v2/games.json';

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function packageUrl(id, version, format) {
  const fileName = format === 'asset-zip-v2' ? `${id}-${version}.dshgame.zip` : `${id}-${version}.html`;
  return `https://github.com/example/${id}/releases/download/${id}-v${version}/${fileName}`;
}

function reviewFor({ id, version, sha, size, releasedAt }) {
  return {
    schemaVersion: 1,
    gameId: id,
    version,
    decision: 'approved',
    reviewer: { login: 'maintainer', githubUserId: 654321 },
    reviewedAt: releasedAt,
    source: { issueUrl: 'https://github.com/example/registry/issues/1' },
    sourceCommit: SOURCE_COMMIT,
    package: { sha256: sha, size },
    media: { coverSha256: COVER_SHA, screenshotSha256s: [SHOT_SHA] },
    testEvidence: [{ kind: 'manual', note: 'played 5 minutes in an isolated Runtime' }],
  };
}

function releaseRecord({ id, version, format = 'html-v1', sha = 'a'.repeat(64), size = 120000, releasedAt }) {
  const reviewText = `${JSON.stringify(reviewFor({ id, version, sha, size, releasedAt }), null, 2)}\n`;
  return {
    version,
    format,
    tag: `${id}-v${version}`,
    package: {
      url: packageUrl(id, version, format),
      sha256: sha,
      size,
      ...(format === 'asset-zip-v2' ? { filesDigest: 'd'.repeat(64) } : {}),
    },
    media: {
      cover: { url: 'https://example.com/cover.png', sha256: COVER_SHA, size: 50000, type: 'png' },
      screenshots: [{ url: 'https://example.com/shot.png', sha256: SHOT_SHA, size: 40000, type: 'png' }],
    },
    sourceCommit: SOURCE_COMMIT,
    reviewSha256: sha256(reviewText),
    releasedAt,
  };
}

function catalogV2({ id = 'orbit-catch', name = 'Orbit Catch', owner = OWNER, releases, withdrawnAt = null, updatedAt }) {
  return {
    schemaVersion: 2,
    gameId: id,
    owner: { ...owner },
    game: {
      id,
      name,
      version: releases[releases.length - 1].version,
      description: `${name} is a two-generation projection fixture.`,
      author: { name: 'Example Studio' },
      categories: ['arcade'],
      tags: ['fixture'],
      capabilities: ['storage', 'score'],
      sdkVersion: '^1.0.0',
      runtimeVersion: '^1.0.0',
      license: 'MIT',
    },
    releases,
    withdrawnAt,
    createdAt: releases[0].releasedAt,
    updatedAt: updatedAt || releases[releases.length - 1].releasedAt,
  };
}

async function ensureRepoDirs(repo) {
  for (const dir of ['catalog', 'owners', 'reviews', 'registry', 'registry/v2']) {
    await fs.mkdir(path.join(repo, dir), { recursive: true });
  }
}

async function writeOwner(repo, id, owner = OWNER) {
  const record = { schemaVersion: 1, gameId: id, owner: { ...owner }, createdAt: '2026-10-19T12:00:00.000Z' };
  await fs.writeFile(path.join(repo, 'owners', `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
}

async function writeCatalogFiles(repo, catalog) {
  await ensureRepoDirs(repo);
  await writeOwner(repo, catalog.gameId, catalog.owner);
  // Owner/authored catalogs of this suite always use the V1.5 owner identity.
  for (const release of catalog.releases) {
    const review = reviewFor({
      id: catalog.gameId,
      version: release.version,
      sha: release.package.sha256,
      size: release.package.size,
      releasedAt: release.releasedAt,
    });
    await fs.mkdir(path.join(repo, 'reviews', catalog.gameId), { recursive: true });
    await fs.writeFile(
      path.join(repo, 'reviews', catalog.gameId, `${release.version}.json`),
      `${JSON.stringify(review, null, 2)}\n`
    );
  }
  await fs.writeFile(path.join(repo, 'catalog', `${catalog.gameId}.json`), `${JSON.stringify(catalog, null, 2)}\n`);
}

/**
 * Legacy V1.2 catalog (single `release`, author/review/source blocks). The
 * generator must read it without a flag day (§5.5 migration).
 */
function legacyCatalog({ id = 'legacy-game', version = '1.0.0', sha = 'e'.repeat(64), releasedAt }) {
  const review = reviewFor({ id, version, sha, size: 90000, releasedAt });
  return {
    entry: {
      schemaVersion: 1,
      gameId: id,
      game: {
        name: 'Legacy Game',
        version,
        description: 'A pre-V1.5 content repository entry.',
        categories: ['puzzle'],
        tags: ['legacy'],
        capabilities: [],
        sdkVersion: '^1.0.0',
        runtimeVersion: '^1.0.0',
        license: 'MIT',
      },
      author: { name: 'Legacy Studio', login: OWNER.login, githubUserId: OWNER.githubUserId },
      release: {
        tag: `${id}-v${version}`,
        releasedAt,
        packageUrl: packageUrl(id, version, 'html-v1'),
        packageSha256: sha,
        packageSize: 90000,
        cover: { url: 'https://example.com/cover.png', sha256: COVER_SHA, size: 50000, type: 'png' },
        screenshots: [{ url: 'https://example.com/shot.png', sha256: SHOT_SHA, size: 40000, type: 'png' }],
      },
      source: { repo: `https://github.com/example/${id}`, commit: SOURCE_COMMIT },
      review: {
        reviewer: { login: 'maintainer', githubUserId: 654321 },
        reviewedAt: releasedAt,
        packageSha256: sha,
      },
      selfTest: { ready: true },
      publishedAt: releasedAt,
      updatedAt: releasedAt,
    },
    review,
  };
}

async function writeLegacyCatalog(repo, legacy) {
  await ensureRepoDirs(repo);
  await writeOwner(repo, legacy.entry.gameId);
  await fs.mkdir(path.join(repo, 'reviews', legacy.entry.gameId), { recursive: true });
  await fs.writeFile(
    path.join(repo, 'reviews', legacy.entry.gameId, `${legacy.entry.game.version}.json`),
    `${JSON.stringify(legacy.review, null, 2)}\n`
  );
  await fs.writeFile(
    path.join(repo, 'catalog', `${legacy.entry.gameId}.json`),
    `${JSON.stringify(legacy.entry, null, 2)}\n`
  );
}

async function makeRepo(t) {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-catalog-v15-'));
  t.after(() => fs.rm(repo, { recursive: true, force: true }));
  await ensureRepoDirs(repo);
  return repo;
}

async function copyRepo(t, source) {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-catalog-v15-copy-'));
  t.after(() => fs.rm(target, { recursive: true, force: true }));
  await fs.cp(source, target, { recursive: true });
  return target;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

// ---------------------------------------------------------------------------
// §5.5 projection selection
// ---------------------------------------------------------------------------

test('projection: v2 uses the newest release of any format while v1 keeps the newest HTML release', () => {
  const catalog = catalogV2({
    releases: [
      releaseRecord({ id: 'orbit-catch', version: '1.0.0', releasedAt: '2026-10-01T00:00:00.000Z' }),
      releaseRecord({
        id: 'orbit-catch',
        version: '1.1.0',
        format: 'asset-zip-v2',
        sha: 'f'.repeat(64),
        size: 200000,
        releasedAt: '2026-10-19T12:00:00.000Z',
      }),
    ],
    updatedAt: '2026-10-20T00:00:00.000Z',
  });
  const result = projectRegistryEntries([catalog]);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.v1.games.length, 1);
  assert.equal(result.v2.games.length, 1);
  // v1 keeps the previous *real* HTML release: not the ZIP and not a downgrade.
  assert.equal(result.v1.games[0].version, '1.0.0');
  assert.equal(result.v1.games[0].package.url, packageUrl('orbit-catch', '1.0.0', 'html-v1'));
  assert.equal('format' in result.v1.games[0].package, false);
  // v2 carries the newest release, format explicit.
  assert.equal(result.v2.games[0].version, '1.1.0');
  assert.equal(result.v2.games[0].package.format, 'asset-zip-v2');
  assert.equal(result.v2.games[0].package.filesDigest, 'd'.repeat(64));
  // generatedAt is the largest fixed source timestamp, not the build clock.
  assert.equal(result.v1.generatedAt, '2026-10-20T00:00:00.000Z');
  assert.equal(result.v2.generatedAt, result.v1.generatedAt);
  // Deterministic: identical input -> identical projection.
  assert.equal(JSON.stringify(projectRegistryEntries([catalog])), JSON.stringify(result));
});

test('projection: a ZIP-only game is absent from v1 (no degraded downgrade) but present in v2', () => {
  const zipOnly = catalogV2({
    id: 'zip-only',
    releases: [
      releaseRecord({
        id: 'zip-only',
        version: '2.0.0',
        format: 'asset-zip-v2',
        sha: 'f'.repeat(64),
        releasedAt: '2026-10-19T12:00:00.000Z',
      }),
    ],
  });
  const html = catalogV2({
    id: 'html-game',
    releases: [releaseRecord({ id: 'html-game', version: '1.0.0', releasedAt: '2026-10-18T00:00:00.000Z' })],
  });
  const result = projectRegistryEntries([zipOnly, html]);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.v1.games.map((game) => game.id), ['html-game']);
  assert.deepEqual(result.v2.games.map((game) => game.id), ['html-game', 'zip-only']);
});

// ---------------------------------------------------------------------------
// Generator: both indexes, determinism, migration
// ---------------------------------------------------------------------------

test('generator writes both indexes deterministically and keeps v1 HTML-only when the newest release is ZIP', async (t) => {
  const repo = await makeRepo(t);
  const twoGeneration = catalogV2({
    id: 'orbit-catch',
    releases: [
      releaseRecord({ id: 'orbit-catch', version: '1.0.0', releasedAt: '2026-10-01T00:00:00.000Z' }),
      releaseRecord({
        id: 'orbit-catch',
        version: '1.1.0',
        format: 'asset-zip-v2',
        sha: 'f'.repeat(64),
        size: 200000,
        releasedAt: '2026-10-19T12:00:00.000Z',
      }),
    ],
    updatedAt: '2026-10-20T00:00:00.000Z',
  });
  await writeCatalogFiles(repo, twoGeneration);
  await writeLegacyCatalog(repo, legacyCatalog({ releasedAt: '2026-10-18T00:00:00.000Z' }));

  const first = await buildRegistry(repo, { write: true });
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  const v1Path = path.join(repo, 'registry', 'games.json');
  const v2Path = path.join(repo, REGISTRY_V2_INDEX);
  const v1Bytes = await fs.readFile(v1Path, 'utf8');
  const v2Bytes = await fs.readFile(v2Path, 'utf8');
  const v1Index = JSON.parse(v1Bytes);
  const v2Index = JSON.parse(v2Bytes);

  assert.equal(v1Index.registryVersion, 1);
  assert.equal(v2Index.registryVersion, REGISTRY_V2_VERSION);
  // Both projected indexes must pass the same validators the Host runs.
  assert.equal(validateRegistry(v1Index, { sourceType: 'https', sourceUrl: DEFAULT_OFFICIAL_REGISTRY_URL }).ok, true);
  assert.equal(validateRegistryV2(v2Index, { sourceType: 'https', sourceUrl: DEFAULT_OFFICIAL_REGISTRY_V2_URL }).ok, true);

  const v1Orbit = v1Index.games.find((game) => game.id === 'orbit-catch');
  const v2Orbit = v2Index.games.find((game) => game.id === 'orbit-catch');
  assert.equal(v1Orbit.version, '1.0.0', 'v1 keeps the last real HTML release');
  assert.equal('format' in v1Orbit.package, false, 'v1 schema stays exactly V1');
  assert.equal(v2Orbit.version, '1.1.0', 'v2 projects the newest release (ZIP)');
  assert.equal(v2Orbit.package.format, 'asset-zip-v2');
  assert.equal(v2Index.games.find((game) => game.id === 'legacy-game').package.format, 'html-v1');
  // Deterministic: same inputs => byte-identical files.
  const second = await buildRegistry(repo, { write: true });
  assert.equal(second.ok, true, JSON.stringify(second.errors));
  assert.equal(second.changed, false);
  assert.equal(second.changedV2, false);
  assert.equal(await fs.readFile(v1Path, 'utf8'), v1Bytes);
  assert.equal(await fs.readFile(v2Path, 'utf8'), v2Bytes);
  const check = await buildRegistry(repo, { check: true });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  // generatedAt comes from the sources (max fixed timestamp), not from the clock.
  assert.equal(v1Index.generatedAt, '2026-10-20T00:00:00.000Z');
  assert.equal(v2Index.generatedAt, v1Index.generatedAt);
});

test('generator: withdrawal removes a game from both projections but keeps owner/review audit files', async (t) => {
  const repo = await makeRepo(t);
  await writeCatalogFiles(repo, catalogV2({
    id: 'withdrawn-game',
    releases: [releaseRecord({ id: 'withdrawn-game', version: '1.0.0', releasedAt: '2026-10-18T00:00:00.000Z' })],
    withdrawnAt: '2026-10-20T00:00:00.000Z',
  }));
  await writeCatalogFiles(repo, catalogV2({
    id: 'live-game',
    releases: [releaseRecord({ id: 'live-game', version: '1.0.0', releasedAt: '2026-10-18T00:00:00.000Z' })],
  }));

  const result = await buildRegistry(repo, { write: true });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const v1Index = await readJson(path.join(repo, 'registry', 'games.json'));
  const v2Index = await readJson(path.join(repo, REGISTRY_V2_INDEX));
  assert.deepEqual(v1Index.games.map((game) => game.id), ['live-game']);
  assert.deepEqual(v2Index.games.map((game) => game.id), ['live-game']);
  assert.equal(await fs.stat(path.join(repo, 'owners', 'withdrawn-game.json')).then(() => true), true);
  assert.equal(
    await fs.stat(path.join(repo, 'reviews', 'withdrawn-game', '1.0.0.json')).then(() => true),
    true
  );
});

// ---------------------------------------------------------------------------
// §5.4 immutability / version monotonicity / format policy
// ---------------------------------------------------------------------------

async function historyRepo(t) {
  const repo = await makeRepo(t);
  await writeCatalogFiles(repo, catalogV2({
    id: 'orbit-catch',
    releases: [releaseRecord({ id: 'orbit-catch', version: '1.0.0', releasedAt: '2026-10-19T12:00:00.000Z' })],
  }));
  const built = await buildRegistry(repo, { write: true });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  return repo;
}

test('history: same id/version bytes are immutable (GM-4281)', async (t) => {
  const base = await historyRepo(t);
  const candidate = await copyRepo(t, base);
  await writeCatalogFiles(candidate, catalogV2({
    id: 'orbit-catch',
    releases: [releaseRecord({
      id: 'orbit-catch',
      version: '1.0.0',
      sha: '9'.repeat(64),
      releasedAt: '2026-10-19T12:00:00.000Z',
    })],
  }));
  const result = await validateAgainstBase(candidate, base);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'E_CATALOG_IMMUTABLE'), JSON.stringify(result.errors));
  assert.equal(result.errors.some((error) => error.code === 'E_FORMAT_POLICY'), false);
});

test('history: version cannot go backwards', async (t) => {
  const base = await historyRepo(t);
  const candidate = await copyRepo(t, base);
  await writeCatalogFiles(candidate, catalogV2({
    id: 'orbit-catch',
    releases: [releaseRecord({ id: 'orbit-catch', version: '0.9.0', releasedAt: '2026-10-21T00:00:00.000Z' })],
  }));
  const result = await validateAgainstBase(candidate, base);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'E_CATALOG_VERSION_ROLLBACK'), JSON.stringify(result.errors));
});

test('history: html-v1 -> asset-zip-v2 at the same version is a format policy violation (GM-4282)', async (t) => {
  const base = await historyRepo(t);
  const candidate = await copyRepo(t, base);
  await writeCatalogFiles(candidate, catalogV2({
    id: 'orbit-catch',
    releases: [releaseRecord({
      id: 'orbit-catch',
      version: '1.0.0',
      format: 'asset-zip-v2',
      sha: 'f'.repeat(64),
      size: 200000,
      releasedAt: '2026-10-19T12:00:00.000Z',
    })],
  }));
  const result = await validateAgainstBase(candidate, base);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'E_FORMAT_POLICY'), JSON.stringify(result.errors));
});

test('history: a newer version may change format, old releases stay append-only', async (t) => {
  const base = await historyRepo(t);
  const candidate = await copyRepo(t, base);
  await writeCatalogFiles(candidate, catalogV2({
    id: 'orbit-catch',
    releases: [
      releaseRecord({ id: 'orbit-catch', version: '1.0.0', releasedAt: '2026-10-19T12:00:00.000Z' }),
      releaseRecord({
        id: 'orbit-catch',
        version: '1.0.1',
        format: 'asset-zip-v2',
        sha: 'f'.repeat(64),
        size: 200000,
        releasedAt: '2026-10-21T00:00:00.000Z',
      }),
    ],
  }));
  const accepted = await validateAgainstBase(candidate, base);
  assert.equal(accepted.ok, true, JSON.stringify(accepted.errors));

  // Dropping the trusted release while adding a newer one is still a rewrite.
  const dropped = await copyRepo(t, base);
  await writeCatalogFiles(dropped, catalogV2({
    id: 'orbit-catch',
    releases: [releaseRecord({
      id: 'orbit-catch',
      version: '1.0.2',
      format: 'asset-zip-v2',
      sha: 'e'.repeat(64),
      size: 200000,
      releasedAt: '2026-10-22T00:00:00.000Z',
    })],
  }));
  const rejected = await validateAgainstBase(dropped, base);
  assert.equal(rejected.ok, false);
  assert.ok(rejected.errors.some((error) => error.code === 'E_CATALOG_IMMUTABLE'), JSON.stringify(rejected.errors));
});

// ---------------------------------------------------------------------------
// Publishing tool: dry-run rejects a same-version format replacement
// ---------------------------------------------------------------------------

function fakeGit() {
  const calls = [];
  return {
    calls,
    isRepo: () => true,
    remoteUrl: () => 'https://github.com/example/registry.git',
    hasCleanWorktree: () => true,
    currentBranch: () => 'main',
    fetchOrigin() {},
    remoteHead: () => 'head',
    head: () => 'head',
    isAncestor: () => true,
    add() {},
    commit() {},
    push() {},
    branchExists: () => false,
    createBranch() {},
    checkout() {},
    materializeRef() {
      throw new Error('no trusted base materialisation in dry-run format test');
    },
  };
}

test('publishing dry-run rejects an HTML -> ZIP replacement at the same version before downloading anything', async (t) => {
  const repo = await makeRepo(t);
  const legacy = legacyCatalog({ id: 'jump', releasedAt: '2026-10-18T00:00:00.000Z' });
  await writeLegacyCatalog(repo, legacy);
  const built = await buildRegistry(repo, { write: true });
  assert.equal(built.ok, true, JSON.stringify(built.errors));

  const zipSha = 'f'.repeat(64);
  const zipSize = 200000;
  const submission = {
    schemaVersion: 1,
    submissionType: 'update',
    game: {
      id: 'jump',
      name: 'Jump',
      version: legacy.entry.game.version,
      description: legacy.entry.game.description,
      categories: legacy.entry.game.categories,
      tags: legacy.entry.game.tags,
      capabilities: legacy.entry.game.capabilities,
      sdkVersion: legacy.entry.game.sdkVersion,
      runtimeVersion: legacy.entry.game.runtimeVersion,
      license: 'MIT',
    },
    author: {
      login: OWNER.login,
      githubUserId: OWNER.githubUserId,
      sourceRepo: 'https://github.com/example/jump',
      sourceCommit: SOURCE_COMMIT,
      buildInstructions: 'npm run build',
    },
    package: {
      format: 'asset-zip-v2',
      url: packageUrl('jump', legacy.entry.game.version, 'asset-zip-v2'),
      sha256: zipSha,
      sha256Url: `${packageUrl('jump', legacy.entry.game.version, 'asset-zip-v2')}.sha256`,
      size: zipSize,
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
    update: { changelog: 'repackaged as asset-zip-v2', saveCompatibility: 'compatible' },
  };
  const review = reviewFor({
    id: 'jump',
    version: legacy.entry.game.version,
    sha: zipSha,
    size: zipSize,
    releasedAt: '2026-10-20T00:00:00.000Z',
  });
  const submissionPath = path.join(repo, '..', `submission-${process.pid}.json`);
  const reviewPath = path.join(repo, '..', `review-${process.pid}.json`);
  t.after(() => Promise.all([fs.rm(submissionPath, { force: true }), fs.rm(reviewPath, { force: true })]));
  await fs.writeFile(submissionPath, `${JSON.stringify(submission, null, 2)}\n`);
  await fs.writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);

  let downloads = 0;
  const http = {
    fetch: async () => {
      downloads += 1;
      return new Response('should not be reached', { status: 404 });
    },
    resolveHost: async () => [{ address: '203.0.113.7', family: 4 }],
    retries: 0,
  };
  const git = fakeGit();
  await assert.rejects(
    () => preparePublish({
      submissionPath,
      reviewPath,
      registryDir: repo,
      execute: false,
      repo: 'example/registry',
      git,
      http,
    }),
    (error) => error.code === 'E_FORMAT_POLICY'
  );
  assert.equal(downloads, 0, 'format policy must reject before downloading the package');
});

// ---------------------------------------------------------------------------
// §5.3 v2 cache isolation and strict whole-index validation
// ---------------------------------------------------------------------------

function v2Cache(overrides = {}) {
  return {
    schemaVersion: 2,
    registryVersion: REGISTRY_V2_VERSION,
    fetchedAt: '2026-10-19T12:00:00.000Z',
    sourceUrl: DEFAULT_OFFICIAL_REGISTRY_V2_URL,
    etag: null,
    lastModified: null,
    truncated: false,
    games: [],
    ...overrides,
  };
}

test('cache isolation: registry-cache.json (schemaVersion 1) can never be used as a v2 cache', () => {
  const v1Cache = {
    schemaVersion: 1,
    fetchedAt: '2026-10-19T12:00:00.000Z',
    sourceUrl: DEFAULT_OFFICIAL_REGISTRY_V2_URL,
    etag: null,
    lastModified: null,
    truncated: false,
    games: [],
  };
  assert.equal(validateRegistryCacheV2(v1Cache).ok, false);
  assert.equal(validateRegistryCacheV2(v2Cache()).ok, true);
  // A v2 cache is also bound to its source (§5.3): another URL means "no cache".
  assert.equal(validateRegistryCacheV2(v2Cache(), { sourceUrl: 'https://other.example/games.json' }).ok, false);
  assert.equal(validateRegistryCacheV2(v2Cache(), { sourceUrl: DEFAULT_OFFICIAL_REGISTRY_V2_URL }).ok, true);
  // The version tag is not optional.
  assert.equal(validateRegistryCacheV2(v2Cache({ registryVersion: 1 })).ok, false);
  assert.equal(validateRegistryCacheV2(v2Cache({ truncated: undefined })).ok, false);
});

function v2Entry(id, overrides = {}) {
  return {
    id,
    name: 'Fixture Game',
    version: '1.0.0',
    description: 'A v2 index fixture.',
    author: { name: 'Example Studio' },
    categories: ['arcade'],
    tags: [],
    capabilities: [],
    sdkVersion: '^1.0.0',
    runtimeVersion: '^1.0.0',
    package: {
      format: 'html-v1',
      url: packageUrl(id, '1.0.0', 'html-v1'),
      sha256: 'a'.repeat(64),
      size: 120000,
      releasedAt: '2026-10-19T12:00:00.000Z',
    },
    cover: 'https://example.com/cover.png',
    publishedAt: '2026-10-19T12:00:00.000Z',
    updatedAt: '2026-10-19T12:00:00.000Z',
    ...overrides,
  };
}

test('v2 index: one bad entry rejects the whole document, package.format is mandatory', () => {
  const good = v2Entry('good-game');
  const zip = v2Entry('zip-game', {
    version: '1.1.0',
    package: {
      format: 'asset-zip-v2',
      url: packageUrl('zip-game', '1.1.0', 'asset-zip-v2'),
      sha256: 'f'.repeat(64),
      size: LIMITS.zip.zipOuterBytes,
      releasedAt: '2026-10-19T12:00:00.000Z',
    },
  });
  const valid = validateRegistryV2(
    { registryVersion: 2, generatedAt: '2026-10-19T12:00:00.000Z', games: [good, zip] },
    { sourceType: 'https', sourceUrl: DEFAULT_OFFICIAL_REGISTRY_V2_URL }
  );
  assert.equal(valid.ok, true, JSON.stringify(valid.errors));

  const missingFormat = v2Entry('bad-game');
  delete missingFormat.package.format;
  const whole = validateRegistryV2(
    { registryVersion: 2, generatedAt: '2026-10-19T12:00:00.000Z', games: [good, missingFormat] },
    { sourceType: 'https', sourceUrl: DEFAULT_OFFICIAL_REGISTRY_V2_URL }
  );
  assert.equal(whole.ok, false);
  assert.equal(whole.registry, null, 'no partial index may be returned');

  const wrongFileName = v2Entry('wrong-name', {
    package: {
      format: 'asset-zip-v2',
      url: packageUrl('wrong-name', '1.0.0', 'html-v1'),
      sha256: 'a'.repeat(64),
      size: 120000,
      releasedAt: '2026-10-19T12:00:00.000Z',
    },
  });
  const fileNameCheck = validateRegistryV2(
    { registryVersion: 2, generatedAt: '2026-10-19T12:00:00.000Z', games: [wrongFileName] },
    { sourceType: 'https', sourceUrl: DEFAULT_OFFICIAL_REGISTRY_V2_URL }
  );
  assert.equal(fileNameCheck.ok, false, 'ZIP entries must use <id>-<version>.dshgame.zip');

  const oversized = v2Entry('too-big', {
    package: {
      format: 'html-v1',
      url: packageUrl('too-big', '1.0.0', 'html-v1'),
      sha256: 'a'.repeat(64),
      size: LIMITS.packageBytes + 1,
      releasedAt: '2026-10-19T12:00:00.000Z',
    },
  });
  const sizeCheck = validateRegistryV2(
    { registryVersion: 2, generatedAt: '2026-10-19T12:00:00.000Z', games: [oversized] },
    { sourceType: 'https', sourceUrl: DEFAULT_OFFICIAL_REGISTRY_V2_URL }
  );
  assert.equal(sizeCheck.ok, false);
});

test('v2 index: the size ceiling is applied per package format (html-v1 vs asset-zip-v2)', () => {
  const zipAtLimit = v2Entry('zip-at-limit', {
    version: '1.1.0',
    package: {
      format: 'asset-zip-v2',
      url: packageUrl('zip-at-limit', '1.1.0', 'asset-zip-v2'),
      sha256: 'f'.repeat(64),
      size: LIMITS.zip.zipOuterBytes,
      releasedAt: '2026-10-19T12:00:00.000Z',
    },
  });
  const zipTooLarge = JSON.parse(JSON.stringify(zipAtLimit));
  zipTooLarge.id = 'zip-too-large';
  zipTooLarge.package.url = packageUrl('zip-too-large', '1.1.0', 'asset-zip-v2');
  zipTooLarge.package.size = LIMITS.zip.zipOuterBytes + 1;
  const htmlTooLarge = v2Entry('html-too-large', {
    package: {
      format: 'html-v1',
      url: packageUrl('html-too-large', '1.0.0', 'html-v1'),
      sha256: 'a'.repeat(64),
      size: LIMITS.packageBytes + 1,
      releasedAt: '2026-10-19T12:00:00.000Z',
    },
  });
  const check = (games) => validateRegistryV2(
    { registryVersion: 2, generatedAt: '2026-10-19T12:00:00.000Z', games },
    { sourceType: 'https', sourceUrl: DEFAULT_OFFICIAL_REGISTRY_V2_URL }
  );
  assert.equal(check([zipAtLimit]).ok, true, 'a ZIP exactly at zipOuterBytes is allowed');
  assert.equal(check([zipTooLarge]).ok, false, 'a ZIP above zipOuterBytes is rejected');
  assert.equal(check([htmlTooLarge]).ok, false, 'an HTML package above packageBytes is rejected');
});

// ---------------------------------------------------------------------------
// CI asset re-verification knows both catalog shapes
// ---------------------------------------------------------------------------

test('validate-assets re-downloads and verifies every release of a v2 catalog (HTML and ZIP)', async (t) => {
  const repo = await makeRepo(t);
  const htmlPackage = buildPackage(buildManifest({ id: 'orbit-catch', version: '1.0.0' }));
  const htmlBytes = htmlPackage.bytes;
  // M2-D: ZIP releases are re-validated with the Host archive pipeline, not
  // just their outer sha256 (the old M1 fixture was a 19-byte fake ZIP that no
  // longer represents a legal package). Build a real `asset-zip-v2` fixture.
  const zipFiles = defaultZipFiles();
  zipFiles.set(
    'game.json',
    Buffer.from(JSON.stringify(buildGameManifest({ id: 'orbit-catch', name: 'Orbit Catch', version: '1.1.0' }), null, 2)),
  );
  const zipPackage = buildZipPackage(zipFiles);
  const zipBytes = zipPackage.zip;
  const zipFilesDigest = fileManifestDigest(zipPackage.descriptor.files, (text) => sha256(text));
  const png = PNG_BYTES;
  const files = new Map();
  const serve = (url, bytes) => {
    files.set(url, bytes);
    return url;
  };
  const catalog = {
    schemaVersion: 2,
    gameId: 'orbit-catch',
    owner: { ...OWNER },
    game: {
      id: 'orbit-catch',
      name: 'Orbit Catch',
      version: '1.1.0',
      description: 'Asset verification fixture.',
      author: { name: 'Example Studio' },
      categories: ['arcade'],
      tags: [],
      capabilities: [],
      sdkVersion: '^1.0.0',
      runtimeVersion: '^1.0.0',
      license: 'MIT',
    },
    releases: [
      {
        version: '1.0.0',
        format: 'html-v1',
        tag: 'orbit-catch-v1.0.0',
        package: {
          url: serve('https://github.com/example/orbit-catch/releases/download/orbit-catch-v1.0.0/orbit-catch-1.0.0.html', htmlBytes),
          sha256: sha256(htmlBytes),
          size: htmlBytes.length,
        },
        media: { cover: { url: serve(`https://github.com/example/orbit-catch/releases/download/v0/cover-1.png`, png), sha256: sha256(png), size: png.length, type: 'png' }, screenshots: [] },
        sourceCommit: SOURCE_COMMIT,
        reviewSha256: '0'.repeat(64),
        releasedAt: '2026-10-19T12:00:00.000Z',
      },
      {
        version: '1.1.0',
        format: 'asset-zip-v2',
        tag: 'orbit-catch-v1.1.0',
        package: {
          url: serve('https://github.com/example/orbit-catch/releases/download/orbit-catch-v1.1.0/orbit-catch-1.1.0.dshgame.zip', zipBytes),
          sha256: sha256(zipBytes),
          size: zipBytes.length,
          filesDigest: zipFilesDigest,
        },
        media: { cover: { url: serve(`https://github.com/example/orbit-catch/releases/download/v1/cover-2.png`, png), sha256: sha256(png), size: png.length, type: 'png' }, screenshots: [] },
        sourceCommit: SOURCE_COMMIT,
        reviewSha256: '0'.repeat(64),
        releasedAt: '2026-10-21T12:00:00.000Z',
      },
    ],
    withdrawnAt: null,
    createdAt: '2026-10-19T12:00:00.000Z',
    updatedAt: '2026-10-21T12:00:00.000Z',
  };
  // Minimal owner/review files: the CI asset check only needs the catalog shape.
  await ensureRepoDirs(repo);
  await writeOwner(repo, catalog.gameId);
  await fs.writeFile(path.join(repo, 'catalog', 'orbit-catch.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  const http = {
    fetch: async (url) => {
      const bytes = files.get(String(url));
      if (!bytes) return new Response('not found', { status: 404 });
      return new Response(bytes, { status: 200 });
    },
    resolveHost: async () => [{ address: '203.0.113.7', family: 4 }],
    retries: 0,
  };
  const verified = await validateAssets(repo, http);
  assert.equal(verified.ok, true, JSON.stringify(verified.errors));
  assert.equal(verified.count, 2);
  assert.deepEqual(
    verified.entries.map((entry) => `${entry.version}:${entry.format}`),
    ['1.0.0:html-v1', '1.1.0:asset-zip-v2']
  );

  // A changed byte must fail re-verification, not silently pass.
  files.set(catalog.releases[1].package.url, Buffer.concat([zipBytes, Buffer.from('x')]));
  const tampered = await validateAssets(repo, http);
  assert.equal(tampered.ok, false);
  assert.ok(tampered.errors.some((error) => error.code === 'E_PUBLISH_SIZE_MISMATCH' || error.code === 'E_PUBLISH_SHA_MISMATCH'), JSON.stringify(tampered.errors));
});

// ---------------------------------------------------------------------------
// Bundled seed stays HTML-only and consistent with the generator
// ---------------------------------------------------------------------------

test('bundled seed ships both generated indexes and contains HTML only (§5.3)', async () => {
  const v1Index = await readJson(path.join(ROOT, 'registry', 'games.json'));
  const v2Index = await readJson(path.join(ROOT, REGISTRY_V2_INDEX));
  assert.equal(v1Index.registryVersion, 1);
  assert.equal(v2Index.registryVersion, REGISTRY_V2_VERSION);
  assert.equal(validateRegistry(v1Index, {
    sourceType: 'file',
    sourceUrl: path.join(ROOT, 'registry', 'games.json'),
  }).ok, true);
  assert.equal(validateRegistryV2(v2Index, {
    sourceType: 'file',
    sourceUrl: path.join(ROOT, REGISTRY_V2_INDEX),
  }).ok, true);
  assert.equal(v1Index.games.length, 3);
  assert.equal(v2Index.games.length, 3);
  const v2ById = new Map(v2Index.games.map((game) => [game.id, game]));
  for (const game of v1Index.games) {
    const other = v2ById.get(game.id);
    assert.ok(other, `v2 seed is missing ${game.id}`);
    assert.equal(other.version, game.version);
    assert.equal(other.package.format, 'html-v1', 'the bundled seed must not ship ZIP packages');
    assert.equal(other.package.sha256, game.package.sha256);
    assert.equal(other.package.size, game.package.size);
    assert.equal('format' in game.package, false, 'the v1 seed schema stays exactly V1');
    const packagePath = path.join(ROOT, 'registry', game.package.url);
    const bytes = await fs.readFile(packagePath);
    assert.equal(sha256(bytes), game.package.sha256);
  }
});
