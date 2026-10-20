/**
 * Native platform update adapter (docs/V1.5-CONTRACTS.md §9).
 *
 * Only the **public** `pluginManager` service methods are used:
 * `listBundles()`, `listPlugins()`, `installBundle(spec, options)`,
 * `waitForInstall(requestId)`, `cancelInstall(requestId)`. No private module
 * import, no `removeBundle(self)` + `installBundle(self)` combination: the
 * native manager owns the install and re-applies the updated bundle itself
 * (M0 proved the operator survives the updated bundle's disposal).
 *
 * The service is resolved lazily on every call: the real DSH tree registers
 * services asynchronously (M0 measured the `hmr` service missing at t=0 and
 * present ≈0.5s later), so freezing an activation-time `null` would disable the
 * feature forever. When the manager is absent the adapter reports
 * `available:false` and every mutating entry fails closed with GM-5038.
 */

import { GM } from '../../shared/src/errors.js';
import { PLATFORM_UPDATE_TIMING, updateGitSpecForCommit } from '../../shared/src/platform-update.js';
import { BUNDLE_ID } from '../../shared/src/constants.js';
import { hostError } from './errors.js';

const LOG = '[game-market/host]';

const MANAGER_METHODS = ['listBundles', 'listPlugins', 'installBundle', 'waitForInstall', 'cancelInstall'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isManager(value) {
  if (value === null || typeof value !== 'object') return false;
  return MANAGER_METHODS.every((method) => typeof value[method] === 'function');
}

/** Project plugin/bundle state into a short signature; a change invalidates capability caches. */
function capabilitySignature(bundles, plugins) {
  const bundlePart = (Array.isArray(bundles) ? bundles : [])
    .filter((entry) => entry !== null && typeof entry === 'object')
    .map((entry) => [entry.name, entry.version, entry.installed, entry.enabled])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  const pluginPart = (Array.isArray(plugins) ? plugins : [])
    .filter((entry) => entry !== null && typeof entry === 'object')
    .map((entry) => [entry.patchId ?? null, entry.moduleName ?? null, entry.fiberPhase ?? null])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  return JSON.stringify([bundlePart, pluginPart]);
}

/** True when a Loader row for our bundle is a dev-mode `file:`/`link:` row. */
function devRowShadowOf(plugins) {
  if (!Array.isArray(plugins)) return false;
  const row = plugins.find((entry) => {
    if (entry === null || typeof entry !== 'object') return false;
    if (entry.patchId === BUNDLE_ID) return true;
    if (entry.moduleName === BUNDLE_ID) return true;
    return typeof entry.moduleName === 'string' && entry.moduleName.includes(BUNDLE_ID) && /^(?:file|link):/.test(entry.moduleName);
  });
  if (row === undefined) return false;
  const module = typeof row.moduleName === 'string' ? row.moduleName : '';
  return /^(?:file|link):/.test(module);
}

/**
 * @param {{
 *   pluginManagerResolver?: (() => object|null)|null,
 *   hmrResolver?: (() => object|null)|null,
 *   identity?: object|null,
 *   hostEpoch?: string,
 *   logger?: object,
 *   now?: () => Date,
 *   timing?: object,
 * }} [options]
 */
export function createPlatformUpdateAdapter({
  pluginManagerResolver = null,
  hmrResolver = null,
  identity = null,
  hostEpoch = 'he_unknown',
  logger = null,
  now = () => new Date(),
  timing = {},
}) {
  const limits = { ...PLATFORM_UPDATE_TIMING, ...(timing !== null && typeof timing === 'object' ? timing : {}) };
  let cachedManager = null;
  /** @type {{hostEpoch:string, signature:string, state:'present'|'absent'|'unknown'}|null} */
  let capabilityCache = null;

  /**
   * Resolve (and cache) the native plugin manager. Deliberately re-runs the
   * resolver while it is absent: it can appear after activation.
   */
  function resolveManager() {
    if (cachedManager !== null && isManager(cachedManager)) return cachedManager;
    cachedManager = null;
    if (typeof pluginManagerResolver !== 'function') return null;
    try {
      const candidate = pluginManagerResolver();
      if (isManager(candidate)) {
        cachedManager = candidate;
        return candidate;
      }
    } catch (error) {
      logger?.warn?.(LOG, 'plugin-manager-resolver-failed', `code=${error?.code || 'E_UNKNOWN'}`);
    }
    return null;
  }

  function available() {
    return resolveManager() !== null;
  }

  function stopPromise(value) {
    return value !== null && typeof value === 'object' && typeof value.then === 'function';
  }

  async function safeListBundles(manager) {
    try {
      const bundles = manager.listBundles();
      if (stopPromise(bundles)) return await bundles;
      return bundles;
    } catch (error) {
      logger?.warn?.(LOG, 'update-list-bundles-failed', `code=${error?.code || 'E_UNKNOWN'}`);
      return [];
    }
  }

  async function safeListPlugins(manager) {
    try {
      const plugins = manager.listPlugins();
      if (stopPromise(plugins)) return await plugins;
      return plugins;
    } catch (error) {
      logger?.warn?.(LOG, 'update-list-plugins-failed', `code=${error?.code || 'E_UNKNOWN'}`);
      return [];
    }
  }

  function readHmrService(manager) {
    let resolved = null;
    let threw = false;
    if (typeof hmrResolver === 'function') {
      try {
        resolved = hmrResolver();
      } catch (_error) {
        threw = true;
      }
    }
    if (!threw && (resolved === null || resolved === undefined) && manager && manager.ownerContext) {
      // M0 measured this as the exact source `installBundle` itself reads. It is
      // only a fallback because the plugin context may not see the hmr service.
      try {
        resolved = manager.ownerContext.get('hmr');
      } catch (_error) {
        threw = true;
      }
    }
    return { value: resolved, threw };
  }

  /**
   * Poll the `hmr` service until the capability conclusion is stable (§9.2).
   *
   * `present`: `stableSamples` consecutive truthy samples.
   * `absent`: continuous absence for at least `hmrAbsenceSettleMs` (2.5s) so
   * the t=0 registration race can never be mistaken for a non-HMR profile.
   * `unknown`: the window ended without a stable conclusion (fail closed).
   */
  async function detectHmrCapability(manager, { signature = 'unknown' } = {}) {
    if (manager === null || manager === undefined) return 'unknown';
    if (capabilityCache !== null && capabilityCache.hostEpoch === hostEpoch && capabilityCache.signature === signature) {
      return capabilityCache.state;
    }
    const intervalMs = Number.isFinite(limits.hmrProbeIntervalMs) ? limits.hmrProbeIntervalMs : 250;
    const timeoutMs = Number.isFinite(limits.hmrProbeTimeoutMs) ? limits.hmrProbeTimeoutMs : 5000;
    const absenceSettleMs = Number.isFinite(limits.hmrAbsenceSettleMs) ? limits.hmrAbsenceSettleMs : 2500;
    const stableSamples = 2;
    const startedAt = Date.now();
    let presentRun = 0;
    let absentRun = 0;
    let sawError = false;
    let everSeenPresent = false;
    let conclusion = 'unknown';
    for (;;) {
      const sample = readHmrService(manager);
      if (sample.threw) sawError = true;
      if (!sample.threw && sample.value !== null && sample.value !== undefined) {
        everSeenPresent = true;
        presentRun += 1;
        absentRun = 0;
        if (presentRun >= stableSamples) {
          conclusion = 'present';
          break;
        }
      } else {
        absentRun += 1;
        presentRun = 0;
        const elapsed = Date.now() - startedAt;
        // A resolver that keeps throwing cannot prove absence: fail closed.
        if (sawError !== true && everSeenPresent !== true && absentRun >= stableSamples && elapsed >= absenceSettleMs) {
          conclusion = 'absent';
          break;
        }
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed >= timeoutMs) {
        conclusion = 'unknown';
        break;
      }
      await sleep(Math.min(intervalMs, Math.max(1, timeoutMs - elapsed)));
    }
    capabilityCache = { hostEpoch, signature, state: conclusion };
    logger?.info?.(LOG, 'platform-update-hmr-capability', `state=${conclusion}`, `sawError=${sawError === true}`);
    return conclusion;
  }

  /** Invalidate the HMR capability cache (profile/tree change, install applied). */
  function invalidateCapability() {
    capabilityCache = null;
  }

  /**
   * Read-only inspection for discovery `capability` and `installed` fields.
   * Never throws: a broken manager yields `available:false` (fail closed).
   */
  async function describe() {
    const manager = resolveManager();
    if (manager === null) {
      return {
        available: false,
        pluginManager: 'missing',
        hmr: 'unknown',
        enabled: null,
        diskVersion: null,
        devRowShadow: identity !== null && identity.devSource === true,
        spec: null,
        specShapeAtActivation: identity === null ? 'unknown' : identity.specShapeAtActivation,
        reasonKey: 'update.reason.adapterUnavailable',
      };
    }
    const [bundles, plugins] = await Promise.all([safeListBundles(manager), safeListPlugins(manager)]);
    const signature = capabilitySignature(bundles, plugins);
    const hmr = await detectHmrCapability(manager, { signature });
    const bundle = Array.isArray(bundles) ? bundles.find((entry) => entry !== null && entry !== undefined && entry.name === BUNDLE_ID) : undefined;
    const recordedShape = identity === null ? 'unknown' : identity.snapshot().specShape;
    const devRowShadow =
      devRowShadowOf(plugins) ||
      (identity !== null && identity.devSource === true) ||
      recordedShape === 'path' ||
      recordedShape === 'file';
    return {
      available: true,
      pluginManager: 'present',
      hmr,
      enabled: bundle !== undefined && typeof bundle.enabled === 'boolean' ? bundle.enabled : null,
      diskVersion: bundle !== undefined && typeof bundle.version === 'string' ? bundle.version : null,
      devRowShadow,
      installed: bundle !== undefined ? bundle.installed === true : null,
      availability: bundle !== undefined && typeof bundle.availability === 'string' ? bundle.availability : null,
      recordSource: bundle !== undefined && typeof bundle.source === 'string' ? bundle.source : null,
      reasonKey: null,
    };
  }

  /**
   * Install the exact pinned spec for a validated discovery target.
   * Returns the native folded result object (never throws for management
   * failures; only a missing capability throws).
   */
  async function install(target, { requestId } = {}) {
    const manager = resolveManager();
    if (manager === null) {
      throw hostError(GM.UPDATE_ADAPTER_UNAVAILABLE, 'Plugin update capability is unavailable', {
        retryable: true,
      });
    }
    const spec = updateGitSpecForCommit(target.commit);
    if (spec === null || spec !== target.spec) {
      // Defence in depth: the adapter may only construct the frozen spec shape;
      // arbitrary URLs/specs from any caller are never forwarded.
      throw hostError(GM.UPDATE_TARGET_INVALID, 'Update target is not the validated official spec', {
        retryable: false,
      });
    }
    const result = await manager.installBundle(spec, {
      enabled: true,
      requestId,
      saveExact: true,
    });
    invalidateCapability();
    return result;
  }

  async function waitForInstall(requestId) {
    const manager = resolveManager();
    if (manager === null || typeof requestId !== 'string' || requestId.length === 0) return null;
    try {
      const pending = manager.waitForInstall(requestId);
      if (stopPromise(pending)) return await pending;
      return pending ?? null;
    } catch (error) {
      logger?.warn?.(LOG, 'update-wait-for-install-failed', `code=${error?.code || 'E_UNKNOWN'}`);
      return null;
    }
  }

  async function cancelInstall(requestId) {
    const manager = resolveManager();
    if (manager === null) return { status: 'not-running' };
    try {
      const result = await manager.cancelInstall(requestId);
      return result !== null && typeof result === 'object' ? result : { status: 'not-running' };
    } catch (error) {
      logger?.warn?.(LOG, 'update-cancel-failed', `code=${error?.code || 'E_UNKNOWN'}`);
      return { status: 'not-running' };
    }
  }

  /** Current Host release-expected Client identity (from the running bundle). */
  function expectedClientIdentity() {
    if (identity === null) return { buildVersion: null, buildCommit: null };
    return identity.expectedClient;
  }

  return {
    available,
    describe,
    install,
    waitForInstall,
    cancelInstall,
    detectHmrCapability,
    invalidateCapability,
    expectedClientIdentity,
    resolveManager,
    get hostEpoch() {
      return hostEpoch;
    },
    get now() {
      return now;
    },
  };
}
