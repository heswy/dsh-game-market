#!/usr/bin/env node
/**
 * M1 · A02 — real multi-resource `asset-zip-v2` game through the real Host
 * resource origin + platform wrapper, in a real DSH page, plus offline play.
 *
 * Contract: docs/V1.5-CONTRACTS.md §1.10/§3/§4/§7 (asset-zip-v2, resource
 * origin, wrapper, LaunchInfo). Guide §8 A02: "真 ZIP 独立 ESM/CSS/图片/JSON/
 * 音频实际加载，断网仍可玩，不能用内联替代".
 *
 * What is real here:
 *   - the installed 0.2.1-rc.2 `dsh web` host, isolated DSH_HOME under /tmp;
 *   - the worktree Host plugin (real `POST /api/game-market/install-local` ZIP
 *     install, real `POST /api/game-market/launch`, real loopback resource
 *     origin + wrapper document);
 *   - headless Chrome 155 over CDP, recursive OOPIF attach for wrapper+game;
 *   - the production Runtime controller (`packages/runtime/src`) and the real
 *     production SDK compiled into the package, loaded into the real DSH page.
 *
 * Runtime embedding requirement (Lead decision 2026-10-20, see
 * `raw/m1/blocker-wrapper-frame-ancestors-*.json`): the OUTER wrapper iframe
 * must carry NO `sandbox` attribute; the INNER game iframe (created by the
 * wrapper document) keeps `sandbox="allow-scripts"` and never
 * `allow-same-origin`. While runtime-client has not landed that change this
 * script runs a clearly-labelled **diagnostic mode** (wrapper embedded without
 * the Runtime) so the resource stack/offline evidence is still produced; the
 * runtime-mode checks stay required and fail, so the run exits non-zero.
 *
 * Usage: node scripts/verification/v1.5/m1/m1-a02-multiresource.mjs [--keep]
 * Exit code 0 = every required check passed. Evidence:
 *   docs/verification/v1.5/raw/m1/a02-<timestamp>.json + screenshots/.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  Cdp,
  sleep,
  runtimeIdentity,
  startIsolatedHost,
  createStaticOrigin,
  createSinkOrigin,
  createCdpCapture,
  waitForDshPage,
  installZipFromPage,
  launchFromPage,
  setupRuntimeLab,
  runtimeLaunch,
  runtimeReload,
  runtimeDestroy,
  runtimeState,
  embedWrapperDiagnostic,
  removeProbeFrames,
  screenshot,
  buildGoodPackage,
  writeEvidence,
  sanitiseForEvidence,
  redact,
  OUT_DIR,
  REPO_ROOT,
} from './lib/lab.mjs';

const PORTS = Object.freeze({ bootstrap: 58280, host: 58281, static: 58331, sink: 58332, chrome: 9506 });
const KEEP = process.argv.includes('--keep');

function nowId() {
  return `op_m1_a02_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Normalise one CDP network entry for evidence (sanitised later). */
function networkSummary(entry) {
  return {
    sessionId: entry.sessionId,
    method: entry.method,
    url: entry.url,
    resourceType: entry.resourceType,
    status: entry.status ?? null,
    mimeType: entry.mimeType ?? null,
    failed: entry.failed === true,
    errorText: entry.errorText ?? null,
    blockedReason: entry.blockedReason ?? null,
    requestOrigin: entry.actualRequestHeaders ? entry.actualRequestHeaders.origin ?? entry.actualRequestHeaders.Origin ?? null : null,
    credentialKind: classifyCredential(entry.url),
    responseHeaders: {
      contentType: headerOf(entry, 'content-type'),
      accessControlAllowOrigin: headerOf(entry, 'access-control-allow-origin'),
      xContentTypeOptions: headerOf(entry, 'x-content-type-options'),
      cacheControl: headerOf(entry, 'cache-control'),
      referrerPolicy: headerOf(entry, 'referrer-policy'),
      contentSecurityPolicy: headerOf(entry, 'content-security-policy'),
    },
  };
}

/** Contract §7.2: launch vs wrapper vs repeatable resource credential. */
function classifyCredential(url) {
  if (typeof url !== 'string') return 'unknown';
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_error) {
    return 'unknown';
  }
  if (parsed.pathname.endsWith('/wrapper')) return 'wrapper-document';
  if (parsed.pathname.includes('/res/')) {
    if (parsed.pathname.endsWith('/index.html') && parsed.searchParams.get('launch')) return 'entry-launch';
    return 'resource';
  }
  return 'other';
}

function headerOf(entry, name) {
  const headers = entry.responseHeaders || {};
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? null : String(headers[key]);
}

function relOf(url, resourceBase) {
  if (typeof url !== 'string' || typeof resourceBase !== 'string' || !url.startsWith(`${resourceBase}/`)) return null;
  return url.slice(resourceBase.length + 1).replace(/[?#].*$/, '');
}

function collectResourceRound(capture, { sessionId, wrapperSessionId, launch, since = 0 }) {
  const entries = capture.state.networkOrder.filter((entry) => entry.at >= since);
  const gameRequests = sessionId === null ? [] : entries.filter((entry) => entry.sessionId === sessionId);
  void wrapperSessionId;
  // Attribute by URL, not by target session: the top-level page target also
  // reports the nested iframe document request (initiator), and after the P0
  // fix the wrapper is same-process (no per-frame OOPIF session).
  const resourceRequests = entries
    .filter((entry) => typeof entry.url === 'string' && entry.url.startsWith(`${launch.resourceOrigin}/`))
    .map(networkSummary);
  const byRel = new Map();
  for (const entry of entries) {
    const rel = relOf(entry.url, launch.resourceBase);
    if (!rel) continue;
    if (!byRel.has(rel)) byRel.set(rel, []);
    byRel.get(rel).push(networkSummary(entry));
  }
  const wrapperDocs = entries
    .filter((entry) => typeof entry.url === 'string' && entry.url.includes('/wrapper?'))
    .map((entry) => ({
      ...networkSummary(entry),
      srcParam: (() => {
        try {
          return new URL(entry.url).searchParams.get('src');
        } catch (_error) {
          return null;
        }
      })(),
    }));
  return { resourceRequests, byRel, wrapperDocs, gameRequests: gameRequests.map(networkSummary) };
}

function check(checks, name, ok, detail, { required = true } = {}) {
  checks.push({ name, ok: Boolean(ok), required, detail });
  return Boolean(ok);
}

async function nodeFetch(url) {
  const response = await fetch(url, { redirect: 'manual' });
  const text = await response.text();
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), text };
}

function findAfter(capture, since, predicate) {
  return capture.state.attached.find((record) => record.type === 'iframe' && record.attachedAt >= since && predicate(record)) || null;
}

async function waitForGameAfter(capture, since, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const session of capture.state.attached.filter((record) => record.type === 'iframe' && record.attachedAt >= since)) {
      try {
        const snapshot = await capture.evaluate(
          session.sessionId,
          `(() => ({
            origin: window.origin,
            title: document.title || '',
            href: location.href,
            hasHud: Boolean(document.getElementById('hud')),
            hasBoard: Boolean(document.getElementById('board')),
            chromeError: location.href.startsWith('chrome-error:'),
            game: window.__M1_GAME__ ? {
              phase: window.__M1_GAME__.phase,
              ticks: window.__M1_GAME__.ticks,
              score: window.__M1_GAME__.score,
              resources: window.__M1_GAME__.resources,
              bridge: window.__M1_GAME__.bridge,
              errors: window.__M1_GAME__.errors
            } : null
          }))()`
        );
        if (snapshot && (snapshot.game || snapshot.chromeError)) return { sessionId: session.sessionId, snapshot };
      } catch (_error) {
        // Navigation in flight or target gone.
      }
    }
    await sleep(250);
  }
  return null;
}

async function waitForGamePhase(capture, sessionId, phase, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await capture.evaluate(
        sessionId,
        `window.__M1_GAME__ ? { phase: window.__M1_GAME__.phase, ticks: window.__M1_GAME__.ticks, bridge: window.__M1_GAME__.bridge } : null`
      );
      if (value && (phase === null || value.phase === phase)) return value;
    } catch (_error) {
      // Retry.
    }
    await sleep(250);
  }
  return null;
}

async function evaluateWrapper(capture, wrapperSessionId) {
  return capture.evaluate(
    wrapperSessionId,
    `(() => {
      const frame = document.getElementById('dsh-game-frame');
      return {
        origin: window.origin,
        href: location.href,
        gameFrames: document.querySelectorAll('iframe').length,
        innerSandbox: frame ? frame.getAttribute('sandbox') : null,
        innerAllow: frame ? frame.getAttribute('allow') : null,
        innerReferrerPolicy: frame ? frame.getAttribute('referrerpolicy') : null,
        cspHeaderPresent: true
      };
    })()`
  );
}

function evaluateGame(capture, gameSessionId) {
  return capture.evaluate(
    gameSessionId,
    `(() => ({
      origin: window.origin,
      title: document.title || '',
      href: location.href,
      hasHud: Boolean(document.getElementById('hud')),
      hasBoard: Boolean(document.getElementById('board')),
      chromeError: location.href.startsWith('chrome-error:'),
      game: window.__M1_GAME__ ? {
        phase: window.__M1_GAME__.phase,
        ticks: window.__M1_GAME__.ticks,
        score: window.__M1_GAME__.score,
        esmStaticImport: window.__M1_GAME__.esmStaticImport,
        resources: window.__M1_GAME__.resources,
        bridge: window.__M1_GAME__.bridge,
        errors: window.__M1_GAME__.errors
      } : null
    }))()`
  );
}

function assertResourceRound(checks, label, round, launch, { required = true } = {}) {
  const expected = [
    ['index.html', 'text/html; charset=utf-8'],
    ['dsh-sdk.js', 'text/javascript; charset=utf-8'],
    ['scripts/main.mjs', 'text/javascript; charset=utf-8'],
    ['scripts/logic.mjs', 'text/javascript; charset=utf-8'],
    ['styles/game.css', 'text/css; charset=utf-8'],
    ['data/level.json', 'application/json; charset=utf-8'],
    ['assets/ship.png', 'image/png'],
    ['assets/pickup.wav', 'audio/wav'],
  ];
  const missing = [];
  const wrongStatus = [];
  const wrongMime = [];
  const missingHeaders = [];
  for (const [rel, mime] of expected) {
    const entries = (round.byRel.get(rel) || []).filter((entry) => entry.status === 200);
    if (entries.length === 0) {
      missing.push(rel);
      continue;
    }
    const entry = entries[0];
    if (!String(entry.mimeType || entry.responseHeaders.contentType || '').startsWith(mime.split(';')[0])) wrongMime.push({ rel, actual: entry.mimeType, expected: mime });
    if (entry.responseHeaders.accessControlAllowOrigin !== '*') missingHeaders.push({ rel, header: 'access-control-allow-origin' });
    if (entry.responseHeaders.xContentTypeOptions !== 'nosniff') missingHeaders.push({ rel, header: 'x-content-type-options' });
    if (entry.responseHeaders.cacheControl !== 'no-store') missingHeaders.push({ rel, header: 'cache-control' });
    if (entry.responseHeaders.referrerPolicy !== 'no-referrer') missingHeaders.push({ rel, header: 'referrer-policy' });
  }
  const badStatuses = round.resourceRequests.filter((entry) => entry.status !== 200 && !entry.failed);
  const jsonTwice = (round.byRel.get('data/level.json') || []).filter((entry) => entry.status === 200).length;
  check(checks, `${label}.every-declared-resource-requested-200`, missing.length === 0, { missing }, { required });
  check(checks, `${label}.no-404-and-no-error-status`, badStatuses.length === 0 && round.resourceRequests.every((entry) => !entry.failed), { badStatuses }, { required });
  check(checks, `${label}.exact-mime-types`, wrongMime.length === 0, { wrongMime }, { required });
  check(checks, `${label}.resource-response-headers`, missingHeaders.length === 0, { missingHeaders }, { required });
  check(checks, `${label}.json-level-fetched-twice`, jsonTwice >= 2, { count: jsonTwice }, { required });
  check(
    checks,
    `${label}.entry-document-carries-csp`,
    (round.byRel.get('index.html') || []).some((entry) => (entry.responseHeaders.contentSecurityPolicy || '').includes(`script-src ${launch.resourceOrigin}`)),
    { csp: (round.byRel.get('index.html') || []).map((entry) => entry.responseHeaders.contentSecurityPolicy) },
    { required }
  );
  check(
    checks,
    `${label}.subresources-do-not-repeat-csp`,
    round.byRel.has('scripts/main.mjs') ? (round.byRel.get('scripts/main.mjs') || []).every((entry) => !entry.responseHeaders.contentSecurityPolicy) : false,
    {},
    { required }
  );
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const identity = runtimeIdentity();
  const checks = [];
  const evidence = {
    id: 'M1-A02-multiresource',
    title: 'A02: real asset-zip-v2 multi-resource load + offline play in the real DSH page',
    environment: { dsh: identity, chrome: 'Google Chrome headless via CDP', ports: PORTS },
    scenarios: {},
  };
  let hostHandle = null;
  let staticOrigin = null;
  let sink = null;
  let cdp = null;
  let capture = null;
  let exitCode = 0;
  const secrets = [];

  try {
    staticOrigin = createStaticOrigin({ port: PORTS.static });
    const staticInfo = await staticOrigin.start();
    sink = createSinkOrigin({ port: PORTS.sink });
    const sinkInfo = await sink.start();

    hostHandle = await startIsolatedHost({ name: 'probe-m1-a02', ports: PORTS });
    cdp = await Cdp.launch({ port: PORTS.chrome });
    capture = createCdpCapture(cdp);
    await capture.start();
    await cdp.navigate(hostHandle.host.url);
    const boot = await waitForDshPage(cdp, hostHandle.hostOrigin);
    check(checks, 'dsh-page-loads-and-host-api-answers', boot.health && boot.health.status === 200, { health: boot.health });
    evidence.environment.staticOrigin = staticInfo.origin;
    evidence.environment.sinkOrigin = sinkInfo.origin;

    // --- 1. real ZIP install through the real Host API ----------------------
    const good = await buildGoodPackage();
    const install = await installZipFromPage(cdp, good.zip, { operationId: nowId() });
    const installed = install.body && install.body.ok === true ? install.body.data : null;
    evidence.scenarios.install = {
      status: install.status,
      gameId: installed && installed.gameId,
      version: installed && installed.version,
      changed: installed && installed.changed,
      installation: installed && installed.installation ? {
        format: installed.installation.format,
        entry: installed.installation.entry,
        fileCount: installed.installation.fileCount,
        fileManifestDigest: installed.installation.fileManifestDigest,
        sizeBytes: installed.installation.sizeBytes
      } : null,
    };
    check(checks, 'zip-install-through-host-api-succeeds', Boolean(installed && installed.installation && installed.installation.format === 'asset-zip-v2'), evidence.scenarios.install);

    // --- 2. real launch: LaunchInfo contract fields -------------------------
    const launch = await launchFromPage(cdp, { gameId: good.gameId });
    const info = launch.body && launch.body.ok === true ? launch.body.data : null;
    if (!info) {
      check(checks, 'launch-returns-launch-info', false, launch);
      throw new Error(`launch failed: ${JSON.stringify(launch).slice(0, 400)}`);
    }
    const launchUrl = (() => {
      try {
        return new URL(info.entryUrl);
      } catch (_error) {
        return null;
      }
    })();
    const launchInfoSummary = {
      instanceIdShape: /^[a-f0-9]{32}$/.test(info.instanceId),
      nonceShape: /^[a-f0-9]{32}$/.test(info.nonce),
      resourceOrigin: info.resourceOrigin,
      resourceBase: info.resourceBase,
      resourceTtlMs: info.resourceTtlMs,
      entryResourceUrl: info.entryResourceUrl,
      wrapperUrl: info.wrapperUrl,
      wrapperResourceUrl: info.wrapperResourceUrl,
      package: info.package,
      entryUrlQuery: launchUrl ? { launch: Boolean(launchUrl.searchParams.get('launch')), pathUnderRes: launchUrl.pathname.startsWith('/res/') } : null,
    };
    evidence.scenarios.launchInfo = launchInfoSummary;
    secrets.push(info.instanceId, info.nonce);
    const resourceBaseUrl = new URL(info.resourceBase);
    const tokenPath = resourceBaseUrl.pathname.split('/').filter(Boolean)[2];
    secrets.push(tokenPath);
    check(
      checks,
      'launch-info-contract-v2-fields',
      info.resourceOrigin === `${resourceBaseUrl.protocol}//${resourceBaseUrl.host}` &&
        /^http:\/\/127\.0\.0\.1:\d+$/.test(info.resourceOrigin) &&
        info.resourceBase === `${info.resourceOrigin}/res/${info.instanceId}/${tokenPath}` &&
        Number.isFinite(info.resourceTtlMs) &&
        info.resourceTtlMs > 0 &&
        info.package && info.package.format === 'asset-zip-v2' &&
        info.package.entry === 'index.html' &&
        typeof info.package.filesDigest === 'string' &&
        info.entryResourceUrl === `${info.resourceBase}/index.html` &&
        info.wrapperUrl.startsWith(`${info.resourceOrigin}/wrapper?`) &&
        info.wrapperResourceUrl.startsWith(`${info.resourceOrigin}/wrapper?`) &&
        launchInfoSummary.entryUrlQuery.launch === true,
      launchInfoSummary
    );

    // --- 3. wrapper document over HTTP (no credential in this fetch) --------
    const wrapperDoc = await nodeFetch(info.wrapperUrl);
    const wrapperSrc = (() => {
      try {
        return new URL(info.wrapperUrl).searchParams.get('src');
      } catch (_error) {
        return null;
      }
    })();
    const wrapperCsp = wrapperDoc.headers['content-security-policy'] || '';
    evidence.scenarios.wrapper = {
      status: wrapperDoc.status,
      contentType: wrapperDoc.headers['content-type'],
      csp: wrapperCsp,
      srcIsLaunchUrl: typeof wrapperSrc === 'string' && wrapperSrc.includes('launch='),
      srcUnderResourceBase: typeof wrapperSrc === 'string' && wrapperSrc.startsWith(`${info.resourceBase}/`),
      innerIframeSandbox: (wrapperDoc.text.match(/<iframe[^>]*sandbox="([^"]+)"/) || [])[1] || null,
      innerIframeHasAllowSameOrigin: /allow-same-origin/.test(wrapperDoc.text),
      relayScriptNonce: /<script nonce="[a-f0-9]+">/.test(wrapperDoc.text),
    };
    check(
      checks,
      'wrapper-document-contract',
      wrapperDoc.status === 200 &&
        wrapperDoc.headers['content-type'] === 'text/html; charset=utf-8' &&
        wrapperCsp.includes(`frame-src ${info.resourceOrigin}`) &&
        wrapperCsp.includes(`child-src ${info.resourceOrigin}`) &&
        evidence.scenarios.wrapper.innerIframeSandbox === 'allow-scripts' &&
        evidence.scenarios.wrapper.innerIframeHasAllowSameOrigin === false &&
        evidence.scenarios.wrapper.srcIsLaunchUrl === true &&
        evidence.scenarios.wrapper.relayScriptNonce === true,
      evidence.scenarios.wrapper
    );
    const wrapperAncestors = (wrapperCsp.match(/frame-ancestors\s+([^;]+)/i) || [])[1] || null;
    const wrapperAncestorSources = wrapperAncestors === null ? [] : wrapperAncestors.trim().split(/\s+/);
    evidence.scenarios.wrapper.frameAncestors = wrapperAncestors;
    check(
      checks,
      'wrapper-csp-has-frame-ancestors-without-bare-wildcard',
      wrapperAncestors !== null && !wrapperAncestorSources.includes('*'),
      { frameAncestors: wrapperAncestors }
    );
    check(
      checks,
      'wrapper-csp-frame-ancestors-no-wildcard-at-all',
      wrapperAncestors !== null && !wrapperAncestors.includes('*'),
      { frameAncestors: wrapperAncestors, note: 'Lead hard assertion 2026-10-20: no wildcard; contract §7.5.1 wants the exact DSH web origin' }
    );

    // --- 4. Runtime mode: production controller + wrapper + wrapper attrs ---
    const sinceRuntime = Date.now();
    await setupRuntimeLab(cdp, { staticOrigin: staticInfo.origin });
    await runtimeLaunch(cdp, info);
    const wrapperSession = await capture.waitForSession((record) => record.url.includes('/wrapper?'), 15000);
    const runtimeOutcome = await waitForGameAfter(capture, sinceRuntime, 12000);
    const frameInfo = await runtimeState(cdp).then((state) => state.frame).catch(() => null);
    evidence.scenarios.runtime = {
      wrapperSessionAttached: Boolean(wrapperSession),
      frameInfo,
      rendered: runtimeOutcome,
    };

    // The decided M1 model (Lead 2026-10-20): outer wrapper iframe has NO
    // sandbox; inner game iframe (created by the wrapper) has sandbox=
    // "allow-scripts" and never allow-same-origin.
    check(
      checks,
      'runtime-wrapper-iframe-has-no-sandbox-attribute',
      Boolean(frameInfo) && frameInfo.sandbox === null,
      { frameInfo }
    );
    // The wrapper is same-site cross-origin (different loopback port) and is
    // deliberately NOT sandboxed, so it is not an OOPIF target: evaluate its
    // DOM through the root target frame tree + an isolated world.
    let wrapperLayer = null;
    for (let attempt = 0; attempt < 40 && !wrapperLayer; attempt += 1) {
      const evaluated = await capture
        .evaluateInFrame('/wrapper?', `(() => {
          const frame = document.getElementById('dsh-game-frame');
          return {
            origin: location.origin,
            windowOrigin: window.origin,
            href: location.href,
            gameFrames: document.querySelectorAll('iframe').length,
            innerSandbox: frame ? frame.getAttribute('sandbox') : null,
            innerAllow: frame ? frame.getAttribute('allow') : null,
            innerReferrerPolicy: frame ? frame.getAttribute('referrerpolicy') : null
          };
        })()`)
        .catch((error) => ({ frameFound: false, error: String(error.message).slice(0, 200) }));
      if (evaluated && evaluated.frameFound && evaluated.value) {
        wrapperLayer = { ...evaluated.value, frameId: evaluated.frameId, frameUrl: evaluated.frameUrl };
      } else {
        await sleep(250);
      }
    }
    evidence.scenarios.runtime.wrapperLayer = wrapperLayer;
    evidence.scenarios.runtime.wrapperFrame = await capture.evaluateInFrame('/wrapper?', `({ href: location.href, origin: location.origin, windowOrigin: window.origin })`).catch(() => null);
    evidence.scenarios.runtime.frameTree = await capture.frameTree().catch(() => null);
    check(
      checks,
      'wrapper-layer-real-origin-inner-game-sandbox',
      Boolean(
        wrapperLayer &&
          !wrapperLayer.error &&
          wrapperLayer.origin === info.resourceOrigin &&
          wrapperLayer.gameFrames === 1 &&
          wrapperLayer.innerSandbox === 'allow-scripts' &&
          !/allow-same-origin/.test(String(wrapperLayer.innerSandbox)) &&
          wrapperLayer.innerReferrerPolicy === 'no-referrer'
      ),
      wrapperLayer
    );
    check(
      checks,
      'runtime-renders-game-document-in-wrapper',
      Boolean(runtimeOutcome && runtimeOutcome.snapshot && !runtimeOutcome.snapshot.chromeError && runtimeOutcome.snapshot.game),
      runtimeOutcome
    );

    let gameSessionId = runtimeOutcome && runtimeOutcome.sessionId;
    let gameSnapshot = runtimeOutcome && runtimeOutcome.snapshot;
    let runtimeModeWorking = Boolean(gameSessionId && gameSnapshot && !gameSnapshot.chromeError);
    let diagnostic = null;

    if (!runtimeModeWorking) {
      // --- 4b. Diagnostic mode (labelled): isolate the runtime embedding gap -
      // Wrapper embedded WITHOUT the Runtime (no sandbox on the outer iframe),
      // mirroring the decided M1 model, so the resource stack is still proven.
      const diagnosticLaunch = await launchFromPage(cdp, { gameId: good.gameId });
      const diagInfo = diagnosticLaunch.body && diagnosticLaunch.body.ok === true ? diagnosticLaunch.body.data : null;
      if (!diagInfo) throw new Error(`diagnostic launch failed: ${JSON.stringify(diagnosticLaunch).slice(0, 300)}`);
      secrets.push(diagInfo.instanceId, diagInfo.nonce, new URL(diagInfo.resourceBase).pathname.split('/').filter(Boolean)[2]);
      const sinceDiagnostic = Date.now();
      const diagRect = await embedWrapperDiagnostic(cdp, { wrapperUrl: diagInfo.wrapperUrl });
      const diagRendered = await waitForGameAfter(capture, sinceDiagnostic, 20000);
      const diagWrapperSession = findAfter(capture, sinceDiagnostic, (record) => record.url.includes('/wrapper?'));
      diagnostic = {
        label: 'diagnostic-wrapper-no-runtime (outer wrapper iframe without sandbox)',
        launchInfo: { resourceOrigin: diagInfo.resourceOrigin, resourceBase: diagInfo.resourceBase },
        outerIframeSandbox: diagRect.sandbox,
        wrapperSessionAttached: Boolean(diagWrapperSession),
        rendered: diagRendered,
        wrapperLayer: diagWrapperSession ? await evaluateWrapper(capture, diagWrapperSession.sessionId).catch((error) => ({ error: String(error.message).slice(0, 200) })) : null,
      };
      evidence.scenarios.diagnostic = diagnostic;
      if (diagRendered && diagRendered.snapshot && !diagRendered.snapshot.chromeError && diagRendered.snapshot.game) {
        gameSessionId = diagRendered.sessionId;
        gameSnapshot = diagRendered.snapshot;
        // Reuse the diagnostic instance for the resource/offline checks.
        Object.assign(info, diagInfo);
      }
      check(checks, 'diagnostic-mode-game-renders-without-runtime', Boolean(gameSessionId), diagnostic, { required: false });
    }

    if (!gameSessionId || !gameSnapshot || gameSnapshot.chromeError) {
      check(checks, 'game-document-renders-not-chrome-error', false, { runtimeOutcome, diagnostic });
      throw new Error('game document never rendered (see runtime/diagnostic evidence)');
    }

    // --- 4c. runtime health: no false-positive navigation revocation --------
    const runtimeEvents = await cdp.eval('window.__M1_LAB__ ? window.__M1_LAB__.eventLog() : []').catch(() => []);
    evidence.scenarios.runtimeEvents = runtimeEvents;
    const unexpectedNavigationEvents = runtimeEvents.filter(
      (event) => event.type === 'error' && event.error && ['GM-5012', 'GM-5013', 'GM-5004'].includes(event.error.code)
    );
    check(
      checks,
      'runtime-no-unexpected-navigation-revocation',
      unexpectedNavigationEvents.length === 0,
      { events: unexpectedNavigationEvents, allEvents: runtimeEvents.slice(0, 20) }
    );

    // --- 5. game-internal resource evidence ---------------------------------
    const phaseState = await waitForGamePhase(capture, gameSessionId, 'playing', 25000);
    evidence.scenarios.phaseState = phaseState;
    const gameLayer = await evaluateGame(capture, gameSessionId);
    evidence.scenarios.gameDocument = gameLayer;
    const game = gameLayer.game || {};
    const resources = game.resources || {};
    check(
      checks,
      'game-document-renders-not-chrome-error-2',
      !gameLayer.chromeError && gameLayer.origin === 'null' && gameLayer.title === 'M1 Multi-Resource Probe' && gameLayer.hasHud === true && gameLayer.hasBoard === true,
      { origin: gameLayer.origin, title: gameLayer.title, hasHud: gameLayer.hasHud, hasBoard: gameLayer.hasBoard, chromeError: gameLayer.chromeError }
    );
    check(checks, 'game-esm-static-import-resolved', game.esmStaticImport === true, { esmStaticImport: game.esmStaticImport });
    check(checks, 'game-css-applied-computed-style', Boolean(resources.css && resources.css.applied === true), resources.css);
    check(checks, 'game-json-fetched-twice-and-parsed', Boolean(resources.json && resources.json.repeated === true && resources.json.levelId === 'level-01' && resources.json.waves === 5), resources.json);
    check(checks, 'game-sdk-asset-url-works', Boolean(resources.assetUrl && resources.assetUrl.ok === true && /^http:\/\/127\.0\.0\.1:\d+\/res\//.test(resources.assetUrl.value || '')), resources.assetUrl);
    check(checks, 'game-image-decoded-and-canvas-readable', Boolean(resources.image && resources.image.naturalWidth === 64 && resources.image.naturalHeight === 64 && resources.image.canvasOpaquePixels > 0), resources.image);
    check(checks, 'game-audio-ready-and-decodable', Boolean(resources.audio && resources.audio.readyState > 0 && typeof resources.audio.decodedDuration === 'number' && Math.abs(resources.audio.decodedDuration - 0.2) < 0.05), resources.audio);
    check(checks, 'game-play-loop-advances-ticks', typeof game.ticks === 'number' && game.ticks > 0, { ticks: game.ticks, score: game.score });
    check(checks, 'game-storage-save-through-bridge', Boolean(game.bridge && game.bridge.storageSave && game.bridge.storageSave.ok === true), game.bridge);
    check(checks, 'game-sdk-handshake-ready', Boolean(game.bridge && game.bridge.ready && game.bridge.ready.ok === true && game.bridge.ready.packageFormat === 'asset-zip-v2' && typeof game.bridge.ready.resourceBase === 'string'), game.bridge && game.bridge.ready);

    // --- 6. CDP network evidence for round 1 (wrapper + game) --------------
    const round1 = collectResourceRound(capture, { sessionId: gameSessionId, wrapperSessionId: wrapperSession ? wrapperSession.sessionId : diagnostic && diagnostic.wrapperSession ? diagnostic.wrapperSession.sessionId : null, launch: info, since: 0 });
    evidence.scenarios.round1 = {
      resourceRequests: round1.resourceRequests,
      wrapperDocs: round1.wrapperDocs.map((entry) => ({ ...entry, srcParam: entry.srcParam ? redact(entry.srcParam, secrets) : null })),
      byRel: Object.fromEntries([...round1.byRel.entries()].map(([rel, entries]) => [rel, entries.map((entry) => ({ status: entry.status, mimeType: entry.mimeType, failed: entry.failed }))])),
    };
    assertResourceRound(checks, 'a02-round1', round1, info);
    const entryLaunchRequests = round1.resourceRequests.filter((entry) => entry.credentialKind === 'entry-launch');
    const entryLaunch200 = entryLaunchRequests.filter((entry) => entry.status === 200);
    check(
      checks,
      'launch-credential-consumed-exactly-once-by-runtime',
      entryLaunchRequests.length === 1 && entryLaunch200.length === 1,
      { count: entryLaunchRequests.length, statuses: entryLaunchRequests.map((entry) => entry.status) }
    );
    check(
      checks,
      'game-entry-document-200-after-runtime-load',
      (round1.byRel.get('index.html') || []).some((entry) => entry.status === 200),
      { indexRequests: round1.byRel.get('index.html') || [] }
    );
    const wrapperDocEntry = round1.wrapperDocs[0];
    check(
      checks,
      'wrapper-response-has-frame-src-csp',
      Boolean(wrapperDocEntry && (wrapperDocEntry.responseHeaders.contentSecurityPolicy || '').includes(`frame-src ${info.resourceOrigin}`)),
      wrapperDocEntry || null
    );
    check(
      checks,
      'game-origin-is-opaque',
      Boolean(gameLayer.origin === 'null'),
      { origin: gameLayer.origin }
    );

    // No CSP violations in a correct run (wrapper or game layer).
    const sessionIds = [gameSessionId, wrapperSession ? wrapperSession.sessionId : null, diagnostic && diagnostic.wrapperSession ? diagnostic.wrapperSession.sessionId : null].filter(Boolean);
    const logEntries = capture.state.logs.filter((entry) => sessionIds.includes(entry.sessionId));
    const violations = logEntries.filter((entry) => /violates the following Content Security Policy|Refused to/i.test(entry.text || ''));
    const framingViolations = logEntries.filter((entry) => /Framing .*violates/i.test(entry.text || ''));
    check(checks, 'no-csp-violation-logs', violations.length === 0, violations.slice(0, 10));
    check(checks, 'no-framing-frame-ancestors-violation', framingViolations.length === 0, framingViolations.slice(0, 10));
    check(checks, 'game-document-network-200-with-rendered-dom', Boolean(gameSessionId) && gameLayer && !gameLayer.chromeError && gameLayer.title === 'M1 Multi-Resource Probe', { title: gameLayer && gameLayer.title, chromeError: gameLayer && gameLayer.chromeError });

    // --- 7. launch credential semantics (direct HTTP) ----------------------
    const replay = await nodeFetch(info.entryUrl);
    const resourceRepeat = await nodeFetch(info.entryResourceUrl);
    const gameJson = await nodeFetch(`${info.resourceBase}/game.json`);
    const descriptor = await nodeFetch(`${info.resourceBase}/dsh-package.json`);
    const headSdk = await fetch(`${info.resourceBase}/dsh-sdk.js`, { method: 'HEAD' });
    const postResource = await fetch(`${info.resourceBase}/scripts/main.mjs`, { method: 'POST' });
    const traversal = await fetch(`${info.resourceBase}/%2e%2e%2findex.html`);
    evidence.scenarios.credentials = {
      launchReplayStatus: replay.status,
      entryResourceUrlStatus: resourceRepeat.status,
      gameJsonStatus: gameJson.status,
      descriptorStatus: descriptor.status,
      headSdkStatus: headSdk.status,
      postResourceStatus: postResource.status,
      traversalStatus: traversal.status,
    };
    check(checks, 'launch-url-replay-is-410', replay.status === 410, { status: replay.status });
    check(checks, 'resource-credential-entry-url-is-repeatable-200', resourceRepeat.status === 200, { status: resourceRepeat.status });
    check(
      checks,
      'descriptor-and-game-json-not-served',
      gameJson.status === 403 && descriptor.status === 403,
      { gameJson: gameJson.status, descriptor: descriptor.status, expectation: 'contract §7.3: reserved paths -> GM-4039 -> HTTP 403' }
    );
    check(checks, 'resource-methods-and-traversal-rejected', headSdk.status === 200 && postResource.status === 405 && traversal.status === 403, { head: headSdk.status, post: postResource.status, traversal: traversal.status });

    // --- 8. "offline still playable" ---------------------------------------
    // (a) reload the game document with a gate that blocks every request that
    //     is not the instance resource origin, then assert all resources load
    //     again and the launch URL was NOT replayed.
    if (runtimeModeWorking) {
      const beforeReload = (await runtimeState(cdp)).state;
      const reloadSince = Date.now();
      await capture.setDefaultGate({ allowPrefix: info.resourceOrigin });
      const reloadResult = await runtimeReload(cdp);
      const reloaded = await waitForGameAfter(capture, reloadSince, 25000);
      const reloadRound = collectResourceRound(capture, {
        sessionId: reloaded ? reloaded.sessionId : null,
        wrapperSessionId: null,
        launch: info,
        since: reloadSince,
      });
      // Every wrapper request after reload must point at the resource-credential
      // URL (no `launch` query) — the Runtime may never replay the one-shot URL.
      const reloadWrapperDocs = capture.state.networkOrder
        .filter((entry) => entry.at >= reloadSince && typeof entry.url === 'string' && entry.url.includes('/wrapper?'))
        .map((entry) => entry.url);
      const wrapperSrcs = reloadWrapperDocs.map((url) => {
        try {
          return new URL(url).searchParams.get('src') || '';
        } catch (_error) {
          return '';
        }
      });
      const launchReplayedAfterReload = wrapperSrcs.some((src) => src.includes('launch=')) ||
        capture.state.networkOrder.some((entry) => entry.at >= reloadSince && typeof entry.url === 'string' && entry.url.includes('?launch=') && entry.url.includes('/res/'));
      evidence.scenarios.gateReload = {
        reloadResult,
        reloaded: reloaded
          ? { sessionId: reloaded.sessionId, snapshot: reloaded.snapshot ? { title: reloaded.snapshot.title, phase: reloaded.snapshot.game && reloaded.snapshot.game.phase, ticks: reloaded.snapshot.game && reloaded.snapshot.game.ticks } : null }
          : null,
        blockedRequests: capture.state.fetchBlocked.slice(),
        continuedRequests: capture.state.fetchContinued.length,
        wrapperDocsAfterReload: reloadWrapperDocs.map((url) => redact(url, secrets)),
        wrapperSrcFlags: wrapperSrcs.map((src) => ({ hasLaunch: src.includes('launch='), underResourceBase: src.startsWith(`${info.resourceBase}/`) })),
        launchReplayedAfterReload,
        resourceRequestStatuses: reloadRound.resourceRequests.map((entry) => ({ rel: relOf(entry.url, info.resourceBase), status: entry.status, failed: entry.failed })),
      };
      const reloadedOk = Boolean(reloaded && reloaded.snapshot && !reloaded.snapshot.chromeError && reloaded.snapshot.game && reloaded.snapshot.game.phase === 'playing');
      const reloadResourcesOk = ['index.html', 'dsh-sdk.js', 'scripts/main.mjs', 'scripts/logic.mjs', 'styles/game.css', 'data/level.json', 'assets/ship.png', 'assets/pickup.wav']
        .every((rel) => reloadRound.resourceRequests.some((entry) => relOf(entry.url, info.resourceBase) === rel && entry.status === 200));
      check(checks, 'offline-gate-reload-renders-and-plays', reloadedOk, evidence.scenarios.gateReload);
      check(checks, 'offline-gate-reload-loads-every-resource-from-resource-origin', reloadResourcesOk, evidence.scenarios.gateReload);
      check(checks, 'offline-gate-blocked-zero-non-resource-requests', capture.state.fetchBlocked.length === 0, capture.state.fetchBlocked.slice(0, 10));
      check(checks, 'reload-uses-resource-credential-url-not-launch-url', reloadWrapperDocs.length > 0 && !launchReplayedAfterReload && wrapperSrcs.every((src) => src.startsWith(`${info.resourceBase}/`)), evidence.scenarios.gateReload.wrapperSrcFlags);

      // (b) after the reload, emulate a disconnected network; the already
      //     loaded game must keep advancing (nothing needs the network to play).
      const activeSession = reloaded ? reloaded.sessionId : gameSessionId;
      const beforeOffline = await capture.evaluate(activeSession, 'window.__M1_GAME__ ? window.__M1_GAME__.ticks : -1');
      await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, activeSession);
      await sleep(1500);
      const afterOffline = await capture.evaluate(activeSession, 'window.__M1_GAME__ ? window.__M1_GAME__.ticks : -1');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, activeSession).catch(() => {});
      evidence.scenarios.offlinePlay = { beforeOffline, afterOffline, sessionId: activeSession };
      check(checks, 'offline-play-ticks-advance-with-network-disabled', typeof afterOffline === 'number' && typeof beforeOffline === 'number' && afterOffline > beforeOffline + 1, evidence.scenarios.offlinePlay);
      await capture.setDefaultGate(null);
      void beforeReload;
      void reloadResult;
    } else {
      // Diagnostic fallback: re-embed the wrapper with the resource-credential
      // URL (no launch) under a non-resource-origin block gate. This proves the
      // reload URL semantics and offline resource loading without the Runtime.
      const freshLaunch = await launchFromPage(cdp, { gameId: good.gameId });
      const fresh = freshLaunch.body && freshLaunch.body.ok === true ? freshLaunch.body.data : null;
      if (fresh) {
        secrets.push(fresh.instanceId, fresh.nonce, new URL(fresh.resourceBase).pathname.split('/').filter(Boolean)[2]);
        const diagSince = Date.now();
        await capture.setDefaultGate({ allowPrefix: fresh.resourceOrigin });
        await embedWrapperDiagnostic(cdp, { wrapperUrl: fresh.wrapperResourceUrl, id: 'm1-diag-frame' });
        const diagReloaded = await waitForGameAfter(capture, diagSince, 25000);
        const diagRound = collectResourceRound(capture, { sessionId: diagReloaded ? diagReloaded.sessionId : null, wrapperSessionId: null, launch: fresh, since: diagSince });
        const reloadResourcesOk = ['index.html', 'dsh-sdk.js', 'scripts/main.mjs', 'scripts/logic.mjs', 'styles/game.css', 'data/level.json', 'assets/ship.png', 'assets/pickup.wav']
          .every((rel) => diagRound.resourceRequests.some((entry) => relOf(entry.url, fresh.resourceBase) === rel && entry.status === 200));
        evidence.scenarios.diagnosticReload = {
          rendered: diagReloaded ? { title: diagReloaded.snapshot.title, phase: diagReloaded.snapshot.game && diagReloaded.snapshot.game.phase } : null,
          blockedRequests: capture.state.fetchBlocked.slice(),
          resourceStatuses: diagRound.resourceRequests.map((entry) => ({ rel: relOf(entry.url, fresh.resourceBase), status: entry.status })),
        };
        check(checks, 'diagnostic-offline-gate-reload-loads-all-resources', reloadResourcesOk, evidence.scenarios.diagnosticReload, { required: false });
        check(checks, 'diagnostic-offline-gate-blocked-zero-non-resource-requests', capture.state.fetchBlocked.length === 0, capture.state.fetchBlocked.slice(0, 10), { required: false });
        if (diagReloaded && diagReloaded.snapshot.game && !diagReloaded.snapshot.chromeError) {
          const before = diagReloaded.snapshot.game.ticks;
          await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, diagReloaded.sessionId);
          await sleep(1500);
          const after = await capture.evaluate(diagReloaded.sessionId, 'window.__M1_GAME__ ? window.__M1_GAME__.ticks : -1');
          await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, diagReloaded.sessionId).catch(() => {});
          evidence.scenarios.diagnosticOfflinePlay = { before, after };
          check(checks, 'diagnostic-offline-play-ticks-advance', typeof after === 'number' && typeof before === 'number' && after > before + 1, evidence.scenarios.diagnosticOfflinePlay, { required: false });
        }
        await capture.setDefaultGate(null);
      }
      check(checks, 'offline-gate-reload-renders-and-plays', false, { reason: 'runtime wrapper embedding is currently broken; see diagnostic evidence' });
    }

    // --- 9. screenshots -----------------------------------------------------
    try {
      evidence.scenarios.screenshots = {
        full: await screenshot(cdp, 'a02-dsh-page-full'),
        runtimeContainer: await cdp.eval(`(() => { const c = document.getElementById('m1-runtime-container') || document.getElementById('m1-diag-frame'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`).then(async (rect) =>
          rect ? screenshot(cdp, 'a02-runtime-iframe', { ...rect, scale: 1 }) : null
        ).catch(() => null),
      };
    } catch (_error) {
      evidence.scenarios.screenshots = { error: 'screenshot failed' };
    }
  } catch (error) {
    check(checks, 'a02-completed-without-throwing', false, { error: String(error && error.stack ? error.stack : error).slice(0, 1200) });
  } finally {
    try {
      await removeProbeFrames(cdp);
      await runtimeDestroy(cdp);
    } catch (_error) {
      // ignore
    }
    try {
      if (cdp) cdp.dispose();
    } catch (_error) {
      // ignore
    }
    try {
      if (sink) await sink.stop();
    } catch (_error) {
      // ignore
    }
    try {
      if (staticOrigin) await staticOrigin.stop();
    } catch (_error) {
      // ignore
    }
    try {
      if (hostHandle) {
        if (KEEP) await hostHandle.stop();
        else await hostHandle.cleanup();
      }
    } catch (_error) {
      // ignore
    }
    if (hostHandle && KEEP) evidence.environment.keptHome = hostHandle.home;
  }

  const written = writeEvidence('M1-A02-multiresource', {
    id: 'M1-A02-multiresource',
    title: evidence.title,
    command: `node scripts/verification/v1.5/m1/m1-a02-multiresource.mjs${KEEP ? ' --keep' : ''}`,
    environment: evidence.environment,
    checks,
    extra: { scenarios: evidence.scenarios },
  }, secrets);
  const failed = checks.filter((entry) => entry.required && !entry.ok);
  if (failed.length > 0) exitCode = 1;
  process.stdout.write(`\nM1-A02 ${written.passed ? 'PASSED' : 'FAILED'} (${checks.filter((c) => c.required && c.ok).length}/${checks.filter((c) => c.required).length} required checks)\n`);
  process.stdout.write(`evidence: ${written.file}\n`);
  for (const entry of failed) process.stdout.write(`  FAIL ${entry.name}: ${JSON.stringify(evidenceSafe(entry.detail)).slice(0, 300)}\n`);
  process.exitCode = exitCode;
}

function evidenceSafe(value) {
  try {
    return sanitiseForEvidence(value);
  } catch (_error) {
    return String(value);
  }
}

main().catch((error) => {
  process.stderr.write(`[m1-a02] fatal: ${String(error && error.stack ? error.stack : error)}\n`);
  process.exitCode = 1;
});
