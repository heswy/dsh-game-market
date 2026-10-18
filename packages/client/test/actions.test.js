import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { PAGES } from '../src/constants.js';
import {
  acknowledgeCompleted,
  beginGame,
  finishLeave,
  launchModeFor,
  recordPausedGame,
  refreshMarket,
} from '../src/actions.js';
import { selectCurrentSessionId, selectSessionStatus, summarizeSessionStatus } from '../src/binding.js';
import { formatCategory, formatRelativeTime, formatScore } from '../src/format.js';

const SESSION = 'session-A';

function sessionsState(rows) {
  const byId = {};
  const ids = [];
  for (const row of rows) {
    ids.push(row.id);
    byId[row.id] = row;
  }
  return { ids: ids, byId: byId };
}

test('current session prefers a non-blank mainView retention', function () {
  const snapshot = sessionsState([
    { id: 'other', retainedBy: { mainView: 0 }, blank: false },
    { id: 'blank', retainedBy: { mainView: 1 }, blank: true },
    { id: SESSION, retainedBy: { mainView: 2 }, blank: false },
  ]);
  assert.equal(selectCurrentSessionId(snapshot), SESSION);
  assert.equal(
    selectCurrentSessionId(sessionsState([{ id: 'blank', retainedBy: { mainView: 1 }, blank: true }])),
    'blank'
  );
  assert.equal(selectCurrentSessionId(sessionsState([{ id: 'x', retainedBy: {}, blank: false }])), null);
  assert.equal(selectCurrentSessionId(null), null);
});

test('session status selectors tolerate missing entries', function () {
  const map = new Map([[SESSION, { running: true, pendingInteraction: { kind: 'approval' }, completionUnread: true }]]);
  assert.deepEqual(selectSessionStatus(map, SESSION), {
    running: true,
    pendingInteraction: { kind: 'approval' },
    completionUnread: true,
  });
  assert.equal(selectSessionStatus(map, 'other'), null);
  assert.deepEqual(summarizeSessionStatus(null), { running: false, pendingInteraction: null, completionUnread: false });
});

test('refreshMarket stores items and preserves cached items on failure', async function () {
  const store = createStore();
  const api = {
    listGames: async function listGames() {
      return { items: [{ id: 'snake', name: 'Snake', installed: true, canContinue: true }], refreshedAt: 42 };
    },
  };
  const result = await refreshMarket({ store: store, api: api, now: 100 });
  assert.equal(result.ok, true);
  assert.equal(store.getState().market.status, 'ready');
  assert.equal(store.getState().market.games.length, 1);
  assert.equal(store.getState().market.refreshedAt, 100);

  const failingApi = {
    listGames: async function listGames() {
      const error = new Error('offline');
      error.code = 'GM-5031';
      error.retryable = true;
      throw error;
    },
  };
  const failed = await refreshMarket({ store: store, api: failingApi, now: 200 });
  assert.equal(failed.ok, false);
  assert.equal(store.getState().market.status, 'error');
  assert.equal(store.getState().market.error.code, 'GM-5031');
  assert.equal(store.getState().market.games.length, 1);

  const missing = await refreshMarket({ store: createStore(), api: null, now: 300 });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'GM-5031');
});

test('beginGame captures the current session as a sticky runtime binding', function () {
  const store = createStore({ bindingSessionId: SESSION });
  assert.equal(beginGame(store, { gameId: 'snake', mode: 'resume-paused' }), true);
  const state = store.getState();
  assert.equal(state.page, PAGES.RUNTIME);
  assert.equal(state.runtime.gameId, 'snake');
  assert.equal(state.runtime.mode, 'resume-paused');
  assert.equal(state.runtime.bindingSessionId, SESSION);
  assert.equal(state.runtime.state, 'launching');
  assert.equal(beginGame(store, { gameId: '' }), false);
  assert.equal(launchModeFor({ canContinue: true }), 'resume-paused');
  assert.equal(launchModeFor({ canContinue: false }), 'start');
});

test('paused game records and leave transitions keep the resume window data', function () {
  const store = createStore({ bindingSessionId: SESSION });
  beginGame(store, { gameId: 'snake', mode: 'start' });
  const paused = recordPausedGame(store, {
    gameId: 'snake',
    reason: 'waiting-user',
    at: 1234,
    saveStale: false,
  });
  assert.equal(paused.sessionId, SESSION);
  assert.equal(store.getState().pausedGame.reason, 'waiting-user');
  finishLeave(store, {});
  assert.equal(store.getState().page, PAGES.MARKET);
  assert.equal(store.getState().runtime.state, 'idle');
  assert.equal(store.getState().pausedGame.gameId, 'snake');
});

test('acknowledgeCompleted clears locally even if the Host ack fails', async function () {
  const store = createStore({ bindingSessionId: SESSION });
  let called = null;
  const api = {
    ackAgent: async function ackAgent(input) {
      called = input;
      return { ok: true };
    },
  };
  assert.equal(await acknowledgeCompleted({ store: store, api: api, sessionId: SESSION, seq: 5 }), true);
  assert.deepEqual(called, { sessionId: SESSION, seq: 5 });
  assert.deepEqual(store.getState().acknowledged, { sessionId: SESSION, seq: 5 });

  const failingApi = {
    ackAgent: async function ackAgent() {
      throw new Error('offline');
    },
  };
  const storeTwo = createStore({ bindingSessionId: SESSION });
  assert.equal(await acknowledgeCompleted({ store: storeTwo, api: failingApi, sessionId: SESSION, seq: 6 }), false);
  assert.deepEqual(storeTwo.getState().acknowledged, { sessionId: SESSION, seq: 6 });
});

test('formatting helpers degrade safely', function () {
  assert.equal(formatScore(12345, 'en'), '12,345');
  assert.equal(formatScore(undefined, 'en'), '');
  assert.equal(formatCategory(['arcade']), 'Arcade');
  assert.equal(formatCategory([]), '');
  assert.equal(formatRelativeTime('not-a-date', Date.now(), 'en'), '');
  assert.ok(formatRelativeTime(new Date(Date.now() - 3600_000).toISOString(), Date.now(), 'en').length > 0);
});
