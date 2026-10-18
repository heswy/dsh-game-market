/**
 * Query debouncer for the local search box (PRD 9.3.5: input debounce 150ms).
 * Scheduler is injectable so the timing is testable without fake globals.
 */

export function createQueryDebouncer(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const delayMs = typeof opts.delayMs === 'number' && opts.delayMs >= 0 ? opts.delayMs : 150;
  const scheduler = opts.scheduler && typeof opts.scheduler.setTimeout === 'function' ? opts.scheduler : {
    setTimeout: function schedule(callback, delay) {
      return setTimeout(callback, delay);
    },
    clearTimeout: function clear(handle) {
      clearTimeout(handle);
    },
  };
  const apply = typeof opts.apply === 'function' ? opts.apply : function noop() {};
  let timer = null;
  let pending = null;

  function fire() {
    timer = null;
    if (pending === null) return;
    const value = pending;
    pending = null;
    apply(value);
  }

  return {
    push: function push(value) {
      pending = value;
      if (timer !== null) scheduler.clearTimeout(timer);
      timer = scheduler.setTimeout(fire, delayMs);
    },
    flush: function flush() {
      if (timer !== null) {
        scheduler.clearTimeout(timer);
        timer = null;
      }
      fire();
    },
    cancel: function cancel() {
      if (timer !== null) scheduler.clearTimeout(timer);
      timer = null;
      pending = null;
    },
    isScheduled: function isScheduled() {
      return timer !== null;
    },
    pendingValue: function pendingValue() {
      return pending;
    },
  };
}
