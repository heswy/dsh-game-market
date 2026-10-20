import test from 'node:test';
import assert from 'node:assert/strict';

import { createRunSessions } from '../src/run-sessions.js';

/** Deferred promise helper for ordering-sensitive host fakes. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/** Host fake that records every call and can delay individual answers. */
function fakeHost() {
  const calls = { starts: [], ends: [], submits: [], clears: [] };
  const gates = { submit: null, end: null, clear: null };
  return {
    calls,
    gates,
    startSession() {
      calls.starts.push(Date.now());
      return Promise.resolve({ playSessionId: `session-${calls.starts.length}` });
    },
    endSession(request) {
      calls.ends.push(request);
      if (gates.end) return gates.end.promise;
      return Promise.resolve({ ok: true });
    },
    submitScore(score) {
      calls.submits.push(score);
      if (gates.submit) return gates.submit.promise;
      return Promise.resolve({ isBest: true, best: score });
    },
    clearSave() {
      calls.clears.push(Date.now());
      if (gates.clear) return gates.clear.promise;
      return Promise.resolve(true);
    },
  };
}

test('two consecutive runs on one page both settle and the second best wins', async () => {
  const host = fakeHost();
  const sessions = createRunSessions(host);
  sessions.setBest(0);
  const overlays = [];

  // Run A: 1210 points.
  const runA = sessions.beginRun();
  assert.equal(sessions.ensureSessionStart(), true, 'run A starts its play session');
  assert.equal(sessions.ensureSessionStart(), false, 'extra gestures do not start another session');
  const settleA = sessions.settle({
    score: 1210,
    outcome: 'completed',
    onIssued: ({ score, isBest, best }) => overlays.push({ run: 'A', score, isBest, best }),
  });
  const resultA = await settleA;
  assert.equal(resultA.status, 'settled');
  assert.equal(resultA.token, runA);
  assert.equal(resultA.isBest, true);
  assert.equal(sessions.best, 1210);
  assert.deepEqual(overlays, [{ run: 'A', score: 1210, isBest: true, best: 1210 }], 'first run shows an end overlay');
  assert.deepEqual(host.calls.submits, [1210], 'first run submits its score');
  assert.equal(host.calls.ends.length, 1);
  assert.deepEqual(host.calls.ends[0], { outcome: 'completed', score: 1210 });
  assert.equal(host.calls.clears.length, 1, 'first run clears its save');

  // Run B: a bigger score. This is the CR8-03 regression: it must settle too.
  const runB = sessions.beginRun();
  assert.notEqual(runB, runA, 'each run gets its own token');
  assert.equal(sessions.ensureSessionStart(), true, 'run B starts a second play session');
  const resultB = await sessions.settle({
    score: 9210,
    outcome: 'shift-complete',
    onIssued: ({ score, isBest, best }) => overlays.push({ run: 'B', score, isBest, best }),
  });
  assert.equal(resultB.status, 'settled', 'second run settles instead of being treated as already-settled');
  assert.equal(resultB.isBest, true);
  assert.equal(sessions.best, 9210, 'best score updates to run B');
  assert.deepEqual(overlays.map((overlay) => overlay.run), ['A', 'B'], 'both runs show their own end overlay');
  assert.deepEqual(overlays[1], { run: 'B', score: 9210, isBest: true, best: 9210 });
  assert.deepEqual(host.calls.submits, [1210, 9210], 'both runs submit a score');
  assert.equal(host.calls.ends.length, 2, 'both runs end exactly one play session');
  assert.equal(host.calls.starts.length, 2, 'both runs start exactly one play session');
  assert.equal(host.calls.clears.length, 2, 'both runs clear their own save');
  assert.deepEqual(sessions.counters, { sessionStarts: 2, sessionEnds: 2, submits: 2, clears: 2 });
});

test('a stale settlement cannot pollute the next run', async () => {
  const host = fakeHost();
  const sessions = createRunSessions(host);
  sessions.setBest(0);
  const overlays = [];

  // Run A settles, but its submit/end responses are still in flight.
  host.gates.submit = deferred();
  host.gates.end = deferred();
  sessions.beginRun();
  sessions.ensureSessionStart();
  const pendingA = sessions.settle({ score: 500, outcome: 'completed', onIssued: () => overlays.push('A') });
  assert.deepEqual(host.calls.clears, [], 'save cleanup waits for the host answers');

  // The player immediately starts run B (no wait for A's promises).
  const runB = sessions.beginRun();
  assert.equal(sessions.ensureSessionStart(), true, 'run B starts even while A is settling');
  assert.equal(overlays.length, 1, 'A already showed its overlay synchronously');

  // Now A's host calls resolve: it must be stale, so it must not clear B's save
  // nor pretend to be the current run.
  host.gates.submit.resolve({ isBest: true, best: 500 });
  host.gates.end.resolve({ ok: true });
  const resultA = await pendingA;
  assert.equal(resultA.status, 'stale', 'A finishes as a stale settlement');
  assert.equal(host.calls.clears.length, 0, 'a stale settlement never clears the new run save');
  assert.equal(sessions.runId, runB);

  // Run B settles normally and stays current.
  const resultB = await sessions.settle({ score: 900, outcome: 'completed', onIssued: () => overlays.push('B') });
  assert.equal(resultB.status, 'settled');
  assert.equal(sessions.best, 900, 'run B still owns the best score');
  assert.equal(host.calls.clears.length, 1, 'only the current run clears its save');
  assert.deepEqual(overlays, ['A', 'B']);
});

test('three consecutive runs all settle and the best score is monotonic', async () => {
  const host = fakeHost();
  const sessions = createRunSessions(host);
  sessions.setBest(40);
  const issued = [];
  const scores = [120, 80, 300];
  for (const score of scores) {
    sessions.beginRun();
    sessions.ensureSessionStart();
    const result = await sessions.settle({ score, outcome: 'completed', onIssued: ({ isBest, best }) => issued.push({ score, isBest, best }) });
    assert.equal(result.status, 'settled', `run with ${score} settles`);
  }
  assert.deepEqual(host.calls.submits, scores, 'one submit per run');
  assert.equal(host.calls.starts.length, 3, 'one session per run');
  assert.equal(host.calls.ends.length, 3, 'one session end per run');
  assert.equal(host.calls.clears.length, 3, 'one save cleanup per run');
  assert.equal(sessions.best, 300, 'best ends at the highest score');
  assert.deepEqual(issued.map((entry) => entry.isBest), [true, false, true], 'isBest is reported per run');
});

test('settling the same run twice is a no-op, not a second session end', async () => {
  const host = fakeHost();
  const sessions = createRunSessions(host);
  sessions.beginRun();
  sessions.ensureSessionStart();
  const first = await sessions.settle({ score: 100, outcome: 'completed' });
  const second = await sessions.settle({ score: 100, outcome: 'completed' });
  assert.equal(first.status, 'settled');
  assert.equal(second.status, 'duplicate', 'duplicate end events are dropped per run token');
  assert.equal(host.calls.submits.length, 1);
  assert.equal(host.calls.ends.length, 1);
  assert.equal(host.calls.clears.length, 1);
});

test('a resumed run gets its own token and settlement', async () => {
  const host = fakeHost();
  const sessions = createRunSessions(host);
  sessions.setBest(300);
  sessions.beginRun();
  sessions.ensureSessionStart();
  await sessions.settle({ score: 300, outcome: 'lost' });
  // "Continue" restarts the page shell in production; in the same page a resumed
  // run is just another beginRun() with restored state.
  const resumed = sessions.beginRun();
  assert.equal(sessions.ensureSessionStart(), true);
  const result = await sessions.settle({ score: 640, outcome: 'completed' });
  assert.equal(result.status, 'settled');
  assert.equal(result.token, resumed);
  assert.equal(host.calls.ends.length, 2);
  assert.equal(host.calls.starts.length, 2);
  assert.equal(sessions.best, 640);
});

test('host call failures degrade gracefully and still settle the run', async () => {
  const host = fakeHost();
  const sessions = createRunSessions(host);
  sessions.beginRun();
  sessions.ensureSessionStart();
  host.gates.submit = deferred();
  host.gates.end = deferred();
  const pending = sessions.settle({ score: 250, outcome: 'completed' });
  host.gates.submit.reject(new Error('submit timeout'));
  host.gates.end.reject(new Error('session end failed'));
  const result = await pending;
  assert.equal(result.status, 'settled', 'a host failure must not jam the run lifecycle');
  assert.equal(result.submitResult.error instanceof Error, true);
  assert.equal(result.endResult.error instanceof Error, true);
  assert.equal(sessions.best, 250);
  assert.equal(host.calls.clears.length, 1);
});

test('no run started means settle is a safe no-op', async () => {
  const host = fakeHost();
  const sessions = createRunSessions(host);
  const result = await sessions.settle({ score: 999, outcome: 'completed' });
  assert.equal(result.status, 'duplicate');
  assert.deepEqual(host.calls.submits, []);
  assert.equal(sessions.best, 0);
});
