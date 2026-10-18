/**
 * Coordinated client actions (API + store + navigation-free).
 *
 * Components call these instead of duplicating fetch/dispatch sequences, which
 * keeps the important transitions unit-testable without React.
 */
import { GM } from '../../shared/src/errors.js';
import { PAGES } from './constants.js';
import { marketLoading, marketReady, marketFailed, marketInvalidated, runtimeStarted, runtimePatched, pausedGameRecorded, pausedGameCleared, completedAcknowledged, leaveCompleted } from './store.js';
import { normalizeUiError, uiError } from './ui-errors.js';
import { reportDiagnostic } from './diagnostics.js';

/**
 * Load the V0 game list. Errors stay on screen with a manual retry (PRD 9.3.6).
 * Returns `{ok, error?}` so callers can keep navigation decisions local.
 */
export async function refreshMarket(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const target = opts.store;
  const api = opts.api;
  if (!target || !api || typeof api.listGames !== 'function') {
    const error = uiError(GM.HOST_UNAVAILABLE, { retryable: true });
    if (target) target.dispatch(marketFailed(error));
    return { ok: false, error: error };
  }
  target.dispatch(marketLoading());
  try {
    const payload = await api.listGames();
    const items = payload && Array.isArray(payload.items) ? payload.items : [];
    target.dispatch(marketReady(items, typeof opts.now === 'number' ? opts.now : Date.now()));
    return { ok: true, items: items };
  } catch (error) {
    const normalized = normalizeUiError(error, GM.HOST_UNAVAILABLE);
    target.dispatch(marketFailed(normalized));
    return { ok: false, error: normalized };
  }
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
  target.dispatch(runtimeStarted(opts.gameId, mode, sessionId));
  target.dispatch(pausedGameCleared());
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
  if (!state || !state.market || !Array.isArray(state.market.games)) return gameId;
  for (const game of state.market.games) {
    if (game && game.id === gameId && typeof game.name === 'string' && game.name.length > 0) return game.name;
  }
  return gameId;
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
