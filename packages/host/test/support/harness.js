/**
 * Test harness: a fake Cordis context captures exact Fetch routes and agent
 * event listeners; handlers are invoked with real `Request` objects (no server).
 *
 * `createHarness` boots through the real Cordis plugin (`apply`).
 * `createHostHarness` builds the Host directly so tests can inject env,
 * fetch/DNS stubs and expose the service graph.
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROUTES } from '../../../shared/src/contracts.js';
import { RUNTIME_VERSION, SDK_VERSION } from '../../../shared/src/constants.js';
import { AGENT_EVENTS, AGENT_SESSION_EVENTS } from '../../src/agent-adapter.js';
import { createHost } from '../../src/host.js';
import { apply } from '../../src/plugin.js';

export const FIXTURE_ROOT = path.resolve(fileURLToPath(new URL('../fixtures/games/', import.meta.url)));
export const BROKEN_FIXTURE_ROOT = path.resolve(
  fileURLToPath(new URL('../fixtures/games-broken/', import.meta.url))
);
export const ORIGIN = 'http://127.0.0.1:19387';

export { ROUTES, AGENT_EVENTS, AGENT_SESSION_EVENTS };

export function createFakeContext({ knownEvents = [...AGENT_EVENTS, 'session/event'], failingEvents = [], withConnection = true } = {}) {
  const routes = new Map();
  const listeners = new Map();
  const effects = [];
  const logs = [];

  const logger = {
    info: (...parts) => logs.push(['info', ...parts]),
    warn: (...parts) => logs.push(['warn', ...parts]),
    error: (...parts) => logs.push(['error', ...parts]),
    debug: (...parts) => logs.push(['debug', ...parts]),
  };

  const ctx = {
    connection: withConnection
      ? {
          fetch: {
            register(route) {
              if (routes.has(route.path)) throw new Error(`duplicate route: ${route.path}`);
              routes.set(route.path, route);
              return async () => {
                routes.delete(route.path);
              };
            },
          },
        }
      : undefined,
    effect(callback, label) {
      const cleanup = callback();
      const entry = { callback, cleanup, label };
      effects.push(entry);
      return () => {
        const index = effects.indexOf(entry);
        if (index >= 0) effects.splice(index, 1);
        return typeof cleanup === 'function' ? cleanup() : undefined;
      };
    },
    on(name, listener) {
      if (!knownEvents.includes(name)) throw new Error(`unknown event: ${name}`);
      if (failingEvents.includes(name)) throw new Error(`failing event: ${name}`);
      const set = listeners.get(name) || new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => {
        set.delete(listener);
      };
    },
    logger,
    get(name) {
      return name === 'connection' ? ctx.connection : undefined;
    },
  };

  async function dispose() {
    for (const entry of effects.splice(0).reverse()) {
      try {
        const result = typeof entry.cleanup === 'function' ? entry.cleanup() : undefined;
        if (result && typeof result.then === 'function') await result;
      } catch (_error) {
        // Tests assert behaviour, not cleanup exceptions.
      }
    }
    listeners.clear();
    routes.clear();
  }

  function trigger(name, payload, next) {
    const returns = [];
    const args = Array.isArray(payload) ? [...payload, next] : [payload, next];
    for (const listener of listeners.get(name) || []) returns.push(listener(...args));
    return returns;
  }

  return { ctx, routes, listeners, effects, logs, logger, dispose, trigger };
}

function createRequestHelpers(fake, directory, dataRoot) {
  async function request(pathname, options = {}) {
    const url = new URL(`${ORIGIN}${pathname}`);
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const route = fake.routes.get(url.pathname);
    if (!route) throw new Error(`route not registered: ${url.pathname}`);
    const headers = new Headers(options.headers || {});
    let body = options.rawBody;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }
    if (options.contentType !== undefined) {
      if (options.contentType === null) headers.delete('content-type');
      else headers.set('content-type', options.contentType);
    }
    const method = options.method || (body === undefined ? 'GET' : 'POST');
    return route.fetch(new Request(url, { method, headers, body }));
  }

  async function requestJson(pathname, options = {}) {
    const response = await request(pathname, options);
    const text = await response.text();
    let payload = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch (_error) {
        payload = null;
      }
    }
    return { response, payload, text };
  }

  async function data(pathname, options = {}) {
    const { response, payload } = await requestJson(pathname, options);
    if (!payload || payload.ok !== true) {
      throw new Error(`expected success, got ${response.status}: ${JSON.stringify(payload)}`);
    }
    return payload.data;
  }

  function filePath(...segments) {
    return path.join(dataRoot, ...segments);
  }

  async function readDataFile(...segments) {
    return fs.readFile(filePath(...segments), 'utf8');
  }

  async function readDataJson(...segments) {
    return JSON.parse(await readDataFile(...segments));
  }

  async function writeDataFile(relativePath, content) {
    const target = path.join(dataRoot, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, typeof content === 'string' ? content : JSON.stringify(content));
    return target;
  }

  async function listDataFiles(relativeDirectory) {
    try {
      return (await fs.readdir(filePath(relativeDirectory))).sort();
    } catch (_error) {
      return [];
    }
  }

  async function pathExists(relativePath) {
    try {
      await fs.lstat(filePath(relativePath));
      return true;
    } catch (_error) {
      return false;
    }
  }

  return {
    directory,
    dataRoot,
    request,
    requestJson,
    data,
    filePath,
    readDataFile,
    readDataJson,
    writeDataFile,
    listDataFiles,
    pathExists,
  };
}

/** Fake DNS resolution so tests never touch the network. */
export async function publicResolveHost() {
  return [{ address: '203.0.113.7', family: 4 }];
}

export async function createHarness(
  t,
  {
    config = {},
    fixtureRoot = FIXTURE_ROOT,
    knownEvents = [...AGENT_EVENTS, 'session/event'],
    failingEvents = [],
    withConnection = true,
  } = {}
) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'dsh-gm-host-'));
  const dataRoot = path.join(directory, 'data');
  const fake = createFakeContext({ knownEvents, failingEvents, withConnection });
  try {
    apply(fake.ctx, { dataRoot, builtinGamesRoot: fixtureRoot, ...config });
  } catch (error) {
    fake.logs.push(['error', 'apply-threw', error]);
  }

  t.after(async () => {
    await fake.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  });

  return {
    ...createRequestHelpers(fake, directory, dataRoot),
    ...fake,
    fixtureRoot,
    config,
  };
}

/**
 * Build the Host directly (no Cordis shell) with injectable env/http so V1
 * tests can exercise the Registry client and installer deterministically.
 */
export async function createHostHarness(
  t,
  {
    config = {},
    fixtureRoot = FIXTURE_ROOT,
    env = {},
    http = {},
    now,
    hostEpoch,
    prepareDataRoot,
  } = {}
) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'dsh-gm-host-v1-'));
  const dataRoot = path.join(directory, 'data');
  const home = path.join(directory, 'home');
  const fake = createFakeContext();
  if (typeof prepareDataRoot === 'function') await prepareDataRoot(dataRoot, directory);
  const httpOptions = {
    resolveHost: publicResolveHost,
    sleep: async () => undefined,
    retries: 0,
    installLockWaitMs: 500,
    ...http,
  };
  const host = createHost({
    config: { dataRoot, builtinGamesRoot: fixtureRoot, ...config },
    env: { DSH_HOME: home, ...env },
    logger: fake.logger,
    http: httpOptions,
    ...(now ? { now } : {}),
    ...(hostEpoch ? { hostEpoch } : {}),
  });
  for (const route of host.routes) {
    fake.routes.set(route.path, {
      ...route,
      fetch: (request) => host.router.handleRoute(route, request),
    });
  }

  t.after(async () => {
    try {
      await host.maintenance.ready();
      await host.registry.ready();
      await host.storage.flush();
    } catch (_error) {
      // Cleanup is best effort.
    }
    await fake.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  });

  return {
    ...createRequestHelpers(fake, directory, dataRoot),
    ...fake,
    host,
    home,
    fixtureRoot,
    config,
    http: httpOptions,
  };
}

/** Copy the fixture games tree to a temp root and optionally patch snake/game.json. */
export async function makeGameRoot(t, { base = FIXTURE_ROOT, overrides = null, omitEntry = false } = {}) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'dsh-gm-games-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.cp(base, directory, { recursive: true });
  const manifestPath = path.join(directory, 'snake', 'game.json');
  if (overrides) {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const next = typeof overrides === 'function' ? overrides(manifest) : { ...manifest, ...overrides };
    await fs.writeFile(manifestPath, JSON.stringify(next, null, 2));
  }
  if (omitEntry) await fs.rm(path.join(directory, 'snake', 'dist'), { recursive: true, force: true });
  return directory;
}

export async function chmodPath(target, mode) {
  await fs.chmod(target, mode);
}

export async function listFilesRecursive(root) {
  const out = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (_error) {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else out.push(path.relative(root, abs));
    }
  }
  await walk(root);
  return out.sort();
}

export const expected = Object.freeze({
  gameId: 'snake',
  name: 'Snake',
  version: '0.1.0',
  runtimeVersion: RUNTIME_VERSION,
  sdkVersion: SDK_VERSION,
  viewport: { width: 960, height: 540, fit: 'contain' },
  limits: {
    saveBytes: 1024 * 1024,
    saveKeys: 32,
    scoreMetaBytes: 2048,
  },
});
