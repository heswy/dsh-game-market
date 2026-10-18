/**
 * DSH Agent → platform AgentSnapshot adapter (PRD §8.9).
 *
 * This is the only Host module that understands DSH event names. It compresses
 * events into five states and never reads prompt/message/tool-argument content.
 *
 * Events are registered by `plugin.js`; `ingest(eventName, payload)` is the
 * testable, defensive entry point.
 */

import {
  AGENT_LABEL_KEYS,
  AGENT_LABELS_ZH,
  AGENT_SOURCES,
  AGENT_STATES,
} from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import { hostError } from './errors.js';
import {
  isPlainObject,
  validateDshSessionIdRequired,
  validateOptionalString,
} from './validation.js';

const SOURCES = new Set(AGENT_SOURCES);
const STATES = new Set(AGENT_STATES);
const LABEL_KEYS = new Set(Object.values(AGENT_LABEL_KEYS));

/** DSH event names subscribed by the Host half. */
export const AGENT_EVENTS = Object.freeze([
  'agent/pre-step',
  'agent/disposed',
]);

/**
 * Live session-log event types observed through `session/event`.
 *
 * `turn/end`, `tool/result`, `approval/*` and `assistant/message` are session
 * events, not Cordis agent events; subscribing them via `ctx.on(type)` never
 * fires in real DSH. This list is the real completion/waiting signal path.
 */
export const AGENT_SESSION_EVENTS = Object.freeze([
  'turn/start',
  'turn/end',
  'tool/call',
  'tool/result',
  'assistant/message',
  'approval/asked',
  'approval/decided',
]);

function defaultKeyForState(state) {
  if (state === 'waiting-user') return AGENT_LABEL_KEYS['waiting-generic'];
  return AGENT_LABEL_KEYS[state] || AGENT_LABEL_KEYS.running;
}

const LABEL_KEY_TO_SHORT = new Map(
  Object.entries(AGENT_LABEL_KEYS).map(([short, stable]) => [stable, short])
);

function labelFor(key) {
  const short = LABEL_KEY_TO_SHORT.get(key);
  return (short && AGENT_LABELS_ZH[short]) || AGENT_LABELS_ZH.running;
}

function cloneSnapshot(snapshot) {
  return snapshot ? { ...snapshot } : null;
}

function extractSessionId(payload) {
  if (!isPlainObject(payload)) return null;
  const candidates = [
    payload.sessionId,
    payload.session?.id,
    payload.session?.sessionId,
    payload.agent?.session?.id,
    payload.agent?.session?.sessionId,
    payload.agent?.sessionId,
    payload.context?.sessionId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate)) return candidate;
  }
  return null;
}

function extractTurnId(payload) {
  if (!isPlainObject(payload)) return null;
  const candidates = [
    payload.turnId,
    payload.turn?.id,
    payload.turn?.turnId,
    payload.step?.turnId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 128) return candidate;
  }
  return null;
}

function extractToolName(payload) {
  if (!isPlainObject(payload)) return '';
  const candidates = [
    payload.toolName,
    payload.tool?.name,
    payload.name,
    payload.tool,
    payload.toolCall?.name,
    payload.call?.name,
    payload.result?.toolName,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 128) return candidate;
    if (isPlainObject(candidate) && typeof candidate.name === 'string') return candidate.name;
  }
  return '';
}

/**
 * Tool-name buckets only (PRD §8.9). Tool parameters are never inspected.
 */
export function toolLabelKey(payload) {
  const name = extractToolName(payload).toLowerCase();
  if (name.length === 0) return AGENT_LABEL_KEYS.running;
  if (name.includes('test')) return AGENT_LABEL_KEYS.test;
  if (name.includes('build')) return AGENT_LABEL_KEYS.build;
  if (
    name.includes('web_search') ||
    name.includes('web_fetch') ||
    name.includes('search') ||
    name.includes('fetch')
  ) {
    return AGENT_LABEL_KEYS.search;
  }
  if (/(^|[_-])(read|grep|glob|ls|view)([_-]|$)/.test(name) || /(read|grep|glob|view)_/.test(name)) {
    return AGENT_LABEL_KEYS.read;
  }
  if (
    /(^|[_-])(write|edit|patch|str_replace)([_-]|$)/.test(name) ||
    name.includes('apply_patch') ||
    name.includes('str_replace')
  ) {
    return AGENT_LABEL_KEYS.write;
  }
  if (/(^|[_-])(bash|shell|exec|command)([_-]|$)/.test(name)) {
    return AGENT_LABEL_KEYS.command;
  }
  return AGENT_LABEL_KEYS.running;
}

/** Defensive error detection for turn results (Spike S-15 field names vary). */
export function payloadIndicatesError(payload) {
  if (!isPlainObject(payload)) return false;
  if (payload.error) return true;
  if (isPlainObject(payload.result) && payload.result.error) return true;
  if (payload.ok === false || payload.success === false) return true;
  if (payload.isError === true || payload.cancelled === true || payload.canceled === true) return true;
  const statusFields = [payload.outcome, payload.status, payload.stopReason, payload.reason, payload.finishReason];
  for (const value of statusFields) {
    if (typeof value !== 'string') continue;
    const status = value.toLowerCase();
    if (['error', 'failed', 'failure', 'cancelled', 'canceled', 'aborted', 'timeout', 'interrupted', 'killed'].includes(status)) {
      return true;
    }
  }
  return false;
}

function validateLabelKey(value) {
  if (typeof value !== 'string' || !LABEL_KEYS.has(value)) {
    throw hostError(GM.INVALID_PARAM, 'Invalid labelKey');
  }
  return value;
}

/**
 * @param {{hostEpoch: string, now: () => Date, logger?: object, maxSessions?: number}} options
 */
export function createAgentAdapter({ hostEpoch, now, logger = null, maxSessions = 256 }) {
  const snapshots = new Map();

  function idleSnapshot(sessionId) {
    const stamp = now().toISOString();
    return {
      state: 'idle',
      label: AGENT_LABELS_ZH.idle,
      labelKey: AGENT_LABEL_KEYS.idle,
      sessionId: sessionId || null,
      updatedAt: stamp,
      source: 'lifecycle',
      seq: 0,
      since: stamp,
      turnId: null,
      hostEpoch,
    };
  }

  function ensureSnapshot(sessionId) {
    let snapshot = snapshots.get(sessionId);
    if (snapshot) return snapshot;
    snapshot = idleSnapshot(sessionId);
    snapshots.set(sessionId, snapshot);
    if (snapshots.size > maxSessions) {
      for (const [key, value] of snapshots) {
        if (value.state === 'idle' && key !== sessionId) {
          snapshots.delete(key);
          break;
        }
      }
    }
    return snapshot;
  }

  function apply(sessionId, patch) {
    const current = ensureSnapshot(sessionId);
    const state = STATES.has(patch.state) ? patch.state : 'running';
    const labelKey = patch.labelKey || defaultKeyForState(state);
    const label = typeof patch.label === 'string' && patch.label.length > 0 ? patch.label : labelFor(labelKey);
    const turnId =
      state === 'idle' ? null : patch.turnId !== undefined ? patch.turnId : current.turnId;
    const source = SOURCES.has(patch.source) ? patch.source : current.source;
    const sameState = current.state === state;
    const sameLabel = current.label === label && current.labelKey === labelKey;
    const sameTurn = patch.turnId === undefined || patch.turnId === current.turnId;
    if (sameState && sameLabel && sameTurn) return cloneSnapshot(current);

    const stamp = now().toISOString();
    const next = {
      state,
      label,
      labelKey,
      sessionId,
      updatedAt: stamp,
      source,
      seq: current.seq + 1,
      since: sameState ? current.since : stamp,
      turnId: turnId === undefined ? null : turnId,
      hostEpoch,
    };
    snapshots.set(sessionId, next);
    return cloneSnapshot(next);
  }

  function current(sessionId) {
    return snapshots.get(sessionId) || null;
  }

  /** Read-only snapshot lookup; unknown sessions get a cached idle snapshot. */
  function get(sessionId) {
    const id = validateDshSessionIdRequired(sessionId);
    return cloneSnapshot(ensureSnapshot(id));
  }

  function ingest(eventName, payload) {
    try {
      const sessionId = extractSessionId(payload);
      if (!sessionId) return null;
      const snapshot = ensureSnapshot(sessionId);
      const turnId = extractTurnId(payload);

      switch (eventName) {
        case 'agent/pre-step': {
          // A pending approval/question wins until it is decided.
          if (snapshot.state === 'waiting-user') return cloneSnapshot(snapshot);
          return apply(sessionId, {
            state: 'running',
            labelKey: AGENT_LABEL_KEYS.running,
            source: 'turn',
            turnId: turnId === null ? undefined : turnId,
          });
        }
        case 'tool/result': {
          // Completed/error are terminal until ack or a new turn.
          if (snapshot.state === 'waiting-user' || snapshot.state === 'completed' || snapshot.state === 'error') {
            return cloneSnapshot(snapshot);
          }
          return apply(sessionId, {
            state: 'running',
            labelKey: toolLabelKey(payload),
            source: 'tool',
            turnId: snapshot.turnId,
          });
        }
        case 'assistant/message': {
          if (snapshot.state !== 'idle' && snapshot.state !== 'running') return cloneSnapshot(snapshot);
          if (snapshot.state === 'running') return cloneSnapshot(snapshot);
          return apply(sessionId, {
            state: 'running',
            labelKey: AGENT_LABEL_KEYS.running,
            source: 'turn',
            turnId: turnId === null ? undefined : turnId,
          });
        }
        case 'turn/end': {
          if (
            snapshot.state === 'waiting-user' ||
            snapshot.state === 'completed' ||
            snapshot.state === 'error'
          ) {
            return cloneSnapshot(snapshot);
          }
          const failed = payloadIndicatesError(payload);
          return apply(sessionId, {
            state: failed ? 'error' : 'completed',
            labelKey: failed ? AGENT_LABEL_KEYS.error : AGENT_LABEL_KEYS.completed,
            source: 'turn',
            turnId: turnId === null ? snapshot.turnId : turnId,
          });
        }
        case 'approval/asked': {
          return apply(sessionId, {
            state: 'waiting-user',
            labelKey: AGENT_LABEL_KEYS['waiting-approval'],
            source: 'approval',
            turnId: turnId === null ? snapshot.turnId : turnId,
          });
        }
        case 'approval/decided': {
          if (snapshot.state === 'completed' || snapshot.state === 'error') return cloneSnapshot(snapshot);
          return apply(sessionId, {
            state: 'running',
            labelKey: AGENT_LABEL_KEYS.running,
            source: 'approval',
            turnId: snapshot.turnId,
          });
        }
        case 'agent/disposed': {
          return apply(sessionId, {
            state: 'idle',
            labelKey: AGENT_LABEL_KEYS.idle,
            source: 'lifecycle',
            turnId: null,
          });
        }
        default:
          return null;
      }
    } catch (error) {
      logger?.warn?.(
        '[game-market/host] agent-ingest-failed',
        `event=${String(eventName)}`,
        `code=${error && error.code ? error.code : 'E_UNKNOWN'}`
      );
      return null;
    }
  }

  /**
   * Map one live session event to the per-session agent snapshot.
   *
   * Real DSH payloads differ from the flattened shapes the old Cordis
   * subscriptions assumed: `turn/end` carries `{ turn, reason: { kind } }` and
   * `approval/asked` carries the approval request fields directly.
   */
  function ingestSessionEvent(session, event) {
    try {
      const sessionId = session && typeof session.id === 'string' ? session.id : null;
      if (!sessionId || !isPlainObject(event) || typeof event.type !== 'string') return null;
      if (!AGENT_SESSION_EVENTS.includes(event.type)) return null;
      const data = isPlainObject(event.data) ? event.data : {};
      const snapshot = ensureSnapshot(sessionId);
      const rawTurn = data.turn;
      const turnId =
        typeof rawTurn === 'number' && Number.isFinite(rawTurn)
          ? `turn-${rawTurn}`
          : extractTurnId(data) || snapshot.turnId;

      switch (event.type) {
        case 'turn/start':
          if (snapshot.state === 'waiting-user') return cloneSnapshot(snapshot);
          return apply(sessionId, {
            state: 'running',
            labelKey: AGENT_LABEL_KEYS.running,
            source: 'turn',
            turnId: turnId,
          });
        case 'turn/end': {
          if (
            snapshot.state === 'waiting-user' ||
            snapshot.state === 'completed' ||
            snapshot.state === 'error'
          ) {
            return cloneSnapshot(snapshot);
          }
          const kind = isPlainObject(data.reason) && typeof data.reason.kind === 'string' ? data.reason.kind : 'completed';
          if (kind === 'aborted' || kind === 'interrupted' || kind === 'blocked' || kind === 'forked') {
            return apply(sessionId, {
              state: 'idle',
              labelKey: AGENT_LABEL_KEYS.idle,
              source: 'lifecycle',
              turnId: null,
            });
          }
          const failed = kind === 'error';
          return apply(sessionId, {
            state: failed ? 'error' : 'completed',
            labelKey: failed ? AGENT_LABEL_KEYS.error : AGENT_LABEL_KEYS.completed,
            source: 'turn',
            turnId: turnId,
          });
        }
        case 'tool/call': {
          if (snapshot.state === 'waiting-user' || snapshot.state === 'completed' || snapshot.state === 'error') {
            return cloneSnapshot(snapshot);
          }
          return apply(sessionId, {
            state: 'running',
            labelKey: toolLabelKey(data),
            source: 'tool',
            turnId: turnId,
          });
        }
        case 'tool/result': {
          if (snapshot.state === 'waiting-user' || snapshot.state === 'completed' || snapshot.state === 'error') {
            return cloneSnapshot(snapshot);
          }
          return apply(sessionId, {
            state: 'running',
            labelKey: toolLabelKey(data),
            source: 'tool',
            turnId: snapshot.turnId,
          });
        }
        case 'assistant/message': {
          if (snapshot.state === 'waiting-user' || snapshot.state === 'completed' || snapshot.state === 'error') {
            return cloneSnapshot(snapshot);
          }
          return apply(sessionId, {
            state: 'running',
            labelKey: AGENT_LABEL_KEYS.running,
            source: 'turn',
            turnId: turnId,
          });
        }
        case 'approval/asked': {
          return apply(sessionId, {
            state: 'waiting-user',
            labelKey: AGENT_LABEL_KEYS['waiting-approval'],
            source: 'approval',
            turnId: turnId,
          });
        }
        case 'approval/decided': {
          if (snapshot.state === 'completed' || snapshot.state === 'error' || snapshot.state === 'idle') {
            return cloneSnapshot(snapshot);
          }
          return apply(sessionId, {
            state: 'running',
            labelKey: AGENT_LABEL_KEYS.running,
            source: 'approval',
            turnId: snapshot.turnId,
          });
        }
        default:
          return null;
      }
    } catch (error) {
      logger?.warn?.(
        '[game-market/host] agent-session-ingest-failed',
        `event=${String(event && event.type)}`,
        `code=${error && error.code ? error.code : 'E_UNKNOWN'}`
      );
      return null;
    }
  }

  function ack({ sessionId, seq } = {}) {
    const id = validateDshSessionIdRequired(sessionId);
    let expected = null;
    if (seq !== undefined && seq !== null) {
      if (!Number.isSafeInteger(seq) || seq < 0) throw hostError(GM.INVALID_PARAM, 'Invalid seq');
      expected = seq;
    }
    const snapshot = ensureSnapshot(id);
    if (expected !== null && expected < snapshot.seq) {
      return { state: snapshot.state, seq: snapshot.seq };
    }
    if (snapshot.state === 'completed' || snapshot.state === 'error') {
      const next = apply(id, {
        state: 'idle',
        labelKey: AGENT_LABEL_KEYS.idle,
        source: 'lifecycle',
        turnId: null,
      });
      return { state: next.state, seq: next.seq };
    }
    return { state: snapshot.state, seq: snapshot.seq };
  }

  function devSet(body) {
    if (!isPlainObject(body)) throw hostError(GM.INVALID_PARAM, 'Request body must be an object');
    const sessionId = validateDshSessionIdRequired(body.sessionId);
    if (!STATES.has(body.state)) throw hostError(GM.INVALID_PARAM, 'Unknown agent state');
    const labelKey =
      body.labelKey === undefined || body.labelKey === null
        ? defaultKeyForState(body.state)
        : validateLabelKey(body.labelKey);
    const label =
      body.label === undefined || body.label === null
        ? labelFor(labelKey)
        : validateOptionalString(body.label, 'label', { maxLength: 200 });
    const turnId = validateOptionalString(body.turnId, 'turnId', { maxLength: 128 });
    return apply(sessionId, {
      state: body.state,
      labelKey,
      label,
      turnId: body.state === 'idle' ? null : turnId,
      source: 'lifecycle',
    });
  }

  function etag(snapshot) {
    const seq = snapshot && Number.isInteger(snapshot.seq) ? snapshot.seq : 0;
    return `W/"${hostEpoch}:${seq}"`;
  }

  return {
    get,
    ingest,
    ingestSessionEvent,
    ack,
    devSet,
    etag,
    current,
    idleSnapshot,
    eventNames: AGENT_EVENTS,
    hostEpoch,
  };
}
