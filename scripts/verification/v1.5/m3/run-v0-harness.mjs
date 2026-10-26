#!/usr/bin/env node
/**
 * M3-V0 harness self-proof: the isolated DSH verification rig M3 needs.
 *
 * Proves, on the real installed DSH (`/Applications/DeepSeek Harness.app`,
 * read-only extraction re-verified byte-for-byte) and the REAL DSH page:
 *   1. runtime identity (0.2.1-rc.2) and extraction integrity;
 *   2. a fresh isolated DSH_HOME under /tmp/dsh-v15/m3 (never ~/.dsh) boots
 *      `dsh web` with the pnpm proxy env and a marker env var;
 *   3. the probe Host plugin (its own `file://` row, NOT dsh-game-market) can
 *      call the real `pluginManager` (listBundles/installBundle/... present)
 *      and read the profile/disk package identity;
 *   4. this worktree's Host plugin boots as a dev row and answers
 *      `/api/game-market/health` (through the connection route and from the
 *      real page via same-origin fetch);
 *   5. a real headless-Chrome page (CDP) loads the real DSH UI from the
 *      isolated host, keeps the probe fiber alive (same uid), and can talk to
 *      the Host API;
 *   6. cleanup self-proof: Host child exited, no listener on either port, no
 *      recorded PID alive, isolated home + chrome profile removed.
 *
 * Exit 0 iff every required check passed AND cleanup is proven leak-free.
 * Evidence: docs/verification/v1.5/raw/m3/M3-V0-harness-<ts>.json (+ screenshot).
 *
 * Usage: node scripts/verification/v1.5/m3/run-v0-harness.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  Cdp,
  PROBE_NETWORK_ENV,
  PROBE_ROW_ID,
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
  hostEnvEvidence,
  log,
  makeIsolatedHome,
  removeHome,
  runWithCleanup,
  uniqueRunTag,
  verifyRuntime,
  waitForDshPage,
  pageFetchJson,
  listenerPids,
} from './lib.mjs';

const RUN_PREFIX = 'v0-harness';
const runTag = uniqueRunTag(RUN_PREFIX);
const runDir = path.join(RUNS_ROOT, runTag);
const evidenceRel = `M3-V0-harness-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const REPORT_ID = 'M3-V0-harness';

const report = createReport({
  id: REPORT_ID,
  title: 'Isolated-DSH M3 verification harness self-proof (runtime + probe operator + real page + cleanup)',
  commands: ['node scripts/verification/v1.5/m3/run-v0-harness.mjs'],
});

const state = { home: null, host: null, cdp: null, chromePort: null, hostPort: null, boot: null, identity: null, chromeDir: null };

async function cleanup() {
  if (state.cdp) {
    try {
      state.cdp.dispose();
    } catch (error) {
      log(`cdp dispose failed: ${error && error.message}`);
    }
    state.cdp = null;
    // Wait for the Chrome child to actually die, then remove its scratch profile
    // so the cleanup proof can assert the directory is gone.
    const deadline = Date.now() + 10000;
    while (state.chromePid && Date.now() < deadline && (() => { try { process.kill(state.chromePid, 0); return true; } catch { return false; } })()) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (state.chromeDir) fs.rmSync(state.chromeDir, { recursive: true, force: true });
  }
  if (state.host) {
    try {
      await state.host.stop();
    } catch (error) {
      report.add('host-stop-without-throw', false, error && error.message ? error.message : String(error));
    }
    state.host = null;
  }
  if (state.home) {
    try {
      removeHome(state.home);
    } catch (error) {
      report.add('isolated-home-removal-without-throw', false, error && error.message ? error.message : String(error));
    }
  }
  const proof = await cleanupProof({
    ports: [state.hostPort, state.chromePort].filter((port) => Number.isInteger(port)),
    pids: [state.host && state.host.pid, state.chromePid].filter((pid) => Number.isInteger(pid)),
    dirs: [state.home, state.chromeDir].filter(Boolean),
    label: 'v0-harness-cleanup',
  });
  report.add('cleanup-ports-refused-pids-dead-dirs-gone', proof.ok, proof);
  return proof;
}

async function body() {
  // 1. Runtime identity ------------------------------------------------------
  const identity = verifyRuntime();
  state.identity = identity;
  report.add('runtime-installed-app-asar-present', fs.existsSync(identity.installedApp.asarPath), identity.installedApp);
  report.add('runtime-expected-version', identity.versionsMatchExpected.dsh && identity.versionsMatchExpected.pluginManager, identity.versions);
  report.add('runtime-dsh-bin-under-m3-root', identity.dshBin.startsWith(`${identity.extractedRoot}${path.sep}`), identity.dshBin);
  report.add('runtime-extraction-matches-installed-app', identity.extractionVerifiedAgainstInstalledApp, identity.identityFiles.map((file) => ({ rel: file.rel, matchesApp: file.matchesApp })));
  log(`runtime verified: dsh ${identity.versions.dsh.version}, plugin-manager ${identity.versions.pluginManager.version}, app.asar ${identity.installedApp.asarSha256.slice(0, 12)}…`);

  // 2-3. Isolated home + probe operator + Host plugin dev row ----------------
  ensureDir(runDir);
  ensureDir(RAW_ROOT);
  const bootstrapPort = await freePort();
  const homeName = `${RUN_PREFIX}-${runTag}`;
  const home = await makeIsolatedHome(homeName, { port: bootstrapPort });
  state.home = home;
  report.add('isolated-home-under-m3-scratch', home.startsWith('/tmp/dsh-v15/m3/'), home);
  report.add('isolated-home-is-not-daily-profile', !home.includes('/.dsh'), home);

  const hostPort = await freePort();
  state.hostPort = hostPort;
  const hostEnv = { ...PROBE_NETWORK_ENV, M3_FIXTURE_RUN_TAG: runTag };
  const bootTag = runTag;
  const { host, probe, boot } = await bootProbeHost({
    name: homeName,
    home,
    runDir,
    bootTag,
    port: hostPort,
    env: hostEnv,
    pluginMode: 'dev-row',
    logName: `${homeName}-host`,
  });
  state.host = host;
  state.boot = boot;

  report.add('host-boot-wrote-probe-boot-record', boot.bootTag === bootTag, { bootTag: boot.bootTag, pid: boot.pid });
  report.add('probe-operator-uses-independent-fiber', Number.isInteger(boot.managerInternal?.ownerEntryId ? 1 : 0) && boot.managerInternal.ownerEntryId !== null, boot.managerInternal);
  report.add('probe-operator-real-pluginManager-methods', boot.managerInternal?.methods?.includes('installBundle') && boot.managerInternal.methods.includes('waitForInstall') && boot.managerInternal.methods.includes('cancelInstall') && boot.managerInternal.methods.includes('listBundles'), boot.managerInternal?.methods);
  report.add('probe-operator-hmr-capability-present', boot.capability?.managerContextHmr === true, boot.capability);
  report.add('host-env-marker-received', boot.env?.fixtureRunTag === runTag, boot.env);
  report.add('host-env-proxy-injection-recorded', hostEnvEvidence(hostEnv).keys.includes('HTTPS_PROXY'), hostEnvEvidence(hostEnv));
  report.record('host-url-token-free-origin', host.origin, { required: true });

  const ping = await probe.send({ id: 'v0-ping', action: 'ping' });
  report.add('probe-ping-ok', ping.ok === true && ping.pid === boot.pid, { pid: ping.pid, bootPid: boot.pid });

  const obs1 = await probe.send({ id: 'v0-observe-1', action: 'observe', label: 'boot' });
  const snapshot = obs1.snapshot;
  report.add('probe-observation-profile-dir-in-home', typeof snapshot.profile?.dir === 'string' && snapshot.profile.dir.startsWith(home), snapshot.profile?.dir);
  // In dev-row mode the worktree plugin is a loader row, not a profile bundle:
  // listBundles() intentionally reports only profile dependencies, so the dev
  // row is asserted through the loader rows + /health instead.
  const devRow = (snapshot.loader?.rows ?? []).find((row) => row.id === 'dsh-game-market') ?? null;
  report.add('probe-observation-sees-game-market-dev-row-running', devRow !== null && devRow.hasFiber === true && devRow.fiberState === 2, devRow);
  report.add('probe-observation-health-route-registered', snapshot.health?.available === true && snapshot.health.routeRegistered === true, { available: snapshot.health?.available, routeRegistered: snapshot.health?.routeRegistered });
  report.add('probe-observation-health-200', snapshot.health?.status === 200, snapshot.health?.status);
  report.add('probe-observation-health-envelope-ok', snapshot.health?.envelope?.ok === true, snapshot.health?.envelope);
  const observedHealth = snapshot.health?.body ?? null;
  report.add('probe-observation-health-version-string', typeof observedHealth?.version === 'string' && observedHealth.version.length > 0, { version: observedHealth?.version, hostEpochPresent: typeof observedHealth?.hostEpoch === 'string' });
  report.add('probe-observation-hmr-loader-row-has-fiber', (snapshot.loader?.rows ?? []).some((row) => row.id === 'hmr' && row.hasFiber === true), snapshot.loader?.rows);
  report.add('host-profile-dependency-null-in-dev-row-mode', snapshot.profile?.dependency === null, { dependency: snapshot.profile?.dependency, note: 'dev row is injected via cordis.patch.yml, not profile dependencies' });

  const routeHealth = await probe.send({ id: 'v0-host-route-health', action: 'host-route', path: '/api/game-market/health' });
  report.add('in-process-route-health-200', routeHealth.status === 200 && routeHealth.envelope?.ok === true, { status: routeHealth.status, envelope: routeHealth.envelope });

  // 4-5. Real DSH page over CDP --------------------------------------------
  const chromePort = await freePort();
  state.chromePort = chromePort;
  state.chromeDir = path.join('/tmp/dsh-v15/m3', `chrome-${chromePort}`);
  const cdp = await Cdp.launch({ port: chromePort });
  state.cdp = cdp;
  state.chromePid = cdp.chrome ? cdp.chrome.pid : null;
  await cdp.navigate(host.url);
  const page = await waitForDshPage(cdp, host.origin, { timeoutMs: 45000 });
  const pageInfo = await cdp.eval(`(() => ({
    ready: document.readyState,
    origin: location.origin,
    href: location.href,
    title: document.title,
    bodyHtmlLength: document.body ? document.body.innerHTML.length : 0,
    textLength: document.body ? (document.body.innerText || '').length : 0
  }))()`);
  report.add('real-dsh-page-loaded-complete', pageInfo?.ready === 'complete' && pageInfo.bodyHtmlLength > 0, pageInfo && { ready: pageInfo.ready, origin: pageInfo.origin, title: pageInfo.title, bodyHtmlLength: pageInfo.bodyHtmlLength });
  report.add('real-dsh-page-origin-is-isolated-host', pageInfo?.origin === host.origin, { origin: pageInfo?.origin, expected: host.origin });
  report.add('real-dsh-page-has-nonempty-title', typeof pageInfo?.title === 'string' && pageInfo.title.trim().length > 0, pageInfo?.title);
  report.add('real-dsh-page-health-200', page.health?.status === 200, page.health && { status: page.health.status, bodyVersion: page.health.body?.data?.version ?? page.health.body?.version ?? null });

  const pageHealth = await pageFetchJson(cdp, '/api/game-market/health');
  let pageHealthBody = null;
  try {
    pageHealthBody = JSON.parse(pageHealth.body);
  } catch { /* not json */ }
  report.add('page-fetch-health-200-json-envelope', pageHealth.status === 200 && pageHealthBody?.ok === true, { status: pageHealth.status, envelopeOk: pageHealthBody?.ok ?? null });

  const pageInstalled = await pageFetchJson(cdp, '/api/game-market/installed');
  let pageInstalledBody = null;
  try {
    pageInstalledBody = JSON.parse(pageInstalled.body);
  } catch { /* not json */ }
  report.add('page-fetch-installed-200', pageInstalled.status === 200 && pageInstalledBody?.ok === true, { status: pageInstalled.status, envelopeOk: pageInstalledBody?.ok ?? null });

  const shotFile = cdp && await cdp.shot(path.join(SHOT_DIR, `M3-V0-harness-${runTag}.png`));
  report.record('real-dsh-page-screenshot', shotFile ? path.relative(REPO_ROOT, shotFile) : null, { required: false });

  // Probe operator must still be the same live fiber after the page ran.
  const ping2 = await probe.send({ id: 'v0-ping-after-page', action: 'ping' });
  report.add('probe-operator-alive-after-page', ping2.ok === true && ping2.pid === boot.pid, { pid: ping2.pid });
  const obs2 = await probe.send({ id: 'v0-observe-2', action: 'observe', label: 'after-page' });
  report.add('probe-operator-same-fiber-after-page', obs2.snapshot.selfFiberUid === snapshot.selfFiberUid, { before: snapshot.selfFiberUid, after: obs2.snapshot.selfFiberUid });

  return { boot, snapshot, pageInfo, pageHealthBody, obs2 };
}

const results = await runWithCleanup({ report, runDir, cleanup, body });
const evidence = finalizeRun({
  report,
  evidenceRel,
  runDir,
  extra: {
    runTag,
    evidenceLevel: 'isolated-browser + isolated-host (real installed DSH runtime, real DSH page)',
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      chrome: fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? 'chrome-headless-cdp' : null,
      repoRoot: REPO_ROOT,
      workRoot: '/tmp/dsh-v15/m3',
    },
    runtime: state.identity,
    probeRowId: PROBE_ROW_ID,
    checksRequired: report.checks.filter((check) => check.required).length,
    thrown: results.thrown ? String(results.thrown.stack ?? results.thrown) : null,
    cleanupProof: results.cleanupResult,
    listenerPidsAfterCleanup: [state.hostPort, state.chromePort].filter((port) => Number.isInteger(port)).map((port) => ({ port, listenerPids: listenerPids(port) })),
  },
});
