import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { preparePublish } from '../lib/prepare.mjs';
import { createGit } from '../lib/git.mjs';
import { buildRegistry } from '../lib/catalog.mjs';
import { makeEmptyContentRepo, makeFakeGit, makeFakeGithub, makeHttpMock, prepareFixtures, PNG_1X1 } from './helpers.mjs';

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
}

async function context() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-prepare-test-'));
  const fixtures = await prepareFixtures();
  const submissionPath = path.join(base, 'submission.json');
  const reviewPath = path.join(base, 'review.json');
  await writeJson(submissionPath, fixtures.submission);
  await writeJson(reviewPath, fixtures.review);
  const content = await makeEmptyContentRepo();
  const urls = new Map([
    [fixtures.submission.package.url, fixtures.pkg],
    [fixtures.submission.package.sha256Url, Buffer.from(`${fixtures.pkgSha}  jump-1.0.0.html\n`)],
    [fixtures.submission.media.cover.url, PNG_1X1],
    [fixtures.submission.media.screenshots[0].url, PNG_1X1],
  ]);
  return {
    base,
    fixtures,
    submissionPath,
    reviewPath,
    content,
    http: makeHttpMock(urls),
    async cleanup() {
      await fs.rm(base, { recursive: true, force: true });
      await fs.rm(content, { recursive: true, force: true });
    },
  };
}

async function snapshot(root) {
  const output = [];
  async function walk(directory) {
    for (const name of (await fs.readdir(directory)).sort()) {
      if (name === '.git') continue;
      const target = path.join(directory, name);
      const stat = await fs.stat(target);
      if (stat.isDirectory()) await walk(target);
      else output.push([path.relative(root, target), (await fs.readFile(target)).length]);
    }
  }
  await walk(root);
  return output;
}

test('dry run validates and plans without remote or local mutation', async (t) => {
  const ctx = await context();
  t.after(() => ctx.cleanup());
  const before = await snapshot(ctx.content);
  const git = makeFakeGit();
  const github = makeFakeGithub();
  const result = await preparePublish({
    submissionPath: ctx.submissionPath,
    reviewPath: ctx.reviewPath,
    registryDir: ctx.content,
    execute: false,
    repo: 'example/registry',
    git,
    github,
    http: ctx.http,
  });
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.plan.game.id, 'jump');
  assert.equal(result.plan.tag, 'jump-v1.0.0');
  assert.equal(result.plan.assetPlan.packageName, 'jump-1.0.0.html');
  assert.equal(result.plan.assetPlan.hashes.package, ctx.fixtures.pkgSha);
  assert.equal(github.calls.length, 0);
  assert.equal(git.calls.length, 0);
  assert.deepEqual(await snapshot(ctx.content), before);
});

test('rejects a changed package or media after the approval', async (t) => {
  const ctx = await context();
  t.after(() => ctx.cleanup());
  const changed = JSON.parse(await fs.readFile(ctx.reviewPath, 'utf8'));
  changed.package.sha256 = 'd'.repeat(64);
  await writeJson(ctx.reviewPath, changed);
  await assert.rejects(
    () => preparePublish({ submissionPath: ctx.submissionPath, reviewPath: ctx.reviewPath, registryDir: ctx.content, execute: false, repo: 'example/registry', git: makeFakeGit(), http: ctx.http }),
    (error) => error.code === 'E_PUBLISH_REVIEW'
  );
});

test('execute publishes verified bytes, writes catalog and opens one PR', async (t) => {
  const ctx = await context();
  t.after(() => ctx.cleanup());
  const git = makeFakeGit();
  const github = makeFakeGithub();
  const result = await preparePublish({
    submissionPath: ctx.submissionPath,
    reviewPath: ctx.reviewPath,
    registryDir: ctx.content,
    execute: true,
    repo: 'example/registry',
    git,
    github,
    http: ctx.http,
  });
  assert.equal(result.mode, 'execute');
  assert.match(result.releaseUrl, /releases\/tag\/jump-v1\.0\.0/);
  assert.match(result.prUrl, /\/pull\/1$/);
  assert.equal(github.prs.length, 1);
  assert.equal(await fs.stat(path.join(ctx.content, 'catalog', 'jump.json')).then(() => true), true);
  assert.equal(await fs.stat(path.join(ctx.content, 'owners', 'jump.json')).then(() => true), true);
  assert.equal(await fs.stat(path.join(ctx.content, 'reviews', 'jump', '1.0.0.json')).then(() => true), true);
  const registry = JSON.parse(await fs.readFile(path.join(ctx.content, 'registry', 'games.json'), 'utf8'));
  assert.equal(registry.games.length, 1);
  assert.equal(registry.games[0].id, 'jump');

  // Same version + same bytes resumes the existing catalog branch/PR instead
  // of creating a second release or PR.
  const second = await preparePublish({
    submissionPath: ctx.submissionPath,
    reviewPath: ctx.reviewPath,
    registryDir: ctx.content,
    execute: true,
    repo: 'example/registry',
    git,
    github,
    http: ctx.http,
  });
  assert.equal(second.alreadyPublished, false);
  assert.equal(second.prUrl, result.prUrl);
  assert.equal(github.prs.length, 1);
});

test('upload failure leaves the catalog unchanged and opens no PR', async (t) => {
  const ctx = await context();
  t.after(() => ctx.cleanup());
  const git = makeFakeGit();
  const github = makeFakeGithub({ failOnUpload: true });
  const before = await snapshot(ctx.content);
  await assert.rejects(
    () => preparePublish({ submissionPath: ctx.submissionPath, reviewPath: ctx.reviewPath, registryDir: ctx.content, execute: true, repo: 'example/registry', git, github, http: ctx.http }),
    (error) => error.code === 'E_PUBLISH_GH'
  );
  assert.deepEqual(await snapshot(ctx.content), before);
  assert.equal(github.prs.length, 0);
});

test('public asset verification failure can be retried and creates only one PR', async (t) => {
  const ctx = await context();
  t.after(() => ctx.cleanup());
  const git = makeFakeGit();
  const github = makeFakeGithub({ failVerifyOnce: true });
  await assert.rejects(
    () => preparePublish({ submissionPath: ctx.submissionPath, reviewPath: ctx.reviewPath, registryDir: ctx.content, execute: true, repo: 'example/registry', git, github, http: ctx.http }),
    (error) => error.code === 'E_PUBLISH_PUBLIC_ASSET'
  );
  assert.equal(github.prs.length, 0);
  assert.equal(await fs.stat(path.join(ctx.content, 'catalog', 'jump.json')).then(() => false).catch(() => false), false);
  const retry = await preparePublish({ submissionPath: ctx.submissionPath, reviewPath: ctx.reviewPath, registryDir: ctx.content, execute: true, repo: 'example/registry', git, github, http: ctx.http });
  assert.equal(retry.mode, 'execute');
  assert.equal(github.prs.length, 1);
});

test('PR creation failure resumes the catalog branch on retry', async (t) => {
  const ctx = await context();
  t.after(() => ctx.cleanup());
  const git = makeFakeGit();
  const github = makeFakeGithub({ failPullRequestOnce: true });
  await assert.rejects(
    () => preparePublish({ submissionPath: ctx.submissionPath, reviewPath: ctx.reviewPath, registryDir: ctx.content, execute: true, repo: 'example/registry', git, github, http: ctx.http }),
    (error) => error.code === 'E_PUBLISH_GH'
  );
  assert.equal(github.prs.length, 0);
  assert.equal(git.currentBranch().startsWith('catalog/jump-'), true);
  const retry = await preparePublish({ submissionPath: ctx.submissionPath, reviewPath: ctx.reviewPath, registryDir: ctx.content, execute: true, repo: 'example/registry', git, github, http: ctx.http });
  assert.equal(retry.mode, 'execute');
  assert.equal(github.prs.length, 1);
});

test('a 1.0.1 update gets a separate release and preserves the client data contract', async (t) => {
  const ctx = await context();
  t.after(() => ctx.cleanup());
  const git = makeFakeGit();
  const github = makeFakeGithub();
  const first = await preparePublish({ submissionPath: ctx.submissionPath, reviewPath: ctx.reviewPath, registryDir: ctx.content, execute: true, repo: 'example/registry', git, github, http: ctx.http });
  assert.equal(first.mode, 'execute');

  const updateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-update-test-'));
  t.after(() => fs.rm(updateDir, { recursive: true, force: true }));
  const nextPackage = await fs.readFile(new URL('../../../docs/verification/v1/fixtures/packages/jump-1.0.1.html', import.meta.url));
  const nextSha = (await import('node:crypto')).createHash('sha256').update(nextPackage).digest('hex');
  const submission = JSON.parse(await fs.readFile(ctx.submissionPath, 'utf8'));
  submission.submissionType = 'update';
  submission.game.version = '1.0.1';
  submission.package.url = 'https://github.com/example-author/jump/releases/download/jump-v1.0.1/jump-1.0.1.html';
  submission.package.sha256Url = 'https://github.com/example-author/jump/releases/download/jump-v1.0.1/jump-1.0.1.html.sha256';
  submission.package.sha256 = nextSha;
  submission.package.size = nextPackage.length;
  submission.update = { changelog: 'Fix one bug; old saves stay valid.', saveCompatibility: 'compatible' };
  const review = JSON.parse(await fs.readFile(ctx.reviewPath, 'utf8'));
  review.version = '1.0.1';
  review.package = { sha256: nextSha, size: nextPackage.length };
  review.reviewedAt = '2026-10-19T13:00:00.000Z';
  const submissionPath = path.join(updateDir, 'submission.json');
  const reviewPath = path.join(updateDir, 'review.json');
  await writeJson(submissionPath, submission);
  await writeJson(reviewPath, review);
  const urls = new Map([
    [submission.package.url, nextPackage],
    [submission.package.sha256Url, Buffer.from(`${nextSha}  jump-1.0.1.html\n`)],
    [submission.media.cover.url, PNG_1X1],
    [submission.media.screenshots[0].url, PNG_1X1],
  ]);
  git.checkout('main');
  const second = await preparePublish({ submissionPath, reviewPath, registryDir: ctx.content, execute: true, repo: 'example/registry', git, github, http: makeHttpMock(urls) });
  assert.equal(second.mode, 'execute');
  assert.equal(second.plan.tag, 'jump-v1.0.1');
  assert.equal(github.prs.length, 2);
  const catalog = JSON.parse(await fs.readFile(path.join(ctx.content, 'catalog', 'jump.json'), 'utf8'));
  assert.equal(catalog.game.version, '1.0.1');
  const owner = JSON.parse(await fs.readFile(path.join(ctx.content, 'owners', 'jump.json'), 'utf8'));
  assert.equal(owner.owner.githubUserId, 123456);
  const registry = JSON.parse(await fs.readFile(path.join(ctx.content, 'registry', 'games.json'), 'utf8'));
  assert.equal(registry.games[0].version, '1.0.1');
});

test('dry run rejects a candidate that violates trusted catalog history before any remote call', async (t) => {
  const ctx = await context();
  t.after(() => ctx.cleanup());
  const git = makeFakeGit();
  const github = makeFakeGithub();
  const dry = await preparePublish({ submissionPath: ctx.submissionPath, reviewPath: ctx.reviewPath, registryDir: ctx.content, execute: false, repo: 'example/registry', git, github, http: ctx.http });

  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-history-base-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await fs.cp(ctx.content, base, { recursive: true });
  const entry = JSON.parse(JSON.stringify(dry.plan.catalogEntry));
  entry.release.packageSha256 = 'd'.repeat(64);
  await writeJson(path.join(base, 'catalog', 'jump.json'), entry);
  await writeJson(path.join(base, 'owners', 'jump.json'), {
    schemaVersion: 1,
    gameId: 'jump',
    owner: { login: ctx.fixtures.submission.author.login, githubUserId: ctx.fixtures.submission.author.githubUserId },
    createdAt: ctx.fixtures.review.reviewedAt,
  });
  const review = JSON.parse(JSON.stringify(ctx.fixtures.review));
  review.package.sha256 = 'd'.repeat(64);
  await writeJson(path.join(base, 'reviews', 'jump', '1.0.0.json'), review);
  const baseBuild = await buildRegistry(base, { write: true });
  assert.equal(baseBuild.ok, true, JSON.stringify(baseBuild.errors));

  await assert.rejects(
    () => preparePublish({ submissionPath: ctx.submissionPath, reviewPath: ctx.reviewPath, registryDir: ctx.content, execute: false, repo: 'example/registry', git, github, http: ctx.http, historyBaseDir: base }),
    (error) => error.code === 'E_PUBLISH_HISTORY_INVALID'
  );
  assert.equal(github.calls.length, 0);
});

test('a resumed draft with mismatched asset bytes is never published', async (t) => {
  const ctx = await context();
  t.after(() => ctx.cleanup());
  const git = makeFakeGit();
  const github = makeFakeGithub({
    draftAssets: { tag: 'jump-v1.0.0', assets: [{ name: 'jump-1.0.0.html', bytes: Buffer.from('wrong bytes') }] },
  });
  await assert.rejects(
    () => preparePublish({ submissionPath: ctx.submissionPath, reviewPath: ctx.reviewPath, registryDir: ctx.content, execute: true, repo: 'example/registry', git, github, http: ctx.http }),
    (error) => error.code === 'E_PUBLISH_DRAFT_ASSET_MISMATCH'
  );
  assert.equal(github.calls.some((call) => call[0] === 'publishRelease'), false);
  assert.equal(await fs.stat(path.join(ctx.content, 'catalog', 'jump.json')).then(() => true).catch(() => false), false);
});

test('invalid UTF-8 package bytes are rejected by publishing validation', async (t) => {
  const ctx = await context();
  t.after(() => ctx.cleanup());
  const invalid = Buffer.concat([ctx.fixtures.pkg, Buffer.from('<!-- '), Buffer.from([0xff]), Buffer.from(' -->')]);
  const sha = (await import('node:crypto')).createHash('sha256').update(invalid).digest('hex');
  const submission = JSON.parse(JSON.stringify(ctx.fixtures.submission));
  submission.package.sha256 = sha;
  submission.package.size = invalid.length;
  const submissionPath = path.join(ctx.base, 'submission-invalid-utf8.json');
  await writeJson(submissionPath, submission);
  const reviewPath = path.join(ctx.base, 'review-invalid-utf8.json');
  const review = JSON.parse(JSON.stringify(ctx.fixtures.review));
  review.package = { sha256: sha, size: invalid.length };
  await writeJson(reviewPath, review);
  const urls = new Map([
    [submission.package.url, invalid],
    [submission.package.sha256Url, Buffer.from(`${sha}  jump-1.0.0.html\n`)],
    [submission.media.cover.url, PNG_1X1],
    [submission.media.screenshots[0].url, PNG_1X1],
  ]);
  const git = makeFakeGit();
  const github = makeFakeGithub();
  await assert.rejects(
    () => preparePublish({ submissionPath, reviewPath, registryDir: ctx.content, execute: false, repo: 'example/registry', git, github, http: makeHttpMock(urls) }),
    (error) => error.code === 'E_PUBLISH_PACKAGE_UTF8'
  );
  assert.equal(github.calls.length, 0);
});

test('resuming a branch that is not based on the latest base is rejected', async (t) => {
  const ctx = await context();
  t.after(() => ctx.cleanup());
  const git = makeFakeGit({ ancestor: false });
  const github = makeFakeGithub({ failPullRequestOnce: true });
  await assert.rejects(
    () => preparePublish({ submissionPath: ctx.submissionPath, reviewPath: ctx.reviewPath, registryDir: ctx.content, execute: true, repo: 'example/registry', git, github, http: ctx.http }),
    (error) => error.code === 'E_PUBLISH_GH'
  );
  github.publishRelease = github.publishRelease; // keep fake state
  await assert.rejects(
    () => preparePublish({ submissionPath: ctx.submissionPath, reviewPath: ctx.reviewPath, registryDir: ctx.content, execute: true, repo: 'example/registry', git, github, http: ctx.http }),
    (error) => error.code === 'E_PUBLISH_STALE_BASE'
  );
});

test('a failed commit rolls back files, index and branch so the tool can be retried', async (t) => {
  const ctx = await context();
  t.after(() => ctx.cleanup());
  const run = (args) => execFileSync('git', args, { cwd: ctx.content, encoding: 'utf8' }).trim();
  run(['init', '-q']);
  run(['config', 'user.email', 'maintainer@example.com']);
  run(['config', 'user.name', 'Maintainer']);
  run(['add', '-A']);
  run(['commit', '-q', '-m', 'init content repo']);
  run(['branch', '-M', 'main']);
  const origin = path.join(ctx.base, 'origin.git');
  await fs.mkdir(origin, { recursive: true });
  execFileSync('git', ['init', '-q', '--bare', origin], { encoding: 'utf8' });
  run(['remote', 'add', 'origin', origin]);
  run(['push', '-q', '-u', 'origin', 'main']);
  const hooks = path.join(ctx.base, 'hooks');
  await fs.mkdir(hooks, { recursive: true });
  await fs.writeFile(path.join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  run(['config', 'core.hooksPath', hooks]);

  const git = createGit({ cwd: ctx.content });
  const github = makeFakeGithub();
  await assert.rejects(
    () => preparePublish({ submissionPath: ctx.submissionPath, reviewPath: ctx.reviewPath, registryDir: ctx.content, execute: true, repo: 'example/registry', git, github, http: ctx.http }),
    (error) => error.code === 'E_PUBLISH_GIT'
  );
  assert.equal(run(['status', '--porcelain']), '', 'worktree/index must be clean after rollback');
  assert.equal(run(['branch', '--format=%(refname:short)']), 'main', 'temporary catalog branch must be removed');
  assert.equal(run(['stash', 'list']), '', 'rollback must not stash user work');

  await fs.rm(path.join(hooks, 'pre-commit'));
  const retry = await preparePublish({ submissionPath: ctx.submissionPath, reviewPath: ctx.reviewPath, registryDir: ctx.content, execute: true, repo: 'example/registry', git, github, http: ctx.http });
  assert.equal(retry.mode, 'execute');
  assert.equal(github.prs.length, 1);
  assert.equal(run(['branch', '--format=%(refname:short)']).split('\n').includes('main'), true);
});

test('a failed rollback is reported explicitly, never silently swallowed', async (t) => {
  const ctx = await context();
  t.after(() => ctx.cleanup());
  const git = makeFakeGit({ failCommit: true, failReset: true });
  const github = makeFakeGithub();
  await assert.rejects(
    () => preparePublish({ submissionPath: ctx.submissionPath, reviewPath: ctx.reviewPath, registryDir: ctx.content, execute: true, repo: 'example/registry', git, github, http: ctx.http }),
    (error) => error.code === 'E_PUBLISH_ROLLBACK_FAILED' &&
      error.details && error.details.original === 'E_PUBLISH_GIT' &&
      String(error.details.rollback).includes('index lock')
  );
});

test('same version with different bytes is immutable', async (t) => {
  const ctx = await context();
  t.after(() => ctx.cleanup());
  const first = await preparePublish({ submissionPath: ctx.submissionPath, reviewPath: ctx.reviewPath, registryDir: ctx.content, execute: true, repo: 'example/registry', git: makeFakeGit(), github: makeFakeGithub(), http: ctx.http });
  assert.equal(first.mode, 'execute');
  const otherPackage = Buffer.concat([ctx.fixtures.pkg, Buffer.from('\n<!-- changed -->')]);
  const otherSha = (await import('node:crypto')).createHash('sha256').update(otherPackage).digest('hex');
  const sub = JSON.parse(await fs.readFile(ctx.submissionPath, 'utf8'));
  sub.submissionType = 'update';
  sub.game.version = '1.0.0';
  sub.package.sha256 = otherSha;
  sub.package.size = otherPackage.length;
  sub.update = { changelog: 'changed', saveCompatibility: 'compatible' };
  const review = JSON.parse(await fs.readFile(ctx.reviewPath, 'utf8'));
  review.package = { sha256: otherSha, size: otherPackage.length };
  await writeJson(ctx.submissionPath, sub);
  await writeJson(ctx.reviewPath, review);
  const urls = new Map([[sub.package.url, otherPackage], [sub.package.sha256Url, Buffer.from(`${otherSha}  jump-1.0.0.html\n`)], [sub.media.cover.url, PNG_1X1], [sub.media.screenshots[0].url, PNG_1X1]]);
  await assert.rejects(
    () => preparePublish({ submissionPath: ctx.submissionPath, reviewPath: ctx.reviewPath, registryDir: ctx.content, execute: false, repo: 'example/registry', git: makeFakeGit(), http: makeHttpMock(urls) }),
    (error) => error.code === 'E_PUBLISH_VERSION_IMMUTABLE'
  );
});
