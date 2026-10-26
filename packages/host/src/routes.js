/**
 * Host API route table (contracts.js ROUTES).
 *
 * Every write is POST; GET handlers are read-only. Paths are exact; resources
 * are located through query/body. `/dev/agent-state` exists only in devMode.
 */

import { ROUTES } from '../../shared/src/contracts.js';
import { GM } from '../../shared/src/errors.js';
import { hostError } from './errors.js';
import { JSON_HEADERS, jsonResponse, queryInteger, queryValue } from './http.js';

function requireObjectBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw hostError(GM.INVALID_PARAM, 'Request body must be a JSON object');
  }
  return body;
}

export function createRouteTable({ services, devMode = false }) {
  const { health, platformUpdate, updates, games, saves, sessions, scores, preferences, agent, entry, install, registry } = services;

  const routeList = [
    {
      path: ROUTES.HEALTH,
      methods: ['GET', 'HEAD'],
      handler: async () => health.snapshot(),
    },
    {
      path: ROUTES.GAMES,
      methods: ['GET'],
      handler: async ({ url }) => {
        const q = queryValue(url, 'q', { required: false, maxLength: 100 });
        const category = queryValue(url, 'category', { required: false, maxLength: 32 });
        const limit = queryInteger(url, 'limit', { min: 1, max: 50 });
        const cursor = queryValue(url, 'cursor', { required: false, maxLength: 32 });
        return games.list({
          q: q === null ? null : q,
          category: category === null ? null : category,
          limit,
          cursor: cursor === null ? null : cursor,
        });
      },
    },
    {
      path: ROUTES.GAME,
      methods: ['GET'],
      handler: async ({ url }) => {
        const id = queryValue(url, 'id', { maxLength: 48 });
        return games.get(id);
      },
    },
    {
      path: ROUTES.INSTALLED,
      methods: ['GET'],
      handler: async () => games.installed(),
    },
    {
      path: ROUTES.INSTALL,
      methods: ['POST'],
      handler: async ({ body }) => install.install(requireObjectBody(body)),
    },
    {
      path: ROUTES.INSTALL_LOCAL,
      methods: ['POST'],
      rawBody: true,
      handler: async ({ request, url }) => install.installLocal(request, url),
    },
    {
      path: ROUTES.UNINSTALL,
      methods: ['POST'],
      handler: async ({ body }) => install.uninstall(requireObjectBody(body)),
    },
    {
      path: ROUTES.REGISTRY_REFRESH,
      methods: ['POST'],
      optionalBody: true,
      handler: async ({ body }) => {
        const request = body === null || body === undefined ? {} : requireObjectBody(body);
        return registry.refresh({
          manual: true,
          force: request.force === true,
          operationId: request.operationId,
        });
      },
    },
    {
      path: ROUTES.SAVE,
      methods: ['GET', 'POST'],
      handler: async ({ method, url, body }) => {
        if (method === 'POST') return saves.save(requireObjectBody(body));
        const gameId = queryValue(url, 'gameId', { maxLength: 48 });
        const include = queryValue(url, 'include', { required: false, maxLength: 16 });
        return saves.get(gameId, { includeData: include === 'data' });
      },
    },
    {
      path: ROUTES.SAVE_REMOVE,
      methods: ['POST'],
      handler: async ({ body }) => saves.remove(requireObjectBody(body)),
    },
    {
      path: ROUTES.SESSION,
      methods: ['POST'],
      handler: async ({ body }) => {
        const request = requireObjectBody(body);
        if (request.action === 'start') return sessions.start(request);
        if (request.action === 'end') return sessions.end(request);
        throw hostError(GM.INVALID_PARAM, 'Invalid session action');
      },
    },
    {
      path: ROUTES.SCORES,
      methods: ['GET'],
      handler: async ({ url }) => {
        const gameId = queryValue(url, 'gameId', { maxLength: 48 });
        return scores.get(gameId);
      },
    },
    {
      path: ROUTES.SCORE,
      methods: ['POST'],
      handler: async ({ body }) => scores.submit(requireObjectBody(body)),
    },
    {
      path: ROUTES.PREFERENCES,
      methods: ['GET', 'POST'],
      handler: async ({ method, body }) => {
        if (method === 'POST') return preferences.update(requireObjectBody(body));
        return preferences.get();
      },
    },
    {
      path: ROUTES.AGENT_STATE,
      methods: ['GET'],
      handler: async ({ request, url, requestId, serverTime }) => {
        const sessionId = queryValue(url, 'sessionId', { maxLength: 128 });
        const snapshot = agent.get(sessionId);
        const etag = agent.etag(snapshot);
        const ifNoneMatch = request.headers.get('if-none-match');
        if (ifNoneMatch) {
          const tags = ifNoneMatch.split(',').map((tag) => tag.trim());
          if (tags.includes(etag)) {
            return new Response(null, {
              status: 304,
              headers: { etag, 'cache-control': 'no-store', 'x-request-id': requestId },
            });
          }
        }
        return jsonResponse(snapshot, {
          requestId,
          serverTime,
          headers: { etag },
        });
      },
    },
    {
      path: ROUTES.AGENT_ACK,
      methods: ['POST'],
      handler: async ({ body }) => agent.ack(requireObjectBody(body)),
    },
    {
      path: ROUTES.LAUNCH,
      methods: ['POST'],
      handler: async ({ body }) => entry.launch(requireObjectBody(body)),
    },
    {
      path: ROUTES.RUNTIME_RELEASE,
      methods: ['POST'],
      handler: async ({ body }) => {
        const request = requireObjectBody(body);
        const gameId = typeof request.gameId === 'string' ? request.gameId : null;
        if (gameId === null) throw hostError(GM.INVALID_PARAM, 'gameId is required');
        if (typeof request.instanceId === 'string') {
          return { gameId, instanceId: request.instanceId, released: entry.releaseInstance(request.instanceId, gameId) };
        }
        return { gameId, released: entry.releaseGame(gameId) };
      },
    },
    {
      path: ROUTES.RUNTIME_RENEW,
      methods: ['POST'],
      handler: async ({ body }) => {
        const request = requireObjectBody(body);
        if (typeof request.instanceId !== 'string' || request.instanceId.length === 0) {
          throw hostError(GM.INVALID_PARAM, 'instanceId is required');
        }
        const renewed = entry.renewInstance(request.instanceId);
        if (!renewed) throw hostError(GM.INVALID_PARAM, 'Unknown or expired game instance');
        return renewed;
      },
    },

    // V1.5 platform update (docs/V1.5-CONTRACTS.md §9, m3-decisions §2).
    // Inspect always answers 200; failures are discovery state, never HTTP errors.
    {
      path: ROUTES.PLATFORM_UPDATE,
      methods: ['GET', 'HEAD'],
      handler: async () => platformUpdate.inspect(),
    },
    {
      path: ROUTES.PLATFORM_UPDATE_REFRESH,
      methods: ['POST'],
      optionalBody: true,
      handler: async () => {
        const result = await platformUpdate.refresh();
        return { ...(await platformUpdate.inspect()), refreshed: result.refreshed === true, throttled: result.throttled === true };
      },
    },
    {
      path: ROUTES.PLATFORM_UPDATE_BEGIN,
      methods: ['POST'],
      handler: async ({ body }) => updates.begin(requireObjectBody(body)),
    },
    {
      path: ROUTES.PLATFORM_UPDATE_OBSERVE,
      methods: ['GET'],
      handler: async ({ url }) => {
        const operationId = queryValue(url, 'operationId', { maxLength: 64 });
        return updates.observe(operationId);
      },
    },
    {
      path: ROUTES.PLATFORM_UPDATE_CANCEL,
      methods: ['POST'],
      handler: async ({ body }) => updates.cancel(requireObjectBody(body)),
    },
    {
      path: ROUTES.PLATFORM_UPDATE_COORDINATE,
      methods: ['POST'],
      handler: async ({ body }) => updates.coordinate(requireObjectBody(body)),
    },
    {
      path: ROUTES.PLATFORM_UPDATE_CLIENT_REPORT,
      methods: ['POST'],
      handler: async ({ body }) => updates.clientReport(requireObjectBody(body)),
    },
    {
      path: ROUTES.ENTRY,
      methods: ['GET', 'HEAD'],
      handler: async ({ request, url }) => entry.serveEntry(request, url),
    },
    {
      path: ROUTES.PREVIEW,
      methods: ['GET', 'HEAD'],
      handler: async ({ url }) => entry.servePreview(url),
    },
  ];

  if (devMode) {
    routeList.push({
      path: ROUTES.DEV_AGENT_STATE,
      methods: ['POST'],
      handler: async ({ body }) => agent.devSet(requireObjectBody(body)),
    });
  }

  return routeList;
}
