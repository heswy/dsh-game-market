/**
 * M0 frozen-contract assertions (V1).
 *
 * This file is intentionally boring: it pins the cross-module surface that M1a
 * (install/Registry), M1b (SDK/CLI), M1c (games) and M2 (Market UI) build on.
 * Changing a value here means changing docs/V1-CONTRACTS.md and PROJECT_MEMORY.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  API_BASE,
  GM,
  INTERNAL_TO_GM,
  LIMITS,
  PACKAGE_BYTES_MAX,
  PROTOCOL_VERSION,
  ROUTES,
  RUNTIME_VERSION,
  SDK_VERSION,
  TIMING,
  gmForInternal,
  httpStatusFor,
  packageFileName,
  validatePackageHtml,
} from '../packages/shared/src/index.js';
import { checkCompatibility, isLegacyV0Range } from '../packages/host/src/semver.js';

test('V1 versions are frozen at SDK/Runtime 1.0.0 with protocol 1', () => {
  assert.equal(SDK_VERSION, '1.0.0');
  assert.equal(RUNTIME_VERSION, '1.0.0');
  assert.equal(PROTOCOL_VERSION, 1);
  assert.equal(API_BASE, '/api/game-market');
});

test('V1 route table is complete, unique and prefixed', () => {
  const values = Object.values(ROUTES);
  assert.equal(new Set(values).size, values.length, 'routes must be unique');
  for (const route of values) assert.ok(route.startsWith(`${API_BASE}/`), route);

  for (const name of ['INSTALL', 'INSTALL_LOCAL', 'UNINSTALL', 'REGISTRY_REFRESH', 'ENTRY', 'PREVIEW']) {
    assert.ok(ROUTES[name], `missing route ${name}`);
  }
  assert.equal(ROUTES.INSTALL, '/api/game-market/install');
  assert.equal(ROUTES.INSTALL_LOCAL, '/api/game-market/install-local');
  assert.equal(ROUTES.UNINSTALL, '/api/game-market/uninstall');
  assert.equal(ROUTES.REGISTRY_REFRESH, '/api/game-market/registry-refresh');
});

test('package limits match the single-file contract', () => {
  assert.equal(LIMITS.packageBytes, 20 * 1024 * 1024);
  assert.equal(PACKAGE_BYTES_MAX, LIMITS.packageBytes);
  assert.equal(LIMITS.manifestBytes, 64 * 1024);
  assert.equal(LIMITS.registryBytes, 2 * 1024 * 1024);
  assert.equal(LIMITS.registryGames, 500);
  assert.equal(LIMITS.iconBytes, 256 * 1024);
});

test('internal E_* codes translate to public GM-* codes', () => {
  assert.equal(gmForInternal('E_PKG_ENTRY_NOT_SELF_CONTAINED'), GM.ENTRY_NOT_SELF_CONTAINED);
  assert.equal(gmForInternal('E_PKG_MANIFEST_MISSING'), GM.MANIFEST_INVALID);
  assert.equal(gmForInternal('E_PKG_MANIFEST_DUPLICATE'), GM.MANIFEST_INVALID);
  assert.equal(gmForInternal('E_PKG_HTML_INVALID'), GM.PACKAGE_INVALID);
  assert.equal(gmForInternal('E_PKG_ICON_TOO_LARGE'), 'GM-4248');
  assert.equal(gmForInternal('E_PKG_MANIFEST_TOO_LARGE'), GM.MANIFEST_TOO_LARGE);
  assert.equal(gmForInternal('E_PKG_TOO_LARGE'), 'GM-4135');
  assert.equal(gmForInternal('E_INSTALL_HASH_MISMATCH'), 'GM-5015');
  assert.equal(gmForInternal('GM-4221'), 'GM-4221');
  assert.equal(gmForInternal('E_UNKNOWN_FUTURE'), GM.INTERNAL);
  // No zip/archive codes survive the single-file switch.
  // V1.5 supersedes the V1 "no zip/archive at all" rule (docs/V1.5-CONTRACTS.md
  // §0.2 marks it 废弃) and adds the asset-zip-v2 archive path. What must stay
  // frozen is that the V1 single-file codes are neither renumbered nor removed,
  // and that archive codes are the new ones only. Nothing above this line moved.
  for (const [internal, gmCode] of Object.entries(INTERNAL_TO_GM)) {
    assert.match(gmCode, /^GM-\d{4}$/, `${internal} must map to a GM code`);
  }
  const zipCodes = Object.keys(INTERNAL_TO_GM).filter((code) => code.includes('ZIP'));
  assert.deepEqual(zipCodes.sort(), [
    'E_ZIP_CRC_MISMATCH',
    'E_ZIP_HEADER_MISMATCH',
    'E_ZIP_LIMIT_EXCEEDED',
    'E_ZIP_PATH_CONFLICT',
    'E_ZIP_PATH_INVALID',
    'E_ZIP_STRUCTURE',
    'E_ZIP_UNSUPPORTED_FEATURE',
  ]);
  // The archive codes map into the V1.5 422 window, never onto a V1 code.
  for (const code of zipCodes) {
    assert.ok(INTERNAL_TO_GM[code].startsWith('GM-427'), `${code} must use the V1.5 archive window`);
  }
  // V1 single-file semantics keep their own codes.
  assert.equal(INTERNAL_TO_GM.E_PKG_HTML_INVALID, GM.PACKAGE_INVALID);
  assert.equal(INTERNAL_TO_GM.E_PKG_ENTRY_NOT_SELF_CONTAINED, GM.ENTRY_NOT_SELF_CONTAINED);
});

test('GM codes map to the PRD HTTP status', () => {
  assert.equal(httpStatusFor('GM-4221'), 422);
  assert.equal(httpStatusFor('GM-4222'), 422);
  assert.equal(httpStatusFor('GM-4135'), 413);
  assert.equal(httpStatusFor('GM-4044'), 404);
  assert.equal(httpStatusFor('GM-5001'), 500);
  assert.equal(httpStatusFor('GM-5034'), 503);
});

test('V0 games stay compatible through the legacy window (V1-07)', () => {
  assert.equal(isLegacyV0Range('^0.1.0'), true);
  assert.equal(isLegacyV0Range('0.1.0'), true);
  assert.equal(isLegacyV0Range('^1.0.0'), false);
  assert.doesNotThrow(() =>
    checkCompatibility({ capabilities: ['storage', 'score'], sdkVersion: '^0.1.0', runtimeVersion: '^0.1.0' }),
  );
  assert.doesNotThrow(() =>
    checkCompatibility({ capabilities: ['storage'], sdkVersion: '^1.0.0', runtimeVersion: '^1.0.0' }),
  );
  assert.throws(
    () => checkCompatibility({ capabilities: [], sdkVersion: '^2.0.0', runtimeVersion: '^1.0.0' }),
    (error) => error && error.code === GM.SDK_INCOMPATIBLE,
  );
  assert.throws(
    () => checkCompatibility({ capabilities: ['network'], sdkVersion: '^1.0.0', runtimeVersion: '^1.0.0' }),
    (error) => error && error.code === GM.MANIFEST_INVALID,
  );
});

test('the contract validators run end to end on a package sample', () => {
  const manifest = {
    manifestVersion: 1,
    id: 'jump',
    name: 'Jump',
    version: '1.0.0',
    author: { name: 'DSH' },
    description: '纵向平台跳跃。',
    categories: ['arcade'],
    capabilities: ['storage', 'score'],
    sdkVersion: '^1.0.0',
    runtimeVersion: '^1.0.0',
    score: { direction: 'higher-better', min: 0, max: 100000 },
    save: { schemaVersion: 1 },
  };
  const html = `<!doctype html><html><body><canvas></canvas><script type="application/json" id="dsh-game-manifest">${JSON.stringify(manifest)}</script><script>/* game */</script></body></html>`;
  const result = validatePackageHtml(html);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(packageFileName(result.manifest.id, result.manifest.version), 'jump-1.0.0.html');
});

test('M0 contract docs exist and match the frozen surface', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const docs = path.resolve(here, '..', 'docs');
  const files = {
    contracts: path.join(docs, 'V1-CONTRACTS.md'),
    acceptance: path.join(docs, 'V1-GAME-ACCEPTANCE.md'),
    verification: path.join(docs, 'V1-VERIFICATION.md'),
  };
  for (const [name, file] of Object.entries(files)) {
    assert.ok(readFileSync(file, 'utf8').length > 1000, `${name} doc must exist and be substantive`);
  }
  const contracts = readFileSync(files.contracts, 'utf8');
  for (const required of [
    'registryVersion: 1',
    'packages/<id>/<version>/entry.html',
    'entryBindingTtlMs',
    'E_PKG_HTML_INVALID',
    'GM-4222',
    'GM-4225',
    'GM-4038',
    'POST /install-local',
  ]) {
    assert.ok(contracts.includes(required), `contracts doc must mention ${required}`);
  }
  // Retired V1 internal codes must never reappear in the frozen docs.
  for (const retired of [
    'E_PKG_STRUCTURE',
    'E_PKG_ASSET_MISSING',
    'E_PKG_ASSET_FORMAT',
    'E_PKG_ASSET_TOO_LARGE',
    'E_PKG_ENTRY_MISSING',
    'E_PKG_PATH_UNSAFE',
    'E_REGISTRY_PACKAGE_URL',
  ]) {
    assert.equal(contracts.includes(retired), false, `contracts doc still mentions retired code ${retired}`);
  }
  const acceptance = readFileSync(files.acceptance, 'utf8');
  for (const game of ['snake', 'jump', '2048', 'breakout']) {
    assert.ok(acceptance.toLowerCase().includes(game), `acceptance doc must cover ${game}`);
  }
  const verification = readFileSync(files.verification, 'utf8');
  assert.ok(verification.includes('未执行') || verification.includes('待填'), 'verification doc must stay a skeleton');
});

test('TBD-10 launch binding TTL is frozen in constants', () => {
  assert.equal(TIMING.entryBindingTtlMs, 10 * 60 * 1000);
  assert.equal(TIMING.installLockWaitMs, 10000);
});
