/**
 * M1-C — instance resource origin, credentials, wrapper navigation (V1.5-CONTRACTS §7).
 *
 * These tests boot the production `createResourceService` on a real loopback
 * socket and the production `createEntryService` on top of it, then speak raw
 * HTTP to it. Raw `node:http` requests are used on purpose: the WHATWG URL
 * parser collapses `..` segments, which would hide traversal behaviour from the
 * tests.
 *
 * Falsifiability (M0 CR-P1 lesson, `docs/verification/v1.5/resources.md` §5.4):
 * every rejection case is paired with the same request succeeding under valid
 * conditions, and the rejection reason is observable as a GM-* code, a header or
 * the consumed-credential state — "the request never happened" is not a pass.
 *
 * This file self-registers (`node --test` discovers `packages/host/test/cases/`)
 * and is intentionally not wired into `test/index.js`.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ASSET_ZIP_V2,
  DESCRIPTOR_FILE,
  RESOURCE_ORIGIN_PATH,
  RESOURCE_WRAPPER_PATH,
  TIMING,
  ZIP_GAME_MANIFEST_FILE,
} from '../../../shared/src/constants.js';
import { ROUTES } from '../../../shared/src/contracts.js';
import { GM } from '../../../shared/src/errors.js';
import { fileManifestDigest } from '../../../shared/src/package-v2.js';
import { buildResourceBase } from '../../../shared/src/resources.js';
import { createEntryService } from '../../src/entry.js';
import { createMaintenanceService } from '../../src/maintenance.js';
import { createResourceService } from '../../src/resources.js';
import { createRouteTable } from '../../src/routes.js';
import { createHostHarness } from '../support/harness.js';
import { buildManifest, buildPackage } from '../support/packages.js';

const DSH_ORIGIN = 'http://127.0.0.1:19387';
const TTL_MS = 60_000;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

/** Minimal 44-byte RIFF/WAVE header; the resource service only checks magic. */
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

const HTML_MARKER = 'data-test-entry="demo"';

function demoHtml() {
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<link rel="stylesheet" href="styles/game.css"></head>` +
    `<body ${HTML_MARKER}><h1>demo</h1><script src="scripts/main.js"></script></body></html>`;
}

function zipGameFiles() {
  return {
    'index.html': demoHtml(),
    'game.json': JSON.stringify({ manifestVersion: 1, id: 'demo', version: '1.0.0' }),
    'scripts/main.js': 'window.__DEMO__ = true;',
    'styles/game.css': 'body{background:#123456}',
    'assets/pixel.png': PNG_1X1,
    'assets/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
    'assets/tone.wav': wavBytes(),
    'levels/level-01.json': '{"level":1,"obstacles":5}',
  };
}

function htmlV1Files() {
  return {
    'entry.html': `<!doctype html><html><body ${HTML_MARKER}><script>window.__DEMO__ = true;</script></body></html>`,
  };
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

function minimalManifest(id, version) {
  return {
    id,
    version,
    name: id,
    sdkVersion: '^1.0.0',
    runtimeVersion: '^1.0.0',
    capabilities: ['storage'],
    viewport: { width: 960, height: 540 },
  };
}

function zipRecord(id, version, { entry = 'index.html' } = {}) {
  return {
    id,
    version,
    source: 'local',
    packagePath: `${id}/${version}`,
    sha256: null,
    sizeBytes: 0,
    previousVersion: null,
    format: ASSET_ZIP_V2,
    entry,
    fileManifestDigest: null,
    fileCount: null,
    unpackedBytes: null,
    compatibility: { status: 'ok' },
    update: { available: false },
    lastPlayedAt: null,
    playCount: 0,
    totalPlayMinutes: 0,
    manifest: minimalManifest(id, version),
  };
}

function htmlV1Record(id, version, entrySha256) {
  return {
    id,
    version,
    source: 'registry',
    packagePath: `${id}/${version}`,
    sha256: entrySha256,
    sizeBytes: 0,
    previousVersion: null,
    compatibility: { status: 'ok' },
    update: { available: false },
    lastPlayedAt: null,
    playCount: 0,
    totalPlayMinutes: 0,
    manifest: minimalManifest(id, version),
  };
}

function rmTree(directory) {
  return fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
}

/** Write one game tree under `<dataRoot>/packages/<id>/<version>/`. */
async function writeGamePackage(dataRoot, game) {
  const versionDirectory = path.join(dataRoot, 'packages', game.record.id, game.record.version);
  await fs.mkdir(versionDirectory, { recursive: true });
  const written = new Map();
  for (const [rel, content] of Object.entries(game.files)) {
    const abs = path.join(versionDirectory, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    await fs.writeFile(abs, bytes);
    written.set(rel, bytes);
  }
  if (game.record.format === ASSET_ZIP_V2) {
    const manifestEntries = [...written.entries()]
      .map(([rel, bytes]) => ({ path: rel, size: bytes.length, sha256: sha256(bytes) }))
      .sort((left, right) => codePointCompare(left.path, right.path));
    const descriptor = {
      formatVersion: 2,
      entry: game.record.entry,
      gameManifest: ZIP_GAME_MANIFEST_FILE,
      files: manifestEntries,
    };
    await fs.writeFile(
      path.join(versionDirectory, DESCRIPTOR_FILE),
      `${JSON.stringify(descriptor, null, 2)}\n`,
      'utf8'
    );
    game.record.fileManifestDigest = fileManifestDigest(manifestEntries, sha256);
    game.record.fileCount = manifestEntries.length;
    game.record.unpackedBytes = manifestEntries.reduce((sum, item) => sum + item.size, 0);
  }
  return { versionDirectory, written };
}

/**
 * Boot a resource origin + entry service on a fake storage root.
 * `games`: [{ record, files }]; the first game is the default launch target.
 */
async function createStack(
  t,
  { games, ttlMs = TTL_MS, frameAncestors = [DSH_ORIGIN], dshWebOrigin = DSH_ORIGIN, logSink = null } = {}
) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'dsh-gm-resources-'));
  const dataRoot = path.join(directory, 'data');
  const gamesById = new Map();
  for (const game of games) {
    const written = await writeGamePackage(dataRoot, game);
    gamesById.set(game.record.id, { ...game, ...written });
  }

  let clock = Date.parse('2026-01-01T00:00:00.000Z');
  const now = () => new Date(clock);
  const advance = (ms) => {
    clock += ms;
  };

  const logs = logSink || [];
  const logger = {
    info: () => {},
    debug: () => {},
    warn: (...parts) => logs.push(parts.map(String).join(' ')),
    error: (...parts) => logs.push(`ERROR ${parts.map(String).join(' ')}`),
  };
  const storage = { filePath: (...segments) => path.join(dataRoot, ...segments) };
  const installations = {
    get: async (gameId) => (gameId && gamesById.has(gameId) ? gamesById.get(gameId).record : null),
  };
  const resources = createResourceService({
    now,
    logger,
    timing: { resourceCredentialTtlMs: ttlMs },
    frameAncestors,
    // The composition supplies the concrete DSH web origin when it knows it;
    // the service uses it as the exact `frame-ancestors` entry for the game
    // entry document and for the wrapper. `null` exercises the fallback.
    dshWebOrigin,
  });
  const entry = createEntryService({
    catalog: { entries: [], load: async () => null },
    devCatalog: null,
    installations,
    registry: { previewUrl: async () => null },
    storage,
    settings: { security: { frameAncestors } },
    hostEpoch: 'he_test',
    logger,
    now,
    timing: { entryBindingTtlMs: ttlMs },
    resources,
  });

  t.after(async () => {
    await resources.close();
    await rmTree(directory);
  });

  return {
    directory,
    dataRoot,
    games: gamesById,
    resources,
    entry,
    logger,
    logs,
    advance,
    now,
    launch: (gameId, extra = {}) => entry.launch({ gameId, ...extra }),
    versionDirectory: (gameId) => gamesById.get(gameId).versionDirectory,
  };
}

/** Raw HTTP request (no WHATWG URL normalisation of the request path). */
function rawRequest(origin, rawPath, { method = 'GET', headers = {} } = {}) {
  const target = new URL(origin);
  // Absolute URLs are accepted for convenience: only origin+path are used, so
  // the request path keeps its exact (un-normalised) encoding.
  let requestPath = rawPath;
  if (typeof rawPath === 'string' && /^https?:\/\//i.test(rawPath)) {
    const parsed = new URL(rawPath);
    requestPath = `${parsed.pathname}${parsed.search}`;
  }
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: target.hostname,
        port: Number(target.port),
        path: requestPath,
        method,
        headers,
      },
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

function assertGm(response, status, code) {
  assert.equal(response.status, status, `expected HTTP ${status}, got ${response.status}: ${response.text()}`);
  const payload = response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, code);
  return payload;
}

async function launchAndGetUrls(stack, gameId = [...stack.games.keys()][0], extra = {}) {
  const info = await stack.launch(gameId, extra);
  const origin = new URL(info.resourceOrigin);
  return { info, origin: info.resourceOrigin, host: origin.host };
}

function resourcePath(info, relPath) {
  const url = new URL(info.resourceBase);
  return `${url.pathname}/${relPath}`;
}

// ---------------------------------------------------------------------------
// §7.1 — independent loopback origin
// ---------------------------------------------------------------------------

test('resource origin binds loopback only and keeps one stable port per process', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const first = await stack.launch('demo');
  const second = await stack.launch('demo');

  assert.match(first.resourceOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const address = stack.resources.address();
  assert.equal(address.address, '127.0.0.1', 'the resource origin must bind loopback, never 0.0.0.0');
  assert.equal(String(address.family), 'IPv4');
  assert.notEqual(address.address, '0.0.0.0');
  assert.notEqual(address.address, '::');

  // Port stability: every instance of the same host process shares the origin.
  assert.equal(first.resourceOrigin, second.resourceOrigin);
  assert.equal(new URL(first.resourceBase).port, new URL(second.resourceBase).port);
  assert.equal(new URL(first.entryResourceUrl).origin, first.resourceOrigin);

  // Positive control: the origin really answers.
  const response = await rawRequest(first.resourceOrigin, resourcePath(first, 'index.html'));
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
});

test('resource origin exposes only instance resources and the wrapper (no Host write surface)', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const { info, origin } = await launchAndGetUrls(stack);

  const { headers } = await rawRequest(origin, resourcePath(info, 'index.html'));
  assert.equal(headers['access-control-allow-origin'], '*');
  assert.equal(headers['access-control-allow-methods'], 'GET, HEAD');

  // (a) writes to a valid resource path: 405, and the positive control proves
  // the path itself exists and is servable via GET.
  const positiveGet = await rawRequest(origin, resourcePath(info, 'index.html'));
  assert.equal(positiveGet.status, 200);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const rejected = await rawRequest(origin, resourcePath(info, 'index.html'), { method });
    assert.equal(rejected.status, 405, `${method} must be 405`);
    assert.equal(rejected.headers.allow, 'GET, HEAD');
  }

  // (b) Host API/admin paths are not routed here at all.
  const hostPaths = [
    '/api/game-market/install',
    '/api/game-market/save',
    '/api/game-market/runtime-renew',
    '/api/game-market/health',
    '/health',
    '/install',
    '/save',
    '/diagnostics',
    '/',
    '/res',
    '/res/',
    '/res/not-an-instance/index.html',
    '/random',
  ];
  for (const hostPath of hostPaths) {
    const response = await rawRequest(origin, hostPath);
    assert.ok(
      response.status === 404 || response.status === 403,
      `unknown path ${hostPath} must be 404/403, got ${response.status}`
    );
    // No write surface even if a client tries POST on an unknown path.
    const write = await rawRequest(origin, hostPath, { method: 'POST' });
    assert.equal(write.status, 405, `POST ${hostPath} must be 405, got ${write.status}`);
  }
});

// ---------------------------------------------------------------------------
// §7.6 — LaunchInfo extension (old fields unchanged)
// ---------------------------------------------------------------------------

test('LaunchInfo carries the §7.6 resource fields for asset-zip-v2, entryUrl is the one-shot launch URL', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const info = await stack.launch('demo', { mode: 'resume-paused', dshSessionId: 'session-res' });
  const record = stack.games.get('demo').record;

  // V1 fields keep their semantics.
  assert.equal(info.gameId, 'demo');
  assert.equal(info.gameVersion, '1.0.0');
  assert.equal(info.mode, 'resume-paused');
  assert.equal(info.protocolVersion, 1);
  assert.equal(info.runtimeVersion, '1.0.0');
  assert.equal(info.sdkVersion, '1.0.0');
  assert.match(info.instanceId, /^[a-f0-9]{32}$/);
  assert.match(info.nonce, /^[a-f0-9]{32}$/);
  assert.deepEqual(info.capabilities, ['storage']);
  assert.deepEqual(info.viewport, { width: 960, height: 540, fit: 'contain' });

  // §7.6 additions.
  assert.match(info.resourceOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(
    info.resourceBase,
    `${info.resourceOrigin}${RESOURCE_ORIGIN_PATH}/${info.instanceId}/${new URL(info.entryResourceUrl).pathname.split('/')[3]}`
  );
  assert.equal(info.resourceTtlMs, TTL_MS);
  assert.equal(info.entryResourceUrl, `${info.resourceBase}/index.html`);
  assert.deepEqual(info.package, {
    format: ASSET_ZIP_V2,
    entry: 'index.html',
    filesDigest: record.fileManifestDigest,
  });
  assert.equal(info.entrySha256, sha256(Buffer.from(demoHtml(), 'utf8')));
  assert.equal(info.entryUrl, `${info.entryResourceUrl}?launch=${info.nonce}`);

  // §7.5.1 wrapper URLs (additive): one-shot wrapper first, resource wrapper on reload.
  assert.equal(info.wrapperUrl, `${info.resourceOrigin}${RESOURCE_WRAPPER_PATH}?src=${encodeURIComponent(info.entryUrl)}`);
  assert.equal(
    info.wrapperResourceUrl,
    `${info.resourceOrigin}${RESOURCE_WRAPPER_PATH}?src=${encodeURIComponent(info.entryResourceUrl)}`
  );
});

test('LaunchInfo keeps html-v1 entryUrl on the V1 /entry route and still adds resource fields', async (t) => {
  const entryBytes = Buffer.from(htmlV1Files()['entry.html'], 'utf8');
  const stack = await createStack(t, {
    games: [{ record: htmlV1Record('legacy', '2.1.0', sha256(entryBytes)), files: htmlV1Files() }],
  });
  const info = await stack.launch('legacy');

  assert.match(info.entryUrl, /^\/api\/game-market\/entry\?/);
  assert.equal(new URLSearchParams(info.entryUrl.split('?')[1]).get('instance'), info.instanceId);
  assert.equal(info.entrySha256, sha256(entryBytes));
  assert.equal(info.package.format, 'html-v1');
  assert.equal(info.package.entry, 'entry.html');
  assert.equal(info.package.filesDigest, null);
  assert.equal(info.entryResourceUrl, `${info.resourceBase}/entry.html`);
  assert.equal(info.resourceTtlMs, TTL_MS);
  // M4 adds wrapper navigation without breaking an older Client's /entry URL.
  assert.equal(new URL(info.wrapperUrl).origin, info.resourceOrigin);
  const target = new URL(info.wrapperUrl).searchParams.get('src');
  assert.equal(target, info.entryResourceUrl + '?launch=' + info.nonce);
  const document = await fetch(target);
  assert.equal(document.status, 200);
  assert.ok(document.headers.get('content-security-policy').includes(info.resourceOrigin));
  assert.equal(await document.text(), entryBytes.toString('utf8'));
  assert.equal((await fetch(target)).status, 410);
  assert.equal((await fetch(info.entryResourceUrl)).status, 200);

  // The legacy /entry path is behaviourally unchanged: repeated GET, V1 CSP.
  const legacyUrl = new URL(info.entryUrl, DSH_ORIGIN);
  const first = await stack.entry.serveEntry(new Request(legacyUrl), legacyUrl);
  assert.equal(first.status, 200);
  const second = await stack.entry.serveEntry(new Request(legacyUrl), legacyUrl);
  assert.equal(second.status, 200, 'html-v1 /entry keeps its V1 repeatable semantics');
  const csp = first.headers.get('content-security-policy');
  assert.match(csp, /script-src 'unsafe-inline'/);
  assert.match(csp, /connect-src 'none'/);
  for (const directive of ['object-src', 'base-uri', 'form-action', 'frame-src', 'child-src', 'worker-src']) {
    assert.ok(csp.includes(`${directive} 'none'`), `html-v1 CSP must keep the outward-boundary directive ${directive}`);
  }
  assert.equal(await first.text(), entryBytes.toString('utf8'));
});

// ---------------------------------------------------------------------------
// §7.2 — credentials: one-shot launch, repeatable resource credential
// ---------------------------------------------------------------------------

test('one-shot launch: first GET consumes, replay is 410 GM-4013, resource URL stays 200', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const info = await stack.launch('demo');

  const launchResponse = await rawRequest(info.resourceOrigin, `${resourcePath(info, 'index.html')}?launch=${info.nonce}`);
  assert.equal(launchResponse.status, 200);
  assert.equal(launchResponse.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(launchResponse.body.length, Buffer.byteLength(demoHtml()));
  assert.equal(launchResponse.headers['content-length'], String(launchResponse.body.length));
  assert.equal(launchResponse.body.toString('utf8'), demoHtml());

  // The one-shot credential is really consumed: same URL replays with 410.
  const replay = await rawRequest(info.resourceOrigin, `${resourcePath(info, 'index.html')}?launch=${info.nonce}`);
  assertGm(replay, 410, GM.ENTRY_LAUNCH_CONSUMED);

  // Falsifiability: it is the launch nonce, not "a second request", that is
  // rejected — a request without `launch` is the documented reload path (200).
  const resourceCredential = await rawRequest(info.resourceOrigin, resourcePath(info, 'index.html'));
  assert.equal(resourceCredential.status, 200);

  // On a *fresh* instance, a wrong nonce is the wrong-credential code (401
  // GM-4012), while the correct nonce is accepted (positive control).
  const other = await stack.launch('demo');
  const otherNonceOnFirst = await rawRequest(
    other.resourceOrigin,
    `${resourcePath(other, 'index.html')}?launch=${'f'.repeat(32)}`
  );
  assertGm(otherNonceOnFirst, 401, GM.ENTRY_CREDENTIAL_CONSUMED);
  const otherCorrect = await rawRequest(
    other.resourceOrigin,
    `${resourcePath(other, 'index.html')}?launch=${other.nonce}`
  );
  assert.equal(otherCorrect.status, 200);
  // Once consumed, any replay of the launch URL is a 410.
  assertGm(
    await rawRequest(other.resourceOrigin, `${resourcePath(other, 'index.html')}?launch=${other.nonce}`),
    410,
    GM.ENTRY_LAUNCH_CONSUMED
  );
});

test('credentials are repeatable GET/HEAD for every manifest file, with exact MIME per file', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const info = await stack.launch('demo');
  const expected = [
    ['index.html', 'text/html; charset=utf-8', Buffer.from(demoHtml())],
    ['scripts/main.js', 'text/javascript; charset=utf-8', Buffer.from('window.__DEMO__ = true;')],
    ['styles/game.css', 'text/css; charset=utf-8', Buffer.from('body{background:#123456}')],
    ['levels/level-01.json', 'application/json; charset=utf-8', Buffer.from('{"level":1,"obstacles":5}')],
    ['assets/pixel.png', 'image/png', PNG_1X1],
    ['assets/icon.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>')],
    ['assets/tone.wav', 'audio/wav', wavBytes()],
  ];
  for (const [rel, contentType, bytes] of expected) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await rawRequest(info.resourceOrigin, resourcePath(info, rel));
      assert.equal(response.status, 200, `${rel} GET #${attempt + 1}`);
      assert.equal(response.headers['content-type'], contentType, rel);
      assert.equal(response.headers['content-length'], String(bytes.length));
      assert.deepEqual(response.body, bytes, rel);
    }
    const head = await rawRequest(info.resourceOrigin, resourcePath(info, rel), { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-type'], contentType);
    assert.equal(head.headers['content-length'], String(bytes.length));
    assert.equal(head.body.length, 0);
  }
});

test('asset-zip-v2 sends the same CSP on every package document (HTML + SVG), not just the entry (CR7-01)', async (t) => {
  // A package with a second HTML page that can be navigated to from the entry.
  // Same-origin navigation is allowed by the wrapper's frame-src, so the second
  // page is a fresh document and must not be policy-free (CR7-01).
  const files = {
    ...zipGameFiles(),
    'second.html':
      '<!doctype html><html><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="styles/game.css"></head>' +
      '<body data-test-page="second"><script src="second.js"></script></body></html>',
    'second.js': 'window.__SECOND__ = true;',
    // SVG is executable when loaded as a document, so it is the other
    // document-shaped asset that must carry the same policy (CR7-01 follow-up).
    'second.svg':
      '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2">' +
      '<script>window.__SECOND_SVG__ = true;</script></svg>',
  };
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files }] });
  const info = await stack.launch('demo');

  // Positive control: the nested page really is served as an HTML document.
  const second = await rawRequest(info.resourceOrigin, resourcePath(info, 'second.html'));
  assert.equal(second.status, 200);
  assert.equal(second.headers['content-type'], 'text/html; charset=utf-8');
  const secondCsp = second.headers['content-security-policy'];
  assert.ok(secondCsp, 'second.html must carry the asset CSP');

  const entry = await rawRequest(info.resourceOrigin, resourcePath(info, 'index.html'));
  const entryCsp = entry.headers['content-security-policy'];
  assert.ok(entry.headers['x-entry-sha256'], 'the entry keeps the V1 entry hash header');
  assert.equal(second.headers['x-entry-sha256'], undefined, 'x-entry-sha256 stays entry-only');
  assert.equal(
    secondCsp,
    entryCsp,
    'every package HTML document must get the exact same policy as the entry (except x-entry-sha256)'
  );

  // Directive-by-directive assertion on the non-entry document.
  const directives = [
    "default-src 'none'",
    `script-src ${info.resourceOrigin}`,
    `style-src ${info.resourceOrigin}`,
    `img-src ${info.resourceOrigin} data:`,
    `media-src ${info.resourceOrigin}`,
    `font-src ${info.resourceOrigin}`,
    `connect-src ${info.resourceOrigin}`,
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${DSH_ORIGIN} ${info.resourceOrigin}`,
  ];
  for (const directive of directives) {
    assert.ok(secondCsp.includes(directive), `second.html CSP must include "${directive}"; got: ${secondCsp}`);
  }
  assert.ok(!secondCsp.includes("'self'"), 'the document CSP must use the explicit resource origin');
  assert.ok(!secondCsp.includes("'unsafe-inline'"), 'asset-zip-v2 must not allow inline script/style');
  assert.ok(!secondCsp.includes('upgrade-insecure-requests'));

  // Same-origin subresources referenced by the second page still load: the CSP
  // authorizes the resource origin instead of killing in-package reads.
  const secondScript = await rawRequest(info.resourceOrigin, resourcePath(info, 'second.js'));
  assert.equal(secondScript.status, 200);
  assert.equal(secondScript.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(secondScript.headers['content-security-policy'], undefined, 'non-document resources never repeat the CSP');
  assert.equal(new URL(`http://placeholder${resourcePath(info, 'second.js')}`).search, '');
  const stylesheet = await rawRequest(info.resourceOrigin, resourcePath(info, 'styles/game.css'));
  assert.equal(stylesheet.status, 200);
  const levelJson = await rawRequest(info.resourceOrigin, resourcePath(info, 'levels/level-01.json'));
  assert.equal(levelJson.status, 200, "same-origin fetch('./levels/…json') must stay readable");

  // SVG is the other document-shaped asset: loaded directly it can run script,
  // so it must carry the exact same asset CSP as the entry/HTML pages.
  const secondSvg = await rawRequest(info.resourceOrigin, resourcePath(info, 'second.svg'));
  assert.equal(secondSvg.status, 200);
  assert.equal(secondSvg.headers['content-type'], 'image/svg+xml');
  const secondSvgCsp = secondSvg.headers['content-security-policy'];
  assert.ok(secondSvgCsp, 'second.svg must carry the asset CSP when requested as a document');
  assert.equal(secondSvgCsp, entryCsp, 'SVG documents get the same policy as HTML documents');
  assert.equal(secondSvg.headers['x-entry-sha256'], undefined);
  for (const directive of directives) {
    assert.ok(secondSvgCsp.includes(directive), `second.svg CSP must include "${directive}"; got: ${secondSvgCsp}`);
  }
  for (const forbidden of ["'self'", "'unsafe-inline'", 'upgrade-insecure-requests']) {
    assert.ok(!secondSvgCsp.includes(forbidden), `second.svg CSP must not contain ${forbidden}`);
  }

  // Control: non-document static assets must NOT be over-hardened with a CSP.
  assert.equal(secondScript.headers['content-security-policy'], undefined);
  assert.equal(levelJson.headers['content-security-policy'], undefined, 'JSON/level data stays CSP-free');
  assert.equal(stylesheet.headers['content-security-policy'], undefined, 'CSS stays CSP-free');
  assert.equal(
    (await rawRequest(info.resourceOrigin, resourcePath(info, 'assets/pixel.png'))).headers['content-security-policy'],
    undefined,
    'images stay CSP-free'
  );

  // The page is repeatable (no credential consumed by navigating documents).
  assert.equal((await rawRequest(info.resourceOrigin, resourcePath(info, 'second.html'))).status, 200);

  // Fallback path: without a known dshWebOrigin the same document policy uses
  // the configured allowlist + resource origin (identical to the entry logic).
  const fallback = await createStack(t, {
    games: [{ record: zipRecord('demo', '1.0.0'), files }],
    dshWebOrigin: null,
    frameAncestors: ['http://127.0.0.1:19387'],
  });
  const fallbackInfo = await fallback.launch('demo');
  const fallbackSecond = await rawRequest(fallbackInfo.resourceOrigin, resourcePath(fallbackInfo, 'second.html'));
  assert.ok(
    fallbackSecond.headers['content-security-policy'].includes(
      `frame-ancestors http://127.0.0.1:19387 ${fallbackInfo.resourceOrigin}`
    ),
    'non-entry HTML must use the same frame-ancestors fallback as the entry'
  );
});

test('credential lifecycle: renew extends TTL, release invalidates immediately, expiry returns 403', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const info = await stack.launch('demo');

  // Positive control at t=0.
  assert.equal((await rawRequest(info.resourceOrigin, resourcePath(info, 'index.html'))).status, 200);

  // TTL expiry: exactly the documented 403 GM-4011.
  stack.advance(TTL_MS + 1);
  assertGm(await rawRequest(info.resourceOrigin, resourcePath(info, 'index.html')), 403, GM.RESOURCE_CREDENTIAL_EXPIRED);

  // Renew must be possible before expiry and must move the whole window.
  const second = await stack.launch('demo');
  stack.advance(TTL_MS - 1_000);
  const renewed = stack.entry.renewInstance(second.instanceId);
  assert.ok(renewed, 'renewInstance must succeed for a live instance');
  assert.equal(renewed.resourceTtlMs, TTL_MS);
  assert.equal(renewed.instanceId, second.instanceId);
  stack.advance(2_000); // past the original window, inside the renewed one
  assert.equal(
    (await rawRequest(second.resourceOrigin, resourcePath(second, 'index.html'))).status,
    200,
    'a renewed credential must survive the original TTL'
  );
  assert.ok(stack.resources.ttlOf(second.instanceId) > 0);

  // Release invalidates immediately (positive control before release).
  assert.equal((await rawRequest(second.resourceOrigin, resourcePath(second, 'index.html'))).status, 200);
  const released = stack.entry.releaseInstance(second.instanceId, 'demo');
  assert.equal(released, 1);
  assert.equal(stack.resources.has(second.instanceId), false);
  assertGm(await rawRequest(second.resourceOrigin, resourcePath(second, 'index.html')), 403, GM.RESOURCE_CREDENTIAL_EXPIRED);

  // Expired instance is no longer renewable.
  assert.equal(stack.resources.renew(second.instanceId), null);
});

test('cross-instance and unknown credentials are denied, valid credential is the positive control', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const first = await stack.launch('demo');
  const second = await stack.launch('demo');
  assert.notEqual(first.instanceId, second.instanceId);

  // Positive controls: each instance reads its own entry.
  assert.equal((await rawRequest(first.resourceOrigin, resourcePath(first, 'index.html'))).status, 200);
  assert.equal((await rawRequest(second.resourceOrigin, resourcePath(second, 'index.html'))).status, 200);

  // Instance A + instance B's token = cross-instance scope denial (403).
  const tokenB = new URL(second.resourceBase).pathname.split('/')[3];
  const crossInstance = await rawRequest(
    first.resourceOrigin,
    `/res/${first.instanceId}/${tokenB}/index.html`
  );
  assertGm(crossInstance, 403, GM.RESOURCE_SCOPE_DENIED);

  // A well-formed but unknown token is an invalid credential (401).
  const unknownToken = await rawRequest(
    first.resourceOrigin,
    `/res/${first.instanceId}/${'c'.repeat(32)}/index.html`
  );
  assertGm(unknownToken, 401, GM.RESOURCE_CREDENTIAL_INVALID);

  // Unknown instance id is an invalid credential (401), never a file read.
  const unknownInstance = await rawRequest(
    first.resourceOrigin,
    `/res/${'d'.repeat(32)}/${tokenB}/index.html`
  );
  assertGm(unknownInstance, 401, GM.RESOURCE_CREDENTIAL_INVALID);

  // A token used where the launch nonce belongs (and vice versa) is GM-4012.
  const tokenAsLaunch = await rawRequest(
    first.resourceOrigin,
    `${resourcePath(first, 'index.html')}?launch=${tokenB}`
  );
  assertGm(tokenAsLaunch, 401, GM.ENTRY_CREDENTIAL_CONSUMED);
});

test('cross-version/cross-package files are not reachable through another instance', async (t) => {
  const filesA = { ...zipGameFiles(), 'only-a.txt': 'A' };
  const filesB = { ...zipGameFiles(), 'only-b.txt': 'B' };
  const stack = await createStack(t, {
    games: [
      { record: zipRecord('demo', '1.0.0'), files: filesA },
      { record: zipRecord('other', '2.0.0'), files: filesB },
    ],
  });
  const instanceA = await stack.launch('demo');
  const instanceB = await stack.launch('other');

  // Positive controls: both own files are reachable for their own instance.
  assert.equal((await rawRequest(instanceA.resourceOrigin, resourcePath(instanceA, 'only-a.txt'))).status, 200);
  assert.equal((await rawRequest(instanceB.resourceOrigin, resourcePath(instanceB, 'only-b.txt'))).status, 200);

  // Instance A's manifest does not list B's file: 404 GM-4043, even though the
  // request is otherwise well-formed and A's token is valid.
  assertGm(await rawRequest(instanceA.resourceOrigin, resourcePath(instanceA, 'only-b.txt')), 404, GM.ASSET_NOT_FOUND);

  // A token of a different instance/version cannot be mixed in.
  const tokenB = new URL(instanceB.resourceBase).pathname.split('/')[3];
  assertGm(
    await rawRequest(instanceA.resourceOrigin, `/res/${instanceA.instanceId}/${tokenB}/only-b.txt`),
    403,
    GM.RESOURCE_SCOPE_DENIED
  );
});

// ---------------------------------------------------------------------------
// §7.3 — path admission matrix (each rejection paired with a positive control)
// ---------------------------------------------------------------------------

test('path traversal, absolute paths, encoded separators, directories and descriptors are rejected', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const info = await stack.launch('demo');
  const basePath = new URL(info.resourceBase).pathname;
  const origin = info.resourceOrigin;

  // Positive controls: a manifest file at depth 2 and the entry both work.
  assert.equal((await rawRequest(origin, `${basePath}/scripts/main.js`)).status, 200);
  assert.equal((await rawRequest(origin, `${basePath}/index.html`)).status, 200);

  const rejected = [
    [`${basePath}/../index.html`, GM.RESOURCE_SCOPE_DENIED],
    [`${basePath}/../../etc/passwd`, GM.RESOURCE_SCOPE_DENIED],
    [`${basePath}/scripts/../index.html`, GM.RESOURCE_SCOPE_DENIED],
    [`${basePath}/%2e%2e/index.html`, GM.RESOURCE_SCOPE_DENIED],
    [`${basePath}/%2e%2e%2findex.html`, GM.RESOURCE_SCOPE_DENIED],
    // Double encoding decodes once to literal `%2e…` text: it is not traversal
    // after one decode, but it still must not resolve to a manifest file.
    [`${basePath}/%252e%252e%252findex.html`, 'NO_FILE'],
    [`${basePath}/..%5cindex.html`, GM.RESOURCE_SCOPE_DENIED],
    [`${basePath}/%2fetc%2fpasswd`, GM.RESOURCE_SCOPE_DENIED],
    [`${basePath}//etc/passwd`, GM.RESOURCE_SCOPE_DENIED],
    [`${basePath}/index.html%00.png`, GM.RESOURCE_SCOPE_DENIED],
    [`${basePath}/scripts/`, GM.RESOURCE_SCOPE_DENIED],
    [`${basePath}/`, GM.RESOURCE_SCOPE_DENIED],
    [`${basePath}/${DESCRIPTOR_FILE}`, GM.RESOURCE_SCOPE_DENIED],
    [`${basePath}/${ZIP_GAME_MANIFEST_FILE}`, GM.RESOURCE_SCOPE_DENIED],
    // Unknown but safe relative path: 404, not a filesystem lookup.
    [`${basePath}/assets/missing.png`, GM.ASSET_NOT_FOUND],
    [`${basePath}/not-in-manifest.json`, GM.ASSET_NOT_FOUND],
  ];
  for (const [rawPath, code] of rejected) {
    const response = await rawRequest(origin, rawPath);
    let payload;
    if (code === 'NO_FILE') {
      assert.ok(response.status === 403 || response.status === 404, `${rawPath} must be rejected, got ${response.status}`);
      payload = response.json();
      assert.ok(payload.ok === false);
    } else {
      payload = assertGm(response, code === GM.ASSET_NOT_FOUND ? 404 : 403, code);
    }
    // Error responses must not leak the package root, the token or the nonce.
    const serialised = JSON.stringify(payload);
    assert.ok(!serialised.includes(stack.dataRoot), 'error details must not leak the host path');
    assert.ok(!serialised.includes(info.nonce), 'error details must not leak the launch nonce');
    assert.ok(!serialised.includes(new URL(info.resourceBase).pathname.split('/')[3]), 'error details must not leak the token');
  }

  // The same length/look-alike path inside the manifest still works after all
  // of the above rejects (the origin did not enter a failed state).
  assert.equal((await rawRequest(origin, `${basePath}/levels/level-01.json`)).status, 200);
});

test('malformed instance/token path segments are credential errors, not filesystem errors', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const info = await stack.launch('demo');
  const basePath = new URL(info.resourceBase).pathname;

  // Missing token / missing path in URL shape: the origin routes nothing.
  const missing = await rawRequest(info.resourceOrigin, `${basePath}`);
  assert.ok(missing.status === 401 || missing.status === 404, `missing token must be 401/404, got ${missing.status}`);

  // Non-hex instance/token shapes are credential errors with the contract code.
  const badInstance = await rawRequest(info.resourceOrigin, `/res/zzzz/${'a'.repeat(32)}/index.html`);
  assert.ok(
    [401, 403, 404].includes(badInstance.status),
    `a non-instance-shaped route must be rejected, got ${badInstance.status}`
  );

  // Positive control: the unmodified URLs still serve.
  assert.equal((await rawRequest(info.resourceOrigin, `${basePath}/index.html`)).status, 200);
});

// ---------------------------------------------------------------------------
// §7.3/§7.4 — response headers, no cookies, no redirects, MIME + magic
// ---------------------------------------------------------------------------

test('resource responses carry the S-A1 frozen header set and never cookies/redirects/credentials', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const info = await stack.launch('demo');

  const css = await rawRequest(info.resourceOrigin, resourcePath(info, 'styles/game.css'), {
    headers: { origin: 'null', referer: 'http://127.0.0.1:1/ref' },
  });
  assert.equal(css.status, 200);
  assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');
  assert.equal(css.headers['content-length'], String(Buffer.byteLength('body{background:#123456}')));
  assert.equal(css.headers['cache-control'], 'no-store');
  assert.equal(css.headers['x-content-type-options'], 'nosniff');
  assert.equal(css.headers['referrer-policy'], 'no-referrer');
  assert.equal(css.headers['access-control-allow-origin'], '*');
  assert.equal(css.headers['access-control-allow-credentials'], undefined);
  assert.equal(css.headers['set-cookie'], undefined);
  assert.equal(css.headers.location, undefined);
  assert.equal(css.headers['cross-origin-resource-policy'], undefined, 'CORP must not break opaque-origin loads');
  assert.equal(css.headers['cross-origin-embedder-policy'], undefined);
  assert.equal(css.headers['x-frame-options'], undefined);
  assert.equal(css.headers['content-security-policy'], undefined, 'CSP is only sent on the entry document');

  // Entry document: the same security headers plus the explicit-origin CSP.
  const entry = await rawRequest(info.resourceOrigin, resourcePath(info, 'index.html'));
  assert.equal(entry.status, 200);
  const csp = entry.headers['content-security-policy'];
  assert.ok(csp, 'entry document must carry a CSP');
  for (const directive of [
    `script-src ${info.resourceOrigin}`,
    `style-src ${info.resourceOrigin}`,
    `img-src ${info.resourceOrigin} data:`,
    `media-src ${info.resourceOrigin}`,
    `font-src ${info.resourceOrigin}`,
    `connect-src ${info.resourceOrigin}`,
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${DSH_ORIGIN} ${info.resourceOrigin}`,
  ]) {
    assert.ok(csp.includes(directive), `asset-zip-v2 CSP must include "${directive}"; got: ${csp}`);
  }
  assert.ok(!csp.includes("'self'"), "the CSP must use the explicit resource origin, never 'self'");
  assert.ok(!csp.includes('upgrade-insecure-requests'), 'loopback http must not be upgraded to https');
  assert.ok(!csp.includes("'unsafe-inline'"), 'asset-zip-v2 forbids inline script/style');
  assert.ok(!csp.includes("'unsafe-eval'"));
  assert.ok(csp.includes(`frame-ancestors ${DSH_ORIGIN} ${info.resourceOrigin}`), 'the whole ancestor chain (host page + wrapper) must be listed');
  assert.equal(entry.headers['x-entry-sha256'], sha256(Buffer.from(demoHtml())));
});

test('content is checked against the declared type (extension + magic), tampering is observable', async (t) => {
  // A well-formed package first: the same request succeeds (positive control).
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const info = await stack.launch('demo');
  assert.equal((await rawRequest(info.resourceOrigin, resourcePath(info, 'assets/pixel.png'))).status, 200);

  // Then a package whose .js bytes are a ZIP container: it must not be served
  // as JavaScript. The descriptor is valid, so this is served-content defence.
  const disguised = { ...zipGameFiles(), 'scripts/main.js': Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]) };
  const tampered = await createStack(t, {
    games: [{ record: zipRecord('disguised', '1.0.0'), files: disguised }],
  });
  const tamperedInfo = await tampered.launch('disguised');
  assertGm(
    await rawRequest(tamperedInfo.resourceOrigin, resourcePath(tamperedInfo, 'scripts/main.js')),
    422,
    GM.ASSET_TYPE_UNSUPPORTED
  );
});

test('on-disk tampering after launch fails integrity instead of serving different bytes', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const info = await stack.launch('demo');
  assert.equal((await rawRequest(info.resourceOrigin, resourcePath(info, 'scripts/main.js'))).status, 200);

  const target = path.join(stack.versionDirectory('demo'), 'scripts', 'main.js');
  await fs.writeFile(target, 'window.__TAMPERED__ = true;');
  const response = await rawRequest(info.resourceOrigin, resourcePath(info, 'scripts/main.js'));
  const payload = assertGm(response, 500, GM.ASSET_INTEGRITY);
  assert.ok(!JSON.stringify(payload).includes('TAMPERED'), 'failure must not echo the file content');
});

test('resource token and launch nonce never appear in diagnostics', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const info = await stack.launch('demo');
  const token = new URL(info.resourceBase).pathname.split('/')[3];

  // Trigger a logged failure (integrity) so redaction is tested on real data.
  await fs.writeFile(path.join(stack.versionDirectory('demo'), 'index.html'), '<!doctype html><html>tampered</html>');
  const failed = await rawRequest(info.resourceOrigin, `${resourcePath(info, 'index.html')}?launch=${info.nonce}`);
  assertGm(failed, 500, GM.ASSET_INTEGRITY);

  assert.ok(stack.logs.length > 0, 'the failure must have been logged (otherwise redaction is untested)');
  const combined = stack.logs.join('\n');
  assert.ok(combined.includes('asset-integrity-failed'), 'log lines must keep the diagnostic event');
  assert.ok(!combined.includes(token), 'the resource token must be redacted from logs');
  assert.ok(!combined.includes(info.nonce), 'the launch nonce must be redacted from logs');
  assert.ok(!combined.includes(stack.dataRoot), 'absolute host paths must not appear in logs');
});

// ---------------------------------------------------------------------------
// §7.5.1 — platform wrapper document (CR-P1 mitigation)
// ---------------------------------------------------------------------------

test('wrapper is platform-served, static, uncredentialed, game-free and pins frame-src/child-src', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const info = await stack.launch('demo');

  // No credential is needed: the bogus src (and no src at all) both render.
  const bare = await rawRequest(info.resourceOrigin, RESOURCE_WRAPPER_PATH);
  assert.equal(bare.status, 200);
  assert.equal(bare.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(bare.headers['cache-control'], 'no-store');
  assert.equal(bare.headers['x-content-type-options'], 'nosniff');
  assert.equal(bare.headers['referrer-policy'], 'no-referrer');
  const bareCsp = bare.headers['content-security-policy'];
  assert.ok(bareCsp.includes(`frame-src ${info.resourceOrigin};`), `wrapper CSP frame-src: ${bareCsp}`);
  assert.ok(bareCsp.includes(`child-src ${info.resourceOrigin};`), `wrapper CSP child-src: ${bareCsp}`);
  assert.ok(bareCsp.includes("script-src 'nonce-"), 'the wrapper relay needs a nonce, never unsafe-inline');
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(bareCsp), 'the wrapper relay must never be admitted by unsafe-inline');
  // The wrapper is a trusted platform document that may only be embedded by the
  // DSH page: without frame-ancestors an arbitrary website could frame it.
  assert.ok(
    bareCsp.includes(`frame-ancestors ${DSH_ORIGIN}`),
    `wrapper CSP must pin frame-ancestors to the DSH web origin: ${bareCsp}`
  );
  assert.ok(!/frame-ancestors[^;]*\*/.test(bareCsp), 'the wrapper must never be frameable by any origin');
  for (const directive of ["default-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
    assert.ok(bareCsp.includes(directive), `wrapper CSP must include "${directive}"`);
  }
  const bareHtml = bare.text();
  // The wrapper document is the *embedded* side: the sandbox attribute belongs
  // on the embedding iframe (created by the Runtime), never on this document.
  assert.ok(!/<(?:html|body)[^>]*sandbox/i.test(bareHtml), 'the wrapper document itself must not carry a sandbox attribute');
  assert.ok(!bareHtml.includes(info.nonce), 'the wrapper document must not embed the launch nonce');
  assert.ok(!bareHtml.includes(new URL(info.resourceBase).pathname.split('/')[3]), 'the wrapper must not embed the resource token');
  assert.ok(!bareHtml.includes(HTML_MARKER), 'the wrapper must contain no game content');
  assert.ok(bareHtml.includes('src="about:blank"'), 'no src means no game frame');

  // Valid src: iframe points at the one-shot launch URL; sandbox keeps the
  // opaque-origin invariant (allow-scripts, never allow-same-origin).
  const wrapped = await rawRequest(info.resourceOrigin, `${RESOURCE_WRAPPER_PATH}?src=${encodeURIComponent(info.entryUrl)}`);
  assert.equal(wrapped.status, 200);
  const html = wrapped.text();
  const wrappedCsp = wrapped.headers['content-security-policy'];
  assert.ok(wrappedCsp.includes(`frame-src ${info.resourceOrigin};`), `wrapper CSP frame-src: ${wrappedCsp}`);
  assert.ok(wrappedCsp.includes(`child-src ${info.resourceOrigin};`), `wrapper CSP child-src: ${wrappedCsp}`);
  assert.equal(
    wrappedCsp.replace(/nonce-[a-f0-9]+/g, 'nonce-<n>'),
    bareCsp.replace(/nonce-[a-f0-9]+/g, 'nonce-<n>'),
    'the wrapper CSP is static except for the per-response script nonce'
  );
  const iframe = /<iframe[^>]*>/.exec(html);
  assert.ok(iframe, 'the wrapper must contain exactly one game iframe');
  assert.ok(iframe[0].includes(`src="${info.entryUrl.replaceAll('&', '&amp;')}"`), `iframe src must target the launch URL: ${iframe[0]}`);
  // The nested GAME iframe is the only sandboxed layer: opaque origin,
  // allow-scripts only, never allow-same-origin. The outer wrapper iframe added
  // by the Runtime carries no sandbox (real-browser finding: a sandboxed wrapper
  // is an opaque ancestor and defeats the game document's frame-ancestors).
  assert.ok(iframe[0].includes('sandbox="allow-scripts"'), 'the inner game iframe must be sandboxed');
  assert.ok(!iframe[0].includes('allow-same-origin'), 'the inner game iframe must not grant allow-same-origin');
  assert.ok(iframe[0].includes('referrerpolicy="no-referrer"'));
  assert.equal((html.match(/<iframe/g) || []).length, 1);

  // Foreign / malformed src is not reflected: the wrapper stays a safe document.
  for (const src of ['http://127.0.0.1:1/evil.html', 'https://example.com/game.html', 'javascript:alert(1)', '/res/../../x']) {
    const response = await rawRequest(info.resourceOrigin, `${RESOURCE_WRAPPER_PATH}?src=${encodeURIComponent(src)}`);
    assert.equal(response.status, 200);
    assert.ok(!response.text().includes('example.com'), 'foreign origins must never be reflected into the wrapper');
    assert.ok(!response.text().includes('evil.html'));
    assert.ok(response.text().includes('src="about:blank"'), 'invalid targets collapse to about:blank');
  }

  // Loading the wrapper does not consume the one-shot launch credential.
  await rawRequest(info.resourceOrigin, info.wrapperUrl);
  const launch = await rawRequest(info.resourceOrigin, `${resourcePath(info, 'index.html')}?launch=${info.nonce}`);
  assert.equal(launch.status, 200, 'the wrapper must not consume the launch credential');
  // Post-release the static wrapper keeps serving (it grants nothing by itself).
  stack.entry.releaseInstance(info.instanceId, 'demo');
  assert.equal((await rawRequest(info.resourceOrigin, info.wrapperResourceUrl)).status, 200);
  // The wrapper has no write surface either.
  const wrapperPost = await rawRequest(info.resourceOrigin, RESOURCE_WRAPPER_PATH, { method: 'POST' });
  assert.equal(wrapperPost.status, 405);
  assert.equal(wrapperPost.headers.allow, 'GET, HEAD');
  // HEAD is supported on the wrapper too.
  const head = await rawRequest(info.resourceOrigin, RESOURCE_WRAPPER_PATH, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.ok(head.headers['content-security-policy'].includes(`frame-src ${info.resourceOrigin}`));
});

test('wrapper frame-ancestors falls back to the configured allowlist when dshWebOrigin is unknown', async (t) => {
  const stack = await createStack(t, {
    games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }],
    dshWebOrigin: null,
    frameAncestors: ['http://127.0.0.1:19387', 'http://localhost:41234'],
  });
  const info = await stack.launch('demo');
  assert.equal(info.resourceOrigin.startsWith('http://127.0.0.1:'), true);

  const wrapped = await rawRequest(info.resourceOrigin, RESOURCE_WRAPPER_PATH);
  const wrapperCsp = wrapped.headers['content-security-policy'];
  assert.ok(
    wrapperCsp.includes('frame-ancestors http://127.0.0.1:19387 http://localhost:41234'),
    `wrapper must fall back to the V1 allowlist: ${wrapperCsp}`
  );
  assert.ok(!wrapperCsp.includes("frame-ancestors 'self' http://127.0.0.1:19387"), 'fallback must not silently add extra ancestors');

  // The game entry document also uses the allowlist and appends the resource
  // origin, because the (unsandboxed) wrapper is an ancestor on that origin.
  const entry = await rawRequest(info.resourceOrigin, resourcePath(info, 'index.html'));
  const entryCsp = entry.headers['content-security-policy'];
  assert.ok(
    entryCsp.includes(`frame-ancestors http://127.0.0.1:19387 http://localhost:41234 ${info.resourceOrigin}`),
    `zip entry CSP must list the whole ancestor chain: ${entryCsp}`
  );
});

test('wrapper relay is point-to-point: only parent<->game messages are forwarded, payload untouched', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const info = await stack.launch('demo');
  const wrapped = await rawRequest(info.resourceOrigin, `${RESOURCE_WRAPPER_PATH}?src=${encodeURIComponent(info.entryUrl)}`);
  const html = wrapped.text();
  const scriptMatch = /<script nonce="([^"]+)">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(scriptMatch, 'the wrapper must ship its relay as an inline nonce script');
  const [, nonce, scriptBody] = scriptMatch;
  const csp = wrapped.headers['content-security-policy'];
  assert.ok(csp.includes(`script-src 'nonce-${nonce}'`), `CSP must admit the wrapper relay nonce only: ${csp}`);
  assert.ok(!csp.includes("script-src 'unsafe-inline'"));

  // Execute the *actual served relay* in a minimal DOM/message sandbox so the
  // forwarding decision is tested, not described.
  const { runInNewContext } = await import('node:vm');
  const toGame = [];
  const toParent = [];
  const parentWindow = { id: 'parent', postMessage: (data, target) => toParent.push({ data, target }) };
  const gameWindow = { id: 'game', postMessage: (data, target) => toGame.push({ data, target }) };
  const gameFrame = { contentWindow: gameWindow };
  const listeners = [];
  const fakeWindow = {
    parent: parentWindow,
    addEventListener: (type, listener) => {
      if (type === 'message') listeners.push(listener);
    },
  };
  const fakeDocument = { getElementById: (id) => (id === 'dsh-game-frame' ? gameFrame : null) };
  runInNewContext(scriptBody, { window: fakeWindow, document: fakeDocument });
  assert.equal(listeners.length, 1, 'the relay installs exactly one message listener');
  const dispatch = (source, data) => {
    for (const listener of listeners) listener({ source, data });
  };

  const downstream = { jsonrpc: '2.0', method: 'game/ready', params: { nonce: 'x' } };
  dispatch(parentWindow, downstream);
  assert.equal(toGame.length, 1, 'a message from the host page must reach the game iframe');
  assert.equal(toGame[0].data, downstream, 'the relay must not copy/parse/rewrite the payload');
  assert.equal(toGame[0].target, '*');

  const upstream = { jsonrpc: '2.0', method: 'game/score', params: { value: 7 } };
  dispatch(gameWindow, upstream);
  assert.equal(toParent.length, 1, 'a message from the game iframe must reach the host page');
  assert.equal(toParent[0].data, upstream);
  assert.equal(toParent[0].target, '*');

  // Third-party windows are dropped: no broadcast, no echo to the sender.
  dispatch({ id: 'attacker' }, { jsonrpc: '2.0', method: 'game/evil' });
  assert.equal(toGame.length, 1, 'unknown sources must not reach the game');
  assert.equal(toParent.length, 1, 'unknown sources must not be relayed upward');
  // A parent message is not echoed back to the parent, and vice versa.
  assert.equal(toParent.length, 1);
  assert.equal(toGame.length, 1);
});

// ---------------------------------------------------------------------------
// §7.7 — maintenance sees zip packages (record.entry / descriptor digest)
// ---------------------------------------------------------------------------

test('startup maintenance flags inconsistent asset-zip-v2 packages and leaves valid ones alone', async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'dsh-gm-res-maint-'));
  const dataRoot = path.join(directory, 'data');
  t.after(() => rmTree(directory));

  const record = zipRecord('demo', '1.0.0');
  const written = await writeGamePackage(dataRoot, { record, files: zipGameFiles() });
  assert.ok(written.written.size > 0);

  const games = new Map([['demo', record]]);
  const storage = {
    filePath: (...segments) => path.join(dataRoot, ...segments),
    ensureReady: async () => {},
    readOnly: false,
  };
  const installations = {
    get: async (id) => games.get(id) || null,
    read: async () => ({
      schemaVersion: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      games: Object.fromEntries(games),
    }),
    write: async (file) => {
      for (const [id, value] of Object.entries(file.games)) games.set(id, value);
      return file;
    },
  };
  const maintenance = createMaintenanceService({
    storage,
    installations,
    registry: null,
    lock: null,
    logger: null,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });

  // Positive control: a valid zip package is not marked broken.
  const clean = await maintenance.runStartup();
  assert.equal(clean.packages.brokenRecords, 0);
  assert.notEqual(record.compatibility.status, 'broken');

  // Digest mismatch is detected without deleting the package directory.
  record.fileManifestDigest = 'f'.repeat(64);
  const flagged = await maintenance.runStartup();
  assert.equal(flagged.packages.brokenRecords, 1);
  assert.equal(record.compatibility.status, 'broken');
  assert.ok(record.compatibility.reasons.includes('file-manifest-digest'));
  assert.equal(await fs.stat(path.join(dataRoot, 'packages', 'demo', '1.0.0', DESCRIPTOR_FILE)).then(() => true, () => false), true);
});

// ---------------------------------------------------------------------------
// §7.1/§7.6 — URL helper contract shared with the runtime/sdk
// ---------------------------------------------------------------------------

test('shared resource URL helpers agree with the served origin', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const info = await stack.launch('demo');
  const rebuilt = buildResourceBase({
    resourceOrigin: info.resourceOrigin,
    instanceId: info.instanceId,
    resourceToken: new URL(info.resourceBase).pathname.split('/')[3],
  });
  assert.equal(rebuilt.ok, true);
  assert.equal(rebuilt.value, info.resourceBase);
  // The advertised TTL matches the timing constant semantics (§7.2/§7.6).
  assert.equal(info.resourceTtlMs, TTL_MS);
  assert.equal(TIMING.resourceCredentialTtlMs, 10 * 60 * 1000);
});

test('close() is idempotent and the factory exposes the documented surface', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const { info } = await launchAndGetUrls(stack);
  assert.ok(info.resourceOrigin);
  const ready = await stack.resources.ready();
  assert.equal(ready.origin, info.resourceOrigin);
  await stack.resources.close();
  await stack.resources.close(); // repeated close must not throw or hang
  assert.equal(stack.resources.address(), null);
});

// ---------------------------------------------------------------------------
// §7.2/§7.3 — HTTP status matrix for resource errors (contract observable)
// ---------------------------------------------------------------------------

test('resource errors use the Host GM -> HTTP mapping, not just codes', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const first = await stack.launch('demo');
  const second = await stack.launch('demo');
  const origin = first.resourceOrigin;
  const tokenB = new URL(second.resourceBase).pathname.split('/')[3];

  // GM-4010 -> 401 (unknown / malformed credential).
  assertGm(
    await rawRequest(origin, `/res/${first.instanceId}/${'c'.repeat(32)}/index.html`),
    401,
    GM.RESOURCE_CREDENTIAL_INVALID
  );
  // GM-4012 -> 401 (the launch URL carried a nonce that is not this instance's).
  assertGm(
    await rawRequest(origin, `${resourcePath(second, 'index.html')}?launch=${'f'.repeat(32)}`),
    401,
    GM.ENTRY_CREDENTIAL_CONSUMED
  );
  // GM-4013 -> 410 (replay of a consumed one-shot launch URL).
  assert.equal(
    (await rawRequest(origin, `${resourcePath(second, 'index.html')}?launch=${second.nonce}`)).status,
    200
  );
  assertGm(
    await rawRequest(origin, `${resourcePath(second, 'index.html')}?launch=${second.nonce}`),
    410,
    GM.ENTRY_LAUNCH_CONSUMED
  );
  // GM-4039 -> 403 (cross-instance credential / out-of-scope path).
  assertGm(await rawRequest(origin, `/res/${first.instanceId}/${tokenB}/index.html`), 403, GM.RESOURCE_SCOPE_DENIED);
  // GM-4043 -> 404 (safe path not in the validated manifest).
  assertGm(await rawRequest(origin, resourcePath(first, 'missing.json')), 404, GM.ASSET_NOT_FOUND);
  // GM-4011 -> 403 (TTL expiry, and release, which is asserted elsewhere).
  const third = await stack.launch('demo');
  assert.equal(
    (await rawRequest(third.resourceOrigin, resourcePath(third, 'index.html'))).status,
    200,
    'positive control: the soon-to-expire credential works before the TTL elapses'
  );
  stack.advance(TTL_MS + 1);
  assertGm(
    await rawRequest(third.resourceOrigin, resourcePath(third, 'index.html')),
    403,
    GM.RESOURCE_CREDENTIAL_EXPIRED
  );
});

// ---------------------------------------------------------------------------
// §7.6 — host routes forward renew/release to the resource credential
// ---------------------------------------------------------------------------

test('runtime-renew / runtime-release routes refresh and invalidate the resource credential', async (t) => {
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const info = await stack.launch('demo');
  const routes = createRouteTable({ services: { entry: stack.entry } });
  const renewRoute = routes.find((route) => route.path === ROUTES.RUNTIME_RENEW);
  const releaseRoute = routes.find((route) => route.path === ROUTES.RUNTIME_RELEASE);
  assert.ok(renewRoute && releaseRoute, 'the V1 runtime lifecycle routes must stay registered');

  // Positive control before renew.
  assert.equal((await rawRequest(info.resourceOrigin, resourcePath(info, 'index.html'))).status, 200);
  const renewed = await renewRoute.handler({ body: { instanceId: info.instanceId } });
  assert.equal(renewed.instanceId, info.instanceId);
  assert.equal(renewed.resourceTtlMs, TTL_MS, 'POST /runtime-renew must report the new resource TTL');
  assert.ok(renewed.expiresAt > 0);
  assert.equal((await rawRequest(info.resourceOrigin, resourcePath(info, 'index.html'))).status, 200);

  const released = await releaseRoute.handler({ body: { gameId: 'demo', instanceId: info.instanceId } });
  assert.equal(released.released, 1);
  assertGm(
    await rawRequest(info.resourceOrigin, resourcePath(info, 'index.html')),
    403,
    GM.RESOURCE_CREDENTIAL_EXPIRED
  );
});

// ---------------------------------------------------------------------------
// Fail-closed wiring: asset-zip-v2 has no fallback when the origin is missing
// ---------------------------------------------------------------------------

test('asset-zip-v2 launch fails closed without a resource origin and /entry never serves it', async (t) => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'dsh-gm-res-no-wire-'));
  const dataRoot = path.join(directory, 'data');
  t.after(() => rmTree(directory));
  const record = zipRecord('demo', '1.0.0');
  await writeGamePackage(dataRoot, { record, files: zipGameFiles() });

  const unwired = createEntryService({
    catalog: { entries: [], load: async () => null },
    devCatalog: null,
    installations: { get: async (gameId) => (gameId === 'demo' ? record : null) },
    registry: { previewUrl: async () => null },
    storage: { filePath: (...segments) => path.join(dataRoot, ...segments) },
    settings: { security: { frameAncestors: [DSH_ORIGIN] } },
    hostEpoch: 'he_test',
    logger: null,
    timing: { entryBindingTtlMs: TTL_MS },
    resources: null,
  });
  await assert.rejects(
    () => unwired.launch({ gameId: 'demo' }),
    (error) => error && error.code === GM.HOST_UNAVAILABLE,
    'a zip package must not launch when the resource origin is unwired (fail closed)'
  );

  // A wired stack still refuses to serve a zip entry over the DSH /api route.
  const stack = await createStack(t, { games: [{ record: zipRecord('demo', '1.0.0'), files: zipGameFiles() }] });
  const info = await stack.launch('demo');
  const legacyUrl = new URL(`${ROUTES.ENTRY}?gameId=demo&version=1.0.0&instance=${info.instanceId}&nonce=${info.nonce}`, DSH_ORIGIN);
  await assert.rejects(
    () => stack.entry.serveEntry(new Request(legacyUrl), legacyUrl),
    (error) => error && error.code === GM.ASSET_NOT_FOUND,
    '/entry must not serve asset-zip-v2 entries (they live on the resource origin)'
  );
});

// ---------------------------------------------------------------------------
// Composition: the real createHost wiring must hand the resource service to the
// entry service (Lead-owned wiring; this test is the integration contract).
// ---------------------------------------------------------------------------

test('createHost wires the resource origin into launch and disposes it cleanly', async (t) => {
  const host = await createHostHarness(t);
  assert.ok(host.host.resources, 'createHost must expose the resource service');
  assert.equal(typeof host.host.resources.issue, 'function');
  assert.equal(typeof host.host.dispose, 'function');
  assert.ok(host.host.services.resources === host.host.resources, 'the service graph must expose resources');

  const manifest = buildManifest({ id: 'wired-game', version: '1.0.0' });
  const pkg = buildPackage(manifest);
  await host.data(ROUTES.INSTALL_LOCAL, { rawBody: pkg.html, contentType: 'text/html' });
  const info = await host.data(ROUTES.LAUNCH, { body: { gameId: 'wired-game' } });

  // §7.6: html-v1 keeps /entry and still receives the additive resource fields.
  assert.match(info.entryUrl, /^\/api\/game-market\/entry\?/);
  assert.match(info.resourceOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(info.package.format, 'html-v1');
  assert.equal(info.package.entry, 'entry.html');
  assert.equal(info.package.filesDigest, null);
  assert.equal(typeof info.resourceTtlMs, 'number');
  assert.ok(info.resourceTtlMs > 0);
  assert.equal(info.entryResourceUrl, `${info.resourceBase}/entry.html`);
  assert.equal(new URL(info.wrapperUrl).pathname, '/wrapper');
  assert.equal(new URL(info.wrapperResourceUrl).pathname, '/wrapper');

  // The wired origin really serves the launched entry resource.
  const served = await rawRequest(new URL(info.resourceOrigin).origin, new URL(info.entryResourceUrl).pathname);
  assert.equal(served.status, 200);
  assert.equal(served.headers['content-security-policy'] !== undefined, true);

  // Teardown closes the listening socket and is idempotent.
  const origin = host.host.resources.origin;
  await host.host.dispose();
  await host.host.dispose();
  assert.equal(host.host.resources.address(), null);
  assert.equal(origin, origin);
});

// ---------------------------------------------------------------------------
// Registration: self-register on import (direct `node --test <file>` works) and
// expose `register()` idempotently for `test/index.js`.
// ---------------------------------------------------------------------------

test('an unbindable resource origin fails closed with GM-5038 (no silent fallback)', async (t) => {
  const blocker = http.createServer(() => undefined);
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  const occupiedPort = blocker.address().port;
  t.after(() => new Promise((resolve) => blocker.close(resolve)));

  const resources = createResourceService({ port: occupiedPort });
  t.after(() => resources.close());
  await assert.rejects(
    () => resources.start(),
    (error) => error && error.code === GM.HOST_UNAVAILABLE,
    'binding an occupied port must surface GM-5038, never a silent no-op'
  );
  await assert.rejects(
    () =>
      resources.issue({
        instanceId: 'a'.repeat(32),
        nonce: 'b'.repeat(32),
        gameId: 'demo',
        version: '1.0.0',
        format: 'html-v1',
        entry: 'entry.html',
        entryPath: path.join(tmpdir(), 'does-not-exist.html'),
      }),
    (error) => error && error.code === GM.HOST_UNAVAILABLE,
    'issue() must not fabricate a credential without a listening origin'
  );
  assert.equal(resources.address(), null);
});

let registered = false;
export function register() {
  if (registered) return;
  registered = true;
}

register();

test('M4 packaged Desktop pins wrapper and both game formats to dsh-app://app',async t=>{
 const bytes=Buffer.from(htmlV1Files()['entry.html']);
 const stack=await createStack(t,{dshWebOrigin:'dsh-app://app',games:[{record:htmlV1Record('legacy','2.1.0',sha256(bytes)),files:htmlV1Files()}]});
 const info=await stack.launch('legacy');
 const wrapper=await fetch(info.wrapperUrl);const csp=wrapper.headers.get('content-security-policy');
 assert.ok(csp.includes('frame-ancestors dsh-app://app'));assert.ok(!csp.includes('127.0.0.1:*'));
 const entry=await fetch(info.entryResourceUrl);assert.ok(entry.headers.get('content-security-policy').includes('dsh-app://app'));
 const zip=await createStack(t,{dshWebOrigin:'dsh-app://app',games:[{record:zipRecord('demo','1.0.0'),files:zipGameFiles()}]});const z=await zip.launch('demo');
 const doc=await fetch(z.entryResourceUrl);assert.ok(doc.headers.get('content-security-policy').includes('frame-ancestors dsh-app://app '+z.resourceOrigin));
});
