#!/usr/bin/env node
/**
 * S-U2 probe: DSH plugin update on an HMR-capable profile — the capability the
 * real Desktop 0.2.1-rc.2 boots with — performed by an independent Host plugin.
 *
 * The raw Remote Result of the real `pluginManager.installBundle` /
 * `removeBundle` is written verbatim to the evidence directory. The sequence:
 *
 *   install A v1.1.0 (Git URL + full commit, package not yet a dependency)
 *   re-install with the exact recorded spec      -> already-installed
 *   install B v1.2.0 (same URL form)             -> consecutive update #1
 *   re-install with the exact recorded spec      -> already-installed
 *   install B again with the same URL spec       -> duplicate-click behaviour
 *   install C v1.0.0 (same URL form)             -> consecutive update #2
 *   cancel B at the applying boundary (too-late) -> consecutive update #3
 *   removeBundle + re-install                    -> path with an independent operator
 *
 * It also proves the operator plugin (ownerEntryId "include:plugin-manager")
 * stays alive, with an unchanged fiber uid and heartbeat, while the bundle
 * under update is stopped and replaced by HMR.
 *
 * Usage: node scripts/verification/v1.5/plugin-update/run-su2-hmr.mjs
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
  sleep,
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
  PROBE_NETWORK_ENV,
  sanitizeEvidence,
} from './lib.mjs';

const HOME_NAME = 'su2-hmr';
const PORT = 58321;
const SCENARIO = 'S-U2 (HMR profile, independent operator)';
const SHA_C = '611c0ed0083432fc7b471e1d1351b90bc15f81ff'; // tag v1.0.0
const VERSION_C = '1.0.0';

const report = createReport({
  id: 's-u2-hmr',
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
  return writeEvidence(path.join('s-u2-hmr', name), sanitizeEvidence(value));
}

function rowOf(snapshot, id) {
  return snapshot.loader?.rows?.find((row) => row.id === id) ?? null;
}

function versionOf(snapshot) {
  return snapshot.health?.body?.version ?? null;
}

function depOf(snapshot) {
  return snapshot.profile?.dependency ?? null;
}

/** Record the Remote Result fields product code must read, plus live consistency. */
function recordResult(label, result) {
  const value = result?.result ?? null;
  note(`${label}.application`, value?.application ?? null);
  note(`${label}.restartReason`, value?.restartReason ?? null);
  note(`${label}.changed`, value?.changed ?? null);
  note(`${label}.bundle`, value?.bundle ?? null);
  note(`${label}.version`, value?.version ?? null);
  note(`${label}.error`, value?.error ?? null);
  note(`${label}.packageResult`, value?.packageResult
    ? {
      exitCode: value.packageResult.exitCode,
      timedOut: value.packageResult.timedOut ?? null,
      truncated: value.packageResult.truncated ?? null,
      kind: value.packageResult.kind ?? null,
    }
    : null);
  return value;
}

/**
 * A reported "applied" install must be live in this same Host; a reported
 * "restart-required" install must leave the previous code running while the
 * disk holds the new version. This is the check that keeps the evidence honest.
 */
function assertAppliedLive(label, after, installedVersion) {
  report.add(
    `${label}: reported applied => live /health reports the installed version without restart`,
    versionOf(after) === installedVersion,
    { running: versionOf(after), installedVersion },
  );
  report.add(`${label}: disk package holds the installed version`, after.profile?.diskPackage?.version === installedVersion, after.profile?.diskPackage?.version);
}

const runMeta = { runtime: null, home: null, note: 'HMR profile == real Desktop default (dsh-base hmr row enabled); raw probe output in the isolated work dir, this copy is sanitised', networkEnvUsedForPnpm: null };

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
  console.log(`[su2] runtime dsh=${identity.dshPackage.version} pluginManager=${identity.pluginManager.version}`);

  const home = await makeHome(HOME_NAME, { port: PORT });
  // Evidence hygiene: never leave a previous run's files next to this one's.
  fs.rmSync(path.join(PATHS.rawRoot, 's-u2-hmr'), { recursive: true, force: true });
  runMeta.home = home;
  runMeta.networkEnvUsedForPnpm = PROBE_NETWORK_ENV;
  const bootTag = 'su2-boot1';
  const outDir = path.join(PATHS.outRoot, 'su2-boot1');
  fs.rmSync(outDir, { recursive: true, force: true });
  const storageDir = path.join(home, 'storages', 'dsh-game-market');
  injectProbeRow(home, {
    id: 'v15-plugin-update-probe',
    entry: PATHS.probeUrl,
    config: { bootTag, outDir, storageDir },
  });

  const host = await startHostNode(home, { port: PORT, logName: 'su2-hmr', nodeArgs: ['--expose-internals'], env: PROBE_NETWORK_ENV });
  const probe = new Probe(bootTag, { outDir, home, port: PORT });
  const selfUids = [];
  // probe.send() returns the command envelope; observations are in .snapshot.
  const rememberSelf = (result) => {
    const snapshot = result?.snapshot ?? result;
    if (snapshot?.selfFiberUid !== undefined) selfUids.push(snapshot.selfFiberUid);
    return snapshot;
  };
  try {
    const { ready, boot } = await probe.waitReady(180000);
    evidence('boot1/boot.json', { identity, ready, boot });
    report.add('hmr service detected through the manager context after stabilisation', boot.capability.managerContextHmr === true, boot.capability);
    note('hmr capability samples (async Service.init race)', boot.capabilitySamples);
    report.add('manager context hmr is the Hmr service with runExclusive', boot.capability.managerContextHmrCtor === 'Hmr' && boot.capability.managerContextHmrHasRunExclusive === true, boot.capability);
    report.add(
      'operation holder is the plugin-manager row, not the updated bundle',
      boot.managerInternal.ownerEntryId !== null
        && boot.managerInternal.ownerEntryId !== 'dsh-game-market'
        && boot.managerInternal.ownerContextIsProbeContext === false,
      boot.managerInternal,
    );

    const fixtures = seedStorage(home, bootTag);
    evidence('boot1/storage-seeded.json', fixtures);

    const pre = rememberSelf(await probe.send({ id: 'su2-pre', action: 'observe', label: 'pre' }));
    evidence('boot1/observe-pre.json', pre);
    report.add('pre: dsh-game-market is not a profile dependency', depOf(pre) === null, depOf(pre));
    report.add('pre: /health route not registered (bundle not loaded)', pre.health?.available === false && pre.health?.routeRegistered === false, pre.health);
    note('pre: hmr loader row', rowOf(pre, 'hmr'));

    // ---- 1. first install: package is NOT a dependency ---------------------
    const installA = await probe.send({
      id: 'su2-install-a',
      action: 'install',
      spec: TARGETS.specHttps(TARGETS.shaA),
      requestId: 'su2-a-req',
      saveExact: true,
      waitConcurrently: true,
    }, { timeoutMs: 600000 });
    evidence('boot1/install-a.json', installA);
    const valueA = recordResult('first-install-A-1.1.0', installA);
    report.add('first install (URL+commit spec, package absent) is applied by HMR', valueA?.application === 'applied', valueA?.application);
    report.add('first install reports bundle/version 1.1.0', valueA?.bundle === 'dsh-game-market' && valueA?.version === TARGETS.versionA, { bundle: valueA?.bundle, version: valueA?.version });
    report.add('first install reports changed=true', valueA?.changed === true, valueA?.changed);
    report.add('waitForInstall(active requestId) resolves to the same result', installA.waitEqualsResult === true, installA.waitEqualsResult);
    report.add('waitForInstall after settle returns null (results are not retained)', installA.waitForInstallAfterSettle === null, installA.waitForInstallAfterSettle);

    const postA = rememberSelf(await probe.send({ id: 'su2-post-a', action: 'observe', label: 'post-a' }));
    evidence('boot1/observe-post-a.json', postA);
    assertAppliedLive('first-install-A', postA, TARGETS.versionA);
    const rowA = rowOf(postA, 'dsh-game-market');
    report.add('first install: bundle row is running', rowA?.hasFiber === true, rowA);
    note('first install: recorded dependency string (verbatim)', depOf(postA));

    // ---- 2. exact recorded spec while it IS a dependency -------------------
    const recordedA = await probe.send({
      id: 'su2-install-recorded-a',
      action: 'install',
      spec: TARGETS.specRecorded(TARGETS.shaA),
      requestId: 'su2-recorded-a-req',
    }, { timeoutMs: 120000 });
    evidence('boot1/install-recorded-a.json', recordedA);
    const valueRecordedA = recordResult('recorded-spec-A', recordedA);
    report.add(
      'HMR + dependency + exact recorded spec => failed/already-installed',
      valueRecordedA?.application === 'failed' && valueRecordedA?.error?.code === 'already-installed',
      { application: valueRecordedA?.application, error: valueRecordedA?.error ?? null },
    );
    report.add('already-installed runs no pnpm and leaves changed=false', valueRecordedA?.changed === false && valueRecordedA?.packageResult === undefined, { changed: valueRecordedA?.changed, packageResult: valueRecordedA?.packageResult ?? null });

    // ---- 3. consecutive update #1: A -> B (URL form) -----------------------
    const installB = await probe.send({
      id: 'su2-install-b',
      action: 'install',
      spec: TARGETS.specHttps(TARGETS.shaB),
      requestId: 'su2-b-req',
      saveExact: true,
    }, { timeoutMs: 600000 });
    evidence('boot1/install-b.json', installB);
    const valueB = recordResult('update-A-to-B-1.2.0', installB);
    report.add('URL+commit spec update to B is not blocked by already-installed', valueB?.error?.code !== 'already-installed', valueB?.error ?? null);
    report.add('update to B reports applied by HMR', valueB?.application === 'applied', valueB?.application);
    report.add('update to B reports version 1.2.0 and the bundle row', valueB?.version === TARGETS.versionB && valueB?.bundle === 'dsh-game-market', { version: valueB?.version, bundle: valueB?.bundle });
    const postB = rememberSelf(await probe.send({ id: 'su2-post-b', action: 'observe', label: 'post-b' }));
    evidence('boot1/observe-post-b.json', postB);
    assertAppliedLive('update-A-to-B', postB, TARGETS.versionB);
    note('update A->B: recorded dependency string (verbatim)', depOf(postB));
    report.add('update A->B: recorded dependency string is the pnpm hosted-git form', depOf(postB) === TARGETS.specRecorded(TARGETS.shaB), depOf(postB));
    const rowB = rowOf(postB, 'dsh-game-market');
    note('update A->B: bundle row fiber identity', rowB);
    report.add(
      'update A->B: the updated bundle row was disposed and restarted with a new fiber',
      rowA?.fiberUid !== null && rowB?.fiberUid !== null && rowA?.fiberUid !== rowB?.fiberUid,
      { before: rowA, after: rowB },
    );

    // ---- 4. exact recorded spec of the installed version -------------------
    const recordedB = await probe.send({
      id: 'su2-install-recorded-b',
      action: 'install',
      spec: TARGETS.specRecorded(TARGETS.shaB),
      requestId: 'su2-recorded-b-req',
    }, { timeoutMs: 120000 });
    evidence('boot1/install-recorded-b.json', recordedB);
    const valueRecordedB = recordResult('recorded-spec-B', recordedB);
    report.add(
      'same-version repeat click with the exact recorded spec => already-installed',
      valueRecordedB?.application === 'failed' && valueRecordedB?.error?.code === 'already-installed' && valueRecordedB?.changed === false,
      { application: valueRecordedB?.application, error: valueRecordedB?.error ?? null, changed: valueRecordedB?.changed },
    );

    // ---- 5. duplicate click with the same URL spec -------------------------
    const againB = await probe.send({
      id: 'su2-install-b-again-url',
      action: 'install',
      spec: TARGETS.specHttps(TARGETS.shaB),
      requestId: 'su2-b-again-req',
      saveExact: true,
    }, { timeoutMs: 600000 });
    evidence('boot1/install-b-again-url.json', againB);
    const valueAgainB = recordResult('duplicate-URL-spec-B', againB);
    report.add('duplicate URL-form install returns a definitive Remote Result', valueAgainB !== null && typeof valueAgainB === 'object', againB.resultKeys);
    report.add(
      'duplicate URL-form install is NOT caught by the already-installed gate (string-exact rule)',
      valueAgainB?.error?.code !== 'already-installed',
      { error: valueAgainB?.error ?? null, application: valueAgainB?.application ?? null },
    );
    const postAgain = rememberSelf(await probe.send({ id: 'su2-post-b-again', action: 'observe', label: 'post-b-again' }));
    evidence('boot1/observe-post-b-again.json', postAgain);
    report.add(
      'duplicate URL-form install does not change the recorded dependency',
      depOf(postAgain) === TARGETS.specRecorded(TARGETS.shaB),
      { declared: depOf(postAgain), result: valueAgainB?.application ?? null, error: valueAgainB?.error ?? null },
    );
    report.add('duplicate URL-form install leaves the live version untouched', versionOf(postAgain) === TARGETS.versionB, versionOf(postAgain));

    // ---- 6. consecutive update #2: B -> C (same URL form) ------------------
    const installC = await probe.send({
      id: 'su2-install-c',
      action: 'install',
      spec: TARGETS.specHttps(SHA_C),
      requestId: 'su2-c-req',
      saveExact: true,
    }, { timeoutMs: 600000 });
    evidence('boot1/install-c.json', installC);
    const valueC = recordResult('update-B-to-C-1.0.0', installC);
    report.add('second consecutive URL+commit update is also applied by HMR', valueC?.application === 'applied' && valueC?.version === VERSION_C, { application: valueC?.application, version: valueC?.version, error: valueC?.error ?? null });
    const postC = rememberSelf(await probe.send({ id: 'su2-post-c', action: 'observe', label: 'post-c' }));
    evidence('boot1/observe-post-c.json', postC);
    assertAppliedLive('update-B-to-C', postC, VERSION_C);
    report.add('update B->C: recorded dependency string points at commit C', depOf(postC) === `github:heswy/dsh-game-market#${SHA_C}`, depOf(postC));
    report.add(
      'update B->C: the bundle row was disposed and restarted again',
      rowB?.fiberUid !== null && rowOf(postC, 'dsh-game-market')?.fiberUid !== null && rowB?.fiberUid !== rowOf(postC, 'dsh-game-market')?.fiberUid,
      { before: rowB, after: rowOf(postC, 'dsh-game-market') },
    );

    // ---- 7. cancel / waitForInstall boundaries -----------------------------
    const cancelUnknown = await probe.send({ id: 'su2-cancel-unknown', action: 'cancel-unknown', requestId: 'su2-unknown-req' });
    evidence('boot1/cancel-unknown.json', cancelUnknown);
    report.add('cancelInstall(unknown requestId) => not-running', cancelUnknown.cancelResult?.status === 'not-running', cancelUnknown.cancelResult);
    report.add('waitForInstall(unknown requestId) => null', cancelUnknown.waitForInstallResult === null, cancelUnknown.waitForInstallResult);

    const cancelDuring = await probe.send({
      id: 'su2-cancel-during-install',
      action: 'cancel-during-install',
      spec: TARGETS.specHttps(TARGETS.shaA),
      requestId: 'su2-cancel-req',
      afterMs: 400,
    }, { timeoutMs: 600000 });
    evidence('boot1/cancel-during-install.json', cancelDuring);
    report.add('cancelInstall during installing => cancelled', cancelDuring.cancelResult?.status === 'cancelled', cancelDuring.cancelResult);
    report.add('cancelled install reports application=cancelled', cancelDuring.result?.application === 'cancelled', cancelDuring.result?.application);
    report.add('cancelled install reports changed=false (profile files restored)', cancelDuring.result?.changed === false, cancelDuring.result?.changed);
    const postCancel = rememberSelf(await probe.send({ id: 'su2-post-cancel', action: 'observe', label: 'post-cancel' }));
    evidence('boot1/observe-post-cancel.json', postCancel);
    report.add('cancel restores the previous declared dependency (commit C kept)', depOf(postCancel) === `github:heswy/dsh-game-market#${SHA_C}`, depOf(postCancel));
    report.add('cancel leaves the live version untouched', versionOf(postCancel) === VERSION_C, versionOf(postCancel));

    // ---- 8. consecutive update #3: C -> B, cancelled at the applying boundary
    const tooLate = await probe.send({
      id: 'su2-cancel-at-applying',
      action: 'cancel-at-applying',
      spec: TARGETS.specHttps(TARGETS.shaB),
      requestId: 'su2-tooLate-req',
    }, { timeoutMs: 600000 });
    evidence('boot1/cancel-at-applying.json', tooLate);
    note('cancel-at-applying phases seen by the scheduler (internal read)', tooLate.phasesSeen);
    report.add('cancelInstall in the applying phase => too-late', tooLate.cancelResult?.status === 'too-late', tooLate.cancelResult);
    report.add('too-late is not a rollback: the install completes as applied', tooLate.result?.application === 'applied' && tooLate.result?.version === TARGETS.versionB, { application: tooLate.result?.application, version: tooLate.result?.version, error: tooLate.result?.error ?? null });
    const postTooLate = rememberSelf(await probe.send({ id: 'su2-post-too-late', action: 'observe', label: 'post-too-late' }));
    evidence('boot1/observe-post-too-late.json', postTooLate);
    assertAppliedLive('update-C-to-B-via-too-late', postTooLate, TARGETS.versionB);
    report.add('too-late update records commit B in the dependency', depOf(postTooLate) === TARGETS.specRecorded(TARGETS.shaB), depOf(postTooLate));

    // ---- 9. removeBundle + re-install with an independent operator ---------
    const beforeRemove = rememberSelf(await probe.send({ id: 'su2-before-remove', action: 'observe', label: 'before-remove' }));
    evidence('boot1/observe-before-remove.json', beforeRemove);
    const remove = await probe.send({ id: 'su2-remove', action: 'remove-bundle', name: 'dsh-game-market' }, { timeoutMs: 600000 });
    evidence('boot1/remove-bundle.json', remove);
    const valueRemove = recordResult('remove-bundle', remove);
    report.add('removeBundle did not throw stop-profile/bundle-in-use', remove.thrown === undefined, remove.thrown ?? null);
    report.add(
      'independent operator survived the whole lifecycle (probe wrote the remove result)',
      remove.after?.selfFiberUid === remove.before?.selfFiberUid && remove.after?.alive === true,
      { before: remove.before, after: remove.after },
    );
    const postRemove = rememberSelf(await probe.send({ id: 'su2-post-remove', action: 'observe', label: 'post-remove' }));
    evidence('boot1/observe-post-remove.json', postRemove);
    report.add('after remove: dependency is gone', depOf(postRemove) === null, depOf(postRemove));
    report.add('after remove: /health route is gone', postRemove.health?.available === false, postRemove.health);
    report.add('after remove: the bundle row is not running', rowOf(postRemove, 'dsh-game-market')?.hasFiber !== true, rowOf(postRemove, 'dsh-game-market'));
    if (valueRemove?.application === 'applied') {
      report.add('removeBundle reports applied under HMR', true, valueRemove.application);
    } else {
      note('removeBundle application (not applied)', valueRemove?.application ?? null);
    }

    const reinstall = await probe.send({
      id: 'su2-reinstall-b',
      action: 'install',
      spec: TARGETS.specHttps(TARGETS.shaB),
      requestId: 'su2-reinstall-req',
      saveExact: true,
    }, { timeoutMs: 600000 });
    evidence('boot1/reinstall-b.json', reinstall);
    const valueReinstall = recordResult('reinstall-after-remove', reinstall);
    report.add('re-install after remove is applied by HMR', valueReinstall?.application === 'applied' && valueReinstall?.version === TARGETS.versionB, { application: valueReinstall?.application, version: valueReinstall?.version, error: valueReinstall?.error ?? null });
    const postReinstall = rememberSelf(await probe.send({ id: 'su2-post-reinstall', action: 'observe', label: 'post-reinstall' }));
    evidence('boot1/observe-post-reinstall.json', postReinstall);
    assertAppliedLive('reinstall-after-remove', postReinstall, TARGETS.versionB);

    // ---- 10. operator liveness and data outside the bundle -----------------
    const heartbeat = JSON.parse(fs.readFileSync(path.join(outDir, 'heartbeat.json'), 'utf8'));
    evidence('boot1/heartbeat-final.json', heartbeat);
    report.add('operator heartbeat is fresh and belongs to a single fiber', heartbeat.selfFiberUid === postReinstall.selfFiberUid, { heartbeat, observing: postReinstall.selfFiberUid });
    report.add(
      'operator fiber uid never changed across installs/removals (no disposal)',
      selfUids.length > 5 && new Set(selfUids).size === 1,
      { samples: selfUids },
    );

    const storage = readStorage(home, bootTag);
    evidence('boot1/storage-after.json', storage);
    report.add('storage marker survived every update/removal/re-install', storage.markerPresent === true, storage.marker ?? null);
    report.add('save fixture survived unchanged', storage.savePresent === true && storage.save?.marker === 'v1.5-m0-plugin-update-save-fixture', storage.save ?? null);
    report.add('storage root is outside the profile bundle directory', storage.root.startsWith(path.join(home, 'storages')), storage.root);

    evidence('summary.json', {
      runtime: identity,
      home,
      networkEnvUsedForPnpm: PROBE_NETWORK_ENV,
      note: 'HMR profile == real Desktop default (dsh-base hmr row enabled); raw probe output in the isolated work dir, this copy is sanitised',
      checks: report.checks,
    });
  } finally {
    await host.stop();
  }
}

main()
  .then(() => {
    const finished = summarize();
    writeJson(path.join(WORK, 'plugin-update', 'su2-report.json'), sanitizeDeep(finished));
    writeEvidence('s-u2-hmr/summary.json', sanitizeEvidence({ ...runMeta, ...finished }));
    console.log(`[su2] passed=${finished.passed} checks=${finished.checks.length} failed=${JSON.stringify(finished.failed)}`);
    if (!finished.passed) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(`[su2] FATAL: ${sanitize(String(error && error.stack ? error.stack : error))}`);
    try {
      writeJson(path.join(WORK, 'plugin-update', 'su2-report.json'), sanitizeDeep(summarize({ fatal: String(error && error.message ? error.message : error) })));
    } catch { /* ignore */ }
    process.exitCode = 1;
  });
