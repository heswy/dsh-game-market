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
import { register as v1Registry } from './cases/v1-registry.js';
import { register as v1Install } from './cases/v1-install.js';
import { register as v1Launch } from './cases/v1-launch.js';
import { register as v1Games } from './cases/v1-games.js';
import { register as v1Maintenance } from './cases/v1-maintenance.js';
import { register as v15InstallZip } from './cases/v1.5-install-zip.js';
import { register as v15RegistryV2 } from './cases/v1.5-registry-v2.js';
import { register as v15Resources } from './cases/v1.5-resources.js';
import { register as v15BuiltinPackage } from './cases/v1.5-builtin-package.js';
import { register as v15PlatformUpdate } from './cases/v1.5-platform-update.js';

health();
games();
saves();
sessions();
scores();
preferences();
agent();
launchEntry();
storage();
v1Registry();
v1Install();
v1Launch();
v1Games();
v1Maintenance();
v15InstallZip();
v15RegistryV2();
v15Resources();
v15BuiltinPackage();
v15PlatformUpdate();
