#!/usr/bin/env node
/**
 * A-11 evidence: continuous play in the isolated headless host.
 *
 * Fails (non-zero exit) unless the Runtime stays alive AND the game itself keeps
 * progressing (iframe debug hook: not paused, no overlay, ball/paddle moved),
 * with zero page/runtime exceptions. See CR-08 in `codex 验收文档.md`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureDshRuntime } from './lib-dsh.mjs';
import { createChecker } from './assert.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const OUT = path.join(ROOT, 'docs/verification/v1/logs/A-11-A-16-stability.log');
const BIN = await ensureDshRuntime();
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WORK = '/tmp/m3-stability';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ensure = (dir) => fs.mkdirSync(dir, { recursive: true });
const checker = createChecker('A-11');

async function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
}
async function startHost(home, port) {
  const logPath = `${WORK}/host-${port}.log`;
  const child = spawn(process.execPath, [BIN, 'web', '--no-open', '--port', String(port), '--host', '127.0.0.1'], { env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', fs.openSync(logPath, 'w'), fs.openSync(logPath, 'a')] });
  for (let i = 0; i < 50; i += 1) {
    await sleep(500);
    const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    const match = text.match(/token=(\S+)/);
    if (match) return { child, url: `http://127.0.0.1:${port}/?token=${match[1]}` };
  }
  throw new Error(`host ${port} did not start`);
}
class Cdp {
  static async attach(port) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    const cdp = new Cdp();
    cdp.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { cdp.ws.onopen = res; cdp.ws.onerror = rej; });
    cdp.id = 0; cdp.pending = new Map(); cdp.sessions = []; cdp.errors = [];
    cdp.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && cdp.pending.has(m.id)) { cdp.pending.get(m.id)(m.result); cdp.pending.delete(m.id); return; }
      if (m.method === 'Target.attachedToTarget') cdp.sessions.push(m.params.sessionId);
      if (m.method === 'Runtime.exceptionThrown') cdp.errors.push(((m.params.exceptionDetails || {}).exception || {}).description || 'exception');
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') cdp.errors.push(m.params.entry.text);
    };
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    return cdp;
  }
  send(method, params = {}, sid) { return new Promise((resolve) => { const id = ++this.id; this.pending.set(id, resolve); const msg = { id, method, params }; if (sid) msg.sessionId = sid; this.ws.send(JSON.stringify(msg)); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : null; }
  async evalInFrames(expr) {
    const out = [];
    for (const sid of [...new Set(this.sessions)]) {
      try {
        const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true }, sid);
        if (r && r.result && r.result.value !== undefined && r.result.value !== null) out.push(r.result.value);
      } catch (_error) { /* frame went away */ }
    }
    return out;
  }
  async key(keyName) {
    const code = keyName === ' ' ? 32 : keyName === 'ArrowLeft' ? 37 : 39;
    const d = keyName === ' ' ? 'Space' : keyName;
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: keyName, code: d });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: keyName, code: d });
  }
  close() { try { this.ws.close(); } catch (_error) { /* ignore */ } }
}
async function makeHome(name) {
  const home = `${WORK}/home-${name}`;
  fs.rmSync(home, { recursive: true, force: true });
  ensure(`${home}/profiles`);
  const profile = `${home}/profiles/web`;
  const boot = spawn(process.execPath, [BIN, 'web', '--no-open', '--port', '58031', '--host', '127.0.0.1'], { env: { ...process.env, DSH_HOME: home }, stdio: 'ignore' });
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
async function enterBreakout(cdp) {
  await cdp.eval(`(() => { const els = Array.from(document.querySelectorAll('button,a,[role="button"],div')).filter((n) => n.offsetParent !== null); const el = els.find((n) => (n.innerText || '').trim() === 'Game Market'); if (el) el.click(); return !!el; })()`);
  await sleep(4000);
  await cdp.eval(`(() => { const leaf = Array.from(document.querySelectorAll('.dgm-root *')).find((n) => n.children.length === 0 && (n.textContent || '').trim() === 'Breakout' && n.offsetParent !== null); if (!leaf) return false; const card = leaf.closest('button,[role="button"],[class*="card"],[class*="Card"]'); if (!card) return false; card.click(); return true; })()`);
  await sleep(1500);
  const started = await cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('.dgm-root button')).filter((x) => x.offsetParent !== null && !x.disabled).find((x) => /^(开始游戏|继续游戏|开始|继续)$/.test((x.innerText || '').trim())); if (!b) return false; b.click(); return true; })()`);
  await sleep(5000);
  // The first launch of a saved game opens the platform resume dialog; keep
  // clicking it until the runtime is actually playing, then return the game
  // debug snapshot so callers can assert on real progression.
  for (let i = 0; i < 60; i += 1) {
    await sleep(300);
    await cdp.eval(`(() => { const o = document.querySelector('.dgm-overlay'); if (!o) return false; const b = Array.from(o.querySelectorAll('button')).find((x) => /^(继续游戏|继续)$/.test((x.innerText || '').trim())); if (b) b.click(); return !!b; })()`);
    const st = await cdp.eval(`(() => { const r = document.querySelector('.dgm-runtime'); return r ? r.dataset.runtimeState : null; })()`);
    if (st === 'playing') {
      await sleep(600);
      const debug = await gameDebug(cdp);
      if (debug && debug.runtimePaused === false) return { started, debug };
    }
  }
  return { started, debug: null };
}
async function gameDebug(cdp) {
  const values = await cdp.evalInFrames('typeof window.__dshBreakoutDebug === "function" ? JSON.stringify(window.__dshBreakoutDebug()) : null');
  for (const value of values) { try { return JSON.parse(value); } catch (_error) { /* next */ } }
  return null;
}

let host = null; let chrome = null; let cdp = null;
async function finish(report) {
  if (cdp) cdp.close();
  if (chrome) chrome.kill();
  try { if (host) host.child.kill(); } catch (_error) { /* ignore */ }
  const result = {
    ...report,
    ok: checker.ok,
    checks: checker.checks,
    failures: checker.failures,
    finishedAt: new Date().toISOString(),
  };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  process.exit(checker.exitCode());
}
async function main() {
  fs.rmSync(WORK, { recursive: true, force: true }); ensure(WORK);
  const home = await makeHome('breakout');
  host = await startHost(home, 58032);
  fs.rmSync(`${WORK}/chrome`, { recursive: true, force: true });
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9459', `--user-data-dir=${WORK}/chrome`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  await sleep(2500);
  cdp = await Cdp.attach(9459);
  await cdp.send('Page.navigate', { url: host.url });
  await sleep(9000);
  await dismissOnboarding(cdp);
  const entered = await enterBreakout(cdp);
  checker.check('breakout started', entered.started === true);
  checker.check('breakout reached playing (not paused)', Boolean(entered.debug && entered.debug.runtimePaused === false), entered.debug && { runtimePaused: entered.debug.runtimePaused });
  await cdp.key(' ');
  await sleep(4000);
  const debugStart = entered.debug || (await gameDebug(cdp));
  const t0 = Date.now();
  const ticks = [];
  let step = 0;
  const MAX_MS = 300 * 1000;
  while (Date.now() - t0 < MAX_MS) {
    const keys = [' ', 'ArrowLeft', 'ArrowRight'];
    await cdp.key(keys[step % 3]);
    await sleep(2000);
    if (step % 30 === 0) {
      const state = await cdp.eval(`(() => { const r = document.querySelector('.dgm-runtime'); return r ? { state: r.dataset.runtimeState, overlay: (document.querySelector('.dgm-overlay') || {}).innerText || '' } : null; })()`);
      ticks.push({ atSec: Math.round((Date.now() - t0) / 1000), state });
    }
    step += 1;
  }
  const debugEnd = await gameDebug(cdp);
  const finalState = await cdp.eval(`(() => { const r = document.querySelector('.dgm-runtime'); return r ? { state: r.dataset.runtimeState, overlay: (document.querySelector('.dgm-overlay') || {}).innerText || '' } : null; })()`);
  const progressed = Boolean(
    debugStart && debugEnd &&
    (debugStart.ball.x !== debugEnd.ball.x || debugStart.ball.y !== debugEnd.ball.y ||
      debugStart.ball.launched !== debugEnd.ball.launched ||
      debugStart.paddleX !== debugEnd.paddleX || debugStart.status !== debugEnd.status ||
      debugEnd.score > debugStart.score || debugEnd.remaining < debugStart.remaining)
  );
  checker.check('duration >= 300s', Date.now() - t0 >= MAX_MS - 2000);
  checker.check('runtime stayed playing', finalState && finalState.state === 'playing', finalState);
  checker.check('no tick observed a non-playing shell', ticks.every((tick) => tick.state && tick.state.state === 'playing'));
  checker.check('game progressed internally', progressed, { start: debugStart && { ball: debugStart.ball, paddleX: debugStart.paddleX, score: debugStart.score, remaining: debugStart.remaining }, end: debugEnd && { ball: debugEnd.ball, paddleX: debugEnd.paddleX, score: debugEnd.score, remaining: debugEnd.remaining } });
  checker.check('zero page/runtime exceptions', cdp.errors.length === 0, cdp.errors.slice(0, 10));
  await finish({ environment: 'isolated dsh web + headless Chrome 155', durationSec: Math.round((Date.now() - t0) / 1000), steps: step, finalState, debugStart, debugEnd, progressed, errors: [...new Set(cdp.errors)], ticks, a11: true });
}
main().catch(async (error) => {
  checker.check('stability run completed without throwing', false, String(error && error.message ? error.message : error));
  await finish({ environment: 'isolated dsh web + headless Chrome 155', error: String(error && error.message ? error.message : error) });
});
