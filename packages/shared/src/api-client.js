/**
 * Host API client used by the Client and Runtime.
 *
 * - Same-origin relative base by default (`api/game-market`, matching the
 *   verified DSH pattern `fetch('api/...')`).
 * - Injected `fetchImpl` keeps it testable in Node.
 * - Throws `GameMarketApiError` on `{ ok:false }` responses or transport errors.
 *
 * Endpoint shapes live in ./contracts.js.
 */

import { API_BASE, LIMITS } from './constants.js';
import { GM } from './errors.js';

export class GameMarketApiError extends Error {
  /**
   * @param {string} code GM code
   * @param {string} message
   * @param {{retryable?: boolean, status?: number, details?: object}} [options]
   */
  constructor(code, message, options = {}) {
    super(message || code);
    this.name = 'GameMarketApiError';
    this.code = code;
    this.retryable = options.retryable === true;
    this.status = options.status || 0;
    this.details = options.details;
  }
}

const DEFAULT_TIMEOUTS = Object.freeze({
  health: 3000,
  games: 5000,
  game: 3000,
  installed: 3000,
  save: 6000,
  session: 5000,
  scores: 3000,
  score: 5000,
  preferences: 3000,
  'agent-state': 3000,
  'agent-ack': 2000,
  launch: 8000,
  'dev-agent-state': 2000,
});

function stripLeadingSlash(path) {
  return path.startsWith('/') ? path.slice(1) : path;
}

function createTimeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (typeof timer.unref === 'function') timer.unref();
  return controller.signal;
}

function randomOperationId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return `op_${cryptoApi.randomUUID()}`;
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {{base?: string, fetchImpl?: Function, timeoutMs?: number}} [options]
 */
export function createApiClient(options = {}) {
  const base = stripLeadingSlash(options.base || API_BASE);
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');

  async function call(name, { method = 'GET', query, body, timeoutMs, retry = method === 'GET' } = {}) {
    const ms = timeoutMs || DEFAULT_TIMEOUTS[name] || 5000;
    const url = `${base}/${name}${query ? `?${new URLSearchParams(query).toString()}` : ''}`;
    const headers = body === undefined ? undefined : { 'content-type': 'application/json' };
    const requestBody = body === undefined ? undefined : JSON.stringify(body);
    if (requestBody !== undefined && new TextEncoder().encode(requestBody).length > LIMITS.jsonBodyBytes) {
      throw new GameMarketApiError(GM.INVALID_PARAM, 'Request body is too large');
    }

    let lastError = null;
    for (let attempt = 0; attempt < (retry ? 3 : 1); attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          method,
          headers,
          credentials: 'same-origin',
          body: requestBody,
          signal: createTimeoutSignal(ms),
        });
        const payload = await safeJson(response);
        if (payload && payload.ok === true) return payload.data;
        if (payload && payload.ok === false && payload.error) {
          const error = new GameMarketApiError(payload.error.code || GM.INTERNAL, payload.error.message, {
            retryable: payload.error.retryable,
            status: response.status,
            details: payload.error.details,
          });
          if (retry && (response.status === 429 || response.status === 503)) {
            lastError = error;
            await sleep(200 * 2 ** attempt);
            continue;
          }
          throw error;
        }
        throw new GameMarketApiError(GM.INTERNAL, `Unexpected response from ${name}`, {
          retryable: false,
          status: response.status,
        });
      } catch (error) {
        if (error instanceof GameMarketApiError) {
          if (!(retry && error.retryable && attempt < 2)) throw error;
          lastError = error;
        } else {
          lastError = new GameMarketApiError(GM.HOST_UNAVAILABLE, `Cannot reach Game Market Host (${name})`, {
            retryable: true,
            status: 0,
          });
          if (!retry || attempt >= 2) throw lastError;
        }
        await sleep(200 * 2 ** attempt);
      }
    }
    throw lastError || new GameMarketApiError(GM.HOST_UNAVAILABLE, 'Cannot reach Game Market Host');
  }

  return Object.freeze({
    base,
    requestId: randomOperationId,
    health: () => call('health', { timeoutMs: 3000 }),
    listGames: () => call('games'),
    listInstalled: () => call('installed'),
    getGame: (gameId) => call('game', { query: { id: gameId } }),
    getSave: (gameId, { includeData = false } = {}) =>
      call('save', { query: includeData ? { gameId, include: 'data' } : { gameId } }),
    setSave: ({ gameId, key, data, expectedRevision, operationId }) =>
      call('save', {
        method: 'POST',
        body: {
          gameId,
          key,
          data,
          ...(expectedRevision === undefined ? {} : { expectedRevision }),
          operationId: operationId || randomOperationId(),
        },
        timeoutMs: 6000,
      }),
    startSession: ({ gameId, dshSessionId = null, operationId }) =>
      call('session', {
        method: 'POST',
        body: { gameId, action: 'start', dshSessionId, operationId: operationId || randomOperationId() },
      }),
    endSession: ({ gameId, playSessionId, outcome, score = null, operationId }) =>
      call('session', {
        method: 'POST',
        body: {
          gameId,
          action: 'end',
          playSessionId,
          outcome,
          score,
          operationId: operationId || randomOperationId(),
        },
      }),
    getScores: (gameId) => call('scores', { query: { gameId } }),
    submitScore: ({ gameId, score, meta = null, playSessionId = null, operationId }) =>
      call('score', {
        method: 'POST',
        body: {
          gameId,
          score,
          meta,
          playSessionId,
          operationId: operationId || randomOperationId(),
        },
      }),
    getPreferences: () => call('preferences'),
    setPreferences: (patch) => call('preferences', { method: 'POST', body: patch }),
    /**
     * @param {string} sessionId
     * @param {{etag?: string}} [opts]
     * @returns {Promise<{snapshot: object, etag: string|null, notModified: boolean}>}
     */
    getAgentState: async (sessionId, { etag } = {}) => {
      const url = `${base}/agent-state?${new URLSearchParams({ sessionId }).toString()}`;
      const headers = etag ? { 'if-none-match': etag } : undefined;
      const response = await fetchImpl(url, {
        method: 'GET',
        headers,
        credentials: 'same-origin',
        signal: createTimeoutSignal(DEFAULT_TIMEOUTS['agent-state']),
      });
      if (response.status === 304) return { snapshot: null, etag, notModified: true };
      const payload = await safeJson(response);
      if (payload && payload.ok === true) {
        return { snapshot: payload.data, etag: response.headers?.get?.('etag') || null, notModified: false };
      }
      const error = payload?.error || { code: GM.HOST_UNAVAILABLE, message: 'Agent state unavailable' };
      throw new GameMarketApiError(error.code || GM.HOST_UNAVAILABLE, error.message, {
        retryable: error.retryable,
        status: response.status,
      });
    },
    ackAgent: ({ sessionId, seq }) => call('agent-ack', { method: 'POST', body: { sessionId, seq } }),
    launch: ({ gameId, version, dshSessionId = null, mode = 'start' }) =>
      call('launch', {
        method: 'POST',
        body: {
          gameId,
          ...(version ? { version } : {}),
          dshSessionId,
          mode,
        },
        retry: false,
      }),
    /** Dev-only: requires Host config.devMode. */
    devSetAgentState: ({ sessionId, state, label, labelKey, turnId }) =>
      call('dev/agent-state', {
        method: 'POST',
        body: { sessionId, state, label, labelKey, turnId },
        retry: false,
      }),
    operationId: randomOperationId,
  });
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { randomOperationId };
