import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyLeave, LEAVE_OUTCOME } from '../src/leave-outcome.js';
import { createStore, leaveNoticeCleared, leaveNoticeSet } from '../src/store.js';

test('classifyLeave treats a skipped save as "no progress", not a failure', function () {
  assert.equal(classifyLeave({ ok: true, saveStale: false, skipped: false }), LEAVE_OUTCOME.SAVED);
  assert.equal(
    classifyLeave({ ok: false, saveStale: true, skipped: true, unresponsive: false }),
    LEAVE_OUTCOME.NO_PROGRESS
  );
  assert.equal(classifyLeave({ ok: false, saveStale: true, skipped: false }), LEAVE_OUTCOME.BLOCKED);
  assert.equal(
    classifyLeave({ ok: false, saveStale: true, skipped: true, unresponsive: true }),
    LEAVE_OUTCOME.BLOCKED,
    'a hung bridge is still a real failure'
  );
  assert.equal(classifyLeave(null), LEAVE_OUTCOME.BLOCKED);
});

test('leave notice keeps only known kinds and session ids', function () {
  const store = createStore();
  store.dispatch(leaveNoticeSet({ kind: 'saved', gameId: 'jump', sessionId: 'sess-1', at: 1000 }));
  assert.deepEqual(store.getState().leaveNotice, {
    kind: 'saved',
    gameId: 'jump',
    sessionId: 'sess-1',
    at: 1000,
  });

  store.dispatch(leaveNoticeSet({ kind: 'saved', gameId: '', sessionId: 'not a session' }));
  assert.equal(store.getState().leaveNotice.gameId, null);
  assert.equal(store.getState().leaveNotice.sessionId, null);

  store.dispatch(leaveNoticeSet({ kind: 'unknown' }));
  assert.equal(store.getState().leaveNotice.kind, 'saved', 'unknown kinds are ignored');

  store.dispatch(leaveNoticeCleared());
  assert.equal(store.getState().leaveNotice, null);
});
