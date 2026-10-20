#!/usr/bin/env node
/**
 * M0 S-A1 — opaque-origin sandbox multi-file resource probe.
 *
 * Proves, with a real installed DSH build + a real browser, whether a
 * `sandbox="allow-scripts"` iframe (opaque origin, no allow-same-origin) can
 * load an independent multi-file game package (classic JS, ESM, CSS, PNG,
 * fetch(JSON), audio) through the target M1 resource-service design, and what
 * exact response headers that service must send.
 *
 * What is "platform existing capability" vs "M0 target design":
 *   - EXISTING: the installed `dsh web` host, the project Host plugin loaded
 *     through an isolated profile, the DSH `/api` Origin/auth fence, the
 *     production `/entry` route + production CSP builder, the Runtime iframe
 *     attributes from packages/runtime/src/controller.js.
 *   - TARGET DESIGN (M1): the probe's instance-bound resource route
 *     (`/res/<instance>/<token>/<path>`), one-shot launch credential, CORS and
 *     CSP headers. It is implemented in scripts/verification/v1.5/assets/lib/
 *     probe-service.mjs — NOT wired into production routes.
 *
 * Safety: every DSH_HOME is created under /tmp/dsh-v15 (never ~/.dsh), no file
 * under /Applications is modified, no allow-same-origin is used, and all
 * credentials are redacted before evidence is written.
 *
 * Usage:
 *   node scripts/verification/v1.5/assets/probe-resources.mjs
 *   node scripts/verification/v1.5/assets/probe-resources.mjs --keep   # keep /tmp work dirs
 *
 * Exit code: 0 only when every required check passes; 1 otherwise (or on error).
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
  ASAR_ROOT,
} from '../lib/harness.mjs';
import { ensureFixturePackage, checkFixturePackage } from './gen-fixtures.mjs';
import {
  createProbeResourceService,
  createThirdPartyService,
  candidateContentSecurityPolicy,
  DEFAULT_TTL_MS,
} from './lib/probe-service.mjs';

// ---------------------------------------------------------------------------
// Constants / paths
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKTREE = path.resolve(HERE, '../../../..');
const FIXTURE_ROOT = path.join(HERE, 'fixture-package');
const OUT_DIR = path.join(WORKTREE, 'docs/verification/v1.5/raw/resources');
const SHOT_DIR = path.join(OUT_DIR, 'screenshots');

const HOME_NAME = 'probe-resources';
const PLUGIN_ID = 'dsh-game-market';
const PORTS = Object.freeze({
  bootstrap: 58260,
  host: 58261,
  resource: 58262,
  thirdParty: 58263,
  chrome: 9495,
});
const HOST_ORIGIN = `http://127.0.0.1:${PORTS.host}`;
const IFRAME_ID = 'probe-assets-frame';

const KEEP = process.argv.includes('--keep');

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function nodeRequest(port, { method = 'GET', path: requestPath = '/', headers = {}, body = null, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const request = http.request({ host: '127.0.0.1', port, method, path: requestPath, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          status: response.statusCode,
          headers: response.headers,
          bodyPrefix: buffer.subarray(0, 200).toString('utf8'),
          bytes: buffer.length,
        });
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('request timeout'));
    });
    request.on('error', (error) => resolve({ status: 0, error: String(error && error.message) }));
    if (body !== null) request.write(body);
    request.end();
  });
}

async function waitFor(check, timeoutMs = 10000, stepMs = 200) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await check();
      if (value) return value;
    } catch (_error) {
      // keep polling
    }
    await sleep(stepMs);
  }
  return null;
}

function pickHeaders(headers, names) {
  const out = {};
  for (const name of names) {
    const value = headers[name] ?? headers[name.toLowerCase()];
    if (value !== undefined) out[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

function redactPathname(pathname) {
  return String(pathname)
    .replace(/\/res\/[a-f0-9]{32}\/[a-f0-9]{32}\//g, '/res/<instance>/<token>/')
    .replace(/launch=[^&]+/g, 'launch=<redacted>');
}

function redactQuery(query) {
  return String(query || '').replace(/launch=[^&]+/g, 'launch=<redacted>');
}

// ---------------------------------------------------------------------------
// CDP capture: OOPIF (sandboxed/opaque-origin iframe) sessions, network, logs
// ---------------------------------------------------------------------------

function createCdpCapture(cdp) {
  const state = {
    attached: [],
    detached: [],
    sessions: new Map(),
    network: new Map(),
    networkOrder: [],
    logs: [],
    consoleEntries: [],
    exceptions: [],
    contexts: [],
  };

  const originalOnMessage = cdp.ws.onmessage;
  cdp.ws.onmessage = (event) => {
    originalOnMessage(event);
    let message;
    try {
      message = JSON.parse(event.data);
    } catch (_error) {
      return;
    }
    const sid = message.sessionId || null;
    const params = message.params || {};
    switch (message.method) {
      case 'Target.attachedToTarget': {
        const info = params.targetInfo || {};
        const record = {
          sessionId: params.sessionId,
          type: info.type,
          url: info.url,
          attachedAt: Date.now(),
          waitingForDebugger: params.waitingForDebugger === true,
        };
        state.attached.push(record);
        state.sessions.set(params.sessionId, record);
        // Capture from the very first request: enable domains inside the
        // debugger pause, then release the new target.
        Promise.allSettled([
          cdp.send('Network.enable', {}, params.sessionId),
          cdp.send('Log.enable', {}, params.sessionId),
          cdp.send('Runtime.enable', {}, params.sessionId),
          cdp.send('Page.enable', {}, params.sessionId),
        ]).then(() => {
          if (params.waitingForDebugger) cdp.send('Runtime.runIfWaitingForDebugger', {}, params.sessionId);
        });
        return;
      }
      case 'Target.targetInfoChanged': {
        const record = state.sessions.get(params.targetInfo && params.targetInfo.targetId);
        if (record) record.url = (params.targetInfo && params.targetInfo.url) || record.url;
        return;
      }
      case 'Target.detachedFromTarget':
        state.detached.push({ sessionId: params.sessionId, at: Date.now() });
        state.sessions.delete(params.sessionId);
        return;
      case 'Runtime.executionContextCreated':
        state.contexts.push({ sessionId: sid, context: params.context });
        return;
      case 'Network.requestWillBeSent': {
        const value = {
          sessionId: sid,
          requestId: params.requestId,
          url: params.request && params.request.url,
          method: params.request && params.request.method,
          resourceType: params.type,
          at: Date.now(),
          requestHeaders: (params.request && params.request.headers) || null,
        };
        state.network.set(`${sid}:${params.requestId}`, value);
        state.networkOrder.push(value);
        return;
      }
      case 'Network.requestWillBeSentExtraInfo': {
        const value = state.network.get(`${sid}:${params.requestId}`);
        if (value) value.actualRequestHeaders = params.headers || null;
        return;
      }
      case 'Network.responseReceived': {
        const value = state.network.get(`${sid}:${params.requestId}`);
        if (value) {
          value.status = params.response && params.response.status;
          value.statusText = params.response && params.response.statusText;
          value.mimeType = params.response && params.response.mimeType;
          value.responseHeaders = (params.response && params.response.headers) || null;
          value.fromDiskCache = Boolean(params.response && params.response.fromDiskCache);
        }
        return;
      }
      case 'Network.loadingFailed': {
        let value = state.network.get(`${sid}:${params.requestId}`);
        if (!value) {
          value = { sessionId: sid, requestId: params.requestId, url: null, resourceType: params.type, at: Date.now() };
          state.network.set(`${sid}:${params.requestId}`, value);
          state.networkOrder.push(value);
        }
        value.failed = true;
        value.errorText = params.errorText;
        value.blockedReason = params.blockedReason || null;
        value.canceled = params.canceled === true;
        return;
      }
      case 'Log.entryAdded': {
        const entry = params.entry || {};
        state.logs.push({
          sessionId: sid,
          at: Date.now(),
          level: entry.level,
          source: entry.source,
          text: String(entry.text || '').slice(0, 400),
          url: entry.url || null,
        });
        return;
      }
      case 'Runtime.consoleAPICalled': {
        state.consoleEntries.push({
          sessionId: sid,
          at: Date.now(),
          type: params.type,
          text: (params.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ').slice(0, 400),
        });
        return;
      }
      case 'Runtime.exceptionThrown': {
        const details = params.exceptionDetails || {};
        state.exceptions.push({
          sessionId: sid,
          at: Date.now(),
          text: String(((details.exception && details.exception.description) || details.text || '')).slice(0, 400),
        });
        return;
      }
      default:
        return;
    }
  };

  return {
    state,
    get attached() {
      return state.attached;
    },
    async start() {
      // Pause brand-new targets (the sandboxed iframe is an OOPIF) so Network/
      // Log can be enabled before its first request.
      await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    },
    iframeSessions() {
      return state.attached.filter((record) => record.type === 'iframe');
    },
    async waitForNewIframe(previousCount, timeoutMs = 12000) {
      const found = await waitFor(() => {
        const frames = state.attached.filter((record) => record.type === 'iframe');
        return frames.length > previousCount ? frames[frames.length - 1] : null;
      }, timeoutMs, 150);
      return found;
    },
    async evaluate(sessionId, expression) {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (result && result.exceptionDetails) {
        const text = ((result.exceptionDetails.exception || {}).description) || result.exceptionDetails.text;
        throw new Error(`iframe evaluate failed: ${String(text).slice(0, 300)}`);
      }
      return result && result.result ? result.result.value : null;
    },
    slice(counters) {
      return {
        network: state.networkOrder.slice(counters.network),
        logs: state.logs.slice(counters.logs),
        consoleEntries: state.consoleEntries.slice(counters.console),
        exceptions: state.exceptions.slice(counters.exceptions),
      };
    },
    counters() {
      return {
        network: state.networkOrder.length,
        logs: state.logs.length,
        console: state.consoleEntries.length,
        exceptions: state.exceptions.length,
      };
    },
  };
}

function sanitiseNetworkEntry(entry, secrets) {
  const headers = entry.responseHeaders || {};
  const requestHeaders = entry.actualRequestHeaders || entry.requestHeaders || {};
  const pick = (source, names) => {
    const out = {};
    for (const name of names) {
      const key = Object.keys(source).find((candidate) => candidate.toLowerCase() === name);
      if (key !== undefined) out[name] = String(source[key]);
    }
    return out;
  };
  return redactSecrets(
    {
      sessionId: entry.sessionId,
      requestId: entry.requestId,
      method: entry.method,
      url: redactUrl(entry.url),
      resourceType: entry.resourceType,
      status: entry.status ?? null,
      mimeType: entry.mimeType ?? null,
      failed: entry.failed === true,
      errorText: entry.errorText ?? null,
      blockedReason: entry.blockedReason ?? null,
      fromDiskCache: entry.fromDiskCache === true,
      responseHeaders: pick(headers, [
        'content-type',
        'access-control-allow-origin',
        'x-content-type-options',
        'cache-control',
        'referrer-policy',
        'content-security-policy',
      ]),
      requestHeaders: pick(requestHeaders, ['origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest']),
    },
    secrets
  );
}

function redactUrl(url) {
  if (typeof url !== 'string') return url;
  return url
    .replace(/\/res\/[a-f0-9]{32}\/[a-f0-9]{32}\//g, '/res/<instance>/<token>/')
    .replace(/([?&])launch=[^&]*/g, '$1launch=<redacted>')
    .replace(/([?&])token=[^&]*/g, '$1token=<redacted>')
    // Production /launch entryUrl carries instance= and nonce= credentials.
    .replace(/([?&])instance=[a-f0-9]{32}/g, '$1instance=<instance>')
    .replace(/([?&])nonce=[a-f0-9]{32}/g, '$1nonce=<launch-nonce>');
}

/**
 * Replace every known live credential with a stable, readable placeholder.
 * `pairs` is a list of [secret, placeholder]; longer secrets are replaced first.
 */
function redactSecrets(value, pairs) {
  const ordered = pairs
    .filter(([secret]) => typeof secret === 'string' && secret.length >= 8)
    .sort((a, b) => b[0].length - a[0].length);
  if (ordered.length === 0) {
    return typeof value === 'string' ? redactUrl(value) : value;
  }
  if (typeof value === 'string') {
    let out = redactUrl(value);
    for (const [secret, placeholder] of ordered) out = out.split(secret).join(placeholder);
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, ordered));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSecrets(item, ordered)]));
  }
  return value;
}

/** Build the redaction table from every live instance created by the probe. */
function secretPairs() {
  const pairs = [];
  if (!resourceService) return pairs;
  for (const instance of resourceService.snapshot().instances) {
    pairs.push([instance.resourceToken, '<token>']);
    pairs.push([instance.launchNonce, '<launch-nonce>']);
    pairs.push([instance.instanceId, '<instance>']);
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Browser scenario helpers
// ---------------------------------------------------------------------------

async function createSandboxedIframe(cdp, { src, id, title = 'Game: probe-orbit' }) {
  return cdp.eval(`(() => {
    const existing = document.getElementById(${JSON.stringify(id)});
    if (existing) existing.remove();
    // Attributes mirror packages/runtime/src/controller.js exactly:
    // sandbox="allow-scripts" (no allow-same-origin), allow=autoplay,
    // referrerpolicy=no-referrer, loading=eager.
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('allow', 'autoplay');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('loading', 'eager');
    frame.setAttribute('title', ${JSON.stringify(title)});
    frame.id = ${JSON.stringify(id)};
    frame.src = ${JSON.stringify(src)};
    frame.style.cssText = 'position:fixed;left:24px;top:92px;width:900px;height:620px;border:2px solid #37b;border-radius:6px;z-index:2147483000;background:#000;display:block;box-shadow:0 8px 30px rgba(0,0,0,.45)';
    document.body.appendChild(frame);
    const rect = frame.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, clientLeft: frame.clientLeft, clientTop: frame.clientTop };
  })()`);
}

async function removeIframe(cdp, id) {
  try {
    await cdp.eval(`(() => { const frame = document.getElementById(${JSON.stringify(id)}); if (frame) frame.remove(); return true; })()`);
  } catch (_error) {
    // page may be navigating
  }
}

async function waitProbeDone(capture, sessionId, timeoutMs = 25000) {
  return waitFor(async () => {
    const done = await capture.evaluate(
      sessionId,
      'Boolean(window.__ASSETS_PROBE__ && window.__ASSETS_PROBE__.done)'
    );
    return done === true;
  }, timeoutMs, 250);
}

async function iframeDomSnapshot(capture, sessionId, probeState) {
  try {
    return await capture.evaluate(
      sessionId,
      `(() => {
        const state = window.__ASSETS_PROBE__ || null;
        return {
          origin: location.origin,
          pathname: location.pathname.replace(/[a-f0-9]{32}/g, '<id>'),
          title: document.title,
          hasBody: Boolean(document.body),
          classicMarker: Boolean(window.__PROBE_CLASSIC__),
          probePresent: Boolean(state),
          probeDone: Boolean(state && state.done),
          styleSheetCount: document.styleSheets.length,
          bodyBackground: document.body ? getComputedStyle(document.body).backgroundColor : null,
          scriptCount: document.scripts.length,
          moduleScriptCount: [...document.scripts].filter((script) => script.type === 'module').length,
          images: [...document.querySelectorAll('img')].map((img) => ({ id: img.id, complete: img.complete, naturalWidth: img.naturalWidth })),
          hud: document.getElementById('hud') ? document.getElementById('hud').textContent : null,
        };
      })()`
    );
  } catch (error) {
    return { evaluateError: String(error.message).slice(0, 300) };
  }
}

async function dispatchTrustedClick(cdp, capture, sessionId, iframeRect) {
  const point = await capture.evaluate(
    sessionId,
    `(() => {
      const button = document.getElementById('unlock');
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`
  );
  if (!point) return false;
  const x = Math.round(iframeRect.left + (iframeRect.clientLeft || 0) + point.x);
  const y = Math.round(iframeRect.top + (iframeRect.clientTop || 0) + point.y);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  return true;
}

async function screenshot(cdp, name, clip = null) {
  const file = path.join(SHOT_DIR, `${name}.png`);
  await cdp.shot(file, clip ? { clip } : {});
  return path.relative(WORKTREE, file);
}

function filterSessionEntries(entries, sessionId) {
  return entries.filter((entry) => entry.sessionId === sessionId);
}

function summariseResourceLog(entries, instanceId) {
  return entries
    .filter((entry) => (entry.instance && entry.instance.instanceId === instanceId) || entry.instanceId === instanceId)
    .map((entry) => ({
      seq: entry.seq,
      route: entry.route,
      method: entry.method,
      path: redactPathname(entry.path),
      query: redactQuery(entry.query),
      status: entry.status,
      rel: entry.rel ?? null,
      bytes: entry.bytes ?? null,
      origin: entry.origin ?? null,
      referer: entry.referer ?? null,
      secFetchSite: entry.secFetchSite ?? null,
      launchConsumed: entry.instance ? entry.instance.launchConsumed : null,
      responseHeaders: entry.responseHeaders ?? null,
      event: entry.event ?? null,
    }));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const report = createReport({
  id: 'S-A1',
  title: 'opaque-origin sandbox multi-file resource loading + isolation',
  commands: ['node scripts/verification/v1.5/assets/gen-fixtures.mjs --check', 'node scripts/verification/v1.5/assets/probe-resources.mjs'],
});

const evidence = {
  generatedAt: new Date().toISOString(),
  worktree: WORKTREE,
  probeHarnessWork: WORK,
  asarRoot: ASAR_ROOT,
  ports: PORTS,
  scenarios: {},
};

let host = null;
let resourceService = null;
let thirdParty = null;
let cdp = null;
let capture = null;

async function run() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  // ---- 0. Preflight -------------------------------------------------------
  ensureRuntime();
  const identity = runtimeIdentity();
  evidence.runtimeIdentity = identity;
  report.add('runtime-installed-dsh-0.2.1-rc.2', identity.dshPackage.version === '0.2.1-rc.2', identity);

  const fixtureGen = ensureFixturePackage();
  const fixtureState = checkFixturePackage();
  report.add('fixture-package-manifest-verified', fixtureState.ok, { problems: fixtureState.problems ?? [] });
  evidence.fixture = {
    root: path.relative(WORKTREE, FIXTURE_ROOT),
    regeneratedFiles: fixtureGen.written,
    descriptor: fixtureState.manifest,
  };

  const controllerSource = fs.readFileSync(path.join(WORKTREE, 'packages/runtime/src/controller.js'), 'utf8');
  // Strip comments: the security-invariant comment mentions the forbidden
  // token on purpose; only real code/attribute values must be checked.
  const controllerCode = controllerSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const sandboxLine = controllerCode.match(/setAttribute\('sandbox',\s*'([^']+)'\)/);
  evidence.platformFacts = {
    runtimeSandboxAttribute: sandboxLine ? sandboxLine[1] : null,
    runtimeUsesAllowSameOrigin: /allow-same-origin/.test(controllerCode),
    iframeAllowAttribute: /setAttribute\('allow',\s*'autoplay'\)/.test(controllerCode),
    referrerPolicyAttribute: /setAttribute\('referrerpolicy',\s*'no-referrer'\)/.test(controllerCode),
  };
  report.add('runtime-keeps-sandbox-allow-scripts-only', sandboxLine !== null && sandboxLine[1] === 'allow-scripts' && !evidence.platformFacts.runtimeUsesAllowSameOrigin, evidence.platformFacts);

  const packageJson = JSON.parse(fs.readFileSync(path.join(WORKTREE, 'package.json'), 'utf8'));
  evidence.bundleVersion = packageJson.version;

  // ---- 1. Isolated DSH home + project Host plugin --------------------------
  const home = await makeHome(HOME_NAME, { port: PORTS.bootstrap });
  if (!home.startsWith(WORK) || home.includes('/.dsh')) {
    throw new Error(`refusing to use a non-isolated DSH_HOME: ${home}`);
  }
  const patchPath = injectProbeRow(home, {
    id: PLUGIN_ID,
    entry: path.join(WORKTREE, 'index.js'),
    config: { devMode: true },
  });
  evidence.isolatedHost = {
    dshHome: home,
    patchPath,
    pluginEntry: path.join(WORKTREE, 'index.js'),
    neverTouchesUserProfile: !home.includes('/.dsh') && home.startsWith('/tmp/'),
  };
  report.add('isolated-dsh-home-under-tmp', evidence.isolatedHost.neverTouchesUserProfile, evidence.isolatedHost);

  host = await startHost(home, { port: PORTS.host, logName: 'resources-host' });
  evidence.isolatedHost.url = '<redacted:token-in-query>';
  evidence.hostLogPath = host.logPath;

  // ---- 2. M0 probe resource service + third-party origin -------------------
  resourceService = createProbeResourceService({
    packageRoot: FIXTURE_ROOT,
    port: PORTS.resource,
    frameAncestorOrigin: HOST_ORIGIN,
    queryExtras: { host: HOST_ORIGIN, evil: `http://127.0.0.1:${PORTS.thirdParty}` },
    ttlMs: DEFAULT_TTL_MS,
  });
  const resourceInfo = await resourceService.start();
  thirdParty = createThirdPartyService({ port: PORTS.thirdParty });
  const thirdPartyInfo = await thirdParty.start();
  evidence.probeService = {
    origin: resourceInfo.origin,
    thirdPartyOrigin: thirdPartyInfo.origin,
    packageFiles: resourceService.packageInfo().files,
    targetCsp: candidateContentSecurityPolicy({ resourceOrigin: resourceInfo.origin, frameAncestorOrigin: HOST_ORIGIN }),
    productionCspForComparison: null, // filled with the real production builder output below
    note: 'M0 target design, not a production route (M1 implements the real service).',
  };
  evidence.probeService.productionCspForComparison = (
    await import('../../../../packages/host/src/entry.js')
  ).buildContentSecurityPolicy(resourceInfo.origin, { frameAncestors: [HOST_ORIGIN] });

  // ---- 3. Browser ---------------------------------------------------------
  cdp = await Cdp.launch({ port: PORTS.chrome });
  capture = createCdpCapture(cdp);
  await capture.start();
  await cdp.navigate(host.url);
  const booted = await waitFor(() => cdp.eval(`document.readyState === 'complete' && Boolean(document.body)`), 30000, 500);
  report.add('real-dsh-page-loaded', Boolean(booted));
  await sleep(4000);

  // The Host plugin must be live inside the real host: same-origin fetch works.
  const health = await cdp.eval(`fetch('/api/game-market/health').then(async (response) => ({ status: response.status, body: await response.json() })).catch((error) => ({ error: String(error) }))`);
  evidence.platformHealth = health;
  const healthOk = Boolean(health && health.status === 200 && health.body && health.body.ok === true && health.body.data && health.body.data.version === packageJson.version);
  report.add('project-host-plugin-live-in-isolated-host', healthOk, {
    status: health && health.status,
    version: health && health.body && health.body.data && health.body.data.version,
    expectedVersion: packageJson.version,
  });
  await screenshot(cdp, 'dh-00-dsh-page-loaded');

  // Auth cookie for direct Host API fence checks (kept in memory only).
  const cookieBundle = await cdp.send('Network.getCookies', { urls: [`${HOST_ORIGIN}/`] });
  const authCookie = (cookieBundle.cookies || []).find((cookie) => cookie.name.startsWith('dsh-auth-'));
  const cookieHeader = authCookie ? `${authCookie.name}=${authCookie.value}` : null;
  evidence.hostFenceCookie = authCookie
    ? { present: true, namePrefix: 'dsh-auth-…', sameSite: authCookie.sameSite, httpOnly: authCookie.httpOnly, secure: authCookie.secure, value: '<redacted>' }
    : { present: false };
  report.add('browser-auth-cookie-present', Boolean(cookieHeader));

  // ---- 4. Platform baseline: production /entry single-file package --------
  evidence.scenarios.platformEntry = await runPlatformEntryScenario();
  // ---- 5. Target design: multi-file package with candidate CSP ------------
  evidence.scenarios.candidate = await runMultiFileScenario({ name: 'candidate', variant: 'candidate', expectBlocked: false });
  // ---- 6. Control: the current production CSP cannot serve it ------------
  evidence.scenarios.legacyCsp = await runMultiFileScenario({ name: 'legacy-csp', variant: 'legacy', expectBlocked: true });
  // ---- 7. Control: `'self'`-only CSP (cannot authorize an opaque origin) --
  evidence.scenarios.selfCsp = await runMultiFileScenario({ name: 'self-csp', variant: 'self', expectBlocked: true });
  // ---- 8. Control: no CSP at all (isolates CORS behaviour) ----------------
  evidence.scenarios.noCsp = await runMultiFileScenario({ name: 'no-csp', variant: 'none', expectBlocked: false });

  // ---- 8. HTTP credential / path matrix against the probe service --------
  evidence.httpMatrix = await runHttpMatrix();
  // ---- 9. Direct Host API Origin fence matrix ----------------------------
  evidence.hostFence = await runHostFenceMatrix(cookieHeader);

  // ---- 10. Assertions -----------------------------------------------------
  assertPlatformEntry(evidence.scenarios.platformEntry);
  assertCandidate(evidence.scenarios.candidate);
  assertLegacyControl(evidence.scenarios.legacyCsp);
  assertSelfCspControl(evidence.scenarios.selfCsp);
  assertNoCspControl(evidence.scenarios.noCsp);
  assertHttpMatrix(evidence.httpMatrix);
  assertHostFence(evidence.hostFence);

  // ---- 11. Cleanup --------------------------------------------------------
  await removeIframe(cdp, IFRAME_ID);
}

// ---------------------------------------------------------------------------
// Scenario: production /entry (existing platform capability)
// ---------------------------------------------------------------------------

async function runPlatformEntryScenario() {
  const scenario = { name: 'platform-entry', kind: 'existing-capability' };
  try {
    // Launch a real builtin single-file game through the real Host API.
    const launch = await cdp.eval(`fetch('/api/game-market/launch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'snake', mode: 'start', dshSessionId: 'probe-session' })
    }).then(async (response) => ({ status: response.status, body: await response.json() })).catch((error) => ({ error: String(error) }))`);
    scenario.launch = { status: launch.status, ok: Boolean(launch.body && launch.body.ok) };
    if (!launch.body || launch.body.ok !== true) throw new Error(`launch failed: ${JSON.stringify(launch).slice(0, 300)}`);
    const entryUrl = new URL(launch.body.data.entryUrl, HOST_ORIGIN).toString();
    scenario.entryUrlPath = redactUrl(entryUrl);

    // Nav-like GET with auth cookie: the current platform serves the HTML.
    const cookieBundle = await cdp.send('Network.getCookies', { urls: [`${HOST_ORIGIN}/`] });
    const authCookie = (cookieBundle.cookies || []).find((cookie) => cookie.name.startsWith('dsh-auth-'));
    const cookieHeader = authCookie ? `${authCookie.name}=${authCookie.value}` : null;
    const entryPath = new URL(entryUrl).pathname + new URL(entryUrl).search;
    const navLike = await nodeRequest(PORTS.host, { headers: cookieHeader ? { cookie: cookieHeader } : {} , path: entryPath});
    scenario.entryHeaders = {
      status: navLike.status,
      headers: pickHeaders(navLike.headers, [
        'content-type',
        'content-security-policy',
        'cache-control',
        'x-content-type-options',
        'referrer-policy',
        'content-length',
        'x-entry-sha256',
        'access-control-allow-origin',
      ]),
    };
    const repeat = await nodeRequest(PORTS.host, { headers: cookieHeader ? { cookie: cookieHeader } : {}, path: entryPath });
    scenario.repeatGetStatus = repeat.status;
    const originNull = await nodeRequest(PORTS.host, {
      headers: { ...(cookieHeader ? { cookie: cookieHeader } : {}), origin: 'null' },
      path: entryPath,
    });
    scenario.fetchWithOriginNull = { status: originNull.status, bodyPrefix: String(originNull.bodyPrefix || '').slice(0, 60) };
    const originSelf = await nodeRequest(PORTS.host, {
      headers: { ...(cookieHeader ? { cookie: cookieHeader } : {}), origin: HOST_ORIGIN },
      path: entryPath,
    });
    scenario.fetchWithSameOrigin = { status: originSelf.status };

    // The existing sandboxed iframe loads the production single-file game.
    const beforeSessions = capture.attached.length;
    const rect = await createSandboxedIframe(cdp, { src: entryUrl, id: `${IFRAME_ID}-platform`, title: 'Game: snake' });
    const session = await capture.waitForNewIframe(beforeSessions, 15000);
    scenario.iframeSessionAttached = Boolean(session);
    if (session) {
      const ready = await waitFor(() => capture.evaluate(session.sessionId, `Boolean(document.body && (document.querySelector('canvas') || document.querySelector('#game, .game')))`), 15000, 300);
      scenario.domReady = Boolean(ready);
      scenario.dom = await iframeDomSnapshot(capture, session.sessionId, null);
      // The document request itself starts before the OOPIF target attaches, so
      // the renderer Network domain does not always report it. The iframe's own
      // PerformanceNavigationTiming is browser-side evidence of the response.
      scenario.navigationTiming = await capture
        .evaluate(
          session.sessionId,
          `(() => {
            const nav = performance.getEntriesByType('navigation')[0];
            return nav ? {
              responseStatus: typeof nav.responseStatus === 'number' ? nav.responseStatus : null,
              contentType: typeof nav.contentType === 'string' ? nav.contentType : null,
              encodedBodySize: nav.encodedBodySize ?? null,
              durationMs: Math.round(nav.duration),
            } : null;
          })()`
        )
        .catch((error) => ({ error: String(error.message).slice(0, 200) }));
      const net = capture.state.networkOrder;
      scenario.entryResponse = net
        .filter((entry) => entry.url && entry.url.includes('/api/game-market/entry'))
        .map((entry) => sanitiseNetworkEntry(entry, secretPairs()));
    }
    await sleep(800);
    scenario.screenshot = await screenshot(cdp, 'dh-01-platform-entry-single-file');
    await removeIframe(cdp, `${IFRAME_ID}-platform`);
    await sleep(400);
  } catch (error) {
    scenario.error = String(error && error.message).slice(0, 400);
  }
  return scenario;
}

// ---------------------------------------------------------------------------
// Scenario: multi-file package in a sandboxed iframe
// ---------------------------------------------------------------------------

async function runMultiFileScenario({ name, variant, expectBlocked = false }) {
  const scenario = {
    name,
    variant,
    expectBlocked,
    description:
      variant === 'candidate'
        ? 'Target M1 design: instance-bound resource credential in path + anonymous CORS + explicit resource-origin CSP.'
        : variant === 'legacy'
          ? 'Control: the production V1.2 CSP builder output applied to a multi-file entry (expected to block subresources).'
          : variant === 'self'
            ? "Measured control: a 'self'-only CSP on a sandboxed opaque-origin document (Chromium resolves 'self' against the entry URL origin)."
            : 'Control: same resource service without any CSP header (isolates CORS and shows why CSP is required).',
  };
  const instance = resourceService.createInstance();
  scenario.instance = { instanceId: instance.instanceId, ttlMs: instance.ttl };
  const entryUrl = resourceService.entryUrl(instance, { variant });
  scenario.entry = {
    url: redactUrl(entryUrl),
    path: `/res/<instance>/<token>/${instance.gameId}/${'index.html'}`,
    variant,
    oneShotLaunchCredential: true,
  };
  const logStart = resourceService.requestLog().length;
  const counters = capture.counters();
  const beforeSessions = capture.attached.length;
  let iframeRect = null;
  try {
    iframeRect = await createSandboxedIframe(cdp, { src: entryUrl, id: IFRAME_ID });
    const session = await capture.waitForNewIframe(beforeSessions, 15000);
    scenario.iframeSessionAttached = Boolean(session);
    if (!session) throw new Error('sandboxed iframe did not attach as a debuggable OOPIF target');
    scenario.sessionId = session.sessionId;

    const done = await waitProbeDone(capture, session.sessionId, variant === 'legacy' ? 6000 : 25000);
    scenario.probeScriptRan = Boolean(done);
    scenario.dom = await iframeDomSnapshot(capture, session.sessionId, null);

    if (done) {
      // Trusted click for the audio gesture gate.
      const clicked = await dispatchTrustedClick(cdp, capture, session.sessionId, iframeRect);
      scenario.trustedClickDispatched = Boolean(clicked);
      await sleep(900);
      scenario.probe = await capture.evaluate(session.sessionId, 'window.__ASSETS_PROBE__ || null');
    } else {
      scenario.probe = null;
    }

    await sleep(500);
    scenario.screenshot = await screenshot(cdp, `dh-02-${name}-full`);
    scenario.iframeScreenshot = await screenshot(cdp, `dh-02-${name}-iframe`, {
      x: iframeRect.left,
      y: iframeRect.top,
      width: Math.min(iframeRect.width, 900),
      height: Math.min(iframeRect.height, 620),
      scale: 1,
    });

    const entries = capture.slice(counters);
    scenario.browser = {
      network: filterSessionEntries(entries.network, session.sessionId)
        .filter((entry) => entry.url && !entry.url.startsWith('data:'))
        .map((entry) => sanitiseNetworkEntry(entry, secretPairs())),
      logEntries: filterSessionEntries(entries.logs, session.sessionId).map((entry) => ({
        level: entry.level,
        source: entry.source,
        text: entry.text,
        url: redactUrl(entry.url),
      })),
      consoleEntries: filterSessionEntries(entries.consoleEntries, session.sessionId),
      exceptions: filterSessionEntries(entries.exceptions, session.sessionId).map((entry) => ({ text: entry.text })),
    };
    scenario.httpRequests = summariseResourceLog(resourceService.requestLog().slice(logStart), instance.instanceId);
  } catch (error) {
    scenario.error = String(error && error.message).slice(0, 500);
  } finally {
    await removeIframe(cdp, IFRAME_ID);
    await sleep(400);
  }
  return scenario;
}

// ---------------------------------------------------------------------------
// HTTP credential / path matrix (direct, no browser)
// ---------------------------------------------------------------------------

async function runHttpMatrix() {
  const matrix = { cases: [] };
  const serviceOrigin = resourceService.origin;
  const port = PORTS.resource;
  const record = (name, expectedStatus, request, extra = {}) => {
    const actual = request.status;
    matrix.cases.push({
      name,
      expectedStatus,
      status: actual,
      ok: expectedStatus === actual,
      headers: pickHeaders(request.headers || {}, [
        'access-control-allow-origin',
        'access-control-allow-methods',
        'x-content-type-options',
        'cache-control',
        'referrer-policy',
        'content-type',
        'content-length',
        'set-cookie',
        'content-security-policy',
      ]),
      bodyPrefix: String(request.bodyPrefix || '').slice(0, 80),
      ...extra,
    });
  };

  // Fresh instance for the matrix.
  const instance = resourceService.createInstance();
  const token = instance.resourceToken;
  const basePath = `/res/${instance.instanceId}/${token}`;
  const entryUrlPath = `${basePath}/index.html?launch=${instance.launchNonce}&variant=candidate`;
  const resourcePath = `${basePath}/levels/level-01.json`;

  const firstEntry = await nodeRequest(port, { path: entryUrlPath });
  record('entry-first-get-consumes-launch-credential', 200, firstEntry, { bodyHasMainScript: String(firstEntry.bodyPrefix || '').length > 0 });
  const replayEntry = await nodeRequest(port, { path: entryUrlPath });
  record('entry-replay-with-consumed-launch-credential', 410, replayEntry);
  const repeatEntryWithoutLaunch = await nodeRequest(port, { path: `${basePath}/index.html` });
  record('entry-repeat-get-via-resource-credential', 200, repeatEntryWithoutLaunch);
  const repeatResource = await nodeRequest(port, { path: resourcePath });
  record('resource-repeat-get-1', 200, repeatResource);
  const repeatResource2 = await nodeRequest(port, { path: resourcePath });
  record('resource-repeat-get-2', 200, repeatResource2);
  const headResource = await nodeRequest(port, { method: 'HEAD', path: `${basePath}/styles/game.css` });
  record('resource-head', 200, headResource, { bodyBytes: headResource.bytes });
  const postResource = await nodeRequest(port, { method: 'POST', path: resourcePath, headers: { 'content-type': 'application/json' }, body: '{}' });
  record('resource-post-rejected', 405, postResource);

  // Unknown / mismatched / missing credentials.
  record('unknown-instance', 403, await nodeRequest(port, { path: `/res/${'a'.repeat(32)}/${token}/index.html` }));
  record('wrong-resource-token', 403, await nodeRequest(port, { path: `/res/${instance.instanceId}/${'b'.repeat(32)}/index.html` }));
  const otherInstance = resourceService.createInstance();
  record(
    'cross-instance-token',
    403,
    await nodeRequest(port, { path: `/res/${instance.instanceId}/${otherInstance.resourceToken}/index.html` })
  );
  const freshForWrongLaunch = resourceService.createInstance();
  const freshBase = `/res/${freshForWrongLaunch.instanceId}/${freshForWrongLaunch.resourceToken}`;
  const wrongLaunch = await nodeRequest(port, { path: `${freshBase}/index.html?launch=${'c'.repeat(32)}` });
  record('wrong-launch-credential', 403, wrongLaunch);
  record('missing-resource-token-route', 404, await nodeRequest(port, { path: `/res/${instance.instanceId}/index.html` }));

  // Path traversal / canonicalisation / listing.
  const traversalPaths = [
    `${basePath}/%2e%2e%2findex.html`,
    `${basePath}/..%2f..%2fdsh-package.json`,
    `${basePath}/%252e%252e%252fdsh-package.json`,
    `${basePath}/assets/..%2f..%2findex.html`,
    `${basePath}/..%5c..%5cdsh-package.json`,
    `${basePath}/%2fetc%2fpasswd`,
    `${basePath}/%00index.html`,
    `${basePath}/not-in-manifest.txt`,
    `${basePath}/`,
    `${basePath}/assets/`,
    `${basePath}/assets/.hidden`,
  ];
  for (const rawPath of traversalPaths) {
    const response = await nodeRequest(port, { path: rawPath });
    const label = rawPath.replace(basePath, '<base>');
    matrix.cases.push({
      name: `reject-path:${label}`,
      expectedStatus: response.status === 403 || response.status === 404 ? response.status : '403/404',
      status: response.status,
      ok: response.status === 403 || response.status === 404,
      headers: pickHeaders(response.headers || {}, ['access-control-allow-origin', 'x-content-type-options', 'cache-control']),
    });
  }

  // TTL expiry + renew + release.
  const shortLived = resourceService.createInstance({ ttl: 600 });
  const shortBase = `/res/${shortLived.instanceId}/${shortLived.resourceToken}`;
  await sleep(700);
  record('expired-resource-credential', 403, await nodeRequest(port, { path: `${shortBase}/levels/level-01.json` }));
  const renewable = resourceService.createInstance({ ttl: 1200 });
  const renewBase = `/res/${renewable.instanceId}/${renewable.resourceToken}`;
  await sleep(500);
  matrix.renewResult = resourceService.renewInstance(renewable.instanceId) ? 'extended' : null;
  await sleep(800);
  record('renew-keeps-resource-credential-valid', 200, await nodeRequest(port, { path: `${renewBase}/levels/level-01.json` }));
  resourceService.releaseInstance(renewable.instanceId);
  record('released-instance-read-rejected', 403, await nodeRequest(port, { path: `${renewBase}/levels/level-01.json` }));

  // Every manifest file must be readable via the resource credential.
  const allFiles = resourceService.packageInfo().files;
  const fileMatrix = [];
  const live = resourceService.createInstance();
  const liveBase = `/res/${live.instanceId}/${live.resourceToken}`;
  for (const file of allFiles) {
    const response = await nodeRequest(port, { path: `${liveBase}/${file.rel}` });
    fileMatrix.push({
      rel: file.rel,
      status: response.status,
      mime: response.headers && response.headers['content-type'],
      acao: response.headers && response.headers['access-control-allow-origin'],
      nosniff: response.headers && response.headers['x-content-type-options'],
      cacheControl: response.headers && response.headers['cache-control'],
      bodyBytes: response.bytes,
      expectedBytes: file.size,
    });
  }
  matrix.manifestFiles = fileMatrix;

  // Response body sample for the JSON resource proves real content.
  const jsonProbe = await nodeRequest(port, { path: `${liveBase}/levels/level-01.json` });
  matrix.jsonSample = { status: jsonProbe.status, bodyPrefix: jsonProbe.bodyPrefix };
  matrix.serviceOrigin = serviceOrigin;
  return matrix;
}

// ---------------------------------------------------------------------------
// Direct Host API Origin fence matrix
// ---------------------------------------------------------------------------

async function runHostFenceMatrix(cookieHeader) {
  const cases = [];
  const run = (name, { method = 'GET', path = '/api/game-market/health', origin, useCookie = false, body = null, extraHeaders = {} } = {}) => {
    const headers = { ...extraHeaders };
    if (origin !== undefined) headers.origin = origin;
    if (useCookie && cookieHeader) headers.cookie = cookieHeader;
    if (body !== null) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(body));
    }
    return nodeRequest(PORTS.host, { method, path, headers, body }).then((response) => {
      cases.push({
        name,
        method,
        path,
        origin: origin === undefined ? null : origin,
        authenticated: useCookie && Boolean(cookieHeader),
        status: response.status,
        ok:
          name.startsWith('reject')
            ? response.status === 403
            : response.status === 200 || response.status === 401,
        bodyPrefix: String(response.bodyPrefix || '').slice(0, 60),
      });
      return response;
    });
  };

  await run('authenticated-same-origin-get', { origin: HOST_ORIGIN, useCookie: true }).then((response) => {
    cases[cases.length - 1].ok = response.status === 200;
  });
  await run('authenticated-no-origin-get', { useCookie: true }).then((response) => {
    cases[cases.length - 1].ok = response.status === 200;
  });
  await run('reject-origin-null-get', { origin: 'null', useCookie: true }).then((response) => {
    cases[cases.length - 1].ok = response.status === 403;
  });
  await run('reject-third-party-origin-get', { origin: 'http://evil.example', useCookie: true }).then((response) => {
    cases[cases.length - 1].ok = response.status === 403;
  });
  await run('reject-origin-null-write', {
    method: 'POST',
    path: '/api/game-market/preferences',
    origin: 'null',
    useCookie: true,
    body: JSON.stringify({ probeWrite: true }),
  }).then((response) => {
    cases[cases.length - 1].ok = response.status === 403;
  });
  await run('reject-unauthenticated-same-origin-write', {
    method: 'POST',
    path: '/api/game-market/preferences',
    origin: HOST_ORIGIN,
    body: JSON.stringify({ probeWrite: true }),
  }).then((response) => {
    cases[cases.length - 1].ok = response.status === 401;
  });
  await run('accept-authenticated-same-origin-write', {
    method: 'POST',
    path: '/api/game-market/preferences',
    origin: HOST_ORIGIN,
    useCookie: true,
    body: JSON.stringify({ probeWrite: true }),
  }).then((response) => {
    cases[cases.length - 1].ok = response.status === 200;
  });

  return {
    hostOrigin: HOST_ORIGIN,
    cookiePresent: Boolean(cookieHeader),
    platformFence: 'DSH client-connection isTrustedApiRequest: trusted Host + Origin must equal the listener authority',
    cases,
  };
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

function assertPlatformEntry(scenario) {
  report.record('platform-entry.snapshot', scenario);
  report.add('platform-entry.production-entry-served-200', scenario.entryHeaders && scenario.entryHeaders.status === 200, {
    status: scenario.entryHeaders && scenario.entryHeaders.status,
  });
  report.add(
    'platform-entry.production-csp-is-inline-only',
    Boolean(
      scenario.entryHeaders &&
        scenario.entryHeaders.headers &&
        /script-src 'unsafe-inline'/.test(scenario.entryHeaders.headers['content-security-policy'] || '') &&
        /connect-src 'none'/.test(scenario.entryHeaders.headers['content-security-policy'] || '')
    ),
    { csp: scenario.entryHeaders && scenario.entryHeaders.headers && scenario.entryHeaders.headers['content-security-policy'] }
  );
  report.add('platform-entry.single-file-html-loads-in-sandbox', scenario.domReady === true, { dom: scenario.dom });
  report.add('platform-entry.entry-repeat-get-works', scenario.repeatGetStatus === 200, { status: scenario.repeatGetStatus });
  report.add('platform-entry.entry-with-origin-null-rejected', scenario.fetchWithOriginNull && scenario.fetchWithOriginNull.status === 403, scenario.fetchWithOriginNull);
  report.add('platform-entry.entry-with-same-origin-accepted', scenario.fetchWithSameOrigin && scenario.fetchWithSameOrigin.status === 200, scenario.fetchWithSameOrigin);
  const entryNet = (scenario.entryResponse || [])[0];
  const navStatus = scenario.navigationTiming && scenario.navigationTiming.responseStatus;
  report.add(
    'platform-entry.browser-observed-entry-response',
    navStatus === 200 || Boolean(entryNet && entryNet.status === 200),
    { navigationTiming: scenario.navigationTiming || null, networkEntry: entryNet || null }
  );
  report.add(
    'platform-entry.no-cors-header-on-entry',
    Boolean(scenario.entryHeaders && scenario.entryHeaders.headers && !scenario.entryHeaders.headers['access-control-allow-origin']),
    scenario.entryHeaders && scenario.entryHeaders.headers
  );
}

function assertCandidate(scenario) {
  const probe = scenario.probe || {};
  for (const [name, ok, detail] of [
    [
      'candidate.iframe-is-sandboxed-opaque-origin',
      probe.opaqueOrigin === true && probe.documentOrigin === 'null' && probe.urlOrigin === resourceServiceOrigin(),
      { documentOrigin: probe.documentOrigin, urlOrigin: probe.urlOrigin },
    ],
    ['candidate.classic-script-executed', Boolean(probe.classic && probe.classic.marker && probe.classic.marker.ok === true), probe.classic],
    ['candidate.static-esm-import-resolved', Boolean(probe.staticModule && probe.staticModule.moduleId === 'level-loader@probe-1'), probe.staticModule],
    ['candidate.dynamic-esm-import-resolved', Boolean(probe.dynamicImport && probe.dynamicImport.powerupId === 'powerup@probe-1'), probe.dynamicImport],
    ['candidate.stylesheet-applied', Boolean(probe.css && probe.css.sheets >= 1 && probe.css.applied === true), probe.css],
    ['candidate.image-decoded', Boolean(probe.image && probe.image.naturalWidth === 64 && probe.image.decoded === true), probe.image],
    ['candidate.cors-image-canvas-readable', Boolean(probe.image && probe.image.pixels && probe.image.pixels.readable && probe.image.pixels.nonTransparent > 0), probe.image && probe.image.pixels],
    ['candidate.no-cors-image-taints-canvas', Boolean(probe.imageNoCors && probe.imageNoCors.canvasTainted === true), probe.imageNoCors],
    ['candidate.json-fetch-repeated-200', Boolean(probe.levels && probe.levels.firstStatus === 200 && probe.levels.secondStatus === 200 && probe.levels.repeatedReadOk), probe.levels],
    ['candidate.json-content-parsed', Boolean(probe.levels && probe.levels.signature === 'level-01:5:1200'), probe.levels],
    ['candidate.head-request-200', Boolean(probe.head && probe.head.status === 200), probe.head],
    ['candidate.entry-one-shot-credential-410-on-replay', Boolean(probe.entryOneShot && probe.entryOneShot.status === 410), probe.entryOneShot],
    ['candidate.entry-repeatable-with-resource-credential', Boolean(probe.entryResourceRepeat && probe.entryResourceRepeat.status === 200 && probe.entryResourceRepeat.hasMainScript === true), probe.entryResourceRepeat],
    ['candidate.audio-media-element-ready', Boolean(probe.audio && probe.audio.mediaStatus === 200 && probe.audio.mediaReadyState >= 1), probe.audio],
    ['candidate.audio-decoded-via-audiocontext', Boolean(probe.audio && typeof probe.audio.decodedDuration === 'number' && Math.abs(probe.audio.decodedDuration - 0.2) < 0.03), probe.audio],
    [
      'candidate.audio-playback-after-trusted-gesture',
      Boolean(
        (probe.audioGesture && probe.audioGesture.afterGesture && probe.audioGesture.afterGesture.play === 'ok') ||
          (probe.audioGesture && probe.audioGesture.beforeGesture && probe.audioGesture.beforeGesture.played === true)
      ),
      probe.audioGesture,
    ],
    ['candidate.opaque-origin-cannot-read-host-api', Boolean(probe.hostApi && probe.hostApi.readBlocked === true), probe.hostApi],
    ['candidate.opaque-origin-cannot-write-host-api', Boolean(probe.hostApiWrite && probe.hostApiWrite.writeBlocked === true), probe.hostApiWrite],
    ['candidate.external-network-read-blocked', Boolean(probe.external && probe.external.readBlocked === true), probe.external],
    ['candidate.third-party-read-blocked', Boolean(probe.evil && probe.evil.readBlocked === true), probe.evil],
    ['candidate.csp-blocks-third-party-no-cors-image', Boolean(probe.evilImage && probe.evilImage.loaded === false), probe.evilImage],
    ['candidate.csp-blocks-third-party-no-cors-post', Boolean(probe.evilPost && probe.evilPost.sent === false), probe.evilPost],
    ['candidate.csp-violations-observed', Array.isArray(probe.cspViolations) && probe.cspViolations.length > 0, probe.cspViolations && probe.cspViolations.slice(0, 8)],
    ['candidate.canvas-painted', Boolean(probe.canvas && probe.canvas.hudText), probe.canvas],
  ]) {
    report.add(name, ok, detail);
  }

  // HTTP-level evidence: every subresource was really served, with headers.
  const requests = scenario.httpRequests || [];
  const statuses = requests.map((entry) => entry.status);
  const served200 = requests.filter((entry) => entry.status === 200 && entry.route !== 'entry-credential');
  const rels = new Set(served200.map((entry) => entry.rel));
  const requiredRels = [
    'index.html',
    'scripts/bootstrap.js',
    'scripts/main.js',
    'scripts/level-loader.mjs',
    'scripts/powerup.mjs',
    'styles/game.css',
    'assets/ship.png',
    'assets/pickup.wav',
    'levels/level-01.json',
  ];
  report.add('candidate.all-manifest-files-served-200', requiredRels.every((rel) => rels.has(rel)), {
    served: [...rels],
    missing: requiredRels.filter((rel) => !rels.has(rel)),
  });
  report.add('candidate.no-unexpected-statuses', statuses.every((status) => status === 200 || status === 410), {
    statuses: [...new Set(statuses)],
  });
  report.add('candidate.entry-credential-consumed-once', requests.some((entry) => entry.event === 'launch-credential-consumed'), {
    consumed: requests.filter((entry) => entry.event === 'launch-credential-consumed').length,
  });
  const levelGets = served200.filter((entry) => entry.rel === 'levels/level-01.json');
  report.add('candidate.level-json-requested-twice', levelGets.length >= 2, { count: levelGets.length });
  report.add('candidate.head-request-served-200', served200.some((entry) => entry.method === 'HEAD' && entry.rel === 'styles/game.css'), {});
  const cssBackgroundImage = served200.filter((entry) => entry.rel === 'assets/ship.png');
  report.add('candidate.image-requested-by-img-and-css', cssBackgroundImage.length >= 2, { count: cssBackgroundImage.length });

  const headerChecks = served200.map((entry) => entry.responseHeaders || {});
  const every = (predicate) => headerChecks.length > 0 && headerChecks.every(predicate);
  report.add('candidate.response-headers-cors-anonymous', every((headers) => headers['access-control-allow-origin'] === '*'));
  report.add('candidate.response-headers-nosniff', every((headers) => headers['x-content-type-options'] === 'nosniff'));
  report.add('candidate.response-headers-no-store', every((headers) => headers['cache-control'] === 'no-store'));
  report.add('candidate.response-headers-no-referrer-policy', every((headers) => headers['referrer-policy'] === 'no-referrer'));
  const entryRequests = requests.filter((entry) => entry.route === 'entry');
  report.add(
    'candidate.entry-carries-candidate-csp',
    entryRequests.length > 0 &&
      entryRequests.every((entry) => {
        const csp = (entry.responseHeaders || {})['content-security-policy'] || '';
        return csp.includes(`script-src ${resourceServiceOrigin()}`) && csp.includes('connect-src') && !csp.includes("'self'");
      }),
    entryRequests.map((entry) => (entry.responseHeaders || {})['content-security-policy'] || null)
  );
  const mimeByRel = Object.fromEntries(served200.map((entry) => [entry.rel, (entry.responseHeaders || {})['content-type']]));
  report.add(
    'candidate.mime-types-exact',
    mimeByRel['scripts/main.js'] === 'text/javascript; charset=utf-8' &&
      mimeByRel['styles/game.css'] === 'text/css; charset=utf-8' &&
      mimeByRel['levels/level-01.json'] === 'application/json; charset=utf-8' &&
      mimeByRel['assets/ship.png'] === 'image/png' &&
      mimeByRel['assets/pickup.wav'] === 'audio/wav',
    mimeByRel
  );

  // Referrer-policy means the token must never leak through Referer.
  const refererLeak = requests.filter((entry) => typeof entry.referer === 'string' && entry.referer !== '');
  report.add('candidate.no-referer-token-leak', refererLeak.length === 0, refererLeak);

  // Browser-side negative evidence: the iframe really tried, and was blocked.
  const network = scenario.browser && scenario.browser.network ? scenario.browser.network : [];
  const hostApiAttempt = network.filter((entry) => entry.url && entry.url.includes('/api/game-market/health'));
  const hostApiWriteAttempt = network.filter((entry) => entry.url && entry.url.includes('/api/game-market/preferences'));
  report.add('candidate.browser-saw-host-api-attempt-blocked-by-csp', hostApiAttempt.every((entry) => entry.failed === true || entry.status === undefined || entry.status === 403), hostApiAttempt);
  report.add('candidate.browser-saw-host-api-write-blocked', hostApiWriteAttempt.length === 0 || hostApiWriteAttempt.every((entry) => entry.failed === true || entry.status === 403), hostApiWriteAttempt);
  const externalAttempt = network.filter((entry) => entry.url && entry.url.startsWith('https://example.com'));
  report.add('candidate.browser-saw-external-attempt-blocked', externalAttempt.length === 0 || externalAttempt.every((entry) => entry.failed === true || entry.status === undefined), externalAttempt);
  const corsRequestsWithOrigin = network.filter((entry) => entry.requestHeaders && entry.requestHeaders.origin);
  report.add(
    'candidate.cors-requests-carry-opaque-origin-null',
    corsRequestsWithOrigin.length > 0 && corsRequestsWithOrigin.every((entry) => entry.requestHeaders.origin === 'null'),
    corsRequestsWithOrigin.map((entry) => ({ url: entry.url, origin: entry.requestHeaders.origin, mode: entry.requestHeaders['sec-fetch-mode'] }))
  );
  report.record('candidate.browser-network', network);
  report.record('candidate.browser-logEntries', scenario.browser && scenario.browser.logEntries);
  report.record('candidate.browser-consoleEntries', scenario.browser && scenario.browser.consoleEntries);
  report.record('candidate.screenshot', scenario.screenshot);
  report.record('candidate.iframeScreenshot', scenario.iframeScreenshot);
}

function resourceServiceOrigin() {
  return resourceService.origin;
}

function assertLegacyControl(scenario) {
  report.record('legacy-csp.snapshot', {
    dom: scenario.dom,
    logEntryCount: scenario.browser && scenario.browser.logEntries ? scenario.browser.logEntries.length : 0,
    httpRequestCount: scenario.httpRequests ? scenario.httpRequests.length : 0,
  });
  const dom = scenario.dom || {};
  report.add('legacy-csp.external-classic-script-blocked', dom.classicMarker !== true, { classicMarker: dom.classicMarker });
  report.add('legacy-csp.external-module-script-blocked', dom.probePresent !== true, { probePresent: dom.probePresent });
  report.add('legacy-csp.stylesheet-blocked', dom.bodyBackground === 'rgba(0, 0, 0, 0)', { bodyBackground: dom.bodyBackground, styleSheetCount: dom.styleSheetCount });
  report.add('legacy-csp.image-blocked', (dom.images || []).every((image) => image.naturalWidth === 0), dom.images);
  const logs = (scenario.browser && scenario.browser.logEntries) || [];
  const violations = logs.filter((entry) => /Content Security Policy|content security policy|Refused to/i.test(entry.text));
  report.add('legacy-csp.csp-violations-logged', violations.length >= 2, violations.slice(0, 8));
  const requests = scenario.httpRequests || [];
  report.add('legacy-csp.only-entry-document-hits-network', requests.every((entry) => entry.route === 'entry' || entry.route === 'entry-credential'), {
    routes: requests.map((entry) => entry.route),
  });
  report.record('legacy-csp.screenshot', scenario.screenshot);
}

function assertSelfCspControl(scenario) {
  const dom = scenario.dom || {};
  const probe = scenario.probe || {};
  const logs = (scenario.browser && scenario.browser.logEntries) || [];
  const violations = logs.filter((entry) => /Content Security Policy|Refused to/i.test(entry.text));
  // Measured Chromium 155 behaviour: in a sandboxed opaque-origin document,
  // CSP 'self' matched the entry URL origin for scripts/styles/images/media.
  // It is deliberately NOT used as a security claim: explicit origin is safer.
  report.add('self-csp.same-url-origin-subresources-allowed-by-chromium', dom.classicMarker === true && dom.probePresent === true && dom.bodyBackground !== 'rgba(0, 0, 0, 0)', {
    classicMarker: dom.classicMarker,
    probePresent: dom.probePresent,
    bodyBackground: dom.bodyBackground,
  });
  report.add('self-csp.different-origin-connect-blocked-by-csp', Boolean(probe.hostApi && probe.hostApi.readBlocked === true), probe.hostApi);
  report.add('self-csp.external-network-blocked-by-csp', Boolean(probe.external && probe.external.readBlocked === true), probe.external);
  report.add('self-csp.csp-violations-logged-for-cross-origin', violations.length >= 2, violations.slice(0, 6));
  report.record('self-csp.decision-note', "Do not rely on 'self' semantics in opaque-origin documents; M1 should name the resource origin explicitly (candidate variant).");
  report.record('self-csp.screenshot', scenario.screenshot);
}

function assertNoCspControl(scenario) {
  const probe = scenario.probe || {};
  const network = (scenario.browser && scenario.browser.network) || [];
  report.add('no-csp.resources-load-without-csp', Boolean(probe.levels && probe.levels.repeatedReadOk === true && probe.css && probe.css.applied === true), {
    levels: probe.levels,
    css: probe.css,
  });
  report.add('no-csp.host-api-read-blocked-by-cors', Boolean(probe.hostApi && probe.hostApi.readBlocked === true), probe.hostApi);
  const hostApiNet = network.filter((entry) => entry.url && entry.url.includes('/api/game-market/health'));
  const hostApiObserved = hostApiNet.some(
    (entry) =>
      entry.failed === true ||
      (entry.status === 403 && !(entry.responseHeaders && entry.responseHeaders['access-control-allow-origin']))
  );
  report.add('no-csp.browser-observed-host-api-blocked-by-cors', hostApiObserved, hostApiNet);
  report.add('no-csp.external-fetch-read-blocked', Boolean(probe.external && probe.external.readBlocked === true), probe.external);
  report.add('no-csp.third-party-fetch-read-blocked', Boolean(probe.evil && probe.evil.readBlocked === true), probe.evil);
  report.add('no-csp.no-cors-image-sent-despite-cors', Boolean(probe.evilImage && probe.evilImage.loaded === true), probe.evilImage);
  report.add('no-csp.no-cors-post-sent-despite-cors', Boolean(probe.evilPost && probe.evilPost.sent === true), probe.evilPost);
  const thirdPartyLog = thirdParty.requestLog();
  report.add('no-csp.third-party-origin-received-no-cors-requests', thirdPartyLog.some((entry) => entry.path === '/no-cors.png') && thirdPartyLog.some((entry) => entry.path === '/sink'), thirdPartyLog);
  report.record('no-csp.third-party-log', thirdPartyLog);
  report.record('no-csp.screenshot', scenario.screenshot);
}

function assertHttpMatrix(matrix) {
  const failed = matrix.cases.filter((entry) => entry.ok !== true);
  report.add('http-matrix.all-credential-and-path-cases-as-expected', failed.length === 0, { failed, total: matrix.cases.length });
  const fileMatrix = matrix.manifestFiles || [];
  report.add('http-matrix.every-manifest-file-readable', fileMatrix.length > 0 && fileMatrix.every((entry) => entry.status === 200), fileMatrix);
  report.add(
    'http-matrix.every-resource-has-cors-nosniff-no-store',
    fileMatrix.length > 0 && fileMatrix.every((entry) => entry.acao === '*' && entry.nosniff === 'nosniff' && entry.cacheControl === 'no-store'),
    fileMatrix
  );
  report.add('http-matrix.no-set-cookie-on-resources', matrix.cases.every((entry) => !(entry.headers && entry.headers['set-cookie'])), {});
  report.add('http-matrix.renew-extends-credential', matrix.renewResult === 'extended', { renewResult: matrix.renewResult });
  report.add('http-matrix.json-sample-parsed', Boolean(matrix.jsonSample && matrix.jsonSample.status === 200 && matrix.jsonSample.bodyPrefix.includes('level-01')), matrix.jsonSample);
}

function assertHostFence(matrix) {
  const failed = matrix.cases.filter((entry) => entry.ok !== true);
  report.add('host-fence.all-origin-auth-cases-as-expected', failed.length === 0, { failed, cases: matrix.cases });
  report.add(
    'host-fence.origin-null-write-rejected',
    matrix.cases.some((entry) => entry.name === 'reject-origin-null-write' && entry.status === 403),
    matrix.cases.filter((entry) => entry.name.includes('origin-null'))
  );
}

// ---------------------------------------------------------------------------
// Output + entry point
// ---------------------------------------------------------------------------

function writeEvidence() {
  const pairs = secretPairs();

  const reportResult = report.finish();
  const sanitised = redactSecrets(sanitizeDeep({ ...evidence, report: reportResult }), pairs);

  writeJson(path.join(OUT_DIR, 'runtime-identity.json'), sanitised.runtimeIdentity);
  writeJson(path.join(OUT_DIR, 'platform-facts.json'), sanitised.platformFacts);
  writeJson(path.join(OUT_DIR, 'http-credential-matrix.json'), sanitised.httpMatrix || {});
  writeJson(path.join(OUT_DIR, 'http-host-fence.json'), sanitised.hostFence || {});
  writeJson(path.join(OUT_DIR, 'probe-server-log.json'), {
    package: sanitised.fixture,
    targetCsp: sanitised.probeService && sanitised.probeService.targetCsp,
    productionCspForComparison: sanitised.probeService && sanitised.probeService.productionCspForComparison,
    requestLog: sanitised.probeServiceRequestLog || [],
  });
  for (const [name, scenario] of Object.entries(evidence.scenarios)) {
    writeJson(path.join(OUT_DIR, `browser-${name}.json`), redactSecrets(sanitizeDeep(scenario), pairs));
  }
  writeJson(path.join(OUT_DIR, 'summary.json'), sanitised);
  return { reportResult, sanitised };
}

async function main() {
  let exitCode = 0;
  try {
    await run();
  } catch (error) {
    report.add('probe-completed-without-throwing', false, { error: String(error && error.stack ? error.stack : error).slice(0, 800) });
    process.stderr.write(`[probe-resources] fatal: ${String(error && error.stack ? error.stack : error)}\n`);
    exitCode = 1;
  } finally {
    if (capture) {
      try {
        await removeIframe(cdp, IFRAME_ID);
      } catch (_error) {
        /* ignore */
      }
    }
    if (evidence.scenarios) {
      evidence.probeServiceRequestLog = resourceService ? resourceService.snapshot().requestLog.map((entry) => ({
        seq: entry.seq,
        route: entry.route,
        method: entry.method,
        path: redactPathname(entry.path),
        query: redactQuery(entry.query),
        status: entry.status,
        rel: entry.rel ?? null,
        origin: entry.origin ?? null,
        referer: entry.referer ?? null,
        secFetchSite: entry.secFetchSite ?? null,
        event: entry.event ?? null,
        launchConsumed: entry.instance ? entry.instance.launchConsumed : null,
      })) : [];
    }
    try {
      if (cdp) cdp.dispose();
    } catch (_error) {
      /* ignore */
    }
    try {
      if (thirdParty) await thirdParty.stop();
    } catch (_error) {
      /* ignore */
    }
    try {
      if (resourceService) await resourceService.stop();
    } catch (_error) {
      /* ignore */
    }
    try {
      if (host) {
        if (!KEEP) removeProbeRow(host.home, PLUGIN_ID);
        await host.stop();
      }
    } catch (_error) {
      /* ignore */
    }
    if (!KEEP) {
      try {
        fs.rmSync(path.join(WORK, `home-${HOME_NAME}`), { recursive: true, force: true });
      } catch (_error) {
        /* ignore */
      }
    }
  }

  let written;
  try {
    written = writeEvidence();
  } catch (error) {
    process.stderr.write(`[probe-resources] failed to write evidence: ${String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  const { reportResult } = written;
  const summaryLines = [
    `S-A1 probe ${reportResult.passed ? 'PASSED' : 'FAILED'} (${reportResult.checks.filter((c) => c.required && c.ok).length}/${reportResult.checks.filter((c) => c.required).length} required checks)`,
    `evidence: ${path.relative(WORKTREE, OUT_DIR)}`,
    `screenshots: ${path.relative(WORKTREE, SHOT_DIR)}`,
  ];
  process.stdout.write(`${summaryLines.join('\n')}\n`);
  if (!reportResult.passed) {
    process.stdout.write(`failed checks: ${reportResult.failed.join(', ')}\n`);
    for (const check of reportResult.checks.filter((c) => c.required && !c.ok)) {
      process.stdout.write(`  - ${check.name}: ${JSON.stringify(check.detail).slice(0, 400)}\n`);
    }
    exitCode = 1;
  }
  process.exitCode = exitCode;
}

main();
