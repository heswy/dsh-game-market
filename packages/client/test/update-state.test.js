import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blockedReason,
  compareTarget,
  describeObservation,
  deriveUpdateView,
  normalizeClientIdentity,
  normalizeInspection,
  normalizeObservation,
  timestampMs,
} from '../src/update-state.js';
import { UPDATE_ACTIVE_STATES, UPDATE_TERMINAL_STATES } from '../src/constants.js';

const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const OPERATION_ID = 'upd_0123456789abcdef';

/** One `GET /platform-update` payload in the frozen m3-decisions §8 shape. */
function inspectionFixture(overrides) {
  const base = {
    schemaVersion: 1,
    host: { version: '1.2.0', commit: COMMIT_A, hostEpoch: 'epoch-1', loadedAt: '2026-10-20T10:00:00.000Z' },
    installed: {
      bundleId: 'dsh-game-market',
      spec: 'github:heswy/dsh-game-market#' + COMMIT_A,
      specShape: 'git-url',
      version: '1.2.0',
      enabled: true,
      loadedVersion: '1.2.0',
      loadedCommit: COMMIT_A,
      devRowShadow: false,
    },
    target: {
      id: 'tgt_1',
      version: '1.3.0',
      commit: COMMIT_B,
      channel: 'stable',
      publishedAt: '2026-10-19T00:00:00.000Z',
      spec: 'https://github.com/heswy/dsh-game-market.git#' + COMMIT_B,
    },
    discovery: {
      channel: 'stable',
      indexUrl: 'https://example.invalid/plugins.json',
      state: 'ready',
      fetchedAt: '2026-10-20T09:59:00.000Z',
      checkedAt: '2026-10-20T09:59:00.000Z',
      nextCheckAt: '2026-10-20T10:00:00.000Z',
      lastError: null,
      canRefresh: true,
      anomaly: null,
    },
    capability: { hmr: 'present', updatePath: 'in-place-hmr', canBeginUpdate: true, reasonKey: null },
    operation: null,
  };
  const source = overrides && typeof overrides === 'object' ? overrides : {};
  return {
    ...base,
    ...source,
    host: { ...base.host, ...(source.host || {}) },
    installed: { ...base.installed, ...(source.installed || {}) },
    discovery: { ...base.discovery, ...(source.discovery || {}) },
    capability: { ...base.capability, ...(source.capability || {}) },
    target: Object.prototype.hasOwnProperty.call(source, 'target') ? source.target : base.target,
    operation: Object.prototype.hasOwnProperty.call(source, 'operation') ? source.operation : base.operation,
  };
}

function observation(state, extra) {
  return { operationId: OPERATION_ID, state: state, ...(extra || {}) };
}

test('normalizeInspection accepts the frozen §8 shape and never invents fields', function () {
  const inspection = normalizeInspection(inspectionFixture());
  assert.equal(inspection.schemaVersion, 1);
  assert.equal(inspection.host.version, '1.2.0');
  assert.equal(inspection.host.commit, COMMIT_A);
  assert.equal(inspection.installed.specShape, 'git-url');
  assert.equal(inspection.installed.devRowShadow, false);
  assert.equal(inspection.target.id, 'tgt_1');
  assert.equal(inspection.target.commit, COMMIT_B);
  assert.equal(inspection.discovery.state, 'ready');
  assert.equal(inspection.capability.canBeginUpdate, true);
  assert.equal(inspection.operation, null);
});

test('normalizeInspection tolerates a never-checked Host (200 envelope, empty state)', function () {
  const inspection = normalizeInspection(
    inspectionFixture({
      target: null,
      discovery: { state: 'never', fetchedAt: null, checkedAt: null, nextCheckAt: null, lastError: null, canRefresh: true, anomaly: null },
      capability: { hmr: 'unknown', updatePath: 'unsupported', canBeginUpdate: false, reasonKey: 'update.reason.hmrUnknown' },
      operation: null,
    })
  );
  assert.equal(inspection.target, null);
  assert.equal(inspection.discovery.state, 'never');
  assert.equal(inspection.capability.canBeginUpdate, false);
  assert.equal(inspection.operation, null);
});

test('invalid inspection payloads normalize to null instead of guessing', function () {
  assert.equal(normalizeInspection(null), null);
  assert.equal(normalizeInspection('nope'), null);
  assert.equal(normalizeInspection([]), null);
});

test('observation normalization drops numeric progress and keeps only the union fields', function () {
  const observationValue = normalizeObservation({
    operationId: OPERATION_ID,
    state: 'installing',
    stage: 'install',
    progress: 42,
    percent: 42,
    attacker: 'ignored',
  });
  assert.equal(observationValue.progress, null);
  assert.equal(observationValue.percent, undefined);
  assert.equal(observationValue.attacker, undefined);
  assert.equal(observationValue.state, 'installing');
});

test('unknown observation states are rejected (UI only renders contract states)', function () {
  assert.equal(normalizeObservation({ operationId: OPERATION_ID, state: 'downloading' }), null);
  assert.equal(normalizeObservation({ state: 'updated' }), null);
  assert.equal(normalizeObservation({ operationId: OPERATION_ID, state: 'applied' }).state, 'applied');
});

test('active/terminal state lists match the contract state machine', function () {
  assert.deepEqual(UPDATE_ACTIVE_STATES, ['inspecting', 'installing', 'applied', 'activating']);
  assert.ok(UPDATE_TERMINAL_STATES.indexOf('updated') !== -1);
  for (const state of UPDATE_ACTIVE_STATES) {
    const described = describeObservation(observation(state, { version: '1.3.0' }));
    assert.equal(described.active, true, state);
    assert.equal(described.success, false, state);
  }
});

test('applied and installing and activating are never rendered as success', function () {
  for (const state of ['inspecting', 'installing', 'applied', 'activating']) {
    const described = describeObservation(observation(state, { version: '1.3.0', awaiting: 'health' }));
    assert.equal(described.success, false, 'state ' + state + ' must not be success');
    assert.equal(described.terminal, false);
  }
  const applied = describeObservation(observation('applied', { changed: true, bundle: 'dsh-game-market', version: '1.3.0' }));
  assert.equal(applied.titleKey, 'update.state.applied.title');
  assert.equal(applied.showProgress, true);
  assert.equal(applied.progressIndex, 2);
  assert.equal(applied.action, null);
});

test('only updated is the success terminal state', function () {
  const updated = describeObservation(
    observation('updated', { version: '1.3.0', host: '1.3.0+' + COMMIT_B, client: '1.3.0+' + COMMIT_A })
  );
  assert.equal(updated.success, true);
  assert.equal(updated.terminal, true);
  for (const [state, extra] of [
    ['pending-restart', { restartReason: 'no-hmr', installedVersion: '1.3.0' }],
    ['already-at-target', { reason: 'already-installed' }],
    ['verification-failed', { reason: 'response-lost', installedVersion: '1.3.0', runningVersion: '1.2.0' }],
    ['stale-runtime', { reason: 'client-old', runningVersion: '1.2.0' }],
    ['too-late', { note: 'install-continues' }],
    ['cancelled', { cancelledBy: 'host' }],
    ['failed', { error: { code: 'GM-5033', message: 'x' }, oldVersionStillRunning: true }],
  ]) {
    const described = describeObservation(observation(state, extra));
    assert.equal(described.success, false, state + ' must not be success');
  }
});

test('pending-restart says installed-but-effective-after-restart, not updated', function () {
  const described = describeObservation(observation('pending-restart', { restartReason: 'no-hmr', installedVersion: '1.3.0' }));
  assert.equal(described.titleKey, 'update.state.pendingRestart.title');
  assert.equal(described.detailKey, 'update.state.pendingRestart.body');
  assert.equal(described.detailParams.version, '1.3.0');
  assert.equal(described.success, false);
});

test('recovery actions are explicit per branch', function () {
  const failedOld = describeObservation(observation('failed', { error: { code: 'GM-5033' }, oldVersionStillRunning: true }));
  assert.equal(failedOld.action, 'retry');
  assert.equal(failedOld.showRecovery, true);
  assert.equal(failedOld.detailKey, 'update.state.failed.oldVersionRunning');
  assert.equal(failedOld.oldVersionStillRunning, true);
  assert.equal(failedOld.errorCode, 'GM-5033');

  const failedRecovery = describeObservation(observation('failed', { error: { code: 'GM-5033' }, oldVersionStillRunning: false }));
  assert.equal(failedRecovery.detailKey, 'update.state.failed.recoveryNeeded');

  const verification = describeObservation(observation('verification-failed', { reason: 'version-mismatch' }));
  assert.equal(verification.action, 'retry');
  assert.equal(verification.detailKey, 'update.state.verificationFailed.versionMismatch');

  const staleClient = describeObservation(observation('stale-runtime', { reason: 'client-old' }));
  assert.equal(staleClient.action, 'refresh-page');
  assert.equal(staleClient.detailKey, 'update.state.staleRuntime.clientOld');

  const staleDev = describeObservation(observation('stale-runtime', { reason: 'dev-row-shadows-package' }));
  assert.equal(staleDev.action, null);
  assert.equal(staleDev.showRecovery, true);
  assert.equal(staleDev.detailKey, 'update.state.staleRuntime.devRow');
});

test('too-late keeps observing and never claims cancellation', function () {
  const described = describeObservation(observation('too-late', { note: 'install-continues' }));
  assert.equal(described.success, false);
  assert.equal(described.titleKey, 'update.state.tooLate.title');
  assert.equal(described.action, null);
});

test('cancel is offered only while inspecting/installing', function () {
  assert.equal(describeObservation(observation('inspecting', { progress: null })).cancellable, true);
  assert.equal(describeObservation(observation('installing', { stage: 'install', progress: null })).cancellable, true);
  assert.equal(describeObservation(observation('applied', { changed: true, bundle: 'x', version: '1.3.0' })).cancellable, false);
  assert.equal(describeObservation(observation('activating', { installedVersion: '1.3.0', awaiting: 'health' })).cancellable, false);
});

test('coordination state surfaces pending and failed counts', function () {
  const waiting = describeObservation(observation('inspecting', { coordination: { phase: 'collecting', pending: 2, failed: false } }));
  assert.equal(waiting.coordinationPending, 2);
  assert.equal(waiting.detailKey, 'update.state.inspecting.coordination');
  const failed = describeObservation(observation('inspecting', { coordination: { phase: 'blocked', pending: 1, failed: true } }));
  assert.equal(failed.coordinationFailed, true);
  assert.equal(failed.detailKey, 'update.state.inspecting.coordinationFailed');
});

test('target comparison only claims up-to-date when version+commit match', function () {
  const available = compareTarget(normalizeInspection(inspectionFixture()));
  assert.equal(available.kind, 'available');
  assert.equal(available.currentVersion, '1.2.0');

  const same = compareTarget(
    normalizeInspection(
      inspectionFixture({
        target: { id: 'tgt_a', version: '1.2.0', commit: COMMIT_A, channel: 'stable', publishedAt: null, spec: null },
      })
    )
  );
  assert.equal(same.kind, 'up-to-date');

  const sameVersionDifferentCommit = compareTarget(
    normalizeInspection(
      inspectionFixture({
        target: { id: 'tgt_b', version: '1.2.0', commit: COMMIT_B, channel: 'stable', publishedAt: null, spec: null },
      })
    )
  );
  assert.equal(sameVersionDifferentCommit.kind, 'unknown');

  const noTarget = compareTarget(normalizeInspection(inspectionFixture({ target: null })));
  assert.equal(noTarget.kind, 'no-target');
});

test('blocked reasons follow the frozen capability reason enum (fail closed)', function () {
  assert.equal(blockedReason(normalizeInspection(inspectionFixture())), null);
  for (const [installed, capability, expected] of [
    [{ specShape: 'path', spec: '/tmp/dev' }, {}, 'dev-source'],
    [{ devRowShadow: true }, {}, 'dev-row'],
    [{}, { canBeginUpdate: false, hmr: 'unknown', reasonKey: 'update.reason.hmrUnknown' }, 'hmr-unknown'],
    [{}, { canBeginUpdate: false, reasonKey: 'update.reason.adapterUnavailable' }, 'adapter-unavailable'],
    [{}, { canBeginUpdate: false, reasonKey: 'update.reason.devSource' }, 'dev-source'],
    [{}, { canBeginUpdate: false, reasonKey: 'update.reason.noTarget' }, 'no-target'],
    [{}, { canBeginUpdate: false, reasonKey: 'update.reason.versionCommitAnomaly' }, 'commit-anomaly'],
    [{}, { canBeginUpdate: false, reasonKey: 'update.reason.alreadyAtTarget' }, 'already-at-target'],
  ]) {
    const inspection = normalizeInspection(inspectionFixture({ installed: installed, capability: capability }));
    assert.equal(blockedReason(inspection), expected, JSON.stringify({ installed, capability }));
  }
  // canBeginUpdate must be explicit: a missing value is fail-closed.
  assert.equal(
    blockedReason(normalizeInspection(inspectionFixture({ capability: { canBeginUpdate: undefined, hmr: 'present' } }))),
    'unknown'
  );
});

test('deriveUpdateView exposes discovery/target/identity for the section', function () {
  const inspection = normalizeInspection(inspectionFixture());
  const view = deriveUpdateView({
    status: 'ready',
    inspection: inspection,
    clientIdentity: { version: '1.2.0', buildCommit: null },
    now: Date.parse('2026-10-20T10:00:00.000Z'),
  });
  assert.equal(view.hidden, false);
  assert.equal(view.identity.hostVersion, '1.2.0');
  assert.equal(view.identity.hostCommit, COMMIT_A);
  assert.equal(view.identity.clientVersion, '1.2.0');
  assert.equal(view.identity.clientCommit, null);
  assert.equal(view.identity.clientEmbedded, true);
  assert.equal(view.discovery.comparison, 'available');
  assert.equal(view.update.kind, 'available');
  assert.equal(view.update.fromVersion, '1.2.0');
  assert.equal(view.update.toVersion, '1.3.0');
});

test('deriveUpdateView hides the UI for an unsupported (old) Host', function () {
  const view = deriveUpdateView({ status: 'unsupported' });
  assert.equal(view.hidden, true);
  assert.equal(view.operation, null);
});

test('deriveUpdateView keeps the cached target while offline and never claims success', function () {
  const inspection = normalizeInspection(
    inspectionFixture({
      discovery: {
        state: 'offline',
        fetchedAt: '2026-10-19T00:00:00.000Z',
        checkedAt: '2026-10-20T09:59:00.000Z',
        lastError: { code: 'GM-5039', message: 'offline', retryable: true, at: '2026-10-20T09:59:00.000Z' },
      },
    })
  );
  const view = deriveUpdateView({ status: 'ready', inspection: inspection, clientIdentity: { version: '1.2.0' } });
  assert.equal(view.discovery.state, 'offline');
  assert.equal(view.discovery.lastSuccessAt, '2026-10-19T00:00:00.000Z');
  assert.equal(view.update.kind, 'available');
  assert.equal(view.operation, null);
});

test('deriveUpdateView renders the host operation and applied stays non-success', function () {
  const inspection = normalizeInspection(
    inspectionFixture({ operation: observation('applied', { changed: true, bundle: 'dsh-game-market', version: '1.3.0' }) })
  );
  const view = deriveUpdateView({ status: 'ready', inspection: inspection, clientIdentity: { version: '1.2.0' } });
  assert.equal(view.operation.state, 'applied');
  assert.equal(view.operation.success, false);
  assert.equal(view.operation.titleKey, 'update.state.applied.title');
});

test('deriveUpdateView shows a local starting state before the first observation', function () {
  const inspection = normalizeInspection(inspectionFixture());
  const view = deriveUpdateView({
    status: 'ready',
    inspection: inspection,
    starting: true,
    clientIdentity: { version: '1.2.0' },
  });
  assert.equal(view.operation.state, 'starting');
  assert.equal(view.operation.success, false);
  assert.equal(view.operation.active, true);
});

test('deriveUpdateView computes the refresh throttle window from nextCheckAt', function () {
  const now = Date.parse('2026-10-20T10:00:00.000Z');
  const inspection = normalizeInspection(
    inspectionFixture({ discovery: { nextCheckAt: '2026-10-20T10:00:45.000Z' } })
  );
  const view = deriveUpdateView({ status: 'ready', inspection: inspection, now: now });
  assert.equal(view.refresh.secondsUntil, 45);
  assert.equal(view.refresh.disabled, true);
  assert.equal(timestampMs(view.refresh.availableAt), Date.parse('2026-10-20T10:00:45.000Z'));
  const later = deriveUpdateView({ status: 'ready', inspection: inspection, now: Date.parse('2026-10-20T10:01:00.000Z') });
  assert.equal(later.refresh.secondsUntil, null);
});

test('deriveUpdateView surfaces begin/refresh action errors and coordination state', function () {
  const view = deriveUpdateView({
    status: 'ready',
    inspection: normalizeInspection(inspectionFixture()),
    actionError: { code: 'GM-4091', retryable: false },
    coordination: { status: 'working', failedCount: 0 },
    clientIdentity: { version: '1.2.0' },
  });
  assert.equal(view.actionError.code, 'GM-4091');
  assert.equal(view.coordination.status, 'working');
});

test('client identity normalization never fabricates a version', function () {
  assert.deepEqual(normalizeClientIdentity(null), { version: null, buildCommit: null, embedded: false });
  assert.deepEqual(normalizeClientIdentity({ version: 'not-a-version' }), { version: null, buildCommit: null, embedded: false });
  assert.deepEqual(normalizeClientIdentity({ version: '1.2.0', buildCommit: COMMIT_A }), {
    version: '1.2.0',
    buildCommit: COMMIT_A,
    embedded: true,
  });
  assert.equal(normalizeClientIdentity({ version: '1.2.0', buildCommit: 'abc' }).buildCommit, null);
});

test('inspection anomaly (same version different commit) is preserved for the UI', function () {
  const inspection = normalizeInspection(
    inspectionFixture({
      discovery: {
        state: 'ready',
        anomaly: {
          kind: 'same-version-different-commit',
          version: '1.2.0',
          expectedCommit: COMMIT_A,
          foundCommit: COMMIT_B,
          source: 'profile',
        },
      },
    })
  );
  assert.equal(inspection.discovery.anomaly.kind, 'same-version-different-commit');
  assert.equal(inspection.discovery.anomaly.foundCommit, COMMIT_B);
});
