/**
 * Game-tab entry flow (no React): decides Market vs resume and performs the
 * side effects through injected callbacks so it is unit-testable without a
 * browser. See components/game-entry-view.js for the React binding.
 *
 * Behaviour (user request, 2026-10-18):
 *   - first time in a Session (no game started yet) -> open the Market;
 *   - after the user played a game in this Session and returned to work ->
 *     resume that game instead.
 */
import { selectGameEntry } from './store.js';

/**
 * @param {{store: {getState: Function}, sessionId: string|null,
 *   openView?: (view: string) => void, openMarket?: () => void,
 *   startGame?: (options: object) => void}} options
 * @returns {{kind: 'market'|'resume', gameId?: string}}
 */
export function enterGameSpace(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const store = opts.store;
  if (!store || typeof store.getState !== 'function') throw new Error('enterGameSpace requires a store');
  if (typeof opts.openView === 'function') opts.openView('chat');
  const entry = selectGameEntry(store.getState(), opts.sessionId);
  if (typeof opts.openMarket === 'function') opts.openMarket();
  if (entry.kind === 'resume' && typeof opts.startGame === 'function') {
    opts.startGame({ gameId: entry.gameId, mode: 'resume-paused', sessionId: opts.sessionId });
  }
  return entry;
}
