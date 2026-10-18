/**
 * Bounded HTTP downloads for the Registry client and installer (PRD §8.7.2,
 * §8.8.3, §8.10, V1-CONTRACTS §5.2 U-08/U-09).
 *
 * Only Node built-ins (`fetch`, `node:crypto`, `node:dns`, `node:fs`) are used.
 * Every download has an explicit byte ceiling, connect/idle/total timeouts and
 * a redirect budget; each hop re-checks scheme/credentials/host so an
 * `https:` URL can never downgrade to `http:` or pivot to an unexpected host.
 */

import { createHash } from 'node:crypto';
import { lookup as defaultLookup } from 'node:dns/promises';
import { promises as fs } from 'node:fs';
import { isIP } from 'node:net';

import { GM } from '../../shared/src/errors.js';
import { hostError } from './errors.js';

export const REDIRECTS_MAX = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Codes used when a caller does not provide a more specific mapping. */
export const DEFAULT_ERROR_CODES = Object.freeze({
  rejected: GM.INSTALL_URL_REJECTED,
  fetch: GM.INSTALL_DOWNLOAD_FAILED,
  timeout: GM.INSTALL_DOWNLOAD_TIMEOUT,
  tooLarge: GM.PACKAGE_TOO_LARGE,
});

function codesFor(options) {
  return { ...DEFAULT_ERROR_CODES, ...(options.errorCodes || {}) };
}

function rejectedError(options, message) {
  const codes = codesFor(options);
  return hostError(codes.rejected, message || 'Package URL is not allowed', { retryable: false });
}

function fetchError(options, message, { status = null, retryable = true } = {}) {
  const codes = codesFor(options);
  const details = status === null ? undefined : { status };
  return hostError(codes.fetch, message || 'Download failed', { retryable, details });
}

function timeoutError(options, reason) {
  const codes = codesFor(options);
  return hostError(codes.timeout, 'Download timed out', {
    retryable: true,
    details: { reason },
  });
}

function tooLargeError(options, limitBytes) {
  const codes = codesFor(options);
  return hostError(codes.tooLarge, 'Download exceeds the size limit', {
    retryable: false,
    details: { limitBytes },
  });
}

export function isLoopbackHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost');
}

export function isLoopbackAddress(address) {
  const value = String(address || '').toLowerCase();
  if (value === '::1') return true;
  if (value.startsWith('::ffff:')) return isLoopbackAddress(value.slice(7));
  return /^127\./.test(value);
}

/** True for loopback, private, link-local, CGNAT, multicast and reserved IPs. */
export function isNonPublicAddress(address) {
  const value = String(address || '');
  if (isIP(value) === 4) {
    const parts = value.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0) return true;
    if (a >= 224) return true;
    return false;
  }
  if (isIP(value) === 6) {
    const lower = value.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (value.startsWith('::ffff:')) return isNonPublicAddress(value.slice(7));
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true;
    }
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    return false;
  }
  return true;
}

/**
 * Reject loopback/private/link-local destinations (U-09). `devMode` only
 * relaxes loopback for local development.
 */
export async function assertPublicDestination(hostname, options = {}) {
  if (isLoopbackHostname(hostname) || isLoopbackAddress(hostname)) {
    if (options.devMode === true) return;
    throw rejectedError(options, 'Loopback destinations are not allowed');
  }
  if (isIP(hostname)) {
    if (isNonPublicAddress(hostname) && options.devMode !== true) {
      throw rejectedError(options, 'Private network destinations are not allowed');
    }
    return;
  }
  let records;
  try {
    records = await (options.resolveHost || defaultLookup)(hostname, { all: true, verbatim: true });
  } catch (_error) {
    throw fetchError(options, 'Could not resolve download host');
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw fetchError(options, 'Could not resolve download host');
  }
  for (const record of records) {
    const address = record && record.address;
    if (isLoopbackAddress(address) && options.devMode === true) continue;
    if (isNonPublicAddress(address)) {
      throw rejectedError(options, 'Private network destinations are not allowed');
    }
  }
}

function scheduleTimeout(state, delayMs, reason) {
  const timer = setTimeout(() => {
    if (state.finished) return;
    state.reason = state.reason || reason;
    state.controller.abort();
  }, delayMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

function touch(state) {
  if (state.finished) return;
  state.lastDataAt = Date.now();
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = scheduleTimeout(state, state.idleMs, 'idle');
}

function finish(state) {
  state.finished = true;
  if (state.connectTimer) clearTimeout(state.connectTimer);
  if (state.totalTimer) clearTimeout(state.totalTimer);
  if (state.idleTimer) clearTimeout(state.idleTimer);
}

function validateHop(url, options) {
  if (url.protocol !== 'https:' && !(options.allowHttp === true && url.protocol === 'http:')) {
    throw rejectedError(options, 'Downloads must use https');
  }
  if (url.username || url.password) {
    throw rejectedError(options, 'Download URL must not contain credentials');
  }
  if (url.toString().length > 1000) {
    throw rejectedError(options, 'Download URL is too long');
  }
  if (typeof options.validateHop === 'function') options.validateHop(url);
}

async function openResponse(startUrl, options) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw fetchError(options, 'No fetch implementation is available');
  }
  const controller = new AbortController();
  const state = {
    controller,
    reason: null,
    finished: false,
    idleMs: options.idleMs,
    idleTimer: null,
    lastDataAt: Date.now(),
  };
  state.totalTimer = scheduleTimeout(state, options.totalMs, 'total');

  let current;
  try {
    current = new URL(String(startUrl));
  } catch (_error) {
    finish(state);
    throw rejectedError(options, 'Download URL is invalid');
  }

  try {
    for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
      validateHop(current, options);
      await assertPublicDestination(current.hostname, options);
      state.connectTimer = scheduleTimeout(state, options.connectMs, 'connect');
      let response;
      try {
        response = await fetchImpl(current.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: { ...(options.headers || {}) },
        });
      } catch (error) {
        if (state.reason) throw timeoutError(options, state.reason);
        throw fetchError(options, 'Download request failed');
      } finally {
        if (state.connectTimer) clearTimeout(state.connectTimer);
        state.connectTimer = null;
      }
      if (!response || typeof response.status !== 'number') {
        throw fetchError(options, 'Download response was invalid');
      }
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw fetchError(options, 'Redirect response is missing a location');
        if (hop >= options.maxRedirects) {
          throw rejectedError(options, 'Too many redirects');
        }
        let next;
        try {
          next = new URL(location, current);
        } catch (_error) {
          throw rejectedError(options, 'Redirect target is invalid');
        }
        if (current.protocol === 'https:' && next.protocol !== 'https:') {
          throw rejectedError(options, 'Redirect must not downgrade to http');
        }
        try {
          await response.body?.cancel();
        } catch (_error) {
          // The redirect body is irrelevant.
        }
        current = next;
        continue;
      }
      return { response, url: current, state };
    }
    throw rejectedError(options, 'Too many redirects');
  } catch (error) {
    if (state.reason) throw timeoutError(options, state.reason);
    finish(state);
    if (error && typeof error.code === 'string' && error.name === 'HostError') throw error;
    if (error && error.name === 'AbortError') throw timeoutError(options, state.reason || 'total');
    throw fetchError(options, 'Download failed');
  }
}

async function readBody(response, state, options) {
  const declared = response.headers.get('content-length');
  if (declared !== null && declared !== '') {
    const value = Number(declared);
    if (Number.isFinite(value) && value > options.maxBytes) {
      finish(state);
      state.controller.abort();
      throw tooLargeError(options, options.maxBytes);
    }
  }
  const hash = createHash('sha256');
  const chunks = [];
  let bytes = 0;
  if (!response.body) {
    finish(state);
    return { bytes: new Uint8Array(0), sha256: hash.digest('hex'), length: 0 };
  }
  const reader = response.body.getReader();
  touch(state);
  try {
    for (;;) {
      let result;
      try {
        result = await reader.read();
      } catch (error) {
        if (state.reason) throw timeoutError(options, state.reason);
        throw fetchError(options, 'Download body could not be read');
      }
      if (result.done) break;
      const chunk = result.value;
      if (!chunk || chunk.length === 0) continue;
      bytes += chunk.length;
      if (bytes > options.maxBytes) {
        state.controller.abort();
        try {
          await reader.cancel();
        } catch (_error) {
          // Already aborted.
        }
        throw tooLargeError(options, options.maxBytes);
      }
      hash.update(chunk);
      chunks.push(chunk);
      touch(state);
    }
  } finally {
    finish(state);
  }
  const body = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
  return { bytes: body, sha256: hash.digest('hex'), length: bytes };
}

async function drainError(response) {
  try {
    await response.body?.cancel();
  } catch (_error) {
    // Ignore.
  }
}

async function writeBodyToFile(response, state, destination, options) {
  const hash = createHash('sha256');
  let bytes = 0;
  let handle = null;
  const declared = response.headers.get('content-length');
  if (declared !== null && declared !== '') {
    const value = Number(declared);
    if (Number.isFinite(value) && value > options.maxBytes) {
      finish(state);
      state.controller.abort();
      throw tooLargeError(options, options.maxBytes);
    }
  }
  try {
    handle = await fs.open(destination, 'wx', 0o644);
    if (!response.body) {
      await handle.sync();
      return { bytes: 0, sha256: hash.digest('hex') };
    }
    const reader = response.body.getReader();
    touch(state);
    try {
      for (;;) {
        let result;
        try {
          result = await reader.read();
        } catch (error) {
          if (state.reason) throw timeoutError(options, state.reason);
          throw fetchError(options, 'Download body could not be read');
        }
        if (result.done) break;
        const chunk = result.value;
        if (!chunk || chunk.length === 0) continue;
        bytes += chunk.length;
        if (bytes > options.maxBytes) {
          state.controller.abort();
          try {
            await reader.cancel();
          } catch (_error) {
            // Already aborted.
          }
          throw tooLargeError(options, options.maxBytes);
        }
        hash.update(chunk);
        await handle.write(chunk);
        touch(state);
      }
    } finally {
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      handle = null;
    }
    return { bytes, sha256: hash.digest('hex') };
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await fs.rm(destination, { force: true }).catch(() => undefined);
    if (error && error.name === 'HostError') throw error;
    if (state.reason) throw timeoutError(options, state.reason);
    if (error && error.name === 'AbortError') throw timeoutError(options, state.reason || 'total');
    throw fetchError(options, 'Download could not be written');
  } finally {
    finish(state);
  }
}

function normaliseOptions(options = {}) {
  return {
    fetchImpl: typeof options.fetchImpl === 'function' ? options.fetchImpl : null,
    sleep: typeof options.sleep === 'function' ? options.sleep : (ms) => new Promise((r) => setTimeout(r, ms)),
    resolveHost: typeof options.resolveHost === 'function' ? options.resolveHost : null,
    devMode: options.devMode === true,
    allowHttp: options.allowHttp === true,
    validateHop: options.validateHop,
    headers: options.headers || {},
    maxBytes: Number.isInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : Infinity,
    maxRedirects: Number.isInteger(options.maxRedirects) ? options.maxRedirects : REDIRECTS_MAX,
    connectMs: Number.isFinite(options.connectMs) ? options.connectMs : 10000,
    idleMs: Number.isFinite(options.idleMs) ? options.idleMs : 20000,
    totalMs: Number.isFinite(options.totalMs) ? options.totalMs : 120000,
    retries: Number.isInteger(options.retries) && options.retries >= 0 ? options.retries : 0,
    retryDelaysMs: Array.isArray(options.retryDelaysMs) ? options.retryDelaysMs.slice() : [1000, 3000],
    errorCodes: options.errorCodes || null,
  };
}

function shouldRetry(error) {
  return Boolean(error && error.retryable === true);
}

/**
 * Buffer a bounded download. Returns `{status, headers, url, bytes, sha256}`
 * where `bytes` is `null` when the caller must handle the status itself (304).
 * Non-2xx final statuses throw the configured download error.
 */
export async function fetchBytes(url, rawOptions = {}) {
  const options = normaliseOptions(rawOptions);
  let attempt = 0;
  for (;;) {
    try {
      const { response, url: finalUrl, state } = await openResponse(url, options);
      let result = null;
      if (response.status === 304) {
        finish(state);
        await drainError(response);
        result = { status: 304, headers: response.headers, url: finalUrl.toString(), bytes: null, sha256: null };
      } else if (response.status >= 200 && response.status < 300) {
        const body = await readBody(response, state, options);
        result = {
          status: response.status,
          headers: response.headers,
          url: finalUrl.toString(),
          bytes: body.bytes,
          sha256: body.sha256,
        };
      } else {
        finish(state);
        await drainError(response);
        throw fetchError(options, 'Download returned an HTTP error', {
          status: response.status,
          retryable: response.status >= 500 || response.status === 429,
        });
      }
      return result;
    } catch (error) {
      if (attempt >= options.retries || !shouldRetry(error)) throw error;
      const delay = options.retryDelaysMs[Math.min(attempt, options.retryDelaysMs.length - 1)] || 0;
      attempt += 1;
      if (delay > 0) await options.sleep(delay);
    }
  }
}

/**
 * Stream a bounded download into `destination` while hashing it.
 * Returns `{status, headers, url, bytes, sha256}` for a 2xx response.
 */
export async function downloadToFile(url, destination, rawOptions = {}) {
  const options = normaliseOptions(rawOptions);
  let attempt = 0;
  for (;;) {
    try {
      const { response, url: finalUrl, state } = await openResponse(url, options);
      if (response.status < 200 || response.status >= 300) {
        finish(state);
        await drainError(response);
        throw fetchError(options, 'Download returned an HTTP error', {
          status: response.status,
          retryable: response.status >= 500 || response.status === 429,
        });
      }
      const body = await writeBodyToFile(response, state, destination, options);
      return {
        status: response.status,
        headers: response.headers,
        url: finalUrl.toString(),
        bytes: body.bytes,
        sha256: body.sha256,
      };
    } catch (error) {
      if (attempt >= options.retries || !shouldRetry(error)) throw error;
      const delay = options.retryDelaysMs[Math.min(attempt, options.retryDelaysMs.length - 1)] || 0;
      attempt += 1;
      if (delay > 0) await options.sleep(delay);
    }
  }
}
