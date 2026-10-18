/**
 * Jump — pure game logic.
 *
 * This module has no DOM, SDK, timer or random-global dependency: the same
 * seed plus the same input sequence always produces the same world, which is
 * what makes saves, Continue and the tests reproducible.
 *
 * Coordinate system: world Y grows upwards. `y` is the player centre; a
 * platform's `y` is its top surface. The camera's `y` is the world Y of the
 * bottom edge of the screen. Screen Y is derived in the renderer.
 */

export const VIEW_WIDTH = 540;
export const VIEW_HEIGHT = 960;

/** Fixed simulation step (60 Hz). Rendering may run faster, logic never does. */
export const STEP_SECONDS = 1 / 60;

/** Physics, in logical pixels and seconds. */
export const GRAVITY = 2100;
export const BOUNCE_VY = 1080;
export const SPRING_VY = 1750;
export const TERMINAL_VY = 1900;
export const MOVE_SPEED = 430;

export const PLAYER_HALF_WIDTH = 17;
export const PLAYER_HALF_HEIGHT = 21;

export const PLATFORM_HEIGHT = 14;
export const START_PLATFORM_Y = 120;
export const START_PLAYER_Y = START_PLATFORM_Y + PLAYER_HALF_HEIGHT;

/** The camera keeps the player at ~38% from the top once it starts following. */
export const CAMERA_ANCHOR = 0.62;
export const OUT_OF_VIEW_MARGIN = 40;
export const CULL_BELOW_VIEW = 420;
export const GENERATE_AHEAD = 900;
export const MAX_PLATFORMS = 64;

/** Ten logical pixels are one displayed metre; the submitted score is metres. */
export const PIXELS_PER_METER = 10;
export const SCORE_MAX = 1000000;

export const SAVE_VERSION = 1;

export const MIN_PLATFORM_GAP = 84;
export const MAX_PLATFORM_GAP = 142;
export const MAX_PLATFORM_DX = 210;
export const PLATFORM_MARGIN = 14;
export const MOVING_SPEED_MIN = 58;
export const MOVING_SPEED_MAX = 96;

export const PLATFORM_TYPES = Object.freeze(['normal', 'moving', 'fragile', 'spring']);

const PLATFORM_WIDTHS = Object.freeze({
  normal: Object.freeze([104, 128]),
  moving: Object.freeze([98, 114]),
  fragile: Object.freeze([94, 110]),
  spring: Object.freeze([100, 118]),
});

/** Metrics used by the reachability tests and the README. */
export const JUMP_PROFILE = Object.freeze({
  maxRise: (BOUNCE_VY * BOUNCE_VY) / (2 * GRAVITY),
  springRise: (SPRING_VY * SPRING_VY) / (2 * GRAVITY),
  terminalFall: TERMINAL_VY,
});

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function normalizeSeed(seed) {
  const numeric = typeof seed === 'number' && Number.isFinite(seed) ? Math.floor(seed) : 1;
  return numeric >>> 0 || 1;
}

/**
 * Mulberry32 step. Returns the next uint32 state and a float in [0, 1).
 * @param {number} rngState
 */
export function nextRandom(rngState) {
  const nextState = (rngState + 0x6d2b79f5) >>> 0;
  let t = nextState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { rngState: nextState, value };
}

function takeRandom(state, key) {
  const result = nextRandom(state[key]);
  state[key] = result.rngState;
  return result.value;
}

/**
 * How far the player can travel horizontally before falling back to `rise`
 * pixels above the bounce point. Used to prove generated platforms are
 * reachable with a comfortable margin.
 * @param {number} rise
 */
export function horizontalReachForRise(rise) {
  const discriminant = BOUNCE_VY * BOUNCE_VY - 2 * GRAVITY * rise;
  if (!(discriminant >= 0)) return 0;
  const timeUntilDescending = (BOUNCE_VY + Math.sqrt(discriminant)) / GRAVITY;
  return timeUntilDescending * MOVE_SPEED;
}

function chooseType(roll, platformSeq) {
  if (platformSeq < 4) return 'normal';
  const ramp = Math.min(1, (platformSeq - 3) / 10);
  const moving = 0.12 + 0.1 * ramp;
  const fragile = 0.06 + 0.12 * ramp;
  const spring = 0.06 + 0.05 * ramp;
  const normal = 1 - moving - fragile - spring;
  if (roll < normal) return 'normal';
  if (roll < normal + moving) return 'moving';
  if (roll < normal + moving + fragile) return 'fragile';
  return 'spring';
}

/**
 * Append one procedurally generated platform above the current top one.
 * Internal helper: the field object is mutated so a single construction can
 * keep drawing from one RNG stream.
 */
function appendPlatform(field) {
  const last = field.platforms[field.platforms.length - 1];
  if (!last) throw new Error('cannot generate a platform without a base platform');

  const gapRoll = takeRandom(field, 'rngState');
  const gap = MIN_PLATFORM_GAP + Math.floor(gapRoll * (MAX_PLATFORM_GAP - MIN_PLATFORM_GAP + 1));
  const y = last.y + gap;

  const typeRoll = takeRandom(field, 'rngState');
  const type = chooseType(typeRoll, field.platformSeq);

  const widthRange = PLATFORM_WIDTHS[type];
  const widthRoll = takeRandom(field, 'rngState');
  const w = widthRange[0] + Math.floor(widthRoll * (widthRange[1] - widthRange[0] + 1));

  const dxRoll = takeRandom(field, 'rngState');
  const dx = (dxRoll * 2 - 1) * MAX_PLATFORM_DX;
  const previousCenter = last.x + last.w / 2;
  const halfWidth = w / 2;
  const minCenter = halfWidth + PLATFORM_MARGIN;
  const maxCenter = VIEW_WIDTH - halfWidth - PLATFORM_MARGIN;
  const center = clamp(previousCenter + dx, minCenter, maxCenter);
  const x = Math.round(center - halfWidth);

  const platform = {
    id: field.platformSeq,
    x,
    y,
    w,
    type,
    vx: 0,
    dir: 1,
    broken: false,
  };

  if (type === 'moving') {
    const speedRoll = takeRandom(field, 'rngState');
    platform.vx = MOVING_SPEED_MIN + Math.round(speedRoll * (MOVING_SPEED_MAX - MOVING_SPEED_MIN));
    const dirRoll = takeRandom(field, 'rngState');
    platform.dir = dirRoll < 0.5 ? -1 : 1;
  }

  field.platforms.push(platform);
  field.platformSeq += 1;
}

/**
 * Build a deterministic ladder of platforms.
 *
 * @param {{seed?: number, startY?: number, targetTopY?: number}} [options]
 * @returns {{platforms: object[], rngState: number, platformSeq: number}}
 */
export function createPlatformField(options = {}) {
  const seed = normalizeSeed(options.seed);
  const startY = Number.isFinite(options.startY) ? options.startY : START_PLATFORM_Y;
  const targetTopY = Number.isFinite(options.targetTopY)
    ? options.targetTopY
    : startY + VIEW_HEIGHT + GENERATE_AHEAD;

  const firstWidth = 128;
  const field = {
    platforms: [
      {
        id: 0,
        x: Math.round((VIEW_WIDTH - firstWidth) / 2),
        y: startY,
        w: firstWidth,
        type: 'normal',
        vx: 0,
        dir: 1,
        broken: false,
      },
    ],
    rngState: seed,
    platformSeq: 1,
  };

  while (field.platforms[field.platforms.length - 1].y < targetTopY) {
    appendPlatform(field);
  }
  return {
    platforms: field.platforms,
    rngState: field.rngState >>> 0,
    platformSeq: field.platformSeq,
  };
}

/**
 * New game in `ready` state (no physics until `startRun`).
 * @param {{seed?: number}} [options]
 */
export function createGame(options = {}) {
  const seed = normalizeSeed(options.seed);
  const field = createPlatformField({ seed });
  const first = field.platforms[0];
  first.x = Math.round((VIEW_WIDTH - first.w) / 2);

  return {
    seed,
    rngState: field.rngState >>> 0,
    platformSeq: field.platformSeq,
    platforms: field.platforms,
    player: { x: VIEW_WIDTH / 2, y: START_PLAYER_Y, vy: 0 },
    camera: { y: 0 },
    score: 0,
    maxHeight: START_PLAYER_Y,
    elapsed: 0,
    startY: START_PLAYER_Y,
    status: 'ready',
  };
}

/**
 * Turn a ready (or restored) snapshot into a running one. A restored mid-air
 * velocity is kept so Continue resumes the exact arc; a standing start gets
 * the first automatic bounce.
 */
export function startRun(state) {
  if (!state || state.status === 'over' || state.status === 'playing') return state;
  const player = { ...state.player };
  if (!Number.isFinite(player.vy) || player.vy === 0) player.vy = BOUNCE_VY;
  return { ...state, status: 'playing', player };
}

function movePlatforms(platforms, dt) {
  let changed = false;
  const next = platforms.map((platform) => {
    if (platform.type !== 'moving' || platform.broken) return platform;
    const minX = PLATFORM_MARGIN;
    const maxX = VIEW_WIDTH - PLATFORM_MARGIN - platform.w;
    let x = platform.x + platform.dir * platform.vx * dt;
    let dir = platform.dir;
    if (x <= minX) {
      x = minX;
      dir = 1;
    } else if (x >= maxX) {
      x = maxX;
      dir = -1;
    }
    if (x === platform.x && dir === platform.dir) return platform;
    changed = true;
    return { ...platform, x, dir };
  });
  return changed ? next : platforms;
}

function findLanding(previousPlayer, nextPlayer, platforms) {
  if (!(nextPlayer.vy < 0)) return null;
  const previousBottom = previousPlayer.y - PLAYER_HALF_HEIGHT;
  const nextBottom = nextPlayer.y - PLAYER_HALF_HEIGHT;
  let bestIndex = -1;
  let bestY = -Infinity;

  for (let index = 0; index < platforms.length; index += 1) {
    const platform = platforms[index];
    if (platform.broken) continue;
    // The platform top must have been crossed from above during this step.
    if (platform.y > previousBottom + 1e-6) continue;
    if (platform.y < nextBottom - 1e-6) continue;
    const overlap =
      Math.min(nextPlayer.x + PLAYER_HALF_WIDTH, platform.x + platform.w) -
      Math.max(nextPlayer.x - PLAYER_HALF_WIDTH, platform.x);
    if (overlap < 8) continue;
    if (platform.y > bestY) {
      bestY = platform.y;
      bestIndex = index;
    }
  }

  if (bestIndex === -1) return null;
  return { index: bestIndex, platform: platforms[bestIndex] };
}

function ensurePlatforms(platforms, rngState, platformSeq, cameraY) {
  let topY = platforms.length ? platforms[platforms.length - 1].y : 0;
  const targetTopY = cameraY + VIEW_HEIGHT + GENERATE_AHEAD;
  if (topY >= targetTopY) return { platforms, rngState, platformSeq };

  const field = { platforms: platforms.slice(), rngState, platformSeq };
  // A corrupt save could place the camera arbitrarily high; cap the amount of
  // work per step so one bad snapshot can never freeze the game.
  let guard = 0;
  while (field.platforms[field.platforms.length - 1].y < targetTopY && guard < 32) {
    appendPlatform(field);
    guard += 1;
  }
  return {
    platforms: field.platforms,
    rngState: field.rngState >>> 0,
    platformSeq: field.platformSeq,
  };
}

function trimPlatforms(platforms, cameraY) {
  const cutoff = cameraY - CULL_BELOW_VIEW;
  let next = platforms;
  if (next.length && next[0].y < cutoff) {
    next = next.filter((platform) => platform.y >= cutoff);
  }
  if (next.length > MAX_PLATFORMS) {
    next = next.slice(next.length - MAX_PLATFORMS);
  }
  return next;
}

/**
 * Advance exactly one fixed step. States that are not `playing` are returned
 * unchanged (same reference), so ready/paused/over snapshots never drift.
 *
 * @param {object} state
 * @param {{left?: boolean, right?: boolean}} [input]
 */
export function stepGame(state, input = {}) {
  if (!state || state.status !== 'playing') return state;

  const dt = STEP_SECONDS;
  const left = input.left === true;
  const right = input.right === true && !left;
  const previousPlayer = state.player;

  const player = {
    x: clamp(
      previousPlayer.x + (right ? 1 : 0) * MOVE_SPEED * dt - (left ? 1 : 0) * MOVE_SPEED * dt,
      PLAYER_HALF_WIDTH,
      VIEW_WIDTH - PLAYER_HALF_WIDTH
    ),
    y: previousPlayer.y,
    vy: previousPlayer.vy - GRAVITY * dt,
  };
  if (player.vy < -TERMINAL_VY) player.vy = -TERMINAL_VY;
  player.y += player.vy * dt;

  let platforms = movePlatforms(state.platforms, dt);
  const landing = findLanding(previousPlayer, player, platforms);
  const elapsed = state.elapsed + dt;

  if (landing) {
    const platform = landing.platform;
    player.y = platform.y + PLAYER_HALF_HEIGHT;
    player.vy = platform.type === 'spring' ? SPRING_VY : BOUNCE_VY;
    const updated = { ...platform, bounceAt: elapsed };
    if (platform.type === 'fragile') {
      updated.broken = true;
      updated.brokenAt = elapsed;
    }
    platforms = platforms.slice();
    platforms[landing.index] = updated;
  }

  const maxHeight = Math.max(state.maxHeight, player.y);
  const score = Math.min(
    SCORE_MAX,
    Math.max(0, Math.floor((maxHeight - state.startY) / PIXELS_PER_METER))
  );
  const cameraY = Math.max(state.camera.y, player.y - VIEW_HEIGHT * CAMERA_ANCHOR, 0);
  const camera = cameraY === state.camera.y ? state.camera : { y: cameraY };
  const outOfView = player.y + PLAYER_HALF_HEIGHT < camera.y - OUT_OF_VIEW_MARGIN;
  const status = outOfView ? 'over' : 'playing';

  const grown = ensurePlatforms(platforms, state.rngState, state.platformSeq, camera.y);
  const trimmed = trimPlatforms(grown.platforms, camera.y);

  return {
    ...state,
    player,
    platforms: trimmed,
    camera,
    rngState: grown.rngState,
    platformSeq: grown.platformSeq,
    score,
    maxHeight,
    elapsed,
    status,
  };
}

function round(value, digits) {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function serializePlatform(platform) {
  const saved = {
    id: platform.id,
    x: platform.x,
    y: platform.y,
    w: platform.w,
    type: platform.type,
  };
  if (platform.type === 'moving') {
    saved.vx = platform.vx;
    saved.dir = platform.dir;
  }
  if (platform.broken) saved.broken = true;
  return saved;
}

/**
 * Save payload for `storage.save('current', …)`. A run in progress is stored
 * as `ready`: loading it must not start physics before the player continues.
 */
export function serialize(state) {
  return {
    version: SAVE_VERSION,
    seed: state.seed >>> 0,
    platforms: state.platforms.map(serializePlatform),
    player: { x: state.player.x, y: state.player.y, vy: state.player.vy },
    camera: { y: state.camera.y },
    score: state.score,
    elapsed: round(state.elapsed, 3),
    maxHeight: state.maxHeight,
    startY: state.startY,
    rngState: state.rngState >>> 0,
    platformSeq: state.platformSeq,
    status: state.status === 'over' ? 'over' : 'ready',
  };
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeSavedPlatform(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { id, x, y, w, type } = value;
  if (!Number.isInteger(id) || id < 0) return null;
  if (!finiteNumber(x) || !finiteNumber(y)) return null;
  if (!Number.isInteger(w) || w < 48 || w > VIEW_WIDTH) return null;
  if (!PLATFORM_TYPES.includes(type)) return null;
  if (x < -PLATFORM_MARGIN || x + w > VIEW_WIDTH + PLATFORM_MARGIN) return null;
  if (y < -100000 || y > 100000000) return null;

  const platform = { id, x, y, w, type, vx: 0, dir: 1, broken: value.broken === true };
  if (type === 'moving') {
    if (!finiteNumber(value.vx) || value.vx < 0 || value.vx > 500) return null;
    if (value.dir !== 1 && value.dir !== -1) return null;
    platform.vx = value.vx;
    platform.dir = value.dir;
  }
  return platform;
}

/**
 * Validate and normalize a save payload. Accepts an object or a JSON string.
 * Returns `null` for anything corrupt; never throws.
 */
export function deserialize(raw) {
  let save = raw;
  if (typeof raw === 'string') {
    try {
      save = JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }
  if (!save || typeof save !== 'object' || Array.isArray(save)) return null;
  if (save.version !== SAVE_VERSION) return null;

  if (!Number.isInteger(save.seed) || save.seed < 0 || save.seed > 0xffffffff) return null;
  const seed = normalizeSeed(save.seed);
  if (!Number.isInteger(save.rngState) || save.rngState < 0 || save.rngState > 0xffffffff) return null;
  if (!Array.isArray(save.platforms) || save.platforms.length < 1 || save.platforms.length > MAX_PLATFORMS) {
    return null;
  }

  const platforms = [];
  const ids = new Set();
  let previousY = -Infinity;
  for (const rawPlatform of save.platforms) {
    const platform = normalizeSavedPlatform(rawPlatform);
    if (!platform) return null;
    if (ids.has(platform.id)) return null;
    if (platform.y <= previousY) return null;
    ids.add(platform.id);
    previousY = platform.y;
    platforms.push(platform);
  }

  const player = save.player;
  if (!player || typeof player !== 'object' || Array.isArray(player)) return null;
  if (!finiteNumber(player.x) || !finiteNumber(player.y) || !finiteNumber(player.vy)) return null;
  if (player.x < 0 || player.x > VIEW_WIDTH) return null;
  if (player.y < -100000 || player.y > 100000000) return null;
  if (Math.abs(player.vy) > 5000) return null;

  const camera = save.camera;
  if (!camera || typeof camera !== 'object' || Array.isArray(camera)) return null;
  if (!finiteNumber(camera.y) || camera.y < 0 || camera.y > 100000000) return null;
  if (camera.y > player.y + VIEW_HEIGHT) return null;
  // A finished run is expected to be below the camera; only a live save that
  // is already out of view is inconsistent.
  if (save.status !== 'over' && player.y + PLAYER_HALF_HEIGHT < camera.y - OUT_OF_VIEW_MARGIN) return null;

  if (!Number.isInteger(save.score) || save.score < 0 || save.score > SCORE_MAX) return null;
  if (!finiteNumber(save.elapsed) || save.elapsed < 0 || save.elapsed > 1000000000) return null;
  if (!finiteNumber(save.maxHeight) || save.maxHeight < 0) return null;
  if (!finiteNumber(save.startY)) return null;
  if (!Number.isInteger(save.platformSeq) || save.platformSeq < 1) return null;
  if (save.status !== 'ready' && save.status !== 'playing' && save.status !== 'over') return null;

  return {
    seed,
    rngState: save.rngState >>> 0,
    platformSeq: save.platformSeq,
    platforms,
    player: { x: player.x, y: player.y, vy: player.vy },
    camera: { y: camera.y },
    score: save.score,
    maxHeight: Math.max(save.maxHeight, player.y),
    elapsed: save.elapsed,
    startY: save.startY,
    status: save.status,
  };
}

/** Convenience for tests and diagnostics: score implied by a state. */
export function scoreForHeight(maxHeight, startY) {
  return Math.min(SCORE_MAX, Math.max(0, Math.floor((maxHeight - startY) / PIXELS_PER_METER)));
}
