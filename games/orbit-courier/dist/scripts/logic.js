/**
 * Orbit Courier — pure run rules (no DOM, no timers, no SDK).
 *
 * Everything that decides the game outcome lives here so the rules can be
 * unit-tested and replayed deterministically:
 *
 *   createRunState(level, seed) -> state
 *   startRun / pauseRun / resumeRun
 *   stepRun(state, dtMs, input) -> events  (mutates state, returns event names)
 *   finishRun / serializeRun / hydrateRun
 *
 * A run is a fixed 120 s shift split into acts loaded from `levels/shift-01.json`.
 * The ship rides one of three concentric rings; parcels appear on rings and must
 * be carried across the station gate while bullets of rock orbit the other way.
 */

export const PHASES = Object.freeze(['ready', 'playing', 'paused', 'ended']);
export const RUN_SAVE_SCHEMA_VERSION = 1;
export const RUN_STORAGE_KEY = 'run';

const TAU = Math.PI * 2;
const TWO_PI = TAU;

/** Normalize an angle into [0, 2π). */
export function wrapAngle(angle) {
  let value = angle % TWO_PI;
  if (value < 0) value += TWO_PI;
  return value;
}

/** Shortest signed difference `b - a` in (-π, π]. */
export function angleDelta(a, b) {
  let diff = wrapAngle(b - a);
  if (diff > Math.PI) diff -= TWO_PI;
  return diff;
}

/** mulberry32: tiny, deterministic, good enough for gameplay. */
export function createRng(seed) {
  let state = (Number(seed) >>> 0) || 0x9e3779b9;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Validate the level document enough to fail loudly instead of half-running. */
export function assertLevel(level) {
  if (!level || typeof level !== 'object') throw new Error('level must be an object');
  if (!Number.isFinite(level.durationSeconds) || level.durationSeconds <= 0) {
    throw new Error('level.durationSeconds must be a positive number');
  }
  const rings = level.geometry && level.geometry.rings;
  if (!Array.isArray(rings) || rings.length < 2) throw new Error('level.geometry.rings needs at least two rings');
  if (!Array.isArray(level.acts) || level.acts.length === 0) throw new Error('level.acts must not be empty');
  if (!level.ship || !Number.isFinite(level.ship.angularSpeed)) throw new Error('level.ship.angularSpeed is required');
  if (!level.parcel || !Number.isFinite(level.parcel.score)) throw new Error('level.parcel.score is required');
  return level;
}

function firstAct(level) {
  return level.acts[0];
}

function makeShip(level) {
  return {
    ring: Math.min(1, level.geometry.rings.length - 1),
    angle: (level.geometry.stationAngle || 0) + Math.PI,
    carry: null,
    ringCooldownMs: 0,
  };
}

/**
 * Fresh run state.
 * @param {object} level Parsed level document.
 * @param {{seed?:number}} [options]
 */
export function createRunState(level, options = {}) {
  assertLevel(level);
  const seed = Number.isFinite(options.seed) ? options.seed >>> 0 : 0x5eed1234;
  const durationMs = Math.round(level.durationSeconds * 1000);
  return {
    schemaVersion: RUN_SAVE_SCHEMA_VERSION,
    levelId: String(level.id || 'shift'),
    phase: 'ready',
    endReason: null,
    seed,
    rng: createRng(seed),
    elapsedMs: 0,
    durationMs,
    timeLeftMs: durationMs,
    actIndex: 0,
    ship: makeShip(level),
    parcels: [],
    asteroids: [],
    score: 0,
    deliveries: 0,
    combo: 1,
    bestCombo: 1,
    comboTimerMs: 0,
    shield: Math.max(1, Number(level.shield) || 3),
    invulnerableMs: 0,
    spawnTimerMs: firstAct(level).spawnIntervalMs,
    burstTimerMs: firstAct(level).burstEveryMs || 0,
    nextId: 1,
    events: [],
    stats: {
      collected: 0,
      delivered: 0,
      fastDeliveries: 0,
      hits: 0,
      actsCleared: 0,
      missed: 0,
    },
    finalScore: null,
  };
}

function emit(state, event) {
  state.events.push(event);
}

/** Enter the playing phase (keeps the generated entities). */
export function startRun(state) {
  if (state.phase !== 'ready' && state.phase !== 'paused') return state;
  state.phase = 'playing';
  state.events = [];
  return state;
}

export function pauseRun(state) {
  if (state.phase === 'playing') state.phase = 'paused';
  return state;
}

export function resumeRun(state) {
  if (state.phase === 'paused') state.phase = 'playing';
  return state;
}

export function currentAct(level, state) {
  return level.acts[Math.min(state.actIndex, level.acts.length - 1)];
}

function spawnParcel(level, state) {
  const act = currentAct(level, state);
  const rings = level.geometry.rings.length;
  const station = level.geometry.stationAngle || 0;
  const rng = state.rng;
  let ring = Math.floor(rng() * rings);
  if (ring === state.ship.ring && rng() < 0.55) ring = (ring + 1 + Math.floor(rng() * (rings - 1))) % rings;
  const angle = wrapAngle(rng() * TWO_PI);
  // Keep parcels from spawning inside the station gate (they would look delivered).
  const toStation = Math.abs(angleDelta(angle, station));
  const safeAngle = toStation < 0.45 ? wrapAngle(angle + 0.9) : angle;
  state.parcels.push({
    id: state.nextId,
    ring,
    angle: safeAngle,
    ttlMs: act.parcelTtlMs || level.parcel.ttlMs,
    bornAtMs: state.elapsedMs,
  });
  state.nextId += 1;
}

function spawnAsteroid(level, state, options = {}) {
  const act = currentAct(level, state);
  const rng = state.rng;
  const rings = level.geometry.rings.length;
  const ring = options.ring !== undefined ? options.ring : Math.floor(rng() * rings);
  const dir = rng() < 0.5 ? -1 : 1;
  const speed = (act.asteroidSpeed || 1) * (0.85 + rng() * 0.3);
  state.asteroids.push({
    id: state.nextId,
    ring,
    angle: wrapAngle(rng() * TWO_PI),
    dir,
    speed,
    ttlMs: Number.isFinite(options.ttlMs) ? options.ttlMs : null,
    bornAtMs: state.elapsedMs,
  });
  state.nextId += 1;
}

function ensureAsteroids(level, state) {
  const act = currentAct(level, state);
  const wanted = Math.max(0, Number(act.asteroidCount) || 0);
  const live = state.asteroids.filter((rock) => rock.ttlMs === null);
  for (let index = live.length; index < wanted; index += 1) spawnAsteroid(level, state);
}

function advanceAct(level, state) {
  let advanced = false;
  while (state.actIndex < level.acts.length - 1) {
    const nextAct = level.acts[state.actIndex + 1];
    if (state.elapsedMs < nextAct.fromSeconds * 1000) break;
    state.actIndex += 1;
    const bonus = Number(level.acts[state.actIndex - 1].actClearBonus) || 0;
    state.score += bonus;
    state.stats.actsCleared += 1;
    state.spawnTimerMs = Number(nextAct.spawnIntervalMs) || state.spawnTimerMs;
    state.burstTimerMs = Number(nextAct.burstEveryMs) || 0;
    emit(state, 'act');
    advanced = true;
  }
  return advanced;
}

function finishRun(level, state, reason) {
  state.phase = 'ended';
  state.endReason = reason;
  let score = state.score;
  if (reason === 'shift-complete') {
    const bonus = level.completionBonus || {};
    score += (Number(bonus.perDelivery) || 0) * state.deliveries;
    score += (Number(bonus.perShield) || 0) * Math.max(0, state.shield);
  }
  state.finalScore = Math.max(0, Math.round(score));
  emit(state, 'end');
  return state;
}

function hitShip(level, state) {
  state.stats.hits += 1;
  state.shield -= 1;
  state.invulnerableMs = Math.max(0, Number(level.ship.invulnerableMs) || 0);
  state.combo = 1;
  state.bestCombo = Math.max(state.bestCombo, state.combo);
  state.comboTimerMs = 0;
  emit(state, 'hit');
  if (state.shield <= 0) {
    state.shield = 0;
    finishRun(level, state, 'wrecked');
  }
}

function deliver(level, state) {
  const carry = state.ship.carry;
  if (!carry) return;
  const parcel = level.parcel;
  const multiplier = Math.min(Number(level.combo.max) || 5, Math.max(1, state.combo));
  const carryMs = state.elapsedMs - carry.bornAtMs;
  const fast = carryMs <= Number(parcel.fastDeliveryMs || 6000);
  const points = (Number(parcel.score) || 10) * multiplier + (fast ? Number(parcel.fastBonus) || 0 : 0);
  state.score += points;
  state.deliveries += 1;
  state.stats.delivered += 1;
  if (fast) state.stats.fastDeliveries += 1;
  state.combo = Math.min(Number(level.combo.max) || 5, multiplier + 1);
  state.bestCombo = Math.max(state.bestCombo, state.combo);
  state.comboTimerMs = Number(level.combo.windowMs) || 4200;
  state.ship.carry = null;
  emit(state, fast ? 'deliver-fast' : 'deliver');
}

/**
 * Advance the run by `dtMs` of wall time.
 * @returns {{events:string[]}} event names this tick (batchable for audio/UI).
 */
export function stepRun(level, state, dtMs, input = {}) {
  state.events = [];
  if (state.phase !== 'playing') return { events: [] };
  const dt = Math.max(0, Math.min(Number(dtMs) || 0, 50));
  if (dt === 0) return { events: [] };

  state.elapsedMs += dt;
  state.timeLeftMs = Math.max(0, state.durationMs - state.elapsedMs);
  if (state.invulnerableMs > 0) state.invulnerableMs = Math.max(0, state.invulnerableMs - dt);
  if (state.comboTimerMs > 0) {
    state.comboTimerMs = Math.max(0, state.comboTimerMs - dt);
    if (state.comboTimerMs === 0) state.combo = 1;
  }
  if (state.ship.ringCooldownMs > 0) state.ship.ringCooldownMs = Math.max(0, state.ship.ringCooldownMs - dt);

  const act = currentAct(level, state);
  const ship = state.ship;

  // Steering.
  const rotate = input.rotate === -1 || input.rotate === 1 ? input.rotate : 0;
  if (rotate !== 0) {
    const speed = Number(level.ship.angularSpeed) || 1.8;
    ship.angle = wrapAngle(ship.angle + rotate * speed * (dt / 1000));
  }
  if ((input.ring === -1 || input.ring === 1) && ship.ringCooldownMs === 0) {
    const rings = level.geometry.rings.length;
    const next = Math.max(0, Math.min(rings - 1, ship.ring + input.ring));
    if (next !== ship.ring) {
      ship.ring = next;
      ship.ringCooldownMs = Number(level.ship.ringCooldownMs) || 170;
      emit(state, 'lane');
    }
  }

  // Act progression and act timers.
  advanceAct(level, state);
  const activeAct = currentAct(level, state);

  // Parcel spawning and expiry.
  state.spawnTimerMs -= dt;
  if (state.spawnTimerMs <= 0) {
    state.spawnTimerMs = Number(activeAct.spawnIntervalMs) || 2000;
    if (state.parcels.length < (Number(activeAct.maxParcels) || 2)) spawnParcel(level, state);
  }
  const survivingParcels = [];
  for (const parcel of state.parcels) {
    const ttl = Number(parcel.ttlMs) || 0;
    if (ttl > 0 && state.elapsedMs - parcel.bornAtMs >= ttl) {
      state.stats.missed += 1;
      continue;
    }
    survivingParcels.push(parcel);
  }
  state.parcels = survivingParcels;

  // Asteroid upkeep, movement and expiry.
  ensureAsteroids(level, state);
  if (activeAct.burstEveryMs) {
    state.burstTimerMs -= dt;
    if (state.burstTimerMs <= 0) {
      state.burstTimerMs = Number(activeAct.burstEveryMs);
      const count = Math.max(1, Number(activeAct.burstCount) || 2);
      for (let index = 0; index < count; index += 1) {
        spawnAsteroid(level, state, { ttlMs: Number(activeAct.burstTtlMs) || 7000 });
      }
      emit(state, 'burst');
    }
  }
  const survivingAsteroids = [];
  for (const rock of state.asteroids) {
    rock.angle = wrapAngle(rock.angle + rock.dir * rock.speed * (dt / 1000));
    if (rock.ttlMs !== null && state.elapsedMs - rock.bornAtMs >= rock.ttlMs) continue;
    survivingAsteroids.push(rock);
  }
  state.asteroids = survivingAsteroids;

  // Collection: touch a parcel while the cargo bay is empty.
  if (!ship.carry) {
    for (let index = 0; index < state.parcels.length; index += 1) {
      const parcel = state.parcels[index];
      if (parcel.ring !== ship.ring) continue;
      if (Math.abs(angleDelta(ship.angle, parcel.angle)) > Number(level.parcel.collectAngle)) continue;
      ship.carry = { id: parcel.id, bornAtMs: state.elapsedMs };
      state.stats.collected += 1;
      state.parcels.splice(index, 1);
      emit(state, 'collect');
      break;
    }
  }

  // Delivery: cross the station gate while carrying.
  if (ship.carry) {
    const station = level.geometry.stationAngle || 0;
    if (Math.abs(angleDelta(ship.angle, station)) <= Number(level.parcel.deliveryAngle)) deliver(level, state);
  }

  // Collision: an asteroid on the same ring at the ship's angle.
  if (state.invulnerableMs === 0) {
    for (const rock of state.asteroids) {
      if (rock.ring !== ship.ring) continue;
      if (Math.abs(angleDelta(ship.angle, rock.angle)) > Number(level.ship.hitAngle)) continue;
      hitShip(level, state);
      break;
    }
  }

  // Clock.
  if (state.phase === 'playing' && state.elapsedMs >= state.durationMs) finishRun(level, state, 'shift-complete');
  return { events: state.events.slice() };
}

/** Final score for an ended run (falls back to the live score). */
export function scoreOf(state) {
  if (Number.isFinite(state.finalScore)) return state.finalScore;
  return Math.max(0, Math.round(state.score));
}

/** Serialize the resumable part of a run (contract: save.schemaVersion 1). */
export function serializeRun(state) {
  return {
    schemaVersion: RUN_SAVE_SCHEMA_VERSION,
    levelId: state.levelId,
    phase: state.phase === 'ended' ? 'ended' : 'paused',
    endReason: state.phase === 'ended' ? state.endReason : null,
    seed: state.seed,
    elapsedMs: Math.round(state.elapsedMs),
    actIndex: state.actIndex,
    ship: {
      ring: state.ship.ring,
      angle: Math.round(state.ship.angle * 10000) / 10000,
      carry: state.ship.carry
        ? { id: state.ship.carry.id, bornAtMs: Math.round(state.ship.carry.bornAtMs) }
        : null,
    },
    score: state.score,
    deliveries: state.deliveries,
    combo: state.combo,
    bestCombo: state.bestCombo,
    comboTimerMs: Math.round(state.comboTimerMs),
    shield: state.shield,
    stats: { ...state.stats },
    savedAt: null,
  };
}

/**
 * True when the run state is worth persisting.
 *
 * A save must never contain a menu/loading state: the host may deliver a
 * lifecycle `pause` (e.g. when relaunching a paused game) before the player has
 * started a run, and writing the fresh `ready` state would clobber the
 * resumable save that Continue depends on. Ended runs are cleaned up instead.
 */
export function shouldPersistRun(state) {
  if (!state || typeof state !== 'object') return false;
  if (state.phase !== 'playing' && state.phase !== 'paused') return false;
  if (!Number.isFinite(state.elapsedMs) || state.elapsedMs < 500) return false;
  return true;
}

/** True when a save is worth offering as "Continue". */
export function shouldOfferContinue(save) {
  if (!save || save.schemaVersion !== RUN_SAVE_SCHEMA_VERSION) return false;
  if (save.phase === 'ended') return false;
  if (!Number.isFinite(save.elapsedMs) || save.elapsedMs < 1000) return false;
  return true;
}

/**
 * Rebuild a run from a save. Entities (parcels/asteroids) are regenerated from
 * the saved seed, so a resumed shift keeps its difficulty phase but starts with
 * a clean local situation — the score, combo, shield and clock all carry over.
 */
export function hydrateRun(level, save, options = {}) {
  assertLevel(level);
  if (!save || save.schemaVersion !== RUN_SAVE_SCHEMA_VERSION) return null;
  const seed = Number.isFinite(save.seed) ? save.seed >>> 0 : (Number(options.seed) || 0x5eed1234);
  const state = createRunState(level, { seed });
  state.phase = 'paused';
  state.elapsedMs = Math.max(0, Math.min(Number(save.elapsedMs) || 0, state.durationMs));
  state.timeLeftMs = Math.max(0, state.durationMs - state.elapsedMs);
  // The clock is authoritative: an old save may carry a stale act index, so the
  // act is re-derived from the elapsed time and clamped to the level's acts.
  let actIndex = 0;
  for (let index = 0; index < level.acts.length; index += 1) {
    if (state.elapsedMs >= level.acts[index].fromSeconds * 1000) actIndex = index;
  }
  state.actIndex = actIndex;
  const rings = level.geometry.rings.length;
  state.ship.ring = Math.max(0, Math.min(rings - 1, Number(save.ship && save.ship.ring) || 0));
  state.ship.angle = wrapAngle(Number(save.ship && save.ship.angle) || 0);
  state.ship.carry = save.ship && save.ship.carry
    ? { id: Number(save.ship.carry.id) || 1, bornAtMs: Math.max(0, Number(save.ship.carry.bornAtMs) || 0) }
    : null;
  state.score = Math.max(0, Number(save.score) || 0);
  state.deliveries = Math.max(0, Number(save.deliveries) || 0);
  state.combo = Math.max(1, Math.min(Number(level.combo.max) || 5, Number(save.combo) || 1));
  state.bestCombo = Math.max(state.combo, Number(save.bestCombo) || state.combo);
  state.comboTimerMs = Math.max(0, Number(save.comboTimerMs) || 0);
  state.shield = Math.max(1, Math.min(Number(level.shield) || 3, Number(save.shield) || 3));
  state.stats = { ...state.stats, ...(save.stats || {}) };
  // Seed entity placement from the resumed clock so different saves diverge.
  const prewarm = createRng(seed ^ Math.round(state.elapsedMs / 1000));
  state.rng = prewarm;
  state.spawnTimerMs = Number(currentAct(level, state).spawnIntervalMs) || 2000;
  state.burstTimerMs = Number(currentAct(level, state).burstEveryMs) || 0;
  ensureAsteroids(level, state);
  return state;
}
