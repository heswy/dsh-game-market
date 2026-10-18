import assert from 'node:assert/strict';
import test from 'node:test';

import { ROUTES } from '../../../shared/src/contracts.js';
import { GM } from '../../../shared/src/errors.js';
import {
  BROKEN_FIXTURE_ROOT,
  createHarness,
  expected,
  FIXTURE_ROOT,
} from '../support/harness.js';

function assertErrorEnvelope(payload, code) {
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, code);
}

function assertSnakeRecord(item, { installed = true } = {}) {
  assert.equal(item.id, 'snake');
  assert.equal(item.name, 'Snake');
  assert.equal(item.version, '0.1.0');
  assert.equal(item.description, 'A tiny built-in snake used by host tests.');
  assert.deepEqual(item.author, { name: 'DSH' });
  assert.deepEqual(item.categories, ['arcade']);
  assert.deepEqual(item.capabilities, ['storage', 'score']);
  assert.equal(item.builtin, true);
  assert.equal(item.installed, installed);
  assert.deepEqual(item.viewport, expected.viewport);
  assert.equal(item.canContinue, false);
  assert.equal(item.bestScore, null);
  assert.equal(item.lastPlayedAt, null);
}

export function register() {
  test('GET /games returns built-in GameRecords from game.json', async (t) => {
    const host = await createHarness(t);
    const { response, payload } = await host.requestJson(ROUTES.GAMES);
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.data.source, 'builtin');
    assert.equal(payload.data.nextCursor, null);
    assert.ok(!Number.isNaN(Date.parse(payload.data.refreshedAt)));
    assert.equal(payload.data.items.length, 1);
    assertSnakeRecord(payload.data.items[0]);
    assert.equal(payload.data.items[0].entryAvailable, true);
    assert.equal(payload.data.items[0].issue, null);
  });

  test('GET /installed and GET /game expose the same record + active session', async (t) => {
    const host = await createHarness(t);
    const installed = await host.data(ROUTES.INSTALLED);
    assert.equal(installed.items.length, 1);
    assertSnakeRecord(installed.items[0]);
    const game = await host.data(ROUTES.GAME, { query: { id: 'snake' } });
    // V1 `/game` returns a GameDetail under `game` plus a flat legacy record.
    assertSnakeRecord(game.game);
    assert.equal(game.game.activePlaySession, null);
    assert.equal(game.installed, null);
    assert.equal(game.registry, null);
    const started = await host.data(ROUTES.SESSION, {
      body: { gameId: 'snake', action: 'start', dshSessionId: 'session-1', operationId: 'op-start' },
    });
    const active = await host.data(ROUTES.GAME, { query: { id: 'snake' } });
    assert.deepEqual(active.activePlaySession, {
      playSessionId: started.playSessionId,
      startedAt: started.startedAt,
    });
  });

  test('games list supports q/category filters and validates ids', async (t) => {
    const host = await createHarness(t);
    assert.equal((await host.data(ROUTES.GAMES, { query: { q: 'snake' } })).items.length, 1);
    assert.equal((await host.data(ROUTES.GAMES, { query: { q: 'zzz' } })).items.length, 0);
    assert.equal((await host.data(ROUTES.GAMES, { query: { category: 'arcade' } })).items.length, 1);
    assert.equal((await host.data(ROUTES.GAMES, { query: { category: 'puzzle' } })).items.length, 0);
    assert.equal((await host.data(ROUTES.GAMES, { query: { limit: '1' } })).items.length, 1);
    const badLimit = await host.requestJson(ROUTES.GAMES, { query: { limit: '0' } });
    assert.equal(badLimit.response.status, 400);
    assertErrorEnvelope(badLimit.payload, GM.INVALID_PARAM);

    const badId = await host.requestJson(ROUTES.GAME, { query: { id: 'Bad_ID' } });
    assert.equal(badId.response.status, 400);
    assertErrorEnvelope(badId.payload, GM.BAD_GAME_ID);
    const unknown = await host.requestJson(ROUTES.GAME, { query: { id: 'unknown-game' } });
    assert.equal(unknown.response.status, 404);
    assertErrorEnvelope(unknown.payload, GM.GAME_NOT_FOUND);
  });

  test('missing dist is reported by installed/health while manifest fields still come from game.json', async (t) => {
    const host = await createHarness(t, { fixtureRoot: BROKEN_FIXTURE_ROOT });
    const installed = await host.data(ROUTES.INSTALLED);
    assert.equal(installed.items.length, 1);
    const item = installed.items[0];
    assert.equal(item.id, 'snake');
    assert.equal(item.name, 'Snake');
    assert.equal(item.version, '0.1.0');
    assert.equal(item.installed, true);
    assert.equal(item.entryAvailable, false);
    assert.equal(item.issue, 'entry-missing');
    const game = await host.requestJson(ROUTES.GAME, { query: { id: 'snake' } });
    assert.equal(game.response.status, 200);
    assert.equal(game.payload.data.issue, 'entry-missing');
    assert.equal(game.payload.data.game.issue, 'entry-missing');
  });

  test('preview serves only manifest-declared files', async (t) => {
    const host = await createHarness(t);
    const preview = await host.request(ROUTES.PREVIEW, {
      query: { gameId: 'snake', file: 'preview/icon.png' },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('content-type'), 'image/png');
    assert.equal(preview.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(preview.headers.get('x-content-type-options'), 'nosniff');
    const bytes = new Uint8Array(await preview.arrayBuffer());
    assert.ok(bytes.length > 8);
    assert.deepEqual([...bytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const undeclared = await host.requestJson(ROUTES.PREVIEW, {
      query: { gameId: 'snake', file: 'dist/index.html' },
    });
    assert.equal(undeclared.response.status, 404);
    assertErrorEnvelope(undeclared.payload, GM.ASSET_NOT_FOUND);
    const traversal = await host.requestJson(ROUTES.PREVIEW, {
      query: { gameId: 'snake', file: '../snake/game.json' },
    });
    assert.equal(traversal.response.status, 404);
    assertErrorEnvelope(traversal.payload, GM.ASSET_NOT_FOUND);
    assert.equal(FIXTURE_ROOT.endsWith('fixtures/games'), true);
  });

  test('GameRecord projection reflects save/session/score state', async (t) => {
    const host = await createHarness(t);
    await host.data(ROUTES.SAVE, {
      body: { gameId: 'snake', key: 'current', data: { score: 7 } },
    });
    const started = await host.data(ROUTES.SESSION, {
      body: { gameId: 'snake', action: 'start', dshSessionId: 'session-42' },
    });
    await host.data(ROUTES.SCORE, { body: { gameId: 'snake', score: 42 } });
    const installed = await host.data(ROUTES.INSTALLED);
    const item = installed.items[0];
    assert.equal(item.canContinue, true);
    assert.equal(item.bestScore, 42);
    assert.equal(typeof item.lastPlayedAt, 'string');
    assert.ok(!Number.isNaN(Date.parse(item.lastPlayedAt)));
    assert.ok(started.playSessionId.startsWith('ps_'));
    await host.data(ROUTES.SESSION, {
      body: {
        gameId: 'snake',
        action: 'end',
        playSessionId: started.playSessionId,
        outcome: 'completed',
        score: 42,
      },
    });
    const afterEnd = await host.data(ROUTES.INSTALLED);
    assert.equal(afterEnd.items[0].canContinue, false);
  });
}
