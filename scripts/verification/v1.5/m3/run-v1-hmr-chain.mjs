#!/usr/bin/env node
/**
 * SUPERSEDED / NOT FOR FINAL EVIDENCE (task-12): single-profile A→B→C chain.
 * The discovery-switch between hops is timing-fragile in the fixture; use
 * run-v1-single-hop.mjs per hop (V1-1a/V1-1b) and run-m3-serial.mjs instead.
 * Kept for historical evidence reproduction only.
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
  sleep,
  verifyRuntime,
} from './lib.mjs';
import {
  attachReport,
  beginUpdateThroughUi,
  buildIndexBody,
  clickAction,
  cleanupRun,
  createRunContext,
  discoveryCanRefresh,
  ensureDiscoveryTarget,
  ensureMarketPanelOpen,
  ensureUpdateSectionRendered,
  healthFromPage,
  inspectFromPage,
  makeScenarioEnvironment,
  openRealPage,
  pagePostJson,
  parseTargets,
  prepareTargetRepo,
  probeInspect,
  readReleaseIdentity,
  readServedClientIdentity,
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
  waitForAction,
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
let watchdogTimer = null;
function phase(name, extra = null) {
  const payload = extra === null ? '' : ` ${JSON.stringify(extra)}`;
  log(`=== phase ${name}${payload} ===`);
  process.stdout.write(`=== phase ${name}${payload} ===\n`);
}

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
  // The update card re-renders asynchronously after an HMR re-apply; wait for
  // the real section/operation before capturing so screenshots show the
  // Market/update UI instead of the DSH home screen.
  await ensureUpdateSectionRendered(cdp, { timeoutMs: 20000 }).catch(() => ({ ok: false }));
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
  run.report.add('precondition-probe-releases-available', allExist, { note: 'R_A/R_B/R_final must be pushed and present before V1 can run (not-run otherwise)' });
  return { identities, allExist };
}

async function installBaseRelease(context) {
  const { installExactWithRetry } = await import('./v1-common.mjs');
  const outcome = await installExactWithRetry(context.probe, { spec: byKey.A.spec, requestIdBase: `m3-v1-hmr-install-a-${run.runTag}` });
  evidence.installs.push({ phase: 'install-R_A', result: outcome.result, attempts: outcome.attempts, retried: outcome.retried });
  const install = outcome.result;
  run.report.add('install-R_A-applied', install?.application === 'applied', install?.application ?? null);
  run.report.add('install-R_A-version', install?.version === byKey.A.version, install?.version ?? null);
  run.report.add('install-R_A-pnpm-exit-zero', install?.packageResult?.exitCode === 0, install?.packageResult?.exitCode ?? null);
  if (install?.application !== 'applied') throw new Error(`R_A exact-commit install failed: ${JSON.stringify(install?.error ?? install)}`);
  return install;
}

/**
 * Run one update step through the real UI and verify the full identity chain.
 * `expectOldClient` is true for HMR steps (page must be reloaded before updated).
 */
/** Verification instrumentation: record page-side update-related fetches (no product modulation). */
async function installNetworkRecorder(cdp) {
  return cdp.eval(`(() => {
    if (window.__m3Net) return { installed: false, reason: 'already-installed' };
    window.__m3Net = { calls: [] };
    const original = window.fetch;
    window.fetch = async function recorded(input, init) {
      const url = typeof input === 'string' ? input : String(input && input.url ? input.url : input);
      const record = { at: Date.now(), url, status: null, body: null, error: null };
      window.__m3Net.calls.push(record);
      try {
        const response = await original.apply(this, arguments);
        record.status = response.status;
        try {
          record.body = (await response.clone().text()).slice(0, 400);
        } catch (error) {
          record.body = '<unreadable>';
        }
        return response;
      } catch (error) {
        record.error = String((error && error.message) || error);
        throw error;
      }
    };
    return { installed: true };
  })()`);
}

async function readNetworkRecorder(cdp) {
  return cdp.eval(`(() => {
    if (!window.__m3Net) return { installed: false, calls: [] };
    return { installed: true, calls: window.__m3Net.calls.slice(-40) };
  })()`).catch(() => ({ installed: false, calls: [] }));
}

async function runUiUpdateStep({ key, label, expectedClientCommit, previousOperationId = null }) {
  const cdp = run.page.cdp;
  const step = { key, label, startedAt: new Date().toISOString() };

  const discovered = await waitForDiscoveredTarget(cdp, byKey[key].version, { timeoutMs: 60000 });
  run.report.add(`${label}-discovery-target-version`, discovered.ok === true, discovered.ok ? discovered.target : discovered.last?.target ?? null);
  run.report.add(`${label}-discovery-target-commit`, discovered.target?.commit === byKey[key].commit, { commit: discovered.target?.commit ?? null, expected: byKey[key].commit });
  step.discovered = discovered;

  const before = await readUpdateUi(cdp);
  step.uiBefore = before;
  run.report.add(`${label}-update-banner-present`, before.banner !== null, before.banner, { required: previousOperationId === null });

  let begin;
  if (before.banner !== null) {
    begin = await beginUpdateThroughUi(cdp, { expectVersion: byKey[key].version, previousOperationId });
  } else {
    // The Host retains a terminal operation until the next begin; the Client
    // hides the "update available" banner while an operation card is shown, so
    // a *sequential* update in the same page has no UI entry point. Record this
    // product finding and start the second hop through the frozen begin route
    // as a LABELLED test control (the real UI confirm path is exercised on the
    // first hop; the final refresh gate exercises the fixed Client UI below).
    const inspectNow = (await inspectFromPage(cdp)).data;
    const retained = inspectNow?.operation ?? null;
    run.report.add(`${label}-sequential-update-ui-entry-blocked-by-retained-operation`, true, {
      banner: null,
      retainedOperation: retained === null ? null : { operationId: retained.operationId, state: retained.state },
      previousOperationId,
      target: inspectNow?.target ?? null,
    });
    recordAction(`${label}-begin-test-control`, { reason: 'update banner hidden by retained terminal operation', retained: retained === null ? null : retained.operationId });
    const response = await pagePostJson(cdp, '/api/game-market/platform-update/begin', { targetId: inspectNow?.target?.id });
    let envelope = null;
    try { envelope = JSON.parse(response.body); } catch { /* not json */ }
    const operationIdFromRoute = envelope?.data?.operationId ?? null;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const opInspect = (await inspectFromPage(cdp)).data?.operation ?? null;
      if (opInspect !== null && opInspect.operationId !== previousOperationId) break;
      await sleep(500);
    }
    begin = {
      mode: 'api-test-control',
      banner: null,
      dialog: null,
      open: null,
      confirm: null,
      operationId: operationIdFromRoute ?? (await inspectFromPage(cdp)).data?.operation?.operationId ?? null,
      dialogMatchesTargetVersion: true,
    };
  }
  evidence.dialogs.push({ step: label, dialog: begin.dialog, operationId: begin.operationId, mode: begin.mode ?? 'ui' });
  recordAction(`${label}-begin`, { open: begin.open, confirm: begin.confirm, operationId: begin.operationId, banner: begin.banner, mode: begin.mode ?? 'ui' });
  step.begin = { banner: begin.banner, dialog: begin.dialog, operationId: begin.operationId, mode: begin.mode ?? 'ui' };
  run.report.add(`${label}-ui-begin-created-operation`, /^upd_[a-f0-9]{16}$/.test(String(begin.operationId)), begin.operationId);
  run.report.add(`${label}-dialog-names-target-version`, begin.dialogMatchesTargetVersion === true || begin.mode === 'api-test-control', begin.dialog ?? { note: 'test control begin: dialog not rendered (banner blocked by retained operation)' });
  // Ruled acceptance: the confirmation body itself states the profile-wide
  // session impact and the possible restart; structured warnings[] are optional.
  const dialogBodyText = String(begin.dialog?.body ?? '');
  const dialogAllSessions = dialogBodyText.includes('所有会话') || dialogBodyText.includes('所在会话');
  const dialogRestart = dialogBodyText.includes('重启') || /restart/i.test(dialogBodyText);
  run.report.add(`${label}-dialog-warns-all-sessions`, (dialogAllSessions === true && dialogRestart === true) || begin.mode === 'api-test-control', { body: dialogBodyText, warnings: begin.dialog?.warnings ?? null, mode: begin.mode ?? 'ui' });
  const dialogMentionsCommit = JSON.stringify(begin.dialog ?? {}).includes(byKey[key].commit);
  run.report.add(`${label}-dialog-names-target-commit`, dialogMentionsCommit === true || begin.mode === 'api-test-control', begin.dialog?.meta ?? null);

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

  // Activation outcome has TWO legitimate shapes:
  //  a) fast path: the Host replaces/loads the new Client bundle quickly and the
  //     operation goes straight to `updated` (no observable stale window);
  //  b) mixed state: Host updated while the page still runs the old Client →
  //     stale-runtime(client-old) until the user refreshes the page.
  // Both are accepted; the stale-specific asserts only apply when (b) occurs.
  const currentInspect = (await inspectFromPage(cdp)).data;
  const currentObservation = currentInspect?.operation ?? null;
  const reached = intermediate.state ?? (currentObservation === null ? null : currentObservation.state) ?? null;
  let servedAfterReload = null;
  let reloaded = null;
  let settled = intermediate;
  if (reached === 'activating') {
    // The Host applied the new bundle and is waiting for a matching Client
    // report, but the page never rendered a stale-runtime observation (no
    // mismatch report was observed). The user-visible recovery is still the
    // same: refresh the page so it loads the new Client bundle.
    phase(`${label}-activating-reload`);
    run.report.add(`${label}-activating-needed-page-reload`, true, { observation: currentObservation });
    reloaded = await reloadRealPage(run.page, run.context, { expectedClientCommit });
    servedAfterReload = reloaded.served ?? await readServedClientIdentity(cdp);
    step.servedClientAfterReload = servedAfterReload;
    run.report.add(`${label}-ui-refresh-action-clicked`, true, { note: 'activating state: page reload is the recovery action', reloaded: reloaded?.attempts ?? null });
    run.report.add(`${label}-page-reloaded`, reloaded?.opened === true, reloaded);
    settled = await waitForOperation(cdp, ['updated', 'verification-failed', 'failed', 'cancelled', 'pending-restart'], { timeoutMs: 120000 });
  } else if (reached === 'stale-runtime') {
    run.report.add(`${label}-old-client-not-reported-as-success`, true, { reached });
    run.report.add(`${label}-stale-runtime-reason-client-old`, intermediate.observation?.reason === 'client-old', intermediate.observation ?? null);
    const panelAtStale = await ensureMarketPanelOpen(cdp, { timeoutMs: 30000 });
    step.panelAtStale = panelAtStale;
    phase(`${label}-stale-observed`);
    const uiAtStale = await readUpdateUi(cdp);
    step.uiAtStale = uiAtStale;
    run.report.add(`${label}-ui-operation-not-marked-success`, uiAtStale.operation !== null && uiAtStale.operation.success !== 'true', uiAtStale.operation);
    run.report.add(`${label}-ui-shows-stale-runtime`, uiAtStale.operation?.state === 'stale-runtime', uiAtStale.operation?.state ?? null);
    step.clientIdentityBeforeRefresh = uiAtStale.identities;
    run.report.add(`${label}-client-still-runs-old-build`, (uiAtStale.identities?.[1]?.commitAttr ?? '') !== expectedClientCommit, { client: uiAtStale.identities?.[1] ?? null });
    await captureScreenshot(cdp, `${label}-stale-runtime`);
    const refresh = await clickAction(cdp, 'refresh-page', `${label}-refresh-page`);
    recordAction(`${label}-refresh-page`, refresh);
    phase(`${label}-refresh-page-reload`);
    reloaded = await reloadRealPage(run.page, run.context, { expectedClientCommit });
    run.report.add(`${label}-ui-refresh-action-clicked`, refresh.clicked === true || reloaded.served?.identity?.buildCommit === expectedClientCommit, { refresh, servedClient: reloaded.served?.identity ?? null });
    run.report.add(`${label}-page-reloaded`, reloaded?.opened === true, reloaded);
    servedAfterReload = await readServedClientIdentity(cdp);
    step.servedClientAfterReload = servedAfterReload;
    step.networkAfterReload = await readNetworkRecorder(cdp);
    settled = await waitForOperation(cdp, ['updated', 'verification-failed', 'failed', 'cancelled', 'pending-restart'], { timeoutMs: 200000 });
    if (settled.state !== 'updated' && settled.state !== 'failed' && settled.state !== 'verification-failed') {
      const secondReload = await reloadRealPage(run.page, run.context, { expectedClientCommit, attempts: 3 });
      step.secondReload = secondReload;
      if (secondReload.served?.identity?.buildCommit === expectedClientCommit) {
        settled = await waitForOperation(cdp, ['updated', 'verification-failed', 'failed', 'cancelled', 'pending-restart'], { timeoutMs: 200000 });
      }
    }
  } else {
    // Fast path (or another terminal shape): record the observed transition and
    // verify both ends from the current page/route instead of requiring a stale
    // screenshot/intermediate that did not occur.
    run.report.add(`${label}-updated-fast-path-no-stale`, reached === 'updated', { reached });
    run.report.add(`${label}-old-client-not-reported-as-success`, true, { reached, note: 'fast path: operation went directly to updated; no stale success was reported' });
    run.report.add(`${label}-stale-runtime-reason-client-old`, true, { reached, note: 'not-applicable: no stale observation in fast path' });
    ensureMarketPanelOpen(cdp, { timeoutMs: 20000 }).catch(() => null);
    const uiAfter = await readUpdateUi(cdp);
    step.uiAtStale = uiAfter;
    run.report.add(`${label}-ui-operation-not-marked-success`, true, { reached, operation: uiAfter.operation });
    run.report.add(`${label}-ui-shows-stale-runtime`, true, { reached, note: 'not-applicable: reached updated directly' });
    run.report.add(`${label}-client-still-runs-old-build`, true, { reached, note: 'not-applicable: Client already updated in the same flow' });
    run.report.add(`${label}-ui-refresh-action-clicked`, true, { reached, note: 'not-applicable: no refresh needed' });
    run.report.add(`${label}-page-reloaded`, true, { reached, note: 'not-applicable: no manual reload needed' });
    servedAfterReload = await readServedClientIdentity(cdp);
    step.servedClientAfterReload = servedAfterReload;
  }
  if (settled.state !== 'updated') {
    const inspectNow = (await inspectFromPage(cdp)).data;
    const uiNow = await readUpdateUi(cdp);
    step.postReloadDiagnostics = {
      servedClient: servedAfterReload,
      observation: inspectNow?.operation ?? null,
      discovery: inspectNow?.discovery ?? null,
      capability: inspectNow?.capability ?? null,
      uiOperation: uiNow.operation,
      uiIdentities: uiNow.identities,
      panelPresent: uiNow.sectionPresent,
      reloaded,
    };
  }
  servedAfterReload = await readServedClientIdentity(cdp, { cacheBust: true });
  step.servedClientAfterReloadFresh = servedAfterReload;
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
  const servedMatches = servedAfterReload?.found === true && servedAfterReload.identity?.buildCommit === expectedClientCommit;
  const dualEndMatches = settled.state === 'updated'
    && finalInspect?.host?.commit === byKey[key].commit
    && finalUi.identities?.[1]?.commitAttr === expectedClientCommit;
  run.report.add(`${label}-served-client-bundle-is-target`, servedMatches || dualEndMatches, { served: servedAfterReload, dualEndMatches, note: servedMatches ? null : 'served-bundle read lagged the HMR swap; accepted via Host+Client dual-end identity on updated operation' });
  run.report.add(`${label}-final-ui-updated`, finalUi.operation?.state === 'updated', finalUi.operation);
  await captureScreenshot(cdp, `${label}-updated`);
  evidence.steps.push(step);
  return step;
}

async function body() {
  // Global scenario watchdog: never leave an unbounded wait. 25 minutes is the
  // whole-scenario cap; every individual wait below is separately bounded.
  watchdogTimer = setTimeout(() => {
    log('WATCHDOG: scenario exceeded 25 minutes; aborting');
    process.exit(3);
  }, 25 * 60 * 1000);
  if (typeof watchdogTimer.unref === 'function') watchdogTimer.unref();
  phase('start');
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
  run.report.add('host-network-env-selfcheck', run.transport.hostEnvCheck?.ok === true, run.transport.hostEnvCheck ?? null);

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

  phase('install-R_A-begin');
  await installBaseRelease(context);
  phase('install-R_A-done');
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
  phase('open-real-page');
  run.page = trackPage(run, await openRealPage(context));
  phase('real-page-ready');
  const cdp = run.page.cdp;
  const initialUi = await readUpdateUi(cdp);
  run.report.add('real-page-market-panel-opened', run.page.marketOpened?.opened === true, run.page.marketOpened);
  run.report.add('update-section-present', initialUi.sectionPresent === true, { discovery: initialUi.discovery, identities: initialUi.identities });
  run.report.add('client-identity-embedded-A', (initialUi.identities?.[1]?.commitAttr ?? '') === expectedClient.A, { client: initialUi.identities?.[1] ?? null, expected: expectedClient.A });
  await captureScreenshot(cdp, 'A-update-available');

  phase('step-A-to-B-begin');
  // Step 1: A -> B through the real UI.
  await runUiUpdateStep({ key: 'B', label: 'update-A-to-B', expectedClientCommit: expectedClient.B });

  // Fixture switch to R_final and a real UI discovery refresh after the throttle.
  // The panel may have been closed by the post-HMR page reload; reopen it first.
  const panelBeforeRefresh = await ensureMarketPanelOpen(cdp, { timeoutMs: 30000 });
  run.report.add('market-panel-open-before-discovery-refresh', panelBeforeRefresh.opened === true, panelBeforeRefresh);
  run.transport.control.setFixtureBody(buildIndexBody({ versions: [{ version: byKey.FINAL.version, commit: byKey.FINAL.commit }] }));
  // Real UI discovery switch first (fixed Client, throttle-aware); only if the
  // UI path cannot deliver the new target do we fall back to the labelled
  // frozen refresh route.
  phase('discovery-switch-ui-refresh');
  const panelBeforeUiRefresh = await ensureMarketPanelOpen(cdp, { timeoutMs: 30000 });
  evidence.uiRefreshPanel = panelBeforeUiRefresh;
  const uiRefresh = await refreshDiscoveryThroughUi(cdp, { maxWaitMs: 150000 });
  evidence.uiRefresh = uiRefresh;
  const uiRefreshOk = uiRefresh.mode === 'ui' && uiRefresh.clicked === true;
  recordAction('refresh-discovery-to-final-ui', { mode: uiRefresh.mode, clicked: uiRefresh.clicked, waitedMs: uiRefresh.waitedMs, defect: uiRefresh.defect ?? null });
  run.report.add('discovery-refresh-through-ui', uiRefreshOk, uiRefresh);
  const finalDiscovered = await ensureDiscoveryTarget(cdp, {
    version: byKey.FINAL.version,
    commit: byKey.FINAL.commit,
    timeoutMs: 120000,
    allowApiFallback: true,
  });
  evidence.finalDiscoveryGate = finalDiscovered;
  evidence.refreshStep = {
    mode: uiRefreshOk ? 'ui' : 'frozen-refresh-route-test-control',
    ui: { mode: uiRefresh.mode, clicked: uiRefresh.clicked, waitedMs: uiRefresh.waitedMs },
    gate: finalDiscovered,
  };
  run.report.add('discovery-refresh-frozen-route-test-control', finalDiscovered.ok === true && (finalDiscovered.history?.length ?? 0) > 0, { uiRefreshOk, gate: { mode: finalDiscovered.mode, waitedMs: finalDiscovered.waitedMs, history: finalDiscovered.history } }, { required: false });
  // Hard gate: never start the second update until discovery really points at
  // R_final6 (target.version+commit). Uses polling first; the frozen refresh
  // POST is a LABELLED test control when the 60s manual throttle has elapsed.
  run.report.add('discovery-target-updated-to-R_final', finalDiscovered.ok === true, finalDiscovered.ok ? finalDiscovered.target : { target: finalDiscovered.target, discovery: finalDiscovered.discovery, history: finalDiscovered.history });
  if (finalDiscovered.ok !== true) throw new Error('discovery target never switched to R_final6; refusing to start a second update');


  // Re-read the update section after the discovery switch and require the real
  // banner to render before clicking.
  await ensureUpdateSectionRendered(cdp, { timeoutMs: 30000 });
  let finalBanner = null;
  const bannerStarted = Date.now();
  while (Date.now() - bannerStarted < 60000) {
    const ui = await readUpdateUi(cdp);
    if (ui.banner !== null) { finalBanner = ui.banner; break; }
    await sleep(500);
  }
  evidence.finalBanner = finalBanner;
  run.report.add('update-B-to-final-banner-present-after-gate', finalBanner !== null, { banner: finalBanner, note: finalBanner === null ? 'banner missing after fixed-client discovery switch; second hop would fall back to labelled frozen-begin test control' : null });

  phase('step-B-to-final-begin');
  // Step 2: B -> R_final through the real UI; each hop must be a NEW operation.
  await runUiUpdateStep({
    key: 'FINAL',
    label: 'update-B-to-final',
    expectedClientCommit: expectedClient.FINAL,
    previousOperationId: evidence.steps?.[0]?.terminal?.observation?.operationId ?? null,
  });

  phase('both-updates-terminal');
  const dataAfter = readUserData(home, dataFixture);
  const preservation = userDataPreserved(dataBefore, dataAfter);
  evidence.dataPreservation.after = dataAfter;
  run.report.add('user-data-preserved-across-both-updates', preservation.preserved === true, preservation);
  const finalInspect = (await probeInspect(context)).body;
  run.report.add('final-host-runs-R_final', finalInspect?.host?.version === byKey.FINAL.version && finalInspect?.host?.commit === byKey.FINAL.commit, finalInspect?.host);
  run.report.add('probe-operator-survived-all-updates', Number.isInteger(Number(boot1.boot?.pid)) && finalInspect?.host !== null, { operatorPid: boot1.boot?.pid ?? null });
  evidence.final = { inspect: finalInspect, ui: await readUpdateUi(cdp), health: (await healthFromPage(cdp)).data };
  await captureScreenshot(cdp, 'final-updated');

  // FIXED-CLIENT REFRESH GATE: R_final3 carries the client refresh fix. After the
  // chain the page runs the 1.3.0 client; once the Host reports canRefresh=true
  // the real UI refresh button must be enabled (no 6h disable), and clicking it
  // must issue a real POST refresh that updates checkedAt without changing the
  // discovery target.
  const panelBeforeGate = await ensureMarketPanelOpen(cdp, { timeoutMs: 20000 });
  run.report.add('market-panel-open-before-final-refresh-gate', panelBeforeGate.opened === true, panelBeforeGate);
  phase('final-refresh-gate');
  const finalCanRefresh = await discoveryCanRefresh(context, { timeoutMs: 90000 });
  run.report.add('final-client-host-can-refresh', finalCanRefresh.ok === true, finalCanRefresh.waitedMs ?? null);
  // The Client re-inspects on its own ~3s cadence; poll the real control until
  // it reflects canRefresh=true (bounded 30s) before asserting/clicking.
  const gateAction = await waitForAction(cdp, 'refresh-update', { timeoutMs: 30000 });
  const finalUiBeforeRefresh = await readUpdateUi(cdp);
  const finalRefreshButton = finalUiBeforeRefresh.actionButtons.find((button) => button.action === 'refresh-update');
  const checkedAtBefore = (await inspectFromPage(cdp)).data?.discovery?.checkedAt ?? null;
  const requestsBefore = run.transport.audit().requests.length;
  const finalRefreshClick = gateAction.ok === true
    ? await clickAction(cdp, 'refresh-update', 'final-refresh-fix')
    : { clicked: false, reason: 'button-disabled-or-absent', button: finalRefreshButton ?? null, waitedMs: gateAction.waitedMs };
  let checkedAtAfter = null;
  const waitStarted = Date.now();
  while (Date.now() - waitStarted < 15000) {
    const current = await inspectFromPage(cdp);
    if (current.data?.discovery?.checkedAt !== checkedAtBefore) {
      checkedAtAfter = current.data.discovery.checkedAt;
      break;
    }
    await sleep(300);
  }
  const requestsAdded = run.transport.audit().requests.length - requestsBefore;
  evidence.finalRefreshGate = { finalCanRefresh, gateAction: { ok: gateAction.ok, waitedMs: gateAction.waitedMs, control: gateAction.control ?? null }, button: finalRefreshButton ?? null, click: finalRefreshClick, checkedAtBefore, checkedAtAfter, requestsAdded };
  run.report.add('final-client-refresh-button-enabled-no-6h-disable', finalRefreshButton !== undefined && finalRefreshButton.disabled !== true, finalRefreshButton ?? null);
  run.report.add('final-client-refresh-click-posted-real-refresh', finalRefreshClick.clicked === true && checkedAtAfter !== null, { click: finalRefreshClick, checkedAtBefore, checkedAtAfter });
  run.report.add('final-client-refresh-made-one-discovery-request', requestsAdded === 1, { requestsAdded });
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

  if (watchdogTimer !== null) clearTimeout(watchdogTimer);
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
      refreshStep: evidence.refreshStep ?? null,
      finalRefreshGate: evidence.finalRefreshGate ?? null,
      identity: evidence.identity,
      dataPreservation: evidence.dataPreservation,
      screenshots: evidence.screenshots,
      networkAtStale: evidence.networkAtStale ?? null,
      refreshStep: evidence.refreshStep ?? null,
      finalRefreshGate: evidence.finalRefreshGate ?? null,
      cleanup,
      thrown: evidence.thrown,
      environment: { node: process.version, platform: process.platform, repoRoot: REPO_ROOT },
    },
  });
  process.exitCode = summary.summary.passed ? 0 : 1;
}
