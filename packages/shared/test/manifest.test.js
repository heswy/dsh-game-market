/**
 * V1 manifest / single-file package contract tests (PRD §8.2, M0).
 *
 * These tests are the executable half of the M0 freeze: if a future change
 * wants to alter the package format, it must change this file and the contract
 * docs deliberately.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORIES,
  MANIFEST_BYTES_MAX,
  MANIFEST_SCRIPT_ID,
  PACKAGE_BYTES_MAX,
  checkSelfContained,
  codePointLength,
  extractManifest,
  isDataImageUri,
  isPackageFileName,
  isValidRange,
  isValidVersion,
  packageFileName,
  utf8ByteLength,
  validateManifest,
  validatePackageHtml,
} from '../src/manifest.js';

const ICON = 'data:image/png;base64,iVBORw0KGgo=';

function manifest(overrides = {}) {
  return {
    manifestVersion: 1,
    id: 'block-drop',
    name: 'Block Drop',
    version: '1.2.0',
    author: { name: 'Orange', url: 'https://github.com/orange' },
    description: '把下落的方块叠成完整横行。',
    categories: ['puzzle', 'arcade'],
    capabilities: ['storage', 'score'],
    sdkVersion: '^1.0.0',
    runtimeVersion: '^1.0.0',
    icon: ICON,
    preferredTheme: 'game-defined',
    viewport: { width: 960, height: 540, fit: 'contain' },
    score: { direction: 'higher-better', min: 0, max: 1000000, integer: true },
    save: { schemaVersion: 1 },
    ...overrides,
  };
}

function html(manifestValue = manifest()) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Block Drop</title>
<script type="application/json" id="${MANIFEST_SCRIPT_ID}">${JSON.stringify(manifestValue)}</script>
</head><body><canvas id="stage"></canvas><script>globalThis.__boot = true;</script></body></html>`;
}

test('accepts a minimal valid single-file package', () => {
  const result = validatePackageHtml(html());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.errors.length, 0);
  assert.equal(result.manifest.id, 'block-drop');
  assert.equal(result.manifest.version, '1.2.0');
  assert.ok(result.bytes > 0);
});

test('requires exactly one inline manifest script', () => {
  const missing = validatePackageHtml('<html><body><canvas></canvas></body></html>');
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((error) => error.code === 'E_PKG_MANIFEST_MISSING'));

  const duplicate = validatePackageHtml(`${html()}${html()}`);
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.errors.some((error) => error.code === 'E_PKG_MANIFEST_DUPLICATE'));
});

test('rejects malformed or oversized inline manifests', () => {
  const malformed = html().replace(/\{"manifestVersion".*\}<\/script>/, '{not json}</script>');
  const result = validatePackageHtml(malformed);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'E_PKG_MANIFEST_JSON'));

  const bigDescription = 'x'.repeat(MANIFEST_BYTES_MAX + 100);
  const bigManifest = html(manifest({ description: bigDescription }));
  const big = validatePackageHtml(bigManifest);
  assert.equal(big.ok, false);
  assert.ok(big.errors.some((error) => error.code === 'E_PKG_MANIFEST_TOO_LARGE'));
});

test('manifest field rules: version/id/categories/capabilities', () => {
  assert.equal(validateManifest(manifest({ version: '1.0.0+build' })).ok, false);
  assert.equal(validateManifest(manifest({ id: 'Block_Drop' })).ok, false);
  assert.equal(validateManifest(manifest({ id: 'api' })).ok, false);
  assert.equal(validateManifest(manifest({ categories: ['not-a-category'] })).ok, false);
  assert.equal(validateManifest(manifest({ categories: [] })).ok, false);

  const unknownCapability = validateManifest(manifest({ capabilities: ['storage', 'net'] }));
  assert.ok(unknownCapability.errors.some((error) => error.code === 'E_PKG_CAPABILITY_UNKNOWN'));
  const unsupportedCapability = validateManifest(manifest({ capabilities: ['storage', 'network'] }));
  assert.ok(unsupportedCapability.errors.some((error) => error.code === 'E_PKG_CAPABILITY_UNSUPPORTED'));
  const duplicateCapability = validateManifest(manifest({ capabilities: ['storage', 'storage'] }));
  assert.ok(duplicateCapability.errors.some((error) => error.code === 'E_PKG_CAPABILITY_DUPLICATE'));
});

test('capability-driven required fields and legacy/removed fields', () => {
  const scoreRequired = validateManifest(manifest({ score: undefined }));
  assert.ok(scoreRequired.errors.some((error) => error.code === 'E_PKG_FIELD_MISSING'));
  const saveRequired = validateManifest(manifest({ save: undefined }));
  assert.ok(saveRequired.errors.some((error) => error.code === 'E_PKG_FIELD_MISSING'));

  const legacyAuthor = validateManifest(manifest({ author: 'Orange' }));
  assert.ok(legacyAuthor.errors.some((error) => error.code === 'E_PKG_LEGACY_FIELD'));
  const legacyEntry = validateManifest(manifest({ entry: 'index.html' }));
  assert.ok(legacyEntry.errors.some((error) => error.code === 'E_PKG_LEGACY_FIELD'));
  const permissions = validateManifest(manifest({ permissions: { network: true } }));
  assert.ok(permissions.errors.some((error) => error.code === 'E_PKG_PERMISSION_UNSUPPORTED'));
});

test('icon must be a bounded png/webp/jpeg data URI', () => {
  assert.equal(isDataImageUri(ICON), true);
  assert.equal(isDataImageUri('https://example.com/icon.png'), false);
  const bad = validateManifest(manifest({ icon: 'https://example.com/icon.png' }));
  assert.ok(bad.errors.some((error) => error.code === 'E_PKG_ICON_FORMAT'));
  const huge = 'A'.repeat(Math.ceil((300 * 1024 * 4) / 3));
  const oversized = validateManifest(manifest({ icon: `data:image/png;base64,${huge}` }));
  assert.ok(oversized.errors.some((error) => error.code === 'E_PKG_ICON_TOO_LARGE'));
});

test('self-containment rejects external resources and network APIs', () => {
  const cases = [
    '<script src="https://cdn.example.com/game.js"></script>',
    '<link rel="stylesheet" href="./style.css">',
    '<img src="../asset.png">',
    '<iframe src="about:blank"></iframe>',
    '<style>@import url("https://x/y.css");</style>',
    '<style>.a{background:url(https://x/y.png)}</style>',
    '<script>fetch("/api/steal")</script>',
    '<script>new WebSocket("wss://x")</script>',
    '<script>navigator.sendBeacon("/x", "y")</script>',
  ];
  for (const snippet of cases) {
    const violations = checkSelfContained(`<html><body>${snippet}</body></html>`);
    assert.ok(
      violations.some((error) => error.code === 'E_PKG_ENTRY_NOT_SELF_CONTAINED'),
      `expected violation for ${snippet}`,
    );
  }
  const inline = '<html><body><canvas></canvas><script>const s = "fetch is not used";</script></body></html>';
  assert.equal(checkSelfContained(inline).length, 0);
  const dataUri = `<html><body><img src="data:image/png;base64,${ICON}"></body></html>`;
  assert.equal(checkSelfContained(dataUri).length, 0);
});

test('package size limit is enforced (limit injectable for tests)', () => {
  const body = `<html><body>${'x'.repeat(2000)}</body></html>`;
  const result = validatePackageHtml(body, { packageBytes: 100 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'E_PKG_TOO_LARGE'));
  assert.equal(PACKAGE_BYTES_MAX, 20 * 1024 * 1024);
  assert.equal(MANIFEST_BYTES_MAX, 64 * 1024);
});

test('extractManifest returns the manifest text span', () => {
  const source = html();
  const extracted = extractManifest(source);
  assert.equal(extracted.ok, true);
  assert.ok(extracted.span);
  const [start, end] = extracted.span;
  assert.ok(source.slice(start, end).startsWith('<script'));
  assert.equal(JSON.parse(extracted.jsonText).id, 'block-drop');
});

test('helpers: semver/range/byte length/code points/package file name', () => {
  assert.equal(isValidVersion('1.0.0'), true);
  assert.equal(isValidVersion('1.0.0-beta.1'), true);
  assert.equal(isValidVersion('1.0'), false);
  assert.equal(isValidVersion('01.0.0'), false);
  assert.equal(isValidRange('^1.0.0'), true);
  assert.equal(isValidRange('>=1.0.0 <2.0.0'), true);
  assert.equal(isValidRange('latest'), false);
  assert.equal(packageFileName('snake', '1.0.0'), 'snake-1.0.0.html');
  assert.equal(isPackageFileName('snake-1.0.0.html', 'snake', '1.0.0'), true);
  assert.equal(isPackageFileName('snake-1.0.0.zip', 'snake', '1.0.0'), false);
  assert.equal(utf8ByteLength('你好'), 6);
  assert.equal(codePointLength('你好'), 2);
  assert.ok(CATEGORIES.includes('arcade'));
});
