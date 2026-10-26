#!/usr/bin/env node
/**
 * Independently re-run the H1 host/shared test suites and capture per-case results.
 *
 * Lead reported `tests/v1.5-platform-update.test.js` 13/13 and
 * `packages/host/test/index.js` 245/245. This runner does NOT trust the report:
 * it executes both commands itself in this worktree, records exit codes and the
 * per-test pass/fail lines, and writes sanitised evidence under
 * `docs/verification/v1.5/raw/m3/`.
 *
 * Exit 0 iff both commands exited 0 and the parsed summary has zero failures.
 *
 * Two modes:
 *   --ref <40hex>   authoritative: extract that COMMITTED tree with `git archive`
 *                   into /tmp and run the suites there (immune to teammates'
 *                   uncommitted in-flight edits in the shared worktree);
 *   (default)       snapshot the CURRENT worktree (may include uncommitted H2
 *                   work; recorded honestly as "current-worktree snapshot").
 *
 * Usage: node scripts/verification/v1.5/m3/run-h1-tests-evidence.mjs [--ref <sha>] [--write-evidence]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { RAW_ROOT, REPO_ROOT, createReport, ensureDir, finalizeRun, log, uniqueRunTag } from './lib.mjs';

const runTag = uniqueRunTag('h1-tests');
const runDir = path.join('/tmp/dsh-v15/m3/runs', runTag);
const LOG_ROOT = '/tmp/dsh-v15/m3/logs';
const writeEvidence = process.argv.includes('--write-evidence');
const refIndex = process.argv.indexOf('--ref');
const REF = refIndex === -1 ? null : process.argv[refIndex + 1];
const MODE = REF === null ? 'current-worktree' : 'committed-ref';
const evidenceRel = `M3-implementation-tests-${MODE}${REF === null ? '' : `-${REF.slice(0, 12)}`}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const TREE_ROOT = '/tmp/dsh-v15/m3/verify-trees';

const SUITES = [
  {
    id: 'shared-platform-update',
    command: 'node --test tests/v1.5-platform-update.test.js',
    args: ['--test', 'tests/v1.5-platform-update.test.js'],
    log: path.join(LOG_ROOT, 'suite-shared-platform-update.log'),
  },
  {
    id: 'host-suite',
    command: 'node --test packages/host/test/index.js',
    args: ['--test', 'packages/host/test/index.js'],
    log: path.join(LOG_ROOT, 'suite-host.log'),
  },
  {
    id: 'client-suite',
    command: 'node --test packages/client/test/index.js',
    args: ['--test', 'packages/client/test/index.js'],
    log: path.join(LOG_ROOT, 'suite-client.log'),
  },
  {
    id: 'release-tools',
    command: 'node --test tests/v1.5-release-tools.test.js',
    args: ['--test', 'tests/v1.5-release-tools.test.js'],
    log: path.join(LOG_ROOT, 'suite-release-tools.log'),
  },
];

function git(argsList) {
  const result = spawnSync('git', argsList, { cwd: REPO_ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Extract one committed tree read-only; the shared worktree is never modified. */
function prepareCommittedTree(ref) {
  if (!/^[0-9a-f]{40}$/.test(String(ref))) throw new Error('--ref must be a full 40-hex commit');
  const dir = path.join(TREE_ROOT, ref);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const tar = spawnSync('git', ['archive', '--format=tar', ref], { cwd: REPO_ROOT, maxBuffer: 512 * 1024 * 1024 });
  if (tar.status !== 0) throw new Error(`git archive ${ref} failed: ${String(tar.stderr ?? '')}`);
  const extract = spawnSync('tar', ['-xf', '-', '-C', dir], { input: tar.stdout, maxBuffer: 64 * 1024 * 1024 });
  if (extract.status !== 0) throw new Error(`tar extract failed: ${String(extract.stderr ?? '')}`);
  // Dependencies are not part of the commit; reuse the installed node_modules read-only.
  const modules = path.join(REPO_ROOT, 'node_modules');
  const link = path.join(dir, 'node_modules');
  if (fs.existsSync(modules) && !fs.existsSync(link)) fs.symlinkSync(modules, link, 'dir');
  return dir;
}

function parseSuiteOutput(text) {
  const lines = text.split('\n');
  const tests = [];
  for (const line of lines) {
    const match = line.match(/^[✔✖]\s+(.+?)(?:\s+\([\d.]+ms\))?\s*$/);
    if (match) tests.push({ name: match[1].trim(), ok: line.startsWith('✔') });
  }
  const counts = {};
  for (const line of lines) {
    const match = line.match(/^ℹ\s+(tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/);
    if (match) counts[match[1]] = Number(match[2]);
  }
  return { tests, counts };
}

const report = createReport({
  id: 'M3-implementation-tests',
  title: 'Independent re-run of the M3 implementation test suites on a committed tree (shared/host/client/release)',
  commands: SUITES.map((suite) => suite.command),
});

const results = [];
ensureDir(runDir);
ensureDir(LOG_ROOT);
let treeRoot = REPO_ROOT;
let treePreparation = null;
if (MODE === 'committed-ref') {
  treeRoot = prepareCommittedTree(REF);
  treePreparation = { mode: MODE, ref: REF, tree: treeRoot, nodeModulesSymlinked: true };
  log(`running committed tree ${REF.slice(0, 12)} at ${treeRoot}`);
} else {
  treePreparation = { mode: MODE, ref: null, tree: REPO_ROOT, nodeModulesSymlinked: false };
}

for (const suite of SUITES) {
  log(`running ${suite.command}`);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, suite.args, {
    cwd: treeRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    maxBuffer: 64 * 1024 * 1024,
  });
  const elapsedMs = Date.now() - startedAt;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  fs.writeFileSync(suite.log, `${stdout}\n${stderr}`, 'utf8');
  const parsed = parseSuiteOutput(stdout);
  results.push({
    id: suite.id,
    command: suite.command,
    exitCode: result.status,
    signal: result.signal ?? null,
    elapsedMs,
    logPath: suite.log,
    counts: parsed.counts,
    tests: parsed.tests,
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
  });
  const failed = parsed.tests.filter((test) => !test.ok);
  report.add(`${suite.id}-exit-zero`, result.status === 0, { exitCode: result.status, signal: result.signal ?? null, elapsedMs });
  report.add(`${suite.id}-parsed-tests-positive`, (parsed.counts.tests ?? 0) > 0, parsed.counts);
  report.add(`${suite.id}-parsed-failures-zero`, (parsed.counts.fail ?? 0) === 0 && failed.length === 0, { counts: parsed.counts, failed: failed.map((test) => test.name) });
  report.add(`${suite.id}-named-test-lines-captured`, parsed.tests.length > 0, { namedTests: parsed.tests.length });
  report.record(`${suite.id}-per-test-results`, parsed.tests.length > 0 ? parsed.tests : null);
}

const head = MODE === 'committed-ref' ? REF : git(['rev-parse', 'HEAD']);
const branch = git(['branch', '--show-current']);
const dirty = git(['status', '--porcelain']);
report.add('tested-tree-recorded', typeof head === 'string' && /^[0-9a-f]{40}$/.test(head), { mode: MODE, head, branch, tree: treeRoot, dirtyWorktreeFiles: dirty === null ? null : dirty.split('\n').filter(Boolean).length });
if (MODE === 'committed-ref') {
  report.add('tested-committed-tree-not-current-worktree', treeRoot !== REPO_ROOT && treeRoot.startsWith(TREE_ROOT), { mode: MODE, treeRoot });
} else {
  report.add('tested-current-worktree-snapshot-flag', true, { note: 'current worktree snapshot; uncommitted teammate edits may be in flight and are recorded as such, not as H1-commit evidence' });
}
report.add('independent-rerun-not-lead-report', true, { note: 'executed by verification; Lead reported numbers are only the comparison baseline' });

if (!writeEvidence) {
  log('--write-evidence not passed: no raw evidence written');
  const failedRequired = report.checks.filter((check) => check.required && !check.ok);
  process.stdout.write(`${JSON.stringify({ id: report.id, passed: failedRequired.length === 0, suites: results.map((item) => ({ id: item.id, exitCode: item.exitCode, counts: item.counts })), failedRequired: failedRequired.map((check) => check.name) }, null, 2)}\n`);
  process.exitCode = failedRequired.length === 0 ? 0 : 1;
} else {
  const evidence = finalizeRun({
    report,
    evidenceRel,
    runDir,
    extra: {
      runTag,
      evidenceLevel: 'automated (real test suites executed in this worktree)',
      mode: MODE,
      testedRef: head,
      treePreparation,
      suites: results.map((item) => ({
        id: item.id,
        command: item.command,
        exitCode: item.exitCode,
        elapsedMs: item.elapsedMs,
        counts: item.counts,
        tests: item.tests,
        scratchLog: item.logPath,
        stdoutBytes: item.stdoutBytes,
        stderrBytes: item.stderrBytes,
      })),
      head,
      branch,
      environment: { node: process.version, platform: process.platform, repoRoot: REPO_ROOT },
      rawEvidenceRoot: RAW_ROOT,
    },
  });
  process.exitCode = evidence.summary.passed ? 0 : 1;
}
