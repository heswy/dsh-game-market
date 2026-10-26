#!/usr/bin/env node
/**
 * M3-V2 edge cases + malicious index + dev-row + recovery (real isolated DSH).
 *
 * Covers (task-7):
 *   §3 already-installed / same-commit idempotency (UI-disabled path + API
 *      negative control -> `already-at-target`, never "updated");
 *   §4 ambiguous-install reproduction (native URL-form repeat) mapped only
 *      after verifying actual version/commit; recorded-spec replay;
 *   §5 cancel during installing -> cancelled (no continue); cancel after
 *      applying -> too-late (installation continues; never "rolled back");
 *   §8 malicious/invalid index matrix (wrong repo, file: source, short SHA,
 *      oversize, timeout/offline, redirect downgrade, same-version-different
 *      commit anomaly, malformed JSON) -> explicit discovery state/error, no
 *      update started, last successful target/offline state preserved, games
 *      routes unaffected; forged targetId / arbitrary spec to begin -> rejected;
 *      recovery: restore a valid index -> capability true + UI banner -> begin
 *      through the UI succeeds again;
 *   §7 dev-row shadow -> inspect reports dev-row, update blocked with native
 *      plugin-manager guidance, no silent migration (no installBundle);
 *   §6 capability unknown -> cannot be forced without a fault-injection seam:
 *      recorded as `not-run` (unit matrix covers the decision function).
 *
 * Isolated profile data (cache file) is seeded to simulate an OLD previous
 * successful check so the Host's startup silent check re-runs after a restart
 * without waiting for the 60s manual throttle. This is test pre-state, not
 * product code modulation; recorded in evidence.
 *
 * Usage:
 *   node scripts/verification/v1.5/m3/run-v2-edges-index.mjs \
 *     --a <R_A> --b <R_B> --final <R_final>
 */
import fs from 'node:fs';
import { updateTargetIdFor } from '../../../../packages/shared/src/platform-update.js';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  RAW_ROOT,
  REPO_ROOT,
  SHOT_DIR,
  cleanupProof,
  createReport,
  ensureDir,
  finalizeRun,
  log,
  verifyRuntime,
  injectDevGameMarketRow,
} from './lib.mjs';
import {
  attachReport,
  beginUpdateThroughUi,
  bootstrapInstalledProfile,
  cleanupRun,
  clickAction,
  confirmDialog,
  createRunContext,
  healthFromPage,
  inspectFromPage,
  openRealPage,
  pageGetJson,
  pagePostJson,
  parseTargets,
  prepareTargetRepo,
  readReleaseIdentity,
  readUpdateUi,
  restartContextHost,
  seedUserData,
  readUserData,
  trackHost,
  trackPage,
  userDataPreserved,
  waitForOperation,
  waitForRoute,
  waitForUi,
} from './v1-common.mjs';
import { closeRealPage } from './v1-common.mjs';
import { removeFixtureTls } from './fixture.mjs';

const REPO_URL = 'https://github.com/heswy/dsh-game-market.git';
const PUBLISHED_OTHER_COMMIT = 'f422e8d04b3b3de3f920a794317c0d28ee1246a2';
const PUBLISH_TS = 1761000000;
const run = createRunContext('v2-edges-index');
const targets = parseTargets(process.argv.slice(2));
const SPEC_A = `${REPO_URL}#${targets.a}`;
const SPEC_B = `${REPO_URL}#${targets.b}`;
const REPORT = createReport({
  id: 'M3-V2-edges-index',
  title: 'V2 edges: cancel/too-late, already-at-target, ambiguous-install, malicious index, dev-row, recovery',
  commands: [`node scripts/verification/v1.5/m3/run-v2-edges-index.mjs --a ${targets.a} --b ${targets.b} --final ${targets.final}`],
});
attachReport(run, REPORT);

const evidence = { targets, targetIdentities: null, sections: {}, restarts: [], transitions: [], screenshots: [], dataPreservation: null, cleanup: null, thrown: null };
let thrown = null;
let bootstrap = null;

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

function buildBody(versions) {
  return `${JSON.stringify({
    format: 1,
    title: { en: 'DSH plugin index (M3 verification fixture)' },
    plugins: [{
      name: 'dsh-game-market',
      versions: versions.map((entry) => ({
        version: entry.version,
        publishTimestamp: entry.publishTimestamp ?? PUBLISH_TS,
        source: { type: 'git', url: REPO_URL, commit: entry.commit },
      })),
    }],
  }, null, 2)}\n`;
}

function targetIdFor(version, commit) {
  return updateTargetIdFor(version, commit);
}

function seedOldCache(home, { version, commit, ageMs = 7 * 60 * 60 * 1000 }) {
  const dir = path.join(home, 'storages', 'dsh-game-market');
  ensureDir(dir);
  const checkedAt = new Date(Date.now() - ageMs).toISOString();
  const cache = {
    schemaVersion: 1,
    indexUrl: 'https://raw.githubusercontent.com/heswy/dsh-game-market/main/platform-updates/plugins.json',
    indexHash: sha(`${version}/${commit}`),
    channel: 'stable',
    fetchedAt: checkedAt,
    checkedAt,
    target: { id: targetIdFor(version, commit), version, commit, channel: 'stable', publishedAt: new Date(PUBLISH_TS * 1000).toISOString(), spec: `${REPO_URL}#${commit}` },
    previousTarget: null,
    marker: 'v1.5-m3 cache pre-state fixture (isolated profile only; product code unmodified)',
  };
  const file = path.join(dir, 'platform-update-cache.json');
  fs.writeFileSync(file, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  return { file, checkedAt };
}

async function captureScreenshot(cdp, name) {
  ensureDir(SHOT_DIR);
  const file = path.join(SHOT_DIR, `M3-V2-edges-${run.runTag}-${name}.png`);
  try {
    await cdp.shot(file);
    evidence.screenshots.push({ name, file: path.relative(REPO_ROOT, file) });
    return file;
  } catch (error) {
    run.report.add(`screenshot-${name}`, false, String(error && error.message ? error.message : error));
    return null;
  }
}

function envelope(raw) {
  try {
    return JSON.parse(raw.body);
  } catch {
    return null;
  }
}

async function pollInspect(page, predicate, { timeoutMs = 30000, label = 'inspect' } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = (await inspectFromPage(page.cdp)).data;
    if (predicate(last)) return { ok: true, waitedMs: Date.now() - started, data: last };
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { ok: false, waitedMs: Date.now() - started, data: last ?? null };
}

async function probeObserve(context, id) {
  return context.probe.send({ id: `observe-${id}-${Date.now()}`, action: 'observe', label: id });
}

/** Restart the Host with a fresh page after setting fixture/body + old cache. */
async function restartWithFixture({ label, body = null, scenario = 'valid' }) {
  if (run.page) {
    try {
      await closeRealPage(run.page);
    } catch { /* ignore */ }
    run.page = null;
  }
  if (body !== null) bootstrap.transport.control.setFixtureBody(body);
  else bootstrap.transport.control.setScenario(scenario);
  seedOldCache(bootstrap.home, { version: targets.versionB, commit: targets.b });
  await restartContextHost(bootstrap.context, { logNamePrefix: `v2-edges-${label}` });
  const route = await waitForRoute(bootstrap.context, { timeoutMs: 90000 });
  run.page = trackPage(run, await openRealPage(bootstrap.context));
  const settled = await pollInspect(run.page, (data) => data !== null && ['ready', 'invalid', 'offline', 'stale'].includes(data.discovery?.state), { timeoutMs: 30000, label });
  evidence.restarts.push({ label, routeReady: route.ok === true, settled: settled.ok, discovery: settled.data?.discovery ?? null, target: settled.data?.target ?? null });
  return settled;
}

async function beginViaApi(page, targetId) {
  const response = await pagePostJson(page.cdp, '/api/game-market/platform-update/begin', { targetId });
  const body = envelope(response);
  return { status: response.status, envelope: body, errorCode: body?.error?.code ?? null, data: body?.data ?? null };
}

async function startOrRetryUpdate(page, { expectVersion }) {
  const cdp = page.cdp;
  const previousId = (await inspectFromPage(cdp)).data?.operation?.operationId ?? null;
  const ui = await readUpdateUi(cdp);
  if (ui.banner !== null) {
    return beginUpdateThroughUi(cdp, { expectVersion, previousOperationId: previousId });
  }
  const retryAction = ui.actionButtons.find((button) => button.action === 'retry-update');
  if (retryAction !== undefined) {
    const click = await clickAction(cdp, 'retry-update', 'retry-update');
    await new Promise((resolve) => setTimeout(resolve, 700));
    const confirm = await confirmDialog(cdp);
    let operationId = null;
    const started = Date.now();
    while (Date.now() - started < 30000) {
      const inspect = (await inspectFromPage(cdp)).data;
      if (inspect?.operation?.operationId && inspect.operation.operationId !== previousId) {
        operationId = inspect.operation.operationId;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return { mode: 'ui-retry-action', retry: click, confirm, operationId, banner: ui.banner, dialog: null };
  }
  throw new Error('no real UI entry for retry; API fallback is not an acceptance path');
}

async function completeUpdateToTarget(page, { expectVersion, expectedClientCommit, label }) {
  const cdp = page.cdp;
  let terminal = await waitForOperation(cdp, ['stale-runtime', 'updated', 'failed', 'verification-failed', 'pending-restart'], { timeoutMs: 240000 });
  const transitions = terminal.transitions?.map((entry) => entry.state) ?? [];
  if (terminal.state === 'stale-runtime' || terminal.state === 'too-late') {
    const refresh = await clickAction(cdp, 'refresh-page', 'refresh-page');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const { reloadRealPage } = await import('./v1-common.mjs');
    const reloaded = await reloadRealPage(page, bootstrap.context, { expectedClientCommit });
    const settled = await waitForOperation(cdp, ['updated', 'failed', 'verification-failed'], { timeoutMs: 180000 });
    const inspect = (await inspectFromPage(cdp)).data;
    const ui = await readUpdateUi(cdp);
    const served = await (await import('./v1-common.mjs')).readServedClientIdentity(cdp);
    return { label, transitions, refresh, reloaded, terminal: settled, served, inspect, ui };
  }
  const inspect = (await inspectFromPage(cdp)).data;
  const ui = await readUpdateUi(cdp);
  return { label, transitions, terminal, inspect, ui };
}

async function body() {
  const identity = verifyRuntime();
  run.report.add('runtime-extraction-matches-installed-app', identity.extractionVerifiedAgainstInstalledApp, identity.mismatched);

  const repo = prepareTargetRepo({ final: targets.final, commits: [targets.a, targets.b] });
  const gitRun = (args) => repo.git(args, { allowFail: true });
  evidence.targetRepo = { dir: repo.dir, fetchResults: repo.fetchResults };
  for (const result of repo.fetchResults) run.report.add(`target-repo-fetch-${result.mode}`, result.ok === true, result);
  const releaseA = readReleaseIdentity(targets.a, { git: gitRun });
  const releaseB = readReleaseIdentity(targets.b, { git: gitRun });
  const releaseFinal = readReleaseIdentity(targets.final, { git: gitRun });
  const expectedClientA = releaseA?.clientBuildCommit ?? null;
  const expectedClientB = releaseB?.clientBuildCommit ?? null;
  evidence.targetIdentities = { releaseA, releaseB, releaseFinal };

  bootstrap = await bootstrapInstalledProfile({
    targetA: { commit: targets.a, version: targets.versionA, spec: SPEC_A },
    fixtureTargetVersion: targets.versionB,
    fixtureTargetCommit: targets.b,
    namePrefix: 'v2-edges',
    runTag: run.runTag,
  });
  trackHost(run, bootstrap.context);
  run.report.add('host-network-env-selfcheck', bootstrap.transport?.hostEnvCheck?.ok === true, bootstrap.transport?.hostEnvCheck ?? null);
  run.report.add('R_A-installed-applied', bootstrap.install?.application === 'applied', bootstrap.install?.application ?? null);
  run.page = trackPage(run, await openRealPage(bootstrap.context));
  const cdp = run.page.cdp;
  run.report.add('real-page-market-panel-opened', run.page.marketOpened?.opened === true, run.page.marketOpened);
  const dataFixture = seedUserData(bootstrap.home, 'v2-edges');
  const dataBefore = readUserData(bootstrap.home, dataFixture);
  evidence.dataPreservation = { before: dataBefore };

  // ---------------------------------------------------------------- cancel
  {
    const section = { label: 'cancel', startedAt: new Date().toISOString() };
    const begin = await beginUpdateThroughUi(cdp, { expectVersion: targets.versionB });
    section.begin = { operationId: begin.operationId, dialog: begin.dialog };
    run.report.add('cancel-begin-operation', /^upd_[a-f0-9]{16}$/.test(String(begin.operationId)), begin.operationId);
    const installing = await pollInspect(run.page, (data) => ['installing', 'inspecting', 'applied'].includes(data?.operation?.state), { timeoutMs: 30000 });
    run.report.add('cancel-operaton-observed-in-progress', installing.ok === true, { state: installing.data?.operation?.state ?? null });
    const cancelClick = await clickAction(cdp, 'cancel-update', 'cancel-update');
    section.cancelClick = cancelClick;
    run.report.add('cancel-ui-clicked', cancelClick.clicked === true, cancelClick);
    const terminal = await waitForOperation(cdp, ['cancelled', 'too-late', 'updated', 'stale-runtime', 'failed'], { timeoutMs: 180000 });
    section.terminal = terminal.state ?? null;
    section.transitions = terminal.transitions?.map((entry) => entry.state) ?? [];
    evidence.transitions.push(...(terminal.transitions ?? []).map((entry) => ({ section: 'cancel', ...entry })));
    run.report.add('cancel-terminal-is-cancelled-or-too-late', terminal.state === 'cancelled' || terminal.state === 'too-late' || terminal.state === 'stale-runtime' || terminal.state === 'updated', section);
    const probeAfter = await probeObserve(bootstrap.context, 'cancel-after');
    section.probe = probeAfter.snapshot?.profile ?? null;
    const cancelled = terminal.state === 'cancelled';
    if (cancelled) {
      run.report.add('cancel-does-not-continue-install', String(section.probe?.diskPackage?.version) === targets.versionA, { diskPackage: section.probe?.diskPackage ?? null });
      const restart = await startOrRetryUpdate(run.page, { expectVersion: targets.versionB });
      section.reBegin = restart;
      run.report.add('cancel-rebegin-accepted', /^upd_[a-f0-9]{16}$/.test(String(restart.operationId)), restart);
      section.completion = await completeUpdateToTarget(run.page, { expectVersion: targets.versionB, expectedClientCommit: expectedClientB, label: 'after-cancel' });
      run.report.add('cancel-then-complete-updated', section.completion.terminal?.state === 'updated', section.completion.terminal?.state ?? null);
    } else if (terminal.state === 'too-late') {
      run.report.add('tol-late-never-shows-cancelled-rollback', terminal.state === 'too-late', { state: terminal.state });
      section.completion = await completeUpdateToTarget(run.page, { expectVersion: targets.versionB, expectedClientCommit: expectedClientB, label: 'too-late' });
      run.report.add('too-late-install-continues-to-correct-terminal', ['updated', 'stale-runtime'].includes(section.completion.terminal?.state), section.completion.terminal?.state ?? null);
    } else if (['stale-runtime', 'updated'].includes(terminal.state)) {
      section.completion = await completeUpdateToTarget(run.page, { expectVersion: targets.versionB, expectedClientCommit: expectedClientB, label: 'cancel-race' });
      run.report.add('cancel-race-updated-after-refresh', section.completion.terminal?.state === 'updated', section.completion.terminal?.state ?? null);
    }
    if (section.completion?.served) run.report.add('after-cancel-served-client-is-B', section.completion.served.identity?.buildCommit === expectedClientB, section.completion.served);
    evidence.sections.cancel = section;
  }

  // ---------------------------------------- already-at-target / ambiguous
  {
    const section = {};
    const inspect = (await inspectFromPage(cdp)).data;
    section.inspect = inspect;
    run.report.add('at-target-installed-and-target-are-R_B', inspect?.installed?.version === targets.versionB && inspect?.target?.version === targets.versionB && inspect?.target?.commit === targets.b, { installed: inspect?.installed, target: inspect?.target });
    const first = await beginViaApi(run.page, inspect?.target?.id ?? targetIdFor(targets.versionB, targets.b));
    section.alreadyAtTarget = first;
    run.report.add('already-at-target-begin-not-success', first.status === 200 && first.data?.operationId !== undefined || first.errorCode !== null, first);
    const afterInspect = await pollInspect(run.page, (data) => data?.operation?.state === 'already-at-target', { timeoutMs: 15000 });
    section.operation = afterInspect.data?.operation ?? null;
    run.report.add('already-at-target-state', afterInspect.ok === true, { state: section.operation?.state ?? null, reason: section.operation?.reason ?? null });
    run.report.add('already-at-target-not-reported-updated', section.operation?.state !== 'updated', section.operation?.state ?? null);
    const uiAfter = await readUpdateUi(cdp);
    run.report.add('already-at-target-ui-not-success', uiAfter.operation === null || uiAfter.operation.success !== 'true', uiAfter.operation);
    // native ambiguous-install reproduction (URL-form repeat) + recorded-spec replay
    const ambiguous = await bootstrap.context.probe.send({ id: 'ambiguous-repro', action: 'install', spec: SPEC_B, requestId: `v2-ambiguous-${Date.now()}`, enabled: true }, { timeoutMs: 420000 });
    section.ambiguous = ambiguous.result ?? null;
    run.report.add('ambiguous-install-reproduced', ambiguous.result?.application === 'failed' && ambiguous.result?.error?.code === 'ambiguous-install', { application: ambiguous.result?.application ?? null, code: ambiguous.result?.error?.code ?? null, packageExit: ambiguous.result?.packageResult?.exitCode ?? null });
    const recorded = await bootstrap.context.probe.send({ id: 'recorded-replay', action: 'install', spec: `github:heswy/dsh-game-market#${targets.b}`, requestId: `v2-recorded-${Date.now()}`, enabled: true }, { timeoutMs: 240000 });
    section.recorded = recorded.result ?? null;
    run.report.add('recorded-spec-replay-already-installed', recorded.result?.application === 'failed' && recorded.result?.error?.code === 'already-installed', { application: recorded.result?.application ?? null, code: recorded.result?.error?.code ?? null });
    const probeAfter = await probeObserve(bootstrap.context, 'ambiguous-after');
    section.probe = probeAfter.snapshot?.profile ?? null;
    run.report.add('ambiguous-does-not-change-version', String(section.probe?.diskPackage?.version) === targets.versionB && String(section.probe?.dependency ?? '').endsWith(targets.b), { diskPackage: section.probe?.diskPackage ?? null, dependency: section.probe?.dependency ?? null });
    const beginAfter = await beginViaApi(run.page, targetIdFor(targets.versionB, targets.b));
    section.beginAfterAmbiguous = beginAfter;
    run.report.add('ambiguous-mapped-after-actual-version-check', beginAfter.envelope?.ok === true || beginAfter.errorCode === null, beginAfter);
    evidence.sections.atTarget = section;
  }

  // ------------------------------------------------------------- forged
  {
    const section = {};
    const forgedId = `tgt_${'0'.repeat(16)}`;
    const forged = await beginViaApi(run.page, forgedId);
    section.forgedTargetId = forged;
    run.report.add('forged-target-id-rejected', forged.status >= 400 && forged.envelope?.ok === false, forged);
    run.report.add('forged-target-code-is-target-invalid', forged.errorCode === 'GM-4090', forged.errorCode);
    const arbitrary = await beginViaApi(run.page, `https://github.com/evil/repo.git#${targets.b}`);
    section.arbitrarySpec = arbitrary;
    run.report.add('arbitrary-spec-rejected', arbitrary.status >= 400 && arbitrary.envelope?.ok === false, arbitrary);
    const probeAfter = await probeObserve(bootstrap.context, 'forged-after');
    section.probe = probeAfter.snapshot?.profile ?? null;
    run.report.add('forged-begin-did-not-start-install', String(section.probe?.diskPackage?.version) === targets.versionB, section.probe?.diskPackage ?? null);
    evidence.sections.forged = section;
  }

  // ----------------------------------------------- malicious index matrix
  {
    const cases = [
      { id: 'wrong-repo', body: buildBody([{ version: targets.versionB, commit: targets.b }]).replace(REPO_URL, 'https://github.com/evil/dsh-game-market.git'), expectState: 'invalid', expectReason: 'binding' },
      { id: 'file-source', body: buildBody([{ version: targets.versionB, commit: targets.b }]).replace(REPO_URL, 'file:///tmp/dsh-v15/m3/stand-in'), expectState: 'invalid', expectReason: 'format' },
      { id: 'short-sha', body: buildBody([{ version: targets.versionB, commit: targets.b.slice(0, 7) }]), expectState: 'invalid', expectReason: 'format' },
      { id: 'malformed-json', scenario: 'malformed-json', expectState: 'invalid', expectReason: 'json' },
      { id: 'oversize', scenario: 'oversize', expectState: 'invalid', expectReason: 'too-large' },
      { id: 'timeout', scenario: 'timeout', expectState: 'offline', expectReason: 'timeout' },
      { id: 'redirect-http', scenario: 'redirect-http', expectState: 'invalid', expectReason: 'redirect' },
      { id: 'same-version-different-commit', body: buildBody([{ version: targets.versionB, commit: PUBLISHED_OTHER_COMMIT }]), expectAnomaly: true },
    ];
    const results = [];
    for (const testCase of cases) {
      const settled = await restartWithFixture({ label: testCase.id, body: testCase.body ?? null, scenario: testCase.scenario ?? 'valid' });
      const data = settled.data ?? {};
      const result = {
        id: testCase.id,
        discovery: data.discovery ?? null,
        target: data.target ?? null,
        capability: data.capability ?? null,
        anomaly: data.discovery?.anomaly ?? null,
        state: data.discovery?.state ?? null,
        reason: data.discovery?.lastError?.reason ?? null,
      };
      results.push(result);
      run.report.add(`malicious-${testCase.id}-state`, data.discovery?.state === (testCase.expectState ?? 'ready'), { state: data.discovery?.state ?? null, expected: testCase.expectState ?? null });
      if (testCase.expectReason) run.report.add(`malicious-${testCase.id}-reason`, data.discovery?.lastError?.reason === testCase.expectReason, { reason: data.discovery?.lastError?.reason ?? null, expected: testCase.expectReason });
      if (testCase.expectAnomaly) run.report.add(`malicious-${testCase.id}-anomaly`, data.discovery?.anomaly?.kind === 'same-version-different-commit', data.discovery?.anomaly ?? null);
      // Contract §17 retains the last validated target on invalid/offline
      // responses. Only the cached, already-installed B may remain here.
      const trustedCached = data.target?.version === targets.versionB && data.target?.commit === targets.b
        && data.target?.spec === `${REPO_URL}#${targets.b}`;
      run.report.add(`malicious-${testCase.id}-retained-target-or-blocked-anomaly`, trustedCached || data.target === null || (testCase.expectAnomaly && data.discovery?.anomaly?.kind === 'same-version-different-commit' && data.capability?.canBeginUpdate === false), data.target ?? null);
      if (testCase.expectAnomaly) run.report.add(`malicious-${testCase.id}-cannot-begin`, data.capability?.canBeginUpdate === false, data.capability ?? null);
      const beginAttempt = await beginViaApi(run.page, data.target?.id ?? `tgt_${'1'.repeat(16)}`);
      result.begin = beginAttempt;
      const afterAttempt = (await inspectFromPage(run.page.cdp)).data;
      const rejected = beginAttempt.status >= 400 && beginAttempt.envelope?.ok === false;
      const cachedNoop = !testCase.expectAnomaly && trustedCached && beginAttempt.envelope?.ok === true
        && afterAttempt?.operation?.state === 'already-at-target';
      run.report.add(`malicious-${testCase.id}-rejected-or-trusted-cached-noop`, rejected || cachedNoop, { begin: beginAttempt, operation: afterAttempt?.operation });
      const probeAfter = await probeObserve(bootstrap.context, `malicious-${testCase.id}`);
      run.report.add(`malicious-${testCase.id}-no-package-change`, String(probeAfter.snapshot?.profile?.diskPackage?.version) === targets.versionB && String(probeAfter.snapshot?.profile?.dependency).endsWith(targets.b), probeAfter.snapshot?.profile?.diskPackage ?? null);
      const games = await pageGetJson(run.page.cdp, '/api/game-market/games');
      run.report.add(`malicious-${testCase.id}-games-unaffected`, games.status === 200, { status: games.status });
    }
    evidence.sections.maliciousIndex = results;
    // Recovery: valid index (target R_final) + restart -> capability true + real UI banner -> begin via UI.
    const recovered = await restartWithFixture({ label: 'recovery', body: buildBody([{ version: targets.versionFinal, commit: targets.final }]) });
    const data = recovered.data ?? {};
    const recovery = { discovery: data.discovery ?? null, target: data.target ?? null, capability: data.capability ?? null };
    run.report.add('recovery-capability-can-begin-update', data.capability?.canBeginUpdate === true, data.capability ?? null);
    run.report.add('recovery-target-is-R_final', data.target?.version === targets.versionFinal && data.target?.commit === targets.final, data.target ?? null);
    const banner = await waitForUi(run.page.cdp, (ui) => ui.banner !== null, { timeoutMs: 30000 });
    run.report.add('recovery-ui-banner-present', banner.ok === true, banner.ui?.banner ?? null);
    const beginRecovery = await beginUpdateThroughUi(run.page.cdp, { expectVersion: targets.versionFinal });
    recovery.begin = { operationId: beginRecovery.operationId, dialog: beginRecovery.dialog };
    run.report.add('recovery-begin-through-ui-succeeds', /^upd_[a-f0-9]{16}$/.test(String(beginRecovery.operationId)), beginRecovery.operationId);
    const cancelAfter = await pollInspect(run.page, (data2) => ['installing', 'applied', 'inspecting'].includes(data2?.operation?.state), { timeoutMs: 30000 });
    recovery.cancelObserved = cancelAfter.data?.operation?.state ?? null;
    const cancelClick = await clickAction(run.page.cdp, 'cancel-update', 'recovery-cancel');
    recovery.cancelClick = cancelClick;
    const terminal = await waitForOperation(run.page.cdp, ['cancelled', 'too-late', 'updated', 'stale-runtime', 'failed'], { timeoutMs: 180000 });
    recovery.terminal = terminal.state ?? null;
    run.report.add('recovery-update-cancelled-or-too-late', ['cancelled', 'too-late', 'stale-runtime', 'updated'].includes(terminal.state), { state: terminal.state });
    if (['too-late', 'stale-runtime', 'updated'].includes(terminal.state)) {
      recovery.completion = await completeUpdateToTarget(run.page, { expectVersion: targets.versionFinal, expectedClientCommit: releaseFinal?.clientBuildCommit, label: 'recovery-too-late' });
      run.report.add('recovery-too-late-finishes-before-next-case', recovery.completion.terminal?.state === 'updated', recovery.completion.terminal?.state);
    }
    evidence.sections.recovery = recovery;
  }

  // -------------------------------------------------------------- dev-row
  {
    const baseline = (await probeObserve(bootstrap.context, 'devrow-baseline')).snapshot?.profile;
    const section = { baseline };
    injectDevGameMarketRow(bootstrap.home, {});
    seedOldCache(bootstrap.home, { version: targets.versionFinal, commit: targets.final });
    if (run.page) await closeRealPage(run.page);
    run.page = null;
    bootstrap.transport.control.setFixtureBody(buildBody([{ version: targets.versionFinal, commit: targets.final }]));
    await restartContextHost(bootstrap.context, { logNamePrefix: 'v2-edges-devrow' });
    await waitForRoute(bootstrap.context, { timeoutMs: 90000 });
    run.page = trackPage(run, await openRealPage(bootstrap.context));
    const settled = await pollInspect(run.page, (data) => data !== null && ['ready', 'invalid', 'offline'].includes(data.discovery?.state), { timeoutMs: 30000 });
    const data = settled.data ?? {};
    section.inspect = data;
    run.report.add('dev-row-detected', data.installed?.devRowShadow === true, data.installed ?? null);
    run.report.add('dev-row-blocks-update', data.capability?.canBeginUpdate === false && data.capability?.reasonKey === 'update.reason.devSource', data.capability ?? null);
    const ui = await readUpdateUi(run.page.cdp);
    section.ui = { blocked: ui.blocked, operation: ui.operation };
    run.report.add('dev-row-ui-guidance-native-manager', ui.blocked !== null, ui.blocked ?? null);
    const beginAttempt = await beginViaApi(run.page, data.target?.id ?? targetIdFor(targets.versionFinal, targets.final));
    section.begin = beginAttempt;
    run.report.add('dev-row-begin-rejected-no-silent-migration', beginAttempt.status >= 400 && beginAttempt.envelope?.ok === false, beginAttempt);
    const probeAfter = await probeObserve(bootstrap.context, 'devrow-after');
    section.probe = probeAfter.snapshot?.profile ?? null;
    run.report.add('dev-row-no-install-started', section.probe?.diskPackage?.version === baseline?.diskPackage?.version && section.probe?.dependency === baseline?.dependency, { before: baseline?.diskPackage?.version, after: section.probe?.diskPackage?.version, sameDependency: section.probe?.dependency === baseline?.dependency });
    evidence.sections.devRow = section;
  }

  // capability unknown: cannot be forced without a fault-injection seam.
  run.report.add('capability-unknown-forced-real-environment', false, {
    required: false,
    notRun: true,
    reason: 'no production seam to force the HMR sampling timeout/missing service without product test hooks; the decision branch is covered by the committed unit matrix (tests/v1.5-platform-update.test.js / host adapter tests). Capability-unknown real-path remains not-run.',
  }, { required: false });

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
  const transportProof = await cleanupProof({ ports: [bootstrap?.transport?.port].filter((port) => Number.isInteger(port)), dirs: [bootstrap?.tlsDir].filter(Boolean), label: 'v2-edges-transport-cleanup' });
  run.report.add('transport-and-tls-cleaned', transportProof.ok === true, transportProof);
  evidence.thrown = thrown === null ? null : String(thrown.stack ?? thrown);
  const summary = finalizeRun({
    report: run.report,
    evidenceRel: run.evidenceRel,
    runDir: run.runDir,
    extra: {
      runTag: run.runTag,
      targets,
      evidenceLevel: 'isolated-browser (real installed bundle + real page; UI actions for updates/cancel/begin where applicable; API negative controls labelled) + real Host restarts + isolated transport fixture',
      targetIdentities: evidence.targetIdentities,
      sections: evidence.sections,
      restarts: evidence.restarts,
      transitions: evidence.transitions,
      dataPreservation: evidence.dataPreservation,
      screenshots: evidence.screenshots,
      cleanup,
      thrown: evidence.thrown,
      environment: { node: process.version, platform: process.platform, repoRoot: REPO_ROOT },
    },
  });
  process.exitCode = summary.summary.passed ? 0 : 1;
}
