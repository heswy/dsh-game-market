/**
 * Agent snapshot polling (PRD D-015 / 8.5 / 9.1.1).
 *
 * - while the page is visible and a Session is bound (the persistent Game tab and
 *   the in-game whale both need state even when no floating hint is mounted).
 * - stops on `document.hidden`; an immediate refresh happens on return.
 * - ETag/304 keeps the fresh timestamp without replacing the snapshot.
 * - failures back off 1s → 2s → 4s → 8s (shared TIMING cap).
 */
import { TIMING } from '../../shared/src/constants.js';
import { agentFresh, agentPollFailed, agentSnapshotReceived } from './store.js';
import { normalizeUiError } from './ui-errors.js';
import { reportDiagnostic } from './diagnostics.js';

/** Session whose snapshot the poller should read (D-006 binding is sticky). */
export function pollingSessionId(state) {
  if (!state || typeof state !== 'object') return null;
  if (state.page === 'runtime' && state.runtime && typeof state.runtime.bindingSessionId === 'string' && state.runtime.bindingSessionId.length > 0) {
    return state.runtime.bindingSessionId;
  }
  return typeof state.bindingSessionId === 'string' && state.bindingSessionId.length > 0 ? state.bindingSessionId : null;
}

/** Pure polling decision, also used by tests and the runtime view. */
export function shouldPollAgent(state, visibility) {
  if (!state || visibility !== 'visible') return false;
  return Boolean(pollingSessionId(state));
}

/** Exponential backoff for snapshot failures, capped by shared TIMING. */
export function nextBackoffMs(failures, baseMs, maxMs) {
  const base = typeof baseMs === 'number' && baseMs > 0 ? baseMs : TIMING.agentPollMs;
  const max = typeof maxMs === 'number' && maxMs > 0 ? maxMs : TIMING.pollBackoffMaxMs;
  const count = typeof failures === 'number' && failures > 0 ? Math.floor(failures) : 0;
  if (count <= 0) return base;
  const delay = base * Math.pow(2, count - 1);
  return delay > max ? max : delay;
}

function defaultScheduler() {
  return {
    now: function now() {
      return Date.now();
    },
    setTimeout: function schedule(callback, delay) {
      return setTimeout(callback, delay);
    },
    clearTimeout: function clear(handle) {
      clearTimeout(handle);
    },
  };
}

/**
 * @param {{
 *   store: object,
 *   getApi: () => object|null,
 *   getVisibility?: () => string,
 *   scheduler?: {now:Function,setTimeout:Function,clearTimeout:Function},
 *   intervalMs?: number,
 * }} options
 */
export function createAgentPoller(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const store = opts.store;
  const getApi = typeof opts.getApi === 'function' ? opts.getApi : function noApi() {
    return null;
  };
  const scheduler = opts.scheduler && typeof opts.scheduler === 'object' ? opts.scheduler : defaultScheduler();
  const intervalMs = typeof opts.intervalMs === 'number' && opts.intervalMs > 0 ? opts.intervalMs : TIMING.agentPollMs;

  let visibility = typeof opts.visibility === 'string' ? opts.visibility : 'visible';
  let timer = null;
  let started = false;
  let stopped = true;
  let inFlight = false;
  let failures = 0;
  let etag = null;
  let etagSession = null;
  let unsubscribe = null;

  function readVisibility() {
    if (typeof opts.getVisibility === 'function') {
      try {
        const value = opts.getVisibility();
        if (typeof value === 'string') return value;
      } catch (_error) {
        return 'visible';
      }
    }
    return visibility;
  }

  function decide() {
    return shouldPollAgent(store.getState(), readVisibility());
  }

  function clearTimer() {
    if (timer !== null) {
      scheduler.clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(delay) {
    clearTimer();
    if (stopped || !decide()) return;
    timer = scheduler.setTimeout(function onTimer() {
      timer = null;
      void run();
    }, delay);
  }

  async function run() {
    if (stopped || inFlight || !decide()) return;
    const state = store.getState();
    const sessionId = pollingSessionId(state);
    const api = getApi();
    if (!api || typeof api.getAgentState !== 'function') {
      failures += 1;
      reportDiagnostic('agent-poll-no-api');
      if (stopped) return;
      schedule(nextBackoffMs(failures, intervalMs));
      return;
    }

    if (etagSession !== sessionId) {
      etag = null;
      etagSession = sessionId;
    }

    inFlight = true;
    let failed = false;
    try {
      const query = etag ? { etag: etag } : undefined;
      const result = await api.getAgentState(sessionId, query);
      if (stopped || !decide()) return;
      if (pollingSessionId(store.getState()) !== sessionId) return;
      if (result && result.notModified === true) {
        store.dispatch(agentFresh(scheduler.now()));
        failures = 0;
        return;
      }
      if (result && result.snapshot && typeof result.snapshot === 'object') {
        store.dispatch(agentSnapshotReceived(result.snapshot, scheduler.now()));
        etag = typeof result.etag === 'string' ? result.etag : null;
        etagSession = sessionId;
        failures = 0;
        return;
      }
      failed = true;
      failures += 1;
      reportDiagnostic('agent-poll-empty');
    } catch (error) {
      failed = true;
      failures += 1;
      reportDiagnostic('agent-poll-failed', error);
      if (!stopped) store.dispatch(agentPollFailed(normalizeUiError(error)));
    } finally {
      inFlight = false;
      if (!stopped && decide()) {
        schedule(failed ? nextBackoffMs(failures, intervalMs) : intervalMs);
      }
    }
  }

  function sync() {
    if (stopped) return;
    if (!decide()) {
      clearTimer();
      return;
    }
    if (timer === null && !inFlight) schedule(0);
  }

  function setVisibility(next) {
    visibility = next === 'hidden' ? 'hidden' : 'visible';
    if (visibility === 'visible') {
      failures = 0;
      sync();
    } else {
      clearTimer();
    }
  }

  function start() {
    if (started) return;
    started = true;
    stopped = false;
    unsubscribe = store.subscribe(sync);
    sync();
  }

  function stop() {
    stopped = true;
    started = false;
    if (unsubscribe !== null) {
      unsubscribe();
      unsubscribe = null;
    }
    clearTimer();
  }

  return {
    start: start,
    stop: stop,
    sync: sync,
    setVisibility: setVisibility,
    tickNow: run,
    getDiagnostics: function getDiagnostics() {
      return { failures: failures, etag: etag, inFlight: inFlight, polling: decide() };
    },
  };
}
