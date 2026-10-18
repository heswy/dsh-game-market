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
    const host = createHost({ config, logger });
    registerHttpRoutes(ctx, host, logger);
    registerAgentEvents(ctx, host, logger);
  registerAgentSessionEvents(ctx, host, logger);
    logger.info(LOG_PREFIX, 'applied', `hostEpoch=${host.hostEpoch}`);
  } catch (error) {
    logger.error(LOG_PREFIX, 'apply-failed', `code=${error?.code || 'E_UNKNOWN'}`);
  }
}
