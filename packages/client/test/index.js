/**
 * Aggregate entry so the documented `node --test packages/client/test` command
 * discovers every client test on Node versions that resolve a directory to
 * `index.js` instead of scanning it.
 */
import './store.test.js';
import './chip-state.test.js';
import './agent-polling.test.js';
import './locale.test.js';
import './runtime-utils.test.js';
import './actions.test.js';
import './bundle.test.js';
