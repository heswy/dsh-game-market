#!/usr/bin/env node
/**
 * Serial, bounded M3 verification driver.
 *
 * Runs a list of scenario scripts ONE AT A TIME (never concurrently), stops at
 * the first harness failure (unless --keep-going), enforces a per-scenario
 * timeout, records a machine-readable summary, and checks that each scenario
 * proved cleanup and left no orphan processes.
 *
 * Default command (safe smoke):
 *   node scripts/verification/v1.5/m3/run-m3-serial.mjs
 * Full core list (once product candidate is frozen):
 *   node scripts/verification/v1.5/m3/run-m3-serial.mjs \
 *     --a <A2> --b <B4> --final <R_final> \
 *     --scenarios selfcheck,smoke,hop-a,hop-b,nonhmr,v2-windows,v2-save,v2-edges
 *
 * Network mode defaults to the isolated local mirror (network-independent);
 * `--mode real-github` is an explicit opt-in and is labelled in the summary.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const RAW_ROOT = path.join(REPO_ROOT, 'docs/verification/v1.5/raw/m3');
const WORK = '/tmp/dsh-v15/m3';
const LOCK = path.join(WORK, 'm3-serial.lock');

const A2_DEFAULT = '75c0041c3e73ddea83940d1d23a54f0d6d1431cf';
const B_DEFAULT = 'e4cb4694ad856b1132179f4db2385057dca7f66d';
const FINAL_DEFAULT = 'f8244cf24a418aaf796a2b64ad17e7417b65ecac';

function parseArgs(argv) {
  const args = {
    scenarios: ['selfcheck', 'smoke'],
    a: A2_DEFAULT,
    b: B_DEFAULT,
    final: FINAL_DEFAULT,
    versionA: '1.2.1',
    versionB: '1.2.2',
    versionFinal: '1.3.0',
    mode: process.env.M3_NETWORK_MODE === 'real-github' ? 'real-github' : 'mirror',
    keepGoing: false,
    timeoutMultiplier: 1,
    writeSummary: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--scenarios') args.scenarios = argv[++i].split(',').map((item) => item.trim()).filter(Boolean);
    else if (arg === '--a') args.a = argv[++i];
    else if (arg === '--b') args.b = argv[++i];
    else if (arg === '--final') args.final = argv[++i];
    else if (arg === '--version-a') args.versionA = argv[++i];
    else if (arg === '--version-b') args.versionB = argv[++i];
    else if (arg === '--version-final') args.versionFinal = argv[++i];
    else if (arg === '--mode') args.mode = argv[++i] === 'real-github' ? 'real-github' : 'mirror';
    else if (arg === '--keep-going') args.keepGoing = true;
    else if (arg === '--timeout-multiplier') args.timeoutMultiplier = Number(argv[++i]) || 1;
    else if (arg === '--no-summary') args.writeSummary = false;
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
    else throw new Error(`unknown argument ${arg}`);
  }
  return args;
}

function printHelp() {
  process.stdout.write([
    'run-m3-serial.mjs [--scenarios selfcheck,smoke,hop-a,hop-b,two-hop,nonhmr,v2-windows,v2-save,v2-edges]',
    '  --a <A2 commit> --b <B commit> --final <FINAL commit> [--version-a 1.2.1 --version-b 1.2.2 --version-final 1.3.0]',
    '  [--mode mirror|real-github] [--keep-going] [--timeout-multiplier 1] [--no-summary]',
    '',
  ].join('\n'));
}

const args = parseArgs(process.argv.slice(2));
const runTag = `serial-${Date.now().toString(36)}`;
const logDir = path.join(WORK, 'logs', `m3-${runTag}`);
fs.mkdirSync(logDir, { recursive: true });

function scenarioTable() {
  const base = ['--a', args.a, '--b', args.b, '--final', args.final];
  const node = (script) => [process.execPath, path.join(HERE, script)];
  return {
    selfcheck: { timeoutMs: 120000, command: [...node('check-runners.mjs'), '--write-evidence'], label: 'static harness self-check' },
    smoke: { timeoutMs: 420000, command: [...node('run-v1-preflight.mjs'), ...base], label: 'preflight environment gate (install A2 + real page + fixed-client refresh + cleanup)' },
    'hop-a': { timeoutMs: 600000, command: [...node('run-v1-single-hop.mjs'), ...base, '--label', 'A2-to-B'], label: 'real-UI single hop A2 -> B' },
    'hop-b': {
      timeoutMs: 600000,
      command: [...node('run-v1-single-hop.mjs'), '--a', args.b, '--b', args.final, '--final', args.final, '--version-a', args.versionB, '--version-b', args.versionFinal, '--label', 'B-to-FINAL'],
      label: 'real-UI single hop B -> FINAL',
    },
    'two-hop': { timeoutMs: 1200000, command: [...node('run-v1-two-hop.mjs'), ...base], label: 'same-profile continuous two-hop A->B->FINAL (real UI only)' },
    nonhmr: { timeoutMs: 900000, command: [...node('run-v1-nonhmr-restart.mjs'), ...base], label: 'non-HMR pending-restart -> real restart -> updated' },
    'v2-windows': { timeoutMs: 900000, command: [...node('run-v2-windows-idempotency.mjs'), ...base], label: 'multi-window idempotency' },
    'v2-save': { timeoutMs: 1200000, command: [...node('run-v2-save-coordination.mjs'), ...base], label: 'active-game save failure blocks package change' },
    'v2-edges': { timeoutMs: 1200000, command: [...node('run-v2-edges-index.mjs'), ...base], label: 'edges: at-target/ambiguous/cancel/malicious/dev-row/recovery' },
  };
}

const table = scenarioTable();
for (const name of args.scenarios) {
  if (!table[name]) throw new Error(`unknown scenario ${name}; known: ${Object.keys(table).join(', ')}`);
}

function listHarnessProcesses() {
  const result = spawnSync('ps', ['-axo', 'pid,command'], { encoding: 'utf8', timeout: 20000 });
  const pids = new Set();
  for (const line of (result.stdout || '').split('\n')) {
    if (!line.includes('/tmp/dsh-v15/m3/')) continue;
    const match = line.trim().match(/^(\d+)\s+/);
    if (match) pids.add(Number(match[1]));
  }
  return pids;
}

function evidenceFromLog(logFile) {
  try {
    const lines = fs.readFileSync(logFile, 'utf8').split('\n').reverse();
    for (const line of lines) {
      const match = line.match(/evidence=(.+)$/);
      if (match) return match[1].trim();
      const jsonMatch = line.match(/"evidence"\s*:\s*"([^"]+)"/);
      if (jsonMatch) return jsonMatch[1];
    }
  } catch { /* ignore */ }
  return null;
}

function readEvidence(evidencePath) {
  if (evidencePath === null) return null;
  try {
    const absolute = path.isAbsolute(evidencePath) ? evidencePath : path.join(REPO_ROOT, evidencePath);
    return JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch { return null; }
}

async function runScenario(name) {
  const scenario = table[name];
  const timeoutMs = Math.max(60000, Math.round(scenario.timeoutMs * args.timeoutMultiplier));
  const logFile = path.join(logDir, `${name}.log`);
  const before = listHarnessProcesses();
  const startedAt = Date.now();
  const env = {
    ...process.env,
    M3_NETWORK_MODE: args.mode,
    M3_SERIAL_RUN_TAG: runTag,
  };
  const child = spawn(scenario.command[0], scenario.command.slice(1), {
    cwd: REPO_ROOT,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = fs.createWriteStream(logFile);
  const outClosed = new Promise((resolve) => out.once('close', resolve));
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* ignore */ } }
  }, timeoutMs);
  const exit = await new Promise((resolve) => {
    let settled = false;
    const done = (value) => { if (settled) return; settled = true; resolve(value); };
    child.once('error', (error) => done({ code: null, signal: null, spawnError: String(error && error.message ? error.message : error) }));
    child.once('close', (code, signal) => done({ code, signal, spawnError: null }));
  });
  clearTimeout(timeout);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  out.end();
  await outClosed;
  const after = listHarnessProcesses();
  const orphans = [...after].filter((pid) => !before.has(pid));
  const evidencePath = evidenceFromLog(logFile);
  const evidence = readEvidence(evidencePath);
  const cleanupCheck = evidence?.checks?.find((check) => check.name === 'cleanup-proven' || check.name === 'run-cleanup-proven') ?? null;
  const cleanupOk = cleanupCheck !== null
    ? cleanupCheck.ok === true
    : name === 'selfcheck' || name === 'smoke';
  const passed = timedOut !== true && exit.code === 0 && orphans.length === 0 && cleanupOk;
  return {
    name,
    label: scenario.label,
    command: scenario.command.join(' '),
    logFile,
    timeoutMs,
    timedOut,
    exitCode: exit.code,
    signal: exit.signal,
    spawnError: exit.spawnError ?? null,
    durationMs: Date.now() - startedAt,
    evidencePath,
    evidencePassed: evidence === null ? null : evidence.passed === true,
    cleanupProven: cleanupOk,
    orphanPids: orphans,
    passed,
  };
}

let lockFd = null;
for (let attempt = 0; attempt < 2 && lockFd === null; attempt += 1) {
  try {
    lockFd = fs.openSync(LOCK, 'wx');
    fs.writeSync(lockFd, `${runTag} ${process.pid}\n`);
  } catch (error) {
    if (error.code === 'EEXIST' && attempt === 0) {
      // Stale-lock recovery: only remove if the recorded PID is gone.
      let stale = true;
      try {
        const holder = fs.readFileSync(LOCK, 'utf8').trim().split(/\s+/).pop();
        const holderPid = Number(holder);
        if (Number.isInteger(holderPid) && holderPid > 0) {
          try { process.kill(holderPid, 0); stale = false; } catch (_error) { stale = true; }
        }
      } catch { stale = true; }
      if (stale === true) { try { fs.unlinkSync(LOCK); } catch { /* ignore */ } continue; }
    }
    process.stdout.write(`${JSON.stringify({ id: 'M3-serial', passed: false, error: `another serial run holds ${LOCK}: ${error.code}` })}\n`);
    process.exit(2);
  }
}

const results = [];
const driverStartedAt = Date.now();
try {
  for (const name of args.scenarios) {
    process.stdout.write(`\n=== M3-SERIAL scenario ${name} (${table[name].label}) ===\n`);
    const result = await runScenario(name);
    results.push(result);
    process.stdout.write(`=== M3-SERIAL scenario ${name}: ${result.passed ? 'PASS' : 'FAIL'} exit=${result.exitCode} timeout=${result.timedOut} orphans=${result.orphanPids.length} evidence=${result.evidencePath ?? 'none'} ===\n`);
    if (result.passed !== true && args.keepGoing !== true) break;
  }
} finally {
  if (lockFd !== null) {
    try { fs.closeSync(lockFd); } catch { /* ignore */ }
    try { fs.unlinkSync(LOCK); } catch { /* ignore */ }
  }
}

const failedAt = results.find((result) => result.passed !== true) ?? null;
const summary = {
  id: 'M3-serial-summary',
  startedAt: new Date(driverStartedAt).toISOString(),
  runTag,
  mode: args.mode,
  modeLabel: args.mode === 'mirror'
    ? 'isolated local git mirror + pre-warmed pnpm offline store (network-independent)'
    : 'real GitHub transport (network-dependent; explicitly opted in)',
  candidates: { a: args.a, b: args.b, final: args.final, versionA: args.versionA, versionB: args.versionB, versionFinal: args.versionFinal },
  scenarios: results,
  failedAt: failedAt === null ? null : failedAt.name,
  passed: failedAt === null && results.length === args.scenarios.length,
  logDir,
};
if (args.writeSummary) {
  fs.mkdirSync(RAW_ROOT, { recursive: true });
  const file = path.join(RAW_ROOT, `M3-serial-summary-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
  summary.evidence = path.relative(REPO_ROOT, file);
}
process.stdout.write(`\n${JSON.stringify({ id: summary.id, passed: summary.passed, mode: summary.mode, scenarios: results.map((result) => ({ name: result.name, passed: result.passed, exitCode: result.exitCode, timedOut: result.timedOut, evidencePath: result.evidencePath })), failedAt: summary.failedAt, evidence: summary.evidence ?? null })}\n`);
process.exitCode = summary.passed === true ? 0 : 1;
