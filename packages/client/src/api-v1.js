/**
 * V1 Host API client for the Market surfaces (PRD 8.5, V1-CONTRACTS 7).
 *
 * The shared V0 client only knows the V0 endpoints; install/registry routes are
 * added here without touching the frozen `packages/shared` contract. Every call
 * uses the same JSON envelope and turns failures into `GameMarketApiError`
 * carrying a single `GM-*` code.
 */
import { API_BASE, LIMITS } from '../../shared/src/constants.js';
import { GameMarketApiError, randomOperationId } from '../../shared/src/api-client.js';
import { GM } from '../../shared/src/errors.js';

export const V1_TIMEOUTS = Object.freeze({
  health: 3000,
  games: 5000,
  game: 5000,
  installed: 5000,
  install: 130000,
  'install-local': 30000,
  uninstall: 10000,
  'registry-refresh': 30000,
  scores: 3000,
});

const JSON_TIMEOUT_FALLBACK = 5000;

function stripLeadingSlash(path) {
  return path.charAt(0) === '/' ? path.slice(1) : path;
}

function buildQuery(query) {
  if (!query || typeof query !== 'object') return '';
  const params = new URLSearchParams();
  for (const key of Object.keys(query)) {
    const value = query[key];
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text.length > 0 ? '?' + text : '';
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
}

function asApiError(code, message, options) {
  return new GameMarketApiError(code, message, options || {});
}

/**
 * Read a local file as UTF-8 text. Uses `File.text()` when present and falls
 * back to `FileReader.readAsText` (the browser path in DSH).
 */
export function readFileText(file, options) {
  const opts = options && typeof options === 'object' ? options : {};
  if (!file || typeof file !== 'object') {
    return Promise.reject(new Error('No file selected'));
  }
  if (typeof file.text === 'function') {
    return Promise.resolve(file.text()).then(function asText(value) {
      return typeof value === 'string' ? value : '';
    });
  }
  const Reader = opts.FileReader || (typeof globalThis.FileReader === 'function' ? globalThis.FileReader : null);
  if (!Reader) return Promise.reject(new Error('FileReader is unavailable'));
  return new Promise(function read(resolve, reject) {
    let reader = null;
    try {
      reader = new Reader();
    } catch (error) {
      reject(error);
      return;
    }
    reader.onload = function loaded() {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.onerror = function failed() {
      reject(reader.error || new Error('Could not read the file'));
    };
    reader.onabort = function aborted() {
      reject(new Error('File read aborted'));
    };
    try {
      reader.readAsText(file);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * @param {{base?: string, fetchImpl?: Function, timeouts?: object}} [options]
 */
export function createMarketApi(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const base = stripLeadingSlash(opts.base || API_BASE);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const timeouts = Object.assign({}, V1_TIMEOUTS, opts.timeouts || {});
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');

  async function request(name, config) {
    const cfg = config && typeof config === 'object' ? config : {};
    const method = cfg.method || 'GET';
    const timeoutMs = typeof cfg.timeoutMs === 'number' ? cfg.timeoutMs : timeouts[name] || JSON_TIMEOUT_FALLBACK;
    const url = base + '/' + name + buildQuery(cfg.query);
    const json = cfg.body !== undefined && cfg.contentType !== 'text/html; charset=utf-8';
    const body = cfg.body === undefined ? undefined : json ? JSON.stringify(cfg.body) : cfg.body;
    if (json && body !== undefined && new TextEncoder().encode(body).length > LIMITS.jsonBodyBytes) {
      throw asApiError(GM.INVALID_PARAM, 'Request body is too large');
    }
    const headers = {};
    if (cfg.body !== undefined) headers['content-type'] = cfg.contentType || 'application/json';
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    let onAbort = null;
    if (controller) {
      timer = setTimeout(function abortOnTimeout() {
        try {
          controller.abort('timeout');
        } catch (_error) {
          // Older engines may ignore the reason.
        }
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      if (cfg.signal && typeof cfg.signal.addEventListener === 'function') {
        if (cfg.signal.aborted) controller.abort('cancelled');
        else {
          onAbort = function abortFromCaller() {
            controller.abort('cancelled');
          };
          cfg.signal.addEventListener('abort', onAbort);
        }
      }
    }

    try {
      const response = await fetchImpl(url, {
        method: method,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: body,
        credentials: 'same-origin',
        signal: controller ? controller.signal : undefined,
      });
      const payload = await safeJson(response);
      if (payload && payload.ok === true) return payload.data;
      if (payload && payload.ok === false && payload.error) {
        throw asApiError(payload.error.code || GM.INTERNAL, payload.error.message, {
          retryable: payload.error.retryable === true,
          status: response.status,
          details: payload.error.details,
        });
      }
      // A non-JSON body usually means this Host predates the V1 route.
      throw asApiError(GM.HOST_UNAVAILABLE, 'Unexpected response from ' + name, {
        retryable: true,
        status: response.status,
      });
    } catch (error) {
      if (error instanceof GameMarketApiError) throw error;
      const aborted = Boolean(controller && controller.signal.aborted);
      const cancelled = Boolean(aborted && cfg.signal && cfg.signal.aborted);
      const failure = asApiError(cancelled ? GM.INSTALL_FAILED : GM.HOST_UNAVAILABLE, cancelled ? 'Cancelled' : 'Cannot reach Game Market Host (' + name + ')', {
        retryable: !cancelled,
        status: 0,
      });
      failure.cancelled = cancelled;
      failure.timedOut = aborted && !cancelled;
      throw failure;
    } finally {
      if (timer !== null) clearTimeout(timer);
      if (onAbort && cfg.signal && typeof cfg.signal.removeEventListener === 'function') {
        cfg.signal.removeEventListener('abort', onAbort);
      }
    }
  }

  return {
    base: base,
    operationId: randomOperationId,
    health: function health() {
      return request('health', { timeoutMs: timeouts.health });
    },
    listGames: function listGames(filter) {
      const f = filter && typeof filter === 'object' ? filter : {};
      return request('games', {
        query: {
          q: typeof f.q === 'string' && f.q.length > 0 ? f.q.slice(0, 100) : undefined,
          category: typeof f.category === 'string' && f.category.length > 0 ? f.category : undefined,
          cursor: typeof f.cursor === 'string' ? f.cursor : undefined,
          limit: typeof f.limit === 'number' ? f.limit : undefined,
        },
        timeoutMs: timeouts.games,
      });
    },
    getGame: function getGame(gameId) {
      return request('game', { query: { id: gameId }, timeoutMs: timeouts.game });
    },
    listInstalled: function listInstalled() {
      return request('installed', { timeoutMs: timeouts.installed });
    },
    install: function install(input) {
      const body = input && typeof input === 'object' ? input : {};
      return request('install', {
        method: 'POST',
        body: {
          gameId: body.gameId,
          ...(typeof body.version === 'string' && body.version.length > 0 ? { version: body.version } : {}),
          operationId: body.operationId || randomOperationId(),
        },
        timeoutMs: timeouts.install,
        signal: body.signal,
      });
    },
    installLocal: function installLocal(input) {
      const body = input && typeof input === 'object' ? input : {};
      const textPromise =
        typeof body.text === 'string'
          ? Promise.resolve(body.text)
          : readFileText(body.file, { FileReader: body.FileReader });
      return textPromise.then(function post(text) {
        return request('install-local', {
          method: 'POST',
          query: { operationId: body.operationId || randomOperationId() },
          body: text,
          contentType: 'text/html; charset=utf-8',
          timeoutMs: timeouts['install-local'],
          signal: body.signal,
        });
      });
    },
    uninstall: function uninstall(input) {
      const body = input && typeof input === 'object' ? input : {};
      const deleteData = body.deleteData === true;
      return request('uninstall', {
        method: 'POST',
        body: {
          gameId: body.gameId,
          deleteData: deleteData,
          ...(deleteData ? { confirmDataDeletion: true } : {}),
          operationId: body.operationId || randomOperationId(),
        },
        timeoutMs: timeouts.uninstall,
        signal: body.signal,
      });
    },
    refreshRegistry: function refreshRegistry(input) {
      const body = input && typeof input === 'object' ? input : {};
      return request('registry-refresh', {
        method: 'POST',
        body: {
          force: body.force === true,
          operationId: body.operationId || randomOperationId(),
        },
        timeoutMs: timeouts['registry-refresh'],
        signal: body.signal,
      });
    },
    getScores: function getScores(gameId) {
      return request('scores', { query: { gameId: gameId }, timeoutMs: timeouts.scores });
    },
  };
}

/** Exposed for tests: the exact query string builder used by every call. */
export function buildRequestQuery(query) {
  return buildQuery(query);
}
