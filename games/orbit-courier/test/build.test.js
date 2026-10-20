import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPackage, serializeManifest } from '../build.mjs';
import { validateManifest } from '../../../packages/shared/src/manifest.js';
import {
  checkCssContent,
  checkHtmlContent,
  checkManifestConflict,
  checkPathConflicts,
  checkReservedNames,
  checkZipEntryPath,
  compareFileManifest,
  fileManifestDigest,
  validateDescriptor,
} from '../../../packages/shared/src/package-v2.js';
import { buildPackage as buildArchiveFixture } from '../../../tests/helpers/zip-package.mjs';
import { extractPackageArchive } from '../../../packages/host/src/zip.js';
import { LIMITS } from '../../../packages/shared/src/constants.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.resolve(testDir, '..');
const distDir = path.join(gameDir, 'dist');
const manifestSource = JSON.parse(fs.readFileSync(path.join(gameDir, 'game.json'), 'utf8'));

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

test('game.json is a valid V1 manifest with the frozen orbit-courier identity', () => {
  const result = validateManifest(manifestSource);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(manifestSource.id, 'orbit-courier');
  assert.equal(manifestSource.version, '1.0.0');
  assert.equal(manifestSource.name, '轨道信使');
  assert.deepEqual(manifestSource.categories, ['arcade']);
  assert.deepEqual(manifestSource.capabilities, ['storage', 'score']);
  assert.equal(manifestSource.sdkVersion, '^1.0.0');
  assert.equal(manifestSource.runtimeVersion, '^1.0.0');
  assert.deepEqual(manifestSource.viewport, { width: 720, height: 1280, fit: 'contain' });
  assert.deepEqual(manifestSource.score, { direction: 'higher-better', min: 0, max: 1000000000, integer: true });
  assert.deepEqual(manifestSource.save, { schemaVersion: 1 });
  assert.equal(manifestSource.license, 'MIT');
  for (const removed of ['entry', 'cover', 'screenshots']) {
    assert.equal(manifestSource[removed], undefined, `${removed} must not exist in a V1 manifest`);
  }
});

test('the build is byte-deterministic across every package file', () => {
  const first = buildPackage();
  const second = buildPackage();
  assert.deepEqual([...first.files.keys()], [...second.files.keys()], 'same file set');
  for (const [relative, bytes] of first.files) {
    assert.ok(Buffer.isBuffer(bytes), `${relative} is a buffer`);
    assert.equal(Buffer.compare(bytes, second.files.get(relative)), 0, `${relative} is byte-identical`);
  }
  assert.equal(JSON.stringify(first.descriptor), JSON.stringify(second.descriptor));
  assert.equal(first.digest, second.digest, 'file manifest digest is stable');
  assert.equal(serializeManifest(first.manifest), serializeManifest(second.manifest));
});

test('the descriptor passes the M1 validator and lists every non-descriptor entry', () => {
  const built = buildPackage();
  const validation = validateDescriptor(built.descriptor);
  assert.equal(validation.ok, true, JSON.stringify(validation));
  assert.equal(validation.value.entry, 'index.html');
  assert.equal(validation.value.gameManifest, 'game.json');
  assert.ok(validation.value.files.length >= 20, 'the package carries every module and asset');

  const paths = [...built.files.keys()];
  assert.deepEqual(validation.value.files.map((file) => file.path), [...paths].sort());
  assert.equal(paths.includes('dsh-package.json'), false, 'the descriptor never lists itself');
  assert.ok(paths.includes('index.html'));
  assert.ok(paths.includes('game.json'));
  assert.ok(paths.includes('levels/shift-01.json'));
  assert.ok(paths.includes('scripts/main.js'));
  assert.ok(paths.includes('scripts/vendor/dsh-sdk.js'));
  assert.ok(paths.includes('styles/game.css'));
  assert.ok(paths.some((relative) => relative.startsWith('assets/') && relative.endsWith('.png')));
  assert.ok(paths.some((relative) => relative.startsWith('audio/') && relative.endsWith('.wav')));

  for (const relative of paths) {
    const entry = checkZipEntryPath(relative);
    assert.equal(entry.ok, true, `${relative}: ${JSON.stringify(entry)}`);
  }
  assert.equal(checkPathConflicts(paths).ok, true);
  assert.equal(checkReservedNames(paths).ok, true);
  const compare = compareFileManifest(
    built.descriptor.files,
    paths.map((relative) => ({ path: relative, size: built.files.get(relative).length })),
  );
  assert.equal(compare.ok, true, JSON.stringify(compare));

  const digest = fileManifestDigest(built.descriptor.files, (text) => sha256(Buffer.from(text, 'utf8')));
  assert.equal(digest, built.digest);
});

test('every HTML document is external-only and every stylesheet is local', () => {
  const built = buildPackage();
  const htmlFiles = [...built.files.keys()].filter((relative) => relative.endsWith('.html'));
  assert.ok(htmlFiles.includes('index.html'));
  for (const relative of htmlFiles) {
    const html = built.files.get(relative).toString('utf8');
    const inline = checkHtmlContent(html, { inlineForbidden: true });
    assert.equal(inline.ok, true, `${relative} inline scan: ${JSON.stringify(inline)}`);
    assert.equal(checkManifestConflict(html).ok, true, `${relative} manifest conflict`);
    assert.equal(inline.ok && /<script\b[^>]*\bsrc=/.test(html), true, `${relative} loads scripts externally`);
    assert.equal(/<style\b/i.test(html), false, `${relative} has no inline style block`);
    assert.equal(/\son[a-z]+\s*=/i.test(html), false, `${relative} has no inline event handler`);
    assert.equal(/javascript\s*:/i.test(html), false, `${relative} has no javascript: URL`);
    assert.equal(/(?:src|href)\s*=\s*["']?(?:https?:)?\/\//i.test(html), false, `${relative} has no external URL`);
  }
  const cssFiles = [...built.files.keys()].filter((relative) => relative.endsWith('.css'));
  assert.ok(cssFiles.length >= 1);
  for (const relative of cssFiles) {
    const css = built.files.get(relative).toString('utf8');
    const cssCheck = checkCssContent(css);
    assert.equal(cssCheck.ok, true, `${relative}: ${JSON.stringify(cssCheck)}`);
    assert.equal(/@import\s/i.test(css), false, `${relative} has no @import`);
    assert.equal(/url\(\s*["']?(?:https?:)?\/\//i.test(css), false, `${relative} has no remote url()`);
  }
});

test('game scripts ship as real ESM modules with relative imports', () => {
  const built = buildPackage();
  const scripts = [...built.files.keys()].filter((relative) => relative.startsWith('scripts/') && relative.endsWith('.js'));
  assert.ok(scripts.length >= 6, 'rules, render, input, audio, resume, shell, sdk');
  const shell = built.files.get('scripts/game.js').toString('utf8');
  assert.match(shell, /from '\.\/logic\.js'/);
  const main = built.files.get('scripts/main.js').toString('utf8');
  assert.match(main, /from '\.\/game\.js'/);
  assert.match(main, /fetch\(LEVEL_URL/);
  const sdk = built.files.get('scripts/vendor/dsh-sdk.js').toString('utf8');
  assert.match(sdk, /export const game =/);
  assert.match(sdk, /createGameSDK/);
  // The SDK file is generated from packages/sdk, never hand-edited.
  assert.match(sdk, /Generated by games\/orbit-courier\/build\.mjs/);

  // Storage envelopes are unwrapped before the save/mute payload is used.
  const resume = built.files.get('scripts/resume.js').toString('utf8');
  assert.match(resume, /unwrapStorageValue/);
  const shapes = built.files.get('scripts/storage-shapes.js').toString('utf8');
  assert.match(shapes, /storage\.load\(key\)  -> \{ key, data, revision, updatedAt \}/);
  assert.match(shapes, /export function unwrapStorageValue/);

  // A08 automation hook: read-only snapshot, no mutation entry points.
  const probeShell = built.files.get('scripts/game.js').toString('utf8');
  assert.match(probeShell, /window\.__ORBIT_PROBE__/);
  assert.match(probeShell, /const snapshot = \(\) =>/);
  assert.match(probeShell, /readOnly: true/);
  assert.match(probeShell, /writable: false/);
  assert.match(probeShell, /Object\.defineProperty\(window, '__ORBIT_PROBE__'/);
  assert.equal(/window\.__ORBIT_PROBE__\s*=/.test(probeShell), false, 'the hook is never assigned writably');
});

test('level data and generated media are real, parseable files', () => {
  const built = buildPackage();
  const level = JSON.parse(built.files.get('levels/shift-01.json').toString('utf8'));
  assert.equal(level.schemaVersion, 1);
  assert.equal(level.durationSeconds, 120);
  assert.equal(level.acts.length, 3);
  assert.deepEqual(level.acts.map((act) => act.fromSeconds), [0, 40, 80]);
  assert.ok(level.geometry.rings.length === 3);
  assert.ok(level.parcel.score > 0);

  const pngs = [...built.files.keys()].filter((relative) => relative.endsWith('.png'));
  assert.ok(pngs.length >= 1);
  for (const relative of pngs) {
    const bytes = built.files.get(relative);
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${relative} PNG signature`);
    assert.ok(bytes.readUInt32BE(16) >= 32, `${relative} IHDR width is a real sprite`);
    assert.ok(bytes.readUInt32BE(20) >= 32, `${relative} IHDR height is a real sprite`);
  }

  const wavs = [...built.files.keys()].filter((relative) => relative.endsWith('.wav'));
  assert.ok(wavs.length >= 1);
  for (const relative of wavs) {
    const bytes = built.files.get(relative);
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF', `${relative} RIFF header`);
    assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WAVE', `${relative} WAVE header`);
    assert.ok(bytes.length > 1000, `${relative} carries audio samples`);
  }
});

test('limits: package size, entry count and per-file bounds stay inside the contract table', () => {
  const built = buildPackage();
  const unpacked = [...built.files.values()].reduce((total, bytes) => total + bytes.length, 0);
  assert.ok(built.files.size + 1 <= LIMITS.zip.zipEntries, 'entries including descriptor');
  assert.ok(unpacked <= LIMITS.zip.zipUnpackedBytes, 'unpacked total');
  assert.ok(built.files.size <= LIMITS.zip.zipEntries - 1, 'files[] bound');
  for (const [relative, bytes] of built.files) {
    assert.ok(bytes.length <= LIMITS.zip.zipEntryBytes, `${relative} within per-file bound`);
    assert.ok(relative.length <= LIMITS.zip.zipPathChars, `${relative} path length`);
    assert.ok(relative.split('/').length <= LIMITS.zip.zipPathDepth, `${relative} path depth`);
  }
});

test('the built package installs through the real M1 archive pipeline', async () => {
  const built = buildPackage();
  const fixture = buildArchiveFixture(built.files, { descriptor: built.descriptor, method: 8 });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-courier-zip-'));
  const zipPath = path.join(workDir, 'orbit-courier-1.0.0.dshgame.zip');
  const outDir = path.join(workDir, 'out');
  try {
    fs.writeFileSync(zipPath, fixture.zip);
    assert.ok(fixture.zip.length <= LIMITS.zip.zipOuterBytes, 'outer ZIP within the 20 MiB bound');
    const result = await extractPackageArchive({ zipPath, outDir });
    assert.equal(result.format, 'asset-zip-v2');
    assert.equal(result.entry, 'index.html');
    assert.equal(result.manifest.id, 'orbit-courier');
    assert.equal(result.manifest.version, '1.0.0');
    assert.equal(result.fileCount, built.descriptor.files.length);
    assert.equal(result.fileManifestDigest, built.digest);
    assert.equal(result.unpackedBytes, [...built.files.values()].reduce((total, bytes) => total + bytes.length, 0));
    assert.deepEqual(result.warnings, []);

    const extracted = new Map();
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(absolute);
        else extracted.set(path.relative(outDir, absolute).split(path.sep).join('/'), fs.readFileSync(absolute));
      }
    };
    walk(outDir);
    assert.equal(extracted.size, built.files.size + 1, 'descriptor + every file extracted');
    assert.ok(extracted.has('dsh-package.json'));
    for (const [relative, bytes] of built.files) {
      const actual = extracted.get(relative);
      assert.ok(actual, `${relative} extracted`);
      assert.equal(Buffer.compare(actual, bytes), 0, `${relative} bytes survive the round trip`);
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('the committed dist/ is exactly the current build (run node games/orbit-courier/build.mjs)', () => {
  const built = buildPackage();
  assert.equal(fs.existsSync(distDir), true, 'dist/ must be committed');
  const distFiles = new Map();
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else distFiles.set(path.relative(distDir, absolute).split(path.sep).join('/'), fs.readFileSync(absolute));
    }
  };
  walk(distDir);
  assert.equal(distFiles.has('dsh-package.json'), true);
  assert.equal(distFiles.size, built.files.size + 1, 'no stale files in dist/');
  for (const [relative, bytes] of built.files) {
    assert.ok(distFiles.has(relative), `dist/${relative} exists`);
    assert.equal(Buffer.compare(distFiles.get(relative), bytes), 0, `dist/${relative} is stale; rebuild`);
  }
  const descriptorText = distFiles.get('dsh-package.json').toString('utf8');
  assert.equal(descriptorText, `${JSON.stringify(built.descriptor, null, 2)}\n`);
  assert.equal(descriptorText.endsWith('\n'), true);
});
