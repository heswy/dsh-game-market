#!/usr/bin/env node
/**
 * M3-V1 HMR update chain: install R_A -> real Client UI update to R_B ->
 * real Client UI update to R_final (version 1.3.0).
 *
 * Requirements exercised (task-6 / docs/verification/v1.5/m3-decisions.md §6):
 *   - one-time exact-commit install of A into a FRESH isolated profile by the
 *     real pluginManager (via the independent probe operator);
 *   - both updates are started through the REAL Client UI (banner -> confirm
 *     dialog -> confirm), never a direct begin API call;
 *   - per step: applied -> activating -> stale-runtime(client-old) while the
 *     page still runs the old Client -> real UI refresh page -> updated with
 *     Host running identity (loadedVersion+buildCommit), Client self-reported
 *     identity (from its own built bundle) and /health all matching the target;
 *   - `applied` is never treated as success; the probe operator survives every
 *     HMR dispose/re-apply; user data is preserved; cleanup is proven.
 *
 * Preconditions (not-run semantics if absent): the probe release commits
 * R_A/R_B and PR head R_final are pushed and present in this repo. The runner
 * records a required failure and exits non-zero instead of faking a pass.
 *
 * Usage:
 *   node scripts/verification/v1.5/m3/run-v1-hmr-chain.mjs \
 *     --a <R_A> --b <R_B> --final <R_final> \
 *     [--version-a 1.2.1 --version-b 1.2.2 --version-final 1.3.0]
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  RAW_ROOT,
  REPO_ROOT,
  RUNS_ROOT,
  SHOT_DIR,
  bootProbeHost,
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
  clickAction,
  cleanupRun,
  createRunContext,
  healthFromPage,
  inspectFromPage,
  makeScenarioEnvironment,
  openRealPage,
  parseTargets,
  probeInspect,
  readReleaseIdentity,
  readUpdateUi,
  readUserData,
  refreshDiscoveryThroughUi,
  reloadRealPage,
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
} from './v1-common.mjs';
import { removeFixtureTls } from './fixture.mjs';

const run = createRunContext('v1-hmr-chain');
const targets = parseTargets(process.argv.slice(2));
const refs = targetRefs(targets);
const byKey = Object.fromEntries(refs.map((ref) => [ref.key, ref]));
const REPORT = createReport({
  id: 'M3-V1-hmr-chain',
  title: 'HMR update chain R_A -> R_B -> R_final driven through the real Client UI',
  commands: [`node scripts/verification/v1.5/m3/run-v1-hmr-chain.mjs --a ${targets.a} --b ${targets.b} --final ${targets.final}`],
});
attachReport(run, REPORT);

const evidence = {
  targets: refs,
  targetIdentities: null,
  installs: [],
  steps: [],
  transitions: [],
  dialogs: [],
  uiActions: [],
  screenshots: [],
  identity: {},
  dataPreservation: null,
  final: null,
  cleanup: null,
  thrown: null,
};
let thrown = null;

function gitRun(args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function recordAction(name, result, extra = {}) {
  evidence.uiActions.push({ name, at: new Date().toISOString(), result, ...extra });
}

async function captureScreenshot(cdp, name) {
  ensureDir(SHOT_DIR);
  const file = path.join(SHOT_DIR, `M3-V1-hmr-chain-${run.runTag}-${name}.png`);
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
    hasClientJs: gitRun(['cat-file', '-e', `${ref.commit}:client.js`]) !== null,
  }));
  evidence.targetIdentities = identities;
  for (const identity of identities) {
    run.report.add(`target-${identity.key}-commit-exists`, identity.exists === true, { commit: identity.commit });
    run.report.add(`target-${identity.key}-version`, identity.packageVersion === identity.version, { actual: identity.packageVersion, expected: identity.version });
    run.report.add(`target-${identity.key}-release-identity`, identity.release?.schemaVersion === 1 && /^[0-9a-f]{40}$/.test(String(identity.release?.clientBuildCommit)), identity.release);
  }
  const allExist = identities.every((identity) => identity.exists === true);
  run.report.add('precondition-probe-releases-available', allExist, { note: 'R_A/R_B/R_final must be pushed and present before V1 can run (not-run otherwise)' });
  return { identities, allExist };
}

async function installBaseRelease(context) {
  const install = await context.probe.send({
    id: 'install-base-a',
    action: 'install',
    spec: byKey.A.spec,
    requestId: `m3-v1-hmr-install-a-${run.runTag}`,
    enabled: true,
  }, { timeoutMs: 420000 });
  evidence.installs.push({ phase: 'install-R_A', result: install.result ?? null, elapsedMs: install.elapsedMs ?? null });
  run.report.add('install-R_A-applied', install.result?.application === 'applied', install.result?.application ?? null);
  run.report.add('install-R_A-version', install.result?.version === byKey.A.version, install.result?.version ?? null);
  run.report.add('install-R_A-pnpm-exit-zero', install.result?.packageResult?.exitCode === 0, install.result?.packageResult?.exitCode ?? null);
  return install.result ?? null;
}

/**
 * Run one update step through the real UI and verify the full identity chain.
 * `expectOldClient` is true for HMR steps (page must be reloaded before updated).
 */
async function runUiUpdateStep({ key, label, expectedClientCommit }) {
  const cdp = run.page.cdp;
  const step = { key, label, startedAt: new Date().toISOString() };

  const discovered = await waitForDiscoveredTarget(cdp, byKey[key].version, { timeoutMs: 60000 });
  run.report.add(`${label}-discovery-target-version`, discovered.ok === true, discovered.ok ? discovered.target : discovered.last?.target ?? null);
  run.report.add(`${label}-discovery-target-commit`, discovered.target?.commit === byKey[key].commit, { commit: discovered.target?.commit ?? null, expected: byKey[key].commit });
  step.discovered = discovered;

  const before = await readUpdateUi(cdp);
  step.uiBefore = before;
  run.report.add(`${label}-update-banner-present`, before.banner !== null, before.banner);

  const begin = await beginUpdateThroughUi(cdp, { expectVersion: byKey[key].version });
  evidence.dialogs.push({ step: label, dialog: begin.dialog, operationId: begin.operationId });
  recordAction(`${label}-begin`, { open: begin.open, confirm: begin.confirm, operationId: begin.operationId, banner: begin.banner });
  step.begin = { banner: begin.banner, dialog: begin.dialog, operationId: begin.operationId };
  run.report.add(`${label}-ui-begin-created-operation`, /^upd_[a-f0-9]{16}$/.test(String(begin.operationId)), begin.operationId);
  run.report.add(`${label}-dialog-names-target-version`, begin.dialogMatchesTargetVersion === true, begin.dialog);
  run.report.add(`${label}-dialog-warns-all-sessions`, (begin.dialog?.warnings ?? []).length >= 2, begin.dialog?.warnings ?? null);
  const dialogMentionsCommit = JSON.stringify(begin.dialog ?? {}).includes(byKey[key].commit);
  run.report.add(`${label}-dialog-names-target-commit`, dialogMentionsCommit === true, begin.dialog?.meta ?? null);

  // Host transition log; `applied` must stay an intermediate state.
  const transitions = [];
  const intermediate = await waitForOperation(cdp, ['stale-runtime', 'updated', 'verification-failed', 'pending-restart', 'already-at-target', 'failed', 'cancelled'], {
    timeoutMs: 180000,
    onTransition: (entry) => {
      transitions.push(entry);
      evidence.transitions.push({ step: label, at: entry.at, state: entry.state, observation: entry.observation });
      if (entry.state === 'applied') {
        run.report.add(`${label}-applied-is-not-success`, entry.observation?.success !== true, entry.observation);
      }
    },
  });
  step.transitions = transitions;
  run.report.record(`${label}-transition-sequence`, transitions.map((entry) => entry.state));
  run.report.add(`${label}-saw-install-progress`, transitions.some((entry) => ['installing', 'applied', 'activating'].includes(entry.state)), transitions.map((entry) => entry.state));

  const inspectAfterInstall = (await inspectFromPage(cdp)).data;
  const healthAfterInstall = (await healthFromPage(cdp)).data;
  step.inspectAfterInstall = inspectAfterInstall;
  step.healthAfterInstall = healthAfterInstall;
  run.report.add(`${label}-host-installed-version`, inspectAfterInstall?.installed?.version === byKey[key].version, inspectAfterInstall?.installed?.version ?? null);
  run.report.add(`${label}-host-running-version`, inspectAfterInstall?.host?.version === byKey[key].version, inspectAfterInstall?.host?.version ?? null);
  run.report.add(`${label}-host-running-commit`, inspectAfterInstall?.host?.commit === byKey[key].commit, { commit: inspectAfterInstall?.host?.commit ?? null, expected: byKey[key].commit });
  run.report.add(`${label}-health-version`, healthAfterInstall?.version === byKey[key].version, healthAfterInstall?.version ?? null);

  // Old Client + new Host: must be stale-runtime(client-old), never "updated".
  const reached = intermediate.state;
  run.report.add(`${label}-old-client-not-reported-as-success`, reached === 'stale-runtime', { reached });
  run.report.add(`${label}-stale-runtime-reason-client-old`, intermediate.observation?.reason === 'client-old', intermediate.observation ?? null);
  const uiAtStale = await readUpdateUi(cdp);
  step.uiAtStale = uiAtStale;
  run.report.add(`${label}-ui-operation-not-marked-success`, uiAtStale.operation !== null && uiAtStale.operation.success !== 'true', uiAtStale.operation);
  run.report.add(`${label}-ui-shows-stale-runtime`, uiAtStale.operation?.state === 'stale-runtime', uiAtStale.operation?.state ?? null);
  step.clientIdentityBeforeRefresh = uiAtStale.identities;
  run.report.add(`${label}-client-still-runs-old-build`, (uiAtStale.identities?.[1]?.commitAttr ?? '') !== expectedClientCommit, { client: uiAtStale.identities?.[1] ?? null });
  await captureScreenshot(cdp, `${label}-stale-runtime`);

  // Only the real UI refresh action may move the page to the new Client build.
  const refresh = await clickAction(cdp, 'refresh-page', `${label}-refresh-page`);
  recordAction(`${label}-refresh-page`, refresh);
  run.report.add(`${label}-ui-refresh-action-clicked`, refresh.clicked === true, refresh);
  const reloaded = await reloadRealPage(run.page, run.context);
  run.report.add(`${label}-page-reloaded`, reloaded?.opened === true, reloaded);
  if (reloaded?.opened) await run.page.cdp.send('Runtime.evaluate', { expression: 'void 0' }).catch(() => {});

  const settled = await waitForOperation(cdp, ['updated', 'verification-failed', 'failed', 'cancelled', 'stale-runtime'], { timeoutMs: 180000 });
  step.terminal = settled;
  run.report.add(`${label}-updated-reached-after-refresh`, settled.state === 'updated', { state: settled.state, observation: settled.observation });

  const finalInspect = (await inspectFromPage(cdp)).data;
  const finalUi = await readUpdateUi(cdp);
  const finalHealth = (await healthFromPage(cdp)).data;
  step.final = { inspect: finalInspect, ui: finalUi, health: finalHealth };
  run.report.add(`${label}-final-host-identity`, finalInspect?.host?.version === byKey[key].version && finalInspect?.host?.commit === byKey[key].commit, finalInspect?.host);
  run.report.add(`${label}-final-health-version`, finalHealth?.version === byKey[key].version, finalHealth?.version);
  run.report.add(`${label}-final-client-version`, (finalUi.identities?.[1]?.version ?? '').includes(byKey[key].version), finalUi.identities?.[1] ?? null);
  run.report.add(`${label}-final-client-build-commit`, finalUi.identities?.[1]?.commitAttr === expectedClientCommit, { commitAttr: finalUi.identities?.[1]?.commitAttr ?? null, expected: expectedClientCommit });
  run.report.add(`${label}-final-ui-updated`, finalUi.operation?.state === 'updated', finalUi.operation);
  await captureScreenshot(cdp, `${label}-updated`);
  evidence.steps.push(step);
  return step;
}

async function body() {
  const identity = verifyRuntime();
  run.report.add('runtime-extraction-matches-installed-app', identity.extractionVerifiedAgainstInstalledApp, identity.mismatched);

  const targetState = recordTargetIdentities();
  if (!targetState.allExist) throw new Error('probe release commits are not available locally (V1 not-run precondition)');
  const expectedClient = Object.fromEntries(targetState.identities.map((item) => [item.key, item.release?.clientBuildCommit ?? null]));

  // Transport fixture starts with target R_B (A sees an update immediately).
  const env = makeScenarioEnvironment(run.runTag);
  run.tls = env.tls;
  run.tlsDir = env.tlsDir;
  run.transport = await startTransport(env);
  run.transport.control.setFixtureBody(buildIndexBody({ versions: [{ version: byKey.B.version, commit: byKey.B.commit }] }));
  run.report.add('transport-fixture-up', Boolean(run.transport.port), { port: run.transport.port });

  // Fresh isolated profile; real install of R_A by exact commit.
  const name = `v1-hmr-${run.runTag}`;
  const home = await makeIsolatedHome(name, { port: await freePort() });
  const context = { name, home, host: null, probe: null, boot: null, hostPort: null, bootIndex: 1, transport: run.transport };
  run.context = context;
  trackHost(run, context);
  run.report.add('fresh-isolated-home', home.startsWith('/tmp/dsh-v15/m3/'), home);

  const boot1 = await bootProbeHost({
    name,
    home,
    runDir: path.join(RUNS_ROOT, run.runTag, 'boot1'),
    bootTag: `${name}-boot1`,
    port: await freePort(),
    env: run.transport.envForHost({ marker: run.runTag }),
    pluginMode: 'none',
    logName: `${name}-boot1`,
  });
  context.host = boot1.host;
  context.probe = boot1.probe;
  context.boot = boot1.boot;
  context.hostPort = boot1.host.port;
  run.report.add('probe-operator-booted', boot1.boot?.pid > 0, { pid: boot1.boot?.pid ?? null });
  run.report.add('hmr-capability-present', boot1.boot?.capability?.managerContextHmr === true, boot1.boot?.capability ?? null);

  await installBaseRelease(context);
  const applied = await waitForHostVersion(context.probe, byKey.A.version, { timeoutMs: 240000 });
  run.report.add('R_A-applied-to-disk-and-running', applied.ok === true, applied.ok ? { waitedMs: applied.waitedMs } : applied.last);
  const routeReady = await waitForRoute(context, { timeoutMs: 90000 });
  run.report.add('update-routes-available', routeReady.ok === true, routeReady.ok ? { waitedMs: routeReady.waitedMs } : null);
  const baseInspect = (await probeInspect(context)).body;
  run.report.add('capability-can-begin-update', baseInspect?.capability?.canBeginUpdate === true, baseInspect?.capability);
  run.report.add('discovery-target-is-R_B', baseInspect?.target?.version === byKey.B.version && baseInspect?.target?.commit === byKey.B.commit, baseInspect?.target);
  evidence.identity.afterInstallA = { inspect: baseInspect };

  // User data fixture after A is installed; updates must preserve it.
  const dataFixture = seedUserData(home, 'v1-hmr');
  const dataBefore = readUserData(home, dataFixture);
  evidence.dataPreservation = { before: dataBefore };

  // Real page + UI.
  run.page = trackPage(run, await openRealPage(context));
  const cdp = run.page.cdp;
  const initialUi = await readUpdateUi(cdp);
  run.report.add('real-page-market-panel-opened', run.page.marketOpened?.opened === true, run.page.marketOpened);
  run.report.add('update-section-present', initialUi.sectionPresent === true, { discovery: initialUi.discovery, identities: initialUi.identities });
  run.report.add('client-identity-embedded-A', (initialUi.identities?.[1]?.commitAttr ?? '') === expectedClient.A, { client: initialUi.identities?.[1] ?? null, expected: expectedClient.A });
  await captureScreenshot(cdp, 'A-update-available');

  // Step 1: A -> B through the real UI.
  await runUiUpdateStep({ key: 'B', label: 'update-A-to-B', expectedClientCommit: expectedClient.B });

  // Fixture switch to R_final and a real UI discovery refresh after the throttle.
  run.transport.control.setFixtureBody(buildIndexBody({ versions: [{ version: byKey.FINAL.version, commit: byKey.FINAL.commit }] }));
  const refresh = await refreshDiscoveryThroughUi(cdp, { maxWaitMs: 150000 });
  recordAction('refresh-discovery-to-final', refresh);
  run.report.add('discovery-refresh-clicked-after-throttle', refresh.clicked === true, { waitedMs: refresh.waitedMs });
  const finalDiscovered = await waitForDiscoveredTarget(cdp, byKey.FINAL.version, { timeoutMs: 120000 });
  run.report.add('discovery-target-updated-to-R_final', finalDiscovered.ok === true && finalDiscovered.target?.commit === byKey.FINAL.commit, finalDiscovered.ok ? finalDiscovered.target : finalDiscovered.last?.target ?? null);

  // Step 2: B -> R_final through the real UI.
  await runUiUpdateStep({ key: 'FINAL', label: 'update-B-to-final', expectedClientCommit: expectedClient.FINAL });

  const dataAfter = readUserData(home, dataFixture);
  const preservation = userDataPreserved(dataBefore, dataAfter);
  evidence.dataPreservation.after = dataAfter;
  run.report.add('user-data-preserved-across-both-updates', preservation.preserved === true, preservation);
  const finalInspect = (await probeInspect(context)).body;
  run.report.add('final-host-runs-R_final', finalInspect?.host?.version === byKey.FINAL.version && finalInspect?.host?.commit === byKey.FINAL.commit, finalInspect?.host);
  run.report.add('probe-operator-survived-all-updates', Number.isInteger(Number(boot1.boot?.pid)) && finalInspect?.host !== null, { operatorPid: boot1.boot?.pid ?? null });
  evidence.final = { inspect: finalInspect, ui: await readUpdateUi(cdp), health: (await healthFromPage(cdp)).data };
  await captureScreenshot(cdp, 'final-updated');
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
  const transportProof = await cleanupProof({ ports: [run.transport?.port].filter((port) => Number.isInteger(port)), dirs: [run.tlsDir].filter(Boolean), label: 'v1-hmr-transport-cleanup' });
  run.report.add('transport-and-tls-cleaned', transportProof.ok === true, transportProof);
  evidence.thrown = thrown === null ? null : String(thrown.stack ?? thrown);

  const summary = finalizeRun({
    report: run.report,
    evidenceRel: run.evidenceRel,
    runDir: run.runDir,
    extra: {
      runTag: run.runTag,
      targets,
      evidenceLevel: 'isolated-browser (real installed DSH runtime + real DSH page + real Client UI clicks) + isolated transport fixture',
      notProven: ['real Desktop/Electron main process (isolated dsh web only)', 'production official index content (fixture transport)'],
      targetIdentities: evidence.targetIdentities,
      installs: evidence.installs,
      steps: evidence.steps,
      transitions: evidence.transitions,
      dialogs: evidence.dialogs,
      uiActions: evidence.uiActions,
      identity: evidence.identity,
      dataPreservation: evidence.dataPreservation,
      screenshots: evidence.screenshots,
      final: evidence.final,
      cleanup,
      thrown: evidence.thrown,
      environment: { node: process.version, platform: process.platform, repoRoot: REPO_ROOT },
    },
  });
  process.exitCode = summary.summary.passed ? 0 : 1;
}
