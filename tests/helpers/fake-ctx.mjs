/**
 * Minimal fake Cordis/DSH Host context for integration tests.
 *
 * Captures exact Fetch routes registered by the Host plugin and dispatches
 * Requests to them, so we never need to boot DSH or open a socket.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function createFakeCtx() {
  const routes = [];
  const disposers = [];
  const listeners = new Map();
  const effects = [];

  const ctx = {
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
    connection: {
      fetch: {
        register(route) {
          if (!route || typeof route.path !== 'string') throw new Error('route.path is required');
          const key = route.path;
          if (routes.some((item) => item.path === key)) throw new Error(`duplicate route: ${key}`);
          routes.push(route);
          const dispose = () => {
            const index = routes.indexOf(route);
            if (index !== -1) routes.splice(index, 1);
          };
          disposers.push(dispose);
          return dispose;
        },
      },
    },
    on(name, handler) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(handler);
      const dispose = () => {
        const list = listeners.get(name) || [];
        const index = list.indexOf(handler);
        if (index !== -1) list.splice(index, 1);
      };
      disposers.push(dispose);
      return dispose;
    },
    effect(callback, _label) {
      const dispose = callback();
      effects.push({ callback, dispose });
      return typeof dispose === 'function' ? dispose : () => {};
    },
    get(name) {
      if (name === 'connection') return ctx.connection;
      return null;
    },
  };

  return {
    ctx,
    routes,
    effects,
    listeners,
    dispose() {
      for (const dispose of disposers.splice(0).reverse()) {
        try {
          dispose();
        } catch (_error) {
          /* test cleanup */
        }
      }
      for (const effect of effects.splice(0)) {
        try {
          if (typeof effect.dispose === 'function') effect.dispose();
        } catch (_error) {
          /* test cleanup */
        }
      }
    },
    emit(name, payload) {
      for (const handler of listeners.get(name) || []) {
        try {
          handler(payload);
        } catch (error) {
          console.error(`[fake-ctx] listener for ${name} threw`, error);
        }
      }
    },
    async request(pathAndQuery, init = {}, origin = 'http://127.0.0.1:56891') {
      const url = new URL(pathAndQuery, origin);
      const route = routes.find((item) => item.path === url.pathname);
      if (!route) {
        return new Response(JSON.stringify({ ok: false, error: { code: 'GM-4042', message: 'not found' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (init.method && !route.methods.includes(init.method)) {
        return new Response(JSON.stringify({ ok: false, error: { code: 'GM-4004', message: 'method' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      const request = new Request(url.toString(), {
        method: init.method || 'GET',
        headers: init.headers,
        body: init.body,
      });
      return route.fetch(request);
    },
  };
}

export function createTempHome(prefix = 'dsh-game-market-test-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    dataRoot: path.join(dir, 'storages', 'dsh-game-market'),
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}
