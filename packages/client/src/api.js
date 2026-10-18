/**
 * Same-origin API client for the Host routes.
 *
 * The repository's shared `api-client.js` cannot be used in the browser bundle:
 * its final `export { randomOperationId };` form is outside the restricted
 * bundler subset. This module keeps the same endpoint shapes, envelope checks and
 * error codes from `packages/shared` without importing that file.
 */
import { API_BASE, LIMITS } from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import { reportDiagnostic } from './diagnostics.js';

const TIMEOUTS = Object.freeze({
  games: 5000,
  'agent-state': 3000,
  'agent-ack': 2000,
  launch: 8000,
});

export class ClientApiError extends Error {
  constructor(code, message, options) {
    super(message || code);
    this.name = 'ClientApiError';
    this.code = code;
    this.retryable = Boolean(options && options.retryable);
    this.status = (options && options.status) || 0;
  }
}

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  const timer = setTimeout(function abort() {
    controller.abort();
  }, ms);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return controller.signal;
}

function randomOperationId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return 'op_' + cryptoApi.randomUUID();
  return 'op_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

/**
 * @param {{base?: string, fetchImpl?: Function}} [options]
 */
export function createClientApi(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const base = String(opts.base || API_BASE).replace(/^\/+/, '');
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');

  async function call(name, config) {
    const cfg = config && typeof config === 'object' ? config : {};
    const method = cfg.method || 'GET';
    const timeoutMs = cfg.timeoutMs || TIMEOUTS[name] || 5000;
    const query = cfg.query ? '?' + new URLSearchParams(cfg.query).toString() : '';
    const url = base + '/' + name + query;
    const body = cfg.body === undefined ? undefined : JSON.stringify(cfg.body);
    if (body !== undefined) {
      const bytes = new TextEncoder().encode(body).length;
      if (bytes > LIMITS.jsonBodyBytes) throw new ClientApiError(GM.INVALID_PARAM, 'Request body is too large');
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method: method,
        headers: body === undefined ? cfg.headers : { ...(cfg.headers || {}), 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: body,
        signal: timeoutSignal(timeoutMs),
      });
    } catch (_error) {
      throw new ClientApiError(GM.HOST_UNAVAILABLE, 'Cannot reach Game Market Host', { retryable: true });
    }
    const payload = await safeJson(response);
    if (payload && payload.ok === true) return payload.data;
    if (payload && payload.ok === false && payload.error) {
      throw new ClientApiError(payload.error.code || GM.INTERNAL, payload.error.message, {
        retryable: payload.error.retryable === true,
        status: response.status,
      });
    }
    throw new ClientApiError(GM.INTERNAL, 'Unexpected response from ' + name, {
      retryable: false,
      status: response.status,
    });
  }

  return Object.freeze({
    base: base,
    listGames: function listGames() {
      return call('games', { timeoutMs: TIMEOUTS.games });
    },
    getAgentState: async function getAgentState(sessionId, stateOptions) {
      const etag = stateOptions && stateOptions.etag;
      const url = base + '/agent-state?' + new URLSearchParams({ sessionId: sessionId }).toString();
      const headers = etag ? { 'if-none-match': etag } : undefined;
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers: headers,
          credentials: 'same-origin',
          signal: timeoutSignal(TIMEOUTS['agent-state']),
        });
      } catch (_error) {
        throw new ClientApiError(GM.HOST_UNAVAILABLE, 'Agent state unavailable', { retryable: true });
      }
      if (response.status === 304) return { snapshot: null, etag: etag || null, notModified: true };
      const payload = await safeJson(response);
      if (payload && payload.ok === true) {
        return {
          snapshot: payload.data,
          etag: response.headers && typeof response.headers.get === 'function' ? response.headers.get('etag') : null,
          notModified: false,
        };
      }
      const error = payload && payload.error ? payload.error : null;
      throw new ClientApiError((error && error.code) || GM.HOST_UNAVAILABLE, error && error.message, {
        retryable: error && error.retryable,
        status: response.status,
      });
    },
    ackAgent: function ackAgent(input) {
      return call('agent-ack', {
        method: 'POST',
        body: { sessionId: input.sessionId, seq: input.seq },
        timeoutMs: TIMEOUTS['agent-ack'],
      });
    },
    launch: function launch(input) {
      return call('launch', {
        method: 'POST',
        body: {
          gameId: input.gameId,
          ...(input.version ? { version: input.version } : {}),
          dshSessionId: input.dshSessionId === undefined ? null : input.dshSessionId,
          mode: input.mode || 'start',
        },
        timeoutMs: TIMEOUTS.launch,
      });
    },
    operationId: randomOperationId,
  });
}

let client = null;

/** Inject a client in tests or replace it at runtime. */
export function configureApiClient(nextClient) {
  client = nextClient && typeof nextClient === 'object' ? nextClient : null;
  return function reset() {
    client = null;
  };
}

/** Return the shared API client, or null when fetch is unavailable. */
export function getApiClient() {
  if (client !== null) return client;
  try {
    client = createClientApi();
  } catch (error) {
    reportDiagnostic('api-unavailable', error);
    client = null;
  }
  return client;
}

/** True when a same-origin fetch client can be built. */
export function isApiAvailable() {
  return getApiClient() !== null;
}
