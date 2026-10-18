import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOUNCE_VY,
  JUMP_PROFILE,
  MAX_PLATFORM_DX,
  MAX_PLATFORM_GAP,
  MIN_PLATFORM_GAP,
  MOVE_SPEED,
  PLATFORM_HEIGHT,
  PLATFORM_TYPES,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  SCORE_MAX,
  SPRING_VY,
  START_PLATFORM_Y,
  START_PLAYER_Y,
  STEP_SECONDS,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  createGame,
  createPlatformField,
  horizontalReachForRise,
  serialize,
  startRun,
  stepGame,
} from '../src/logic.js';

function makeTestPlatform(overrides = {}) {
  return {
    id: 100,
    x: 210,
    y: 400,
    w: 120,
    type: 'normal',
    vx: 0,
    dir: 1,
    broken: false,
    ...overrides,
  };
}

/**
 * A running snapshot whose player is falling onto a controlled platform at
 * y=400. The RNG/sequence values are fixed so generation after the step is
 * reproducible.
 */
function fallingState(platform = makeTestPlatform(), overrides = {}) {
  const base = createGame({ seed: 99 });
  return {
    ...base,
    status: 'playing',
    player: { x: 270, y: platform.y + PLAYER_HALF_HEIGHT + 1, vy: -300 },
    camera: { y: 0 },
    platforms: [base.platforms[0], platform],
    rngState: 12345,
    platformSeq: 101,
    ...overrides,
  };
}

test('createGame starts ready on a centred platform with no movement', () => {
  const state = createGame({ seed: 7 });
  assert.equal(state.status, 'ready');
  assert.equal(state.score, 0);
  assert.equal(state.elapsed, 0);
  assert.equal(state.camera.y, 0);
  assert.equal(state.startY, START_PLAYER_Y);
  assert.equal(state.player.x, VIEW_WIDTH / 2);
  assert.equal(state.player.y, START_PLAYER_Y);
  assert.equal(state.player.vy, 0);
  assert.ok(state.platforms.length >= 10);
  const first = state.platforms[0];
  assert.equal(first.y, START_PLATFORM_Y);
  assert.equal(first.type, 'normal');
  assert.equal(first.x, Math.round((VIEW_WIDTH - first.w) / 2));
  assert.equal(stepGame(state), state);
});

test('the same seed produces the same world and different seeds do not', () => {
  const a = createPlatformField({ seed: 2024 });
  const b = createPlatformField({ seed: 2024 });
  const c = createPlatformField({ seed: 2025 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.deepEqual(createGame({ seed: 2024 }), createGame({ seed: 2024 }));
  assert.notDeepEqual(createGame({ seed: 2024 }), createGame({ seed: 2025 }));
});

test('platform ladder is deterministic, spaced, in bounds and reachable', () => {
  const field = createPlatformField({ seed: 424242, targetTopY: START_PLATFORM_Y + 260 * MAX_PLATFORM_GAP });
  const platforms = field.platforms;
  assert.ok(platforms.length > 200);
  assert.equal(field.platformSeq, platforms.length);
  assert.equal(new Set(platforms.map((platform) => platform.id)).size, platforms.length);

  let previousCenter = null;
  for (let index = 0; index < platforms.length; index += 1) {
    const platform = platforms[index];
    assert.ok(PLATFORM_TYPES.includes(platform.type), `unknown type ${platform.type}`);
    assert.ok(platform.x >= 14, 'platform must stay inside the left margin');
    assert.ok(platform.x + platform.w <= VIEW_WIDTH - 14, 'platform must stay inside the right margin');
    assert.ok(platform.w >= 94 && platform.w <= 128);
    assert.equal(platform.y, Math.round(platform.y));

    if (index > 0) {
      const previous = platforms[index - 1];
      const gap = platform.y - previous.y;
      assert.ok(gap >= MIN_PLATFORM_GAP && gap <= MAX_PLATFORM_GAP, `gap ${gap} out of range`);
      assert.ok(gap > PLATFORM_HEIGHT, 'platforms must never overlap');
      const center = platform.x + platform.w / 2;
      assert.ok(
        Math.abs(center - previousCenter) <= MAX_PLATFORM_DX + 1,
        'horizontal step between platforms must stay jumpable'
      );
    }
    previousCenter = platform.x + platform.w / 2;

    if (platform.type === 'moving') {
      assert.ok(platform.vx >= 58 && platform.vx <= 96);
      assert.ok(platform.dir === -1 || platform.dir === 1);
    } else {
      assert.equal(platform.vx, 0);
    }
    if (platform.type !== 'normal') assert.ok(index >= 4, 'type variety starts after the intro platforms');
  }

  const types = new Set(platforms.map((platform) => platform.type));
  assert.deepEqual([...types].sort(), [...PLATFORM_TYPES].sort());
});

test('generated gaps and horizontal steps fit inside the jump envelope', () => {
  assert.ok(JUMP_PROFILE.maxRise > MAX_PLATFORM_GAP + PLATFORM_HEIGHT + 60);
  const worstHorizontal = horizontalReachForRise(MAX_PLATFORM_GAP);
  assert.ok(worstHorizontal > MAX_PLATFORM_DX + 120, `horizontal reach ${worstHorizontal} too small`);
  assert.ok(JUMP_PROFILE.springRise > JUMP_PROFILE.maxRise);
  assert.ok(horizontalReachForRise(JUMP_PROFILE.maxRise + 1) === 0);
});

test('startRun bounces from rest but preserves a restored mid-air velocity', () => {
  const ready = createGame({ seed: 3 });
  const started = startRun(ready);
  assert.equal(started.status, 'playing');
  assert.equal(started.player.vy, BOUNCE_VY);
  assert.equal(startRun(started), started);

  const restored = {
    ...ready,
    player: { ...ready.player, y: 640, vy: -420 },
  };
  const resumed = startRun(restored);
  assert.equal(resumed.player.vy, -420);
  assert.equal(resumed.player.y, 640);

  const over = { ...ready, status: 'over' };
  assert.equal(startRun(over), over);
});

test('horizontal input moves the player and clamps at both walls', () => {
  let right = startRun(createGame({ seed: 5 }));
  for (let index = 0; index < 90; index += 1) right = stepGame(right, { right: true });
  assert.equal(right.player.x, VIEW_WIDTH - PLAYER_HALF_WIDTH);

  let left = startRun({ ...createGame({ seed: 5 }), player: { x: 40, y: 600, vy: 0 } });
  for (let index = 0; index < 90; index += 1) left = stepGame(left, { left: true });
  assert.equal(left.player.x, PLAYER_HALF_WIDTH);

  const straight = startRun(createGame({ seed: 5 }));
  const still = stepGame(straight, {});
  assert.equal(still.player.x, straight.player.x);
  assert.ok(MOVE_SPEED > 0);
});

test('landing on a platform snaps to the top and bounces', () => {
  const state = fallingState();
  const next = stepGame(state);
  assert.equal(next.status, 'playing');
  assert.equal(next.player.y, 400 + PLAYER_HALF_HEIGHT);
  assert.equal(next.player.vy, BOUNCE_VY);
  const platform = next.platforms.find((item) => item.id === 100);
  assert.ok(platform);
  assert.equal(platform.broken, false);
  assert.equal(platform.bounceAt, STEP_SECONDS);
  assert.equal(next.score, Math.floor((400 + PLAYER_HALF_HEIGHT - START_PLAYER_Y) / 10));
});

test('a rising player passes through a platform from below', () => {
  const state = fallingState(makeTestPlatform(), {
    player: { x: 270, y: 350, vy: 500 },
  });
  const next = stepGame(state);
  assert.ok(next.player.vy > 400, 'gravity applies but the player keeps rising');
  assert.ok(next.player.y > 350);
  assert.ok(next.player.y < 400, 'the player must not snap onto the platform');
});

test('a horizontally missed platform does not catch the player', () => {
  const state = fallingState(makeTestPlatform(), {
    player: { x: 50, y: 422, vy: -300 },
  });
  const next = stepGame(state);
  assert.ok(next.player.vy < 0);
  assert.ok(next.player.y < 421);
  assert.notEqual(next.player.vy, BOUNCE_VY);
});

test('fragile platforms break on landing and never catch the player again', () => {
  const state = fallingState(makeTestPlatform({ type: 'fragile' }));
  const landed = stepGame(state);
  assert.equal(landed.player.vy, BOUNCE_VY);
  const broken = landed.platforms.find((item) => item.id === 100);
  assert.equal(broken.broken, true);
  assert.equal(broken.brokenAt, STEP_SECONDS);

  const reentry = {
    ...landed,
    player: { x: 270, y: 400 + PLAYER_HALF_HEIGHT + 1, vy: -300 },
  };
  const after = stepGame(reentry);
  assert.ok(after.player.vy < 0, 'the player falls through the broken platform');
  assert.ok(after.player.y < 400 + PLAYER_HALF_HEIGHT);
});

test('spring platforms launch the player much higher', () => {
  const state = fallingState(makeTestPlatform({ type: 'spring' }));
  const next = stepGame(state);
  assert.equal(next.player.y, 400 + PLAYER_HALF_HEIGHT);
  assert.equal(next.player.vy, SPRING_VY);
  assert.ok(next.player.vy > BOUNCE_VY);
});

test('moving platforms travel horizontally, stay in bounds and reverse', () => {
  const moving = makeTestPlatform({ id: 200, x: 14, w: 100, type: 'moving', vx: 100, dir: -1 });
  const state = fallingState(moving, {
    player: { x: 270, y: 600, vy: 0 },
    platforms: [createGame({ seed: 99 }).platforms[0], moving],
  });
  const next = stepGame(state);
  const platform = next.platforms.find((item) => item.id === 200);
  assert.equal(platform.x, 14);
  assert.equal(platform.dir, 1);
});

test('the camera follows the player upward and never moves back down', () => {
  const state = fallingState(makeTestPlatform(), {
    player: { x: 270, y: 5000, vy: 0 },
    platforms: createGame({ seed: 99 }).platforms,
    maxHeight: START_PLAYER_Y,
  });
  let current = state;
  let lastCamera = 0;
  for (let index = 0; index < 12; index += 1) {
    current = stepGame(current);
    assert.ok(current.camera.y >= lastCamera, 'camera must never reverse');
    lastCamera = current.camera.y;
  }
  assert.ok(lastCamera > 4000);
  assert.ok(current.score > 400);
  assert.equal(current.score, Math.floor((current.maxHeight - START_PLAYER_Y) / 10));
});

test('score is a monotonic integer bounded by the manifest maximum', () => {
  let state = startRun(createGame({ seed: 31 }));
  let previous = state.score;
  for (let index = 0; index < 800; index += 1) {
    const input =
      index % 140 < 60 ? { left: true } : index % 140 < 120 ? { right: true } : {};
    state = stepGame(state, input);
    assert.ok(Number.isInteger(state.score));
    assert.ok(state.score >= previous, 'score must never decrease');
    assert.ok(state.score >= 0 && state.score <= SCORE_MAX);
    previous = state.score;
  }

  const capped = stepGame({
    ...startRun(createGame({ seed: 32 })),
    maxHeight: 20000000,
  });
  assert.equal(capped.score, SCORE_MAX);
});

test('falling below the camera ends the game and freezes the run', () => {
  const state = fallingState(makeTestPlatform(), {
    player: { x: 270, y: 800, vy: -100 },
    camera: { y: 1000 },
  });
  const over = stepGame(state);
  assert.equal(over.status, 'over');
  const frozen = stepGame(over);
  assert.equal(frozen, over);
  assert.equal(frozen.score, over.score);
  assert.equal(frozen.elapsed, over.elapsed);
});

test('elapsed time advances only while playing', () => {
  const ready = createGame({ seed: 8 });
  assert.equal(stepGame(ready).elapsed, 0);
  let running = startRun(ready);
  running = stepGame(running);
  assert.ok(Math.abs(running.elapsed - STEP_SECONDS) < 1e-12);
  running = stepGame(running);
  assert.ok(Math.abs(running.elapsed - 2 * STEP_SECONDS) < 1e-12);
  const paused = { ...running, status: 'ready' };
  assert.equal(stepGame(paused), paused);
  const over = { ...running, status: 'over' };
  assert.equal(stepGame(over), over);
});

test('a replay of the same seed and inputs is byte-identical', () => {
  function replay() {
    let state = startRun(createGame({ seed: 777 }));
    for (let index = 0; index < 700; index += 1) {
      const input = index % 90 < 45 ? { right: true } : { left: true };
      state = stepGame(state, input);
    }
    return serialize(state);
  }
  assert.deepEqual(replay(), replay());
});
