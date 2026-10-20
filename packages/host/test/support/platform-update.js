/**
 * Helpers for V1.5 platform update tests (M3-H1/H2): format-1 index fixtures,
 * deterministic fetch stubs and cached-discovery fixtures.
 *
 * Everything here is local and deterministic; no test may touch the network.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  PLATFORM_UPDATE_CACHE_FILE,
  PLATFORM_UPDATE_REPOSITORY,
  updateTargetIdFor,
  updateGitSpecForCommit,
} from '../../../shared/src/platform-update.js';

export const COMMIT_A = 'a'.repeat(40);
export const COMMIT_B = 'b'.repeat(40);
export const COMMIT_C = 'c'.repeat(40);

export const REPO_URL = PLATFORM_UPDATE_REPOSITORY.url;

export function makeVersion({
  version = '1.3.0',
  commit = COMMIT_A,
  publishTimestamp = 1700000000,
  source,
} = {}) {
  return {
    version,
    publishTimestamp,
    source: source ?? { type: 'git', url: REPO_URL, commit },
  };
}

export function makeIndexDocument({
  versions = [makeVersion()],
  pluginName = 'dsh-game-market',
  plugins,
  title = 'DSH Game Market plugins',
  metadata,
} = {}) {
  return {
    format: 1,
    title,
    ...(metadata === undefined ? {} : { metadata }),
    plugins:
      plugins ??
      [
        {
          name: pluginName,
          repository: { url: 'https://github.com/heswy/dsh-game-market' },
          versions,
        },
      ],
  };
}

/** A `Response` carrying a JSON body (what global `fetch` would return). */
export function jsonResponse(value, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Fetch stub that always answers the same payload and counts calls. */
export function staticFetch(payload, options = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse(payload, options);
  };
  return { fetch: fetchImpl, calls };
}

/** Fetch stub whose responses are scripted per call (function or list). */
export function scriptedFetch(script) {
  const calls = [];
  const handlers = Array.isArray(script) ? script.slice() : null;
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = handlers === null ? script(calls.length - 1, String(url), init) : handlers.shift();
    if (typeof next === 'function') return next(String(url), init);
    if (next instanceof Error) throw next;
    if (next === undefined) throw new Error('scriptedFetch: no response scripted');
    return next;
  };
  return { fetch: fetchImpl, calls };
}

/** Fetch stub that never settles until its request is aborted (timeout path). */
export function hangingFetch() {
  const calls = [];
  const fetchImpl = (url, init) =>
    new Promise((_resolve, reject) => {
      calls.push({ url: String(url), init });
      const signal = init?.signal;
      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }
    });
  return { fetch: fetchImpl, calls };
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function makeCacheTarget({ version = '1.2.9', commit = COMMIT_B } = {}) {
  return {
    id: updateTargetIdFor(version, commit),
    version,
    commit,
    channel: 'stable',
    publishedAt: '2023-11-14T22:13:20.000Z',
    spec: updateGitSpecForCommit(commit),
  };
}

export function makeCacheDocument({
  target = makeCacheTarget(),
  previousTarget = null,
  channel = 'stable',
  fetchedAt = new Date(Date.now() - 60_000).toISOString(),
  checkedAt = fetchedAt,
  indexHash = 'f'.repeat(64),
} = {}) {
  return {
    schemaVersion: 1,
    indexUrl:
      'https://raw.githubusercontent.com/heswy/dsh-game-market/main/platform-updates/plugins.json',
    indexHash,
    channel,
    fetchedAt,
    checkedAt,
    target,
    previousTarget,
  };
}

export async function writeDiscoveryCache(dataRoot, value) {
  const file = path.join(dataRoot, PLATFORM_UPDATE_CACHE_FILE);
  await fs.mkdir(dataRoot, { recursive: true });
  await fs.writeFile(file, JSON.stringify(value));
  return file;
}

export async function readDiscoveryCache(dataRoot) {
  return JSON.parse(await fs.readFile(path.join(dataRoot, PLATFORM_UPDATE_CACHE_FILE), 'utf8'));
}

export async function writeProfile(t, home, { profile = 'web', spec, diskVersion = null } = {}) {
  const profileDir = path.join(home, 'profiles', profile);
  await fs.mkdir(profileDir, { recursive: true });
  const dependencies = spec === undefined || spec === null ? {} : { 'dsh-game-market': spec };
  await fs.writeFile(
    path.join(profileDir, 'package.json'),
    JSON.stringify({ name: `profile-${profile}`, private: true, dependencies }, null, 2)
  );
  if (diskVersion !== null) {
    const installed = path.join(profileDir, 'node_modules', 'dsh-game-market');
    await fs.mkdir(installed, { recursive: true });
    await fs.writeFile(
      path.join(installed, 'package.json'),
      JSON.stringify({ name: 'dsh-game-market', version: diskVersion })
    );
  }
  return profileDir;
}

export async function updateProfileSpec(home, { profile = 'web', spec, diskVersion = null } = {}) {
  return writeProfile(null, home, { profile, spec, diskVersion });
}
