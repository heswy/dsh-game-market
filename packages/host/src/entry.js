/**
 * Launch + resource serving (V1-CONTRACTS §7.4, §6.4; PRD §8.5/§8.10).
 *
 * `POST /launch` resolves an installed package, built-in or dev game, verifies
 * the entry bytes (SHA-256 for registry installs, inline manifest for
 * local/dev), binds a short-lived instance/nonce pair, and only then serves the
 * HTML through `/entry`. `/preview` serves cached Registry artwork only.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  API_BASE,
  LAUNCH_MODES,
  LIMITS,
  PROTOCOL_VERSION,
  RUNTIME_VERSION,
  SDK_VERSION,
  TIMING,
} from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import { ENTRY_FILE, PACKAGES_DIR } from '../../shared/src/installation.js';
import { validatePackageHtml } from '../../shared/src/manifest.js';
import { DEFAULT_FRAME_ANCESTORS } from './config.js';
import { hostError } from './errors.js';
import { queryValue } from './http.js';
import { createInstanceId, createNonce, sha256Hex } from './ids.js';
import { isPreviewFile } from './registry.js';
import { checkCompatibility, parseVersion } from './semver.js';
import {
  validateDshSessionId,
  validateGameId,
  validateInstanceId,
  validateNonce,
} from './validation.js';

const LAUNCH_MODES_SET = new Set(LAUNCH_MODES);
const DEFAULT_VIEWPORT = Object.freeze({ width: 960, height: 540, fit: 'contain' });
const MAX_BINDINGS = 64;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

function isLoopbackHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return true;
  return /^127\./.test(host);
}

/** True when a CSP source expression already covers the given origin. */
export function cspCoversOrigin(entry, origin) {
  if (typeof entry !== 'string' || typeof origin !== 'string') return false;
  if (entry === origin) return true;
  const match = /^([a-z][a-z0-9+.-]*):\/\/(\[[^\]]+\]|[^/:]+)(?::(\*|\d+))?$/i.exec(entry);
  if (!match) return false;
  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch (_error) {
    return false;
  }
  const scheme = match[1].toLowerCase();
  if (scheme !== originUrl.protocol.slice(0, -1)) return false;
  const host = match[2].replace(/^\[|\]$/g, '').toLowerCase();
  if (host !== originUrl.hostname.toLowerCase()) return false;
  const port = match[3];
  if (port === undefined) return originUrl.port === '' || originUrl.port === defaultPortFor(scheme);
  if (port === '*') return true;
  return originUrl.port === port || (originUrl.port === '' && port === defaultPortFor(scheme));
}

function defaultPortFor(scheme) {
  if (scheme === 'http' || scheme === 'ws') return '80';
  if (scheme === 'https' || scheme === 'wss') return '443';
  return '';
}

export function buildContentSecurityPolicy(origin, options = {}) {
  const configured =
    Array.isArray(options.frameAncestors) && options.frameAncestors.length > 0
      ? options.frameAncestors
      : DEFAULT_FRAME_ANCESTORS;
  const frameAncestors = configured.slice(0, 16);
  // V1 default covers loopback wildcards; append the concrete bind origin when
  // a custom allowlist does not already cover it (V1-15: never fall back to *).
  if (typeof origin === 'string' && origin.length > 0) {
    let loopback = false;
    try {
      loopback = isLoopbackHostname(new URL(origin).hostname);
    } catch (_error) {
      loopback = false;
    }
    if (loopback && !frameAncestors.some((entry) => cspCoversOrigin(entry, origin))) {
      frameAncestors.push(origin);
    }
  }
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src data:',
    "connect-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestors.join(' ')}`,
  ].join('; ');
}

function normaliseViewport(viewport) {
  if (!viewport || typeof viewport !== 'object') return { ...DEFAULT_VIEWPORT };
  const width = Number.isInteger(viewport.width) && viewport.width >= 1 && viewport.width <= 3840
    ? viewport.width
    : DEFAULT_VIEWPORT.width;
  const height = Number.isInteger(viewport.height) && viewport.height >= 1 && viewport.height <= 3840
    ? viewport.height
    : DEFAULT_VIEWPORT.height;
  return { width, height, fit: 'contain' };
}

function validateVersion(value) {
  if (typeof value !== 'string' || parseVersion(value) === null) {
    throw hostError(GM.INVALID_PARAM, 'Invalid game version');
  }
  return value;
}

const DATA_IMAGE_RE = /^data:image\/(png|webp|jpeg);base64,([A-Za-z0-9+/=\s]+)$/;

/** Decode an inline manifest `icon` data URI for local/installed previews. */
export function decodeDataImage(value) {
  if (typeof value !== 'string') return null;
  const match = DATA_IMAGE_RE.exec(value);
  if (!match) return null;
  try {
    const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    if (bytes.length === 0 || bytes.length > LIMITS.iconBytes) return null;
    const contentType = match[1] === 'jpeg' ? 'image/jpeg' : `image/${match[1]}`;
    return { bytes, contentType };
  } catch (_error) {
    return null;
  }
}

function decodeText(bytes) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) return null;
    return text;
  } catch (_error) {
    return null;
  }
}

/**
 * @param {{
 *   catalog: object,
 *   devCatalog: object,
 *   installations: object,
 *   registry: object,
 *   storage: object,
 *   settings?: object,
 *   hostEpoch: string,
 *   logger?: object,
 *   now?: () => Date,
 *   timing?: object
 * }} options
 */
export function createEntryService({
  catalog,
  devCatalog,
  installations,
  registry,
  storage,
  settings = {},
  hostEpoch,
  logger = null,
  now = () => new Date(),
  timing = {},
}) {
  const instanceBindings = new Map();
  const frameAncestors = Array.isArray(settings?.security?.frameAncestors)
    ? settings.security.frameAncestors
    : DEFAULT_FRAME_ANCESTORS;
  const bindingTtlMs =
    Number.isFinite(timing.entryBindingTtlMs) && timing.entryBindingTtlMs > 0
      ? timing.entryBindingTtlMs
      : TIMING.entryBindingTtlMs;

  function isBuiltin(gameId) {
    return Array.isArray(catalog?.entries) && catalog.entries.some((entry) => entry.id === gameId);
  }

  function rememberInstance(instanceId, binding) {
    instanceBindings.set(instanceId, binding);
    const stamp = now().getTime();
    for (const [key, value] of instanceBindings) {
      if (value.expiresAt <= stamp) instanceBindings.delete(key);
    }
    while (instanceBindings.size > MAX_BINDINGS) {
      const oldest = instanceBindings.keys().next().value;
      if (oldest === undefined) break;
      instanceBindings.delete(oldest);
    }
  }

  async function readEntryFile(entryPath) {
    let stats;
    try {
      stats = await fs.lstat(entryPath);
    } catch (_error) {
      throw hostError(GM.ASSET_NOT_FOUND, 'Game entry file is missing', { retryable: false });
    }
    if (stats.isSymbolicLink()) {
      throw hostError(GM.STORE_PATH_ESCAPE, 'Game entry must not be a symbolic link', { retryable: false });
    }
    if (!stats.isFile()) throw hostError(GM.ASSET_NOT_FOUND, 'Game entry file is missing', { retryable: false });
    if (stats.size > LIMITS.entryBytes) {
      throw hostError(GM.PACKAGE_TOO_LARGE, 'Game entry exceeds the size limit', {
        retryable: false,
        details: { limitBytes: LIMITS.entryBytes },
      });
    }
    let bytes;
    try {
      bytes = await fs.readFile(entryPath);
    } catch (_error) {
      throw hostError(GM.ASSET_NOT_FOUND, 'Game entry file is missing', { retryable: false });
    }
    if (bytes.length > LIMITS.entryBytes) {
      throw hostError(GM.PACKAGE_TOO_LARGE, 'Game entry exceeds the size limit', {
        retryable: false,
        details: { limitBytes: LIMITS.entryBytes },
      });
    }
    return bytes;
  }

  /** Resolve a launchable target (dev > installed > builtin). */
  async function resolveLaunchable(gameId) {
    const dev = devCatalog ? await devCatalog.get(gameId) : null;
    if (dev) {
      return {
        kind: 'dev',
        gameId,
        version: dev.version,
        manifest: dev.manifest,
        entryPath: dev.entryPath,
        record: null,
        source: 'dev',
      };
    }
    const record = await installations.get(gameId);
    if (record) {
      return {
        kind: 'installed',
        gameId,
        version: record.version,
        manifest: record.manifest,
        entryPath: storage.filePath(PACKAGES_DIR, record.id, record.version, ENTRY_FILE),
        record,
        source: record.source,
      };
    }
    if (isBuiltin(gameId)) {
      const info = await catalog.load(gameId);
      if (!info) return null;
      if (!info.manifest) {
        if (info.issue === 'manifest-missing' || info.issue === 'manifest-unreadable') return null;
        throw hostError(GM.MANIFEST_INVALID, 'Game manifest is invalid', { retryable: false });
      }
      return {
        kind: 'builtin',
        gameId,
        version: info.manifest.version,
        manifest: info.manifest,
        entryPath: info.entryPath,
        entryExists: info.entryExists,
        record: null,
        source: 'builtin',
      };
    }
    return null;
  }

  async function previewLinks(gameId, version, source) {
    if (source !== 'registry') return { icon: null, cover: null };
    const [icon, cover] = await Promise.all([
      registry.previewUrl(gameId, version, 'icon').catch(() => null),
      registry.previewUrl(gameId, version, 'cover').catch(() => null),
    ]);
    return { icon, cover };
  }

  async function launch(body) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw hostError(GM.INVALID_PARAM, 'Request body must be an object');
    }
    const gameId = validateGameId(body.gameId);
    const mode = body.mode === undefined || body.mode === null ? 'start' : body.mode;
    if (!LAUNCH_MODES_SET.has(mode)) throw hostError(GM.INVALID_PARAM, 'Invalid launch mode');
    const dshSessionId = validateDshSessionId(body.dshSessionId);
    let requestedVersion = null;
    if (body.version !== undefined && body.version !== null) {
      requestedVersion = validateVersion(body.version);
    }

    const resolved = await resolveLaunchable(gameId);
    if (!resolved) throw hostError(GM.GAME_NOT_FOUND, 'Game not found', { retryable: false });
    if (resolved.kind === 'builtin' && resolved.entryExists === false) {
      throw hostError(GM.ASSET_NOT_FOUND, 'Game entry file is missing', { retryable: false });
    }
    if (requestedVersion !== null && requestedVersion !== resolved.version) {
      throw hostError(GM.GAME_NOT_FOUND, 'Game version not found', { retryable: false });
    }
    const manifest = resolved.manifest;
    if (!manifest) throw hostError(GM.INSTALL_CORRUPT, 'Installed package is incomplete', { retryable: true });
    checkCompatibility(manifest);

    const bytes = await readEntryFile(resolved.entryPath);
    const digest = sha256Hex(bytes);
    if (resolved.kind === 'installed') {
      const record = resolved.record;
      if (typeof record.sha256 === 'string') {
        if (digest !== record.sha256) {
          throw hostError(GM.ASSET_INTEGRITY, 'Game files failed integrity check', {
            retryable: true,
            details: { reason: 'sha256' },
          });
        }
      } else {
        // local/dev installs carry no recorded hash: re-parse the inline
        // manifest and require it to match the installation record.
        const text = decodeText(bytes);
        const validation = text === null ? null : validatePackageHtml(text, { packageBytes: LIMITS.entryBytes });
        if (!validation || !validation.ok || !validation.manifest) {
          throw hostError(GM.INSTALL_CORRUPT, 'Installed package is incomplete', {
            retryable: true,
            details: { reason: 'manifest' },
          });
        }
        if (validation.manifest.id !== record.id || validation.manifest.version !== record.version) {
          throw hostError(GM.INSTALL_CORRUPT, 'Installed package does not match its record', {
            retryable: true,
            details: { reason: 'manifest' },
          });
        }
      }
    }

    const instanceId = createInstanceId();
    const nonce = createNonce();
    const params = new URLSearchParams({ gameId, version: resolved.version, instance: instanceId, nonce });
    const preview = await previewLinks(gameId, resolved.version, resolved.source);
    rememberInstance(instanceId, {
      gameId,
      version: resolved.version,
      nonce,
      dshSessionId,
      source: resolved.source,
      entryPath: resolved.entryPath,
      entrySha256: digest,
      capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities.slice() : [],
      viewport: normaliseViewport(manifest.viewport),
      createdAt: now().toISOString(),
      expiresAt: now().getTime() + bindingTtlMs,
    });
    return {
      instanceId,
      nonce,
      entryUrl: `${API_BASE}/entry?${params.toString()}`,
      preview,
      runtimeVersion: RUNTIME_VERSION,
      sdkVersion: SDK_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      gameId,
      gameVersion: resolved.version,
      capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities.slice() : [],
      limits: {
        saveBytes: LIMITS.saveTotalBytes,
        saveKeys: LIMITS.saveKeys,
        scoreMetaBytes: LIMITS.scoreMetaBytes,
      },
      viewport: normaliseViewport(manifest.viewport),
      hostEpoch,
      mode,
      entrySha256: digest,
    };
  }

  /** Resolve game/version before binding checks so unknown ids stay 404s. */
  async function resolveForServe(gameId, version) {
    const dev = devCatalog ? await devCatalog.get(gameId) : null;
    if (dev) {
      if (dev.version !== version) throw hostError(GM.GAME_NOT_FOUND, 'Game version not found');
      return { kind: 'dev', entryPath: dev.entryPath, record: null };
    }
    const record = await installations.get(gameId);
    if (record) {
      if (record.version !== version) throw hostError(GM.GAME_NOT_FOUND, 'Game version not found');
      return {
        kind: 'installed',
        entryPath: storage.filePath(PACKAGES_DIR, record.id, record.version, ENTRY_FILE),
        record,
      };
    }
    if (isBuiltin(gameId)) {
      const info = await catalog.load(gameId);
      if (!info) throw hostError(GM.GAME_NOT_FOUND, 'Game not found');
      if (!info.manifest) throw hostError(GM.MANIFEST_INVALID, 'Game manifest is invalid');
      if (info.manifest.version !== version) throw hostError(GM.GAME_NOT_FOUND, 'Game version not found');
      if (!info.entryExists) throw hostError(GM.ASSET_NOT_FOUND, 'Game entry file is missing');
      return { kind: 'builtin', entryPath: info.entryPath, record: null };
    }
    throw hostError(GM.GAME_NOT_FOUND, 'Game not found');
  }

  async function serveEntry(request, url) {
    const gameId = validateGameId(queryValue(url, 'gameId', { maxLength: 48 }));
    const version = validateVersion(queryValue(url, 'version', { maxLength: 64 }));
    const instance = validateInstanceId(queryValue(url, 'instance', { maxLength: 32 }));
    const nonce = validateNonce(queryValue(url, 'nonce', { maxLength: 32 }));

    const resolved = await resolveForServe(gameId, version);

    const binding = instanceBindings.get(instance);
    if (!binding || binding.expiresAt <= now().getTime()) {
      if (binding) instanceBindings.delete(instance);
      throw hostError(GM.INVALID_PARAM, 'Unknown or expired game instance', { retryable: false });
    }
    if (binding.gameId !== gameId || binding.version !== version || binding.nonce !== nonce) {
      throw hostError(GM.INVALID_PARAM, 'Game instance binding mismatch', { retryable: false });
    }

    const bytes = await readEntryFile(resolved.entryPath);
    const digest = sha256Hex(bytes);
    if (resolved.record && typeof resolved.record.sha256 === 'string') {
      if (digest !== resolved.record.sha256) {
        throw hostError(GM.ASSET_INTEGRITY, 'Game files failed integrity check', {
          retryable: true,
          details: { reason: 'sha256' },
        });
      }
    } else if (resolved.record && resolved.kind === 'installed') {
      // local/dev installs have no recorded hash: re-check the inline manifest.
      const text = decodeText(bytes);
      const validation = text === null ? null : validatePackageHtml(text, { packageBytes: LIMITS.entryBytes });
      if (
        !validation ||
        !validation.ok ||
        !validation.manifest ||
        validation.manifest.id !== resolved.record.id ||
        validation.manifest.version !== resolved.record.version
      ) {
        throw hostError(GM.INSTALL_CORRUPT, 'Installed package is incomplete', {
          retryable: true,
          details: { reason: 'manifest' },
        });
      }
    }
    const headers = {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': buildContentSecurityPolicy(url.origin, { frameAncestors }),
      'content-length': String(bytes.length),
      'x-entry-sha256': digest,
      'x-entry-version': version,
    };
    return new Response(bytes, { status: 200, headers });
  }

  function builtinPreviewPath(info, file) {
    const manifest = info && info.manifest;
    if (!manifest) return null;
    if (file === 'icon') return manifest.icon || null;
    if (file === 'cover') return manifest.cover || null;
    if (isPreviewFile(file) && file.startsWith('screenshot-')) {
      const index = Number(file.slice('screenshot-'.length)) - 1;
      return Array.isArray(manifest.screenshots) ? manifest.screenshots[index] || null : null;
    }
    return file;
  }

  function previewResponse(preview) {
    return new Response(preview.bytes, {
      status: 200,
      headers: {
        'content-type': preview.contentType,
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-length': String(preview.size),
        ...(preview.etag ? { etag: preview.etag } : {}),
      },
    });
  }

  async function servePreview(url) {
    const gameId = validateGameId(queryValue(url, 'gameId', { maxLength: 48 }));
    const file = queryValue(url, 'file', { maxLength: 180 });
    let version = queryValue(url, 'version', { required: false, maxLength: 64 });
    if (version !== null) version = validateVersion(version);

    if (version === null) {
      const record = await installations.get(gameId);
      if (record) version = record.version;
      else if (isBuiltin(gameId)) {
        const info = await catalog.load(gameId);
        version = info && info.manifest ? info.manifest.version : null;
      }
    }
    if (version !== null && isPreviewFile(file)) {
      const cached = await registry.getPreview(gameId, version, file);
      if (cached) return previewResponse(cached);
      // Local installs have no preview cache; `manifest.icon` is a data URI.
      if (file === 'icon') {
        const record = await installations.get(gameId);
        if (record && record.version === version) {
          const inline = decodeDataImage(record.manifest && record.manifest.icon);
          if (inline) {
            const digest = sha256Hex(inline.bytes);
            return previewResponse({
              bytes: inline.bytes,
              contentType: inline.contentType,
              size: inline.bytes.length,
              etag: `"${digest.slice(0, 32)}"`,
            });
          }
        }
      }
    }

    // V0 built-in preview files (manifest-declared relative paths) stay served
    // for the bundled game; installed packages only use the preview cache.
    if (isBuiltin(gameId)) {
      const info = await catalog.load(gameId);
      if (info && info.manifest) {
        const declared = builtinPreviewPath(info, file);
        if (declared) {
          try {
            return previewResponse(await catalog.getPreview(gameId, declared));
          } catch (error) {
            if (error && error.code === GM.ASSET_NOT_FOUND) {
              throw hostError(GM.ASSET_NOT_FOUND, 'Asset not found', { retryable: false });
            }
            throw error;
          }
        }
      }
    }
    throw hostError(GM.ASSET_NOT_FOUND, 'Asset not found', { retryable: false });
  }

  function hasActiveInstance(gameId) {
    const stamp = now().getTime();
    for (const [instanceId, binding] of instanceBindings) {
      if (binding.expiresAt <= stamp) {
        instanceBindings.delete(instanceId);
        continue;
      }
      if (binding.gameId === gameId) return true;
    }
    return false;
  }

  function invalidateGame(gameId) {
    for (const [instanceId, binding] of instanceBindings) {
      if (binding.gameId === gameId) instanceBindings.delete(instanceId);
    }
  }

  return {
    launch,
    serveEntry,
    servePreview,
    hasActiveInstance,
    invalidateGame,
    instanceBindings,
    bindingTtlMs,
    isBuiltin,
    readEntryFile,
  };
}
