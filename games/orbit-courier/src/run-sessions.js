/**
 * Per-run session ledger + settlement coordinator.
 *
 * CR8-03: the boot shell used two closure booleans (`sessionStarted` /
 * `sessionEnded`). They were never reset by `beginNewRun()`, so after the first
 * settlement every later run was treated as "already settled": no score submit,
 * no best-score update, no end overlay, no save cleanup.
 *
 * This module keeps that state **per run token** instead:
 *  - `beginRun()` mints a fresh monotonic run token; a resumed run gets one too;
 *  - `ensureSessionStart()` starts at most one play session per run;
 *  - `settle()` is idempotent *per run token* (duplicate end events are dropped)
 *    and issues `score.submit` + `session.end` immediately, so a slow/stale
 *    settlement can never block or corrupt the next run: results only clean up
 *    the save while their run is still current, and best scores are monotonic.
 *
 * The page keeps one ledger for its whole lifetime, which is exactly the
 * two/three-runs-on-one-page scenario from the review.
 */

const OUTCOMES = new Set(['completed', 'lost']);

/** Coerce a score to the manifest's non-negative integer range. */
function normalizeScore(value) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.floor(numeric));
}

/** Run a host call without letting a rejection escape the game loop. */
function safeCall(fn, ...args) {
  if (typeof fn !== 'function') return Promise.resolve(null);
  try {
    return Promise.resolve(fn(...args)).catch((error) => ({ error }));
  } catch (error) {
    return Promise.resolve({ error });
  }
}

/**
 * @param {{
 *   startSession?: () => Promise<unknown>|unknown,
 *   endSession?: (request: {outcome: 'completed'|'lost', score: number}) => Promise<unknown>|unknown,
 *   submitScore?: (score: number) => Promise<unknown>|unknown,
 *   clearSave?: () => Promise<unknown>|unknown
 * }} [host]
 */
export function createRunSessions(host = {}) {
  let currentRunId = 0;
  let sessionRunId = 0;
  let settledRunId = 0;
  let bestScore = 0;
  const counters = { sessionStarts: 0, sessionEnds: 0, submits: 0, clears: 0 };

  return {
    get runId() {
      return currentRunId;
    },
    get best() {
      return bestScore;
    },
    counters,

    /** Seed the best score from storage once per boot. */
    setBest(value) {
      bestScore = normalizeScore(value);
      return bestScore;
    },

    /** Start a new run: fresh token, so session/settlement state resets per run. */
    beginRun() {
      currentRunId += 1;
      return currentRunId;
    },

    isCurrent(token) {
      return token !== null && token !== undefined && token === currentRunId;
    },

    /** One play session per run, no matter how many gestures arrive. */
    ensureSessionStart() {
      if (currentRunId === 0 || sessionRunId === currentRunId) return false;
      sessionRunId = currentRunId;
      counters.sessionStarts += 1;
      void safeCall(host.startSession);
      return true;
    },

    /**
     * Settle the current run exactly once.
     *
     * `onIssued` fires synchronously (so the end overlay/audio never wait on the
     * host). The returned promise always resolves with `status`:
     * `settled` (this run is still current) or `stale` (a newer run started
     * while the host calls were in flight: do not touch the new run's state).
     */
    settle({ score, outcome, onIssued } = {}) {
      if (currentRunId === 0 || settledRunId === currentRunId) {
        return Promise.resolve({ status: 'duplicate', token: currentRunId, best: bestScore });
      }
      const token = currentRunId;
      settledRunId = token;
      const finalScore = normalizeScore(score);
      const isBest = finalScore > bestScore;
      if (isBest) bestScore = finalScore;

      if (typeof onIssued === 'function') {
        try {
          onIssued({ token, score: finalScore, isBest, best: bestScore });
        } catch (_error) {
          // Presentation errors must not abort settlement.
        }
      }

      const request = { outcome: OUTCOMES.has(outcome) ? outcome : 'completed', score: finalScore };
      counters.submits += 1;
      counters.sessionEnds += 1;
      const submitPromise = safeCall(host.submitScore, finalScore);
      const endPromise = safeCall(host.endSession, request);

      return Promise.all([submitPromise, endPromise]).then(([submitResult, endResult]) => {
        const current = token === currentRunId;
        if (current) {
          counters.clears += 1;
          void safeCall(host.clearSave);
        }
        return {
          status: current ? 'settled' : 'stale',
          token,
          score: finalScore,
          isBest,
          best: bestScore,
          submitResult,
          endResult,
        };
      });
    },
  };
}
