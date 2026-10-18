import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BALL,
  FIELD,
  LEVELS,
  PADDLE,
  SAVE_SCHEMA_VERSION,
  SCORE_MAX,
  STEP_MS,
  brickRect,
  createBricks,
  createState,
  deserialize,
  launchBall,
  movePaddle,
  serialize,
  setPaused,
  step,
} from '../src/logic.js';

function playedState() {
  const state = createState({ seed: 2026, level: 2 });
  movePaddle(state, 410);
  launchBall(state);
  const bottomRow = LEVELS[1].layout.length - 1;
  const target = state.bricks.find((brick) => brick.row === bottomRow && brick.col === 0);
  const rect = brickRect(target);
  state.ball = {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height + BALL.radius + 0.5,
    vx: 0,
    vy: -240,
    launched: true,
  };
  state.status = 'playing';
  step(state, STEP_MS);
  for (let index = 0; index < 40; index += 1) step(state, STEP_MS);
  return state;
}

function validSave(overrides = {}) {
  return { ...serialize(playedState()), ...overrides };
}

test('serialize exposes the documented save keys and stays well under 8 KiB', () => {
  const save = serialize(playedState());
  for (const key of ['version', 'level', 'lives', 'score', 'bricks', 'ball', 'paddle']) {
    assert.ok(Object.prototype.hasOwnProperty.call(save, key), `save must contain ${key}`);
  }
  assert.equal(save.version, SAVE_SCHEMA_VERSION);
  assert.ok(Array.isArray(save.bricks));
  assert.ok(save.ball && typeof save.ball === 'object');
  assert.ok(save.paddle && Number.isFinite(save.paddle.x));
  assert.ok(JSON.stringify(save).length < 8192);
  const largest = createState({ seed: 1, level: 5 });
  assert.ok(JSON.stringify(serialize(largest)).length < 8192);
});

test('serialize → JSON → deserialize → serialize is an exact round trip', () => {
  const state = playedState();
  const save = serialize(state);
  const restored = deserialize(JSON.stringify(save));
  assert.ok(restored);
  assert.deepEqual(serialize(restored), save);
  assert.equal(restored.level, save.level);
  assert.equal(restored.lives, save.lives);
  assert.equal(restored.score, save.score);
  assert.equal(restored.ball.x, save.ball.x);
  assert.equal(restored.paddle.x, save.paddle.x);
  assert.equal(restored.bricks.length, save.bricks.length);
});

test('a paused in-flight save keeps the ball and resumes as paused', () => {
  const state = playedState();
  setPaused(state, true);
  const save = serialize(state);
  const restored = deserialize(JSON.stringify(save));
  assert.ok(restored);
  assert.equal(restored.status, 'paused');
  assert.equal(restored.ball.launched, true);
  assert.deepEqual(serialize(restored), save);
});

test('corrupt saves are rejected without throwing', () => {
  const broken = [
    null,
    undefined,
    42,
    'not json at all',
    '[]',
    {},
    validSave({ version: 2 }),
    validSave({ version: SAVE_SCHEMA_VERSION + 1 }),
    validSave({ level: 0 }),
    validSave({ level: LEVELS.length + 1 }),
    validSave({ level: '1' }),
    validSave({ lives: 0 }),
    validSave({ lives: 4 }),
    validSave({ score: -1 }),
    validSave({ score: SCORE_MAX + 1 }),
    validSave({ score: 1.5 }),
    validSave({ status: 'over' }),
    validSave({ status: 'won' }),
    validSave({ status: 'nonsense' }),
    validSave({ bricks: 'nope' }),
    validSave({ bricks: [{ row: 0, col: 0, type: 'nonsense', hp: 1 }] }),
    validSave({ ball: null }),
    validSave({ paddle: null }),
    validSave({ paddle: { x: 'left' } }),
  ];
  for (const value of broken) {
    assert.doesNotThrow(() => deserialize(value));
    assert.equal(deserialize(value), null, `expected rejection for ${JSON.stringify(value)}`);
  }
  const base = playedState();
  const duplicate = serialize(base);
  duplicate.bricks.push({ ...duplicate.bricks[0] });
  assert.equal(deserialize(duplicate), null);

  const wrongHp = serialize(base);
  wrongHp.bricks = wrongHp.bricks.map((brick) =>
    brick.type === 'normal' ? { ...brick, hp: 2 } : brick,
  );
  assert.equal(deserialize(wrongHp), null);

  const missingSolid = serialize(createState({ seed: 1, level: 4 }));
  missingSolid.bricks = missingSolid.bricks.filter((brick) => brick.type !== 'solid');
  assert.equal(deserialize(missingSolid), null);
});

test('a save whose ball already fell is normalized to a safe serve', () => {
  const save = validSave({ status: 'playing' });
  save.ball = { x: 480, y: FIELD.bottom + 40, vx: 100, vy: 300, launched: true };
  const restored = deserialize(save);
  assert.ok(restored);
  assert.equal(restored.status, 'ready');
  assert.equal(restored.ball.launched, false);
  assert.equal(restored.ball.x, restored.paddle.x);
  assert.ok(restored.ball.y < PADDLE.y);
});

test('out-of-bounds saved positions are clamped into the field', () => {
  const save = validSave({ status: 'playing' });
  save.ball = { x: -500, y: FIELD.top - 500, vx: 100, vy: -120, launched: true };
  const restored = deserialize(save);
  assert.ok(restored);
  assert.ok(restored.ball.x >= FIELD.left + BALL.radius);
  assert.ok(restored.ball.y >= FIELD.top + BALL.radius);
  assert.ok(restored.ball.y + BALL.radius < FIELD.bottom);
  assert.ok(restored.paddle.x >= FIELD.left + PADDLE.width / 2);
  assert.ok(restored.paddle.x <= FIELD.right - PADDLE.width / 2);
});

test('a mid-transition level-clear save resumes on the next level', () => {
  const save = serialize(createState({ seed: 8, level: 1 }));
  save.status = 'level-clear';
  save.bricks = [];
  save.clearTimer = 0;
  const restored = deserialize(save);
  assert.ok(restored);
  assert.equal(restored.level, 2);
  assert.equal(restored.status, 'ready');
  assert.deepEqual(restored.bricks, createBricks(2));
  assert.equal(restored.ball.launched, false);
});

test('a terminal save on the final level cannot be continued', () => {
  const save = serialize(createState({ seed: 8, level: LEVELS.length }));
  save.status = 'level-clear';
  save.bricks = [];
  assert.equal(deserialize(save), null);
});

test('deserialize never trusts extra keys and rebuilds derived state', () => {
  const save = validSave();
  save.rngState = 12345;
  save.levelHits = 4;
  save.elapsedMs = 12345;
  save.ball = { ...save.ball, extra: 'ignored' };
  save.evil = { __proto__: { polluted: true } };
  const restored = deserialize(save);
  assert.ok(restored);
  assert.equal(restored.rngState, 12345);
  assert.equal(restored.levelHits, 4);
  assert.equal(restored.elapsedMs, 12345);
  assert.equal(restored.evil, undefined);
  assert.equal({}.polluted, undefined);
  assert.ok(restored.ball && restored.ball.extra === undefined);
});
