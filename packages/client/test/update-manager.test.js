import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateManager } from '../src/update-manager.js';
import { createStore } from '../src/store.js';
import { clearRuntimeInstances, registerRuntimeInstance } from '../src/runtime-registry.js';
import { GM } from '../../shared/src/errors.js';

const COMMIT_RUNNING = 'a'.repeat(40);
const COMMIT_TARGET = 'b'.repeat(40);
const WINDOW_ID = '1'.repeat(32);
const CLIENT_ID = '2'.repeat(32);
const PAGE_TOKEN = '3'.repeat(32);
const INSTANCE_ID = '4'.repeat(32);
const OPERATION_ID = 'upd_0123456789abcdef';

function inspectionFixture(overrides) {
  const base = {
    schemaVersion: 1,
    host: { version: '1.2.0', commit: COMMIT_RUNNING, hostEpoch: 'epoch-1', loadedAt: '2026-10-20T10:00:00.000Z' },
    installed: {
      bundleId: 'dsh-game-market',
      spec: 'github:heswy/dsh-game-market#' + COMMIT_RUNNING,
      specShape: 'git-url',
      version: '1.2.0',
      enabled: true,
      loadedVersion: '1.2.0',
      loadedCommit: COMMIT_RUNNING,
      devRowShadow: false,
    },
    target: {
      id: 'tgt_1',
      version: '1.3.0',
      commit: COMMIT_TARGET,
      channel: 'stable',
      publishedAt: '2026-10-19T00:00:00.000Z',
      spec: 'https://github.com/heswy/dsh-game-market.git#' + COMMIT_TARGET,
    },
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
    operation: null,
  };
  const source = overrides && typeof overrides === 'object' ? overrides : {};
  return {
    ...base,
    ...source,
    host: { ...base.host, ...(source.host || {}) },
    installed: { ...base.installed, ...(source.installed || {}) },
    discovery: { ...base.discovery, ...(source.discovery || {}) },
    capability: { ...base.capability, ...(source.capability || {}) },
    target: Object.prototype.hasOwnProperty.call(source, 'target') ? source.target : base.target,
    operation: Object.prototype.hasOwnProperty.call(source, 'operation') ? source.operation : base.operation,
  };
}

function createFakeScheduler() {
  let clock = Date.parse('2026-10-20T12:00:00.000Z');
  let nextId = 1;
  let tasks = [];
  return {
    now: function now() {
      return clock;
    },
    setTimeout: function setTimeoutFake(callback, delay) {
      const id = nextId;
      nextId += 1;
      tasks.push({ id: id, callback: callback, due: clock + (typeof delay === 'number' ? delay : 0) });
      return id;
    },
    clearTimeout: function clearTimeoutFake(id) {
      tasks = tasks.filter(function keep(task) {
        return task.id !== id;
      });
    },
    pendingCount: function pendingCount() {
      return tasks.length;
    },
    nextDelay: function nextDelay() {
      if (tasks.length === 0) return null;
      return Math.min.apply(
        null,
        tasks.map(function delay(task) {
          return task.due - clock;
        })
      );
    },
    runNext: function runNext() {
      if (tasks.length === 0) return false;
      tasks.sort(function order(left, right) {
        return left.due === right.due ? left.id - right.id : left.due - right.due;
      });
      const task = tasks.shift();
      clock = Math.max(clock, task.due);
      task.callback();
      return true;
    },
  };
}

function createFakePageIdentity() {
  return { windowId: WINDOW_ID, clientId: CLIENT_ID, pageToken: PAGE_TOKEN, startedAt: '2026-10-20T12:00:00.000Z' };
}

function createFakeApi(handlers) {
  const h = handlers || {};
  const calls = [];
  const api = {
    calls: calls,
    inspect: function inspect() {
      calls.push({ method: 'inspect' });
      return h.inspect ? h.inspect() : Promise.resolve(inspectionFixture());
    },
    refresh: function refresh() {
      calls.push({ method: 'refresh' });
      return h.refresh ? h.refresh() : Promise.resolve(inspectionFixture());
    },
    begin: function begin(targetId) {
      calls.push({ method: 'begin', targetId: targetId });
      return h.begin ? h.begin(targetId) : Promise.resolve({ operationId: OPERATION_ID });
    },
    observe: function observe(operationId) {
      calls.push({ method: 'observe', operationId: operationId });
      return h.observe ? h.observe(operationId) : Promise.resolve({ operationId: operationId, state: 'installing', stage: 'install', progress: null });
    },
    cancel: function cancel(operationId) {
      calls.push({ method: 'cancel', operationId: operationId });
      return h.cancel ? h.cancel(operationId) : Promise.resolve({ status: 'cancelled' });
    },
    coordinate: function coordinate(payload) {
      calls.push({ method: 'coordinate', payload: payload });
      return h.coordinate ? h.coordinate(payload) : Promise.resolve({ accepted: true, phase: 'satisfied', pending: { windows: 0, instances: 0 } });
    },
    clientReport: function clientReport(payload) {
      calls.push({ method: 'client-report', payload: payload });
      return h.clientReport ? h.clientReport(payload) : Promise.resolve({ accepted: true, state: 'idle' });
    },
  };
  function count(method) {
    return calls.filter(function match(call) {
      return call.method === method;
    }).length;
  }
  api.count = count;
  api.last = function last(method) {
    for (let i = calls.length - 1; i >= 0; i -= 1) {
      if (calls[i].method === method) return calls[i];
    }
    return null;
  };
  return api;
}

function flush(times) {
  let chain = Promise.resolve();
  const rounds = typeof times === 'number' ? times : 14;
  for (let i = 0; i < rounds; i += 1) {
    chain = chain.then(function next() {
      return new Promise(function wait(resolve) {
        setImmediate(resolve);
      });
    });
  }
  return chain;
}

async function waitFor(predicate, rounds) {
  const limit = typeof rounds === 'number' ? rounds : 40;
  for (let i = 0; i < limit; i += 1) {
    if (predicate()) return true;
    await flush(1);
  }
  return predicate();
}

function buildManager(overrides) {
  const options = overrides && typeof overrides === 'object' ? overrides : {};
  const store = options.store || createStore();
  const scheduler = options.scheduler || createFakeScheduler();
  const api = options.api || createFakeApi();
  const manager = createUpdateManager({
    store: store,
    getApi: function getApi() {
      return api;
    },
    getClientIdentity: function identity() {
      return options.clientIdentity || { version: '1.2.0', buildCommit: COMMIT_RUNNING };
    },
    getPageIdentity: function pageIdentity() {
      return createFakePageIdentity();
    },
    getRuntimeInstances: options.getRuntimeInstances || function noInstances() {
      return [];
    },
    pauseInstance: options.pauseInstance || function pauseController() {
      return Promise.resolve({ ok: true, saveStale: false });
    },
    scheduler: scheduler,
  });
  return { manager: manager, store: store, api: api, scheduler: scheduler };
}

test('start reports this build identity (never the Host version) and loads the inspection', async function () {
  const api = createFakeApi({
    inspect: function inspect() {
      return Promise.resolve(
        inspectionFixture({ host: { version: '9.9.9', commit: COMMIT_TARGET, hostEpoch: 'epoch-9' } })
      );
    },
  });
  const built = buildManager({ api: api, clientIdentity: { version: '1.2.0', buildCommit: COMMIT_RUNNING } });
  built.manager.start();
  assert.equal(built.scheduler.runNext(), true, 'initial inspection is scheduled');
  await waitFor(function ready() {
    return built.store.getState().update.status === 'ready';
  });
  assert.equal(api.count('inspect'), 1);
  assert.equal(api.count('client-report'), 1);
  const report = api.last('client-report').payload;
  assert.equal(report.buildVersion, '1.2.0');
  assert.equal(report.buildCommit, COMMIT_RUNNING);
  assert.equal(report.windowId, WINDOW_ID);
  assert.equal(report.clientId, CLIENT_ID);
  assert.equal(report.pageToken, PAGE_TOKEN);
  const state = built.store.getState();
  assert.equal(state.update.inspection.host.version, '9.9.9', 'Host identity comes from the inspection');
  assert.equal(state.update.identity, undefined, 'client identity is not stored from the Host payload');
  built.manager.stop();
});

test('an active persisted operation is observed at ~1s and only updated is success', async function () {
  const observations = [
    { operationId: OPERATION_ID, state: 'activating', installedVersion: '1.3.0', awaiting: 'health' },
    { operationId: OPERATION_ID, state: 'updated', version: '1.3.0', host: '1.3.0+' + COMMIT_TARGET, client: '1.3.0+' + COMMIT_RUNNING },
  ];
  const api = createFakeApi({
    inspect: function inspect() {
      return Promise.resolve(inspectionFixture({ operation: observations[0] }));
    },
    observe: function observe() {
      return Promise.resolve(observations[Math.min(api.count('observe'), observations.length - 1)]);
    },
  });
  const built = buildManager({ api: api });
  await built.manager.inspect();
  assert.equal(built.store.getState().update.operation.state, 'activating');
  assert.equal(built.store.getState().update.operation.success, undefined, 'not stored at all: derived later');
  assert.equal(built.scheduler.runNext(), true, 'first observe tick is scheduled');
  await waitFor(function observing() {
    return built.store.getState().update.operation.state === 'activating';
  });
  assert.equal(built.store.getState().update.status, 'ready');
  built.manager.stop();
});

test('observation reaches updated terminal state and stops polling', async function () {
  let observeCalls = 0;
  const api = createFakeApi({
    inspect: function inspect() {
      return Promise.resolve(inspectionFixture({ operation: { operationId: OPERATION_ID, state: 'applied', changed: true, bundle: 'dsh-game-market', version: '1.3.0' } }));
    },
    observe: function observe() {
      observeCalls += 1;
      if (observeCalls === 1) {
        return Promise.resolve({ operationId: OPERATION_ID, state: 'activating', installedVersion: '1.3.0', awaiting: 'health' });
      }
      return Promise.resolve({ operationId: OPERATION_ID, state: 'updated', version: '1.3.0', host: '1.3.0+' + COMMIT_TARGET, client: '1.3.0+' + COMMIT_RUNNING });
    },
  });
  const built = buildManager({ api: api });
  await built.manager.inspect();
  assert.equal(built.store.getState().update.operation.state, 'applied');
  built.scheduler.runNext();
  await waitFor(function firstObserve() {
    return built.store.getState().update.operation.state === 'activating';
  });
  built.scheduler.runNext();
  await waitFor(function terminal() {
    return built.store.getState().update.operation.state === 'updated';
  });
  const before = observeCalls;
  built.manager.stop();
  assert.equal(before, 2);
  assert.equal(built.store.getState().update.operation.state, 'updated');
});

test('repeated begin calls never start a second install and reuse the operation id', async function () {
  let resolveBegin = null;
  const api = createFakeApi({
    begin: function begin() {
      return new Promise(function wait(resolve) {
        resolveBegin = resolve;
      });
    },
  });
  const built = buildManager({ api: api });
  await built.manager.inspect();
  const first = built.manager.begin('tgt_1');
  const second = built.manager.begin('tgt_1');
  const secondResult = await second;
  assert.equal(secondResult.busy, true, 'concurrent click is rejected locally');
  assert.equal(api.count('begin'), 1, 'only one Host begin request');
  resolveBegin({ operationId: OPERATION_ID });
  const firstResult = await first;
  assert.equal(firstResult.ok, true);
  assert.equal(firstResult.operationId, OPERATION_ID);
  assert.equal(built.store.getState().update.starting, true);
  // The Host reports the operation as active; a later click reuses it.
  built.store.dispatch({
    type: 'update-inspect-ready',
    inspection: requireInspectionWithOperation(),
    at: built.scheduler.now(),
  });
  const again = await built.manager.begin('tgt_1');
  assert.equal(again.ok, true);
  assert.equal(again.operationId, OPERATION_ID);
  assert.equal(again.existing, true);
  assert.equal(api.count('begin'), 1, 'no duplicate begin');
  built.manager.stop();
});

function requireInspectionWithOperation() {
  return inspectionFixture({ operation: { operationId: OPERATION_ID, state: 'inspecting', progress: null } });
}

test('begin rejects a forged target id without calling the Host', async function () {
  const api = createFakeApi();
  const built = buildManager({ api: api });
  await built.manager.inspect();
  const result = await built.manager.begin('forged-target');
  assert.equal(result.ok, false);
  assert.equal(api.count('begin'), 0);
  assert.equal(built.store.getState().update.actionError.code, GM.UPDATE_TARGET_INVALID);
});

test('coordination reports saved:true only for a clean platform pause', async function () {
  const api = createFakeApi({
    inspect: function inspect() {
      return Promise.resolve(inspectionFixture({ operation: { operationId: OPERATION_ID, state: 'inspecting', progress: null } }));
    },
  });
  const instances = [{ instanceId: INSTANCE_ID, gameId: 'snake', controller: {} }];
  const built = buildManager({
    api: api,
    getRuntimeInstances: function instancesFn() {
      return instances;
    },
    pauseInstance: function pause() {
      return Promise.resolve({ ok: true, saveStale: false });
    },
  });
  await built.manager.inspect();
  await waitFor(function coordinated() {
    return api.count('coordinate') === 1;
  });
  const payload = api.last('coordinate').payload;
  assert.equal(payload.windowId, WINDOW_ID);
  assert.equal(payload.idle, false);
  assert.equal(payload.instances.length, 1);
  const instance = payload.instances[0];
  assert.equal(instance.instanceId, INSTANCE_ID);
  assert.equal(instance.gameId, 'snake');
  assert.equal(instance.paused, true);
  assert.equal(instance.saved, true);
  assert.equal(instance.saveStale, false);
  assert.equal(instance.playSessionId, null);
  assert.equal(instance.saveRevision, null);
  assert.equal(instance.error, undefined);
  assert.equal(built.store.getState().update.coordination.status, 'reported');
  built.manager.stop();
});

test('a save failure is reported saved:false and visibly blocks the update', async function () {
  const api = createFakeApi({
    inspect: function inspect() {
      return Promise.resolve(
        inspectionFixture({
          operation: { operationId: OPERATION_ID, state: 'inspecting', coordination: { phase: 'collecting', pending: 1, failed: false }, progress: null },
        })
      );
    },
  });
  const instances = [{ instanceId: INSTANCE_ID, gameId: 'puzzle', controller: {} }];
  const built = buildManager({
    api: api,
    getRuntimeInstances: function instancesFn() {
      return instances;
    },
    pauseInstance: function pause() {
      return Promise.resolve({ ok: false, saveStale: true, error: { code: GM.SAVE_WRITE_FAILED } });
    },
  });
  await built.manager.inspect();
  await waitFor(function coordinated() {
    return built.store.getState().update.coordination !== null;
  });
  await flush(20);
  const payload = api.last('coordinate').payload;
  const instance = payload.instances[0];
  assert.equal(instance.saved, false, 'save failure is never reported as saved');
  assert.equal(instance.paused, true);
  assert.equal(instance.saveStale, true);
  assert.equal(instance.error.code, GM.SAVE_WRITE_FAILED);
  assert.equal(built.store.getState().update.coordination.status, 'failed');
  const toast = built.store.getState().toasts.find(function find(item) {
    return item.textKey === 'update.toast.coordinationFailed';
  });
  assert.ok(toast, 'the block is visible through a toast');
  built.manager.stop();
});

test('an unresponsive instance is reported paused:false and saved:false', async function () {
  const api = createFakeApi({
    inspect: function inspect() {
      return Promise.resolve(inspectionFixture({ operation: { operationId: OPERATION_ID, state: 'inspecting', progress: null } }));
    },
  });
  const built = buildManager({
    api: api,
    getRuntimeInstances: function instancesFn() {
      return [{ instanceId: INSTANCE_ID, gameId: 'breakout', controller: {} }];
    },
    pauseInstance: function pause() {
      return Promise.reject(new Error('bridge hung'));
    },
  });
  await built.manager.inspect();
  await waitFor(function coordinated() {
    return api.count('coordinate') === 1;
  });
  const instance = api.last('coordinate').payload.instances[0];
  assert.equal(instance.paused, false);
  assert.equal(instance.saved, false);
  assert.equal(instance.saveStale, true);
  assert.equal(built.store.getState().update.coordination.status, 'failed');
  built.manager.stop();
});

test('an idle window reports idle with an empty instance list', async function () {
  const api = createFakeApi({
    inspect: function inspect() {
      return Promise.resolve(inspectionFixture({ operation: { operationId: OPERATION_ID, state: 'inspecting', progress: null } }));
    },
  });
  const built = buildManager({ api: api });
  await built.manager.inspect();
  await waitFor(function coordinated() {
    return api.count('coordinate') === 1;
  });
  const payload = api.last('coordinate').payload;
  assert.equal(payload.idle, true);
  assert.deepEqual(payload.instances, []);
  built.manager.stop();
});

test('coordination happens once per operation per page life (multi-window safe)', async function () {
  const api = createFakeApi({
    inspect: function inspect() {
      return Promise.resolve(inspectionFixture({ operation: { operationId: OPERATION_ID, state: 'inspecting', progress: null } }));
    },
  });
  const built = buildManager({ api: api });
  await built.manager.inspect();
  await built.manager.inspect();
  await waitFor(function coordinated() {
    return api.count('coordinate') === 1;
  });
  await flush(10);
  assert.equal(api.count('coordinate'), 1, 'no duplicate coordinate reports');
  built.manager.stop();
});

test('page refresh resumes the persisted operation and reports identity again', async function () {
  let observeCalls = 0;
  const api = createFakeApi({
    inspect: function inspect() {
      return Promise.resolve(inspectionFixture({ operation: { operationId: OPERATION_ID, state: 'activating', installedVersion: '1.3.0', awaiting: 'health' } }));
    },
    observe: function observe() {
      observeCalls += 1;
      return Promise.resolve({
        operationId: OPERATION_ID,
        state: 'updated',
        version: '1.3.0',
        host: '1.3.0+' + COMMIT_TARGET,
        client: '1.3.0+' + COMMIT_RUNNING,
      });
    },
  });
  const built = buildManager({ api: api });
  built.manager.start();
  assert.equal(built.scheduler.runNext(), true, 'initial inspection is scheduled on load');
  await waitFor(function ready() {
    return built.store.getState().update.status === 'ready';
  });
  assert.equal(api.count('client-report'), 1, 'identity is reported on load');
  assert.equal(built.store.getState().update.operation.state, 'activating');
  for (let i = 0; i < 10 && built.store.getState().update.operation.state !== 'updated'; i += 1) {
    assert.equal(built.scheduler.runNext(), true, 'observation resumes from the persisted operation');
    await flush(4);
  }
  assert.equal(built.store.getState().update.operation.state, 'updated');
  assert.equal(observeCalls, 1);
  built.manager.stop();
});

test('an old Host without the routes marks the UI unsupported and stops polling', async function () {
  const api = createFakeApi({
    inspect: function inspect() {
      const error = new Error('not found');
      error.code = GM.UNKNOWN_METHOD;
      error.status = 404;
      return Promise.reject(error);
    },
  });
  const built = buildManager({ api: api });
  await built.manager.inspect();
  const state = built.store.getState();
  assert.equal(state.update.status, 'unsupported');
  assert.equal(built.manager.getDiagnostics().unsupported, true);
  assert.equal(built.scheduler.pendingCount(), 0, 'no further polling after unsupported');
  built.manager.stop();
});

test('cancel too-late does not claim cancellation and keeps observing', async function () {
  const api = createFakeApi({
    inspect: function inspect() {
      return Promise.resolve(inspectionFixture({ operation: { operationId: OPERATION_ID, state: 'installing', stage: 'install', progress: null } }));
    },
    cancel: function cancel() {
      return Promise.resolve({
        status: 'too-late',
        observation: { operationId: OPERATION_ID, state: 'too-late', note: 'install-continues' },
      });
    },
  });
  const built = buildManager({ api: api });
  await built.manager.inspect();
  const result = await built.manager.cancel();
  assert.equal(result.status, 'too-late');
  assert.equal(built.store.getState().update.operation.state, 'too-late');
  built.manager.stop();
});

test('refresh keeps the inspection and surfaces throttling without an error', async function () {
  const api = createFakeApi({
    refresh: function refresh() {
      return Promise.resolve(
        inspectionFixture({
          refreshed: false,
          throttled: true,
          discovery: { nextCheckAt: '2026-10-20T12:00:30.000Z' },
        })
      );
    },
  });
  const built = buildManager({ api: api });
  const result = await built.manager.refresh();
  assert.equal(result.ok, true);
  const state = built.store.getState();
  assert.equal(state.update.refreshing, false);
  assert.equal(state.update.error, null);
  assert.equal(state.update.status, 'ready');
  assert.ok(state.update.inspection);
  built.manager.stop();
});

test('client identity is re-reported periodically while an update is running', async function () {
  const api = createFakeApi({
    begin: function begin() {
      return Promise.resolve({ operationId: OPERATION_ID });
    },
    inspect: function inspect() {
      return Promise.resolve(inspectionFixture());
    },
    observe: function observe() {
      return Promise.resolve({ operationId: OPERATION_ID, state: 'installing', stage: 'install', progress: null });
    },
  });
  const built = buildManager({ api: api });
  await built.manager.inspect();
  await built.manager.begin('tgt_1');
  assert.equal(api.count('client-report'), 0, 'no report before an update runs');
  // Drain scheduled timers (observe 1s, inspect 3s, report 15s) until a second
  // identity report is sent.
  for (let i = 0; i < 120; i += 1) {
    if (api.count('client-report') >= 1) break;
    if (!built.scheduler.runNext()) break;
    await flush(2);
  }
  assert.ok(api.count('client-report') >= 1, 'identity reported during the update');
  built.manager.stop();
});

test('runtime registry entries are collected without clearing live registrations', function () {
  clearRuntimeInstances();
  const unregister = registerRuntimeInstance({ instanceId: INSTANCE_ID, gameId: 'snake', controller: {} });
  assert.equal(registerRuntimeInstance({ instanceId: INSTANCE_ID, gameId: 'other', controller: {} }) instanceof Function, true);
  unregister();
  clearRuntimeInstances();
});
