/**
 * Launch + built-in entry/preview resource serving (PRD §8.4/§8.5/§8.10).
 *
 * Only the manifest-declared entry HTML is served. Response headers apply the
 * V0 CSP, `no-store`, nosniff and no-referrer rules. Errors are JSON, never an
 * empty 500.
 */

import { promises as fs } from 'node:fs';

import {
  API_BASE,
  LAUNCH_MODES,
  LIMITS,
  RUNTIME_VERSION,
  SDK_VERSION,
} from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import { GM_STORE_IO, hostError } from './errors.js';
import { queryValue } from './http.js';
import { createInstanceId, createNonce, sha256Hex } from './ids.js';
import { checkCompatibility, parseVersion } from './semver.js';
import {
  validateDshSessionId,
  validateGameId,
  validateInstanceId,
  validateNonce,
} from './validation.js';

const LAUNCH_MODES_SET = new Set(LAUNCH_MODES);

export function buildContentSecurityPolicy(origin) {
  // V0 note: the Host can see a different internal origin than the embedding
  // page (dsh.internal vs the loopback Web UI), so a single computed origin
  // blocks the iframe. The game document is untrusted static content inside a
  // sandboxed iframe, so V0 allows framing broadly; V1 narrows this with an
  // explicit configured allowlist (PRD §8.10).
  void origin;
  const frameAncestors = '*';
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    'font-src data:',
    'media-src data: blob:',
    "connect-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestors}`,
  ].join('; ');
}

export function createEntryService({ catalog, hostEpoch, logger = null, now }) {
  const instanceBindings = new Map();
  const hashCache = new Map();

  function rememberInstance(instanceId, binding) {
    instanceBindings.set(instanceId, binding);
    if (instanceBindings.size > 64) {
      const oldest = instanceBindings.keys().next().value;
      if (oldest !== undefined) instanceBindings.delete(oldest);
    }
  }

  function validateVersion(value) {
    if (typeof value !== 'string' || parseVersion(value) === null) {
      throw hostError(GM.INVALID_PARAM, 'Invalid game version');
    }
    return value;
  }

  async function launch(body) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw hostError(GM.INVALID_PARAM, 'Request body must be an object');
    }
    const gameId = validateGameId(body.gameId);
    const info = await catalog.get(gameId);
    if (body.version !== undefined && body.version !== null) {
      const version = validateVersion(body.version);
      if (version !== info.manifest.version) {
        throw hostError(GM.GAME_NOT_FOUND, 'Game version not found');
      }
    }
    const mode = body.mode === undefined || body.mode === null ? 'start' : body.mode;
    if (!LAUNCH_MODES_SET.has(mode)) {
      throw hostError(GM.INVALID_PARAM, 'Invalid launch mode');
    }
    const dshSessionId = validateDshSessionId(body.dshSessionId);
    checkCompatibility(info.manifest);
    if (!info.entryExists) {
      throw hostError(GM.ASSET_NOT_FOUND, 'Game entry file is missing');
    }
    const instanceId = createInstanceId();
    const nonce = createNonce();
    const params = new URLSearchParams({
      gameId,
      version: info.manifest.version,
      instance: instanceId,
      nonce,
    });
    rememberInstance(instanceId, {
      gameId,
      version: info.manifest.version,
      dshSessionId,
      createdAt: now().toISOString(),
    });
    return {
      instanceId,
      nonce,
      entryUrl: `${API_BASE}/entry?${params.toString()}`,
      preview: { icon: null, cover: null },
      runtimeVersion: RUNTIME_VERSION,
      sdkVersion: SDK_VERSION,
      capabilities: info.manifest.capabilities.slice(),
      limits: {
        saveBytes: LIMITS.saveTotalBytes,
        saveKeys: LIMITS.saveKeys,
        scoreMetaBytes: LIMITS.scoreMetaBytes,
      },
      viewport: { ...info.manifest.viewport },
      hostEpoch,
      mode,
    };
  }

  function hashFor(entryPath, stats, bytes) {
    const key = `${entryPath}|${stats.mtimeMs}|${stats.size}`;
    const cached = hashCache.get(key);
    if (cached) return cached;
    const digest = sha256Hex(bytes);
    hashCache.set(key, digest);
    if (hashCache.size > 32) {
      const oldest = hashCache.keys().next().value;
      if (oldest !== undefined) hashCache.delete(oldest);
    }
    return digest;
  }

  async function serveEntry(request, url) {
    const gameId = validateGameId(queryValue(url, 'gameId', { maxLength: 48 }));
    const version = validateVersion(queryValue(url, 'version', { maxLength: 64 }));
    validateInstanceId(queryValue(url, 'instance', { maxLength: 32 }));
    validateNonce(queryValue(url, 'nonce', { maxLength: 32 }));

    const info = await catalog.get(gameId);
    if (version !== info.manifest.version) {
      throw hostError(GM.GAME_NOT_FOUND, 'Game version not found');
    }
    if (!info.entryExists) {
      throw hostError(GM.ASSET_NOT_FOUND, 'Game entry file is missing');
    }

    let stats;
    try {
      stats = await fs.lstat(info.entryPath);
    } catch (_error) {
      throw hostError(GM.ASSET_NOT_FOUND, 'Game entry file is missing');
    }
    if (!stats.isFile()) throw hostError(GM.ASSET_NOT_FOUND, 'Game entry file is missing');
    if (stats.size > LIMITS.entryBytes) {
      throw hostError(GM.SAVE_TOO_LARGE, 'Game entry exceeds the size limit', {
        details: { limitBytes: LIMITS.entryBytes },
      });
    }
    let bytes;
    try {
      bytes = await fs.readFile(info.entryPath);
    } catch (error) {
      if (error && (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EPERM')) {
        throw hostError(GM.ASSET_NOT_FOUND, 'Game entry file is not readable');
      }
      throw hostError(GM_STORE_IO, 'Game entry could not be read');
    }
    const digest = hashFor(info.entryPath, stats, bytes);
    const headers = {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': buildContentSecurityPolicy(url.origin),
      'content-length': String(bytes.length),
      'x-entry-sha256': digest,
    };
    return new Response(bytes, { status: 200, headers });
  }

  async function servePreview(url) {
    const gameId = validateGameId(queryValue(url, 'gameId', { maxLength: 48 }));
    const file = queryValue(url, 'file', { maxLength: 180 });
    const preview = await catalog.getPreview(gameId, file);
    return new Response(preview.bytes, {
      status: 200,
      headers: {
        'content-type': preview.contentType,
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-length': String(preview.size),
      },
    });
  }

  return { launch, serveEntry, servePreview, instanceBindings, hashFor };
}
