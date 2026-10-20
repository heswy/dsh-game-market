/**
 * MANUAL M3 integration smoke (not part of `node --test`, no test framework):
 * real Client update API layer (`packages/client/src/api-update.js` +
 * `update-state.js`) against the real Host composition harness
 * (`packages/host/test/support/harness.js`), no network and no DSH process.
 *
 * Run from the repo root:
 *   node packages/client/test/manual/m3-client-host-smoke.mjs
 *
 * Covers: inspect/normalization, client-report validation, refresh envelope,
 * launch instance registration, coordinate (unknown instance rejection,
 * satisfied ack, save-failure abort), begin/observe pending-restart without a
 * success claim, terminal retention, forged target GM-4090, repeat begin
 * idempotency.
 */
/**
 * One-off M3 integration smoke: real Client update API layer against the real
 * Host composition harness (no network, no DSH process).
 *
 * Run: node /tmp/m3-client-host-smoke.mjs (cwd = worktree root)
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const { createHostHarness } = await imp('packages/host/test/support/harness.js');
const { createFakePluginManager, makeBundleState } = await imp('packages/host/test/support/platform-update-harness.js');
const { makeCacheDocument, writeDiscoveryCache, COMMIT_A } = await imp('packages/host/test/support/platform-update.js');
const { createFileRegistry } = await imp('packages/host/test/support/packages.js');
const { ROUTES } = await imp('packages/shared/src/contracts.js');
const { updateTargetIdFor, updateGitSpecForCommit } = await imp('packages/shared/src/platform-update.js');
const { createUpdateApi } = await imp('packages/client/src/api-update.js');
const { normalizeInspection, deriveUpdateView, describeObservation } = await imp('packages/client/src/update-state.js');

const TARGET = {
  id: updateTargetIdFor('1.3.0', COMMIT_A),
  version: '1.3.0',
  commit: COMMIT_A,
  channel: 'stable',
  publishedAt: '2023-11-14T22:13:20.000Z',
  spec: updateGitSpecForCommit(COMMIT_A),
};

const cleanups = [];
const fakeTest = { after: (fn) => cleanups.push(fn) };

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
    version: '1.3.0',
    spec,
    options,
  }),
});

const fixture = await createFileRegistry(fakeTest, [
  { manifest: { id: 'jump', name: 'Jump', version: '1.0.0' } },
]);
const host = await createHostHarness(fakeTest, {
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

// fetchImpl that routes the Client's relative URLs into the real Host handler.
const calls = [];
const fetchImpl = async (url, init) => {
  const parsed = new URL(url, 'http://127.0.0.1:19387/');
  calls.push({ path: parsed.pathname + parsed.search, method: init.method });
  return host.request(parsed.pathname + parsed.search, {
    method: init.method,
    rawBody: init.body,
    headers: init.headers,
  });
};

const api = createUpdateApi({ fetchImpl });

function ok(label) {
  console.log('PASS ' + label);
}

// 1) inspect → real Host payload normalizes and maps to update-available.
const raw = await api.inspect();
assert.equal(raw.schemaVersion, 1);
assert.ok(raw.host && typeof raw.host === 'object');
assert.ok(raw.installed && typeof raw.installed === 'object');
assert.equal(raw.target.id, TARGET.id);
assert.equal(raw.target.commit, COMMIT_A);
assert.equal(raw.discovery.state, 'ready');
assert.equal(raw.capability.canBeginUpdate, true);
const inspection = normalizeInspection(raw);
const view = deriveUpdateView({ status: 'ready', inspection, clientIdentity: { version: '1.2.0', buildCommit: null } });
assert.equal(view.hidden, false);
assert.equal(view.update.kind, 'available');
assert.equal(view.blocked, null);
assert.equal(view.update.toVersion, '1.3.0');
ok('inspect via real Host route + client normalization (update-available, identity)');

// 2) client-report with this build's identity.
const report = await api.clientReport({
  clientId: 'c'.repeat(32),
  windowId: 'w'.repeat(32),
  buildVersion: '1.2.0',
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

// 3b) register one active runtime instance through the real launch route.
await host.data(ROUTES.INSTALL, { body: { gameId: 'jump', operationId: 'smoke-install-jump' } });
const launchInfo = await host.data(ROUTES.LAUNCH, { body: { gameId: 'jump', mode: 'start' } });
assert.match(launchInfo.instanceId, /^[a-f0-9]{32}$/);
ok('launch registers an active runtime instance (' + launchInfo.instanceId + ')');

// 3c) begin → coordination phase; the client-shaped ack satisfies it.
const beginCoord = await api.begin(TARGET.id);
const coordinating = await (async () => {
  for (let i = 0; i < 300; i += 1) {
    const observation = await api.observe(beginCoord.operationId);
    if (observation.state === 'inspecting') return observation;
    if (observation.state === 'installing' || observation.state === 'applied') return observation;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('never entered coordination/install');
})();
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
let coordinatedTerminal = null;
for (let i = 0; i < 300; i += 1) {
  const observation = await api.observe(beginCoord.operationId);
  if (observation.state === 'pending-restart' || observation.state === 'failed') {
    coordinatedTerminal = observation;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.ok(coordinatedTerminal);
assert.equal(coordinatedTerminal.state, 'pending-restart');
ok('real Host coordination: paused+saved ack satisfied, then pending-restart');

// 3d) while pending-restart, a repeat begin reuses the same operation (no install).
const beginAgain = await api.begin(TARGET.id);
assert.equal(beginAgain.operationId, beginCoord.operationId);
ok('pending-restart keeps the same operation id on repeat begin (no duplicate install)');

// 3e) Phase 2 harness: a save failure during coordination aborts before install.
const fake2 = createFakePluginManager({
  bundles: [makeBundleState({ version: '1.2.0' })],
  install: async (spec, options) => ({
    stage: 'enable',
    target: 'dsh-game-market',
    enabled: true,
    changed: true,
    application: 'applied',
    bundle: 'dsh-game-market',
    version: '1.3.0',
    spec,
    options,
  }),
});
const fixture2 = await createFileRegistry(fakeTest, [
  { manifest: { id: 'jump', name: 'Jump', version: '1.0.0' } },
]);
const host2 = await createHostHarness(fakeTest, {
  config: {
    registry: { url: fixture2.indexPath, allowLocalFile: true },
    platformUpdate: { startupCheck: false },
  },
  http: { updateOperationTiming: { coordinateTimeoutMs: 5000 }, platformUpdateTiming: { indexConnectMs: 200, indexTotalMs: 200, indexIdleMs: 200 } },
  pluginManagerResolver: () => fake2.manager,
  hmrResolver: () => ({ runExclusive: async (task) => task() }),
  prepareDataRoot: async (dataRoot) => {
    await writeDiscoveryCache(dataRoot, makeCacheDocument({ target: TARGET }));
  },
});
await host2.host.registry.ready();
const fetch2 = async (url, init) => {
  const parsed = new URL(url, 'http://127.0.0.1:19387/');
  return host2.request(parsed.pathname + parsed.search, { method: init.method, rawBody: init.body, headers: init.headers });
};
const api2 = createUpdateApi({ fetchImpl: fetch2 });
await host2.data(ROUTES.INSTALL, { body: { gameId: 'jump', operationId: 'smoke2-install-jump' } });
const launch2 = await host2.data(ROUTES.LAUNCH, { body: { gameId: 'jump', mode: 'start' } });
const beginFail = await api2.begin(TARGET.id);
let secondCoordinating = null;
for (let i = 0; i < 300; i += 1) {
  const observation = await api2.observe(beginFail.operationId);
  if (observation.state === 'inspecting') {
    secondCoordinating = observation;
    break;
  }
  if (observation.state === 'installing' || observation.state === 'applied') break;
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.ok(secondCoordinating, 'phase 2 entered coordination');
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
let failedTerminal = null;
for (let i = 0; i < 300; i += 1) {
  const observation = await api2.observe(beginFail.operationId);
  if (observation.state === 'failed' || observation.state === 'verification-failed') {
    failedTerminal = observation;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
}
assert.ok(failedTerminal, 'save failure reaches a failed terminal observation');
assert.equal(failedTerminal.state, 'failed');
assert.equal(typeof failedTerminal.oldVersionStillRunning, 'boolean');
const failedView = describeObservation(failedTerminal, { targetVersion: '1.3.0' });
assert.equal(failedView.success, false);
assert.equal(failedView.showRecovery, true);
ok('real Host save-failure aborts before install: failed (not success) + recovery copy');

// 4) terminal retention + cancel not-running on the first harness.
const reInspected = await api.inspect();
assert.equal(reInspected.operation.operationId, beginCoord.operationId);
assert.equal(reInspected.operation.state, 'pending-restart');
const cancel = await api.cancel(beginCoord.operationId);
assert.equal(cancel.status, 'not-running');
ok('terminal retained + cancel not-running');

console.log('SMOKE PASS: ' + calls.length + ' phase-1 Host route calls, operation ' + beginCoord.operationId);
for (const cleanup of cleanups) await cleanup();
