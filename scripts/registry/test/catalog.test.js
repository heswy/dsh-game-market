import assert from 'node:assert/strict';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { buildRegistry, initContentRepo, validateAgainstBase } from '../lib/catalog.mjs';
import { fixtureCatalogEntry, fixtureReview, makeContentRepo, TEMPLATE_DIR } from './helpers.mjs';

test('catalog generation produces a deterministic runtime index', async (t) => {
  const root = await makeContentRepo();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = await buildRegistry(root, { write: true });
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  assert.equal(first.index.games.length, 1);
  assert.equal(first.index.games[0].package.sha256, 'a'.repeat(64));
  const bytesA = await fs.readFile(path.join(root, 'registry', 'games.json'), 'utf8');
  const second = await buildRegistry(root, { write: true });
  assert.equal(second.ok, true);
  const bytesB = await fs.readFile(path.join(root, 'registry', 'games.json'), 'utf8');
  assert.equal(bytesA, bytesB);
  const check = await buildRegistry(root, { check: true });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});

test('check mode rejects a stale or missing generated index', async (t) => {
  const root = await makeContentRepo();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const missing = await buildRegistry(root, { check: true });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((error) => error.code === 'E_REGISTRY_STALE'));

  await buildRegistry(root, { write: true });
  await fs.writeFile(path.join(root, 'registry', 'games.json'), '{"registryVersion":1,"generatedAt":"2026-01-01T00:00:00.000Z","games":[]}\n');
  const stale = await buildRegistry(root, { check: true });
  assert.equal(stale.ok, false);
  assert.ok(stale.errors.some((error) => error.code === 'E_REGISTRY_STALE'));
});

test('owner/review binding rejects changed package or media hashes', async (t) => {
  const root = await makeContentRepo();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const reviewPath = path.join(root, 'reviews', 'orbit-catch', '1.0.0.json');
  const review = JSON.parse(await fs.readFile(reviewPath, 'utf8'));
  review.package.sha256 = 'd'.repeat(64);
  await fs.writeFile(reviewPath, JSON.stringify(review, null, 2) + '\n');
  const result = await buildRegistry(root, { write: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'E_REVIEW_BINDING'));
});

test('catalog entry without owner is rejected', async (t) => {
  const root = await makeContentRepo();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.rm(path.join(root, 'owners', 'orbit-catch.json'));
  const result = await buildRegistry(root, { write: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'E_OWNER_MISSING'));
});

test('init-content-repo fills platform lock and refuses a non-empty target', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-registry-init-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'repo');
  await initContentRepo({
    target,
    templateDir: TEMPLATE_DIR,
    platformRepo: 'example/platform',
    platformCommit: '0123456789abcdef0123456789abcdef01234567',
    platformVersion: '1.1.0',
    generatedAt: '2026-10-19T12:00:00.000Z',
  });
  const lock = JSON.parse(await fs.readFile(path.join(target, 'toolchain.lock.json'), 'utf8'));
  assert.equal(lock.platformRepo, 'example/platform');
  assert.equal(lock.commit, '0123456789abcdef0123456789abcdef01234567');
  assert.equal(await fs.stat(path.join(target, 'toolchain.lock.json')).then(() => true), true);
  await fs.writeFile(path.join(target, 'README.md'), 'occupied');
  await assert.rejects(() => initContentRepo({
    target,
    templateDir: TEMPLATE_DIR,
    platformRepo: 'example/platform',
    platformCommit: '0123456789abcdef0123456789abcdef01234567',
    platformVersion: '1.1.0',
  }), /not empty/);
});

test('multiple games coexist, cover URLs are in the generated index, withdrawal removes only that entry', async (t) => {
  const root = await makeContentRepo();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const second = JSON.parse(JSON.stringify(fixtureCatalogEntry()));
  second.gameId = 'orbit-two';
  second.game.name = 'Orbit Two';
  second.release.tag = 'orbit-two-v1.0.0';
  second.release.packageUrl = 'https://github.com/example/orbit-two/releases/download/orbit-two-v1.0.0/orbit-two-1.0.0.html';
  second.release.cover = { ...second.release.cover, url: 'https://example.com/orbit-two-cover.png' };
  second.source.repo = 'https://github.com/example/orbit-two';
  await fs.writeFile(path.join(root, 'catalog', 'orbit-two.json'), JSON.stringify(second, null, 2) + '\n');
  await fs.writeFile(path.join(root, 'owners', 'orbit-two.json'), JSON.stringify({
    schemaVersion: 1,
    gameId: 'orbit-two',
    owner: { login: 'example-author', githubUserId: 123456 },
    createdAt: '2026-10-19T12:00:00.000Z',
  }, null, 2) + '\n');
  const review = fixtureReview();
  review.gameId = 'orbit-two';
  await fs.mkdir(path.join(root, 'reviews', 'orbit-two'), { recursive: true });
  await fs.writeFile(path.join(root, 'reviews', 'orbit-two', '1.0.0.json'), JSON.stringify(review, null, 2) + '\n');

  const generated = await buildRegistry(root, { write: true });
  assert.equal(generated.ok, true, JSON.stringify(generated.errors));
  assert.deepEqual(generated.index.games.map((game) => game.id), ['orbit-catch', 'orbit-two']);
  assert.equal(generated.index.games[1].cover, 'https://example.com/orbit-two-cover.png');

  await fs.rm(path.join(root, 'catalog', 'orbit-two.json'));
  const withdrawn = await buildRegistry(root, { write: true });
  assert.equal(withdrawn.ok, true, JSON.stringify(withdrawn.errors));
  assert.deepEqual(withdrawn.index.games.map((game) => game.id), ['orbit-catch']);
  assert.equal((await fs.stat(path.join(root, 'owners', 'orbit-two.json')).then(() => true)), true, 'withdrawal keeps owner audit record');
});

async function copyRepo(root) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-history-'));
  await fs.cp(root, directory, { recursive: true });
  return directory;
}

test('history validation rejects version rollback, owner replacement and review rewrite', async (t) => {
  const candidate = await makeContentRepo();
  const base = await copyRepo(candidate);
  const rollbackCandidate = await copyRepo(candidate);
  t.after(() => Promise.all([candidate, base, rollbackCandidate].map((dir) => fs.rm(dir, { recursive: true, force: true }))));

  const entryPath = path.join(base, 'catalog', 'orbit-catch.json');
  const entry = JSON.parse(await fs.readFile(entryPath, 'utf8'));
  entry.game.version = '1.0.1';
  entry.release.tag = 'orbit-catch-v1.0.1';
  entry.release.packageUrl = entry.release.packageUrl.replace('orbit-catch-v1.0.0', 'orbit-catch-v1.0.1').replace('orbit-catch-1.0.0.html', 'orbit-catch-1.0.1.html');
  entry.release.cover.url = entry.release.cover.url.replace('orbit-catch-v1.0.0', 'orbit-catch-v1.0.1');
  entry.release.screenshots = entry.release.screenshots.map((shot) => ({ ...shot, url: shot.url.replace('orbit-catch-v1.0.0', 'orbit-catch-v1.0.1') }));
  await fs.writeFile(entryPath, JSON.stringify(entry, null, 2) + '\n');
  const review = JSON.parse(await fs.readFile(path.join(base, 'reviews', 'orbit-catch', '1.0.0.json'), 'utf8'));
  review.version = '1.0.1';
  await fs.writeFile(path.join(base, 'reviews', 'orbit-catch', '1.0.1.json'), JSON.stringify(review, null, 2) + '\n');
  assert.equal((await buildRegistry(base, { write: true })).ok, true);

  const rollback = await validateAgainstBase(rollbackCandidate, base);
  assert.equal(rollback.ok, false);
  assert.ok(rollback.errors.some((error) => error.code === 'E_CATALOG_VERSION_ROLLBACK'), JSON.stringify(rollback.errors));

  const ownerCandidate = await copyRepo(candidate);
  t.after(() => fs.rm(ownerCandidate, { recursive: true, force: true }));
  const ownerPath = path.join(ownerCandidate, 'owners', 'orbit-catch.json');
  const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
  owner.owner.login = 'someone-else';
  owner.owner.githubUserId = 999999;
  await fs.writeFile(ownerPath, JSON.stringify(owner, null, 2) + '\n');
  const candidateEntry = JSON.parse(await fs.readFile(path.join(ownerCandidate, 'catalog', 'orbit-catch.json'), 'utf8'));
  candidateEntry.author.login = 'someone-else';
  candidateEntry.author.githubUserId = 999999;
  await fs.writeFile(path.join(ownerCandidate, 'catalog', 'orbit-catch.json'), JSON.stringify(candidateEntry, null, 2) + '\n');
  const ownerResult = await validateAgainstBase(ownerCandidate, candidate);
  assert.equal(ownerResult.ok, false);
  assert.ok(ownerResult.errors.some((error) => error.code === 'E_CATALOG_OWNER_IMMUTABLE' || error.code === 'E_CATALOG_IMMUTABLE'), JSON.stringify(ownerResult.errors));

  const reviewCandidate = await copyRepo(candidate);
  t.after(() => fs.rm(reviewCandidate, { recursive: true, force: true }));
  const reviewPath = path.join(reviewCandidate, 'reviews', 'orbit-catch', '1.0.0.json');
  const rewritten = JSON.parse(await fs.readFile(reviewPath, 'utf8'));
  rewritten.reviewedAt = '2026-10-20T00:00:00.000Z';
  await fs.writeFile(reviewPath, JSON.stringify(rewritten, null, 2) + '\n');
  const rewrittenEntry = JSON.parse(await fs.readFile(path.join(reviewCandidate, 'catalog', 'orbit-catch.json'), 'utf8'));
  rewrittenEntry.review.reviewedAt = '2026-10-20T00:00:00.000Z';
  await fs.writeFile(path.join(reviewCandidate, 'catalog', 'orbit-catch.json'), JSON.stringify(rewrittenEntry, null, 2) + '\n');
  const reviewResult = await validateAgainstBase(reviewCandidate, candidate);
  assert.equal(reviewResult.ok, false);
  assert.ok(reviewResult.errors.some((error) => error.code === 'E_CATALOG_REVIEW_IMMUTABLE'), JSON.stringify(reviewResult.errors));
});

test('history validation allows documented withdrawal while keeping audit records', async (t) => {
  const candidate = await makeContentRepo();
  const base = await copyRepo(candidate);
  t.after(() => Promise.all([candidate, base].map((dir) => fs.rm(dir, { recursive: true, force: true }))));
  await fs.rm(path.join(candidate, 'catalog', 'orbit-catch.json'));
  const result = await validateAgainstBase(candidate, base);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.removed, ['orbit-catch']);
  assert.equal(await fs.stat(path.join(candidate, 'owners', 'orbit-catch.json')).then(() => true), true);
});
