#!/usr/bin/env node
/**
 * M3-V0 one-time exact-commit install helper.
 *
 * Installs `dsh-game-market` from
 *   https://github.com/heswy/dsh-game-market.git#<full-40-hex-commit>
 * into a FRESH isolated DSH profile through the real `pluginManager` service
 * (`installBundle`), driven by the independent M3 probe Host plugin — this is
 * the bootstrap step the M3 HMR A→B→C verification starts from, and the shape
 * a user's one-time migration from v1.2.0 also takes.
 *
 * What it proves, per run:
 *   - fresh profile starts without the bundle (no dependency, no /health route);
 *   - installBundle(URL + exact commit) returns a real Remote Result, pnpm exit
 *     0 (`applied` on an HMR profile), package version matches `--version`;
 *   - after HMR apply the disk package version, the pnpm-normalised profile
 *     dependency spec (`github:heswy/dsh-game-market#<commit>`), the bundle row
 *     and `/api/game-market/health` all agree on the installed version;
 *   - user data under $DSH_HOME/storages/dsh-game-market is preserved
 *     byte-for-byte across the package change (marker + save fixture);
 *   - cleanup: Host exited, port refused, PID dead, isolated home removed.
 *
 * This helper is M3-code-agnostic: it takes the commit/version as arguments.
 * Until Lead pushes the verification probe releases A/B/C, the provable target
 * is the real published v1.2.0 release commit f422e8d0… (evidence then states
 * that fact honestly; A/B/C installs are `not-run`).
 *
 * Usage:
 *   node scripts/verification/v1.5/m3/install-exact-commit.mjs \
 *     --commit f422e8d04b3b3de3f920a794317c0d28ee1246a2 --version 1.2.0
 *   [--home-name m3-install-a] [--keep-home] [--install-timeout-ms 300000]
 *
 * Exit 0 iff every required check passed (including storage preservation and
 * cleanup proof). Evidence: docs/verification/v1.5/raw/m3/M3-V0-exact-install-*.json
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  PROBE_NETWORK_ENV,
  RAW_ROOT,
  REPO_ROOT,
  RUNS_ROOT,
  bootProbeHost,
  cleanupProof,
  createReport,
  ensureDir,
  finalizeRun,
  freePort,
  log,
  makeIsolatedHome,
  removeHome,
  runWithCleanup,
  sleep,
  uniqueRunTag,
  verifyRuntime,
} from './lib.mjs';

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function parseArgs(argv) {
  const args = { keepHome: false, installTimeoutMs: 300000, homeName: null, commit: null, version: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--keep-home') args.keepHome = true;
    else if (arg === '--commit') args.commit = argv[++i];
    else if (arg === '--version') args.version = argv[++i];
    else if (arg === '--home-name') args.homeName = argv[++i];
    else if (arg === '--install-timeout-ms') args.installTimeoutMs = Number(argv[++i]);
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!/^[0-9a-f]{40}$/.test(String(args.commit))) throw new Error('--commit must be a full lowercase 40-hex commit');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(args.version))) throw new Error('--version must be an exact semver');
  return args;
}

const args = parseArgs(process.argv.slice(2));
const runTag = uniqueRunTag('v0-install');
const runDir = path.join(RUNS_ROOT, runTag);
const evidenceRel = `M3-V0-exact-install-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const REPORT_ID = 'M3-V0-exact-install';
const SPEC = `https://github.com/heswy/dsh-game-market.git#${args.commit}`;
const RECORDED_SPEC_PREFIX = 'github:heswy/dsh-game-market#';

const report = createReport({
  id: REPORT_ID,
  title: 'One-time exact-commit install (pluginManager.installBundle) into a fresh isolated profile',
  commands: [`node scripts/verification/v1.5/m3/install-exact-commit.mjs --commit ${args.commit} --version ${args.version}`],
});

const state = { home: null, host: null, hostPort: null, identity: null, storage: null, keepHome: Boolean(args.keepHome) };

function seedStorage(home, bootTag) {
  const root = path.join(home, 'storages', 'dsh-game-market');
  ensureDir(path.join(root, 'saves', 'snake'));
  const marker = { marker: 'v1.5-m3-install-storage-marker', bootTag, writtenAt: new Date().toISOString() };
  const save = {
    schemaVersion: 1,
    gameId: 'snake',
    playSessionId: `m3-${bootTag}`,
    score: 42,
    state: { snake: [[3, 3]], direction: 'right' },
    updatedAt: new Date().toISOString(),
    marker: 'v1.5-m3-install-save-fixture',
  };
  const markerPath = path.join(root, `${bootTag}-marker.json`);
  const savePath = path.join(root, 'saves', 'snake', 'current.json');
  fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  fs.writeFileSync(savePath, `${JSON.stringify(save, null, 2)}\n`, 'utf8');
  return { root, markerPath, savePath, markerSha256: sha256(fs.readFileSync(markerPath)), saveSha256: sha256(fs.readFileSync(savePath)) };
}

function storageSnapshot(fixture) {
  const read = (file) => (fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null);
  return {
    root: fixture.root,
    markerSha256: read(fixture.markerPath),
    saveSha256: read(fixture.savePath),
    markerPresent: fs.existsSync(fixture.markerPath),
    savePresent: fs.existsSync(fixture.savePath),
  };
}

async function cleanup() {
  if (state.host) {
    try {
      await state.host.stop();
    } catch (error) {
      report.add('host-stop-without-throw', false, error && error.message ? error.message : String(error));
    }
    state.host = null;
  }
  if (state.home && !state.keepHome) {
    try {
      removeHome(state.home);
    } catch (error) {
      report.add('isolated-home-removal-without-throw', false, error && error.message ? error.message : String(error));
    }
  }
  const proof = await cleanupProof({
    ports: [state.hostPort].filter((port) => Number.isInteger(port)),
    pids: [state.host ? state.host.pid : null].filter((pid) => Number.isInteger(pid)),
    dirs: state.keepHome ? [] : [state.home].filter(Boolean),
    label: 'v0-exact-install-cleanup',
  });
  report.add('cleanup-ports-refused-pids-dead-dirs-gone', proof.ok, proof);
  return proof;
}

async function waitFor(fn, { timeoutMs = 90000, intervalMs = 1500, label = 'condition' } = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await fn();
      if (last && last.ok) return { ok: true, waitedMs: Date.now() - started, last };
    } catch (error) {
      last = { ok: false, error: String(error && error.message ? error.message : error) };
    }
    await sleep(intervalMs);
  }
  return { ok: false, waitedMs: Date.now() - started, last };
}

async function body() {
  // 0. Runtime identity -----------------------------------------------------
  const identity = verifyRuntime();
  state.identity = identity;
  report.add('runtime-extraction-matches-installed-app', identity.extractionVerifiedAgainstInstalledApp, identity.mismatched);
  report.add('runtime-expected-version', identity.versionsMatchExpected.dsh && identity.versionsMatchExpected.pluginManager, identity.versions);
  report.record('install-target', { spec: SPEC, commit: args.commit, expectedVersion: args.version }, { required: true });

  // 1. Fresh isolated profile ---------------------------------------------
  ensureDir(runDir);
  ensureDir(RAW_ROOT);
  const homeName = args.homeName ?? `${runTag}`;
  const home = await makeIsolatedHome(homeName, { port: await freePort() });
  state.home = home;
  report.add('fresh-isolated-home-under-m3-scratch', home.startsWith('/tmp/dsh-v15/m3/'), home);

  // 2. Probe operator Host (no game-market row yet) ------------------------
  const hostPort = await freePort();
  state.hostPort = hostPort;
  const bootTag = runTag;
  const { host, probe, boot } = await bootProbeHost({
    name: homeName,
    home,
    runDir,
    bootTag,
    port: hostPort,
    env: { ...PROBE_NETWORK_ENV },
    pluginMode: 'none',
    logName: `${homeName}-host`,
  });
  state.host = host;
  report.add('isolated-host-boots-before-install', boot.bootTag === bootTag, { pid: boot.pid, node: boot.nodeVersion });
  report.add('probe-operator-drives-real-pluginManager', (boot.managerInternal?.methods ?? []).includes('installBundle') && boot.managerInternal.methods.includes('listBundles'), boot.managerInternal?.methods);
  report.add('hmr-capability-present-on-default-profile', boot.capability?.managerContextHmr === true, boot.capability);

  const before = await probe.send({ id: 'install-before-observe', action: 'observe', label: 'before-install' });
  const beforeSnapshot = before.snapshot;
  report.add('fresh-profile-has-no-game-market-dependency', beforeSnapshot.profile?.dependency === null, { dependency: beforeSnapshot.profile?.dependency });
  report.add('fresh-profile-has-no-disk-package', beforeSnapshot.profile?.diskPackage === null, { diskPackage: beforeSnapshot.profile?.diskPackage });
  report.add('fresh-profile-has-no-health-route', beforeSnapshot.health?.routeRegistered === false || beforeSnapshot.health?.status === 404, { routeRegistered: beforeSnapshot.health?.routeRegistered, status: beforeSnapshot.health?.status });

  // 3. User-data fixture before the package change -------------------------
  const storageFixture = seedStorage(home, bootTag);
  state.storage = storageFixture;
  report.record('storage-fixture-seeded', { markerSha256: storageFixture.markerSha256, saveSha256: storageFixture.saveSha256 }, { required: true });

  // 4. Real installBundle(URL + exact commit) ------------------------------
  const requestId = `m3-install-${runTag}`;
  log(`installing ${SPEC} into ${home} (pnpm may take a while)`);
  const install = await probe.send(
    { id: 'install-exact-commit', action: 'install', spec: SPEC, requestId, enabled: true },
    { timeoutMs: args.installTimeoutMs },
  );
  report.record('install-remote-result', install.result ?? null, { required: true });
  const application = install.result?.application ?? null;
  report.add('install-result-application-applied-or-restart-required', application === 'applied' || application === 'restart-required', { application, changed: install.result?.changed, stage: install.result?.stage, target: install.result?.target });
  report.add('install-result-version-matches', install.result?.version === args.version, { version: install.result?.version ?? null, expected: args.version });
  report.add('install-pnpm-exit-code-zero', install.result?.packageResult?.exitCode === 0, install.result?.packageResult);
  report.add('install-changed-true', install.result?.changed === true, { changed: install.result?.changed ?? null });
  report.add('install-threw-nothing', install.thrown === undefined, install.thrown ?? null);

  // 5. Verify the applied state on disk + profile + running Host ------------
  const applied = await waitFor(async () => {
    const observation = await probe.send({ id: `install-applied-${Date.now()}`, action: 'observe', label: 'after-install' });
    const snap = observation.snapshot;
    const dependency = snap.profile?.dependency ?? null;
    return {
      ok: dependency !== null && snap.profile?.diskPackage?.version === args.version && snap.health?.status === 200,
      snapshot: snap,
    };
  }, { timeoutMs: 120000, intervalMs: 2000, label: 'installed-state' });
  report.add('installed-state-observed-within-120s', applied.ok, applied.ok ? { waitedMs: applied.waitedMs } : applied.last);
  const afterSnapshot = applied.last?.snapshot ?? null;
  report.record('post-install-observation', afterSnapshot === null ? null : {
    dependency: afterSnapshot.profile?.dependency,
    diskPackage: afterSnapshot.profile?.diskPackage,
    health: afterSnapshot.health,
    bundles: afterSnapshot.bundles,
    loaderRows: afterSnapshot.loader?.rows,
    capability: afterSnapshot.capability,
  }, { required: true });
  report.add('profile-dependency-is-normalised-github-spec', typeof afterSnapshot?.profile?.dependency === 'string' && afterSnapshot.profile.dependency.startsWith(RECORDED_SPEC_PREFIX) && afterSnapshot.profile.dependency.endsWith(args.commit), afterSnapshot?.profile?.dependency ?? null);
  report.add('disk-package-version-matches-target', afterSnapshot?.profile?.diskPackage?.version === args.version, afterSnapshot?.profile?.diskPackage ?? null);
  const healthBody = afterSnapshot?.health?.body ?? null;
  report.add('health-route-200-with-envelope', afterSnapshot?.health?.status === 200 && afterSnapshot?.health?.envelope?.ok === true, { status: afterSnapshot?.health?.status, envelope: afterSnapshot?.health?.envelope });
  report.add('health-version-matches-target', healthBody?.version === args.version, { version: healthBody?.version ?? null, expected: args.version });
  report.add('listed-bundle-version-matches-target', (afterSnapshot?.bundles ?? []).some((bundle) => bundle.name === 'dsh-game-market' && bundle.version === args.version), afterSnapshot?.bundles ?? null);
  report.add('bundle-loader-row-running-after-apply', (afterSnapshot?.loader?.rows ?? []).some((row) => String(row.name ?? '').includes('dsh-game-market') && row.hasFiber === true), afterSnapshot?.loader?.rows ?? null);

  // 6. User data preserved byte-for-byte -----------------------------------
  const afterStorage = storageSnapshot(storageFixture);
  report.record('storage-after-package-change', afterStorage, { required: true });
  report.add('storage-marker-bytes-preserved', afterStorage.markerSha256 === storageFixture.markerSha256, { before: storageFixture.markerSha256, after: afterStorage.markerSha256 });
  report.add('storage-save-bytes-preserved', afterStorage.saveSha256 === storageFixture.saveSha256, { before: storageFixture.saveSha256, after: afterStorage.saveSha256 });

  // 7. Operator independence + liveness across the install -----------------
  const ping = await probe.send({ id: 'install-ping-after', action: 'ping' });
  report.add('probe-operator-alive-after-install', ping.ok === true && ping.pid === boot.pid, { pid: ping.pid });
  const obsFinal = await probe.send({ id: 'install-final-observe', action: 'observe', label: 'final' });
  report.add('probe-operator-fiber-survived-install', obsFinal.snapshot.selfFiberUid === beforeSnapshot.selfFiberUid, { before: beforeSnapshot.selfFiberUid, after: obsFinal.snapshot.selfFiberUid });

  return {
    identity,
    target: { spec: SPEC, commit: args.commit, version: args.version },
    installResult: install.result ?? null,
    before: { dependency: beforeSnapshot.profile?.dependency, diskPackage: beforeSnapshot.profile?.diskPackage, healthRegistered: beforeSnapshot.health?.routeRegistered ?? null },
    after: { dependency: afterSnapshot?.profile?.dependency ?? null, diskPackage: afterSnapshot?.profile?.diskPackage ?? null, healthBody, bundles: afterSnapshot?.bundles ?? null },
    storage: { before: { markerSha256: storageFixture.markerSha256, saveSha256: storageFixture.saveSha256 }, after: afterStorage },
    probe: { pid: boot.pid, fiberUidBefore: beforeSnapshot.selfFiberUid, fiberUidAfter: obsFinal.snapshot.selfFiberUid },
  };
}

const results = await runWithCleanup({ report, runDir, cleanup, body });
const evidence = finalizeRun({
  report,
  evidenceRel,
  runDir,
  extra: {
    runTag,
    evidenceLevel: 'isolated-host + real pnpm network install (exact git commit through real pluginManager)',
    helperPurpose: 'one-time bootstrap install for M3 A/B/C verification and user migration; M3-code-agnostic, commit/version are arguments',
    probeReleasesStatus: 'not-run: verification-only A/B/C probe commits are not pushed yet (Lead git operation); this run proves the helper against the published v1.2.0 commit',
    environment: { node: process.version, platform: process.platform, repoRoot: REPO_ROOT },
    keptHome: state.keepHome ? state.home : null,
    cleanupProof: results.cleanupResult,
    thrown: results.thrown ? String(results.thrown.stack ?? results.thrown) : null,
  },
});
process.exitCode = evidence.summary.passed ? 0 : 1;
