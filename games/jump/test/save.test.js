import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_PLATFORMS,
  PLAYER_HALF_HEIGHT,
  SAVE_VERSION,
  SCORE_MAX,
  START_PLAYER_Y,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  createGame,
  createPlatformField,
  deserialize,
  serialize,
  startRun,
  stepGame,
} from '../src/logic.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function runFor(seed, steps, inputForStep) {
  let state = startRun(createGame({ seed }));
  for (let index = 0; index < steps; index += 1) {
    state = stepGame(state, inputForStep ? inputForStep(index) : {});
  }
  return state;
}

function validSave() {
  // No horizontal input: the player keeps bouncing on the starting platform,
  // so this snapshot stays mid-run and is representative of a real autosave.
  return serialize(runFor(555, 240));
}

function expectCorrupt(save, label) {
  assert.equal(deserialize(save), null, `${label} must be rejected`);
}

test('serialize exposes the documented save keys and a schema version', () => {
  const save = validSave();
  assert.equal(save.version, SAVE_VERSION);
  assert.equal(typeof save.seed, 'number');
  assert.ok(Array.isArray(save.platforms) && save.platforms.length > 0);
  assert.deepEqual(Object.keys(save.player).sort(), ['vy', 'x', 'y']);
  assert.deepEqual(Object.keys(save.camera), ['y']);
  assert.equal(typeof save.score, 'number');
  assert.equal(typeof save.elapsed, 'number');
  assert.equal(typeof save.rngState, 'number');
  assert.equal(typeof save.maxHeight, 'number');
  assert.equal(typeof save.startY, 'number');
  assert.equal(typeof save.platformSeq, 'number');
  assert.equal(save.status, 'ready');
});

test('serialize → JSON → deserialize is exactly equivalent', () => {
  const save = validSave();
  const restored = deserialize(JSON.parse(JSON.stringify(save)));
  assert.ok(restored);
  assert.deepEqual(serialize(restored), save);
});

test('a restored run continues with the same world and RNG', () => {
  const original = runFor(808, 300, (index) => (index % 60 < 30 ? { left: true } : { right: true }));
  const save = serialize(original);
  const restored = deserialize(JSON.stringify(save));
  assert.ok(restored);

  let a = startRun(original);
  let b = startRun(restored);
  for (let index = 0; index < 240; index += 1) {
    const input = index % 50 < 25 ? { right: true } : { left: true };
    a = stepGame(a, input);
    b = stepGame(b, input);
    if (index % 20 === 0) assert.deepEqual(serialize(a), serialize(b));
  }
  assert.deepEqual(serialize(a), serialize(b));
});

test('a stored run is ready: it never advances before the player continues', () => {
  const save = validSave();
  const restored = deserialize(save);
  assert.ok(restored);
  assert.equal(restored.status, 'ready');
  assert.equal(stepGame(restored), restored);
  assert.equal(stepGame(restored, { left: true }), restored);
  assert.equal(restored.player.vy, save.player.vy);
});

test('restored platform types and broken state survive the round trip', () => {
  const base = createGame({ seed: 17 });
  const fragile = {
    id: 900,
    x: 200,
    y: 420,
    w: 100,
    type: 'fragile',
    vx: 0,
    dir: 1,
    broken: true,
  };
  const moving = {
    id: 901,
    x: 300.25,
    y: 560,
    w: 104,
    type: 'moving',
    vx: 72,
    dir: -1,
    broken: false,
  };
  const custom = {
    ...base,
    status: 'playing',
    player: { x: 260, y: 700, vy: -120 },
    camera: { y: 0 },
    platforms: [base.platforms[0], fragile, moving],
    platformSeq: 902,
    maxHeight: 700,
  };
  const save = serialize(custom);
  const restored = deserialize(save);
  assert.ok(restored);
  assert.deepEqual(serialize(restored), save);
  const restoredFragile = restored.platforms.find((platform) => platform.id === 900);
  const restoredMoving = restored.platforms.find((platform) => platform.id === 901);
  assert.equal(restoredFragile.broken, true);
  assert.equal(restoredMoving.vx, 72);
  assert.equal(restoredMoving.dir, -1);
  assert.equal(restoredMoving.x, 300.25);
});

test('a game-over save stays over and cannot be resumed', () => {
  const base = startRun(createGame({ seed: 21 }));
  const over = stepGame({
    ...base,
    player: { x: 270, y: 800, vy: -100 },
    camera: { y: 1000 },
  });
  assert.equal(over.status, 'over');
  const save = serialize(over);
  assert.equal(save.status, 'over');
  const restored = deserialize(save);
  assert.ok(restored);
  assert.equal(restored.status, 'over');
  assert.equal(stepGame(restored), restored);
  assert.deepEqual(serialize(restored), save);
});

test('JSON string saves are accepted', () => {
  const save = validSave();
  const restored = deserialize(JSON.stringify(save));
  assert.ok(restored);
  assert.deepEqual(serialize(restored), save);
});

test('unknown extra fields are ignored', () => {
  const save = validSave();
  save.debugNote = 'from a future version';
  save.player.meta = { hat: 'none' };
  const restored = deserialize(save);
  assert.ok(restored);
  assert.equal(restored.player.meta, undefined);
  assert.deepEqual(serialize(restored), validSave());
});

test('a save without a maxHeight above the player is normalized, not crashed', () => {
  const save = validSave();
  save.maxHeight = save.startY;
  save.player.y = save.startY + 500;
  const restored = deserialize(save);
  assert.ok(restored);
  assert.ok(restored.maxHeight >= restored.player.y);
});

test('a full 64-platform save stays far below the storage limits', () => {
  const field = createPlatformField({ seed: 909, targetTopY: 120 + MAX_PLATFORMS * 142 });
  const platforms = field.platforms.slice(0, MAX_PLATFORMS).map((platform, index) => ({
    ...platform,
    id: index,
    x: platform.x + 0.123456789,
  }));
  const state = {
    ...createGame({ seed: 909 }),
    status: 'playing',
    platforms,
    player: { x: 270.123456789, y: 3000.987654321, vy: -123.456789 },
    camera: { y: 2400.123456789 },
    maxHeight: 3000.987654321,
    score: 286,
    platformSeq: MAX_PLATFORMS,
  };
  const save = serialize(state);
  const bytes = Buffer.byteLength(JSON.stringify(save), 'utf8');
  assert.ok(bytes < 32 * 1024, `save should stay under the 32 KiB target (was ${bytes})`);
  assert.ok(bytes < 256 * 1024, 'save must stay under the 256 KiB value limit');
});

test('corrupt saves return null instead of throwing', () => {
  const valid = validSave();
  expectCorrupt(null, 'null');
  expectCorrupt(undefined, 'undefined');
  expectCorrupt([], 'array');
  expectCorrupt(42, 'number');
  expectCorrupt('{not json', 'bad JSON string');
  expectCorrupt({ ...valid, version: 2 }, 'wrong schema version');
  expectCorrupt({ ...valid, version: SAVE_VERSION + 1 }, 'newer schema version');

  for (const field of ['seed', 'rngState', 'platforms', 'player', 'camera', 'score', 'elapsed', 'maxHeight', 'startY', 'platformSeq', 'status']) {
    const broken = clone(valid);
    delete broken[field];
    expectCorrupt(broken, `missing ${field}`);
  }

  const cases = [
    ['negative seed', (save) => (save.seed = -1)],
    ['fractional seed', (save) => (save.seed = 1.5)],
    ['negative rngState', (save) => (save.rngState = -4)],
    ['fractional rngState', (save) => (save.rngState = 2.25)],
    ['empty platforms', (save) => (save.platforms = [])],
    ['too many platforms', (save) => {
      const last = save.platforms[save.platforms.length - 1];
      save.platforms = Array.from({ length: MAX_PLATFORMS + 1 }, (_, index) => ({
        ...last,
        id: 1000 + index,
        y: 10000 + index * 100,
      }));
    }],
    ['unknown platform type', (save) => (save.platforms[1].type = 'banana')],
    ['platform width too small', (save) => (save.platforms[1].w = 10)],
    ['platform off-screen left', (save) => (save.platforms[1].x = -100)],
    ['platform off-screen right', (save) => (save.platforms[1].x = VIEW_WIDTH - 20)],
    ['non-integer platform id', (save) => (save.platforms[1].id = 'a')],
    ['duplicate platform id', (save) => (save.platforms[2].id = save.platforms[1].id)],
    ['unordered platforms', (save) => (save.platforms[2].y = save.platforms[1].y - 10)],
    ['moving platform without speed', (save) => {
      save.platforms = [
        { id: 0, x: 200, y: 120, w: 120, type: 'moving' },
        { id: 1, x: 200, y: 300, w: 100, type: 'normal' },
      ];
      save.player = { x: 270, y: 400, vy: 10 };
      save.camera = { y: 0 };
    }],
    ['moving platform with bad direction', (save) => {
      save.platforms[1] = { ...save.platforms[1], type: 'moving', vx: 70, dir: 2 };
    }],
    ['player off-screen', (save) => (save.player.x = -5)],
    ['player above the world limit', (save) => (save.player.y = 200000000)],
    ['player velocity out of range', (save) => (save.player.vy = 99999)],
    ['negative camera', (save) => (save.camera.y = -1)],
    ['camera far above the player', (save) => (save.camera.y = save.player.y + VIEW_HEIGHT + 10)],
    ['player below the visible world', (save) => {
      save.camera.y = 5000;
      save.player.y = 100;
    }],
    ['negative score', (save) => (save.score = -1)],
    ['fractional score', (save) => (save.score = 2.5)],
    ['score above the manifest maximum', (save) => (save.score = SCORE_MAX + 1)],
    ['negative elapsed', (save) => (save.elapsed = -1)],
    ['negative maxHeight', (save) => (save.maxHeight = -10)],
    ['bad startY', (save) => (save.startY = 'zero')],
    ['bad platformSeq', (save) => (save.platformSeq = 0)],
    ['bad status', (save) => (save.status = 'paused')],
    ['NaN player position', (save) => (save.player.y = Number.NaN)],
    ['NaN elapsed', (save) => (save.elapsed = Number.NaN)],
    ['platforms not an array', (save) => (save.platforms = {})],
  ];

  for (const [label, mutate] of cases) {
    const broken = clone(valid);
    mutate(broken);
    expectCorrupt(broken, label);
  }
});

test('deserialize never mutates the input save', () => {
  const save = validSave();
  const snapshot = clone(save);
  const restored = deserialize(save);
  assert.ok(restored);
  assert.deepEqual(save, snapshot);
  assert.notEqual(restored.platforms, save.platforms);
  assert.notEqual(restored.platforms[0], save.platforms[0]);
});

test('a fresh game save restores to the starting platform', () => {
  const fresh = createGame({ seed: 2026 });
  const save = serialize(fresh);
  assert.equal(save.score, 0);
  assert.equal(save.status, 'ready');
  assert.equal(save.player.y, START_PLAYER_Y);
  const restored = deserialize(save);
  assert.ok(restored);
  assert.deepEqual(serialize(restored), save);
  assert.equal(restored.player.y - PLAYER_HALF_HEIGHT, restored.platforms[0].y);
});
