/**
 * Platform update operations: coordination gate, persisted update record,
 * state machine and recovery (docs/V1.5-CONTRACTS.md §9.1/§9.5.1,
 * docs/verification/v1.5/m3-decisions.md §2–§4).
 *
 * The single authority for `UpdateObservation`. The invariant chain is:
 *
 *   inspecting → installing → applied (intermediate) → activating → updated
 *
 * plus the frozen branches. `updated` requires the frozen Host running identity
 * (`loadedVersion`+`buildCommit`) to equal the target, the Client's *own*
 * reported build identity to equal the release-expected identity, and a healthy
 * `/health` snapshot. A disk version is never treated as a running version and
 * `hostEpoch` is never used as restart proof.
 *
 * Recovery is durable: the update record is atomically persisted **before** any
 * package change. When HMR disposes this Host row mid-install, the re-applied
 * Host reads the record and reattaches (`waitForInstall`, actual identity
 * probing), so a Client refresh / RPC loss / plugin dispose cannot lose the
 * operation or fake a success.
 */

import { GM } from '../../shared/src/errors.js';
import { BUNDLE_ID } from '../../shared/src/constants.js';
import {
  PLATFORM_UPDATE_OPERATION_FILE,
  PLATFORM_UPDATE_REASON_KEYS,
  PLATFORM_UPDATE_SCHEMA_VERSION,
  PLATFORM_UPDATE_STATES,
  PLATFORM_UPDATE_TIMING,
  detectUpdateTargetAnomaly,
  isPinnedCommit,
  isUpdateOperationId,
  parseExactSemver,
} from '../../shared/src/platform-update.js';
import { hostError } from './errors.js';
import { createInstallLock } from './install-lock.js';
import { randomHex } from './ids.js';

const LOG = '[game-market/host]';
const RECORD_SCHEMA_VERSION = 1;
/** A non-terminal record older than this cannot be trusted after a restart. */
const MAX_RECORD_AGE_MS = 30 * 60 * 1000;
const POLL_MS = 250;

function pollDelay(limits) {
  return Number.isFinite(limits.operationPollMs) ? limits.operationPollMs : POLL_MS;
}

function iso(now) {
  return now().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value, { maxLength = 128, name = 'value' } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw hostError(GM.INVALID_PARAM, `Invalid ${name}`);
  }
  return value;
}

function optionalIsoString(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > 64 || Number.isNaN(Date.parse(value))) {
    throw hostError(GM.INVALID_PARAM, `Invalid ${name}`);
  }
  return value;
}

function optionalString(value, { maxLength = 256 } = {}) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > maxLength) return null;
  return value;
}

function sanitisedDiagnostic(value) {
  if (typeof value !== 'string') return null;
  // Diagnostics are messages only: never paths, credentials or full pnpm output.
  return value.replace(/\s+/g, ' ').slice(0, 160);
}

function terminalOf(observation) {
  return observation !== null && typeof observation === 'object' && PLATFORM_UPDATE_STATES.includes(observation.state) && [
    'updated',
    'pending-restart',
    'already-at-target',
    'verification-failed',
    'cancelled',
    'failed',
    'too-late',
  ].includes(observation.state);
}

function nativeFailureCode(nativeCode) {
  switch (nativeCode) {
    case 'incompatible-version':
      return GM.RUNTIME_INCOMPATIBLE;
    case 'not-bundle':
    case 'management-required':
    case 'stop-profile':
    case 'bundle-in-use':
      return GM.INSTALL_FAILED;
    case 'invalid-spec':
      return GM.UPDATE_TARGET_INVALID;
    default:
      return GM.INSTALL_FAILED;
  }
}

function recoveryLockName(identity, storage) {
  let label = 'default';
  if (identity !== null && typeof identity.profileDir === 'string' && identity.profileDir.length > 0) {
    const base = identity.profileDir.split(/[\\/]/).filter(Boolean).pop() || 'profile';
    label = base.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 32) || 'profile';
  }
  const root = storage !== null && typeof storage.root === 'string' ? storage.root : '';
  return { label, root };
}

/**
 * @param {{
 *   storage: object,
 *   discovery: object,
 *   adapter: object,
 *   identity?: object|null,
 *   coordination?: {listActiveInstances?: () => Array<object>}|null,
 *   healthCheck?: (() => Promise<object>)|null,
 *   hostEpoch?: string,
 *   logger?: object,
 *   now?: () => Date,
 *   timing?: object,
 * }} options
 */
export function createUpdateOperationService({
  storage,
  discovery,
  adapter,
  identity = null,
  coordination = null,
  healthCheck = null,
  hostEpoch = 'he_unknown',
  logger = null,
  now = () => new Date(),
  timing = {},
  /**
   * Host-authoritative admission barrier (audit M3-AUD-03). While a real update
   * is between coordination and package change, new game launches are blocked.
   * Optional so unit tests can construct the operations service in isolation.
   */
  admission = null,
}) {
  const limits = { ...PLATFORM_UPDATE_TIMING, ...(isPlainObject(timing) ? timing : {}) };

  /** Per-window client build identity reports (POST /platform-update/client-report). */
  const clientReports = new Map();

  /** Current/last operation (in-memory projection of the persisted record). */
  let operation = null;
  let pipeline = null;
  let recovery = null;
  let stopped = false;
  let coordinationTimer = null;

  const { label: lockLabel } = recoveryLockName(identity, storage);
  const updateLock =
    storage === null
      ? null
      : createInstallLock({
          storage,
          logger,
          heartbeatMs: 5000,
          staleMs: 30000,
          fileName: `platform-update-${lockLabel}.lock`,
          busyMessage: 'Another platform plugin update is in progress',
        });

  function observationOf(op) {
    if (op === null) return null;
    if (op.observation !== null) return op.observation;
    if (op.status === 'coordinating') {
      return {
        operationId: op.operationId,
        state: 'inspecting',
        progress: null,
        coordination: {
          phase: op.coordination?.phase ?? 'waiting',
          pending: op.coordination?.pending ?? 0,
          ...(op.coordination?.failed === undefined ? {} : { failed: op.coordination.failed }),
        },
      };
    }
    if (op.status === 'installing') {
      return { operationId: op.operationId, state: 'installing', stage: 'install', progress: null };
    }
    if (op.status === 'applied') {
      return {
        operationId: op.operationId,
        state: 'applied',
        changed: true,
        bundle: BUNDLE_ID,
        version: op.target.version,
      };
    }
    return { operationId: op.operationId, state: 'inspecting', progress: null };
  }

  function setObservation(op, observation) {
    op.observation = observation;
    op.updatedAt = iso(now);
  }

  function recordOf(op) {
    return {
      schemaVersion: RECORD_SCHEMA_VERSION,
      operationId: op.operationId,
      requestId: op.requestId,
      createdAt: op.createdAt,
      updatedAt: op.updatedAt,
      status: op.status,
      target: op.target,
      previous: op.previous,
      coordination:
        op.coordination === null
          ? null
          : {
              phase: op.coordination.phase,
              pending: op.coordination.pending ?? 0,
              startedAt: op.coordination.startedAt,
              deadlineAt: op.coordination.deadlineAt,
            },
      cancelled: op.cancelled === true,
      observation: op.observation,
      hostEpochStarted: op.hostEpochStarted,
    };
  }

  function persistFailure(error) {
    return hostError(GM.STORE_IO, 'Could not persist the platform update record', {
      retryable: true,
      cause: error,
    });
  }

  /**
   * CRITICAL persistence gate (audit M3-AUD-01): the durable update record must
   * exist BEFORE any package change. A storage failure here must abort the
   * update (no `installBundle`) with a retryable `GM.STORE_IO`; it is never
   * swallowed, because losing the record means losing the recovery target /
   * requestId / previous-version snapshot if HMR disposes this Host row.
   */
  async function persistCritical(op) {
    if (op === null) return;
    if (storage === null) {
      throw hostError(GM.STORE_IO, 'Could not persist the platform update record', { retryable: true });
    }
    try {
      await storage.writeJson(storage.filePath(PLATFORM_UPDATE_OPERATION_FILE), recordOf(op));
    } catch (error) {
      logger?.warn?.(LOG, 'platform-update-record-write-critical-failed', `code=${error?.code || 'E_UNKNOWN'}`);
      throw persistFailure(error);
    }
  }

  /**
   * BEST-EFFORT diagnostics persistence: progress/terminal observations AFTER
   * the package change already started, plus recovery-side bookkeeping. These
   * writes may fail without changing the operation outcome (the native manager
   * plus the last critical record still drive recovery), so failures are logged
   * and intentionally non-fatal.
   */
  async function persistBestEffort(op) {
    if (stopped || storage === null || op === null) return;
    try {
      await storage.writeJson(storage.filePath(PLATFORM_UPDATE_OPERATION_FILE), recordOf(op));
    } catch (error) {
      logger?.warn?.(LOG, 'platform-update-record-write-failed', `code=${error?.code || 'E_UNKNOWN'}`);
    }
  }

  let updateLockHeldRelease = null;

  async function acquireLock() {
    if (updateLock === null) return;
    updateLockHeldRelease = await updateLock.acquire({ waitMs: 0, busyCode: GM.INSTALL_IN_PROGRESS });
  }

  async function releaseHeldLock() {
    const release = updateLockHeldRelease;
    updateLockHeldRelease = null;
    if (typeof release === 'function') {
      await release().catch(() => undefined);
    }
  }

  // ----- Host-authoritative update admission barrier (audit M3-AUD-03) -----

  function blockAdmission(op) {
    if (admission === null || op === null) return;
    admission.block(op.operationId);
  }

  function releaseAdmission(op) {
    if (admission === null) return;
    if (op === null) admission.release();
    else admission.release(op.operationId);
  }

  /** Instance ids covered by a paused+saved+not-stale, error-free ack. */
  function confirmedInstanceIds(op) {
    const confirmed = new Set();
    if (op === null || op.coordination === null) return confirmed;
    for (const ack of op.coordination.acks.values()) {
      for (const entry of ack.instances.values()) {
        if (entry.paused === true && entry.saved === true && entry.saveStale !== true && entry.error === undefined) {
          confirmed.add(entry.instanceId);
        }
      }
    }
    return confirmed;
  }

  /** Active instances that no confirming ack covers (must block install). */
  function unconfirmedInstances(op) {
    if (op === null || op.status === 'terminal') return [];
    const confirmed = confirmedInstanceIds(op);
    return activeRuntimeInstances().filter((instance) => !confirmed.has(instance.instanceId));
  }

  /**
   * Re-open the coordination gate for instances that appeared after the first
   * enumeration (in-flight launch that raced the barrier, or a still-registered
   * resumed instance). Resets the coordination deadline to the frozen window.
   */
  function reopenCoordination(op, pendingInstances) {
    const coordinationState =
      op.coordination === null
        ? { acks: new Map(), failed: undefined, resolve: null, reject: null }
        : op.coordination;
    coordinationState.phase = 'waiting';
    coordinationState.pending = pendingInstances.length;
    coordinationState.startedAt = iso(now);
    coordinationState.deadlineAt = new Date(now().getTime() + limits.coordinateTimeoutMs).toISOString();
    coordinationState.registry = pendingInstances.map((instance) => ({
      instanceId: instance.instanceId,
      gameId: instance.gameId,
    }));
    coordinationState.failed = undefined;
    coordinationState.resolve = null;
    coordinationState.reject = null;
    op.coordination = coordinationState;
    op.status = 'coordinating';
    setObservation(op, {
      operationId: op.operationId,
      state: 'inspecting',
      progress: null,
      coordination: { phase: 'waiting', pending: pendingInstances.length },
    });
  }

  function clearCoordinationTimer() {
    if (coordinationTimer !== null) {
      clearTimeout(coordinationTimer);
      coordinationTimer = null;
    }
  }

  function activeRuntimeInstances() {
    if (coordination === null || typeof coordination.listActiveInstances !== 'function') return [];
    try {
      const list = coordination.listActiveInstances();
      if (!Array.isArray(list)) throw new Error('invalid active-instance inventory');
      return list.filter(
        (instance) =>
          instance !== null &&
          typeof instance === 'object' &&
          typeof instance.instanceId === 'string' &&
          typeof instance.gameId === 'string'
      );
    } catch (error) {
      logger?.warn?.(LOG, 'update-instance-list-failed', `code=${error?.code || 'E_UNKNOWN'}`);
      throw hostError(GM.GAME_RUNNING, 'Could not inspect active game sessions; retry the update', { retryable: true });
    }
  }

  function previousIdentitySnapshot() {
    const snapshot = identity === null ? null : identity.snapshot();
    return {
      spec: snapshot === null ? null : snapshot.spec,
      specShape: snapshot === null ? 'unknown' : snapshot.specShape,
      version: snapshot === null ? null : snapshot.version,
      commit: snapshot === null ? null : snapshot.specCommit,
      enabled: null,
      loadedVersion: identity === null ? null : identity.loadedVersion,
      loadedCommit: identity === null ? null : identity.buildCommit,
      dataRoot: storage === null ? null : storage.root,
    };
  }

  function hostAtTarget(target) {
    if (identity === null) return false;
    return identity.loadedVersion === target.version && identity.buildCommit === target.commit;
  }

  function diskAtTarget(target) {
    if (identity === null) return false;
    const snapshot = identity.snapshot();
    return snapshot.version === target.version && snapshot.specCommit === target.commit;
  }

  function oldVersionStillRunning(op) {
    if (identity === null || op.previous.loadedVersion === null) return false;
    const snapshot = identity.snapshot();
    return (
      snapshot.loadedVersion === op.previous.loadedVersion &&
      (snapshot.loadedCommit ?? null) === (op.previous.loadedCommit ?? null)
    );
  }

  function finalise(op, observation, { release = true } = {}) {
    setObservation(op, observation);
    op.status = 'terminal';
    op.finishedAt = iso(now);
    clearCoordinationTimer();
    if (op.coordination !== null && observation !== null && observation.state === 'failed') {
      op.coordination.phase = 'failed';
      op.coordination.failed = { reason: observation.error?.message ?? 'failed' };
    }
    releaseAdmission(op);
    void persistBestEffort(op);
    if (release) void releaseHeldLock();
    return observation;
  }

  function finaliseFailed(op, message, code = GM.INSTALL_FAILED) {
    return finalise(op, {
      operationId: op.operationId,
      state: 'failed',
      error: { code, message },
      oldVersionStillRunning: oldVersionStillRunning(op),
    });
  }

  function alreadyAtTarget(op, reason) {
    return finalise(op, {
      operationId: op.operationId,
      state: 'already-at-target',
      reason,
    });
  }

  function verificationFailed(op, reason, { installedVersion = null, runningVersion = null } = {}) {
    return finalise(op, {
      operationId: op.operationId,
      state: 'verification-failed',
      reason,
      installedVersion,
      runningVersion,
    });
  }

  function pendingRestart(op, installedVersion) {
    setObservation(op, {
      operationId: op.operationId,
      state: 'pending-restart',
      restartReason: 'no-hmr',
      installedVersion,
    });
    op.status = 'pending-restart';
    // The package change already completed (restart required); new launches are
    // safe against the installed bundle even though the old code still runs.
    releaseAdmission(op);
    void persistBestEffort(op);
    return op.observation;
  }

  function cancelled(op, cancelledBy) {
    return finalise(op, {
      operationId: op.operationId,
      state: 'cancelled',
      cancelledBy,
    });
  }

  function newOperation(target, { status, previous }) {
    const stamp = iso(now);
    return {
      operationId: `upd_${randomHex(8)}`,
      requestId: `upd_${randomHex(8)}`,
      createdAt: stamp,
      updatedAt: stamp,
      status,
      target,
      previous,
      coordination: null,
      cancelled: false,
      cancelRequested: false,
      observation: null,
      hostEpochStarted: hostEpoch,
      finishedAt: null,
    };
  }

  function startPipeline(op, { waitCoordination = false } = {}) {
    if (pipeline !== null) return pipeline;
    pipeline = (async () => {
      try {
        if (waitCoordination) {
          try {
            await waitForCoordination(op);
          } catch (_error) {
            // Coordination failed/timed out and finalised the operation.
            return;
          }
        }
        if (stopped || operation !== op || op.status === 'terminal') return;
        // Host-authoritative barrier + dynamic inclusion (audit M3-AUD-03):
        // re-enumerate immediately before the package change; never persist or
        // install while unconfirmed instances exist, and re-check once more
        // after the critical record write, immediately before installBundle.
        for (;;) {
          if (stopped || operation !== op || op.status === 'terminal') return;
          const unconfirmed = unconfirmedInstances(op);
          if (unconfirmed.length > 0) {
            reopenCoordination(op, unconfirmed);
            await persistBestEffort(op);
            scheduleCoordinationTimeout(op);
            try {
              await waitForCoordination(op);
            } catch (_error) {
              return;
            }
            continue;
          }
          op.status = 'installing';
          setObservation(op, { operationId: op.operationId, state: 'installing', stage: 'install', progress: null });
          try {
            // CRITICAL pre-install gate (audit M3-AUD-01): without a durable
            // record there must be no package change.
            await persistCritical(op);
          } catch (_error) {
            // Fail closed: no installBundle. Release the barrier/lock BEFORE the
            // failure becomes observable, so a retry cannot race the lock.
            releaseAdmission(op);
            await releaseHeldLock();
            finalise(op, {
              operationId: op.operationId,
              state: 'failed',
              error: {
                code: GM.STORE_IO,
                message: 'The update was not started because its recovery record could not be stored; retry',
              },
              oldVersionStillRunning: oldVersionStillRunning(op),
            });
            return;
          }
          if (stopped || operation !== op || op.status === 'terminal') return;
          // Deliberately no `await` between this final unconfirmed check and the
          // install call: the barrier blocks new entries, and entry.launch
          // re-checks admission after registering, so a launch that raced the
          // barrier cannot leave an unconfirmed live instance.
          if (unconfirmedInstances(op).length === 0) break;
          op.status = 'coordinating';
        }
        let result;
        try {
          result = await adapter.install(op.target, { requestId: op.requestId });
        } catch (error) {
          finaliseFailed(op, sanitisedDiagnostic(error?.message) || 'Plugin update could not start');
          return;
        }
        if (stopped || operation !== op) return;
        await handleInstallResult(op, result);
      } catch (error) {
        if (operation === op && op.status !== 'terminal') {
          finaliseFailed(op, sanitisedDiagnostic(error?.message) || 'Plugin update failed');
        }
      } finally {
        pipeline = null;
      }
    })();
    return pipeline;
  }

  function waitForCoordination(op) {
    if (op.coordination === null || op.coordination.phase === 'satisfied') return Promise.resolve();
    return new Promise((resolve, reject) => {
      op.coordination.resolve = resolve;
      op.coordination.reject = reject;
    });
  }

  function satisfyCoordination(op) {
    const coordinationState = op.coordination;
    if (coordinationState === null || coordinationState.phase === 'satisfied') return;
    coordinationState.phase = 'satisfied';
    coordinationState.pending = 0;
    clearCoordinationTimer();
    if (typeof coordinationState.resolve === 'function') coordinationState.resolve();
  }

  function failCoordination(op, reason, instanceIds) {
    const coordinationState = op.coordination;
    if (coordinationState === null || op.status === 'terminal') return;
    coordinationState.phase = 'failed';
    coordinationState.failed = { reason, instanceIds: instanceIds.slice(0, 16) };
    clearCoordinationTimer();
    const message =
      reason === 'timeout'
        ? 'Active game sessions did not confirm pause and save before the update deadline'
        : 'Active game sessions could not pause and save; the update was not started';
    finalise(op, {
      operationId: op.operationId,
      state: 'failed',
      error: { code: GM.UPDATE_GAME_RUNNING, message },
      oldVersionStillRunning: true,
    });
    if (typeof coordinationState.reject === 'function') coordinationState.reject(new Error(message));
  }

  function evaluateCoordination(op) {
    const coordinationState = op.coordination;
    if (coordinationState === null || op.status !== 'coordinating') return;
    const active = activeRuntimeInstances();
    const confirmed = new Set();
    const failed = [];
    for (const ack of coordinationState.acks.values()) {
      for (const entry of ack.instances.values()) {
        if (entry.saved !== true || entry.paused !== true || entry.saveStale === true || entry.error !== undefined) {
          failed.push(entry.instanceId);
        } else {
          confirmed.add(entry.instanceId);
        }
      }
    }
    if (failed.length > 0) {
      failCoordination(op, 'save-failed', failed);
      return;
    }
    const pending = active.filter((instance) => !confirmed.has(instance.instanceId));
    coordinationState.pending = pending.length;
    if (pending.length === 0) satisfyCoordination(op);
  }

  function scheduleCoordinationTimeout(op) {
    clearCoordinationTimer();
    const deadline = Date.parse(op.coordination.deadlineAt);
    const delay = Math.max(0, deadline - now().getTime());
    coordinationTimer = setTimeout(() => {
      coordinationTimer = null;
      if (op.status === 'coordinating') failCoordination(op, 'timeout', []);
    }, delay);
    if (typeof coordinationTimer.unref === 'function') coordinationTimer.unref();
  }

  let beginChain = Promise.resolve();

  /**
   * Serialize `begin` entry: concurrent clicks / multi-window calls must all
   * observe the operation created by the first caller, never race the lock.
   */
  function begin(rawBody) {
    const run = beginChain.then(() => beginInternal(rawBody));
    beginChain = run.catch(() => undefined);
    return run;
  }

  async function beginInternal(rawBody) {
    if (!isPlainObject(rawBody)) throw hostError(GM.INVALID_PARAM, 'Request body must be a JSON object');
    const targetId = boundedString(rawBody.targetId, { maxLength: 64, name: 'targetId' });
    if (typeof discovery.whenReady === 'function') await discovery.whenReady();
    const target = discovery.resolveTarget(targetId);
    if (target === null) {
      throw hostError(GM.UPDATE_TARGET_INVALID, 'Update target is not the current validated discovery record', {
        retryable: false,
      });
    }
    if (adapter.available() !== true) {
      throw hostError(GM.UPDATE_ADAPTER_UNAVAILABLE, 'Plugin update capability is unavailable', { retryable: true });
    }
    // Repeated clicks / multi-window: same target while active returns the same
    // operation; a different target is a documented busy conflict (GM-4091).
    if (operation !== null && operation.status !== 'terminal') {
      if (operation.target.commit === target.commit && operation.target.version === target.version) {
        return { operationId: operation.operationId };
      }
      throw hostError(GM.INSTALL_IN_PROGRESS, 'Another platform plugin update is in progress', { retryable: true });
    }

    const adapterInfo = await adapter.describe();
    if (adapterInfo.available !== true) {
      throw hostError(GM.UPDATE_ADAPTER_UNAVAILABLE, 'Plugin update capability is unavailable', { retryable: true });
    }
    if (adapterInfo.devRowShadow === true) {
      throw hostError(GM.UPDATE_TARGET_INVALID, 'Development installs must switch the install source in the plugin manager', {
        retryable: false,
        details: { reason: 'dev-source' },
      });
    }
    if (adapterInfo.hmr === 'unknown') {
      throw hostError(GM.UPDATE_ADAPTER_UNAVAILABLE, 'Update capability could not be confirmed yet', {
        retryable: true,
        details: { reasonKey: PLATFORM_UPDATE_REASON_KEYS.HMR_UNKNOWN },
      });
    }
    const snapshot = identity === null ? null : identity.snapshot();
    const anomaly = detectUpdateTargetAnomaly({
      target,
      previousTarget: discovery.previousTarget(),
      installedVersion: snapshot === null ? null : snapshot.version,
      installedCommit: snapshot === null ? null : snapshot.specCommit,
    });
    if (anomaly !== null) {
      throw hostError(GM.UPDATE_TARGET_INVALID, 'Published version is pinned to a different commit; update blocked', {
        retryable: false,
        details: { reason: 'version-commit-anomaly' },
      });
    }

    // Idempotency pre-checks by version+commit (never by spec string §9.3).
    if (hostAtTarget(target)) {
      operation = newOperation(target, { status: 'terminal', previous: previousIdentitySnapshot() });
      alreadyAtTarget(operation, 'same-commit');

      return { operationId: operation.operationId };
    }
    if (diskAtTarget(target)) {
      operation = newOperation(target, { status: 'pending-restart', previous: previousIdentitySnapshot() });
      if (adapterInfo.hmr === 'absent') {
        pendingRestart(operation, target.version);
      } else {
        finalise(operation, {
          operationId: operation.operationId,
          state: 'verification-failed',
          reason: 'version-mismatch',
          installedVersion: target.version,
          runningVersion: identity === null ? null : identity.loadedVersion,
        });
      }
      return { operationId: operation.operationId };
    }

    // A failed game save can latch HostStorage read-only even after the user
    // repairs the filesystem. Explicit retry must re-probe it BEFORE collecting
    // fresh save acknowledgements; only real subsequent writes can confirm saves.
    if (typeof storage?.checkStatus === 'function') {
      const status = await storage.checkStatus();
      if (status.ok !== true) throw hostError(GM.STORE_IO, 'Storage is not writable; repair it and retry the update', { retryable: true });
    }
    await acquireLock();
    let op = null;
    try {
      const previous = previousIdentitySnapshot();
      previous.enabled = adapterInfo.enabled === undefined ? null : adapterInfo.enabled;
      const active = activeRuntimeInstances();
      op = newOperation(target, {
        status: active.length === 0 ? 'installing' : 'coordinating',
        previous,
      });
      // Host-authoritative barrier: block new game launches from the moment the
      // operation exists until the package change completes/terminates.
      blockAdmission(op);
      if (active.length > 0) {
        const startedAt = iso(now);
        op.coordination = {
          phase: 'waiting',
          pending: active.length,
          acks: new Map(),
          startedAt,
          deadlineAt: new Date(now().getTime() + limits.coordinateTimeoutMs).toISOString(),
          registry: active.map((instance) => ({ instanceId: instance.instanceId, gameId: instance.gameId })),
          failed: undefined,
          resolve: null,
          reject: null,
        };
        setObservation(op, {
          operationId: op.operationId,
          state: 'inspecting',
          progress: null,
          coordination: {
            phase: 'waiting',
            pending: active.length,
          },
        });
      } else {
        setObservation(op, { operationId: op.operationId, state: 'installing', stage: 'install', progress: null });
      }
      // CRITICAL pre-write (audit M3-AUD-01): the recovery record must exist
      // BEFORE any package change; on failure fail closed with no operation.
      await persistCritical(op);
    } catch (error) {
      // Never leave a half-started operation/barrier/lock behind. `operation`
      // is only assigned after the critical write, so a later begin can retry
      // (the previous retained terminal operation, if any, stays observable).
      releaseAdmission(op);
      clearCoordinationTimer();
      await releaseHeldLock();
      if (error !== null && typeof error === 'object' && error.code === GM.STORE_IO) throw error;
      throw hostError(GM.STORE_IO, 'Could not record the update before installation', {
        retryable: true,
        cause: error,
      });
    }
    operation = op;
    if (op.coordination !== null) {
      scheduleCoordinationTimeout(op);
      void startPipeline(op, { waitCoordination: true });
    } else {
      void startPipeline(op);
    }
    return { operationId: op.operationId };
  }

  async function coordinate(rawBody) {
    if (!isPlainObject(rawBody)) throw hostError(GM.INVALID_PARAM, 'Request body must be a JSON object');
    const windowId = boundedString(rawBody.windowId, { maxLength: 128, name: 'windowId' });
    const idle = rawBody.idle === true;
    const instances = rawBody.instances === undefined ? [] : rawBody.instances;
    if (!Array.isArray(instances) || instances.length > 64) {
      throw hostError(GM.INVALID_PARAM, 'Invalid instances');
    }
    if (idle && instances.length > 0) {
      throw hostError(GM.INVALID_PARAM, 'An idle window must not report active instances');
    }
    const op = operation;
    if (op === null || op.status !== 'coordinating' || op.coordination === null) {
      return { accepted: false, phase: 'idle', pending: { windows: 0, instances: 0 } };
    }
    const known = new Map(activeRuntimeInstances().map((instance) => [instance.instanceId, instance]));
    const ackEntries = new Map();
    for (const raw of instances) {
      if (!isPlainObject(raw)) throw hostError(GM.INVALID_PARAM, 'Invalid instance entry');
      const instanceId = boundedString(raw.instanceId, { maxLength: 64, name: 'instanceId' });
      if (!/^[a-f0-9]{32}$/.test(instanceId)) throw hostError(GM.INVALID_PARAM, 'Invalid instanceId');
      const gameId = boundedString(raw.gameId, { maxLength: 48, name: 'gameId' });
      const knownInstance = known.get(instanceId);
      if (knownInstance === undefined) {
        throw hostError(GM.INVALID_PARAM, 'Unknown runtime instance', { details: { reason: 'unknown-instance' } });
      }
      if (knownInstance.gameId !== gameId) {
        throw hostError(GM.INVALID_PARAM, 'Runtime instance does not belong to that game');
      }
      const error =
        isPlainObject(raw.error) === false
          ? undefined
          : {
              ...(optionalString(raw.error.code, { maxLength: 64 }) === null
                ? {}
                : { code: optionalString(raw.error.code, { maxLength: 64 }) }),
              ...(optionalString(raw.error.message, { maxLength: 160 }) === null
                ? {}
                : { message: optionalString(raw.error.message, { maxLength: 160 }) }),
            };
      ackEntries.set(instanceId, {
        instanceId,
        gameId,
        paused: raw.paused === true,
        saved: raw.saved === true,
        saveStale: raw.saveStale === true,
        playSessionId: optionalString(raw.playSessionId, { maxLength: 64 }),
        saveRevision: Number.isInteger(raw.saveRevision) ? raw.saveRevision : null,
        ...(error === undefined ? {} : { error }),
      });
    }
    op.coordination.acks.set(windowId, {
      windowId,
      idle,
      instances: ackEntries,
      receivedAt: iso(now),
    });
    evaluateCoordination(op);
    if (op.status === 'terminal') {
      return {
        accepted: true,
        phase: 'failed',
        pending: { windows: op.coordination.acks.size, instances: 0 },
        ...(op.coordination.failed === undefined ? {} : { failed: op.coordination.failed }),
      };
    }
    return {
      accepted: true,
      phase: op.coordination.phase,
      pending: {
        windows: op.coordination.acks.size,
        instances: op.coordination.pending ?? 0,
      },
    };
  }

  async function handleInstallResult(op, result) {
    // The native install settled: the package change window is over, so new
    // game launches may proceed again (any later activation verification does
    // not replace the running bundle a second time).
    releaseAdmission(op);
    const application = isPlainObject(result) ? result.application : undefined;
    logInstallOutcome(op, application, result);
    if (application === 'applied') {
      await handleApplied(op, result);
      return;
    }
    if (application === 'restart-required') {
      if (result.restartReason !== 'no-hmr') {
        finaliseFailed(
          op,
          `The updated bundle needs a restart before it can load (${sanitisedDiagnostic(result.restartReason) || 'unknown reason'})`
        );
        return;
      }
      pendingRestart(op, typeof result.version === 'string' ? result.version : op.target.version);
      return;
    }
    if (application === 'cancelled') {
      cancelled(op, op.cancelRequested === true ? 'user' : 'host');
      return;
    }
    if (application === 'failed') {
      await handleInstallFailure(op, result);
      return;
    }
    // Unknown/absent application: never guess success; verify actual state.
    await handleAmbiguous(op, result);
  }

  function logInstallOutcome(op, application, result) {
    const nativeCode = isPlainObject(result) && isPlainObject(result.error) ? result.error.code : null;
    logger?.info?.(
      LOG,
      'platform-update-install-result',
      `operation=${op.operationId}`,
      `application=${typeof application === 'string' ? application : 'missing'}`,
      `code=${typeof nativeCode === 'string' ? nativeCode : 'none'}`
    );
  }

  async function handleApplied(op, result) {
    const installedVersion = typeof result.version === 'string' ? result.version : op.target.version;
    setObservation(op, {
      operationId: op.operationId,
      state: 'applied',
      changed: result.changed === true,
      bundle: BUNDLE_ID,
      version: installedVersion,
    });
    op.status = 'applied';
    op.installedVersion = installedVersion;
    await persistBestEffort(op);
    if (stopped || operation !== op) return;
    if (installedVersion !== op.target.version) {
      verificationFailed(op, 'version-mismatch', {
        installedVersion,
        runningVersion: identity === null ? null : identity.loadedVersion,
      });
      return;
    }
    await verifyActivation(op);
  }

  async function handleInstallFailure(op, result) {
    const nativeCode = isPlainObject(result) && isPlainObject(result.error) ? result.error.code : null;
    if (nativeCode === 'already-installed' || nativeCode === 'ambiguous-install') {
      await resolveInstalledReference(op, nativeCode);
      return;
    }
    if (nativeCode === 'incompatible-version') {
      finalise(
        op,
        {
          operationId: op.operationId,
          state: 'failed',
          error: { code: GM.RUNTIME_INCOMPATIBLE, message: 'The updated bundle is not compatible with this DSH version' },
          oldVersionStillRunning: oldVersionStillRunning(op),
        },
        {}
      );
      return;
    }
    finaliseFailed(op, 'The native plugin manager rejected the update', nativeFailureCode(nativeCode));
  }

  async function resolveInstalledReference(op, nativeCode) {
    // `already-installed` / `ambiguous-install` are only mapped after verifying
    // the actual installed version+commit (§9.3 rule 5, §9.5.1 rule 4).
    if (hostAtTarget(op.target)) {
      alreadyAtTarget(op, nativeCode === 'already-installed' ? 'already-installed' : 'same-commit');
      return;
    }
    if (diskAtTarget(op.target)) {
      const adapterInfo = await adapter.describe().catch(() => null);
      if (adapterInfo !== null && adapterInfo.available === true && adapterInfo.hmr === 'absent') {
        pendingRestart(op, op.target.version);
      } else {
        verificationFailed(op, 'version-mismatch', {
          installedVersion: op.target.version,
          runningVersion: identity === null ? null : identity.loadedVersion,
        });
      }
      return;
    }
    verificationFailed(op, nativeCode === 'ambiguous-install' ? 'ambiguous-install' : 'version-mismatch', {
      installedVersion: identity === null ? null : identity.snapshot().version,
      runningVersion: identity === null ? null : identity.loadedVersion,
    });
  }

  async function handleAmbiguous(op, result) {
    const waitMs = limits.recoveryProbeMs;
    const deadline = now().getTime() + waitMs;
    for (;;) {
      if (hostAtTarget(op.target)) {
        alreadyAtTarget(op, 'same-commit');
        return;
      }
      if (diskAtTarget(op.target)) {
        const adapterInfo = await adapter.describe().catch(() => null);
        if (adapterInfo !== null && adapterInfo.available === true && adapterInfo.hmr === 'absent') {
          pendingRestart(op, op.target.version);
        } else {
          verificationFailed(op, 'version-mismatch', {
            installedVersion: op.target.version,
            runningVersion: identity === null ? null : identity.loadedVersion,
          });
        }
        return;
      }
      if (now().getTime() >= deadline) break;
      await sleep(limits.recoveryPollMs);
    }
    const nativeResult = isPlainObject(result) ? result : null;
    verificationFailed(op, 'response-lost', {
      installedVersion: nativeResult !== null && typeof nativeResult.version === 'string' ? nativeResult.version : null,
      runningVersion: identity === null ? null : identity.loadedVersion,
    });
  }

  function hostIdentityMatchesTarget(op) {
    return hostAtTarget(op.target);
  }

  async function verifyActivation(op) {
    const hostDeadline = now().getTime() + limits.activationHostWaitMs;
    while (now().getTime() < hostDeadline) {
      if (stopped || operation !== op || op.status === 'terminal') return;
      if (hostIdentityMatchesTarget(op)) break;
      await sleep(pollDelay(limits));
    }
    if (stopped || operation !== op || op.status === 'terminal') return;
    if (!hostIdentityMatchesTarget(op)) {
      if (diskAtTarget(op.target)) {
        finalise(op, {
          operationId: op.operationId,
          state: 'stale-runtime',
          reason: 'host-old',
          runningVersion: identity === null ? null : identity.loadedVersion,
        });
      } else {
        verificationFailed(op, 'version-mismatch', {
          installedVersion: op.installedVersion ?? null,
          runningVersion: identity === null ? null : identity.loadedVersion,
        });
      }
      return;
    }
    op.status = 'activating';
    op.hostMatchedAt = iso(now);
    setObservation(op, {
      operationId: op.operationId,
      state: 'activating',
      installedVersion: op.installedVersion ?? op.target.version,
      awaiting: 'reload',
    });
    await persistBestEffort(op);
    await waitForClientVerification(op);
  }

  function expectedClientIdentity() {
    if (identity === null || identity.expectedClient === undefined || identity.expectedClient === null) {
      return { buildVersion: null, buildCommit: null };
    }
    return identity.expectedClient;
  }

  function liveClientReports() {
    const stamp = now().getTime();
    const live = [];
    for (const [key, report] of clientReports) {
      if (stamp - report.receivedAtMs <= limits.clientReportTtlMs) live.push({ key, report });
      else clientReports.delete(key);
    }
    return live;
  }

  function clientMatches(report, expected) {
    return (
      report.buildVersion === expected.buildVersion &&
      (report.buildCommit ?? null) === (expected.buildCommit ?? null)
    );
  }

  /**
   * Wait for the Client's self-reported build identity.
   *
   * Normal in-place activation uses the frozen 60s window. Recovery after a real
   * Host restart uses a much longer window bounded by the 30-minute persisted
   * record rule: the page reload is user/probe driven and must not be preempted
   * with `response-lost` before the Client has loaded (the V1 non-HMR restart run
   * showed the page reloading after the 60s window had already expired).
   */
  async function waitForClientVerification(op, { recovery = false, recordDeadline = null } = {}) {
    const windowMs = recovery === true ? limits.recoveryClientWaitMs : limits.activationClientWaitMs;
    let deadline = now().getTime() + windowMs;
    if (Number.isFinite(recordDeadline)) deadline = Math.min(deadline, recordDeadline);
    let sawMismatch = false;
    for (;;) {
      if (stopped || operation !== op || op.status === 'terminal') return;
      const health = await checkHealth();
      if (health !== true) {
        setObservation(op, {
          operationId: op.operationId,
          state: 'activating',
          installedVersion: op.installedVersion ?? op.target.version,
          awaiting: 'health',
        });
      } else {
        const expected = expectedClientIdentity();
        const reports = liveClientReports().map((entry) => entry.report);
        const mismatched = reports.filter((report) => !clientMatches(report, expected));
        if (mismatched.length > 0) {
          sawMismatch = true;
          setObservation(op, {
            operationId: op.operationId,
            state: 'stale-runtime',
            reason: 'client-old',
            runningVersion: mismatched[0].buildVersion,
          });
          void persistBestEffort(op);
        } else if (reports.some((report) => clientMatches(report, expected))) {
          finalise(op, {
            operationId: op.operationId,
            state: 'updated',
            version: op.target.version,
            host: `${identity === null ? '' : identity.loadedVersion}+${identity === null ? '' : identity.buildCommit}`,
            client: `${expected.buildVersion}+${expected.buildCommit}`,
          });
          logger?.info?.(LOG, 'platform-update-verified', `operation=${op.operationId}`, `version=${op.target.version}`);
          return;
        } else {
          setObservation(op, {
            operationId: op.operationId,
            state: 'activating',
            installedVersion: op.installedVersion ?? op.target.version,
            awaiting: 'reload',
          });
        }
      }
      if (sawMismatch !== true && now().getTime() >= deadline) {
        verificationFailed(op, 'response-lost', {
          installedVersion: op.installedVersion ?? null,
          runningVersion: identity === null ? null : identity.loadedVersion,
        });
        return;
      }
      await sleep(pollDelay(limits));
    }
  }

  async function checkHealth() {
    if (healthCheck === null) return true;
    try {
      const snapshot = await healthCheck();
      return snapshot !== null && typeof snapshot === 'object' && snapshot.ok === true;
    } catch (_error) {
      return false;
    }
  }

  function clientReport(rawBody) {
    if (!isPlainObject(rawBody)) throw hostError(GM.INVALID_PARAM, 'Request body must be a JSON object');
    const clientId = boundedString(rawBody.clientId, { name: 'clientId' });
    const windowId = boundedString(rawBody.windowId, { name: 'windowId' });
    const buildVersion = boundedString(rawBody.buildVersion, { maxLength: 64, name: 'buildVersion' });
    if (parseExactSemver(buildVersion) === null) throw hostError(GM.INVALID_PARAM, 'Invalid buildVersion');
    let buildCommit = null;
    if (rawBody.buildCommit !== undefined && rawBody.buildCommit !== null) {
      if (!isPinnedCommit(rawBody.buildCommit)) throw hostError(GM.INVALID_PARAM, 'Invalid buildCommit');
      buildCommit = rawBody.buildCommit;
    }
    const pageToken =
      rawBody.pageToken === undefined || rawBody.pageToken === null
        ? null
        : boundedString(rawBody.pageToken, { maxLength: 128, name: 'pageToken' });
    const startedAt = optionalIsoString(rawBody.startedAt, 'startedAt');
    const received = now();
    const report = {
      clientId,
      windowId,
      buildVersion,
      buildCommit,
      pageToken,
      startedAt,
      receivedAt: received.toISOString(),
      receivedAtMs: received.getTime(),
    };
    clientReports.set(windowId, report);
    const active = operation !== null && operation.status !== 'terminal';
    // `expected` is the identity this running Host release requires from the
    // browser bundle; it is reported even while idle so the Client can compare
    // its own embedded identity without inventing one.
    const expected = expectedClientIdentity();
    return {
      accepted: true,
      state: active ? 'updating' : 'idle',
      expected,
    };
  }

  function observe(operationId) {
    if (typeof operationId !== 'string' || !isUpdateOperationId(operationId)) {
      throw hostError(GM.INVALID_PARAM, 'Invalid operationId');
    }
    if (operation !== null && operation.operationId === operationId) {
      return observationOf(operation);
    }
    throw hostError(GM.INVALID_PARAM, 'Unknown update operation');
  }

  async function cancel(rawBody) {
    if (!isPlainObject(rawBody)) throw hostError(GM.INVALID_PARAM, 'Request body must be a JSON object');
    const operationId = boundedString(rawBody.operationId, { maxLength: 64, name: 'operationId' });
    if (!isUpdateOperationId(operationId)) throw hostError(GM.INVALID_PARAM, 'Invalid operationId');
    const op = operation;
    if (op === null || op.operationId !== operationId || op.status === 'terminal') {
      return { status: 'not-running', observation: op !== null && op.operationId === operationId ? op.observation : null };
    }
    if (op.status === 'coordinating') {
      op.cancelled = true;
      op.cancelRequested = true;
      clearCoordinationTimer();
      if (op.coordination !== null && typeof op.coordination.reject === 'function') {
        op.coordination.reject(new Error('Cancelled by user'));
      }
      return { status: 'cancelled', observation: cancelled(op, 'user') };
    }
    if (op.status === 'installing' || op.status === 'applied') {
      op.cancelRequested = true;
      const result = await adapter.cancelInstall(op.requestId);
      const status = result !== null && typeof result === 'object' ? result.status : 'not-running';
      if (status === 'cancelled') {
        return { status: 'cancelled', observation: cancelled(op, 'user') };
      }
      if (status === 'too-late') {
        // The native install is still applying the package change, so the
        // admission barrier stays held until handleInstallResult releases it.
        setObservation(op, { operationId: op.operationId, state: 'too-late', note: 'install-continues' });
        void persistBestEffort(op);
        return { status: 'too-late', observation: op.observation };
      }
      return { status: 'not-running', observation: observationOf(op) };
    }
    return { status: 'not-running', observation: observationOf(op) };
  }

  function parseRecord(value) {
    if (!isPlainObject(value) || value.schemaVersion !== RECORD_SCHEMA_VERSION) return null;
    if (typeof value.operationId !== 'string' || !isUpdateOperationId(value.operationId)) return null;
    if (typeof value.requestId !== 'string' || value.requestId.length === 0 || value.requestId.length > 64) return null;
    const target = isPlainObject(value.target) ? value.target : null;
    if (target === null) return null;
    if (typeof target.version !== 'string' || parseExactSemver(target.version) === null) return null;
    if (!isPinnedCommit(target.commit) || typeof target.spec !== 'string') return null;
    const status = typeof value.status === 'string' ? value.status : '';
    if (!['coordinating', 'installing', 'applied', 'activating', 'pending-restart', 'terminal'].includes(status)) return null;
    return {
      schemaVersion: RECORD_SCHEMA_VERSION,
      operationId: value.operationId,
      requestId: value.requestId,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : iso(now),
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : iso(now),
      status,
      target: {
        id: typeof target.id === 'string' ? target.id : null,
        version: target.version,
        commit: target.commit,
        channel: target.channel === 'test' ? 'test' : 'stable',
        publishedAt: typeof target.publishedAt === 'string' ? target.publishedAt : null,
        spec: target.spec,
      },
      previous: isPlainObject(value.previous) ? value.previous : previousIdentitySnapshot(),
      cancelled: value.cancelled === true,
      observation: isPlainObject(value.observation) ? value.observation : null,
      hostEpochStarted: typeof value.hostEpochStarted === 'string' ? value.hostEpochStarted : null,
    };
  }

  /** Absolute deadline from the persisted record's 30-minute freshness rule. */
  function recoveryRecordDeadline(record) {
    const updatedAt = record !== null && typeof record.updatedAt === 'string' ? Date.parse(record.updatedAt) : NaN;
    return Number.isFinite(updatedAt) ? updatedAt + MAX_RECORD_AGE_MS : null;
  }

  /**
   * Enter the activation wait from a recovered record. The running identity is
   * already verified to match the target; only the Client identity is pending.
   */
  async function enterRecoveryActivation(op, record) {
    op.status = 'activating';
    op.installedVersion = op.target.version;
    setObservation(op, {
      operationId: op.operationId,
      state: 'activating',
      installedVersion: op.target.version,
      awaiting: 'reload',
    });
    releaseAdmission(op);
    await persistBestEffort(op);
    await waitForClientVerification(op, { recovery: true, recordDeadline: recoveryRecordDeadline(record) });
  }

  async function recoverFromRecord(record) {
    const op = {
      operationId: record.operationId,
      requestId: record.requestId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      status: record.status,
      target: record.target,
      previous: record.previous,
      coordination: null,
      cancelled: record.cancelled === true,
      cancelRequested: false,
      observation: record.observation,
      hostEpochStarted: record.hostEpochStarted,
      installedVersion:
        record.observation !== null && typeof record.observation.installedVersion === 'string'
          ? record.observation.installedVersion
          : null,
      recoveredAt: iso(now),
    };
    operation = op;
    // A recovered `installing` record may still have the native manager applying
    // the package change; keep new launches out until it settles or terminates.
    if (record.status === 'installing') blockAdmission(op);
    if (record.status === 'terminal') {
      logger?.info?.(LOG, 'platform-update-recovered-terminal', `operation=${op.operationId}`, `state=${op.observation?.state ?? 'none'}`);
      return;
    }
    const age = now().getTime() - Date.parse(record.updatedAt);
    if (!Number.isFinite(age) || age > MAX_RECORD_AGE_MS) {
      finalise(op, {
        operationId: op.operationId,
        state: 'verification-failed',
        reason: 'response-lost',
        installedVersion: op.installedVersion,
        runningVersion: identity === null ? null : identity.loadedVersion,
      });
      return;
    }
    if (record.status === 'coordinating') {
      // No package change happened before coordination completed: safe to abort.
      finaliseFailed(op, 'Update was interrupted before installation; retry the update', GM.INTERNAL);
      return;
    }
    try {
      await acquireLock();
    } catch (error) {
      logger?.warn?.(LOG, 'platform-update-recovery-lock-busy', `code=${error?.code || 'E_UNKNOWN'}`);
    }
    if (record.status === 'pending-restart') {
      if (hostAtTarget(op.target)) {
        await enterRecoveryActivation(op, record);
      } else {
        setObservation(op, record.observation ?? {
          operationId: op.operationId,
          state: 'pending-restart',
          restartReason: 'no-hmr',
          installedVersion: op.installedVersion ?? op.target.version,
        });
        // pending-restart needs no package change; do not hold admission.
        releaseAdmission(op);
        await persistBestEffort(op);
      }
      return;
    }
    if (hostAtTarget(op.target)) {
      await enterRecoveryActivation(op, record);
      return;
    }
    // Host still runs the old code. Ask the native manager (it survives the
    // updated bundle's disposal) for the in-flight result; `null` is NOT success.
    const pending = await adapter.waitForInstall(op.requestId);
    if (pending !== null) {
      await handleInstallResult(op, pending);
      return;
    }
    const deadline = now().getTime() + limits.recoveryProbeMs;
    for (;;) {
      if (hostAtTarget(op.target)) {
        await enterRecoveryActivation(op, record);
        return;
      }
      if (diskAtTarget(op.target)) {
        const adapterInfo = await adapter.describe().catch(() => null);
        if (adapterInfo !== null && adapterInfo.available === true && adapterInfo.hmr === 'absent') {
          pendingRestart(op, op.target.version);
          return;
        }
      }
      if (now().getTime() >= deadline) break;
      await sleep(limits.recoveryPollMs);
    }
    verificationFailed(op, 'response-lost', {
      installedVersion: identity === null ? null : identity.snapshot().version,
      runningVersion: identity === null ? null : identity.loadedVersion,
    });
  }

  async function start() {
    if (storage === null) return;
    let stored = null;
    try {
      stored = await storage.readJson(storage.filePath(PLATFORM_UPDATE_OPERATION_FILE), {
        schemaVersion: RECORD_SCHEMA_VERSION,
      });
    } catch (error) {
      logger?.warn?.(LOG, 'platform-update-record-unreadable', `code=${error?.code || 'E_UNKNOWN'}`);
    }
    const record = stored === null ? null : parseRecord(stored.value);
    if (record === null) return;
    // Recovery runs in the background: activation must never block on a native
    // install or a 30s identity wait.
    recovery = recoverFromRecord(record).catch((error) => {
      logger?.warn?.(LOG, 'platform-update-recovery-failed', `code=${error?.code || 'E_UNKNOWN'}`);
      releaseAdmission(null);
    });
  }

  async function ready() {
    if (recovery !== null) await recovery.catch(() => undefined);
  }

  async function stop() {
    stopped = true;
    releaseAdmission(null);
    clearCoordinationTimer();
    if (operation !== null && operation.coordination !== null && typeof operation.coordination.reject === 'function') {
      operation.coordination.reject(new Error('Host disposed'));
    }
    await releaseHeldLock();
  }

  function currentObservation() {
    return operation === null ? null : observationOf(operation);
  }

  return {
    start,
    ready,
    stop,
    begin,
    observe,
    cancel,
    coordinate,
    clientReport,
    currentObservation,
    /** @internal test access to the live report store */
    clientReports: () => liveClientReports(),
    /** @internal test access for recovery tests */
    _operation: () => operation,
  };
}
