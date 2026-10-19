/**
 * Defensive Host configuration (PRD §8.6.1, F-02, §8.8.7, §8.10).
 *
 * Bad config must never prevent the plugin from starting: every field falls
 * back to a documented default. Issues are collected as field-only strings so
 * `/health` can explain them without leaking paths or URLs.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_OFFICIAL_REGISTRY_URL } from '../../shared/src/constants.js';
import { DEFAULT_ALLOWED_HOSTS, REGISTRY_FILE } from '../../shared/src/registry.js';

const BUNDLE_ROOT_URL = new URL('../../../', import.meta.url);

/** Default CSP `frame-ancestors` allowlist (V1 TBD-05 / S-16). */
export const DEFAULT_FRAME_ANCESTORS = Object.freeze([
  "'self'",
  'http://127.0.0.1:*',
  'http://localhost:*',
]);

/** Bundle version, read once from the package root; never throws. */
export function readBundleVersion() {
  try {
    const raw = readFileSync(new URL('package.json', BUNDLE_ROOT_URL), 'utf8');
    const pkg = JSON.parse(raw);
    return typeof pkg.version === 'string' && pkg.version.length > 0 ? pkg.version : '0.0.0';
  } catch (_error) {
    return '0.0.0';
  }
}

/** `$DSH_HOME` (default `~/.dsh`) + `storages/dsh-game-market`. */
export function defaultDataRoot(env = process.env) {
  let base;
  try {
    const configured = env && typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
    base = configured.length > 0 ? path.resolve(configured) : path.join(homedir(), '.dsh');
  } catch (_error) {
    base = path.join(process.cwd(), '.dsh');
  }
  return path.join(base, 'storages', 'dsh-game-market');
}

/** Repository (or installed bundle) root `games/` directory. */
export function defaultBuiltinGamesRoot() {
  try {
    return path.resolve(fileURLToPath(new URL('games/', BUNDLE_ROOT_URL)));
  } catch (_error) {
    return path.resolve(process.cwd(), 'games');
  }
}

/** Default Registry index: the bundle's own `registry/games.json` (file source). */
export function defaultRegistryPath() {
  try {
    return path.join(fileURLToPath(BUNDLE_ROOT_URL), 'registry', REGISTRY_FILE);
  } catch (_error) {
    return path.resolve(process.cwd(), 'registry', REGISTRY_FILE);
  }
}

function normaliseConfiguredRoot(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.includes('\0')) return null;
  try {
    return path.resolve(trimmed);
  } catch (_error) {
    return null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Exact, lowercase hostname; no scheme, port or wildcard (TBD-04). */
export function normaliseAllowedHost(value) {
  if (typeof value !== 'string') return null;
  const host = value.trim().toLowerCase();
  if (host.length === 0 || host.length > 253) return null;
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)) return null;
  if (host.includes('..')) return null;
  return host;
}

function toFileSource(value) {
  let raw = value;
  if (/^file:/i.test(raw)) {
    try {
      raw = fileURLToPath(raw);
    } catch (_error) {
      return null;
    }
  }
  if (typeof raw !== 'string' || raw.includes('\0') || !path.isAbsolute(raw)) return null;
  try {
    return { kind: 'file', path: path.resolve(raw) };
  } catch (_error) {
    return null;
  }
}

function toRemoteSource(value, { allowHttp = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch (_error) {
    return null;
  }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) return null;
  if (url.username || url.password) return null;
  return { kind: 'https', url: url.toString(), origin: url.origin };
}

function sourceUrlOf(source) {
  if (!source) return null;
  return source.kind === 'file' ? source.path : source.url;
}

/**
 * Registry source priority (PRD §8.8.7):
 *   1. `DSH_GAME_REGISTRY_URL` (absolute http(s) URL or absolute file path)
 *   2. `config.registry.url` (+ `allowLocalFile` for local paths)
 *   3. bundle default file Registry
 */
export function resolveRegistrySource(rawSource, env, issues) {
  const source = isPlainObject(rawSource) ? rawSource : {};
  const allowLocalFile = source.allowLocalFile === true || source.allowLocalFile === 'true';
  const envValue =
    env && typeof env.DSH_GAME_REGISTRY_URL === 'string' ? env.DSH_GAME_REGISTRY_URL.trim() : '';

  if (envValue.length > 0) {
    const remote = /^https?:\/\//i.test(envValue) ? toRemoteSource(envValue, { allowHttp: true }) : null;
    const local = remote ? null : toFileSource(envValue);
    if (remote) return { mode: 'explicit', source: remote, origin: 'env', allowLocalFile, issues };
    if (local) return { mode: 'explicit', source: local, origin: 'env', allowLocalFile, issues };
    issues.push('registry.url:invalid');
    return { mode: 'explicit', source: null, origin: 'env', allowLocalFile, issues };
  }

  const configured =
    typeof source.url === 'string'
      ? source.url.trim()
      : typeof source.registryUrl === 'string'
        ? source.registryUrl.trim()
        : '';
  if (configured.length > 0) {
    if (/^https?:\/\//i.test(configured)) {
      // A configured remote Registry must be https; `http:` is never trusted.
      const remote = toRemoteSource(configured, { allowHttp: false });
      if (remote) return { mode: 'explicit', source: remote, origin: 'config', allowLocalFile, issues };
      issues.push('registry.url:invalid');
      return { mode: 'explicit', source: null, origin: 'config', allowLocalFile, issues };
    } else {
      if (!allowLocalFile) {
        issues.push('registry.allowLocalFile:required');
        return { mode: 'explicit', source: null, origin: 'config', allowLocalFile, issues };
      } else {
        const local = toFileSource(configured);
        if (local) return { mode: 'explicit', source: local, origin: 'config', allowLocalFile, issues };
        issues.push('registry.url:invalid');
        return { mode: 'explicit', source: null, origin: 'config', allowLocalFile, issues };
      }
    }
  }

  return {
    mode: 'layered',
    source: null,
    origin: 'official-default',
    officialUrl: DEFAULT_OFFICIAL_REGISTRY_URL,
    seedSource: { kind: 'file', path: defaultRegistryPath() },
    allowLocalFile,
    issues,
  };
}

function normaliseAllowedHosts(value, issues) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issues.push('registry.allowedHosts:invalid');
    return [];
  }
  const hosts = [];
  for (const item of value) {
    const host = normaliseAllowedHost(item);
    if (host === null) {
      issues.push('registry.allowedHosts:invalid');
      continue;
    }
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

function normaliseFrameAncestors(value, issues) {
  if (value === undefined || value === null) return [...DEFAULT_FRAME_ANCESTORS];
  if (!Array.isArray(value) || value.length === 0) {
    issues.push('security.frameAncestors:invalid');
    return [...DEFAULT_FRAME_ANCESTORS];
  }
  const out = [];
  for (const item of value.slice(0, 32)) {
    if (typeof item !== 'string') {
      issues.push('security.frameAncestors:invalid');
      continue;
    }
    const trimmed = item.trim();
    if (trimmed.length === 0 || trimmed.length > 256 || /[\s;]/.test(trimmed)) {
      issues.push('security.frameAncestors:invalid');
      continue;
    }
    // `*` (and data:/blob: sources) would defeat the V1 tightening (V1-15).
    if (trimmed === '*' || /^(?:data|blob):/i.test(trimmed)) {
      issues.push('security.frameAncestors:wildcard');
      continue;
    }
    if (!out.includes(trimmed) && out.length < 16) out.push(trimmed);
  }
  return out.length > 0 ? out : [...DEFAULT_FRAME_ANCESTORS];
}

function normaliseDevGameRoots(value, devMode, issues) {
  if (!devMode || value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    issues.push('devGameRoots:invalid');
    return [];
  }
  const roots = [];
  for (const item of value) {
    const root = normaliseConfiguredRoot(item);
    if (root === null) {
      issues.push('devGameRoots:invalid');
      continue;
    }
    if (!roots.includes(root)) roots.push(root);
  }
  return roots;
}

/**
 * @param {unknown} raw Cordis row config
 * @param {Record<string, string|undefined>} [env]
 */
export function normaliseConfig(raw, env = process.env) {
  const source = isPlainObject(raw) ? raw : {};
  const issues = [];
  const devMode = source.devMode === true;
  const registryInput = isPlainObject(source.registry) ? { ...source.registry } : {};
  if (registryInput.url === undefined && typeof source.registryUrl === 'string') {
    registryInput.url = source.registryUrl;
  }
  if (registryInput.allowedHosts === undefined && source.allowedHosts !== undefined) {
    registryInput.allowedHosts = source.allowedHosts;
  }
  const resolved = resolveRegistrySource(registryInput, env, issues);
  const allowedHosts = normaliseAllowedHosts(registryInput.allowedHosts, issues);
  const frameAncestors = normaliseFrameAncestors(
    isPlainObject(source.security) ? source.security.frameAncestors : source.frameAncestors,
    issues
  );
  const registrySource = resolved.source;
  return {
    devMode,
    dataRoot: normaliseConfiguredRoot(source.dataRoot) || defaultDataRoot(env),
    builtinGamesRoot: normaliseConfiguredRoot(source.builtinGamesRoot) || defaultBuiltinGamesRoot(),
    devGameRoots: normaliseDevGameRoots(source.devGameRoots, devMode, issues),
    registry: {
      mode: resolved.mode || 'explicit',
      source: registrySource,
      seedSource: resolved.seedSource || null,
      officialUrl: resolved.officialUrl || null,
      origin: resolved.origin,
      sourceUrl: registrySource ? sourceUrlOf(registrySource) : resolved.officialUrl || null,
      allowLocalFile: resolved.allowLocalFile,
      allowedHosts,
      defaultAllowedHosts: [...DEFAULT_ALLOWED_HOSTS],
    },
    security: { frameAncestors },
    configIssues: issues,
  };
}
