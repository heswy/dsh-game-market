/**
 * Client API layer for the V1.5 M3 platform-update routes
 * (docs/verification/v1.5/m3-decisions.md §2).
 *
 * The routes accept/return the standard Game Market envelope
 * (`{ok:true,data,...}` / `{ok:false,error:{code,message,retryable,details}}`).
 * This module never invents target ids, operation ids or progress values: the
 * Host is the single authority for the update state machine.
 */
import { API_BASE, LIMITS } from '../../shared/src/constants.js';
import { GameMarketApiError } from '../../shared/src/api-client.js';
import { GM } from '../../shared/src/errors.js';
import { UPDATE_ROUTES } from './constants.js';

export const UPDATE_TIMEOUTS = Object.freeze({
  inspect: 8000,
  refresh: 20000,
  begin: 20000,
  observe: 5000,
  cancel: 8000,
  coordinate: 10000,
  'client-report': 5000,
});

const FALLBACK_TIMEOUT_MS = 5000;

function stripLeadingSlash(value) {
  return value.charAt(0) === '/' ? value.slice(1) : value;
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
 * @param {{base?: string, fetchImpl?: Function, timeouts?: object}} [options]
 */
export function createUpdateApi(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const base = stripLeadingSlash(opts.base || API_BASE);
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const timeouts = Object.assign({}, UPDATE_TIMEOUTS, opts.timeouts || {});
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');

  async function request(name, config) {
    const cfg = config && typeof config === 'object' ? config : {};
    const method = cfg.method || 'GET';
    const timeoutMs = typeof cfg.timeoutMs === 'number' ? cfg.timeoutMs : timeouts[name] || FALLBACK_TIMEOUT_MS;
    const route = cfg.route || name;
    const url = base + '/' + route + buildQuery(cfg.query);
    const hasBody = cfg.body !== undefined;
    const body = hasBody ? JSON.stringify(cfg.body) : undefined;
    if (hasBody && body !== undefined && new TextEncoder().encode(body).length > LIMITS.jsonBodyBytes) {
      throw asApiError(GM.INVALID_PARAM, 'Request body is too large');
    }
    const headers = hasBody ? { 'content-type': 'application/json' } : undefined;
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
        headers: headers,
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
      // A non-envelope body / 404 usually means this Host predates the M3
      // routes; the UI hides the update entry instead of showing raw errors.
      throw asApiError(GM.UNKNOWN_METHOD, 'Unexpected response from ' + name, {
        retryable: false,
        status: response.status,
      });
    } catch (error) {
      if (error instanceof GameMarketApiError) throw error;
      const aborted = Boolean(controller && controller.signal.aborted);
      const cancelled = Boolean(aborted && cfg.signal && cfg.signal.aborted);
      const failure = asApiError(
        cancelled ? GM.INSTALL_FAILED : GM.HOST_UNAVAILABLE,
        cancelled ? 'Cancelled' : 'Cannot reach Game Market Host (' + name + ')',
        { retryable: !cancelled, status: 0 }
      );
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
    inspect: function inspect(config) {
      const cfg = config && typeof config === 'object' ? config : {};
      return request('inspect', { route: UPDATE_ROUTES.inspect, timeoutMs: timeouts.inspect, signal: cfg.signal });
    },
    refresh: function refresh(config) {
      const cfg = config && typeof config === 'object' ? config : {};
      return request('refresh', {
        route: UPDATE_ROUTES.refresh,
        method: 'POST',
        body: {},
        timeoutMs: timeouts.refresh,
        signal: cfg.signal,
      });
    },
    begin: function begin(targetId, config) {
      const cfg = config && typeof config === 'object' ? config : {};
      if (typeof targetId !== 'string' || targetId.length === 0) {
        return Promise.reject(asApiError(GM.INVALID_PARAM, 'A verified update target id is required'));
      }
      return request('begin', {
        route: UPDATE_ROUTES.begin,
        method: 'POST',
        body: { targetId: targetId },
        timeoutMs: timeouts.begin,
        signal: cfg.signal,
      });
    },
    observe: function observe(operationId, config) {
      const cfg = config && typeof config === 'object' ? config : {};
      if (typeof operationId !== 'string' || operationId.length === 0) {
        return Promise.reject(asApiError(GM.INVALID_PARAM, 'operationId is required'));
      }
      return request('observe', {
        route: UPDATE_ROUTES.observe,
        query: { operationId: operationId },
        timeoutMs: timeouts.observe,
        signal: cfg.signal,
      });
    },
    cancel: function cancel(operationId, config) {
      const cfg = config && typeof config === 'object' ? config : {};
      if (typeof operationId !== 'string' || operationId.length === 0) {
        return Promise.reject(asApiError(GM.INVALID_PARAM, 'operationId is required'));
      }
      return request('cancel', {
        route: UPDATE_ROUTES.cancel,
        method: 'POST',
        body: { operationId: operationId },
        timeoutMs: timeouts.cancel,
        signal: cfg.signal,
      });
    },
    coordinate: function coordinate(payload, config) {
      const cfg = config && typeof config === 'object' ? config : {};
      const body = payload && typeof payload === 'object' ? payload : {};
      return request('coordinate', {
        route: UPDATE_ROUTES.coordinate,
        method: 'POST',
        body: body,
        timeoutMs: timeouts.coordinate,
        signal: cfg.signal,
      });
    },
    clientReport: function clientReport(payload, config) {
      const cfg = config && typeof config === 'object' ? config : {};
      const body = payload && typeof payload === 'object' ? payload : {};
      return request('client-report', {
        route: UPDATE_ROUTES.clientReport,
        method: 'POST',
        body: body,
        timeoutMs: timeouts['client-report'],
        signal: cfg.signal,
      });
    },
  };
}

/** Exposed for tests: the exact query string builder used by every call. */
export function buildUpdateQuery(query) {
  return buildQuery(query);
}
