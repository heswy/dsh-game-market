/**
 * Pure Snake rules: grid, body, direction queue, food, collisions, scoring and
 * save encoding. No DOM, no timers, no randomness outside the seedable PRNG,
 * so every rule is unit-testable and saves are deterministic.
 */

export const BOARD_COLS = 26;
export const BOARD_ROWS = 14;
export const CELL_SIZE = 32;
export const START_LENGTH = 4;
export const SCORE_PER_FOOD = 10;
export const SAVE_SCHEMA_VERSION = 1;
export const MIN_TICK_MS = 70;
export const BASE_TICK_MS = 150;

export const DIRECTIONS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 }),
});

const DIRECTION_LIST = Object.freeze([DIRECTIONS.up, DIRECTIONS.down, DIRECTIONS.left, DIRECTIONS.right]);
const DIRECTIONS_BY_NAME = Object.freeze({
  up: DIRECTIONS.up,
  down: DIRECTIONS.down,
  left: DIRECTIONS.left,
  right: DIRECTIONS.right,
  w: DIRECTIONS.up,
  s: DIRECTIONS.down,
  a: DIRECTIONS.left,
  d: DIRECTIONS.right,
  arrowup: DIRECTIONS.up,
  arrowdown: DIRECTIONS.down,
  arrowleft: DIRECTIONS.left,
  arrowright: DIRECTIONS.right,
});

export function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

export function sameCell(a, b) {
  return Boolean(a && b) && a.x === b.x && a.y === b.y;
}

export function isOpposite(a, b) {
  return a.x === -b.x && a.y === -b.y;
}

export function cloneDirection(direction) {
  return { x: direction.x, y: direction.y };
}

/** Normalize a key name (`ArrowUp`, `w`, `up`) or `{x,y}` into `{x,y}` or null. */
export function normalizeDirection(input) {
  if (typeof input === 'string') {
    const found = DIRECTIONS_BY_NAME[input.toLowerCase()];
    return found ? cloneDirection(found) : null;
  }
  if (input && Number.isInteger(input.x) && Number.isInteger(input.y)) {
    for (const direction of DIRECTION_LIST) {
      if (direction.x === input.x && direction.y === input.y) return cloneDirection(direction);
    }
  }
  return null;
}

export function tickMsFor(score) {
  const steps = Math.floor(Math.max(0, score) / 50);
  return Math.max(MIN_TICK_MS, BASE_TICK_MS - steps * 10);
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

function inBounds(state, cell) {
  return cell.x >= 0 && cell.y >= 0 && cell.x < state.cols && cell.y < state.rows;
}

function freeCells(state) {
  const occupied = new Set(state.snake.map(cellKey));
  const free = [];
  for (let y = 0; y < state.rows; y += 1) {
    for (let x = 0; x < state.cols; x += 1) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  return free;
}

function placeFood(state, rngState) {
  const free = freeCells(state);
  if (free.length === 0) return { food: null, rngState };
  const random = nextRandom(rngState);
  const index = Math.min(free.length - 1, Math.floor(random.value * free.length));
  return { food: free[index], rngState: random.state };
}

/**
 * @param {{cols?: number, rows?: number, seed?: number}} [options]
 */
export function createGame(options = {}) {
  const cols = clampInt(options.cols, 8, 64, BOARD_COLS);
  const rows = clampInt(options.rows, 6, 48, BOARD_ROWS);
  const seed = Number.isFinite(options.seed) ? options.seed >>> 0 : (Date.now() >>> 0) || 1;
  const headX = Math.min(cols - 3, Math.max(3, Math.floor(cols / 2)));
  const headY = Math.floor(rows / 2);
  const snake = [];
  for (let index = 0; index < START_LENGTH; index += 1) {
    snake.push({ x: headX - index, y: headY });
  }
  const base = {
    cols,
    rows,
    snake,
    direction: cloneDirection(DIRECTIONS.right),
    pendingDirections: [],
    food: null,
    score: 0,
    foodEaten: 0,
    status: 'ready',
    rngState: seed,
  };
  const placed = placeFood(base, seed);
  return {
    ...base,
    food: placed.food,
    rngState: placed.rngState,
  };
}

function clampInt(value, min, max, fallback) {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function startGame(state) {
  if (state.status === 'playing' || state.status === 'over' || state.status === 'won') return state;
  return { ...state, status: 'playing' };
}

export function restartGame(state, seed) {
  return createGame({ cols: state.cols, rows: state.rows, seed: Number.isFinite(seed) ? seed : (Date.now() >>> 0) || 1 });
}

/**
 * Queue a turn. Reversing into the neck and repeating the last queued turn are
 * ignored (classic Snake rule). At most two turns are buffered.
 */
export function setDirection(state, input) {
  const direction = normalizeDirection(input);
  if (!direction) return state;
  if (state.status === 'over' || state.status === 'won') return state;
  const last =
    state.pendingDirections.length > 0
      ? state.pendingDirections[state.pendingDirections.length - 1]
      : state.direction;
  if (sameCell(direction, last) || isOpposite(direction, last)) return state;
  if (state.pendingDirections.length >= 2) return state;
  const pending = state.pendingDirections.concat([direction]);
  const next = { ...state, pendingDirections: pending };
  if (next.status === 'ready') next.status = 'playing';
  return next;
}

/**
 * Advance exactly one tick. Pure: returns the same object when not playing.
 */
export function advance(state) {
  if (state.status !== 'playing') return state;
  let direction = state.direction;
  const pending = state.pendingDirections.slice();
  if (pending.length > 0) {
    const candidate = pending.shift();
    if (!isOpposite(candidate, state.direction) && !sameCell(candidate, state.direction)) {
      direction = candidate;
    }
  }
  const head = {
    x: state.snake[0].x + direction.x,
    y: state.snake[0].y + direction.y,
  };
  if (head.x < 0 || head.y < 0 || head.x >= state.cols || head.y >= state.rows) {
    return { ...state, direction, pendingDirections: pending, status: 'over', overReason: 'wall' };
  }
  const eats = Boolean(state.food && sameCell(head, state.food));
  const bodyToCheck = eats ? state.snake : state.snake.slice(0, state.snake.length - 1);
  for (const segment of bodyToCheck) {
    if (sameCell(segment, head)) {
      return { ...state, direction, pendingDirections: pending, status: 'over', overReason: 'self' };
    }
  }
  const snake = [head, ...state.snake];
  if (!eats) snake.pop();
  const score = eats ? state.score + SCORE_PER_FOOD : state.score;
  const foodEaten = eats ? state.foodEaten + 1 : state.foodEaten;
  const next = {
    ...state,
    snake,
    direction,
    pendingDirections: pending,
    score,
    foodEaten,
  };
  if (eats) {
    const placed = placeFood(next, state.rngState);
    next.food = placed.food;
    next.rngState = placed.rngState;
    if (!placed.food) next.status = 'won';
  }
  return next;
}

/** Test/debug helper: force the next food cell (validated). */
export function setFood(state, cell) {
  if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
    return { ...state, food: null };
  }
  const candidate = { x: cell.x, y: cell.y };
  if (!inBounds(state, candidate) || state.snake.some((segment) => sameCell(segment, candidate))) {
    return { ...state, food: null };
  }
  return { ...state, food: candidate };
}

export function serialize(state) {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    cols: state.cols,
    rows: state.rows,
    snake: state.snake.map((cell) => ({ x: cell.x, y: cell.y })),
    direction: cloneDirection(state.direction),
    pendingDirections: state.pendingDirections.map(cloneDirection),
    food: state.food ? { x: state.food.x, y: state.food.y } : null,
    score: state.score,
    foodEaten: state.foodEaten,
    status: state.status,
    rngState: state.rngState >>> 0,
  };
}

function validCell(cell, cols, rows) {
  return (
    cell &&
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.y) &&
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.x < cols &&
    cell.y < rows
  );
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

/**
 * Decode a stored board. Returns null when the save is structurally invalid.
 * A mid-run save is restored as `ready` so the game cannot move (and crash)
 * before the user presses a direction key.
 */
export function deserialize(raw) {
  const save = parseSaveInput(raw);
  if (!save || typeof save !== 'object' || Array.isArray(save)) return null;
  if (save.schemaVersion !== SAVE_SCHEMA_VERSION) return null;
  if (!Number.isInteger(save.cols) || save.cols < 8 || save.cols > 64) return null;
  if (!Number.isInteger(save.rows) || save.rows < 6 || save.rows > 48) return null;
  if (!Array.isArray(save.snake) || save.snake.length < 1 || save.snake.length > save.cols * save.rows) return null;
  const seen = new Set();
  const snake = [];
  for (const cell of save.snake) {
    if (!validCell(cell, save.cols, save.rows)) return null;
    const key = cellKey(cell);
    if (seen.has(key)) return null;
    seen.add(key);
    snake.push({ x: cell.x, y: cell.y });
  }
  const direction = normalizeDirection(save.direction);
  if (!direction) return null;
  const pendingDirections = [];
  if (Array.isArray(save.pendingDirections)) {
    for (const item of save.pendingDirections.slice(0, 2)) {
      const pending = normalizeDirection(item);
      if (pending) pendingDirections.push(pending);
    }
  }
  if (!Number.isFinite(save.score) || save.score < 0) return null;
  const score = Math.floor(save.score);
  const foodEaten =
    Number.isInteger(save.foodEaten) && save.foodEaten >= 0 ? save.foodEaten : Math.floor(score / SCORE_PER_FOOD);
  const rngState = Number.isInteger(save.rngState) ? save.rngState >>> 0 : 1;
  const state = {
    cols: save.cols,
    rows: save.rows,
    snake,
    direction,
    pendingDirections,
    food: validCell(save.food, save.cols, save.rows) && !snake.some((cell) => sameCell(cell, save.food)) ? { ...save.food } : null,
    score,
    foodEaten,
    status: save.status === 'over' || save.status === 'won' ? save.status : 'ready',
    rngState,
  };
  if (!state.food) {
    const placed = placeFood(state, state.rngState);
    state.food = placed.food;
    state.rngState = placed.rngState;
  }
  return state;
}
