import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AGENT_LABEL_KEYS, AGENT_LABELS_ZH } from '../../../shared/src/constants.js';
import { ROUTES } from '../../../shared/src/contracts.js';
import { GM } from '../../../shared/src/errors.js';
import { normaliseConfig } from '../../src/config.js';
import { createHost } from '../../src/host.js';
import {
  BROKEN_FIXTURE_ROOT,
  createHarness,
  expected,
  FIXTURE_ROOT,
} from '../support/harness.js';

function assertErrorEnvelope(payload, code) {
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, code);
  assert.equal(typeof payload.error.message, 'string');
  assert.equal(typeof payload.error.retryable, 'boolean');
}

export function register() {
  test('health returns the documented snapshot and envelope', async (t) => {
    const host = await createHarness(t);
    const { response, payload } = await host.requestJson(ROUTES.HEALTH);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/json/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(payload.ok, true);
    assert.match(payload.requestId, /^req_[a-f0-9]{16}$/);
    assert.ok(!Number.isNaN(Date.parse(payload.serverTime)));
    assert.equal(payload.data.ok, true);
    assert.equal(payload.data.devMode, false);
    assert.match(payload.data.hostEpoch, /^he_[a-f0-9]{16}$/);
    assert.equal(payload.data.storage.root, host.dataRoot);
    assert.equal(payload.data.storage.ok, true);
    assert.equal(payload.data.storage.readOnly, false);
    assert.equal(typeof payload.data.version, 'string');
    assert.ok(payload.data.uptimeMs >= 0);
    assert.equal(payload.data.sessions.running, 0);
    assert.equal(payload.data.sessions.staleRunningPreserved, true);
    assert.equal(payload.data.games.builtinCount, 1);
    assert.deepEqual(payload.data.games.issues, []);
    assert.equal(AGENT_LABELS_ZH.idle, 'Agent 空闲');
    assert.equal(AGENT_LABEL_KEYS.idle, 'agent.state.idle');
  });

  test('request ids are unique and health HEAD has no body', async (t) => {
    const host = await createHarness(t);
    const first = await host.requestJson(ROUTES.HEALTH);
    const second = await host.requestJson(ROUTES.HEALTH);
    assert.notEqual(first.payload.requestId, second.payload.requestId);
    const head = await host.request(ROUTES.HEALTH, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });

  test('devMode only registers the dev agent-state route', async (t) => {
    const regular = await createHarness(t);
    assert.equal(regular.routes.has(ROUTES.DEV_AGENT_STATE), false);
    const dev = await createHarness(t, { config: { devMode: true } });
    assert.equal(dev.routes.has(ROUTES.DEV_AGENT_STATE), true);
    const health = await dev.data(ROUTES.HEALTH);
    assert.equal(health.devMode, true);
    assert.equal(dev.routes.has(ROUTES.AGENT_STATE), true);
    assert.equal(dev.routes.has(ROUTES.ENTRY), true);
  });

  test('POST requires application/json, bounded bodies and object JSON', async (t) => {
    const host = await createHarness(t);
    const wrongType = await host.requestJson(ROUTES.SAVE, {
      rawBody: '{}',
      contentType: 'text/plain',
    });
    assert.equal(wrongType.response.status, 415);
    assertErrorEnvelope(wrongType.payload, GM.UNSUPPORTED_MEDIA_TYPE);

    const missingType = await host.requestJson(ROUTES.SAVE, {
      rawBody: '{}',
      contentType: null,
    });
    assert.equal(missingType.response.status, 415);
    assertErrorEnvelope(missingType.payload, GM.UNSUPPORTED_MEDIA_TYPE);

    const invalidJson = await host.requestJson(ROUTES.SAVE, {
      rawBody: '{not-json',
      contentType: 'application/json',
    });
    assert.equal(invalidJson.response.status, 400);
    assertErrorEnvelope(invalidJson.payload, GM.INVALID_JSON);

    const arrayBody = await host.requestJson(ROUTES.SAVE, {
      rawBody: '[]',
      contentType: 'application/json',
    });
    assert.equal(arrayBody.response.status, 400);
    assertErrorEnvelope(arrayBody.payload, GM.INVALID_PARAM);

    const tooLarge = await host.requestJson(ROUTES.SAVE, {
      rawBody: JSON.stringify({ gameId: 'snake', key: 'current', data: 'x'.repeat(1024 * 1024 + 8) }),
      contentType: 'application/json',
    });
    assert.equal(tooLarge.response.status, 413);
    assertErrorEnvelope(tooLarge.payload, GM.SAVE_TOO_LARGE);
  });

  test('unknown methods map to GM-4004 and method-specific routes stay exact', async (t) => {
    const host = await createHarness(t);
    const { response, payload } = await host.requestJson(ROUTES.SESSION, { method: 'GET' });
    assert.equal(response.status, 400);
    assertErrorEnvelope(payload, GM.UNKNOWN_METHOD);
    assert.deepEqual(host.routes.get(ROUTES.SESSION).methods, ['POST']);
    assert.deepEqual(host.routes.get(ROUTES.ENTRY).methods, ['GET', 'HEAD']);
    assert.deepEqual(host.routes.get(ROUTES.SAVE).methods, ['GET', 'POST']);
  });

  test('all contract paths except the dev route are registered exactly', async (t) => {
    const host = await createHarness(t);
    const expectedPaths = [
      ROUTES.HEALTH,
      ROUTES.GAMES,
      ROUTES.GAME,
      ROUTES.INSTALLED,
      ROUTES.INSTALL,
      ROUTES.INSTALL_LOCAL,
      ROUTES.UNINSTALL,
      ROUTES.REGISTRY_REFRESH,
      ROUTES.SAVE,
      ROUTES.SESSION,
      ROUTES.SCORES,
      ROUTES.SCORE,
      ROUTES.PREFERENCES,
      ROUTES.AGENT_STATE,
      ROUTES.AGENT_ACK,
      ROUTES.LAUNCH,
      ROUTES.ENTRY,
      ROUTES.PREVIEW,
    ];
    assert.deepEqual([...host.routes.keys()].sort(), expectedPaths.sort());
    for (const route of host.routes.values()) {
      assert.equal(route.requestBody, 'buffered');
      assert.equal(typeof route.fetch, 'function');
      assert.ok(route.path.startsWith('/api/game-market/'));
    }
  });

  test('missing connection does not throw and registers no routes', async (t) => {
    const host = await createHarness(t, { withConnection: false });
    assert.equal(host.routes.size, 0);
    assert.equal(host.logs.some((entry) => entry[0] === 'error' && entry[1] === 'apply-threw'), false);
    assert.equal(
      host.logs.some((entry) => entry.includes('connection-unavailable')),
      true
    );
  });

  test('event registration failures do not abort apply', async (t) => {
    const host = await createHarness(t, { failingEvents: ['agent/pre-step'] });
    assert.equal(host.routes.has(ROUTES.HEALTH), true);
    assert.equal(host.listeners.has('agent/pre-step'), false);
    assert.equal(host.listeners.has('agent/disposed'), true);
    assert.equal(host.listeners.has('session/event'), true);
    assert.equal(
      host.logs.some((entry) => entry.includes('event-registration-failed')),
      true
    );
  });

  test('unwritable storage flips health to read-only and rejects writes with GM-5025', async (t) => {
    const host = await createHarness(t);
    await host.requestJson(ROUTES.HEALTH);
    await fs.chmod(host.dataRoot, 0o500);
    try {
      const { response, payload } = await host.requestJson(ROUTES.HEALTH);
      assert.equal(response.status, 200);
      assert.equal(payload.data.ok, false);
      assert.equal(payload.data.storage.ok, false);
      assert.equal(payload.data.storage.readOnly, true);
      const write = await host.requestJson(ROUTES.SAVE, {
        body: { gameId: 'snake', key: 'current', data: { score: 1 } },
      });
      assert.equal(write.response.status, 500);
      assertErrorEnvelope(write.payload, 'GM-5025');
    } finally {
      await fs.chmod(host.dataRoot, 0o700);
    }
  });

  test('broken built-in is explained by health diagnostics', async (t) => {
    const host = await createHarness(t, { fixtureRoot: BROKEN_FIXTURE_ROOT });
    const health = await host.data(ROUTES.HEALTH);
    assert.equal(health.games.builtinCount, 1);
    assert.deepEqual(health.games.issues, [{ gameId: 'snake', issue: 'entry-missing' }]);
  });

  test('host unavailable returns GM-5031 and unknown paths map to 404', async (t) => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'dsh-gm-unavailable-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const host = createHost({
      config: { dataRoot: path.join(directory, 'data'), builtinGamesRoot: FIXTURE_ROOT },
    });
    host.availability.available = false;
    await assert.rejects(
      () => host.services.health.snapshot(),
      (error) => {
        assert.equal(error.code, GM.HOST_UNAVAILABLE);
        assert.equal(error.retryable, true);
        return true;
      }
    );
    host.availability.available = true;
    await host.maintenance.ready();
    await host.registry.ready();
    const unknownPath = await host.router.handle(
      new Request('http://127.0.0.1:19387/api/game-market/not-a-route')
    );
    assert.equal(unknownPath.status, 404);
    const body = await unknownPath.json();
    assert.equal(body.ok, false);
    assert.equal(body.error.code, GM.GAME_NOT_FOUND);
    await host.storage.flush();
  });

  test('config parsing is defensive and respects DSH_HOME', () => {
    const config = normaliseConfig({ devMode: 'yes', dataRoot: 42, builtinGamesRoot: '' }, {
      DSH_HOME: path.join('/tmp', 'gm-config-home'),
    });
    assert.equal(config.devMode, false);
    assert.equal(config.dataRoot, path.join('/tmp', 'gm-config-home', 'storages', 'dsh-game-market'));
    assert.equal(path.basename(config.builtinGamesRoot), 'games');
    const dev = normaliseConfig({ devMode: true }, { DSH_HOME: '/tmp/gm-home-2' });
    assert.equal(dev.devMode, true);
    assert.equal(normaliseConfig(null, { DSH_HOME: '/tmp/gm-home-3' }).dataRoot, '/tmp/gm-home-3/storages/dsh-game-market');
    assert.equal(expected.version, '0.1.0');
  });
}
