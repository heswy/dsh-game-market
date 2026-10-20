import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createMarketApi } from '../src/api-v1.js';
import { createInstallManager } from '../src/install-manager.js';
import { createStore } from '../src/store.js';
import { PAGES } from '../src/constants.js';
import {
  applySearchQuery,
  closeDetail,
  dismissToast,
  installLocalGame,
  loadCatalog,
  localInstallOptionsFromDialog,
  loadDetail,
  openDetail,
  pushErrorToast,
  pushToast,
  refreshRegistryAction,
  startInstall,
  uninstallGame,
} from '../src/actions.js';

function apiError(code, retryable) {
  const error = new Error(code);
  error.code = code;
  error.retryable = retryable === true;
  return error;
}

function gameRecord(id, overrides) {
  return Object.assign(
    {
      id: id,
      name: id.toUpperCase(),
      version: '1.0.0',
      description: 'A game',
      author: { name: 'Studio' },
      categories: ['arcade'],
      capabilities: ['score'],
      installed: false,
      canContinue: false,
      compatibility: { ok: true, reason: null },
    },
    overrides || {}
  );
}

function fakeApi(overrides) {
  return Object.assign(
    {
      listGames: async function listGames() {
        return { items: [gameRecord('jump')], source: 'merged', refreshedAt: '2026-10-18T11:00:00.000Z' };
      },
      listInstalled: async function listInstalled() {
        return { items: [gameRecord('snake', { installed: true })] };
      },
      health: async function health() {
        return { ok: true, registry: { state: 'fresh', count: 1 } };
      },
      getGame: async function getGame(id) {
        return {
          game: gameRecord(id, { installed: true, canContinue: true }),
          installed: { id: id, version: '1.0.0', sizeBytes: 1000 },
          canContinue: true,
          bestScore: 9,
          registry: { id: id, version: '1.0.0', package: { size: 1000 } },
        };
      },
      getScores: async function getScores() {
        return { best: { value: 9 }, history: [{ value: 9 }] };
      },
      refreshRegistry: async function refreshRegistry() {
        return { refreshedAt: '2026-10-18T12:00:00.000Z', count: 1, etag: null, source: 'file' };
      },
    },
    overrides || {}
  );
}

function fakeManager(result) {
  return {
    install: async function install() {
      return result;
    },
    installLocal: async function installLocal() {
      return result;
    },
    uninstall: async function uninstall() {
      return result;
    },
    cancel: function cancel() {
      return true;
    },
  };
}

test('loadCatalog normalizes games and records refresh time, registry and health', async function () {
  const store = createStore();
  const result = await loadCatalog({ store: store, api: fakeApi(), now: 555 });
  assert.equal(result.ok, true);
  const state = store.getState();
  assert.equal(state.market.status, 'ready');
  assert.equal(state.market.games[0].id, 'jump');
  assert.equal(state.market.games[0].author.name, 'Studio');
  assert.equal(state.market.refreshedAt, 555);
  assert.equal(state.market.offline, false);
  assert.equal(state.market.source, 'merged');
  assert.equal(state.market.registry.state, 'fresh');
  assert.equal(state.health.registry.count, 1);
});

test('seed Registry snapshots are usable, not offline', async function () {
  const store = createStore();
  const api = fakeApi({
    health: async function health() {
      return { ok: true, registry: { state: 'seed', activeSource: 'seed', fallback: true, count: 3 } };
    },
  });
  const result = await loadCatalog({ store: store, api: api, now: 777 });
  assert.equal(result.ok, true);
  assert.equal(result.offline, false);
  assert.equal(store.getState().market.offline, false);
  assert.equal(store.getState().market.registry.state, 'seed');
  assert.equal(store.getState().market.registry.fallback, true);
});

test('the catalog follows nextCursor pages until the list is complete', async function () {
  const store = createStore();
  const calls = [];
  const api = fakeApi({
    listGames: async function listGames(filter) {
      calls.push(filter && filter.cursor ? filter.cursor : null);
      if (calls.length === 1) {
        return { items: [gameRecord('a'), gameRecord('b')], nextCursor: 'page-2', source: 'merged' };
      }
      return { items: [gameRecord('c')], nextCursor: null, source: 'merged' };
    },
  });
  const result = await loadCatalog({ store: store, api: api, now: 1 });
  assert.equal(result.ok, true);
  assert.equal(store.getState().market.games.length, 3);
  assert.deepEqual(calls, [null, 'page-2']);
});

test('an offline registry marks the catalog offline but keeps the data', async function () {
  const store = createStore();
  const api = fakeApi({
    health: async function health() {
      return { registry: { state: 'offline', count: 0 } };
    },
  });
  const result = await loadCatalog({ store: store, api: api, now: 1 });
  assert.equal(result.ok, true);
  assert.equal(store.getState().market.offline, true);
  assert.equal(store.getState().market.games.length, 1);
});

test('when /games fails, /installed is used as the offline catalog', async function () {
  const store = createStore();
  const api = fakeApi({
    listGames: async function listGames() {
      throw apiError('GM-5031', true);
    },
  });
  const result = await loadCatalog({ store: store, api: api, now: 10 });
  assert.equal(result.ok, true);
  assert.equal(result.offline, true);
  const state = store.getState();
  assert.equal(state.market.offline, true);
  assert.equal(state.market.games[0].id, 'snake');
  assert.equal(state.market.games[0].installed, true);
});

test('when both catalog routes fail the error is kept and cached games survive', async function () {
  const store = createStore();
  store.dispatch({
    type: 'market-ready',
    items: [{ id: 'snake', name: 'Snake', installed: true }],
    refreshedAt: 1,
  });
  const api = fakeApi({
    listGames: async function listGames() {
      throw apiError('GM-5032', true);
    },
    listInstalled: async function listInstalled() {
      throw apiError('GM-5031', true);
    },
  });
  const result = await loadCatalog({ store: store, api: api, now: 20 });
  assert.equal(result.ok, false);
  assert.equal(store.getState().market.status, 'error');
  assert.equal(store.getState().market.error.code, 'GM-5032');
  assert.equal(store.getState().market.games.length, 1);
  assert.equal(store.getState().market.offline, true);

  const missing = await loadCatalog({ store: createStore(), api: null });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'GM-5031');
});

test('openDetail loads the V1 payload, scores and can be closed', async function () {
  const store = createStore();
  const api = fakeApi();
  const result = await openDetail({ store: store, api: api, gameId: 'jump' });
  assert.equal(result.ok, true);
  const state = store.getState();
  assert.equal(state.page, PAGES.DETAIL);
  assert.equal(state.detail.status, 'ready');
  assert.equal(state.detail.view.game.id, 'jump');
  assert.equal(state.detail.view.bestScore, 9);
  assert.equal(state.detail.scores.best.value, 9);
  closeDetail(store);
  assert.equal(store.getState().page, PAGES.MARKET);
  assert.deepEqual(store.getState().focus, { kind: 'card', gameId: 'jump' });
});

test('loadDetail accepts a bare V0 game record and reports detail failures', async function () {
  const store = createStore();
  store.dispatch({ type: 'detail-open', gameId: 'snake', returnPage: PAGES.MARKET });
  const bare = fakeApi({
    getGame: async function getGame() {
      return { id: 'snake', name: 'Snake', version: '0.1.0', installed: true, canContinue: true, bestScore: 3 };
    },
  });
  const result = await loadDetail({ store: store, api: bare, gameId: 'snake' });
  assert.equal(result.ok, true);
  assert.equal(store.getState().detail.view.game.name, 'Snake');

  const failing = fakeApi({
    getGame: async function getGame() {
      throw apiError('GM-4042', false);
    },
  });
  store.dispatch({ type: 'detail-open', gameId: 'gone', returnPage: PAGES.MARKET });
  const failed = await loadDetail({ store: store, api: failing, gameId: 'gone' });
  assert.equal(failed.ok, false);
  assert.equal(store.getState().detail.status, 'error');
  assert.equal(store.getState().detail.error.code, 'GM-4042');
});

test('startInstall refreshes the catalog, clears the job and raises the install toast', async function () {
  const store = createStore();
  const manager = fakeManager({ ok: true, data: { gameId: 'jump', version: '1.1.0', changed: true } });
  let installed = false;
  const api = fakeApi({
    listGames: async function listGames() {
      return { items: [gameRecord('jump', { installed: installed })], source: 'merged' };
    },
  });
  const promise = startInstall({ store: store, api: api, manager: manager, gameId: 'jump', now: 100 });
  installed = true;
  const result = await promise;
  assert.equal(result.ok, true);
  const state = store.getState();
  assert.equal(state.toasts.length, 1);
  assert.equal(state.toasts[0].textKey, 'toast.installed');
  assert.equal(state.toasts[0].action.kind, 'play');
  assert.equal(state.market.games[0].installed, true, 'catalog is reloaded after install');
  assert.equal(state.installJobs.jump, undefined);
});

test('update installs use the update toast and pass the version', async function () {
  const store = createStore();
  const manager = fakeManager({ ok: true, data: { gameId: 'jump', version: '1.1.0', changed: true } });
  const result = await startInstall({ store: store, api: fakeApi(), manager: manager, gameId: 'jump', update: true, now: 1 });
  assert.equal(result.ok, true);
  assert.equal(store.getState().toasts[0].textKey, 'toast.updated');
  assert.deepEqual(store.getState().toasts[0].params, { gameName: 'jump', version: '1.1.0' });
});

test('cancelled and failed installs do not show a success toast', async function () {
  const cancelledStore = createStore();
  const cancelled = await startInstall({
    store: cancelledStore,
    api: fakeApi(),
    manager: fakeManager({ ok: false, cancelled: true, error: { code: 'GM-5033' } }),
    gameId: 'jump',
  });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelledStore.getState().toasts[0].textKey, 'toast.installCancelled');

  const failedStore = createStore();
  const failed = await startInstall({
    store: failedStore,
    api: fakeApi(),
    manager: fakeManager({ ok: false, error: { code: 'GM-5034', retryable: true } }),
    gameId: 'jump',
  });
  assert.equal(failed.ok, false);
  assert.equal(failedStore.getState().toasts.length, 0);
});

test('uninstall keeps saves by default and deletes data only when confirmed', async function () {
  const store = createStore();
  const api = fakeApi({
    listGames: async function listGames() {
      return { items: [], source: 'merged' };
    },
  });
  const first = await uninstallGame({
    store: store,
    api: api,
    manager: fakeManager({ ok: true, data: { gameId: 'jump', removed: true, dataDeleted: false } }),
    gameId: 'jump',
  });
  assert.equal(first.ok, true);
  assert.equal(store.getState().toasts[0].textKey, 'toast.uninstalled');

  const dataStore = createStore();
  const second = await uninstallGame({
    store: dataStore,
    api: api,
    manager: fakeManager({ ok: true, data: { gameId: 'jump', removed: true, dataDeleted: true } }),
    gameId: 'jump',
    deleteData: true,
  });
  assert.equal(second.ok, true);
  assert.equal(dataStore.getState().toasts[0].textKey, 'toast.uninstalledData');
});

test('uninstalling from the detail page returns to the market', async function () {
  const store = createStore();
  const api = fakeApi();
  await openDetail({ store: store, api: api, gameId: 'jump' });
  assert.equal(store.getState().page, PAGES.DETAIL);
  const result = await uninstallGame({
    store: store,
    api: api,
    manager: fakeManager({ ok: true, data: { gameId: 'jump', removed: true } }),
    gameId: 'jump',
  });
  assert.equal(result.ok, true);
  assert.equal(store.getState().page, PAGES.MARKET);
});

test('local installs toast the game name and clear both job keys', async function () {
  const store = createStore();
  let games = [gameRecord('jump')];
  const api = fakeApi({
    listGames: async function listGames() {
      return { items: games, source: 'merged' };
    },
  });
  const manager = fakeManager({
    ok: true,
    gameId: 'local:1',
    data: { gameId: 'mine', version: '1.0.0', source: 'local', changed: true },
  });
  const promise = installLocalGame({ store: store, api: api, manager: manager, file: { name: 'mine.html' }, fileName: 'mine.html' });
  games = [gameRecord('jump'), gameRecord('mine', { name: 'Mine', installed: true })];
  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(store.getState().toasts[0].textKey, 'market.localInstall.done');
  assert.deepEqual(store.getState().toasts[0].params, { gameName: 'Mine' });
  assert.equal(store.getState().installJobs['local:1'], undefined);
  assert.equal(store.getState().installJobs.mine, undefined);
});

test('local zip installs forward format and raw bytes to the manager', async function () {
  const store = createStore();
  let captured = null;
  const manager = {
    installLocal: async function installLocal(input) {
      captured = input;
      return { ok: false, error: { code: 'GM-5000', retryable: false } };
    },
  };
  const bytes = new ArrayBuffer(6);
  new Uint8Array(bytes).set([0x50, 0x4b, 0x03, 0x04, 0xff, 0x80]);
  const result = await installLocalGame({
    store: store,
    api: fakeApi(),
    manager: manager,
    file: { name: 'orbit-courier-1.0.0.dshgame.zip', size: 6, type: 'application/zip' },
    fileName: 'orbit-courier-1.0.0.dshgame.zip',
    format: 'asset-zip-v2',
    bytes: bytes,
  });
  assert.equal(result.ok, false);
  assert.equal(captured.format, 'asset-zip-v2');
  assert.equal(captured.bytes, bytes);
  assert.equal(captured.fileName, 'orbit-courier-1.0.0.dshgame.zip');
  assert.equal(store.getState().toasts[0].kind, 'error');
});

test('local html installs keep the default html-v1 format when none is given', async function () {
  const store = createStore();
  let captured = null;
  const manager = {
    installLocal: async function installLocal(input) {
      captured = input;
      return { ok: false, error: { code: 'GM-5000', retryable: false } };
    },
  };
  await installLocalGame({
    store: store,
    api: fakeApi(),
    manager: manager,
    file: { name: 'mine.html', size: 10 },
    fileName: 'mine.html',
  });
  assert.equal(captured.format, 'html-v1');
  assert.equal(captured.fileName, 'mine.html');
});

test('the install-local confirmation passes the selected format to the manager', async function () {
  const store = createStore();
  let captured = null;
  const manager = {
    installLocal: async function installLocal(input) {
      captured = input;
      return { ok: false, error: { code: 'GM-5000', retryable: false } };
    },
  };
  const bytes = new ArrayBuffer(6);
  new Uint8Array(bytes).set([0x50, 0x4b, 0x03, 0x04, 0xff, 0x80]);
  const file = { name: 'orbit-courier-1.0.0.dshgame.zip', size: 6, type: 'application/zip' };
  // This is exactly what panel.js#confirmDialogAction feeds into the action.
  const dialog = {
    kind: 'install-local',
    file: file,
    fileName: 'orbit-courier-1.0.0.dshgame.zip',
    format: 'asset-zip-v2',
    bytes: bytes,
  };
  const dialogOptions = localInstallOptionsFromDialog(dialog);
  assert.equal(dialogOptions.format, 'asset-zip-v2');
  assert.equal(dialogOptions.file, file);
  assert.equal(dialogOptions.fileName, 'orbit-courier-1.0.0.dshgame.zip');

  await installLocalGame({ store: store, api: fakeApi(), manager: manager, ...dialogOptions });
  assert.equal(captured.format, 'asset-zip-v2', 'ZIP must not degrade to the html-v1 text path');
  assert.equal(captured.file, file);
  assert.equal(captured.bytes, bytes);
  assert.equal(captured.fileName, 'orbit-courier-1.0.0.dshgame.zip');
});

test('without an explicit format a .dshgame.zip name is detected as asset-zip-v2', async function () {
  const store = createStore();
  let captured = null;
  const manager = {
    installLocal: async function installLocal(input) {
      captured = input;
      return { ok: false, error: { code: 'GM-5000', retryable: false } };
    },
  };
  const file = { name: 'orbit-courier-1.0.0.dshgame.zip', size: 6, type: '' };
  await installLocalGame({ store: store, api: fakeApi(), manager: manager, file: file });
  assert.equal(captured.format, 'asset-zip-v2');
  assert.equal(captured.fileName, 'orbit-courier-1.0.0.dshgame.zip');
});

test('the Market panel confirm action uses the dialog format helper (source guard)', function () {
  const panelPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'panel.js');
  const source = fs.readFileSync(panelPath, 'utf8');
  const installBlock = source.slice(source.indexOf('function confirmDialogAction'));
  assert.match(
    installBlock,
    /installLocalGame\(\{[\s\S]*?localInstallOptionsFromDialog\(dialog\)[\s\S]*?\}\);/,
    'panel must forward the dialog format payload into installLocalGame'
  );
  assert.equal(
    /installLocalGame\(\{[\s\S]*?file: dialog\.file/.test(installBlock),
    false,
    'panel must not rebuild the install payload without the format'
  );
});

test('dialog format travels through the real install manager to an application/zip upload', async function () {
  // End-to-end (minus React): dialog payload -> installLocalGame -> real
  // install-manager -> market API client -> fetch(init.body). This is the chain
  // the real Market UI click uses, and the one that regressed in CR7-03.
  const calls = [];
  const fetchImpl = async function fetchImpl(url, init) {
    calls.push({ url: url, init: init });
    return {
      status: 200,
      json: async function json() {
        return { ok: true, data: { gameId: 'orbit-courier', version: '1.0.0', source: 'local' } };
      },
    };
  };
  const marketApi = createMarketApi({ fetchImpl: fetchImpl });
  const store = createStore();
  const manager = createInstallManager({
    store: store,
    getApi: function getApi() {
      return marketApi;
    },
    scheduler: { setTimeout: setTimeout, clearTimeout: clearTimeout },
    stageHintMs: 5000,
    retryDelays: [0, 0],
  });

  const size = 2384;
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * 37 + 0x5a) & 0xff;
  bytes.set([0x50, 0x4b, 0x03, 0x04], 0);
  bytes.set([0xff, 0xfe, 0x80, 0xc3, 0x28, 0x00, 0xf0, 0x9f, 0x92, 0xa9], 32);
  const source = bytes.buffer;
  const sha = function sha(buffer) {
    return createHash('sha256').update(Buffer.from(new Uint8Array(buffer))).digest('hex');
  };

  const file = {
    name: 'orbit-courier-1.0.0.dshgame.zip',
    type: 'application/zip',
    size: source.byteLength,
    arrayBuffer: async function arrayBuffer() {
      return source;
    },
  };
  // Exactly what the confirmation dialog stores and panel.js forwards.
  const dialog = {
    kind: 'install-local',
    file: file,
    fileName: file.name,
    format: 'asset-zip-v2',
    fileSize: source.byteLength,
  };
  const result = await installLocalGame({
    store: store,
    api: fakeApi(),
    manager: manager,
    ...localInstallOptionsFromDialog(dialog),
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  const init = calls[0].init;
  assert.equal(init.headers['content-type'], 'application/zip');
  assert.ok(init.body instanceof ArrayBuffer);
  assert.equal(init.body.byteLength, size);
  assert.equal(sha(init.body), sha(source), 'uploaded bytes sha256 must equal the source file sha256');
  assert.equal(typeof init.body, 'object');
});

test('local install failures surface the mapped GM message', async function () {
  const store = createStore();
  const result = await installLocalGame({
    store: store,
    api: fakeApi(),
    manager: fakeManager({ ok: false, error: { code: 'GM-4225', retryable: false } }),
    file: { name: 'mine.html' },
    fileName: 'mine.html',
  });
  assert.equal(result.ok, false);
  assert.equal(store.getState().toasts[0].textKey, 'error.gm.notSelfContained');
  assert.equal(store.getState().toasts[0].kind, 'error');
});

test('registry refresh handles success, throttling and offline failures', async function () {
  const successStore = createStore();
  const success = await refreshRegistryAction({ store: successStore, api: fakeApi(), now: 1 });
  assert.equal(success.ok, true);
  assert.equal(successStore.getState().toasts[0].textKey, 'toast.registryRefreshed');

  const fallbackStore = createStore();
  const fallback = await refreshRegistryAction({
    store: fallbackStore,
    api: fakeApi({
      refreshRegistry: async function refreshRegistry() {
        return { count: 3, fallback: true, activeSource: 'seed' };
      },
    }),
    now: 2,
  });
  assert.equal(fallback.ok, true);
  assert.equal(fallbackStore.getState().toasts[0].textKey, 'toast.registryFallback');
  assert.equal(fallbackStore.getState().toasts[0].kind, 'info');

  const throttledStore = createStore();
  const throttled = await refreshRegistryAction({
    store: throttledStore,
    api: fakeApi({
      refreshRegistry: async function refreshRegistry() {
        throw apiError('GM-4290', true);
      },
    }),
  });
  assert.equal(throttled.ok, true);
  assert.equal(throttled.throttled, true);
  assert.equal(throttledStore.getState().toasts[0].textKey, 'toast.registryThrottled');

  const offlineStore = createStore();
  const offline = await refreshRegistryAction({
    store: offlineStore,
    api: fakeApi({
      refreshRegistry: async function refreshRegistry() {
        throw apiError('GM-5031', true);
      },
    }),
  });
  assert.equal(offline.ok, false);
  assert.equal(offlineStore.getState().toasts[0].textKey, 'error.gm.host');
  assert.equal(offlineStore.getState().market.status, 'ready', 'catalog is reloaded after a failed refresh');
});

test('toast helpers and search actions dispatch the expected state', function () {
  const store = createStore();
  const id = pushToast(store, { kind: 'info', textKey: 'toast.offline', id: 'fixed-id' });
  assert.equal(id, 'fixed-id');
  assert.equal(store.getState().toasts[0].textKey, 'toast.offline');
  dismissToast(store, 'fixed-id');
  assert.equal(store.getState().toasts.length, 0);
  pushErrorToast(store, 'GM-4091', { id: 'err-id' });
  assert.equal(store.getState().toasts[0].textKey, 'error.gm.installBusy');
  applySearchQuery(store, 'snake');
  assert.equal(store.getState().ui.query, 'snake');
});
