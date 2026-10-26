#!/usr/bin/env node
/**
 * M3 V1 single-hop real-UI verification (fallback closing evidence).
 *
 * One fresh isolated HMR profile: install the BASE probe release by exact commit
 * with the real native plugin manager, then drive ONE update hop through the
 * REAL Client UI (banner -> confirm dialog -> operation -> terminal updated) and
 * verify both ends: Host loadedVersion/commit == target commit, Client
 * self-reported buildCommit == target release clientBuildCommit, /health ok.
 * Saves/config must survive; ports/PIDs/homes/chrome dirs cleaned and proven.
 *
 * The single-profile A->B->C sequencing is covered separately by host/client
 * regression tests; this runner proves each consecutive exact-commit hop with a
 * real Client in a fresh profile.
 *
 * Usage:
 *   node scripts/verification/v1.5/m3/run-v1-single-hop.mjs \
 *     --base <commit> --base-version 1.2.1 --base-client <commit|null> \
 *     --target <commit> --target-version 1.2.2 --target-client <P_B4> \
 *     --label A2-to-B4 [--tag suffix] [--write-evidence]
 */
import path from 'node:path';

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
  cleanupRun,
  clickAction,
  createRunContext,
  discoveryCanRefresh,
  ensureMarketPanelOpen,
  ensureUpdateSectionRendered,
  healthFromPage,
  inspectFromPage,
  installExactWithRetry,
  makeScenarioEnvironment,
  openRealPage,
  parseTargets,
  prepareTargetRepo,
  probeInspect,
  readReleaseIdentity,
  readServedClientIdentity,
  readUpdateUi,
  readUserData,
  reloadRealPage,
  seedUserData,
  startTransport,
  trackHost,
  trackPage,
  userDataPreserved,
  waitForHostVersion,
  waitForOperation,
  waitForRoute,
} from './v1-common.mjs';
import { removeFixtureTls } from './fixture.mjs';

function parseLocalArgs(argv) {
  const extraKeys = new Set(['--label', '--base-client', '--tag']);
  const filtered = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (extraKeys.has(argv[i])) { i += 1; continue; }
    filtered.push(argv[i]);
  }
  const base = parseTargets(filtered, { versions: { a: '1.2.1', b: '1.2.2', final: '1.3.0' } });
  const extra = { label: null, baseClient: null, tag: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--label') extra.label = argv[++i];
    else if (argv[i] === '--base-client') extra.baseClient = argv[++i];
    else if (argv[i] === '--tag') extra.tag = argv[++i];
  }
  return { base, extra };
}

const run = createRunContext('v1-single-hop');
const { base: rawTargets, extra } = parseLocalArgs(process.argv.slice(2));
const targets = {
  base: rawTargets.a,
  baseVersion: rawTargets.versionA,
  target: rawTargets.b,
  targetVersion: rawTargets.versionB,
  final: rawTargets.final,
};
const label = extra.label ?? `${targets.base.slice(0, 7)}-to-${targets.target.slice(0, 7)}`;
const REPORT = createReport({
  id: `M3-v1-single-hop-${label}`,
  title: `V1 single-hop real-UI update ${label}`,
  commands: [`node scripts/verification/v1.5/m3/run-v1-single-hop.mjs --a ${targets.base} --b ${targets.target} --final ${targets.final} --label ${label}`],
});
attachReport(run, REPORT);

const evidence = { targets, label, expectedClient: null, baseRelease: null, targetRelease: null, installs: [], transitions: [], screenshots: [], dataPreservation: null, cleanup: null, thrown: null };
let thrown = null;
let bootstrap = null;

async function captureScreenshot(cdp, name) {
  await ensureUpdateSectionRendered(cdp, { timeoutMs: 20000 }).catch(() => ({ ok: false }));
  ensureDir(SHOT_DIR);
  const file = path.join(SHOT_DIR, `M3-V1-single-hop-${label}-${run.runTag}-${name}.png`);
  try {
    await cdp.shot(file);
    evidence.screenshots.push({ name, file: path.relative(REPO_ROOT, file) });
  } catch (error) {
    run.report.add(`screenshot-${name}`, false, String(error && error.message ? error.message : error));
  }
}

async function waitForTerminalOrRecover(cdp, context, expectedClientCommit, stepKey) {
  const transitions = [];
  const onTransition = (entry) => {
    transitions.push(entry);
    evidence.transitions.push({ step: stepKey, at: entry.at, state: entry.state, observation: entry.observation ?? null });
  };
  let settled = await waitForOperation(cdp, ['updated', 'stale-runtime', 'activating', 'failed', 'verification-failed', 'pending-restart', 'cancelled'], { timeoutMs: 180000, onTransition });
  if (settled.state === 'activating') {
    // Host applied the bundle and is waiting for a matching Client report; a
    // fresh page load is the user-equivalent recovery when no stale card shows.
    const reloadOnly = await reloadRealPage(run.page, context, { expectedClientCommit });
    evidence.activatingReload = reloadOnly;
    settled = await waitForOperation(cdp, ['updated', 'failed', 'verification-failed', 'cancelled'], { timeoutMs: 150000, onTransition });
  }
  if (settled.state === 'stale-runtime') {
    await ensureMarketPanelOpen(cdp, { timeoutMs: 20000 }).catch(() => null);
    const refresh = await clickAction(cdp, 'refresh-page', `${label}-refresh-page`);
    evidence.refreshAction = refresh;
    const reloaded = await reloadRealPage(run.page, context, { expectedClientCommit });
    evidence.reloaded = reloaded;
    settled = await waitForOperation(cdp, ['updated', 'failed', 'verification-failed', 'cancelled'], { timeoutMs: 150000, onTransition });
  }
  // Network-window flake: the native manager's github preflight has a hard 5s
  // budget; one bounded re-begin gives the link another chance to be healthy.
  const installFailedCode = settled.observation?.error?.code;
  if (settled.state === 'failed' && installFailedCode === 'GM-5033') {
    phaseLog('retry-after-GM-5033');
    evidence.retry = { reason: installFailedCode, at: new Date().toISOString() };
    await sleep(8000);
    let retryBegin = null;
    try {
      retryBegin = await beginUpdateThroughUi(cdp, { expectVersion: targets.targetVersion, previousOperationId: evidence.begin?.operationId ?? null });
      evidence.retry.begin = { operationId: retryBegin.operationId, dialog: retryBegin.dialog };
      run.report.add('retry-after-network-failure-begin', /^upd_[a-f0-9]{16}$/.test(String(retryBegin.operationId)), retryBegin.operationId);
      settled = await waitForOperation(cdp, ['updated', 'stale-runtime', 'activating', 'failed', 'verification-failed'], { timeoutMs: 180000, onTransition });
      if (settled.state === 'activating') {
        await reloadRealPage(run.page, context, { expectedClientCommit });
        settled = await waitForOperation(cdp, ['updated', 'failed', 'verification-failed'], { timeoutMs: 150000, onTransition });
      } else if (settled.state === 'stale-runtime') {
        const refresh = await clickAction(cdp, 'refresh-page', `${label}-retry-refresh-page`);
        evidence.retry.refresh = refresh;
        await reloadRealPage(run.page, context, { expectedClientCommit });
        settled = await waitForOperation(cdp, ['updated', 'failed', 'verification-failed'], { timeoutMs: 150000, onTransition });
      }
      run.report.add('retry-after-network-failure-terminal', settled.state === 'updated', { state: settled.state, observation: settled.observation ?? null });
    } catch (error) {
      evidence.retry.error = String(error && error.message ? error.message : error);
      run.report.add('retry-after-network-failure-begin', false, evidence.retry.error);
    }
  }
  return { settled, transitions };
}

async function body() {
  const identity = verifyRuntime();
  run.report.add('runtime-extraction-matches-installed-app', identity.extractionVerifiedAgainstInstalledApp, identity.mismatched);

  const repo = prepareTargetRepo({ final: targets.final, commits: [targets.base, targets.target] });
  evidence.targetRepo = { dir: repo.dir, mode: repo.mode, networkModes: repo.networkModes };
  const baseRelease = readReleaseIdentity(targets.base, { git: repo.git });
  const targetRelease = readReleaseIdentity(targets.target, { git: repo.git });
  evidence.baseRelease = baseRelease;
  evidence.targetRelease = targetRelease;
  const expectedClient = targetRelease?.clientBuildCommit ?? extra.targetClient ?? null;
  evidence.expectedClient = expectedClient;
  run.report.add('target-release-identity', targetRelease?.version === targets.targetVersion && typeof expectedClient === 'string', { version: targetRelease?.version ?? null, clientBuildCommit: expectedClient });
  if (typeof expectedClient !== 'string') throw new Error('target release.json has no clientBuildCommit');

  const env = makeScenarioEnvironment(run.runTag);
  run.tls = env.tls;
  run.tlsDir = env.tlsDir;
  run.transport = await startTransport(env);
  evidence.networkGate = run.transport.networkGate ?? null;
  run.report.add('host-network-env-selfcheck', run.transport.hostEnvCheck?.ok === true, run.transport.hostEnvCheck ?? null);
  if (run.transport.networkGate !== undefined && run.transport.networkGate.ok !== true) {
    throw new Error('pre-run network gate failed (GitHub unreachable in this window); refusing to start installs');
  }
  run.transport.control.setFixtureBody(buildIndexBody({ versions: [{ version: targets.targetVersion, commit: targets.target }] }));

  const name = `v1-single-${run.runTag}`;
  const home = await makeIsolatedHome(name, { port: await freePort() });
  const context = { name, home, host: null, probe: null, boot: null, hostPort: null, bootIndex: 1, transport: run.transport, restarts: [] };
  bootstrap = { context, home };
  run.context = context;

  const boot1 = await bootProbeHost({
    name,
    home,
    runDir: path.join(RUNS_ROOT, run.runTag, 'boot1'),
    bootTag: `${name}-boot1`,
    port: await freePort(),
    env: run.transport.envForHost({ marker: run.runTag }),
    pluginMode: 'none',
    logName: `${name}-boot1`,
  }).catch(async (error) => {
    // runDir is only for probe scratch; fall back to the run directory.
    throw error;
  });
  trackHost(run, context);
  context.host = boot1.host;
  context.probe = boot1.probe;
  context.boot = boot1.boot;
  context.hostPort = boot1.host.port;

  phaseLog('install-base-begin');
  const baseSpec = `https://github.com/heswy/dsh-game-market.git#${targets.base}`;
  const installOutcome = await installExactWithRetry(context.probe, { spec: baseSpec, requestIdBase: `m3-single-${run.runTag}-base` });
  evidence.installs.push({ phase: 'install-base', spec: baseSpec, result: installOutcome.result, attempts: installOutcome.attempts });
  run.report.add('base-install-applied', installOutcome.result?.application === 'applied', installOutcome.result?.application ?? installOutcome.result?.error ?? null);
  if (installOutcome.result?.application !== 'applied') throw new Error(`base install did not apply: ${JSON.stringify(installOutcome.result)}`);
  const applied = await waitForHostVersion(context.probe, targets.baseVersion, { timeoutMs: 240000 });
  run.report.add('base-running-version', applied.ok === true, applied.ok ? applied.waitedMs : applied.last);
  const routeReady = await waitForRoute(context, { timeoutMs: 90000 });
  run.report.add('update-routes-available', routeReady.ok === true, routeReady.ok ? routeReady.waitedMs : null);
  const inspectBase = (await probeInspect(context)).body;
  run.report.add('discovery-target-is-target', inspectBase?.target?.version === targets.targetVersion && inspectBase?.target?.commit === targets.target, inspectBase?.target ?? null);
  run.report.add('capability-can-begin-update', inspectBase?.capability?.canBeginUpdate === true, inspectBase?.capability ?? null);

  const dataFixture = seedUserData(home, `v1-single-${run.runTag}`);
  const dataBefore = readUserData(home, dataFixture);
  evidence.dataPreservation = { before: dataBefore };

  phaseLog('open-real-page');
  run.page = trackPage(run, await openRealPage(context));
  const cdp = run.page.cdp;
  const initialUi = await readUpdateUi(cdp);
  run.report.add('real-page-market-panel-opened', run.page.marketOpened?.opened === true, run.page.marketOpened);
  run.report.add('update-section-present', initialUi.sectionPresent === true, { discovery: initialUi.discovery, identities: initialUi.identities });
  run.report.add('client-identity-embedded-base', (initialUi.identities?.[1]?.commitAttr ?? null) === (baseRelease?.clientBuildCommit ?? null), { client: initialUi.identities?.[1] ?? null, expected: baseRelease?.clientBuildCommit ?? null });
  await captureScreenshot(cdp, 'base-update-available');

  phaseLog('real-ui-begin');
  const before = await readUpdateUi(cdp);
  run.report.add('update-banner-present', before.banner !== null, before.banner);
  if (before.banner === null) throw new Error('update banner did not render for the target (no UI entry point)');
  const begin = await beginUpdateThroughUi(cdp, { expectVersion: targets.targetVersion });
  evidence.begin = { banner: begin.banner, dialog: begin.dialog, operationId: begin.operationId };
  run.report.add('ui-begin-created-operation', /^upd_[a-f0-9]{16}$/.test(String(begin.operationId)), begin.operationId);
  run.report.add('dialog-names-target-version', begin.dialogMatchesTargetVersion === true, begin.dialog);
  const dialogMeta = JSON.stringify(begin.dialog?.meta ?? []);
  run.report.add('dialog-names-target-commit', dialogMeta.includes(targets.target), begin.dialog?.meta ?? null);
  const dialogBody = String(begin.dialog?.body ?? '');
  run.report.add('dialog-warns-all-sessions-and-restart', (dialogBody.includes('所有会话') || dialogBody.includes('所在会话')) && (dialogBody.includes('重启') || /restart/i.test(dialogBody)), dialogBody);
  await captureScreenshot(cdp, 'confirm-dialog');

  phaseLog('wait-terminal');
  const { settled, transitions } = await waitForTerminalOrRecover(cdp, context, expectedClient, 'single-hop');
  evidence.transitions = evidence.transitions.concat(transitions.map((entry) => ({ step: 'single-hop', at: entry.at, state: entry.state, observation: entry.observation ?? null })));
  run.report.add('saw-install-progress', transitions.some((entry) => ['installing', 'applied', 'activating'].includes(entry.state)), transitions.map((entry) => entry.state));
  run.report.add('terminal-updated', settled.state === 'updated', { state: settled.state, observation: settled.observation ?? null });

  // The HMR re-apply can auto-reload the page to the DSH home; reopen the
  // Market panel and wait for the update section before reading DOM identities.
  await ensureMarketPanelOpen(cdp, { timeoutMs: 30000 }).catch(() => null);
  await ensureUpdateSectionRendered(cdp, { timeoutMs: 30000 }).catch(() => ({ ok: false }));
  const finalInspect = (await inspectFromPage(cdp)).data;
  const finalHealth = (await healthFromPage(cdp)).data;
  const finalUi = await readUpdateUi(cdp);
  let served = await readServedClientIdentity(cdp, { cacheBust: true });
  if (served.found !== true) {
    await sleep(1500);
    served = await readServedClientIdentity(cdp, { cacheBust: true });
  }
  run.report.add('host-running-target-version', finalInspect?.host?.version === targets.targetVersion, finalInspect?.host ?? null);
  run.report.add('host-running-target-commit', finalInspect?.host?.commit === targets.target, { commit: finalInspect?.host?.commit ?? null, expected: targets.target });
  run.report.add('host-installed-version-target', finalInspect?.installed?.version === targets.targetVersion, finalInspect?.installed ?? null);
  run.report.add('health-version-target', finalHealth?.version === targets.targetVersion, finalHealth?.version ?? null);
  run.report.add('ui-updated-not-success-before-verify', finalUi.operation?.state === 'updated' && finalUi.operation?.success !== 'false', finalUi.operation);
  const uiClientCommit = finalUi.identities?.[1]?.commitAttr ?? null;
  const dualEnd = finalInspect?.host?.commit === targets.target && uiClientCommit === expectedClient;
  run.report.add('client-build-identity-target', uiClientCommit === expectedClient || (served.found === true && served.identity?.buildCommit === expectedClient) || dualEnd, { uiClientCommit, served: served.identity ?? null, expectedClient, dualEnd });
  run.report.add('served-client-bundle-or-dual-end', (served.found === true && served.identity?.buildCommit === expectedClient) || dualEnd, served);
  await captureScreenshot(cdp, 'updated');

  // Fixed-client UI refresh gate (both base and target clients carry the fix).
  const canRefresh = await discoveryCanRefresh(context, { timeoutMs: 90000 });
  run.report.add('host-can-refresh-after-throttle', canRefresh.ok === true, canRefresh.waitedMs ?? null);
  const buttonWaitStarted = Date.now();
  let refreshButton = (await readUpdateUi(cdp)).actionButtons.find((button) => button.action === 'refresh-update');
  while ((refreshButton === undefined || refreshButton.disabled === true) && Date.now() - buttonWaitStarted < 30000) {
    await sleep(1000);
    refreshButton = (await readUpdateUi(cdp)).actionButtons.find((button) => button.action === 'refresh-update');
  }
  const checkedAtBefore = (await inspectFromPage(cdp)).data?.discovery?.checkedAt ?? null;
  const requestsBefore = run.transport.audit().requests.length;
  const refreshClick = refreshButton !== undefined && refreshButton.disabled !== true ? await clickAction(cdp, 'refresh-update', 'single-hop-refresh') : { clicked: false, reason: 'disabled-or-absent' };
  let checkedAtAfter = null;
  const refreshWait = Date.now();
  while (Date.now() - refreshWait < 20000) {
    const current = (await inspectFromPage(cdp)).data;
    if (current?.discovery?.checkedAt !== checkedAtBefore) { checkedAtAfter = current.discovery.checkedAt; break; }
    await sleep(500);
  }
  const requestsAdded = run.transport.audit().requests.length - requestsBefore;
  run.report.add('fixed-client-refresh-button-enabled', refreshButton !== undefined && refreshButton.disabled !== true, refreshButton ?? null);
  run.report.add('fixed-client-refresh-posted-real-request', refreshClick.clicked === true && checkedAtAfter !== null && requestsAdded === 1, { refreshClick, checkedAtBefore, checkedAtAfter, requestsAdded });
  evidence.refreshGate = { canRefresh: canRefresh.ok, button: refreshButton ?? null, refreshClick, checkedAtBefore, checkedAtAfter, requestsAdded };

  const dataAfter = readUserData(home, dataFixture);
  evidence.dataPreservation.after = dataAfter;
  run.report.add('user-data-preserved', userDataPreserved(dataBefore, dataAfter).preserved === true, userDataPreserved(dataBefore, dataAfter));
}

function phaseLog(name, extra = null) {
  const payload = extra === null ? '' : ` ${JSON.stringify(extra)}`;
  log(`=== phase ${name}${payload} ===`);
  process.stdout.write(`=== phase ${name}${payload} ===\n`);
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
    try { await run.transport.close(); } catch (error) { run.report.add('transport-close', false, String(error && error.message ? error.message : error)); }
  }
  if (run.tls) removeFixtureTls(run.tls);
  const transportProof = await cleanupProof({ ports: [run.transport?.port].filter((port) => Number.isInteger(port)), dirs: [run.tlsDir].filter(Boolean), label: 'v1-single-hop-transport-cleanup' });
  run.report.add('transport-and-tls-cleaned', transportProof.ok === true, transportProof);
  evidence.thrown = thrown === null ? null : String(thrown.stack ?? thrown);
  const summary = finalizeRun({
    report: run.report,
    evidenceRel: run.evidenceRel,
    runDir: run.runDir,
    extra: {
      runTag: run.runTag,
      label,
      targets,
      evidenceLevel: 'isolated-browser (real installed bundle + real DSH page + real Client UI for the update; isolated host/profile + isolated transport fixture); NOT real Desktop/Electron main process',
      releaseIdentities: { base: evidence.baseRelease, target: evidence.targetRelease, expectedClient: evidence.expectedClient },
      installs: evidence.installs,
      networkGate: evidence.networkGate,
      begin: evidence.begin,
      transitions: evidence.transitions,
      refreshAction: evidence.refreshAction ?? null,
      reloaded: evidence.reloaded ?? null,
      refreshGate: evidence.refreshGate ?? null,
      dataPreservation: evidence.dataPreservation,
      screenshots: evidence.screenshots,
      cleanup,
      thrown: evidence.thrown,
      environment: { node: process.version, platform: process.platform },
    },
  });
  process.exitCode = summary.summary.passed ? 0 : 1;
}
