/**
 * Dynamically imported module (separate ESM request + CORS + CSP script-src).
 * A game that lazy-loads power-ups/levels uses exactly this pattern.
 */
export const POWERUP_ID = 'powerup@probe-1';

export function applyPowerup(state) {
  return { ...state, power: (state.power || 0) + 1 };
}
