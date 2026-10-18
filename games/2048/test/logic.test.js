import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CELLS,
  MAX_ELAPSED_MS,
  SAVE_VERSION,
  SCORE_MAX,
  TARGET,
  addElapsed,
  beginPlay,
  boardFromRows,
  canUndo,
  continueAfterWin,
  createGame,
  createState,
  deserialize,
  highestTile,
  isGameOver,
  move,
  normalizeDirection,
  rowsFromBoard,
  serialize,
  spawnTile,
  tileCount,
  undo,
  undoAllowance,
} from '../src/logic.js';

const EMPTY = [
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
];

function stateWith(rows, overrides = {}) {
  return createState({
    board: boardFromRows(rows),
    rngState: 123456,
    status: 'playing',
    ...overrides,
  });
}

/** The board after a move with the single spawned tile removed again. */
function boardExceptSpawn(result) {
  assert.equal(result.moved, true);
  const board = result.state.board.slice();
  if (result.spawned) {
    assert.equal(board[result.spawned.index], result.spawned.value);
    board[result.spawned.index] = 0;
  }
  return rowsFromBoard(board);
}

test('createGame: two starting tiles, zero score, ready, deterministic by seed', () => {
  const first = createGame({ seed: 1 });
  const second = createGame({ seed: 1 });
  assert.equal(first.board.length, CELLS);
  assert.equal(tileCount(first.board), 2);
  for (const value of first.board) {
    assert.ok(value === 0 || value === 2 || value === 4, `unexpected starting tile ${value}`);
  }
  assert.equal(first.score, 0);
  assert.equal(first.moves, 0);
  assert.equal(first.elapsed, 0);
  assert.equal(first.status, 'ready');
  assert.equal(first.undo, null);
  assert.equal(first.undoUsed, false);
  assert.ok(Number.isInteger(first.rngState) && first.rngState > 0);
  assert.deepEqual(first, second, 'same seed must create the same board and RNG state');
  assert.notDeepEqual(createGame({ seed: 2 }).board, first.board);
});

test('spawnTile: deterministic index/value, only 2 or 4, 90/10-ish distribution', () => {
  const empty = new Array(CELLS).fill(0);
  const first = spawnTile(empty, 123456);
  assert.deepEqual(first.spawned, { index: 11, value: 4 });
  assert.deepEqual(spawnTile(empty, 123456), first);
  assert.deepEqual(spawnTile(new Array(CELLS).fill(2), 123456).spawned, null);

  let fours = 0;
  let twos = 0;
  for (let seed = 1; seed <= 2000; seed += 1) {
    const result = spawnTile(empty, seed);
    assert.ok(result.spawned.value === 2 || result.spawned.value === 4);
    assert.ok(Number.isInteger(result.spawned.index));
    if (result.spawned.value === 4) fours += 1;
    else twos += 1;
  }
  assert.ok(twos > fours, '2 must be more common than 4');
  const rate = fours / (fours + twos);
  assert.ok(rate > 0.04 && rate < 0.18, `unexpected 4 spawn rate ${rate}`);
});

test('normalizeDirection: arrows, WASD and names map to the four directions', () => {
  assert.equal(normalizeDirection('ArrowUp'), 'up');
  assert.equal(normalizeDirection('ArrowLeft'), 'left');
  assert.equal(normalizeDirection('w'), 'up');
  assert.equal(normalizeDirection('A'), 'left');
  assert.equal(normalizeDirection('right'), 'right');
  assert.equal(normalizeDirection('nope'), null);
  assert.equal(normalizeDirection(null), null);
  assert.equal(normalizeDirection(''), null);
});

test('move left/right/up/down: merge, score and compact correctly', () => {
  const left = move(stateWith([[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left');
  assert.deepEqual(boardExceptSpawn(left), [
    [4, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  assert.equal(left.scoreGained, 4);
  assert.deepEqual(left.merges, [{ index: 0, value: 4 }]);

  const right = move(stateWith([[2, 2, 4, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'right');
  assert.deepEqual(boardExceptSpawn(right), [
    [0, 0, 4, 4],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  assert.equal(right.scoreGained, 4);

  const up = move(stateWith([[2, 0, 0, 0], [2, 0, 0, 0], [4, 0, 0, 0], [4, 0, 0, 0]]), 'up');
  assert.deepEqual(boardExceptSpawn(up), [
    [4, 0, 0, 0],
    [8, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  assert.equal(up.scoreGained, 12);

  const down = move(stateWith([[2, 0, 0, 0], [2, 0, 0, 0], [4, 0, 0, 0], [4, 0, 0, 0]]), 'down');
  assert.deepEqual(boardExceptSpawn(down), [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [4, 0, 0, 0],
    [8, 0, 0, 0],
  ]);
  assert.equal(down.scoreGained, 12);
});

test('move merges each tile at most once and never re-merges the result', () => {
  const pairOfPairs = move(stateWith([[2, 2, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left');
  assert.deepEqual(boardExceptSpawn(pairOfPairs), [
    [4, 4, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  assert.equal(pairOfPairs.scoreGained, 8);

  const noChain = move(stateWith([[2, 2, 4, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left');
  assert.deepEqual(boardExceptSpawn(noChain), [
    [4, 4, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  assert.equal(noChain.scoreGained, 4);

  const twoPairs = move(stateWith([[4, 4, 8, 8], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left');
  assert.deepEqual(boardExceptSpawn(twoPairs), [
    [8, 16, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  assert.equal(twoPairs.scoreGained, 24);
  assert.deepEqual(twoPairs.merges, [
    { index: 0, value: 8 },
    { index: 1, value: 16 },
  ]);
});

test('move compacts zeros without merging unrelated values', () => {
  const result = move(stateWith([[2, 0, 2, 4], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left');
  assert.deepEqual(boardExceptSpawn(result), [
    [4, 4, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  assert.equal(result.scoreGained, 4);
});

test('accepted move spawns exactly one tile, advances moves and RNG', () => {
  const state = stateWith([
    [2, 0, 0, 0],
    [2, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  const result = move(state, 'up');
  assert.equal(result.moved, true);
  assert.ok(result.spawned);
  assert.ok(result.spawned.value === 2 || result.spawned.value === 4);
  assert.equal(tileCount(result.state.board), tileCount(state.board) - 1 + 1);
  assert.equal(result.state.moves, state.moves + 1);
  assert.notEqual(result.state.rngState, state.rngState);
  assert.equal(result.state.score, 4);
  assert.equal(result.state.status, 'playing');
  assert.equal(state.board[0], 2, 'input state must not be mutated');
});

test('invalid move: no spawn, no score, no move count, state untouched', () => {
  const state = stateWith([
    [2, 4, 8, 16],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  const result = move(state, 'left');
  assert.equal(result.moved, false);
  assert.equal(result.state, state);
  assert.equal(result.spawned, null);
  assert.equal(result.scoreGained, 0);
  assert.equal(result.slides.length, 0);
  assert.equal(result.state.moves, 0);
  assert.deepEqual(state.board, boardFromRows([
    [2, 4, 8, 16],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]));
  assert.equal(move(state, 'sideways').moved, false);
  assert.equal(move({ ...state, status: 'over' }, 'right').moved, false);
  assert.equal(move({ ...state, status: 'won' }, 'right').moved, false);
});

test('slides describe every source tile and its destination', () => {
  const state = stateWith([
    [2, 0, 2, 4],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  const result = move(state, 'left');
  assert.deepEqual(
    result.slides.map((slide) => [slide.from, slide.to]),
    [[0, 0], [2, 0], [3, 1]].sort((a, b) => a[0] - b[0]),
  );
  assert.equal(result.slides.filter((slide) => slide.merged).length, 2);
});

test('one undo per game: restores board/score/moves, never spawns, then locks', () => {
  const start = stateWith([
    [2, 2, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  const moved = move(start, 'left');
  assert.equal(canUndo(moved.state), true);
  assert.equal(undoAllowance(moved.state), 1);
  const restored = undo(moved.state);
  assert.equal(restored.undone, true);
  assert.deepEqual(restored.state.board, start.board);
  assert.equal(restored.state.score, start.score);
  assert.equal(restored.state.moves, start.moves);
  assert.equal(restored.state.undo, null);
  assert.equal(restored.state.undoUsed, true);
  assert.equal(canUndo(restored.state), false);
  assert.equal(undoAllowance(restored.state), 0);
  assert.equal(moved.state.board[moved.spawned.index], moved.spawned.value);
  assert.equal(tileCount(restored.state.board), tileCount(start.board), 'undo restores the pre-move board, spawn included');
  assert.equal(tileCount(restored.state.board), 2);
  assert.deepEqual(undo(restored.state), { state: restored.state, undone: false });

  const movedAgain = move(restored.state, 'right');
  assert.equal(movedAgain.moved, true);
  assert.equal(movedAgain.state.undo, null, 'undo allowance is not refilled by later moves');
  assert.equal(canUndo(movedAgain.state), false);
  assert.equal(undo(movedAgain.state).undone, false);
});

test('isGameOver: empty, mergeable and locked boards', () => {
  assert.equal(isGameOver(boardFromRows(EMPTY)), false);
  assert.equal(
    isGameOver(boardFromRows([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ])),
    true,
  );
  assert.equal(
    isGameOver(boardFromRows([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 4],
    ])),
    false,
    'equal horizontal neighbours are still playable',
  );
  assert.equal(
    isGameOver(boardFromRows([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 2, 4],
    ])),
    false,
    'equal vertical neighbours are still playable',
  );
});

test('a move that fills the last cell with no merge ends the game', () => {
  // After moving left, row 0 shifts and the only empty cell is index 3. Seed 1
  // spawns a 4 there (verified by the RNG test above), leaving no move.
  const state = createState({
    board: boardFromRows([
      [0, 2, 4, 2],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ]),
    rngState: 1,
    status: 'playing',
  });
  const result = move(state, 'left');
  assert.equal(result.moved, true);
  assert.deepEqual(result.spawned, { index: 3, value: 4 });
  assert.equal(result.gameOver, true);
  assert.equal(result.state.status, 'over');
  assert.equal(isGameOver(result.state.board), true);
  assert.equal(move(result.state, 'up').moved, false);
  assert.equal(move(result.state, 'left').moved, false);
});

test('reaching 2048 becomes won and can be continued into a higher score', () => {
  const state = stateWith([
    [1024, 1024, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  const win = move(state, 'left');
  assert.equal(win.state.board[0], TARGET);
  assert.equal(win.reachedTarget, true);
  assert.equal(win.state.status, 'won');
  assert.equal(win.state.reached2048, true);
  assert.equal(win.scoreGained, TARGET);
  assert.equal(move(win.state, 'right').moved, false, 'won pauses input until the player continues');

  const continued = continueAfterWin(win.state);
  assert.equal(continued.status, 'playing');
  const next = move(continued, 'right');
  assert.equal(next.moved, true);
  assert.equal(next.reachedTarget, false, 'the 2048 celebration only fires once per game');
  assert.equal(next.state.reached2048, true);
  assert.equal(continueAfterWin(continued).status, 'playing', 'continuing again is a no-op');
});

test('score accumulates merges, is clamped to the manifest maximum, and stays integer', () => {
  const state = stateWith([
    [2, 2, 4, 4],
    [8, 8, 16, 16],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  const result = move(state, 'left');
  assert.equal(result.scoreGained, 4 + 8 + 16 + 32);
  assert.equal(result.state.score, 60);

  const nearMax = createState({
    board: boardFromRows([
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]),
    score: SCORE_MAX - 2,
    rngState: 123456,
    status: 'playing',
  });
  const clamped = move(nearMax, 'left');
  assert.equal(clamped.state.score, SCORE_MAX);
  assert.ok(Number.isSafeInteger(clamped.state.score));
});

test('elapsed accumulates only while playing and respects the 24h cap', () => {
  const playing = stateWith(EMPTY);
  const withTime = addElapsed(playing, 1500);
  assert.equal(withTime.elapsed, 1500);
  assert.equal(addElapsed(withTime, 500).elapsed, 2000);
  assert.equal(addElapsed(playing, -500).elapsed, 0);
  assert.equal(addElapsed({ ...playing, status: 'ready' }, 1000).elapsed, 0, 'ready time is not play time');
  assert.equal(addElapsed({ ...playing, status: 'won' }, 1000).elapsed, 0);
  assert.equal(addElapsed({ ...playing, status: 'over' }, 1000).elapsed, 0);
  const capped = addElapsed({ ...playing, elapsed: MAX_ELAPSED_MS - 10 }, 1000);
  assert.equal(capped.elapsed, MAX_ELAPSED_MS);
});

test('beginPlay only advances a ready game', () => {
  const ready = createGame({ seed: 7 });
  assert.equal(beginPlay(ready).status, 'playing');
  assert.equal(beginPlay(beginPlay(ready)).status, 'playing');
  assert.equal(beginPlay({ ...ready, status: 'over' }).status, 'over');
});

test('save round-trip preserves board, score, moves, undo, elapsed, status and RNG', () => {
  let state = createGame({ seed: 42 });
  state = move(state, 'left').state;
  state = move(state, 'up').state;
  state = move(state, 'right').state;
  state = addElapsed(state, 4321);
  assert.equal(canUndo(state), true);

  const payload = serialize(state);
  assert.equal(payload.version, SAVE_VERSION);
  for (const key of ['version', 'board', 'score', 'undo', 'elapsed']) {
    assert.ok(Object.prototype.hasOwnProperty.call(payload, key), `save must include ${key}`);
  }
  assert.deepEqual(payload.board, state.board);
  assert.deepEqual(payload.undo.board, state.undo.board);

  const restored = deserialize(JSON.stringify(payload));
  assert.deepEqual(restored, state);
  assert.equal(restored.elapsed, 4321);
  assert.equal(restored.score, state.score);
  assert.equal(restored.moves, 3);
  assert.equal(restored.undoUsed, false);
  assert.deepEqual(rowsFromBoard(restored.board), rowsFromBoard(state.board));

  const afterUndo = undo(restored);
  assert.equal(afterUndo.undone, true);
  assert.deepEqual(serialize(afterUndo.state).undo, null);
  assert.equal(deserialize(serialize(afterUndo.state)).undoUsed, true, 'a spent undo stays spent after reload');

  assert.ok(Buffer.byteLength(JSON.stringify(payload), 'utf8') < 4096, 'save should stay well under 4 KiB');
  assert.equal(Buffer.byteLength(JSON.stringify(serialize(createGame({ seed: 1 }))), 'utf8') < 2048, true);
});

test('serialize returns copies, not live state references', () => {
  const state = createGame({ seed: 5 });
  const payload = serialize(state);
  payload.board[0] = 9999;
  assert.notEqual(state.board[0], 9999);
});

test('deserialize accepts JSON strings and the legacy schemaVersion key', () => {
  const state = createGame({ seed: 11 });
  const payload = serialize(state);
  assert.deepEqual(deserialize(JSON.stringify(payload)), state);
  const asSchemaVersion = { ...payload, schemaVersion: payload.version };
  delete asSchemaVersion.version;
  assert.deepEqual(deserialize(asSchemaVersion), state);
});

test('deserialize rejects corrupt or out-of-contract saves without throwing', () => {
  const good = serialize(createGame({ seed: 3 }));
  const cases = [
    null,
    undefined,
    42,
    'not json',
    '[]',
    {},
    { ...good, version: 2 },
    { ...good, board: good.board.slice(0, 15) },
    { ...good, board: [...good.board.slice(0, 15), 3] },
    { ...good, board: [...good.board.slice(0, 15), -2] },
    { ...good, score: -1 },
    { ...good, score: 1.5 },
    { ...good, score: SCORE_MAX + 1 },
    { ...good, moves: -1 },
    { ...good, rngState: -1 },
    { ...good, rngState: 4294967296 },
    { ...good, elapsed: -1 },
    { ...good, status: 'paused' },
    { ...good, undoUsed: 'yes' },
    { ...good, undo: { board: [1, 2], score: 0, moves: 0, rngState: 1 } },
  ];
  for (const save of cases) {
    assert.equal(deserialize(save), null, `expected null for ${JSON.stringify(save)}`);
  }
  assert.notEqual(deserialize(good), null);
});

test('a fixed seed plus a fixed direction sequence replays identically', () => {
  const sequence = ['left', 'down', 'right', 'up', 'left', 'left', 'down', 'right'];
  function play() {
    let state = createGame({ seed: 99 });
    const frames = [];
    for (const direction of sequence) {
      const result = move(state, direction);
      state = result.state;
      frames.push({
        moved: result.moved,
        spawned: result.spawned,
        board: result.state.board,
        score: result.state.score,
        rngState: result.state.rngState,
      });
    }
    return { state: serialize(state), frames };
  }
  const first = play();
  const second = play();
  assert.deepEqual(first, second);
  assert.ok(first.frames.some((frame) => frame.moved));
});

test('highestTile / tileCount basics', () => {
  const board = boardFromRows([
    [2, 4, 8, 16],
    [0, 0, 0, 0],
    [0, 0, 32, 0],
    [0, 0, 0, 0],
  ]);
  assert.equal(highestTile(board), 32);
  assert.equal(tileCount(board), 5);
  assert.equal(highestTile(boardFromRows(EMPTY)), 0);
});
