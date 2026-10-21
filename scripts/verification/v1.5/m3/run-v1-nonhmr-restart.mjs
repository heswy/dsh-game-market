#!/usr/bin/env node
/**
 * M3-V1 non-HMR path: install R_A -> real Client UI update to R_B ->
 * pending-restart(no-hmr) -> Host restart -> activating -> updated (both ends 1.2.2).
 *
 * The isolated profile explicitly disables the shipped `hmr` row (real non-HMR
 * profile; M0 S-U1 evidence), so the update MUST take the restart-required path:
 *   - the install returns `restart-required` + `restartReason:"no-hmr"`;
 *   - the UI must show "installed, restart required" (`pending-restart`) and
 *     must NEVER claim success or show the disk version as the running version;
 *   - before the restart, disk version is R_B (1.2.2) while the running Host is
 *     still R_A (1.2.1) — proven from /health + inspect, not inferred;
 *   - after a real Host restart the operation resumes (persisted record) and
 *     reaches `updated` only when Host running identity and Client self-reported
 *     identity both match R_B;
 *   - saves/user data are preserved; cleanup is proven.
 *
 * Preconditions: R_A/R_B probe releases pushed (git objects present here).
 *
 * Usage:
 *   node scripts/verification/v1.5/m3/run-v1-nonhmr-restart.mjs \
 *     --a <R_A> --b <R_B> --final <R_final> [--version-a 1.2.1 --version-b 1.2.2]
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  RAW_ROOT,
  REPO_ROOT,
  RUNS_ROOT,
  SHOT_DIR,
  bootProbeHost,
  sleep,
  cleanupProof,
  createReport,
  ensureDir,
  finalizeRun,
  freePort,
  log,
  makeIsolatedHome,
  verifyRuntime,
} from './lib.mjs';
import {
  attachReport,
  beginUpdateThroughUi,
  buildIndexBody,
  cleanupRun,
  createRunContext,
  ensureUpdateSectionRendered,
  healthFromPage,
  inspectFromPage,
  makeScenarioEnvironment,
  openRealPage,
  parseTargets,
  prepareTargetRepo,
  probeInspect,
  readReleaseIdentity,
  readUpdateUi,
  readUserData,
  reloadRealPage,
  restartContextHost,
  seedUserData,
  startTransport,
  targetRefs,
  trackHost,
  trackPage,
  userDataPreserved,
  waitForDiscoveredTarget,
  waitForHostVersion,
  waitForOperation,
  waitForRoute,
  writeNoHmrPatch,
} from './v1-common.mjs';
import { removeFixtureTls } from './fixture.mjs';

const REPORT_ID = 'M3-V1-nonhmr-restart';
const run = createRunContext('v1-nonhmr-restart');
const targets = parseTargets(process.argv.slice(2));
const refs = targetRefs(targets);
const byKey = Object.fromEntries(refs.map((ref) => [ref.key, ref]));
const REPORT = createReport({
  id: REPORT_ID,
  title: 'Non-HMR pending-restart -> Host restart -> updated (real Client UI + real restart)',
  commands: [`node scripts/verification/v1.5/m3/run-v1-nonhmr-restart.mjs --a ${targets.a} --b ${targets.b} --final ${targets.final}`],
});
attachReport(run, REPORT);

const evidence = { targets: refs, targetIdentities: null, boots: [], installs: [], transitions: [], dialogs: [], uiActions: [], screenshots: [], dataPreservation: null, beforeRestart: null, afterRestart: null, cleanup: null, thrown: null };
let thrown = null;

const targetRepo = (() => {
  try {
    return prepareTargetRepo({ final: targets.final, commits: [targets.a, targets.b] });
  } catch (error) {
    return { dir: null, fetchResults: [{ ok: false, error: String(error && error.message ? error.message : error) }], git: () => null };
  }
})();

function gitRun(args) {
  return targetRepo.dir === null ? null : targetRepo.git(args, { allowFail: true });
}

function recordAction(name, result, extra = {}) {
  evidence.uiActions.push({ name, at: new Date().toISOString(), result, ...extra });
}

async function captureScreenshot(cdp, name) {
  ensureDir(SHOT_DIR);
  const file = path.join(SHOT_DIR, `M3-V1-nonhmr-restart-${run.runTag}-${name}.png`);
  try {
    await cdp.shot(file);
    evidence.screenshots.push({ name, file: path.relative(REPO_ROOT, file) });
    return file;
  } catch (error) {
    run.report.add(`screenshot-${name}`, false, String(error && error.message ? error.message : error));
    return null;
  }
}

function recordTargetIdentities() {
  const identities = refs.map((ref) => ({
    key: ref.key,
    commit: ref.commit,
    version: ref.version,
    exists: gitRun(['cat-file', '-e', `${ref.commit}^{commit}`]) !== null,
    packageVersion: (() => {
      const raw = gitRun(['show', `${ref.commit}:package.json`]);
      try {
        return raw === null ? null : JSON.parse(raw).version;
      } catch {
        return null;
      }
    })(),
    release: readReleaseIdentity(ref.commit, { git: gitRun }),
  }));
  evidence.targetIdentities = identities;
  evidence.targetRepo = { dir: targetRepo.dir, fetchResults: targetRepo.fetchResults };
  for (const result of targetRepo.fetchResults) {
    run.report.add(`target-repo-fetch-${result.mode ?? 'failed'}-${String(result.commit ?? '').slice(0, 12)}`, result.ok === true, result);
  }
  for (const identity of identities) {
    run.report.add(`target-${identity.key}-commit-exists`, identity.exists === true, { commit: identity.commit });
    run.report.add(`target-${identity.key}-version`, identity.packageVersion === identity.version, { actual: identity.packageVersion, expected: identity.version });
    run.report.add(`target-${identity.key}-release-identity`, identity.release?.schemaVersion === 1 && /^[0-9a-f]{40}$/.test(String(identity.release?.clientBuildCommit)), identity.release);
  }
  const allExist = identities.every((identity) => identity.exists === true);
  run.report.add('precondition-probe-releases-available', allExist, { note: 'R_A/R_B/R_final must be pushed first (not-run otherwise)' });
  return { identities, allExist };
}

async function bootIndex(context, { transport, name, home, bootIndex = 1, noHmrPatch = false, tag = 'boot' } = {}) {
  const runDir = path.join(RUNS_ROOT, run.runTag, `${tag}${bootIndex}`);
  ensureDir(runDir);
  const bootTag = `${name}-${tag}${bootIndex}`;
  const booted = await bootProbeHost({
    name,
    home,
    runDir,
    bootTag,
    port: await freePort(),
    env: transport.envForHost({ marker: run.runTag }),
    pluginMode: 'none',
    logName: `${name}-${tag}${bootIndex}`,
  });
  context.host = booted.host;
  context.probe = booted.probe;
  context.boot = booted.boot;
  context.hostPort = booted.host.port;
  context.bootIndex = bootIndex;
  trackHost(run, context);
  evidence.boots.push({ bootIndex, pid: booted.boot?.pid ?? null, hmr: booted.boot?.capability?.managerContextHmr ?? null });
  return booted;
}

async function body() {
  const identity = verifyRuntime();
  run.report.add('runtime-extraction-matches-installed-app', identity.extractionVerifiedAgainstInstalledApp, identity.mismatched);
  const targetState = recordTargetIdentities();
  if (!targetState.allExist) throw new Error('probe release commits are not available locally (V1 not-run precondition)');
  const expectedClient = Object.fromEntries(targetState.identities.map((item) => [item.key, item.release?.clientBuildCommit ?? null]));

  const env = makeScenarioEnvironment(run.runTag);
  run.tls = env.tls;
  run.tlsDir = env.tlsDir;
  run.transport = await startTransport(env);
  run.transport.control.setFixtureBody(buildIndexBody({ versions: [{ version: byKey.B.version, commit: byKey.B.commit }] }));
  run.report.add('transport-fixture-up', Boolean(run.transport.port), { port: run.transport.port });
  run.report.add('host-network-env-selfcheck', run.transport.hostEnvCheck?.ok === true, run.transport.hostEnvCheck ?? null);

  // Fresh isolated profile with the hmr row explicitly disabled (non-HMR profile).
  const name = `v1-nonhmr-${run.runTag}`;
  const home = await makeIsolatedHome(name, { port: await freePort() });
  const patchFile = writeNoHmrPatch(home);
  const context = { name, home, transport: run.transport, restarts: [] };
  run.context = context;
  run.report.add('fresh-isolated-home', home.startsWith('/tmp/dsh-v15/m3/'), home);
  run.report.add('non-hmr-profile-patch-written', path.basename(patchFile) === 'cordis.patch.yml', { patchFile });

  // Boot 1: no bundle yet. Install R_A returns restart-required (no HMR service).
  const boot1 = await bootIndex(context, { transport: run.transport, name, home, bootIndex: 1, tag: 'boot' });
  run.report.add('boot1-hmr-capability-absent', boot1.boot?.capability?.managerContextHmr === false, boot1.boot?.capability ?? null);
  const { installExactWithRetry } = await import('./v1-common.mjs');
  const outcome = await installExactWithRetry(context.probe, { spec: byKey.A.spec, requestIdBase: `m3-v1-nonhmr-install-a-${run.runTag}` });
  const install = { result: outcome.result, attempts: outcome.attempts };
  evidence.installs.push({ phase: 'install-R_A-nonhmr', result: install.result ?? null, attempts: outcome.attempts, retried: outcome.retried === true });
  run.report.add('install-R_A-application-restart-required', install.result?.application === 'restart-required', install.result?.application ?? null);
  run.report.add('install-R_A-restart-reason-no-hmr', install.result?.restartReason === 'no-hmr', install.result?.restartReason ?? null);
  run.report.add('install-R_A-version-matches', install.result?.version === byKey.A.version, install.result?.version ?? null);
  run.report.add('install-R_A-pnpm-exit-zero', install.result?.packageResult?.exitCode === 0, install.result?.packageResult?.exitCode ?? null);
  const observeDiskA = await context.probe.send({ id: 'nonhmr-observe-disk-a', action: 'observe', label: 'after-install-a' });
  run.report.add('disk-version-R_A-after-install', observeDiskA.snapshot?.profile?.diskPackage?.version === byKey.A.version, observeDiskA.snapshot?.profile?.diskPackage ?? null);
  run.report.add('no-health-route-before-restart', observeDiskA.snapshot?.health?.routeRegistered !== true, observeDiskA.snapshot?.health ?? null);

  // Restart (boot 2): the newly installed bundle loads; it is still version A, no HMR.
  await restartContextHost(context, { logNamePrefix: `${name}-restart` });
  const route2 = await waitForRoute(context, { timeoutMs: 90000 });
  run.report.add('boot2-routes-available', route2.ok === true, route2.ok ? { waitedMs: route2.waitedMs } : null);
  const inspect2 = (await probeInspect(context)).body;
  run.report.add('boot2-running-version-R_A', inspect2?.host?.version === byKey.A.version, inspect2?.host ?? null);
  run.report.add('boot2-capability-hmr-absent', inspect2?.capability?.hmr === 'absent', inspect2?.capability ?? null);
  run.report.add('boot2-update-path-restart-required', inspect2?.capability?.updatePath === 'restart-required', inspect2?.capability ?? null);
  run.report.add('boot2-discovery-target-R_B', inspect2?.target?.version === byKey.B.version && inspect2?.target?.commit === byKey.B.commit, inspect2?.target ?? null);
  run.report.add('boot2-can-begin-update', inspect2?.capability?.canBeginUpdate === true, inspect2?.capability ?? null);
  const hostEpochBeforeUpdate = inspect2?.host?.hostEpoch ?? null;

  // Real page + UI; start the update through the UI.
  const dataFixture = seedUserData(home, 'v1-nonhmr');
  const dataBefore = readUserData(home, dataFixture);
  evidence.dataPreservation = { before: dataBefore };
  run.page = trackPage(run, await openRealPage(context));
  const cdp = run.page.cdp;
  const initialUi = await readUpdateUi(cdp);
  run.report.add('update-section-present', initialUi.sectionPresent === true, { discovery: initialUi.discovery, identities: initialUi.identities });
  run.report.add('client-identity-embedded-A', (initialUi.identities?.[1]?.commitAttr ?? '') === expectedClient.A, { client: initialUi.identities?.[1] ?? null, expected: expectedClient.A });
  await captureScreenshot(cdp, 'A-update-available');

  const discovered = await waitForDiscoveredTarget(cdp, byKey.B.version, { timeoutMs: 60000 });
  run.report.add('discovery-target-R_B', discovered.ok === true, discovered.ok ? discovered.target : discovered.last?.target ?? null);
  const begin = await beginUpdateThroughUi(cdp, { expectVersion: byKey.B.version });
  evidence.dialogs.push({ step: 'nonhmr-A-to-B', dialog: begin.dialog, operationId: begin.operationId });
  recordAction('nonhmr-begin-update', { open: begin.open, confirm: begin.confirm, operationId: begin.operationId });
  run.report.add('ui-begin-created-operation', /^upd_[a-f0-9]{16}$/.test(String(begin.operationId)), begin.operationId);
  run.report.add('dialog-names-target-version', begin.dialogMatchesTargetVersion === true, begin.dialog);
  // Ruled acceptance: the confirmation body itself must state both the
  // profile-wide session impact and the restart semantics; structured
  // warnings[] are optional.
  const dialogBody = String(begin.dialog?.body ?? '');
  const dialogWarnsRestart = (dialogBody.includes('所有会话') || dialogBody.includes('所在会话'))
    && (dialogBody.includes('重启') || dialogBody.includes('restart'))
    || (begin.dialog?.warnings ?? []).length >= 2;
  run.report.add('dialog-warns-restart', dialogWarnsRestart === true, begin.dialog ?? null);

  const transitions = [];
  const pending = await waitForOperation(cdp, ['pending-restart', 'updated', 'verification-failed', 'failed', 'cancelled'], {
    timeoutMs: 180000,
    onTransition: (entry) => {
      transitions.push(entry);
      evidence.transitions.push({ step: 'nonhmr-A-to-B', at: entry.at, state: entry.state, observation: entry.observation });
      if (entry.state === 'updated') run.report.add('nonhmr-updated-before-restart-is-false', false, entry.observation);
    },
  });
  run.report.record('nonhmr-transition-sequence', transitions.map((entry) => entry.state));
  run.report.add('nonhmr-reaches-pending-restart', pending.state === 'pending-restart', { state: pending.state, observation: pending.observation });
  run.report.add('nonhmr-never-claims-updated', transitions.every((entry) => entry.state !== 'updated'), transitions.map((entry) => entry.state));
  // The operation card re-renders shortly after the terminal state; poll it.
  let uiPending = await readUpdateUi(cdp);
  const pendingUiStarted = Date.now();
  while (uiPending.operation?.state !== 'pending-restart' && Date.now() - pendingUiStarted < 10000) {
    await ensureUpdateSectionRendered(cdp, { timeoutMs: 3000, wantOperation: true }).catch(() => ({ ok: false }));
    await sleep(400);
    uiPending = await readUpdateUi(cdp);
  }
  evidence.uiPending = uiPending;
  run.report.add('ui-shows-pending-restart-not-success', uiPending.operation?.state === 'pending-restart' && uiPending.operation?.success !== 'true', uiPending.operation);
  run.report.add('ui-pending-restart-guidance-present', (uiPending.operation?.body ?? '').length > 0 || (uiPending.operation?.recovery ?? '').length > 0, { body: uiPending.operation?.body ?? null, recovery: uiPending.operation?.recovery ?? null });
  await captureScreenshot(cdp, 'pending-restart');

  // Disk new / running old: both ends still A; health still 1.2.1.
  const inspectPending = (await inspectFromPage(cdp)).data;
  const healthPending = (await healthFromPage(cdp)).data;
  const observePending = await context.probe.send({ id: 'nonhmr-observe-pending', action: 'observe', label: 'pending-restart' });
  run.report.add('pending-disk-installed-version-R_B', inspectPending?.installed?.version === byKey.B.version, inspectPending?.installed ?? null);
  run.report.add('pending-running-host-version-R_A', inspectPending?.host?.version === byKey.A.version, inspectPending?.host ?? null);
  run.report.add('pending-health-running-version-R_A', healthPending?.version === byKey.A.version, healthPending?.version ?? null);
  run.report.add('pending-profile-dependency-R_B', String(observePending.snapshot?.profile?.dependency ?? '').endsWith(byKey.B.commit), observePending.snapshot?.profile?.dependency ?? null);
  evidence.beforeRestart = { inspect: inspectPending, health: healthPending, profile: observePending.snapshot?.profile ?? null, hostEpochBeforeUpdate };

  // Real Host restart: persisted operation must resume; only then may UI report updated.
  await restartContextHost(context, { logNamePrefix: `${name}-final` });
  evidence.boots.push({ bootIndex: context.bootIndex, pid: context.host.pid, phase: 'after-pending-restart' });
  const route3 = await waitForRoute(context, { timeoutMs: 90000 });
  run.report.add('restart-routes-available', route3.ok === true, route3.ok ? { waitedMs: route3.waitedMs } : null);
  const inspectAfterRestart = (await probeInspect(context)).body;
  run.report.add('restart-running-version-R_B', inspectAfterRestart?.host?.version === byKey.B.version, inspectAfterRestart?.host ?? null);
  run.report.add('restart-host-commit-R_B', inspectAfterRestart?.host?.commit === byKey.B.commit, inspectAfterRestart?.host ?? null);
  run.report.add('restart-host-epoch-changed', inspectAfterRestart?.host?.hostEpoch !== hostEpochBeforeUpdate, { before: hostEpochBeforeUpdate, after: inspectAfterRestart?.host?.hostEpoch ?? null, note: 'informational only: never used as restart proof' });

  // Page reload after the Host restart; Client reports its own B identity.
  await reloadRealPage(run.page, context, { expectedClientCommit: expectedClient.B });
  const settled = await waitForOperation(cdp, ['updated', 'verification-failed', 'failed', 'cancelled'], { timeoutMs: 180000 });
  run.report.record('after-restart-transitions', settled.transitions?.map((entry) => entry.state) ?? []);
  run.report.add('after-restart-updated', settled.state === 'updated', { state: settled.state, observation: settled.observation });
  const finalInspect = (await inspectFromPage(cdp)).data;
  const finalHealth = (await healthFromPage(cdp)).data;
  const finalUi = await readUpdateUi(cdp);
  run.report.add('final-host-running-R_B', finalInspect?.host?.version === byKey.B.version && finalInspect?.host?.commit === byKey.B.commit, finalInspect?.host ?? null);
  run.report.add('final-health-version-R_B', finalHealth?.version === byKey.B.version, finalHealth?.version ?? null);
  run.report.add('final-client-version-R_B', (finalUi.identities?.[1]?.version ?? '').includes(byKey.B.version), finalUi.identities?.[1] ?? null);
  run.report.add('final-client-build-commit', finalUi.identities?.[1]?.commitAttr === expectedClient.B, { commitAttr: finalUi.identities?.[1]?.commitAttr ?? null, expected: expectedClient.B });
  run.report.add('final-ui-updated', finalUi.operation?.state === 'updated', finalUi.operation);
  await captureScreenshot(cdp, 'updated-after-restart');
  evidence.afterRestart = { inspect: finalInspect, health: finalHealth, ui: finalUi };

  const dataAfter = readUserData(home, dataFixture);
  const preservation = userDataPreserved(dataBefore, dataAfter);
  evidence.dataPreservation.after = dataAfter;
  run.report.add('user-data-preserved-across-update-and-restart', preservation.preserved === true, preservation);
}

try {
  ensureDir(run.runDir);
  ensureDir(RAW_ROOT);
  await body();
} catch (error) {
  thrown = error;
  run.report.add('scenario-completed-without-throw', false, String(error && error.stack ? error.stack : error));
} finally {
  const cleanup = await cleanupRun(run);
  evidence.cleanup = cleanup;
  run.report.add('cleanup-proven', cleanup.proof?.ok === true, cleanup.proof);
  if (run.transport) {
    try {
      await run.transport.close();
    } catch (error) {
      run.report.add('transport-close', false, String(error && error.message ? error.message : error));
    }
  }
  if (run.tls) removeFixtureTls(run.tls);
  const transportProof = await cleanupProof({ ports: [run.transport?.port].filter((port) => Number.isInteger(port)), dirs: [run.tlsDir].filter(Boolean), label: 'v1-nonhmr-transport-cleanup' });
  run.report.add('transport-and-tls-cleaned', transportProof.ok === true, transportProof);
  evidence.thrown = thrown === null ? null : String(thrown.stack ?? thrown);
  const summary = finalizeRun({
    report: run.report,
    evidenceRel: run.evidenceRel,
    runDir: run.runDir,
    extra: {
      runTag: run.runTag,
      targets,
      evidenceLevel: 'isolated-browser (real installed DSH runtime + real DSH page + real Client UI clicks + real Host restart) + isolated transport fixture',
      notProven: ['real Desktop/Electron main process (isolated dsh web only)', 'production official index content (fixture transport)'],
      targetIdentities: evidence.targetIdentities,
      boots: evidence.boots,
      installs: evidence.installs,
      transitions: evidence.transitions,
      dialogs: evidence.dialogs,
      uiActions: evidence.uiActions,
      dataPreservation: evidence.dataPreservation,
      beforeRestart: evidence.beforeRestart,
      afterRestart: evidence.afterRestart,
      screenshots: evidence.screenshots,
      cleanup,
      thrown: evidence.thrown,
      environment: { node: process.version, platform: process.platform, repoRoot: REPO_ROOT },
    },
  });
  process.exitCode = summary.summary.passed ? 0 : 1;
}
