#!/usr/bin/env node
/**
 * M3 UI evidence: isolated DSH web host + headless Chrome screenshots.
 *
 * Usage: node scripts/verification/ui-evidence.mjs [--keep]
 * Outputs: docs/verification/v1/screenshots/*.png + results/ui-evidence.json
 *
 * The host runs from the cached app.asar extraction with an isolated DSH_HOME;
 * it never touches the user's profile. Two homes are used: fresh (U-01) and a
 * copy of the current user's plugin storage (Continue / My Games evidence).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const OUT = path.join(ROOT, 'docs/verification/v1');
const SHOTS = path.join(OUT, 'screenshots');
const RESULTS = path.join(OUT, 'results/ui-evidence.json');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
const WORK = '/tmp/dsh-m3-ui';
const DSH_ROOT = `${WORK}/asar`;
const BIN = `${DSH_ROOT}/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { startedAt: new Date().toISOString(), shots: [], checks: {}, perf: {} };
const ensure = (dir) => fs.mkdirSync(dir, { recursive: true });

function extractAsar() {
  if (fs.existsSync(BIN)) return;
  ensure(WORK);
  const archive = fs.readFileSync(ASAR);
  const headerSize = archive.readUInt32LE(4);
  const jsonLen = archive.readUInt32LE(12);
  const header = JSON.parse(archive.subarray(16, 16 + jsonLen).toString('utf8'));
  const base = 8 + headerSize;
  const wanted = (rel) => ['dsh', 'node_modules', 'package.json', 'lib'].some((p) => rel === p || rel.startsWith(`${p}/`));
  function walk(node, rel) {
    if (!node) return;
    if (node.files) {
      for (const [name, child] of Object.entries(node.files)) walk(child, rel ? `${rel}/${name}` : name);
      return;
    }
    if (!wanted(rel) || node.link) return;
    const target = path.join(DSH_ROOT, rel);
    ensure(path.dirname(target));
    if (node.unpacked) {
      const from = `${ASAR}.unpacked/${rel}`;
      if (fs.existsSync(from)) fs.copyFileSync(from, target);
    } else {
      fs.writeFileSync(target, archive.subarray(base + Number(node.offset), base + Number(node.offset) + Number(node.size)));
    }
  }
  for (const p of ['dsh', 'node_modules', 'package.json', 'lib']) if (header.files[p]) walk(header.files[p], p);
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function makeHome(name, { fresh }) {
  const home = `${WORK}/home-${name}`;
  fs.rmSync(home, { recursive: true, force: true });
  ensure(`${home}/profiles`);
  const profile = `${home}/profiles/web`;
  // Bootstrap one Host start so DSH creates the web profile config, then enable
  // the dev row and start the real Host for evidence.
  const boot = spawn(process.execPath, [BIN, 'web', '--no-open', '--port', '58011', '--host', '127.0.0.1'], { env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 30; i += 1) { await sleep(500); if (fs.existsSync(profile)) break; }
  boot.kill();
  await sleep(1200);
  await run(process.execPath, ['scripts/dev-enable.mjs', '--yes', `--profile-dir=${profile}`], { cwd: ROOT, env: { ...process.env, DSH_HOME: home } });
  if (!fresh) {
    const from = path.join(os.homedir(), '.dsh/storages/dsh-game-market');
    if (fs.existsSync(from)) fs.cpSync(from, `${home}/storages/dsh-game-market`, { recursive: true });
  }
  return home;
}

async function dismissOnboarding(cdp) {
  for (let i = 0; i < 5; i += 1) {
    const clicked = await cdp.eval(`(() => { const buttons = Array.from(document.querySelectorAll('button')).filter((n) => n.offsetParent !== null); const el = buttons.find((n) => /^(继续|开始使用|知道了|完成|跳过)$/.test((n.innerText || '').trim())); if (el) { el.click(); return true; } return false; })()`);
    if (!clicked) return;
    await sleep(900);
  }
}

async function startHost(home, port) {
  const log = fs.openSync(`${WORK}/host-${port}.log`, 'w');
  const child = spawn(process.execPath, [BIN, 'web', '--no-open', '--port', String(port), '--host', '127.0.0.1'], {
    env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', log, log],
  });
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    try {
      const text = fs.readFileSync(`${WORK}/host-${port}.log`, 'utf8');
      const match = text.match(/token=([^\s]+)/);
      if (match) return { child, url: `http://127.0.0.1:${port}/?token=${match[1]}` };
    } catch (_error) { /* not yet */ }
  }
  throw new Error('isolated host did not start');
}

class Cdp {
  static async attach(port = 9456) {
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
      if (m.method === 'Runtime.exceptionThrown') cdp.errors.push(((m.params.exceptionDetails || {}).exception || {}).description || (m.params.exceptionDetails || {}).text);
    };
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    return cdp;
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve) => {
      const id = ++this.id;
      this.pending.set(id, resolve);
      const msg = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      this.ws.send(JSON.stringify(msg));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r && r.result ? r.result.value : null;
  }
  async shot(name) {
    const data = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data.data, 'base64'));
    results.shots.push(name);
  }
  async click(text) {
    return this.eval(`(() => { const els = Array.from(document.querySelectorAll('button,a,[role="button"],[role="tab"],div')).filter((n) => n.offsetParent !== null); const el = els.find((n) => (n.innerText || '').trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true; })()`);
  }
  async clickMatch(re) {
    return this.eval(`(() => { const els = Array.from(document.querySelectorAll('button')).filter((n) => n.offsetParent !== null && !n.disabled); const el = els.find((n) => ${re}.test((n.innerText || '').trim())); if (!el) return false; el.click(); return true; })()`);
  }
  async until(expr, timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.eval(expr)) return Date.now() - start;
      await sleep(200);
    }
    return null;
  }
}

async function main() {
  ensure(SHOTS); ensure(`${OUT}/results`); ensure(WORK);
  extractAsar();
  fs.rmSync('/tmp/dsh-m3-chrome', { recursive: true, force: true });
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9456', '--user-data-dir=/tmp/dsh-m3-chrome', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
  await sleep(2500);
  const cdp = await Cdp.attach();
  let host = null;

  // ---- U-01: fresh isolated home, empty Market ----
  try {
    const home = await makeHome('fresh', { fresh: true });
    host = await startHost(home, 58012);
    await cdp.send('Page.navigate', { url: host.url });
    await sleep(9000);
    await dismissOnboarding(cdp);
    await cdp.click('Game Market');
    await cdp.until(`!!document.querySelector('.dgm-root')`, 10000);
    await sleep(1200);
    await cdp.shot('U-01-market-first-run');
    results.checks.freshMarket = await cdp.eval(`(() => { const root = document.querySelector('.dgm-root'); return root ? root.innerText.slice(0, 300) : null; })()`);
  } finally { if (host) host.child.kill(); await sleep(1500); }

  // ---- U-02/03/08/11/13/14: copied storage (Continue + My Games) ----
  try {
    const home = await makeHome('data', { fresh: false });
    host = await startHost(home, 58013);
    const t0 = Date.now();
    await cdp.send('Page.navigate', { url: host.url });
    await sleep(9000);
    await dismissOnboarding(cdp);
    const t1 = Date.now();
    await cdp.click('Game Market');
    const marketDelay = await cdp.until(`!!document.querySelector('.dgm-root')`, 10000);
    results.perf.marketFirstPaintMs = marketDelay;
    await sleep(1200);
    await cdp.shot('U-02-market-with-games');
    // search interaction
    await cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('.dgm-root button')).find((x) => (x.getAttribute('aria-label') || '').includes('搜索') || (x.innerText || '').trim() === '搜索'); if (b) b.click(); return !!b; })()`);
    await sleep(400);
    await cdp.eval(`(() => { const i = document.querySelector('.dgm-root input'); if (!i) return false; i.focus(); i.value = 'jump'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
    await sleep(800);
    await cdp.shot('U-02-search-jump');
    await cdp.eval(`(() => { const i = document.querySelector('.dgm-root input'); if (!i) return false; i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
    await sleep(700);
    // detail
    const opened = await cdp.eval(`(() => { const root = document.querySelector('.dgm-root'); const leaf = Array.from(root.querySelectorAll('*')).find((n) => n.children.length === 0 && (n.textContent || '').trim() === 'Jump' && n.offsetParent !== null); if (!leaf) return false; const card = leaf.closest('button,[role="button"],[class*="card"],[class*="Card"]'); if (!card) return false; card.click(); return true; })()`);
    await sleep(1200);
    await cdp.shot('U-03-detail-jump');
    results.checks.detailOpened = opened;
    // uninstall confirmation (open dialog, then escape)
    const uninstallClicked = await cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('.dgm-root button')).find((x) => /卸载/.test(x.innerText || '')); if (!b) return false; b.click(); return true; })()`);
    await sleep(600);
    if (uninstallClicked) await cdp.shot('U-11-uninstall-confirm');
    await cdp.eval(`(() => { const b = Array.from(document.querySelectorAll('.dgm-root button')).find((x) => /取消|Cancel/.test(x.innerText || '')); if (b) b.click(); return true; })()`);
    await sleep(500);
    // runtime: continue breakout from Market hero, capture resume dialog, pause dialog
    await cdp.click('市场');
    await sleep(800);
    const cont = await cdp.eval(`(() => { const root = document.querySelector('.dgm-root'); if (!root) return null; const b = Array.from(root.querySelectorAll('button')).find((x) => /^继续$|^继续游戏$/.test((x.innerText || '').trim())); if (!b) return null; b.click(); return true; })()`);
    if (cont) {
      const resumeDelay = await cdp.until(`!!document.querySelector('.dgm-overlay')`, 12000);
      await sleep(500);
      await cdp.shot('U-08-resume-confirm');
      await cdp.click('继续游戏');
      await cdp.until(`!!document.querySelector('.dgm-runtime') && document.querySelector('.dgm-runtime').dataset.runtimeState === 'playing'`, 12000);
      await sleep(1200);
      await cdp.shot('U-13-runtime-breakout');
      // platform pause dialog (must be the only dialog)
      await cdp.eval(`(() => { const root = document.querySelector('.dgm-runtime'); const b = Array.from(root.querySelectorAll('button')).find((x) => (x.getAttribute('aria-label') || '').includes('暂停')); if (b) b.click(); return !!b; })()`);
      await cdp.until(`!!document.querySelector('.dgm-overlay')`, 6000);
      await sleep(700);
      await cdp.shot('A-05-pause-overlay');
      results.checks.pauseModalOnly = await cdp.eval(`(() => { const o = document.querySelector('.dgm-overlay'); return o ? o.innerText.replace(/\\s+/g, ' ').slice(0, 160) : null; })()`);
      await cdp.click('退出到市场');
      await sleep(1200);
    }
    // narrow window + dark theme
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 720, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(900);
    await cdp.shot('U-13-narrow-720');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 0, height: 0, deviceScaleFactor: 0, mobile: false });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await sleep(900);
    await cdp.shot('U-13-dark-theme');
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    results.checks.runtimeErrors = cdp.errors;
  } finally { if (host) host.child.kill(); }

  results.finishedAt = new Date().toISOString();
  fs.writeFileSync(RESULTS, JSON.stringify(results, null, 2));
  chrome.kill();
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
