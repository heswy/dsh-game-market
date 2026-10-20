#!/usr/bin/env node
/**
 * M1 · CR7-01 — every package HTML document must carry the asset CSP, not just
 * the entry document.
 *
 * Codex review of head `77c8d0a` found this gap: a ZIP `index.html` may navigate
 * itself to a same-origin `second.html` (inside the same sandboxed game iframe;
 * the wrapper's `frame-src` allows the resource origin), and that new document
 * used to be served **without** a Content-Security-Policy. It then loaded as a
 * fresh document in the sandboxed frame and could send external requests
 * (fetch/Image/WebSocket) — the wrapper boundary only constrains *navigation*,
 * not the new document's own subresources.
 *
 * This probe builds a real `asset-zip-v2` package (entry navigates to a
 * same-origin second page which attempts external egress), installs it through
 * the real Host API, launches it through the real RuntimeController + wrapper,
 * and asserts:
 *   - the second page really runs (title / DOM / JS marker — positive control);
 *   - `second.html` is served 200 with the **same asset CSP** as the entry
 *     document (per directive: `connect-src` = resource origin,
 *     `frame-ancestors` = `<DSH origin> <resource origin>`);
 *   - external sink receives **0 HTTP requests / 0 WebSocket upgrades** (the
 *     network-layer assertion; console alone is not enough);
 *   - `Image` does not load and `fetch` is rejected; Chrome logs the CSP
 *     violation (cause evidence);
 *   - the entry document's same-origin `fetch('./data/x.json')` still succeeds
 *     with 200 (the policy must not break legitimate same-origin reads).
 *
 * Pre-fix evidence (Codex asked for the "real gap" comparison): run this same
 * probe against a snapshot of the pre-fix head with `--plugin-root=<snapshot>`
 * `--label=prefix`. That run exits non-zero (missing CSP + sink hits) and its
 * JSON is kept as the falsifiable "before" artifact.
 *
 * Usage:
 *   node scripts/verification/v1.5/m1/m1-a06b-same-origin-html.mjs
 *   node scripts/verification/v1.5/m1/m1-a06b-same-origin-html.mjs --plugin-root=/tmp/m1b-prefix-77c8d0a --label=prefix
 * Exit code 0 = every required check passed; 1 = at least one required check
 * failed (evidence is still written).
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
  runtimeDestroy,
  removeProbeFrames,
  screenshot,
  buildSameOriginHtmlPackage,
  writeEvidence,
  OUT_DIR,
} from './lib/lab.mjs';

const PORTS = Object.freeze({ bootstrap: 58310, host: 58311, static: 58351, sink: 58352, chrome: 9511 });
const KEEP = process.argv.includes('--keep');
const PLUGIN_ROOT = (process.argv.find((arg) => arg.startsWith('--plugin-root=')) || '').slice('--plugin-root='.length) || null;
const LABEL = (process.argv.find((arg) => arg.startsWith('--label=')) || '').slice('--label='.length) || null;

const EVIDENCE_ID = LABEL ? `CR7-01-same-origin-html-${LABEL}` : 'CR7-01-same-origin-html';

function opId(tag) {
  return `op_m1_cr7a_${tag}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function check(checks, name, ok, detail, { required = true } = {}) {
  checks.push({ name, ok: Boolean(ok), required, detail });
  return Boolean(ok);
}

function sample(value, limit = 1200) {
  try {
    return JSON.stringify(value).slice(0, limit);
  } catch (_error) {
    return String(value).slice(0, 400);
  }
}

function headerOf(response, name) {
  const value = response && response.headers ? response.headers.get(name) : null;
  return value === null || value === undefined ? null : String(value);
}

function cspDirectives(csp) {
  const out = {};
  if (typeof csp !== 'string') return out;
  for (const part of csp.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const space = trimmed.indexOf(' ');
    const name = space === -1 ? trimmed : trimmed.slice(0, space);
    out[name] = space === -1 ? '' : trimmed.slice(space + 1).trim();
  }
  return out;
}

function parsedMessages(capture, prefix) {
  const events = [];
  for (const entry of capture.state.console) {
    if (typeof entry.text !== 'string' || !entry.text.startsWith(prefix)) continue;
    try {
      events.push({ sessionId: entry.sessionId, at: entry.at, ...JSON.parse(entry.text.slice(prefix.length)) });
    } catch (_error) {
      events.push({ sessionId: entry.sessionId, at: entry.at, unparsed: entry.text.slice(0, 200) });
    }
  }
  return events;
}

async function waitForMessage(capture, predicate, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const match = parsedMessages(capture, 'M1B ').find(predicate);
    if (match) return match;
    await sleep(150);
  }
  return null;
}

function networkSummary(entry, resourceBase) {
  let credentialKind = 'other';
  try {
    const parsed = new URL(entry.url);
    if (parsed.pathname.includes('/res/')) credentialKind = 'resource';
  } catch (_error) {
    credentialKind = 'unparsable';
  }
  const rel = resourceBase && typeof entry.url === 'string' && entry.url.startsWith(resourceBase)
    ? entry.url.slice(resourceBase.length + 1).replace(/[?#].*$/, '')
    : null;
  return {
    sessionId: entry.sessionId,
    method: entry.method,
    url: entry.url,
    rel,
    resourceType: entry.resourceType,
    status: entry.status ?? null,
    mimeType: entry.mimeType ?? null,
    failed: entry.failed === true,
    errorText: entry.errorText ?? null,
    blockedReason: entry.blockedReason ?? null,
    credentialKind,
    responseCsp: entry.responseHeaders
      ? (Object.entries(entry.responseHeaders).find(([key]) => key.toLowerCase() === 'content-security-policy') || [])[1] || null
      : null,
  };
}

function selectSecondSession(capture) {
  return capture.state.attached.find(
    (record) => record.type === 'iframe' && typeof record.url === 'string' && record.url.includes('second.html')
  );
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const identity = runtimeIdentity();
  const checks = [];
  const scenario = {
    pluginRoot: PLUGIN_ROOT || '<worktree>',
    label: LABEL,
    ports: PORTS,
  };
  let hostHandle = null;
  let staticOrigin = null;
  let sink = null;
  let cdp = null;
  let capture = null;
  const secrets = [];

  try {
    staticOrigin = createStaticOrigin({ port: PORTS.static });
    const staticInfo = await staticOrigin.start();
    sink = createSinkOrigin({ port: PORTS.sink });
    const sinkInfo = await sink.start();
    sink.reset();

    const hostHandleOptions = { name: `probe-m1-cr7a${LABEL ? '-' + LABEL : ''}`, ports: PORTS };
    if (PLUGIN_ROOT) hostHandleOptions.pluginRoot = PLUGIN_ROOT;
    hostHandle = await startIsolatedHost(hostHandleOptions);
    cdp = await Cdp.launch({ port: PORTS.chrome });
    capture = createCdpCapture(cdp);
    await capture.start();
    await cdp.navigate(hostHandle.host.url);
    const boot = await waitForDshPage(cdp, hostHandle.hostOrigin);
    check(checks, 'dsh-page-loads-and-host-api-answers', boot.health && boot.health.status === 200, { health: boot.health });

    // A real package with a same-origin second document.
    const built = buildSameOriginHtmlPackage({
      gameId: 'm1-cr7a-same-origin-html',
      version: '1.0.0',
      sinkOrigin: sinkInfo.origin,
      sinkWsOrigin: sinkInfo.wsOrigin,
    });
    const install = await installZipFromPage(cdp, built.zip, { operationId: opId('install') });
    const installed = install.body && install.body.ok === true ? install.body.data : null;
    const installInfo = {
      status: install.status,
      gameId: installed && installed.gameId,
      format: installed && installed.installation && installed.installation.format,
      entry: installed && installed.installation && installed.installation.entry,
      fileCount: installed && installed.installation && installed.installation.fileCount,
      errorBody: installed ? null : install.body,
    };
    scenario.install = installInfo;
    check(
      checks,
      'zip-package-installs-through-real-host-api',
      Boolean(installed && installed.installation && installed.installation.format === 'asset-zip-v2'),
      installInfo
    );

    // Real launch through the real RuntimeController + platform wrapper.
    const launch = await launchFromPage(cdp, { gameId: 'm1-cr7a-same-origin-html' });
    const info = launch.body && launch.body.ok === true ? launch.body.data : null;
    if (!info) throw new Error(`launch failed: ${sample(launch)}`);
    secrets.push(info.instanceId, info.nonce, new URL(info.resourceBase).pathname.split('/').filter(Boolean)[2]);
    scenario.launch = {
      resourceOrigin: info.resourceOrigin,
      resourceBase: info.resourceBase,
      entryResourceUrl: info.entryResourceUrl,
      wrapperUrl: info.wrapperUrl,
      packageFormat: info.package && info.package.format,
    };
    check(
      checks,
      'launch-info-contract-v2',
      Boolean(
        info.resourceOrigin &&
          info.resourceBase &&
          info.entryResourceUrl &&
          info.wrapperUrl &&
          info.package &&
          info.package.format === 'asset-zip-v2'
      ),
      scenario.launch
    );

    const since = Date.now();
    await setupRuntimeLab(cdp, { staticOrigin: staticInfo.origin });
    await runtimeLaunch(cdp, info);

    // --- index document: runs + same-origin fetch positive control ----------
    const indexRunning = await waitForMessage(capture, (event) => event.event === 'index-running', 25000);
    const indexFetch = await waitForMessage(capture, (event) => event.event === 'index-fetch', 15000);
    const navigating = await waitForMessage(capture, (event) => event.event === 'index-navigating', 15000);
    scenario.index = { indexRunning, indexFetch, navigating };

    // --- second document: really runs (title/DOM/JS marker) -----------------
    const secondRunning = await waitForMessage(capture, (event) => event.event === 'second-running', 25000);
    const attacksComplete = await waitForMessage(capture, (event) => event.event === 'second-attacks-complete', 30000);
    const secondSession = selectSecondSession(capture);
    let secondSnapshot = null;
    if (secondSession) {
      secondSnapshot = await capture
        .evaluate(
          secondSession.sessionId,
          `(() => ({
            href: location.href,
            origin: window.origin,
            title: document.title || '',
            hasHud: Boolean(document.getElementById('second-hud')),
            chromeError: location.href.startsWith('chrome-error:'),
            marker: window.__M1B_SECOND__ ? window.__M1B_SECOND__.marker : null,
            phase: window.__M1B_SECOND__ ? window.__M1B_SECOND__.phase : null,
            state: window.__M1B_SECOND__ ? JSON.parse(JSON.stringify(window.__M1B_SECOND__)) : null
          }))()`
        )
        .catch((error) => ({ error: String(error.message).slice(0, 200) }));
    }
    scenario.secondDocument = { running: secondRunning, attacksComplete, session: secondSession ? secondSession.sessionId : null, snapshot: secondSnapshot };
    check(checks, 'second-page-really-runs', Boolean(secondRunning), secondRunning);
    check(
      checks,
      'second-page-title-dom-marker-present',
      Boolean(
        secondSnapshot &&
          !secondSnapshot.chromeError &&
          secondSnapshot.title === 'M1 CR7 Second Document' &&
          secondSnapshot.hasHud === true &&
          secondSnapshot.marker === 'second-marker' &&
          secondSnapshot.origin === 'null'
      ),
      secondSnapshot
    );
    check(checks, 'second-page-finished-its-attack-suite', Boolean(attacksComplete), attacksComplete);

    // --- second.html response: status + asset CSP (response headers) --------
    const resourceBase = String(info.resourceBase).endsWith('/') ? info.resourceBase : `${info.resourceBase}/`;
    const secondUrl = new URL('second.html', resourceBase).href;
    const secondResponse = await fetch(secondUrl);
    const secondCsp = headerOf(secondResponse, 'content-security-policy');
    const entryResponse = await fetch(info.entryResourceUrl);
    const entryCsp = headerOf(entryResponse, 'content-security-policy');
    const secondDirectives = cspDirectives(secondCsp);
    const entryDirectives = cspDirectives(entryCsp);
    scenario.headers = {
      secondUrl: secondUrl.replace(/\/res\/[a-f0-9]{32}\/[a-f0-9]{32}\//, '/res/<instance>/<token>/'),
      secondStatus: secondResponse.status,
      secondCsp,
      secondDirectives,
      entryStatus: entryResponse.status,
      entryCsp,
      entryDirectives,
      sinkOrigin: sinkInfo.origin,
      resourceOrigin: info.resourceOrigin,
      dshOrigin: hostHandle.hostOrigin,
    };
    check(checks, 'second-html-served-200-with-resource-credential', secondResponse.status === 200, { status: secondResponse.status });
    check(checks, 'entry-html-still-has-asset-csp', Boolean(entryCsp && entryDirectives['connect-src'] === info.resourceOrigin), { entryCsp });
    check(checks, 'second-html-has-asset-csp', Boolean(secondCsp && secondCsp.length > 0), { secondCsp });
    const expectedDirectives = {
      'default-src': "'none'",
      'script-src': info.resourceOrigin,
      'style-src': info.resourceOrigin,
      'img-src': `${info.resourceOrigin} data:`,
      'media-src': info.resourceOrigin,
      'font-src': info.resourceOrigin,
      'connect-src': info.resourceOrigin,
      'frame-src': "'none'",
      'child-src': "'none'",
      'worker-src': "'none'",
      'object-src': "'none'",
      'base-uri': "'none'",
      'form-action': "'none'",
    };
    const directiveMismatches = Object.entries(expectedDirectives)
      .filter(([name, expected]) => secondDirectives[name] !== expected)
      .map(([name, expected]) => ({ name, expected, actual: secondDirectives[name] ?? null }));
    scenario.headers.directiveMismatches = directiveMismatches;
    check(
      checks,
      'second-html-csp-directives-match-asset-policy',
      directiveMismatches.length === 0,
      { mismatches: directiveMismatches, secondDirectives }
    );
    const ancestors = typeof secondDirectives['frame-ancestors'] === 'string' ? secondDirectives['frame-ancestors'].split(/\s+/).filter(Boolean) : [];
    scenario.headers.frameAncestors = ancestors;
    check(
      checks,
      'second-html-csp-frame-ancestors-exact-dsh-and-resource-origin',
      ancestors.includes(hostHandle.hostOrigin) && ancestors.includes(info.resourceOrigin) && !ancestors.includes('*') && !secondDirectives['frame-ancestors'].includes('*'),
      { frameAncestors: secondDirectives['frame-ancestors'] ?? null }
    );

    // --- network layer: sink must see NOTHING -------------------------------
    await sleep(1200);
    const sinkRequests = sink.requests();
    const sinkUpgrades = sink.upgrades();
    const externalNetwork = capture.state.networkOrder
      .filter((entry) => typeof entry.url === 'string' && (entry.url.startsWith(sinkInfo.origin) || entry.url.startsWith(sinkInfo.wsOrigin)))
      .map((entry) => networkSummary(entry, info.resourceBase));
    const sentExternal = externalNetwork.filter((entry) => entry.status !== null && entry.status !== undefined && entry.failed !== true);
    const blockedByCsp = externalNetwork.filter((entry) => entry.failed === true && entry.blockedReason === 'csp');
    scenario.network = {
      sinkRequests,
      sinkUpgrades,
      externalNetwork,
      sentExternal,
      blockedByCspCount: blockedByCsp.length,
    };
    check(checks, 'sink-received-zero-http-requests', sinkRequests.length === 0, sinkRequests);
    check(checks, 'sink-received-zero-websocket-upgrades', sinkUpgrades.length === 0, sinkUpgrades);
    check(
      checks,
      'network-layer-zero-external-requests',
      sentExternal.length === 0 && blockedByCsp.length === externalNetwork.length,
      { sentExternal, blockedByCspCount: blockedByCsp.length, externalNetwork }
    );

    // --- game-observed outcomes --------------------------------------------
    const secondState = (secondSnapshot && secondSnapshot.state) || null;
    scenario.secondObserved = secondState;
    check(checks, 'second-page-external-fetch-rejected', Boolean(secondState && secondState.fetch && secondState.fetch.resolved === false), secondState && secondState.fetch);
    check(checks, 'second-page-external-image-not-loaded', Boolean(secondState && secondState.image && secondState.image.loaded === false), secondState && secondState.image);
    check(checks, 'second-page-window-open-blocked-by-sandbox', Boolean(secondState && secondState.popup && secondState.popup.opened === false), secondState && secondState.popup);

    // --- cause evidence: Chrome CSP violation logs --------------------------
    const cspViolations = capture.state.logs.filter((entry) => /violates the following Content Security Policy/i.test(entry.text || ''));
    const connectViolations = cspViolations.filter((entry) => /connect-src/i.test(entry.text || ''));
    const imgViolations = cspViolations.filter((entry) => /img-src/i.test(entry.text || ''));
    scenario.cspViolationLogs = {
      total: cspViolations.length,
      connect: connectViolations.slice(0, 6),
      img: imgViolations.slice(0, 6),
    };
    check(checks, 'chrome-csp-violation-log-recorded', cspViolations.length > 0, { total: cspViolations.length, sample: cspViolations.slice(0, 4) });
    check(checks, 'chrome-connect-src-violation-recorded', connectViolations.length > 0, connectViolations.slice(0, 4));

    // --- same-origin positive control + framing violations -----------------
    const indexFetchNetwork = capture.state.networkOrder
      .filter((entry) => typeof entry.url === 'string' && entry.url.includes('/data/x.json'))
      .map((entry) => networkSummary(entry, info.resourceBase));
    scenario.indexDataFetch = { console: indexFetch, network: indexFetchNetwork };
    check(
      checks,
      'index-same-origin-fetch-succeeds-200',
      Boolean(indexFetch && indexFetch.status === 200 && indexFetchNetwork.some((entry) => entry.status === 200)),
      scenario.indexDataFetch
    );
    const framingViolations = capture.state.logs.filter((entry) => /Framing .*violates.*frame-ancestors/i.test(entry.text || ''));
    scenario.framingViolations = framingViolations;
    check(checks, 'no-frame-ancestors-framing-violations', framingViolations.length === 0, framingViolations.slice(0, 6));

    try {
      scenario.screenshots = { full: await screenshot(cdp, `cr7-01-same-origin-html${LABEL ? '-' + LABEL : ''}`) };
    } catch (_error) {
      scenario.screenshots = { error: 'screenshot failed' };
    }
  } catch (error) {
    check(checks, 'probe-completed-without-throwing', false, { error: String(error && error.stack ? error.stack : error).slice(0, 1500) });
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
    if (hostHandle && KEEP) scenario.keptHome = hostHandle.home;
  }

  const written = writeEvidence(
    EVIDENCE_ID,
    {
      id: EVIDENCE_ID,
      title: 'CR7-01: same-origin second HTML document must carry the asset CSP (no external egress)',
      command: `node scripts/verification/v1.5/m1/m1-a06b-same-origin-html.mjs${PLUGIN_ROOT ? ` --plugin-root=${PLUGIN_ROOT}` : ''}${LABEL ? ` --label=${LABEL}` : ''}${KEEP ? ' --keep' : ''}`,
      environment: { dsh: identity, chrome: 'headless CDP', pluginRoot: PLUGIN_ROOT || '<worktree>', ports: PORTS },
      checks,
      extra: { scenario },
    },
    secrets
  );
  const failed = checks.filter((entry) => entry.required && !entry.ok);
  process.stdout.write(
    `\n${EVIDENCE_ID} ${written.passed ? 'PASSED' : 'FAILED'} (${checks.filter((c) => c.required && c.ok).length}/${checks.filter((c) => c.required).length} required checks)\n`
  );
  process.stdout.write(`evidence: ${written.file}\n`);
  for (const entry of failed) process.stdout.write(`  FAIL ${entry.name}: ${sample(entry.detail, 500)}\n`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((error) => {
  process.stderr.write(`[m1-a06b] fatal: ${String(error && error.stack ? error.stack : error)}\n`);
  process.exitCode = 1;
});
