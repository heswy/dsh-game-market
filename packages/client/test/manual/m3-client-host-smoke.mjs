/**
 * M3 client↔host integration scenario (hermetic, no network, no worktree writes).
 *
 * This file lives under `packages/client/test/`, so `node --test` discovers it
 * together with the unit tests. It is therefore a real `node:test` test that
 * must pass in ANY checkout state:
 *
 *  - the simulated update target is derived from the checkout's package.json
 *    (`<major>.<minor+1>.0`, always strictly greater than the running version),
 *    so the scenario always exercises "update available" instead of flipping to
 *    "up to date" when the tree already sits on the pinned target version;
 *  - everything runs against the real Host composition harness
 *    (`packages/host/test/support/harness.js`): real router + real discovery
 *    cache + fake native plugin manager, all in /tmp directories.
 *
 * Standalone run (from the repo root):
 *   node packages/client/test/manual/m3-client-host-smoke.mjs
 * With the client suite:
 *   node --test packages/client/test
 *
 * Covers: inspect/normalization, client-report validation, refresh envelope,
 * launch instance registration, coordinate (unknown instance rejection,
 * satisfied ack, save-failure abort), begin/observe pending-restart without a
 * success claim, terminal retention, forged target GM-4090, repeat begin
 * idempotency.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', '..');
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { createHostHarness } = await imp('packages/host/test/support/harness.js');
const { createFakePluginManager, makeBundleState } = await imp('packages/host/test/support/platform-update-harness.js');
const { makeCacheDocument, writeDiscoveryCache, COMMIT_A } = await imp('packages/host/test/support/platform-update.js');
const { createFileRegistry } = await imp('packages/host/test/support/packages.js');
const { ROUTES } = await imp('packages/shared/src/contracts.js');
const { updateTargetIdFor, updateGitSpecForCommit } = await imp('packages/shared/src/platform-update.js');
const { createUpdateApi } = await imp('packages/client/src/api-update.js');
const { normalizeInspection, deriveUpdateView, describeObservation } = await imp('packages/client/src/update-state.js');

const packageDocument = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const CURRENT_VERSION = packageDocument.version;

/** Parse the numeric core of a semver string (prerelease/build ignored). */
function versionCore(value) {
  const core = String(value).split('-')[0].split('+')[0];
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(core);
  if (match === null) throw new Error('package.json version is not a numeric semver: ' + value);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Strictly greater numeric semver comparison (ignores prerelease/build). */
function isGreaterVersion(left, right) {
  const a = versionCore(left);
  const b = versionCore(right);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/**
 * Next minor version: always strictly greater than the checkout version, in
 * any state (release commit, staging source, dev build).
 */
function nextMinorVersion(value) {
  const [major, minor] = versionCore(value);
  return major + '.' + String(minor + 1) + '.0';
}

const TARGET_VERSION = nextMinorVersion(CURRENT_VERSION);
assert.equal(isGreaterVersion(TARGET_VERSION, CURRENT_VERSION), true, 'derived target must be newer than the running version');

const TARGET = {
  id: updateTargetIdFor(TARGET_VERSION, COMMIT_A),
  version: TARGET_VERSION,
  commit: COMMIT_A,
  channel: 'stable',
  publishedAt: '2023-11-14T22:13:20.000Z',
  spec: updateGitSpecForCommit(COMMIT_A),
};

/** Build a fetch implementation that routes Client URLs into the real Host. */
function hostFetch(host, calls) {
  return async function fetchImpl(url, init) {
    const parsed = new URL(url, 'http://127.0.0.1:19387/');
    calls.push({ path: parsed.pathname + parsed.search, method: init.method });
    return host.request(parsed.pathname + parsed.search, {
      method: init.method,
      rawBody: init.body,
      headers: init.headers,
    });
  };
}

/** Poll one observation until a terminal-ish state for the flow under test. */
async function pollObservation(api, operationId, isDone, label) {
  for (let i = 0; i < 600; i += 1) {
    const observation = await api.observe(operationId);
    if (isDone(observation)) return observation;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for ' + label);
}

function ok(label) {
  console.log('PASS ' + label);
}

test('M3 client update scenario against the real Host harness (self-adapting target)', async (t) => {
  // ---- Harness 1: update-available → coordination satisfied → pending-restart.
  const fake = createFakePluginManager({
    bundles: [makeBundleState({ version: '1.2.0' })],
    install: async (spec, options) => ({
      stage: 'enable',
      target: 'dsh-game-market',
      enabled: true,
      changed: true,
      application: 'restart-required',
      restartReason: 'no-hmr',
      bundle: 'dsh-game-market',
      version: TARGET_VERSION,
      spec,
      options,
    }),
  });
  const fixture = await createFileRegistry(t, [{ manifest: { id: 'jump', name: 'Jump', version: '1.0.0' } }]);
  const host = await createHostHarness(t, {
    config: {
      registry: { url: fixture.indexPath, allowLocalFile: true },
      platformUpdate: { startupCheck: false },
    },
    http: { platformUpdateTiming: { indexConnectMs: 200, indexTotalMs: 200, indexIdleMs: 200 } },
    pluginManagerResolver: () => fake.manager,
    hmrResolver: () => ({ runExclusive: async (task) => task() }),
    prepareDataRoot: async (dataRoot) => {
      await writeDiscoveryCache(dataRoot, makeCacheDocument({ target: TARGET }));
    },
  });
  await host.host.registry.ready();

  const calls = [];
  const api = createUpdateApi({ fetchImpl: hostFetch(host, calls) });

  // 1) inspect → real Host payload normalizes and maps to update-available.
  const raw = await api.inspect();
  assert.equal(raw.schemaVersion, 1);
  assert.ok(raw.host && typeof raw.host === 'object');
  assert.ok(raw.installed && typeof raw.installed === 'object');
  assert.equal(raw.target.id, TARGET.id);
  assert.equal(raw.target.commit, COMMIT_A);
  assert.equal(raw.target.version, TARGET_VERSION);
  assert.equal(raw.discovery.state, 'ready');
  assert.equal(raw.capability.canBeginUpdate, true);
  const inspection = normalizeInspection(raw);
  const view = deriveUpdateView({
    status: 'ready',
    inspection,
    clientIdentity: { version: CURRENT_VERSION, buildCommit: null },
  });
  assert.equal(view.hidden, false);
  assert.equal(view.update.kind, 'available', 'target ' + TARGET_VERSION + ' must be newer than running ' + CURRENT_VERSION);
  assert.equal(view.blocked, null);
  assert.equal(view.update.toVersion, TARGET_VERSION);
  ok('inspect via real Host route + client normalization (update-available, identity)');

  // 2) client-report with this build's identity (host validates exact semver).
  const report = await api.clientReport({
    clientId: 'c'.repeat(32),
    windowId: 'w'.repeat(32),
    buildVersion: CURRENT_VERSION,
    buildCommit: null,
    pageToken: 'p'.repeat(32),
    startedAt: new Date().toISOString(),
  });
  assert.equal(report.accepted, true);
  assert.equal(typeof report.state, 'string');
  ok('client-report accepted by real Host validation');

  // 3) manual refresh keeps a 200 envelope (network-free harness: no throw).
  const refreshed = await api.refresh();
  assert.equal(typeof refreshed.refreshed, 'boolean');
  assert.equal(typeof refreshed.throttled, 'boolean');
  assert.equal(refreshed.target.id, TARGET.id);
  ok('refresh route envelope + throttle flags');

  // 4) register one active runtime instance through the real launch route.
  await host.data(ROUTES.INSTALL, { body: { gameId: 'jump', operationId: 'smoke-install-jump' } });
  const launchInfo = await host.data(ROUTES.LAUNCH, { body: { gameId: 'jump', mode: 'start' } });
  assert.match(launchInfo.instanceId, /^[a-f0-9]{32}$/);
  ok('launch registers an active runtime instance (' + launchInfo.instanceId + ')');

  // 5) begin → coordination phase; the client-shaped ack satisfies it.
  const beginCoord = await api.begin(TARGET.id);
  assert.match(beginCoord.operationId, /^upd_[a-f0-9]{16}$/);
  const coordinating = await pollObservation(
    api,
    beginCoord.operationId,
    (observation) => observation.state === 'inspecting' || observation.state === 'installing' || observation.state === 'applied',
    'coordination'
  );
  assert.equal(coordinating.state, 'inspecting');
  assert.equal(coordinating.coordination.pending, 1);

  let unknownAck = null;
  try {
    await api.coordinate({
      windowId: 'w'.repeat(32),
      instances: [
        {
          instanceId: '9'.repeat(32),
          gameId: 'jump',
          paused: true,
          saved: true,
          saveStale: false,
          playSessionId: null,
          saveRevision: null,
        },
      ],
      idle: false,
    });
  } catch (error) {
    unknownAck = error;
  }
  assert.ok(unknownAck, 'unknown coordinate instance rejected by the real Host');
  assert.equal(unknownAck.code, 'GM-4002');
  ok('real Host rejects an unknown coordinate instance (GM-4002)');

  const ack = await api.coordinate({
    windowId: 'w'.repeat(32),
    instances: [
      {
        instanceId: launchInfo.instanceId,
        gameId: 'jump',
        playSessionId: null,
        paused: true,
        saved: true,
        saveStale: false,
        saveRevision: null,
      },
    ],
    idle: false,
  });
  assert.equal(ack.accepted, true);
  assert.equal(ack.phase === 'satisfied' || ack.phase === 'waiting', true);
  const coordinatedTerminal = await pollObservation(
    api,
    beginCoord.operationId,
    (observation) => observation.state === 'pending-restart' || observation.state === 'failed',
    'pending-restart'
  );
  assert.equal(coordinatedTerminal.state, 'pending-restart');
  assert.equal(coordinatedTerminal.installedVersion, TARGET_VERSION);
  ok('real Host coordination: paused+saved ack satisfied, then pending-restart');

  // 6) while pending-restart, a repeat begin reuses the same operation (no install).
  const beginAgain = await api.begin(TARGET.id);
  assert.equal(beginAgain.operationId, beginCoord.operationId);
  ok('pending-restart keeps the same operation id on repeat begin (no duplicate install)');

  // 7) terminal retention + cancel not-running.
  const reInspected = await api.inspect();
  assert.equal(reInspected.operation.operationId, beginCoord.operationId);
  assert.equal(reInspected.operation.state, 'pending-restart');
  const cancel = await api.cancel(beginCoord.operationId);
  assert.equal(cancel.status, 'not-running');
  ok('terminal retained + cancel not-running');

  // 8) forged target → GM-4090, no install.
  let forged = null;
  try {
    await api.begin(updateTargetIdFor(nextMinorVersion(TARGET_VERSION), COMMIT_A));
  } catch (error) {
    forged = error;
  }
  assert.ok(forged, 'forged target rejected');
  assert.equal(forged.code, 'GM-4090');
  ok('forged target rejected with GM-4090');

  // ---- Harness 2: a save failure aborts before the install.
  const fake2 = createFakePluginManager({
    bundles: [makeBundleState({ version: '1.2.0' })],
    install: async (spec, options) => ({
      stage: 'enable',
      target: 'dsh-game-market',
      enabled: true,
      changed: true,
      application: 'applied',
      bundle: 'dsh-game-market',
      version: TARGET_VERSION,
      spec,
      options,
    }),
  });
  const fixture2 = await createFileRegistry(t, [{ manifest: { id: 'jump', name: 'Jump', version: '1.0.0' } }]);
  const host2 = await createHostHarness(t, {
    config: {
      registry: { url: fixture2.indexPath, allowLocalFile: true },
      platformUpdate: { startupCheck: false },
    },
    http: {
      updateOperationTiming: { coordinateTimeoutMs: 5000 },
      platformUpdateTiming: { indexConnectMs: 200, indexTotalMs: 200, indexIdleMs: 200 },
    },
    pluginManagerResolver: () => fake2.manager,
    hmrResolver: () => ({ runExclusive: async (task) => task() }),
    prepareDataRoot: async (dataRoot) => {
      await writeDiscoveryCache(dataRoot, makeCacheDocument({ target: TARGET }));
    },
  });
  await host2.host.registry.ready();
  const api2 = createUpdateApi({ fetchImpl: hostFetch(host2, []) });
  await host2.data(ROUTES.INSTALL, { body: { gameId: 'jump', operationId: 'smoke2-install-jump' } });
  const launch2 = await host2.data(ROUTES.LAUNCH, { body: { gameId: 'jump', mode: 'start' } });
  const beginFail = await api2.begin(TARGET.id);
  const secondCoordinating = await pollObservation(
    api2,
    beginFail.operationId,
    (observation) => observation.state === 'inspecting' || observation.state === 'installing' || observation.state === 'applied',
    'phase-2 coordination'
  );
  assert.equal(secondCoordinating.state, 'inspecting');
  assert.equal(secondCoordinating.coordination.pending, 1);
  const failedAck = await api2.coordinate({
    windowId: 'w'.repeat(32),
    instances: [
      {
        instanceId: launch2.instanceId,
        gameId: 'jump',
        playSessionId: null,
        paused: true,
        saved: false,
        saveStale: true,
        saveRevision: null,
        error: { code: 'GM-5021' },
      },
    ],
    idle: false,
  });
  assert.equal(failedAck.accepted, true);
  assert.equal(failedAck.phase, 'failed');
  const failedTerminal = await pollObservation(
    api2,
    beginFail.operationId,
    (observation) => observation.state === 'failed' || observation.state === 'verification-failed',
    'failed terminal'
  );
  assert.equal(failedTerminal.state, 'failed');
  assert.equal(typeof failedTerminal.oldVersionStillRunning, 'boolean');
  const failedView = describeObservation(failedTerminal, { targetVersion: TARGET_VERSION });
  assert.equal(failedView.success, false);
  assert.equal(failedView.showRecovery, true);
  ok('real Host save-failure aborts before install: failed (not success) + recovery copy');

  console.log('SMOKE PASS: ' + calls.length + ' phase-1 Host route calls, operation ' + beginCoord.operationId);
});
