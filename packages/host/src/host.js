/**
 * Host service composition. Kept separate from the Cordis plugin shell so the
 * services can be exercised without a live DSH connection.
 */

import { normaliseConfig, readBundleVersion } from './config.js';
import { createHostEpoch } from './ids.js';
import { createStorage } from './storage.js';
import { createGameCatalog, createGamesService } from './games.js';
import { createSavesService } from './saves.js';
import { createSessionsService } from './sessions.js';
import { createScoresService } from './scores.js';
import { createPreferencesService } from './preferences.js';
import { createAgentAdapter } from './agent-adapter.js';
import { createEntryService } from './entry.js';
import { createHealthService } from './health.js';
import { createRouteTable } from './routes.js';
import { createRouter } from './router.js';

/**
 * @param {{
 *   config?: object,
 *   env?: Record<string, string|undefined>,
 *   logger?: object,
 *   now?: () => Date,
 *   hostEpoch?: string,
 *   version?: string
 * }} [options]
 */
export function createHost({
  config = {},
  env = process.env,
  logger = null,
  now = () => new Date(),
  hostEpoch = createHostEpoch(),
  version = readBundleVersion(),
} = {}) {
  const settings = normaliseConfig(config, env);
  const startedAt = now().getTime();
  const availability = { available: true };
  const storage = createStorage({ root: settings.dataRoot, logger });
  const catalog = createGameCatalog({ root: settings.builtinGamesRoot, logger });
  const saves = createSavesService({ storage, catalog, logger, now });
  const sessions = createSessionsService({ storage, catalog, logger, now });
  const scores = createScoresService({ storage, catalog, logger, now });
  const preferences = createPreferencesService({ storage, logger });
  const games = createGamesService({ catalog, storage, saves, sessions, scores, now });
  const agent = createAgentAdapter({ hostEpoch, now, logger });
  const entry = createEntryService({ catalog, hostEpoch, logger, now });
  const health = createHealthService({
    storage,
    catalog,
    sessions,
    availability,
    version,
    hostEpoch,
    devMode: settings.devMode,
    startedAt,
    now,
    logger,
  });
  const services = {
    health,
    games,
    saves,
    sessions,
    scores,
    preferences,
    agent,
    entry,
    storage,
    catalog,
  };
  const routes = createRouteTable({ services, devMode: settings.devMode });
  const router = createRouter({ routes, logger, now });
  return {
    settings,
    storage,
    catalog,
    services,
    routes,
    router,
    hostEpoch,
    version,
    startedAt,
    availability,
  };
}
