import test from 'node:test';
import assert from 'node:assert/strict';

import { createSaveScheduler } from '../src/scheduler.js';
import { createClock } from './helpers/fakes.js';

function makeScheduler(overrides = {}) {
  const clock = createClock();
  const statuses = [];
  const sent = [];
  const scheduler = createSaveScheduler({
    timers: clock,
    now: clock.now,
    sendBeforeSave: (reason, meta) => sent.push({ reason, meta }),
    onStatus: (status, at) => statuses.push({ status, at }),
    ...overrides,
  });
  return { scheduler, clock, statuses, sent };
}

test('autosave fires every 30s while started', async () => {
  const { scheduler, clock, sent, statuses } = makeScheduler();
  scheduler.start();
  clock.tick(30000);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].reason, 'interval');
  assert.equal(sent[0].meta.deadlineMs, 1500);
  assert.equal(statuses[statuses.length - 1].status, 'saving');

  scheduler.noteSave({ ok: true });
  clock.tick(30000);
  assert.equal(sent.length, 2);
  assert.ok(statuses.some((entry) => entry.status === 'saved'));
});

test('stop() prevents autosave ticks; pause saves are unaffected', async () => {
  const { scheduler, clock, sent } = makeScheduler();
  scheduler.start();
  scheduler.stop();
  clock.tick(90000);
  assert.equal(sent.length, 0);

  const pending = scheduler.save('pause');
  assert.equal(sent.length, 1);
  scheduler.noteSave({ ok: true });
  assert.deepEqual(await pending, { ok: true, saveStale: false, skipped: false, reason: 'pause' });
});

test('a failed save reports saveStale without touching previous data', async () => {
  const { scheduler, sent, statuses } = makeScheduler();
  const pending = scheduler.save('leave');
  assert.equal(sent.length, 1);
  scheduler.noteSave({ ok: false, error: { code: 'GM-5021' } });
  assert.deepEqual(await pending, { ok: false, saveStale: true, skipped: false, reason: 'leave' });
  assert.equal(statuses[statuses.length - 1].status, 'failed');
});

test('a game that ignores before-save times out with saveStale', async () => {
  const { scheduler, clock, sent } = makeScheduler();
  const pending = scheduler.save('hidden');
  assert.equal(sent.length, 1);
  clock.tick(1499);
  scheduler.noteSave({ ok: true });
  assert.deepEqual(await pending, { ok: true, saveStale: false, skipped: false, reason: 'hidden' });

  const timedOut = scheduler.save('leave');
  clock.tick(1500);
  assert.deepEqual(await timedOut, { ok: false, saveStale: true, skipped: true, reason: 'leave' });
});

test('concurrent saves coalesce into at most one queued run', async () => {
  const { scheduler, clock, sent } = makeScheduler();
  const first = scheduler.save('pause');
  const second = scheduler.save('leave');
  const third = scheduler.save('hidden');
  assert.equal(sent.length, 1);
  assert.equal(scheduler.pending(), 2);

  scheduler.noteSave({ ok: true });
  await first;
  assert.equal(sent.length, 2);
  assert.equal(sent[1].reason, 'leave');

  scheduler.noteSave({ ok: true });
  const [secondResult, thirdResult] = await Promise.all([second, third]);
  assert.equal(secondResult.ok, true);
  assert.equal(thirdResult.ok, true);
  assert.equal(sent.length, 2);
  assert.equal(clock.pendingCount(), 0);
});

test('destroy cancels in-flight saves and resolves waiters as stale', async () => {
  const { scheduler, sent } = makeScheduler();
  const pending = scheduler.save('pause');
  assert.equal(sent.length, 1);
  scheduler.destroy();
  assert.deepEqual(await pending, { ok: false, saveStale: true, skipped: true, reason: 'pause' });
  const afterDestroy = await scheduler.save('pause');
  assert.equal(afterDestroy.ok, false);
});

test('status timeline is idle-free but reports saving/saved/failed', async () => {
  const { scheduler, statuses } = makeScheduler();
  const pending = scheduler.save('pause');
  scheduler.noteSave({ ok: true });
  await pending;
  assert.deepEqual(
    statuses.map((entry) => entry.status),
    ['saving', 'saved']
  );
});
