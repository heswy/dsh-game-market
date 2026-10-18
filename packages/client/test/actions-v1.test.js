import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { PAGES } from '../src/constants.js';
import {
  applySearchQuery,
  closeDetail,
  dismissToast,
  installLocalGame,
  loadCatalog,
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
