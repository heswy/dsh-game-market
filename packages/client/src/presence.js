/**
 * Agent Presence state machine (PRD 9.7): waiting-user > error > completed >
 * running > idle. Rendering details live in components/whale.js.
 */
import { TIMING } from '../../shared/src/constants.js';

export const PRESENCE = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  WAITING: 'waiting-user',
  COMPLETED: 'completed',
  ERROR: 'error',
});

const STAGE_KEYS = Object.freeze([
  'agent.state.test',
  'agent.state.build',
  'agent.state.search',
  'agent.state.read',
  'agent.state.write',
  'agent.state.command',
]);

function fresh(fetchedAt, now, staleMs) {
  if (typeof fetchedAt !== 'number' || fetchedAt <= 0) return false;
  const limit = typeof staleMs === 'number' ? staleMs : TIMING.agentStaleMs;
  return now - fetchedAt <= limit;
}

/**
 * @param {{agent: object|null, agentFetchedAt: number, runtimeError: object|null}} state
 * @param {number} [now]
 * @param {{staleMs?: number, sessionId?: string|null}} [options]
 */
export function derivePresenceState(state, now, options) {
  const clock = typeof now === 'number' ? now : Date.now();
  const opts = options && typeof options === 'object' ? options : {};
  const agent = state && state.agent ? state.agent : null;
  const agentError = state && state.runtimeError ? state.runtimeError : null;
  const agentFresh = fresh(state && state.agentFetchedAt, clock, opts.staleMs);
  const matches =
    !agent ||
    !agent.sessionId ||
    typeof opts.sessionId !== 'string' ||
    agent.sessionId === opts.sessionId;

  if (agentFresh && matches && agent.state === 'waiting-user') return PRESENCE.WAITING;
  if (agentError) return PRESENCE.ERROR;
  if (!agentFresh || !matches) return PRESENCE.IDLE;
  if (agent.state === 'error') return PRESENCE.ERROR;
  if (agent.state === 'completed') return PRESENCE.COMPLETED;
  if (agent.state === 'running') return PRESENCE.RUNNING;
  return PRESENCE.IDLE;
}

/** One-line status key for the presence bubble. */
export function presenceLabelKey(presence, agent) {
  if (presence === PRESENCE.WAITING) {
    if (agent && typeof agent.labelKey === 'string') {
      if (agent.labelKey === 'agent.state.waiting.approval') return agent.labelKey;
      if (agent.labelKey === 'agent.state.waiting.question') return agent.labelKey;
    }
    return 'agent.state.waiting.generic';
  }
  if (presence === PRESENCE.COMPLETED) return 'agent.state.completed';
  if (presence === PRESENCE.ERROR) return 'agent.state.error';
  if (presence === PRESENCE.RUNNING) {
    if (agent && STAGE_KEYS.indexOf(agent.labelKey) !== -1) return agent.labelKey;
    return 'agent.state.running';
  }
  return 'agent.state.idle';
}

/** Single action key for the bubble. */
export function presenceActionKey(presence) {
  if (presence === PRESENCE.WAITING) return 'agent.action.answer';
  if (presence === PRESENCE.COMPLETED) return 'agent.action.results';
  if (presence === PRESENCE.ERROR) return 'agent.action.view';
  return 'agent.action.returnWork';
}

/** Bubbles auto-open for states that need the user; running stays quiet. */
export function presenceBubbleDefaultOpen(presence) {
  return presence === PRESENCE.WAITING || presence === PRESENCE.COMPLETED || presence === PRESENCE.ERROR;
}

/** Bubble text width key used by the collapsible pill. */
export function presencePillKey(presence) {
  if (presence === PRESENCE.WAITING) return 'agent.pill.waiting';
  if (presence === PRESENCE.COMPLETED) return 'agent.pill.completed';
  if (presence === PRESENCE.ERROR) return 'agent.pill.error';
  return null;
}
