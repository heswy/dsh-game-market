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
  ASSET_ZIP_V2,
  DEFAULT_PACKAGE_FORMAT,
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
import { normalizeZipPath } from '../../shared/src/package-v2.js';
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

/** V1 records have no `format`; a missing format always means `html-v1` (§6.2). */
function recordFormatOf(record) {
  return record && record.format === ASSET_ZIP_V2 ? ASSET_ZIP_V2 : DEFAULT_PACKAGE_FORMAT;
}

/**
 * Entry path relative to `packages/<id>/<version>/`.
 * `html-v1` is always `entry.html` (V1 semantics); `asset-zip-v2` uses the
 * installation record's `entry` and re-applies the archive path rules.
 */
function installedEntryRel(format, record) {
  if (format !== ASSET_ZIP_V2) return ENTRY_FILE;
  const candidate = record && typeof record.entry === 'string' ? record.entry : null;
  const normalized = normalizeZipPath(candidate);
  if (!normalized.ok || !normalized.value.toLowerCase().endsWith('.html')) {
    throw hostError(GM.DESCRIPTOR_MISMATCH, 'Installed package entry is invalid', { retryable: false });
  }
  return normalized.value;
}

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
  resources = null,
  /**
   * Host-authoritative update admission barrier (audit M3-AUD-03). While a
   * platform update is between coordination and package change, new game
   * launches are rejected with a retryable busy code. Optional so isolated
   * entry tests can run without a host barrier.
   */
  admission = null,
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
        format: DEFAULT_PACKAGE_FORMAT,
        entry: ENTRY_FILE,
        packageRoot: null,
        entryPath: dev.entryPath,
        record: null,
        source: 'dev',
      };
    }
    const record = await installations.get(gameId);
    if (record) {
      const format = recordFormatOf(record);
      const entry = installedEntryRel(format, record);
      return {
        kind: 'installed',
        gameId,
        version: record.version,
        manifest: record.manifest,
        format,
        entry,
        packageRoot: storage.filePath(PACKAGES_DIR, record.id, record.version),
        entryPath: storage.filePath(PACKAGES_DIR, record.id, record.version, entry),
        record,
        source: record.source,
      };
    }
    if (isBuiltin(gameId)) {
      const info = await catalog.load(gameId);
      if (!info) return null;
      // A present-but-invalid built-in package (`package-invalid`) fails closed
      // with the catalog's GM code instead of being served as a broken game. A
      // package that is not shipped in this tree is simply absent (catalog.list
      // already skips it, so `info` would be null for launch lookups).
      if (!info.manifest) {
        if (info.issue === 'package-invalid' && typeof info.packageError === 'string') {
          throw hostError(info.packageError, 'Built-in package is invalid', {
            retryable: false,
            details: { reason: 'package-invalid' },
          });
        }
        if (info.issue === 'manifest-missing' || info.issue === 'manifest-unreadable') return null;
        throw hostError(GM.MANIFEST_INVALID, 'Game manifest is invalid', { retryable: false });
      }
      const format = info.format === ASSET_ZIP_V2 ? ASSET_ZIP_V2 : DEFAULT_PACKAGE_FORMAT;
      return {
        kind: 'builtin',
        gameId,
        version: info.manifest.version,
        manifest: info.manifest,
        format,
        // `asset-zip-v2` builtins use the descriptor entry + its package root so
        // the resource origin serves them through the *same* manifest path as an
        // installed package; `html-v1` keeps the V1 single-file shape.
        entry: format === ASSET_ZIP_V2 ? info.entry || info.entryRel : ENTRY_FILE,
        packageRoot: format === ASSET_ZIP_V2 ? info.packageRoot : null,
        entryPath: info.entryPath,
        entryExists: info.entryExists,
        filesDigest: format === ASSET_ZIP_V2 ? info.filesDigest ?? null : null,
        fileCount: format === ASSET_ZIP_V2 ? info.fileCount ?? null : null,
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

  const importingGames=new Set();
  const deletingGames=new Set();
  function assertNotImporting(gameId){
    if(importingGames.has(gameId))throw hostError(GM.INSTALL_IN_PROGRESS,'Saved progress is being imported',{retryable:true});
  }
  /**
   * Import and "uninstall + delete data" are mutually exclusive in both
   * directions. Both sides check and claim the game synchronously, so on one
   * thread they cannot interleave: without this, an import that started first
   * kept writing `current.json` after the uninstall had removed the saves
   * directory, recreating progress for an uninstalled game.
   */
  function beginDataDeletion(gameId){
    assertNotImporting(gameId);
    if(deletingGames.has(gameId))throw hostError(GM.UNINSTALL_BUSY,'Game data is already being deleted',{retryable:true});
    deletingGames.add(gameId);
    let released=false;
    return ()=>{if(!released){released=true;deletingGames.delete(gameId);}};
  }
  async function withInactiveGame(gameId,run){
    assertNotImporting(gameId);
    if(deletingGames.has(gameId))throw hostError(GM.INSTALL_IN_PROGRESS,'Game data is being deleted',{retryable:true});
    importingGames.add(gameId);
    try{
      if(hasActiveInstance(gameId))throw hostError(GM.UPDATE_GAME_RUNNING,'Close this game in every window before importing');
      return await run();
    }finally{importingGames.delete(gameId);}
  }

  async function launch(body) {
    // Fail fast BEFORE any side effect: the update barrier must reject new
    // entries (start and resume-paused alike) while a package change may occur.
    if (admission) admission.assertEntryAllowed();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw hostError(GM.INVALID_PARAM, 'Request body must be an object');
    }
    const gameId = validateGameId(body.gameId);
    assertNotImporting(gameId);
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

    const format = resolved.format === ASSET_ZIP_V2 ? ASSET_ZIP_V2 : DEFAULT_PACKAGE_FORMAT;
    let digest = null;
    if (format === ASSET_ZIP_V2) {
      // `asset-zip-v2`: the executable entry lives in the validated file
      // manifest, and the outer sha256 binds the ZIP, not this file. The
      // resource service verifies descriptor + entry sha256 (contract §7.2).
      if (!resources) {
        throw hostError(GM.HOST_UNAVAILABLE, 'Resource origin is unavailable', { retryable: true });
      }
      digest = sha256Hex(await readEntryFile(resolved.entryPath));
    } else {
      const bytes = await readEntryFile(resolved.entryPath);
      digest = sha256Hex(bytes);
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
    }

    const instanceId = createInstanceId();
    const nonce = createNonce();
    const preview = await previewLinks(gameId, resolved.version, resolved.source);

    // Instance-bound resource credential (§7.2/§7.6). The resource origin is
    // the only path that can serve an `asset-zip-v2` entry; `html-v1` keeps the
    // V1 `/entry` URL as its launch URL and gets the extra fields additively.
    let resourceInfo = null;
    if (resources) {
      resourceInfo = await resources.issue({
        instanceId,
        nonce,
        gameId,
        version: resolved.version,
        format,
        entry: resolved.entry,
        entryPath: resolved.entryPath,
        packageRoot: resolved.packageRoot || null,
        entrySha256: digest,
        // Installed packages carry the digest on the installation record; a
        // built-in package carries the catalog-validated digest (M2).
        filesDigest: format === ASSET_ZIP_V2 ? resolved.filesDigest ?? resolved.record?.fileManifestDigest ?? null : null,
        ttlMs: bindingTtlMs,
      });
    }
    if (format === ASSET_ZIP_V2 && !resourceInfo) {
      throw hostError(GM.HOST_UNAVAILABLE, 'Resource origin is unavailable', { retryable: true });
    }
    const entrySha256 = digest;
    const params = new URLSearchParams({ gameId, version: resolved.version, instance: instanceId, nonce });
    const legacyEntryUrl = `${API_BASE}/entry?${params.toString()}`;
    // §7.6: for `asset-zip-v2` the one-shot launch URL lives on the resource
    // origin (inside the wrapper); `html-v1` keeps the V1 `/entry` semantics.
    const entryUrl = format === ASSET_ZIP_V2 && resourceInfo
      ? `${resourceInfo.entryResourceUrl}?launch=${encodeURIComponent(nonce)}`
      : legacyEntryUrl;

    const createdAtMs = now().getTime();
    rememberInstance(instanceId, {
      gameId,
      version: resolved.version,
      nonce,
      dshSessionId,
      source: resolved.source,
      entryPath: resolved.entryPath,
      entrySha256,
      capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities.slice() : [],
      viewport: normaliseViewport(manifest.viewport),
      createdAt: now().toISOString(),
      // Entry credential TTL is fixed; runtime lifetime is renewed by the
      // Client heartbeat so a long session does not lose update protection.
      entryExpiresAt: createdAtMs + bindingTtlMs,
      expiresAt: createdAtMs + bindingTtlMs,
    });
    // Second admission check at the end of the (async) launch: a launch that
    // passed the first check just before the Host set the update barrier must
    // not leave a live instance behind. Remove the binding/credential and fail
    // closed with the same retryable busy code.
    {
      try {
        assertNotImporting(gameId);
        if(admission)admission.assertEntryAllowed();
      } catch (error) {
        instanceBindings.delete(instanceId);
        if (resources) resources.release(instanceId, gameId);
        throw error;
      }
    }
    return {
      instanceId,
      nonce,
      entryUrl,
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
      entrySha256,
      ...(resourceInfo
        ? {
            resourceOrigin: resourceInfo.resourceOrigin,
            resourceBase: resourceInfo.resourceBase,
            resourceTtlMs: resourceInfo.ttlMs,
            entryResourceUrl: resourceInfo.entryResourceUrl,
            package: {
              format,
              entry: resolved.entry,
              filesDigest: format === ASSET_ZIP_V2 ? resolved.filesDigest ?? resolved.record?.fileManifestDigest ?? null : null,
            },
            // M4: additive wrapper fields protect html-v1 too; entryUrl stays
            // on the legacy route for older Clients.
            wrapperUrl: resourceInfo.wrapperUrl,
            wrapperResourceUrl: resourceInfo.wrapperResourceUrl,
          }
        : {}),
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
      const format = recordFormatOf(record);
      const entry = installedEntryRel(format, record);
      return {
        kind: 'installed',
        format,
        entry,
        packageRoot: storage.filePath(PACKAGES_DIR, record.id, record.version),
        entryPath: storage.filePath(PACKAGES_DIR, record.id, record.version, entry),
        record,
      };
    }
    if (isBuiltin(gameId)) {
      const info = await catalog.load(gameId);
      if (!info) throw hostError(GM.GAME_NOT_FOUND, 'Game not found');
      if (!info.manifest) {
        if (info.issue === 'package-invalid' && typeof info.packageError === 'string') {
          throw hostError(info.packageError, 'Built-in package is invalid', {
            retryable: false,
            details: { reason: 'package-invalid' },
          });
        }
        throw hostError(GM.MANIFEST_INVALID, 'Game manifest is invalid');
      }
      if (info.manifest.version !== version) throw hostError(GM.GAME_NOT_FOUND, 'Game version not found');
      if (!info.entryExists) throw hostError(GM.ASSET_NOT_FOUND, 'Game entry file is missing');
      const format = info.format === ASSET_ZIP_V2 ? ASSET_ZIP_V2 : DEFAULT_PACKAGE_FORMAT;
      return {
        kind: 'builtin',
        format,
        entry: format === ASSET_ZIP_V2 ? info.entry || info.entryRel : ENTRY_FILE,
        packageRoot: format === ASSET_ZIP_V2 ? info.packageRoot : null,
        entryPath: info.entryPath,
        filesDigest: format === ASSET_ZIP_V2 ? info.filesDigest ?? null : null,
        record: null,
      };
    }
    throw hostError(GM.GAME_NOT_FOUND, 'Game not found');
  }

  async function serveEntry(request, url) {
    const gameId = validateGameId(queryValue(url, 'gameId', { maxLength: 48 }));
    const version = validateVersion(queryValue(url, 'version', { maxLength: 64 }));
    const instance = validateInstanceId(queryValue(url, 'instance', { maxLength: 32 }));
    const nonce = validateNonce(queryValue(url, 'nonce', { maxLength: 32 }));

    const resolved = await resolveForServe(gameId, version);
    // `asset-zip-v2` entries are served by the instance resource origin only:
    // package-relative URLs must resolve under `/res/<instance>/<token>/`, and
    // the `/api` origin is fenced for opaque-origin documents (S-A1).
    if (resolved.format === ASSET_ZIP_V2) {
      throw hostError(GM.ASSET_NOT_FOUND, 'Game entry is served by the resource origin', { retryable: false });
    }

    const binding = instanceBindings.get(instance);
    if (!binding) {
      throw hostError(GM.INVALID_PARAM, 'Unknown or expired game instance', { retryable: false });
    }
    // The one-shot entry credential expires on its own TTL; an active instance
    // (renewed by heartbeat) must not keep an expired credential usable.
    if (binding.entryExpiresAt <= now().getTime()) {
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

  /**
   * Active runtime instances (launch bindings whose TTL has not expired).
   *
   * V1.5 coordination needs the authoritative Host-side list: an update may not
   * change the package until every live instance in this profile has paused,
   * saved and confirmed (docs/V1.5-CONTRACTS.md §9, m3-decisions §4). Instance
   * bindings are renewed by `POST /runtime-renew`, so an abandoned page stops
   * blocking updates once its TTL lapses.
   *
   * @returns {Array<{instanceId:string, gameId:string, version:string, dshSessionId:string|null, createdAt:string}>}
   */
  function listActiveInstances() {
    const stamp = now().getTime();
    const active = [];
    for (const [instanceId, binding] of instanceBindings) {
      if (binding.expiresAt <= stamp) {
        instanceBindings.delete(instanceId);
        if (resources) resources.release(instanceId, binding.gameId);
        continue;
      }
      active.push({
        instanceId,
        gameId: binding.gameId,
        version: binding.version,
        dshSessionId: typeof binding.dshSessionId === 'string' ? binding.dshSessionId : null,
        createdAt: binding.createdAt,
      });
    }
    active.sort((left, right) => (left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0));
    return active;
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
    if (resources) resources.releaseGame(gameId);
  }

  /**
   * Extend one live instance while its Runtime is still open (§7.6).
   * `POST /runtime-renew` MUST renew the entry binding *and* the instance-bound
   * resource credential, and return the new `resourceTtlMs`.
   */
  function renewInstance(instanceId) {
    const binding = instanceBindings.get(instanceId);
    if (!binding) return null;
    const stamp = now().getTime();
    if (binding.expiresAt <= stamp) {
      instanceBindings.delete(instanceId);
      if (resources) resources.release(instanceId);
      return null;
    }
    let resourceTtlMs = null;
    if (resources) {
      const renewed = resources.renew(instanceId);
      if (!renewed) {
        // The resource credential is the runtime's actual read authority; if it
        // cannot be renewed, the instance is no longer usable.
        instanceBindings.delete(instanceId);
        resources.release(instanceId);
        return null;
      }
      resourceTtlMs = renewed.resourceTtlMs;
    }
    binding.expiresAt = stamp + bindingTtlMs;
    return {
      instanceId,
      gameId: binding.gameId,
      version: binding.version,
      expiresAt: binding.expiresAt,
      ...(resourceTtlMs === null ? {} : { resourceTtlMs }),
    };
  }

  /** Release one instance (multi-window safe); a wrong gameId releases nothing. */
  function releaseInstance(instanceId, gameId) {
    const binding = instanceBindings.get(instanceId);
    if (!binding) {
      if (resources) resources.release(instanceId);
      return 0;
    }
    if (typeof gameId === 'string' && binding.gameId !== gameId) return 0;
    instanceBindings.delete(instanceId);
    if (resources) resources.release(instanceId, binding.gameId);
    return 1;
  }

  /** Legacy: drop every live launch binding for a game. */
  function releaseGame(gameId) {
    let released = 0;
    for (const [instanceId, binding] of instanceBindings) {
      if (binding.gameId === gameId) {
        instanceBindings.delete(instanceId);
        released += 1;
      }
    }
    if (resources) resources.releaseGame(gameId);
    return released;
  }

  return {
    launch,
    withInactiveGame,
    beginDataDeletion,
    serveEntry,
    servePreview,
    hasActiveInstance,
    listActiveInstances,
    invalidateGame,
    releaseGame,
    renewInstance,
    releaseInstance,
    instanceBindings,
    bindingTtlMs,
    isBuiltin,
    readEntryFile,
  };
}
