#!/usr/bin/env node
/**
 * M2 F1 · A02 class — the builtin `orbit-courier` (asset-zip-v2) multi-resource
 * load through the real Host resource origin and the real two-layer iframe.
 *
 * Launches the builtin game through the real Market UI in a real DSH page, then
 *   - asserts the game document really runs (`window.origin === "null"`, title,
 *     canvas + HUD, module scripts present);
 *   - asserts both iframe layers (outer wrapper: no sandbox attribute; inner
 *     game iframe: `sandbox="allow-scripts"` without allow-same-origin,
 *     `referrerpolicy=no-referrer`);
 *   - requests every package resource (independent ESM modules, CSS, level JSON,
 *     sprites, WAV audio) from inside the sandboxed game document and asserts
 *     HTTP 200 + exact MIME + the §7 security headers on each response;
 *   - asserts the reserved descriptor/manifest are still 403 GM-4039;
 *   - asserts the wrapper / entry CSP headers and zero CSP/framing violations.
 *
 * The resource inventory is read from `games/orbit-courier/dist` (the source the
 * builtin package is synthesized from); a missing expected file fails the probe.
 *
 * Usage: node scripts/verification/v1.5/m2/m2-a02-orbit-resources.mjs [--keep]
 * Exit 0 iff every required check passed. Evidence: raw/m2/<id>-<ts>.json.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  Cdp,
  sleep,
  runtimeIdentity,
  startIsolatedHost,
  createCdpCapture,
  waitForDshPage,
  writeEvidence,
  OUT_DIR,
  REPO_ROOT,
} from './lib/lab.mjs';
import {
  dismissOverlays,
  openMarketPanel,
  openMyGamesTab,
  launchFromRow,
  waitFor,
  readUiState,
} from './lib/ui.mjs';

const PORTS = Object.freeze({ bootstrap: 58460, host: 58461, chrome: 9526 });
const KEEP = process.argv.includes('--keep');
const GAME_ID = 'orbit-courier';
const EVIDENCE_ID = 'M2-A02-orbit-multiresource';
const GAME_DIST = path.join(REPO_ROOT, 'games/orbit-courier/dist');

const checks = [];
const scenario = {};

function check(name, ok, detail, { required = true } = {}) {
  checks.push({ name, ok: Boolean(ok), required, detail });
  process.stdout.write(`  ${ok ? 'ok' : 'FAIL'} ${name}\n`);
  return Boolean(ok);
}

function sample(value, limit = 1200) {
  try {
    return JSON.stringify(value).slice(0, limit);
  } catch (_error) {
    return String(value).slice(0, 400);
  }
}

const MIME_BY_EXT = Object.freeze({
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml',
});

function listDistFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listDistFiles(path.join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

async function gameSession(capture, expression, timeoutMs = 30000) {
  return waitFor(async () => {
    for (const record of capture.state.attached) {
      if (record.type !== 'iframe') continue;
      try {
        const value = await capture.evaluate(record.sessionId, `window.__orbitCourier ? (${expression}) : null`);
        if (value !== null && value !== undefined) return { sessionId: record.sessionId, value };
      } catch (_error) {
        // navigation in flight
      }
    }
    return null;
  }, timeoutMs);
}

function responseHeader(entry, name) {
  const headers = (entry && entry.responseHeaders) || {};
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? null : headers[key];
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const identity = runtimeIdentity();
  let hostHandle = null;
  let cdp = null;
  let capture = null;
  const runTag = Date.now().toString(36);

  try {
    const distFiles = listDistFiles(GAME_DIST);
    scenario.packageInventory = { root: 'games/orbit-courier/dist', filesDigestCount: distFiles.length, files: distFiles };
    hostHandle = await startIsolatedHost({ name: `probe-m2-resources-${runTag}`, ports: PORTS });
    cdp = await Cdp.launch({ port: PORTS.chrome });
    capture = createCdpCapture(cdp);
    await capture.start();
    await cdp.navigate(hostHandle.host.url);
    const boot = await waitForDshPage(cdp, hostHandle.hostOrigin);
    check('dsh-page-loads-and-host-api-answers', boot.health && boot.health.status === 200, { status: boot.health && boot.health.status });
    await dismissOverlays(cdp);
    await openMarketPanel(cdp);
    await openMyGamesTab(cdp);

    const launch = await launchFromRow(cdp, capture, GAME_ID);
    scenario.launch = { play: launch.play.clicked, runtime: launch.runtime };
    check('orbit-courier-launches-from-my-games-row', Boolean(launch.play.clicked && launch.runtime), scenario.launch);
    const instance = await gameSession(capture, `({ phase: window.__orbitCourier.state.phase, levelId: window.__orbitCourier.state.levelId })`, 30000);
    check('orbit-courier-instance-booted', Boolean(instance), instance ? instance.value : null);
    if (!instance) throw new Error('orbit-courier instance never booted');
    await sleep(1500);
    const sessionId = instance.sessionId;

    // ---- two-layer iframe model ------------------------------------------
    const outerFrame = await cdp.eval(`(() => {
      const frame = document.querySelector('.dgm-stage-canvas iframe, .dgm-stage iframe');
      if (!frame) return null;
      return {
        sandbox: frame.getAttribute('sandbox'),
        allow: frame.getAttribute('allow'),
        referrerpolicy: frame.getAttribute('referrerpolicy'),
        src: frame.getAttribute('src')
      };
    })()`);
    scenario.outerFrame = outerFrame;
    check('outer-wrapper-iframe-has-no-sandbox-attribute', Boolean(outerFrame && outerFrame.sandbox === null), outerFrame);
    const wrapperLayer = await capture
      .evaluateInFrame(
        '/wrapper?',
        `(() => {
          const inner = document.getElementById('dsh-game-frame');
          return {
            origin: location.origin,
            windowOrigin: window.origin,
            innerCount: document.querySelectorAll('iframe').length,
            innerSandbox: inner ? inner.getAttribute('sandbox') : null,
            innerAllow: inner ? inner.getAttribute('allow') : null,
            innerReferrerPolicy: inner ? inner.getAttribute('referrerpolicy') : null
          };
        })()`
      )
      .catch((error) => ({ frameFound: false, error: String(error.message).slice(0, 200) }));
    scenario.wrapperLayer = wrapperLayer;
    check(
      'wrapper-layer-real-origin-and-inner-game-sandbox',
      Boolean(
        wrapperLayer &&
          wrapperLayer.frameFound &&
          wrapperLayer.value &&
          wrapperLayer.value.origin === outerFrameOrigin(outerFrame) &&
          wrapperLayer.value.innerCount === 1 &&
          wrapperLayer.value.innerSandbox === 'allow-scripts' &&
          !/allow-same-origin/.test(String(wrapperLayer.value.innerSandbox)) &&
          wrapperLayer.value.innerReferrerPolicy === 'no-referrer'
      ),
      wrapperLayer
    );

    // ---- game document really runs ---------------------------------------
    const gameDoc = await capture.evaluate(
      sessionId,
      `(() => ({
        href: location.href,
        origin: window.origin,
        title: document.title || '',
        readyState: document.readyState,
        hasStage: Boolean(document.getElementById('stage')),
        hasHud: Boolean(document.getElementById('hud')),
        hudScore: (document.getElementById('hud-score') || {}).textContent || null,
        moduleScripts: [...document.querySelectorAll('script[type="module"]')].map((script) => script.getAttribute('src')),
        phase: window.__orbitCourier.state.phase,
        levelId: window.__orbitCourier.state.levelId,
        durationMs: window.__orbitCourier.state.durationMs
      }))()`
    );
    scenario.gameDocument = gameDoc;
    check('game-document-is-opaque-origin', gameDoc.origin === 'null', { origin: gameDoc.origin });
    check('game-document-really-renders', Boolean(gameDoc.hasStage && gameDoc.hasHud && gameDoc.title.includes('轨道信使')), { title: gameDoc.title, hasStage: gameDoc.hasStage, hasHud: gameDoc.hasHud });
    check('game-uses-independent-esm-module-scripts', Boolean(Array.isArray(gameDoc.moduleScripts) && gameDoc.moduleScripts.length > 0 && gameDoc.moduleScripts.every((src) => typeof src === 'string' && src.startsWith('scripts/'))), { moduleScripts: gameDoc.moduleScripts });
    check('game-level-loads-from-package-json', Boolean(gameDoc.levelId === 'shift-01' && gameDoc.durationMs === 120000), { levelId: gameDoc.levelId, durationMs: gameDoc.durationMs });

    // ---- every package resource: real fetch + 200 + exact MIME -----------
    const reserved = ['dsh-package.json', 'game.json'];
    const resources = distFiles.filter((rel) => !reserved.includes(rel) && rel !== 'index.html');
    const observed = [];
    for (const rel of resources) {
      const result = await capture
        .evaluate(
          sessionId,
          `fetch(${JSON.stringify(rel)}, { cache: 'no-store' }).then(async (response) => ({
            rel: ${JSON.stringify(rel)},
            status: response.status,
            contentType: response.headers.get('content-type'),
            bytes: (await response.arrayBuffer()).byteLength
          }), (error) => ({ rel: ${JSON.stringify(rel)}, error: String(error && error.message || error) }))`
        )
        .catch((error) => ({ rel, error: String(error.message).slice(0, 200) }));
      observed.push(result);
    }
    scenario.resources = observed;
    const expectedMime = (rel) => MIME_BY_EXT[path.extname(rel)] || null;
    const badStatus = observed.filter((entry) => entry.status !== 200);
    const badMime = observed.filter((entry) => {
      const expected = expectedMime(entry.rel);
      return expected !== null && !(typeof entry.contentType === 'string' && entry.contentType.startsWith(expected));
    });
    const zeroBytes = observed.filter((entry) => !(entry.bytes > 0));
    check('every-package-resource-fetched-200', badStatus.length === 0, { badStatus, count: observed.length });
    check('every-package-resource-has-exact-mime', badMime.length === 0, { badMime, count: observed.length });
    check('every-package-resource-is-non-empty', zeroBytes.length === 0, { zeroBytes });
    check('package-has-js-css-json-png-wav-resources', Boolean(
      resources.some((rel) => rel.endsWith('.js')) &&
      resources.some((rel) => rel.endsWith('.css')) &&
      resources.some((rel) => rel.endsWith('.json')) &&
      resources.some((rel) => rel.endsWith('.png')) &&
      resources.some((rel) => rel.endsWith('.wav'))
    ), { resources });

    const indexFetch = await capture
      .evaluate(sessionId, `fetch('index.html', { cache: 'no-store' }).then(async (response) => ({ status: response.status, type: response.headers.get('content-type') }))`)
      .catch((error) => ({ error: String(error.message).slice(0, 200) }));
    scenario.indexFetch = indexFetch;
    check('entry-document-fetches-200', Boolean(indexFetch && indexFetch.status === 200), indexFetch);
    const reservedChecks = [];
    for (const rel of reserved) {
      reservedChecks.push(
        await capture
          .evaluate(sessionId, `fetch(${JSON.stringify(rel)}, { cache: 'no-store' }).then(async (response) => ({ rel: ${JSON.stringify(rel)}, status: response.status }))`)
          .catch((error) => ({ rel, error: String(error.message).slice(0, 200) }))
      );
    }
    scenario.reserved = reservedChecks;
    check('reserved-descriptor-and-manifest-are-403', reservedChecks.every((entry) => entry.status === 403), reservedChecks);

    // ---- per-resource security headers at the network layer --------------
    const resourceNetwork = capture.state.networkOrder
      .filter((entry) => typeof entry.url === 'string' && entry.url.includes('/res/'))
      .map((entry) => ({
        url: entry.url,
        status: entry.status ?? null,
        resourceType: entry.resourceType,
        contentType: responseHeader(entry, 'content-type'),
        acao: responseHeader(entry, 'access-control-allow-origin'),
        nosniff: responseHeader(entry, 'x-content-type-options'),
        cacheControl: responseHeader(entry, 'cache-control'),
        referrerPolicy: responseHeader(entry, 'referrer-policy'),
      }));
    scenario.resourceNetwork = resourceNetwork.slice(0, 80);
    const missingHeaders = resourceNetwork.filter(
      (entry) => entry.status === 200 && (!entry.acao || !entry.nosniff || !entry.cacheControl || !entry.referrerPolicy)
    );
    check('resource-responses-carry-security-headers', resourceNetwork.length > 0 && missingHeaders.length === 0, { count: resourceNetwork.length, missingHeaders: missingHeaders.slice(0, 5) });
    const badCors = resourceNetwork.filter((entry) => entry.status === 200 && entry.acao !== '*');
    check('resource-responses-are-anonymous-cors', badCors.length === 0, badCors.slice(0, 5));

    // ---- wrapper + entry CSP --------------------------------------------
    const wrapperSrc = outerFrame && outerFrame.src ? outerFrame.src : null;
    if (wrapperSrc) {
      const wrapperResponse = await fetch(wrapperSrc);
      const csp = wrapperResponse.headers.get('content-security-policy') || '';
      const ancestors = (csp.match(/frame-ancestors\s+([^;]+)/i) || [])[1] || null;
      scenario.wrapperCsp = { status: wrapperResponse.status, frameAncestors: ancestors, csp };
      check('wrapper-csp-frame-ancestors-exact-no-wildcard', Boolean(ancestors && !ancestors.includes('*')), { frameAncestors: ancestors });
    } else {
      check('wrapper-csp-frame-ancestors-exact-no-wildcard', false, { error: 'wrapper iframe src missing' });
    }
    const entryLaunch = capture.state.networkOrder.find(
      (entry) => typeof entry.url === 'string' && entry.url.includes('/index.html') && entry.url.includes('launch=')
    );
    const entryCsp = entryLaunch ? responseHeader(entryLaunch, 'content-security-policy') : null;
    scenario.entryCsp = entryCsp;
    check('entry-document-has-asset-csp', Boolean(entryCsp && entryCsp.includes('connect-src')), { entryCsp });

    const framing = capture.state.logs.filter((entry) => /Framing .*violates.*frame-ancestors/i.test(entry.text || ''));
    const cspViolations = capture.state.logs.filter((entry) => /violates the following Content Security Policy/i.test(entry.text || ''));
    scenario.csp = { framing: framing.slice(0, 5), violations: cspViolations.slice(0, 10) };
    check('zero-frame-ancestors-violations', framing.length === 0, framing.slice(0, 5));
    check('zero-csp-violations', cspViolations.length === 0, cspViolations.slice(0, 10));
  } catch (error) {
    check('probe-completed-without-throwing', false, { error: String(error && error.stack ? error.stack : error).slice(0, 1500) });
  } finally {
    try {
      if (cdp) cdp.dispose();
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
      title: 'M2 A02: builtin orbit-courier multi-resource load (ESM/CSS/JSON/PNG/WAV) through the real resource origin',
      command: `node scripts/verification/v1.5/m2/m2-a02-orbit-resources.mjs${KEEP ? ' --keep' : ''}`,
      environment: { dsh: identity, chrome: 'headless CDP', gameId: GAME_ID, ports: PORTS },
      checks,
      extra: { scenario },
    },
    []
  );
  const failed = checks.filter((entry) => entry.required && !entry.ok);
  process.stdout.write(`\n${EVIDENCE_ID} ${written.passed ? 'PASSED' : 'FAILED'} (${checks.filter((c) => c.required && c.ok).length}/${checks.filter((c) => c.required).length} required checks)\n`);
  process.stdout.write(`evidence: ${written.file}\n`);
  for (const entry of failed) process.stdout.write(`  FAIL ${entry.name}: ${sample(entry.detail, 500)}\n`);
  process.exitCode = failed.length > 0 ? 1 : 0;
}

function outerFrameOrigin(outerFrame) {
  if (!outerFrame || !outerFrame.src) return null;
  try {
    const url = new URL(outerFrame.src);
    return `${url.protocol}//${url.host}`;
  } catch (_error) {
    return null;
  }
}

main().catch((error) => {
  process.stderr.write(`[m2-a02] fatal: ${String(error && error.stack ? error.stack : error)}\n`);
  process.exitCode = 1;
});
