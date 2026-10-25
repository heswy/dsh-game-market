#!/usr/bin/env node
/**
 * Single source of truth for the isolated host network environment.
 *
 * Default mode: `mirror`
 *   - git transport is rewritten to the Lead-provided bare mirror
 *     (/tmp/m3-mirror.git) via GIT_CONFIG_GLOBAL url.insteadOf;
 *   - pnpm runs offline against the pre-warmed content-addressable store;
 *   - the fixture proxy only carries the frozen index URL fetch (local TLS
 *     interception), so no real network is needed at all.
 *   Evidence label: "isolated local git mirror (network-independent); commits
 *   identical to origin; production transport unchanged".
 *
 * Opt-in mode: `real-github` (M3_NETWORK_MODE=real-github)
 *   - git uses the pinned reachable-IP git config (curloptResolve) and pnpm
 *     retries; still routed through the fixture proxy for the index fetch.
 *   Evidence label recorded by the runners.
 *
 * Nothing here changes product code: it only shapes the isolated host process
 * env and is recorded in evidence.
 */
import fs from 'node:fs';

export const MIRROR_REPO = '/tmp/m3-mirror.git';
export const MIRROR_CONFIG = '/tmp/m3-mirror-gitconfig';
export const PINNED_CONFIG = '/tmp/dsh-v15/m3/pinned-gitconfig';

export const NETWORK_MODES = Object.freeze(['mirror', 'real-github']);

export function resolveNetworkMode(explicit = null) {
  if (explicit !== null && explicit !== undefined) return explicit === 'real-github' ? 'real-github' : 'mirror';
  return process.env.M3_NETWORK_MODE === 'real-github' ? 'real-github' : 'mirror';
}

export function networkModeAvailable(mode) {
  if (mode === 'mirror') return fs.existsSync(MIRROR_REPO) && fs.existsSync(MIRROR_CONFIG);
  return true;
}

export function networkModeLabel(mode) {
  if (mode === 'mirror') {
    return 'isolated local git mirror via GIT_CONFIG_GLOBAL url.insteadOf (/tmp/m3-mirror.git) + pre-warmed pnpm offline store (network-independent); commits identical to origin; production transport unchanged; real-GitHub exact-commit fetch separately evidenced in V0/network runs';
  }
  return 'real GitHub transport (pinned reachable IPs via git config; network-dependent, explicitly opted in)';
}

/**
 * Build the mode-specific part of the isolated host env.
 * The caller adds the fixture proxy/CA/DNS-pin vars.
 */
export function buildHostNetworkEnv({ mode = resolveNetworkMode(), marker = null } = {}) {
  const env = {
    M3_NETWORK_MODE: mode,
    NO_PROXY: '127.0.0.1,localhost',
    npm_config_noproxy: '127.0.0.1,localhost',
  };
  if (mode === 'mirror') {
    if (!networkModeAvailable('mirror')) {
      throw new Error(`mirror network mode unavailable: missing ${MIRROR_REPO} or ${MIRROR_CONFIG}`);
    }
    Object.assign(env, {
      GIT_CONFIG_GLOBAL: MIRROR_CONFIG,
      GIT_CONFIG_NOSYSTEM: '1',
      // pnpm must not touch the network in mirror mode.
      npm_config_proxy: '',
      npm_config_http_proxy: '',
      npm_config_https_proxy: '',
      npm_config_offline: 'true',
      npm_config_prefer_offline: 'true',
      npm_config_fetch_retries: '2',
      npm_config_network_concurrency: '1',
    });
  } else {
    Object.assign(env, {
      ...(fs.existsSync(PINNED_CONFIG) ? { GIT_CONFIG_GLOBAL: PINNED_CONFIG } : {}),
      GIT_CONFIG_NOSYSTEM: '1',
      npm_config_fetch_retries: '4',
      npm_config_fetch_retry_maxtimeout: '120000',
      npm_config_fetch_timeout: '120000',
      npm_config_network_concurrency: '1',
    });
  }
  if (marker !== null) env.M3_FIXTURE_RUN_TAG = marker;
  return env;
}
