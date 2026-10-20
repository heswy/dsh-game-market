#!/usr/bin/env node
/**
 * S-U2 companion probe: first migration on an HMR profile that still carries
 * the project's dev row (`dsh-game-market` inserted by scripts/dev-enable.mjs
 * pointing at the repository checkout).
 *
 * Question answered here with the real Remote Result: when the package is NOT a
 * profile dependency but a same-id dev row exists, does installBundle really run
 * pnpm and what happens to the duplicate `dsh-game-market` row id during the
 * HMR recomposition? This decides whether "install the bundle over dev mode"
 * can be offered as a one-click migration.
 *
 * Usage: node scripts/verification/v1.5/plugin-update/run-su2b-devmigration.mjs
 * Exit code 0 only when every required check passes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ensureRuntime,
  runtimeIdentity,
  makeHome,
  injectProbeRow,
  createReport,
  sanitize,
  sanitizeDeep,
  writeJson,
  WORK,
} from '../lib/harness.mjs';
import {
  PATHS,
  TARGETS,
  Probe,
  appendDevRow,
  startHostNode,
  writeEvidence,
  PROBE_NETWORK_ENV,
  sanitizeEvidence,
} from './lib.mjs';

const PORT = 58323;
const HOME_NAME = 'su2b-devrow';
const SCENARIO = 'S-U2b (HMR profile with an existing dev row)';

const report = createReport({
  id: 's-u2b-devmigration',
  title: SCENARIO,
  commands: [`node ${path.relative(PATHS.repoRoot, fileURLToPath(import.meta.url))}`],
});

/**
 * Record an observation without asserting it is non-empty. Reviewer-facing
 * summaries must not show a legitimately absent optional field (e.g. no
 * `restartReason` on an `applied` result) as a failed check.
 */
function note(name, value) {
  report.add(name, true, { present: value !== undefined && value !== null, value: value ?? null }, { required: false });
}


function evidence(name, value) {
  return writeEvidence(path.join('s-u2b-devmigration', name), sanitizeEvidence(value));
}

const runMeta = { runtime: null, home: null, note: 'HMR profile with a same-id dev row (scripts/dev-enable.mjs form)', networkEnvUsedForPnpm: null };

function summarize(extra = {}) {
  const checks = report.checks;
  const required = checks.filter((check) => check.required);
  const failedRequired = required.filter((check) => !check.ok).map((check) => check.name);
  const failedOptional = checks.filter((check) => !check.required && !check.ok).map((check) => check.name);
  return report.finish({
    checks,
    requiredChecks: required.length,
    optionalChecks: checks.length - required.length,
    requiredPassed: required.length - failedRequired.length,
    failedRequired,
    failedOptional,
    passed: failedRequired.length === 0,
    ...extra,
  });
}

async function main() {
  ensureRuntime();
  const identity = runtimeIdentity();
  runMeta.runtime = identity;
  console.log(`[su2b] runtime dsh=${identity.dshPackage.version}`);

  const home = await makeHome(HOME_NAME, { port: PORT });
  // Evidence hygiene: never leave a previous run's files next to this one's.
  fs.rmSync(path.join(PATHS.rawRoot, 's-u2b-devmigration'), { recursive: true, force: true });
  runMeta.home = home;
  runMeta.networkEnvUsedForPnpm = PROBE_NETWORK_ENV;
  const bootTag = 'su2b-boot1';
  const outDir = path.join(PATHS.outRoot, 'su2b-boot1');
  fs.rmSync(outDir, { recursive: true, force: true });
  const storageDir = path.join(home, 'storages', 'dsh-game-market');

  // The dev row first, then the probe row: the profile patch order is preserved.
  appendDevRow(home, { hostEntry: PATHS.repoIndex });
  injectProbeRow(home, {
    id: 'v15-plugin-update-probe',
    entry: PATHS.probeUrl,
    config: { bootTag, outDir, storageDir },
  });

  const host = await startHostNode(home, { port: PORT, logName: 'su2b-devrow', nodeArgs: ['--expose-internals'], env: PROBE_NETWORK_ENV });
  const probe = new Probe(bootTag, { outDir, home, port: PORT });
  try {
    const { ready, boot } = await probe.waitReady(180000);
    evidence('boot.json', { identity, ready, boot });
    report.add('HMR capability present in manager context', boot.capability?.managerContextHmr === true, boot.capability);
    const preResult = await probe.send({ id: 'su2b-pre', action: 'observe', label: 'pre' });
    const pre = preResult.snapshot;
    evidence('observe-pre.json', preResult);
    note('pre: dev row health version (checkout code)', pre.health?.body?.version ?? null);
    note('pre: dev mode reported by /health', pre.health?.body?.devMode ?? null);
    report.add('pre: dev row serves /health before any install', pre.health?.available === true, pre.health);
    report.add('pre: package is not a profile dependency', pre.profile?.dependency === null, pre.profile?.dependency);
    report.add(
      'pre: /health reports devMode=true from the repository checkout',
      pre.health?.body?.devMode === true,
      pre.health?.body ?? null,
    );

    const installA = await probe.send({
      id: 'su2b-install-a',
      action: 'install',
      spec: TARGETS.specHttps(TARGETS.shaA),
      requestId: `su2b-a-${Date.now()}`,
      saveExact: true,
    }, { timeoutMs: 600000 });
    evidence('install-a.json', installA);
    report.add('install over the dev row returned a Remote Result', installA.result !== null && typeof installA.result === 'object', installA.resultKeys);
    note('install application', installA.result?.application ?? null);
    note('install error code', installA.result?.error?.code ?? 'none');
    note('install version', installA.result?.version ?? null);
    report.add(
      'install actually ran pnpm (packageResult present)',
      installA.result?.packageResult !== undefined && installA.result?.packageResult !== null,
      installA.result?.packageResult ? { exitCode: installA.result.packageResult.exitCode } : null,
    );

    const postResult = await probe.send({ id: 'su2b-post', action: 'observe', label: 'post' });
    const post = postResult.snapshot;
    evidence('observe-post.json', postResult);
    note('post: dependency after install', post.profile?.dependency ?? null);
    note('post: disk package version', post.profile?.diskPackage?.version ?? null);
    const gameMarketRows = (post.loader?.rows ?? []).filter((row) => row.id === 'dsh-game-market');
    note('post: loader rows with id dsh-game-market', gameMarketRows);
    report.add(
      'post: dev row and installed row did not create two competing live rows',
      gameMarketRows.filter((row) => row.hasFiber === true).length <= 1,
      gameMarketRows,
    );
    note('post: /health version', post.health?.body?.version ?? null);
    note('post: /health devMode', post.health?.body?.devMode ?? null);
    note('post: live row name (which layer won)', gameMarketRows[0]?.name ?? null);
    report.add(
      'the installed bundle did NOT take over the live row: the same-id dev row still runs',
      gameMarketRows.length === 1
        && gameMarketRows[0]?.name?.includes('/index.js') === true
        && post.health?.body?.devMode === true,
      { rows: gameMarketRows, health: { version: post.health?.body?.version ?? null, devMode: post.health?.body?.devMode ?? null } },
    );
    report.add(
      'package installed + dependency recorded while the live row stayed on the checkout code',
      post.profile?.dependency === TARGETS.specRecorded(TARGETS.shaA)
        && post.profile?.diskPackage?.version === TARGETS.versionA
        && post.health?.body?.version === '1.2.0',
      { dependency: post.profile?.dependency ?? null, disk: post.profile?.diskPackage?.version ?? null, running: post.health?.body?.version ?? null },
    );
    note('post: bundles summary', post.bundles ?? null);

    evidence('summary.json', { runtime: identity, home, networkEnvUsedForPnpm: PROBE_NETWORK_ENV, checks: report.checks });
  } finally {
    await host.stop();
  }
}

main()
  .then(() => {
    const finished = summarize();
    writeJson(path.join(WORK, 'plugin-update', 'su2b-report.json'), sanitizeDeep(finished));
    writeEvidence('s-u2b-devmigration/summary.json', sanitizeEvidence({ ...runMeta, ...finished }));
    console.log(`[su2b] passed=${finished.passed} checks=${finished.checks.length} failed=${JSON.stringify(finished.failed)}`);
    if (!finished.passed) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(`[su2b] FATAL: ${sanitize(String(error && error.stack ? error.stack : error))}`);
    try {
      writeJson(path.join(WORK, 'plugin-update', 'su2b-report.json'), sanitizeDeep(summarize({ fatal: String(error && error.message ? error.message : error) })));
    } catch { /* ignore */ }
    process.exitCode = 1;
  });
