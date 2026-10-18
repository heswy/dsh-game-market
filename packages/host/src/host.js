/**
 * Host service composition. Kept separate from the Cordis plugin shell so the
 * services can be exercised without a live DSH connection.
 */

import { normaliseConfig, readBundleVersion } from './config.js';
import { createDevCatalog } from './dev-games.js';
import { createEntryService } from './entry.js';
import { createGameCatalog, createGamesService } from './games.js';
import { createHealthService } from './health.js';
import { createHostEpoch } from './ids.js';
import { createInstallLock } from './install-lock.js';
import { createInstallService } from './install.js';
import { createInstallationsStore } from './installations.js';
import { createMaintenanceService } from './maintenance.js';
import { createPreferencesService } from './preferences.js';
import { createGameResolver } from './resolver.js';
import { createRegistryService } from './registry.js';
import { createRouteTable } from './routes.js';
import { createRouter } from './router.js';
import { createSavesService } from './saves.js';
import { createScoresService } from './scores.js';
import { createSessionsService } from './sessions.js';
import { createStorage } from './storage.js';
import { createAgentAdapter } from './agent-adapter.js';

/**
 * @param {{
 *   config?: object,
 *   env?: Record<string, string|undefined>,
 *   logger?: object,
 *   now?: () => Date,
 *   hostEpoch?: string,
 *   version?: string,
 *   http?: {
 *     fetch?: Function,
 *     sleep?: Function,
 *     resolveHost?: Function,
 *     retries?: number,
 *     retryDelaysMs?: number[],
 *     installLockWaitMs?: number,
 *     lockHeartbeatMs?: number,
 *     lockStaleMs?: number,
 *     timing?: {entryBindingTtlMs?: number}
 *   }
 * }} [options]
 */
export function createHost({
  config = {},
  env = process.env,
  logger = null,
  now = () => new Date(),
  hostEpoch = createHostEpoch(),
  version = readBundleVersion(),
  http = {},
} = {}) {
  const settings = normaliseConfig(config, env);
  const startedAt = now().getTime();
  const availability = { available: true };
  const storage = createStorage({ root: settings.dataRoot, logger });
  const installations = createInstallationsStore({ storage, logger, now });
  const catalog = createGameCatalog({ root: settings.builtinGamesRoot, logger });
  const devCatalog = createDevCatalog({ settings, logger, now });
  const registry = createRegistryService({ storage, settings, logger, now, http });
  const lock = createInstallLock({
    storage,
    logger,
    heartbeatMs: http.lockHeartbeatMs,
    staleMs: http.lockStaleMs,
  });
  const resolver = createGameResolver({ catalog, installations, devCatalog });
  const saves = createSavesService({ storage, catalog: resolver, logger, now });
  const sessions = createSessionsService({ storage, catalog: resolver, logger, now });
  const scores = createScoresService({ storage, catalog: resolver, logger, now });
  const preferences = createPreferencesService({ storage, logger });
  const entry = createEntryService({
    catalog,
    devCatalog,
    installations,
    registry,
    storage,
    settings,
    hostEpoch,
    logger,
    now,
    timing: http.timing,
  });
  const maintenance = createMaintenanceService({ storage, installations, registry, lock, logger, now });
  const maintenanceReady = maintenance.start();
  const install = createInstallService({
    storage,
    settings,
    registry,
    catalog,
    installations,
    sessions,
    saves,
    preferences,
    entry,
    lock,
    maintenance: { ready: () => maintenanceReady },
    logger,
    now,
    http,
  });
  const games = createGamesService({
    catalog,
    devCatalog,
    installations,
    registry,
    storage,
    saves,
    sessions,
    scores,
    now,
  });
  const agent = createAgentAdapter({ hostEpoch, now, logger });
  const health = createHealthService({
    storage,
    catalog,
    sessions,
    registry,
    installations,
    settings,
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
    install,
    registry,
    storage,
    catalog,
    installations,
    resolver,
    maintenance,
  };
  const routes = createRouteTable({ services, devMode: settings.devMode });
  const router = createRouter({ routes, logger, now });
  // Background Registry refresh (missing/stale cache) never blocks activation.
  registry.start();
  return {
    settings,
    storage,
    catalog,
    installations,
    registry,
    install,
    maintenance: { ...maintenance, ready: () => maintenanceReady },
    services,
    routes,
    router,
    hostEpoch,
    version,
    startedAt,
    availability,
  };
}
