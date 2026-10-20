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
import './bundle-lib.test.js';
import './catalog.test.js';
import './keyboard.test.js';
import './debounce.test.js';
import './errors-text.test.js';
import './api-v1.test.js';
import './install-manager.test.js';
import './market-store.test.js';
import './actions-v1.test.js';
