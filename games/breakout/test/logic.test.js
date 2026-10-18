import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BALL,
  BRICK,
  FIELD,
  LEVELS,
  LEVEL_CLEAR_MS,
  PADDLE,
  SCORE_MAX,
  START_LIVES,
  STEP_MS,
  bounceOffPaddle,
  brickRect,
  createBricks,
  createState,
  currentSpeed,
  destructibleCount,
  launchBall,
  levelClearBonus,
  maxHpForType,
  movePaddle,
  nudgePaddle,
  pointsForHit,
  serialize,
  setPaused,
  startLevel,
  step,
} from '../src/logic.js';

function bottomRow(levelNumber) {
  return levelDefinition(levelNumber).layout.length - 1;
}

function levelDefinition(levelNumber) {
  return LEVELS[levelNumber - 1];
}

function brickAt(state, row, col) {
  return state.bricks.find((brick) => brick.row === row && brick.col === col) || null;
}

/** Place the ball just below a bottom-row brick and step once into it. */
function hitBottomBrick(state, row, col) {
  const brick = brickAt(state, row, col);
  assert.ok(brick, `expected brick at ${row},${col}`);
  const rect = brickRect(brick);
  state.status = 'playing';
  state.ball = {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height + BALL.radius + 0.5,
    vx: 0,
    vy: -240,
    launched: true,
  };
  const events = step(state, STEP_MS);
  return events;
}

function dropBall(state) {
  state.status = 'playing';
  state.ball = {
    x: state.paddle.x,
    y: FIELD.bottom + BALL.radius + 4,
    vx: 0,
    vy: 220,
    launched: true,
  };
  return step(state, STEP_MS);
}

test('five levels are data-driven, deterministic and use only known characters', () => {
  assert.ok(LEVELS.length >= 3, 'at least three levels are required');
  assert.equal(LEVELS.length, 5);
  for (let index = 0; index < LEVELS.length; index += 1) {
    const level = LEVELS[index];
    assert.equal(level.number, index + 1);
    assert.ok(level.nameZh.length > 0 && level.nameEn.length > 0);
    assert.ok(level.layout.length > 0);
    for (const line of level.layout) {
      assert.equal(line.length, BRICK.cols, `level ${level.number} row width`);
      assert.match(line, /^[.12X]+$/);
    }
    const bricks = createBricks(level.number);
    assert.ok(bricks.length > 0, `level ${level.number} has bricks`);
    assert.ok(destructibleCount({ bricks }) > 0, `level ${level.number} is clearable`);
    for (const brick of bricks) {
      assert.equal(brick.hp, maxHpForType(brick.type));
      const rect = brickRect(brick);
      assert.ok(rect.x >= FIELD.left && rect.x + rect.width <= FIELD.right + 0.001);
      assert.ok(rect.y >= FIELD.top && rect.y + rect.height < PADDLE.y);
    }
  }
  for (let index = 1; index < LEVELS.length; index += 1) {
    assert.ok(LEVELS[index].speed > LEVELS[index - 1].speed, 'ball speed rises per level');
  }
  assert.deepEqual(createBricks(3), createBricks(3), 'layouts are deterministic');
  assert.notDeepEqual(createBricks(1), createBricks(2), 'layouts differ');
});

test('normal bricks break in one hit and pay ten points exactly once', () => {
  const state = createState({ seed: 7, level: 1 });
  const row = bottomRow(1);
  const before = state.bricks.length;
  const events = hitBottomBrick(state, row, 3);
  const hit = events.find((event) => event.type === 'brick-hit');
  assert.ok(hit);
  assert.equal(hit.brickType, 'normal');
  assert.equal(hit.destroyed, true);
  assert.equal(hit.points, 10);
  assert.equal(state.score, 10);
  assert.equal(state.bricks.length, before - 1);
  assert.equal(brickAt(state, row, 3), null);
  assert.equal(pointsForHit('normal', true), 10);
  assert.equal(pointsForHit('solid', true), 0);

  const scoreAfter = state.score;
  step(state, STEP_MS);
  step(state, STEP_MS);
  assert.equal(state.score, scoreAfter, 'removed bricks cannot score twice');
});

test('hard bricks need two hits, score per hit and pay a destroy bonus', () => {
  const state = createState({ seed: 11, level: 2 });
  const row = bottomRow(2);
  const events1 = hitBottomBrick(state, row, 0);
  const hit1 = events1.find((event) => event.type === 'brick-hit');
  assert.equal(hit1.brickType, 'hard');
  assert.equal(hit1.destroyed, false);
  assert.equal(hit1.points, 10);
  assert.equal(brickAt(state, row, 0).hp, 1);
  assert.equal(state.score, 10);

  const events2 = hitBottomBrick(state, row, 0);
  const hit2 = events2.find((event) => event.type === 'brick-hit');
  assert.equal(hit2.destroyed, true);
  assert.equal(hit2.points, 30);
  assert.equal(brickAt(state, row, 0), null);
  assert.equal(state.score, 40);
  assert.equal(pointsForHit('hard', false), 10);
  assert.equal(pointsForHit('hard', true), 30);
});

test('indestructible bricks bounce the ball without damage or score', () => {
  const state = createState({ seed: 3, level: 4 });
  const row = bottomRow(4);
  const brick = brickAt(state, row, 0);
  assert.equal(brick.type, 'solid');
  const events = hitBottomBrick(state, row, 0);
  const hit = events.find((event) => event.type === 'brick-hit');
  assert.equal(hit.brickType, 'solid');
  assert.equal(hit.points, 0);
  assert.equal(hit.destroyed, false);
  assert.equal(state.score, 0);
  assert.deepEqual(brickAt(state, row, 0), brick);
});

test('paddle bounce follows the hit offset and never locks horizontally', () => {
  const state = createState({ seed: 21, level: 1 });
  state.paddle.x = (FIELD.left + FIELD.right) / 2;
  state.ball = {
    x: state.paddle.x - 50,
    y: PADDLE.y - BALL.radius - 0.5,
    vx: 0,
    vy: 260,
    launched: true,
  };
  state.status = 'playing';
  const events = step(state, STEP_MS);
  assert.ok(events.some((event) => event.type === 'paddle-hit'));
  assert.ok(state.ball.vy < 0, 'ball bounces upward');
  assert.ok(state.ball.vx < 0, 'left-side hit sends the ball left');
  const speed = Math.hypot(state.ball.vx, state.ball.vy);
  assert.ok(Math.abs(state.ball.vy) / speed >= 0.49, 'vertical component stays playable');

  const center = createState({ seed: 22, level: 1 });
  center.ball.x = center.paddle.x;
  bounceOffPaddle(center);
  assert.ok(Math.abs(center.ball.vx) < 1e-9, 'center hit goes straight up');
  assert.ok(center.ball.vy < 0);

  for (const offset of [-PADDLE.width / 2, -20, 0, 20, PADDLE.width / 2]) {
    const probe = createState({ seed: 23, level: 1 });
    probe.ball.x = probe.paddle.x + offset;
    bounceOffPaddle(probe);
    const probeSpeed = Math.hypot(probe.ball.vx, probe.ball.vy);
    assert.ok(Math.abs(probe.ball.vy) / probeSpeed >= 0.49, `no horizontal lock at offset ${offset}`);
    assert.ok(Math.hypot(probe.ball.vx, probe.ball.vy) > 0);
  }
});

test('paddle movement is clamped and the served ball follows it', () => {
  const state = createState({ seed: 5, level: 1 });
  movePaddle(state, -1000);
  assert.equal(state.paddle.x, FIELD.left + PADDLE.width / 2);
  assert.equal(state.ball.x, state.paddle.x);
  movePaddle(state, 5000);
  assert.equal(state.paddle.x, FIELD.right - PADDLE.width / 2);
  assert.equal(state.ball.x, state.paddle.x);
  const before = state.paddle.x;
  nudgePaddle(state, -1, 1000);
  assert.ok(state.paddle.x < before);
  nudgePaddle(state, 1, 100000);
  assert.equal(state.paddle.x, FIELD.right - PADDLE.width / 2);
});

test('left, right and top walls reflect the ball and keep it inside', () => {
  const left = createState({ seed: 1, level: 1 });
  left.status = 'playing';
  left.ball = { x: FIELD.left + BALL.radius + 0.5, y: 400, vx: -300, vy: 0, launched: true };
  step(left, STEP_MS);
  assert.ok(left.ball.vx > 0);
  assert.ok(left.ball.x >= FIELD.left + BALL.radius);

  const right = createState({ seed: 1, level: 1 });
  right.status = 'playing';
  right.ball = { x: FIELD.right - BALL.radius - 0.5, y: 400, vx: 300, vy: 0, launched: true };
  step(right, STEP_MS);
  assert.ok(right.ball.vx < 0);
  assert.ok(right.ball.x <= FIELD.right - BALL.radius);

  const top = createState({ seed: 1, level: 1 });
  top.status = 'playing';
  top.ball = { x: 480, y: FIELD.top + BALL.radius + 0.5, vx: 0, vy: -300, launched: true };
  step(top, STEP_MS);
  assert.ok(top.ball.vy > 0);
  assert.ok(top.ball.y >= FIELD.top + BALL.radius);
});

test('the ball stays inside the side walls across a long replay', () => {
  const state = createState({ seed: 42, level: 5 });
  launchBall(state);
  for (let index = 0; index < 400; index += 1) {
    if (state.status === 'ready') launchBall(state);
    step(state, STEP_MS);
    assert.ok(state.ball.x >= FIELD.left + BALL.radius - 0.02);
    assert.ok(state.ball.x <= FIELD.right - BALL.radius + 0.02);
  }
});

test('launch angles are seeded, upward and never horizontal', () => {
  for (let seed = 1; seed <= 24; seed += 1) {
    const state = createState({ seed, level: 1 });
    assert.equal(launchBall(state), true);
    assert.equal(state.status, 'playing');
    assert.ok(state.ball.vy < 0);
    const speed = Math.hypot(state.ball.vx, state.ball.vy);
    assert.ok(speed > 0);
    assert.ok(Math.abs(state.ball.vy) / speed >= 0.84);
    assert.equal(launchBall(state), false, 'a launched ball cannot be launched twice');
  }
});

test('ball speed increases with level, brick hits and elapsed time, and is capped', () => {
  const state = createState({ seed: 1, level: 1 });
  const base = currentSpeed(state);
  state.levelHits = 10;
  assert.ok(currentSpeed(state) > base);
  state.elapsedMs = 30000;
  assert.ok(currentSpeed(state) > base + 39);
  state.levelHits = 1000;
  state.elapsedMs = 10000000;
  assert.ok(currentSpeed(state) <= BALL.maxSpeed);
  const level5 = createState({ seed: 1, level: 5 });
  assert.ok(currentSpeed(level5) > currentSpeed(createState({ seed: 1, level: 1 })));
});

test('losing a ball costs a life, resets ball and paddle but keeps score and bricks', () => {
  const state = createState({ seed: 9, level: 1 });
  state.score = 120;
  const brickSnapshot = JSON.stringify(state.bricks);
  let events = dropBall(state);
  assert.ok(events.some((event) => event.type === 'life-lost' && event.lives === START_LIVES - 1));
  assert.equal(state.lives, START_LIVES - 1);
  assert.equal(state.status, 'ready');
  assert.equal(state.ball.launched, false);
  assert.equal(state.ball.x, state.paddle.x);
  assert.equal(state.paddle.x, (FIELD.left + FIELD.right) / 2);
  assert.equal(state.score, 120);
  assert.equal(JSON.stringify(state.bricks), brickSnapshot);

  dropBall(state);
  events = dropBall(state);
  assert.equal(state.lives, 0);
  assert.equal(state.status, 'over');
  assert.ok(events.some((event) => event.type === 'game-over'));
  assert.equal(state.score, 120);
});

test('clearing a level pays a bonus, freezes, then advances and re-serves', () => {
  const state = createState({ seed: 13, level: 1 });
  state.score = 100;
  state.bricks = state.bricks.filter((brick) => brick.type === 'solid');
  state.status = 'playing';
  state.ball = { x: 480, y: 300, vx: 100, vy: -100, launched: true };
  const clearEvents = step(state, STEP_MS);
  const clear = clearEvents.find((event) => event.type === 'level-clear');
  assert.ok(clear);
  assert.equal(clear.bonus, levelClearBonus(1));
  assert.equal(state.score, 200);
  assert.equal(state.status, 'level-clear');
  assert.equal(state.ball.launched, false);
  const frozenScore = state.score;

  const advanceEvents = step(state, LEVEL_CLEAR_MS);
  assert.ok(advanceEvents.some((event) => event.type === 'level-advanced' && event.level === 2));
  assert.equal(state.level, 2);
  assert.equal(state.status, 'playing');
  assert.equal(state.lives, START_LIVES);
  assert.equal(state.score, frozenScore);
  assert.equal(state.ball.launched, true);
  assert.ok(state.bricks.length > 0);
});

test('clearing the final level ends in won exactly once', () => {
  const state = createState({ seed: 4, level: 5 });
  state.bricks = state.bricks.filter((brick) => brick.type === 'solid');
  state.status = 'playing';
  state.ball = { x: 480, y: 300, vx: 100, vy: -100, launched: true };
  const clear = step(state, STEP_MS);
  assert.ok(clear.some((event) => event.type === 'level-clear' && event.level === 5));
  const bonusScore = state.score;
  assert.equal(bonusScore, levelClearBonus(5));
  const finish = step(state, LEVEL_CLEAR_MS);
  assert.ok(finish.some((event) => event.type === 'won'));
  assert.equal(state.status, 'won');
  const again = step(state, LEVEL_CLEAR_MS);
  assert.equal(again.length, 0);
  assert.equal(state.score, bonusScore);
});

test('startLevel resets bricks, paddle and speed but preserves score and lives', () => {
  const state = createState({ seed: 1, level: 1 });
  state.score = 777;
  state.lives = 2;
  state.levelHits = 20;
  state.elapsedMs = 50000;
  startLevel(state, 3);
  assert.equal(state.level, 3);
  assert.equal(state.score, 777);
  assert.equal(state.lives, 2);
  assert.equal(state.levelHits, 0);
  assert.equal(state.elapsedMs, 0);
  assert.equal(state.status, 'ready');
  assert.deepEqual(state.bricks, createBricks(3));
});

test('score is clamped to the manifest maximum', () => {
  const state = createState({ seed: 1, level: 1 });
  state.score = SCORE_MAX - 5;
  hitBottomBrick(state, bottomRow(1), 0);
  assert.equal(state.score, SCORE_MAX);
  assert.ok(state.score >= 0);
});

test('paused runs freeze physics and resume from the same state', () => {
  const state = createState({ seed: 17, level: 1 });
  launchBall(state);
  for (let index = 0; index < 20; index += 1) step(state, STEP_MS);
  const snapshot = JSON.stringify(serialize(state));
  setPaused(state, true);
  assert.equal(state.status, 'paused');
  for (let index = 0; index < 30; index += 1) {
    const events = step(state, STEP_MS);
    assert.equal(events.length, 0);
  }
  const paused = serialize(state);
  assert.equal(paused.ball.x, JSON.parse(snapshot).ball.x);
  assert.equal(paused.elapsedMs, JSON.parse(snapshot).elapsedMs);
  setPaused(state, false);
  assert.equal(state.status, 'playing');
  step(state, STEP_MS);
  assert.notEqual(state.ball.x, paused.ball.x);
});

test('same seed and input sequence replay to the same state', () => {
  function replay(seed) {
    const state = createState({ seed, level: 1 });
    launchBall(state);
    for (let index = 0; index < 900; index += 1) {
      if (index % 45 === 0) movePaddle(state, 260 + ((index * 37) % 440));
      if (state.status === 'ready') launchBall(state);
      step(state, STEP_MS);
      if (state.status === 'over' || state.status === 'won') break;
    }
    return serialize(state);
  }
  assert.deepEqual(replay(1234), replay(1234));
  assert.notDeepEqual(replay(1234), replay(4321));
});

test('invalid or non-playing states never advance', () => {
  const state = createState({ seed: 1, level: 1 });
  const before = JSON.stringify(serialize(state));
  assert.equal(step(state, STEP_MS).length, 0);
  assert.equal(JSON.stringify(serialize(state)), before);
  state.status = 'over';
  assert.equal(step(state, STEP_MS).length, 0);
  assert.equal(state.status, 'over');
});

test('brick hit positions come from the rendered rectangles', () => {
  const state = createState({ seed: 1, level: 1 });
  const brick = state.bricks[0];
  const rect = brickRect(brick);
  const events = hitBottomBrick(state, bottomRow(1), 0);
  const hit = events.find((event) => event.type === 'brick-hit');
  assert.ok(hit);
  assert.ok(hit.x > FIELD.left && hit.x < FIELD.right);
  assert.ok(hit.y > FIELD.top && hit.y < PADDLE.y);
  assert.ok(rect.width > 0 && rect.height > 0);
});
