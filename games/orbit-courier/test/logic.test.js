import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  angleDelta,
  createRunState,
  currentAct,
  hydrateRun,
  pauseRun,
  resumeRun,
  scoreOf,
  serializeRun,
  shouldOfferContinue,
  startRun,
  stepRun,
  wrapAngle,
} from '../src/logic.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const gameDir = path.resolve(testDir, '..');
const level = JSON.parse(fs.readFileSync(path.join(gameDir, 'src', 'levels', 'shift-01.json'), 'utf8'));

function playingState(options = {}) {
  const state = createRunState(level, { seed: 7 });
  startRun(state);
  if (options.noAsteroids !== false) state.asteroids = [];
  return state;
}

/** Level copy with no hazards, used by the clock/timer tests. */
function calmLevel() {
  return {
    ...level,
    acts: level.acts.map((act) => ({ ...act, asteroidCount: 0, burstEveryMs: undefined, actClearBonus: 0 })),
  };
}

function placeParcel(state, patch = {}) {
  const parcel = {
    id: 900,
    ring: state.ship.ring,
    angle: state.ship.angle,
    ttlMs: level.parcel.ttlMs,
    bornAtMs: state.elapsedMs,
    ...patch,
  };
  state.parcels.push(parcel);
  return parcel;
}

test('level and run state are created deterministically', () => {
  assert.equal(level.durationSeconds, 120);
  assert.equal(level.acts.length, 3);
  assert.deepEqual(level.acts.map((act) => act.fromSeconds), [0, 40, 80]);

  const left = createRunState(level, { seed: 42 });
  const right = createRunState(level, { seed: 42 });
  assert.equal(left.phase, 'ready');
  assert.equal(left.durationMs, 120000);
  assert.equal(left.timeLeftMs, 120000);
  assert.equal(left.shield, 3);
  assert.equal(left.score, 0);
  assert.deepEqual(left.ship, right.ship);
  assert.equal(typeof left.rng, 'function');
  assert.equal(left.schemaVersion, 1);
  assert.equal(left.levelId, 'shift-01');
});

test('angles stay normalized and deltas take the short way around', () => {
  assert.ok(Math.abs(wrapAngle(-Math.PI / 2) - (Math.PI * 1.5)) < 1e-9);
  assert.ok(Math.abs(wrapAngle(4 * Math.PI) - 0) < 1e-9);
  assert.ok(Math.abs(angleDelta(0.1, 0.2) - 0.1) < 1e-9);
  assert.ok(Math.abs(angleDelta(0.1, -0.1) + 0.2) < 1e-9);
  assert.ok(Math.abs(angleDelta(-0.1, 0.1) - 0.2) < 1e-9);
});

test('steering rotates on the current ring and lane changes move inward/outward', () => {
  const state = playingState();
  const before = state.ship.angle;
  stepRun(level, state, 16, { rotate: 1 });
  assert.ok(state.ship.angle > before, 'right input rotates clockwise');
  assert.equal(state.ship.ring, 1);
  stepRun(level, state, 16, { ring: -1 });
  assert.equal(state.ship.ring, 0, 'inward lane change');
  stepRun(level, state, 16, { ring: -1 });
  assert.equal(state.ship.ring, 0, 'cannot leave the innermost ring');
  stepRun(level, state, 16, { ring: 1 });
  assert.equal(state.ship.ring, 0, 'lane changes respect the cooldown');
  for (let step = 0; step < 12; step += 1) stepRun(level, state, 16, {});
  stepRun(level, state, 16, { ring: 1 });
  assert.equal(state.ship.ring, 1, 'lane change works again after the cooldown');
});

test('touching a parcel with an empty cargo bay collects it', () => {
  const state = playingState();
  placeParcel(state);
  const events = stepRun(level, state, 16, {}).events;
  assert.deepEqual(state.parcels, []);
  assert.ok(state.ship.carry, 'cargo is carried');
  assert.equal(state.stats.collected, 1);
  assert.deepEqual(events, ['collect']);
});

test('collecting requires the same ring and a close angle', () => {
  const state = playingState();
  placeParcel(state, { ring: state.ship.ring === 0 ? 1 : 0 });
  stepRun(level, state, 16, {});
  assert.equal(state.ship.carry, null);
  placeParcel(state, { angle: wrapAngle(state.ship.angle + 0.5) });
  stepRun(level, state, 16, {});
  assert.equal(state.ship.carry, null);
  assert.equal(state.parcels.length, 2);
});

test('a fresh delivery multiplies the combo and pays the fast bonus', () => {
  const state = playingState();
  state.ship.carry = { id: 1, bornAtMs: 0 };
  state.ship.angle = level.geometry.stationAngle;
  const events = stepRun(level, state, 16, {}).events;
  assert.deepEqual(events, ['deliver-fast']);
  assert.equal(state.score, level.parcel.score + level.parcel.fastBonus);
  assert.equal(state.deliveries, 1);
  assert.equal(state.combo, 2);
  assert.equal(state.stats.fastDeliveries, 1);
  assert.equal(state.ship.carry, null);
});

test('slow deliveries pay the combo multiplier without the fast bonus', () => {
  const state = playingState();
  state.ship.angle = level.geometry.stationAngle;
  state.combo = 3;
  state.ship.carry = { id: 1, bornAtMs: -level.parcel.fastDeliveryMs - 500 };
  const events = stepRun(level, state, 16, {}).events;
  assert.deepEqual(events, ['deliver']);
  assert.equal(state.score, level.parcel.score * 3);
  assert.equal(state.combo, 4);
});

test('combo is capped and resets after the combo window lapses', () => {
  const state = playingState();
  state.combo = level.combo.max;
  state.comboTimerMs = 100;
  stepRun(level, state, 16, {});
  stepRun(level, state, 16, {});
  stepRun(level, state, 16, {});
  stepRun(level, state, 16, {});
  stepRun(level, state, 16, {});
  stepRun(level, state, 16, {});
  stepRun(level, state, 16, {});
  assert.equal(state.combo, 1, 'combo drops back to 1 after the window');

  const capState = playingState();
  capState.combo = level.combo.max;
  capState.ship.carry = { id: 1, bornAtMs: 0 };
  capState.ship.angle = level.geometry.stationAngle;
  stepRun(level, capState, 16, {});
  assert.equal(capState.combo, level.combo.max, 'combo never exceeds the level cap');
});

test('asteroid collisions cost one hull point and grant invulnerability', () => {
  const state = playingState({ noAsteroids: false });
  state.asteroids = [];
  state.asteroids.push({
    id: 77,
    ring: state.ship.ring,
    angle: state.ship.angle,
    dir: 1,
    speed: 0,
    ttlMs: null,
    bornAtMs: 0,
  });
  stepRun(level, state, 16, {});
  assert.equal(state.shield, 3 - 1);
  assert.ok(state.invulnerableMs > 0);
  assert.equal(state.stats.hits, 1);
  state.asteroids[0].angle = state.ship.angle;
  stepRun(level, state, 16, {});
  assert.equal(state.shield, 3 - 1, 'invulnerability blocks the second hit');
});

test('losing the last hull point ends the run as wrecked', () => {
  const state = playingState({ noAsteroids: false });
  state.shield = 1;
  state.asteroids = [{
    id: 78,
    ring: state.ship.ring,
    angle: state.ship.angle,
    dir: 1,
    speed: 0,
    ttlMs: null,
    bornAtMs: 0,
  }];
  const events = stepRun(level, state, 16, {}).events;
  assert.ok(events.includes('end'));
  assert.equal(state.phase, 'ended');
  assert.equal(state.endReason, 'wrecked');
  assert.equal(scoreOf(state), state.score, 'wrecked runs keep their earned score');
});

test('act boundaries add their clear bonus and switch the level phase', () => {
  const state = playingState();
  state.elapsedMs = 39_990;
  state.timeLeftMs = state.durationMs - state.elapsedMs;
  const events = stepRun(level, state, 16, {}).events;
  assert.ok(events.includes('act'));
  assert.equal(state.actIndex, 1);
  assert.equal(currentAct(level, state).label, '碎石带');
  assert.equal(state.score, level.acts[0].actClearBonus);
  assert.equal(state.stats.actsCleared, 1);
  assert.equal(state.asteroids.filter((rock) => rock.ttlMs === null).length, level.acts[1].asteroidCount);
});

test('the shift ends at 120 s and pays the completion bonus', () => {
  const neutral = calmLevel();
  const state = createRunState(neutral, { seed: 7 });
  startRun(state);
  state.elapsedMs = state.durationMs - 8;
  state.timeLeftMs = 8;
  state.score = 100;
  state.deliveries = 4;
  state.shield = 2;
  const events = stepRun(neutral, state, 16, {}).events;
  assert.ok(events.includes('end'));
  assert.equal(state.phase, 'ended');
  assert.equal(state.endReason, 'shift-complete');
  assert.equal(state.timeLeftMs, 0);
  const expected = 100 + neutral.completionBonus.perDelivery * 4 + neutral.completionBonus.perShield * 2;
  assert.equal(scoreOf(state), expected);
  assert.equal(state.finalScore, expected);
});

test('paused runs do not advance time or emit events', () => {
  const state = playingState();
  pauseRun(state);
  const before = state.elapsedMs;
  const result = stepRun(level, state, 500, { rotate: 1 });
  assert.deepEqual(result.events, []);
  assert.equal(state.elapsedMs, before);
  resumeRun(state);
  stepRun(level, state, 16, {});
  assert.ok(state.elapsedMs > before);
});

test('uncollected parcels expire and count as missed', () => {
  const state = playingState();
  placeParcel(state, { angle: wrapAngle(state.ship.angle + Math.PI), ttlMs: 40 });
  stepRun(level, state, 16, {});
  stepRun(level, state, 16, {});
  stepRun(level, state, 16, {});
  assert.equal(state.parcels.length, 0);
  assert.ok(state.stats.missed >= 1);
});

test('serialize/hydrate round-trips the resumable run', () => {
  const state = playingState();
  state.score = 321;
  state.deliveries = 7;
  state.combo = 3;
  state.bestCombo = 4;
  state.shield = 2;
  state.elapsedMs = 47_500;
  state.timeLeftMs = state.durationMs - state.elapsedMs;
  const save = serializeRun(state);
  assert.equal(save.schemaVersion, 1);
  assert.equal(save.phase, 'paused');

  const resumed = hydrateRun(level, save);
  assert.ok(resumed);
  assert.equal(resumed.phase, 'paused');
  assert.equal(resumed.score, 321);
  assert.equal(resumed.deliveries, 7);
  assert.equal(resumed.combo, 3);
  assert.equal(resumed.shield, 2);
  assert.equal(resumed.elapsedMs, 47_500);
  assert.equal(resumed.actIndex, 1, 'act comes back from the saved index');
  assert.ok(resumed.asteroids.length > 0, 'asteroids are regenerated for the resumed phase');
  assert.equal(shouldOfferContinue(save), true);
});

test('continue is only offered for meaningful, unfinished runs', () => {
  const state = playingState();
  const save = serializeRun(state);
  save.elapsedMs = 200;
  assert.equal(shouldOfferContinue(save), false, 'too early to be worth continuing');
  save.elapsedMs = 5000;
  assert.equal(shouldOfferContinue(save), true);
  assert.equal(shouldOfferContinue({ schemaVersion: 2, phase: 'paused', elapsedMs: 9000 }), false);
  assert.equal(shouldOfferContinue(null), false);

  const ended = serializeRun(state);
  ended.phase = 'ended';
  assert.equal(shouldOfferContinue(ended), false);
  assert.equal(hydrateRun(level, { schemaVersion: 9 }), null);
});

test('two runs with the same seed and inputs stay identical', () => {
  const left = createRunState(level, { seed: 1234 });
  const right = createRunState(level, { seed: 1234 });
  startRun(left);
  startRun(right);
  const inputs = [
    { rotate: 1 },
    { rotate: 1, ring: 1 },
    {},
    { rotate: -1 },
    { ring: 1 },
    {},
  ];
  for (let step = 0; step < 400; step += 1) {
    const intent = inputs[step % inputs.length];
    stepRun(level, left, 16, intent);
    stepRun(level, right, 16, intent);
  }
  assert.deepEqual(
    {
      angle: left.ship.angle,
      ring: left.ship.ring,
      score: left.score,
      parcels: left.parcels,
      asteroids: left.asteroids,
      shield: left.shield,
    },
    {
      angle: right.ship.angle,
      ring: right.ship.ring,
      score: right.score,
      parcels: right.parcels,
      asteroids: right.asteroids,
      shield: right.shield,
    },
  );
});

test('a full 120 second shift can be simulated to completion', () => {
  const neutral = calmLevel();
  const state = createRunState(neutral, { seed: 99 });
  startRun(state);
  let guard = 0;
  while (state.phase === 'playing' && guard < Math.ceil(120_000 / 16) + 20) {
    stepRun(neutral, state, 16, { rotate: 1 });
    guard += 1;
  }
  assert.equal(state.phase, 'ended');
  assert.equal(state.endReason, 'shift-complete');
  assert.equal(state.actIndex, neutral.acts.length - 1);
  assert.ok(guard >= 120_000 / 16, 'the run really lasted the full shift (120 s at 16 ms steps)');
  assert.ok(scoreOf(state) >= neutral.completionBonus.perShield * state.shield, 'completion bonus is paid');
});
