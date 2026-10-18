import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOARD_COLS,
  BOARD_ROWS,
  DIRECTIONS,
  MIN_TICK_MS,
  SCORE_PER_FOOD,
  advance,
  cellKey,
  createGame,
  deserialize,
  isOpposite,
  normalizeDirection,
  restartGame,
  serialize,
  setDirection,
  setFood,
  startGame,
  tickMsFor,
} from '../src/logic.js';

function playingGame(overrides = {}) {
  return startGame({ ...createGame({ seed: 1234, ...overrides }) });
}

test('createGame builds a valid board and food never overlaps the snake', () => {
  const state = createGame({ seed: 42 });
  assert.equal(state.cols, BOARD_COLS);
  assert.equal(state.rows, BOARD_ROWS);
  assert.equal(state.snake.length, 4);
  assert.equal(state.score, 0);
  assert.equal(state.status, 'ready');
  assert.ok(state.food);
  const occupied = new Set(state.snake.map(cellKey));
  assert.equal(occupied.has(cellKey(state.food)), false);
  for (const segment of state.snake) {
    assert.ok(segment.x >= 0 && segment.x < state.cols);
    assert.ok(segment.y >= 0 && segment.y < state.rows);
  }
});

test('advance moves the head one cell and keeps the length without food', () => {
  const state = setFood(playingGame(), { x: 20, y: 10 });
  const before = state.snake[0];
  const next = advance(state);
  assert.deepEqual(next.snake[0], { x: before.x + 1, y: before.y });
  assert.equal(next.snake.length, state.snake.length);
  assert.equal(next.score, state.score);
});

test('advance is a no-op before the game starts or after it is over', () => {
  const ready = createGame({ seed: 1 });
  assert.equal(advance(ready), ready);
  const over = { ...playingGame(), status: 'over' };
  assert.equal(advance(over), over);
});

test('setDirection turns the snake and starts a ready game', () => {
  const ready = createGame({ seed: 1 });
  const turned = setDirection(ready, 'down');
  assert.equal(turned.status, 'playing');
  assert.deepEqual(turned.direction, DIRECTIONS.right);
  assert.deepEqual(turned.pendingDirections, [DIRECTIONS.down]);
  const moved = advance(turned);
  assert.equal(moved.direction.y, 1);
  assert.equal(moved.snake[0].y, ready.snake[0].y + 1);
});

test('startGame flips a ready board even when the first key equals the heading', () => {
  const ready = createGame({ seed: 1 });
  // Pressing the initial direction is a no-op for setDirection (no 180°/duplicate
  // turn), so the game shell must still call startGame before running the loop.
  assert.equal(setDirection(ready, 'right'), ready);
  assert.equal(ready.status, 'ready');
  assert.equal(startGame(ready).status, 'playing');
});

test('setDirection rejects a 180-degree reversal', () => {
  const state = playingGame();
  const unchanged = setDirection(state, 'left');
  assert.equal(unchanged, state);
  assert.equal(unchanged.pendingDirections.length, 0);
});

test('setDirection buffers at most two turns in order', () => {
  const state = playingGame();
  const up = setDirection(state, 'up');
  const left = setDirection(up, 'left');
  const down = setDirection(left, 'down');
  assert.deepEqual(down.pendingDirections, [DIRECTIONS.up, DIRECTIONS.left]);
  const firstMove = advance(down);
  assert.deepEqual(firstMove.direction, DIRECTIONS.up);
  const secondMove = advance(firstMove);
  assert.deepEqual(secondMove.direction, DIRECTIONS.left);
  const thirdMove = advance(secondMove);
  assert.equal(thirdMove.pendingDirections.length, 0);
});

test('eating grows the snake, scores and respawns food off the body', () => {
  const base = playingGame();
  const state = setFood(base, {
    x: base.snake[0].x + 1,
    y: base.snake[0].y,
  });
  const next = advance(state);
  assert.equal(next.snake.length, state.snake.length + 1);
  assert.equal(next.score, state.score + SCORE_PER_FOOD);
  assert.equal(next.foodEaten, 1);
  assert.ok(next.food);
  const occupied = new Set(next.snake.map(cellKey));
  assert.equal(occupied.has(cellKey(next.food)), false);
});

test('hitting a wall ends the game with overReason wall', () => {
  const base = playingGame();
  const head = { x: base.cols - 1, y: 3 };
  const state = {
    ...base,
    snake: [{ ...head }, { x: head.x - 1, y: 3 }],
    direction: DIRECTIONS.right,
    pendingDirections: [],
    food: { x: 0, y: 0 },
  };
  const next = advance(state);
  assert.equal(next.status, 'over');
  assert.equal(next.overReason, 'wall');
});

test('hitting the body ends the game with overReason self', () => {
  const base = playingGame();
  const state = {
    ...base,
    snake: [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 4, y: 6 },
      { x: 5, y: 6 },
      { x: 6, y: 6 },
    ],
    direction: DIRECTIONS.down,
    pendingDirections: [],
    food: { x: 10, y: 10 },
  };
  const next = advance(state);
  assert.equal(next.status, 'over');
  assert.equal(next.overReason, 'self');
});

test('moving into the cell the tail vacates is legal', () => {
  const base = playingGame();
  const state = {
    ...base,
    snake: [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 4, y: 6 },
      { x: 5, y: 6 },
    ],
    direction: DIRECTIONS.down,
    pendingDirections: [],
    food: { x: 10, y: 10 },
  };
  const next = advance(state);
  assert.equal(next.status, 'playing');
  assert.deepEqual(next.snake[0], { x: 5, y: 6 });
  assert.equal(next.snake.length, state.snake.length);
});

test('tickMsFor speeds up with the score and has a floor', () => {
  assert.equal(tickMsFor(0), 150);
  assert.equal(tickMsFor(50), 140);
  assert.equal(tickMsFor(500), MIN_TICK_MS);
  assert.equal(tickMsFor(-10), 150);
});

test('serialize/deserialize round-trips a mid-run board as ready', () => {
  let state = setFood(playingGame({ seed: 7 }), {
    x: createGame({ seed: 7 }).snake[0].x + 1,
    y: createGame({ seed: 7 }).snake[0].y,
  });
  state = advance(state);
  state = advance(state);
  const encoded = serialize(state);
  assert.equal(encoded.schemaVersion, 1);
  assert.equal(encoded.status, 'playing');
  assert.equal(encoded.score, SCORE_PER_FOOD);

  const restored = deserialize(JSON.parse(JSON.stringify(encoded)));
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.snake, state.snake);
  assert.deepEqual(restored.direction, state.direction);
  assert.deepEqual(restored.food, state.food);
  assert.equal(restored.score, state.score);
  assert.equal(restored.rngState, state.rngState);
  assert.equal(advance(restored), restored, 'a restored board cannot move by itself');
});

test('a game-over save stays over after deserialize', () => {
  const over = { ...playingGame(), status: 'over', overReason: 'wall' };
  const restored = deserialize(serialize(over));
  assert.equal(restored.status, 'over');
});

test('deserialize rejects malformed or unsafe saves', () => {
  assert.equal(deserialize(null), null);
  assert.equal(deserialize('not json'), null);
  assert.equal(deserialize({}), null);
  assert.equal(deserialize({ schemaVersion: 2 }), null);
  const valid = serialize(createGame({ seed: 3 }));
  assert.equal(deserialize({ ...valid, snake: [] }), null);
  assert.equal(deserialize({ ...valid, snake: [{ x: -1, y: 0 }] }), null);
  assert.equal(deserialize({ ...valid, snake: [{ x: 1, y: 1 }, { x: 1, y: 1 }] }), null);
  assert.equal(deserialize({ ...valid, direction: { x: 2, y: 0 } }), null);
  assert.equal(deserialize({ ...valid, score: Number.NaN }), null);
});

test('deserialize regenerates food that overlaps the snake', () => {
  const base = createGame({ seed: 5 });
  const save = serialize(base);
  save.food = { ...base.snake[0] };
  const restored = deserialize(save);
  assert.ok(restored.food);
  assert.equal(restored.snake.some((cell) => cellKey(cell) === cellKey(restored.food)), false);
});

test('deserialize accepts a JSON string payload', () => {
  const state = createGame({ seed: 9 });
  const restored = deserialize(JSON.stringify(serialize(state)));
  assert.deepEqual(restored.snake, state.snake);
});

test('the same seed produces the same food placement', () => {
  const a = createGame({ seed: 2026 });
  const b = createGame({ seed: 2026 });
  assert.deepEqual(a.food, b.food);
  assert.equal(a.rngState, b.rngState);
  const c = createGame({ seed: 2027 });
  assert.notDeepEqual(a.food, c.food);
});

test('restartGame resets score, body and status', () => {
  let state = playingGame({ seed: 11 });
  state = advance(state);
  state = advance(state);
  const restarted = restartGame(state, 11);
  assert.equal(restarted.score, 0);
  assert.equal(restarted.snake.length, 4);
  assert.equal(restarted.status, 'ready');
  assert.equal(restarted.foodEaten, 0);
});

test('normalizeDirection understands keys, letters and vectors', () => {
  assert.deepEqual(normalizeDirection('ArrowUp'), DIRECTIONS.up);
  assert.deepEqual(normalizeDirection('w'), DIRECTIONS.up);
  assert.deepEqual(normalizeDirection('D'), DIRECTIONS.right);
  assert.deepEqual(normalizeDirection({ x: 0, y: 1 }), DIRECTIONS.down);
  assert.equal(normalizeDirection('q'), null);
  assert.equal(normalizeDirection({ x: 2, y: 0 }), null);
  assert.equal(normalizeDirection(null), null);
});

test('isOpposite detects 180-degree pairs only', () => {
  assert.equal(isOpposite(DIRECTIONS.up, DIRECTIONS.down), true);
  assert.equal(isOpposite(DIRECTIONS.left, DIRECTIONS.right), true);
  assert.equal(isOpposite(DIRECTIONS.up, DIRECTIONS.left), false);
});

test('setFood validates bounds and body overlap', () => {
  const state = playingGame();
  assert.equal(setFood(state, { x: 0, y: 0 }).food.x, 0);
  assert.equal(setFood(state, { x: -1, y: 0 }).food, null);
  assert.equal(setFood(state, { ...state.snake[1] }).food, null);
});

test('filling the board ends the game as won', () => {
  const base = playingGame({ cols: 8, rows: 6, seed: 1 });
  const occupied = [];
  for (let y = 0; y < 6; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if (!(x === 1 && y === 0)) occupied.push({ x, y });
    }
  }
  const snake = [{ x: 0, y: 0 }, ...occupied.filter((cell) => !(cell.x === 0 && cell.y === 0))];
  const state = {
    ...base,
    snake,
    direction: DIRECTIONS.right,
    pendingDirections: [],
    food: { x: 1, y: 0 },
    score: 0,
    foodEaten: 0,
  };
  const next = advance(state);
  assert.equal(next.score, SCORE_PER_FOOD);
  assert.equal(next.status, 'won');
  assert.equal(next.food, null);
});
