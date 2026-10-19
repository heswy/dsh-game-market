/**
 * Pure waiting-entry and sidebar-status derivations.
 *
 * Chip priority: waiting > resume > running > hidden (PRD 9.1.2).
 * The Agent snapshot is authoritative; `pausedGame` is local client state and
 * survives a briefly unavailable Host.
 */
import { TIMING } from '../../shared/src/constants.js';
import { MAIN_PANEL_KEY } from './constants.js';

export const RESUME_WINDOW_MS = 10 * 60 * 1000;

export const CHIP_STATUS = Object.freeze({
  HIDDEN: 'hidden',
  RUNNING: 'running',
  RESUME: 'resume',
  WAITING: 'waiting',
});

export const SIDEBAR_STATUS = Object.freeze({
  HIDDEN: 'hidden',
  RUNNING: 'running',
  WAITING: 'waiting',
  COMPLETED: 'completed',
  RESUME: 'resume',
  ERROR: 'error',
});

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Snapshot freshness uses the fetch timestamp, not the Host `updatedAt`. */
export function isAgentFresh(fetchedAt, now, staleMs) {
  if (!finiteNumber(fetchedAt) || !finiteNumber(now)) return false;
  if (fetchedAt <= 0) return false;
  const limit = finiteNumber(staleMs) ? staleMs : TIMING.agentStaleMs;
  return now - fetchedAt <= limit;
}

/** A snapshot without a sessionId is treated as belonging to the binding. */
export function agentMatchesSession(agent, sessionId) {
  if (!agent || typeof agent !== 'object') return false;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return true;
  if (typeof agent.sessionId !== 'string' || agent.sessionId.length === 0) return true;
  return agent.sessionId === sessionId;
}

/**
 * Ignore key for one turn. `turnId` is preferred; older Host builds may omit it,
 * in which case the state `since` timestamp is the stable fallback (PRD 9.1.5).
 */
export function deriveTurnKey(agent) {
  if (!agent || typeof agent !== 'object') return null;
  if (typeof agent.turnId === 'string' && agent.turnId.length > 0) return agent.turnId;
  if (typeof agent.since === 'string' && agent.since.length > 0) return agent.since;
  if (typeof agent.updatedAt === 'string' && agent.updatedAt.length > 0) return agent.updatedAt;
  return null;
}

/** A paused game is resumable in the chip for ten minutes (PRD 9.1.2). */
export function activePausedGame(pausedGame, now, windowMs) {
  if (!pausedGame || typeof pausedGame !== 'object') return null;
  if (typeof pausedGame.gameId !== 'string' || pausedGame.gameId.length === 0) return null;
  if (!finiteNumber(pausedGame.at)) return null;
  const limit = finiteNumber(windowMs) ? windowMs : RESUME_WINDOW_MS;
  let elapsed = now - pausedGame.at;
  if (!Number.isFinite(elapsed)) return null;
  if (elapsed < 0) elapsed = 0;
  return elapsed <= limit ? pausedGame : null;
}

/** A paused game only belongs to the Session that left it (D-006). */
export function pausedBelongsToSession(pausedGame, sessionId) {
  if (!pausedGame || typeof pausedGame !== 'object') return false;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return true;
  if (typeof pausedGame.sessionId !== 'string' || pausedGame.sessionId.length === 0) return true;
  return pausedGame.sessionId === sessionId;
}

/** First installed game with an unfinished Session + save (PRD D-004). */
export function findResumableGame(state, now, sessionId) {
  const paused = activePausedGame(state && state.pausedGame, now);
  if (paused && pausedBelongsToSession(paused, sessionId)) {
    return { gameId: paused.gameId, source: 'paused', at: paused.at };
  }
  const games = state && state.market && Array.isArray(state.market.games) ? state.market.games : [];
  const candidates = games
    .filter(function installed(game) {
      return game && typeof game.id === 'string' && game.canContinue === true && game.installed !== false;
    })
    .sort(function byLastPlayed(left, right) {
      const a = Date.parse(left.lastPlayedAt || '') || 0;
      const b = Date.parse(right.lastPlayedAt || '') || 0;
      return b - a;
    });
  if (candidates.length === 0) return null;
  return { gameId: candidates[0].id, source: 'save', at: candidates[0].lastPlayedAt || null };
}

/** Waiting label category from the Host snapshot. */
export function waitingKind(agent) {
  if (!agent || typeof agent !== 'object') return 'generic';
  if (typeof agent.labelKey === 'string') {
    if (agent.labelKey.indexOf('waiting.approval') !== -1) return 'approval';
    if (agent.labelKey.indexOf('waiting.question') !== -1) return 'question';
  }
  if (agent.source === 'approval') return 'approval';
  if (agent.source === 'question') return 'question';
  return 'generic';
}

function turnIgnored(state, turnKey, sessionId) {
  if (!turnKey) return false;
  const waitEntry = state && state.waitEntry ? state.waitEntry : null;
  if (!waitEntry || waitEntry.ignoredTurnId !== turnKey) return false;
  if (!waitEntry.sessionId || !sessionId) return true;
  return waitEntry.sessionId === sessionId;
}

function baseChip(sessionId) {
  return {
    status: CHIP_STATUS.HIDDEN,
    reason: 'none',
    sessionId: typeof sessionId === 'string' ? sessionId : null,
    turnKey: null,
    waitingKind: null,
    canResume: false,
    resumeGameId: null,
    resumeSource: null,
    runningSinceMs: 0,
    snapshotFresh: false,
  };
}

/**
 * Derive the chip state.
 *
 * @param {object} state module store state
 * @param {number} [now] monotonic wall clock used for thresholds
 * @param {{sessionId?:string|null, activePanelId?:string|null, staleMs?:number,
 *   thresholdMs?:number, resumeWindowMs?:number}} [options]
 */
export function deriveChipState(state, now, options) {
  const clock = finiteNumber(now) ? now : Date.now();
  const opts = options && typeof options === 'object' ? options : {};
  const sessionId = Object.prototype.hasOwnProperty.call(opts, 'sessionId') ? opts.sessionId : state.bindingSessionId;
  const activePanelId = Object.prototype.hasOwnProperty.call(opts, 'activePanelId')
    ? opts.activePanelId
    : state.surface && state.surface.activePanelId;
  const result = baseChip(sessionId);

  if (activePanelId === MAIN_PANEL_KEY) {
    return { ...result, reason: 'panel-active' };
  }

  const agent = state.agent;
  const fresh = isAgentFresh(state.agentFetchedAt, clock, opts.staleMs);
  const matches = agentMatchesSession(agent, sessionId);
  result.snapshotFresh = fresh && matches;

  if (fresh && matches && agent.state === 'waiting-user') {
    return {
      ...result,
      status: CHIP_STATUS.WAITING,
      reason: 'agent-waiting',
      turnKey: deriveTurnKey(agent),
      waitingKind: waitingKind(agent),
    };
  }

  const paused = activePausedGame(state.pausedGame, clock, opts.resumeWindowMs);
  if (paused && pausedBelongsToSession(paused, sessionId)) {
    return {
      ...result,
      status: CHIP_STATUS.RESUME,
      reason: 'paused-game',
      canResume: true,
      resumeGameId: paused.gameId,
      resumeSource: 'paused',
    };
  }

  if (fresh && matches && agent.state === 'running') {
    const sinceMs = Date.parse(agent.since);
    const elapsed = Number.isFinite(sinceMs) ? clock - sinceMs : NaN;
    const turnKey = deriveTurnKey(agent);
    const threshold = finiteNumber(opts.thresholdMs) ? opts.thresholdMs : TIMING.waitEntryThresholdMs;
    const ignored = turnIgnored(state, turnKey, sessionId);
    if (Number.isFinite(elapsed) && elapsed >= threshold && !ignored) {
      const resumable = findResumableGame(state, clock, sessionId);
      return {
        ...result,
        status: CHIP_STATUS.RUNNING,
        reason: 'agent-running',
        turnKey: turnKey,
        runningSinceMs: elapsed,
        canResume: resumable !== null,
        resumeGameId: resumable ? resumable.gameId : null,
        resumeSource: resumable ? resumable.source : null,
      };
    }
  }

  return result;
}

function agentAcknowledged(state, agent) {
  const ack = state && state.acknowledged;
  if (!ack || !agent) return false;
  if (ack.sessionId && agent.sessionId && ack.sessionId !== agent.sessionId) return false;
  return typeof ack.seq === 'number' && typeof agent.seq === 'number' && ack.seq >= agent.seq;
}

/**
 * Conversation Game-tab badge (CR: sidebar no longer carries state).
 * Only states worth surfacing are returned; a quiet running game stays plain.
 * @param {object} state module store state
 * @param {number} [now]
 * @param {{sessionId?:string|null, resumeWindowMs?:number, staleMs?:number}} [options]
 * @returns {'waiting'|'error'|'completed'|'resume'|null}
 */
export function deriveTabStatus(state, now, options) {
  const clock = finiteNumber(now) ? now : Date.now();
  const opts = options && typeof options === 'object' ? options : {};
  const sessionId = Object.prototype.hasOwnProperty.call(opts, 'sessionId')
    ? opts.sessionId
    : state.bindingSessionId;
  const agent = state && state.agent ? state.agent : null;
  const fresh = isAgentFresh(state && state.agentFetchedAt, clock, opts.staleMs);
  const matches = agentMatchesSession(agent, sessionId);
  const trusted = fresh && matches;

  if (trusted && agent.state === 'waiting-user') return 'waiting';
  if (trusted && agent.state === 'error') return 'error';
  if (trusted && agent.state === 'completed' && !agentAcknowledged(state, agent)) return 'completed';
  const paused = activePausedGame(state && state.pausedGame, clock, opts.resumeWindowMs);
  if (paused && pausedBelongsToSession(paused, sessionId)) return 'resume';
  return null;
}

/**
 * Sidebar dot: waiting > error > completed-unread > running > resume > hidden.
 * `dshStatus` is the optional `useSessionStatus` value for the current Session;
 * it supplements the Host snapshot while the latter is still arriving.
 */
export function deriveSidebarStatus(state, now, options) {
  const clock = finiteNumber(now) ? now : Date.now();
  const opts = options && typeof options === 'object' ? options : {};
  const sessionId = Object.prototype.hasOwnProperty.call(opts, 'sessionId') ? opts.sessionId : state.bindingSessionId;
  const dshStatus = opts.dshStatus && typeof opts.dshStatus === 'object' ? opts.dshStatus : null;
  const agent = state.agent;
  const fresh = isAgentFresh(state.agentFetchedAt, clock, opts.staleMs);
  const matches = agentMatchesSession(agent, sessionId);
  const trusted = fresh && matches;

  if (trusted && agent.state === 'waiting-user') return SIDEBAR_STATUS.WAITING;
  if (dshStatus && dshStatus.pendingInteraction) return SIDEBAR_STATUS.WAITING;
  if (trusted && agent.state === 'error') return SIDEBAR_STATUS.ERROR;
  if (trusted && agent.state === 'completed' && !agentAcknowledged(state, agent)) {
    return SIDEBAR_STATUS.COMPLETED;
  }
  if (dshStatus && dshStatus.completionUnread === true && !agentAcknowledged(state, agent)) {
    return SIDEBAR_STATUS.COMPLETED;
  }

  if (trusted && agent.state === 'running') {
    if (opts.activePanelId === MAIN_PANEL_KEY) return SIDEBAR_STATUS.HIDDEN;
    const sinceMs = Date.parse(agent.since);
    const elapsed = Number.isFinite(sinceMs) ? clock - sinceMs : NaN;
    const turnKey = deriveTurnKey(agent);
    const threshold = finiteNumber(opts.thresholdMs) ? opts.thresholdMs : TIMING.waitEntryThresholdMs;
    if (Number.isFinite(elapsed) && elapsed >= threshold && !turnIgnored(state, turnKey, sessionId)) {
      return SIDEBAR_STATUS.RUNNING;
    }
  }

  const paused = activePausedGame(state.pausedGame, clock, opts.resumeWindowMs);
  if (paused && pausedBelongsToSession(paused, sessionId)) return SIDEBAR_STATUS.RESUME;
  return SIDEBAR_STATUS.HIDDEN;
}

/** Map the sidebar state to its aria-label key (host label is static). */
export function sidebarLabelKey(status) {
  switch (status) {
    case SIDEBAR_STATUS.WAITING:
      return 'entry.sidebar.waiting';
    case SIDEBAR_STATUS.ERROR:
      return 'entry.sidebar.error';
    case SIDEBAR_STATUS.COMPLETED:
      return 'entry.sidebar.completed';
    case SIDEBAR_STATUS.RUNNING:
      return 'entry.sidebar.running';
    case SIDEBAR_STATUS.RESUME:
      return 'entry.sidebar.resume';
    default:
      return 'sidebar.label';
  }
}
