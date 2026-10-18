/**
 * Pure save/restore helpers (PRD §8.2.9 item 2).
 *
 * `serialize` and `deserialize` are synchronous, idempotent and never touch the
 * network or the DOM: the Runtime may ask for a snapshot at any moment.
 * Coordinates are normalized so a save restored at a different viewport size
 * still makes sense.
 */

export const SAVE_VERSION = 1;
export const MAX_STARS = 32;

export function createInitialState() {
  return {
    saveVersion: SAVE_VERSION,
    score: 0,
    lives: 3,
    elapsed: 0,
    stars: [],
    spawnIn: 0.45,
    speed: 0.2,
    basket: 0.5,
    gameOver: false,
  };
}

function finiteNumber(value, fallback, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function cloneStar(star) {
  return {
    x: finiteNumber(star && star.x, 0.5, 0, 1),
    y: finiteNumber(star && star.y, -0.1, -0.5, 1.5),
    vy: finiteNumber(star && star.vy, 0.2, 0.01, 2),
    r: finiteNumber(star && star.r, 10, 4, 32),
    tone: star && star.tone === 'meteor' ? 'meteor' : 'star',
  };
}

/** Pure snapshot; returns a fresh JSON-ready object. */
export function serializeState(state) {
  const stars = Array.isArray(state.stars) ? state.stars.slice(0, MAX_STARS).map(cloneStar) : [];
  return {
    saveVersion: SAVE_VERSION,
    score: finiteNumber(state.score, 0, 0, 1000000),
    lives: Math.round(finiteNumber(state.lives, 3, 0, 3)),
    elapsed: finiteNumber(state.elapsed, 0, 0, 60 * 60 * 24),
    stars,
    spawnIn: finiteNumber(state.spawnIn, 0.4, 0, 10),
    speed: finiteNumber(state.speed, 0.2, 0.05, 2),
    basket: finiteNumber(state.basket, 0.5, 0, 1),
    gameOver: state.gameOver === true,
  };
}

/**
 * Restore a snapshot. Returns `null` for missing/foreign/finished saves so the
 * caller can start a fresh game (Continue must not resume a finished run).
 */
export function deserializeState(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (data.saveVersion !== SAVE_VERSION) return null;
  if (data.gameOver === true) return null;
  const lives = Math.round(finiteNumber(data.lives, 0, 0, 3));
  if (lives <= 0) return null;
  const stars = Array.isArray(data.stars) ? data.stars.slice(0, MAX_STARS).map(cloneStar) : [];
  return {
    saveVersion: SAVE_VERSION,
    score: finiteNumber(data.score, 0, 0, 1000000),
    lives,
    elapsed: finiteNumber(data.elapsed, 0, 0, 60 * 60 * 24),
    stars,
    spawnIn: finiteNumber(data.spawnIn, 0.4, 0, 10),
    speed: finiteNumber(data.speed, 0.2, 0.05, 2),
    basket: finiteNumber(data.basket, 0.5, 0, 1),
    gameOver: false,
  };
}
