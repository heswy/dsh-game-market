/**
 * Tiny event hub used for lifecycle / agent subscriptions.
 *
 * - Handlers run in registration order and are isolated: a throwing handler
 *   never breaks the bridge (PRD §8.3 lifecycle semantics).
 * - Lifecycle events that arrive before `ready` are buffered and replayed once
 *   the game becomes ready, so "subscribe first, event later" and "event first,
 *   subscribe later" both work for the handshake window.
 */

const LIFECYCLE_EVENTS = Object.freeze(['pause', 'resume', 'hidden', 'visible', 'before-save']);

export function isLifecycleEvent(name) {
  return LIFECYCLE_EVENTS.includes(name);
}

export function createEventHub() {
  const handlers = new Map();
  const buffered = [];
  let open = false;

  function on(name, handler) {
    if (typeof handler !== 'function') return function off() {};
    let set = handlers.get(name);
    if (!set) {
      set = new Set();
      handlers.set(name, set);
    }
    set.add(handler);
    return function off() {
      const current = handlers.get(name);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) handlers.delete(name);
    };
  }

  function dispatch(name, payload) {
    const set = handlers.get(name);
    if (!set || set.size === 0) return;
    for (const handler of Array.from(set)) {
      try {
        const result = handler(payload);
        if (result && typeof result.then === 'function') {
          result.then(undefined, function ignore() {});
        }
      } catch (_error) {
        // Game callbacks must never break the bridge.
      }
    }
  }

  function emit(name, payload, options) {
    const shouldBuffer = options ? options.buffer !== false : true;
    if (!open && shouldBuffer) {
      buffered.push([name, payload]);
      if (buffered.length > 64) buffered.shift();
      return;
    }
    dispatch(name, payload);
  }

  function openBuffer() {
    if (open) return;
    open = true;
    const queued = buffered.splice(0, buffered.length);
    for (const entry of queued) dispatch(entry[0], entry[1]);
  }

  function has(name) {
    const set = handlers.get(name);
    return Boolean(set && set.size > 0);
  }

  return { on, emit, open: openBuffer, has, isOpen: function isOpen() { return open; } };
}
