/**
 * Exact-path Fetch router for the Host API.
 *
 * `plugin.js` registers one `connection.fetch` route per path and forwards to
 * `handleRoute`; tests can call route handlers directly with a `Request`.
 */

import { GM } from '../../shared/src/errors.js';
import { hostError } from './errors.js';
import { JSON_HEADERS, errorResponse, readJsonBody } from './http.js';
import { createRequestId } from './ids.js';

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST']);

function pathnameOf(request) {
  try {
    return new URL(request.url).pathname;
  } catch (_error) {
    return null;
  }
}

function finalise(response, method, requestId) {
  const headers = new Headers(response.headers);
  if (!headers.has('x-request-id')) headers.set('x-request-id', requestId);
  return new Response(method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createRouter({ routes, logger = null, now = () => new Date() }) {
  const byPath = new Map();
  for (const route of routes) {
    if (byPath.has(route.path)) throw new Error(`duplicate route path: ${route.path}`);
    byPath.set(route.path, route);
  }

  async function handleRoute(route, request) {
    const requestId = createRequestId();
    const serverTime = now().toISOString();
    const method = String(request.method || 'GET').toUpperCase();
    try {
      if (!route) throw hostError(GM.GAME_NOT_FOUND, 'Route not found');
      if (!ALLOWED_METHODS.has(method)) {
        throw hostError(GM.UNKNOWN_METHOD, 'Method not allowed', { details: { method } });
      }
      if (!route.methods.includes(method)) {
        throw hostError(GM.UNKNOWN_METHOD, 'Method not allowed', {
          details: { allowed: route.methods.slice() },
        });
      }
      const url = new URL(request.url);
      let body = null;
      if (method === 'POST') body = await readJsonBody(request);
      const result = await route.handler({
        request,
        url,
        method,
        body,
        requestId,
        serverTime,
      });
      if (result instanceof Response) return finalise(result, method, requestId);
      const headers = { ...JSON_HEADERS };
      if (typeof route.headers === 'function') Object.assign(headers, route.headers(result) || {});
      const response = new Response(
        JSON.stringify({ ok: true, data: result, requestId, serverTime }),
        { status: 200, headers }
      );
      return finalise(response, method, requestId);
    } catch (error) {
      const response = errorResponse(error, { requestId, serverTime, method });
      if (response.status >= 500 && logger && typeof logger.error === 'function') {
        const code = error && typeof error.code === 'string' ? error.code : GM.INTERNAL;
        logger.error('[game-market/host] request-failed', `method=${method}`, `code=${code}`);
      }
      return response;
    }
  }

  /** Dispatch by exact pathname (unknown paths behave like the host's 404). */
  async function handle(request) {
    const path = pathnameOf(request);
    return handleRoute(path === null ? null : byPath.get(path) || null, request);
  }

  return { handle, handleRoute, byPath };
}
