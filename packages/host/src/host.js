/**
 * Host service composition. Kept separate from the Cordis plugin shell so the
 * services can be exercised without a live DSH connection.
 */

import { normaliseConfig, readBundleVersion } from './config.js';
import { createDevCatalog } from './dev-games.js';
import { createEntryService } from './entry.js';
import { createGameCatalog, createGamesService } from './games.js';
import { createHealthService } from './health.js';
import { createHostIdentity } from './host-identity.js';
import { createHostEpoch } from './ids.js';
import { createInstallLock } from './install-lock.js';
import { createInstallService } from './install.js';
import { createInstallationsStore } from './installations.js';
import { createMaintenanceService } from './maintenance.js';
import { createPlatformUpdateService } from './platform-update.js';
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
import { createUpdateAdmissionBarrier } from './update-admission.js';
import { createPlatformUpdateAdapter } from './update-adapter.js';
import { createUpdateOperationService } from './update-operations.js';
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
  pluginManager = null,
  pluginManagerResolver = null,
  hmrResolver = null,
} = {}) {
  const settings = normaliseConfig(config, env);
  const startedAt = now().getTime();
  const availability = { available: true };
  const storage = createStorage({ root: settings.dataRoot, logger });
  // V1.5: the Host running identity is frozen at activation; requests never
  // re-read the disk version and pretend it is what is running (§9, m3 §4).
  const identity = createHostIdentity({ env, settings, version, now, logger });
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
  // V1.5 M3 audit AUD-03: one Host-authoritative admission barrier shared by the
  // entry (launch/resume) path and the update operation state machine. It blocks
  // NEW game entries only while an update is between coordination and package
  // change; non-game routes are unaffected.
  const admission = createUpdateAdmissionBarrier({ now });
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
    admission,
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
  // V1.5 platform update adapter/operations. The native plugin manager is
  // resolved LAZILY on every adapter call: DSH registers services
  // asynchronously, so an activation-time `null` must not disable the feature
  // forever (M0 measured exactly that race for the `hmr` service).
  const resolvePluginManager =
    typeof pluginManagerResolver === 'function' ? pluginManagerResolver : () => pluginManager;
  const adapter = createPlatformUpdateAdapter({
    pluginManagerResolver: resolvePluginManager,
    hmrResolver,
    identity,
    hostEpoch,
    logger,
    now,
    timing: settings.platformUpdate,
  });
  let updates = null;
  const platformUpdate = createPlatformUpdateService({
    storage,
    settings,
    logger,
    now,
    http,
    identity,
    hostEpoch,
    getAdapterInfo: async () => (adapter === null ? null : adapter.describe()),
    getOperation: () => (updates === null ? null : updates.currentObservation()),
  });
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
    identity,
  });
  const services = {
    health,
    platformUpdate,
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
  updates = createUpdateOperationService({
    storage,
    discovery: platformUpdate,
    adapter,
    identity,
    admission,
    coordination: {
      listActiveInstances: () => entry.listActiveInstances(),
    },
    healthCheck: () => health.snapshot(),
    hostEpoch,
    logger,
    now,
    // Test/probe-only timing seam; production uses the frozen contract timing.
    timing: {
      ...(settings.platformUpdate || {}),
      ...(http.updateOperationTiming !== undefined && typeof http.updateOperationTiming === 'object'
        ? http.updateOperationTiming
        : {}),
    },
  });
  services.updates = updates;
  const routes = createRouteTable({ services, devMode: settings.devMode });
  const router = createRouter({ routes, logger, now });
  // Background Registry refresh (missing/stale cache) never blocks activation.
  registry.start();
  // V1.5 discovery: the silent startup check is background-only and must never
  // block activation or game/market routes (m3-decisions §3).
  const platformUpdateReady = platformUpdate.start().catch((error) => {
    logger?.warn?.('[game-market/host] platform-update-start-failed', `code=${error?.code || 'E_UNKNOWN'}`);
  });
  // Recovery of a persisted update record (HMR dispose / client refresh / RPC
  // loss / process restart) is background work; it never blocks activation.
  const updatesReady = updates.start().catch((error) => {
    logger?.warn?.('[game-market/host] platform-update-recovery-start-failed', `code=${error?.code || 'E_UNKNOWN'}`);
  });
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
    identity,
    platformUpdate,
    updates,
    admission,
    /**
     * Release the loopback resource server. Idempotent; awaited by the plugin
     * teardown so tests never leave a listening socket behind.
     */
    dispose: async () => {
      try {
        await maintenance.stop?.();
      } catch (_error) { /* best effort */ }
      try {
        await platformUpdate.stop();
      } catch (_error) { /* best effort */ }
      try {
        await updates.stop?.();
      } catch (_error) { /* best effort */ }
      await resources.close();
    },
    /** Settles discovery cache load / silent startup check (bounded by caller). */
    platformUpdateReady,
    /** Settles persisted update-record recovery (bounded by caller). */
    updatesReady,
  };
}
