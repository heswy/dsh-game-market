/**
 * 2048 · pure game logic.
 *
 * No DOM, no timers, no SDK, no global state: every function takes a state and
 * returns a new one. The renderer and the platform SDK live in game.js /
 * render.js, which keeps the rules exhaustively testable in `node --test`.
 *
 * Contract highlights (docs/V1-GAME-ACCEPTANCE.md §4, docs/V1-CONTRACTS.md §10):
 *   - 4x4 board, a move merges each pair at most once and compacts towards the
 *     target edge; every accepted move spawns exactly one 2 or 4.
 *   - The spawn is deterministic: `rngState` is a 32-bit xorshift seed, so the
 *     same seed + the same input sequence always reproduces the same board.
 *   - One undo per game. Undo restores board + score + moves (and the RNG, so
 *     the replayed future stays deterministic) and never spawns a tile.
 *   - The game ends only when no empty cell and no equal neighbour remains.
 *     Reaching 2048 is `won`, which the player may continue from.
 */

export const SIZE = 4;
export const CELLS = SIZE * SIZE;
export const TARGET = 2048;
export const SAVE_VERSION = 1;
export const SCORE_MAX = 1000000000;
export const SPAWN_FOUR_RATE = 0.1;
export const MAX_ELAPSED_MS = 24 * 60 * 60 * 1000;

const DEFAULT_SEED = 0x9e3779b9;
const STATUSES = Object.freeze(['ready', 'playing', 'won', 'over']);

export const DIRECTIONS = Object.freeze(['up', 'right', 'down', 'left']);

const KEY_TO_DIRECTION = Object.freeze({
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  w: 'up',
  a: 'left',
  s: 'down',
  d: 'right',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
});

/**
 * Lines of cell indices ordered from the target edge inward.
 * Moving `left` processes every row from column 0 towards column 3, etc.
 */
const LINES = Object.freeze({
  left: Object.freeze([
    Object.freeze([0, 1, 2, 3]),
    Object.freeze([4, 5, 6, 7]),
    Object.freeze([8, 9, 10, 11]),
    Object.freeze([12, 13, 14, 15]),
  ]),
  right: Object.freeze([
    Object.freeze([3, 2, 1, 0]),
    Object.freeze([7, 6, 5, 4]),
    Object.freeze([11, 10, 9, 8]),
    Object.freeze([15, 14, 13, 12]),
  ]),
  up: Object.freeze([
    Object.freeze([0, 4, 8, 12]),
    Object.freeze([1, 5, 9, 13]),
    Object.freeze([2, 6, 10, 14]),
    Object.freeze([3, 7, 11, 15]),
  ]),
  down: Object.freeze([
    Object.freeze([12, 8, 4, 0]),
    Object.freeze([13, 9, 5, 1]),
    Object.freeze([14, 10, 6, 2]),
    Object.freeze([15, 11, 7, 3]),
  ]),
});

function normalizeSeed(seed) {
  const value = Number(seed);
  if (!Number.isFinite(value)) return DEFAULT_SEED;
  const normalized = Math.trunc(value) >>> 0;
  return normalized === 0 ? DEFAULT_SEED : normalized;
}

/** True for 0 or a power of two in [2, 2^52] (a legal tile value). */
export function isTileValue(value) {
  if (value === 0) return true;
  return Number.isSafeInteger(value) && value >= 2 && Number.isInteger(Math.log2(value));
}

function isScore(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function clampScore(value) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(SCORE_MAX, Math.floor(value));
}

/** Create an empty 4x4 board (16 zeros). */
export function emptyBoard() {
  return new Array(CELLS).fill(0);
}

/** Build a board from 4 rows of 4 numbers. Throws on malformed input. */
export function boardFromRows(rows) {
  if (!Array.isArray(rows) || rows.length !== SIZE) {
    throw new Error('boardFromRows expects 4 rows');
  }
  const board = emptyBoard();
  for (let row = 0; row < SIZE; row += 1) {
    const values = rows[row];
    if (!Array.isArray(values) || values.length !== SIZE) {
      throw new Error('boardFromRows expects 4 columns per row');
    }
    for (let col = 0; col < SIZE; col += 1) {
      const value = values[col];
      if (!isTileValue(value) || value < 0) throw new Error(`invalid tile value at ${row},${col}: ${value}`);
      board[row * SIZE + col] = value;
    }
  }
  return board;
}

/** Split a board into 4 rows (a copy, safe for assertions). */
export function rowsFromBoard(board) {
  const rows = [];
  for (let row = 0; row < SIZE; row += 1) {
    rows.push(board.slice(row * SIZE, row * SIZE + SIZE));
  }
  return rows;
}

/** Highest tile on the board (0 for an empty board). */
export function highestTile(board) {
  let highest = 0;
  for (let index = 0; index < CELLS; index += 1) {
    if (board[index] > highest) highest = board[index];
  }
  return highest;
}

/** Number of non-empty cells. */
export function tileCount(board) {
  let count = 0;
  for (let index = 0; index < CELLS; index += 1) {
    if (board[index] !== 0) count += 1;
  }
  return count;
}

/** Map a keyboard key / direction name to `up|right|down|left` (or null). */
export function normalizeDirection(input) {
  if (typeof input !== 'string') return null;
  return KEY_TO_DIRECTION[input.trim().toLowerCase()] || null;
}

/**
 * Advance the 32-bit xorshift RNG. Returns the next state plus a float in
 * [0, 1). A state of 0 is replaced by the default seed so the stream can never
 * get stuck (xorshift is undefined for zero).
 */
export function nextRandom(rngState) {
  let value = normalizeSeed(rngState);
  value ^= value << 13;
  value >>>= 0;
  value ^= value >>> 17;
  value ^= value << 5;
  value >>>= 0;
  return { state: value, value: value / 4294967296 };
}

/**
 * Place one tile (2 with 90% probability, otherwise 4) on a random empty cell.
 * Returns the new board + rng state + the spawned tile. A full board is left
 * untouched and `spawned` is null.
 */
export function spawnTile(board, rngState) {
  const empties = [];
  for (let index = 0; index < CELLS; index += 1) {
    if (board[index] === 0) empties.push(index);
  }
  let state = normalizeSeed(rngState);
  if (empties.length === 0) return { board: board.slice(), rngState: state, spawned: null };
  const first = nextRandom(state);
  state = first.state;
  const index = empties[Math.floor(first.value * empties.length)];
  const second = nextRandom(state);
  state = second.state;
  const value = second.value < SPAWN_FOUR_RATE ? 4 : 2;
  const nextBoard = board.slice();
  nextBoard[index] = value;
  return { board: nextBoard, rngState: state, spawned: { index, value } };
}

function makeSnapshot(state) {
  return {
    board: state.board.slice(),
    score: state.score,
    moves: state.moves,
    rngState: state.rngState,
  };
}

function validStatus(status) {
  return STATUSES.includes(status);
}

/**
 * Build a state explicitly. Tests and dev tools use this to place a known
 * board; the game itself starts via createGame().
 */
export function createState(options = {}) {
  const board = Array.isArray(options.board) ? options.board.slice() : emptyBoard();
  if (board.length !== CELLS || board.some((value) => !isTileValue(value))) {
    throw new Error('createState expects a 16-cell board of 0 or power-of-two tiles');
  }
  const status = validStatus(options.status) ? options.status : 'ready';
  return {
    board,
    score: isScore(options.score) ? clampScore(options.score) : 0,
    moves: Number.isSafeInteger(options.moves) && options.moves >= 0 ? options.moves : 0,
    undo: options.undo || null,
    undoUsed: options.undoUsed === true,
    rngState: normalizeSeed(options.rngState),
    status,
    reached2048: options.reached2048 === true || highestTile(board) >= TARGET,
    elapsed: Number.isFinite(options.elapsed) && options.elapsed > 0 ? Math.floor(options.elapsed) : 0,
  };
}

/** Fresh game: empty board, two starting tiles, score 0, one undo available. */
export function createGame(options = {}) {
  const seed = normalizeSeed(options.seed);
  let state = createState({ rngState: seed });
  let first = spawnTile(state.board, state.rngState);
  let second = spawnTile(first.board, first.rngState);
  return {
    ...state,
    board: second.board,
    rngState: second.rngState,
    status: 'ready',
  };
}

/** The status a game enters when the player first interacts (no move yet). */
export function beginPlay(state) {
  if (!state || state.status !== 'ready') return state;
  return { ...state, status: 'playing' };
}

/** Remaining undos this game (1 until used, then 0). */
export function undoAllowance(state) {
  return state && state.undoUsed ? 0 : 1;
}

/** Whether an undo can be applied right now (a move exists and is unused). */
export function canUndo(state) {
  return Boolean(state && state.undo && !state.undoUsed);
}

/**
 * Apply one move. Returns:
 *   state       next state (same reference when the move is invalid)
 *   moved       whether the board changed
 *   scoreGained points earned by merges (0 when invalid)
 *   slides      [{from, to, value, merged}] source -> destination tiles
 *   merges      [{index, value}] merged destinations
 *   spawned     {index, value} | null (only for accepted moves)
 *   reachedTarget / gameOver booleans for the UI.
 */
export function move(state, direction) {
  const noMove = {
    state,
    moved: false,
    scoreGained: 0,
    slides: [],
    merges: [],
    spawned: null,
    reachedTarget: false,
    gameOver: false,
  };
  if (!state || !Array.isArray(state.board) || state.board.length !== CELLS) return noMove;
  const resolved = normalizeDirection(direction);
  if (!resolved) return noMove;
  if (state.status === 'over' || state.status === 'won') return noMove;

  const board = emptyBoard();
  const slides = [];
  const merges = [];
  let scoreGained = 0;
  let changed = false;

  for (const line of LINES[resolved]) {
    const compacted = [];
    for (const index of line) {
      if (state.board[index] !== 0) compacted.push({ value: state.board[index], from: index });
    }
    const mergedLine = [];
    for (let cursor = 0; cursor < compacted.length; cursor += 1) {
      const current = compacted[cursor];
      const neighbor = compacted[cursor + 1];
      if (neighbor && neighbor.value === current.value) {
        mergedLine.push({ value: current.value * 2, sources: [current.from, neighbor.from], merged: true });
        cursor += 1;
      } else {
        mergedLine.push({ value: current.value, sources: [current.from], merged: false });
      }
    }
    for (let position = 0; position < mergedLine.length; position += 1) {
      const tile = mergedLine[position];
      const destination = line[position];
      board[destination] = tile.value;
      if (tile.merged) {
        scoreGained += tile.value;
        merges.push({ index: destination, value: tile.value });
      }
      for (const source of tile.sources) {
        slides.push({
          from: source,
          to: destination,
          value: tile.value,
          merged: tile.merged,
          fromValue: state.board[source],
        });
        if (source !== destination) changed = true;
      }
      if (tile.merged) changed = true;
    }
  }

  if (!changed) return noMove;

  const spawnResult = spawnTile(board, state.rngState);
  const nextBoard = spawnResult.board;
  const nextScore = clampScore(state.score + scoreGained);
  const previouslyReached = state.reached2048 === true;
  const nowReached = !previouslyReached && highestTile(nextBoard) >= TARGET;
  const gameOver = !nowReached && isGameOver(nextBoard);
  let status = state.status === 'ready' ? 'playing' : state.status;
  if (nowReached) status = 'won';
  else if (gameOver) status = 'over';

  const nextState = {
    ...state,
    board: nextBoard,
    score: nextScore,
    moves: state.moves + 1,
    undo: state.undoUsed ? null : makeSnapshot(state),
    undoUsed: state.undoUsed === true,
    rngState: spawnResult.rngState,
    status,
    reached2048: previouslyReached || nowReached,
  };

  return {
    state: nextState,
    moved: true,
    scoreGained,
    slides,
    merges,
    spawned: spawnResult.spawned,
    reachedTarget: nowReached,
    gameOver: status === 'over',
  };
}

/**
 * Undo the last move. Consumes the single allowance; restores board, score,
 * moves and rng without spawning a new tile.
 */
export function undo(state) {
  if (!canUndo(state)) return { state, undone: false };
  const snapshot = state.undo;
  const restoredBoard = snapshot.board.slice();
  const status = state.status === 'won' || state.status === 'over' ? 'playing' : state.status;
  return {
    state: {
      ...state,
      board: restoredBoard,
      score: clampScore(snapshot.score),
      moves: snapshot.moves,
      undo: null,
      undoUsed: true,
      rngState: normalizeSeed(snapshot.rngState),
      status,
      reached2048: highestTile(restoredBoard) >= TARGET,
    },
    undone: true,
  };
}

/** True when the board is full and no orthogonal neighbours are equal. */
export function isGameOver(board) {
  if (!Array.isArray(board) || board.length !== CELLS) return true;
  for (let index = 0; index < CELLS; index += 1) {
    if (board[index] === 0) return false;
    const row = Math.floor(index / SIZE);
    const col = index % SIZE;
    if (col < SIZE - 1 && board[index] === board[index + 1]) return false;
    if (row < SIZE - 1 && board[index] === board[index + SIZE]) return false;
  }
  return true;
}

/** Leave the `won` overlay and keep playing (or settle a locked board). */
export function continueAfterWin(state) {
  if (!state || state.status !== 'won') return state;
  const status = isGameOver(state.board) ? 'over' : 'playing';
  return { ...state, status };
}

/** Add active play time. Paused / ready / over states never accumulate. */
export function addElapsed(state, milliseconds) {
  if (!state) return state;
  const delta = Number.isFinite(milliseconds) ? Math.max(0, Math.floor(milliseconds)) : 0;
  if (delta === 0 || state.status !== 'playing') return state;
  return { ...state, elapsed: Math.min(MAX_ELAPSED_MS, (state.elapsed || 0) + delta) };
}

/**
 * Save payload. `version` is the game save schema (manifest save.schemaVersion
 * = 1). Shape: { version, board, score, moves, undo, rngState, elapsed,
 * status, reached2048, undoUsed }.
 */
export function serialize(state) {
  const snapshot = state.undo
    ? {
        board: state.undo.board.slice(),
        score: state.undo.score,
        moves: state.undo.moves,
        rngState: state.undo.rngState,
      }
    : null;
  return {
    version: SAVE_VERSION,
    board: state.board.slice(),
    score: state.score,
    moves: state.moves,
    undo: snapshot,
    rngState: state.rngState >>> 0,
    elapsed: Math.max(0, Math.round(state.elapsed || 0)),
    status: state.status,
    reached2048: state.reached2048 === true,
    undoUsed: state.undoUsed === true,
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

function parseBoard(raw) {
  if (!Array.isArray(raw) || raw.length !== CELLS) return null;
  const board = emptyBoard();
  for (let index = 0; index < CELLS; index += 1) {
    const value = raw[index];
    if (!isTileValue(value)) return null;
    board[index] = value;
  }
  return board;
}

function parseUndo(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const board = parseBoard(raw.board);
  if (!board) return null;
  if (!isScore(raw.score) || raw.score > SCORE_MAX) return null;
  if (!Number.isSafeInteger(raw.moves) || raw.moves < 0) return null;
  return {
    board,
    score: raw.score,
    moves: raw.moves,
    rngState: normalizeSeed(raw.rngState),
  };
}

/**
 * Restore a state from a save payload (object or JSON string). Returns null for
 * anything malformed, version-mismatched or out of contract — callers treat
 * null as "start a fresh game" and never crash.
 */
export function deserialize(raw) {
  const input = parseSaveInput(raw);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const version = input.version !== undefined ? input.version : input.schemaVersion;
  if (version !== SAVE_VERSION) return null;
  const board = parseBoard(input.board);
  if (!board) return null;
  if (!isScore(input.score) || input.score > SCORE_MAX) return null;
  if (!Number.isSafeInteger(input.moves) || input.moves < 0) return null;
  const undo = parseUndo(input.undo);
  if (input.undo !== null && input.undo !== undefined && undo === null) return null;
  if (!Number.isSafeInteger(input.rngState) || input.rngState < 0 || input.rngState > 0xffffffff) return null;
  const elapsed = input.elapsed === undefined ? 0 : input.elapsed;
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  if (!validStatus(input.status)) return null;
  if (input.undoUsed !== undefined && typeof input.undoUsed !== 'boolean') return null;
  return {
    board,
    score: input.score,
    moves: input.moves,
    undo,
    undoUsed: input.undoUsed === true,
    rngState: normalizeSeed(input.rngState),
    status: input.status,
    reached2048: input.reached2048 === true || highestTile(board) >= TARGET,
    elapsed: Math.min(MAX_ELAPSED_MS, Math.floor(elapsed)),
  };
}
