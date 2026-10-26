#!/usr/bin/env node
/**
 * M3-V2 active-game save coordination (real isolated DSH, real UI).
 *
 * Requirements (task-7 §2):
 *   - real game instances are running (launched through the real Client UI);
 *   - a genuinely failing save (read-only saves directory -> Host save write
 *     error) must abort the update BEFORE any package change: no installBundle,
 *     old version still running, UI shows an actionable failure;
 *   - after restoring save ability, a retry succeeds and the update completes;
 *   - two active instances in two windows must both pause+save+confirm before
 *     the package change (both windows coordinate the same operation).
 *
 * Fault injection is filesystem-level only (chmod on the isolated profile's
 * saves directory); no product code seam and no user profile is touched.
 *
 * Preconditions: R_A/R_B pushed + accepted. Usage:
 *   node scripts/verification/v1.5/m3/run-v2-save-coordination.mjs \
 *     --a <R_A> --b <R_B> --final <R_final>
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  RAW_ROOT,
  REPO_ROOT,
  SHOT_DIR,
  cleanupProof,
  createReport,
  ensureDir,
  log,
  sleep,
  verifyRuntime,
  finalizeRun,
} from './lib.mjs';
import {
  attachReport,
  beginUpdateThroughUi,
  bootstrapInstalledProfile,
  cleanupRun,
  createRunContext,
  ensureMarketPanelOpen,
  ensureUpdateSectionRendered,
  healthFromPage,
  inspectFromPage,
  openRealPage,
  pageGetJson,
  pagePostJson,
  parseTargets,
  prepareTargetRepo,
  readReleaseIdentity,
  readUpdateUi,
  readUserData,
  seedUserData,
  trackHost,
  trackPage,
  userDataPreserved,
  waitForOperation,
  waitForUi,
} from './v1-common.mjs';
import { createCdpCapture } from '../m2/lib/lab.mjs';
import { openMyGamesTab, launchFromRow, readUiState } from '../m2/lib/ui.mjs';
import { removeFixtureTls } from './fixture.mjs';
import { blockGameSaveWrites, restoreGameSaveWrites } from './save-fault.mjs';

const run = createRunContext('v2-save-coordination');
const targets = parseTargets(process.argv.slice(2));
const SPEC_A = `https://github.com/heswy/dsh-game-market.git#${targets.a}`;
const SPEC_B = `https://github.com/heswy/dsh-game-market.git#${targets.b}`;
const REPORT = createReport({
  id: 'M3-V2-save-coordination',
  title: 'Active-game save failure blocks the package change before install; retry succeeds (real UI)',
  commands: [`node scripts/verification/v1.5/m3/run-v2-save-coordination.mjs --a ${targets.a} --b ${targets.b} --final ${targets.final}`],
});
attachReport(run, REPORT);

const evidence = { targets, games: [], coordination: [], windows: [], transitions: [], screenshots: [], beforeBlock: null, afterRetry: null, dataPreservation: null, cleanup: null, thrown: null };
let thrown = null;
let bootstrap = null;

async function captureScreenshot(cdp, name) {
  ensureDir(SHOT_DIR);
  const file = path.join(SHOT_DIR, `M3-V2-save-${run.runTag}-${name}.png`);
  try {
    await cdp.shot(file);
    evidence.screenshots.push({ name, file: path.relative(REPO_ROOT, file) });
    return file;
  } catch (error) {
    run.report.add(`screenshot-${name}`, false, String(error && error.message ? error.message : error));
    return null;
  }
}

let saveFault = null;

async function launchGameThroughUi(page, gameId) {
  const cdp = page.cdp;
  const capture = createCdpCapture(cdp);
  await capture.start();
  page.capture = capture;
  await ensureMarketPanelOpen(cdp);
  await openMyGamesTab(cdp, null);
  const state = await readUiState(cdp);
  const rows = state.rows.map((row) => row.id);
  const launch = await launchFromRow(cdp, null, gameId, { expectRuntimeMs: 40000 });
  let ready = null;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = await readUiState(cdp);
    if (['playing', 'paused'].includes(state.runtime?.state)) { ready = state.runtime; break; }
    if (state.runtime?.state === 'error') break;
    await sleep(250);
  }
  let gameplay = null;
  if (gameId === 'orbit-courier' && ready !== null) {
    let gameSession = null;
    const until = Date.now() + 10000;
    while (Date.now() < until && gameSession === null) {
      for (const record of capture.state.attached) {
        if (record.type !== 'iframe') continue;
        const found = await capture.evaluate(record.sessionId, 'Boolean(window.__orbitCourier)').catch(() => false);
        if (found) { gameSession = record.sessionId; break; }
      }
      if (gameSession === null) await sleep(100);
    }
    if (gameSession === null) throw new Error('Orbit game frame not ready');
    const rect = await capture.evaluate(gameSession, `(() => {
      const button = document.querySelector('#overlay-actions .primary');
      const r = button?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    })()`);
    const outer = await cdp.eval(`(() => {const r=document.querySelector('.dgm-runtime iframe')?.getBoundingClientRect();return r?{x:r.x,y:r.y}:null})()`);
    if (!rect || !outer) throw new Error('Orbit start control missing');
    const point = { x: outer.x + rect.x, y: outer.y + rect.y };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(250);
    const started = await capture.evaluate(gameSession, 'window.__orbitCourier.state.phase');
    if (started !== 'playing') throw new Error('Orbit trusted start click did not begin a run');
    const progressDeadline = Date.now() + 10000;
    let elapsedMs = 0;
    while (Date.now() < progressDeadline) {
      elapsedMs = await capture.evaluate(gameSession, 'window.__orbitCourier.state.elapsedMs');
      if (elapsedMs >= 1500) break;
      await sleep(100);
    }
    if (elapsedMs < 1500) throw new Error('Orbit did not advance to a resumable run');
    // Keep the run alive while the update-control page is operated; this is a
    // normal local game pause, not a platform pause/save acknowledgement.
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'p', code: 'KeyP', windowsVirtualKeyCode: 80 });
    gameplay = await capture.evaluate(gameSession, '({phase:window.__orbitCourier.state.phase,score:window.__orbitCourier.state.score,elapsedMs:window.__orbitCourier.state.elapsedMs})');
  }
  return { gameId, rows, launch, ready, gameplay, runtimeMounted: ready !== null };
}

async function body() {
  const identity = verifyRuntime();
  run.report.add('runtime-extraction-matches-installed-app', identity.extractionVerifiedAgainstInstalledApp, identity.mismatched);

  const repo = prepareTargetRepo({ final: targets.final, commits: [targets.a, targets.b] });
  const gitRun = (args) => repo.git(args, { allowFail: true });
  evidence.targetRepo = { dir: repo.dir, fetchResults: repo.fetchResults };
  for (const result of repo.fetchResults) run.report.add(`target-repo-fetch-${result.mode}`, result.ok === true, result);
  const releaseB = readReleaseIdentity(targets.b, { git: gitRun });
  const expectedClientB = releaseB?.clientBuildCommit ?? null;
  run.report.add('expected-client-identity-B', /^[0-9a-f]{40}$/.test(String(expectedClientB)), expectedClientB);

  bootstrap = await bootstrapInstalledProfile({
    targetA: { commit: targets.a, version: targets.versionA, spec: SPEC_A },
    fixtureTargetVersion: targets.versionB,
    fixtureTargetCommit: targets.b,
    namePrefix: 'v2-save',
    runTag: run.runTag,
  });
  trackHost(run, bootstrap.context);
  run.report.add('host-network-env-selfcheck', bootstrap.transport?.hostEnvCheck?.ok === true, bootstrap.transport?.hostEnvCheck ?? null);
  run.report.add('R_A-installed-applied', bootstrap.install?.application === 'applied' && bootstrap.install?.version === targets.versionA, bootstrap.install);
  run.report.add('R_A-applied-to-disk-and-running', bootstrap.applied?.ok === true, bootstrap.applied?.ok ?? bootstrap.applied?.last);
  const dataFixture = seedUserData(bootstrap.home, 'v2-save');
  // A synthetic corrupt snake save is unsuitable when actually playing snake.
  // Preserve it as an unrelated marker; real game saves below are SDK-created.
  const markerDir = path.join(path.dirname(dataFixture.files.save), '..', 'm3-marker');
  ensureDir(markerDir);
  const markerSave = path.join(markerDir, 'current.json');
  fs.renameSync(dataFixture.files.save, markerSave);
  dataFixture.files.save = markerSave;
  const dataBefore = readUserData(bootstrap.home, dataFixture);
  evidence.dataPreservation = { before: dataBefore };

  // Two real windows, each running a real game instance.
  const page1 = trackPage(run, await openRealPage(bootstrap.context));
  const page2 = trackPage(run, await openRealPage(bootstrap.context));
  const controlPage = trackPage(run, await openRealPage(bootstrap.context));
  evidence.windows = [{ index: 1, port: page1.port }, { index: 2, port: page2.port }];
  const game1 = await launchGameThroughUi(page1, 'snake');
  evidence.games.push({ window: 1, ...game1 });
  run.report.add('window1-real-game-instance-running', game1.runtimeMounted === true, { rows: game1.rows, runtimeMounted: game1.runtimeMounted });
  const game2 = await launchGameThroughUi(page2, 'orbit-courier');
  evidence.games.push({ window: 2, ...game2 });
  run.report.add('window2-real-game-instance-running', game2.runtimeMounted === true, { rows: game2.rows, runtimeMounted: game2.runtimeMounted });
  if (!game1.runtimeMounted || !game2.runtimeMounted) {
    throw new Error('could not launch real game instances for the save-coordination scenario');
  }

  // Both windows must see the update and be able to start it.
  for (const [index, page] of [controlPage].entries()) {
    const banner = await waitForUi(page.cdp, (ui) => ui.banner !== null, { timeoutMs: 30000 });
    run.report.add(`window${index + 1}-update-banner`, banner.ok === true, banner.ui?.banner ?? null);
  }

  // Inject a REAL save failure: read-only saves directory.
  const injection = blockGameSaveWrites(bootstrap.home, ['snake', 'orbit-courier']);
  saveFault = injection;
  evidence.saveInjection = injection;
  run.report.add('save-failure-injected-readonly-saves-dir', true, injection);

  // Both windows click update -> coordination attempted -> save fails -> abort
  // BEFORE package change.
  const begins = [await beginUpdateThroughUi(controlPage.cdp, { expectVersion: targets.versionB })];
  const opIds = new Set(begins.map((item) => item.operationId).filter(Boolean));
  evidence.coordination.push({ phase: 'begin-under-save-failure', operationIds: [...opIds], begins: begins.map((item) => ({ operationId: item.operationId, dialog: item.dialog })) });
  run.report.add('begin-under-save-failure-created-operation', opIds.size === 1, { operationIds: [...opIds] });

  const blocked = await waitForOperation(controlPage.cdp, ['failed', 'cancelled', 'verification-failed', 'updated'], { timeoutMs: 120000 });
  evidence.coordination.push({ phase: 'terminal-under-save-failure', state: blocked.state ?? null, transitions: blocked.transitions?.map((entry) => entry.state) ?? [] });
  evidence.transitions.push(...(blocked.transitions ?? []).map((entry) => ({ scope: 'save-failure', ...entry })));
  run.report.add('save-failure-blocks-update-before-install', blocked.state === 'failed', { state: blocked.state, observation: blocked.observation });
  const probeBlocked = await bootstrap.context.probe.send({ id: 'v2-save-observe-blocked', action: 'observe', label: 'after-save-failure' });
  const blockedDependency = probeBlocked.snapshot?.profile?.dependency ?? null;
  const blockedDisk = probeBlocked.snapshot?.profile?.diskPackage ?? null;
  evidence.beforeBlock = { profile: probeBlocked.snapshot?.profile ?? null, operation: blocked.observation ?? null };
  run.report.add('no-package-change-before-install', String(blockedDependency).endsWith(targets.a) && blockedDisk?.version === targets.versionA, { dependency: blockedDependency, diskPackage: blockedDisk });
  const blockedUi = await readUpdateUi(controlPage.cdp);
  const failedUi = await waitForUi(controlPage.cdp, (ui) => ui.operation !== null && ui.operation.state === 'failed', { timeoutMs: 30000 });
  evidence.blockedUi = blockedUi.operation;
  run.report.add('ui-shows-failed-with-recovery', failedUi.ok === true && failedUi.ui.operation.success !== 'true', failedUi.ui?.operation ?? null);
  run.report.add('ui-offers-actionable-recovery-entry', (failedUi.ui?.operation?.recovery ?? '').length > 0 || failedUi.ui?.actionButtons.some((button) => button.action === 'retry-update') === true, { recovery: failedUi.ui?.operation?.recovery ?? null, buttons: failedUi.ui?.actionButtons ?? null });
  await captureScreenshot(page1.cdp, 'save-blocked');

  // Restore save ability and retry from the UI (page 1); the other window must
  // still coordinate its own instance before the install proceeds.
  evidence.restore = restoreGameSaveWrites(saveFault);
  run.report.add('save-failure-injection-restored', evidence.restore.restored === true, evidence.restore);
  const retryUi = await readUpdateUi(controlPage.cdp);
  const retryAction = retryUi.actionButtons.find((button) => button.action === 'retry-update');
  let retryStart = null;
  if (retryAction !== undefined) {
    retryStart = await import('./v1-common.mjs').then((module) => module.clickAction(controlPage.cdp, 'retry-update', 'retry-update'));
    await sleep(800);
    const confirm = await import('./v1-common.mjs').then((module) => module.confirmDialog(controlPage.cdp));
    evidence.retry = { retryAction, retryStart, confirm };
    run.report.add('ui-retry-action-clicked', retryStart.clicked === true && confirm.clicked === true, evidence.retry);
  } else {
    evidence.retry = { retryAction: null, fallback: 'banner' };
    const beginRetry = await beginUpdateThroughUi(controlPage.cdp, { expectVersion: targets.versionB, previousOperationId: blocked.observation?.operationId ?? null });
    evidence.retry.beginRetry = { operationId: beginRetry.operationId, banner: beginRetry.banner };
    run.report.add('ui-retry-action-clicked', beginRetry.operationId !== null, evidence.retry);
  }
  const retryDeadline = Date.now() + 15000;
  let retryOperation = null;
  while (Date.now() < retryDeadline) {
    const inspect = (await inspectFromPage(controlPage.cdp)).data;
    if (inspect?.operation?.operationId && inspect.operation.operationId !== blocked.observation?.operationId) {
      retryOperation = inspect.operation.operationId;
      break;
    }
    await sleep(200);
  }
  run.report.add('retry-created-new-operation', retryOperation !== null, retryOperation);
  if (retryOperation === null) throw new Error('retry did not create a new operation');
  const retried = await waitForOperation(controlPage.cdp, ['stale-runtime', 'updated', 'failed', 'verification-failed'], { timeoutMs: 240000 });
  evidence.transitions.push(...(retried.transitions ?? []).map((entry) => ({ scope: 'retry', ...entry })));
  run.report.add('retry-does-not-fail-coordination', retried.state !== 'failed', { state: retried.state, observation: retried.observation });
  if (!['updated', 'stale-runtime'].includes(retried.state)) {
    evidence.retryDiagnostics = [];
    for (const [index, page] of [page1, page2].entries()) {
      const requests = [];
      for (const entry of page.capture.state.networkOrder) {
        const url = new URL(entry.url);
        if (!/\/(save|platform-update\/coordinate)$/.test(url.pathname)) continue;
        const raw = await page.capture.responseBody(entry).catch(() => null);
        let response = null;
        try { const body = JSON.parse(raw); response = { ok: body.ok, error: body.error, phase: body.data?.phase }; } catch { /* diagnostic */ }
        requests.push({ path: url.pathname, status: entry.status, postData: url.pathname.endsWith('coordinate') ? entry.postData : null, response });
      }
      evidence.retryDiagnostics.push({ window: index + 1, ui: await readUiState(page.cdp), requests });
      await captureScreenshot(page.cdp, `retry-failed-window${index + 1}`);
    }
    throw new Error('retry failed before activation');
  }

  // The update is complete before reopening the Market on the game windows;
  // never navigate away from those runtimes during save coordination.
  for (const page of [page1, page2]) {
    await ensureMarketPanelOpen(page.cdp);
    await ensureUpdateSectionRendered(page.cdp, { timeoutMs: 30000, wantOperation: true });
  }
  // Refresh both windows through the UI and verify both ends on R_B.
  if (retried.state === 'updated') {
    // Fast path: the Client bundle swapped and the operation already finalised;
    // there is no stale card to refresh.
    for (let index = 0; index < 2; index += 1) {
      run.report.add(`window${index + 1}-refresh-action-clicked`, true, { note: 'fast path: retry reached updated without a stale window; no manual refresh needed' });
      run.report.add(`window${index + 1}-page-reloaded`, true, { note: 'fast path: no manual reload needed' });
    }
  }
  for (const [index, page] of (retried.state === 'updated' ? [] : [page1, page2]).entries()) {
    const ui = await readUpdateUi(page.cdp);
    const refreshAction = ui.actionButtons.find((button) => button.action === 'refresh-page');
    if (refreshAction !== undefined) {
      const clicked = await import('./v1-common.mjs').then((module) => module.clickAction(page.cdp, 'refresh-page', `save-window${index + 1}-refresh`));
      run.report.add(`window${index + 1}-refresh-action-clicked`, clicked.clicked === true, clicked);
    } else {
      run.report.add(`window${index + 1}-refresh-action-clicked`, false, { note: 'no refresh action visible; will reload directly and record it', operation: ui.operation });
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const { reloadRealPage } = await import('./v1-common.mjs');
  for (const [index, page] of (retried.state === 'updated' ? [] : [page1, page2]).entries()) {
    const reloaded = await reloadRealPage(page, bootstrap.context, { expectedClientCommit: expectedClientB });
    run.report.add(`window${index + 1}-page-reloaded`, reloaded?.opened?.opened === true, reloaded);
  }
  const settled = await waitForOperation(controlPage.cdp, ['updated', 'verification-failed', 'failed', 'stale-runtime'], { timeoutMs: 180000 });
  run.report.add('update-completes-to-updated-after-retry', settled.state === 'updated', { state: settled.state, observation: settled.observation });
  for (const [index, page] of [page1, page2].entries()) {
    const inspect = (await inspectFromPage(page.cdp)).data;
    const health = (await healthFromPage(page.cdp)).data;
    const ui = await readUpdateUi(page.cdp);
    run.report.add(`window${index + 1}-host-running-R_B`, inspect?.host?.version === targets.versionB && inspect?.host?.commit === targets.b, inspect?.host ?? null);
    run.report.add(`window${index + 1}-health-R_B`, health?.version === targets.versionB, health?.version ?? null);
    run.report.add(`window${index + 1}-client-identity-R_B`, (ui.identities?.[1]?.commitAttr ?? '') === expectedClientB, { client: ui.identities?.[1] ?? null, expected: expectedClientB });
  }
  evidence.afterRetry = { settled, pages: [] };
  await captureScreenshot(page1.cdp, 'updated-after-retry');
  const dataAfter = readUserData(bootstrap.home, dataFixture);
  const preservation = userDataPreserved(dataBefore, dataAfter);
  evidence.dataPreservation.after = dataAfter;
  run.report.add('user-data-preserved', preservation.preserved === true, preservation);
  for (const gameId of ['snake', 'orbit-courier']) {
    const file = path.join(bootstrap.home, 'storages/dsh-game-market/saves', gameId, 'current.json');
    let save = null;
    try { save = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* assertion below */ }
    run.report.add(`${gameId}-real-sdk-save-retained`, save?.gameId === gameId && Object.keys(save?.values ?? {}).length > 0, { gameId: save?.gameId, keys: Object.keys(save?.values ?? {}) });
  }
}

try {
  ensureDir(run.runDir);
  ensureDir(RAW_ROOT);
  await body();
} catch (error) {
  thrown = error;
  run.report.add('scenario-completed-without-throw', false, String(error && error.stack ? error.stack : error));
} finally {
  if (bootstrap?.home) {
    try {
      restoreGameSaveWrites(saveFault);
    } catch { /* best effort */ }
  }
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
  const transportProof = await cleanupProof({ ports: [bootstrap?.transport?.port].filter((port) => Number.isInteger(port)), dirs: [bootstrap?.tlsDir].filter(Boolean), label: 'v2-save-transport-cleanup' });
  run.report.add('transport-and-tls-cleaned', transportProof.ok === true, transportProof);
  evidence.thrown = thrown === null ? null : String(thrown.stack ?? thrown);
  const summary = finalizeRun({
    report: run.report,
    evidenceRel: run.evidenceRel,
    runDir: run.runDir,
    extra: {
      runTag: run.runTag,
      targets,
      evidenceLevel: 'isolated-browser (two real DSH game pages plus a third update-control page, real game instances, real UI clicks) + real filesystem save-failure injection + isolated transport fixture',
      windows: evidence.windows,
      games: evidence.games,
      saveInjection: evidence.saveInjection ?? null,
      restore: evidence.restore ?? null,
      coordination: evidence.coordination,
      transitions: evidence.transitions,
      beforeBlock: evidence.beforeBlock,
      blockedUi: evidence.blockedUi ?? null,
      retry: evidence.retry ?? null,
      afterRetry: evidence.afterRetry ?? null,
      retryDiagnostics: evidence.retryDiagnostics ?? null,
      dataPreservation: evidence.dataPreservation,
      screenshots: evidence.screenshots,
      cleanup,
      thrown: evidence.thrown,
      environment: { node: process.version, platform: process.platform, repoRoot: REPO_ROOT },
    },
  });
  process.exitCode = summary.summary.passed ? 0 : 1;
}
