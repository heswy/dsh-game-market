import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, createInitialState, reduce, selectGame, selectGameEntry, selectResumableGames } from '../src/store.js';
import { PAGES } from '../src/constants.js';

const SESSION = 'session-A';
const NOW = 1_800_000_000_000;

function snapshot(overrides) {
  return {
    state: 'running',
    label: 'Working...',
    labelKey: 'agent.state.running',
    sessionId: SESSION,
    updatedAt: new Date(NOW).toISOString(),
    source: 'turn',
    seq: 1,
    since: new Date(NOW - 6000).toISOString(),
    turnId: 'turn-1',
    hostEpoch: 'epoch-1',
    ...(overrides || {}),
  };
}

function stateWith(overrides) {
  return createInitialState(overrides);
}

test('initial store state is the Market page with an idle runtime', function () {
  const store = createStore();
  const state = store.getState();
  assert.equal(state.page, PAGES.MARKET);
  assert.equal(state.runtime.state, 'idle');
  assert.equal(state.bindingSessionId, null);
  assert.deepEqual(state.waitEntry, { sessionId: null, turnId: null, ignoredTurnId: null });
});

test('page transitions accept only known pages and notify subscribers once', function () {
  const store = createStore();
  let calls = 0;
  const unsubscribe = store.subscribe(function listener() {
    calls += 1;
  });
  store.dispatch({ type: 'page', page: PAGES.MY_GAMES });
  assert.equal(store.getState().page, PAGES.MY_GAMES);
  assert.equal(calls, 1);
  store.dispatch({ type: 'page', page: 'bogus' });
  assert.equal(store.getState().page, PAGES.MY_GAMES);
  assert.equal(calls, 1);
  unsubscribe();
  store.dispatch({ type: 'page', page: PAGES.RUNTIME });
  assert.equal(calls, 1);
  assert.equal(store.getState().page, PAGES.RUNTIME);
});

test('binding a session resets agent state and rejects invalid ids', function () {
  const store = createStore();
  store.dispatch({ type: 'agent-snapshot', snapshot: snapshot(), fetchedAt: NOW });
  store.dispatch({ type: 'session-bind', sessionId: SESSION });
  assert.equal(store.getState().bindingSessionId, SESSION);
  assert.equal(store.getState().agent, null);
  assert.equal(store.getState().agentFetchedAt, 0);
  store.dispatch({ type: 'session-bind', sessionId: 'bad session id!' });
  assert.equal(store.getState().bindingSessionId, SESSION);
});

test('agent snapshots replace per epoch/seq and refresh 304 timestamps', function () {
  const store = createStore({ bindingSessionId: SESSION });
  store.dispatch({ type: 'agent-snapshot', snapshot: snapshot({ seq: 2 }), fetchedAt: NOW });
  assert.equal(store.getState().agent.seq, 2);
  store.dispatch({ type: 'agent-snapshot', snapshot: snapshot({ seq: 1 }), fetchedAt: NOW + 10 });
  assert.equal(store.getState().agent.seq, 2);
  store.dispatch({ type: 'agent-snapshot', snapshot: snapshot({ seq: 2 }), fetchedAt: NOW + 500 });
  assert.equal(store.getState().agentFetchedAt, NOW + 500);
  store.dispatch({ type: 'agent-snapshot', snapshot: snapshot({ seq: 1, hostEpoch: 'epoch-2' }), fetchedAt: NOW + 900 });
  assert.equal(store.getState().agent.hostEpoch, 'epoch-2');
  assert.equal(store.getState().agent.seq, 1);
});

test('agent snapshots for another session and malformed states are ignored', function () {
  const store = createStore({ bindingSessionId: SESSION });
  store.dispatch({ type: 'agent-snapshot', snapshot: snapshot({ sessionId: 'session-B' }), fetchedAt: NOW });
  assert.equal(store.getState().agent, null);
  store.dispatch({ type: 'agent-snapshot', snapshot: snapshot({ state: 'exploded' }), fetchedAt: NOW });
  assert.equal(store.getState().agent, null);
  store.dispatch({ type: 'agent-snapshot', snapshot: snapshot(), fetchedAt: NOW });
  store.dispatch({ type: 'agent-fresh', fetchedAt: NOW + 1200 });
  assert.equal(store.getState().agentFetchedAt, NOW + 1200);
});

test('poll failures are recorded as codes and a later snapshot clears them', function () {
  const store = createStore({ bindingSessionId: SESSION });
  store.dispatch({ type: 'agent-poll-failed', error: { code: 'GM-5031', retryable: true } });
  assert.equal(store.getState().agentError.code, 'GM-5031');
  store.dispatch({ type: 'agent-snapshot', snapshot: snapshot(), fetchedAt: NOW });
  assert.equal(store.getState().agentError, null);
});

test('paused games are validated and belong to the bound session', function () {
  const store = createStore({ bindingSessionId: SESSION });
  store.dispatch({ type: 'paused-game-record', pausedGame: { gameId: 'snake', reason: 'waiting-user', at: NOW } });
  assert.equal(store.getState().pausedGame.gameId, 'snake');
  assert.equal(store.getState().pausedGame.sessionId, SESSION);
  store.dispatch({ type: 'paused-game-record', pausedGame: { gameId: '', reason: 'leave', at: NOW } });
  assert.equal(store.getState().pausedGame.gameId, 'snake');
  store.dispatch({ type: 'paused-game-clear' });
  assert.equal(store.getState().pausedGame, null);
});

test('turn ignore, completion ack, market cache and runtime transitions', function () {
  const store = createStore({ bindingSessionId: SESSION });
  store.dispatch({ type: 'turn-ignore', turnKey: 'turn-9' });
  assert.equal(store.getState().waitEntry.ignoredTurnId, 'turn-9');
  store.dispatch({ type: 'completed-ack', seq: 4 });
  assert.deepEqual(store.getState().acknowledged, { sessionId: SESSION, seq: 4 });
  store.dispatch({ type: 'market-loading' });
  assert.equal(store.getState().market.status, 'loading');
  store.dispatch({ type: 'market-ready', items: [{ id: 'snake', canContinue: true, installed: true }], refreshedAt: NOW });
  assert.equal(store.getState().market.games.length, 1);
  assert.equal(selectGame(store.getState(), 'snake').id, 'snake');
  assert.equal(selectResumableGames(store.getState()).length, 1);
  store.dispatch({ type: 'runtime-start', gameId: 'snake', mode: 'resume-paused', sessionId: SESSION });
  assert.equal(store.getState().page, PAGES.RUNTIME);
  assert.equal(store.getState().runtime.mode, 'resume-paused');
  assert.equal(store.getState().runtime.bindingSessionId, SESSION);
  store.dispatch({ type: 'runtime-launch-info', launchInfo: { instanceId: 'x' } });
  assert.equal(store.getState().runtime.state, 'loading');
  store.dispatch({ type: 'runtime-patch', patch: { state: 'playing', saveStatus: 'saved', lastSaveAt: NOW } });
  assert.equal(store.getState().runtime.state, 'playing');
  assert.equal(store.getState().runtime.saveStatus, 'saved');
  store.dispatch({ type: 'runtime-failed', error: { code: 'GM-5013' } });
  assert.equal(store.getState().runtime.state, 'error');
  store.dispatch({ type: 'leave-complete' });
  assert.equal(store.getState().page, PAGES.MARKET);
  assert.equal(store.getState().runtime.state, 'idle');
  assert.equal(store.getState().market.status, 'idle');
});

test('reduce is pure: unchanged actions return the same object', function () {
  const state = stateWith();
  assert.equal(reduce(state, { type: 'nope' }), state);
  assert.equal(reduce(state, { type: 'page', page: PAGES.MARKET }), state);
  assert.equal(reduce(state, { type: 'surface', name: 'chip', value: false }), state);
});

test('the Game tab resumes the last game played in the same Session', function () {
  const store = createStore();
  assert.deepEqual(store.getState().sessionGames, {});
  assert.deepEqual(selectGameEntry(store.getState(), SESSION), { kind: 'market' });

  store.dispatch({ type: 'market-ready', items: [{ id: 'snake', installed: true, source: 'builtin' }], refreshedAt: NOW });
  store.dispatch({ type: 'runtime-start', gameId: 'snake', mode: 'start', sessionId: SESSION });
  assert.deepEqual(store.getState().sessionGames[SESSION], { gameId: 'snake' });
  assert.deepEqual(selectGameEntry(store.getState(), SESSION), { kind: 'resume', gameId: 'snake' });

  // Returning to work keeps the per-Session memory.
  store.dispatch({ type: 'leave-complete' });
  assert.equal(store.getState().page, PAGES.MARKET);
  assert.deepEqual(selectGameEntry(store.getState(), SESSION), { kind: 'resume', gameId: 'snake' });

  // A different Session starts from the Market.
  assert.deepEqual(selectGameEntry(store.getState(), 'session-B'), { kind: 'market' });
  assert.deepEqual(selectGameEntry(store.getState(), null), { kind: 'market' });
});

test('the Game tab falls back to the Market when the remembered game is gone', function () {
  const store = createStore({
    sessionGames: { [SESSION]: { gameId: 'jump' } },
    market: { status: 'ready', games: [{ id: 'jump', installed: false, source: 'registry' }] },
  });
  const entry = selectGameEntry(store.getState(), SESSION);
  assert.equal(entry.kind, 'market');
  assert.equal(entry.staleGameId, 'jump');

  // A loaded but empty catalog must not block a resume (runtime still validates).
  store.dispatch({ type: 'market-ready', items: [], refreshedAt: NOW });
  const withEmptyCatalog = createStore({ sessionGames: { [SESSION]: { gameId: 'jump' } } });
  assert.deepEqual(selectGameEntry(withEmptyCatalog.getState(), SESSION), { kind: 'resume', gameId: 'jump' });

  // Local/builtin/dev games are resumable; uninstalled registry games are not.
  store.dispatch({ type: 'market-ready', items: [{ id: 'jump', installed: true, source: 'local' }], refreshedAt: NOW });
  assert.deepEqual(selectGameEntry(store.getState(), SESSION), { kind: 'resume', gameId: 'jump' });
});

test('runtime-start without a Session does not record a Game-tab target', function () {
  const store = createStore();
  store.dispatch({ type: 'runtime-start', gameId: 'snake', mode: 'start', sessionId: null });
  assert.deepEqual(store.getState().sessionGames, {});
  store.dispatch({ type: 'runtime-start', gameId: 'snake', mode: 'start', sessionId: SESSION });
  assert.deepEqual(store.getState().sessionGames[SESSION], { gameId: 'snake' });
});
