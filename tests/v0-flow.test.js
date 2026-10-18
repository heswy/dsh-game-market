/**
 * V0 cross-module contract test: Host API + built-in snake + agent adapter.
 *
 * Boots the Host plugin against a fake DSH context (captured Fetch routes) and
 * walks the same sequence the Client + SDK use in V0:
 *   health → games → launch → entry → save → session → continue → score →
 *   preferences → agent snapshot → dev waiting-user → ack → end session.
 *
 * Requires the host + snake branches to be merged (it is the integration gate).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeCtx, createTempHome, readJson } from './helpers/fake-ctx.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

async function boot() {
  const home = createTempHome();
  const fake = createFakeCtx();
  const { apply } = await import(path.join(root, 'index.js'));
  apply(fake.ctx, {
    devMode: true,
    dataRoot: home.dataRoot,
    builtinGamesRoot: path.join(root, 'games'),
  });
  return { fake, home };
}

async function getJson(fake, url, init) {
  const response = await fake.request(url, init);
  const body = await readJson(response);
  return { response, body };
}

test('V0 flow: snake market, launch, save, continue, score, agent presence', async (t) => {
  const { fake, home } = await boot();
  t.after(() => {
    fake.dispose();
    home.cleanup();
  });

  // 1. health
  {
    const { response, body } = await getJson(fake, '/api/game-market/health');
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(typeof body.data.hostEpoch, 'string');
    assert.equal(body.data.devMode, true);
  }

  // 2. games + installed
  {
    const { body } = await getJson(fake, '/api/game-market/games');
    assert.equal(body.ok, true);
    const snake = body.data.items.find((item) => item.id === 'snake');
    assert.ok(snake, 'builtin snake must be listed');
    assert.equal(snake.name, 'Snake');
    assert.equal(snake.builtin, true);
    assert.equal(snake.installed, true);
    assert.equal(snake.canContinue, false);

    const installed = await getJson(fake, '/api/game-market/installed');
    assert.ok(installed.body.data.items.some((item) => item.id === 'snake'));
  }

  // 3. launch returns a sandbox entry URL with instance + nonce
  const launch = await getJson(fake, '/api/game-market/launch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId: 'snake', mode: 'start' }),
  });
  assert.equal(launch.body.ok, true);
  const info = launch.body.data;
  assert.match(info.instanceId, /^[a-f0-9]{32}$/);
  assert.match(info.nonce, /^[a-f0-9]{32}$/);
  assert.match(info.entryUrl, /^\/api\/game-market\/entry\?/);
  assert.equal(info.viewport.width, 960);
  assert.equal(info.viewport.height, 540);
  assert.ok(info.limits.saveBytes > 0);

  // 4. entry HTML is served with sandbox-friendly headers and is self-contained
  {
    const response = await fake.request(info.entryUrl);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    const csp = response.headers.get('content-security-policy') || '';
    assert.match(csp, /connect-src 'none'/);
    assert.match(csp, /script-src 'unsafe-inline'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const html = await response.text();
    assert.match(html, /<canvas/i);
    assert.doesNotMatch(html, /<script[^>]+src=/i);
  }

  // 5. no save yet
  {
    const { response, body } = await getJson(fake, '/api/game-market/save?gameId=snake');
    assert.equal(response.status, 404);
    assert.equal(body.error.code, 'GM-4041');
  }

  // 6. start session, write save, Continue becomes true
  const started = await getJson(fake, '/api/game-market/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameId: 'snake', action: 'start', dshSessionId: 'ses_test', operationId: 'op_start_1' }),
  });
  assert.equal(started.body.ok, true);
  const playSessionId = started.body.data.playSessionId;
  assert.match(playSessionId, /^ps_[a-z0-9]+$/);

  const saved = await getJson(fake, '/api/game-market/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gameId: 'snake',
      key: 'current',
      data: { snake: [[5, 5]], score: 10 },
      operationId: 'op_save_1',
    }),
  });
  assert.equal(saved.body.ok, true);
  assert.ok(saved.body.data.revision >= 1);

  {
    const { body } = await getJson(fake, '/api/game-market/installed');
    const snake = body.data.items.find((item) => item.id === 'snake');
    assert.equal(snake.canContinue, true);
  }

  // 7. save conflict + prototype-pollution guard
  {
    const conflict = await getJson(fake, '/api/game-market/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        gameId: 'snake',
        key: 'current',
        data: { score: 11 },
        expectedRevision: 0,
        operationId: 'op_save_conflict',
      }),
    });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.body.error.code, 'GM-4092');

    const polluted = JSON.parse('{"gameId":"snake","key":"current","data":{"__proto__":{"x":1}},"operationId":"op_save_proto"}');
    const proto = await getJson(fake, '/api/game-market/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(polluted),
    });
    assert.ok(proto.response.status >= 400 && proto.response.status < 500);
  }

  // 8. score submit + read
  {
    const submitted = await getJson(fake, '/api/game-market/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'snake', score: 42, playSessionId, operationId: 'op_score_1' }),
    });
    assert.equal(submitted.body.ok, true);
    assert.equal(submitted.body.data.best, 42);
    const scores = await getJson(fake, '/api/game-market/scores?gameId=snake');
    assert.equal(scores.body.data.best.value, 42);
    assert.ok(scores.body.data.history.some((entry) => entry.value === 42));
  }

  // 9. preferences round-trip
  {
    const defaults = await getJson(fake, '/api/game-market/preferences');
    assert.equal(defaults.body.ok, true);
    const patched = await getJson(fake, '/api/game-market/preferences', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lastPlayedGameId: 'snake', notifySoundEnabled: false }),
    });
    assert.equal(patched.body.data.lastPlayedGameId, 'snake');
    assert.equal(patched.body.data.notifySoundEnabled, false);
  }

  // 10. agent snapshot: idle -> dev waiting-user -> ack -> idle
  {
    const idle = await getJson(fake, '/api/game-market/agent-state?sessionId=ses_test');
    assert.equal(idle.body.data.state, 'idle');

    const waiting = await getJson(fake, '/api/game-market/dev/agent-state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'ses_test', state: 'waiting-user', turnId: 'turn_1' }),
    });
    assert.equal(waiting.body.ok, true);
    assert.equal(waiting.body.data.state, 'waiting-user');

    const ackBody = { sessionId: 'ses_test', seq: waiting.body.data.seq };
    const acked = await getJson(fake, '/api/game-market/agent-ack', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ackBody),
    });
    assert.equal(acked.body.data.state, 'idle');
  }

  // 11. end session -> Continue false
  {
    const ended = await getJson(fake, '/api/game-market/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'snake', action: 'end', playSessionId, outcome: 'completed', score: 42, operationId: 'op_end_1' }),
    });
    assert.equal(ended.body.ok, true);
    const { body } = await getJson(fake, '/api/game-market/installed');
    const snake = body.data.items.find((item) => item.id === 'snake');
    assert.equal(snake.canContinue, false);
  }

  // 12. unknown game is a clean 404
  {
    const { response, body } = await getJson(fake, '/api/game-market/game?id=missing');
    assert.equal(response.status, 404);
    assert.equal(body.ok, false);
  }
});
