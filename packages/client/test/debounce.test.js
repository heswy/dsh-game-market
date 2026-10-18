import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueryDebouncer } from '../src/debounce.js';
import { SEARCH_DEBOUNCE_MS } from '../src/constants.js';

function fakeScheduler() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout: function setTimeout(callback, delay) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback: callback, delay: delay });
      return id;
    },
    clearTimeout: function clearTimeout(id) {
      timers.delete(id);
    },
    pending: function pending() {
      return timers.size;
    },
    tick: function tick(delay) {
      const ready = [];
      for (const [id, timer] of timers) {
        if (timer.delay <= delay) ready.push([id, timer]);
      }
      for (const [id, timer] of ready) {
        timers.delete(id);
        timer.callback();
      }
      return ready.length;
    },
  };
}

test('search debounce waits the PRD 150ms and applies only the latest value', function () {
  assert.equal(SEARCH_DEBOUNCE_MS, 150);
  const scheduler = fakeScheduler();
  const applied = [];
  const debouncer = createQueryDebouncer({
    delayMs: SEARCH_DEBOUNCE_MS,
    scheduler: scheduler,
    apply: function apply(value) {
      applied.push(value);
    },
  });
  debouncer.push('s');
  debouncer.push('sn');
  debouncer.push('sna');
  assert.deepEqual(applied, []);
  assert.equal(scheduler.pending(), 1);
  scheduler.tick(149);
  assert.deepEqual(applied, []);
  scheduler.tick(150);
  assert.deepEqual(applied, ['sna']);
  assert.equal(scheduler.pending(), 0);
});

test('debounce flush applies immediately and cancel drops the pending value', function () {
  const scheduler = fakeScheduler();
  const applied = [];
  const debouncer = createQueryDebouncer({
    delayMs: 150,
    scheduler: scheduler,
    apply: function apply(value) {
      applied.push(value);
    },
  });
  debouncer.push('jump');
  debouncer.flush();
  assert.deepEqual(applied, ['jump']);
  debouncer.push('snake');
  debouncer.cancel();
  scheduler.tick(500);
  assert.deepEqual(applied, ['jump']);
  assert.equal(debouncer.isScheduled(), false);
  assert.equal(debouncer.pendingValue(), null);
});

test('debounce is a no-op when there is nothing pending', function () {
  const scheduler = fakeScheduler();
  const applied = [];
  const debouncer = createQueryDebouncer({
    delayMs: 150,
    scheduler: scheduler,
    apply: function apply(value) {
      applied.push(value);
    },
  });
  debouncer.flush();
  assert.deepEqual(applied, []);
  assert.equal(debouncer.isScheduled(), false);
});
