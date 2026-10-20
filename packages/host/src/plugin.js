/**
 * dsh-game-market — Host half entry (Cordis plugin).
 *
 * Registration is defensive: a missing `connection` service, an unknown DSH
 * event name or a bad config row must never make plugin activation throw.
 * Every route/event registration lives inside `ctx.effect(...)` and returns a
 * cleanup function.
 */

import { GM } from '../../shared/src/errors.js';
import { createHost } from './host.js';

export const inject = ['connection'];

const LOG_PREFIX = '[game-market/host]';

function createLogger(ctx) {
  const logger = ctx && typeof ctx === 'object' ? ctx.logger : null;
  const write = (level) => (...parts) => {
    const sink = logger && typeof logger[level] === 'function' ? logger[level] : console[level];
    if (typeof sink === 'function') {
      try {
        sink.call(logger || console, ...parts);
      } catch (_error) {
        // Diagnostics must never break activation.
      }
    }
  };
  return {
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    debug: write('debug'),
  };
}

function settleWithin(promise, ms) {
  return Promise.race([
    promise.catch(() => undefined),
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);
}

function safeDispose(disposer, logger) {
  if (typeof disposer !== 'function') return;
  try {
    const result = disposer();
    if (result && typeof result.then === 'function') {
      result.catch((error) => logger.warn(LOG_PREFIX, 'cleanup-failed', `code=${error?.code || 'E_UNKNOWN'}`));
    }
  } catch (error) {
    logger.warn(LOG_PREFIX, 'cleanup-failed', `code=${error?.code || 'E_UNKNOWN'}`);
  }
}

/**
 * The DSH web page origin, read from the host `webServer` service.
 *
 * V1.5 needs this exact value for the `frame-ancestors` of the resource-origin
 * wrapper and of an `asset-zip-v2` entry document (docs/V1.5-CONTRACTS.md §7.5,
 * §7.5.2). Without it we would have to fall back to the configured loopback
 * allowlist, which admits *any* loopback origin instead of just the app page.
 *
 * Deliberately defensive: the service may not be reachable from the plugin's
 * fiber, or may not have bound a port yet, in which case `getOrigin()` throws.
 * A missing origin is not fatal — the resource service then falls back to the
 * configured `security.frameAncestors` allowlist.
 *
 * @returns {string|null} e.g. `http://127.0.0.1:54663`
 */
/**
 * Read an optional service without declaring it in `inject` (see
 * `resolveDshWebOrigin` below for why activation must not depend on it).
 *
 * @returns {object|null}
 */
function readOptionalService(ctx, name) {
  try {
    if (ctx && typeof ctx.reflect === 'object' && typeof ctx.reflect.get === 'function') {
      const reflected = ctx.reflect.get(name, false);
      if (reflected !== undefined && reflected !== null) return reflected;
    }
  } catch (_error) {
    // Fall through to `ctx.get` below.
  }
  try {
    if (ctx && typeof ctx.get === 'function') {
      const service = ctx.get(name);
      return service === undefined ? null : service;
    }
  } catch (_error) {
    // A missing optional service is never fatal.
  }
  return null;
}

function resolveDshWebOrigin(ctx, logger) {
  try {
    // `ctx.reflect.get(name, false)` reads a service WITHOUT declaring it in
    // `inject`: the plugin must keep activating on hosts that serve no web UI,
    // so `webServer` stays optional rather than a hard dependency.
    const webServer = readOptionalService(ctx, 'webServer');
    if (!webServer || typeof webServer.getOrigin !== 'function') return null;
    const origin = webServer.getOrigin();
    if (typeof origin !== 'string' || origin.length === 0) return null;
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch (error) {
    logger.warn(LOG_PREFIX, 'dsh-web-origin-unavailable', `code=${error?.code || 'E_UNKNOWN'}`);
    return null;
  }
}

function registerHttpRoutes(ctx, host, logger) {
  ctx.effect(
    function gameMarketHttpRoutes() {
      const connection = ctx.connection;
      const register = connection && connection.fetch ? connection.fetch.register : null;
      if (typeof register !== 'function') {
        host.availability.available = false;
        logger.warn(LOG_PREFIX, 'connection-unavailable', `code=${GM.HOST_UNAVAILABLE}`);
        return () => {};
      }
      const disposers = [];
      for (const route of host.routes) {
        try {
          const disposer = register.call(connection.fetch, {
            path: route.path,
            methods: route.methods,
            requestBody: 'buffered',
            fetch: (request) => host.router.handleRoute(route, request),
          });
          disposers.push(disposer);
        } catch (error) {
          logger.error(
            LOG_PREFIX,
            'route-registration-failed',
            `path=${route.path}`,
            `code=${error?.code || 'E_UNKNOWN'}`
          );
        }
      }
      return async function disposeGameMarketRoutes() {
        const pending = [];
        for (const disposer of disposers.splice(0).reverse()) {
          if (typeof disposer !== 'function') continue;
          try {
            const result = disposer();
            if (result && typeof result.then === 'function') {
              pending.push(
                result.catch((error) =>
                  logger.warn(LOG_PREFIX, 'cleanup-failed', `code=${error?.code || 'E_UNKNOWN'}`)
                )
              );
            }
          } catch (error) {
            logger.warn(LOG_PREFIX, 'cleanup-failed', `code=${error?.code || 'E_UNKNOWN'}`);
          }
        }
        await Promise.allSettled(pending);
        // Let background Registry refresh / startup maintenance settle so the
        // storage root is quiescent before the plugin reports disposed.
        try {
          if (host.registry && typeof host.registry.ready === 'function') {
            await settleWithin(host.registry.ready(), 2000);
          }
        } catch (error) {
          logger.warn(LOG_PREFIX, 'registry-dispose-failed', `code=${error?.code || 'E_UNKNOWN'}`);
        }
        try {
          if (host.maintenance && typeof host.maintenance.ready === 'function') {
            await settleWithin(host.maintenance.ready(), 2000);
          }
        } catch (error) {
          logger.warn(LOG_PREFIX, 'maintenance-dispose-failed', `code=${error?.code || 'E_UNKNOWN'}`);
        }
        try {
          await host.storage.flush();
        } catch (error) {
          logger.warn(LOG_PREFIX, 'storage-flush-failed', `code=${error?.code || 'E_UNKNOWN'}`);
        }
      };
    },
    'dsh-game-market: http routes'
  );
}

function registerAgentSessionEvents(ctx, host, logger) {
  ctx.effect(
    function gameMarketAgentSessionEvents() {
      if (typeof ctx.on !== 'function') return () => {};
      let disposer;
      try {
        disposer = ctx.on('session/event', function onGameMarketSessionEvent(session, event) {
          try {
            host.services.agent.ingestSessionEvent(session, event);
          } catch (_error) {
            // Mapping is defensive; never let it break the session append.
          }
        });
      } catch (error) {
        logger.warn(
          LOG_PREFIX,
          'session-event-registration-failed',
          `code=${error?.code || 'E_UNKNOWN'}`
        );
        return () => {};
      }
      return () => safeDispose(disposer, logger);
    },
    'dsh-game-market: session events'
  );
}

function registerAgentEvents(ctx, host, logger) {
  for (const eventName of host.services.agent.eventNames) {
    ctx.effect(
      function gameMarketAgentEvent() {
        if (typeof ctx.on !== 'function') return () => {};
        let disposer;
        try {
          disposer = ctx.on(eventName, function onGameMarketAgentEvent(payload, next) {
            try {
              host.services.agent.ingest(eventName, payload);
            } catch (_error) {
              // ingest() is defensive; never let a malformed event break DSH.
            }
            // `agent/pre-step` is a waterfall: observing must not swallow it.
            if (eventName === 'agent/pre-step' && typeof next === 'function') return next();
            return undefined;
          });
        } catch (error) {
          logger.warn(
            LOG_PREFIX,
            'event-registration-failed',
            `event=${eventName}`,
            `code=${error?.code || 'E_UNKNOWN'}`
          );
          return () => {};
        }
        return () => safeDispose(disposer, logger);
      },
      `dsh-game-market: ${eventName}`
    );
  }
}

/** Cordis plugin body. */
export function apply(ctx, config) {
  const logger = createLogger(ctx);
  try {
    // V1.5: the exact DSH page origin feeds the resource-origin CSP
    // `frame-ancestors` so only the app page can frame the wrapper /
    // asset-zip-v2 entry document (contract §7.5.2).
    const dshWebOrigin = resolveDshWebOrigin(ctx, logger);
    // V1.5 platform update needs the native plugin manager (H2 adapter) and the
    // HMR capability probe; both are optional so activation never depends on
    // them. They are read here (the plugin's own context), not imported from a
    // private module. Production discovery uses the global `fetch`; the Host
    // transport seam exists only so tests/probes can inject a fixture.
    const pluginManager = readOptionalService(ctx, 'pluginManager');
    const hmrResolver = () => readOptionalService(ctx, 'hmr');
    const fetchImpl = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
    const host = createHost({
      config,
      logger,
      pluginManager,
      hmrResolver,
      http: {
        ...(dshWebOrigin === null ? {} : { dshWebOrigin }),
        ...(fetchImpl === null ? {} : { platformUpdateFetch: fetchImpl }),
      },
    });
    registerHttpRoutes(ctx, host, logger);
    registerAgentEvents(ctx, host, logger);
    registerAgentSessionEvents(ctx, host, logger);
    // V1.5: the instance resource origin is its own loopback server. It must be
    // started when the plugin activates and closed when it is disposed, so a
    // plugin reload never leaks a listening socket or a stale credential.
    ctx.effect(
      () => () => host.dispose(),
      'game-market: resource origin teardown',
    );
    host.resources.start().catch((error) => {
      // A failed resource origin must not fail plugin activation: the
      // html-v1 path keeps working and asset-zip-v2 launches fail closed with
      // GM-5038 (see docs/V1.5-CONTRACTS.md §7.1).
      logger.error(LOG_PREFIX, 'resource-origin-failed', `code=${error?.code || 'E_UNKNOWN'}`);
    });
    logger.info(LOG_PREFIX, 'applied', `hostEpoch=${host.hostEpoch}`);
  } catch (error) {
    logger.error(LOG_PREFIX, 'apply-failed', `code=${error?.code || 'E_UNKNOWN'}`);
  }
}
