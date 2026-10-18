/**
 * Node test entry for `node --test packages/host/test`.
 *
 * Node 24 resolves a directory argument through module resolution (index.js),
 * so every case module exports `register()` and this file wires them together.
 * Running `node --test` from the repo root still discovers this file and the
 * helper modules (which register no tests).
 */

import { register as health } from './cases/health.js';
import { register as games } from './cases/games.js';
import { register as saves } from './cases/saves.js';
import { register as sessions } from './cases/sessions.js';
import { register as scores } from './cases/scores.js';
import { register as preferences } from './cases/preferences.js';
import { register as agent } from './cases/agent.js';
import { register as launchEntry } from './cases/launch-entry.js';
import { register as storage } from './cases/storage.js';

health();
games();
saves();
sessions();
scores();
preferences();
agent();
launchEntry();
storage();
