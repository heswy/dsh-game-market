/**
 * Pure, synchronous save helpers (PRD §8.2.9 item 2). React state is never the
 * source of truth: the mutable game state lives in a ref, so serialization is
 * a plain function call with no render dependency.
 */

export const SAVE_VERSION = 1 as const;

export interface Star {
  x: number;
  y: number;
  vy: number;
  r: number;
}

export interface GameState {
  saveVersion: number;
  score: number;
  lives: number;
  elapsed: number;
  stars: Star[];
  spawnIn: number;
  basket: number;
  gameOver: boolean;
}

export function createInitialState(): GameState {
  return {
    saveVersion: SAVE_VERSION,
    score: 0,
    lives: 3,
    elapsed: 0,
    stars: [],
    spawnIn: 0.45,
    basket: 0.5,
    gameOver: false,
  };
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function cloneStar(star: Star): Star {
  return {
    x: finite(star.x, 0.5, 0, 1),
    y: finite(star.y, -0.1, -0.5, 1.5),
    vy: finite(star.vy, 0.2, 0.01, 2),
    r: finite(star.r, 10, 4, 32),
  };
}

export function serializeState(state: GameState): GameState {
  return {
    saveVersion: SAVE_VERSION,
    score: finite(state.score, 0, 0, 1_000_000),
    lives: Math.round(finite(state.lives, 3, 0, 3)),
    elapsed: finite(state.elapsed, 0, 0, 86_400),
    stars: state.stars.slice(0, 32).map(cloneStar),
    spawnIn: finite(state.spawnIn, 0.4, 0, 10),
    basket: finite(state.basket, 0.5, 0, 1),
    gameOver: state.gameOver === true,
  };
}

export function deserializeState(data: unknown): GameState | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const raw = data as Partial<GameState>;
  if (raw.saveVersion !== SAVE_VERSION || raw.gameOver === true) return null;
  const lives = Math.round(finite(raw.lives, 0, 0, 3));
  if (lives <= 0) return null;
  return {
    saveVersion: SAVE_VERSION,
    score: finite(raw.score, 0, 0, 1_000_000),
    lives,
    elapsed: finite(raw.elapsed, 0, 0, 86_400),
    stars: Array.isArray(raw.stars) ? raw.stars.slice(0, 32).map(cloneStar) : [],
    spawnIn: finite(raw.spawnIn, 0.4, 0, 10),
    basket: finite(raw.basket, 0.5, 0, 1),
    gameOver: false,
  };
}
