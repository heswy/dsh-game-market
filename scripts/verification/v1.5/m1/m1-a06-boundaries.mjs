#!/usr/bin/env node
/**
 * M1 · A06 — real browser security boundaries through the real Host resource
 * origin + platform wrapper + production Runtime bridge.
 *
 * Contract: docs/V1.5-CONTRACTS.md §7.4/§7.5/§7.5.1; guide §8 A06: "浏览器验证
 * sandbox/CSP/CORS/ESM；恶意游戏不能 fetch 外网、读 Host API、调用更新/答案/
 * 审批；Host 写接口对不可信 Origin 与无凭据请求拒绝".
 *
 * The hostile package is a *valid* `asset-zip-v2` package (passes installation
 * validation; no inline scripts) that misbehaves at runtime exactly like a
 * malicious author could. Every refusal assertion has a positive control so a
 * "nothing happened" run cannot pass:
 *   - external egress: sink origin records every HTTP request AND WS upgrade;
 *     package-internal same-origin fetch/ESM/CSS must succeed (proved in A02
 *     and re-proved here via `fetch-same-origin` + bridge handshake);
 *   - Host API: page itself can read `/api/game-market/health` (endpoint is
 *     live), the game's attempts are blocked pre-network;
 *   - Bridge: wrapper relay accepts the real SDK handshake and a legit
 *     `storage.save`, while spoofed messages from a non-instance window are
 *     rejected and COUNTED (invalid-message budget -> fatal GM-5004 at >50/10s);
 *   - navigation: the game logs the attempt before `location.replace(external)`;
 *     the sink must stay silent and the document must still be there, then a
 *     same-origin page navigation must really load (positive control).
 *
 * Two Runtime instances are used: instance #1 for the egress/bridge-abuse
 * evidence and the untrusted-window flood (which intentionally trips the
 * fatal invalid-message budget), instance #2 for the wrapper navigation tests.
 *
 * Usage: node scripts/verification/v1.5/m1/m1-a06-boundaries.mjs [--keep]
 * Exit code 0 = every required check passed. Evidence:
 *   docs/verification/v1.5/raw/m1/a06-<timestamp>.json + screenshots/.
 */
import fs from 'node:fs';

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
  runtimeDestroy,
  runtimeState,
  removeProbeFrames,
  screenshot,
  buildEvilPackage,
  writeEvidence,
  OUT_DIR,
} from './lib/lab.mjs';

const PORTS = Object.freeze({ bootstrap: 58290, host: 58291, static: 58341, sink: 58342, chrome: 9507 });
const KEEP = process.argv.includes('--keep');

function opId(tag) {
  return `op_m1_a06_${tag}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function check(checks, name, ok, detail, { required = true } = {}) {
  checks.push({ name, ok: Boolean(ok), required, detail });
  return Boolean(ok);
}

function headerOf(entry, name) {
  const headers = entry.responseHeaders || {};
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? null : String(headers[key]);
}

function networkSummary(entry, resourceBase) {
  let credentialKind = 'other';
  try {
    const parsed = new URL(entry.url);
    if (parsed.pathname.endsWith('/wrapper')) credentialKind = 'wrapper-document';
    else if (parsed.pathname.includes('/res/')) {
      credentialKind = parsed.pathname.endsWith('/index.html') && parsed.searchParams.get('launch') ? 'entry-launch' : 'resource';
    }
    if (resourceBase && typeof entry.url === 'string' && entry.url.startsWith(`${resourceBase}/`)) {
      // keep resource rel for evidence readability
      credentialKind = `${credentialKind}:${entry.url.slice(resourceBase.length + 1).replace(/[?#].*$/, '')}`;
    }
  } catch (_error) {
    credentialKind = 'unparsable';
  }
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
    credentialKind,
    requestOrigin: entry.actualRequestHeaders ? entry.actualRequestHeaders.origin ?? null : null,
    responseHeaders: {
      contentType: headerOf(entry, 'content-type'),
      accessControlAllowOrigin: headerOf(entry, 'access-control-allow-origin'),
      contentSecurityPolicy: headerOf(entry, 'content-security-policy'),
    },
  };
}

function parsedConsole(capture) {
  const events = [];
  for (const entry of capture.state.console) {
    if (typeof entry.text !== 'string') continue;
    if (entry.text.startsWith('M1P_ATTACKER ')) {
      try {
        events.push({ sessionId: entry.sessionId, kind: 'attacker', at: entry.at, ...JSON.parse(entry.text.slice('M1P_ATTACKER '.length)) });
      } catch (_error) {
        events.push({ sessionId: entry.sessionId, kind: 'attacker', at: entry.at, unparsed: entry.text.slice(0, 200) });
      }
      continue;
    }
    if (!entry.text.startsWith('M1P ')) continue;
    try {
      events.push({ sessionId: entry.sessionId, kind: 'game', at: entry.at, ...JSON.parse(entry.text.slice('M1P '.length)) });
    } catch (_error) {
      events.push({ sessionId: entry.sessionId, kind: 'game', at: entry.at, unparsed: entry.text.slice(0, 200) });
    }
  }
  return events;
}

async function waitForConsole(capture, predicate, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const match = parsedConsole(capture).find(predicate);
    if (match) return match;
    await sleep(200);
  }
  return null;
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
            chromeError: location.href.startsWith('chrome-error:'),
            evil: window.__M1_EVIL__ ? {
              phase: window.__M1_EVIL__.phase,
              initEvents: window.__M1_EVIL__.initEvents,
              observed: window.__M1_EVIL__.observed,
              bridgeResponses: window.__M1_EVIL__.bridgeResponses,
              bridgeReady: window.__M1_EVIL__.bridgeReady || null
            } : null
          }))()`
        );
        if (snapshot && (snapshot.evil || snapshot.chromeError || snapshot.title === 'M1 Boundary Probe · second')) return { sessionId: session.sessionId, snapshot };
      } catch (_error) {
        // In flight.
      }
    }
    await sleep(250);
  }
  return null;
}

async function waitForFileSessions(capture, cdp, urlIncludes, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const session of capture.state.attached.filter((record) => record.type === 'iframe' && typeof record.url === 'string' && record.url.includes(urlIncludes))) {
      try {
        const value = await capture.evaluate(
          session.sessionId,
          `({ origin: window.origin, title: document.title || '', href: location.href, hasHud: Boolean(document.getElementById('hud')), chromeError: location.href.startsWith('chrome-error:') })`
        );
        if (value) return { sessionId: session.sessionId, value };
      } catch (_error) {
        // In flight.
      }
    }
    await sleep(250);
  }
  return null;
}

function sample(value) {
  try {
    return JSON.stringify(value).slice(0, 1200);
  } catch (_error) {
    return String(value).slice(0, 400);
  }
}

async function launchInstance({ cdp, capture, gameId, tag }) {
  const launch = await launchFromPage(cdp, { gameId });
  const info = launch.body && launch.body.ok === true ? launch.body.data : null;
  if (!info) throw new Error(`launch failed (${tag}): ${sample(launch)}`);
  const since = Date.now();
  await setupRuntimeLab(cdp, { staticOrigin: globalThis.__M1_STATIC_ORIGIN__ });
  await runtimeLaunch(cdp, info);
  const rendered = await waitForGameAfter(capture, since, 25000);
  const phase1 = rendered && rendered.snapshot.evil ? await waitForConsole(capture, (event) => event.event === 'phase1-complete', 25000) : null;
  // Re-read the documented state AFTER phase1: the initial snapshot is taken at
  // 'boot' and would miss the later attack outcomes (probe lesson).
  const finalState = rendered
    ? await capture
        .evaluate(
          rendered.sessionId,
          `window.__M1_EVIL__ ? JSON.parse(JSON.stringify(window.__M1_EVIL__)) : null`
        )
        .catch(() => null)
    : null;
  const runtimeEvents = await cdp.eval('window.__M1_LAB__ ? window.__M1_LAB__.eventLog() : []').catch(() => []);
  return { info, launch, rendered, finalState, phase1, runtimeEvents, since };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const identity = runtimeIdentity();
  const checks = [];
  const evidence = {
    id: 'M1-A06-boundaries',
    title: 'A06: external egress / Host API / bridge abuse / wrapper navigation boundaries',
    environment: { dsh: identity, chrome: 'Google Chrome headless via CDP', ports: PORTS },
    scenarios: { egress: {}, bridge: {}, navigation: {}, runtime: {} },
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
    globalThis.__M1_STATIC_ORIGIN__ = staticInfo.origin;
    sink = createSinkOrigin({ port: PORTS.sink });
    const sinkInfo = await sink.start();

    hostHandle = await startIsolatedHost({ name: 'probe-m1-a06', ports: PORTS });
    cdp = await Cdp.launch({ port: PORTS.chrome });
    capture = createCdpCapture(cdp);
    await capture.start();
    await cdp.navigate(hostHandle.host.url);
    const boot = await waitForDshPage(cdp, hostHandle.hostOrigin);
    check(checks, 'dsh-page-loads-and-host-api-answers', boot.health && boot.health.status === 200, { health: boot.health });

    // Positive control: the Host API endpoint really exists and is readable from
    // the trusted page (so "the game cannot read it" is not because it is dead).
    const pageHealth = await cdp.eval(`fetch('/api/game-market/health').then(async (response) => ({ status: response.status, body: await response.json() }))`);
    evidence.scenarios.egress.pageApiPositiveControl = { status: pageHealth.status, ok: pageHealth.body && pageHealth.body.ok };
    check(checks, 'host-api-positive-control-page-200', pageHealth.status === 200 && pageHealth.body && pageHealth.body.ok === true, { status: pageHealth.status });

    // Evil (valid-ASCII, runtime-misbehaving) package.
    const evil = await buildEvilPackage({
      gameId: 'm1-a06-boundaries',
      dshOrigin: hostHandle.hostOrigin,
      sinkOrigin: sinkInfo.origin,
      sinkWsOrigin: sinkInfo.wsOrigin,
      externalUrl: sinkInfo.origin,
    });
    const install = await installZipFromPage(cdp, evil.zip, { operationId: opId('install') });
    const installed = install.body && install.body.ok === true ? install.body.data : null;
    evidence.scenarios.install = {
      status: install.status,
      gameId: installed && installed.gameId,
      format: installed && installed.installation && installed.installation.format,
      fileCount: installed && installed.installation && installed.installation.fileCount,
    };
    check(checks, 'evil-package-installs-through-real-host-api', Boolean(installed && installed.installation && installed.installation.format === 'asset-zip-v2'), evidence.scenarios.install);

    // =====================================================================
    // Instance #1: egress, Host API, bridge abuse, untrusted-window flood
    // =====================================================================
    const instance1 = await launchInstance({ cdp, capture, gameId: 'm1-a06-boundaries', tag: 'instance1' });
    secrets.push(instance1.info.instanceId, instance1.info.nonce, new URL(instance1.info.resourceBase).pathname.split('/').filter(Boolean)[2]);
    const evilState = instance1.finalState || {};
    const runtimeInfo1 = await runtimeState(cdp).catch(() => null);
    evidence.scenarios.runtime.instance1 = {
      derivedInfo: { resourceOrigin: instance1.info.resourceOrigin, resourceBase: instance1.info.resourceBase, wrapperUrl: instance1.info.wrapperUrl },
      frame: runtimeInfo1 && runtimeInfo1.frame,
      rendered: instance1.rendered,
      finalState: instance1.finalState,
      phase1: instance1.phase1,
      runtimeEvents: instance1.runtimeEvents,
    };
    // Two-layer iframe attributes (Lead hard assertion 2026-10-20).
    const frame = runtimeInfo1 && runtimeInfo1.frame;
    check(checks, 'outer-wrapper-iframe-no-sandbox-attribute', Boolean(frame && frame.sandbox === null), { frame });
    const wrapperFrame = await capture
      .evaluateInFrame('/wrapper?', `(() => {
        const inner = document.getElementById('dsh-game-frame');
        return {
          origin: location.origin,
          windowOrigin: window.origin,
          innerCount: document.querySelectorAll('iframe').length,
          innerSandbox: inner ? inner.getAttribute('sandbox') : null,
          innerAllow: inner ? inner.getAttribute('allow') : null,
          innerReferrerPolicy: inner ? inner.getAttribute('referrerpolicy') : null
        };
      })()`)
      .catch((error) => ({ frameFound: false, error: String(error.message).slice(0, 200) }));
    evidence.scenarios.runtime.wrapperLayer = wrapperFrame;
    check(
      checks,
      'wrapper-layer-origin-and-inner-game-sandbox',
      Boolean(
        wrapperFrame &&
          wrapperFrame.frameFound &&
          wrapperFrame.value &&
          wrapperFrame.value.origin === instance1.info.resourceOrigin &&
          wrapperFrame.value.windowOrigin === instance1.info.resourceOrigin &&
          wrapperFrame.value.innerCount === 1 &&
          wrapperFrame.value.innerSandbox === 'allow-scripts' &&
          !/allow-same-origin/.test(String(wrapperFrame.value.innerSandbox)) &&
          wrapperFrame.value.innerReferrerPolicy === 'no-referrer'
      ),
      wrapperFrame
    );
    check(
      checks,
      'game-document-renders-not-chrome-error',
      Boolean(instance1.rendered && instance1.rendered.snapshot && !instance1.rendered.snapshot.chromeError && instance1.rendered.snapshot.evil),
      instance1.rendered
    );
    check(
      checks,
      'game-document-title-and-dom-present',
      Boolean(instance1.rendered && instance1.rendered.snapshot && instance1.rendered.snapshot.title === 'M1 Boundary Probe' && instance1.rendered.snapshot.hasHud === true && instance1.rendered.snapshot.origin === 'null'),
      instance1.rendered && instance1.rendered.snapshot
    );
    check(checks, 'evil-package-phase1-completed', Boolean(instance1.phase1 && instance1.phase1.event === 'phase1-complete'), instance1.phase1 || null);

    // Screenshot while the hostile game is actually rendered (before the flood
    // and navigation tests tear it down): proves "rendered, not just 200".
    try {
      const containerRect = await cdp.eval(`(() => { const c = document.getElementById('m1-runtime-container'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
      evidence.scenarios.screenshots = evidence.scenarios.screenshots || {};
      if (containerRect) {
        evidence.scenarios.screenshots.gameRendered = await screenshot(cdp, 'a06-game-rendered', { ...containerRect, scale: 1 });
        evidence.scenarios.screenshots.gameRenderedFull = await screenshot(cdp, 'a06-game-rendered-full');
      }
    } catch (_error) {
      evidence.scenarios.screenshots = { error: 'early screenshot failed' };
    }

    // Wrapper CSP (response header assertion, not DOM).
    const wrapperResponse = await fetch(instance1.info.wrapperUrl);
    const wrapperCsp = wrapperResponse.headers.get('content-security-policy') || '';
    const wrapperAncestors = (wrapperCsp.match(/frame-ancestors\s+([^;]+)/i) || [])[1] || null;
    evidence.scenarios.runtime.wrapperCsp = { csp: wrapperCsp, frameAncestors: wrapperAncestors, status: wrapperResponse.status };
    check(checks, 'wrapper-csp-frame-src-resource-origin', wrapperCsp.includes(`frame-src ${instance1.info.resourceOrigin}`) && wrapperCsp.includes(`child-src ${instance1.info.resourceOrigin}`), { csp: wrapperCsp });
    check(checks, 'wrapper-csp-has-frame-ancestors', wrapperAncestors !== null && !wrapperAncestors.trim().split(/\s+/).includes('*'), { frameAncestors: wrapperAncestors });
    check(checks, 'wrapper-csp-frame-ancestors-no-wildcard-at-all', wrapperAncestors !== null && !wrapperAncestors.includes('*'), { frameAncestors: wrapperAncestors });

    // ---- External egress: sink must be silent, attempts must be observable --
    const sinkRequests = sink.requests();
    const sinkUpgrades = sink.upgrades();
    const netAfterLaunch = capture.state.networkOrder.filter((entry) => entry.at >= instance1.since);
    const externalNetwork = netAfterLaunch
      .filter((entry) => typeof entry.url === 'string' && (entry.url.startsWith(sinkInfo.origin) || entry.url.startsWith(sinkInfo.wsOrigin)))
      .map((entry) => networkSummary(entry, instance1.info.resourceBase));
    evidence.scenarios.egress = {
      sinkRequests,
      sinkUpgrades,
      externalNetwork,
      gameObserved: evilState.observed || null,
      attempts: evilState.attempts || null,
      bridgeReady: evilState.bridgeReady || null,
    };
    check(checks, 'egress-sink-received-zero-http-requests', sinkRequests.length === 0, sinkRequests);
    check(checks, 'egress-sink-received-zero-websocket-upgrades', sinkUpgrades.length === 0, sinkUpgrades);
    const sentExternal = externalNetwork.filter((entry) => entry.status !== null && entry.status !== undefined && entry.failed !== true);
    const blockedByCsp = externalNetwork.filter((entry) => entry.failed === true && entry.blockedReason === 'csp');
    check(
      checks,
      'egress-network-layer-blocked-before-send',
      sentExternal.length === 0 && blockedByCsp.length === externalNetwork.length,
      { total: externalNetwork.length, sent: sentExternal, blockedByCsp: blockedByCsp.length, note: 'CDP reports a request event for XHR before the CSP check; blockedReason=csp means nothing left the renderer (sink is the network-layer witness)' }
    );
    const observed = evilState.observed || {};
    check(checks, 'egress-fetch-external-rejected', Boolean(observed['fetch-external'] && observed['fetch-external'].resolved === false), observed['fetch-external']);
    check(checks, 'egress-xhr-external-rejected', Boolean(observed['xhr-external'] && observed['xhr-external'].resolved === false), observed['xhr-external']);
    check(checks, 'egress-websocket-external-not-opened', Boolean(observed['websocket-external'] && observed['websocket-external'].opened === false), observed['websocket-external']);
    check(checks, 'egress-window-open-external-blocked', Boolean(observed['window-open-external'] && observed['window-open-external'].opened === false), observed['window-open-external']);
    check(checks, 'egress-fetch-same-origin-positive-control', Boolean(observed['fetch-same-origin'] && observed['fetch-same-origin'].resolved === true && observed['fetch-same-origin'].status === 200), observed['fetch-same-origin']);
    check(checks, 'egress-entry-launch-replay-is-410', Boolean(observed['entry-launch-replay'] && observed['entry-launch-replay'].resolved === true && observed['entry-launch-replay'].status === 410), observed['entry-launch-replay']);
    const pageUrlAfterTopNav = await cdp.eval('location.href').catch(() => null);
    const pagePageAfter = (() => {
      try {
        const url = new URL(pageUrlAfterTopNav);
        return `${url.origin}${url.pathname}`;
      } catch (_error) {
        return null;
      }
    })();
    evidence.scenarios.egress.pageUrlAfter = pageUrlAfterTopNav;
    check(
      checks,
      'egress-top-navigation-did-not-change-page',
      pagePageAfter === `${hostHandle.hostOrigin}/`,
      { after: pageUrlAfterTopNav, expectedPage: `${hostHandle.hostOrigin}/` }
    );
    check(
      checks,
      'egress-top-navigation-blocked',
      Boolean(observed['top-navigation-external'] && (observed['top-navigation-external'].assignment === 'threw' || observed['top-navigation-external'].assignment === 'accepted-by-js')),
      observed['top-navigation-external']
    );

    // ---- Host API: game attempts blocked pre-network ----------------------
    const apiPaths = ['/api/game-market/health', '/api/game-market/save', '/api/game-market/install', '/api/game-market/uninstall', '/api/game-market/update', '/api/game-market/answer', '/api/game-market/approval'];
    const apiRequestsAfterLaunch = netAfterLaunch
      .filter((entry) => typeof entry.url === 'string' && entry.url.startsWith(`${hostHandle.hostOrigin}/api/`))
      .map((entry) => ({ ...networkSummary(entry, instance1.info.resourceBase), path: new URL(entry.url).pathname }));
    const gameBlockedApiRead = !apiRequestsAfterLaunch.some((entry) => entry.path === '/api/game-market/health' && entry.status !== 200 && entry.sessionId !== null);
    evidence.scenarios.egress.apiRequestsAfterLaunch = apiRequestsAfterLaunch;
    check(checks, 'host-api-game-fetch-rejected', Boolean(observed['fetch-host-api'] && observed['fetch-host-api'].resolved === false), observed['fetch-host-api']);
    check(checks, 'host-api-game-xhr-rejected', Boolean(observed['xhr-host-api'] && observed['xhr-host-api'].resolved === false), observed['xhr-host-api']);
    // Game-initiated requests to the DSH API must all be blocked before the
    // network (CSP connect-src). The only successful /api traffic allowed is the
    // trusted page/Runtime path: the bridge's sanctioned storage.save, the
    // Runtime release, DSH's own session UI endpoint, and the probe's own
    // Boot-time health control (before launch, so not in this slice).
    const allowedSuccessfulApiPaths = new Set(['/api/game-market/save', '/api/game-market/runtime-release', '/api/game-market/session', '/api/session/create']);
    const gameSessionApi = apiRequestsAfterLaunch.filter((entry) => entry.sessionId === (instance1.rendered && instance1.rendered.sessionId));
    check(
      checks,
      'host-api-game-attempts-all-blocked-pre-network',
      gameSessionApi.length > 0 && gameSessionApi.every((entry) => entry.failed === true && entry.blockedReason === 'csp'),
      gameSessionApi
    );
    const successfulApi = apiRequestsAfterLaunch.filter((entry) => entry.status === 200);
    check(
      checks,
      'host-api-no-dangerous-endpoint-called',
      successfulApi.every((entry) => allowedSuccessfulApiPaths.has(entry.path)),
      { successful: successfulApi, gameSessionApi }
    );
    check(checks, 'host-api-read-attempt-blocked', !successfulApi.some((entry) => entry.path === '/api/game-market/health'), successfulApi);
    void gameBlockedApiRead; void apiPaths;

    // ---- Bridge capability abuse + legit relay positive control ----------
    const dangerousResponses = (evilState.bridgeResponses || []).filter((response) => String(response.id).startsWith('evil-req-') && response.id !== 'evil-req-save');
    const legitSaveResponse = (evilState.bridgeResponses || []).find((response) => response.id === 'evil-req-save');
    evidence.scenarios.bridge = {
      bridgeRequests: evilState.bridgeRequests || null,
      bridgeResponses: evilState.bridgeResponses || null,
      initEvents: evilState.initEvents,
      runtimeEvents: instance1.runtimeEvents,
    };
    check(checks, 'bridge-legit-save-accepted-via-wrapper-relay', Boolean(legitSaveResponse && legitSaveResponse.ok === true), legitSaveResponse || null);
    check(checks, 'bridge-handshake-ready-positive-control', Boolean(evilState.bridgeReady && evilState.bridgeReady.ok === true && evilState.bridgeReady.packageFormat === 'asset-zip-v2'), evilState.bridgeReady || null);
    check(
      checks,
      'bridge-dangerous-methods-absent-or-rejected',
      dangerousResponses.length === 6 && dangerousResponses.every((response) => response.ok === false && /^GM-/.test(String(response.code))),
      dangerousResponses
    );
    check(checks, 'bridge-direct-to-top-spoof-produces-no-extra-init', evilState.initEvents === 1, { initEvents: evilState.initEvents });
    const runtimeEventCodes = instance1.runtimeEvents.map((event) => event.error && event.error.code).filter(Boolean);
    evidence.scenarios.bridge.runtimeEventCodes = runtimeEventCodes;

    // ---- Untrusted window postMessage: rejected AND counted --------------
    // A separate attacker iframe (static origin, unprivileged page) posts 60
    // structurally valid bridge envelopes to the DSH page. The Runtime accepts
    // only the wrapper WindowProxy, so every message is invalid; the bridge
    // invalid budget (>50 / 10s) must trip the documented fatal GM-5004.
    await cdp.eval(`(() => {
      const existing = document.getElementById('m1-attacker-frame');
      if (existing) existing.remove();
      const frame = document.createElement('iframe');
      frame.id = 'm1-attacker-frame';
      frame.src = ${JSON.stringify(`${staticInfo.origin}/probe/attacker.html?count=60&delay=400`)};
      frame.style.cssText = 'position:fixed;left:940px;top:96px;width:220px;height:140px;border:2px solid #b33;z-index:2147483000;background:#200';
      document.body.appendChild(frame);
      return true;
    })()`);
    const floodStarted = Date.now();
    let floodObservation = null;
    const fatalEvent = await (async () => {
      const started = Date.now();
      while (Date.now() - started < 12000) {
        floodObservation = await cdp.eval(`(() => {
          const lab = window.__M1_LAB__;
          const container = document.getElementById('m1-runtime-container');
          return {
            labPresent: Boolean(lab),
            framesInContainer: container ? container.querySelectorAll('iframe').length : null,
            state: lab ? lab.state().state : null,
            events: lab ? lab.eventLog() : []
          };
        })()`).catch((error) => ({ evalError: String(error).slice(0, 200) }));
        const fatal = floodObservation && Array.isArray(floodObservation.events)
          ? floodObservation.events.find((event) => event.type === 'error' && event.error && event.error.code === 'GM-5004')
          : null;
        if (fatal) return fatal;
        await sleep(250);
      }
      return null;
    })();
    const attackerLog = parsedConsole(capture).find((event) => event.kind === 'attacker');
    evidence.scenarios.bridge.untrustedWindowFlood = {
      floodStarted,
      fatalEvent,
      attackerLog: attackerLog || null,
      observation: floodObservation,
    };
    check(
      checks,
      'bridge-untrusted-window-spoof-rejected-and-counted',
      Boolean(fatalEvent) && Boolean(floodObservation && floodObservation.state === 'error'),
      { fatalEvent, observation: floodObservation }
    );
    check(checks, 'bridge-untrusted-window-got-no-bridge-response', Boolean(attackerLog && attackerLog.received === 0), attackerLog || null);

    // =====================================================================
    // Instance #2: wrapper self-navigation boundary (external blocked,
    // same-origin positive control)
    // =====================================================================
    await runtimeDestroy(cdp);
    await removeProbeFrames(cdp);
    await sleep(500);
    sink.reset();
    const instance2 = await launchInstance({ cdp, capture, gameId: 'm1-a06-boundaries', tag: 'instance2' });
    secrets.push(instance2.info.instanceId, instance2.info.nonce, new URL(instance2.info.resourceBase).pathname.split('/').filter(Boolean)[2]);
    evidence.scenarios.navigation.instance2 = { rendered: instance2.rendered, phase1: instance2.phase1 };
    check(checks, 'navigation-instance2-renders-and-phases1', Boolean(instance2.rendered && instance2.rendered.snapshot.evil && instance2.phase1), { rendered: instance2.rendered, phase1: instance2.phase1 });
    const sinkRequestsBeforeNav = sink.requests().length;
    const networkBeforeNav = capture.state.networkOrder.length;
    const sendProbeCommand = (command) =>
      cdp.eval(`(() => {
        const container = document.getElementById('m1-runtime-container');
        const outer = container && container.querySelector('iframe');
        if (!outer || !outer.contentWindow) return false;
        outer.contentWindow.postMessage({ probeCommand: ${JSON.stringify(command)} }, '*');
        return true;
      })()`);
    // --- external self-navigation: wrapper frame-src must block it ----------
    await sendProbeCommand('run-external-nav');
    const externalAttempt = await waitForConsole(capture, (event) => event.event === 'nav-external-attempt', 15000);
    const blockedCheck = await waitForConsole(capture, (event) => event.event === 'nav-external-blocked-check', 10000);
    await sleep(1200);
    const networkAfterNav = capture.state.networkOrder.slice(networkBeforeNav);
    const sinkRequestsAfterNav = sink.requests();
    const externalNavNet = networkAfterNav
      .filter((entry) => typeof entry.url === 'string' && entry.url.startsWith(sinkInfo.origin))
      .map((entry) => networkSummary(entry, instance2.info.resourceBase));
    const navRuntimeEventsBefore = await cdp.eval('window.__M1_LAB__ ? window.__M1_LAB__.eventLog() : []').catch(() => []);
    const frameSrcViolations = capture.state.logs.filter(
      (entry) => /Framing .*violates.*frame-src/i.test(entry.text || '') && (entry.text || '').includes(sinkInfo.origin)
    );
    evidence.scenarios.navigation.external = {
      externalAttempt,
      blockedCheck,
      sinkRequestsBeforeNav,
      sinkRequestsAfterNav,
      externalNavNet,
      frameSrcViolations,
      runtimeEvents: navRuntimeEventsBefore.slice(-20),
    };
    check(checks, 'navigation-external-attempt-is-observable', Boolean(externalAttempt), externalAttempt || null);
    check(checks, 'navigation-wrapper-frame-src-blocked-external', sinkRequestsAfterNav.length === 0 && externalNavNet.length === 0, { sinkRequestsAfterNav, externalNavNet });
    check(
      checks,
      'navigation-external-blocked-by-frame-src',
      frameSrcViolations.length > 0 && frameSrcViolations.every((entry) => (entry.text || '').includes(`frame-src ${instance2.info.resourceOrigin}`)),
      frameSrcViolations
    );
    // A blocked self-navigation may abort the game document (Chrome may replace
    // the frame with an error document), so "document still alive" is recorded,
    // not required: the security requirement is the zero-request target boundary.
    evidence.scenarios.navigation.external.documentStillAlive = Boolean(blockedCheck && blockedCheck.stillHere === true);
    check(checks, 'navigation-no-request-reached-external-origin', sink.requests().length === 0 && sink.upgrades().length === 0, { requests: sink.requests(), upgrades: sink.upgrades() });
    await runtimeDestroy(cdp);
    await removeProbeFrames(cdp);
    await sleep(500);

    // --- same-origin positive control on a fresh instance ------------------
    const instance3 = await launchInstance({ cdp, capture, gameId: 'm1-a06-boundaries', tag: 'instance3' });
    secrets.push(instance3.info.instanceId, instance3.info.nonce, new URL(instance3.info.resourceBase).pathname.split('/').filter(Boolean)[2]);
    evidence.scenarios.navigation.instance3 = { rendered: instance3.rendered, phase1: instance3.phase1 };
    const networkBeforeSameOrigin = capture.state.networkOrder.length;
    await sendProbeCommand('run-same-origin-nav');
    const sameOriginAttempt = await waitForConsole(capture, (event) => event.event === 'nav-same-origin-attempt', 15000);
    const secondPage = await waitForConsole(capture, (event) => event.event === 'second-page', 20000);
    await sleep(800);
    const secondPageNetwork = capture.state.networkOrder.slice(networkBeforeSameOrigin);
    const secondPageResponse = secondPageNetwork
      .filter((entry) => typeof entry.url === 'string' && entry.url.includes('/second.html'))
      .map((entry) => networkSummary(entry, instance3.info.resourceBase));
    evidence.scenarios.navigation.sameOrigin = { sameOriginAttempt, secondPage, secondPageResponse };
    check(checks, 'navigation-same-origin-positive-control-loads', Boolean(sameOriginAttempt && secondPage && secondPageResponse.some((entry) => entry.status === 200)), { sameOriginAttempt, secondPage, secondPageResponse });
    // §7.5.1 defence-in-depth: after the game navigated itself to a same-origin
    // page that does not speak the bridge, heartbeat pings must fail and the
    // Runtime must revoke the instance (3 consecutive misses; ~15-25s).
    let navRuntimeEvents = [];
    const revocationDeadline = Date.now() + 28000;
    while (Date.now() < revocationDeadline) {
      navRuntimeEvents = await cdp.eval('window.__M1_LAB__ ? window.__M1_LAB__.eventLog() : []').catch(() => []);
      const found = navRuntimeEvents.filter((event) => event.type === 'error' && event.error && ['GM-5012', 'GM-5013'].includes(event.error.code));
      if (found.length > 0) break;
      await sleep(500);
    }
    const navRevocation = navRuntimeEvents.filter((event) => event.type === 'error' && event.error && ['GM-5012', 'GM-5013'].includes(event.error.code));
    evidence.scenarios.navigation.revocationAfterUnexpectedNestedNavigation = navRevocation;
    evidence.scenarios.navigation.runtimeEventsAfterHeartbeatWindow = navRuntimeEvents.slice(-20);
    check(checks, 'navigation-runtime-detects-unexpected-nested-navigation', navRevocation.length > 0, navRevocation, { required: false });

    // ---- Framing violations: zero frame-ancestors rejections -------------
    const allLogs = capture.state.logs;
    const framingViolations = allLogs.filter((entry) => /Framing .*violates.*frame-ancestors/i.test(entry.text || ''));
    const frameSrcBlocks = allLogs.filter((entry) => /Framing .*violates.*frame-src/i.test(entry.text || ''));
    const otherCspReports = allLogs.filter((entry) => /violates the following Content Security Policy|Refused to/i.test(entry.text || ''));
    evidence.scenarios.runtime.cspLogs = { framingViolations, frameSrcBlocks, otherCspReports: otherCspReports.slice(0, 20) };
    check(checks, 'no-frame-ancestors-framing-violations', framingViolations.length === 0, framingViolations.slice(0, 10));
    check(checks, 'frame-src-blocked-external-self-navigation-observed', frameSrcBlocks.length > 0, frameSrcBlocks.slice(0, 10));
    check(checks, 'csp-reported-blocked-egress-attempts', otherCspReports.length > 0, { count: otherCspReports.length, sample: otherCspReports.slice(0, 5) });

    // ---- Screenshots ------------------------------------------------------
    try {
      evidence.scenarios.screenshots = {
        full: await screenshot(cdp, 'a06-dsh-page-full'),
        runtimeContainer: await cdp.eval(`(() => { const c = document.getElementById('m1-runtime-container'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`).then(async (rect) =>
          rect ? screenshot(cdp, 'a06-runtime-iframe', { ...rect, scale: 1 }) : null
        ).catch(() => null),
      };
    } catch (_error) {
      evidence.scenarios.screenshots = { error: 'screenshot failed' };
    }
    void exitCode;
  } catch (error) {
    check(checks, 'a06-completed-without-throwing', false, { error: String(error && error.stack ? error.stack : error).slice(0, 1500) });
  } finally {
    try {
      await runtimeDestroy(cdp);
      await removeProbeFrames(cdp);
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

  const written = writeEvidence('M1-A06-boundaries', {
    id: 'M1-A06-boundaries',
    title: evidence.title,
    command: `node scripts/verification/v1.5/m1/m1-a06-boundaries.mjs${KEEP ? ' --keep' : ''}`,
    environment: evidence.environment,
    checks,
    extra: { scenarios: evidence.scenarios },
  }, secrets);
  const failed = checks.filter((entry) => entry.required && !entry.ok);
  if (failed.length > 0) exitCode = 1;
  process.stdout.write(`\nM1-A06 ${written.passed ? 'PASSED' : 'FAILED'} (${checks.filter((c) => c.required && c.ok).length}/${checks.filter((c) => c.required).length} required checks)\n`);
  process.stdout.write(`evidence: ${written.file}\n`);
  for (const entry of failed) process.stdout.write(`  FAIL ${entry.name}: ${sample(entry.detail)}\n`);
  process.exitCode = exitCode;
}

main().catch((error) => {
  process.stderr.write(`[m1-a06] fatal: ${String(error && error.stack ? error.stack : error)}\n`);
  process.exitCode = 1;
});
