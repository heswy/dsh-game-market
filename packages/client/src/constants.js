/** Stable client-side identifiers shared by registration and components. */

export const MAIN_PANEL_KEY = 'dsh-game-market';
export const SIDEBAR_ORDER = 40;

export const PAGES = Object.freeze({
  MARKET: 'market',
  MY_GAMES: 'my-games',
  RUNTIME: 'runtime',
});

export const RUNTIME_STATES = Object.freeze([
  'idle',
  'launching',
  'loading',
  'ready',
  'playing',
  'paused',
  'saving',
  'error',
  'exited',
]);

export const PAUSED_REASONS = Object.freeze(['waiting-user', 'view-result', 'leave']);
