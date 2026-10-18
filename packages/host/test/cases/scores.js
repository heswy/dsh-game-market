import assert from 'node:assert/strict';
import test from 'node:test';

import { ROUTES } from '../../../shared/src/contracts.js';
import { GM } from '../../../shared/src/errors.js';
import { createHarness, makeGameRoot } from '../support/harness.js';

function assertErrorEnvelope(payload, code) {
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, code);
}

async function submit(host, body) {
  return host.data(ROUTES.SCORE, { body: { gameId: 'snake', ...body } });
}

export function register() {
  test('GET /scores returns empty state before any submission', async (t) => {
    const host = await createHarness(t);
    const scores = await host.data(ROUTES.SCORES, { query: { gameId: 'snake' } });
    assert.equal(scores.best, null);
    assert.deepEqual(scores.history, []);
    assert.equal(scores.direction, 'higher-better');
  });

  test('best/history follow higher-better semantics and ties keep the earlier entry', async (t) => {
    const host = await createHarness(t);
    const first = await submit(host, { score: 100, playSessionId: 'ps_aaaaaaaaaaaaaaaaaaaaaaaa' });
    assert.equal(first.best.value, 100);
    assert.equal(first.isBest, true);
    assert.ok(!Number.isNaN(Date.parse(first.submittedAt)));
    assert.equal(first.best.achievedAt, first.submittedAt);
    assert.equal(first.best.playSessionId, 'ps_aaaaaaaaaaaaaaaaaaaaaaaa');

    const second = await submit(host, { score: 50, meta: { level: 2 } });
    assert.equal(second.isBest, false);
    assert.equal(second.best.value, 100);
    assert.equal(second.best.achievedAt, first.best.achievedAt);

    const tie = await submit(host, { score: 100 });
    assert.equal(tie.isBest, false);
    assert.equal(tie.best.achievedAt, first.best.achievedAt);

    const scores = await host.data(ROUTES.SCORES, { query: { gameId: 'snake' } });
    assert.equal(scores.best.value, 100);
    assert.equal(scores.history.length, 3);
    assert.deepEqual(
      scores.history.map((entry) => entry.value),
      [100, 50, 100]
    );
    assert.ok(scores.history.every((entry) => typeof entry.achievedAt === 'string'));
    assert.deepEqual(scores.history[1].meta, { level: 2 });

    const file = await host.readDataJson('scores', 'snake.json');
    assert.equal(file.schemaVersion, 1);
    assert.equal(file.gameId, 'snake');
    assert.equal(file.direction, 'higher-better');
    assert.equal(file.best.value, 100);
    assert.equal(file.submitCount, 3);
    assert.equal(file.history.length, 3);
  });

  test('manifest score range, integer and type validation map to GM-4006/GM-4002', async (t) => {
    const host = await createHarness(t);
    for (const score of [-1, 1000001]) {
      const { response, payload } = await host.requestJson(ROUTES.SCORE, {
        body: { gameId: 'snake', score },
      });
      assert.equal(response.status, 400);
      assertErrorEnvelope(payload, GM.SCORE_OUT_OF_RANGE);
    }
    const fractional = await host.requestJson(ROUTES.SCORE, {
      body: { gameId: 'snake', score: 1.5 },
    });
    assert.equal(fractional.response.status, 400);
    assertErrorEnvelope(fractional.payload, GM.SCORE_OUT_OF_RANGE);
    const notNumber = await host.requestJson(ROUTES.SCORE, {
      body: { gameId: 'snake', score: '10' },
    });
    assert.equal(notNumber.response.status, 400);
    assertErrorEnvelope(notNumber.payload, GM.INVALID_PARAM);
    assert.equal((await host.requestJson(ROUTES.SCORES)).response.status, 400);
    const unknown = await host.requestJson(ROUTES.SCORES, { query: { gameId: 'unknown-game' } });
    assert.equal(unknown.response.status, 404);
    assertErrorEnvelope(unknown.payload, GM.GAME_NOT_FOUND);
  });

  test('meta is size-limited and duplicate operationId is idempotent', async (t) => {
    const host = await createHarness(t);
    const largeMeta = await host.requestJson(ROUTES.SCORE, {
      body: { gameId: 'snake', score: 1, meta: { blob: 'z'.repeat(2048) } },
    });
    assert.equal(largeMeta.response.status, 413);
    assertErrorEnvelope(largeMeta.payload, GM.SAVE_TOO_LARGE);

    const first = await submit(host, { score: 10, operationId: 'op-score-1' });
    const second = await submit(host, { score: 999, operationId: 'op-score-1' });
    assert.deepEqual(second, first);
    const file = await host.readDataJson('scores', 'snake.json');
    assert.equal(file.submitCount, 1);
    assert.equal(file.best.value, 10);
  });

  test('concurrent duplicate operationIds resolve once', async (t) => {
    const host = await createHarness(t);
    const [first, second] = await Promise.all([
      submit(host, { score: 10, operationId: 'op-concurrent' }),
      submit(host, { score: 999, operationId: 'op-concurrent' }),
    ]);
    assert.deepEqual(first, second);
    const file = await host.readDataJson('scores', 'snake.json');
    assert.equal(file.submitCount, 1);
    assert.equal(file.best.value, 10);
  });

  test('lower-better direction from the manifest is honoured', async (t) => {
    const root = await makeGameRoot(t, {
      overrides: (manifest) => ({
        ...manifest,
        score: { direction: 'lower-better', min: 0, max: 1000000, integer: true },
      }),
    });
    const host = await createHarness(t, { fixtureRoot: root });
    const scores = await host.data(ROUTES.SCORES, { query: { gameId: 'snake' } });
    assert.equal(scores.direction, 'lower-better');
    const first = await submit(host, { score: 100 });
    assert.equal(first.best.value, 100);
    assert.equal(first.isBest, true);
    const second = await submit(host, { score: 50 });
    assert.equal(second.isBest, true);
    assert.equal(second.best.value, 50);
    const higher = await submit(host, { score: 80 });
    assert.equal(higher.isBest, false);
    assert.equal(higher.best.value, 50);
  });

  test('history is capped at 200 while best is never evicted', async (t) => {
    const host = await createHarness(t);
    const top = await submit(host, { score: 1000000 });
    for (let index = 0; index < 205; index += 1) {
      await submit(host, { score: index });
    }
    const scores = await host.data(ROUTES.SCORES, { query: { gameId: 'snake' } });
    assert.equal(scores.best.value, 1000000);
    assert.equal(scores.best.achievedAt, top.best.achievedAt);
    assert.equal(scores.history.length, 200);
    assert.equal(scores.history[0].value, 204);
    assert.equal(scores.history[199].value, 5);
    const file = await host.readDataJson('scores', 'snake.json');
    assert.equal(file.submitCount, 206);
    assert.equal(file.best.value, 1000000);
  });
}
