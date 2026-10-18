import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, createInitialState } from '../src/store.js';
import {
  createAgentPoller,
  nextBackoffMs,
  pollingSessionId,
  shouldPollAgent,
} from '../src/agent-polling.js';
import { TIMING } from '../../shared/src/constants.js';

const NOW = 1_800_000_000_000;
const SESSION = 'session-A';

function createScheduler() {
  const tasks = [];
  let clock = NOW;
  return {
    tasks: tasks,
    now: function now() {
      return clock;
    },
    setClock: function setClock(next) {
      clock = next;
    },
    setTimeout: function setTimeoutFake(callback, delay) {
      const task = { callback: callback, delay: delay, cleared: false };
      tasks.push(task);
      return tasks.length;
    },
    clearTimeout: function clearTimeoutFake(id) {
      const task = tasks[id - 1];
      if (task) task.cleared = true;
    },
  };
}

function state(overrides) {
  return createInitialState({
    bindingSessionId: SESSION,
    surface: { chip: true, runtime: false, activePanelId: null },
    ...(overrides || {}),
  });
}

test('polling requires visibility and a bound session', function () {
  assert.equal(shouldPollAgent(state(), 'visible'), true);
  assert.equal(shouldPollAgent(state(), 'hidden'), false);
  assert.equal(shouldPollAgent(state({ bindingSessionId: null }), 'visible'), false);
  assert.equal(shouldPollAgent(state({ surface: { chip: false } }), 'visible'), true);
  assert.equal(
    shouldPollAgent(state({ page: 'runtime', surface: { runtime: true } }), 'visible'),
    true
  );
  assert.equal(
    shouldPollAgent(state({ page: 'market', surface: { runtime: true } }), 'visible'),
    true
  );
});

test('the game runtime polls its sticky bound session, not a newly selected one', function () {
  const runtimeState = state({
    page: 'runtime',
    bindingSessionId: 'session-B',
    runtime: { bindingSessionId: SESSION },
    surface: { runtime: true },
  });
  assert.equal(pollingSessionId(runtimeState), SESSION);
  assert.equal(pollingSessionId(state()), SESSION);
});

test('backoff doubles to the shared cap', function () {
  assert.equal(nextBackoffMs(0), TIMING.agentPollMs);
  assert.equal(nextBackoffMs(1), TIMING.agentPollMs);
  assert.equal(nextBackoffMs(2), TIMING.agentPollMs * 2);
  assert.equal(nextBackoffMs(3), TIMING.agentPollMs * 4);
  assert.equal(nextBackoffMs(4), TIMING.pollBackoffMaxMs);
  assert.equal(nextBackoffMs(10), TIMING.pollBackoffMaxMs);
});

test('poller fetches a snapshot, honours ETag/304, and schedules the next tick', async function () {
  const store = createStore();
  store.dispatch({ type: 'session-bind', sessionId: SESSION });
  store.dispatch({ type: 'surface', name: 'chip', value: true });
  const scheduler = createScheduler();
  const calls = [];
  const api = {
    getAgentState: async function getAgentState(sessionId, options) {
      calls.push([sessionId, options]);
      if (calls.length === 1) {
        return {
          snapshot: {
            state: 'running',
            sessionId: SESSION,
            hostEpoch: 'epoch-1',
            seq: 1,
            since: new Date(NOW - 6000).toISOString(),
            turnId: 'turn-1',
            labelKey: 'agent.state.running',
            source: 'turn',
            updatedAt: new Date(NOW).toISOString(),
          },
          etag: 'W/"epoch-1:1"',
          notModified: false,
        };
      }
      return { snapshot: null, etag: 'W/"epoch-1:1"', notModified: true };
    },
  };
  const poller = createAgentPoller({
    store: store,
    getApi: function getApi() {
      return api;
    },
    scheduler: scheduler,
  });
  poller.start();
  assert.equal(scheduler.tasks[0].delay, 0);
  await poller.tickNow();
  assert.equal(calls[0][0], SESSION);
  assert.equal(calls[0][1], undefined);
  assert.equal(store.getState().agent.seq, 1);
  assert.equal(store.getState().agentFetchedAt, NOW);
  assert.equal(scheduler.tasks[0].cleared, true);
  assert.equal(scheduler.tasks[scheduler.tasks.length - 1].delay, TIMING.agentPollMs);

  scheduler.setClock(NOW + 1000);
  await poller.tickNow();
  assert.deepEqual(calls[1][1], { etag: 'W/"epoch-1:1"' });
  assert.equal(store.getState().agentFetchedAt, NOW + 1000);
  assert.equal(store.getState().agent.seq, 1);
  poller.stop();
});

test('poller backs off after failures and stops scheduling while hidden', async function () {
  const store = createStore();
  store.dispatch({ type: 'session-bind', sessionId: SESSION });
  store.dispatch({ type: 'surface', name: 'chip', value: true });
  const scheduler = createScheduler();
  const api = {
    getAgentState: async function failing() {
      throw new Error('offline');
    },
  };
  const poller = createAgentPoller({
    store: store,
    getApi: function getApi() {
      return api;
    },
    scheduler: scheduler,
  });
  poller.start();
  await poller.tickNow();
  assert.equal(poller.getDiagnostics().failures, 1);
  assert.equal(scheduler.tasks[scheduler.tasks.length - 1].delay, TIMING.agentPollMs);
  await poller.tickNow();
  assert.equal(poller.getDiagnostics().failures, 2);
  assert.equal(scheduler.tasks[scheduler.tasks.length - 1].delay, TIMING.agentPollMs * 2);
  assert.equal(store.getState().agentError.code, 'GM-5000');

  const before = scheduler.tasks.length;
  poller.setVisibility('hidden');
  assert.equal(scheduler.tasks[before - 1].cleared, true);
  poller.setVisibility('visible');
  assert.equal(scheduler.tasks[scheduler.tasks.length - 1].delay, 0);
  poller.stop();
});
