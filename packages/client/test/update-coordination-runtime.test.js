/**
 * V1.5 AUD-02 cross-module regression: update coordination with the REAL
 * Runtime controller (injected storage.save failure) instead of a fake pause
 * result.
 *
 * Scenario: the update coordination pause hits a failing storage.save, so the
 * client must report `saved:false` and the Host must not proceed. After the
 * user retries (storage recovered), a second coordination must perform a REAL
 * save retry on the still-paused instance, report `saved:true` only then, and
 * only then may the simulated Host package-change gate open.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createGameRuntime } from '../../runtime/src/index.js';
import { createClock, createFakeApi, createFakeDocument, createFakeElement, createFakeWindow, flushAsync } from '../../runtime/test/helpers/fakes.js';
import { EVENTS, METHODS, createEvent, createRequest } from '../../shared/src/protocol.js';
import { createUpdateManager } from '../src/update-manager.js';
import { createStore } from '../src/store.js';
import { pauseRuntimeBounded } from '../src/runtime-adapter.js';

const INSTANCE = 'a'.repeat(32);
const NONCE = 'b'.repeat(32);
const OPERATION_A = 'upd_0123456789abcdef';
const OPERATION_B = 'upd_fedcba9876543210';
const TARGET = {
  id: 'tgt_0123456789abcdef',
  version: '1.4.0',
  commit: 'c'.repeat(40),
  channel: 'stable',
  publishedAt: '2023-11-14T22:13:20.000Z',
  spec: null,
};

function makeLaunchInfo(overrides = {}) {
  return {
    instanceId: INSTANCE,
    nonce: NONCE,
    entryUrl: `/api/game-market/entry?gameId=snake&version=0.1.0&instance=${INSTANCE}&nonce=${NONCE}`,
    preview: { icon: null, cover: null },
    runtimeVersion: '0.1.0',
    sdkVersion: '0.1.0',
    capabilities: ['storage', 'score'],
    limits: { saveBytes: 1024 * 1024, saveKeys: 32, scoreMetaBytes: 2048 },
    viewport: { width: 960, height: 540, fit: 'contain' },
    hostEpoch: 'epoch-1',
    mode: 'start',
    ...overrides,
  };
}

function messagesOf(iframe, predicate) {
  return iframe.sent.map((entry) => entry.message).filter(predicate);
}

function send(win, iframe, data) {
  win.dispatchEvent('message', { source: iframe.contentWindow, data });
}

async function createPlayingRuntime() {
  const clock = createClock();
  const doc = createFakeDocument();
  const win = createFakeWindow(doc);
  const container = createFakeElement('div');
  const api = createFakeApi();
  const events = [];
  const controller = createGameRuntime({
    container,
    api,
    environment: { theme: 'dark', reducedMotion: false, locale: 'zh' },
    onEvent: (event) => events.push(event),
    window: win,
    document: doc,
    timers: clock,
    now: clock.now,
  });
  await controller.launch(makeLaunchInfo());
  const iframe = container.children[0];
  iframe.dispatchEvent('load', {});
  send(win, iframe, createEvent(EVENTS.HELLO, { instanceId: INSTANCE, nonce: NONCE, sdkVersion: '0.1.0', protocolVersion: 1 }));
  send(win, iframe, createRequest('ready-req', METHODS.READY, { sdkVersion: '0.1.0', protocolVersion: 1 }));
  await flushAsync();
  clock.tick(0);
  assert.equal(controller.getState().state, 'playing');
  return { controller, clock, doc, win, container, api, events, iframe };
}

function inspection(operation) {
  return {
    schemaVersion: 1,
    host: { version: '1.3.0', commit: 'd'.repeat(40), hostEpoch: 'epoch-1', loadedAt: null },
    installed: {
      bundleId: 'dsh-game-market',
      spec: 'github:heswy/dsh-game-market#' + 'd'.repeat(40),
      specShape: 'git-url',
      version: '1.3.0',
      enabled: true,
      loadedVersion: '1.3.0',
      loadedCommit: 'd'.repeat(40),
      devRowShadow: false,
    },
    target: TARGET,
    discovery: {
      channel: 'stable',
      indexUrl: 'https://example.invalid/plugins.json',
      state: 'ready',
      fetchedAt: '2026-10-20T09:59:00.000Z',
      checkedAt: '2026-10-20T09:59:00.000Z',
      nextCheckAt: null,
      lastError: null,
      canRefresh: true,
      anomaly: null,
    },
    capability: { hmr: 'present', updatePath: 'in-place-hmr', canBeginUpdate: true, reasonKey: null },
    operation: operation,
  };
}

function createFakeHost() {
  let current = inspection({ operationId: OPERATION_A, state: 'inspecting', progress: null });
  const calls = [];
  let savedAck = false;
  let installs = 0;
  const api = {
    inspect: async function inspect() {
      calls.push({ method: 'inspect' });
      return current;
    },
    refresh: async function refresh() {
      calls.push({ method: 'refresh' });
      return Object.assign({}, current, { refreshed: true, throttled: false });
    },
    begin: async function begin(targetId) {
      calls.push({ method: 'begin', targetId: targetId });
      return { operationId: OPERATION_B };
    },
    observe: async function observe(operationId) {
      calls.push({ method: 'observe', operationId: operationId });
      return current.operation;
    },
    cancel: async function cancel() {
      return { status: 'not-running' };
    },
    coordinate: async function coordinate(payload) {
      calls.push({ method: 'coordinate', payload: payload });
      const allSaved = payload.instances.length > 0 && payload.instances.every(function saved(entry) {
        return entry.saved === true && entry.saveStale === false;
      });
      if (allSaved) {
        savedAck = true;
        installs += 1; // simulated Host package-change gate opening
      }
      return {
        accepted: true,
        phase: allSaved ? 'satisfied' : 'failed',
        pending: { windows: 1, instances: 0 },
      };
    },
    clientReport: async function clientReport() {
      return { accepted: true, state: 'idle' };
    },
  };
  return {
    api: api,
    calls: calls,
    setInspection: function setInspection(next) {
      current = next;
    },
    get savedAck() {
      return savedAck;
    },
    get installs() {
      return installs;
    },
    count: function count(method) {
      return calls.filter(function match(call) {
        return call.method === method;
      }).length;
    },
    last: function last(method) {
      for (let i = calls.length - 1; i >= 0; i -= 1) {
        if (calls[i].method === method) return calls[i];
      }
      return null;
    },
  };
}

/**
 * Answer every new Runtime before-save with a storage.save request, while
 * waiting for `done()`. `saveFailures[index]` injects a failure per save call.
 */
async function pumpSaves(context, done, saveFailures) {
  const iframe = context.iframe;
  const failures = saveFailures || {};
  // Before-save events are cumulative for the instance lifetime; keep the
  // answered counter on the context so a second pump does not re-answer the
  // previous attempt's before-save with a stray storage.save.
  for (let i = 0; i < 600; i += 1) {
    const total = messagesOf(iframe, (message) => message.event === EVENTS.BEFORE_SAVE).length;
    const answered = context.answeredSaves || 0;
    if (answered < total) {
      context.api.state.failNextSave = failures[answered] || null;
      send(
        context.win,
        iframe,
        createRequest('client-save-' + String(answered), METHODS.STORAGE_SAVE, {
          key: 'current',
          data: { score: 10 + answered },
        })
      );
      context.answeredSaves = answered + 1;
      await flushAsync();
      continue;
    }
    if (done()) return context.answeredSaves || 0;
    await flushAsync();
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('pumpSaves timed out');
}

function saveCalls(api) {
  return api.calls.filter((call) => call[0] === 'setSave').length;
}

test('coordination reports saved:false on a real failed save, then a retried coordination performs a real save and only then opens the Host gate', async function () {
  const context = await createPlayingRuntime();
  const host = createFakeHost();
  const store = createStore();
  const manager = createUpdateManager({
    store: store,
    getApi: function getApi() {
      return host.api;
    },
    getClientIdentity: function identity() {
      return { version: '1.3.0', buildCommit: null };
    },
    getPageIdentity: function pageIdentity() {
      return { windowId: '1'.repeat(32), clientId: '2'.repeat(32), pageToken: '3'.repeat(32), startedAt: '2026-10-20T12:00:00.000Z' };
    },
    getRuntimeInstances: function instances() {
      return [{ instanceId: INSTANCE, gameId: 'snake', controller: context.controller }];
    },
    pauseInstance: function pause(controller) {
      return pauseRuntimeBounded(controller);
    },
  });

  // Attempt 1: inspect sees operation A in coordination; the real pause save fails.
  const firstInspect = manager.inspect();
  const firstCoordinate = manager.coordinateOperation(OPERATION_A);
  await pumpSaves(context, function done() {
    return host.count('coordinate') === 1;
  }, { 0: { code: 'GM-5021', message: 'disk full', retryable: true } });
  await firstCoordinate;
  await firstInspect;

  const failedPayload = host.last('coordinate').payload;
  assert.equal(failedPayload.instances.length, 1);
  assert.equal(failedPayload.instances[0].saved, false, 'real failed save is never reported saved');
  assert.equal(failedPayload.instances[0].saveStale, true);
  assert.equal(failedPayload.instances[0].paused, true);
  assert.equal(failedPayload.instances[0].error.code, 'GM-5021');
  assert.equal(host.savedAck, false, 'Host gate stayed closed');
  assert.equal(host.installs, 0, 'no package change after a failed save');
  assert.equal(store.getState().update.coordination.status, 'failed');
  assert.equal(saveCalls(context.api), 1);
  assert.equal(messagesOf(context.iframe, (message) => message.event === EVENTS.PAUSE).length, 1);

  // Attempt 2 (user retry): storage recovered; new Host operation B coordinates.
  host.setInspection(inspection({ operationId: OPERATION_B, state: 'inspecting', progress: null }));
  const retryInspect = manager.inspect();
  const retryCoordinate = manager.coordinateOperation(OPERATION_B);
  await pumpSaves(context, function done() {
    return host.count('coordinate') === 2;
  }, {});
  await retryCoordinate;
  await retryInspect;

  const retryPayload = host.last('coordinate').payload;
  assert.equal(retryPayload.instances[0].saved, true, 'retry performs a real save and reports it');
  assert.equal(retryPayload.instances[0].saveStale, false);
  assert.equal(host.savedAck, true);
  assert.equal(host.installs, 1, 'Host package-change gate opened exactly once, after the save retry');
  assert.equal(store.getState().update.coordination.status, 'reported');
  assert.equal(saveCalls(context.api), 2, 'exactly one new real save on the retry (same paused instance)');
  assert.equal(messagesOf(context.iframe, (message) => message.event === EVENTS.PAUSE).length, 1, 'no duplicate PAUSE event');
  assert.equal(messagesOf(context.iframe, (message) => message.event === EVENTS.BEFORE_SAVE).length, 2);

  context.controller.resume();
  assert.equal(context.controller.getState().state, 'paused', 'acknowledged instance cannot resume during update');
  host.setInspection(inspection({ operationId: OPERATION_A, state: 'failed', error: { code: 'GM-5036' }, oldVersionStillRunning: true }));
  await manager.inspect();
  context.controller.resume();
  assert.equal(context.controller.getState().state, 'paused', 'late result of old operation cannot unlock new operation');
  host.setInspection(inspection({ operationId: OPERATION_B, state: 'failed', error: { code: 'GM-5036' }, oldVersionStillRunning: true }));
  await manager.inspect();
  context.controller.resume();
  assert.equal(context.controller.getState().state, 'playing', 'terminal failure releases hold for explicit resume');

  manager.stop();
  context.controller.destroy();
});
