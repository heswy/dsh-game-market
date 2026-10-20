import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { clearSave, loadSave, readBest, resumeFromSave, submitScore, writeSave } from '../src/resume.js';
import {
  createRunState,
  serializeRun,
  shouldOfferContinue,
  shouldPersistRun,
  startRun,
} from '../src/logic.js';
import { bestScoreOf, isStorageEnvelope, unwrapStorageValue } from '../src/storage-shapes.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.resolve(testDir, '..');
const level = JSON.parse(fs.readFileSync(path.join(gameDir, 'src', 'levels', 'shift-01.json'), 'utf8'));

/** Adapter double: envelope mode mirrors the DSH host, payload mode a legacy shape. */
function fakeAdapter({ envelope = true, scoreBest = { score: 42, achievedAt: '2026-10-20T00:00:00.000Z', meta: null } } = {}) {
  const store = new Map();
  return {
    store,
    mode: envelope ? 'envelope' : 'payload',
    runtime: { theme: 'dark', reducedMotion: false, launchMode: 'start' },
    storage: {
      async load(key) {
        const record = store.get(key);
        if (!record) return null;
        return envelope
          ? { key, data: record.data, revision: record.revision, updatedAt: record.updatedAt }
          : record.data;
      },
      async save(key, data) {
        const revision = (store.get(key)?.revision ?? 0) + 1;
        const updatedAt = '2026-10-20T00:00:00.000Z';
        store.set(key, { data, revision, updatedAt });
        return { key, data, revision, updatedAt };
      },
      async remove(key) {
        store.delete(key);
        return { key, removed: true };
      },
    },
    score: {
      async getBest() {
        return scoreBest;
      },
      async submit(score) {
        return { best: score, isBest: true, submittedAt: '2026-10-20T00:00:00.000Z' };
      },
    },
    session: { async start() { return null; }, async end() { return null; } },
    lifecycle: { on() { return () => {}; } },
    onFatal() { return () => {}; },
  };
}

const SAVED_RUN = {
  schemaVersion: 1,
  levelId: 'shift-01',
  phase: 'paused',
  endReason: null,
  seed: 4242,
  elapsedMs: 5968,
  actIndex: 0,
  ship: { ring: 1, angle: 0.6, carry: null },
  score: 195,
  deliveries: 7,
  combo: 2,
  bestCombo: 3,
  comboTimerMs: 0,
  shield: 2,
  stats: { collected: 7, delivered: 7, fastDeliveries: 2, hits: 1, actsCleared: 0, missed: 0 },
  savedAt: '2026-10-20T00:00:00.000Z',
};

test('loadSave unwraps the host storage envelope and offers Continue', async () => {
  const adapter = fakeAdapter();
  await adapter.storage.save('run', SAVED_RUN);
  const loaded = await loadSave(adapter);
  assert.notEqual(loaded, null, 'an envelope-wrapped save must be offered');
  assert.equal(loaded.elapsedMs, 5968, 'loadSave returns the payload, not the envelope');
  assert.equal(loaded.score, 195);
  assert.equal(loaded.deliveries, 7);
  assert.equal(loaded.phase, 'paused');
  assert.equal(shouldOfferContinue(loaded), true);
});

test('loadSave also tolerates a bare payload (older offline adapter)', async () => {
  const adapter = fakeAdapter({ envelope: false });
  await adapter.storage.save('run', SAVED_RUN);
  const loaded = await loadSave(adapter);
  assert.equal(loaded.elapsedMs, 5968);
  assert.equal(loaded.score, 195);
});

test('writeSave then loadSave round-trips elapsed/score/deliveries/phase', async () => {
  const adapter = fakeAdapter();
  const state = startRun(createRunState(level, { seed: 7 }));
  state.elapsedMs = 21_480;
  state.timeLeftMs = state.durationMs - state.elapsedMs;
  state.score = 246;
  state.deliveries = 11;
  state.shield = 2;
  state.phase = 'paused';
  const payload = serializeRun(state);
  assert.equal(await writeSave(adapter, payload), true);
  const loaded = await loadSave(adapter);
  assert.ok(loaded, 'round-tripped save must load');
  assert.equal(loaded.elapsedMs, 21_480);
  assert.equal(loaded.score, 246);
  assert.equal(loaded.deliveries, 11);
  assert.equal(loaded.phase, 'paused');
  assert.equal(loaded.shield, 2);
  const resumed = resumeFromSave(level, loaded, { seed: 1 });
  assert.equal(resumed.phase, 'paused');
  assert.equal(resumed.elapsedMs, 21_480);
  assert.equal(resumed.score, 246);
  assert.equal(resumed.deliveries, 11);
});

test('a menu/ready state is never persisted and cannot clobber a Continue save', async () => {
  const adapter = fakeAdapter();
  await adapter.storage.save('run', SAVED_RUN);
  // A host pause can arrive during a resume-paused relaunch, before any run.
  const menuState = createRunState(level, { seed: 99 });
  assert.equal(shouldPersistRun(menuState), false, 'ready phase is not persistable');
  assert.equal(shouldPersistRun({ ...menuState, phase: 'ended' }), false, 'ended phase is not persistable');
  assert.equal(shouldPersistRun({ ...menuState, phase: 'playing', elapsedMs: 120 }), false, 'too little progress');
  assert.equal(shouldPersistRun({ ...menuState, phase: 'playing', elapsedMs: 500 }), true);
  assert.equal(shouldPersistRun({ ...menuState, phase: 'paused', elapsedMs: 5000 }), true);
  // The untouched save is still there for Continue.
  const loaded = await loadSave(adapter);
  assert.equal(loaded.elapsedMs, SAVED_RUN.elapsedMs);
});

test('clearSave removes the run and stops offering Continue', async () => {
  const adapter = fakeAdapter();
  await adapter.storage.save('run', SAVED_RUN);
  assert.equal(await clearSave(adapter), true);
  assert.equal(await loadSave(adapter), null);
});

test('the mute flag is read through the same envelope unwrap', async () => {
  const adapter = fakeAdapter();
  await adapter.storage.save('muted', true);
  const loaded = await adapter.storage.load('muted');
  assert.equal(loaded.data, true, 'host shape carries the flag in .data');
  assert.equal(unwrapStorageValue(loaded), true, 'restoreMuted() unwraps to the boolean');
  await adapter.storage.save('muted', false);
  assert.equal(unwrapStorageValue(await adapter.storage.load('muted')), false);
});

test('best score is read from every documented shape', async () => {
  assert.equal(bestScoreOf({ score: 42, achievedAt: null, meta: null }), 42);
  assert.equal(bestScoreOf({ value: 17 }), 17);
  assert.equal(bestScoreOf({ best: 9 }), 9);
  assert.equal(bestScoreOf(31), 31);
  assert.equal(bestScoreOf(null), 0);
  assert.equal(bestScoreOf({ score: null }), 0);
  const adapter = fakeAdapter({ scoreBest: { score: 1234, achievedAt: null, meta: null } });
  assert.equal(await readBest(adapter), 1234);
  const none = fakeAdapter({ scoreBest: null });
  assert.equal(await readBest(none), 0);
  const submitted = await submitScore(fakeAdapter(), 77);
  assert.equal(submitted.isBest, true);
  assert.equal(submitted.best, 77);
});

test('isStorageEnvelope distinguishes host envelopes from payloads', () => {
  assert.equal(isStorageEnvelope({ key: 'run', data: SAVED_RUN, revision: 3, updatedAt: 'x' }), true);
  assert.equal(isStorageEnvelope({ key: 'run', data: true, revision: 1 }), true);
  assert.equal(isStorageEnvelope(SAVED_RUN), false, 'a payload has no key/data/revision');
  assert.equal(isStorageEnvelope(null), false);
  assert.equal(isStorageEnvelope([1, 2]), false);
  assert.equal(unwrapStorageValue(null), null);
  assert.deepEqual(unwrapStorageValue({ k: 1 }), { k: 1 }, 'a bare payload passes through unchanged');
});
