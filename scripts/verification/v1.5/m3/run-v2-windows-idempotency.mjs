#!/usr/bin/env node
/**
 * M3-V2 multi-window concurrency + idempotency (real isolated DSH, real UI).
 *
 * Scenario requirements (task-7 §1):
 *   - two real DSH pages (separate browser windows, same isolated Host/profile)
 *     both click "update" at the same time;
 *   - exactly ONE update operation exists: both pages must end up bound to the
 *     same operationId, no duplicate install starts, no duplicate package
 *     change;
 *   - both windows converge to the same terminal state; after the old clients
 *     are refreshed, both verify the same Host/Client identity;
 *   - repeated rapid clicks in one window stay idempotent (same operation).
 *
 * Preconditions: probe releases R_A/R_B/R_final pushed and structurally accepted.
 *
 * Usage:
 *   node scripts/verification/v1.5/m3/run-v2-windows-idempotency.mjs \
 *     --a <R_A> --b <R_B> --final <R_final> \
 *     [--version-a 1.2.1 --version-b 1.2.2 --version-final 1.3.0]
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  RAW_ROOT,
  REPO_ROOT,
  RUNS_ROOT,
  SHOT_DIR,
  cleanupProof,
  createReport,
  ensureDir,
  finalizeRun,
  log,
  verifyRuntime,
} from './lib.mjs';
import {
  attachReport,
  beginUpdateThroughUi,
  bootstrapInstalledProfile,
  cleanupRun,
  clickAction,
  createRunContext,
  healthFromPage,
  inspectFromPage,
  openRealPage,
  parseTargets,
  prepareTargetRepo,
  readReleaseIdentity,
  readUpdateUi,
  seedUserData,
  readUserData,
  trackHost,
  trackPage,
  userDataPreserved,
  waitForDiscoveredTarget,
  waitForOperation,
  waitForUi,
} from './v1-common.mjs';
import { removeFixtureTls } from './fixture.mjs';

const run = createRunContext('v2-windows-idempotency');
const targets = parseTargets(process.argv.slice(2));
const refs = [
  { key: 'A', commit: targets.a, version: targets.versionA, spec: `https://github.com/heswy/dsh-game-market.git#${targets.a}` },
  { key: 'B', commit: targets.b, version: targets.versionB, spec: `https://github.com/heswy/dsh-game-market.git#${targets.b}` },
];
const byKey = Object.fromEntries(refs.map((ref) => [ref.key, ref]));
const REPORT = createReport({
  id: 'M3-V2-windows-idempotency',
  title: 'Multi-window concurrent update + repeated-click idempotency (real UI, isolated DSH)',
  commands: [`node scripts/verification/v1.5/m3/run-v2-windows-idempotency.mjs --a ${targets.a} --b ${targets.b} --final ${targets.final}`],
});
attachReport(run, REPORT);

const evidence = { targets, windows: [], begin: [], operationIds: [], transitions: [], screenshots: [], final: {}, dataPreservation: null, cleanup: null, thrown: null };
let thrown = null;
let bootstrap = null;

function gitRunFor(repo) {
  return (args) => repo.git(args, { allowFail: true });
}

async function captureScreenshot(cdp, name) {
  ensureDir(SHOT_DIR);
  const file = path.join(SHOT_DIR, `M3-V2-windows-${run.runTag}-${name}.png`);
  try {
    await cdp.shot(file);
    evidence.screenshots.push({ name, file: path.relative(REPO_ROOT, file) });
    return file;
  } catch (error) {
    run.report.add(`screenshot-${name}`, false, String(error && error.message ? error.message : error));
    return null;
  }
}

async function body() {
  const identity = verifyRuntime();
  run.report.add('runtime-extraction-matches-installed-app', identity.extractionVerifiedAgainstInstalledApp, identity.mismatched);

  // Target identity from the pushed commits (temp clone; never the shared worktree).
  const repo = prepareTargetRepo({ final: targets.final, commits: [targets.a, targets.b] });
  const gitRun = gitRunFor(repo);
  evidence.targetRepo = { dir: repo.dir, fetchResults: repo.fetchResults };
  for (const result of repo.fetchResults) run.report.add(`target-repo-fetch-${result.mode}`, result.ok === true, result);
  const releaseA = readReleaseIdentity(targets.a, { git: gitRun });
  const releaseB = readReleaseIdentity(targets.b, { git: gitRun });
  const expectedClientA = releaseA?.clientBuildCommit ?? null;
  const expectedClientB = releaseB?.clientBuildCommit ?? null;
  run.report.add('expected-client-identities-recorded', /^[0-9a-f]{40}$/.test(String(expectedClientA)) && /^[0-9a-f]{40}$/.test(String(expectedClientB)), { expectedClientA, expectedClientB });

  // Fresh profile + real exact-commit install of A; fixture target is B.
  bootstrap = await bootstrapInstalledProfile({
    targetA: byKey.A,
    fixtureTargetVersion: byKey.B.version,
    fixtureTargetCommit: byKey.B.commit,
    namePrefix: 'v2-windows',
    runTag: run.runTag,
  });
  trackHost(run, bootstrap.context);
  run.report.add('R_A-installed-applied', bootstrap.install?.application === 'applied' && bootstrap.install?.version === byKey.A.version, bootstrap.install);
  run.report.add('R_A-applied-to-disk-and-running', bootstrap.applied?.ok === true, bootstrap.applied?.ok ?? bootstrap.applied?.last);
  run.report.add('update-routes-available', bootstrap.routeReady?.ok === true, bootstrap.routeReady?.ok ?? null);
  const dataFixture = seedUserData(bootstrap.home, 'v2-windows');
  const dataBefore = readUserData(bootstrap.home, dataFixture);
  evidence.dataPreservation = { before: dataBefore };

  // Two independent real pages (separate Chrome profiles) on the same Host.
  const page1 = trackPage(run, await openRealPage(bootstrap.context));
  const page2 = trackPage(run, await openRealPage(bootstrap.context));
  run.windows = [page1, page2];
  evidence.windows = [
    { index: 1, port: page1.port, chromePid: page1.chromePid, marketOpened: page1.marketOpened },
    { index: 2, port: page2.port, chromePid: page2.chromePid, marketOpened: page2.marketOpened },
  ];
  run.report.add('both-pages-opened', page1.marketOpened?.opened === true && page2.marketOpened?.opened === true, evidence.windows);

  // Both pages must independently show the update-available banner for B.
  for (const [index, page] of [page1, page2].entries()) {
    const discovered = await waitForDiscoveredTarget(page.cdp, byKey.B.version, { timeoutMs: 60000 });
    run.report.add(`window${index + 1}-discovers-R_B`, discovered.ok === true && discovered.target?.commit === byKey.B.commit, discovered.ok ? discovered.target : discovered.last?.target ?? null);
    const banner = await waitForUi(page.cdp, (ui) => ui.banner !== null, { timeoutMs: 30000 });
    run.report.add(`window${index + 1}-update-banner`, banner.ok === true, banner.ui?.banner ?? null);
  }

  // Concurrent "click update" in both windows.
  const begin1 = beginUpdateThroughUi(page1.cdp, { expectVersion: byKey.B.version });
  const begin2 = beginUpdateThroughUi(page2.cdp, { expectVersion: byKey.B.version });
  const [result1, result2] = await Promise.all([begin1, begin2]);
  evidence.begin = [result1, result2].map((result, index) => ({ window: index + 1, dialog: result.dialog, operationId: result.operationId, confirm: result.confirm }));
  for (const [index, result] of [result1, result2].entries()) {
    run.report.add(`window${index + 1}-begin-produced-operation`, /^upd_[a-f0-9]{16}$/.test(String(result.operationId)), result.operationId);
    run.report.add(`window${index + 1}-dialog-names-R_B`, result.dialogMatchesTargetVersion === true, result.dialog);
    if (result.operationId) evidence.operationIds.push(result.operationId);
  }
  run.report.add('both-windows-same-operation-id', result1.operationId !== null && result1.operationId === result2.operationId, { window1: result1.operationId, window2: result2.operationId });

  // Repeated rapid re-click in window 1 must not create a second operation.
  const uiAfterBegin = await readUpdateUi(page1.cdp);
  const bannerGone = uiAfterBegin.banner === null;
  let repeatClick = { clicked: false, reason: 'banner-not-present-after-operation-started' };
  if (!bannerGone) repeatClick = await clickAction(page1.cdp, 'open-update', 'repeat-open-update');
  const inspectAfterRepeat = (await inspectFromPage(page1.cdp)).data;
  evidence.repeatClick = { bannerGone, repeatClick, operationId: inspectAfterRepeat?.operation?.operationId ?? null };
  run.report.add('repeat-click-same-or-no-new-operation', inspectAfterRepeat?.operation?.operationId === result1.operationId, evidence.repeatClick);

  // Observe the same operation from BOTH windows while it progresses.
  const transitions = [];
  for (const [index, page] of [page1, page2].entries()) {
    const seen = await waitForOperation(page.cdp, ['stale-runtime', 'updated', 'verification-failed', 'failed', 'cancelled'], {
      timeoutMs: 180000,
      onTransition: (entry) => {
        transitions.push({ window: index + 1, at: entry.at, state: entry.state, operationId: entry.observation?.operationId ?? null });
      },
    });
    run.report.add(`window${index + 1}-observes-same-operation`, seen.transitions.every((entry) => entry.observation?.operationId === result1.operationId), seen.transitions.map((entry) => ({ state: entry.state, operationId: entry.observation?.operationId ?? null })));
    run.report.add(`window${index + 1}-reaches-stale-or-updated`, seen.ok === true, { state: seen.state ?? null });
  }
  evidence.transitions = transitions;
  run.report.record('operation-transitions-both-windows', transitions);

  // Old clients: refresh through the real UI action in both windows, then both
  // must converge on the same `updated` terminal state.
  for (const [index, page] of [page1, page2].entries()) {
    const refresh = await clickAction(page.cdp, 'refresh-page', `window${index + 1}-refresh-page`);
    run.report.add(`window${index + 1}-refresh-action-clicked`, refresh.clicked === true, refresh);
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));
  for (const [index, page] of [page1, page2].entries()) {
    const reloaded = await import('./v1-common.mjs').then((module) => module.reloadRealPage(page, bootstrap.context));
    run.report.add(`window${index + 1}-page-reloaded`, reloaded?.opened === true, reloaded);
  }
  const settled = [];
  for (const [index, page] of [page1, page2].entries()) {
    const terminal = await waitForOperation(page.cdp, ['updated', 'verification-failed', 'failed', 'cancelled', 'stale-runtime'], { timeoutMs: 180000 });
    settled.push(terminal);
    run.report.add(`window${index + 1}-terminal-updated`, terminal.state === 'updated', { state: terminal.state, observation: terminal.observation });
    const inspect = (await inspectFromPage(page.cdp)).data;
    const health = (await healthFromPage(page.cdp)).data;
    const ui = await readUpdateUi(page.cdp);
    evidence.final[`window${index + 1}`] = { inspect, health, ui: { operation: ui.operation, identities: ui.identities } };
    run.report.add(`window${index + 1}-host-identity-R_B`, inspect?.host?.version === byKey.B.version && inspect?.host?.commit === byKey.B.commit, inspect?.host ?? null);
    run.report.add(`window${index + 1}-health-R_B`, health?.version === byKey.B.version, health?.version ?? null);
    run.report.add(`window${index + 1}-client-identity-R_B`, (ui.identities?.[1]?.commitAttr ?? '') === expectedClientB, { client: ui.identities?.[1] ?? null, expected: expectedClientB });
    run.report.add(`window${index + 1}-operation-updated`, ui.operation?.state === 'updated', ui.operation);
  }
  run.report.add('both-windows-converged-updated', settled.every((terminal) => terminal.state === 'updated'), settled.map((terminal) => terminal.state));
  const opIds = new Set(settled.map((terminal) => terminal.observation?.operationId).filter(Boolean));
  run.report.add('exactly-one-operation-across-windows', opIds.size === 1 && [...opIds][0] === result1.operationId, { operationIds: [...opIds], expected: result1.operationId });
  await captureScreenshot(page1.cdp, 'window1-updated');
  await captureScreenshot(page2.cdp, 'window2-updated');

  // One install result only: the Host installed B once (disk/profile agree).
  const finalProbe = await bootstrap.context.probe.send({ id: 'v2-windows-observe-final', action: 'observe', label: 'final' });
  const dependency = finalProbe.snapshot?.profile?.dependency ?? null;
  run.report.add('single-package-change-to-R_B', String(dependency).endsWith(byKey.B.commit) && finalProbe.snapshot?.profile?.diskPackage?.version === byKey.B.version, { dependency, diskPackage: finalProbe.snapshot?.profile?.diskPackage ?? null });
  const dataAfter = readUserData(bootstrap.home, dataFixture);
  const preservation = userDataPreserved(dataBefore, dataAfter);
  evidence.dataPreservation.after = dataAfter;
  run.report.add('user-data-preserved', preservation.preserved === true, preservation);
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
  if (bootstrap?.transport) {
    try {
      await bootstrap.transport.close();
    } catch (error) {
      run.report.add('transport-close', false, String(error && error.message ? error.message : error));
    }
  }
  if (bootstrap?.tls) removeFixtureTls(bootstrap.tls);
  const transportProof = await cleanupProof({ ports: [bootstrap?.transport?.port].filter((port) => Number.isInteger(port)), dirs: [bootstrap?.tlsDir].filter(Boolean), label: 'v2-windows-transport-cleanup' });
  run.report.add('transport-and-tls-cleaned', transportProof.ok === true, transportProof);
  evidence.thrown = thrown === null ? null : String(thrown.stack ?? thrown);
  const summary = finalizeRun({
    report: run.report,
    evidenceRel: run.evidenceRel,
    runDir: run.runDir,
    extra: {
      runTag: run.runTag,
      targets,
      evidenceLevel: 'isolated-browser (two real DSH pages + real Client UI clicks) + real installed bundle + isolated transport fixture',
      windows: evidence.windows,
      begin: evidence.begin,
      operationIds: evidence.operationIds,
      repeatClick: evidence.repeatClick ?? null,
      transitions: evidence.transitions,
      final: evidence.final,
      dataPreservation: evidence.dataPreservation,
      screenshots: evidence.screenshots,
      cleanup,
      thrown: evidence.thrown,
      environment: { node: process.version, platform: process.platform, repoRoot: REPO_ROOT },
    },
  });
  process.exitCode = summary.summary.passed ? 0 : 1;
}
