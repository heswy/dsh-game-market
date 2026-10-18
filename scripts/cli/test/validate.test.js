import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { validateFile, validateHtmlText, validatePath } from '../lib/validator.mjs';
import { createFixture, manifest, runCli, tempDir, writeFiles } from '../test-support/helpers.mjs';

function htmlWith(manifestValue, body = '') {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>x</title>
<script type="application/json" id="dsh-game-manifest">${JSON.stringify(manifestValue)}</script>
</head><body>${body}</body></html>
`;
}

test('a valid package passes and reports its manifest', () => {
  const dir = tempDir();
  const file = path.join(dir, 'demo-game-1.0.0.html');
  fs.writeFileSync(file, htmlWith(manifest()), 'utf8');
  const report = validateFile(file);
  assert.equal(report.ok, true);
  assert.equal(report.errors.length, 0);
  assert.deepEqual(report.manifest, { id: 'demo-game', name: 'Demo Game', version: '1.0.0' });
});

test('a project directory is built in memory and validated without writing dist/', async () => {
  const dir = createFixture();
  const { report, html } = await validatePath(dir);
  assert.equal(report.ok, true);
  assert.ok(html.includes('id="dsh-game-manifest"'));
  assert.equal(fs.existsSync(path.join(dir, 'dist')), false);
});

test('missing inline manifest is E_PKG_MANIFEST_MISSING / GM-4221', () => {
  const report = validateHtmlText('<!doctype html><html><body>no manifest</body></html>');
  assert.equal(report.ok, false);
  assert.equal(report.errors[0].code, 'E_PKG_MANIFEST_MISSING');
  assert.equal(report.errors[0].gm, 'GM-4221');
  assert.equal(report.errors[0].path, 'manifest');
  assert.ok(report.errors[0].hint.length > 0);
});

test('duplicate inline manifests are rejected', () => {
  const value = JSON.stringify(manifest());
  const html = `<!doctype html><html><head>
<script type="application/json" id="dsh-game-manifest">${value}</script>
<script type="application/json" id="dsh-game-manifest">${value}</script>
</head><body></body></html>`;
  const report = validateHtmlText(html);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.code === 'E_PKG_MANIFEST_DUPLICATE'));
});

test('invalid manifest JSON is rejected with E_PKG_MANIFEST_JSON', () => {
  const html = `<!doctype html><html><head><script type="application/json" id="dsh-game-manifest">{oops}</script></head></html>`;
  const report = validateHtmlText(html);
  assert.equal(report.ok, false);
  assert.equal(report.errors[0].code, 'E_PKG_MANIFEST_JSON');
  assert.equal(report.errors[0].gm, 'GM-4228');
});

test('unsupported capability network is rejected as GM-4240', () => {
  const report = validateHtmlText(htmlWith(manifest({ capabilities: ['network'] })));
  assert.equal(report.ok, false);
  const error = report.errors.find((item) => item.code === 'E_PKG_CAPABILITY_UNSUPPORTED');
  assert.ok(error);
  assert.equal(error.gm, 'GM-4240');
  assert.equal(error.path, 'capabilities');
});

test('unknown category is rejected as GM-4238', () => {
  const report = validateHtmlText(htmlWith(manifest({ categories: ['racing'] })));
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((item) => item.code === 'E_PKG_CATEGORY_UNKNOWN' && item.gm === 'GM-4238'));
});

test('external scripts/images are rejected as not self-contained (GM-4225)', () => {
  const html = htmlWith(
    manifest(),
    '<script src="https://cdn.example.com/game.js"></script><img src="https://example.com/x.png">'
  );
  const report = validateHtmlText(html);
  assert.equal(report.ok, false);
  assert.equal(report.errors.filter((item) => item.code === 'E_PKG_ENTRY_NOT_SELF_CONTAINED').length, 2);
  assert.ok(report.errors.every((item) => item.code !== 'E_PKG_ENTRY_NOT_SELF_CONTAINED' || item.gm === 'GM-4225'));
});

test('network APIs in inline code are rejected as not self-contained', () => {
  const report = validateHtmlText(htmlWith(manifest(), '<script>fetch("/api")</script>'));
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((item) => item.code === 'E_PKG_ENTRY_NOT_SELF_CONTAINED'));
});

test('oversized packages are rejected before parsing', () => {
  const dir = tempDir();
  const file = path.join(dir, 'huge.html');
  fs.writeFileSync(file, Buffer.alloc(20 * 1024 * 1024 + 1, 0x61));
  const report = validateFile(file);
  assert.equal(report.ok, false);
  assert.equal(report.errors[0].code, 'E_PKG_TOO_LARGE');
  assert.equal(report.errors[0].gm, 'GM-4135');
});

test('BOM and invalid UTF-8 are rejected as E_PKG_HTML_INVALID / GM-4222', () => {
  const bomReport = validateHtmlText(`\uFEFF${htmlWith(manifest())}`);
  assert.equal(bomReport.ok, false);
  assert.ok(bomReport.errors.some((item) => item.code === 'E_PKG_HTML_INVALID' && item.gm === 'GM-4222'));

  const dir = tempDir();
  const file = path.join(dir, 'binary.html');
  fs.writeFileSync(file, Buffer.from([0xff, 0xfe, 0xfd, 0x00, 0x3c]));
  const report = validateFile(file);
  assert.equal(report.ok, false);
  assert.equal(report.errors[0].code, 'E_PKG_HTML_INVALID');
  assert.match(report.errors[0].message, /UTF-8/);
});

test('an id/version mismatch in a package-style file name is rejected', () => {
  const dir = tempDir();
  const file = path.join(dir, 'other-game-2.0.0.html');
  fs.writeFileSync(file, htmlWith(manifest()), 'utf8');
  const report = validateFile(file);
  assert.equal(report.ok, false);
  const error = report.errors.find((item) => item.code === 'E_INSTALL_VERSION_MISMATCH');
  assert.ok(error);
  assert.equal(error.gm, 'GM-4095');
  assert.equal(error.path, 'filename');
});

test('incompatible SDK/runtime ranges are rejected (GM-4261 / GM-4260)', () => {
  const sdkReport = validateHtmlText(htmlWith(manifest({ sdkVersion: '^2.0.0' })));
  assert.equal(sdkReport.ok, false);
  assert.ok(sdkReport.errors.some((item) => item.code === 'E_COMPAT_SDK' && item.gm === 'GM-4261'));

  const runtimeReport = validateHtmlText(htmlWith(manifest({ runtimeVersion: '^2.0.0' })));
  assert.equal(runtimeReport.ok, false);
  assert.ok(runtimeReport.errors.some((item) => item.code === 'E_COMPAT_RUNTIME' && item.gm === 'GM-4260'));

  const legacy = validateHtmlText(htmlWith(manifest({ sdkVersion: '^0.1.0', runtimeVersion: '^0.1.0' })));
  assert.equal(legacy.ok, true, 'V0 0.1.x ranges stay accepted (V1-07)');
});

test('reports are capped at 50 items with truncated:true', () => {
  const body = Array.from({ length: 60 }, (_, index) => `<img src="https://example.com/${index}.png">`).join('');
  const report = validateHtmlText(htmlWith(manifest(), body));
  assert.equal(report.ok, false);
  assert.equal(report.errors.length, 50);
  assert.equal(report.truncated, true);
});

test('warnings are reported but do not fail validation', () => {
  const report = validateHtmlText(htmlWith(manifest({ capabilities: [], save: { schemaVersion: 1 }, score: undefined })));
  assert.equal(report.ok, true);
  assert.ok(report.warnings.some((item) => item.code === 'W_PKG_IGNORED_FIELD'));
  assert.ok(report.warnings.every((item) => typeof item.path === 'string'));
});

test('the CLI exits 0/1/2 for valid, invalid and usage inputs and prints JSON with --json', () => {
  const dir = tempDir();
  const valid = path.join(dir, 'demo-game-1.0.0.html');
  fs.writeFileSync(valid, htmlWith(manifest()), 'utf8');
  const ok = runCli(['validate', valid, '--json']);
  assert.equal(ok.status, 0);
  const parsed = JSON.parse(ok.stdout);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.manifest, { id: 'demo-game', name: 'Demo Game', version: '1.0.0' });

  const invalid = path.join(dir, 'broken.html');
  writeFiles(dir, { 'broken-src.html': htmlWith(manifest({ id: 'Bad ID' })) });
  fs.renameSync(path.join(dir, 'broken-src.html'), invalid);
  const bad = runCli(['validate', invalid, '--json']);
  assert.equal(bad.status, 1);
  const badJson = JSON.parse(bad.stdout);
  assert.equal(badJson.ok, false);
  assert.ok(badJson.errors.some((item) => item.code === 'E_PKG_ID_INVALID' && item.gm === 'GM-4234'));

  const usage = runCli(['validate', path.join(dir, 'nope.html')]);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /does not exist/i);
});
