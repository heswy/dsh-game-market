import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BALL,
  FIELD,
  LEVELS,
  SCORE_MAX,
  START_LIVES,
  STEP_MS,
  createState,
  launchBall,
  movePaddle,
  step,
} from '../src/logic.js';

test('a five-minute autoplay never leaves the field or corrupts state', () => {
  const state = createState({ seed: 4242, level: 1 });
  launchBall(state);
  const totalSteps = Math.round((5 * 60 * 1000) / STEP_MS);

  for (let index = 0; index < totalSteps; index += 1) {
    if (state.status === 'ready') launchBall(state);
    if (state.status === 'playing') {
      const lead = state.ball.vx >= 0 ? 14 : -14;
      movePaddle(state, state.ball.x + lead);
    }
    step(state, STEP_MS);

    if (index % 120 === 0) {
      assert.ok(Number.isFinite(state.ball.x));
      assert.ok(Number.isFinite(state.ball.y));
      assert.ok(Number.isFinite(state.ball.vx));
      assert.ok(Number.isFinite(state.ball.vy));
      assert.ok(state.ball.x >= FIELD.left - 0.01 && state.ball.x <= FIELD.right + 0.01);
      assert.ok(state.ball.y >= FIELD.top - 0.01);
      assert.ok(state.score >= 0 && state.score <= SCORE_MAX);
      assert.ok(state.lives >= 0 && state.lives <= START_LIVES);
      assert.ok(state.level >= 1 && state.level <= LEVELS.length);
      assert.ok(Math.hypot(state.ball.vx, state.ball.vy) <= BALL.maxSpeed + 1);
    }
    if (state.status === 'over') break;
  }

  assert.notEqual(state.status, 'over', 'the tracking paddle should keep the run alive');
  assert.ok(['playing', 'ready', 'level-clear', 'won'].includes(state.status));
  assert.ok(state.level >= 1 && state.level <= LEVELS.length);
  assert.ok(state.score >= 0 && state.score <= SCORE_MAX);
});
