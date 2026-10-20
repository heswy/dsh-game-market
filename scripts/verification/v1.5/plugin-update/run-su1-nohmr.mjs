#!/usr/bin/env node
/**
 * S-U1 probe: DSH plugin overwrite-install on a NON-HMR profile (isolated
 * environment path, NOT the real Desktop default; the real Desktop boots with
 * the hmr row enabled unless the profile overrides it).
 *
 * The profile patch disables the shipped hmr row, which is the same mechanism
 * the shipped headless/SDK/ACP bundles use. Everything else is the real Host:
 * a probe Host plugin calls the running `pluginManager.installBundle` with an
 * exact Git commit, and the raw Remote Result is written verbatim.
 *
 * Sequence (three Host boots on one isolated home):
 *   boot1: install A@v1.1.0            -> expect restart-required / no-hmr
 *   boot2: A now runs; install B@v1.2.0 -> expect restart-required, old code still runs
 *   boot3: restart applied            -> expect running version 1.2.0, data preserved
 *
 * Usage: node scripts/verification/v1.5/plugin-update/run-su1-nohmr.mjs
 * Exit code 0 only when every required check passes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  DSH_BIN,
  ensureRuntime,
  runtimeIdentity,
  makeHome,
  injectProbeRow,
  removeProbeRow,
  createReport,
  sanitizeDeep,
  sanitize,
  writeJson,
  readProfilePackage,
  readProfilePatch,
  WORK,
} from '../lib/harness.mjs';
import {
  PATHS,
  TARGETS,
  Probe,
  readStorage,
  seedStorage,
  startHostNode,
  writeEvidence,
  writeNoHmrPatch,
  PROBE_NETWORK_ENV,
  sanitizeEvidence,
} from './lib.mjs';

const PORT = 58322;
const HOME_NAME = 'su1-nohmr';
const SCENARIO = 'S-U1 (isolated non-HMR profile)';

const report = createReport({
  id: 's-u1-nohmr',
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
  return writeEvidence(path.join('s-u1-nohmr', name), sanitizeEvidence(value));
}

function findRow(snapshot, id) {
  return snapshot.loader?.rows?.find((row) => row.id === id) ?? null;
}

function probeConfig(bootTag, outDir, storageDir) {
  return { bootTag, outDir, storageDir };
}

/** Rewrite the managed probe row with a new boot tag/out dir between Host boots. */
function repointProbe(home, config) {
  removeProbeRow(home, 'v15-plugin-update-probe');
  injectProbeRow(home, { id: 'v15-plugin-update-probe', entry: PATHS.probeUrl, config });
}

/** Static composition evidence: the user layer must disable the hmr row. */
function dumpConfig(home) {
  const run = spawnSync(process.execPath, [DSH_BIN, 'web', '--dump-config'], {
    env: { ...process.env, DSH_HOME: home },
    encoding: 'utf8',
    timeout: 120000,
  });
  const text = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const lines = text.split('\n');
  const interesting = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/^- id: hmr\b/.test(lines[index]) || /hmr row|non-HMR probe profile|^- id: v15-plugin-update-probe/.test(lines[index])) {
      interesting.push(lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 8)).join('\n'));
    }
  }
  return {
    exitCode: run.status,
    composedLines: interesting,
    stdoutTail: text.trim().split('\n').slice(-30).join('\n'),
  };
}

async function bootAndProbe({ home, bootTag, outDir, storageDir, port }) {
  repointProbe(home, probeConfig(bootTag, outDir, storageDir));
  const host = await startHostNode(home, { port, logName: `su1-nohmr-${bootTag}`, nodeArgs: ['--expose-internals'], env: PROBE_NETWORK_ENV });
  const probe = new Probe(bootTag, { outDir, home, port });
  try {
    const { ready, boot } = await probe.waitReady(180000);
    return { host, probe, ready, boot };
  } catch (error) {
    await host.stop();
    throw error;
  }
}

const runMeta = { runtime: null, home: null, note: 'isolated non-HMR profile; NOT the real Desktop default path', networkEnvUsedForPnpm: null };

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
  console.log(`[su1] runtime dsh=${identity.dshPackage.version} pluginManager=${identity.pluginManager.version}`);

  const home = await makeHome(HOME_NAME, { port: PORT });
  // Evidence hygiene: never leave a previous run's files next to this one's.
  fs.rmSync(path.join(PATHS.rawRoot, 's-u1-nohmr'), { recursive: true, force: true });
  runMeta.home = home;
  runMeta.networkEnvUsedForPnpm = PROBE_NETWORK_ENV;
  const storageDir = path.join(home, 'storages', 'dsh-game-market');
  writeNoHmrPatch(home);
  const dump = dumpConfig(home);
  evidence('composition-dump-config.json', dump);
  report.add('dump-config exits 0', dump.exitCode === 0, dump.exitCode);
  report.add(
    'profile user layer contains the hmr disable override',
    dump.composedLines.some((block) => /non-HMR probe profile/.test(block) || /disabled: true/.test(block)),
    dump.composedLines,
  );

  // Each boot writes into its own out dir so evidence never mixes boots.
  const outDir1 = path.join(PATHS.outRoot, 'su1-boot1');
  const outDir2 = path.join(PATHS.outRoot, 'su1-boot2');
  const outDir3 = path.join(PATHS.outRoot, 'su1-boot3');
  for (const dir of [outDir1, outDir2, outDir3]) fs.rmSync(dir, { recursive: true, force: true });

  // ---- boot 1: install A on a non-HMR profile -----------------------------
  const b1 = await bootAndProbe({ home, bootTag: 'su1-boot1', outDir: outDir1, storageDir, port: PORT });
  try {
    evidence('boot1/boot.json', { identity, boot: b1.boot, ready: b1.ready });
    report.add(
      'non-HMR profile: manager-context hmr is absent after 15s sampling',
      b1.boot.capability?.managerContextHmr === false && b1.ready.managerContextHmr === false,
      b1.boot.capability,
    );
    note('non-HMR capability samples', b1.boot.capabilitySamples);
    const preResult = await b1.probe.send({ id: 'su1-b1-pre', action: 'observe', label: 'pre' });
    const pre = preResult.snapshot;
    evidence('boot1/observe-pre.json', pre);
    report.add('non-HMR: /health route is absent before the bundle loads', pre.health?.available === false, pre.health);

    const installA = await b1.probe.send({
      id: 'su1-b1-install-a',
      action: 'install',
      spec: TARGETS.specHttps(TARGETS.shaA),
      requestId: `su1-a-${Date.now()}`,
      saveExact: true,
      waitConcurrently: true,
    }, { timeoutMs: 600000 });
    evidence('boot1/install-a.json', installA);
    report.add('non-HMR overwrite install A returned a Remote Result', installA.result !== null && typeof installA.result === 'object', installA.resultKeys);
    report.add(
      'non-HMR install A: application=restart-required + restartReason=no-hmr',
      installA.result?.application === 'restart-required' && installA.result?.restartReason === 'no-hmr',
      { application: installA.result?.application, restartReason: installA.result?.restartReason },
    );
    report.add(
      'non-HMR install A reports bundle/version and changed=true',
      installA.result?.bundle === 'dsh-game-market' && installA.result?.version === TARGETS.versionA && installA.result?.changed === true,
      { bundle: installA.result?.bundle, version: installA.result?.version, changed: installA.result?.changed },
    );
    report.add('install A waitForInstall(active) equals settled result', installA.waitEqualsResult === true, installA.waitEqualsResult);

    const postAResult = await b1.probe.send({ id: 'su1-b1-post-a', action: 'observe', label: 'post-a' });
    const postA = postAResult.snapshot;
    evidence('boot1/observe-post-a.json', postAResult);
    note('after install A disk package version', postA.profile?.diskPackage?.version ?? null);
    note('after install A declared dependency', postA.profile?.dependency ?? null);
    report.add('after install A the bundle row is NOT running before restart', findRow(postA, 'dsh-game-market')?.hasFiber !== true, findRow(postA, 'dsh-game-market'));
    report.add('after install A /health is still absent (new code not loaded)', postA.health?.available === false, postA.health);

    const seeded = seedStorage(home, 'su1-boot1');
    evidence('boot1/storage-seeded.json', seeded);
  } finally {
    await b1.host.stop();
  }

  // ---- boot 2: A runs; overwrite with B -----------------------------------
  const b2 = await bootAndProbe({ home, bootTag: 'su1-boot2', outDir: outDir2, storageDir, port: PORT });
  try {
    evidence('boot2/boot.json', { identity, boot: b2.boot, ready: b2.ready });
    report.add(
      'after restart the same non-HMR profile still reports hmr absent',
      b2.boot.capability?.managerContextHmr === false && b2.ready.managerContextHmr === false,
      b2.boot.capability,
    );
    const preBResult = await b2.probe.send({ id: 'su1-b2-pre', action: 'observe', label: 'pre-b' });
    const preB = preBResult.snapshot;
    evidence('boot2/observe-pre.json', preBResult);
    const hostEpoch1 = preB.health?.body?.hostEpoch ?? null;
    note('boot2 running version (loadedVersion from /health)', preB.health?.body?.version ?? null);
    report.add('boot2: loaded version is 1.1.0 while disk also holds 1.1.0', preB.health?.body?.version === TARGETS.versionA && preB.profile?.diskPackage?.version === TARGETS.versionA, { running: preB.health?.body?.version ?? null, disk: preB.profile?.diskPackage?.version ?? null });
    report.add('boot2: declared dependency is the exact commit A spec', preB.profile?.dependency === TARGETS.specRecorded(TARGETS.shaA), preB.profile?.dependency);
    const storageBoot2 = readStorage(home, 'su1-boot1');
    evidence('boot2/storage-pre.json', storageBoot2);
    report.add(
      'boot2: storage marker and save fixture written before the update are still present',
      storageBoot2.markerPresent === true && storageBoot2.savePresent === true,
      storageBoot2,
    );
    note('boot2: probe-side storage listing (entry names only)', preB.storage?.entries ?? null);

    const installB = await b2.probe.send({
      id: 'su1-b2-install-b',
      action: 'install',
      spec: TARGETS.specHttps(TARGETS.shaB),
      requestId: `su1-b-${Date.now()}`,
      saveExact: true,
    }, { timeoutMs: 600000 });
    evidence('boot2/install-b.json', installB);
    report.add('overwrite install A->B returned a Remote Result', installB.result !== null && typeof installB.result === 'object', installB.resultKeys);
    report.add(
      'overwrite install A->B: application=restart-required + restartReason=no-hmr',
      installB.result?.application === 'restart-required' && installB.result?.restartReason === 'no-hmr',
      { application: installB.result?.application, restartReason: installB.result?.restartReason },
    );
    report.add(
      'overwrite install reports version 1.2.0 and changed=true',
      installB.result?.version === TARGETS.versionB && installB.result?.changed === true,
      { version: installB.result?.version, changed: installB.result?.changed },
    );

    const postBResult = await b2.probe.send({ id: 'su1-b2-post-b', action: 'observe', label: 'post-b' });
    const postB = postBResult.snapshot;
    evidence('boot2/observe-post-b.json', postBResult);
    const runningAfterInstall = postB.health?.body?.version ?? null;
    note('after overwrite: disk package version', postB.profile?.diskPackage?.version ?? null);
    note('after overwrite: declared dependency', postB.profile?.dependency ?? null);
    note('after overwrite: running version (old Host keeps running)', runningAfterInstall);
    report.add('after overwrite disk holds 1.2.0', postB.profile?.diskPackage?.version === TARGETS.versionB, postB.profile?.diskPackage?.version);
    report.add('after overwrite declared dependency records commit B', postB.profile?.dependency === TARGETS.specRecorded(TARGETS.shaB), postB.profile?.dependency);
    report.add('old Host keeps running 1.1.0 code (same pid/hostEpoch)', runningAfterInstall === TARGETS.versionA && (postB.health?.body?.hostEpoch ?? null) === hostEpoch1, { runningAfterInstall, hostEpoch: postB.health?.body?.hostEpoch ?? null, hostEpoch1 });
    report.add('after overwrite the bundle row still is the previous running fiber', findRow(postB, 'dsh-game-market')?.hasFiber === true, findRow(postB, 'dsh-game-market'));
    report.add('after overwrite /health still reports 1.1.0', postB.health?.body?.version === TARGETS.versionA, postB.health?.body ?? postB.health);

    const storageAfterUpdate = readStorage(home, 'su1-boot1');
    evidence('boot2/storage-after-update.json', storageAfterUpdate);
    report.add('storage preserved across the on-disk overwrite', storageAfterUpdate.markerPresent === true && storageAfterUpdate.savePresent === true, storageAfterUpdate);
  } finally {
    await b2.host.stop();
  }

  // ---- boot 3: restart applies the new version ---------------------------
  const b3 = await bootAndProbe({ home, bootTag: 'su1-boot3', outDir: outDir3, storageDir, port: PORT });
  try {
    evidence('boot3/boot.json', { identity, boot: b3.boot, ready: b3.ready });
    const finalResult = await b3.probe.send({ id: 'su1-b3-final', action: 'observe', label: 'final' });
    const final = finalResult.snapshot;
    evidence('boot3/observe-final.json', finalResult);
    note('boot3 loadedVersion (/health)', final.health?.body?.version ?? null);
    note('boot3 hostEpoch', final.health?.body?.hostEpoch ?? null);
    note('boot3 disk package version', final.profile?.diskPackage?.version ?? null);
    note('boot3 declared dependency', final.profile?.dependency ?? null);
    report.add('after restart the running version is 1.2.0', final.health?.body?.version === TARGETS.versionB, final.health?.body?.version ?? null);
    report.add('after restart disk package version is 1.2.0', final.profile?.diskPackage?.version === TARGETS.versionB, final.profile?.diskPackage?.version);
    report.add('after restart the bundle row is running', findRow(final, 'dsh-game-market')?.hasFiber === true, findRow(final, 'dsh-game-market'));
    report.add('after restart /health route is registered', final.health?.available === true, final.health);
    const storageFinal = readStorage(home, 'su1-boot1');
    evidence('boot3/storage-final.json', storageFinal);
    report.add('storage marker and save survive the version change', storageFinal.markerPresent === true && storageFinal.savePresent === true, storageFinal);
    const profilePackage = readProfilePackage(home, 'web');
    evidence('boot3/profile-package.json', { dependencies: profilePackage.dependencies, bundles: profilePackage.dsh?.profile?.bundles ?? null });
    report.add('profile dependency still records the exact commit B', profilePackage.dependencies?.['dsh-game-market'] === TARGETS.specRecorded(TARGETS.shaB), profilePackage.dependencies?.['dsh-game-market'] ?? null);
    const patchText = readProfilePatch(home, 'web');
    evidence('boot3/profile-patch.json', { containsHmrDisable: /- id: hmr\s*\n\s*disabled: true/m.test(patchText) });
    report.add('probe profile patch keeps the explicit hmr disable', /- id: hmr\s*\n\s*disabled: true/m.test(patchText), null);
  } finally {
    await b3.host.stop();
  }

  evidence('summary.json', {
    runtime: identity,
    home,
    networkEnvUsedForPnpm: PROBE_NETWORK_ENV,
    note: 'isolated non-HMR profile; NOT the real Desktop default path',
    checks: report.checks,
  });
}

main()
  .then(() => {
    const finished = summarize();
    writeJson(path.join(WORK, 'plugin-update', 'su1-report.json'), sanitizeDeep(finished));
    writeEvidence('s-u1-nohmr/summary.json', sanitizeEvidence({ ...runMeta, ...finished }));
    console.log(`[su1] passed=${finished.passed} checks=${finished.checks.length} failed=${JSON.stringify(finished.failed)}`);
    if (!finished.passed) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(`[su1] FATAL: ${sanitize(String(error && error.stack ? error.stack : error))}`);
    try {
      writeJson(path.join(WORK, 'plugin-update', 'su1-report.json'), sanitizeDeep(summarize({ fatal: String(error && error.message ? error.message : error) })));
    } catch { /* ignore */ }
    process.exitCode = 1;
  });
