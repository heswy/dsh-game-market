import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState,
  createStore,
  reduce,
  dialogClosed,
  dialogConfirmAgain,
  dialogDeleteDataChanged,
  dialogOpened,
  detailClosed,
  detailOpened,
  detailReady,
  installStageChanged,
  pageChanged,
  queryApplied,
  queryDraftChanged,
  scrollSaved,
  toastPushed,
  toastDismissed,
} from '../src/store.js';
import { PAGES } from '../src/constants.js';

const VIEW = { game: { id: 'jump', name: 'Jump', installed: true }, canContinue: false, bestScore: 12 };

test('initial state includes the V1 market, detail, UI, install, dialog and toast slices', function () {
  const state = createInitialState();
  assert.equal(state.page, PAGES.MARKET);
  assert.deepEqual(state.market, {
    status: 'idle',
    games: [],
    error: null,
    refreshedAt: 0,
    offline: false,
    registry: null,
    source: null,
  });
  assert.equal(state.detail.status, 'idle');
  assert.equal(state.ui.category, 'all');
  assert.equal(state.ui.query, '');
  assert.equal(state.ui.lightbox, null);
  assert.deepEqual(state.scroll, { market: 0, 'my-games': 0 });
  assert.deepEqual(state.toasts, []);
  assert.equal(state.dialog, null);
  assert.deepEqual(state.installJobs, {});
  assert.equal(state.focus, null);
});

test('detail navigation loads, stores scores and returns to the source list with focus', function () {
  const store = createStore();
  store.dispatch(detailOpened('jump', PAGES.MY_GAMES));
  let state = store.getState();
  assert.equal(state.page, PAGES.DETAIL);
  assert.equal(state.detail.gameId, 'jump');
  assert.equal(state.detail.status, 'loading');
  assert.equal(state.detail.returnPage, PAGES.MY_GAMES);

  store.dispatch(detailReady('jump', VIEW));
  state = store.getState();
  assert.equal(state.detail.status, 'ready');
  assert.equal(state.detail.view.game.id, 'jump');

  store.dispatch({ type: 'detail-scores', scores: { best: { value: 12 }, history: [] } });
  assert.equal(store.getState().detail.scores.best.value, 12);

  store.dispatch(detailReady('other', VIEW));
  assert.equal(store.getState().detail.view, VIEW, 'mismatched detail payload is ignored');

  store.dispatch(detailClosed());
  state = store.getState();
  assert.equal(state.page, PAGES.MY_GAMES);
  assert.equal(state.detail.status, 'idle');
  assert.deepEqual(state.focus, { kind: 'row', gameId: 'jump' });
});

test('detail close returns to Market with a card focus intent', function () {
  const store = createStore();
  store.dispatch(detailOpened('snake', PAGES.MARKET));
  store.dispatch(detailClosed());
  assert.equal(store.getState().page, PAGES.MARKET);
  assert.deepEqual(store.getState().focus, { kind: 'card', gameId: 'snake' });
});

test('tabs reset detail state; detail is not reachable through a raw page action', function () {
  const store = createStore();
  store.dispatch(detailOpened('jump', PAGES.MARKET));
  store.dispatch(pageChanged(PAGES.MARKET));
  const state = store.getState();
  assert.equal(state.page, PAGES.MARKET);
  assert.equal(state.detail.status, 'idle');
  store.dispatch(pageChanged(PAGES.DETAIL));
  assert.equal(store.getState().page, PAGES.MARKET);
});

test('query, category and search state validate their inputs', function () {
  const store = createStore();
  store.dispatch(queryDraftChanged('Sna'));
  assert.equal(store.getState().ui.draftQuery, 'Sna');
  store.dispatch(queryDraftChanged('x'.repeat(140)));
  assert.equal(store.getState().ui.draftQuery.length, 100);
  store.dispatch(queryApplied('snake'));
  assert.equal(store.getState().ui.query, 'snake');
  store.dispatch({ type: 'ui-category', category: 'puzzle' });
  assert.equal(store.getState().ui.category, 'puzzle');
  store.dispatch({ type: 'ui-category', category: 'nope' });
  assert.equal(store.getState().ui.category, 'puzzle');
  store.dispatch({ type: 'ui-search-open', open: true });
  assert.equal(store.getState().ui.searchOpen, true);
  store.dispatch({ type: 'ui-lightbox', index: 2 });
  assert.equal(store.getState().ui.lightbox, 2);
  store.dispatch({ type: 'ui-clear-filters' });
  assert.equal(store.getState().ui.query, '');
  assert.equal(store.getState().ui.draftQuery, '');
  assert.equal(store.getState().ui.category, 'all');
  store.dispatch({ type: 'ui-lightbox', index: null });
  assert.equal(store.getState().ui.lightbox, null);
});

test('scroll positions are stored per page and validated', function () {
  const store = createStore();
  store.dispatch(scrollSaved('market', 420));
  store.dispatch(scrollSaved('my-games', 88.6));
  assert.deepEqual(store.getState().scroll, { market: 420, 'my-games': 89 });
  store.dispatch(scrollSaved('market', -1));
  store.dispatch(scrollSaved('bogus', 10));
  assert.deepEqual(store.getState().scroll, { market: 420, 'my-games': 89 });
});

test('dialogs cover uninstall confirmation, data deletion and focus return', function () {
  const store = createStore();
  store.dispatch(dialogOpened('uninstall', 'jump', { returnFocus: { kind: 'menu', gameId: 'jump' } }));
  let dialog = store.getState().dialog;
  assert.equal(dialog.kind, 'uninstall');
  assert.equal(dialog.deleteData, false);
  store.dispatch(dialogDeleteDataChanged(true));
  assert.equal(store.getState().dialog.deleteData, true);

  store.dispatch(dialogClosed());
  assert.equal(store.getState().dialog, null);
  assert.deepEqual(store.getState().focus, { kind: 'menu', gameId: 'jump' });

  store.dispatch(dialogOpened('delete-data', 'jump'));
  store.dispatch(dialogConfirmAgain());
  assert.equal(store.getState().dialog.confirmAgain, true);
  store.dispatch(dialogConfirmAgain());
  assert.equal(store.getState().dialog.confirmAgain, true);

  store.dispatch(dialogOpened('uninstall', 'jump'));
  store.dispatch(dialogConfirmAgain());
  assert.equal(store.getState().dialog.confirmAgain, false, 'two-click only applies to delete-data');

  store.dispatch(dialogOpened('install-local', null, { fileName: 'mine.html', file: { name: 'mine.html' } }));
  assert.equal(store.getState().dialog.kind, 'install-local');
  assert.equal(store.getState().dialog.fileName, 'mine.html');

  store.dispatch({ type: 'dialog-open', kind: 'bogus', gameId: 'jump' });
  assert.equal(store.getState().dialog.kind, 'install-local');
  store.dispatch({ type: 'dialog-open', kind: 'uninstall', gameId: '' });
  assert.equal(store.getState().dialog.kind, 'install-local');
});

test('toasts deduplicate by id, cap at three and dismiss by id', function () {
  const store = createStore();
  for (let index = 0; index < 5; index += 1) {
    store.dispatch(toastPushed({ id: 't-' + index, kind: 'success', textKey: 'toast.installed' }));
  }
  assert.equal(store.getState().toasts.length, 3);
  assert.deepEqual(
    store.getState().toasts.map(function id(toast) {
      return toast.id;
    }),
    ['t-2', 't-3', 't-4']
  );
  store.dispatch(toastPushed({ id: 't-4', kind: 'error', textKey: 'toast.installed' }));
  assert.equal(store.getState().toasts.length, 3);
  store.dispatch(toastDismissed('t-3'));
  assert.equal(store.getState().toasts.length, 2);
  store.dispatch(toastDismissed('missing'));
  assert.equal(store.getState().toasts.length, 2);
  store.dispatch({ type: 'toast-push', kind: 'info' });
  assert.equal(store.getState().toasts.length, 2);
});

test('install jobs track stages, percentages, failures and clearing', function () {
  const store = createStore();
  store.dispatch(installStageChanged('jump', 'queued', { operationId: 'op-1' }));
  let job = store.getState().installJobs.jump;
  assert.equal(job.stage, 'queued');
  assert.equal(job.kind, 'install');
  assert.equal(job.operationId, 'op-1');

  store.dispatch(installStageChanged('jump', 'downloading', { percent: 42 }));
  assert.equal(store.getState().installJobs.jump.percent, 42);
  store.dispatch(installStageChanged('jump', 'failed', {
    error: { code: 'GM-5034', retryable: true },
    failureStage: 'download',
    reasonKey: 'detail.install.failed.download',
  }));
  job = store.getState().installJobs.jump;
  assert.equal(job.stage, 'failed');
  assert.equal(job.error.code, 'GM-5034');
  assert.equal(job.failureStage, 'download');
  assert.equal(job.reasonKey, 'detail.install.failed.download');

  store.dispatch({ type: 'install-percent', gameId: 'jump', percent: 180 });
  assert.equal(store.getState().installJobs.jump.percent, 100);

  store.dispatch(installStageChanged('jump', 'bogus'));
  assert.equal(store.getState().installJobs.jump.stage, 'failed');
  store.dispatch(installStageChanged('jump', 'installed', { kind: 'uninstall' }));
  assert.equal(store.getState().installJobs.jump.kind, 'uninstall');

  store.dispatch({ type: 'install-clear', gameId: 'jump' });
  assert.equal(store.getState().installJobs.jump, undefined);
  store.dispatch({ type: 'install-clear', gameId: 'jump' });
  assert.equal(store.getState().installJobs.jump, undefined);
});

test('market payloads carry offline and registry state', function () {
  const store = createStore();
  store.dispatch({
    type: 'market-ready',
    items: [{ id: 'snake', installed: true }],
    refreshedAt: 1000,
    offline: true,
    registry: { state: 'stale', count: 3 },
    source: 'builtin',
  });
  const market = store.getState().market;
  assert.equal(market.status, 'ready');
  assert.equal(market.offline, true);
  assert.equal(market.registry.count, 3);
  assert.equal(market.source, 'builtin');
  store.dispatch({ type: 'market-offline', offline: false });
  assert.equal(store.getState().market.offline, false);
  store.dispatch({ type: 'market-loading' });
  assert.equal(store.getState().market.status, 'loading');
  assert.equal(store.getState().market.games.length, 1, 'cached games survive reloads');
  store.dispatch({ type: 'market-failed', error: { code: 'GM-5031' } });
  assert.equal(store.getState().market.status, 'error');
});

test('focus intents are set, consumed and never duplicated by invalid data', function () {
  const store = createStore();
  store.dispatch({ type: 'focus-set', intent: { kind: 'menu', gameId: 'jump' } });
  assert.deepEqual(store.getState().focus, { kind: 'menu', gameId: 'jump', page: null });
  store.dispatch({ type: 'focus-consume' });
  assert.equal(store.getState().focus, null);
  store.dispatch({ type: 'focus-consume' });
  assert.equal(store.getState().focus, null);
  store.dispatch({ type: 'focus-set', intent: { gameId: 'jump' } });
  assert.equal(store.getState().focus, null);
});

test('reduce stays pure for invalid and unchanged actions', function () {
  const state = createInitialState();
  assert.equal(reduce(state, null), state);
  assert.equal(reduce(state, { type: 'nope' }), state);
  assert.equal(reduce(state, { type: 'ui-category', category: 'all' }), state);
  assert.equal(reduce(state, { type: 'toast-dismiss', id: 'x' }), state);
  assert.equal(reduce(state, { type: 'detail-close' }), state);
  assert.equal(reduce(state, { type: 'install-clear', gameId: 'none' }), state);
});
