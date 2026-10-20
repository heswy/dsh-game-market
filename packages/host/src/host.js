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
import { createLayeredRegistryService } from './registry-layered.js';
import { createRegistryService } from './registry.js';
import { createResourceService } from './resources.js';
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
  const registry =
    settings.registry.mode === 'layered'
      ? createLayeredRegistryService({ storage, settings, logger, now, http })
      : createRegistryService({ storage, settings, logger, now, http });
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
  // V1.5: the instance resource origin is an independent loopback server, not a
  // DSH `/api` route (docs/V1.5-CONTRACTS.md §7.1 — the `/api` fence rejects
  // opaque-origin subresources with 403).
  const resources = createResourceService({
    storage,
    installations,
    logger,
    now,
    timing: { resourceCredentialTtlMs: http.timing?.resourceCredentialTtlMs },
    port: settings.resource?.port ?? http.resourcePort ?? 0,
    frameAncestors: settings.security.frameAncestors,
    dshWebOrigin: http.dshWebOrigin ?? null,
  });
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
    // V1.5: entry/launch needs the resource origin to issue instance
    // credentials and fill the LaunchInfo resource fields (§7.2/§7.6).
    resources,
  });
  const maintenance = createMaintenanceService({ storage, installations, registry, lock, logger, now, resources });
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
    resources,
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
    resources,
    /**
     * Release the loopback resource server. Idempotent; awaited by the plugin
     * teardown so tests never leave a listening socket behind.
     */
    dispose: async () => {
      try {
        await maintenance.stop?.();
      } catch (_error) { /* best effort */ }
      await resources.close();
    },
  };
}
