import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILD_FILE, GAME_ID, buildGame, serializeManifest } from '../build.mjs';
import {
  checkSelfContained,
  extractManifest,
  validateManifest,
  validatePackageHtml,
} from '../../../packages/shared/src/manifest.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.resolve(testDir, '..');
const root = path.resolve(gameDir, '../..');
const manifestSource = JSON.parse(fs.readFileSync(path.join(gameDir, 'game.json'), 'utf8'));

test('game.json is a valid V1 manifest source without legacy package fields', () => {
  const result = validateManifest(manifestSource);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
  assert.equal(manifestSource.id, GAME_ID);
  assert.equal(manifestSource.version, '1.0.0');
  assert.deepEqual(manifestSource.categories, ['puzzle']);
  assert.deepEqual(manifestSource.capabilities, ['storage', 'score']);
  assert.equal(manifestSource.sdkVersion, '^1.0.0');
  assert.equal(manifestSource.runtimeVersion, '^1.0.0');
  assert.equal(manifestSource.preferredTheme, 'game-defined');
  assert.deepEqual(manifestSource.viewport, { width: 720, height: 720, fit: 'contain' });
  assert.deepEqual(manifestSource.score, {
    direction: 'higher-better',
    min: 0,
    max: 1000000000,
    integer: true,
  });
  assert.deepEqual(manifestSource.save, { schemaVersion: 1 });
  for (const removed of ['entry', 'cover', 'screenshots']) {
    assert.equal(manifestSource[removed], undefined, `${removed} must not exist in a V1 manifest`);
  }
});

test('build is byte-deterministic and passes the shared package validator', () => {
  const first = buildGame();
  const second = buildGame();
  assert.equal(first.sha256, second.sha256, 'two builds must have the same sha256');
  assert.equal(first.html, second.html, 'two builds must be byte-identical');
  assert.equal(first.bytes, Buffer.byteLength(first.html, 'utf8'));
  assert.ok(first.bytes > 10 * 1024, 'the package should contain the SDK and the game shell');
  assert.ok(first.bytes <= 20 * 1024 * 1024, 'single-file package must stay under 20 MiB');
  assert.equal(first.html.startsWith('\uFEFF'), false, 'UTF-8 without BOM');
  assert.match(first.html, /^<!doctype html>/i);

  const validated = validatePackageHtml(first.html);
  assert.equal(validated.ok, true, JSON.stringify(validated.errors));
  assert.equal(validated.manifest.id, GAME_ID);
  assert.equal(validated.manifest.version, '1.0.0');
  assert.deepEqual(checkSelfContained(first.html), []);
});

test('the built HTML embeds exactly one manifest that matches game.json', () => {
  const { html } = buildGame();
  const occurrences = html.match(/id="dsh-game-manifest"/g) || [];
  assert.equal(occurrences.length, 1, 'exactly one inline manifest is allowed');

  const extracted = extractManifest(html);
  assert.equal(extracted.ok, true);
  assert.ok(Buffer.byteLength(extracted.jsonText, 'utf8') <= 64 * 1024);
  const embedded = JSON.parse(extracted.jsonText);
  assert.deepEqual(embedded, JSON.parse(JSON.stringify(manifestSource)));
  assert.equal(serializeManifest(manifestSource), extracted.jsonText);
});

test('the built HTML inlines SDK, game, styles and holds no external resource tags', () => {
  const { html } = buildGame();
  assert.ok(html.includes('var DSH_GAME_SDK'));
  assert.ok(html.includes('__dsh2048Debug'));
  assert.ok(html.includes('<style>'));
  assert.ok(html.includes('id="tile-layer"'));
  assert.equal(/<script\b[^>]*\bsrc=/i.test(html), false);
  assert.equal(/<link\b[^>]*\bhref=/i.test(html), false);
  assert.equal(/<iframe\b/i.test(html), false);
  assert.equal(/@import\s/i.test(html), false);
  for (const banned of ['fetch(', 'XMLHttpRequest', 'WebSocket(', 'EventSource(', 'sendBeacon(']) {
    assert.equal(html.includes(banned), false, `package must not contain ${banned}`);
  }
  assert.equal(html.includes('__INLINE_SCRIPT__'), false);
  assert.equal(html.includes('__MANIFEST_JSON__'), false);
});

test('the committed dist/index.html is exactly the current build', () => {
  const outFile = path.join(gameDir, BUILD_FILE);
  assert.equal(fs.existsSync(outFile), true, 'dist/index.html must be committed; run node games/2048/build.mjs');
  const committed = fs.readFileSync(outFile, 'utf8');
  const built = buildGame();
  assert.equal(committed, built.html, 'dist/index.html is stale; rebuild with node games/2048/build.mjs');
  assert.equal(committed.endsWith('\n'), true, 'template should end with a trailing newline');
  const stat = fs.statSync(outFile);
  assert.equal(stat.size, built.bytes);
  assert.ok(stat.size <= 20 * 1024 * 1024);
});

test('the build output path stays inside games/2048/dist', () => {
  const outFile = path.resolve(gameDir, BUILD_FILE);
  assert.equal(outFile.startsWith(path.join(root, 'games', '2048', 'dist') + path.sep), true);
  assert.equal(path.basename(outFile), 'index.html');
});
