/**
 * V1.5 M3-H2: platform update routes over the real Host composition.
 *
 * Proves the verification harness can drive `begin`/`observe`/`cancel`/`inspect`
 * through the real router + real discovery + real adapter (fake native manager),
 * including the exact pinned spec handed to the native `installBundle`.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ROUTES } from '../../../shared/src/contracts.js';
import { GM } from '../../../shared/src/errors.js';
import { updateTargetIdFor, updateGitSpecForCommit } from '../../../shared/src/platform-update.js';
import { readBundleVersion } from '../../src/config.js';
import { createHostHarness } from '../support/harness.js';
import { COMMIT_A, COMMIT_B, makeCacheDocument, writeDiscoveryCache } from '../support/platform-update.js';
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
    assert.deepEqual(report.payload.data.expected, {
      buildVersion: readBundleVersion(),
      buildCommit: null,
    });
    const bad = await host.requestJson(ROUTES.PLATFORM_UPDATE_CLIENT_REPORT, {
      body: { clientId: 'client-1', windowId: 'window-1', buildVersion: '1.2', buildCommit: null },
    });
    assert.equal(bad.response.status, 400);
    assert.equal(bad.payload.error.code, GM.INVALID_PARAM);
  });
}
