/**
 * Defensive Host configuration (PRD §8.6.1, F-02).
 *
 * Bad config must never prevent the plugin from starting: every field falls
 * back to a documented default. No path is logged.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUNDLE_ROOT_URL = new URL('../../../', import.meta.url);

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

/**
 * @param {unknown} raw Cordis row config
 * @param {Record<string, string|undefined>} [env]
 */
export function normaliseConfig(raw, env = process.env) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    devMode: source.devMode === true,
    dataRoot: normaliseConfiguredRoot(source.dataRoot) || defaultDataRoot(env),
    builtinGamesRoot: normaliseConfiguredRoot(source.builtinGamesRoot) || defaultBuiltinGamesRoot(),
  };
}
