#!/usr/bin/env node
/** A-16 evidence: CDP prefers-reduced-motion emulation reaches the game iframe. */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const OUT = path.join(ROOT, 'docs/verification/v1/logs/A-16-reduced-motion.log');
const BIN = '/tmp/dsh-inspect/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WORK = '/tmp/m3-a16';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ensure = (dir) => fs.mkdirSync(dir, { recursive: true });
async function run(cmd, args, opts = {}) { return new Promise((res) => { const c = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { o += d; }); c.on('close', (code) => res({ code, o })); }); }
async function startHost(home, port) {
  const logPath = `${WORK}/host-${port}.log`;
  const child = spawn(process.execPath, [BIN, 'web', '--no-open', '--port', String(port), '--host', '127.0.0.1'], { env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', fs.openSync(logPath, 'w'), fs.openSync(logPath, 'a')] });
  for (let i = 0; i < 50; i += 1) { await sleep(500); const t = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''; const m = t.match(/token=(\S+)/); if (m) return { child, url: `http://127.0.0.1:${port}/?token=${m[1]}` }; }
  throw new Error('no token');
}
async function main() {
  fs.rmSync(WORK, { recursive: true, force: true }); ensure(WORK);
  const home = `${WORK}/home`; ensure(`${home}/profiles`); const profile = `${home}/profiles/web`;
  const boot = spawn(process.execPath, [BIN, 'web', '--no-open', '--port', '58035', '--host', '127.0.0.1'], { env: { ...process.env, DSH_HOME: home }, stdio: 'ignore' });
  for (let i = 0; i < 30; i += 1) { await sleep(400); if (fs.existsSync(profile)) break; }
  boot.kill(); await sleep(1000);
  await run(process.execPath, ['scripts/dev-enable.mjs', '--yes', `--profile-dir=${profile}`], { cwd: ROOT, env: { ...process.env, DSH_HOME: home } });
  const from = path.join(os.homedir(), '.dsh/storages/dsh-game-market');
  if (fs.existsSync(from)) fs.cpSync(from, `${home}/storages/dsh-game-market`, { recursive: true });
  const host = await startHost(home, 58036);
  fs.rmSync(`${WORK}/chrome`, { recursive: true, force: true });
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9460', `--user-data-dir=${WORK}/chrome`, '--no-first-run', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  await sleep(2500);
  const list = await (await fetch('http://127.0.0.1:9460/json/list')).json();
  const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const sessions = [];
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); return; } if (m.method === 'Target.attachedToTarget') sessions.push(m.params.sessionId); };
  const send = (method, params = {}, sid) => new Promise((res) => { const i = ++id; pending.set(i, res); const msg = { id: i, method, params }; if (sid) msg.sessionId = sid; ws.send(JSON.stringify(msg)); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await send('Target.setDiscoverTargets', { discover: true }); await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.navigate', { url: host.url });
  await sleep(9000);
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : null; };
  for (let i = 0; i < 4; i += 1) { const c = await ev(`(() => { const b = Array.from(document.querySelectorAll('button')).filter((n) => n.offsetParent !== null).find((n) => /^(继续|开始使用|知道了|完成|跳过)$/.test((n.innerText || '').trim())); if (b) { b.click(); return true; } return false; })()`); if (!c) break; await sleep(700); }
  const mockReduced = await ev(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`);
  await ev(`(() => { const els = Array.from(document.querySelectorAll('button,a,[role="button"],div')).filter((n) => n.offsetParent !== null); const el = els.find((n) => (n.innerText || '').trim() === 'Game Market'); if (el) el.click(); return !!el; })()`);
  await sleep(4000);
  await ev(`(() => { const leaf = Array.from(document.querySelectorAll('.dgm-root *')).find((n) => n.children.length === 0 && (n.textContent || '').trim() === '2048' && n.offsetParent !== null); if (!leaf) return false; const card = leaf.closest('button,[role="button"],[class*="card"],[class*="Card"]'); if (!card) return false; card.click(); return true; })()`);
  await sleep(1500);
  const t0 = Date.now();
  await ev(`(() => { const b = Array.from(document.querySelectorAll('.dgm-root button')).filter((x) => x.offsetParent !== null && !x.disabled).find((x) => /^(继续游戏|开始游戏|开始|继续)$/.test((x.innerText || '').trim())); if (!b) return false; b.click(); return true; })()`);
  await ev(`(() => { const o = document.querySelector('.dgm-overlay'); if (!o) return false; const b = Array.from(o.querySelectorAll('button')).find((x) => /^(继续游戏|继续)$/.test((x.innerText || '').trim())); if (b) b.click(); return !!b; })()`);
  let playingMs = null;
  for (let i = 0; i < 60; i += 1) { await sleep(100); const st = await ev(`(() => { const r = document.querySelector('.dgm-runtime'); return r ? r.dataset.runtimeState : null; })()`); if (st === 'playing') { playingMs = Date.now() - t0; break; } }
  await sleep(1500);
  for (const sid of sessions) { try { await send('Runtime.enable', {}, sid); } catch (_e) { /* ignore */ } }
  let game = null;
  for (const sid of sessions) {
    const r = await send('Runtime.evaluate', { expression: 'typeof window.__dsh2048Debug === "function" ? JSON.stringify(window.__dsh2048Debug()) : null', returnByValue: true }, sid).catch(() => null);
    if (r && r.result && r.result.value) game = JSON.parse(r.result.value);
  }
  const result = { startedAt: new Date().toISOString(), pageMatchMediaReduced: mockReduced, launchToPlayingMs: playingMs, game: game && { reducedMotion: game.reducedMotion, mode: game.mode, theme: game.theme }, iframeSessions: sessions.length };
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  chrome.kill(); host.child.kill(); process.exit(0);
}
main().catch((error) => { console.error(error); process.exit(1); });
