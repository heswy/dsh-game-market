import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import test from 'node:test';

import { ROUTES } from '../../../shared/src/contracts.js';
import { GM } from '../../../shared/src/errors.js';
import { buildPackage, buildManifest } from '../support/packages.js';
import { createFileRegistry } from '../support/packages.js';
import { createHostHarness } from '../support/harness.js';

function assertError(payload, code) {
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, code);
}

async function setupInstalled(t, options = {}) {
  const fixture = await createFileRegistry(t, [
    { manifest: { id: 'jump', name: 'Jump', version: '1.0.0' } },
  ]);
  const host = await createHostHarness(t, {
    config: {
      registry: { url: fixture.indexPath, allowLocalFile: true },
      ...(options.config || {}),
    },
    http: options.http,
  });
  await host.host.registry.ready();
  await host.data(ROUTES.INSTALL, { body: { gameId: 'jump', operationId: 'launch-install' } });
  return { fixture, host };
}

async function launch(host, extra = {}) {
  return host.data(ROUTES.LAUNCH, { body: { gameId: 'jump', ...extra } });
}

export function register() {
  test('POST /launch serves an installed package with LaunchInfo v1 fields', async (t) => {
    const { host } = await setupInstalled(t);
    const info = await launch(host, { dshSessionId: 'session-v1', mode: 'resume-paused' });
    assert.equal(info.gameId, 'jump');
    assert.equal(info.gameVersion, '1.0.0');
    assert.equal(info.mode, 'resume-paused');
    assert.equal(info.protocolVersion, 1);
    assert.equal(info.runtimeVersion, '1.0.0');
    assert.equal(info.sdkVersion, '1.0.0');
    assert.match(info.entrySha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(info.capabilities, ['storage', 'score']);
    assert.deepEqual(info.viewport, { width: 960, height: 540, fit: 'contain' });
    assert.deepEqual(info.limits, { saveBytes: 1024 * 1024, saveKeys: 32, scoreMetaBytes: 2048 });
    assert.match(info.entryUrl, /^\/api\/game-market\/entry\?/);
    assert.deepEqual(info.preview, { icon: null, cover: null });

    const response = await host.request(info.entryUrl);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(body.includes('data-test-entry="jump"'));
    const record = (await host.readDataJson('installations.json')).games.jump;
    assert.equal(info.entrySha256, record.sha256);
    assert.equal(response.headers.get('x-entry-sha256'), record.sha256);
    assert.equal(response.headers.get('x-entry-version'), '1.0.0');
    assert.equal(
      response.headers.get('content-length'),
      String(Buffer.byteLength(body, 'utf8'))
    );
    assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'self'"));
  });

  test('launch refuses a tampered registry package (GM-5014) and /entry re-checks it', async (t) => {
    const { host } = await setupInstalled(t);
    const info = await launch(host);
    const entryPath = host.filePath('packages', 'jump', '1.0.0', 'entry.html');
    const original = await fs.readFile(entryPath, 'utf8');
    await fs.writeFile(entryPath, original.replace('data-test-game="jump"', 'data-test-game="jump" data-tampered="1"'));

    const { response, payload } = await host.requestJson(ROUTES.LAUNCH, {
      body: { gameId: 'jump' },
    });
    assert.equal(response.status, 500);
    assertError(payload, GM.ASSET_INTEGRITY);

    // The earlier binding still points at the path, but serving re-hashes it.
    const served = await host.requestJson(info.entryUrl);
    assert.equal(served.response.status, 500);
    assertError(served.payload, GM.ASSET_INTEGRITY);
  });

  test('local installs re-parse the inline manifest before launch and serve', async (t) => {
    const host = await createHostHarness(t);
    const manifest = buildManifest({ id: 'local-game', version: '1.0.0' });
    const pkg = buildPackage(manifest);
    await host.data(ROUTES.INSTALL_LOCAL, { rawBody: pkg.html, contentType: 'text/html' });
    const info = await host.data(ROUTES.LAUNCH, { body: { gameId: 'local-game' } });
    assert.equal(info.gameVersion, '1.0.0');
    assert.deepEqual(info.preview, { icon: null, cover: null });

    // Replace the entry with a different (valid) package.
    const other = buildPackage(buildManifest({ id: 'other-game', version: '1.0.0' }));
    const entryPath = host.filePath('packages', 'local-game', '1.0.0', 'entry.html');
    await fs.writeFile(entryPath, other.bytes);

    const launchResult = await host.requestJson(ROUTES.LAUNCH, {
      body: { gameId: 'local-game' },
    });
    assert.equal(launchResult.response.status, 503);
    assertError(launchResult.payload, GM.INSTALL_CORRUPT);

    const served = await host.requestJson(info.entryUrl);
    assert.equal(served.response.status, 503);
    assertError(served.payload, GM.INSTALL_CORRUPT);
  });

  test('/entry validates instance binding and expiry', async (t) => {
    const { host } = await setupInstalled(t, { http: { timing: { entryBindingTtlMs: 25 } } });
    const info = await launch(host);
    const wrongNonce = new URL(info.entryUrl, 'http://127.0.0.1:19387');
    wrongNonce.searchParams.set('nonce', 'f'.repeat(32));
    const wrong = await host.requestJson(`${wrongNonce.pathname}${wrongNonce.search}`);
    assert.equal(wrong.response.status, 400);
    assertError(wrong.payload, GM.INVALID_PARAM);

    const unknown = new URL(info.entryUrl, 'http://127.0.0.1:19387');
    unknown.searchParams.set('instance', 'e'.repeat(32));
    const unknownResult = await host.requestJson(`${unknown.pathname}${unknown.search}`);
    assert.equal(unknownResult.response.status, 400);
    assertError(unknownResult.payload, GM.INVALID_PARAM);

    await new Promise((resolve) => setTimeout(resolve, 40));
    const expired = await host.requestJson(info.entryUrl);
    assert.equal(expired.response.status, 400);
    assertError(expired.payload, GM.INVALID_PARAM);
  });

  test('CSP frame-ancestors uses config, appends loopback and never falls back to *', async (t) => {
    const { host } = await setupInstalled(t, {
      config: { security: { frameAncestors: ['https://app.example.com'] } },
    });
    const info = await launch(host);
    const response = await host.request(info.entryUrl);
    const csp = response.headers.get('content-security-policy');
    assert.ok(
      csp.includes("frame-ancestors https://app.example.com http://127.0.0.1:19387"),
      csp
    );
    assert.equal(csp.includes('frame-ancestors *'), false);
    assert.equal(csp.includes('blob:'), false);
  });

  test('invalid frame-ancestors entries are dropped and reported as config issues', async (t) => {
    const { host } = await setupInstalled(t, {
      config: { security: { frameAncestors: ['*', 'data:', 'https://ok.example.com'] } },
    });
    const health = await host.data(ROUTES.HEALTH);
    assert.ok(health.configIssues.includes('security.frameAncestors:wildcard'));
    const info = await launch(host);
    const csp = (await host.request(info.entryUrl)).headers.get('content-security-policy');
    assert.ok(csp.includes('https://ok.example.com'));
    const frameDirective = csp
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('frame-ancestors'));
    assert.ok(frameDirective);
    assert.equal(frameDirective.includes('*'), false);
    assert.equal(frameDirective.includes('data:'), false);
  });

  test('launch errors: unknown, registry-only, version mismatch, invalid mode', async (t) => {
    const fixture = await createFileRegistry(t, [
      { manifest: { id: 'jump' } },
      { manifest: { id: 'puzzle-only' } },
    ]);
    const host = await createHostHarness(t, {
      config: { registry: { url: fixture.indexPath, allowLocalFile: true } },
    });
    await host.host.registry.ready();

    const unknown = await host.requestJson(ROUTES.LAUNCH, { body: { gameId: 'nope-game' } });
    assert.equal(unknown.response.status, 404);
    assertError(unknown.payload, GM.GAME_NOT_FOUND);

    const notInstalled = await host.requestJson(ROUTES.LAUNCH, { body: { gameId: 'puzzle-only' } });
    assert.equal(notInstalled.response.status, 404);
    assertError(notInstalled.payload, GM.GAME_NOT_FOUND);

    await host.data(ROUTES.INSTALL, { body: { gameId: 'jump', operationId: 'launch-jump' } });
    const badVersion = await host.requestJson(ROUTES.LAUNCH, {
      body: { gameId: 'jump', version: '9.9.9' },
    });
    assert.equal(badVersion.response.status, 404);
    assertError(badVersion.payload, GM.GAME_NOT_FOUND);

    const badMode = await host.requestJson(ROUTES.LAUNCH, {
      body: { gameId: 'jump', mode: 'later' },
    });
    assert.equal(badMode.response.status, 400);
    assertError(badMode.payload, GM.INVALID_PARAM);
  });

  test('preview links on launch come from the same-origin cache', async (t) => {
    const fixture = await createFileRegistry(t, [{ manifest: { id: 'jump' } }]);
    const host = await createHostHarness(t, {
      config: { registry: { url: fixture.indexPath, allowLocalFile: true } },
      http: {
        fetch: async () => new Response('offline', { status: 503 }),
      },
    });
    await host.host.registry.ready();
    await host.data(ROUTES.INSTALL, { body: { gameId: 'jump', operationId: 'preview-install' } });
    // File registries never fetch remote previews; launch must not fabricate URLs.
    const info = await launch(host);
    assert.deepEqual(info.preview, { icon: null, cover: null });
  });
}
