/**
 * V1.5 M3-H2: update state machine, coordination, idempotency, persistence and
 * recovery (docs/V1.5-CONTRACTS.md §9.1/§9.5.1, m3-decisions §2–§4).
 *
 * The suite drives the real `createUpdateOperationService` + real adapter over a
 * fake native plugin manager and a mutable identity, so every frozen branch is
 * exercised without a live DSH process. Simulated HMR dispose / process restart
 * reuse the same storage root: the durable record is the only carrier.
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { GM } from '../../../shared/src/errors.js';
import { COMMIT_A, COMMIT_B, COMMIT_CLIENT, createUpdateHarness, makeActiveInstance, makeBundleState, makeTarget } from '../support/platform-update-harness.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function installResult(overrides = {}) {
  return {
    stage: 'enable',
    target: 'dsh-game-market',
    enabled: true,
    changed: true,
    application: 'applied',
    bundle: 'dsh-game-market',
    version: '1.3.0',
    ...overrides,
  };
}

async function waitObservation(operations, predicate, { timeoutMs = 3000, label = 'observation' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const observation = operations.currentObservation();
    if (observation !== null && predicate(observation)) return observation;
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(observation)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function register() {
  test('happy path: inspecting→installing→applied(intermediate)→activating→updated with both ends verified', async (t) => {
    const harness = await createUpdateHarness(t, {
      managerOptions: {
        install: async () => installResult(),
      },
    });
    const tracker = harness.trackStates();
    const { operationId } = await harness.begin();
    assert.match(operationId, /^upd_[a-f0-9]{16}$/);
    // `applied` is observable but is NOT success: Host identity + Client
    // identity must still match afterwards.
    await harness.waitForState('applied');
    const applied = harness.operations.currentObservation();
    assert.equal(applied.state, 'applied');
    assert.equal(applied.version, '1.3.0');
    assert.equal(harness.managerCalls.installBundle.length, 1);
    assert.equal(
      harness.managerCalls.installBundle[0].spec,
      `https://github.com/heswy/dsh-game-market.git#${COMMIT_A}`
    );
    assert.equal(harness.managerCalls.installBundle[0].options.saveExact, true);
    assert.equal(harness.managerCalls.installBundle[0].options.enabled, true);

    // Simulate the HMR re-apply: running identity moves to the target.
    harness.mutable.applyTarget(harness.target);
    await harness.waitForState('activating');
    // A Client report with the release-expected identity completes the update.
    await harness.postClientReport({ buildVersion: '1.3.0', buildCommit: COMMIT_CLIENT });
    const updated = await harness.waitForState('updated');
    assert.equal(updated.version, '1.3.0');
    assert.equal(updated.host, `1.3.0+${COMMIT_A}`);
    assert.equal(updated.client, `1.3.0+${COMMIT_CLIENT}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const states = tracker.states();
    assert.ok(states.includes('installing'), `states=${states}`);
    assert.ok(states.includes('applied'), `states=${states}`);
    assert.ok(states.indexOf('applied') < states.indexOf('updated'), `states=${states}`);
    tracker.stop();
    // Terminal observation is retained for the same operation id.
    assert.deepEqual(harness.operations.observe(operationId), updated);
    assert.equal(harness.managerCalls.installBundle.length, 1, 'no duplicate install');
  });

  test('coordination: no package change until every active instance confirms pause+save', async (t) => {
    const harness = await createUpdateHarness(t, {
      instances: [makeActiveInstance()],
      managerOptions: {
        install: async () => installResult({ application: 'restart-required', restartReason: 'no-hmr' }),
      },
    });
    const { operationId } = await harness.begin();
    const inspecting = await harness.waitForState('inspecting');
    assert.equal(inspecting.coordination.phase, 'waiting');
    assert.equal(inspecting.coordination.pending, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(harness.managerCalls.installBundle.length, 0, 'install must wait for coordination');

    const coordinate = await harness.operations.coordinate({
      windowId: 'window-1',
      idle: false,
      instances: [
        {
          instanceId: makeActiveInstance().instanceId,
          gameId: 'snake',
          paused: true,
          saved: true,
          saveStale: false,
          playSessionId: null,
          saveRevision: null,
        },
      ],
    });
    assert.equal(coordinate.accepted, true);
    assert.equal(coordinate.phase, 'satisfied');
    assert.equal(coordinate.pending.instances, 0);
    const pending = await harness.waitForState('pending-restart');
    assert.equal(pending.installBundle === undefined, true);
    assert.equal(pending.installedVersion, '1.3.0');
    assert.equal(harness.managerCalls.installBundle.length, 1);
    assert.equal(operationId, operationId);
    assert.equal(harness.operations.observe(operationId).state, 'pending-restart');
  });

  test('coordination: a failed save aborts before any package change with actionable state', async (t) => {
    const harness = await createUpdateHarness(t, {
      instances: [makeActiveInstance()],
      managerOptions: { install: async () => installResult({ application: 'restart-required', restartReason: 'no-hmr' }) },
    });
    await harness.begin();
    await harness.waitForState('inspecting');
    const coordinate = await harness.operations.coordinate({
      windowId: 'window-1',
      idle: false,
      instances: [
        {
          instanceId: makeActiveInstance().instanceId,
          gameId: 'snake',
          paused: true,
          saved: false,
          saveStale: true,
          error: { code: 'GM-5021', message: 'save failed' },
        },
      ],
    });
    assert.equal(coordinate.accepted, true);
    assert.equal(coordinate.phase, 'failed');
    const failed = await harness.waitForState('failed');
    assert.equal(failed.error.code, GM.UPDATE_GAME_RUNNING);
    assert.match(failed.error.message, /save/i);
    assert.equal(failed.oldVersionStillRunning, true);
    assert.equal(harness.managerCalls.installBundle.length, 0);
  });

  test('coordination: an unresponsive instance times out and aborts, never installs', async (t) => {
    const harness = await createUpdateHarness(t, {
      instances: [makeActiveInstance()],
      operationTiming: {
        coordinateTimeoutMs: 40,
        activationHostWaitMs: 300,
        activationClientWaitMs: 500,
        recoveryProbeMs: 100,
        recoveryPollMs: 5,
        operationPollMs: 2,
        clientReportTtlMs: 60000,
      },
    });
    await harness.begin();
    const failed = await harness.waitForState('failed');
    assert.equal(failed.error.code, GM.UPDATE_GAME_RUNNING);
    assert.match(failed.error.message, /deadline/i);
    assert.equal(harness.managerCalls.installBundle.length, 0);
  });

  test('coordination: idle windows are allowed, unknown/mismatched instances are rejected', async (t) => {
    const harness = await createUpdateHarness(t, { instances: [makeActiveInstance()] });
    await harness.begin();
    await harness.waitForState('inspecting');
    const idle = await harness.operations.coordinate({ windowId: 'window-idle', idle: true, instances: [] });
    assert.equal(idle.accepted, true);
    assert.equal(idle.phase, 'waiting');
    await assert.rejects(
      () =>
        harness.operations.coordinate({
          windowId: 'window-1',
          idle: true,
          instances: [{ instanceId: makeActiveInstance().instanceId, gameId: 'snake', paused: true, saved: true }],
        }),
      (error) => error.code === GM.INVALID_PARAM
    );
    await assert.rejects(
      () =>
        harness.operations.coordinate({
          windowId: 'window-1',
          idle: false,
          instances: [{ instanceId: 'f'.repeat(32), gameId: 'snake', paused: true, saved: true }],
        }),
      (error) => error.code === GM.INVALID_PARAM
    );
    await assert.rejects(
      () =>
        harness.operations.coordinate({
          windowId: 'window-1',
          idle: false,
          instances: [{ instanceId: makeActiveInstance().instanceId, gameId: 'breakout', paused: true, saved: true }],
        }),
      (error) => error.code === GM.INVALID_PARAM
    );
  });

  test('idempotency: same target returns the same operation; a different target is busy (GM-4091)', async (t) => {
    const harness = await createUpdateHarness(t, { instances: [makeActiveInstance()] });
    const first = await harness.begin();
    const repeat = await harness.begin();
    assert.equal(repeat.operationId, first.operationId);
    const otherTarget = makeTarget({ version: '1.4.0', commit: COMMIT_B });
    harness.discovery.setTarget(otherTarget);
    await assert.rejects(
      () => harness.operations.begin({ targetId: otherTarget.id }),
      (error) => {
        assert.equal(error.code, GM.INSTALL_IN_PROGRESS);
        assert.match(error.message, /platform plugin update is in progress/i);
        return true;
      }
    );
    // Unknown/non-current target ids are refused with GM-4090.
    await assert.rejects(
      () => harness.operations.begin({ targetId: 'tgt_0123456789abcdef' }),
      (error) => error.code === GM.UPDATE_TARGET_INVALID
    );
    const cancelled = await harness.operations.cancel({ operationId: first.operationId });
    assert.equal(cancelled.status, 'cancelled');
  });

  test('already-at-target: running identity match creates a terminal idempotent observation', async (t) => {
    const target = makeTarget();
    const harness = await createUpdateHarness(t, {
      target,
      identity: { loadedVersion: '1.3.0', loadedCommit: COMMIT_A, diskVersion: '1.3.0', diskCommit: COMMIT_A },
    });
    const { operationId } = await harness.begin();
    const observation = harness.operations.observe(operationId);
    assert.equal(observation.state, 'already-at-target');
    assert.equal(observation.reason, 'same-commit');
    assert.equal(harness.managerCalls.installBundle.length, 0);
  });

  test('already-at-target: disk at target with no HMR reports pending-restart, not success', async (t) => {
    const target = makeTarget();
    const harness = await createUpdateHarness(t, {
      target,
      identity: { loadedVersion: '1.2.0', loadedCommit: COMMIT_B, diskVersion: '1.3.0', diskCommit: COMMIT_A },
      managerOptions: { hmr: undefined },
    });
    // Force the non-HMR capability conclusion quickly.
    const { operationId } = await harness.begin();
    const pending = await harness.waitForState('pending-restart');
    assert.equal(pending.restartReason, 'no-hmr');
    assert.equal(harness.managerCalls.installBundle.length, 0);
    assert.equal(harness.operations.observe(operationId).state, 'pending-restart');
  });

  test('ambiguous-install is never mapped to success without verified version+commit', async (t) => {
    const harness = await createUpdateHarness(t, {
      managerOptions: {
        install: async () => ({ stage: 'install', target: 'spec', enabled: true, changed: false, application: 'failed', error: { code: 'ambiguous-install' } }),
      },
    });
    await harness.begin();
    const failed = await harness.waitForState('verification-failed');
    assert.equal(failed.reason, 'ambiguous-install');
    assert.equal(failed.installedVersion, '1.2.0');
    assert.equal(failed.runningVersion, '1.2.0');
  });

  test('native management failure reports failed with oldVersionStillRunning=true', async (t) => {
    const harness = await createUpdateHarness(t, {
      managerOptions: {
        install: async () => ({ stage: 'install', target: 'spec', enabled: true, changed: false, application: 'failed', error: { code: 'operation-error' } }),
      },
    });
    await harness.begin();
    const failed = await harness.waitForState('failed');
    assert.equal(failed.error.code, GM.INSTALL_FAILED);
    assert.equal(failed.oldVersionStillRunning, true);
  });

  test('applied with a mismatched installed version is verification-failed(version-mismatch)', async (t) => {
    const harness = await createUpdateHarness(t, {
      managerOptions: { install: async () => installResult({ version: '1.2.9' }) },
    });
    await harness.begin();
    const failed = await harness.waitForState('verification-failed');
    assert.equal(failed.reason, 'version-mismatch');
    assert.equal(failed.installedVersion, '1.2.9');
  });

  test('non-HMR restart-required maps to pending-restart (never updated)', async (t) => {
    const harness = await createUpdateHarness(t, {
      managerOptions: {
        install: async () => installResult({ application: 'restart-required', restartReason: 'no-hmr' }),
      },
    });
    await harness.begin();
    const pending = await harness.waitForState('pending-restart');
    assert.equal(pending.restartReason, 'no-hmr');
    assert.equal(pending.installedVersion, '1.3.0');
    assert.notEqual(harness.operations.currentObservation().state, 'updated');
  });

  test('cancel during installing: native cancelled maps to cancelled(cancelledBy=user)', async (t) => {
    const gate = deferred();
    const harness = await createUpdateHarness(t, {
      managerOptions: {
        install: () => gate.promise,
        cancel: async () => ({ status: 'cancelled' }),
      },
    });
    const { operationId } = await harness.begin();
    await harness.waitForState('installing');
    const cancel = await harness.operations.cancel({ operationId });
    assert.equal(cancel.status, 'cancelled');
    assert.equal(cancel.observation.state, 'cancelled');
    assert.equal(cancel.observation.cancelledBy, 'user');
    gate.resolve(installResult({ application: 'cancelled' }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(harness.operations.currentObservation().state, 'cancelled');
    // Cancelling an unknown/terminal operation is "not-running", never an error.
    assert.equal((await harness.operations.cancel({ operationId: 'upd_0123456789abcdef' })).status, 'not-running');
  });

  test('cancel too-late keeps observing to the real terminal state (no rollback claim)', async (t) => {
    const gate = deferred();
    const harness = await createUpdateHarness(t, {
      managerOptions: {
        install: () => gate.promise,
        cancel: async () => ({ status: 'too-late' }),
      },
    });
    const { operationId } = await harness.begin();
    await harness.waitForState('installing');
    const cancel = await harness.operations.cancel({ operationId });
    assert.equal(cancel.status, 'too-late');
    assert.equal(cancel.observation.state, 'too-late');
    assert.equal(cancel.observation.note, 'install-continues');
    harness.mutable.applyTarget(harness.target);
    gate.resolve(installResult());
    await harness.waitForState('activating');
    await harness.postClientReport({ buildVersion: '1.3.0', buildCommit: COMMIT_CLIENT });
    const updated = await harness.waitForState('updated');
    assert.equal(updated.state, 'updated');
  });

  test('stale client (old page) reports stale-runtime(client-old) until it refreshes', async (t) => {
    const harness = await createUpdateHarness(t, {
      managerOptions: { install: async () => installResult() },
    });
    await harness.begin();
    await harness.waitForState('applied');
    harness.mutable.applyTarget(harness.target);
    await harness.waitForState('activating');
    await harness.postClientReport({ clientId: 'old', windowId: 'window-1', buildVersion: '1.2.0', buildCommit: null });
    const stale = await harness.waitForState('stale-runtime');
    assert.equal(stale.reason, 'client-old');
    assert.equal(stale.runningVersion, '1.2.0');
    // The refreshed page (same browser window) reports the new identity.
    await harness.postClientReport({ clientId: 'new', windowId: 'window-1', buildVersion: '1.3.0', buildCommit: COMMIT_CLIENT });
    const updated = await harness.waitForState('updated');
    assert.equal(updated.version, '1.3.0');
  });

  test('no client report in time ⇒ verification-failed(response-lost), never success', async (t) => {
    const harness = await createUpdateHarness(t, {
      managerOptions: { install: async () => installResult() },
      operationTiming: {
        coordinateTimeoutMs: 100,
        activationHostWaitMs: 400,
        activationClientWaitMs: 80,
        recoveryProbeMs: 100,
        recoveryPollMs: 5,
        operationPollMs: 2,
        clientReportTtlMs: 60000,
      },
    });
    await harness.begin();
    await harness.waitForState('applied');
    harness.mutable.applyTarget(harness.target);
    const failed = await harness.waitForState('verification-failed');
    assert.equal(failed.reason, 'response-lost');
    assert.equal(failed.runningVersion, '1.3.0');
  });

  test('Host running identity never moves ⇒ stale-runtime(host-old), never updated', async (t) => {
    const harness = await createUpdateHarness(t, {
      managerOptions: { install: async () => installResult() },
      operationTiming: {
        coordinateTimeoutMs: 100,
        activationHostWaitMs: 60,
        activationClientWaitMs: 500,
        recoveryProbeMs: 100,
        recoveryPollMs: 5,
        operationPollMs: 2,
        clientReportTtlMs: 60000,
      },
    });
    await harness.begin();
    await harness.waitForState('applied');
    // Disk moves but the old code keeps running (no HMR/restart).
    harness.mutable.setDisk({ version: '1.3.0', commit: COMMIT_A });
    const stale = await harness.waitForState('stale-runtime');
    assert.equal(stale.reason, 'host-old');
    assert.equal(stale.runningVersion, '1.2.0');
  });

  test('recovery after HMR dispose mid-install: persisted record reattaches, waitForInstall null is not success', async (t) => {
    const never = new Promise(() => {});
    const harness = await createUpdateHarness(t, {
      managerOptions: { install: () => never, waitInstall: async () => null },
    });
    const { operationId } = await harness.begin();
    await harness.waitForState('installing');
    // The update disposes this Host row; the operation is NOT terminal and the
    // native manager is still installing. The persisted record must survive.
    await harness.stop();
    const reopened = await harness.reopen({
      identityState: {
        loadedVersion: '1.3.0',
        loadedCommit: COMMIT_A,
        diskVersion: '1.3.0',
        diskCommit: COMMIT_A,
        expectedClient: { buildVersion: '1.3.0', buildCommit: COMMIT_CLIENT },
      },
      manager: harness.manager,
    });
    // New Host activation resumes from the record and verifies actual identity.
    const activating = await waitObservation(reopened.operations, (observation) => observation.state === 'activating');
    assert.equal(activating.installedVersion, '1.3.0');
    await reopened.operations.clientReport({
      clientId: 'client-1',
      windowId: 'window-1',
      buildVersion: '1.3.0',
      buildCommit: COMMIT_CLIENT,
      pageToken: 'page-1',
      startedAt: new Date().toISOString(),
    });
    const updated = await waitObservation(reopened.operations, (observation) => observation.state === 'updated');
    assert.equal(updated.version, '1.3.0');
    assert.equal(reopened.operations.observe(operationId).state, 'updated');
    assert.equal(harness.managerCalls.installBundle.length, 1, 'recovery must not reinstall');
    await reopened.operations.stop();
  });

  test('recovery after non-HMR restart: pending-restart record becomes activating→updated', async (t) => {
    const harness = await createUpdateHarness(t, {
      managerOptions: {
        install: async () => installResult({ application: 'restart-required', restartReason: 'no-hmr' }),
      },
    });
    const { operationId } = await harness.begin();
    await harness.waitForState('pending-restart');
    await harness.stop();
    // Process restart: the same persisted target is now the running identity.
    const reopened = await harness.reopen({
      identityState: {
        loadedVersion: '1.3.0',
        loadedCommit: COMMIT_A,
        diskVersion: '1.3.0',
        diskCommit: COMMIT_A,
        expectedClient: { buildVersion: '1.3.0', buildCommit: COMMIT_CLIENT },
      },
    });
    const activating = await waitObservation(reopened.operations, (observation) => observation.state === 'activating');
    assert.equal(activating.awaiting, 'reload');
    await reopened.operations.clientReport({
      clientId: 'client-1',
      windowId: 'window-1',
      buildVersion: '1.3.0',
      buildCommit: COMMIT_CLIENT,
      pageToken: 'page-1',
      startedAt: new Date().toISOString(),
    });
    const updated = await waitObservation(reopened.operations, (observation) => observation.state === 'updated');
    assert.equal(updated.version, '1.3.0');
    assert.equal(reopened.operations.observe(operationId).state, 'updated');
    await reopened.operations.stop();
  });

  test('recovery after an interrupted coordination aborts with no package change', async (t) => {
    const harness = await createUpdateHarness(t, { instances: [makeActiveInstance()] });
    const { operationId } = await harness.begin();
    await harness.waitForState('inspecting');
    await harness.stop();
    const reopened = await harness.reopen();
    const failed = await waitObservation(reopened.operations, (observation) => observation.state === 'failed');
    assert.match(failed.error.message, /interrupted/i);
    assert.equal(failed.oldVersionStillRunning, true);
    assert.equal(harness.managerCalls.installBundle.length, 0);
    assert.equal(reopened.operations.observe(operationId).state, 'failed');
    await reopened.operations.stop();
  });

  test('terminal observation is retained until the next begin; new begin replaces it', async (t) => {
    const harness = await createUpdateHarness(t, {
      managerOptions: { install: async () => installResult() },
    });
    const { operationId } = await harness.begin();
    await harness.waitForState('applied');
    harness.mutable.applyTarget(harness.target);
    await harness.waitForState('activating');
    await harness.postClientReport({ buildVersion: '1.3.0', buildCommit: COMMIT_CLIENT });
    await harness.waitForState('updated');
    assert.equal(harness.operations.observe(operationId).state, 'updated');
    assert.equal(harness.operations.observe(operationId).state, 'updated');
    const nextTarget = makeTarget({ version: '1.4.0', commit: COMMIT_B });
    harness.discovery.setTarget(nextTarget);
    harness.mutable.setDisk({ version: '1.3.0', commit: COMMIT_A });
    const next = await harness.begin(nextTarget.id);
    assert.notEqual(next.operationId, operationId);
    assert.throws(
      () => harness.operations.observe(operationId),
      (error) => error.code === GM.INVALID_PARAM
    );
  });

  test('dev-row shadow blocks begin (GM-4090 dev-source) without installing', async (t) => {
    const harness = await createUpdateHarness(t, {
      managerOptions: {
        plugins: [
          {
            entryId: 'entry:dev',
            moduleName: 'file:///tmp/checkout/index.js',
            enabled: true,
            fiberPhase: 'active',
            patchId: 'dsh-game-market',
          },
        ],
      },
      identity: { devSource: true },
    });
    await assert.rejects(
      () => harness.begin(),
      (error) => {
        assert.equal(error.code, GM.UPDATE_TARGET_INVALID);
        assert.equal(error.details.reason, 'dev-source');
        return true;
      }
    );
    assert.equal(harness.managerCalls.installBundle.length, 0);
  });

  test('unknown capability blocks begin with GM-5038 (fail closed)', async (t) => {
    const harness = await createUpdateHarness(t, {
      adapterTiming: { hmrProbeIntervalMs: 2, hmrAbsenceSettleMs: 4, hmrProbeTimeoutMs: 30 },
    });
    // Every probe path throws: absence cannot be proven, so capability must be
    // unknown and the update must stay disabled.
    const originalGet = harness.manager.ownerContext.get;
    harness.manager.ownerContext.get = () => {
      throw new Error('hmr probe unavailable');
    };
    harness.adapter.invalidateCapability();
    await assert.rejects(
      () => harness.begin(),
      (error) => {
        assert.equal(error.code, GM.UPDATE_ADAPTER_UNAVAILABLE);
        return true;
      }
    );
    assert.equal(harness.managerCalls.installBundle.length, 0);
    harness.manager.ownerContext.get = originalGet;
  });

  test('documented seed record drives recovery injection (response-lost, never success)', async (t) => {
    const harness = await createUpdateHarness(t, { managerOptions: { waitInstall: async () => null } });
    await harness.stop();
    // The documented operator-note seed shape (§17.4): a persisted non-terminal
    // record is the ONLY recovery carrier. Writing it must not be read as success.
    const stamp = new Date().toISOString();
    const operationId = 'upd_0123456789abcdef';
    const seed = {
      schemaVersion: 1,
      operationId,
      requestId: 'upd_fedcba9876543210',
      createdAt: stamp,
      updatedAt: stamp,
      status: 'installing',
      target: harness.target,
      previous: {
        spec: `github:heswy/dsh-game-market#${COMMIT_B}`,
        specShape: 'git-url',
        version: '1.2.0',
        commit: COMMIT_B,
        enabled: true,
        loadedVersion: '1.2.0',
        loadedCommit: COMMIT_B,
        dataRoot: harness.dataRoot,
      },
      coordination: null,
      cancelled: false,
      observation: { operationId, state: 'installing', stage: 'install', progress: null },
      hostEpochStarted: 'he_0000000000000000',
    };
    await fs.mkdir(harness.dataRoot, { recursive: true });
    await fs.writeFile(path.join(harness.dataRoot, 'platform-update-operation.json'), JSON.stringify(seed));
    const reopened = await harness.reopen();
    const failed = await waitObservation(reopened.operations, (observation) => observation.state === 'verification-failed');
    assert.equal(failed.reason, 'response-lost');
    assert.equal(failed.runningVersion, '1.2.0');
    assert.equal(reopened.operations.observe(operationId).state, 'verification-failed');
    assert.equal(harness.managerCalls.installBundle.length, 0, 'recovery must never start a new install');
    await reopened.operations.stop();
  });

  test('multi-window concurrent begins collapse into one operation and one install', async (t) => {
    const gate = deferred();
    const harness = await createUpdateHarness(t, {
      instances: [makeActiveInstance()],
      managerOptions: { install: () => gate.promise, cancel: async () => ({ status: 'cancelled' }) },
    });
    const [one, two, three] = await Promise.all([harness.begin(), harness.begin(), harness.begin()]);
    assert.equal(one.operationId, two.operationId);
    assert.equal(two.operationId, three.operationId);
    await harness.waitForState('inspecting');
    await harness.operations.cancel({ operationId: one.operationId });
  });
}
