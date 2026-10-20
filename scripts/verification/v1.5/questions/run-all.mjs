#!/usr/bin/env node
/**
 * Run every V1.5 M0 question probe (S-Q1, S-Q2, S-Q2b) sequentially.
 *
 * Each probe boots its own isolated DSH_HOME + headless Chrome, writes its raw
 * evidence under `docs/verification/v1.5/raw/questions/`, and exits non-zero
 * when a required check fails. This runner aggregates the exit codes and writes
 * `run-all.json`; it exits non-zero when any probe fails.
 *
 * Usage: node scripts/verification/v1.5/questions/run-all.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReport, writeJson } from '../lib/harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Resolve the repo root from this file's real path (`%20` safe). */
const REPO_ROOT = path.resolve(HERE, '../../../..');
const RAW_DIR = path.join(REPO_ROOT, 'docs/verification/v1.5/raw/questions');

const PROBES = [
  { id: 'S-Q1', script: 'q1-open-in-game-panel.mjs' },
  { id: 'S-Q2', script: 'q2-lifecycle.mjs' },
  { id: 'S-Q2b', script: 'q2b-attach-wait.mjs' },
];

const report = createReport({
  id: 'S-Q',
  title: 'V1.5 M0 question probes (S-Q1/S-Q2/S-Q2b)',
  commands: ['node scripts/verification/v1.5/questions/run-all.mjs'],
});
const results = [];

for (const probe of PROBES) {
  const file = path.join(HERE, probe.script);
  console.log(`\n=== ${probe.id}: node ${path.relative(REPO_ROOT, file)} ===`);
  const startedAt = new Date().toISOString();
  const run = spawnSync(process.execPath, [file], { cwd: REPO_ROOT, stdio: 'inherit' });
  const status = run.status === null ? 1 : run.status;
  results.push({
    id: probe.id,
    script: path.relative(REPO_ROOT, file),
    command: `node ${path.relative(REPO_ROOT, file)}`,
    exitCode: status,
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  report.add(`${probe.id} probe exit code 0`, status === 0, { exitCode: status, script: probe.script });
}

report.record('probe runs', results);
const final = report.finish();
fs.mkdirSync(RAW_DIR, { recursive: true });
writeJson(path.join(RAW_DIR, 'run-all.json'), final);
console.log(`\n${JSON.stringify({ passed: final.passed, results }, null, 2)}`);
process.exit(final.passed ? 0 : 1);
