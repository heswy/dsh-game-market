/**
 * Package entry point. The bundle root re-exports `apply`/`inject` from
 * `./plugin.js`; this file keeps `@dsh-game/host` importable for tests/tools.
 */

export { apply, inject } from './plugin.js';
export { createHost } from './host.js';
