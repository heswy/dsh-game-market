import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { createInstallManager } from '../src/install-manager.js';

function tick() {
  return new Promise(function wait(resolve) {
    setImmediate(resolve);
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise(function create(innerResolve, innerReject) {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise: promise, resolve: resolve, reject: reject };
}

function apiError(code, retryable) {
  const error = new Error(code);
  error.code = code;
  error.retryable = retryable === true;
  return error;
}

function baseApi(overrides) {
  return Object.assign(
    {
      operationId: function operationId() {
        return 'op-test';
      },
      install: async function install(input) {
        return { gameId: input.gameId, version: '1.0.0', changed: true };
      },
      installLocal: async function installLocal() {
        return { gameId: 'local-game', version: '1.0.0', source: 'local' };
      },
      uninstall: async function uninstall(input) {
        return { gameId: input.gameId, removed: true, dataDeleted: input.deleteData === true };
      },
    },
    overrides || {}
  );
}

function makeManager(api, extra) {
  const store = createStore();
  const manager = createInstallManager(
    Object.assign(
      {
        store: store,
        getApi: function getApi() {
          return api;
        },
        // Browser timers have no unref(). Keep test-owned retry timers alive
        // until they settle, even when no other Node handles are pending.
        scheduler: { setTimeout, clearTimeout },
        stageHintMs: 5000,
        retryDelays: [0, 0],
      },
      extra || {}
    )
  );
  return { store: store, manager: manager };
}

test('install dispatches queued then installed and returns the payload', async function () {
  const stages = [];
  const { store, manager } = makeManager(baseApi());
  store.subscribe(function record() {
    const job = store.getState().installJobs.jump;
    if (job) stages.push(job.stage);
  });
  const result = await manager.install('jump', { operationId: 'op-1' });
  assert.equal(result.ok, true);
  assert.equal(result.data.changed, true);
  assert.deepEqual(stages, ['queued', 'installed']);
  const job = store.getState().installJobs.jump;
  assert.equal(job.stage, 'installed');
  assert.equal(job.kind, 'install');
  assert.equal(job.operationId, 'op-1');
  assert.equal(manager.isBusy(), false);
});

test('installs are serialized globally: the second request waits for the first', async function () {
  const gate = deferred();
  const calls = [];
  const api = baseApi({
    install: async function install(input) {
      calls.push(input.gameId);
      if (input.gameId === 'a') await gate.promise;
      return { gameId: input.gameId, version: '1.0.0' };
    },
  });
  const { manager } = makeManager(api);
  const first = manager.install('a', { operationId: 'op-a' });
  const second = manager.install('b', { operationId: 'op-b' });
  await tick();
  assert.deepEqual(calls, ['a']);
  assert.equal(manager.activeJob().gameId, 'a');
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['a', 'b']);
});

test('a duplicate request for the same game shares the pending promise', async function () {
  let calls = 0;
  const gate = deferred();
  const api = baseApi({
    install: async function install(input) {
      calls += 1;
      await gate.promise;
      return { gameId: input.gameId, version: '1.0.0' };
    },
  });
  const { manager } = makeManager(api);
  const first = manager.install('jump', { operationId: 'op-1' });
  const second = manager.install('jump', { operationId: 'op-1' });
  gate.resolve();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(one, two);
});

test('busy errors (GM-4091 / GM-4097) retry without surfacing a failure', async function () {
  let calls = 0;
  const api = baseApi({
    install: async function install() {
      calls += 1;
      if (calls < 3) throw apiError(calls === 1 ? 'GM-4091' : 'GM-4097', true);
      return { gameId: 'jump', version: '1.0.0' };
    },
  });
  const { store, manager } = makeManager(api, { retryDelays: [0, 0] });
  const result = await manager.install('jump', { operationId: 'op-1' });
  assert.equal(calls, 3);
  assert.equal(result.ok, true);
  assert.equal(store.getState().installJobs.jump.stage, 'installed');
});

test('permanent failures keep the stage, failure bucket and reason key', async function () {
  const api = baseApi({
    install: async function install() {
      throw apiError('GM-5034', true);
    },
  });
  const { store, manager } = makeManager(api);
  const result = await manager.install('jump', { operationId: 'op-1' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'GM-5034');
  const job = store.getState().installJobs.jump;
  assert.equal(job.stage, 'failed');
  assert.equal(job.failureStage, 'download');
  assert.equal(job.reasonKey, 'detail.install.failed.download');
  assert.equal(job.error.code, 'GM-5034');
});

test('cancel aborts the running request and reports cancellation', async function () {
  const api = baseApi({
    install: function install(input) {
      return new Promise(function pending(resolve, reject) {
        input.signal.addEventListener('abort', function onAbort() {
          reject(apiError('GM-5033', false));
        });
      });
    },
  });
  const { store, manager } = makeManager(api);
  const promise = manager.install('jump', { operationId: 'op-1' });
  await tick();
  assert.equal(manager.cancel('jump'), true);
  const result = await promise;
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.equal(store.getState().installJobs.jump.stage, 'cancelled');
  assert.equal(manager.cancel('jump'), false);
});

test('uninstall clears the row job and passes deleteData through', async function () {
  let received = null;
  const api = baseApi({
    uninstall: async function uninstall(input) {
      received = input;
      return { gameId: input.gameId, removed: true, dataDeleted: true };
    },
  });
  const { store, manager } = makeManager(api);
  const result = await manager.uninstall('jump', { deleteData: true, operationId: 'op-u' });
  assert.equal(result.ok, true);
  assert.equal(received.deleteData, true);
  assert.equal(store.getState().installJobs.jump, undefined);
});

test('local installs use the raw-file API and mark the job installed', async function () {
  let received = null;
  const api = baseApi({
    installLocal: async function installLocal(input) {
      received = input;
      return { gameId: 'local-game', version: '2.0.0', source: 'local' };
    },
  });
  const { store, manager } = makeManager(api);
  const file = { name: 'mine.html', size: 20 };
  const result = await manager.installLocal({ gameId: 'mine', file: file, fileName: 'mine.html' });
  assert.equal(result.ok, true);
  assert.equal(received.file, file);
  assert.equal(store.getState().installJobs.mine.stage, 'installed');
});

test('missing Host API degrades to a failed job instead of throwing', async function () {
  const { store, manager } = makeManager(null, { getApi: function noApi() { return null; } });
  const result = await manager.install('jump');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'GM-5031');
  assert.equal(store.getState().installJobs.jump.stage, 'failed');
});

test('stage hint switches to downloading while the request is in flight', async function () {
  const gate = deferred();
  const api = baseApi({
    install: async function install(input) {
      await gate.promise;
      return { gameId: input.gameId, version: '1.0.0' };
    },
  });
  const { store, manager } = makeManager(api, { stageHintMs: 1 });
  const promise = manager.install('jump', { operationId: 'op-1' });
  await new Promise(function wait(resolve) {
    setTimeout(resolve, 12);
  });
  assert.equal(store.getState().installJobs.jump.stage, 'downloading');
  manager.reportPercent('jump', 40);
  assert.equal(store.getState().installJobs.jump.percent, 40);
  gate.resolve();
  await promise;
  assert.equal(store.getState().installJobs.jump.stage, 'installed');
});
