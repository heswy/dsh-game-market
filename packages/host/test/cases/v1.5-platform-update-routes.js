/**
 * V1.5 M3-H2: platform update routes over the real Host composition.
 *
 * Proves the verification harness can drive `begin`/`observe`/`cancel`/`inspect`
 * through the real router + real discovery + real adapter (fake native manager),
 * including the exact pinned spec handed to the native `installBundle`.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { ROUTES } from '../../../shared/src/contracts.js';
import { GM } from '../../../shared/src/errors.js';
import { updateTargetIdFor, updateGitSpecForCommit } from '../../../shared/src/platform-update.js';
import { readBundleVersion } from '../../src/config.js';
import { createHostIdentity } from '../../src/host-identity.js';
import { createHostHarness } from '../support/harness.js';
import {
  COMMIT_A,
  COMMIT_B,
  makeCacheDocument,
  makeIndexDocument,
  makeVersion,
  staticFetch,
  writeDiscoveryCache,
  writeProfile,
} from '../support/platform-update.js';
import { createFakePluginManager, makeBundleState } from '../support/platform-update-harness.js';

const TARGET_VERSION = '1.3.0';
const TARGET = {
  id: updateTargetIdFor(TARGET_VERSION, COMMIT_A),
  version: TARGET_VERSION,
  commit: COMMIT_A,
  channel: 'stable',
  publishedAt: '2023-11-14T22:13:20.000Z',
  spec: updateGitSpecForCommit(COMMIT_A),
};

const FAST_OPERATION_TIMING = {
  coordinateTimeoutMs: 200,
  activationHostWaitMs: 120,
  activationClientWaitMs: 200,
  recoveryProbeMs: 120,
  recoveryPollMs: 5,
  operationPollMs: 2,
  clientReportTtlMs: 60000,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll(predicate, { timeoutMs = 3000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(10);
  }
}

export function register() {
  test('routes: begin → observe → pending-restart through the real Host composition', async (t) => {
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
    const hmrService = { runExclusive: async (task) => task() };
    const host = await createHostHarness(t, {
      config: { platformUpdate: { startupCheck: false } },
      http: {
        updateOperationTiming: FAST_OPERATION_TIMING,
        platformUpdateTiming: { indexConnectMs: 200, indexTotalMs: 200, indexIdleMs: 200 },
      },
      pluginManagerResolver: () => fake.manager,
      hmrResolver: () => hmrService,
      prepareDataRoot: async (dataRoot) => {
        await writeDiscoveryCache(dataRoot, makeCacheDocument({ target: TARGET }));
      },
    });

    const inspect = await host.data(ROUTES.PLATFORM_UPDATE);
    assert.equal(inspect.target.version, TARGET_VERSION);
    assert.equal(inspect.capability.canBeginUpdate, true);
    assert.equal(inspect.capability.hmr, 'present');
    assert.equal(inspect.capability.updatePath, 'in-place-hmr');
    assert.equal(inspect.installed.enabled, true);
    assert.equal(inspect.installed.version, '1.2.0');

    const begin = await host.requestJson(ROUTES.PLATFORM_UPDATE_BEGIN, { body: { targetId: TARGET.id } });
    assert.equal(begin.response.status, 200);
    assert.match(begin.payload.data.operationId, /^upd_[a-f0-9]{16}$/);
    const operationId = begin.payload.data.operationId;

    const observation = await poll(async () => {
      const { payload } = await host.requestJson(ROUTES.PLATFORM_UPDATE_OBSERVE, { query: { operationId } });
      assert.equal(payload.ok, true);
      return payload.data.state === 'pending-restart' ? payload.data : null;
    });
    assert.equal(observation.state, 'pending-restart');
    assert.equal(observation.restartReason, 'no-hmr');
    assert.equal(observation.installedVersion, TARGET_VERSION);
    assert.equal(fake.calls.installBundle.length, 1);
    assert.equal(fake.calls.installBundle[0].spec, TARGET.spec);
    assert.equal(fake.calls.installBundle[0].options.saveExact, true);
    assert.equal(fake.calls.installBundle[0].options.enabled, true);
    assert.match(fake.calls.installBundle[0].options.requestId, /^upd_[a-f0-9]{16}$/);

    // Terminal observation is retained for the same operation id.
    const again = await host.data(ROUTES.PLATFORM_UPDATE_OBSERVE, { query: { operationId } });
    assert.equal(again.state, 'pending-restart');
    const inspected = await host.data(ROUTES.PLATFORM_UPDATE);
    assert.equal(inspected.operation.state, 'pending-restart');
    // Cancelling a terminal/non-cancellable operation is "not-running".
    const cancel = await host.requestJson(ROUTES.PLATFORM_UPDATE_CANCEL, { body: { operationId } });
    assert.equal(cancel.response.status, 200);
    assert.equal(cancel.payload.data.status, 'not-running');
  });

  test('routes: begin rejects a forged/unknown targetId with GM-4090 (no install)', async (t) => {
    const fake = createFakePluginManager({ hmr: { runExclusive: async (task) => task() } });
    const host = await createHostHarness(t, {
      config: { platformUpdate: { startupCheck: false } },
      pluginManagerResolver: () => fake.manager,
      hmrResolver: () => fake.state.hmr,
      prepareDataRoot: async (dataRoot) => {
        await writeDiscoveryCache(dataRoot, makeCacheDocument({ target: TARGET }));
      },
    });
    const forged = await host.requestJson(ROUTES.PLATFORM_UPDATE_BEGIN, {
      body: { targetId: updateTargetIdFor(TARGET_VERSION, COMMIT_B) },
    });
    assert.equal(forged.response.status, 409);
    assert.equal(forged.payload.error.code, GM.UPDATE_TARGET_INVALID);
    const arbitrary = await host.requestJson(ROUTES.PLATFORM_UPDATE_BEGIN, {
      body: { targetId: TARGET.spec },
    });
    // Arbitrary specs are never accepted as a target id (over-long → invalid
    // parameter; a well-formed but unknown id → GM-4090).
    assert.equal(arbitrary.response.status, 400);
    assert.equal(arbitrary.payload.error.code, GM.INVALID_PARAM);
    assert.equal(fake.calls.installBundle.length, 0);

    const unknownObserve = await host.requestJson(ROUTES.PLATFORM_UPDATE_OBSERVE, {
      query: { operationId: 'upd_0123456789abcdef' },
    });
    assert.equal(unknownObserve.response.status, 400);
    assert.equal(unknownObserve.payload.error.code, GM.INVALID_PARAM);
  });

  test('routes: cancel during installing reports too-late and observation continues', async (t) => {
    let resolveInstall;
    const installGate = new Promise((resolve) => {
      resolveInstall = resolve;
    });
    const fake = createFakePluginManager({
      bundles: [makeBundleState({ version: '1.2.0' })],
      install: () => installGate,
      cancel: async () => ({ status: 'too-late' }),
    });
    const host = await createHostHarness(t, {
      config: { platformUpdate: { startupCheck: false } },
      http: { updateOperationTiming: FAST_OPERATION_TIMING },
      pluginManagerResolver: () => fake.manager,
      hmrResolver: () => ({ runExclusive: async (task) => task() }),
      prepareDataRoot: async (dataRoot) => {
        await writeDiscoveryCache(dataRoot, makeCacheDocument({ target: TARGET }));
      },
    });
    const begin = await host.data(ROUTES.PLATFORM_UPDATE_BEGIN, { body: { targetId: TARGET.id } });
    const operationId = begin.operationId;
    await poll(async () => {
      const observation = await host.data(ROUTES.PLATFORM_UPDATE_OBSERVE, { query: { operationId } });
      return observation.state === 'installing';
    });
    const cancel = await host.requestJson(ROUTES.PLATFORM_UPDATE_CANCEL, { body: { operationId } });
    assert.equal(cancel.payload.data.status, 'too-late');
    assert.equal(cancel.payload.data.observation.state, 'too-late');
    assert.equal(cancel.payload.data.observation.note, 'install-continues');
    // The install completes; the observation must NOT stay "cancelled".
    resolveInstall({
      stage: 'enable',
      target: 'dsh-game-market',
      enabled: true,
      changed: true,
      application: 'applied',
      bundle: 'dsh-game-market',
      version: '1.3.0',
    });
    const terminal = await poll(async () => {
      const observation = await host.data(ROUTES.PLATFORM_UPDATE_OBSERVE, { query: { operationId } });
      return observation.state === 'activating' || observation.state === 'verification-failed' || observation.state === 'stale-runtime'
        ? observation
        : null;
    });
    assert.notEqual(terminal.state, 'cancelled');
    // Host identity cannot move in this harness, so it must fail closed: never updated.
    const failed = await poll(async () => {
      const observation = await host.data(ROUTES.PLATFORM_UPDATE_OBSERVE, { query: { operationId } });
      return observation.state === 'verification-failed' || observation.state === 'stale-runtime' ? observation : null;
    });
    assert.ok(['verification-failed', 'stale-runtime'].includes(failed.state));
  });

  test('routes: retained terminal op + different validated target starts a new operation and re-installs', async (t) => {
    // Reproduces the probe flow: an operation reached `updated` (terminal retained,
    // Host running/disk at the released version), discovery then switches to a
    // newer target and the frozen begin endpoint is called directly.
    const ownVersion = readBundleVersion();
    const retainedTarget = {
      id: updateTargetIdFor(ownVersion, COMMIT_A),
      version: ownVersion,
      commit: COMMIT_A,
      channel: 'stable',
      publishedAt: '2023-11-14T22:13:20.000Z',
      spec: updateGitSpecForCommit(COMMIT_A),
    };
    const nextTarget = {
      id: updateTargetIdFor('9.9.9', COMMIT_B),
      version: '9.9.9',
      commit: COMMIT_B,
      channel: 'stable',
      publishedAt: '2024-01-01T00:00:00.000Z',
      spec: updateGitSpecForCommit(COMMIT_B),
    };
    const clock = { stamp: Date.now() };
    const indexStub = staticFetch(makeIndexDocument({ versions: [makeVersion({ version: '9.9.9', commit: COMMIT_B })] }));
    const fake = createFakePluginManager({
      hmr: { runExclusive: async (task) => task() },
      install: async (spec) => ({
        stage: 'enable',
        target: 'dsh-game-market',
        enabled: true,
        changed: true,
        application: 'restart-required',
        restartReason: 'no-hmr',
        bundle: 'dsh-game-market',
        version: '9.9.9',
        spec,
      }),
    });
    const host = await createHostHarness(t, {
      now: () => new Date(clock.stamp),
      config: { platformUpdate: { startupCheck: false } },
      http: {
        platformUpdateFetch: indexStub.fetch,
        updateOperationTiming: FAST_OPERATION_TIMING,
      },
      pluginManagerResolver: () => fake.manager,
      hmrResolver: () => fake.state.hmr,
      prepareDataRoot: async (dataRoot, directory) => {
        const home = path.join(directory, 'home');
        await writeProfile(null, home, {
          spec: `github:heswy/dsh-game-market#${COMMIT_A}`,
          diskVersion: ownVersion,
        });
        await writeDiscoveryCache(
          dataRoot,
          makeCacheDocument({ target: retainedTarget, checkedAt: new Date(clock.stamp).toISOString() })
        );
      },
    });

    // 1) Same target while already running it ⇒ terminal already-at-target.
    const first = await host.requestJson(ROUTES.PLATFORM_UPDATE_BEGIN, { body: { targetId: retainedTarget.id } });
    assert.equal(first.response.status, 200);
    const firstId = first.payload.data.operationId;
    const already = await poll(async () => {
      const { payload } = await host.requestJson(ROUTES.PLATFORM_UPDATE_OBSERVE, { query: { operationId: firstId } });
      return payload.ok === true && payload.data.state === 'already-at-target' ? payload.data : null;
    });
    assert.equal(already.reason, 'same-commit');
    assert.equal(fake.calls.installBundle.length, 0);

    // 2) Discovery moves to the next target (manual refresh after the 60s throttle).
    clock.stamp += 61_000;
    const refreshed = await host.requestJson(ROUTES.PLATFORM_UPDATE_REFRESH, { method: 'POST' });
    assert.equal(refreshed.payload.data.refreshed, true);
    assert.equal(refreshed.payload.data.target.id, nextTarget.id);

    // 3) Retained terminal op + different validated target ⇒ NEW operation + install.
    const second = await host.requestJson(ROUTES.PLATFORM_UPDATE_BEGIN, { body: { targetId: nextTarget.id } });
    assert.equal(second.response.status, 200);
    const secondId = second.payload.data.operationId;
    assert.notEqual(secondId, firstId, 'must not return the retained terminal operation');
    const pending = await poll(async () => {
      const { payload } = await host.requestJson(ROUTES.PLATFORM_UPDATE_OBSERVE, { query: { operationId: secondId } });
      return payload.ok === true && payload.data.state === 'pending-restart' ? payload.data : null;
    });
    assert.equal(pending.state, 'pending-restart');
    assert.equal(fake.calls.installBundle.length, 1);
    assert.equal(fake.calls.installBundle[0].spec, nextTarget.spec);
    // The retained terminal operation was replaced, not returned.
    const old = await host.requestJson(ROUTES.PLATFORM_UPDATE_OBSERVE, { query: { operationId: firstId } });
    assert.equal(old.response.status, 400);
    assert.equal(old.payload.error.code, GM.INVALID_PARAM);
    const inspected = await host.data(ROUTES.PLATFORM_UPDATE);
    assert.equal(inspected.operation.operationId, secondId);
    assert.equal(inspected.operation.state, 'pending-restart');
  });

  test('AUD-03 real Host admission barrier: game launch is blocked while the update coordinates and works again once it settles', async (t) => {
    const fake = createFakePluginManager({
      hmr: { runExclusive: async (task) => task() },
      install: async (spec) => ({
        stage: 'enable',
        target: 'dsh-game-market',
        enabled: true,
        changed: true,
        application: 'restart-required',
        restartReason: 'no-hmr',
        bundle: 'dsh-game-market',
        version: '1.3.0',
        spec,
      }),
    });
    const host = await createHostHarness(t, {
      config: { platformUpdate: { startupCheck: false } },
      http: { updateOperationTiming: FAST_OPERATION_TIMING },
      pluginManagerResolver: () => fake.manager,
      hmrResolver: () => fake.state.hmr,
      prepareDataRoot: async (dataRoot) => {
        await writeDiscoveryCache(dataRoot, makeCacheDocument({ target: TARGET }));
      },
    });
    // One real active runtime instance (Host entry registry) -> coordination gate.
    const launched = await host.data(ROUTES.LAUNCH, { body: { gameId: 'snake' } });
    assert.equal(launched.gameId, 'snake');
    const activeInstanceId = launched.instanceId;
    const begin = await host.requestJson(ROUTES.PLATFORM_UPDATE_BEGIN, { body: { targetId: TARGET.id } });
    assert.equal(begin.response.status, 200);
    const operationId = begin.payload.data.operationId;
    const inspecting = await poll(async () => {
      const observation = await host.data(ROUTES.PLATFORM_UPDATE_OBSERVE, { query: { operationId } });
      return observation.state === 'inspecting' ? observation : null;
    });
    assert.equal(inspecting.coordination.pending, 1);

    // Non-game routes stay available during the update window.
    const games = await host.data(ROUTES.GAMES);
    assert.equal(Array.isArray(games.items), true);

    // Host-authoritative barrier: a NEW launch must be rejected even though the
    // Client UI never asked this window to pause/save.
    const blocked = await host.requestJson(ROUTES.LAUNCH, { body: { gameId: 'snake' } });
    assert.equal(blocked.response.status, 409);
    assert.equal(blocked.payload.error.code, GM.INSTALL_IN_PROGRESS);
    assert.match(blocked.payload.error.message, /platform plugin update is in progress/i);
    assert.equal(blocked.payload.error.retryable, true);
    assert.equal(fake.calls.installBundle.length, 0, 'no package change while a launch is denied by the barrier');

    // Confirm the active instance's pause+save, then the package change settles.
    const coordinate = await host.requestJson(ROUTES.PLATFORM_UPDATE_COORDINATE, {
      body: {
        windowId: 'window-1',
        idle: false,
        instances: [
          {
            instanceId: activeInstanceId,
            gameId: 'snake',
            paused: true,
            saved: true,
            saveStale: false,
            playSessionId: null,
            saveRevision: null,
          },
        ],
      },
    });
    assert.equal(coordinate.payload.data.phase, 'satisfied');
    await poll(async () => {
      const observation = await host.data(ROUTES.PLATFORM_UPDATE_OBSERVE, { query: { operationId } });
      return observation.state === 'pending-restart' ? observation : null;
    });
    assert.equal(fake.calls.installBundle.length, 1);
    assert.equal(fake.calls.installBundle[0].spec, TARGET.spec);

    // Barrier released once the package change completed: launches work again.
    const relaunched = await host.data(ROUTES.LAUNCH, { body: { gameId: 'snake' } });
    assert.equal(relaunched.gameId, 'snake');
    assert.notEqual(relaunched.instanceId, activeInstanceId);
  });

  test('routes: client-report records the browser identity it is given', async (t) => {
    const fake = createFakePluginManager({ hmr: { runExclusive: async (task) => task() } });
    const host = await createHostHarness(t, {
      config: { platformUpdate: { startupCheck: false } },
      pluginManagerResolver: () => fake.manager,
      hmrResolver: () => fake.state.hmr,
    });
    const report = await host.requestJson(ROUTES.PLATFORM_UPDATE_CLIENT_REPORT, {
      body: {
        clientId: 'client-1',
        windowId: 'window-1',
        buildVersion: '1.2.0',
        buildCommit: null,
        pageToken: 'page-1',
        startedAt: new Date().toISOString(),
      },
    });
    assert.equal(report.response.status, 200);
    assert.equal(report.payload.data.accepted, true);
    assert.equal(report.payload.data.state, 'idle');
    const ownIdentity = createHostIdentity({ env: { DSH_HOME: '/tmp/dsh-gm-no-profile' }, version: readBundleVersion() });
    assert.deepEqual(report.payload.data.expected, ownIdentity.expectedClient);
    assert.equal(report.payload.data.expected.buildVersion, readBundleVersion());
    const bad = await host.requestJson(ROUTES.PLATFORM_UPDATE_CLIENT_REPORT, {
      body: { clientId: 'client-1', windowId: 'window-1', buildVersion: '1.2', buildCommit: null },
    });
    assert.equal(bad.response.status, 400);
    assert.equal(bad.payload.error.code, GM.INVALID_PARAM);
  });
}
