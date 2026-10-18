import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { validateRegistry, validateRegistryGame } from '../../../packages/shared/src/registry.js';
import { buildProject } from '../lib/project.mjs';
import { packProject } from '../lib/pack.mjs';
import { publishProject } from '../lib/publish.mjs';
import { ValidationFailure } from '../lib/cli-error.mjs';
import { createFixture, readJson, runCli, tempDir } from '../test-support/helpers.mjs';

const URL = 'https://github.com/example/demo-game/releases/download/v1.0.0/demo-game-1.0.0.html';
const COVER = 'https://raw.githubusercontent.com/example/demo-game/main/cover.png';
const DATES = {
  releasedAt: '2026-10-18T00:00:00Z',
  publishedAt: '2026-10-18T00:00:00Z',
  updatedAt: '2026-10-18T00:00:00Z',
  generatedAt: '2026-10-18T00:00:00Z',
};

async function prepared() {
  const dir = createFixture();
  await buildProject(dir);
  const packed = packProject(dir);
  return { dir, packed };
}

test('publish emits a valid registry entry, upload plan and checklist (offline)', async () => {
  const { dir, packed } = await prepared();
  const result = await publishProject(dir, { url: URL, cover: COVER, ...DATES });

  assert.equal(result.ok, true);
  assert.equal(result.entry.id, 'demo-game');
  assert.equal(result.entry.version, '1.0.0');
  assert.equal(result.entry.package.sha256, packed.sha256);
  assert.equal(result.entry.package.size, packed.bytes);
  assert.equal(result.entry.package.url, URL);
  assert.equal(result.entry.cover, COVER);
  assert.equal(result.entry.package.releasedAt, DATES.releasedAt);

  const check = validateRegistryGame(result.entry, { sourceType: 'https' });
  assert.equal(check.ok, true, JSON.stringify(check.errors));

  for (const file of Object.values(result.files)) assert.equal(fs.existsSync(file), true);
  const entryJson = readJson(result.files.entry);
  assert.deepEqual(entryJson, result.entry);

  const uploadPlan = fs.readFileSync(result.files.upload, 'utf8');
  assert.match(uploadPlan, /demo-game-1\.0\.0\.html/);
  assert.match(uploadPlan, new RegExp(packed.sha256));
  assert.match(uploadPlan, /gh release create/);

  const checklist = fs.readFileSync(result.files.checklist, 'utf8');
  assert.match(checklist, /\[x\]/);
  assert.match(checklist, /\[ \]/);
  assert.match(checklist, /20 MiB/);
});

test('publish output is reproducible with fixed timestamps', async () => {
  const { dir } = await prepared();
  const first = await publishProject(dir, { url: URL, cover: COVER, ...DATES });
  const snapshot = Object.fromEntries(
    Object.entries(first.files).map(([key, file]) => [key, fs.readFileSync(file, 'utf8')])
  );
  const second = await publishProject(dir, { url: URL, cover: COVER, ...DATES });
  for (const [key, file] of Object.entries(second.files)) {
    assert.equal(fs.readFileSync(file, 'utf8'), snapshot[key], `${key} must be stable`);
  }
});

test('publish merges a local registry deterministically and validates it', async () => {
  const { dir } = await prepared();
  const registryDir = tempDir();
  const first = await publishProject(dir, {
    url: URL,
    cover: COVER,
    registryDir,
    ...DATES,
  });
  const registryPath = path.join(registryDir, 'registry/games.json');
  assert.equal(first.registryPath, registryPath);
  const registry = readJson(registryPath);
  assert.equal(registry.registryVersion, 1);
  assert.equal(registry.generatedAt, DATES.generatedAt);
  assert.equal(registry.games.length, 1);
  const check = validateRegistry(registry, { sourceType: 'https' });
  assert.equal(check.ok, true, JSON.stringify(check.errors));

  // Republish the same version: replace, never duplicate.
  await publishProject(dir, { url: URL, cover: COVER, registryDir, ...DATES });
  const again = readJson(registryPath);
  assert.equal(again.games.filter((game) => game.id === 'demo-game').length, 1);
});

test('publish supports a relative package URL for a local file registry', async () => {
  const { dir } = await prepared();
  const registryDir = tempDir();
  const relativeUrl = 'packages/demo-game-1.0.0.html';
  const result = await publishProject(dir, {
    url: relativeUrl,
    cover: COVER,
    fileRegistry: true,
    registryDir,
    ...DATES,
  });
  assert.equal(result.sourceType, 'file');
  assert.equal(result.entry.package.url, relativeUrl);
  const registry = readJson(path.join(registryDir, 'registry/games.json'));
  const check = validateRegistry(registry, { sourceType: 'file' });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});

test('publish rejects a package URL on a host outside the allowlist', async () => {
  const { dir } = await prepared();
  await assert.rejects(
    () =>
      publishProject(dir, {
        url: 'https://example.com/demo-game-1.0.0.html',
        cover: COVER,
        ...DATES,
      }),
    (error) => {
      assert.ok(error instanceof ValidationFailure);
      assert.ok(error.report.errors.some((item) => item.code === 'E_REGISTRY_INVALID' && item.gm === 'GM-5032'));
      return true;
    }
  );
});

test('publish rejects a mismatched sha256 sidecar (or rehashes with --rehash)', async () => {
  const { dir, packed } = await prepared();
  fs.writeFileSync(`${packed.digestFile}`, `${'0'.repeat(64)}  demo-game-1.0.0.html\n`, 'utf8');
  await assert.rejects(() => publishProject(dir, { url: URL, cover: COVER, ...DATES }), (error) => {
    assert.ok(error instanceof ValidationFailure);
    assert.ok(error.report.errors.some((item) => item.code === 'E_INSTALL_HASH_MISMATCH'));
    return true;
  });
  const rehashed = await publishProject(dir, { url: URL, cover: COVER, rehash: true, ...DATES });
  assert.equal(rehashed.info.sha256, packed.sha256);
});

test('the CLI publish command exits 0 and prints JSON; a bad host exits 1', async () => {
  const { dir } = await prepared();
  const base = [
    'publish',
    dir,
    '--cover',
    COVER,
    '--released-at',
    DATES.releasedAt,
    '--published-at',
    DATES.publishedAt,
    '--updated-at',
    DATES.updatedAt,
  ];
  const ok = runCli([...base, '--url', URL, '--json']);
  assert.equal(ok.status, 0, ok.stderr);
  const parsed = JSON.parse(ok.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.entry.package.url, URL);

  const bad = runCli([...base, '--url', 'https://example.com/demo-game-1.0.0.html', '--json']);
  assert.equal(bad.status, 1);
  const report = JSON.parse(bad.stdout);
  assert.equal(report.ok, false);
  assert.ok(report.errors.length > 0);

  const missingCover = runCli(['publish', dir, '--url', URL]);
  assert.equal(missingCover.status, 2);
  assert.match(missingCover.stderr, /--cover/);
});
