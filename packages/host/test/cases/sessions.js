import assert from 'node:assert/strict';
import test from 'node:test';

import { ROUTES } from '../../../shared/src/contracts.js';
import { GM } from '../../../shared/src/errors.js';
import { createHarness } from '../support/harness.js';

function assertErrorEnvelope(payload, code) {
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, code);
}

async function start(host, extra = {}) {
  return host.data(ROUTES.SESSION, {
    body: { gameId: 'snake', action: 'start', dshSessionId: 'session-test', ...extra },
  });
}

async function end(host, playSessionId, outcome = 'completed', extra = {}) {
  return host.data(ROUTES.SESSION, {
    body: {
      gameId: 'snake',
      action: 'end',
      playSessionId,
      outcome,
      score: 42,
      ...extra,
    },
  });
}

export function register() {
  test('session start is idempotent and end closes exactly once', async (t) => {
    const host = await createHarness(t);
    const first = await start(host);
    assert.match(first.playSessionId, /^ps_[a-f0-9]{24}$/);
    assert.ok(!Number.isNaN(Date.parse(first.startedAt)));
    assert.equal(first.adopted, false);

    const second = await start(host, { dshSessionId: 'session-other' });
    assert.equal(second.playSessionId, first.playSessionId);
    assert.equal(second.startedAt, first.startedAt);
    assert.equal(second.adopted, true);

    const ended = await end(host, first.playSessionId);
    assert.equal(ended.playSessionId, first.playSessionId);
    assert.equal(ended.outcome, 'completed');
    assert.equal(ended.score, 42);
    assert.equal(ended.ignored, false);
    assert.ok(!Number.isNaN(Date.parse(ended.endedAt)));
    assert.ok(Date.parse(ended.endedAt) >= Date.parse(ended.startedAt));

    const again = await end(host, first.playSessionId, 'lost', { score: 1 });
    assert.equal(again.ignored, true);
    assert.equal(again.outcome, 'completed');
    assert.equal(again.endedAt, ended.endedAt);
    assert.equal(again.score, 42);

    const file = await host.readDataJson('sessions', 'snake.json');
    assert.equal(file.schemaVersion, 1);
    assert.equal(file.gameId, 'snake');
    assert.equal(file.records.length, 1);
    assert.equal(file.records[0].playSessionId, first.playSessionId);
    assert.equal(file.records[0].dshSessionId, 'session-test');
    assert.equal(file.records[0].outcome, 'completed');
    assert.equal(file.records[0].score, 42);
    assert.equal(file.records[0].endedAt, ended.endedAt);
    assert.ok(file.records[0].durationMs >= 0);
  });

  test('concurrent starts adopt a single running session', async (t) => {
    const host = await createHarness(t);
    const [first, second] = await Promise.all([start(host), start(host)]);
    assert.equal(first.playSessionId, second.playSessionId);
    assert.deepEqual([first.adopted, second.adopted].sort(), [false, true]);
    const file = await host.readDataJson('sessions', 'snake.json');
    assert.equal(file.records.length, 1);
    assert.equal(file.records[0].outcome, 'running');
  });

  test('session end validates outcome/playSessionId and unknown sessions', async (t) => {
    const host = await createHarness(t);
    const started = await start(host);
    const badOutcome = await host.requestJson(ROUTES.SESSION, {
      body: {
        gameId: 'snake',
        action: 'end',
        playSessionId: started.playSessionId,
        outcome: 'crashed',
      },
    });
    assert.equal(badOutcome.response.status, 400);
    assertErrorEnvelope(badOutcome.payload, GM.INVALID_PARAM);
    const badId = await host.requestJson(ROUTES.SESSION, {
      body: { gameId: 'snake', action: 'end', playSessionId: 'nope', outcome: 'completed' },
    });
    assert.equal(badId.response.status, 400);
    assertErrorEnvelope(badId.payload, GM.INVALID_PARAM);
    const unknownId = await host.requestJson(ROUTES.SESSION, {
      body: {
        gameId: 'snake',
        action: 'end',
        playSessionId: 'ps_aaaaaaaaaaaaaaaaaaaaaaaa',
        outcome: 'completed',
      },
    });
    assert.equal(unknownId.response.status, 409);
    assertErrorEnvelope(unknownId.payload, GM.SESSION_STATE_CONFLICT);
    const badAction = await host.requestJson(ROUTES.SESSION, {
      body: { gameId: 'snake', action: 'pause' },
    });
    assert.equal(badAction.response.status, 400);
    assertErrorEnvelope(badAction.payload, GM.INVALID_PARAM);
    const unknownGame = await host.requestJson(ROUTES.SESSION, {
      body: { gameId: 'unknown-game', action: 'start' },
    });
    assert.equal(unknownGame.response.status, 404);
    assertErrorEnvelope(unknownGame.payload, GM.GAME_NOT_FOUND);
    const badSession = await host.requestJson(ROUTES.SESSION, {
      body: { gameId: 'snake', action: 'start', dshSessionId: 'has space' },
    });
    assert.equal(badSession.response.status, 400);
    assertErrorEnvelope(badSession.payload, GM.INVALID_PARAM);
  });

  test('health reports preserved running sessions', async (t) => {
    const host = await createHarness(t);
    const started = await start(host);
    const withSession = await host.data(ROUTES.HEALTH);
    assert.equal(withSession.sessions.running, 1);
    await end(host, started.playSessionId);
    const afterEnd = await host.data(ROUTES.HEALTH);
    assert.equal(afterEnd.sessions.running, 0);
  });

  test('session records are capped at 100, newest first', async (t) => {
    const host = await createHarness(t);
    for (let index = 0; index < 105; index += 1) {
      const started = await start(host, { operationId: `op-start-${index}` });
      await end(host, started.playSessionId, 'completed', {
        score: index,
        operationId: `op-end-${index}`,
      });
    }
    const file = await host.readDataJson('sessions', 'snake.json');
    assert.equal(file.records.length, 100);
    assert.equal(file.records[0].score, 104);
    assert.equal(file.records[99].score, 5);
    for (let index = 1; index < file.records.length; index += 1) {
      assert.ok(
        Date.parse(file.records[index - 1].startedAt) >= Date.parse(file.records[index].startedAt)
      );
    }
    const health = await host.data(ROUTES.HEALTH);
    assert.equal(health.sessions.running, 0);
  });

  test('a running session survives a new Host instance (V0 keeps running)', async (t) => {
    const host = await createHarness(t);
    const started = await start(host);
    // Simulate a Host restart by constructing a second host over the same root.
    const { createHost } = await import('../../src/host.js');
    const restarted = createHost({
      config: { builtinGamesRoot: host.fixtureRoot, dataRoot: host.dataRoot },
    });
    t.after(() => restarted.storage.flush());
    const running = await restarted.services.sessions.findRunning('snake');
    assert.equal(running.playSessionId, started.playSessionId);
    assert.equal(running.outcome, 'running');
    const health = await restarted.services.health.snapshot();
    assert.equal(health.sessions.running, 1);
    assert.equal(health.sessions.staleRunningPreserved, true);
  });
}
