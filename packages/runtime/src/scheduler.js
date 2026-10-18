/**
 * Autosave scheduler (PRD §8.4 / D-005).
 *
 * Pure timer logic with injected clock; the controller provides the bridge
 * `before-save` sender and forwards storage.save outcomes back via `noteSave`.
 *
 * Guarantees:
 *   - while started: one `before-save` every `autosaveMs` (paused/error stop it);
 *   - a forced save awaits the game's storage.save, up to `saveTimeoutMs`;
 *   - at most one save runs and at most one is queued (extra triggers coalesce);
 *   - failures never delete the previous save; the result carries `saveStale`.
 */

import { TIMING } from '../../shared/src/constants.js';

/**
 * @param {{
 *   sendBeforeSave: (reason: string) => void,
 *   onStatus?: (status: 'idle'|'saving'|'saved'|'failed', at: number|null) => void,
 *   timers?: {setTimeout: Function, clearTimeout: Function},
 *   now?: () => number,
 *   autosaveMs?: number,
 *   saveTimeoutMs?: number,
 *   deadlineMs?: number,
 * }} options
 */
export function createSaveScheduler(options = {}) {
  const timers = options.timers || globalThis;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const autosaveMs = positiveNumber(options.autosaveMs, TIMING.autosaveMs);
  const saveTimeoutMs = positiveNumber(options.saveTimeoutMs, TIMING.saveTimeoutMs);
  const deadlineMs = positiveNumber(options.deadlineMs, saveTimeoutMs);
  const sendBeforeSave =
    typeof options.sendBeforeSave === 'function' ? options.sendBeforeSave : function noop() {};
  const onStatus = typeof options.onStatus === 'function' ? options.onStatus : function noop() {};

  let intervalTimer = null;
  let started = false;
  let destroyed = false;
  let active = null;
  let queued = null;

  function positiveNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function setStatus(status) {
    onStatus(status, status === 'idle' ? null : now());
  }

  function record(result) {
    setStatus(result.ok ? 'saved' : 'failed');
    return result;
  }

  function scheduleInterval() {
    if (!started || destroyed || intervalTimer !== null) return;
    intervalTimer = timers.setTimeout(function onInterval() {
      intervalTimer = null;
      trigger('interval');
      scheduleInterval();
    }, autosaveMs);
  }

  function start() {
    if (destroyed || started) return;
    started = true;
    scheduleInterval();
  }

  function stop() {
    if (!started) return;
    started = false;
    if (intervalTimer !== null) {
      timers.clearTimeout(intervalTimer);
      intervalTimer = null;
    }
  }

  function begin(reason, waiters) {
    let settled = false;
    const finish = function finish(outcome) {
      if (settled) return;
      settled = true;
      if (active && active.timer !== null) {
        timers.clearTimeout(active.timer);
      }
      active = null;
      const result = {
        ok: outcome.ok === true,
        saveStale: outcome.ok !== true,
        skipped: outcome.skipped === true,
        reason,
      };
      record(result);
      for (const waiter of waiters) waiter.resolve(result);
      if (queued) {
        const next = queued;
        queued = null;
        begin(next.reason, next.waiters);
      }
    };

    setStatus('saving');
    active = {
      reason,
      waiters,
      settle: finish,
      timer: timers.setTimeout(function onTimeout() {
        finish({ ok: false, skipped: true });
      }, saveTimeoutMs),
    };
    try {
      sendBeforeSave(reason, { deadlineMs });
    } catch (_error) {
      finish({ ok: false });
    }
  }

  /**
   * Request a save. Concurrent calls are coalesced into one queued run.
   * @param {string} reason interval|pause|hidden|leave|agent-complete
   * @returns {Promise<{ok:boolean, saveStale:boolean, skipped:boolean, reason:string}>}
   */
  function save(reason) {
    const effectiveReason = typeof reason === 'string' && reason ? reason : 'interval';
    if (destroyed) {
      return Promise.resolve({ ok: false, saveStale: true, skipped: true, reason: effectiveReason });
    }
    return new Promise(function executor(resolve) {
      if (active) {
        if (queued) {
          queued.waiters.push({ resolve });
        } else {
          queued = { reason: effectiveReason, waiters: [{ resolve }] };
        }
        return;
      }
      begin(effectiveReason, [{ resolve }]);
    });
  }

  /** Alias used by the 30s cadence: fire-and-forget, result still reported via status. */
  function trigger(reason) {
    return save(reason);
  }

  /**
   * Called by the request service when the game's storage.save settles.
   * @returns {boolean} true when an in-flight save consumed the outcome
   */
  function noteSave(outcome) {
    if (!active) return false;
    active.settle({ ok: Boolean(outcome && outcome.ok), skipped: false });
    return true;
  }

  function isSaving() {
    return active !== null;
  }

  function isStarted() {
    return started;
  }

  function pending() {
    return (active ? 1 : 0) + (queued ? 1 : 0);
  }

  function destroy() {
    destroyed = true;
    stop();
    if (active) {
      if (active.timer !== null) timers.clearTimeout(active.timer);
      const cancelled = { ok: false, saveStale: true, skipped: true, reason: active.reason };
      for (const waiter of active.waiters) waiter.resolve(cancelled);
    }
    if (queued) {
      const cancelledQueued = { ok: false, saveStale: true, skipped: true, reason: queued.reason };
      for (const waiter of queued.waiters) waiter.resolve(cancelledQueued);
    }
    active = null;
    queued = null;
  }

  return { start, stop, save, trigger, noteSave, isSaving, isStarted, pending, destroy };
}
