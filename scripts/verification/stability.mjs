#!/usr/bin/env node
/**
 * M3 stability + reduced-motion evidence (isolated headless).
 *
 * - A-11: active Breakout session for ~5 minutes; records runtime state and
 *   console/runtime errors.
 * - A-16: the same host with CDP `prefers-reduced-motion: reduce` and a 2048
 *   launch; verifies the game receives reducedMotion=true.
 *
 * Usage: node scripts/verification/stability.mjs
 * Outputs: docs/verification/v1/logs/A-11-A-16-stability.log
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const OUT = path.join(ROOT, 'docs/verification/v1/logs/A-11-A-16-stability.log');
const BIN = '/tmp/dsh-inspect/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WORK = '/tmp/m3-stability';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logLines = [];
const log = (...parts) => { const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '); logLines.push(line); console.log(line); };
const results = { startedAt: new Date().toISOString(), a11: null, a16: null, errors: [] };

function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }
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
    cdp.id = 0; cdp.pending = new Map(); cdp.errors = [];
    cdp.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && cdp.pending.has(m.id)) { cdp.pending.get(m.id)(m.result); cdp.pending.delete(m.id); return; }
      if (m.method === 'Runtime.exceptionThrown') cdp.errors.push(((m.params.exceptionDetails || {}).exception || {}).description || 'exception');
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') cdp.errors.push(m.params.entry.text);
    };
    await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('Page.enable');
    return cdp;
  }
  send(method, params = {}) { return new Promise((resolve) => { const id = ++this.id; this.pending.set(id, resolve); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : null; }
  async key(code, keyName) {
    const keyCode = keyName === ' ' ? 32 : keyName === 'ArrowLeft' ? 37 : keyName === 'ArrowRight' ? 39 : code;
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, key: keyName, code: keyName === ' ' ? 'Space' : keyName });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, key: keyName, code: keyName === ' ' ? 'Space' : keyName });
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
  await cdp.eval(`(() => { const o = document.querySelector('.dgm-overlay'); if (!o) return false; const b = Array.from(o.querySelectorAll('button')).find((x) => /^(继续游戏|继续)$/.test((x.innerText || '').trim())); if (b) b.click(); return !!b; })()`);
  await sleep(2000);
  return started;
}

async function main() {
  ensure(WORK); fs.rmSync(WORK, { recursive: true, force: true }); ensure(WORK);
  const home = await makeHome('breakout');
  const host = await startHost(home, 58032);
  let chrome = null; let cdp = null;
  const timer = setTimeout(finish, 9 * 60 * 1000);
  async function finish(reason) {
    if (results.a11 === null) {
      results.a11 = { error: reason || 'timeout', partial: true };
      results.finishedAt = new Date().toISOString();
      fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
      log('A-11 aborted:', reason || 'timeout');
    }
    if (cdp) cdp.close();
    if (chrome) chrome.kill();
    try { host.child.kill(); } catch (_error) { /* ignore */ }
    clearTimeout(timer);
    process.exit(0);
  }
  try {
    fs.rmSync(`${WORK}/chrome`, { recursive: true, force: true });
    chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9459', `--user-data-dir=${WORK}/chrome`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
    await sleep(2500);
    cdp = await Cdp.attach(9459);
    await cdp.send('Page.navigate', { url: host.url });
    await sleep(9000);
    await dismissOnboarding(cdp);
    const started = await enterBreakout(cdp);
    const t0 = Date.now();
    const ticks = [];
    let step = 0;
    while (Date.now() - t0 < 300 * 1000) {
      const keys = [' ', 'ArrowLeft', 'ArrowRight'];
      await cdp.key(0, keys[step % 3]);
      await sleep(2000);
      if (step % 30 === 0) {
        const st = await cdp.eval(`(() => { const r = document.querySelector('.dgm-runtime'); return r ? { state: r.dataset.runtimeState, overlay: (document.querySelector('.dgm-overlay') || {}).innerText || '' } : null; })()`);
        ticks.push({ atSec: Math.round((Date.now() - t0) / 1000), st });
      }
      step += 1;
    }
    const finalState = await cdp.eval(`(() => { const r = document.querySelector('.dgm-runtime'); return r ? { state: r.dataset.runtimeState, overlay: (document.querySelector('.dgm-overlay') || {}).innerText || '' } : null; })()`);
    results.a11 = { started, durationSec: Math.round((Date.now() - t0) / 1000), steps: step, finalState, errors: [...new Set(cdp.errors)], ticks };
    log('A-11 result:', results.a11);

    // A-16: reduced motion through CDP media emulation, fresh 2048 launch.
    const home2 = await makeHome('reduced');
    const host2 = await startHost(home2, 58033);
    const cdp2 = await Cdp.attach(9459);
    await cdp2.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await cdp2.send('Page.navigate', { url: host2.url });
    await sleep(9000);
    await dismissOnboarding(cdp2);
    await cdp2.eval(`(() => { const els = Array.from(document.querySelectorAll('button,a,[role="button"],div')).filter((n) => n.offsetParent !== null); const el = els.find((n) => (n.innerText || '').trim() === 'Game Market'); if (el) el.click(); return !!el; })()`);
    await sleep(4000);
    await cdp2.eval(`(() => { const leaf = Array.from(document.querySelectorAll('.dgm-root *')).find((n) => n.children.length === 0 && (n.textContent || '').trim() === '2048' && n.offsetParent !== null); if (!leaf) return false; const card = leaf.closest('button,[role="button"],[class*="card"],[class*="Card"]'); if (!card) return false; card.click(); return true; })()`);
    await sleep(1500);
    await cdp2.eval(`(() => { const b = Array.from(document.querySelectorAll('.dgm-root button')).filter((x) => x.offsetParent !== null && !x.disabled).find((x) => /^(继续游戏|开始游戏|开始|继续)$/.test((x.innerText || '').trim())); if (!b) return false; b.click(); return true; })()`);
    await sleep(5000);
    await cdp2.eval(`(() => { const o = document.querySelector('.dgm-overlay'); if (!o) return false; const b = Array.from(o.querySelectorAll('button')).find((x) => /^(继续游戏|继续)$/.test((x.innerText || '').trim())); if (b) b.click(); return !!b; })()`);
    await sleep(2500);
    const gameReduced = await cdp2.eval(`(() => { if (typeof window.__dsh2048Debug === 'function') return JSON.stringify(window.__dsh2048Debug()); const el = document.querySelector('.dgm-runtime'); return el ? JSON.stringify({ runtimeState: el.dataset.runtimeState }) : null; })()`);
    results.a16 = { emulated: 'prefers-reduced-motion: reduce', pageReduced: await cdp2.eval(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`), game: gameReduced };
    cdp2.close(); host2.child.kill();
    results.finishedAt = new Date().toISOString();
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    log('wrote', OUT);
  } catch (error) {
    results.error = String(error && error.message || error);
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    log('stability failed:', results.error);
  } finally {
    await finish();
  }
}
main();
