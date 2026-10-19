#!/usr/bin/env node
/** Perf reference measurements in the isolated headless host (warm cache). */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const OUT = path.join(ROOT, 'docs/verification/v1/logs/perf-reference.log');
const BIN = '/tmp/dsh-inspect/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WORK = '/tmp/m3-perf';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ensure = (d) => fs.mkdirSync(d, { recursive: true });
async function run(cmd, args, opts = {}) { return new Promise((res) => { const c = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { o += d; }); c.on('close', (code) => res({ code, o })); }); }
async function startHost(home, port) {
  const logPath = `${WORK}/host.log`;
  const child = spawn(process.execPath, [BIN, 'web', '--no-open', '--port', String(port), '--host', '127.0.0.1'], { env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', fs.openSync(logPath, 'w'), fs.openSync(logPath, 'a')] });
  for (let i = 0; i < 50; i += 1) { await sleep(500); const t = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''; const m = t.match(/token=(\S+)/); if (m) return { child, url: `http://127.0.0.1:${port}/?token=${m[1]}` }; }
  throw new Error('no token');
}
async function main() {
  fs.rmSync(WORK, { recursive: true, force: true }); ensure(WORK);
  const home = `${WORK}/home`; ensure(`${home}/profiles`); const profile = `${home}/profiles/web`;
  const boot = spawn(process.execPath, [BIN, 'web', '--no-open', '--port', '58041', '--host', '127.0.0.1'], { env: { ...process.env, DSH_HOME: home }, stdio: 'ignore' });
  for (let i = 0; i < 30; i += 1) { await sleep(400); if (fs.existsSync(profile)) break; }
  boot.kill(); await sleep(1000);
  await run(process.execPath, ['scripts/dev-enable.mjs', '--yes', `--profile-dir=${profile}`], { cwd: ROOT, env: { ...process.env, DSH_HOME: home } });
  const from = path.join(os.homedir(), '.dsh/storages/dsh-game-market');
  if (fs.existsSync(from)) fs.cpSync(from, `${home}/storages/dsh-game-market`, { recursive: true });
  const host = await startHost(home, 58042);
  fs.rmSync(`${WORK}/chrome`, { recursive: true, force: true });
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9461', `--user-data-dir=${WORK}/chrome`, '--no-first-run', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  await sleep(2500);
  const list = await (await fetch('http://127.0.0.1:9461/json/list')).json();
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: host.url }); await sleep(9000);
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : null; };
  for (let i = 0; i < 4; i += 1) { const c = await ev(`(() => { const b = Array.from(document.querySelectorAll('button')).filter((n) => n.offsetParent !== null).find((n) => /^(继续|开始使用|知道了|完成|跳过)$/.test((n.innerText || '').trim())); if (b) { b.click(); return true; } return false; })()`); if (!c) break; await sleep(700); }
  const marketT0 = Date.now();
  await ev(`(() => { const els = Array.from(document.querySelectorAll('button,a,[role="button"],div')).filter((n) => n.offsetParent !== null); const el = els.find((n) => (n.innerText || '').trim() === 'Game Market'); if (el) el.click(); return !!el; })()`);
  let marketMs = null;
  for (let i = 0; i < 100; i += 1) { await sleep(100); if (await ev(`!!document.querySelector('.dgm-root')`)) { marketMs = Date.now() - marketT0; break; } }
  await sleep(1200);
  const games = ['Breakout', 'Jump', '2048', 'Snake'];
  const results = {};
  for (const name of games) {
    await ev(`(() => { const leaf = Array.from(document.querySelectorAll('.dgm-root *')).find((n) => n.children.length === 0 && (n.textContent || '').trim() === ${JSON.stringify(name)} && n.offsetParent !== null); if (!leaf) return false; const card = leaf.closest('button,[role="button"],[class*="card"],[class*="Card"]'); if (!card) return false; card.click(); return true; })()`);
    await sleep(1000);
    const t0 = Date.now();
    await ev(`(() => { const b = Array.from(document.querySelectorAll('.dgm-root button')).filter((x) => x.offsetParent !== null && !x.disabled).find((x) => /^(继续游戏|开始游戏|开始|继续)$/.test((x.innerText || '').trim())); if (!b) return false; b.click(); return true; })()`);
    let playing = null;
    for (let i = 0; i < 120; i += 1) {
      await sleep(100);
      if (await ev(`(() => { const o = document.querySelector('.dgm-overlay'); if (!o) return false; const b = Array.from(o.querySelectorAll('button')).find((x) => /^(继续游戏|继续)$/.test((x.innerText || '').trim())); if (b) b.click(); return !!b; })()`)) continue;
      const st = await ev(`(() => { const r = document.querySelector('.dgm-runtime'); return r ? r.dataset.runtimeState : null; })()`);
      if (st === 'playing') { playing = Date.now() - t0; break; }
    }
    results[name] = { launchToPlayingMs: playing };
    // back to market
    await ev(`(() => { const b = Array.from(document.querySelectorAll('.dgm-runtime button')).find((x) => (x.getAttribute('aria-label') || '').includes('返回市场')); if (b) { b.click(); return true; } return false; })()`);
    await sleep(1500);
    await ev(`(() => { const els = Array.from(document.querySelectorAll('button,a,[role="button"],div')).filter((n) => n.offsetParent !== null); const el = els.find((n) => (n.innerText || '').trim() === 'Game Market'); if (el) el.click(); return !!el; })()`);
    await sleep(1500);
  }
  const result = { startedAt: new Date().toISOString(), environment: 'isolated dsh web + headless Chrome 155, warm cache', marketFirstPaintMs: marketMs, games: results };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  chrome.kill(); host.child.kill(); process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
