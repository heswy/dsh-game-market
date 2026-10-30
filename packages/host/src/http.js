/**
 * Small HTTP helpers shared by the router and route handlers.
 *
 * The Host API only produces the envelope defined in contracts.js. Resource
 * routes (`/entry`, `/preview`) may return raw `Response` objects instead.
 */

import { LIMITS } from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import { hostError, statusForGm, toGameError } from './errors.js';
import { isPlainObject, validateStoredValue } from './validation.js';

export const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
});

/** Read a required/optional single query parameter. */
export function queryValue(url, name, { required = true, maxLength = 256 } = {}) {
  const values = url.searchParams.getAll(name);
  if (values.length === 0) {
    if (required) throw hostError(GM.INVALID_PARAM, `Missing ${name}`);
    return null;
  }
  if (values.length > 1) throw hostError(GM.INVALID_PARAM, `Duplicate ${name}`);
  const value = values[0];
  if (value.length > maxLength) throw hostError(GM.INVALID_PARAM, `${name} is too long`);
  return value;
}

export function queryInteger(url, name, { required = false, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = queryValue(url, name, { required, maxLength: 20 });
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) throw hostError(GM.INVALID_PARAM, `Invalid ${name}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw hostError(GM.INVALID_PARAM, `Invalid ${name}`);
  }
  return value;
}

/** Parse a buffered JSON request body (PRD §8.5). */
export async function readJsonBody(request, { limitBytes = LIMITS.jsonBodyBytes } = {}) {
  const contentType = request.headers.get('content-type') || '';
  const mediaType = contentType.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    throw hostError(GM.UNSUPPORTED_MEDIA_TYPE, 'Expected application/json');
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && declaredLength !== '') {
    const declared = Number(declaredLength);
    if (Number.isFinite(declared) && declared > limitBytes) {
      throw hostError(GM.SAVE_TOO_LARGE, 'Request body exceeds the size limit', {
        details: { limitBytes },
      });
    }
  }
  let raw;
  try {
    raw = await request.text();
  } catch (_error) {
    throw hostError(GM.INVALID_JSON, 'Request body could not be read');
  }
  if (Buffer.byteLength(raw, 'utf8') > limitBytes) {
    throw hostError(GM.SAVE_TOO_LARGE, 'Request body exceeds the size limit', {
      details: { limitBytes },
    });
  }
  if (raw.trim().length === 0) {
    throw hostError(GM.INVALID_JSON, 'Request body must be valid JSON');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_error) {
    throw hostError(GM.INVALID_JSON, 'Request body must be valid JSON');
  }
  if (!isPlainObject(parsed)) {
    throw hostError(GM.INVALID_PARAM, 'Request body must be a JSON object');
  }
  // Reject prototype-pollution keys anywhere in the body before handlers run.
  return validateStoredValue(parsed);
}

/** Build a success envelope as a raw Response. */
export function jsonResponse(data, { requestId, serverTime, headers = {}, status = 200 } = {}) {
  const payload = { ok: true, data, requestId, serverTime };
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

/** Build an error envelope + HTTP status for a thrown error. */
export function errorResponse(error, { requestId, serverTime, method = 'GET' } = {}) {
  const publicError = toGameError(error);
  const status = statusForGm(publicError.code);
  const payload = { ok: false, error: publicError, requestId, serverTime };
  const headers = { ...JSON_HEADERS, 'x-request-id': requestId };
  if (status === 429 || status === 503) headers['retry-after'] = '1';
  return new Response(method === 'HEAD' ? null : JSON.stringify(payload), {
    status,
    headers,
  });
}
