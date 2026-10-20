/**
 * Contract-mirror guard (V1.5 M3).
 *
 * The Client bundle keeps its own copies of the frozen update vocabulary so the
 * browser artifact does not pull the whole Host-side validator module (bundle
 * size is a recorded risk). This test imports both sides in Node and fails the
 * moment host-core changes a shared enum without the Client mirror.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '../../shared/src/contracts.js';
import {
  PLATFORM_UPDATE_PATHS,
  PLATFORM_UPDATE_REASON_KEYS,
  PLATFORM_UPDATE_STATES,
  PLATFORM_UPDATE_TERMINAL_STATES,
  UPDATE_SPEC_SHAPES as SHARED_UPDATE_SPEC_SHAPES,
  VERIFICATION_FAILED_REASONS as SHARED_VERIFICATION_FAILED_REASONS,
  STALE_RUNTIME_REASONS as SHARED_STALE_RUNTIME_REASONS,
  isPinnedCommit as sharedIsPinnedCommit,
  parseExactSemver as sharedParseExactSemver,
} from '../../shared/src/platform-update.js';
import {
  UPDATE_ACTIVE_STATES,
  UPDATE_CONTINUES_STATES,
  UPDATE_DISCOVERY_STATES,
  UPDATE_PROGRESS_STATES,
  UPDATE_ROUTES,
  UPDATE_SPEC_SHAPES,
  UPDATE_STALE_RUNTIME_REASONS,
  UPDATE_STATES,
  UPDATE_SUCCESS_STATE,
  UPDATE_TERMINAL_STATES,
  UPDATE_VERIFICATION_FAILED_REASONS,
} from '../src/constants.js';
import { blockedReason, normalizeInspection, normalizeObservation } from '../src/update-state.js';
import { isBuildCommit, isBuildVersion } from '../src/build-identity.js';

test('client update states mirror the shared contract vocabulary', function () {
  assert.deepEqual(UPDATE_STATES, PLATFORM_UPDATE_STATES);
  assert.deepEqual(UPDATE_TERMINAL_STATES, PLATFORM_UPDATE_TERMINAL_STATES);
  // `too-late` is not terminal (the install continues) but it is not a
  // progress state either; it must stay in the continuing set only.
  assert.deepEqual(UPDATE_ACTIVE_STATES, ['inspecting', 'installing', 'applied', 'activating']);
  assert.deepEqual(UPDATE_CONTINUES_STATES, UPDATE_ACTIVE_STATES.concat(['too-late']));
  assert.equal(UPDATE_TERMINAL_STATES.indexOf('too-late'), -1);
  assert.deepEqual(UPDATE_PROGRESS_STATES, UPDATE_ACTIVE_STATES);
  assert.equal(UPDATE_SUCCESS_STATE, 'updated');
  assert.deepEqual(UPDATE_DISCOVERY_STATES, ['never', 'checking', 'ready', 'stale', 'offline', 'invalid', 'unknown']);
});

test('client update routes mirror the shared ROUTES table', function () {
  assert.equal(ROUTES.PLATFORM_UPDATE.endsWith('/platform-update'), true);
  assert.equal(ROUTES.PLATFORM_UPDATE_REFRESH.endsWith('/platform-update/refresh'), true);
  assert.equal(ROUTES.PLATFORM_UPDATE_BEGIN.endsWith('/platform-update/begin'), true);
  assert.equal(ROUTES.PLATFORM_UPDATE_OBSERVE.endsWith('/platform-update/observe'), true);
  assert.equal(ROUTES.PLATFORM_UPDATE_CANCEL.endsWith('/platform-update/cancel'), true);
  assert.equal(ROUTES.PLATFORM_UPDATE_COORDINATE.endsWith('/platform-update/coordinate'), true);
  assert.equal(ROUTES.PLATFORM_UPDATE_CLIENT_REPORT.endsWith('/platform-update/client-report'), true);
  assert.equal(UPDATE_ROUTES.inspect, 'platform-update');
  assert.equal(UPDATE_ROUTES.refresh, 'platform-update/refresh');
  assert.equal(UPDATE_ROUTES.begin, 'platform-update/begin');
  assert.equal(UPDATE_ROUTES.observe, 'platform-update/observe');
  assert.equal(UPDATE_ROUTES.cancel, 'platform-update/cancel');
  assert.equal(UPDATE_ROUTES.coordinate, 'platform-update/coordinate');
  assert.equal(UPDATE_ROUTES.clientReport, 'platform-update/client-report');
});

test('every shared reasonKey maps to a visible fail-closed Client block', function () {
  const cases = [
    [PLATFORM_UPDATE_REASON_KEYS.HMR_UNKNOWN, 'hmr-unknown'],
    [PLATFORM_UPDATE_REASON_KEYS.DEV_SOURCE, 'dev-source'],
    [PLATFORM_UPDATE_REASON_KEYS.ADAPTER_UNAVAILABLE, 'adapter-unavailable'],
    [PLATFORM_UPDATE_REASON_KEYS.NO_TARGET, 'no-target'],
    [PLATFORM_UPDATE_REASON_KEYS.VERSION_COMMIT_ANOMALY, 'commit-anomaly'],
    [PLATFORM_UPDATE_REASON_KEYS.ALREADY_AT_TARGET, 'already-at-target'],
  ];
  for (const [reasonKey, expected] of cases) {
    const inspection = normalizeInspection({
      schemaVersion: 1,
      host: {},
      installed: {},
      target: null,
      discovery: { state: 'never' },
      capability: { hmr: 'unknown', updatePath: 'unsupported', canBeginUpdate: false, reasonKey: reasonKey },
      operation: null,
    });
    assert.equal(blockedReason(inspection), expected, reasonKey);
  }
});

test('client spec shapes and update paths mirror the shared enums', function () {
  assert.deepEqual(UPDATE_SPEC_SHAPES, SHARED_UPDATE_SPEC_SHAPES);
  assert.deepEqual(PLATFORM_UPDATE_PATHS, ['in-place-hmr', 'restart-required', 'unsupported']);
  // A shape outside the shared enum must fail closed to "unknown".
  const inspection = normalizeInspection({
    schemaVersion: 1,
    host: {},
    installed: { specShape: 'tarball' },
    target: null,
    discovery: { state: 'never' },
    capability: { canBeginUpdate: false },
    operation: null,
  });
  assert.equal(inspection.installed.specShape, 'unknown');
});

test('client failure/stale reason enums mirror the shared contract', function () {
  assert.deepEqual(UPDATE_VERIFICATION_FAILED_REASONS, SHARED_VERIFICATION_FAILED_REASONS);
  assert.deepEqual(UPDATE_STALE_RUNTIME_REASONS, SHARED_STALE_RUNTIME_REASONS);
  for (const reason of SHARED_VERIFICATION_FAILED_REASONS) {
    const observation = normalizeObservation({ operationId: 'upd_0123456789abcdef', state: 'verification-failed', reason: reason });
    assert.ok(observation.reason);
  }
  for (const reason of SHARED_STALE_RUNTIME_REASONS) {
    const observation = normalizeObservation({ operationId: 'upd_0123456789abcdef', state: 'stale-runtime', reason: reason });
    assert.ok(observation.reason);
  }
  // An unknown reason is not forwarded (UI copy would be meaningless).
  const unknown = normalizeObservation({ operationId: 'upd_0123456789abcdef', state: 'stale-runtime', reason: 'made-up' });
  assert.equal(unknown.reason, null);
});

test('client semver/commit validation matches the shared validators', function () {
  const samples = ['1.2.0', '1.3.0-rc.1', '1.2', '01.2.3', 'x', '2.0.0+build.5'];
  for (const sample of samples) {
    assert.equal(isBuildVersion(sample), sharedParseExactSemver(sample) !== null, sample);
  }
  const commits = ['a'.repeat(40), 'A'.repeat(40), 'a'.repeat(39), 'z'.repeat(40)];
  for (const commit of commits) {
    assert.equal(isBuildCommit(commit), sharedIsPinnedCommit(commit), commit);
  }
});
