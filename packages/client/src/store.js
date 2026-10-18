/**
 * Module-level client store.
 *
 * The DSH `main` slot is keyed: switching panels unmounts the plugin subtree, so
 * every piece of page/session/runtime state lives here instead of React state.
 * Reducers are pure; timestamps are always passed in by the caller.
 */
import { DSH_SESSION_ID_PATTERN } from '../../shared/src/constants.js';
import { PAGES, RUNTIME_STATES, PAUSED_REASONS } from './constants.js';

const AGENT_STATES = Object.freeze(['idle', 'running', 'waiting-user', 'completed', 'error']);

function initialRuntime() {
  return {
    gameId: null,
    mode: 'start',
    state: 'idle',
    saveStatus: 'idle',
    error: null,
    launchInfo: null,
    bindingSessionId: null,
    attempt: 0,
    lastSaveAt: 0,
  };
}

/** Fresh state; every test starts from here so module singletons never leak. */
export function createInitialState(overrides) {
  const base = {
    page: PAGES.MARKET,
    bindingSessionId: null,
    agent: null,
    agentFetchedAt: 0,
    agentError: null,
    pausedGame: null,
    acknowledged: null,
    waitEntry: { sessionId: null, turnId: null, ignoredTurnId: null },
    runtime: initialRuntime(),
    market: { status: 'idle', games: [], error: null, refreshedAt: 0 },
    surface: { chip: false, runtime: false, activePanelId: null },
  };
  if (!overrides || typeof overrides !== 'object') return base;
  return {
    ...base,
    ...overrides,
    waitEntry: { ...base.waitEntry, ...(overrides.waitEntry || {}) },
    runtime: { ...base.runtime, ...(overrides.runtime || {}) },
    market: { ...base.market, ...(overrides.market || {}) },
    surface: { ...base.surface, ...(overrides.surface || {}) },
  };
}

function isSessionId(value) {
  return typeof value === 'string' && DSH_SESSION_ID_PATTERN.test(value);
}

function isRuntimeState(value) {
  return typeof value === 'string' && RUNTIME_STATES.indexOf(value) !== -1;
}

function isGameId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

function normalizeError(error) {
  if (!error || typeof error !== 'object') return null;
  return {
    code: typeof error.code === 'string' ? error.code : 'GM-5000',
    retryable: error.retryable === true,
    unresponsive: error.unresponsive === true,
  };
}

function sameSnapshot(left, right) {
  if (!left || !right) return false;
  return left.hostEpoch === right.hostEpoch && left.seq === right.seq && left.state === right.state;
}

function snapshotLooksValid(snapshot) {
  return Boolean(
    snapshot &&
      typeof snapshot === 'object' &&
      typeof snapshot.state === 'string' &&
      AGENT_STATES.indexOf(snapshot.state) !== -1 &&
      typeof snapshot.hostEpoch === 'string' &&
      typeof snapshot.seq === 'number'
  );
}

function sessionChangeAllowed(state, sessionId) {
  if (!isSessionId(sessionId)) return false;
  if (state.bindingSessionId === sessionId) return false;
  return true;
}

/** Pure reducer over the state shape above. Unknown actions return the state. */
export function reduce(state, action) {
  if (!action || typeof action.type !== 'string') return state;
  switch (action.type) {
    case 'page': {
      if (action.page !== PAGES.MARKET && action.page !== PAGES.MY_GAMES && action.page !== PAGES.RUNTIME) {
        return state;
      }
      if (state.page === action.page) return state;
      return { ...state, page: action.page };
    }

    case 'session-bind': {
      if (!sessionChangeAllowed(state, action.sessionId)) return state;
      const keepPaused = state.pausedGame && state.pausedGame.sessionId === action.sessionId;
      const keepAck = state.acknowledged && state.acknowledged.sessionId === action.sessionId;
      return {
        ...state,
        bindingSessionId: action.sessionId,
        agent: null,
        agentFetchedAt: 0,
        agentError: null,
        pausedGame: keepPaused ? state.pausedGame : null,
        acknowledged: keepAck ? state.acknowledged : null,
        waitEntry: { sessionId: action.sessionId, turnId: null, ignoredTurnId: null },
      };
    }

    case 'agent-snapshot': {
      const snapshot = action.snapshot;
      if (!snapshotLooksValid(snapshot)) return state;
      if (state.bindingSessionId && snapshot.sessionId && snapshot.sessionId !== state.bindingSessionId) {
        return state;
      }
      const previous = state.agent;
      if (previous && previous.hostEpoch === snapshot.hostEpoch && snapshot.seq < previous.seq) return state;
      const activePhase = snapshot.state === 'running' || snapshot.state === 'waiting-user';
      const nextTurnId =
        typeof snapshot.turnId === 'string' && snapshot.turnId.length > 0
          ? snapshot.turnId
          : activePhase && typeof snapshot.since === 'string' && snapshot.since.length > 0
            ? snapshot.since
            : null;
      const waitEntry =
        nextTurnId === state.waitEntry.turnId
          ? state.waitEntry
          : { ...state.waitEntry, turnId: nextTurnId };
      if (sameSnapshot(previous, snapshot)) {
        return { ...state, agentFetchedAt: action.fetchedAt, agentError: null, waitEntry: waitEntry };
      }
      return {
        ...state,
        agent: snapshot,
        agentFetchedAt: action.fetchedAt,
        agentError: null,
        waitEntry: waitEntry,
      };
    }

    case 'agent-fresh': {
      if (!state.agent) return state;
      return { ...state, agentFetchedAt: action.fetchedAt, agentError: null };
    }

    case 'agent-poll-failed': {
      return { ...state, agentError: normalizeError(action.error) };
    }

    case 'paused-game-record': {
      const paused = action.pausedGame;
      if (!paused || !isGameId(paused.gameId)) return state;
      if (typeof paused.at !== 'number' || !Number.isFinite(paused.at)) return state;
      const reason = PAUSED_REASONS.indexOf(paused.reason) !== -1 ? paused.reason : 'leave';
      return {
        ...state,
        pausedGame: {
          gameId: paused.gameId,
          reason: reason,
          at: paused.at,
          saveStale: paused.saveStale === true,
          sessionId: isSessionId(paused.sessionId) ? paused.sessionId : state.bindingSessionId,
        },
      };
    }

    case 'paused-game-clear': {
      if (!state.pausedGame) return state;
      return { ...state, pausedGame: null };
    }

    case 'turn-ignore': {
      if (typeof action.turnKey !== 'string' || action.turnKey.length === 0) return state;
      const sessionId = isSessionId(action.sessionId) ? action.sessionId : state.bindingSessionId;
      return { ...state, waitEntry: { ...state.waitEntry, sessionId: sessionId, ignoredTurnId: action.turnKey } };
    }

    case 'completed-ack': {
      if (typeof action.seq !== 'number') return state;
      const sessionId = isSessionId(action.sessionId) ? action.sessionId : state.bindingSessionId;
      return { ...state, acknowledged: { sessionId: sessionId, seq: action.seq } };
    }

    case 'market-loading': {
      return {
        ...state,
        market: { ...state.market, status: 'loading', error: null },
      };
    }

    case 'market-ready': {
      const items = Array.isArray(action.items) ? action.items : [];
      return {
        ...state,
        market: {
          status: 'ready',
          games: items,
          error: null,
          refreshedAt: typeof action.refreshedAt === 'number' ? action.refreshedAt : state.market.refreshedAt,
        },
      };
    }

    case 'market-failed': {
      return { ...state, market: { ...state.market, status: 'error', error: normalizeError(action.error) } };
    }

    case 'market-invalidate': {
      if (state.market.status === 'loading') return state;
      return { ...state, market: { ...state.market, status: 'idle', error: null } };
    }

    case 'runtime-start': {
      if (!isGameId(action.gameId)) return state;
      if (action.mode !== 'start' && action.mode !== 'resume-paused') return state;
      return {
        ...state,
        page: PAGES.RUNTIME,
        runtime: {
          ...initialRuntime(),
          gameId: action.gameId,
          mode: action.mode,
          bindingSessionId: isSessionId(action.sessionId) ? action.sessionId : state.bindingSessionId,
          state: 'launching',
          attempt: 0,
        },
      };
    }

    case 'runtime-launch-info': {
      return {
        ...state,
        runtime: { ...state.runtime, launchInfo: action.launchInfo || null, state: 'loading' },
      };
    }

    case 'runtime-patch': {
      const patch = action.patch;
      if (!patch || typeof patch !== 'object') return state;
      const next = { ...state.runtime };
      if (isRuntimeState(patch.state)) next.state = patch.state;
      if (patch.saveStatus === 'idle' || patch.saveStatus === 'saving' || patch.saveStatus === 'saved' || patch.saveStatus === 'failed') {
        next.saveStatus = patch.saveStatus;
      }
      if (typeof patch.lastSaveAt === 'number') next.lastSaveAt = patch.lastSaveAt;
      if (Object.prototype.hasOwnProperty.call(patch, 'error')) next.error = normalizeError(patch.error);
      return { ...state, runtime: next };
    }

    case 'runtime-failed': {
      return {
        ...state,
        runtime: { ...state.runtime, state: 'error', error: normalizeError(action.error) },
      };
    }

    case 'runtime-exited': {
      return {
        ...state,
        runtime: { ...state.runtime, state: 'exited', error: null },
      };
    }

    case 'runtime-retry': {
      if (!state.runtime.gameId) return state;
      return {
        ...state,
        runtime: {
          ...state.runtime,
          state: 'launching',
          error: null,
          launchInfo: null,
          saveStatus: 'idle',
          attempt: state.runtime.attempt + 1,
        },
      };
    }

    case 'runtime-reset': {
      return { ...state, runtime: initialRuntime() };
    }

    case 'leave-complete': {
      return {
        ...state,
        page: PAGES.MARKET,
        runtime: initialRuntime(),
        market: { ...state.market, status: 'idle', error: null },
      };
    }

    case 'surface': {
      const name = action.name;
      if (name !== 'chip' && name !== 'runtime' && name !== 'activePanelId') return state;
      if (state.surface[name] === action.value) return state;
      return { ...state, surface: { ...state.surface, [name]: action.value } };
    }

    default:
      return state;
  }
}

/** Action creators keep components free of stringly-typed dispatch payloads. */
export function pageChanged(page) {
  return { type: 'page', page: page };
}

export function sessionBound(sessionId) {
  return { type: 'session-bind', sessionId: sessionId };
}

export function agentSnapshotReceived(snapshot, fetchedAt) {
  return { type: 'agent-snapshot', snapshot: snapshot, fetchedAt: fetchedAt };
}

export function agentFresh(fetchedAt) {
  return { type: 'agent-fresh', fetchedAt: fetchedAt };
}

export function agentPollFailed(error) {
  return { type: 'agent-poll-failed', error: error };
}

export function pausedGameRecorded(pausedGame) {
  return { type: 'paused-game-record', pausedGame: pausedGame };
}

export function pausedGameCleared() {
  return { type: 'paused-game-clear' };
}

export function turnIgnored(turnKey, sessionId) {
  return { type: 'turn-ignore', turnKey: turnKey, sessionId: sessionId };
}

export function completedAcknowledged(sessionId, seq) {
  return { type: 'completed-ack', sessionId: sessionId, seq: seq };
}

export function marketLoading() {
  return { type: 'market-loading' };
}

export function marketReady(items, refreshedAt) {
  return { type: 'market-ready', items: items, refreshedAt: refreshedAt };
}

export function marketFailed(error) {
  return { type: 'market-failed', error: error };
}

export function marketInvalidated() {
  return { type: 'market-invalidate' };
}

export function runtimeStarted(gameId, mode, sessionId) {
  return { type: 'runtime-start', gameId: gameId, mode: mode, sessionId: sessionId };
}

export function runtimeLaunchInfo(launchInfo) {
  return { type: 'runtime-launch-info', launchInfo: launchInfo };
}

export function runtimePatched(patch) {
  return { type: 'runtime-patch', patch: patch };
}

export function runtimeFailed(error) {
  return { type: 'runtime-failed', error: error };
}

export function runtimeExited(reason) {
  return { type: 'runtime-exited', reason: reason };
}

export function runtimeRetried() {
  return { type: 'runtime-retry' };
}

export function runtimeReset() {
  return { type: 'runtime-reset' };
}

export function leaveCompleted() {
  return { type: 'leave-complete' };
}

export function surfaceChanged(name, value) {
  return { type: 'surface', name: name, value: value };
}

/** Create an isolated store (tests) or the plugin singleton below. */
export function createStore(initialState) {
  let state = createInitialState(initialState);
  const listeners = new Set();
  let dispatching = false;

  function getState() {
    return state;
  }

  function dispatch(action) {
    const next = reduce(state, action);
    if (next === state) return state;
    state = next;
    dispatching = true;
    try {
      const snapshot = [...listeners];
      for (const listener of snapshot) {
        try {
          listener();
        } catch (_error) {
          // A broken subscriber must not stop the remaining subscribers.
        }
      }
    } finally {
      dispatching = false;
    }
    return state;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return function noop() {};
    listeners.add(listener);
    return function unsubscribe() {
      listeners.delete(listener);
    };
  }

  return {
    getState: getState,
    dispatch: dispatch,
    subscribe: subscribe,
    isDispatching: function isDispatching() {
      return dispatching;
    },
  };
}

/** Plugin-wide singleton; survives Game Market panel unmounts. */
export const store = createStore();

/** Select a game from the cached market list. */
export function selectGame(state, gameId) {
  if (!state || !state.market || !Array.isArray(state.market.games)) return null;
  for (const game of state.market.games) {
    if (game && game.id === gameId) return game;
  }
  return null;
}

/** Games that are installed and have a resumable save/session (PRD D-004). */
export function selectResumableGames(state) {
  if (!state || !state.market || !Array.isArray(state.market.games)) return [];
  return state.market.games.filter(function installed(game) {
    return game && game.canContinue === true && game.installed !== false;
  });
}
