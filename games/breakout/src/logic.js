/**
 * Pure Breakout rules: paddle/ball/brick collisions, brick durability, scoring,
 * lives, level layouts, level progression and save encoding.
 *
 * This module is deliberately free of DOM, timers and wall-clock reads so the
 * whole rule set can be replayed by `node --test` (V1-GAME-ACCEPTANCE §5.6).
 * The game loop feeds fixed `STEP_MS` slices; `step()` mutates the state and
 * returns the events the UI/SDK layer cares about.
 */

export const LOGICAL_WIDTH = 960;
export const LOGICAL_HEIGHT = 540;
export const SAVE_SCHEMA_VERSION = 1;
export const SAVE_KEY = 'current';
export const SCORE_MAX = 10000000;
export const START_LIVES = 3;
export const LEVEL_CLEAR_MS = 1200;
export const STEP_MS = 1000 / 120;

export const FIELD = Object.freeze({ left: 44, right: 916, top: 92, bottom: 520 });
export const PADDLE = Object.freeze({ width: 108, height: 14, y: 496, speed: 640 });
export const BALL = Object.freeze({
  radius: 7,
  baseSpeed: 360,
  maxSpeed: 760,
  maxBounceAngle: Math.PI / 3,
});
export const BRICK = Object.freeze({ cols: 12, height: 22, gapX: 5, gapY: 6, top: 128 });
export const BRICK_WIDTH = (FIELD.right - FIELD.left - BRICK.gapX * (BRICK.cols - 1)) / BRICK.cols;

export const BRICK_TYPES = Object.freeze({ normal: 'normal', hard: 'hard', solid: 'solid' });

/** Five hand-tuned layouts. `1` normal, `2` hard (2 HP), `X` indestructible. */
export const LEVELS = Object.freeze([
  Object.freeze({
    number: 1,
    nameZh: '初次接触',
    nameEn: 'First Contact',
    speed: 1,
    layout: Object.freeze([
      '111111111111',
      '111122111111',
      '111111111111',
      '111111111111',
    ]),
  }),
  Object.freeze({
    number: 2,
    nameZh: '双塔',
    nameEn: 'Twin Towers',
    speed: 1.08,
    layout: Object.freeze([
      '22........22',
      '22..1111..22',
      '22..1111..22',
      '22..1111..22',
      '22........22',
    ]),
  }),
  Object.freeze({
    number: 3,
    nameZh: '蜂巢',
    nameEn: 'Honeycomb',
    speed: 1.16,
    layout: Object.freeze([
      '1.1.1.1.1.1.',
      '.2.2.2.2.2.2',
      '1.1.1.1.1.1.',
      '.2.2.2.2.2.2',
      '1.1.X.1.1.1.',
    ]),
  }),
  Object.freeze({
    number: 4,
    nameZh: '要塞',
    nameEn: 'Fortress',
    speed: 1.24,
    layout: Object.freeze([
      'XX11111111XX',
      'X.22222222.X',
      'X.22XXXX22.X',
      'X.22222222.X',
      'XX11111111XX',
    ]),
  }),
  Object.freeze({
    number: 5,
    nameZh: '终局',
    nameEn: 'Last Stand',
    speed: 1.32,
    layout: Object.freeze([
      '2X2X2X2X2X2X',
      'X2X2X2X2X2X2',
      '222222222222',
      'X1111111111X',
      'X.22222222.X',
      'XX22222222XX',
    ]),
  }),
]);

const TYPE_BY_CHAR = Object.freeze({ 1: BRICK_TYPES.normal, 2: BRICK_TYPES.hard, X: BRICK_TYPES.solid });

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function nextRandom(seed) {
  let a = seed >>> 0;
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: a, value };
}

/** Durability for a brick type. `solid` uses -1 so saves stay JSON-safe. */
export function maxHpForType(type) {
  if (type === BRICK_TYPES.hard) return 2;
  if (type === BRICK_TYPES.solid) return -1;
  return 1;
}

/** Points for one brick impact. Solid bricks never score. */
export function pointsForHit(type, destroyed) {
  if (type === BRICK_TYPES.normal) return 10;
  if (type === BRICK_TYPES.hard) return destroyed ? 30 : 10;
  return 0;
}

/** Level-clear reward is monotonic and reproducible (acceptance §5.4). */
export function levelClearBonus(level) {
  return 100 * clampInt(level, 1, LEVELS.length, 1);
}

export function levelDefinition(levelNumber) {
  return LEVELS[clampInt(levelNumber, 1, LEVELS.length, 1) - 1];
}

export function brickRect(brick) {
  return {
    x: FIELD.left + brick.col * (BRICK_WIDTH + BRICK.gapX),
    y: BRICK.top + brick.row * (BRICK.height + BRICK.gapY),
    width: BRICK_WIDTH,
    height: BRICK.height,
  };
}

/** Build the alive-brick list for a level. Pure and deterministic. */
export function createBricks(levelNumber) {
  const level = levelDefinition(levelNumber);
  const bricks = [];
  for (let row = 0; row < level.layout.length; row += 1) {
    const line = level.layout[row];
    for (let col = 0; col < line.length; col += 1) {
      const type = TYPE_BY_CHAR[line[col]];
      if (!type) continue;
      bricks.push({ row, col, type, hp: maxHpForType(type) });
    }
  }
  return bricks;
}

/** Speed grows with the level, brick impacts and time spent in the level. */
export function currentSpeed(state) {
  const level = levelDefinition(state.level);
  const hitBonus = Math.min(160, Math.max(0, state.levelHits || 0) * 4);
  const timeBonus = Math.min(90, Math.floor(Math.max(0, state.elapsedMs || 0) / 10000) * 10);
  return Math.min(BALL.maxSpeed, BALL.baseSpeed * level.speed + hitBonus + timeBonus);
}

export function destructibleCount(state) {
  let count = 0;
  for (const brick of state.bricks) {
    if (brick.type !== BRICK_TYPES.solid) count += 1;
  }
  return count;
}

function placeBallOnPaddle(state) {
  state.ball = {
    x: state.paddle.x,
    y: PADDLE.y - BALL.radius - 1.5,
    vx: 0,
    vy: 0,
    launched: false,
  };
}

function syncServeBall(state) {
  if (state.ball.launched) return;
  state.ball.x = state.paddle.x;
  state.ball.y = PADDLE.y - BALL.radius - 1.5;
  state.ball.vx = 0;
  state.ball.vy = 0;
}

/** Create a fresh run at `level` (1-based) with three lives. */
export function createState(options = {}) {
  const seed = Number.isFinite(options.seed) ? (options.seed >>> 0) || 1 : 1;
  const level = clampInt(options.level, 1, LEVELS.length, 1);
  const state = {
    version: SAVE_SCHEMA_VERSION,
    seed,
    rngState: seed,
    level,
    lives: START_LIVES,
    score: 0,
    status: 'ready',
    paddle: { x: (FIELD.left + FIELD.right) / 2 },
    ball: { x: 0, y: 0, vx: 0, vy: 0, launched: false },
    bricks: createBricks(level),
    levelHits: 0,
    elapsedMs: 0,
    clearTimer: 0,
  };
  placeBallOnPaddle(state);
  return state;
}

/** Keep score/lives/seed, reset paddle, ball and bricks for a level. */
export function startLevel(state, levelNumber) {
  state.level = clampInt(levelNumber, 1, LEVELS.length, 1);
  state.bricks = createBricks(state.level);
  state.paddle.x = (FIELD.left + FIELD.right) / 2;
  state.levelHits = 0;
  state.elapsedMs = 0;
  state.clearTimer = 0;
  state.status = 'ready';
  placeBallOnPaddle(state);
  return state;
}

export function restartState(state, seed) {
  const nextSeed = Number.isFinite(seed)
    ? seed >>> 0
    : state && Number.isFinite(state.seed)
      ? state.seed >>> 0
      : 1;
  return createState({ seed: nextSeed });
}

export function movePaddle(state, x) {
  const half = PADDLE.width / 2;
  const target = Number.isFinite(x) ? x : state.paddle.x;
  state.paddle.x = clamp(target, FIELD.left + half, FIELD.right - half);
  syncServeBall(state);
  return state.paddle.x;
}

export function nudgePaddle(state, direction, dtMs) {
  const sign = direction < 0 ? -1 : direction > 0 ? 1 : 0;
  const delta = (Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0) / 1000;
  return movePaddle(state, state.paddle.x + sign * PADDLE.speed * delta);
}

export function setPaused(state, paused) {
  if (paused && state.status === 'playing') state.status = 'paused';
  else if (!paused && state.status === 'paused') state.status = 'playing';
  return state.status;
}

function scaleBallSpeed(state) {
  const speed = Math.hypot(state.ball.vx, state.ball.vy);
  if (!(speed > 0)) return;
  const target = currentSpeed(state);
  state.ball.vx = (state.ball.vx / speed) * target;
  state.ball.vy = (state.ball.vy / speed) * target;
}

/**
 * Launch the served ball. The angle is seeded (22°–31° from vertical), so a
 * replay is reproducible while the ball never starts horizontally locked.
 */
export function launchBall(state) {
  if (state.status !== 'ready' && state.status !== 'playing') return false;
  if (state.ball.launched) return false;
  const speed = currentSpeed(state);
  const first = nextRandom(state.rngState);
  const second = nextRandom(first.state);
  state.rngState = second.state;
  const direction = first.value < 0.5 ? -1 : 1;
  const angle = BALL.maxBounceAngle * (0.34 + second.value * 0.18);
  state.ball.vx = direction * Math.sin(angle) * speed;
  state.ball.vy = -Math.cos(angle) * speed;
  state.ball.launched = true;
  state.status = 'playing';
  state.elapsedMs = 0;
  return true;
}

/**
 * Bounce off the paddle using the hit offset. The 60° cap guarantees a
 * vertical component of at least 0.5 × speed (no horizontal lock).
 */
export function bounceOffPaddle(state) {
  const speed = currentSpeed(state);
  const half = PADDLE.width / 2;
  const offset = clamp((state.ball.x - state.paddle.x) / half, -1, 1);
  const angle = offset * BALL.maxBounceAngle;
  state.ball.vx = Math.sin(angle) * speed;
  state.ball.vy = -Math.cos(angle) * speed;
  state.ball.y = PADDLE.y - BALL.radius - 0.01;
  state.ball.launched = true;
  return state.ball;
}

function circleHitsRect(cx, cy, radius, rect) {
  const closestX = clamp(cx, rect.x, rect.x + rect.width);
  const closestY = clamp(cy, rect.y, rect.y + rect.height);
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

function resolveWalls(state, events) {
  const ball = state.ball;
  const radius = BALL.radius;
  if (ball.x - radius < FIELD.left) {
    ball.x = FIELD.left + radius;
    if (ball.vx < 0) ball.vx = -ball.vx;
    events.push({ type: 'wall-hit', side: 'left' });
  } else if (ball.x + radius > FIELD.right) {
    ball.x = FIELD.right - radius;
    if (ball.vx > 0) ball.vx = -ball.vx;
    events.push({ type: 'wall-hit', side: 'right' });
  }
  if (ball.y - radius < FIELD.top) {
    ball.y = FIELD.top + radius;
    if (ball.vy < 0) ball.vy = -ball.vy;
    events.push({ type: 'wall-hit', side: 'top' });
  }
}

function resolvePaddle(state, events) {
  const ball = state.ball;
  if (ball.vy <= 0) return;
  const half = PADDLE.width / 2;
  const left = state.paddle.x - half;
  const right = state.paddle.x + half;
  const top = PADDLE.y;
  const bottom = PADDLE.y + PADDLE.height;
  const closestX = clamp(ball.x, left, right);
  const closestY = clamp(ball.y, top, bottom);
  const dx = ball.x - closestX;
  const dy = ball.y - closestY;
  if (dx * dx + dy * dy > BALL.radius * BALL.radius) return;
  if (ball.y > bottom) return;
  bounceOffPaddle(state);
  events.push({ type: 'paddle-hit', x: ball.x, y: top });
}

function damageBrick(state, brick, index, events) {
  const rect = brickRect(brick);
  let points = 0;
  let destroyed = false;
  if (brick.type !== BRICK_TYPES.solid) {
    brick.hp -= 1;
    if (brick.hp <= 0) {
      destroyed = true;
      state.bricks.splice(index, 1);
    }
    points = pointsForHit(brick.type, destroyed);
    state.score = Math.min(SCORE_MAX, state.score + points);
  }
  state.levelHits += 1;
  events.push({
    type: 'brick-hit',
    brickType: brick.type,
    row: brick.row,
    col: brick.col,
    points,
    destroyed,
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  });
}

function resolveBricks(state, previousX, previousY, events) {
  const ball = state.ball;
  const radius = BALL.radius;
  for (let index = 0; index < state.bricks.length; index += 1) {
    const brick = state.bricks[index];
    const rect = brickRect(brick);
    if (!circleHitsRect(ball.x, ball.y, radius, rect)) continue;

    const wasLeft = previousX + radius <= rect.x + 0.001;
    const wasRight = previousX - radius >= rect.x + rect.width - 0.001;
    const wasAbove = previousY + radius <= rect.y + 0.001;
    const wasBelow = previousY - radius >= rect.y + rect.height - 0.001;
    const overlapX = Math.min(ball.x + radius - rect.x, rect.x + rect.width - (ball.x - radius));
    const overlapY = Math.min(ball.y + radius - rect.y, rect.y + rect.height - (ball.y - radius));
    let horizontal;
    if ((wasLeft || wasRight) && !(wasAbove || wasBelow)) horizontal = true;
    else if (!(wasLeft || wasRight) && (wasAbove || wasBelow)) horizontal = false;
    else horizontal = overlapX < overlapY;

    if (horizontal) {
      const fromLeft = ball.x < rect.x + rect.width / 2;
      ball.x = fromLeft ? rect.x - radius - 0.01 : rect.x + rect.width + radius + 0.01;
      ball.vx = fromLeft ? -Math.abs(ball.vx) : Math.abs(ball.vx);
    } else {
      const fromTop = ball.y < rect.y + rect.height / 2;
      ball.y = fromTop ? rect.y - radius - 0.01 : rect.y + rect.height + radius + 0.01;
      ball.vy = fromTop ? -Math.abs(ball.vy) : Math.abs(ball.vy);
    }

    damageBrick(state, brick, index, events);
    scaleBallSpeed(state);
    break;
  }
}

function loseLife(state, events) {
  state.lives = Math.max(0, state.lives - 1);
  state.ball.launched = false;
  state.ball.vx = 0;
  state.ball.vy = 0;
  events.push({ type: 'life-lost', lives: state.lives });
  if (state.lives <= 0) {
    state.status = 'over';
    state.clearTimer = 0;
    events.push({ type: 'game-over', score: state.score });
    return;
  }
  state.status = 'ready';
  state.paddle.x = (FIELD.left + FIELD.right) / 2;
  state.levelHits = 0;
  state.elapsedMs = 0;
  placeBallOnPaddle(state);
}

function markLevelClear(state, events) {
  state.status = 'level-clear';
  state.clearTimer = LEVEL_CLEAR_MS;
  state.ball.vx = 0;
  state.ball.vy = 0;
  state.ball.launched = false;
  const bonus = levelClearBonus(state.level);
  state.score = Math.min(SCORE_MAX, state.score + bonus);
  events.push({ type: 'level-clear', level: state.level, bonus });
}

/** Advance one fixed simulation slice. Returns UI/SDK events; mutates state. */
export function step(state, dtMs) {
  const events = [];
  const rawDt = Number.isFinite(dtMs) ? Math.max(0, dtMs) : STEP_MS;

  if (state.status === 'level-clear') {
    state.clearTimer = Math.max(0, state.clearTimer - rawDt);
    if (state.clearTimer <= 0) {
      if (state.level >= LEVELS.length) {
        state.status = 'won';
        state.ball.launched = false;
        state.ball.vx = 0;
        state.ball.vy = 0;
        events.push({ type: 'won', score: state.score });
      } else {
        startLevel(state, state.level + 1);
        launchBall(state);
        events.push({ type: 'level-advanced', level: state.level });
      }
    }
    return events;
  }

  if (state.status !== 'playing') return events;
  if (!state.ball.launched) {
    state.status = 'ready';
    return events;
  }

  const dt = Math.min(50, rawDt);
  const seconds = dt / 1000;
  state.elapsedMs += dt;
  const previousX = state.ball.x;
  const previousY = state.ball.y;
  state.ball.x += state.ball.vx * seconds;
  state.ball.y += state.ball.vy * seconds;

  resolveWalls(state, events);
  resolvePaddle(state, events);
  resolveBricks(state, previousX, previousY, events);

  if (state.ball.y - BALL.radius > FIELD.bottom) loseLife(state, events);
  if (state.status === 'playing' && destructibleCount(state) === 0) markLevelClear(state, events);
  return events;
}

/** Serialize a run for `storage.save('current', …)`. */
export function serialize(state) {
  return {
    version: SAVE_SCHEMA_VERSION,
    seed: state.seed >>> 0,
    rngState: state.rngState >>> 0,
    level: state.level,
    lives: state.lives,
    score: state.score,
    status: state.status,
    paddle: { x: round3(state.paddle.x) },
    ball: {
      x: round3(state.ball.x),
      y: round3(state.ball.y),
      vx: round3(state.ball.vx),
      vy: round3(state.ball.vy),
      launched: state.ball.launched === true,
    },
    bricks: state.bricks.map(function mapBrick(brick) {
      return { row: brick.row, col: brick.col, type: brick.type, hp: brick.hp };
    }),
    levelHits: state.levelHits,
    elapsedMs: Math.round(state.elapsedMs),
    clearTimer: Math.round(state.clearTimer),
  };
}

function parseSaveInput(raw) {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch (_error) {
      return null;
    }
  }
  return raw;
}

function validRectPosition(row, col) {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 && col < BRICK.cols;
}

/**
 * Decode `storage.load('current')`. Structural corruption returns null; a save
 * whose ball already fell is normalized to a safe serve at the paddle.
 */
export function deserialize(raw) {
  const save = parseSaveInput(raw);
  if (!save || typeof save !== 'object' || Array.isArray(save)) return null;
  if (save.version !== SAVE_SCHEMA_VERSION) return null;
  if (!Number.isInteger(save.level) || save.level < 1 || save.level > LEVELS.length) return null;
  if (!Number.isInteger(save.lives) || save.lives < 1 || save.lives > START_LIVES) return null;
  if (!Number.isInteger(save.score) || save.score < 0 || save.score > SCORE_MAX) return null;
  if (!Array.isArray(save.bricks) || save.bricks.length > 12 * BRICK.cols) return null;
  if (!save.paddle || typeof save.paddle !== 'object' || !Number.isFinite(save.paddle.x)) return null;
  if (!save.ball || typeof save.ball !== 'object') return null;
  if (!Number.isFinite(save.ball.x) || !Number.isFinite(save.ball.y)) return null;
  if (!Number.isFinite(save.ball.vx) || !Number.isFinite(save.ball.vy)) return null;
  if (typeof save.ball.launched !== 'boolean') return null;

  const allowedStatus = ['ready', 'playing', 'paused', 'level-clear'];
  if (allowedStatus.indexOf(save.status) === -1) return null;

  const expected = new Map();
  for (const brick of createBricks(save.level)) {
    expected.set(brick.row + ',' + brick.col, brick);
  }

  const bricks = [];
  const seen = new Set();
  for (const item of save.bricks) {
    if (!item || typeof item !== 'object') return null;
    if (!validRectPosition(item.row, item.col)) return null;
    const key = item.row + ',' + item.col;
    if (seen.has(key)) return null;
    const reference = expected.get(key);
    if (!reference || reference.type !== item.type) return null;
    if (!Number.isInteger(item.hp)) return null;
    if (item.type === BRICK_TYPES.solid && item.hp !== -1) return null;
    if (item.type === BRICK_TYPES.normal && item.hp !== 1) return null;
    if (item.type === BRICK_TYPES.hard && (item.hp < 1 || item.hp > 2)) return null;
    seen.add(key);
    bricks.push({ row: item.row, col: item.col, type: item.type, hp: item.hp });
  }
  for (const reference of expected.values()) {
    if (reference.type === BRICK_TYPES.solid && !seen.has(reference.row + ',' + reference.col)) return null;
  }

  const state = createState({
    seed: Number.isInteger(save.seed) ? save.seed : 1,
    level: save.level,
  });
  state.rngState = Number.isInteger(save.rngState) ? save.rngState >>> 0 : state.seed;
  state.levelHits = Number.isInteger(save.levelHits) && save.levelHits >= 0 ? save.levelHits : 0;
  state.elapsedMs =
    Number.isFinite(save.elapsedMs) && save.elapsedMs >= 0 ? Math.min(save.elapsedMs, 24 * 60 * 60 * 1000) : 0;
  state.clearTimer = Number.isFinite(save.clearTimer) && save.clearTimer >= 0 ? save.clearTimer : 0;
  state.lives = save.lives;
  state.score = save.score;
  state.status = save.status;
  state.paddle.x = clamp(save.paddle.x, FIELD.left + PADDLE.width / 2, FIELD.right - PADDLE.width / 2);
  state.bricks = bricks;

  const launched = save.ball.launched === true;
  const speed = Math.hypot(save.ball.vx, save.ball.vy);
  const safeX = clamp(save.ball.x, FIELD.left + BALL.radius + 1, FIELD.right - BALL.radius - 1);
  const safeY = clamp(save.ball.y, FIELD.top + BALL.radius + 1, FIELD.bottom - BALL.radius - 2);
  const fallen = save.ball.y + BALL.radius >= FIELD.bottom;
  if (!launched || !(speed >= 60) || speed > BALL.maxSpeed * 1.6 || fallen) {
    placeBallOnPaddle(state);
    if (state.status === 'playing' || state.status === 'level-clear') state.status = 'ready';
  } else {
    state.ball = { x: safeX, y: safeY, vx: save.ball.vx, vy: save.ball.vy, launched: true };
    if (state.status === 'ready') placeBallOnPaddle(state);
  }

  if (destructibleCount(state) === 0) {
    if (state.level >= LEVELS.length) return null;
    startLevel(state, state.level + 1);
    return state;
  }

  if (state.status === 'level-clear') {
    if (state.level >= LEVELS.length) return null;
    startLevel(state, state.level + 1);
    return state;
  }

  return state;
}
