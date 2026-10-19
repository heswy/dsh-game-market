#!/usr/bin/env node
/**
 * Shared helpers for the V1.5 M0 S-Q1/S-Q2 question probes.
 *
 * Everything runs against the DSH build the user actually has installed, in an
 * isolated DSH_HOME under `/tmp/dsh-v15/`. The daily `~/.dsh` profile and the
 * installed App are never written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Cdp,
  WORK,
  injectProbeRow,
  makeHome,
  readProfilePatch,
  startHost,
  writeJson,
  readJson,
  waitForJson,
  sleep,
} from '../../lib/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Real worktree root (harness.repoRoot keeps `%20` in this workspace path). */
export const REPO_ROOT = path.resolve(HERE, '../../../../..');
export const BUNDLE = path.join(REPO_ROOT, 'scripts/verification/v1.5/questions/probe-bundle');
export const BUNDLE_INDEX = path.join(BUNDLE, 'index.js');
export const RAW_DIR = path.join(REPO_ROOT, 'docs/verification/v1.5/raw/questions');
/** Scratch root; all probe-owned mutable state lives here. */
export const SCRATCH = path.join(WORK, 'questions');

export const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Remove and recreate a directory. */
export function freshDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Append raw patch entries to a profile's `cordis.patch.yml`, stripping the flow-style `[]`. */
export function appendPatch(home, block, profile = 'web') {
  const file = path.join(home, 'profiles', profile, 'cordis.patch.yml');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const withoutEmptyArray = current.replace(/^[ \t]*\[\][ \t]*(?:\r?\n|$)/m, '');
  const trimmed = withoutEmptyArray.replace(/\s+$/, '');
  fs.writeFileSync(file, `${trimmed}${trimmed ? '\n\n' : ''}${block.replace(/\s+$/, '')}\n`, 'utf8');
  return file;
}

/**
 * Build one isolated home: profile materialized, probe bundle row inserted, and
 * the deployment default model pointed at the scripted local provider.
 * @param name - unique home/phase name under `/tmp/dsh-v15/home-<name>`.
 * @param options - `port` for the one boot `makeHome` needs; `dir` command-bus directory.
 */
export async function prepareHome(name, { port, dir, extraRows = '' } = {}) {
  const home = await makeHome(name, { port });
  freshDir(dir);
  injectProbeRow(home, { id: 'dsh-qprobe', entry: BUNDLE_INDEX, config: { dir } });
  appendPatch(
    home,
    [
      '# S-Q1/S-Q2 probe: route the deployment default model to the scripted local adapter',
      '# registered by the probe bundle above. This replaces no product behavior: the',
      '# isolated profile only needs a deterministic model to drive a real Agent turn.',
      '- id: agent-default-model',
      '  config:',
      '    provider: qprobe',
      '    model: qprobe-script',
      ...(extraRows === '' ? [] : ['', extraRows]),
    ].join('\n'),
  );
  return home;
}

/** Profile patch as it was actually applied, for the evidence trail. */
export function readAppliedPatch(home) {
  return readProfilePatch(home);
}

/** Boot the isolated host on `port` and return its handle (URL carries the token). */
export async function bootHost(home, { port, logName }) {
  const host = await startHost(home, { port, logName });
  return host;
}

/** Launch headless Chrome and open the DSH page; waits until the probe Client module runs. */
export async function openProbePage(host, { cdpPort, windowSize = '1440,900', readyExpr = null } = {}) {
  const page = await Cdp.launch({ port: cdpPort, windowSize });
  const loaded = { page, readyMs: null, bootstrapped: false };
  try {
    await page.navigate(host.url);
    const expression = readyExpr ?? 'Boolean(window.__QPROBE__)';
    loaded.readyMs = await page.until(expression, 90000, 400);
    loaded.bootstrapped = loaded.readyMs !== null;
    return loaded;
  } catch (error) {
    try {
      page.dispose();
    } catch {
      /* ignore */
    }
    throw error;
  }
}

/**
 * File-based command bus for the Host half of the probe bundle.
 * Writes `commands/<seq>-<name>.json` and reads `results/<same name>`.
 */
export class HostBridge {
  constructor(dir) {
    this.dir = dir;
    this.commandsDir = path.join(dir, 'commands');
    this.resultsDir = path.join(dir, 'results');
    freshDir(this.commandsDir);
    freshDir(this.resultsDir);
    this.seq = 0;
  }

  resultPath(name) {
    return path.join(this.resultsDir, name);
  }

  /** Run one synchronous command and return its result object. */
  async command(payload, { timeoutMs = 30000, label = null } = {}) {
    this.seq += 1;
    const name = `${String(this.seq).padStart(4, '0')}-${label ?? String(payload.cmd).replace(/[^a-z0-9-]/gi, '-')}.json`;
    writeJson(path.join(this.commandsDir, name), payload);
    const result = await waitForJson(this.resultPath(name), timeoutMs);
    return { name, result };
  }

  /** Start a fire-and-forget command; the result file is overwritten when it settles. */
  start(payload, { label = null } = {}) {
    this.seq += 1;
    const name = `${String(this.seq).padStart(4, '0')}-${label ?? String(payload.cmd).replace(/[^a-z0-9-]/gi, '-')}.json`;
    writeJson(path.join(this.commandsDir, name), { ...payload, async: true });
    return { name, resultPath: this.resultPath(name) };
  }

  /** Wait for a started command's final result (the placeholder has `started: true`). */
  async settle(name, { timeoutMs = 60000 } = {}) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const file = this.resultPath(name);
      if (fs.existsSync(file)) {
        try {
          const value = readJson(file);
          if (value && value.started !== true) return value;
        } catch {
          /* partially written */
        }
      }
      await sleepMs(100);
    }
    throw new Error(`timed out waiting for async command result ${name}`);
  }

  /** Latest heartbeat written by the probe Host plugin. */
  hostState() {
    try {
      return readJson(path.join(this.dir, 'host-state.json'));
    } catch {
      return null;
    }
  }

  /** Set the scripted model scenario (mode: text | open | timed | multi). */
  async setScenario(scenario) {
    return this.command({ cmd: 'set-scenario', scenario });
  }

  /** Read the filtered durable Session event list. */
  async events(sessionId) {
    const { result } = await this.command({ cmd: 'events', sessionId });
    if (!result.ok) throw new Error(`events command failed: ${JSON.stringify(result.error)}`);
    return result.result.events;
  }

  /** Read the `userQuestions` Session projection view (active/settled rows). */
  async projection(sessionId) {
    const { result } = await this.command({ cmd: 'projection', sessionId });
    if (!result.ok) throw new Error(`projection command failed: ${JSON.stringify(result.error)}`);
    return result.result.projection;
  }

  /** Wait until the owning Agent is idle again. */
  async waitIdle(agentId, timeoutMs = 60000) {
    const { result } = await this.command({ cmd: 'wait-idle', agentId, timeoutMs }, { timeoutMs: timeoutMs + 5000 });
    if (!result.ok) throw new Error(`wait-idle command failed: ${JSON.stringify(result.error)}`);
    return result.result;
  }

  async status() {
    const { result } = await this.command({ cmd: 'status' });
    if (!result.ok) throw new Error(`status command failed: ${JSON.stringify(result.error)}`);
    return result.result;
  }
}

/** Wait until one browser-side predicate over `__QPROBE__` is truthy. */
export async function untilProbe(page, expression, timeoutMs = 30000, stepMs = 200) {
  return page.until(`Boolean(window.__QPROBE__ && (${expression}))`, timeoutMs, stepMs);
}

/** Extract the parts of a Session event list the probes assert on. */
export function eventSummary(events) {
  return events.map((event) => {
    if (event.type === 'tool/call') return { seq: event.seq, type: event.type, callId: event.callId, name: event.name, timeout: event.arguments?.timeout };
    if (event.type === 'tool/result') return { seq: event.seq, type: event.type, callId: event.callId, pending: event.result?.pending, answers: event.result?.answers };
    if (event.type === 'user/message') return { seq: event.seq, type: event.type, source: event.source, reply: event.reply };
    if (event.type === 'turn/start' || event.type === 'turn/end') return { seq: event.seq, type: event.type, turn: event.turn };
    if (event.type === 'request/header') return { seq: event.seq, type: event.type, config: event.config };
    return { seq: event.seq, type: event.type };
  });
}

/** Find the ask_user_question tool call recorded in a Session. */
export function findAskCall(events) {
  return events.find((event) => event.type === 'tool/call' && event.name === 'ask_user_question');
}

/** Find the ask_user_question tool result recorded in a Session. */
export function findAskResult(events, callId) {
  return events.find((event) => event.type === 'tool/result' && event.callId === callId);
}

/** Count turn starts; a continued answer is a *new* turn. */
export function turnStarts(events) {
  return events.filter((event) => event.type === 'turn/start').map((event) => event.turn);
}

/** Write one raw evidence file (sorted keys, trailing newline) under the questions raw dir. */
export function writeRaw(name, value) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  return writeJson(path.join(RAW_DIR, name), value);
}

export { sleep };
