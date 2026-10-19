/**
 * Coordinated client actions (API + store + navigation-free).
 *
 * Components call these instead of duplicating fetch/dispatch sequences, which
 * keeps the important transitions unit-testable without React.
 */
import { GM } from '../../shared/src/errors.js';
import { PAGES } from './constants.js';
import { marketLoading, marketReady, marketFailed, marketOffline, marketInvalidated, detailOpened, detailReady, detailFailed, detailScores, detailClosed, installCleared, toastPushed, toastDismissed, healthReady, queryApplied, runtimeStarted, runtimePatched, pausedGameRecorded, completedAcknowledged, leaveCompleted, } from './store.js';
import { normalizeCatalog, normalizeDetailPayload } from './catalog.js';
import { normalizeUiError, uiError } from './ui-errors.js';
import { errorTextKey, isOfflineError } from './errors-text.js';
import { getMarketApi } from './api.js';
import { getInstallManager } from './install-manager.js';
import { reportDiagnostic } from './diagnostics.js';

let toastCounter = 0;
const catalogInflight = new WeakMap();

function registryOffline(registry) {
  if (!registry || typeof registry !== 'object') return false;
  return registry.state === 'offline' || registry.state === 'expired';
}

/**
 * Load the V1 catalog (falls back to `/installed` when `/games` is offline).
 * Errors stay on screen with a manual retry (PRD 9.3.6).
 */
export function loadCatalog(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const target = opts.store;
  if (target && catalogInflight.has(target)) return catalogInflight.get(target);
  const promise = loadCatalogInternal(opts);
  if (target) {
    catalogInflight.set(target, promise);
    promise.then(
      function done() {
        catalogInflight.delete(target);
      },
      function failed() {
        catalogInflight.delete(target);
      }
    );
  }
  return promise;
}

async function fetchCatalogPages(api) {
  const items = [];
  let cursor = null;
  let first = null;
  let pages = 0;
  do {
    const payload = await api.listGames({ limit: 50, cursor: cursor });
    if (first === null) first = payload;
    if (payload && Array.isArray(payload.items)) {
      for (const item of payload.items) items.push(item);
    }
    cursor = payload && typeof payload.nextCursor === 'string' && payload.nextCursor.length > 0 ? payload.nextCursor : null;
    pages += 1;
  } while (cursor !== null && pages < 8);
  return { payload: first, items: items };
}

async function loadCatalogInternal(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const target = opts.store;
  const api = opts.api;
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  if (!target) return { ok: false, error: uiError(GM.HOST_UNAVAILABLE, { retryable: true }) };
  if (!api || typeof api.listGames !== 'function') {
    const error = uiError(GM.HOST_UNAVAILABLE, { retryable: true });
    target.dispatch(marketFailed(error));
    target.dispatch(marketOffline(true));
    return { ok: false, error: error };
  }
  target.dispatch(marketLoading());
  let healthPromise = Promise.resolve(null);
  if (typeof api.health === 'function') {
    healthPromise = Promise.resolve()
      .then(function fetchHealth() {
        return api.health();
      })
      .catch(function ignoreHealth() {
        return null;
      });
  }
  try {
    const page = await fetchCatalogPages(api);
    const payload = page.payload;
    const items = normalizeCatalog(page.items);
    const health = await healthPromise;
    if (health) target.dispatch(healthReady(health));
    const registry = (payload && payload.registry) || (health && health.registry) || null;
    const source = payload && typeof payload.source === 'string' ? payload.source : null;
    const offline = (payload && payload.offline === true) || registryOffline(registry);
    target.dispatch(marketReady(items, now, { offline: offline, registry: registry, source: source }));
    return { ok: true, items: items, offline: offline };
  } catch (error) {
    const normalized = normalizeUiError(error, GM.HOST_UNAVAILABLE);
    const fallback = await loadInstalledFallback(api);
    if (fallback) {
      target.dispatch(marketReady(fallback, now, { offline: true, registry: null, source: 'builtin' }));
      return { ok: true, items: fallback, offline: true };
    }
    target.dispatch(marketFailed(normalized));
    if (isOfflineError(normalized.code)) target.dispatch(marketOffline(true));
    return { ok: false, error: normalized };
  }
}

async function loadInstalledFallback(api) {
  if (!api || typeof api.listInstalled !== 'function') return null;
  try {
    const payload = await api.listInstalled();
    return normalizeCatalog(payload);
  } catch (_error) {
    return null;
  }
}

/** Back-compat alias used by the V0 panel and tests. */
export function refreshMarket(options) {
  return loadCatalog(options);
}

/** Open the detail page and fetch its payload. */
export async function openDetail(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const target = opts.store;
  if (!target || typeof opts.gameId !== 'string' || opts.gameId.length === 0) {
    return { ok: false, error: uiError(GM.INVALID_PARAM) };
  }
  target.dispatch(detailOpened(opts.gameId, opts.returnPage));
  return loadDetail(opts);
}

/** Fetch the detail payload; failures keep the shell and show an error block. */
export async function loadDetail(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const target = opts.store;
  const api = opts.api;
  const gameId = opts.gameId;
  if (!target || typeof gameId !== 'string') return { ok: false, error: uiError(GM.INVALID_PARAM) };
  if (!api || typeof api.getGame !== 'function') {
    const error = uiError(GM.HOST_UNAVAILABLE, { retryable: true });
    target.dispatch(detailFailed(gameId, error));
    return { ok: false, error: error };
  }
  try {
    const payload = await api.getGame(gameId);
    const view = normalizeDetailPayload(payload);
    if (!view) {
      const error = uiError(GM.GAME_NOT_FOUND);
      target.dispatch(detailFailed(gameId, error));
      return { ok: false, error: error };
    }
    target.dispatch(detailReady(gameId, view));
    await loadScores(target, api, gameId, view);
    return { ok: true, view: view };
  } catch (error) {
    const normalized = normalizeUiError(error, GM.HOST_UNAVAILABLE);
    target.dispatch(detailFailed(gameId, normalized));
    return { ok: false, error: normalized };
  }
}

async function loadScores(target, api, gameId, view) {
  if (!view || !view.game || view.game.installed !== true) return;
  if (!api || typeof api.getScores !== 'function') return;
  try {
    const scores = await api.getScores(gameId);
    target.dispatch(detailScores(scores));
  } catch (_error) {
    // The leaderboard preview is optional; never block the detail page on it.
  }
}

/** Return from the detail page to its source list. */
export function closeDetail(target) {
  if (target && typeof target.dispatch === 'function') target.dispatch(detailClosed());
}

/** Set the applied local search term (the input debounces before calling this). */
export function applySearchQuery(target, value) {
  if (!target) return;
  target.dispatch(queryApplied(typeof value === 'string' ? value : ''));
}

/** Push one toast; ids are stable per call for tests. */
export function pushToast(target, toast) {
  if (!target || !toast || typeof toast !== 'object') return null;
  toastCounter += 1;
  const id = typeof toast.id === 'string' && toast.id.length > 0 ? toast.id : 'toast-' + toastCounter;
  const action = {
    type: 'toast-push',
    id: id,
    kind: toast.kind || 'info',
    textKey: toast.textKey || null,
    params: toast.params || {},
    action: toast.action || null,
    at: typeof toast.at === 'number' ? toast.at : Date.now(),
  };
  target.dispatch(toastPushed(action));
  return id;
}

/** Remove one toast by id. */
export function dismissToast(target, id) {
  if (!target) return;
  target.dispatch(toastDismissed(id));
}

/** Create a toast from a GM code. */
export function pushErrorToast(target, code, extras) {
  return pushToast(target, Object.assign({ kind: 'error', textKey: errorTextKey(code) }, extras || {}));
}

function gameFromState(state, gameId) {
  if (state && state.detail && state.detail.view && state.detail.view.game && state.detail.view.game.id === gameId) {
    return state.detail.view.game;
  }
  if (!state || !state.market || !Array.isArray(state.market.games)) return null;
  for (const game of state.market.games) {
    if (game && game.id === gameId) return game;
  }
  return null;
}

/** Launch mode follows the Host's resumable flag (PRD D-004). */
export function launchModeFor(game) {
  return game && game.canContinue === true ? 'resume-paused' : 'start';
}

/** Enter the Runtime page; the Runtime view performs POST launch. */
export function beginGame(target, options) {
  const opts = options && typeof options === 'object' ? options : {};
  if (!target || typeof opts.gameId !== 'string' || opts.gameId.length === 0) return false;
  const mode = opts.mode === 'resume-paused' ? 'resume-paused' : 'start';
  const state = target.getState ? target.getState() : null;
  const sessionId =
    typeof opts.sessionId === 'string' && opts.sessionId.length > 0
      ? opts.sessionId
      : state && typeof state.bindingSessionId === 'string'
        ? state.bindingSessionId
        : null;
  target.dispatch(runtimeStarted(opts.gameId, mode, sessionId, opts.autoResume === true));
  return true;
}

/** Leave the Runtime page after a successful save. */
export function finishLeave(target, options) {
  const opts = options && typeof options === 'object' ? options : {};
  if (!target) return false;
  target.dispatch(leaveCompleted());
  const sessionId = opts.sessionId || null;
  const seq = typeof opts.seq === 'number' ? opts.seq : null;
  if (opts.acknowledge === true && sessionId && seq !== null) {
    target.dispatch(completedAcknowledged(sessionId, seq));
  }
  return true;
}

/** Persist the paused game record used by the resume chip. */
export function recordPausedGame(target, options) {
  const opts = options && typeof options === 'object' ? options : {};
  if (!target) return null;
  const fallbackSession = target.getState ? target.getState().bindingSessionId : null;
  const paused = {
    gameId: opts.gameId,
    reason: opts.reason,
    at: typeof opts.at === 'number' ? opts.at : Date.now(),
    saveStale: opts.saveStale === true,
    sessionId: opts.sessionId || fallbackSession || null,
  };
  target.dispatch(pausedGameRecorded(paused));
  return paused;
}

/** Tell the Host the completed reminder was read; local state clears immediately. */
export async function acknowledgeCompleted(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const target = opts.store;
  const sessionId = opts.sessionId;
  const seq = opts.seq;
  if (!target || typeof sessionId !== 'string' || typeof seq !== 'number') return false;
  target.dispatch(completedAcknowledged(sessionId, seq));
  const api = opts.api;
  if (!api || typeof api.ackAgent !== 'function') return true;
  try {
    await api.ackAgent({ sessionId: sessionId, seq: seq });
    return true;
  } catch (error) {
    reportDiagnostic('agent-ack-failed', error);
    return false;
  }
}

/** Reset the cached market list so the next market mount reloads it. */
export function invalidateMarket(target) {
  if (target) target.dispatch(marketInvalidated());
}

/** Best-effort human game name for menu subtitles and runtime copy. */
export function gameNameFromState(state, gameId) {
  const game = gameFromState(state, gameId);
  if (game && typeof game.name === 'string' && game.name.length > 0) return game.name;
  return gameId;
}

async function refreshAfterMutation(target, api, gameId, now) {
  const catalog = await loadCatalog({ store: target, api: api, now: now });
  let detailOk = true;
  const state = target.getState();
  if (state.page === PAGES.DETAIL && state.detail.gameId === gameId) {
    const detail = await loadDetail({ store: target, api: api, gameId: gameId });
    detailOk = detail.ok === true;
  }
  return { catalog: catalog, detailOk: detailOk };
}

/** Install (or update) one game through the serialized manager. */
export async function startInstall(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const target = opts.store;
  if (!target || typeof opts.gameId !== 'string') return { ok: false, error: uiError(GM.INVALID_PARAM) };
  const manager = opts.manager || getInstallManager();
  const api = opts.api || getMarketApi();
  const stateBefore = target.getState();
  const gameBefore = gameFromState(stateBefore, opts.gameId);
  const wasUpdate = opts.update === true || Boolean(gameBefore && gameBefore.updateAvailable);
  const name = gameNameFromState(stateBefore, opts.gameId);
  const result = await manager.install(opts.gameId, { version: opts.version, operationId: opts.operationId });
  if (!target.getState) return result;
  if (result.ok) {
    const installedVersion = result.data && typeof result.data.version === 'string' ? result.data.version : null;
    pushToast(target, {
      kind: 'success',
      textKey: wasUpdate ? 'toast.updated' : 'toast.installed',
      params: wasUpdate ? { gameName: name, version: installedVersion || '' } : { gameName: name },
      action: wasUpdate
        ? null
        : { kind: 'play', gameId: opts.gameId, mode: 'start' },
      id: opts.toastId,
      at: opts.now,
    });
    const refreshed = await refreshAfterMutation(target, api, opts.gameId, opts.now);
    if (refreshed.catalog.ok && refreshed.detailOk) target.dispatch(installCleared(opts.gameId));
  } else if (result.cancelled) {
    pushToast(target, { kind: 'info', textKey: 'toast.installCancelled', id: opts.cancelToastId, at: opts.now });
  } else if (result.error) {
    reportDiagnostic('install-action-failed', result.error);
  }
  return result;
}

/** Cancel an in-flight install; the manager aborts the request and cleans up. */
export function cancelInstall(gameId, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const manager = opts.manager || getInstallManager();
  return manager.cancel(gameId) === true;
}

/** Local `.html` install after the explicit confirmation dialog. */
export async function installLocalGame(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const target = opts.store;
  if (!target || !opts.file) return { ok: false, error: uiError(GM.UNSUPPORTED_MEDIA_TYPE) };
  const manager = opts.manager || getInstallManager();
  const api = opts.api || getMarketApi();
  const fallbackName = typeof opts.fileName === 'string' && opts.fileName.length > 0 ? opts.fileName : 'game.html';
  const result = await manager.installLocal({ file: opts.file, fileName: fallbackName });
  if (result.ok) {
    const refreshed = await loadCatalog({ store: target, api: api, now: opts.now });
    const gameId = result.data && typeof result.data.gameId === 'string' ? result.data.gameId : null;
    const game = gameId ? gameFromState(target.getState(), gameId) : null;
    pushToast(target, {
      kind: 'success',
      textKey: 'market.localInstall.done',
      params: { gameName: game && game.name ? game.name : fallbackName },
      action: gameId ? { kind: 'play', gameId: gameId, mode: 'start' } : null,
      id: opts.toastId,
      at: opts.now,
    });
    target.dispatch(installCleared(result.gameId));
    if (gameId) target.dispatch(installCleared(gameId));
    void refreshed;
  } else if (!result.cancelled && result.error) {
    pushErrorToast(target, result.error.code, { id: opts.errorToastId, at: opts.now });
  }
  return result;
}

/** Uninstall, with optional save/score deletion (PRD 9.4.4 / D-019). */
export async function uninstallGame(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const target = opts.store;
  if (!target || typeof opts.gameId !== 'string') return { ok: false, error: uiError(GM.INVALID_PARAM) };
  const manager = opts.manager || getInstallManager();
  const api = opts.api || getMarketApi();
  const deleteData = opts.deleteData === true;
  const stateBefore = target.getState();
  const name = gameNameFromState(stateBefore, opts.gameId);
  const wasDetail = stateBefore.page === PAGES.DETAIL && stateBefore.detail.gameId === opts.gameId;
  const result = await manager.uninstall(opts.gameId, { deleteData: deleteData, operationId: opts.operationId });
  if (result.ok) {
    pushToast(target, {
      kind: 'success',
      textKey: deleteData ? 'toast.uninstalledData' : 'toast.uninstalled',
      params: { gameName: name },
      id: opts.toastId,
      at: opts.now,
    });
    await loadCatalog({ store: target, api: api, now: opts.now });
    target.dispatch(installCleared(opts.gameId));
    if (wasDetail) closeDetail(target);
  } else if (!result.cancelled && result.error) {
    pushErrorToast(target, result.error.code, { id: opts.errorToastId, at: opts.now });
  }
  return result;
}

/** Manual registry refresh (PRD 8.8.3); throttling is an informational toast. */
export async function refreshRegistryAction(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const target = opts.store;
  const api = opts.api || getMarketApi();
  if (!target) return { ok: false, error: uiError(GM.HOST_UNAVAILABLE) };
  if (!api || typeof api.refreshRegistry !== 'function') {
    pushErrorToast(target, GM.HOST_UNAVAILABLE, { id: opts.toastId, at: opts.now });
    return { ok: false, error: uiError(GM.HOST_UNAVAILABLE, { retryable: true }) };
  }
  try {
    const data = await api.refreshRegistry({ force: opts.force !== false });
    if (opts.silent !== true) {
      if (data && data.fallback === true) {
        pushToast(target, { kind: 'info', textKey: 'toast.registryFallback', id: opts.toastId, at: opts.now });
      } else {
        pushToast(target, { kind: 'success', textKey: 'toast.registryRefreshed', id: opts.toastId, at: opts.now });
      }
    }
    await loadCatalog({ store: target, api: api, now: opts.now });
    return { ok: true, data: data };
  } catch (error) {
    const normalized = normalizeUiError(error, GM.REGISTRY_UNAVAILABLE);
    if (normalized.code === GM.RATE_LIMITED) {
      if (opts.silent !== true) {
        pushToast(target, { kind: 'info', textKey: 'toast.registryThrottled', id: opts.toastId, at: opts.now });
      }
      await loadCatalog({ store: target, api: api, now: opts.now });
      return { ok: true, throttled: true };
    }
    if (isOfflineError(normalized.code)) target.dispatch(marketOffline(true));
    if (opts.silent !== true) pushErrorToast(target, normalized.code, { id: opts.errorToastId, at: opts.now });
    await loadCatalog({ store: target, api: api, now: opts.now });
    return { ok: false, error: normalized };
  }
}

/** Update one Runtime status field from a controller event. */
export function applyRuntimeEvent(target, event) {
  if (!target || !event || typeof event !== 'object') return;
  switch (event.type) {
    case 'state':
      if (typeof event.state === 'string') target.dispatch(runtimePatched({ state: event.state }));
      break;
    case 'save-status':
      target.dispatch(
        runtimePatched({
          saveStatus: event.status,
          lastSaveAt: typeof event.at === 'number' ? event.at : target.getState().runtime.lastSaveAt,
        })
      );
      break;
    case 'error':
      target.dispatch(
        runtimePatched({
          state: 'error',
          error: normalizeUiError(event.error, GM.INTERNAL),
        })
      );
      break;
    case 'exit':
      target.dispatch(runtimePatched({ state: 'exited' }));
      break;
    default:
      break;
  }
}

/** Page-level guard used by tabs/back navigation. */
export function isPanelPage(page) {
  return page === PAGES.MARKET || page === PAGES.MY_GAMES;
}
