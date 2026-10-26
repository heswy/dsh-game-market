/**
 * Module-level client store.
 *
 * The DSH `main` slot is keyed: switching panels unmounts the plugin subtree, so
 * every piece of page/session/runtime state lives here instead of React state.
 * Reducers are pure; timestamps are always passed in by the caller.
 */
import { DSH_SESSION_ID_PATTERN } from '../../shared/src/constants.js';
import { PAGES, RUNTIME_STATES, PAUSED_REASONS, CATEGORY_FILTERS, CATEGORY_ALL, INSTALL_JOB_STAGES, TOAST_LIMIT, UPDATE_STATES, UPDATE_ACTIVE_STATES, UPDATE_CONTINUES_STATES, UPDATE_PROGRESS_STATES } from './constants.js';

const AGENT_STATES = Object.freeze(['idle', 'running', 'waiting-user', 'completed', 'error']);
const DIALOG_KINDS = Object.freeze(['uninstall', 'delete-data', 'restart', 'install-local', 'platform-update']);

function initialRuntime() {
  return {
    gameId: null,
    mode: 'start',
    autoResume: false,
    state: 'idle',
    saveStatus: 'idle',
    error: null,
    launchInfo: null,
    bindingSessionId: null,
    attempt: 0,
    lastSaveAt: 0,
  };
}

function initialDetail() {
  return {
    gameId: null,
    status: 'idle',
    view: null,
    scores: null,
    error: null,
    returnPage: PAGES.MARKET,
  };
}

function initialUi() {
  return {
    query: '',
    draftQuery: '',
    category: CATEGORY_ALL,
    searchOpen: false,
    lightbox: null,
  };
}

function initialMarket() {
  return {
    status: 'idle',
    games: [],
    error: null,
    refreshedAt: 0,
    offline: false,
    registry: null,
    source: null,
  };
}

/**
 * V1.5 M3 platform-update slice. Raw Host payloads are normalized by
 * `update-state.js`; this slice only stores the latest normalized inspection /
 * observation plus local request flags, never any invented progress.
 */
function initialUpdate() {
  return {
    /** 'idle' | 'loading' | 'ready' | 'error' | 'unsupported' */
    status: 'idle',
    inspection: null,
    operation: null,
    error: null,
    /** Error from a user action (begin/cancel/coordinate), separate from inspection. */
    actionError: null,
    fetchedAt: 0,
    refreshing: false,
    starting: false,
    coordination: null,
    lastClientReportAt: 0,
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
    market: initialMarket(),
    update: initialUpdate(),
    detail: initialDetail(),
    ui: initialUi(),
    scroll: { market: 0, 'my-games': 0 },
    toasts: [],
    dialog: null,
    installJobs: {},
    sessionGames: {},
    focus: null,
    health: null,
    surface: { chip: false, runtime: false, activePanelId: null },
  };
  if (!overrides || typeof overrides !== 'object') return base;
  return {
    ...base,
    ...overrides,
    waitEntry: { ...base.waitEntry, ...(overrides.waitEntry || {}) },
    runtime: { ...base.runtime, ...(overrides.runtime || {}) },
    market: { ...base.market, ...(overrides.market || {}) },
    update: { ...base.update, ...(overrides.update || {}) },
    detail: { ...base.detail, ...(overrides.detail || {}) },
    ui: { ...base.ui, ...(overrides.ui || {}) },
    scroll: { ...base.scroll, ...(overrides.scroll || {}) },
    toasts: Array.isArray(overrides.toasts) ? overrides.toasts : base.toasts,
    installJobs: overrides.installJobs && typeof overrides.installJobs === 'object' ? overrides.installJobs : base.installJobs,
    sessionGames: overrides.sessionGames && typeof overrides.sessionGames === 'object' ? overrides.sessionGames : base.sessionGames,
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

/**
 * Decide what the per-session Game tab should do.
 *
 * - First time in a Session (no game started yet) -> `{ kind: 'market' }`.
 * - After the user has played a game in this Session and returned to work ->
 *   `{ kind: 'resume', gameId }`, so the tab goes back to that game instead of
 *   re-opening the Market. Browsing the Market again stays available through
 *   the sidebar / the game's own back-to-market action.
 */
export function selectGameEntry(state, sessionId) {
  if (!state || !isSessionId(sessionId)) return { kind: 'market' };
  const record = state.sessionGames && state.sessionGames[sessionId];
  if (!record || !isGameId(record.gameId)) return { kind: 'market' };
  const games = state.market && Array.isArray(state.market.games) ? state.market.games : null;
  // Only fall back when the catalog is loaded; an empty list must not block a
  // resume the runtime can still validate.
  if (games && games.length > 0) {
    const game = games.find((item) => item && item.id === record.gameId);
    const available = Boolean(game) && (game.installed === true || game.source === 'builtin' || game.source === 'dev');
    if (!available) return { kind: 'market', staleGameId: record.gameId };
  }
  return { kind: 'resume', gameId: record.gameId };
}

function normalizeError(error) {
  if (!error || typeof error !== 'object') return null;
  return {
    code: typeof error.code === 'string' ? error.code : 'GM-5000',
    retryable: error.retryable === true,
    unresponsive: error.unresponsive === true,
    stage: typeof error.stage === 'string' ? error.stage : null,
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

function isPage(value) {
  return value === PAGES.MARKET || value === PAGES.MY_GAMES || value === PAGES.RUNTIME;
}

function clampText(value, max) {
  if (typeof value !== 'string') return '';
  return value.slice(0, max);
}

function normalizeJobStage(value) {
  return INSTALL_JOB_STAGES.indexOf(value) !== -1 ? value : null;
}

function normalizePercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

/** Accept only observations produced by `update-state.normalizeObservation`. */
function isUpdateObservation(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof value.operationId === 'string' &&
      value.operationId.length > 0 &&
      typeof value.state === 'string' &&
      UPDATE_STATES.indexOf(value.state) !== -1
  );
}

function updateProgressIndex(state) {
  if (!state || typeof state.state !== 'string') return -1;
  return UPDATE_PROGRESS_STATES.indexOf(state.state);
}

/**
 * Never walk the observation backwards: polling `/platform-update` and
 * `/platform-update/observe` race, and a terminal state must not be replaced by
 * an older in-flight progress state. `applied`/`activating` stay monotonic.
 */
function mergeObservation(previous, next) {
  if (!isUpdateObservation(next)) return previous;
  if (!isUpdateObservation(previous) || previous.operationId !== next.operationId) return next;
  const previousTerminal = UPDATE_CONTINUES_STATES.indexOf(previous.state) === -1;
  const nextTerminal = UPDATE_CONTINUES_STATES.indexOf(next.state) === -1;
  if (previousTerminal && !nextTerminal) return previous;
  if (!previousTerminal && !nextTerminal) {
    const previousIndex = updateProgressIndex(previous);
    const nextIndex = updateProgressIndex(next);
    if (previousIndex !== -1 && nextIndex !== -1 && nextIndex < previousIndex) return previous;
  }
  return next;
}

function normalizeUpdateError(error) {
  if (!error || typeof error !== 'object') return null;
  return {
    code: typeof error.code === 'string' && error.code.length > 0 ? error.code : 'GM-5000',
    retryable: error.retryable === true,
  };
}

function normalizeUpdateCoordination(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    operationId: typeof value.operationId === 'string' ? value.operationId : null,
    status: value.status === 'working' || value.status === 'reported' || value.status === 'failed' ? value.status : 'working',
    failedCount: typeof value.failedCount === 'number' && Number.isFinite(value.failedCount) ? value.failedCount : 0,
    at: typeof value.at === 'number' && Number.isFinite(value.at) ? value.at : 0,
  };
}

function toastId(action) {
  if (typeof action.id === 'string' && action.id.length > 0) return action.id;
  return null;
}

/** Pure reducer over the state shape above. Unknown actions return the state. */
export function reduce(state, action) {
  if (!action || typeof action.type !== 'string') return state;
  switch (action.type) {
    case 'page': {
      if (!isPage(action.page)) return state;
      if (state.page === action.page) return state;
      return {
        ...state,
        page: action.page,
        detail: action.page === PAGES.MARKET || action.page === PAGES.MY_GAMES ? initialDetail() : state.detail,
        ui: action.page === PAGES.MARKET || action.page === PAGES.MY_GAMES ? { ...state.ui, lightbox: null } : state.ui,
      };
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
      const registry = action.registry && typeof action.registry === 'object' ? action.registry : state.market.registry;
      return {
        ...state,
        market: {
          status: 'ready',
          games: items,
          error: null,
          refreshedAt: typeof action.refreshedAt === 'number' ? action.refreshedAt : state.market.refreshedAt,
          offline: action.offline === true,
          registry: registry,
          source: typeof action.source === 'string' ? action.source : state.market.source,
        },
      };
    }

    case 'market-failed': {
      return { ...state, market: { ...state.market, status: 'error', error: normalizeError(action.error) } };
    }

    case 'market-offline': {
      const offline = action.offline === true;
      const registry = action.registry && typeof action.registry === 'object' ? action.registry : state.market.registry;
      if (state.market.offline === offline && registry === state.market.registry) return state;
      return { ...state, market: { ...state.market, offline: offline, registry: registry } };
    }

    case 'market-invalidate': {
      if (state.market.status === 'loading') return state;
      return { ...state, market: { ...state.market, status: 'idle', error: null } };
    }

    case 'detail-open': {
      if (!isGameId(action.gameId)) return state;
      const returnPage = action.returnPage === PAGES.MY_GAMES ? PAGES.MY_GAMES : PAGES.MARKET;
      if (state.page === PAGES.DETAIL && state.detail.gameId === action.gameId && state.detail.status !== 'idle') {
        return state;
      }
      return {
        ...state,
        page: PAGES.DETAIL,
        detail: { gameId: action.gameId, status: 'loading', view: null, scores: null, error: null, returnPage: returnPage },
        ui: { ...state.ui, lightbox: null },
      };
    }

    case 'detail-ready': {
      const gameId = action.gameId;
      if (!isGameId(gameId) || state.detail.gameId !== gameId) return state;
      if (!action.view || !action.view.game) return state;
      return {
        ...state,
        detail: { ...state.detail, status: 'ready', view: action.view, error: null },
      };
    }

    case 'detail-failed': {
      const gameId = action.gameId;
      if (!isGameId(gameId) || (state.detail.gameId && state.detail.gameId !== gameId)) return state;
      return {
        ...state,
        detail: { ...state.detail, status: 'error', error: normalizeError(action.error) },
      };
    }

    case 'detail-scores': {
      if (!state.detail.gameId) return state;
      const scores = action.scores && typeof action.scores === 'object' ? action.scores : null;
      if (scores === state.detail.scores) return state;
      return { ...state, detail: { ...state.detail, scores: scores } };
    }

    case 'detail-close': {
      if (state.page !== PAGES.DETAIL) return state;
      const returnPage = state.detail.returnPage === PAGES.MY_GAMES ? PAGES.MY_GAMES : PAGES.MARKET;
      const gameId = state.detail.gameId;
      return {
        ...state,
        page: returnPage,
        detail: initialDetail(),
        ui: { ...state.ui, lightbox: null },
        focus: gameId ? { kind: returnPage === PAGES.MY_GAMES ? 'row' : 'card', gameId: gameId } : state.focus,
      };
    }

    case 'ui-query-draft': {
      const value = clampText(action.value, 100);
      if (value === state.ui.draftQuery) return state;
      return { ...state, ui: { ...state.ui, draftQuery: value } };
    }

    case 'ui-query-apply': {
      const value = clampText(action.query, 100);
      if (value === state.ui.query) return state;
      return { ...state, ui: { ...state.ui, query: value } };
    }

    case 'ui-category': {
      const value = action.category;
      if (CATEGORY_FILTERS.indexOf(value) === -1) return state;
      if (value === state.ui.category) return state;
      return { ...state, ui: { ...state.ui, category: value } };
    }

    case 'ui-search-open': {
      const open = action.open === true;
      if (open === state.ui.searchOpen) return state;
      return { ...state, ui: { ...state.ui, searchOpen: open } };
    }

    case 'ui-clear-filters': {
      if (state.ui.query.length === 0 && state.ui.draftQuery.length === 0 && state.ui.category === CATEGORY_ALL) return state;
      return { ...state, ui: { ...state.ui, query: '', draftQuery: '', category: CATEGORY_ALL } };
    }

    case 'ui-lightbox': {
      const index = typeof action.index === 'number' && action.index >= 0 ? Math.floor(action.index) : null;
      if (index === null) {
        if (state.ui.lightbox === null) return state;
        return { ...state, ui: { ...state.ui, lightbox: null } };
      }
      return { ...state, ui: { ...state.ui, lightbox: index } };
    }

    case 'scroll-save': {
      const page = action.page;
      if (page !== 'market' && page !== 'my-games') return state;
      if (typeof action.top !== 'number' || !Number.isFinite(action.top) || action.top < 0) return state;
      const top = Math.round(action.top);
      if (state.scroll[page] === top) return state;
      return { ...state, scroll: { ...state.scroll, [page]: top } };
    }

    case 'dialog-open': {
      if (DIALOG_KINDS.indexOf(action.kind) === -1) return state;
      if (!isGameId(action.gameId) && action.kind !== 'install-local' && action.kind !== 'platform-update') return state;
      return {
        ...state,
        dialog: {
          kind: action.kind,
          gameId: isGameId(action.gameId) ? action.gameId : null,
          deleteData: false,
          confirmAgain: false,
          busy: false,
          fileName: typeof action.fileName === 'string' ? action.fileName : null,
          file: action.file || null,
          fileSize: typeof action.fileSize === 'number' && Number.isFinite(action.fileSize) ? action.fileSize : null,
          fileSizeLabel: typeof action.fileSizeLabel === 'string' ? action.fileSizeLabel : null,
          format:
            action.format === 'html-v1' || action.format === 'asset-zip-v2' ? action.format : null,
          formatLabel: typeof action.formatLabel === 'string' ? action.formatLabel : null,
          overwrite: action.overwrite && typeof action.overwrite === 'object' ? action.overwrite : null,
          returnFocus: action.returnFocus && typeof action.returnFocus === 'object' ? action.returnFocus : null,
          // V1.5 M3 platform update confirmation (all fields copied verbatim
          // from the verified inspection; the dialog never invents a target).
          targetId: typeof action.targetId === 'string' ? action.targetId : null,
          targetVersion: typeof action.targetVersion === 'string' ? action.targetVersion : null,
          targetCommit: typeof action.targetCommit === 'string' ? action.targetCommit : null,
          currentVersion: typeof action.currentVersion === 'string' ? action.currentVersion : null,
          channel: typeof action.channel === 'string' ? action.channel : null,
          restartPossible: action.restartPossible === true,
        },
      };
    }

    case 'dialog-delete-data': {
      if (!state.dialog) return state;
      const value = action.value === true;
      if (value === state.dialog.deleteData) return state;
      return { ...state, dialog: { ...state.dialog, deleteData: value } };
    }

    case 'dialog-confirm-again': {
      if (!state.dialog || state.dialog.kind !== 'delete-data' || state.dialog.confirmAgain === true) return state;
      return { ...state, dialog: { ...state.dialog, confirmAgain: true } };
    }

    case 'dialog-busy': {
      if (!state.dialog) return state;
      const busy = action.busy === true;
      if (busy === state.dialog.busy) return state;
      return { ...state, dialog: { ...state.dialog, busy: busy } };
    }

    case 'dialog-close': {
      if (!state.dialog) return state;
      const dialog = state.dialog;
      const focus =
        dialog.returnFocus && dialog.returnFocus.kind
          ? dialog.returnFocus
          : dialog.gameId
            ? { kind: 'menu', gameId: dialog.gameId }
            : state.focus;
      return { ...state, dialog: null, focus: focus };
    }

    case 'toast-push': {
      const id = toastId(action);
      if (id === null) return state;
      const toast = {
        id: id,
        kind: typeof action.kind === 'string' ? action.kind : 'info',
        textKey: typeof action.textKey === 'string' ? action.textKey : null,
        params: action.params && typeof action.params === 'object' ? action.params : {},
        action: action.action && typeof action.action === 'object' ? action.action : null,
        at: typeof action.at === 'number' ? action.at : 0,
      };
      if (state.toasts.some(function same(candidate) {
        return candidate.id === id;
      })) {
        return state;
      }
      const next = state.toasts.concat([toast]);
      return { ...state, toasts: next.slice(Math.max(0, next.length - TOAST_LIMIT)) };
    }

    case 'toast-dismiss': {
      if (!Array.isArray(state.toasts) || state.toasts.length === 0) return state;
      const next = state.toasts.filter(function keep(toast) {
        return toast.id !== action.id;
      });
      if (next.length === state.toasts.length) return state;
      return { ...state, toasts: next };
    }

    case 'install-stage': {
      if (!isGameId(action.gameId)) return state;
      const stage = normalizeJobStage(action.stage);
      if (stage === null) return state;
      const previous = state.installJobs[action.gameId] || null;
      const job = {
        gameId: action.gameId,
        kind: action.kind === 'uninstall' ? 'uninstall' : 'install',
        stage: stage,
        percent: Object.prototype.hasOwnProperty.call(action, 'percent') ? normalizePercent(action.percent) : previous ? previous.percent : null,
        operationId: typeof action.operationId === 'string' ? action.operationId : previous ? previous.operationId : null,
        error: Object.prototype.hasOwnProperty.call(action, 'error') ? normalizeError(action.error) : stage === 'failed' ? previous && previous.error : null,
        failureStage: typeof action.failureStage === 'string' ? action.failureStage : null,
        reasonKey: typeof action.reasonKey === 'string' ? action.reasonKey : null,
        startedAt: previous && previous.stage !== 'installed' ? previous.startedAt : typeof action.at === 'number' ? action.at : 0,
      };
      if (previous && previous.stage === job.stage && previous.percent === job.percent && previous.error === job.error && previous.reasonKey === job.reasonKey) {
        return state;
      }
      return { ...state, installJobs: { ...state.installJobs, [action.gameId]: job } };
    }

    case 'install-percent': {
      if (!isGameId(action.gameId)) return state;
      const job = state.installJobs[action.gameId];
      if (!job) return state;
      const percent = normalizePercent(action.percent);
      if (percent === job.percent) return state;
      return { ...state, installJobs: { ...state.installJobs, [action.gameId]: { ...job, percent: percent } } };
    }

    case 'install-clear': {
      if (!isGameId(action.gameId)) return state;
      if (!state.installJobs[action.gameId]) return state;
      const next = { ...state.installJobs };
      delete next[action.gameId];
      return { ...state, installJobs: next };
    }

    case 'focus-set': {
      const intent = action.intent;
      if (!intent || typeof intent !== 'object' || typeof intent.kind !== 'string') return state;
      return { ...state, focus: { kind: intent.kind, gameId: isGameId(intent.gameId) ? intent.gameId : null, page: intent.page || null } };
    }

    case 'focus-consume': {
      if (!state.focus) return state;
      return { ...state, focus: null };
    }

    case 'health-ready': {
      const health = action.health && typeof action.health === 'object' ? action.health : null;
      if (!health) return state;
      return { ...state, health: health };
    }

    case 'update-inspect-start': {
      if (state.update.status === 'unsupported') return state;
      const status = state.update.inspection === null ? 'loading' : state.update.status;
      if (status === state.update.status) return state;
      return { ...state, update: { ...state.update, status: status } };
    }

    case 'update-action-failed': {
      const error = normalizeUpdateError(action.error);
      if (error === null) return state;
      return { ...state, update: { ...state.update, actionError: error, starting: false } };
    }

    case 'update-action-cleared': {
      if (state.update.actionError === null && state.update.starting === false) return state;
      return { ...state, update: { ...state.update, actionError: null, starting: false } };
    }

    case 'update-inspect-ready': {
      const inspection = action.inspection && typeof action.inspection === 'object' ? action.inspection : null;
      if (!inspection) return state;
      const operation = mergeObservation(state.update.operation, inspection.operation);
      return {
        ...state,
        update: {
          ...state.update,
          status: 'ready',
          inspection: inspection,
          operation: operation,
          error: null,
          actionError: null,
          fetchedAt: typeof action.at === 'number' ? action.at : state.update.fetchedAt,
        },
      };
    }

    case 'update-inspect-failed': {
      const error = normalizeUpdateError(action.error);
      if (state.update.inspection !== null) {
        // Keep the last successful inspection visible (offline/stale state).
        return { ...state, update: { ...state.update, error: error } };
      }
      return { ...state, update: { ...state.update, status: 'error', error: error } };
    }

    case 'update-unsupported': {
      if (state.update.status === 'unsupported' && state.update.inspection === null) return state;
      return { ...state, update: { ...state.update, status: 'unsupported', inspection: null, operation: null, error: null } };
    }

    case 'update-refresh-start': {
      if (state.update.refreshing) return state;
      return { ...state, update: { ...state.update, refreshing: true } };
    }

    case 'update-refresh-done': {
      const inspection = action.inspection && typeof action.inspection === 'object' ? action.inspection : null;
      const operation = inspection ? mergeObservation(state.update.operation, inspection.operation) : state.update.operation;
      return {
        ...state,
        update: {
          ...state.update,
          refreshing: false,
          status: inspection ? 'ready' : state.update.status,
          inspection: inspection || state.update.inspection,
          operation: operation,
          fetchedAt: typeof action.at === 'number' ? action.at : state.update.fetchedAt,
        },
      };
    }

    case 'update-starting': {
      const starting = action.starting === true;
      if (starting === state.update.starting) return state;
      return { ...state, update: { ...state.update, starting: starting, actionError: starting ? null : state.update.actionError } };
    }

    case 'update-operation': {
      const operation = mergeObservation(state.update.operation, action.operation);
      if (operation === state.update.operation && state.update.starting === false) return state;
      return {
        ...state,
        update: {
          ...state.update,
          operation: operation,
          starting: false,
          fetchedAt: typeof action.at === 'number' ? action.at : state.update.fetchedAt,
        },
      };
    }

    case 'update-operation-reset': {
      if (state.update.operation === null) return state;
      return { ...state, update: { ...state.update, operation: null } };
    }

    case 'update-coordination': {
      const coordination = normalizeUpdateCoordination(action.coordination);
      if (coordination === null) return state;
      return { ...state, update: { ...state.update, coordination: coordination } };
    }

    case 'update-client-reported': {
      return { ...state, update: { ...state.update, lastClientReportAt: typeof action.at === 'number' ? action.at : state.update.lastClientReportAt } };
    }

    case 'update-reset': {
      return { ...state, update: initialUpdate() };
    }

    case 'runtime-start': {
      if (!isGameId(action.gameId)) return state;
      if (action.mode !== 'start' && action.mode !== 'resume-paused') return state;
      const sessionId = isSessionId(action.sessionId) ? action.sessionId : state.bindingSessionId;
      return {
        ...state,
        page: PAGES.RUNTIME,
        runtime: {
          ...initialRuntime(),
          gameId: action.gameId,
          mode: action.mode,
          autoResume: action.autoResume === true,
          bindingSessionId: sessionId,
          state: 'launching',
          attempt: 0,
        },
        // Remember the last game per Session so the Game tab can return to it.
        sessionGames: isSessionId(sessionId)
          ? { ...state.sessionGames, [sessionId]: { gameId: action.gameId } }
          : state.sessionGames,
        ui: { ...state.ui, lightbox: null },
      };
    }

    case 'runtime-launch-info': {
      return {
        ...state,
        runtime: { ...state.runtime, launchInfo: action.launchInfo || null, state: 'loading' },
      };
    }

    case 'runtime-launch-refresh': {
      const patch = action.patch;
      if (!patch || typeof patch !== 'object') return state;
      if (!state.runtime.launchInfo) return state;
      return {
        ...state,
        runtime: { ...state.runtime, launchInfo: { ...state.runtime.launchInfo, ...patch } },
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
        focus: { kind: 'heading', page: PAGES.MARKET },
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

export function marketReady(items, refreshedAt, extra) {
  return Object.assign({ type: 'market-ready', items: items, refreshedAt: refreshedAt }, extra || {});
}

export function marketFailed(error) {
  return { type: 'market-failed', error: error };
}

export function marketInvalidated() {
  return { type: 'market-invalidate' };
}

export function marketOffline(offline, registry) {
  return { type: 'market-offline', offline: offline, registry: registry };
}

export function detailOpened(gameId, returnPage) {
  return { type: 'detail-open', gameId: gameId, returnPage: returnPage };
}

export function detailReady(gameId, view) {
  return { type: 'detail-ready', gameId: gameId, view: view };
}

export function detailFailed(gameId, error) {
  return { type: 'detail-failed', gameId: gameId, error: error };
}

export function detailScores(scores) {
  return { type: 'detail-scores', scores: scores };
}

export function detailClosed() {
  return { type: 'detail-close' };
}

export function queryDraftChanged(value) {
  return { type: 'ui-query-draft', value: value };
}

export function queryApplied(query) {
  return { type: 'ui-query-apply', query: query };
}

export function categoryChanged(category) {
  return { type: 'ui-category', category: category };
}

export function searchOpenChanged(open) {
  return { type: 'ui-search-open', open: open };
}

export function filtersCleared() {
  return { type: 'ui-clear-filters' };
}

export function lightboxChanged(index) {
  return { type: 'ui-lightbox', index: index };
}

export function scrollSaved(page, top) {
  return { type: 'scroll-save', page: page, top: top };
}

export function dialogOpened(kind, gameId, extra) {
  return Object.assign({ type: 'dialog-open', kind: kind, gameId: gameId }, extra || {});
}

export function dialogDeleteDataChanged(value) {
  return { type: 'dialog-delete-data', value: value };
}

export function dialogConfirmAgain() {
  return { type: 'dialog-confirm-again' };
}

export function dialogBusyChanged(busy) {
  return { type: 'dialog-busy', busy: busy };
}

export function dialogClosed() {
  return { type: 'dialog-close' };
}

export function toastPushed(toast) {
  return Object.assign({ type: 'toast-push' }, toast || {});
}

export function toastDismissed(id) {
  return { type: 'toast-dismiss', id: id };
}

export function installStageChanged(gameId, stage, extra) {
  return Object.assign({ type: 'install-stage', gameId: gameId, stage: stage }, extra || {});
}

export function installPercentChanged(gameId, percent) {
  return { type: 'install-percent', gameId: gameId, percent: percent };
}

export function installCleared(gameId) {
  return { type: 'install-clear', gameId: gameId };
}

export function focusSet(intent) {
  return { type: 'focus-set', intent: intent };
}

export function focusConsumed() {
  return { type: 'focus-consume' };
}

export function healthReady(health) {
  return { type: 'health-ready', health: health };
}

export function updateInspectStarted() {
  return { type: 'update-inspect-start' };
}

export function updateInspectReady(inspection, at) {
  return { type: 'update-inspect-ready', inspection: inspection, at: at };
}

export function updateInspectFailed(error) {
  return { type: 'update-inspect-failed', error: error };
}

export function updateUnsupported() {
  return { type: 'update-unsupported' };
}

export function updateRefreshStarted() {
  return { type: 'update-refresh-start' };
}

export function updateRefreshFinished(at, inspection) {
  return { type: 'update-refresh-done', at: at, inspection: inspection || null };
}

export function updateStarting(starting) {
  return { type: 'update-starting', starting: starting === true };
}

export function updateActionFailed(error) {
  return { type: 'update-action-failed', error: error };
}

export function updateActionCleared() {
  return { type: 'update-action-cleared' };
}

export function updateObservation(operation, at) {
  return { type: 'update-operation', operation: operation, at: at };
}

export function updateObservationCleared() {
  return { type: 'update-operation-reset' };
}

export function updateCoordinated(coordination) {
  return { type: 'update-coordination', coordination: coordination };
}

export function updateClientReported(at) {
  return { type: 'update-client-reported', at: at };
}

export function updateReset() {
  return { type: 'update-reset' };
}

export function runtimeStarted(gameId, mode, sessionId, autoResume) {
  return { type: 'runtime-start', gameId: gameId, mode: mode, sessionId: sessionId, autoResume: autoResume === true };
}

export function runtimeLaunchInfo(launchInfo) {
  return { type: 'runtime-launch-info', launchInfo: launchInfo };
}

/** Merge refreshed launch metadata (e.g. a renewed resourceTtlMs) in place. */
export function runtimeLaunchInfoRefreshed(patch) {
  return { type: 'runtime-launch-refresh', patch: patch };
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

/** Installed games for My Games, including built-ins. */
export function selectInstalledGames(state) {
  if (!state || !state.market || !Array.isArray(state.market.games)) return [];
  return state.market.games.filter(function installed(game) {
    return game && game.installed === true;
  });
}

/** Job for one game (install/update/uninstall progress). */
export function selectInstallJob(state, gameId) {
  if (!state || !state.installJobs || typeof state.installJobs !== 'object') return null;
  return state.installJobs[gameId] || null;
}

/** Active dialog (or null). */
export function selectDialog(state) {
  return state && state.dialog ? state.dialog : null;
}

/** V1.5 M3 platform-update slice (see update-state.js for the projection). */
export function selectUpdateState(state) {
  return state && state.update ? state.update : null;
}
