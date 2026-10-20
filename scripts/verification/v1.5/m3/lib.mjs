#!/usr/bin/env node
/**
 * V1.5 M3 verification harness — shared plumbing.
 *
 * Everything here is scoped to the M3 probes:
 *   - the DSH runtime is the build the user actually installed
 *     (`/Applications/DeepSeek Harness.app`), extracted READ-ONLY from app.asar
 *     into `/tmp/dsh-v15/m3/asar` and re-verified byte-for-byte against the app
 *     archive on every run (identity is evidence, not an assumption);
 *   - every DSH_HOME lives under `/tmp/dsh-v15/m3/` (never `~/.dsh`, never the
 *     App install directory, never a production index);
 *   - the probe Host plugin (`probe-m3-host.js`) is injected as its own
 *     `file://` row, separate from `dsh-game-market`, so any install it drives
 *     is provably performed by an operator independent of the updated bundle;
 *   - a real DSH page is driven over CDP (headless Chrome) with the m2 lab
 *     helpers (`waitForDshPage`, `pageFetchJson`), so "isolated-browser" claims
 *     are about the real Client/UI code path, not a mock;
 *   - raw JSON evidence is written under `docs/verification/v1.5/raw/m3/`,
 *     sanitised by `sanitiseM3` which KEEPS 40-hex commit SHAs (public immutable
 *     release identities this report must quote verbatim) and masks tokens,
 *     bearer credentials, 32-hex per-session IDs, and `/Users/<user>`.
 *
 * No npm dependency is added: Node >= 20 global fetch/WebSocket only.
 *
 * Importing this module must not spawn anything. Runners call the helpers and
 * are responsible for cleanup + `exit`. `lib.mjs` itself is side-effect free
 * apart from creating `/tmp/dsh-v15/m3` directories when a helper asks for it.
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The shared M0/M2 harness reads its scratch root at import time. Point it at
// the M3 sub-tree BEFORE importing so `asar/`, `home-*` and chrome profiles
// used by M3 probes can never collide with older M0/M2 scratch state.
if (!process.env.DSH_V15_WORK) process.env.DSH_V15_WORK = '/tmp/dsh-v15/m3';

const HARNESS = await import('../lib/harness.mjs');
const M2LAB = await import('../m2/lib/lab.mjs');

export const {
  ASAR: ASAR_APP,
  CHROME,
  DSH_BIN,
  ASAR_ROOT,
  WORK,
} = HARNESS;
export const { Cdp, createReport, sleep, ensure, writeJson, readJson, waitForJson } = HARNESS;
export const { closeHostProcess, hostPid, portAccepting, waitForDshPage, pageFetchJson } = M2LAB;

export const REPO_ROOT = path.resolve(HERE, '../../../..');
export const M3_ROOT = WORK; // /tmp/dsh-v15/m3
export const RUNS_ROOT = path.join(M3_ROOT, 'runs');
export const LOGS_ROOT = path.join(M3_ROOT, 'logs');
export const RAW_ROOT = path.join(REPO_ROOT, 'docs/verification/v1.5/raw/m3');
export const SHOT_DIR = path.join(RAW_ROOT, 'screenshots');
export const PROBE_PLUGIN = path.join(HERE, 'probe-m3-host.js');
export const PROBE_URL = pathToFileURL(PROBE_PLUGIN).href;

/** The frozen official discovery entry point (docs/verification/v1.5/m3-decisions.md §3). */
export const FIXED_INDEX_URL = 'https://raw.githubusercontent.com/heswy/dsh-game-market/main/platform-updates/plugins.json';
export const FIXED_INDEX_HOST = 'raw.githubusercontent.com';
export const FIXED_INDEX_PATH = '/heswy/dsh-game-market/main/platform-updates/plugins.json';

/** The DSH build this round is verified against (`/Applications/DeepSeek Harness.app`). */
export const EXPECTED_DSH_VERSION = '0.2.1-rc.2';
export const PROBE_ROW_ID = 'v15-m3-probe';
export const GAME_MARKET_ID = 'dsh-game-market';

/**
 * Network environment for probe Host processes. DSH itself is unaffected; this
 * only lets the pnpm install that `pluginManager` runs reach GitHub through the
 * local proxy this machine uses (the M0 harness proved this is required).
 * Not written to any user/App configuration; recorded in evidence for honesty.
 */
export const PROBE_NETWORK_ENV = Object.freeze({
  HTTPS_PROXY: 'http://127.0.0.1:7897',
  HTTP_PROXY: 'http://127.0.0.1:7897',
  ALL_PROXY: 'http://127.0.0.1:7897',
  npm_config_https_proxy: 'http://127.0.0.1:7897',
  npm_config_http_proxy: 'http://127.0.0.1:7897',
  npm_config_proxy: 'http://127.0.0.1:7897',
  NO_PROXY: '127.0.0.1,localhost',
});

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function log(message) {
  process.stdout.write(`[m3 ${new Date().toISOString()}] ${message}\n`);
}

export function uniqueRunTag(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** PIDs currently listening on `port` (empty array when refused / lsof absent). */
export function listenerPids(port) {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split(/\s+/).filter(Boolean).map(Number).filter((pid) => Number.isInteger(pid));
  } catch {
    return [];
  }
}

/** Ask the kernel for a currently free loopback port. */
export async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Cleanup self-proof: every listener must be gone, every recorded PID dead, no
 * temp home/config left behind. `ok` is the conjunction; runners assert it as a
 * required check so a leak makes the process exit non-zero.
 */
export async function cleanupProof({ ports = [], pids = [], dirs = [], label = 'cleanup' } = {}) {
  const portProofs = [];
  for (const port of ports) {
    const accepting = await portAccepting(port);
    portProofs.push({ port, accepting, listenerPids: listenerPids(port) });
  }
  const pidProofs = pids.filter((pid) => Number.isInteger(pid)).map((pid) => ({ pid, alive: pidAlive(pid) }));
  const dirProofs = dirs.map((dir) => ({ dir, exists: fs.existsSync(dir) }));
  const ok = portProofs.every((item) => item.accepting === false && item.listenerPids.length === 0)
    && pidProofs.every((item) => item.alive === false)
    && dirProofs.every((item) => item.exists === false);
  return { label, ok, checkedAt: new Date().toISOString(), ports: portProofs, pids: pidProofs, dirs: dirProofs };
}

// ---------------------------------------------------------------------------
// DSH runtime: extracted read-only and re-verified against the installed app
// ---------------------------------------------------------------------------

let appAsarCache = null;

function appAsar() {
  if (appAsarCache) return appAsarCache;
  if (!fs.existsSync(ASAR_APP)) throw new Error(`installed DSH app.asar not found: ${ASAR_APP}`);
  const archive = fs.readFileSync(ASAR_APP);
  const headerSize = archive.readUInt32LE(4);
  const jsonLen = archive.readUInt32LE(12);
  const header = JSON.parse(archive.subarray(16, 16 + jsonLen).toString('utf8'));
  appAsarCache = { archive, header, base: 8 + headerSize, size: archive.length, sha256: sha256(archive) };
  return appAsarCache;
}

function appAsarHeaderNode(archiveHeader, rel) {
  let node = null;
  let current = { files: archiveHeader.files };
  for (const part of rel.split('/')) {
    current = current?.files?.[part];
    if (!current) return null;
  }
  node = current;
  return node;
}

/** Read one file straight out of the installed app.asar (never writes it). */
export function readFromAppAsar(rel) {
  const asar = appAsar();
  const node = appAsarHeaderNode(asar.header, rel);
  if (!node) return null;
  if (node.link) return null;
  if (node.unpacked) {
    const unpacked = `${ASAR_APP}.unpacked/${rel}`;
    return fs.existsSync(unpacked) ? fs.readFileSync(unpacked) : null;
  }
  const start = asar.base + Number(node.offset);
  return asar.archive.subarray(start, start + Number(node.size));
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Extract the runtime once (read-only source) and prove the extracted copy is
 * byte-identical to the installed app for a set of identity-critical files.
 * Evidence records package versions, the app.asar sha256/size, extracted file
 * sha256s and the per-file match booleans — a stale or tampered extraction can
 * never silently pass as "the user's DSH".
 */
export function verifyRuntime() {
  HARNESS.ensureRuntime();
  // Identity-critical files only: these exist in the installed app.asar and are
  // the exact bytes the extracted runtime executes. (The desktop app keeps its
  // Electron `lib/` outside this archive prefix; it is not part of DSH itself.)
  const identityFiles = [
    'package.json',
    'dsh/package.json',
    'dsh/desktop-runtime.json',
    'dsh/node_modules/@deepseek-ai/dsh/package.json',
    'dsh/node_modules/@deepseek-ai/dsh-plugin-manager/package.json',
    'dsh/node_modules/@deepseek-ai/dsh/lib/bin.js',
  ];
  const files = identityFiles.map((rel) => {
    const extracted = path.join(ASAR_ROOT, rel);
    const extractedBytes = fs.existsSync(extracted) ? fs.readFileSync(extracted) : null;
    const appBytes = readFromAppAsar(rel);
    return {
      rel,
      extracted: extractedBytes !== null,
      extractedSha256: extractedBytes === null ? null : sha256(extractedBytes),
      appSha256: appBytes === null ? null : sha256(appBytes),
      matchesApp: extractedBytes !== null && appBytes !== null && sha256(extractedBytes) === sha256(appBytes),
      bytes: extractedBytes === null ? null : extractedBytes.length,
    };
  });
  const asar = appAsar();
  const desktopApp = fs.existsSync(path.join(ASAR_ROOT, 'package.json')) ? readJsonFile(path.join(ASAR_ROOT, 'package.json')) : null;
  const desktopRuntime = fs.existsSync(path.join(ASAR_ROOT, 'dsh/package.json')) ? readJsonFile(path.join(ASAR_ROOT, 'dsh/package.json')) : null;
  const dsh = readJsonFile(path.join(ASAR_ROOT, 'dsh/node_modules/@deepseek-ai/dsh/package.json'));
  const pluginManager = readJsonFile(path.join(ASAR_ROOT, 'dsh/node_modules/@deepseek-ai/dsh-plugin-manager/package.json'));
  const versions = {
    electronApp: desktopApp === null ? null : { name: desktopApp.name, version: desktopApp.version },
    desktopRuntime: desktopRuntime === null ? null : { name: desktopRuntime.name, version: desktopRuntime.version },
    dsh: { name: dsh.name, version: dsh.version },
    pluginManager: { name: pluginManager.name, version: pluginManager.version },
  };
  const expected = Object.fromEntries(Object.entries(versions).map(([key, value]) => [key, value === null ? null : value.version === EXPECTED_DSH_VERSION]));
  const missing = files.filter((file) => file.extracted === false).map((file) => file.rel);
  const mismatched = files.filter((file) => file.extracted && file.matchesApp === false).map((file) => file.rel);
  return {
    checkedAt: new Date().toISOString(),
    evidenceLevel: 'installed-runtime (read-only extraction)',
    installedApp: {
      asarPath: ASAR_APP,
      asarSha256: asar.sha256,
      asarBytes: asar.size,
      appModifiedAt: fs.statSync(ASAR_APP).mtime.toISOString(),
    },
    extractedRoot: ASAR_ROOT,
    dshBin: DSH_BIN,
    expectedVersion: EXPECTED_DSH_VERSION,
    versions,
    versionsMatchExpected: expected,
    identityFiles: files,
    missing,
    mismatched,
    extractionVerifiedAgainstInstalledApp: missing.length === 0 && mismatched.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Isolated DSH homes + Host process control
// ---------------------------------------------------------------------------

/** Create an isolated DSH_HOME under the M3 scratch root (asserts the location). */
export async function makeIsolatedHome(name, { port = 58100 } = {}) {
  const home = await HARNESS.makeHome(name, { port });
  const resolved = path.resolve(home);
  if (!resolved.startsWith(`${path.resolve(M3_ROOT)}${path.sep}`)) {
    throw new Error(`refusing non-M3 DSH_HOME: ${resolved}`);
  }
  if (resolved.includes('/.dsh')) throw new Error(`refusing daily DSH_HOME: ${resolved}`);
  return resolved;
}

export function removeHome(home) {
  if (!home) return false;
  if (!path.resolve(home).startsWith(`${path.resolve(M3_ROOT)}${path.sep}`)) {
    throw new Error(`refusing to remove non-M3 home: ${home}`);
  }
  fs.rmSync(home, { recursive: true, force: true });
  return true;
}

/** Inject the M3 probe Host plugin row (independent of the bundle under test). */
export function injectProbeRow(home, { runDir, bootTag, fixedIndexUrl = FIXED_INDEX_URL, profile = 'web' }) {
  return HARNESS.injectProbeRow(home, {
    id: PROBE_ROW_ID,
    entry: PROBE_URL,
    config: { outDir: runDir, bootTag, fixedIndexUrl },
    profile,
  });
}

/** Inject a dev row that boots this worktree's Host plugin (M2 lab pattern). */
export function injectDevGameMarketRow(home, { pluginRoot = REPO_ROOT, profile = 'web' } = {}) {
  return HARNESS.injectProbeRow(home, {
    id: GAME_MARKET_ID,
    entry: path.join(pluginRoot, 'index.js'),
    config: { devMode: true },
    profile,
  });
}

/**
 * Boot `dsh web` against an isolated home. `--expose-internals` reproduces the
 * real Desktop launcher's loader flags (M0 finding: it does not change the HMR
 * capability; it is kept so the boot shape matches the App).
 */
export async function startHostNode(home, { port, logName, env = {}, nodeArgs = ['--expose-internals'], label = null } = {}) {
  ensureDir(LOGS_ROOT);
  const logPath = path.join(LOGS_ROOT, `${logName ?? `host-${port}`}.log`);
  const logFd = fs.openSync(logPath, 'w');
  const child = spawn(
    process.execPath,
    [...nodeArgs, DSH_BIN, 'web', '--no-open', '--port', String(port), '--host', '127.0.0.1'],
    { env: { ...process.env, DSH_HOME: home, ...env }, stdio: ['ignore', logFd, logFd] },
  );
  const handle = {
    child,
    home,
    port,
    logPath,
    label,
    url: null,
    pid: child.pid,
    startedAt: new Date().toISOString(),
    log: () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''),
    stop: async () => closeHostProcess(handle),
    waitForLog: async (re, timeoutMs = 45000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const text = handle.log();
        const match = text.match(re);
        if (match) return match;
        if (child.exitCode !== null) throw new Error(`host exited early (code ${child.exitCode}); log:\n${text}`);
        await sleep(300);
      }
      return null;
    },
  };
  const match = await handle.waitForLog(/token=([^\s]+)/, 60000);
  if (match === null) {
    await handle.stop().catch(() => {});
    throw new Error(`isolated host did not start; log:\n${handle.log()}`);
  }
  handle.token = match[1];
  handle.url = `http://127.0.0.1:${port}/?token=${match[1]}`;
  handle.origin = `http://127.0.0.1:${port}`;
  return handle;
}

/** Evidence-safe view of the environment a probe Host was launched with. */
export function hostEnvEvidence(env) {
  const merged = { ...env };
  const entries = Object.entries(merged).map(([key, value]) => ({
    key,
    value: /token|secret|password|key/i.test(key) ? '<redacted>' : String(value),
  }));
  return { keys: Object.keys(merged).sort(), entries };
}

// ---------------------------------------------------------------------------
// File-inbox probe client (same shape as the M0 probe harness)
// ---------------------------------------------------------------------------

export class Probe {
  constructor(bootTag, { runDir, home, port }) {
    this.bootTag = bootTag;
    this.runDir = runDir;
    this.home = home;
    this.port = port;
    this.commands = [];
    ensureDir(runDir);
  }

  get bootFile() {
    return path.join(this.runDir, 'boot.json');
  }

  get readyFile() {
    return path.join(this.runDir, 'ready.json');
  }

  async waitReady(timeoutMs = 150000) {
    const ready = await waitForJson(this.readyFile, timeoutMs);
    if (ready.bootTag !== this.bootTag) throw new Error(`ready.json belongs to ${ready.bootTag}, expected ${this.bootTag}`);
    this.boot = await waitForJson(this.bootFile, 30000);
    return { ready, boot: this.boot };
  }

  writeInbox() {
    writeJson(path.join(this.runDir, 'inbox.json'), { commands: this.commands });
  }

  async send(command, { timeoutMs = 300000 } = {}) {
    if (typeof command.id !== 'string' || command.id.length === 0) throw new Error('probe command needs an id');
    if (this.commands.some((item) => item.id === command.id)) throw new Error(`duplicate probe command id ${command.id}`);
    this.commands.push(command);
    this.writeInbox();
    const file = path.join(this.runDir, 'results', `${command.id}.json`);
    const result = await waitForJson(file, timeoutMs);
    return result;
  }

  resultText(id) {
    const file = path.join(this.runDir, 'results', `${id}.json`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  }
}

/**
 * Boot an isolated Host with the M3 probe row (and optionally a dev row for
 * this worktree's Host plugin). Returns everything a runner must clean up.
 */
export async function bootProbeHost({
  name,
  home: providedHome = null,
  runDir,
  bootTag,
  port,
  env = {},
  pluginMode = 'none', // 'none' | 'dev-row'
  profile = 'web',
  logName = null,
  fixedIndexUrl = FIXED_INDEX_URL,
} = {}) {
  const home = providedHome ?? await makeIsolatedHome(name);
  injectProbeRow(home, { runDir, bootTag, fixedIndexUrl, profile });
  if (pluginMode === 'dev-row') injectDevGameMarketRow(home, { profile });
  const host = await startHostNode(home, { port, logName: logName ?? name, env });
  const probe = new Probe(bootTag, { runDir, home, port });
  const ready = await probe.waitReady();
  return { home, host, probe, boot: ready.boot, ready: ready.ready };
}

// ---------------------------------------------------------------------------
// Evidence: sanitise (KEEP 40-hex commit SHAs), write, summarise
// ---------------------------------------------------------------------------

const HEX32_STANDALONE = /(?<![0-9a-f])[0-9a-f]{32}(?![0-9a-f])/g;

/** Redact credentials/paths but keep 40-hex commit SHAs and semver identities. */
export function redactString(text) {
  return String(text)
    .replace(/token=[A-Za-z0-9._~+/=-]+/gi, 'token=<redacted>')
    .replace(/(Bearer|authorization)(["'\s:=]+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1$2<redacted>')
    .replace(/([?&])(nonce|launch|instance|token)=[^&\s"']+/g, '$1$2=<redacted>')
    .replace(/\/Users\/[^/\s"']+/g, '/Users/<user>')
    .replace(HEX32_STANDALONE, '<credential-32hex>');
}

const SECRET_KEY = /^(token|secret|credential|password|apikey|api_key|authorization|cookie)$/i;

export function sanitiseM3(value) {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(sanitiseM3);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? '<redacted>' : sanitiseM3(item),
    ]));
  }
  return value;
}

/** Write sanitised evidence under docs/verification/v1.5/raw/m3 (bounded JSON). */
export function writeEvidence(relPath, value) {
  const file = path.join(RAW_ROOT, relPath);
  writeJson(file, sanitiseM3(value));
  return file;
}

/** Write an unsanitised scratch copy under /tmp/dsh-v15/m3 (never committed). */
export function writeScratch(runDir, relPath, value) {
  const file = path.join(runDir, relPath);
  writeJson(file, value);
  return file;
}

/**
 * Collect all required-check state, write the evidence file + a scratch copy,
 * print a machine-readable tail, and return the exit code. The runner still
 * owns cleanup; call this AFTER cleanup proof so the last required check is
 * honest.
 */
export function finalizeRun({ report, evidenceRel, runDir, extra = {} }) {
  const summary = report.finish(extra);
  const failedRequired = summary.checks.filter((check) => check.required && !check.ok);
  const pay = { ...summary, failedRequired: failedRequired.map((check) => check.name) };
  const evidenceFile = writeEvidence(evidenceRel, pay);
  if (runDir) writeScratch(runDir, 'summary.raw.json', pay);
  log(`checks=${summary.checks.length} required=${summary.checks.filter((c) => c.required).length} passed=${summary.checks.filter((c) => c.ok).length} failedRequired=${pay.failedRequired.length}`);
  log(`evidence=${evidenceFile}`);
  log(pay.passed ? 'PASSED' : 'FAILED');
  process.exitCode = pay.passed ? 0 : 1;
  return { summary: pay, evidenceFile };
}

/**
 * Run `fn` then always run `cleanup`. Any thrown error is recorded as a failed
 * required check, never swallowed: a crashed probe must exit non-zero and the
 * cleanup proof must still be produced and written.
 */
export async function runWithCleanup({ report, runDir, cleanup, body }) {
  let thrown = null;
  try {
    await body();
  } catch (error) {
    thrown = error;
    const message = error && error.stack ? error.stack : String(error);
    report.add('probe-completed-without-throw', false, message);
  }
  let cleanupResult = null;
  try {
    cleanupResult = await cleanup();
  } catch (error) {
    report.add('cleanup-completed-without-throw', false, error && error.stack ? error.stack : String(error));
  }
  return { thrown, cleanupResult };
}

export { spawn, fs, path, pathToFileURL, fileURLToPath, execFileSync, crypto, net };
