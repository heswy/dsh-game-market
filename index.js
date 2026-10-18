/**
 * dsh-game-market — Bundle entry (Host half).
 *
 * The implementation lives in packages/host; this file only keeps the bundle
 * entry stable for both package installs and the dev-mode absolute-path row.
 */
export { apply, inject, Config } from './packages/host/src/plugin.js';
