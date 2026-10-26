#!/usr/bin/env node
/**
 * M3-V1 preflight gate — runs in ~2 minutes and proves the V1 environment is
 * sound BEFORE the long update chains:
 *
 *   1. probe-release structural acceptance inputs are available (A/B/final
 *      exact-SHA fetch into temp clone) and identities read;
 *   2. fresh isolated profile + real exact-commit install of R_A; frozen routes up;
 *   3. real DSH page can open the Market panel + "版本与更新" section;
 *   4. **harness validity**: the served Client bundle is the INSTALLED R_A build
 *      (client build identity == 1.2.1 / P_A), not the worktree checkout, and the
 *      Host identity snapshot is not dev-row-shadowed (capability.canBeginUpdate
 *      must be true for a real update to be possible);
 *   5. discovery target is R_B, update banner visible;
 *   6. refresh fix: after the 60s manual-throttle window, the real UI refresh
 *      button is ENABLED (previously it stayed disabled ~6h because the countdown
 *      used discovery.nextCheckAt) and clicking it issues a real POST refresh
 *      without a 6h disable;
 *   7. cleanup proven (ports/PIDs/home/chrome).
 *
 * Exit 0 iff every required check passes. Evidence:
 * docs/verification/v1.5/raw/m3/M3-V1-preflight-<ts>.json
 *
 * Usage:
 *   node scripts/verification/v1.5/m3/run-v1-preflight.mjs \
 *     --a <R_A> --b <R_B> --final <R_final>
 */
import path from 'node:path';

import {
  RAW_ROOT,
  REPO_ROOT,
  SHOT_DIR,
  cleanupProof,
  createReport,
  ensureDir,
  finalizeRun,
  log,
  sleep,
  verifyRuntime,
} from './lib.mjs';
import {
  attachReport,
  bootstrapInstalledProfile,
  cleanupRun,
  clickAction,
  createRunContext,
  discoveryCanRefresh,
  healthFromPage,
  inspectFromPage,
  openRealPage,
  parseTargets,
  prepareTargetRepo,
  probeInspect,
  readReleaseIdentity,
  readServedClientIdentity,
  readUpdateUi,
  trackHost,
  trackPage,
  waitForHostVersion,
  waitForUi,
} from './v1-common.mjs';
import { removeFixtureTls } from './fixture.mjs';

const run = createRunContext('v1-preflight');
const targets = parseTargets(process.argv.slice(2));
const SPEC_A = `https://github.com/heswy/dsh-game-market.git#${targets.a}`;
const REPORT = createReport({
  id: 'M3-V1-preflight',
  title: 'V1 environment preflight: installed A identity, real page/UI, discovery target B, refresh fix',
  commands: [`node scripts/verification/v1.5/m3/run-v1-preflight.mjs --a ${targets.a} --b ${targets.b} --final ${targets.final}`],
});
attachReport(run, REPORT);
const evidence = { targets, targetIdentities: null, install: null, ui: null, inspect: null, refresh: null, screenshots: [], cleanup: null, thrown: null };
let thrown = null;
let bootstrap = null;

async function body() {
  const identity = verifyRuntime();
  run.report.add('runtime-extraction-matches-installed-app', identity.extractionVerifiedAgainstInstalledApp, identity.mismatched);

  const repo = prepareTargetRepo({ final: targets.final, commits: [targets.a, targets.b] });
  const gitRun = (args) => repo.git(args, { allowFail: true });
  evidence.targetRepo = { dir: repo.dir, fetchResults: repo.fetchResults };
  for (const result of repo.fetchResults) run.report.add(`target-repo-fetch-${result.mode}`, result.ok === true, result);
  const releaseA = readReleaseIdentity(targets.a, { git: gitRun });
  const releaseB = readReleaseIdentity(targets.b, { git: gitRun });
  const expectedClientA = releaseA?.clientBuildCommit ?? null;
  run.report.add('expected-client-identity-A', /^[0-9a-f]{40}$/.test(String(expectedClientA)), expectedClientA);
  run.report.add('expected-client-identity-A-version', releaseA?.version === targets.versionA, releaseA);

  bootstrap = await bootstrapInstalledProfile({
    targetA: { commit: targets.a, version: targets.versionA, spec: SPEC_A },
    fixtureTargetVersion: targets.versionB,
    fixtureTargetCommit: targets.b,
    namePrefix: 'v1-preflight',
    runTag: run.runTag,
  });
  trackHost(run, bootstrap.context);
  run.report.add('host-network-env-selfcheck', bootstrap.transport?.hostEnvCheck?.ok === true, bootstrap.transport?.hostEnvCheck ?? null);
  evidence.install = bootstrap.install;
  evidence.installAttempts = bootstrap.installAttempts ?? null;
  run.report.add('R_A-install-attempts-recorded', Array.isArray(bootstrap.installAttempts) && bootstrap.installAttempts.length > 0, { attempts: bootstrap.installAttempts ?? null, retried: bootstrap.installRetried === true });
  if (bootstrap.install?.application !== 'applied') {
    run.report.add('R_A-install-applied', false, bootstrap.install);
    throw new Error(`R_A exact-commit install did not apply (${bootstrap.install?.application ?? 'no result'}); evidence keeps the raw native result`);
  }
  run.report.add('R_A-install-applied', true, bootstrap.install);
  run.report.add('R_A-install-version', bootstrap.install?.version === targets.versionA, bootstrap.install?.version ?? null);
  run.report.add('R_A-running-version', bootstrap.applied?.ok === true, bootstrap.applied?.ok ?? bootstrap.applied?.last);

  const inspect = (await probeInspect(bootstrap.context)).body;
  evidence.inspect = inspect;
  run.report.add('host-capability-can-begin-update', inspect?.capability?.canBeginUpdate === true, inspect?.capability);
  run.report.add('host-not-dev-row-shadowed', inspect?.installed?.devRowShadow === false, { installed: inspect?.installed, capability: inspect?.capability });
  run.report.add('host-identity-loaded-version', inspect?.host?.version === targets.versionA, inspect?.host);
  run.report.add('host-identity-loaded-commit', inspect?.host?.commit === targets.a, { commit: inspect?.host?.commit ?? null, expected: targets.a });
  run.report.add('discovery-target-is-R_B', inspect?.target?.version === targets.versionB && inspect?.target?.commit === targets.b, inspect?.target);

  run.page = trackPage(run, await openRealPage(bootstrap.context));
  const cdp = run.page.cdp;
  run.report.add('real-page-market-panel-opened', run.page.marketOpened?.opened === true, run.page.marketOpened);
  const ui = await readUpdateUi(cdp);
  evidence.ui = ui;
  run.report.add('update-section-present', ui.sectionPresent === true, { discovery: ui.discovery, identities: ui.identities });
  run.report.add('ui-host-identity-A', (ui.identities?.[0]?.version ?? '').includes(targets.versionA), ui.identities?.[0] ?? null);
  run.report.add('ui-client-build-is-installed-A', (ui.identities?.[1]?.version ?? '').includes(targets.versionA) && ui.identities?.[1]?.commitAttr === expectedClientA, { client: ui.identities?.[1] ?? null, expected: { version: targets.versionA, buildCommit: expectedClientA } });
  run.report.add('ui-not-blocked', ui.blocked === null, ui.blocked);
  run.report.add('ui-update-banner-present', ui.banner !== null, ui.banner);
  const health = (await healthFromPage(cdp)).data;
  run.report.add('health-version-A', health?.version === targets.versionA, health?.version ?? null);

  // Served-bundle validity: the page must run the INSTALLED release client
  // (not the worktree checkout), proven from the served plugin bundle itself.
  const servedClient = await readServedClientIdentity(cdp);
  evidence.servedClient = servedClient;
  run.report.add('served-client-bundle-is-installed-A', servedClient.found === true && servedClient.identity?.buildCommit === expectedClientA && servedClient.identity?.version === targets.versionA, servedClient);

  // Fixed-client refresh gate (A2 builds on the fixed tree): after the 60s
  // manual throttle window the real UI refresh button MUST be enabled, and
  // clicking it must issue a real POST refresh (checkedAt changes, one request,
  // transient 60s throttle — no 6h disable).
  const canRefresh = await discoveryCanRefresh(bootstrap.context, { timeoutMs: 90000 });
  run.report.add('host-can-refresh-after-throttle', canRefresh.ok === true, canRefresh.waitedMs ?? null);
  // The Client re-inspects on its own schedule; poll the real UI until the
  // refresh control is enabled (bounded), then assert it.
  let uiBeforeRefresh = await readUpdateUi(cdp);
  let refreshButton = uiBeforeRefresh.actionButtons.find((button) => button.action === 'refresh-update');
  const buttonWaitStarted = Date.now();
  while ((refreshButton === undefined || refreshButton.disabled === true) && Date.now() - buttonWaitStarted < 30000) {
    await sleep(1000);
    uiBeforeRefresh = await readUpdateUi(cdp);
    refreshButton = uiBeforeRefresh.actionButtons.find((button) => button.action === 'refresh-update');
  }
  evidence.refresh = { canRefresh, buttonWaitMs: Date.now() - buttonWaitStarted, button: refreshButton ?? null, uiBeforeRefresh: { discovery: uiBeforeRefresh.discovery, actions: uiBeforeRefresh.actionButtons } };
  run.report.add('ui-refresh-button-enabled-after-throttle', refreshButton !== undefined && refreshButton.disabled !== true, refreshButton ?? null);
  const requestsBefore = bootstrap.transport.audit().requests.length;
  const checkedAtBefore = (await inspectFromPage(cdp)).data?.discovery?.checkedAt ?? null;
  const clicked = await clickAction(cdp, 'refresh-update', 'preflight-refresh');
  evidence.refresh.clicked = clicked;
  const samples = [];
  let refreshed = null;
  const waitStarted = Date.now();
  while (Date.now() - waitStarted < 20000) {
    const current = (await inspectFromPage(cdp)).data;
    const uiNow = await readUpdateUi(cdp);
    const buttonNow = uiNow.actionButtons.find((button) => button.action === 'refresh-update') ?? null;
    samples.push({ at: Date.now() - waitStarted, checkedAt: current?.discovery?.checkedAt ?? null, canRefresh: current?.discovery?.canRefresh ?? null, nextCheckAt: current?.discovery?.nextCheckAt ?? null, button: buttonNow });
    if (current?.discovery?.checkedAt !== checkedAtBefore) {
      refreshed = current;
      break;
    }
    await sleep(500);
  }
  evidence.refresh.samples = samples;
  if (refreshed === null) {
    // Second chance with an explicit JS element click (records whether the
    // trusted click was intercepted by layout while the handler is reachable).
    evidence.refresh.secondChance = await cdp.eval(`(() => {
      const node = document.querySelector('[data-action="refresh-update"]');
      if (!node) return { found: false };
      node.click();
      return { found: true, disabled: node.disabled === true };
    })()`);
    const retryStarted = Date.now();
    while (Date.now() - retryStarted < 15000) {
      const current = (await inspectFromPage(cdp)).data;
      if (current?.discovery?.checkedAt !== checkedAtBefore) {
        refreshed = current;
        break;
      }
      await sleep(500);
    }
    evidence.refresh.afterSecondChance = refreshed?.discovery?.checkedAt ?? null;
  }
  evidence.refresh.after = refreshed;
  evidence.refresh.requestsAdded = bootstrap.transport.audit().requests.length - requestsBefore;
  run.report.add('ui-refresh-click-posted-real-refresh', clicked.clicked === true && refreshed !== null, { clicked, before: checkedAtBefore, after: refreshed?.discovery?.checkedAt ?? null });
  run.report.add('ui-refresh-made-one-discovery-request', evidence.refresh.requestsAdded === 1, evidence.refresh.requestsAdded);
  run.report.add('ui-refresh-no-6h-disable', refreshed?.discovery?.nextCheckAt !== undefined && Date.parse(refreshed?.discovery?.nextCheckAt) < Date.now() + 90 * 1000, { nextCheckAt: refreshed?.discovery?.nextCheckAt ?? null });

  ensureDir(SHOT_DIR);
  const shot = path.join(SHOT_DIR, `M3-V1-preflight-${run.runTag}.png`);
  await cdp.shot(shot);
  evidence.screenshots.push({ name: 'preflight', file: path.relative(REPO_ROOT, shot) });
}

try {
  ensureDir(run.runDir);
  ensureDir(RAW_ROOT);
  await body();
} catch (error) {
  thrown = error;
  run.report.add('preflight-completed-without-throw', false, String(error && error.stack ? error.stack : error));
} finally {
  const cleanup = await cleanupRun(run);
  evidence.cleanup = cleanup;
  run.report.add('cleanup-proven', cleanup.proof?.ok === true, cleanup.proof);
  if (bootstrap?.transport) {
    try {
      await bootstrap.transport.close();
    } catch (error) {
      run.report.add('transport-close', false, String(error && error.message ? error.message : error));
    }
  }
  if (bootstrap?.tls) removeFixtureTls(bootstrap.tls);
  const transportProof = await cleanupProof({ ports: [bootstrap?.transport?.port].filter((port) => Number.isInteger(port)), dirs: [bootstrap?.tlsDir].filter(Boolean), label: 'v1-preflight-transport-cleanup' });
  run.report.add('transport-and-tls-cleaned', transportProof.ok === true, transportProof);
  evidence.thrown = thrown === null ? null : String(thrown.stack ?? thrown);
  const summary = finalizeRun({
    report: run.report,
    evidenceRel: run.evidenceRel,
    runDir: run.runDir,
    extra: {
      runTag: run.runTag,
      targets,
      evidenceLevel: 'isolated-browser preflight (real installed bundle + real page/UI) + isolated transport fixture',
      install: evidence.install,
      inspect: evidence.inspect,
      ui: evidence.ui,
      refresh: evidence.refresh,
      screenshots: evidence.screenshots,
      cleanup,
      thrown: evidence.thrown,
      environment: { node: process.version, platform: process.platform, repoRoot: REPO_ROOT },
    },
  });
  process.exitCode = summary.summary.passed ? 0 : 1;
}
