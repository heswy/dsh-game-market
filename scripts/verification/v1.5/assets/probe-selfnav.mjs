#!/usr/bin/env node
/**
 * M0 review fix (CR-P1) · sandboxed-iframe self-navigation boundary.
 *
 * Codex review of PR #6 found that a `sandbox="allow-scripts"` game document
 * can navigate *itself* to an external URL, and that the document's own CSP
 * (`connect-src`, `frame-src 'none'`) does not prevent it. This probe
 * characterises the gap and checks whether the embedding document's
 * `frame-src` closes it, in a real browser.
 *
 * Cases (all iframes use sandbox="allow-scripts", no allow-same-origin):
 *   C1  parent without frame-src          -> game self-navigates
 *   C2  parent with frame-src='resOrigin' -> game self-navigates
 *   C3  parent -> same-origin wrapper with frame-src='resOrigin' -> game self-navigates
 *
 * The "sink" origin records every request it receives, so a case "leaks" only
 * when the sink observed the navigation. Exit code is non-zero when the
 * observed results do not match the expected boundary, so a regression in
 * either direction fails the run.
 *
 * Usage: node scripts/verification/v1.5/assets/probe-selfnav.mjs [--keep]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const OUT = path.join(ROOT, 'docs/verification/v1.5/raw/resources');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WORK = '/tmp/dsh-v15/selfnav';
const PORTS = { sink: 58301, resource: 58302, parent: 58303, cdp: 9501 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sinkHits = [];
const consoleErrors = [];
const beacons = [];

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

function listen(server, port) {
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/** Third-party origin the game tries to reach. Records every hit. */
function sinkServer() {
  return http.createServer((req, res) => {
    sinkHits.push({ at: Date.now(), method: req.method, url: req.url, host: req.headers.host ?? null, referer: req.headers.referer ?? null });
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('sink');
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

/**
 * Resource origin: the game document plus a same-origin wrapper that carries
 * the restrictive `frame-src`. This is the candidate mitigation — the platform
 * can serve the wrapper from an origin it controls, without touching DSH.
 *
 * The game document loads its script as an EXTERNAL file (the `asset-zip-v2`
 * rule forbids inline scripts), so `script-src <origin>` is enough and the
 * navigation attempt below actually executes.
 */
function resourceServer() {
  const resOrigin = `http://127.0.0.1:${PORTS.resource}`;
  const gameCsp = `default-src 'none'; script-src ${resOrigin}; style-src ${resOrigin}; img-src ${resOrigin} data:; connect-src ${resOrigin}; child-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return http.createServer((req, res) => {
    const url = new URL(req.url, resOrigin);
    if (url.pathname === '/res/beacon') {
      // Same-origin, allowed by `connect-src <resOrigin>` in every case. Used as
      // a positive control: it proves the game document actually loaded AND ran
      // its script, so "no sink hit" means the navigation was blocked rather
      // than the game never starting. `to` records the target the game is about
      // to navigate to, so a case cannot pass by navigating nowhere.
      beacons.push({ at: Date.now(), url: req.url, to: url.searchParams.get('to') });
      res.writeHead(204, { 'access-control-allow-origin': '*' });
      res.end();
      return;
    }
    if (url.pathname === '/res/game.js') {
      const body = `window.__GAME_BOOTED__ = true;
var to = new URLSearchParams(window.location.search).get('to');
fetch('/res/beacon?to=' + encodeURIComponent(String(to)), { method: 'POST' }).catch(function () {});
setTimeout(function () {
  try { window.location.replace(to); } catch (e) { window.__NAV_ERROR__ = String(e); }
}, 400);`;
      res.writeHead(200, { 'content-type': MIME['.js'], 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
      res.end(body);
      return;
    }
    if (url.pathname === '/res/game.html') {
      const body = `<!doctype html><meta charset="utf-8"><title>game</title><script src="/res/game.js"></script>`;
      res.writeHead(200, { 'content-type': MIME['.html'], 'content-security-policy': gameCsp, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(body);
      return;
    }
    if (url.pathname === '/res/wrapper.html' || url.pathname === '/res/wrapper-nocsp.html') {
      // The wrapper forwards the navigation target to its child. Without this
      // the game would call `location.replace(null)` and "blocking" would be an
      // artefact of a navigation that never targeted anything external.
      const target = url.searchParams.get('to') ?? `http://127.0.0.1:${PORTS.sink}`;
      const body = `<!doctype html><meta charset="utf-8"><title>wrapper</title>
<iframe id="g" sandbox="allow-scripts" referrerpolicy="no-referrer" src="/res/game.html?to=${encodeURIComponent(target)}"></iframe>`;
      const headers = { 'content-type': MIME['.html'], 'cache-control': 'no-store' };
      if (url.pathname === '/res/wrapper.html') {
        // The wrapper is served by the resource origin, so this CSP is ours to
        // set — and it is the only framing policy in the C3 case, because the
        // top-level page there deliberately sends none.
        headers['content-security-policy'] = `default-src 'none'; frame-src ${resOrigin}; child-src ${resOrigin}; script-src 'none'; style-src 'none'; base-uri 'none'; form-action 'none'`;
      }
      res.writeHead(200, headers);
      res.end(body);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
}

/**
 * Parent origin: stands in for the host page that embeds the game.
 * `/plain` sends NO CSP at all — the "page we do not control" situation the
 * review describes. `/with-frame-src` restricts `frame-src` to the resource
 * origin, which is the candidate mitigation.
 */
function parentServer() {
  const resOrigin = `http://127.0.0.1:${PORTS.resource}`;
  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORTS.parent}`);
    const target = url.searchParams.get('to') ?? `http://127.0.0.1:${PORTS.sink}`;
    const wrapper = url.pathname === '/wrapper' || url.pathname === '/wrapper-nocsp';
    const src = wrapper
      ? `${resOrigin}${url.pathname === '/wrapper' ? '/res/wrapper.html' : '/res/wrapper-nocsp.html'}?to=${encodeURIComponent(target)}`
      : `${resOrigin}/res/game.html?to=${encodeURIComponent(target)}`;
    const body = `<!doctype html><meta charset="utf-8"><title>parent</title>
<iframe id="f" sandbox="allow-scripts" referrerpolicy="no-referrer" src="${src}"></iframe>`;
    const headers = { 'content-type': MIME['.html'], 'cache-control': 'no-store' };
    if (url.pathname === '/with-frame-src') {
      // Mitigation A: the embedding page itself restricts frame navigations.
      headers['content-security-policy'] = `default-src 'self'; frame-src ${resOrigin}; child-src ${resOrigin}`;
    }
    // `/plain`, `/wrapper` and `/wrapper-nocsp` deliberately send NO CSP. The
    // wrapper cases must therefore be decided by the WRAPPER's own policy alone,
    // otherwise a pass could not be attributed to the wrapper. C3 (wrapper with
    // CSP) and C3c (wrapper without CSP) are otherwise identical, which is what
    // makes the pair a real control.
    res.writeHead(200, headers);
    res.end(body);
    return;
  });
}

// ---------------------------------------------------------------------------
// Minimal CDP client (same shape as the shared harness)
// ---------------------------------------------------------------------------

class Cdp {
  static async attach(port) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    const cdp = new Cdp();
    cdp.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { cdp.ws.onopen = resolve; cdp.ws.onerror = reject; });
    cdp.id = 0;
    cdp.pending = new Map();
    cdp.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && cdp.pending.has(message.id)) { cdp.pending.get(message.id)(message.result); cdp.pending.delete(message.id); return; }
      if (message.method === 'Log.entryAdded') consoleErrors.push(message.params.entry);
      if (message.method === 'Runtime.exceptionThrown') consoleErrors.push({ level: 'exception', text: (message.params.exceptionDetails || {}).text });
    };
    for (const method of ['Runtime.enable', 'Page.enable', 'Log.enable']) await cdp.send(method);
    return cdp;
  }
  send(method, params = {}) {
    return new Promise((resolve) => {
      const id = ++this.id;
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  eval(expression) {
    return this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then((r) => (r && r.result ? r.result.value : null));
  }
  dispose() { try { this.ws.close(); } catch { /* ignore */ } }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });

  const sink = await listen(sinkServer(), PORTS.sink);
  const resource = await listen(resourceServer(), PORTS.resource);
  const parent = await listen(parentServer(), PORTS.parent);
  const chromeDir = path.join(WORK, 'chrome');
  fs.rmSync(chromeDir, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORTS.cdp}`, `--user-data-dir=${chromeDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=800,600', 'about:blank',
  ], { stdio: 'ignore' });
  await sleep(2500);

  const cases = [
    // The reported gap: a host page with no framing policy lets the game
    // navigate itself to an arbitrary origin.
    // The reported gap: a host page with no framing policy lets the game
    // navigate itself to an arbitrary origin.
    { id: 'C1-parent-no-csp', url: `http://127.0.0.1:${PORTS.parent}/plain`, expectLeak: true, note: 'host page sends no CSP (current situation)' },
    // Mitigation A: the host page restricts frame-src to the resource origin.
    { id: 'C2-parent-frame-src', url: `http://127.0.0.1:${PORTS.parent}/with-frame-src`, expectLeak: false, note: 'host page restricts frame-src to the resource origin' },
    // Mitigation B: a same-origin wrapper we serve carries the restriction.
    // The top-level page here sends NO CSP, so the outcome is attributable to
    // the wrapper alone.
    { id: 'C3-wrapper-frame-src', url: `http://127.0.0.1:${PORTS.parent}/wrapper`, expectLeak: false, note: 'platform-served wrapper restricts frame-src; top-level page sends no CSP' },
    // C3's control: identical path and target, wrapper CSP removed. This case
    // MUST leak — otherwise C3's "blocked" would be an artefact of the harness
    // (for example a game that never navigated anywhere).
    { id: 'C3c-wrapper-no-csp', url: `http://127.0.0.1:${PORTS.parent}/wrapper-nocsp`, expectLeak: true, note: 'same wrapper without its CSP (control for C3)' },
    // Negative control: the game document's OWN CSP cannot stop its own
    // navigation, so this case must leak.
    { id: 'C4-game-own-csp-only', url: `http://127.0.0.1:${PORTS.resource}/res/game.html?to=http%3A%2F%2F127.0.0.1%3A${PORTS.sink}`, expectLeak: true, note: 'game document CSP only (negative control)' },
  ];
  const sinkOrigin = `http://127.0.0.1:${PORTS.sink}`;

  const results = [];
  let cdp = null;
  try {
    cdp = await Cdp.attach(PORTS.cdp);
    for (const item of cases) {
      const before = sinkHits.length;
      const beaconsBefore = beacons.length;
      const logsBefore = consoleErrors.length;
      // Record the top-level page's own CSP, so the report shows which policy
      // was actually in play. The wrapper cases MUST show none here: otherwise a
      // pass could not be attributed to the wrapper.
      const topLevelCsp = await fetch(item.url)
        .then((r) => r.headers.get('content-security-policy'))
        .catch(() => null);
      await cdp.send('Page.navigate', { url: item.url });
      await sleep(2200);
      const hits = sinkHits.slice(before);
      const booted = beacons.length > beaconsBefore;
      // The target the game actually tried to reach, as reported by its own
      // pre-navigation beacon. `null`/`"null"` means it never aimed anywhere
      // external, which is exactly the defect this assertion exists to catch.
      const attemptedTarget = beacons.slice(beaconsBefore).map((b) => b.to).find((to) => to !== null) ?? null;
      const aimedAtSink = typeof attemptedTarget === 'string' && attemptedTarget.startsWith(sinkOrigin);
      const logs = consoleErrors.slice(logsBefore)
        .map((entry) => entry.text || entry.url || '')
        .filter(Boolean)
        .slice(0, 6);
      results.push({
        id: item.id,
        note: item.note,
        navigatedTo: item.url,
        topLevelCsp,
        gameRan: booted,
        attemptedTarget,
        aimedAtSink,
        expectedLeak: item.expectLeak,
        leaked: hits.length > 0,
        hits: hits.map((h) => ({ method: h.method, url: h.url, host: h.host, referer: h.referer })),
        browserLog: logs,
        verdict: booted && aimedAtSink && (hits.length > 0) === item.expectLeak ? 'as-expected' : 'UNEXPECTED',
      });
      // Reset the page so the next case starts from a blank document.
      await cdp.send('Page.navigate', { url: 'about:blank' });
      await sleep(300);
    }
  } finally {
    if (cdp) cdp.dispose();
    chrome.kill('SIGKILL');
    for (const server of [sink, resource, parent]) server.close();
  }

  const unexpected = results.filter((r) => r.verdict !== 'as-expected');
  const byId = (id) => results.find((r) => r.id === id);
  const report = {
    id: 'CR-P1-selfnav',
    title: 'sandboxed iframe self-navigation boundary (host frame-src vs game own CSP vs platform wrapper)',
    generatedAt: new Date().toISOString(),
    ports: PORTS,
    sandboxAttribute: 'allow-scripts',
    gameScriptDelivery: 'external /res/game.js (no inline script, per asset-zip-v2 rule)',
    controls: {
      bootBeacon: 'every case beacons the target it is about to navigate to; a case only counts when the game ran AND aimed at the sink origin',
      wrapperPair: 'C3 (wrapper with CSP) and C3c (same wrapper, no CSP) differ only in the wrapper policy, and both are framed by a top-level page that sends no CSP',
    },
    cases: results,
    unexpected,
    conclusion: {
      gapReproduced: Boolean(byId('C1-parent-no-csp')?.leaked),
      hostFrameSrcBlocks: Boolean(byId('C2-parent-frame-src') && !byId('C2-parent-frame-src').leaked),
      sameOriginWrapperBlocks: Boolean(byId('C3-wrapper-frame-src') && !byId('C3-wrapper-frame-src').leaked),
      wrapperControlLeaksWithoutItsCsp: Boolean(byId('C3c-wrapper-no-csp')?.leaked),
      gameOwnCspInsufficient: Boolean(byId('C4-game-own-csp-only')?.leaked),
      allCasesAimedAtSink: results.every((r) => r.aimedAtSink),
      wrapperCasesHaveNoTopLevelCsp: ['C3-wrapper-frame-src', 'C3c-wrapper-no-csp']
        .every((id) => byId(id) !== undefined && byId(id).topLevelCsp === null),
    },
    passed: unexpected.length === 0,
  };
  fs.writeFileSync(path.join(OUT, 'cr-p1-selfnav.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  for (const r of results) {
    console.log(`${r.verdict === 'as-expected' ? 'PASS' : 'FAIL'}  ${r.id.padEnd(24)} ran=${String(r.gameRan).padEnd(5)} aimed=${String(r.aimedAtSink).padEnd(5)} leaked=${String(r.leaked).padEnd(5)} expected=${r.expectedLeak}`);
  }
  console.log('conclusion:', JSON.stringify(report.conclusion));
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
