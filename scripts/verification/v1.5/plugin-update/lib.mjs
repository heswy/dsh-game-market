/**
 * Shared plumbing for the V1.5 M0 plugin-update probes (S-U1/S-U2/S-U3).
 *
 * Every Host runs with an isolated DSH_HOME under /tmp/dsh-v15 (harness.mjs);
 * the user's ~/.dsh and the installed .app are never written. This module only
 * adds what the shared harness does not provide: a Host launcher that can pass
 * Node flags the real Desktop launcher uses (`--expose-internals`), the profile
 * patch writers this probe needs, and a file-inbox client for the probe plugin.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  DSH_BIN,
  WORK,
  ensure,
  sleep,
  waitForJson,
  writeJson,
} from '../lib/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

export const PATHS = {
  repoRoot,
  probeDir: here,
  probePlugin: path.join(here, 'probe-plugin-host.js'),
  probeUrl: new URL(`file://${here}/probe-plugin-host.js`).href,
  work: WORK,
  outRoot: path.join(WORK, 'plugin-update'),
  rawRoot: path.join(repoRoot, 'docs/verification/v1.5/raw/plugin-update'),
  fixtures: path.join(here, 'fixtures'),
  repoIndex: path.join(repoRoot, 'index.js'),
};

/** Stable remote targets: the two exact release commits of the platform repo. */
export const TARGETS = {
  gitUrl: 'https://github.com/heswy/dsh-game-market.git',
  runA: 'dsh-game-market-a',
  runB: 'dsh-game-market-b',
  shaA: 'c106ac101e064a72f408c58b2516aad5118f513f', // v1.1.0
  shaB: 'f422e8d04b3b3de3f920a794317c0d28ee1246a2', // v1.2.0
  versionA: '1.1.0',
  versionB: '1.2.0',
  specHttps(sha) {
    return `${this.gitUrl}#${sha}`;
  },
  /** pnpm records a hosted git dependency in this form (verified empirically). */
  specRecorded(sha) {
    return `github:heswy/dsh-game-market#${sha}`;
  },
};

/**
 * Network environment for the probe Host. DSH itself is unaffected; this only
 * lets the package manager its pluginManager runs reach GitHub through the
 * same local proxy this machine already uses for git (the probe runner does not
 * modify any user or App configuration). Recorded in evidence for honesty.
 */
export const PROBE_NETWORK_ENV = {
  HTTPS_PROXY: 'http://127.0.0.1:7897',
  HTTP_PROXY: 'http://127.0.0.1:7897',
  ALL_PROXY: 'http://127.0.0.1:7897',
  npm_config_https_proxy: 'http://127.0.0.1:7897',
  npm_config_http_proxy: 'http://127.0.0.1:7897',
  npm_config_proxy: 'http://127.0.0.1:7897',
  NO_PROXY: '127.0.0.1,localhost',
};

/**
 * Boot `dsh web` against an isolated home. Mirrors harness.startHost but lets
 * the caller pass Node flags before the DSH entry (the Desktop launcher runs
 * with --expose-internals, so a dev-mode absolute-path row needs that loader).
 */
export async function startHostNode(home, { port = 58300, logName = null, nodeArgs = [], label = null, env = {} } = {}) {
  ensure(WORK);
  const logPath = path.join(WORK, `${logName ?? `host-${port}`}.log`);
  const log = fs.openSync(logPath, 'w');
  const child = spawn(
    process.execPath,
    [...nodeArgs, DSH_BIN, 'web', '--no-open', '--port', String(port), '--host', '127.0.0.1'],
    { env: { ...process.env, DSH_HOME: home, ...env }, stdio: ['ignore', log, log] },
  );
  const handle = {
    child,
    port,
    home,
    logPath,
    label,
    nodeArgs,
    url: null,
    log: () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''),
    stop: async () => {
      try {
        child.kill('SIGKILL');
      } catch { /* already gone */ }
      await sleep(1200);
    },
    waitForLog: async (re, timeoutMs = 40000) => {
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
  const match = await handle.waitForLog(/token=([^\s]+)/, 45000);
  if (match === null) {
    await handle.stop();
    throw new Error(`isolated host did not start; log:\n${handle.log()}`);
  }
  handle.url = `http://127.0.0.1:${port}/?token=${match[1]}`;
  return handle;
}

function patchPath(home, profile = 'web') {
  return path.join(home, 'profiles', profile, 'cordis.patch.yml');
}

/** Prepend a raw loader patch list (e.g. the `- id: hmr / disabled: true` override). */
export function writeProfilePatchLines(home, lines, profile = 'web') {
  const file = patchPath(home, profile);
  ensure(path.dirname(file));
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  return file;
}

/** Append a patch-list entry to the profile user layer while keeping `[]` valid. */
export function appendPatchLines(home, lines, profile = 'web') {
  const file = patchPath(home, profile);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const withoutEmptyArray = current.replace(/^[ \t]*\[\][ \t]*(?:\r?\n|$)/m, '');
  const trimmed = withoutEmptyArray.replace(/\s+$/, '');
  fs.writeFileSync(file, `${trimmed}${trimmed ? '\n\n' : ''}${lines.join('\n')}\n`, 'utf8');
  return file;
}

/** The managed dev row the project's own `scripts/dev-enable.mjs` writes. */
export function appendDevRow(home, { hostEntry = PATHS.repoIndex, config = { devMode: true }, profile = 'web' } = {}) {
  const lines = [
    '# >>> dsh-game-market dev (managed) >>>',
    '- insert:',
    '    - id: dsh-game-market',
    `      name: '${hostEntry.replaceAll("'", "''")}'`,
  ];
  if (Object.keys(config).length > 0) {
    lines.push('      config:');
    for (const [key, value] of Object.entries(config)) lines.push(`        ${key}: ${JSON.stringify(value)}`);
  }
  lines.push('# <<< dsh-game-market dev (managed) <<<');
  return appendPatchLines(home, lines, profile);
}

/** Write the profile patch that disables the shipped hmr row (a real non-HMR profile). */
export function writeNoHmrPatch(home, profile = 'web') {
  return writeProfilePatchLines(home, [
    '# Isolated non-HMR probe profile: disable the hmr row dsh-base inserts.',
    '# Declared vs actual is verified with `dsh web --dump-config` in the run log.',
    '- id: hmr',
    '  disabled: true',
  ], profile);
}

/**
 * File-inbox client for the probe plugin. One inbox per Host boot (per outDir);
 * command ids must be unique and filesystem-safe.
 */
export class Probe {
  constructor(bootTag, { outDir, home, port }) {
    this.bootTag = bootTag;
    this.outDir = outDir;
    this.home = home;
    this.port = port;
    ensure(outDir);
    this.commands = [];
  }

  get bootFile() {
    return path.join(this.outDir, 'boot.json');
  }

  get readyFile() {
    return path.join(this.outDir, 'ready.json');
  }

  async waitReady(timeoutMs = 120000) {
    const ready = await waitForJson(this.readyFile, timeoutMs);
    if (ready.bootTag !== this.bootTag) throw new Error(`ready.json belongs to ${ready.bootTag}, expected ${this.bootTag}`);
    this.boot = await waitForJson(this.bootFile, 30000);
    return { ready, boot: this.boot };
  }

  writeInbox() {
    writeJson(path.join(this.outDir, 'inbox.json'), { commands: this.commands });
  }

  async send(command, { timeoutMs = 240000 } = {}) {
    if (typeof command.id !== 'string' || command.id.length === 0) throw new Error('probe command needs an id');
    if (this.commands.some((item) => item.id === command.id)) throw new Error(`duplicate probe command id ${command.id}`);
    this.commands.push(command);
    this.writeInbox();
    const file = path.join(this.outDir, 'results', `${command.id}.json`);
    const result = await waitForJson(file, timeoutMs);
    if (result.ok !== true) throw new Error(`probe command ${command.id} failed: ${JSON.stringify(result.error)}`);
    return result;
  }
}

/** Storage fixtures: a marked root + a record shaped like the save files the Host owns. */
export function seedStorage(home, bootTag) {
  const root = path.join(home, 'storages', 'dsh-game-market');
  ensure(path.join(root, 'saves', 'snake'));
  const marker = {
    marker: 'v1.5-m0-plugin-update-storage-marker',
    bootTag,
    writtenAt: new Date().toISOString(),
    note: 'probe fixture standing in for user data outside the bundle directory',
  };
  writeJson(path.join(root, `${bootTag}-update-marker.json`), marker);
  const save = {
    schemaVersion: 1,
    gameId: 'snake',
    playSessionId: `probe-${bootTag}`,
    score: 42,
    state: { snake: [[3, 3]], direction: 'right' },
    updatedAt: new Date().toISOString(),
    marker: 'v1.5-m0-plugin-update-save-fixture',
  };
  writeJson(path.join(root, 'saves', 'snake', 'current.json'), save);
  writeJson(path.join(root, 'saves', 'snake', 'meta.json'), { gameId: 'snake', updatedAt: save.updatedAt, score: 42 });
  return { root, markerPath: path.join(root, `${bootTag}-update-marker.json`), savePath: path.join(root, 'saves', 'snake', 'current.json') };
}

/** Read back the storage fixture and report exact-byte preservation. */
export function readStorage(home, bootTag) {
  const root = path.join(home, 'storages', 'dsh-game-market');
  const result = { root, exists: fs.existsSync(root), marker: null, save: null, entries: [] };
  try {
    result.entries = fs.readdirSync(root).sort();
  } catch { /* absent */ }
  const markerPath = path.join(root, `${bootTag}-update-marker.json`);
  const savePath = path.join(root, 'saves', 'snake', 'current.json');
  try {
    result.marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    result.markerPresent = true;
  } catch {
    result.markerPresent = false;
  }
  try {
    result.save = JSON.parse(fs.readFileSync(savePath, 'utf8'));
    result.savePresent = true;
  } catch {
    result.savePresent = false;
  }
  return result;
}

/**
 * Redaction for probe evidence. Same credential/path hygiene as the shared
 * harness, but it deliberately KEEPS 40-hex commit SHAs: they are public
 * immutable release identities this report must quote verbatim, not secrets.
 */
export function sanitizeEvidence(value) {
  if (typeof value === 'string') {
    return value
      .replace(/token=[A-Za-z0-9._~+/=-]+/g, 'token=<redacted>')
      .replace(/(Bearer|api[-_]?key|authorization)["'\s:=]+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 <redacted>')
      .replace(/\/Users\/[^/\s"']+/g, '/Users/<user>');
  }
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /^(token|secret|credential|password|apiKey|api_key)$/i.test(key) ? '<redacted>' : sanitizeEvidence(item),
    ]));
  }
  return value;
}

/** Sanitised evidence writer: caller-provided value, sanitised by the caller. */
export function writeEvidence(relPath, value) {
  const file = path.join(PATHS.rawRoot, relPath);
  writeJson(file, value);
  return file;
}

export { sleep, waitForJson, writeJson, repoRoot };
