#!/usr/bin/env node
/**
 * Metric-semantics-correct perf sampling (CR-09).
 *
 * Distinguishes "Market shell mounted" from "catalog cards ready and clickable",
 * and reports Runtime-playing latency (not game-ready). Each metric is sampled
 * three times; a failed sample/click is a failure (non-zero exit), never a
 * normal-looking timing.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureDshRuntime } from './lib-dsh.mjs';
import { createChecker } from './assert.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const OUT = path.join(ROOT, 'docs/verification/v1/logs/perf-reference.log');
const BIN = await ensureDshRuntime();
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WORK = '/tmp/m3-perf';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ensure = (dir) => fs.mkdirSync(dir, { recursive: true });
const checker = createChecker('perf');
const SAMPLES = 3;

async function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}
async function startHost(home, port) {
  const logPath = `${WORK}/host.log`;
  const child = spawn(process.execPath, [BIN, 'web', '--no-open', '--port', String(port), '--host', '127.0.0.1'], { env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', fs.openSync(logPath, 'w'), fs.openSync(logPath, 'a')] });
  for (let i = 0; i < 50; i += 1) {
    await sleep(500);
    const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    const match = text.match(/token=(\S+)/);
    if (match) return { child, url: `http://127.0.0.1:${port}/?token=${match[1]}` };
  }
  throw new Error('host did not start');
}
class Cdp {
  static async attach(port) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    const cdp = new Cdp();
    cdp.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { cdp.ws.onopen = res; cdp.ws.onerror = rej; });
    cdp.id = 0; cdp.pending = new Map();
    cdp.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && cdp.pending.has(m.id)) { cdp.pending.get(m.id)(m.result); cdp.pending.delete(m.id); } };
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Log.enable');
    return cdp;
  }
  send(method, params = {}) { return new Promise((resolve) => { const id = ++this.id; this.pending.set(id, resolve); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : null; }
  close() { try { this.ws.close(); } catch (_error) { /* ignore */ } }
}
async function makeHome(name) {
  const home = `${WORK}/home-${name}`;
  fs.rmSync(home, { recursive: true, force: true });
  ensure(`${home}/profiles`);
  const profile = `${home}/profiles/web`;
  const boot = spawn(process.execPath, [BIN, 'web', '--no-open', '--port', '58041', '--host', '127.0.0.1'], { env: { ...process.env, DSH_HOME: home }, stdio: 'ignore' });
  for (let i = 0; i < 30; i += 1) { await sleep(400); if (fs.existsSync(profile)) break; }
  boot.kill(); await sleep(1000);
  await run(process.execPath, ['scripts/dev-enable.mjs', '--yes', `--profile-dir=${profile}`], { cwd: ROOT, env: { ...process.env, DSH_HOME: home } });
  const from = path.join(os.homedir(), '.dsh/storages/dsh-game-market');
  if (fs.existsSync(from)) fs.cpSync(from, `${home}/storages/dsh-game-market`, { recursive: true });
  return home;
}
async function dismissOnboarding(cdp) {
  for (let i = 0; i < 5; i += 1) {
    const clicked = await cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('button')).filter((n) => n.offsetParent !== null).find((n) => /^(继续|开始使用|知道了|完成|跳过)$/.test((n.innerText || '').trim())); if (!b) return false; b.click(); return true; })()`);
    if (!clicked) return;
    await sleep(800);
  }
}
async function openMarket(cdp) {
  return cdp.eval(`(() => { const els = Array.from(document.querySelectorAll('button,a,[role="button"],div')).filter((n) => n.offsetParent !== null); const el = els.find((n) => (n.innerText || '').trim() === 'Game Market'); if (!el) return false; el.click(); return true; })()`);
}
async function waitFor(cdp, expr, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cdp.eval(expr)) return true;
    await sleep(100);
  }
  return false;
}
async function openGameDetail(cdp, name) {
  const opened = await cdp.eval(`(() => {
    const cards = Array.from(document.querySelectorAll('.dgm-root .dgm-card'));
    const card = cards.find((c) => (c.innerText || '').includes(${JSON.stringify(name)}));
    if (!card) return false;
    card.click();
    return true;
  })()`);
  if (!opened) return { opened: false };
  // Wait for the detail action outside the measured interval.
  const ready = await waitFor(cdp, `!!Array.from(document.querySelectorAll('.dgm-root button')).find((x) => x.offsetParent !== null && !x.disabled && /^(继续游戏|开始游戏|开始|继续)$/.test((x.innerText || '').trim()))`, 8000);
  return { opened: true, ready };
}
async function clickPrimary(cdp, primaryRe) {
  return cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('.dgm-root button')).filter((x) => x.offsetParent !== null && !x.disabled).find((x) => ${primaryRe}.test((x.innerText || '').trim())); if (!b) return false; b.click(); return true; })()`);
}
let host = null; let chrome = null; let cdp = null;
async function finish(report) {
  if (cdp) cdp.close();
  if (chrome) chrome.kill();
  try { if (host) host.child.kill(); } catch (_error) { /* ignore */ }
  const result = { ...report, ok: checker.ok, checks: checker.checks, failures: checker.failures, finishedAt: new Date().toISOString() };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(checker.exitCode());
}
async function main() {
  fs.rmSync(WORK, { recursive: true, force: true }); ensure(WORK);
  const home = await makeHome('perf');
  host = await startHost(home, 58042);
  fs.rmSync(`${WORK}/chrome`, { recursive: true, force: true });
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9461', `--user-data-dir=${WORK}/chrome`, '--no-first-run', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  await sleep(2500);
  cdp = await Cdp.attach(9461);

  const shellSamples = [];
  const readySamples = [];
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    await cdp.send('Page.navigate', { url: host.url });
    await sleep(8000);
    await dismissOnboarding(cdp);
    const t0 = Date.now();
    const clicked = await openMarket(cdp);
    checker.check(`market click sample ${sample + 1}`, clicked === true);
    let shellMs = null;
    let readyMs = null;
    for (let i = 0; i < 120; i += 1) {
      await sleep(50);
      if (shellMs === null && (await cdp.eval(`!!document.querySelector('.dgm-root')`))) shellMs = Date.now() - t0;
      if (shellMs !== null && (await cdp.eval(`document.querySelectorAll('.dgm-root .dgm-card').length > 0`))) { readyMs = Date.now() - t0; break; }
    }
    checker.check(`market shell sample ${sample + 1}`, shellMs !== null, shellMs);
    checker.check(`market cards-ready sample ${sample + 1}`, readyMs !== null, readyMs);
    shellSamples.push(shellMs); readySamples.push(readyMs);
  }
  const median = (values) => { const sorted = values.filter((v) => typeof v === 'number').sort((a, b) => a - b); if (sorted.length === 0) return null; return sorted[Math.floor(sorted.length / 2)]; };

  const games = ['Breakout', 'Jump', '2048', 'Snake'];
  const gameSamples = {};
  for (const name of games) {
    const attempts = [];
    for (let sample = 0; sample < 2; sample += 1) {
      await cdp.send('Page.navigate', { url: host.url });
      await sleep(7000);
      await dismissOnboarding(cdp);
      await openMarket(cdp);
      await sleep(2500);
      const ready = await waitFor(cdp, `document.querySelectorAll('.dgm-root .dgm-card').length > 0`, 8000);
      if (!ready) { attempts.push(null); checker.check(`${name} market cards sample ${sample + 1}`, false); continue; }
      const detail = await openGameDetail(cdp, name);
      if (!detail.opened || !detail.ready) { attempts.push(null); checker.check(`${name} detail ready sample ${sample + 1}`, false, detail); continue; }
      // Start the clock immediately before the actual primary click: the detail
      // readiness wait above is outside the measured launch interval (CR-09).
      const t0 = Date.now();
      const clicked = await clickPrimary(cdp, /^(继续游戏|开始游戏|开始|继续)$/);
      if (!clicked) { attempts.push(null); checker.check(`${name} primary click sample ${sample + 1}`, false); continue; }
      let playingMs = null;
      for (let i = 0; i < 150; i += 1) {
        await sleep(100);
        await cdp.eval(`(() => { const o = document.querySelector('.dgm-overlay'); if (!o) return false; const b = Array.from(o.querySelectorAll('button')).find((x) => /^(继续游戏|继续)$/.test((x.innerText || '').trim())); if (b) b.click(); return !!b; })()`);
        const st = await cdp.eval(`(() => { const r = document.querySelector('.dgm-runtime'); return r ? r.dataset.runtimeState : null; })()`);
        if (st === 'playing') { playingMs = Date.now() - t0; break; }
      }
      attempts.push(playingMs);
      checker.check(`${name} sample ${sample + 1} reached playing`, typeof playingMs === 'number', playingMs);
    }
    gameSamples[name] = attempts;
    checker.check(`${name} all samples reached playing`, attempts.length === 2 && attempts.every((v) => typeof v === 'number'), attempts);
  }
  const result = {
    startedAt: new Date().toISOString(),
    environment: 'isolated dsh web + headless Chrome 155, warm cache, 1440x900',
    metrics: {
      marketShellMs: { samples: shellSamples, median: median(shellSamples) },
      marketCardsReadyMs: { samples: readySamples, median: median(readySamples) },
      launchToRuntimePlayingMs: Object.fromEntries(Object.entries(gameSamples).map(([game, samples]) => [game, { samples, median: median(samples) }])),
    },
    scriptVersion: 2,
  };
  await finish(result);
}
main().catch(async (error) => {
  checker.check('perf run completed without throwing', false, String(error && error.message ? error.message : error));
  await finish({ error: String(error && error.message ? error.message : error) });
});
