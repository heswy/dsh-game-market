import assert from 'node:assert/strict';
import test from 'node:test';

import { ROUTES } from '../../../shared/src/contracts.js';
import { GM } from '../../../shared/src/errors.js';
import { buildContentSecurityPolicy } from '../../src/entry.js';
import {
  BROKEN_FIXTURE_ROOT,
  ORIGIN,
  createHarness,
  expected,
  makeGameRoot,
} from '../support/harness.js';

function assertErrorEnvelope(payload, code) {
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, code);
}

async function launch(host, body = {}) {
  return host.data(ROUTES.LAUNCH, { body: { gameId: 'snake', ...body } });
}

export function register() {
  test('POST /launch returns complete LaunchInfo and a usable entryUrl', async (t) => {
    const host = await createHarness(t);
    const info = await launch(host, { mode: 'resume-paused', dshSessionId: 'session-launch-1' });
    assert.match(info.instanceId, /^[a-f0-9]{32}$/);
    assert.match(info.nonce, /^[a-f0-9]{32}$/);
    assert.equal(info.mode, 'resume-paused');
    assert.equal(info.runtimeVersion, expected.runtimeVersion);
    assert.equal(info.sdkVersion, expected.sdkVersion);
    assert.deepEqual(info.capabilities, ['storage', 'score']);
    assert.deepEqual(info.limits, expected.limits);
    assert.deepEqual(info.viewport, expected.viewport);
    assert.match(info.hostEpoch, /^he_[a-f0-9]{16}$/);
    assert.deepEqual(info.preview, { icon: null, cover: null });
    assert.ok(info.entryUrl.startsWith('/api/game-market/entry?'));
    const url = new URL(info.entryUrl, ORIGIN);
    assert.equal(url.pathname, ROUTES.ENTRY);
    assert.equal(url.searchParams.get('gameId'), 'snake');
    assert.equal(url.searchParams.get('version'), '0.1.0');
    assert.equal(url.searchParams.get('instance'), info.instanceId);
    assert.equal(url.searchParams.get('nonce'), info.nonce);

    const defaultMode = await launch(host);
    assert.equal(defaultMode.mode, 'start');
    assert.notEqual(defaultMode.instanceId, info.instanceId);
    assert.notEqual(defaultMode.nonce, info.nonce);
  });

  test('POST /launch validates game, version, mode and session id', async (t) => {
    const host = await createHarness(t);
    const cases = [
      [{ gameId: 'unknown-game' }, 404, GM.GAME_NOT_FOUND],
      [{ gameId: 'Bad_ID' }, 400, GM.BAD_GAME_ID],
      [{ gameId: 'snake', version: '9.9.9' }, 404, GM.GAME_NOT_FOUND],
      [{ gameId: 'snake', mode: 'continue' }, 400, GM.INVALID_PARAM],
      [{ gameId: 'snake', dshSessionId: 'bad session' }, 400, GM.INVALID_PARAM],
      [{ gameId: 'snake', version: 'not-semver' }, 400, GM.INVALID_PARAM],
    ];
    for (const [body, status, code] of cases) {
      const { response, payload } = await host.requestJson(ROUTES.LAUNCH, { body });
      assert.equal(response.status, status);
      assertErrorEnvelope(payload, code);
    }
  });

  test('compatibility checks map to GM-4260/GM-4261 and invalid ranges to GM-4221', async (t) => {
    for (const [field, code] of [
      ['runtimeVersion', GM.RUNTIME_INCOMPATIBLE],
      ['sdkVersion', GM.SDK_INCOMPATIBLE],
    ]) {
      const root = await makeGameRoot(t, { overrides: { [field]: '^9.0.0' } });
      const host = await createHarness(t, { fixtureRoot: root });
      const { response, payload } = await host.requestJson(ROUTES.LAUNCH, {
        body: { gameId: 'snake' },
      });
      assert.equal(response.status, 409);
      assertErrorEnvelope(payload, code);
      const incompat = await host.requestJson(ROUTES.INSTALLED);
      assert.equal(incompat.response.status, 200);
      assert.equal(incompat.payload.data.items.length, 1);
    }
    const badRangeRoot = await makeGameRoot(t, { overrides: { runtimeVersion: '*' } });
    const badRange = await createHarness(t, { fixtureRoot: badRangeRoot });
    const { response, payload } = await badRange.requestJson(ROUTES.GAME, {
      query: { id: 'snake' },
    });
    assert.equal(response.status, 422);
    assertErrorEnvelope(payload, GM.MANIFEST_INVALID);
    const launch = await badRange.requestJson(ROUTES.LAUNCH, { body: { gameId: 'snake' } });
    assert.equal(launch.response.status, 422);
    assertErrorEnvelope(launch.payload, GM.MANIFEST_INVALID);
  });

  test('launch refuses a built-in without its entry file', async (t) => {
    const host = await createHarness(t, { fixtureRoot: BROKEN_FIXTURE_ROOT });
    const { response, payload } = await host.requestJson(ROUTES.LAUNCH, {
      body: { gameId: 'snake' },
    });
    assert.equal(response.status, 404);
    assertErrorEnvelope(payload, GM.ASSET_NOT_FOUND);
  });

  test('GET /entry serves self-contained HTML with the full CSP and cache headers', async (t) => {
    const host = await createHarness(t);
    const info = await launch(host);
    const response = await host.request(info.entryUrl);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    const csp = response.headers.get('content-security-policy');
    assert.equal(csp, buildContentSecurityPolicy(ORIGIN));
    for (const directive of [
      "default-src 'none'",
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline'",
      'img-src data: blob:',
      'font-src data:',
      'media-src data: blob:',
      "connect-src 'none'",
      "frame-src 'none'",
      "child-src 'none'",
      "worker-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      'frame-ancestors http://127.0.0.1:19387',
    ]) {
      assert.ok(csp.includes(directive), `missing CSP directive: ${directive}`);
    }
    const body = await response.text();
    assert.ok(body.includes('data-test-entry="snake"'));
    assert.equal(body.includes(info.instanceId), false);
    assert.equal(body.includes(info.nonce), false);
    assert.match(response.headers.get('x-entry-sha256'), /^[a-f0-9]{64}$/);
    assert.equal(Number(response.headers.get('content-length')), Buffer.byteLength(body, 'utf8'));
  });

  test('HEAD /entry keeps headers and omits the body', async (t) => {
    const host = await createHarness(t);
    const info = await launch(host);
    const get = await host.request(info.entryUrl);
    const getBody = await get.text();
    const head = await host.request(info.entryUrl, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(getBody, 'utf8')));
    assert.equal(head.headers.get('x-entry-sha256'), get.headers.get('x-entry-sha256'));
    const second = await host.request(info.entryUrl);
    assert.equal(second.headers.get('x-entry-sha256'), get.headers.get('x-entry-sha256'));
  });

  test('GET /entry returns readable JSON errors for bad params/version/missing assets', async (t) => {
    const host = await createHarness(t);
    const info = await launch(host);
    const url = new URL(info.entryUrl, ORIGIN);
    const withoutNonce = new URL(info.entryUrl, ORIGIN);
    withoutNonce.searchParams.delete('nonce');
    const missingParam = await host.requestJson(`${withoutNonce.pathname}${withoutNonce.search}`);
    assert.equal(missingParam.response.status, 400);
    assertErrorEnvelope(missingParam.payload, GM.INVALID_PARAM);

    const badInstance = new URL(info.entryUrl, ORIGIN);
    badInstance.searchParams.set('instance', 'not-hex');
    const badInstanceResult = await host.requestJson(
      `${badInstance.pathname}${badInstance.search}`
    );
    assert.equal(badInstanceResult.response.status, 400);
    assertErrorEnvelope(badInstanceResult.payload, GM.INVALID_PARAM);

    const wrongVersion = new URL(info.entryUrl, ORIGIN);
    wrongVersion.searchParams.set('version', '9.9.9');
    const wrongVersionResult = await host.requestJson(
      `${wrongVersion.pathname}${wrongVersion.search}`
    );
    assert.equal(wrongVersionResult.response.status, 404);
    assertErrorEnvelope(wrongVersionResult.payload, GM.GAME_NOT_FOUND);

    const unknownGame = new URL(info.entryUrl, ORIGIN);
    unknownGame.searchParams.set('gameId', 'unknown-game');
    const unknownResult = await host.requestJson(`${unknownGame.pathname}${unknownGame.search}`);
    assert.equal(unknownResult.response.status, 404);
    assertErrorEnvelope(unknownResult.payload, GM.GAME_NOT_FOUND);

    const post = await host.requestJson(info.entryUrl, { method: 'POST' });
    assert.equal(post.response.status, 400);
    assertErrorEnvelope(post.payload, GM.UNKNOWN_METHOD);

    const broken = await createHarness(t, { fixtureRoot: BROKEN_FIXTURE_ROOT });
    const brokenPath = `${ROUTES.ENTRY}?gameId=snake&version=0.1.0&instance=${'a'.repeat(32)}&nonce=${'b'.repeat(32)}`;
    const brokenResult = await broken.requestJson(brokenPath);
    assert.equal(brokenResult.response.status, 404);
    assert.equal(brokenResult.response.headers.get('content-type'), 'application/json; charset=utf-8');
    assertErrorEnvelope(brokenResult.payload, GM.ASSET_NOT_FOUND);
  });

  test('preview routing is restricted to declared manifest files', async (t) => {
    const host = await createHarness(t);
    const declared = await host.request(ROUTES.PREVIEW, {
      query: { gameId: 'snake', file: 'preview/icon.png', v: '0.1.0' },
    });
    assert.equal(declared.status, 200);
    assert.equal(declared.headers.get('content-type'), 'image/png');
    const undeclared = await host.requestJson(ROUTES.PREVIEW, {
      query: { gameId: 'snake', file: 'dist/index.html' },
    });
    assert.equal(undeclared.response.status, 404);
    assertErrorEnvelope(undeclared.payload, GM.ASSET_NOT_FOUND);
    const traversal = await host.requestJson(ROUTES.PREVIEW, {
      query: { gameId: 'snake', file: '../../game.json' },
    });
    assert.equal(traversal.response.status, 404);
    assertErrorEnvelope(traversal.payload, GM.ASSET_NOT_FOUND);
  });
}
