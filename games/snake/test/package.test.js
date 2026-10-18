/**
 * Build-artifact contract test for the V1 snake package.
 *
 * It guards the migration that `scripts/build-snake.mjs` performs:
 *   - `dist/index.html` is one self-contained HTML file;
 *   - it embeds the manifest exactly once, as manifest v1;
 *   - the embedded manifest matches `game.json` (minus the legacy `entry`);
 *   - SDK/Runtime ranges are the V1 `^1.0.0` pin.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIMITS } from '../../../packages/shared/src/constants.js';
import {
  MANIFEST_BYTES_MAX,
  MANIFEST_SCRIPT_ID,
  extractManifest,
  validateManifest,
  validatePackageHtml,
} from '../../../packages/shared/src/manifest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.resolve(here, '..');
const distPath = path.join(gameDir, 'dist/index.html');
const sourcePath = path.join(gameDir, 'game.json');

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The build-time source may still carry the V0 `entry` field; the package must not. */
function toV1Source(raw) {
  const manifest = { ...raw };
  delete manifest.entry;
  return manifest;
}

test('dist/index.html is a valid single-file V1 package', () => {
  const html = readFileSync(distPath, 'utf8');
  assert.equal(html.startsWith('\uFEFF'), false, 'package must be UTF-8 without BOM');
  assert.ok(Buffer.byteLength(html, 'utf8') <= LIMITS.packageBytes);

  const result = validatePackageHtml(html);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.manifest.id, 'snake');
  assert.equal(result.manifest.version, '1.0.0');
});

test('the manifest is embedded exactly once and stays under the 64 KiB cap', () => {
  const html = readFileSync(distPath, 'utf8');
  const occurrences = html.split(MANIFEST_SCRIPT_ID).length - 1;
  assert.equal(occurrences, 1);

  const extracted = extractManifest(html);
  assert.equal(extracted.ok, true);
  assert.ok(Buffer.byteLength(extracted.jsonText, 'utf8') <= MANIFEST_BYTES_MAX);
  assert.doesNotThrow(() => JSON.parse(extracted.jsonText));
});

test('embedded manifest is strict manifest v1 (no entry/cover/screenshots)', () => {
  const html = readFileSync(distPath, 'utf8');
  const embedded = JSON.parse(extractManifest(html).jsonText);

  for (const field of ['entry', 'cover', 'screenshots']) {
    assert.equal(Object.prototype.hasOwnProperty.call(embedded, field), false, `${field} must not be embedded`);
  }
  const checked = validateManifest(embedded);
  assert.deepEqual(checked.errors, []);
  assert.equal(checked.ok, true);
  assert.equal(embedded.manifestVersion, 1);
  assert.equal(embedded.id, 'snake');
  assert.equal(embedded.version, '1.0.0');
  assert.equal(embedded.sdkVersion, '^1.0.0');
  assert.equal(embedded.runtimeVersion, '^1.0.0');
  assert.deepEqual(embedded.capabilities, ['storage', 'score']);
  assert.deepEqual(embedded.categories, ['arcade']);
  assert.equal(embedded.save.schemaVersion, 1);
  assert.equal(embedded.score.direction, 'higher-better');
  assert.equal(embedded.score.integer, true);
  assert.equal(embedded.score.min, 0);
  assert.equal(embedded.score.max, 1000000);
  assert.deepEqual(embedded.viewport, { width: 960, height: 540, fit: 'contain' });
});

test('embedded manifest matches the build-time source (legacy entry stripped)', () => {
  const html = readFileSync(distPath, 'utf8');
  const embedded = JSON.parse(extractManifest(html).jsonText);
  const source = readJson(sourcePath);
  assert.deepEqual(embedded, toV1Source(source));
  const sourceCheck = validateManifest(toV1Source(source));
  assert.deepEqual(sourceCheck.errors, []);
  if (source.entry !== undefined) assert.equal(source.entry, 'dist/index.html');
});

test('the package declares no external resources or network APIs', () => {
  const html = readFileSync(distPath, 'utf8');
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=/i);
  assert.doesNotMatch(html, /<link\b[^>]*\bhref=/i);
  assert.doesNotMatch(html, /<iframe\b/i);
  const result = validatePackageHtml(html);
  assert.deepEqual(result.errors, []);
});
