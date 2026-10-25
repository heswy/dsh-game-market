#!/usr/bin/env node
/**
 * V1 same-profile continuous TWO-HOP real-UI verification (task-13 evidence).
 *
 * One isolated fresh profile, one Client page, no reset between hops:
 *   install BASE (exact commit) -> real UI A->B -> (fixture index switch via the
 *   real Client refresh control) -> real UI B->FINAL, verifying Host
 *   loadedVersion/commit and the Client's own build identity after EACH hop,
 *   save/config preservation across both hops, and cleanup proof.
 *
 * This runner intentionally uses only the real Client UI for both begins; if the
 * fixed Client does not offer the next update after the first hop, the hop fails
 * (that would be a product bug, not a harness workaround).
 *
 * Usage:
 *   node scripts/verification/v1.5/m3/run-v1-two-hop.mjs \
 *     --a <base commit> --b <mid commit> --final <final commit> \
 *     [--version-a 1.2.1 --version-b 1.2.2 --version-final 1.3.0] \
 *     [--write-evidence]
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
  waitForAction,
  waitForHostVersion,
  waitForOperation,
  waitForRoute,
} from './v1-common.mjs';
import { removeFixtureTls } from './fixture.mjs';

const run = createRunContext('v1-two-hop');
const targets = parseTargets(process.argv.slice(2));
const REPORT = createReport({
  id: 'M3-v1-two-hop',
  title: 'V1 same-profile continuous two-hop real-UI update (A→B→FINAL)',
  commands: [`node scripts/verification/v1.5/m3/run-v1-two-hop.mjs --a ${targets.a} --b ${targets.b} --final ${targets.final}`],
});
attachReport(run, REPORT);

const evidence = {
  targets,
  releases: {},
  expectedClient: {},
  hops: [],
  transitions: [],
  discoverySwitch: null,
  refreshGate: null,
  dataPreservation: null,
  screenshots: [],
  cleanup: null,
  thrown: null,
};
let thrown = null;

function phase(name, extra = null) {
  const payload = extra === null ? '' : ` ${JSON.stringify(extra)}`;
  log(`=== phase ${name}${payload} ===`);
  process.stdout.write(`=== phase ${name}${payload} ===\n`);
}

async function captureScreenshot(cdp, name) {
  await ensureUpdateSectionRendered(cdp, { timeoutMs: 20000 }).catch(() => ({ ok: false }));
  ensureDir(SHOT_DIR);
  const file = path.join(SHOT_DIR, `M3-v1-two-hop-${run.runTag}-${name}.png`);
  try {
    await cdp.shot(file);
    evidence.screenshots.push({ name, file: path.relative(REPO_ROOT, file) });
  } catch (error) {
    run.report.add(`screenshot-${name}`, false, String(error && error.message ? error.message : error));
  }
}

async function currentUi(cdp) {
  await ensureMarketPanelOpen(cdp, { timeoutMs: 20000 }).catch(() => null);
  await ensureUpdateSectionRendered(cdp, { timeoutMs: 20000 }).catch(() => ({ ok: false }));
  return readUpdateUi(cdp);
}

/** Wait for the hop's terminal state, recovering through the real UI when needed. */
async function waitHopTerminal(cdp, context, expectedClientCommit, label) {
  const transitions = [];
  const onTransition = (entry) => {
    transitions.push(entry);
    evidence.transitions.push({ hop: label, at: entry.at, state: entry.state, observation: entry.observation ?? null });
  };
  let settled = await waitForOperation(cdp, ['updated', 'stale-runtime', 'activating', 'failed', 'verification-failed', 'pending-restart', 'cancelled'], { timeoutMs: 180000, onTransition });
  if (settled.state === 'activating') {
    phase(`${label}-activating-reload`);
    await reloadRealPage(run.page, context, { expectedClientCommit });
    settled = await waitForOperation(cdp, ['updated', 'failed', 'verification-failed', 'cancelled'], { timeoutMs: 150000, onTransition });
  } else if (settled.state === 'stale-runtime') {
    phase(`${label}-stale-refresh`);
    const refresh = await clickAction(cdp, 'refresh-page', `${label}-refresh-page`);
    run.report.add(`${label}-stale-refresh-clicked`, refresh.clicked === true, refresh);
    await reloadRealPage(run.page, context, { expectedClientCommit });
    settled = await waitForOperation(cdp, ['updated', 'failed', 'verification-failed', 'cancelled'], { timeoutMs: 150000, onTransition });
  }
  return { settled, transitions };
}

async function performHop({ cdp, context, hopKey, toVersion, expectedClientCommit, previousOperationId, dataFixture }) {
  const label = `hop-${hopKey}`;
  phase(`${label}-begin`, { toVersion, previousOperationId });
  const before = await currentUi(cdp);
  run.report.add(`${label}-update-banner-present`, before.banner !== null, before.banner);
  if (before.banner === null) {
    throw new Error(`no update banner for ${toVersion} (real-UI begin required; retained-terminal/offer-next product bug?)`);
  }
  const begin = await beginUpdateThroughUi(cdp, { expectVersion: toVersion, previousOperationId });
  run.report.add(`${label}-ui-begin-created-operation`, /^upd_[a-f0-9]{16}$/.test(String(begin.operationId)), begin.operationId);
  run.report.add(`${label}-dialog-names-target-version`, begin.dialogMatchesTargetVersion === true, begin.dialog);
  const dialogJson = JSON.stringify(begin.dialog?.meta ?? []);
  run.report.add(`${label}-dialog-names-target-commit`, dialogJson.includes(hopKey === 'B' ? targets.b : targets.final), begin.dialog?.meta ?? null);
  const dialogBody = String(begin.dialog?.body ?? '');
  run.report.add(`${label}-dialog-warns-sessions-and-restart`, (dialogBody.includes('所有会话') || dialogBody.includes('所在会话')) && (dialogBody.includes('重启') || /restart/i.test(dialogBody)), dialogBody);
  const operationIsNew = previousOperationId === null || begin.operationId !== previousOperationId;
  run.report.add(`${label}-new-operation-id`, operationIsNew, { operationId: begin.operationId ?? null, previousOperationId });
  await captureScreenshot(cdp, `${label}-dialog`);

  phase(`${label}-wait-terminal`);
  const { settled, transitions } = await waitHopTerminal(cdp, context, expectedClientCommit, label);
  run.report.add(`${label}-saw-install-progress`, transitions.some((entry) => ['installing', 'applied', 'activating'].includes(entry.state)), transitions.map((entry) => entry.state));
  run.report.add(`${label}-terminal-updated`, settled.state === 'updated', { state: settled.state, observation: settled.observation ?? null });
  run.report.add(`${label}-same-operation-through-hop`, transitions.every((entry) => (entry.observation?.operationId ?? begin.operationId) === begin.operationId), transitions.map((entry) => ({ state: entry.state, operationId: entry.observation?.operationId ?? null })));

  // Re-open the panel if HMR auto-reloaded the page, then verify BOTH ends.
  const ui = await currentUi(cdp);
  const inspect = (await inspectFromPage(cdp)).data;
  const health = (await healthFromPage(cdp)).data;
  const served = await readServedClientIdentity(cdp, { cacheBust: true });
  const expectedVersion = hopKey === 'B' ? targets.versionB : targets.versionFinal;
  const expectedCommit = hopKey === 'B' ? targets.b : targets.final;
  const uiClientCommit = ui.identities?.[1]?.commitAttr ?? null;
  const dualEnd = inspect?.host?.commit === expectedCommit && uiClientCommit === expectedClientCommit;
  run.report.add(`${label}-host-running-version`, inspect?.host?.version === expectedVersion, inspect?.host ?? null);
  run.report.add(`${label}-host-running-commit`, inspect?.host?.commit === expectedCommit, { commit: inspect?.host?.commit ?? null, expected: expectedCommit });
  run.report.add(`${label}-health-version`, health?.version === expectedVersion, health?.version ?? null);
  run.report.add(`${label}-client-build-identity`, uiClientCommit === expectedClientCommit || (served.found === true && served.identity?.buildCommit === expectedClientCommit) || dualEnd, { uiClientCommit, served: served.identity ?? null, expected: expectedClientCommit, dualEnd });
  run.report.add(`${label}-ui-operation-updated`, ui.operation?.state === 'updated', ui.operation);
  run.report.add(`${label}-user-data-preserved`, userDataPreserved(evidence.dataBefore, readUserData(run.homePath ?? bootstrap.home, dataFixture)).preserved === true, null);
  await captureScreenshot(cdp, `${label}-updated`);

  evidence.hops.push({ hop: hopKey, operationId: begin.operationId, dialog: begin.dialog, transitions: transitions.map((entry) => entry.state), terminal: settled.state, inspect: inspect?.host ?? null, uiClientCommit, dataPreserved: true });
  return { operationId: begin.operationId, inspect, ui };
}

/** Switch the fixture index to the final target and make the REAL Client refresh it. */
async function switchDiscoveryToFinal(cdp) {
  phase('discovery-switch');
  const panel = await ensureMarketPanelOpen(cdp, { timeoutMs: 30000 });
  run.report.add('discovery-switch-panel-open', panel.opened === true, panel);
  run.transport.control.setFixtureBody(buildIndexBody({ versions: [{ version: targets.versionFinal, commit: targets.final }] }));

  // Preferred path: the real Client refresh control (fixed Client; throttle-aware).
  const buttonWaitStarted = Date.now();
  let enabled = await waitForAction(cdp, 'refresh-update', { timeoutMs: 150000 });
  evidence.discoverySwitch = { uiButton: { ok: enabled.ok, waitedMs: enabled.waitedMs } };
  let clicked = { clicked: false, reason: 'not-enabled' };
  if (enabled.ok === true) {
    clicked = await clickAction(cdp, 'refresh-update', 'two-hop-refresh-update');
    evidence.discoverySwitch.click = clicked;
  }
  run.report.add('discovery-switch-ui-refresh-clicked', clicked.clicked === true, { clicked, waitedMs: enabled.waitedMs });

  // Poll the target via the frozen inspect route (no extra refresh needed if the
  // real UI refresh delivered it; labelled test-control only as fallback).
  let target = null;
  const pollStarted = Date.now();
  while (Date.now() - pollStarted < 90000) {
    const inspect = (await inspectFromPage(cdp)).data;
    target = inspect?.target ?? null;
    if (target !== null && target.version === targets.versionFinal && target.commit === targets.final) break;
    await sleep(700);
  }
  const targetOk = target !== null && target.version === targets.versionFinal && target.commit === targets.final;
  evidence.discoverySwitch.target = target;
  run.report.add('discovery-switch-target-final', targetOk === true, target);

  if (targetOk !== true) {
    // Bounded, labelled fallback: frozen POST refresh route (test control), so
    // the hop can still be judged. Recorded explicitly; the fixed-Client UI
    // refresh gate at the end remains an independent assertion.
    phase('discovery-switch-fallback-frozen-refresh');
    const fallback = [];
    for (let attempt = 1; attempt <= 4 && targetOk !== true; attempt += 1) {
      const canRefresh = await discoveryCanRefresh(run.context, { timeoutMs: 90000 });
      if (canRefresh.ok !== true) { fallback.push({ attempt, canRefresh: false }); continue; }
      const response = await (await import('./v1-common.mjs')).pagePostJson(cdp, '/api/game-market/platform-update/refresh', {});
      let envelope = null;
      try { envelope = JSON.parse(response.body); } catch { /* not json */ }
      fallback.push({ attempt, status: response.status, envelopeOk: envelope?.ok ?? null, refreshed: envelope?.data?.refreshed ?? null });
      const until = Date.now() + 30000;
      while (Date.now() < until) {
        const inspect = (await inspectFromPage(cdp)).data;
        target = inspect?.target ?? null;
        if (target !== null && target.version === targets.versionFinal && target.commit === targets.final) break;
        await sleep(700);
      }
    }
    evidence.discoverySwitch.fallback = fallback;
    const finalOk = target !== null && target.version === targets.versionFinal && target.commit === targets.final;
    run.report.add('discovery-switch-target-final-after-fallback', finalOk === true, { target, fallback });
    if (finalOk !== true) throw new Error('discovery target never switched to the final commit');
  }

  // The fixed Client must offer the next update while the previous card remains.
  phase('discovery-switch-wait-banner');
  let banner = null;
  const bannerUntil = Date.now() + 60000;
  while (Date.now() < bannerUntil) {
    const ui = await readUpdateUi(cdp);
    if (ui.banner !== null) { banner = ui.banner; break; }
    await sleep(500);
  }
  evidence.discoverySwitch.banner = banner;
  run.report.add('discovery-switch-banner-offers-next-update', banner !== null, banner);
  if (banner === null) throw new Error('fixed Client did not render the next-update banner after the discovery switch');
}

async function body() {
  phase('start');
  const identity = verifyRuntime();
  run.report.add('runtime-extraction-matches-installed-app', identity.extractionVerifiedAgainstInstalledApp, identity.mismatched);

  const repo = prepareTargetRepo({ final: targets.final, commits: [targets.a, targets.b, targets.final] });
  evidence.targetRepo = { dir: repo.dir, mode: repo.mode, networkModes: repo.networkModes };
  evidence.releases = {
    base: readReleaseIdentity(targets.a, { git: repo.git }),
    mid: readReleaseIdentity(targets.b, { git: repo.git }),
    final: readReleaseIdentity(targets.final, { git: repo.git }),
  };
  const clientMid = evidence.releases.mid?.clientBuildCommit ?? null;
  const clientFinal = evidence.releases.final?.clientBuildCommit ?? null;
  run.report.add('release-identities-mid-and-final', evidence.releases.mid?.version === targets.versionB && evidence.releases.final?.version === targets.versionFinal && typeof clientMid === 'string' && typeof clientFinal === 'string', { mid: clientMid, final: clientFinal });
  evidence.expectedClient = { mid: clientMid, final: clientFinal };

  const env = makeScenarioEnvironment(run.runTag);
  run.tls = env.tls;
  run.tlsDir = env.tlsDir;
  run.transport = await startTransport(env);
  evidence.networkGate = run.transport.networkGate ?? null;
  evidence.networkModeLabel = run.transport.hostEnvCheck?.networkModeLabel ?? null;
  run.report.add('host-network-env-selfcheck', run.transport.hostEnvCheck?.ok === true, run.transport.hostEnvCheck ?? null);
  if (run.transport.networkGate !== undefined && run.transport.networkGate.ok !== true) throw new Error('pre-run network gate failed; refusing to start');
  run.transport.control.setFixtureBody(buildIndexBody({ versions: [{ version: targets.versionB, commit: targets.b }] }));

  const name = `v1-two-hop-${run.runTag}`;
  const home = await makeIsolatedHome(name, { port: await freePort() });
  bootstrap = { home };
  run.homePath = home;
  const context = { name, home, host: null, probe: null, boot: null, hostPort: null, bootIndex: 1, transport: run.transport, restarts: [] };
  run.context = context;

  const boot = await bootProbeHost({
    name,
    home,
    runDir: path.join(RUNS_ROOT, run.runTag, 'boot1'),
    bootTag: `${name}-boot1`,
    port: await freePort(),
    env: run.transport.envForHost({ marker: run.runTag }),
    pluginMode: 'none',
    logName: `${name}-boot1`,
  });
  context.host = boot.host;
  context.probe = boot.probe;
  context.boot = boot.boot;
  context.hostPort = boot.host.port;
  trackHost(run, context);

  phase('install-base');
  const baseSpec = `https://github.com/heswy/dsh-game-market.git#${targets.a}`;
  const outcome = await installExactWithRetry(context.probe, { spec: baseSpec, requestIdBase: `m3-two-hop-${run.runTag}-base` });
  evidence.installs = [{ phase: 'install-base', spec: baseSpec, result: outcome.result, attempts: outcome.attempts }];
  run.report.add('base-install-applied', outcome.result?.application === 'applied', outcome.result?.application ?? outcome.result?.error ?? null);
  if (outcome.result?.application !== 'applied') throw new Error(`base install did not apply: ${JSON.stringify(outcome.result)}`);
  const applied = await waitForHostVersion(context.probe, targets.versionA, { timeoutMs: 240000 });
  run.report.add('base-running-version', applied.ok === true, applied.ok ? applied.waitedMs : applied.last);
  const routeReady = await waitForRoute(context, { timeoutMs: 90000 });
  run.report.add('update-routes-available', routeReady.ok === true, routeReady.ok ? routeReady.waitedMs : null);
  const baseInspect = (await probeInspect(context)).body;
  run.report.add('discovery-target-is-mid', baseInspect?.target?.version === targets.versionB && baseInspect?.target?.commit === targets.b, baseInspect?.target ?? null);
  run.report.add('capability-can-begin-update', baseInspect?.capability?.canBeginUpdate === true, baseInspect?.capability ?? null);

  const dataFixture = seedUserData(home, `v1-two-hop-${run.runTag}`);
  evidence.dataBefore = readUserData(home, dataFixture);
  evidence.dataPreservation = { before: evidence.dataBefore };

  phase('open-real-page');
  run.page = trackPage(run, await openRealPage(context));
  const cdp = run.page.cdp;
  const initialUi = await readUpdateUi(cdp);
  run.report.add('real-page-market-panel-opened', run.page.marketOpened?.opened === true, run.page.marketOpened);
  run.report.add('initial-update-section-present', initialUi.sectionPresent === true, { discovery: initialUi.discovery, identities: initialUi.identities });
  run.report.add('initial-client-identity-base', (initialUi.identities?.[1]?.commitAttr ?? null) === (evidence.releases.base?.clientBuildCommit ?? null), { client: initialUi.identities?.[1] ?? null });
  await captureScreenshot(cdp, 'base-update-available');

  // Hop 1: base -> mid, real UI only.
  const hop1 = await performHop({ cdp, context, hopKey: 'B', toVersion: targets.versionB, expectedClientCommit: clientMid, previousOperationId: null, dataFixture });
  run.report.add('hop-B-operation-created', /^upd_[a-f0-9]{16}$/.test(String(hop1.operationId)), hop1.operationId);

  // Same profile/page: switch the index to the final target and refresh for real.
  await switchDiscoveryToFinal(cdp);

  // Hop 2: mid -> final, real UI only, must be a NEW operation.
  const hop2 = await performHop({ cdp, context, hopKey: 'FINAL', toVersion: targets.versionFinal, expectedClientCommit: clientFinal, previousOperationId: hop1.operationId, dataFixture });
  run.report.add('hops-use-different-operations', hop1.operationId !== hop2.operationId, { hop1: hop1.operationId, hop2: hop2.operationId });

  // Fixed-client refresh gate on the final page.
  phase('final-refresh-gate');
  const canRefresh = await discoveryCanRefresh(context, { timeoutMs: 90000 });
  run.report.add('final-host-can-refresh', canRefresh.ok === true, canRefresh.waitedMs ?? null);
  const gateAction = await waitForAction(cdp, 'refresh-update', { timeoutMs: 30000 });
  const checkedAtBefore = (await inspectFromPage(cdp)).data?.discovery?.checkedAt ?? null;
  const requestsBefore = run.transport.audit().requests.length;
  const refreshClick = gateAction.ok === true ? await clickAction(cdp, 'refresh-update', 'two-hop-final-refresh') : { clicked: false, reason: 'button-disabled-or-absent', waitedMs: gateAction.waitedMs };
  let checkedAtAfter = null;
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    const current = (await inspectFromPage(cdp)).data;
    if (current?.discovery?.checkedAt !== checkedAtBefore) { checkedAtAfter = current.discovery.checkedAt; break; }
    await sleep(500);
  }
  const requestsAdded = run.transport.audit().requests.length - requestsBefore;
  evidence.refreshGate = { canRefresh: canRefresh.ok, gateAction: { ok: gateAction.ok, waitedMs: gateAction.waitedMs }, click: refreshClick, checkedAtBefore, checkedAtAfter, requestsAdded };
  run.report.add('final-fixed-client-refresh-button-enabled', gateAction.ok === true, { waitedMs: gateAction.waitedMs });
  run.report.add('final-fixed-client-refresh-posted-real-request', refreshClick.clicked === true && checkedAtAfter !== null && requestsAdded === 1, evidence.refreshGate);

  // Single package change: profile dependency and disk both at FINAL.
  const finalProbe = await context.probe.send({ id: 'two-hop-observe-final', action: 'observe', label: 'final' });
  const dependency = finalProbe.snapshot?.profile?.dependency ?? null;
  run.report.add('single-package-change-to-final', String(dependency).endsWith(targets.final) && finalProbe.snapshot?.profile?.diskPackage?.version === targets.versionFinal, { dependency, diskPackage: finalProbe.snapshot?.profile?.diskPackage ?? null });

  const dataAfter = readUserData(home, dataFixture);
  const preservation = userDataPreserved(evidence.dataBefore, dataAfter);
  evidence.dataPreservation.after = dataAfter;
  run.report.add('user-data-preserved-across-both-hops', preservation.preserved === true, preservation);
  await captureScreenshot(cdp, 'final-updated');
}

let bootstrap = null;

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
  const transportProof = await cleanupProof({ ports: [run.transport?.port].filter((port) => Number.isInteger(port)), dirs: [run.tlsDir].filter(Boolean), label: 'v1-two-hop-transport-cleanup' });
  run.report.add('transport-and-tls-cleaned', transportProof.ok === true, transportProof);
  evidence.thrown = thrown === null ? null : String(thrown.stack ?? thrown);
  const summary = finalizeRun({
    report: run.report,
    evidenceRel: run.evidenceRel,
    runDir: run.runDir,
    extra: {
      runTag: run.runTag,
      targets,
      modeLabel: evidence.networkModeLabel,
      evidenceLevel: 'isolated-browser (same profile, one Client page, two consecutive real-UI hops; real native installs from exact commits; isolated host/profile + fixture index transport); NOT real Desktop/Electron main process',
      releases: evidence.releases,
      expectedClient: evidence.expectedClient,
      networkGate: evidence.networkGate,
      hops: evidence.hops,
      transitions: evidence.transitions,
      discoverySwitch: evidence.discoverySwitch,
      refreshGate: evidence.refreshGate,
      dataPreservation: evidence.dataPreservation,
      screenshots: evidence.screenshots,
      cleanup,
      thrown: evidence.thrown,
      environment: { node: process.version, platform: process.platform },
    },
  });
  process.exitCode = summary.summary.passed ? 0 : 1;
}
