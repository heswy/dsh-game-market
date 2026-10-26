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

/**
 * Wrap the harness HostStorage.writeJson to inject deterministic storage
 * failures and to observe the exact critical-write sequence (audit M3-AUD-01).
 * `decide(index, record)` returns a DOMException-free error code (e.g. 'ENOSPC',
 * 'EACCES') to fail that write, or null to pass it through.
 */
function hookStorageWrites(harness, decide, events = []) {
  const original = harness.storage.writeJson.bind(harness.storage);
  let writeIndex = 0;
  harness.storage.writeJson = async (file, value, options) => {
    const index = writeIndex;
    writeIndex += 1;
    const failure = typeof decide === 'function' ? decide(index, value) : null;
    if (failure) {
      events.push({ type: 'write', index, failed: true, code: failure, status: value.status });
      const error = new Error('simulated storage failure');
      error.code = failure;
      throw error;
    }
    const result = await original(file, value, options);
    events.push({ type: 'write', index, failed: false, status: value.status });
    return result;
  };
  return {
    events,
    restore() {
      harness.storage.writeJson = original;
    },
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
    // Wait until the native install call is actually in flight (the observation
    // becomes `installing` just before the critical pre-install record write).
    await harness.waitFor(() => harness.managerCalls.installBundle.length === 1, { label: 'install in flight' });
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

  test('recovery pending-restart does not preempt a slow post-restart page (no waitForInstall failure, no reinstall)', async (t) => {
    const harness = await createUpdateHarness(t, {
      managerOptions: {
        install: async () => installResult({ application: 'restart-required', restartReason: 'no-hmr' }),
      },
      operationTiming: {
        coordinateTimeoutMs: 100,
        activationHostWaitMs: 400,
        // Normal in-place activation window stays short; recovery gets the
        // restart-safe window (V1 finding: real page reload happened later).
        activationClientWaitMs: 20,
        recoveryClientWaitMs: 400,
        recoveryProbeMs: 120,
        recoveryPollMs: 5,
        operationPollMs: 2,
        clientReportTtlMs: 60000,
      },
    });
    const { operationId } = await harness.begin();
    await harness.waitForState('pending-restart');
    await harness.stop();
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
    // Wait beyond the normal 20ms activation window: the recovered operation
    // must still be waiting for the Client instead of failing response-lost.
    await new Promise((resolve) => setTimeout(resolve, 80));
    const stillWaiting = reopened.operations.currentObservation();
    assert.notEqual(stillWaiting.state, 'verification-failed');
    assert.equal(stillWaiting.state, 'activating');
    // The page finally loads and reports its own (matching) build identity.
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
    assert.equal(updated.client, `1.3.0+${COMMIT_CLIENT}`);
    assert.equal(reopened.operations.observe(operationId).state, 'updated');
    assert.equal(harness.managerCalls.installBundle.length, 1, 'recovery must not reinstall');
    assert.equal(
      harness.managerCalls.waitForInstall.length,
      0,
      'pending-restart recovery must not depend on waitForInstall()===null'
    );
    await reopened.operations.stop();
  });

  test('recovery pending-restart: old page report → stale-runtime(client-old), refreshed report → updated', async (t) => {
    const harness = await createUpdateHarness(t, {
      managerOptions: {
        install: async () => installResult({ application: 'restart-required', restartReason: 'no-hmr' }),
      },
      operationTiming: {
        coordinateTimeoutMs: 100,
        activationHostWaitMs: 400,
        activationClientWaitMs: 20,
        recoveryClientWaitMs: 600,
        recoveryProbeMs: 120,
        recoveryPollMs: 5,
        operationPollMs: 2,
        clientReportTtlMs: 60000,
      },
    });
    await harness.begin();
    await harness.waitForState('pending-restart');
    await harness.stop();
    const reopened = await harness.reopen({
      identityState: {
        loadedVersion: '1.3.0',
        loadedCommit: COMMIT_A,
        diskVersion: '1.3.0',
        diskCommit: COMMIT_A,
        expectedClient: { buildVersion: '1.3.0', buildCommit: COMMIT_CLIENT },
      },
    });
    await waitObservation(reopened.operations, (observation) => observation.state === 'activating');
    // An unrefreshed page (old Client build) must not be reported as success.
    await reopened.operations.clientReport({
      clientId: 'old-client',
      windowId: 'window-1',
      buildVersion: '1.2.1',
      buildCommit: null,
      pageToken: 'old-page',
      startedAt: new Date().toISOString(),
    });
    const stale = await waitObservation(reopened.operations, (observation) => observation.state === 'stale-runtime');
    assert.equal(stale.reason, 'client-old');
    assert.equal(stale.runningVersion, '1.2.1');
    // Refreshing that same browser window replaces its report with the new one.
    await reopened.operations.clientReport({
      clientId: 'new-client',
      windowId: 'window-1',
      buildVersion: '1.3.0',
      buildCommit: COMMIT_CLIENT,
      pageToken: 'new-page',
      startedAt: new Date().toISOString(),
    });
    const updated = await waitObservation(reopened.operations, (observation) => observation.state === 'updated');
    assert.equal(updated.state, 'updated');
    await reopened.operations.stop();
  });

  test('recovered record older than 30 minutes resolves response-lost (stale rule, not silent success)', async (t) => {
    const harness = await createUpdateHarness(t, { managerOptions: { waitInstall: async () => null } });
    await harness.stop();
    const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    const operationId = 'upd_0123456789abcdef';
    const seed = {
      schemaVersion: 1,
      operationId,
      requestId: 'upd_fedcba9876543210',
      createdAt: old,
      updatedAt: old,
      status: 'pending-restart',
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
      observation: {
        operationId,
        state: 'pending-restart',
        restartReason: 'no-hmr',
        installedVersion: '1.3.0',
      },
      hostEpochStarted: 'he_0000000000000000',
    };
    await fs.mkdir(harness.dataRoot, { recursive: true });
    await fs.writeFile(path.join(harness.dataRoot, 'platform-update-operation.json'), JSON.stringify(seed));
    const reopened = await harness.reopen({
      identityState: {
        loadedVersion: '1.3.0',
        loadedCommit: COMMIT_A,
        diskVersion: '1.3.0',
        diskCommit: COMMIT_A,
      },
    });
    const failed = await waitObservation(reopened.operations, (observation) => observation.state === 'verification-failed');
    assert.equal(failed.reason, 'response-lost');
    assert.equal(harness.managerCalls.installBundle.length, 0);
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

  test('retained terminal op: different target starts a fresh operation (new id + fresh coordination + new install), same target is already-at-target', async (t) => {
    const target1 = makeTarget();
    const target2 = makeTarget({ version: '1.4.0', commit: COMMIT_B });
    const target3 = makeTarget({ version: '1.5.0', commit: 'd'.repeat(40) });
    const harness = await createUpdateHarness(t, {
      target: target1,
      instances: [makeActiveInstance()],
      managerOptions: {
        install: async (spec) =>
          installResult({ version: spec === target2.spec ? target2.version : target1.version }),
      },
    });
    const ack = () => ({
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
    // 1) Complete an operation to a retained terminal `updated`.
    const first = await harness.begin(target1.id);
    await harness.waitForState('inspecting');
    await harness.operations.coordinate(ack());
    await harness.waitForState('applied');
    harness.mutable.applyTarget(target1);
    await harness.waitForState('activating');
    await harness.postClientReport({ buildVersion: target1.version, buildCommit: COMMIT_CLIENT });
    await harness.waitForState('updated');
    assert.equal(harness.managerCalls.installBundle.length, 1);
    assert.equal(harness.managerCalls.installBundle[0].spec, target1.spec);

    // 2) Retained TERMINAL op + different validated target ⇒ NEW operation.
    harness.discovery.setTarget(target2);
    const second = await harness.begin(target2.id);
    assert.notEqual(second.operationId, first.operationId, 'must create a new operation id');
    const inspecting = harness.operations.observe(second.operationId);
    assert.equal(inspecting.operationId, second.operationId);
    assert.equal(inspecting.state, 'inspecting', 'fresh operation re-runs coordination');
    assert.equal(inspecting.coordination.pending, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(harness.managerCalls.installBundle.length, 1, 'no install before fresh coordination');

    // 3) ACTIVE op + different target ⇒ documented busy conflict (GM-4091).
    harness.discovery.setTarget(target3);
    await assert.rejects(
      () => harness.operations.begin({ targetId: target3.id }),
      (error) => {
        assert.equal(error.code, GM.INSTALL_IN_PROGRESS);
        assert.match(error.message, /platform plugin update is in progress/i);
        return true;
      }
    );
    harness.discovery.setTarget(target2);

    // 4) Fresh coordination then install for the new target.
    await harness.operations.coordinate(ack());
    await harness.waitForState('applied');
    harness.mutable.applyTarget(target2);
    await harness.waitForState('activating');
    await harness.postClientReport({ buildVersion: target2.version, buildCommit: COMMIT_CLIENT });
    const updated2 = await harness.waitForState('updated');
    assert.equal(updated2.version, target2.version);
    assert.equal(harness.managerCalls.installBundle.length, 2);
    assert.deepEqual(
      harness.managerCalls.installBundle.map((call) => call.spec),
      [target1.spec, target2.spec]
    );
    assert.throws(
      () => harness.operations.observe(first.operationId),
      (error) => error.code === GM.INVALID_PARAM
    );

    // 5) Retained terminal + SAME target ⇒ new terminal already-at-target, no install.
    const third = await harness.begin(target2.id);
    assert.notEqual(third.operationId, second.operationId);
    const already = harness.operations.observe(third.operationId);
    assert.equal(already.state, 'already-at-target');
    assert.equal(already.reason, 'same-commit');
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(harness.managerCalls.installBundle.length, 2, 'same-target begin must not reinstall');
    assert.throws(
      () => harness.operations.observe(second.operationId),
      (error) => error.code === GM.INVALID_PARAM
    );
  });

  test('AUD-01 critical begin record failure fails closed with retryable GM.STORE_IO (ENOSPC/EACCES)', async (t) => {
    for (const code of ['ENOSPC', 'EACCES']) {
      await t.test(`begin write ${code}`, async (subtest) => {
        const harness = await createUpdateHarness(subtest, {});
        const hook = hookStorageWrites(harness, (index) => (index === 0 ? code : null));
        await assert.rejects(
          () => harness.begin(),
          (error) => {
            assert.equal(error.code, GM.STORE_IO);
            assert.equal(error.retryable, true);
            assert.doesNotMatch(String(error.message), /\/tmp|\/Users|dsh-gm-update|\/private\//);
            return true;
          }
        );
        assert.equal(harness.managerCalls.installBundle.length, 0, 'no package change on critical persist failure');
        assert.equal(harness.operations._operation(), null, 'no half-started operation left behind');
        assert.equal(harness.admission.isBlocked(), false, 'admission barrier released');
        // Storage recovers: a later begin must be possible (no leaked lock/state).
        hook.restore();
        const retried = await harness.begin();
        assert.match(retried.operationId, /^upd_[a-f0-9]{16}$/);
        await harness.waitFor(() => harness.managerCalls.installBundle.length === 1, { label: 'install after retry' });
        await harness.stop();
      });
    }
  });

  test('AUD-01 pre-install record failure aborts before installBundle and releases lock/barrier (ENOSPC/EACCES)', async (t) => {
    for (const code of ['ENOSPC', 'EACCES']) {
      await t.test(`pre-install write ${code}`, async (subtest) => {
        const harness = await createUpdateHarness(subtest, {});
        // Write #0 = begin record, write #1 = immediately-before-installBundle record.
        const hook = hookStorageWrites(harness, (index) => (index === 1 ? code : null));
        const { operationId } = await harness.begin();
        const failed = await harness.waitForState('failed');
        assert.equal(failed.error.code, GM.STORE_IO);
        assert.match(failed.error.message, /not started|retry/i);
        assert.equal(failed.oldVersionStillRunning, true);
        assert.equal(harness.managerCalls.installBundle.length, 0, 'no package change without a persisted record');
        assert.equal(harness.operations.observe(operationId).state, 'failed');
        assert.equal(harness.admission.isBlocked(), false, 'admission barrier released');
        hook.restore();
        const retried = await harness.begin();
        assert.notEqual(retried.operationId, operationId);
        await harness.waitFor(() => harness.managerCalls.installBundle.length === 1, { label: 'install after storage recovery' });
        await harness.stop();
      });
    }
  });

  test('AUD-01 installBundle is only called after two successful critical record writes', async (t) => {
    const harness = await createUpdateHarness(t, {
      managerOptions: {
        install: async () => installResult({ application: 'restart-required', restartReason: 'no-hmr' }),
      },
    });
    const events = [];
    const hook = hookStorageWrites(harness, () => null, events);
    const originalInstall = harness.managerState.install;
    harness.managerState.install = async (spec, options) => {
      events.push({ type: 'install', spec });
      return originalInstall(spec, options);
    };
    const { operationId } = await harness.begin();
    await harness.waitForState('pending-restart');
    const installEvent = events.find((entry) => entry.type === 'install');
    assert.ok(installEvent !== undefined, 'installBundle was called');
    const writesBeforeInstall = events.filter((entry) => entry.type === 'write' && entry.index < events.indexOf(installEvent));
    assert.equal(writesBeforeInstall.length, 2, 'begin record + pre-install record');
    assert.deepEqual(writesBeforeInstall.map((entry) => entry.failed), [false, false]);
    assert.deepEqual(writesBeforeInstall.map((entry) => entry.status), ['installing', 'installing']);
    assert.equal(installEvent.spec, harness.target.spec);
    assert.equal(harness.operations.observe(operationId).state, 'pending-restart');
    hook.restore();
  });

  test('AUD-03 dynamic inclusion: an instance appearing before the package change re-opens coordination and blocks install', async (t) => {
    const harness = await createUpdateHarness(t, {
      managerOptions: {
        install: async () => installResult({ application: 'restart-required', restartReason: 'no-hmr' }),
      },
    });
    const lateInstance = makeActiveInstance();
    // Simulate an in-flight launch that registers during the pre-install persist
    // await (the audit's reproduce: begin with 0 active -> instance appears later).
    hookStorageWrites(harness, (index) => {
      if (index === 1) harness.coordinationState.instances = [lateInstance];
      return null;
    });
    const { operationId } = await harness.begin();
    const inspecting = await harness.waitForState('inspecting');
    assert.equal(inspecting.coordination.pending, 1);
    assert.equal(harness.admission.isBlocked(), true, 'admission blocked while update is active');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(harness.managerCalls.installBundle.length, 0, 'install must wait for the late instance save ack');
    const coordinate = await harness.operations.coordinate({
      windowId: 'window-1',
      idle: false,
      instances: [
        {
          instanceId: lateInstance.instanceId,
          gameId: lateInstance.gameId,
          paused: true,
          saved: true,
          saveStale: false,
        },
      ],
    });
    assert.equal(coordinate.phase, 'satisfied');
    const pending = await harness.waitForState('pending-restart');
    assert.equal(pending.state, 'pending-restart');
    assert.equal(harness.managerCalls.installBundle.length, 1);
    assert.equal(harness.managerCalls.installBundle[0].spec, harness.target.spec);
    assert.equal(harness.operations.observe(operationId).state, 'pending-restart');
    assert.equal(harness.admission.isBlocked(), false, 'barrier released once the package change completed');
  });

  test('AUD-03 coordination-satisfied boundary: an instance appearing during the critical persist re-opens coordination', async (t) => {
    const initialInstance = makeActiveInstance();
    const lateInstance = makeActiveInstance({ instanceId: '2'.repeat(32) });
    const harness = await createUpdateHarness(t, {
      instances: [initialInstance],
      managerOptions: {
        install: async () => installResult({ application: 'restart-required', restartReason: 'no-hmr' }),
      },
    });
    hookStorageWrites(harness, (index) => {
      // write #0 = begin record (coordinating), #1 = pre-install critical record.
      if (index === 1) harness.coordinationState.instances = [initialInstance, lateInstance];
      return null;
    });
    await harness.begin();
    await harness.waitForState('inspecting');
    const ackFor = (instances) => ({
      windowId: 'window-1',
      idle: false,
      instances: instances.map((instance) => ({
        instanceId: instance.instanceId,
        gameId: instance.gameId,
        paused: true,
        saved: true,
        saveStale: false,
      })),
    });
    await harness.operations.coordinate(ackFor([initialInstance]));
    // Coordination was satisfied, but a new instance appeared at the install
    // boundary: the pipeline must re-open the gate instead of installing.
    const reopened = await harness.waitForState('inspecting');
    assert.equal(reopened.coordination.pending, 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(harness.managerCalls.installBundle.length, 0, 'no install while the late instance is unconfirmed');
    const coordinate = await harness.operations.coordinate(ackFor([initialInstance, lateInstance]));
    assert.equal(coordinate.phase, 'satisfied');
    await harness.waitForState('pending-restart');
    assert.equal(harness.managerCalls.installBundle.length, 1);
    assert.equal(harness.managerCalls.installBundle[0].spec, harness.target.spec);
  });

  test('AUD-03 admission barrier is released on update failure, cancel and stop (no lock leak)', async (t) => {
    // Failure path + retry (proves the profile update lock is not leaked).
    const failedHarness = await createUpdateHarness(t, {
      instances: [makeActiveInstance()],
      managerOptions: {
        install: async () => ({ stage: 'install', target: 'spec', enabled: true, changed: false, application: 'failed', error: { code: 'operation-error' } }),
      },
    });
    await failedHarness.begin();
    assert.equal(failedHarness.admission.isBlocked(), true);
    await failedHarness.operations.coordinate({
      windowId: 'window-1',
      idle: false,
      instances: [{ instanceId: makeActiveInstance().instanceId, gameId: 'snake', paused: true, saved: true, saveStale: false }],
    });
    await failedHarness.waitForState('failed');
    assert.equal(failedHarness.admission.isBlocked(), false, 'barrier released after failure');
    const retried = await failedHarness.begin();
    assert.match(retried.operationId, /^upd_/);
    await failedHarness.stop();

    // Cancel path: cancelling coordination releases the barrier immediately.
    const cancelHarness = await createUpdateHarness(t, { instances: [makeActiveInstance()] });
    const cancelOperation = await cancelHarness.begin();
    assert.equal(cancelHarness.admission.isBlocked(), true);
    const cancelled = await cancelHarness.operations.cancel({ operationId: cancelOperation.operationId });
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelHarness.admission.isBlocked(), false, 'barrier released after cancel');
    await cancelHarness.stop();

    // Stop path (plugin dispose) releases the barrier too.
    const stopHarness = await createUpdateHarness(t, { instances: [makeActiveInstance()] });
    await stopHarness.begin();
    assert.equal(stopHarness.admission.isBlocked(), true);
    await stopHarness.operations.stop();
    assert.equal(stopHarness.admission.isBlocked(), false, 'barrier released on dispose');
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
