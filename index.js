/**
 * dsh-game-market — Bundle entry (Host half).
 *
 * The implementation lives in packages/host; this file only keeps the bundle
 * entry stable for both package installs and the dev-mode absolute-path row.
 * Cordis reads the named `apply` / `inject` exports from the plugin module.
 */
export { apply, inject } from './packages/host/src/plugin.js';
