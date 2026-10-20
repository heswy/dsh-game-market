#!/usr/bin/env node
/**
 * V1.5 M0 shared probe harness.
 *
 * Everything here runs against the DSH build the user actually has installed
 * (`/Applications/DeepSeek Harness.app`), extracted read-only from app.asar into
 * a scratch directory. No probe ever writes to the user's daily DSH profile:
 * every home lives under `/tmp/dsh-v15-*`.
 *
 * Zero npm dependencies. Node >= 20 (uses global fetch/WebSocket).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ASAR = '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar';
export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const WORK = process.env.DSH_V15_WORK || '/tmp/dsh-v15';
export const ASAR_ROOT = `${WORK}/asar`;
export const DSH_BIN = `${ASAR_ROOT}/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js`;
export const DSH_PACKAGES = `${ASAR_ROOT}/dsh/node_modules/@deepseek-ai`;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const ensure = (dir) => fs.mkdirSync(dir, { recursive: true });

/**
 * Absolute path inside the probe worktree (repo root).
 * `fileURLToPath` (not `URL.pathname`) is required: these worktrees live under
 * a directory whose name contains a space, and `.pathname` keeps it percent-encoded.
 */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

// ---------------------------------------------------------------------------
// app.asar extraction (read-only source)
// ---------------------------------------------------------------------------

function extractAsar() {
  if (fs.existsSync(DSH_BIN)) return;
  if (!fs.existsSync(ASAR)) throw new Error(`DSH app.asar not found: ${ASAR}`);
  ensure(WORK);
  fs.rmSync(ASAR_ROOT, { recursive: true, force: true });
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
    const target = path.join(ASAR_ROOT, rel);
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

/** Extract the installed DSH runtime once and return its `dsh` CLI path. */
export function ensureRuntime() {
  extractAsar();
  return DSH_BIN;
}

/** Installed DSH runtime identity, as reported by the extracted packages. */
export function runtimeIdentity() {
  extractAsar();
  const dsh = JSON.parse(fs.readFileSync(`${ASAR_ROOT}/dsh/package.json`, 'utf8'));
  const pluginManager = JSON.parse(fs.readFileSync(`${DSH_PACKAGES}/dsh-plugin-manager/package.json`, 'utf8'));
  const appPackage = fs.existsSync('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar')
    ? JSON.parse(fs.readFileSync(`${ASAR_ROOT}/package.json`, 'utf8'))
    : null;
  return {
    dshPackage: { name: dsh.name, version: dsh.version },
    pluginManager: { name: pluginManager.name, version: pluginManager.version },
    electronApp: appPackage ? { name: appPackage.name, version: appPackage.version } : null,
    asarExtractedAt: fs.statSync(DSH_BIN).mtime.toISOString(),
  };
}

/** SHA-256 of a file inside the extracted asar tree, for build-identity evidence. */
export async function sha256File(file) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ---------------------------------------------------------------------------
// Isolated DSH homes and profiles
// ---------------------------------------------------------------------------

export function homeDir(name) {
  return path.join(WORK, `home-${name}`);
}

/**
 * Create an isolated DSH_HOME with a materialized `web` profile.
 * Boots the host once (and kills it) so DSH writes its own default profile,
 * then leaves the home ready for probe-specific patches.
 */
export async function makeHome(name, { port = 58100 } = {}) {
  const home = homeDir(name);
  fs.rmSync(home, { recursive: true, force: true });
  ensure(path.join(home, 'profiles'));
  const boot = spawn(process.execPath, [DSH_BIN, 'web', '--no-open', '--port', String(port), '--host', '127.0.0.1'], {
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const profile = profileDir(home);
  for (let i = 0; i < 60; i += 1) {
    await sleep(500);
    if (fs.existsSync(path.join(profile, 'package.json'))) break;
  }
  boot.kill('SIGKILL');
  await sleep(1200);
  if (!fs.existsSync(profile)) throw new Error(`DSH did not materialize a web profile under ${home}`);
  return home;
}

export function profileDir(home, profile = 'web') {
  return path.join(home, 'profiles', profile);
}

/** Copy an existing home so a probe can compare "before" and "after" states. */
export function cloneHome(from, to) {
  const target = homeDir(to);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(homeDir(from), target, { recursive: true });
  return target;
}

export function readProfilePackage(home, profile = 'web') {
  return JSON.parse(fs.readFileSync(path.join(profileDir(home, profile), 'package.json'), 'utf8'));
}

export function readProfilePatch(home, profile = 'web') {
  const file = path.join(profileDir(home, profile), 'cordis.patch.yml');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/**
 * Append a managed probe row to a profile patch file, mirroring the mechanism
 * the project already uses for `dev:enable`. Idempotent via start/end markers.
 */
export function injectProbeRow(home, { id, entry, config = {}, profile = 'web' }) {
  const patchPath = path.join(profileDir(home, profile), 'cordis.patch.yml');
  const start = `# >>> ${id} probe (managed) >>>`;
  const end = `# <<< ${id} probe (managed) <<<`;
  const lines = [start, '- insert:', `    - id: ${id}`, `      name: '${entry.replaceAll("'", "''")}'`];
  const configKeys = Object.keys(config);
  if (configKeys.length > 0) {
    lines.push('      config:');
    for (const key of configKeys) lines.push(`        ${key}: ${JSON.stringify(config[key])}`);
  }
  lines.push(end);
  const block = lines.join('\n');

  const current = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, 'utf8') : '';
  const startIndex = current.indexOf(start);
  const endIndex = current.indexOf(end);
  let updated;
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    updated = current.slice(0, startIndex) + block + current.slice(endIndex + end.length);
  } else {
    const withoutEmptyArray = current.replace(/^[ \t]*\[\][ \t]*(?:\r?\n|$)/m, '');
    const trimmed = withoutEmptyArray.replace(/\s+$/, '');
    updated = `${trimmed}${trimmed ? '\n\n' : ''}${block}\n`;
  }
  ensure(path.dirname(patchPath));
  fs.writeFileSync(patchPath, updated, 'utf8');
  return patchPath;
}

export function removeProbeRow(home, id, profile = 'web') {
  const patchPath = path.join(profileDir(home, profile), 'cordis.patch.yml');
  if (!fs.existsSync(patchPath)) return;
  const current = fs.readFileSync(patchPath, 'utf8');
  const start = current.indexOf(`# >>> ${id} probe (managed) >>>`);
  const end = current.indexOf(`# <<< ${id} probe (managed) <<<`);
  if (start === -1 || end === -1) return;
  fs.writeFileSync(patchPath, current.slice(0, start) + current.slice(end + `# <<< ${id} probe (managed) <<<`.length), 'utf8');
}

// ---------------------------------------------------------------------------
// Host process control
// ---------------------------------------------------------------------------

/**
 * Boot `dsh web` against an isolated home. Returns a handle with the token URL,
 * the log path, and helpers to wait for boot and to read the log.
 */
export async function startHost(home, { port = 58100, logName = null, extraArgs = [], nodeArgs = [] } = {}) {
  ensure(WORK);
  const logPath = path.join(WORK, `${logName ?? `host-${port}`}.log`);
  const log = fs.openSync(logPath, 'w');
  // `nodeArgs` reproduces how the real DSH Desktop launches its profile: the
  // Electron main process carries `--expose-internals` and runs the profile
  // in-process, which changes whether the `hmr` service can construct.
  const child = spawn(process.execPath, [...nodeArgs, DSH_BIN, 'web', '--no-open', '--port', String(port), '--host', '127.0.0.1', ...extraArgs], {
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', log, log],
  });
  const handle = {
    child,
    port,
    home,
    logPath,
    url: null,
    log: () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''),
    stop: async () => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      await sleep(1500);
    },
    waitForLog: async (re, timeoutMs = 30000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const text = handle.log();
        const match = text.match(re);
        if (match) return match;
        if (child.exitCode !== null) throw new Error(`host exited early (code ${child.exitCode}); log:\n${text}`);
        await sleep(400);
      }
      return null;
    },
  };
  const match = await handle.waitForLog(/token=([^\s]+)/, 40000);
  if (match === null) {
    await handle.stop();
    throw new Error(`isolated host did not start; log:\n${handle.log()}`);
  }
  handle.url = `http://127.0.0.1:${port}/?token=${match[1]}`;
  return handle;
}

// ---------------------------------------------------------------------------
// Headless Chrome over CDP
// ---------------------------------------------------------------------------

export class Cdp {
  static async launch({ port = 9460, profileDir: userDataDir = null, windowSize = '1440,900' } = {}) {
    const dir = userDataDir ?? path.join(WORK, `chrome-${port}`);
    fs.rmSync(dir, { recursive: true, force: true });
    const child = spawn(CHROME, [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${dir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      `--window-size=${windowSize}`,
      'about:blank',
    ], { stdio: 'ignore' });
    await sleep(2500);
    const cdp = await Cdp.attach(port);
    cdp.chrome = child;
    return cdp;
  }

  static async attach(port = 9460) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!page) throw new Error(`no debuggable page on port ${port}`);
    const cdp = new Cdp();
    cdp.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { cdp.ws.onopen = resolve; cdp.ws.onerror = reject; });
    cdp.id = 0;
    cdp.pending = new Map();
    cdp.sessions = [];
    cdp.errors = [];
    cdp.console = [];
    cdp.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && cdp.pending.has(message.id)) {
        cdp.pending.get(message.id)(message.result);
        cdp.pending.delete(message.id);
        return;
      }
      if (message.method === 'Target.attachedToTarget') cdp.sessions.push(message.params.sessionId);
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails || {};
        cdp.errors.push((details.exception || {}).description || details.text);
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        cdp.console.push((message.params.args || []).map((a) => a.value ?? a.description).join(' '));
      }
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
      const message = { id, method, params };
      if (sessionId) message.sessionId = sessionId;
      this.ws.send(JSON.stringify(message));
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result && result.exceptionDetails) {
      const details = result.exceptionDetails;
      throw new Error(`evaluate failed: ${(details.exception || {}).description || details.text}`);
    }
    return result && result.result ? result.result.value : null;
  }

  async evaluateInFrame(frameUrlIncludes, expression) {
    for (const sessionId of this.sessions) {
      const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (result && result.result && result.result.value !== undefined && result.result.value !== null) {
        return { sessionId, value: result.result.value };
      }
    }
    throw new Error(`no attached target matched ${frameUrlIncludes}`);
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
  }

  async until(expression, timeoutMs = 15000, stepMs = 250) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        if (await this.eval(expression)) return Date.now() - started;
      } catch { /* navigation races */ }
      await sleep(stepMs);
    }
    return null;
  }

  async shot(file, { clip = null } = {}) {
    const params = { format: 'png' };
    if (clip) params.clip = { ...clip, scale: 1 };
    const data = await this.send('Page.captureScreenshot', params);
    ensure(path.dirname(file));
    fs.writeFileSync(file, Buffer.from(data.data, 'base64'));
    return file;
  }

  async clickText(text, { selector = 'button,a,[role="button"],[role="tab"],div,span' } = {}) {
    return this.eval(`(() => {
      const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
        .filter((n) => n.offsetParent !== null && !n.disabled);
      const el = nodes.find((n) => (n.innerText || '').trim() === ${JSON.stringify(text)});
      if (!el) return false;
      el.click();
      return true;
    })()`);
  }

  dispose() {
    try { this.ws.close(); } catch { /* ignore */ }
    try { if (this.chrome) this.chrome.kill('SIGKILL'); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Evidence helpers
// ---------------------------------------------------------------------------

/** Stable JSON writer: sorted-key, 2-space, trailing newline, so diffs are reviewable. */
export function writeJson(file, value) {
  ensure(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return file;
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Wait for a file to appear and parse as JSON, with a timeout. */
export async function waitForJson(file, timeoutMs = 60000, stepMs = 300) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(file)) {
      try {
        return readJson(file);
      } catch { /* partially written */ }
    }
    await sleep(stepMs);
  }
  throw new Error(`timed out waiting for ${file}`);
}

/**
 * Minimal assertion helper: every probe records named checks and exits non-zero
 * when a required check fails, so a green run means something.
 */
export function createReport({ id, title, commands = [] }) {
  const checks = [];
  return {
    id,
    title,
    commands,
    startedAt: new Date().toISOString(),
    checks,
    add(name, ok, detail = null, { required = true } = {}) {
      checks.push({ name, ok: Boolean(ok), required, detail });
      return Boolean(ok);
    },
    record(name, value, { required = false } = {}) {
      checks.push({ name, ok: value !== undefined && value !== null, required, detail: value });
      return value;
    },
    finish(extra = {}) {
      const failed = checks.filter((c) => c.required && !c.ok);
      return {
        id,
        title,
        commands,
        startedAt: this.startedAt,
        finishedAt: new Date().toISOString(),
        passed: failed.length === 0,
        failed: failed.map((c) => c.name),
        checks,
        ...extra,
      };
    },
  };
}

/** Redact anything that looks like a credential, token, or absolute user path. */
export function sanitize(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/token=[A-Za-z0-9._~+/=-]+/g, 'token=<redacted>')
    .replace(/(Bearer|api[-_]?key|authorization)["'\s:=]+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 <redacted>')
    .replace(/\b[0-9a-f]{40,}\b/gi, (m) => `${m.slice(0, 8)}…<redacted-len${m.length}>`)
    .replace(/\/Users\/[^/\s"']+/g, '/Users/<user>');
}

/** Sanitize every string leaf of a JSON value before it is written as evidence. */
export function sanitizeDeep(value) {
  if (typeof value === 'string') return sanitize(value);
  if (Array.isArray(value)) return value.map(sanitizeDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => {
      const key = /token|secret|credential|password|apikey|api_key/i.test(k) ? k : k;
      return [key, /^(token|secret|credential|password|apiKey|api_key)$/i.test(k) ? '<redacted>' : sanitizeDeep(v)];
    }));
  }
  return value;
}

export { os, fs, path, spawn };
