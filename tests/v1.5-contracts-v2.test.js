/**
 * V1.5 shared-layer contract tests (M1).
 *
 * These lock the pure-JS surface that Host, Runtime, SDK, CLI, content tooling
 * and the browser bundle all import: archive path policy, descriptor validation,
 * static content scanning, the two-generation catalog projection, resource URL
 * shape and the installation-record extension.
 *
 * They intentionally test *policy*, not ZIP container parsing — the container
 * lives in packages/host/src/zip.js and is covered by A03's malicious matrix.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  DESCRIPTOR_FILE,
  LIMITS,
  PACKAGE_FORMATS,
  PACKAGE_ZIP_EXTENSION,
  REGISTRY_CACHE_V2_FILE,
  REGISTRY_V2_FILE,
  RESOURCE_ORIGIN_PATH,
  RESOURCE_WRAPPER_PATH,
  RESOURCE_WRAPPER_QUERY,
  ZIP_GAME_MANIFEST_FILE,
} from '../packages/shared/src/constants.js';
import { GM, INTERNAL_TO_GM, httpStatusFor } from '../packages/shared/src/errors.js';
import {
  canonicalFileManifest,
  checkCssContent,
  checkHtmlContent,
  checkManifestConflict,
  checkPathConflicts,
  checkZipEntryPath,
  compareFileManifest,
  fileManifestDigest,
  normalizeZipPath,
  validateDescriptor,
} from '../packages/shared/src/package-v2.js';
import {
  projectRegistryEntries,
  selectProjectedReleases,
  upgradeCatalogV1ToV2,
  validateCatalogV2,
  validateRegistryCacheV2,
  validateRegistryV2,
} from '../packages/shared/src/catalog-v2.js';
import {
  assetUrl,
  buildResourceBase,
  isAbsoluteHttpUrl,
  normalizeResourceOrigin,
  resourceCredentialOf,
  sharesOrigin,
  validateAssetRequest,
} from '../packages/shared/src/resources.js';
import {
  entryStoragePathForRecord,
  normalizeInstallationRecord,
  validateInstallationRecordV15,
} from '../packages/shared/src/installation.js';

const hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha = (char) => char.repeat(64);
const INSTANCE = 'a'.repeat(32);
const TOKEN = 'b'.repeat(32);

// ---------------------------------------------------------------------------
// Constants and error mapping
// ---------------------------------------------------------------------------

test('V1.5 constants keep the frozen limit boundaries', () => {
  assert.equal(LIMITS.zip.zipOuterBytes, 20 * 1024 * 1024);
  assert.equal(LIMITS.zip.zipUnpackedBytes, 100 * 1024 * 1024);
  assert.equal(LIMITS.zip.zipEntries, 512);
  assert.equal(LIMITS.zip.zipEntries - 1, 511, 'files[] budget excludes the descriptor');
  assert.equal(PACKAGE_ZIP_EXTENSION, '.dshgame.zip');
  assert.deepEqual([...PACKAGE_FORMATS], ['html-v1', 'asset-zip-v2']);
  assert.equal(DESCRIPTOR_FILE, 'dsh-package.json');
  assert.equal(ZIP_GAME_MANIFEST_FILE, 'game.json');
  assert.equal(REGISTRY_V2_FILE, 'v2/games.json');
  assert.equal(REGISTRY_CACHE_V2_FILE, 'registry-cache-v2.json');
  assert.equal(RESOURCE_ORIGIN_PATH, '/res');
  assert.equal(RESOURCE_WRAPPER_PATH, '/wrapper');
  assert.equal(RESOURCE_WRAPPER_QUERY, 'src');
});

test('V1.5 error codes map to the contract HTTP statuses', () => {
  assert.equal(httpStatusFor(GM.ZIP_INVALID), 422);
  assert.equal(httpStatusFor(GM.ZIP_LIMIT), 422);
  assert.equal(httpStatusFor(GM.DESCRIPTOR_INVALID), 422);
  assert.equal(httpStatusFor(GM.ASSET_INLINE_FORBIDDEN), 422);
  assert.equal(httpStatusFor(GM.RESOURCE_CREDENTIAL_EXPIRED), 403, 'S-A1 measured 403 for expired/released');
  assert.equal(httpStatusFor(GM.ENTRY_LAUNCH_CONSUMED), 410, 'S-A1 measured 410 for a replayed launch URL');
  assert.equal(httpStatusFor(GM.UPDATE_TARGET_INVALID), 409);
  assert.equal(httpStatusFor(GM.INSTALL_HASH_MISMATCH), 500);
  for (const internal of [
    'E_ZIP_LIMIT_EXCEEDED', 'E_ZIP_PATH_INVALID', 'E_DESCRIPTOR_INVALID', 'E_DESCRIPTOR_MISMATCH',
    'E_ASSET_INLINE_FORBIDDEN', 'E_CATALOG_IMMUTABLE', 'E_FORMAT_POLICY', 'E_RESOURCE_SCOPE_DENIED',
  ]) {
    assert.ok(INTERNAL_TO_GM[internal], `${internal} must translate to a GM code`);
    assert.match(INTERNAL_TO_GM[internal], /^GM-\d{4}$/);
  }
});

// ---------------------------------------------------------------------------
// Archive path policy (contract §4.2)
// ---------------------------------------------------------------------------

test('archive paths: traversal, absolute and Windows carriers are rejected', () => {
  const rejected = [
    '', '/etc/passwd', '..', '../x', 'a/../../b', 'a/./b', 'a//b', './a',
    'C:/x', 'c:\\x', 'a\\b', 'a/b\\c', 'a\u0000b', 'a\u001fb', 'a/b\u007f',
    'con', 'aux.js', 'a/NUL.txt', 'a/com1', 'a/b ', 'a/b.', 'a/'.repeat(1) + 'b/',
    `${'a/'.repeat(13)}b`,
  ];
  for (const raw of rejected) {
    const result = normalizeZipPath(raw);
    assert.equal(result.ok, false, `expected rejection: ${JSON.stringify(raw)}`);
    assert.ok(result.code === 'E_ZIP_PATH_INVALID' || result.code === 'E_ZIP_LIMIT_EXCEEDED', raw);
  }
  const accepted = ['index.html', 'scripts/main.js', 'a/b/c.json', 'assets/coin.PNG', 'x-y_z.1.css'];
  for (const raw of accepted) {
    const result = normalizeZipPath(raw);
    assert.equal(result.ok, true, `expected acceptance: ${raw}`);
    assert.equal(result.value, raw);
  }
});

test('archive paths: length and depth limits are exact at the boundary', () => {
  const deepOk = `${'a/'.repeat(LIMITS.zip.zipPathDepth - 1)}b`;
  assert.equal(normalizeZipPath(deepOk).ok, true);
  const deepBad = `${'a/'.repeat(LIMITS.zip.zipPathDepth)}b`;
  assert.equal(normalizeZipPath(deepBad).ok, false);
  const longOk = 'a'.repeat(LIMITS.zip.zipPathChars);
  assert.equal(normalizeZipPath(longOk).ok, true);
  const longBad = 'a'.repeat(LIMITS.zip.zipPathChars + 1);
  assert.equal(normalizeZipPath(longBad).ok, false);
});

test('archive paths: type whitelist and reserved names', () => {
  assert.deepEqual(checkZipEntryPath('index.html'), { ok: true, value: 'index.html', kind: 'document' });
  assert.deepEqual(checkZipEntryPath('game.json'), { ok: true, value: 'game.json', kind: 'manifest' });
  assert.deepEqual(checkZipEntryPath(DESCRIPTOR_FILE), { ok: true, value: DESCRIPTOR_FILE, kind: 'descriptor' });
  for (const bad of ['run.exe', 'lib.node', 'a.wasm', 'noext', 'dir/', 'x/y.TTF2']) {
    assert.equal(checkZipEntryPath(bad).ok, false, bad);
  }
  // A descriptor anywhere but the root is a second-manifest attempt.
  assert.equal(checkZipEntryPath(`sub/${DESCRIPTOR_FILE}`).ok, false);
});

test('archive paths: duplicate, case-folded, NFC-folded and file/dir conflicts', () => {
  assert.equal(checkPathConflicts(['a.js', 'b.js']).ok, true);
  assert.equal(checkPathConflicts(['a.js', 'a.js']).ok, false);
  assert.equal(checkPathConflicts(['A.js', 'a.js']).ok, false, 'case folding');
  const nfc = 'e\u0301.txt'; // e + combining acute
  const precomposed = '\u00e9.txt';
  assert.equal(checkPathConflicts([nfc, precomposed]).ok, false, 'NFC folding');
  assert.equal(checkPathConflicts(['a', 'a/b']).ok, false, 'file vs directory');
});

// ---------------------------------------------------------------------------
// Descriptor (contract §1.4)
// ---------------------------------------------------------------------------

function descriptor(files, overrides = {}) {
  return {
    formatVersion: 2,
    entry: 'index.html',
    gameManifest: ZIP_GAME_MANIFEST_FILE,
    files,
    ...overrides,
  };
}

function sortedFiles(...paths) {
  return [...paths]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((path, index) => ({ path, size: index + 1, sha256: String(index % 10).repeat(64) }));
}

test('descriptor: valid shape is accepted and normalized', () => {
  const files = sortedFiles('game.json', 'index.html', 'scripts/main.js');
  const result = validateDescriptor(descriptor(files));
  assert.equal(result.ok, true);
  assert.equal(result.value.formatVersion, 2);
  assert.equal(result.value.entry, 'index.html');
  assert.deepEqual(result.value.files.map((file) => file.path), ['game.json', 'index.html', 'scripts/main.js']);
  assert.deepEqual(result.warnings, []);
});

test('descriptor: ordering, self-reference, missing entry and duplicates are rejected', () => {
  const files = sortedFiles('game.json', 'index.html');
  // Out of order
  assert.equal(validateDescriptor(descriptor([files[1], files[0]])).ok, false);
  // Self reference
  assert.equal(validateDescriptor(descriptor(sortedFiles(DESCRIPTOR_FILE, 'index.html'))).ok, false);
  // Entry not listed
  assert.equal(validateDescriptor(descriptor(sortedFiles('game.json'))).ok, false);
  // Manifest not listed
  assert.equal(validateDescriptor(descriptor(sortedFiles('index.html'))).ok, false);
  // Duplicate path
  const dup = [{ path: 'game.json', size: 1, sha256: sha('a') }, { path: 'game.json', size: 2, sha256: sha('b') }];
  assert.equal(validateDescriptor(descriptor(dup)).ok, false);
  // Bad hashes / sizes / formatVersion
  assert.equal(validateDescriptor(descriptor(sortedFiles('game.json', 'index.html'), { formatVersion: 1 })).ok, false);
  assert.equal(validateDescriptor(descriptor([{ path: 'game.json', size: 1, sha256: 'XYZ' }])).ok, false);
  assert.equal(validateDescriptor(descriptor([{ path: 'game.json', size: -1, sha256: sha('a') }])).ok, false);
  assert.equal(validateDescriptor(null).ok, false);
});

test('descriptor: files[] budget is 511 because the descriptor takes one entry (rule 0)', () => {
  const filler = (count) => Array.from({ length: count }, (_, i) => ({
    path: `f${String(i).padStart(3, '0')}.txt`, size: 1, sha256: sha('a'),
  }));
  const required = [
    { path: 'index.html', size: 2, sha256: sha('b') },
    { path: 'game.json', size: 1, sha256: sha('c') },
  ];
  const sort = (files) => files.sort((a, b) => (a.path < b.path ? -1 : 1));

  // 511 declared files (+ the descriptor) is exactly the 512-entry budget.
  const atLimit = sort([...required, ...filler(509)]);
  assert.equal(atLimit.length, 511);
  assert.equal(validateDescriptor(descriptor(atLimit)).ok, true, '511 files + descriptor = 512 entries is allowed');

  // 512 declared files would need 513 central-directory entries: rejected.
  const overLimit = sort([...required, ...filler(510)]);
  assert.equal(overLimit.length, 512);
  const rejected = validateDescriptor(descriptor(overLimit));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'E_ZIP_LIMIT_EXCEEDED');
});

test('file manifest digest is canonical and uses the injected sha256', () => {
  const files = sortedFiles('game.json', 'index.html');
  const digest = fileManifestDigest(files, hex);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest, hex(canonicalFileManifest(files)));
  // Key order in the input must not change the digest.
  const shuffled = files.map((file) => ({ sha256: file.sha256, size: file.size, path: file.path }));
  assert.equal(fileManifestDigest(shuffled, hex), digest);
  // A changed byte changes the digest.
  const tampered = files.map((file, index) => (index === 0 ? { ...file, size: 999 } : file));
  assert.notEqual(fileManifestDigest(tampered, hex), digest);
  assert.throws(() => fileManifestDigest(files), /sha256Hex/);
});

test('descriptor vs archive entry set is compared in both directions', () => {
  const files = sortedFiles('game.json', 'index.html');
  const entries = files.map((file) => ({ path: file.path, size: file.size }));
  assert.equal(compareFileManifest(files, entries).ok, true);
  assert.equal(compareFileManifest(files, entries.slice(1)).ok, false, 'missing');
  assert.equal(compareFileManifest(files, [...entries, { path: 'extra.js', size: 1 }]).ok, false, 'extra');
  assert.equal(compareFileManifest(files, [{ ...entries[0], size: 999 }, entries[1]]).ok, false, 'size');
});

// ---------------------------------------------------------------------------
// Static content scanning (contract §4.7) — defence in depth, not a proof
// ---------------------------------------------------------------------------

test('markup scanning rejects base/iframe/external URLs/eval/service workers', () => {
  const forbidden = [
    '<base href="https://evil.example/">',
    '<iframe src="./x.html"></iframe>',
    '<script src="https://evil.example/x.js"></script>',
    '<link rel="stylesheet" href="//evil.example/x.css">',
    '<style>@import url("https://evil.example/x.css");</style>',
    '<script>eval("1")</script>',
    '<script>new Function("return 1")()</script>',
    '<script>navigator.serviceWorker.register("sw.js")</script>',
    '<script>window.open("x")</script>',
  ];
  for (const html of forbidden) {
    assert.equal(checkHtmlContent(html, { inlineForbidden: false }).ok, false, html);
  }
  const allowed = '<script src="./scripts/main.js"></script><link rel="stylesheet" href="styles/game.css"><img src="../assets/coin.png">';
  assert.equal(checkHtmlContent(allowed, { inlineForbidden: true }).ok, true);
});

test('asset-zip-v2 additionally forbids inline script, inline style, handlers and javascript: URLs', () => {
  const inlineForbidden = [
    '<script>console.log(1)</script>',
    '<style>body{}</style>',
    '<button onclick="x()">go</button>',
    '<a href="javascript:alert(1)">x</a>',
  ];
  for (const html of inlineForbidden) {
    assert.equal(checkHtmlContent(html, { inlineForbidden: true }).ok, false, html);
    // The same markup is acceptable for the legacy single-file format: the V1
    // path is unchanged and must not regress.
    assert.equal(checkHtmlContent(html, { inlineForbidden: false }).ok, true, html);
  }
});

test('CSS scanning rejects external references', () => {
  assert.equal(checkCssContent('body{color:#fff}').ok, true);
  assert.equal(checkCssContent('@import url("https://evil.example/x.css");').ok, false);
  assert.equal(checkCssContent('.a{background:url(//evil.example/x.png)}').ok, false);
});

test('a ZIP package must not declare a second inline manifest', () => {
  assert.equal(checkManifestConflict('<script type="application/json" id="dsh-game-manifest">{}</script>').ok, false);
  assert.equal(checkManifestConflict('<script src="./main.js"></script>').ok, true);
});

// ---------------------------------------------------------------------------
// Two-generation catalog projection (contract §5.5)
// ---------------------------------------------------------------------------

function catalogV2({ gameId = 'orbit', releases, withdrawnAt = null } = {}) {
  return {
    schemaVersion: 2,
    gameId,
    owner: { login: 'author', githubUserId: 42 },
    game: {
      id: gameId,
      name: 'Orbit Courier',
      description: 'Deliver things.',
      author: { name: 'Author' },
      categories: ['arcade'],
      tags: [],
      capabilities: ['storage'],
      sdkVersion: '^1.0.0',
      runtimeVersion: '^1.0.0',
      publishedAt: '2026-10-01T00:00:00.000Z',
    },
    releases,
    withdrawnAt,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
  };
}

function release(version, format, extra = {}) {
  return {
    version,
    format,
    tag: `orbit-v${version}`,
    package: {
      url: `https://github.com/heswy/dsh-game-registry/releases/download/orbit-v${version}/orbit-${version}${format === 'asset-zip-v2' ? '.dshgame.zip' : '.html'}`,
      sha256: sha('a'),
      size: 1024,
      ...(format === 'asset-zip-v2' ? { filesDigest: sha('b') } : {}),
    },
    media: {
      cover: { url: `https://github.com/heswy/dsh-game-registry/releases/download/orbit-v${version}/cover.png` },
      screenshots: [{ url: `https://github.com/heswy/dsh-game-registry/releases/download/orbit-v${version}/shot.png` }],
    },
    sourceCommit: 'abcdef1',
    reviewSha256: sha('c'),
    releasedAt: `2026-10-0${Math.min(9, Number(version.split('.')[1]) + 1)}T00:00:00.000Z`,
    ...extra,
  };
}

test('catalog v2: valid shape accepted, format and release rules enforced', () => {
  const ok = validateCatalogV2(catalogV2({ releases: [release('1.0.0', 'html-v1')] }));
  assert.equal(ok.ok, true);

  assert.equal(validateCatalogV2({ ...catalogV2({ releases: [release('1.0.0', 'html-v1')] }), schemaVersion: 1 }).ok, false);
  assert.equal(validateCatalogV2(catalogV2({ releases: [release('1.0.0', 'tar-v9')] })).ok, false);
  assert.equal(validateCatalogV2(catalogV2({ releases: [release('1.0.0', 'html-v1'), release('1.0.0', 'html-v1')] })).ok, false);
  assert.equal(validateCatalogV2(catalogV2({ gameId: 'other', releases: [release('1.0.0', 'html-v1')] }), { gameId: 'orbit' }).ok, false);
});

test('projection: v2 takes the newest release, v1 keeps the newest HTML release', () => {
  const catalog = catalogV2({
    releases: [release('1.0.0', 'html-v1'), release('1.1.0', 'html-v1'), release('2.0.0', 'asset-zip-v2')],
  });
  const selected = selectProjectedReleases(catalog);
  assert.equal(selected.v2.version, '2.0.0');
  assert.equal(selected.v2.format, 'asset-zip-v2');
  assert.equal(selected.v1.version, '1.1.0', 'old clients keep a real HTML release, not a degraded ZIP');
  assert.equal(selected.v1.format, 'html-v1');

  const projected = projectRegistryEntries([catalog]);
  assert.equal(projected.ok, true);
  assert.equal(projected.v2.registryVersion, 2);
  assert.equal(projected.v1.registryVersion, 1);
  assert.equal(projected.v2.games[0].package.format, 'asset-zip-v2');
  assert.equal(projected.v2.games[0].package.filesDigest, sha('b'));
  assert.equal(projected.v1.games[0].version, '1.1.0');
  assert.equal(projected.v1.games[0].package.format, undefined, 'the v1 schema must not gain a format field');
});

test('projection: a ZIP-only game is absent from v1 but present in v2', () => {
  const catalog = catalogV2({ releases: [release('2.0.0', 'asset-zip-v2')] });
  const projected = projectRegistryEntries([catalog]);
  assert.equal(projected.ok, true);
  assert.equal(projected.v1, null);
  assert.equal(projected.v2.games.length, 1);
});

test('projection: a withdrawn game disappears from both generations', () => {
  const catalog = catalogV2({
    releases: [release('1.0.0', 'html-v1'), release('2.0.0', 'asset-zip-v2')],
    withdrawnAt: '2026-10-09T00:00:00.000Z',
  });
  const projected = projectRegistryEntries([catalog]);
  assert.equal(projected.ok, true);
  assert.equal(projected.v1, null);
  assert.equal(projected.v2, null);
});

test('projection: generatedAt comes from the sources, and output is byte-stable', () => {
  const a = catalogV2({ gameId: 'orbit', releases: [release('1.0.0', 'html-v1')] });
  const b = catalogV2({ gameId: 'aster', releases: [release('1.0.0', 'html-v1')] });
  b.game.id = 'aster';
  b.owner = { login: 'author', githubUserId: 42 };
  b.updatedAt = '2026-12-31T00:00:00.000Z';

  const first = projectRegistryEntries([a, b]);
  const second = projectRegistryEntries([b, a]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(JSON.stringify(first), JSON.stringify(second), 'input order must not matter');
  assert.equal(first.v2.generatedAt, '2026-12-31T00:00:00.000Z', 'build clock must not leak in');
  assert.deepEqual(first.v2.games.map((game) => game.id), ['aster', 'orbit'], 'sorted by id');
});

test('projection: a v1 catalog is upgraded in memory, never rewritten', () => {
  const v1 = {
    schemaVersion: 1,
    game: {
      id: 'legacy', name: 'Legacy', description: 'x', author: { name: 'a' },
      categories: ['arcade'], tags: [], capabilities: [], sdkVersion: '^1.0.0',
      runtimeVersion: '^1.0.0', version: '1.0.0', publishedAt: '2026-09-01T00:00:00.000Z',
    },
    release: {
      tag: 'legacy-v1.0.0',
      packageUrl: 'https://github.com/heswy/dsh-game-registry/releases/download/legacy-v1.0.0/legacy-1.0.0.html',
      packageSha256: sha('d'),
      packageSize: 100,
      cover: { url: 'https://github.com/heswy/dsh-game-registry/releases/download/legacy-v1.0.0/cover.png' },
      screenshots: [{ url: 'https://github.com/heswy/dsh-game-registry/releases/download/legacy-v1.0.0/shot.png' }],
      releasedAt: '2026-09-01T00:00:00.000Z',
    },
    createdAt: '2026-09-01T00:00:00.000Z',
  };
  const upgraded = upgradeCatalogV1ToV2(v1);
  assert.equal(upgraded.schemaVersion, 2);
  assert.equal(upgraded.releases.length, 1);
  assert.equal(upgraded.releases[0].format, 'html-v1');
  assert.equal(upgraded.gameId, 'legacy');
  const projected = projectRegistryEntries([v1]);
  assert.equal(projected.ok, true);
  assert.equal(projected.v1.games[0].id, 'legacy');
  assert.equal(v1.schemaVersion, 1, 'upgrade must not mutate the source');
  assert.equal('releases' in v1, false);
});

test('registry v2: format is mandatory and one bad entry rejects the whole index', () => {
  const goodEntry = {
    id: 'orbit', name: 'Orbit', version: '2.0.0', description: 'x', author: { name: 'a' },
    categories: ['arcade'], tags: [], capabilities: [], sdkVersion: '^1.0.0', runtimeVersion: '^1.0.0',
    package: {
      url: 'https://github.com/heswy/dsh-game-registry/releases/download/orbit-v2.0.0/orbit-2.0.0.dshgame.zip',
      sha256: sha('a'), size: 10, releasedAt: '2026-10-01T00:00:00.000Z', format: 'asset-zip-v2',
    },
    cover: 'https://github.com/heswy/dsh-game-registry/releases/download/orbit-v2.0.0/cover.png',
    screenshots: [],
    publishedAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
  const index = { registryVersion: 2, generatedAt: '2026-10-01T00:00:00.000Z', games: [goodEntry] };
  assert.equal(validateRegistryV2(index).ok, true);

  const missingFormat = { ...goodEntry, package: { ...goodEntry.package } };
  delete missingFormat.package.format;
  assert.equal(validateRegistryV2({ ...index, games: [missingFormat] }).ok, false);

  assert.equal(validateRegistryV2({ ...index, registryVersion: 1 }).ok, false);
  assert.equal(validateRegistryV2({ ...index, games: [goodEntry, goodEntry] }).ok, false, 'duplicate id');
});

test('registry v2 cache is never confused with the v1 cache', () => {
  const cache = {
    schemaVersion: 2,
    registryVersion: 2,
    fetchedAt: '2026-10-01T00:00:00.000Z',
    sourceUrl: 'https://raw.githubusercontent.com/heswy/dsh-game-registry/main/registry/v2/games.json',
    etag: null,
    lastModified: null,
    truncated: false,
    games: [],
  };
  assert.equal(validateRegistryCacheV2(cache).ok, true);
  assert.equal(validateRegistryCacheV2({ ...cache, schemaVersion: 1 }).ok, false, 'v1 cache must not load as v2');
  assert.equal(validateRegistryCacheV2({ ...cache, registryVersion: 1 }).ok, false);
  assert.equal(
    validateRegistryCacheV2(cache, { sourceUrl: 'https://other.example/v2/games.json' }).ok,
    false,
    'a cache from another source is not usable',
  );
});

// ---------------------------------------------------------------------------
// Resource URL shape (contract §7.1–§7.6)
// ---------------------------------------------------------------------------

test('resource origin must be a loopback http origin and nothing else', () => {
  assert.deepEqual(normalizeResourceOrigin('http://127.0.0.1:41234'), { ok: true, value: 'http://127.0.0.1:41234' });
  assert.equal(normalizeResourceOrigin('http://127.0.0.1:41234/').ok, true);
  for (const bad of [
    'https://127.0.0.1:41234', 'http://0.0.0.0:41234', 'http://localhost:41234',
    'http://127.0.0.1:41234/path', 'http://127.0.0.1:41234?x=1', 'http://user:pw@127.0.0.1:41234',
    'file:///tmp/x', 'javascript:alert(1)', '', null,
  ]) {
    assert.equal(normalizeResourceOrigin(bad).ok, false, String(bad));
  }
});

test('resource request parsing keeps the three-part shape and rejects escapes', () => {
  const base = `http://127.0.0.1:41234/res/${INSTANCE}/${TOKEN}`;
  const parsed = validateAssetRequest(`${new URL(base).pathname}/scripts/main.js`);
  assert.deepEqual(parsed, {
    ok: true,
    value: { instanceId: INSTANCE, resourceToken: TOKEN, relativePath: 'scripts/main.js' },
  });
  for (const bad of [
    `/res/${INSTANCE}/${TOKEN}/../secret`,
    `/res/${INSTANCE}/${TOKEN}/%2e%2e/secret`,
    `/res/${INSTANCE}/${TOKEN}/a%2fb`,
    `/res/${INSTANCE}/${TOKEN}/dsh-package.json`,
    `/res/${INSTANCE}/${TOKEN}/game.json`,
    `/res/${INSTANCE}/${TOKEN}/nested/`,
    `/res/${INSTANCE}/${TOKEN}/`,
    `/res/${INSTANCE}/not-a-token/main.js`,
    `/res/nope/${TOKEN}/main.js`,
    `/api/game-market/save`,
  ]) {
    assert.equal(validateAssetRequest(bad).ok, false, bad);
  }
  assert.equal(resourceCredentialOf(`${new URL(base).pathname}/index.html`), TOKEN);
  assert.equal(resourceCredentialOf('/api/game-market/save'), null);
});

test('assetUrl joins safely and refuses to escape the resource base', () => {
  const baseResult = buildResourceBase({ resourceOrigin: 'http://127.0.0.1:41234', instanceId: INSTANCE, resourceToken: TOKEN });
  assert.equal(baseResult.ok, true);
  const base = baseResult.value;
  assert.equal(assetUrl(base, 'levels/level-01.json').value, `${base}/levels/level-01.json`);
  assert.equal(assetUrl(`${base}/`, './styles/game.css').value, `${base}/styles/game.css`);
  for (const bad of ['../x', '/etc/passwd', 'a/../../b', '', 'dsh-package.json', 'game.json', 'a\\b']) {
    assert.equal(assetUrl(base, bad).ok, false, bad);
  }
  assert.equal(assetUrl('', 'x').ok, false);
  assert.equal(isAbsoluteHttpUrl(base), true);
  assert.equal(isAbsoluteHttpUrl('/res/x'), false);
  assert.equal(sharesOrigin(`${base}/x`, 'http://127.0.0.1:41234'), true);
  assert.equal(sharesOrigin('http://127.0.0.1:9999/x', 'http://127.0.0.1:41234'), false);
});

// ---------------------------------------------------------------------------
// Installation record extension (contract §6.2)
// ---------------------------------------------------------------------------

test('installation records normalize V1.5 fields without a schema bump', () => {
  const legacy = { id: 'snake', version: '1.0.0', source: 'builtin', packagePath: 'snake/1.0.0', sha256: null };
  const normalized = normalizeInstallationRecord(legacy);
  assert.equal(normalized.format, 'html-v1');
  assert.equal(normalized.entry, 'entry.html');
  assert.equal(normalized.fileManifestDigest, null);
  assert.equal(normalized.fileCount, null);
  assert.equal(normalized.unpackedBytes, null);
  assert.equal(normalized.previousFormat, null);
  assert.equal(normalized.id, 'snake', 'unknown/known fields are preserved');
  assert.equal(validateInstallationRecordV15(normalized).ok, true);

  const zipRecord = normalizeInstallationRecord({
    id: 'orbit', version: '2.0.0', format: 'asset-zip-v2', entry: 'index.html',
    fileManifestDigest: sha('a'), fileCount: 12, unpackedBytes: 4096,
  });
  assert.equal(zipRecord.format, 'asset-zip-v2');
  assert.equal(entryStoragePathForRecord('orbit', '2.0.0', zipRecord), 'packages/orbit/2.0.0/index.html');
  assert.equal(entryStoragePathForRecord('snake', '1.0.0', normalized), 'packages/snake/1.0.0/entry.html');

  assert.equal(validateInstallationRecordV15({ format: 'tar-v9' }).ok, false);
  assert.equal(validateInstallationRecordV15({ fileManifestDigest: 'nope' }).ok, false);
});
