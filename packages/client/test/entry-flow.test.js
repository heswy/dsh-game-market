/**
 * Game tab entry flow: first selection opens the Market, later selections in
 * the same Session resume the game. (User-requested behaviour, 2026-10-18.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { enterGameSpace } from '../src/entry-flow.js';
import { beginGame } from '../src/actions.js';

const SESSION = 'session-game-tab';
const NOW = 1_800_000_000_000;

function harness(store) {
  const calls = { views: [], markets: 0, starts: [] };
  const run = (sessionId) => enterGameSpace({
    store: store,
    sessionId: sessionId,
    openView: (view) => calls.views.push(view),
    openMarket: () => { calls.markets += 1; },
    startGame: (options) => { calls.starts.push(options); beginGame(store, options); },
  });
  return { calls, run };
}

test('first selection in a Session opens the Market', function () {
  const store = createStore();
  const { calls, run } = harness(store);
  const entry = run(SESSION);
  assert.deepEqual(entry, { kind: 'market' });
  assert.deepEqual(calls.views, ['chat']);
  assert.equal(calls.markets, 1);
  assert.deepEqual(calls.starts, []);
  assert.equal(store.getState().page, 'market');
});

test('after playing and returning to work, the Game tab resumes the game', function () {
  const store = createStore();
  const { calls, run } = harness(store);
  // Play once (any launch path records the per-Session game), then return to work.
  store.dispatch({
    type: 'market-ready',
    items: [{ id: 'snake', installed: true, source: 'builtin' }],
    refreshedAt: NOW,
  });
  store.dispatch({ type: 'runtime-start', gameId: 'snake', mode: 'start', sessionId: SESSION });
  store.dispatch({ type: 'leave-complete' });
  assert.equal(store.getState().page, 'market');

  const entry = run(SESSION);
  assert.deepEqual(entry, { kind: 'resume', gameId: 'snake' });
  assert.deepEqual(calls.starts, [{ gameId: 'snake', mode: 'resume-paused', sessionId: SESSION, autoResume: true }]);
  assert.equal(calls.markets, 1, 'the panel is still selected so the runtime can mount');
  assert.equal(store.getState().page, 'runtime');
  assert.equal(store.getState().runtime.gameId, 'snake');
  assert.equal(store.getState().runtime.mode, 'resume-paused');
});

test('a different Session still starts from the Market', function () {
  const store = createStore();
  store.dispatch({
    type: 'market-ready',
    items: [{ id: 'snake', installed: true, source: 'builtin' }],
    refreshedAt: NOW,
  });
  store.dispatch({ type: 'runtime-start', gameId: 'snake', mode: 'start', sessionId: SESSION });
  store.dispatch({ type: 'leave-complete' });
  const { calls, run } = harness(store);
  assert.deepEqual(run('session-other'), { kind: 'market' });
  assert.deepEqual(calls.starts, []);
});

test('remembers an uninstalled game as stale and opens the Market instead', function () {
  const store = createStore();
  store.dispatch({
    type: 'market-ready',
    items: [{ id: 'jump', installed: false, source: 'registry' }],
    refreshedAt: NOW,
  });
  store.dispatch({ type: 'runtime-start', gameId: 'jump', mode: 'start', sessionId: SESSION });
  store.dispatch({ type: 'leave-complete' });
  const { calls, run } = harness(store);
  const entry = run(SESSION);
  assert.equal(entry.kind, 'market');
  assert.deepEqual(calls.starts, []);
});

test('requires a store', function () {
  assert.throws(() => enterGameSpace({ sessionId: SESSION }), /requires a store/);
});
