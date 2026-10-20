/**
 * M2-B: built-in `asset-zip-v2` packages (`orbit-courier`).
 *
 * The built-in game is an **already-extracted package directory**
 * (`games/<id>/dist/` with `dsh-package.json` + `game.json` + resources). It
 * must go through the *same* descriptor/manifest validation and the *same*
 * instance resource origin as an installed ZIP package — this file proves that,
 * plus the two fail-closed branches:
 *
 *   - package tree absent in this checkout  -> the built-in is skipped (it is
 *     simply not bundled here; a production bundle missing it fails
 *     `scripts/check.mjs`, not the runtime);
 *   - package present but invalid/tampered  -> `issue='package-invalid'` and
 *     `/launch` is rejected with a visible GM-* error (never served).
 *
 * Most cases use a temporary fixture so they do not depend on the game author's
 * generated `games/orbit-courier/dist`; the last test re-validates the real
 * bundle when it exists (skipped otherwise).
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ASSET_ZIP_V2,
  DESCRIPTOR_FILE,
  ZIP_GAME_MANIFEST_FILE,
} from '../../../shared/src/constants.js';
import { BUILTIN_GAMES } from '../../../shared/src/builtin-games.js';
import { ROUTES } from '../../../shared/src/contracts.js';
import { GM } from '../../../shared/src/errors.js';
import { fileManifestDigest } from '../../../shared/src/package-v2.js';
import { createHostHarness } from '../support/harness.js';
import { buildPackage, defaultFiles } from '../../../../tests/helpers/zip-package.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const REPO_GAMES_ROOT = path.join(REPO_ROOT, 'games');
const ORBIT_ID = 'orbit-courier';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function wavBytes() {
  const bytes = Buffer.alloc(44);
  bytes.write('RIFF', 0, 'latin1');
  bytes.writeUInt32LE(36, 4);
  bytes.write('WAVE', 8, 'latin1');
  bytes.write('fmt ', 12, 'latin1');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(8000, 28);
  bytes.writeUInt16LE(1, 32);
  bytes.writeUInt16LE(8, 34);
  bytes.write('data', 36, 'latin1');
  bytes.writeUInt32LE(0, 40);
  return bytes;
}

function miniManifest() {
  return {
    manifestVersion: 1,
    id: ORBIT_ID,
    name: '轨道信使',
    version: '1.0.0',
    author: { name: 'DSH Game Market' },
    description: 'test fixture package',
    categories: ['arcade'],
    tags: ['orbit'],
    capabilities: ['storage', 'score'],
    sdkVersion: '^1.0.0',
    runtimeVersion: '^1.0.0',
    preferredTheme: 'game-defined',
    viewport: { width: 720, height: 1280, fit: 'contain' },
    score: { direction: 'higher-better', min: 0, max: 1000, integer: true },
    save: { schemaVersion: 1 },
    license: 'MIT',
  };
}

/** Mini multi-file package: HTML + JS + CSS + JSON + PNG + WAV + game.json. */
function miniPackageFiles() {
  return new Map([
    ['index.html', Buffer.from(
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="styles/game.css"></head>' +
      '<body data-test-page="builtin"><script src="scripts/main.js"></script></body></html>'
    )],
    ['game.json', Buffer.from(`${JSON.stringify(miniManifest(), null, 2)}\n`, 'utf8')],
    ['scripts/main.js', Buffer.from('window.__BUILTIN_GAME__ = true;', 'utf8')],
    ['styles/game.css', Buffer.from('body{background:#101820}', 'utf8')],
    ['levels/level-01.json', Buffer.from('{"level":1,"obstacles":5}', 'utf8')],
    ['assets/pixel.png', PNG_1X1],
    ['audio/tone.wav', wavBytes()],
  ]);
}

function codePointCompare(a, b) {
  const left = Array.from(a);
  const right = Array.from(b);
  const max = Math.min(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    const diff = left[i].codePointAt(0) - right[i].codePointAt(0);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

function manifestEntries(files) {
  return [...files.entries()]
    .map(([rel, bytes]) => ({ path: rel, size: bytes.length, sha256: sha256(bytes) }))
    .sort((left, right) => codePointCompare(left.path, right.path));
}

function expectedDigest(files) {
  return fileManifestDigest(manifestEntries(files), sha256);
}

function rmTree(directory) {
  return fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
}

/** Create a temporary `games/` root (the shape `builtinGamesRoot` expects). */
async function makeGamesRoot(t) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'dsh-gm-m2-games-'));
  t.after(() => rmTree(directory));
  return directory;
}

/**
 * Write `games/<id>/dist/` for the mini package.
 * @returns {{dist: string, files: Map<string, Buffer>, digest: string, descriptor: object}}
 */
async function writeBuiltinPackage(gamesRoot, { files = miniPackageFiles() } = {}) {
  const dist = path.join(gamesRoot, ORBIT_ID, 'dist');
  await fs.mkdir(dist, { recursive: true });
  for (const [rel, bytes] of files) {
    const abs = path.join(dist, ...rel.split('/'));
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, bytes);
  }
  const entries = manifestEntries(files);
  const descriptor = {
    formatVersion: 2,
    entry: 'index.html',
    gameManifest: ZIP_GAME_MANIFEST_FILE,
    files: entries,
  };
  await fs.writeFile(path.join(dist, DESCRIPTOR_FILE), `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8');
  return { dist, files, digest: fileManifestDigest(entries, sha256), descriptor };
}

/** Raw HTTP against the loopback resource origin (no URL normalisation). */
function rawRequest(origin, rawPath, { method = 'GET', headers = {} } = {}) {
  const target = new URL(origin);
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: target.hostname, port: Number(target.port), path: rawPath, method, headers },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body,
            text: () => body.toString('utf8'),
            json: () => JSON.parse(body.toString('utf8')),
          });
        });
      }
    );
    request.on('error', reject);
    request.end();
  });
}

function resourcePath(info, relPath) {
  return `${new URL(info.resourceBase).pathname}/${relPath}`;
}

function assertGm(response, status, code) {
  assert.equal(response.status, status, `expected HTTP ${status}, got ${response.status}: ${response.text()}`);
  const payload = response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, code);
  return payload;
}

// ---------------------------------------------------------------------------
// Catalog validation
// ---------------------------------------------------------------------------

test('catalog lists a bundled asset-zip-v2 built-in with validated package metadata', async (t) => {
  const gamesRoot = await makeGamesRoot(t);
  const pkg = await writeBuiltinPackage(gamesRoot);
  const host = await createHostHarness(t, { fixtureRoot: gamesRoot });

  const list = await host.data(ROUTES.GAMES);
  const item = list.items.find((entry) => entry.id === ORBIT_ID);
  assert.ok(item, 'orbit-courier must be listed when its package tree is bundled');
  assert.equal(item.builtin, true);
  assert.equal(item.source, 'builtin');
  assert.equal(item.format, ASSET_ZIP_V2);
  assert.equal(item.entry, 'index.html');
  assert.equal(item.filesDigest, pkg.digest);
  assert.equal(item.fileCount, pkg.files.size);
  assert.equal(item.installed, true);
  assert.equal(item.entryAvailable, true);
  assert.equal(item.issue, null);
  assert.deepEqual(item.viewport, { width: 720, height: 1280, fit: 'contain' });

  const detail = await host.data(ROUTES.GAME, { query: { id: ORBIT_ID } });
  assert.equal(detail.game.id, ORBIT_ID);
  assert.equal(detail.game.format, ASSET_ZIP_V2);
  assert.equal(detail.game.filesDigest, pkg.digest);
  assert.equal(detail.installed, null, 'built-ins never create an installation record');
});

test('an asset-zip-v2 built-in that is not bundled in this tree is skipped, not shown broken', async (t) => {
  // Both branches use an explicit *temporary* `games/` root, never the checkout
  // directory (which may or may not have a built `dist/` at any given time).
  // (a) no directory at all.
  const emptyRoot = await makeGamesRoot(t);
  const hostA = await createHostHarness(t, { fixtureRoot: emptyRoot });
  assert.equal(await hostA.host.catalog.load(ORBIT_ID), null);
  assert.equal(hostA.host.catalog.entries.some((entry) => entry.id === ORBIT_ID), false);
  const listA = await hostA.data(ROUTES.GAMES);
  assert.equal(listA.items.some((entry) => entry.id === ORBIT_ID), false, 'absent package must not appear');
  assert.equal(listA.items.some((entry) => entry.issue === 'package-invalid'), false, 'absence is not corruption');

  // (b) source directory present but package not built (no dist descriptor).
  const partialRoot = await makeGamesRoot(t);
  await fs.mkdir(path.join(partialRoot, ORBIT_ID), { recursive: true });
  const hostB = await createHostHarness(t, { fixtureRoot: partialRoot });
  assert.equal(await hostB.host.catalog.load(ORBIT_ID), null);
  const listB = await hostB.data(ROUTES.GAMES);
  assert.equal(listB.items.some((entry) => entry.id === ORBIT_ID), false);
  assert.equal(listB.items.some((entry) => entry.issue === 'package-invalid'), false);

  // The id is therefore installable in a tree that does not ship it (the
  // built-in-collision protection follows *presence*, and production bundles
  // are checked by scripts/check.mjs instead).
  assert.equal(hostB.host.catalog.entries.some((entry) => entry.id === ORBIT_ID), false);
});

test('a tampered built-in package fails closed: listed as package-invalid and launch is rejected', async (t) => {
  const gamesRoot = await makeGamesRoot(t);
  const pkg = await writeBuiltinPackage(gamesRoot);
  const host = await createHostHarness(t, { fixtureRoot: gamesRoot });

  // Positive control: the intact package launches.
  const healthy = await host.data(ROUTES.LAUNCH, { body: { gameId: ORBIT_ID } });
  assert.equal(healthy.package.format, ASSET_ZIP_V2);

  // Flip one byte in the entry without changing its length (sha256 now wrong).
  const entryPath = path.join(pkg.dist, 'index.html');
  const original = await fs.readFile(entryPath);
  const tampered = Buffer.from(original);
  tampered[original.length - 3] = tampered[original.length - 3] ^ 0x01;
  await fs.writeFile(entryPath, tampered);

  const list = await host.data(ROUTES.GAMES);
  const broken = list.items.find((entry) => entry.id === ORBIT_ID);
  assert.ok(broken, 'a present-but-invalid built-in stays visible (fail closed)');
  assert.equal(broken.issue, 'package-invalid');
  assert.equal(broken.entryAvailable, false);
  assert.equal(broken.filesDigest, null);
  assert.equal(broken.fileCount, null);

  const launch = await host.requestJson(ROUTES.LAUNCH, { body: { gameId: ORBIT_ID } });
  assert.equal(launch.response.status, 422);
  assert.equal(launch.payload.ok, false);
  assert.equal(launch.payload.error.code, GM.DESCRIPTOR_MISMATCH);
  assert.ok(!launch.text.includes('data-test-page'), 'the rejected response must not echo package content');

  // The host is not wedged: an unrelated unknown game still returns its normal
  // not-found error, not a stuck resource origin.
  const unknown = await host.requestJson(ROUTES.LAUNCH, { body: { gameId: 'no-such-game' } });
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.payload.error.code, GM.GAME_NOT_FOUND);
});

test('an invalid descriptor also fails closed with GM-4277', async (t) => {
  const gamesRoot = await makeGamesRoot(t);
  await writeBuiltinPackage(gamesRoot);
  const descriptorPath = path.join(gamesRoot, ORBIT_ID, 'dist', DESCRIPTOR_FILE);
  await fs.writeFile(descriptorPath, '{ this is not json', 'utf8');
  const host = await createHostHarness(t, { fixtureRoot: gamesRoot });

  const list = await host.data(ROUTES.GAMES);
  const broken = list.items.find((entry) => entry.id === ORBIT_ID);
  assert.ok(broken);
  assert.equal(broken.issue, 'package-invalid');
  const launch = await host.requestJson(ROUTES.LAUNCH, { body: { gameId: ORBIT_ID } });
  assert.equal(launch.response.status, 422);
  assert.equal(launch.payload.error.code, GM.DESCRIPTOR_INVALID);
});

// ---------------------------------------------------------------------------
// LaunchInfo + resource origin
// ---------------------------------------------------------------------------

test('built-in asset-zip-v2 launch uses the same resource-origin LaunchInfo as an installed package', async (t) => {
  const gamesRoot = await makeGamesRoot(t);
  const pkg = await writeBuiltinPackage(gamesRoot);
  const host = await createHostHarness(t, { fixtureRoot: gamesRoot });

  const info = await host.data(ROUTES.LAUNCH, { body: { gameId: ORBIT_ID, mode: 'resume-paused' } });
  assert.match(info.entryUrl, /^http:\/\/127\.0\.0\.1:\d+\/res\/[a-f0-9]{32}\/[a-f0-9]{32}\/index\.html\?launch=[a-f0-9]{32}$/);
  assert.deepEqual(info.package, {
    format: ASSET_ZIP_V2,
    entry: 'index.html',
    filesDigest: pkg.digest,
  });
  assert.match(info.resourceOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(info.resourceTtlMs > 0);
  assert.equal(info.entryResourceUrl, `${info.resourceBase}/index.html`);
  assert.equal(info.entryUrl, `${info.entryResourceUrl}?launch=${info.nonce}`);
  assert.equal(info.wrapperUrl, `${info.resourceOrigin}/wrapper?src=${encodeURIComponent(info.entryUrl)}`);
  assert.equal(
    info.wrapperResourceUrl,
    `${info.resourceOrigin}/wrapper?src=${encodeURIComponent(info.entryResourceUrl)}`
  );
  assert.equal(info.gameId, ORBIT_ID);
  assert.equal(info.gameVersion, '1.0.0');
  assert.equal(info.mode, 'resume-paused');
  assert.equal(info.protocolVersion, 1);
  assert.equal(info.entrySha256, sha256(pkg.files.get('index.html')));

  // Serve the entry through the one-shot launch URL and then re-read it via the
  // repeatable resource credential (installation and built-in paths are equal).
  const launchResponse = await rawRequest(info.resourceOrigin, `${resourcePath(info, 'index.html')}?launch=${info.nonce}`);
  assert.equal(launchResponse.status, 200);
  assert.equal(launchResponse.headers['content-type'], 'text/html; charset=utf-8');
  assert.ok(launchResponse.headers['content-security-policy'].includes(`script-src ${info.resourceOrigin}`));
  assert.equal(
    (await rawRequest(info.resourceOrigin, resourcePath(info, 'index.html'))).status,
    200,
    'resource credential stays repeatable after the launch credential is consumed'
  );
  const replay = await rawRequest(info.resourceOrigin, `${resourcePath(info, 'index.html')}?launch=${info.nonce}`);
  assertGm(replay, 410, GM.ENTRY_LAUNCH_CONSUMED);
});

test('built-in package resources are served only from the descriptor files[] whitelist', async (t) => {
  const gamesRoot = await makeGamesRoot(t);
  const pkg = await writeBuiltinPackage(gamesRoot);
  const host = await createHostHarness(t, { fixtureRoot: gamesRoot });
  const info = await host.data(ROUTES.LAUNCH, { body: { gameId: ORBIT_ID } });

  const mimeByRel = {
    'index.html': 'text/html; charset=utf-8',
    'scripts/main.js': 'text/javascript; charset=utf-8',
    'styles/game.css': 'text/css; charset=utf-8',
    'levels/level-01.json': 'application/json; charset=utf-8',
    'assets/pixel.png': 'image/png',
    'audio/tone.wav': 'audio/wav',
  };
  let served = 0;
  for (const [rel, bytes] of pkg.files) {
    if (rel === ZIP_GAME_MANIFEST_FILE) continue; // served by neither path
    const response = await rawRequest(info.resourceOrigin, resourcePath(info, rel));
    assert.equal(response.status, 200, rel);
    assert.equal(response.headers['content-type'], mimeByRel[rel], rel);
    assert.deepEqual(response.body, bytes, rel);
    assert.equal(response.headers['access-control-allow-origin'], '*');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    served += 1;
  }
  assert.equal(served, pkg.files.size - 1);
  const csp = (await rawRequest(info.resourceOrigin, resourcePath(info, 'index.html')))
    .headers['content-security-policy'];
  assert.ok(csp.includes(`connect-src ${info.resourceOrigin}`));
  assert.ok(csp.includes("default-src 'none'"));
  assert.ok(!csp.includes("'self'"));

  // HEAD works for a built-in resource too.
  const head = await rawRequest(info.resourceOrigin, resourcePath(info, 'scripts/main.js'), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-length'], String(pkg.files.get('scripts/main.js').length));
  assert.equal(head.body.length, 0);

  // Manifest-excluded / traversal paths are rejected exactly like installed packages.
  const rejected = [
    [`${new URL(info.resourceBase).pathname}/game.json`, 403, GM.RESOURCE_SCOPE_DENIED],
    [`${new URL(info.resourceBase).pathname}/${DESCRIPTOR_FILE}`, 403, GM.RESOURCE_SCOPE_DENIED],
    [`${new URL(info.resourceBase).pathname}/%2e%2e%2fgame.json`, 403, GM.RESOURCE_SCOPE_DENIED],
    [`${new URL(info.resourceBase).pathname}/missing.txt`, 404, GM.ASSET_NOT_FOUND],
  ];
  for (const [rawPath, status, code] of rejected) {
    assertGm(await rawRequest(info.resourceOrigin, rawPath), status, code);
  }
  assert.equal(
    (await rawRequest(info.resourceOrigin, `${new URL(info.resourceBase).pathname}/scripts/main.js`, { method: 'POST' })).status,
    405
  );
});

test('built-in asset-zip-v2 is not served over the DSH /entry route (GM-4043)', async (t) => {
  const gamesRoot = await makeGamesRoot(t);
  await writeBuiltinPackage(gamesRoot);
  const host = await createHostHarness(t, { fixtureRoot: gamesRoot });
  const info = await host.data(ROUTES.LAUNCH, { body: { gameId: ORBIT_ID } });

  const entryResponse = await host.requestJson(ROUTES.ENTRY, {
    query: {
      gameId: ORBIT_ID,
      version: info.gameVersion,
      instance: info.instanceId,
      nonce: info.nonce,
    },
  });
  assert.equal(entryResponse.response.status, 404);
  assert.equal(entryResponse.payload.error.code, GM.ASSET_NOT_FOUND);
});

test('built-in runtime lifecycle: renew keeps TTL, release invalidates the resource credential', async (t) => {
  const gamesRoot = await makeGamesRoot(t);
  await writeBuiltinPackage(gamesRoot);
  const host = await createHostHarness(t, { fixtureRoot: gamesRoot });
  const info = await host.data(ROUTES.LAUNCH, { body: { gameId: ORBIT_ID } });

  assert.equal((await rawRequest(info.resourceOrigin, resourcePath(info, 'index.html'))).status, 200);
  const renewed = await host.data(ROUTES.RUNTIME_RENEW, { body: { instanceId: info.instanceId } });
  assert.equal(renewed.instanceId, info.instanceId);
  assert.ok(renewed.resourceTtlMs > 0);

  const released = await host.data(ROUTES.RUNTIME_RELEASE, {
    body: { gameId: ORBIT_ID, instanceId: info.instanceId },
  });
  assert.equal(released.released, 1);
  assertGm(
    await rawRequest(info.resourceOrigin, resourcePath(info, 'index.html')),
    403,
    GM.RESOURCE_CREDENTIAL_EXPIRED
  );
});

test('built-in games can never be uninstalled (GM-4038), including asset-zip-v2 ones', async (t) => {
  const gamesRoot = await makeGamesRoot(t);
  await writeBuiltinPackage(gamesRoot);
  const host = await createHostHarness(t, { fixtureRoot: gamesRoot });
  const response = await host.requestJson(ROUTES.UNINSTALL, { body: { gameId: ORBIT_ID } });
  assert.equal(response.response.status, 403);
  assert.equal(response.payload.error.code, GM.UNINSTALL_BUILTIN);
  // Still launchable afterwards (nothing was deleted/changed).
  const info = await host.data(ROUTES.LAUNCH, { body: { gameId: ORBIT_ID } });
  assert.equal(info.gameId, ORBIT_ID);
});

// ---------------------------------------------------------------------------
// html-v1 builtin non-regression
// ---------------------------------------------------------------------------

test('snake (html-v1 builtin) does not regress and is not joined by an unbuilt orbit-courier', async (t) => {
  const host = await createHostHarness(t); // default fixture games/ (snake only)
  const list = await host.data(ROUTES.GAMES);
  const ids = list.items.map((entry) => entry.id).sort();
  assert.deepEqual(ids, ['snake'], 'a tree without the orbit package keeps exactly the V1 builtin set');
  const snake = list.items.find((entry) => entry.id === 'snake');
  assert.equal(snake.format, 'html-v1');
  assert.equal(snake.filesDigest, null);
  assert.equal(snake.fileCount, null);
  assert.equal(snake.builtin, true);
  assert.equal(snake.issue, null);
  assert.equal(snake.entryAvailable, true);

  // Launch + /entry keep the V1 single-file behaviour.
  const info = await host.data(ROUTES.LAUNCH, { body: { gameId: 'snake' } });
  assert.match(info.entryUrl, /^\/api\/game-market\/entry\?/);
  assert.equal(info.package.format, 'html-v1');
  assert.equal(info.package.filesDigest, null);
  assert.equal(info.wrapperUrl, undefined);
  const entry = await host.request(info.entryUrl);
  assert.equal(entry.status, 200);
  assert.equal(entry.headers.get('content-type'), 'text/html; charset=utf-8');
});

// ---------------------------------------------------------------------------
// Integration: the real bundled package (skipped until the game author lands it)
// ---------------------------------------------------------------------------

test('the real games/orbit-courier/dist package passes catalog validation when present', async (t) => {
  const descriptorPath = path.join(REPO_GAMES_ROOT, ORBIT_ID, 'dist', DESCRIPTOR_FILE);
  if (!existsSync(descriptorPath)) {
    t.skip('games/orbit-courier/dist/dsh-package.json is not present in this checkout');
    return;
  }
  const { createGameCatalog } = await import('../../src/games.js');
  const catalog = createGameCatalog({ root: REPO_GAMES_ROOT });
  assert.ok(
    catalog.entries.some((entry) => entry.id === ORBIT_ID && entry.format === ASSET_ZIP_V2),
    'the real built-in package must be present in BUILTIN_GAMES and bundled'
  );
  const info = await catalog.load(ORBIT_ID);
  assert.ok(info && info.manifest, 'the real package must validate against the descriptor');
  assert.equal(info.issue, null);
  assert.equal(info.format, ASSET_ZIP_V2);
  assert.equal(info.entry, 'index.html');
  assert.equal(info.entryPath, path.join(REPO_GAMES_ROOT, ORBIT_ID, 'dist', 'index.html'));
  assert.match(info.filesDigest, /^[a-f0-9]{64}$/);
  assert.ok(info.fileCount >= 1, 'the real package must report its validated file count');
  const descriptor = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));
  const expected = fileManifestDigest(
    descriptor.files.map((file) => ({ path: file.path, size: file.size, sha256: file.sha256 })),
    sha256
  );
  assert.equal(info.filesDigest, expected, 'catalog digest must equal the descriptor file-manifest digest');
  assert.ok(info.fileCount >= 1);
  // BUILTIN_GAMES declares the same id/version/format the catalog resolved.
  const declared = BUILTIN_GAMES.find((entry) => entry.id === ORBIT_ID);
  assert.ok(declared, 'orbit-courier must be declared in BUILTIN_GAMES');
  assert.equal(declared.format, ASSET_ZIP_V2);
  assert.equal(declared.version, info.manifest.version);
});

// ---------------------------------------------------------------------------
// CR8-04: shipped-but-damaged built-ins stay visible and keep their id protection
// ---------------------------------------------------------------------------

test('a shipped built-in that lost only its descriptor stays visible, broken and install-protected', async (t) => {
  const gamesRoot = await makeGamesRoot(t);
  const pkg = await writeBuiltinPackage(gamesRoot);
  // Keep the whole dist/ tree, remove only the package descriptor.
  await fs.rm(path.join(pkg.dist, DESCRIPTOR_FILE));

  const host = await createHostHarness(t, { fixtureRoot: gamesRoot });
  // The id is still a built-in (presence is decided by the dist/ directory, not by
  // the descriptor), so install/uninstall of this id must stay rejected.
  assert.equal(
    host.host.catalog.entries.some((entry) => entry.id === ORBIT_ID && entry.format === ASSET_ZIP_V2),
    true,
    'a shipped-but-damaged built-in must keep its built-in id registration'
  );
  const listed = (await host.data(ROUTES.GAMES)).items.find((entry) => entry.id === ORBIT_ID);
  assert.ok(listed, 'the damaged built-in must be visible instead of disappearing');
  assert.equal(listed.issue, 'package-invalid');
  assert.equal(listed.entryAvailable, false);
  assert.equal(listed.filesDigest, null);
  assert.equal(listed.builtin, true);

  const launch = await host.requestJson(ROUTES.LAUNCH, { body: { gameId: ORBIT_ID } });
  assert.equal(launch.response.status, 422);
  assert.equal(launch.payload.error.code, GM.DESCRIPTOR_INVALID);
  assert.ok(!launch.text.includes('data-test-page'), 'the rejection must not echo package content');

  const uninstall = await host.requestJson(ROUTES.UNINSTALL, { body: { gameId: ORBIT_ID } });
  assert.equal(uninstall.response.status, 403);
  assert.equal(uninstall.payload.error.code, GM.UNINSTALL_BUILTIN);

  // A local ZIP trying to claim the built-in id is still refused (no takeover).
  const takeover = buildPackage(defaultFiles());
  const install = await host.requestJson(ROUTES.INSTALL_LOCAL, {
    rawBody: takeover.zip,
    contentType: 'application/zip',
    query: { operationId: 'cr8-04-takeover' },
  });
  assert.equal(install.response.status, 400);
  assert.equal(install.payload.error.code, GM.INVALID_PARAM);
  assert.deepEqual(await host.listDataFiles('staging'), [], 'a rejected install leaves no staging tree');
  assert.equal(await host.pathExists('packages/orbit-courier'), false, 'a rejected install writes no version dir');
});

test('a built-in with its whole dist directory absent is treated as not shipped', async (t) => {
  const gamesRoot = await makeGamesRoot(t);
  // Source-only tree: games/<id>/game.json exists, but dist/ was never built.
  await fs.mkdir(path.join(gamesRoot, ORBIT_ID), { recursive: true });
  await fs.writeFile(path.join(gamesRoot, ORBIT_ID, 'game.json'), JSON.stringify(miniManifest(), null, 2));

  const host = await createHostHarness(t, { fixtureRoot: gamesRoot });
  assert.equal(host.host.catalog.entries.some((entry) => entry.id === ORBIT_ID), false);
  const list = await host.data(ROUTES.GAMES);
  assert.equal(list.items.some((entry) => entry.id === ORBIT_ID), false);
  assert.equal(list.items.some((entry) => entry.issue === 'package-invalid'), false);
  const launch = await host.requestJson(ROUTES.LAUNCH, { body: { gameId: ORBIT_ID } });
  assert.equal(launch.response.status, 404);
  assert.equal(launch.payload.error.code, GM.GAME_NOT_FOUND);
});

test('an unreadable built-in package is reported as broken, never silently skipped (CR8-04)', async (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX permission bits are not simulated on Windows');
    return;
  }
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('running as root: chmod(0o000) does not deny access');
    return;
  }
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'dsh-gm-m2-perm-'));
  const gamesRoot = path.join(directory, 'games');
  const created = await writeBuiltinPackage(gamesRoot);
  t.after(async () => {
    await fs.chmod(created.dist, 0o755).catch(() => {});
    await rmTree(directory);
  });
  await fs.chmod(created.dist, 0o000);

  const host = await createHostHarness(t, { fixtureRoot: gamesRoot });
  assert.equal(
    host.host.catalog.entries.some((entry) => entry.id === ORBIT_ID),
    true,
    'a permission error must not be treated as "not distributed"'
  );
  const list = await host.data(ROUTES.GAMES);
  const item = list.items.find((entry) => entry.id === ORBIT_ID);
  assert.ok(item, 'the unreadable built-in must stay visible');
  assert.equal(item.issue, 'package-invalid');
  assert.equal(item.entryAvailable, false);
  const launch = await host.requestJson(ROUTES.LAUNCH, { body: { gameId: ORBIT_ID } });
  assert.equal(launch.response.status, 422);
  assert.equal(launch.payload.error.code, GM.DESCRIPTOR_INVALID);
});

test('a healthy shipped built-in still validates and launches (CR8-04 non-regression)', async (t) => {
  const gamesRoot = await makeGamesRoot(t);
  const pkg = await writeBuiltinPackage(gamesRoot);
  const host = await createHostHarness(t, { fixtureRoot: gamesRoot });
  const item = (await host.data(ROUTES.GAMES)).items.find((entry) => entry.id === ORBIT_ID);
  assert.ok(item);
  assert.equal(item.issue, null);
  assert.equal(item.filesDigest, pkg.digest);
  const info = await host.data(ROUTES.LAUNCH, { body: { gameId: ORBIT_ID } });
  assert.equal(info.package.format, ASSET_ZIP_V2);
  const entry = await rawRequest(
    info.resourceOrigin,
    `${new URL(info.resourceBase).pathname}/index.html?launch=${info.nonce}`
  );
  assert.equal(entry.status, 200);
});

// Registered explicitly from `packages/host/test/index.js`. The tests above are
// declared at module load, so `node --test <this file>` also runs them directly;
// `register()` is the idempotent hook the index uses (same pattern as the other
// V1.5 case modules).
let registered = false;
export function register() {
  if (registered) return;
  registered = true;
}
