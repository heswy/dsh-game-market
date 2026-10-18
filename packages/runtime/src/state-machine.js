/**
 * Runtime page state machine (PRD §8.4).
 *
 * `ready` and `saving` are transient states; the controller leaves them on its
 * own timers. Illegal transitions are ignored (and can be reported through
 * `onInvalidTransition`) so a misbehaving game or a late timer can never drive
 * the controller into an impossible state.
 */

export const RUNTIME_STATES = Object.freeze([
  'idle',
  'loading',
  'ready',
  'playing',
  'paused',
  'saving',
  'error',
  'exited',
]);

const ALLOWED = Object.freeze({
  idle: Object.freeze(['loading', 'exited']),
  loading: Object.freeze(['ready', 'error', 'exited']),
  ready: Object.freeze(['playing', 'paused', 'loading', 'error', 'exited']),
  playing: Object.freeze(['paused', 'saving', 'loading', 'error', 'exited']),
  paused: Object.freeze(['playing', 'saving', 'loading', 'error', 'exited']),
  saving: Object.freeze(['paused', 'playing', 'loading', 'error', 'exited']),
  error: Object.freeze(['loading', 'exited']),
  exited: Object.freeze(['loading']),
});

export function isRuntimeState(value) {
  return RUNTIME_STATES.includes(value);
}

export function canTransition(from, to) {
  if (!isRuntimeState(from) || !isRuntimeState(to)) return false;
  if (from === to) return false;
  const allowed = ALLOWED[from];
  return Boolean(allowed && allowed.includes(to));
}

/**
 * @param {{initial?: string, onInvalidTransition?: (from: string, to: string) => void}} [options]
 */
export function createStateMachine(options = {}) {
  const initial = isRuntimeState(options.initial) ? options.initial : 'idle';
  const onInvalidTransition =
    typeof options.onInvalidTransition === 'function' ? options.onInvalidTransition : function noop() {};
  let current = initial;

  function get() {
    return current;
  }

  function can(to) {
    return canTransition(current, to);
  }

  function transition(to) {
    if (!isRuntimeState(to)) {
      onInvalidTransition(current, String(to));
      return false;
    }
    if (!canTransition(current, to)) {
      onInvalidTransition(current, to);
      return false;
    }
    current = to;
    return true;
  }

  /** Quiet reset used when a controller relaunches before emitting a loading state. */
  function reset(next) {
    current = isRuntimeState(next) ? next : 'idle';
    return current;
  }

  return { get, can, transition, reset };
}
