/**
 * Pure normalization + UI projection for the V1.5 M3 platform update.
 *
 * Two rules drive everything here:
 *  1. The Host observation state machine (contract §9.5.1) is the only authority.
 *     We never derive progress percentages, never promote `applied` to success,
 *     and only `updated` may be rendered as a successful update.
 *  2. The identity reported for this Client comes from the built bundle
 *     (`build-identity.js`), never from a Host response.
 */
import { GM } from '../../shared/src/errors.js';
import { UPDATE_ACTIVE_STATES, UPDATE_DEV_SPEC_SHAPES, UPDATE_DISCOVERY_STATES, UPDATE_PROGRESS_STATES, UPDATE_STATES, UPDATE_SUCCESS_STATE } from './constants.js';
import { isBuildCommit, isBuildVersion } from './build-identity.js';

const HOST_EPOCH_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const FULL_COMMIT_RE = /^[a-f0-9]{40}$/;
const SPEC_SHAPES = Object.freeze(['git-url', 'registry', 'path', 'file', 'unknown']);
const HMR_VALUES = Object.freeze(['present', 'absent', 'unknown']);
const UPDATE_PATHS = Object.freeze(['in-place-hmr', 'restart-required', 'unsupported']);
const AWAITING_VALUES = Object.freeze(['restart', 'reload', 'health']);
const CANCELLED_BY = Object.freeze(['host', 'user']);
const COORDINATION_PHASES = Object.freeze(['idle', 'collecting', 'ready', 'blocked']);

function textValue(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function enumValue(value, allowed, fallback) {
  return typeof value === 'string' && allowed.indexOf(value) !== -1 ? value : fallback;
}

function numberValue(value) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Normalize an ISO timestamp (or epoch ms) to an ISO string for formatting. */
export function timestampValue(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    try {
      return new Date(value).toISOString();
    } catch (_error) {
      return null;
    }
  }
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  try {
    return new Date(parsed).toISOString();
  } catch (_error) {
    return null;
  }
}

/** Epoch ms for a normalized ISO timestamp (null when unknown). */
export function timestampMs(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeHostIdentity(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return Object.freeze({
    version: textValue(input.version),
    commit: FULL_COMMIT_RE.test(input.commit || '') ? input.commit : null,
    hostEpoch: typeof input.hostEpoch === 'string' && HOST_EPOCH_RE.test(input.hostEpoch) ? input.hostEpoch : null,
    loadedAt: timestampValue(input.loadedAt),
  });
}

export function normalizeInstalled(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return Object.freeze({
    bundleId: textValue(input.bundleId),
    spec: textValue(input.spec),
    specShape: enumValue(input.specShape, SPEC_SHAPES, 'unknown'),
    version: textValue(input.version),
    enabled: typeof input.enabled === 'boolean' ? input.enabled : null,
    loadedVersion: textValue(input.loadedVersion),
    loadedCommit: FULL_COMMIT_RE.test(input.loadedCommit || '') ? input.loadedCommit : null,
    devRowShadow: input.devRowShadow === true,
  });
}

export function normalizeTarget(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = textValue(raw.id);
  if (id === null) return null;
  return Object.freeze({
    id: id,
    version: textValue(raw.version),
    commit: FULL_COMMIT_RE.test(raw.commit || '') ? raw.commit : null,
    channel: textValue(raw.channel),
    publishedAt: timestampValue(raw.publishedAt),
    spec: textValue(raw.spec),
  });
}

function normalizeDiscoveryError(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const code = textValue(raw.code);
  return Object.freeze({ code: code === null ? GM.INTERNAL : code });
}

function normalizeAnomaly(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return Object.freeze({
    kind: textValue(raw.kind),
    version: textValue(raw.version),
    expectedCommit: FULL_COMMIT_RE.test(raw.expectedCommit || '') ? raw.expectedCommit : null,
    foundCommit: FULL_COMMIT_RE.test(raw.foundCommit || '') ? raw.foundCommit : null,
    source: textValue(raw.source),
  });
}

export function normalizeDiscovery(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return Object.freeze({
    channel: textValue(input.channel),
    indexUrl: textValue(input.indexUrl),
    state: enumValue(input.state, UPDATE_DISCOVERY_STATES, 'unknown'),
    fetchedAt: timestampValue(input.fetchedAt),
    checkedAt: timestampValue(input.checkedAt),
    nextCheckAt: timestampValue(input.nextCheckAt),
    lastError: normalizeDiscoveryError(input.lastError),
    canRefresh: input.canRefresh !== false,
    anomaly: normalizeAnomaly(input.anomaly),
  });
}

export function normalizeCapability(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return Object.freeze({
    hmr: enumValue(input.hmr, HMR_VALUES, 'unknown'),
    updatePath: enumValue(input.updatePath, UPDATE_PATHS, 'unsupported'),
    canBeginUpdate: input.canBeginUpdate === true,
    reasonKey: textValue(input.reasonKey),
  });
}

function normalizeObservationError(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const code = textValue(raw.code);
  if (code === null) return null;
  return Object.freeze({ code: code });
}

function normalizeCoordination(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return Object.freeze({
    phase: enumValue(raw.phase, COORDINATION_PHASES, 'idle'),
    pending: numberValue(raw.pending),
    failed: raw.failed === true,
  });
}

/**
 * Normalize one `UpdateObservation`.
 *
 * Contract §9.1 declares `progress: null`; any numeric progress the Host (or a
 * future mismatch) sends is deliberately dropped so the UI can never render a
 * fabricated percentage. Unknown fields are not forwarded.
 */
export function normalizeObservation(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const state = enumValue(raw.state, UPDATE_STATES, null);
  if (state === null) return null;
  const operationId = textValue(raw.operationId);
  if (operationId === null) return null;
  return Object.freeze({
    operationId: operationId,
    state: state,
    stage: textValue(raw.stage),
    progress: null,
    changed: typeof raw.changed === 'boolean' ? raw.changed : null,
    bundle: textValue(raw.bundle),
    version: textValue(raw.version),
    installedVersion: textValue(raw.installedVersion),
    runningVersion: textValue(raw.runningVersion),
    awaiting: enumValue(raw.awaiting, AWAITING_VALUES, null),
    host: textValue(raw.host),
    client: textValue(raw.client),
    restartReason: textValue(raw.restartReason),
    reason: textValue(raw.reason),
    cancelledBy: enumValue(raw.cancelledBy, CANCELLED_BY, null),
    error: normalizeObservationError(raw.error),
    oldVersionStillRunning: raw.oldVersionStillRunning === true,
    note: textValue(raw.note),
    coordination: normalizeCoordination(raw.coordination),
    reasonKey: textValue(raw.reasonKey),
    requestId: textValue(raw.requestId),
  });
}

export function isUpdateState(value) {
  return typeof value === 'string' && UPDATE_STATES.indexOf(value) !== -1;
}

export function isActiveObservation(observation) {
  return Boolean(observation && UPDATE_ACTIVE_STATES.indexOf(observation.state) !== -1);
}

export function isTerminalObservation(observation) {
  return Boolean(observation && UPDATE_STATES.indexOf(observation.state) !== -1 && UPDATE_ACTIVE_STATES.indexOf(observation.state) === -1);
}

/**
 * Normalize `GET/POST /platform-update` data (m3-decisions §2).
 * The payload is accepted even when discovery never ran (state 'never',
 * target null, capability unknown, operation null).
 */
export function normalizeInspection(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw;
  return Object.freeze({
    schemaVersion: numberValue(input.schemaVersion),
    host: normalizeHostIdentity(input.host),
    installed: normalizeInstalled(input.installed),
    target: normalizeTarget(input.target),
    discovery: normalizeDiscovery(input.discovery),
    capability: normalizeCapability(input.capability),
    operation: normalizeObservation(input.operation),
  });
}

/** Client build identity as embedded in the bundle (never Host-provided). */
export function normalizeClientIdentity(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const version = isBuildVersion(input.version) ? input.version : null;
  const buildCommit = isBuildCommit(input.buildCommit) ? input.buildCommit : null;
  return Object.freeze({
    version: version,
    buildCommit: buildCommit,
    embedded: version !== null,
  });
}

/** Commit recorded in a git spec (`...git#<40-hex>`), when present. */
export function commitFromSpec(spec) {
  if (typeof spec !== 'string') return null;
  const match = /#([a-f0-9]{40})$/.exec(spec.trim());
  return match ? match[1] : null;
}

/** True when the installed plugin came from a dev/link source. */
export function isDevSource(installed) {
  if (!installed || typeof installed !== 'object') return false;
  if (installed.devRowShadow === true) return true;
  if (UPDATE_DEV_SPEC_SHAPES.indexOf(installed.specShape) !== -1) return true;
  if (typeof installed.spec === 'string' && /^(file:|link:|\.{0,2}\/)/i.test(installed.spec.trim())) return true;
  return false;
}

/**
 * Compare the discovered target with the running identity.
 * Returns `{kind, currentVersion, currentCommit}` where kind is one of
 * `available` | `up-to-date` | `no-target` | `unknown`.
 *
 * Equal versions with different commits are NOT promoted to "update available":
 * m3-decisions §3 treats that as an anomaly for the Host to surface.
 */
export function compareTarget(inspection) {
  if (!inspection || typeof inspection !== 'object') {
    return { kind: 'unknown', currentVersion: null, currentCommit: null };
  }
  const target = inspection.target;
  const currentVersion = inspection.host.version || inspection.installed.loadedVersion || inspection.installed.version || null;
  const currentCommit =
    inspection.host.commit || inspection.installed.loadedCommit || commitFromSpec(inspection.installed.spec) || null;
  if (!target || target.version === null) return { kind: 'no-target', currentVersion: currentVersion, currentCommit: currentCommit };
  if (currentVersion !== null && target.version === currentVersion) {
    if (target.commit !== null && currentCommit !== null) {
      return {
        kind: target.commit === currentCommit ? 'up-to-date' : 'unknown',
        currentVersion: currentVersion,
        currentCommit: currentCommit,
      };
    }
    return { kind: 'up-to-date', currentVersion: currentVersion, currentCommit: currentCommit };
  }
  return { kind: 'available', currentVersion: currentVersion, currentCommit: currentCommit };
}

/**
 * Why an update cannot be started right now (fail-closed).
 * `canBeginUpdate` is only honored when the Host explicitly set it true.
 */
export function blockedReason(inspection) {
  if (!inspection) return null;
  if (isDevSource(inspection.installed)) {
    return inspection.installed.devRowShadow ? 'dev-row' : 'dev-source';
  }
  if (inspection.capability.canBeginUpdate === true) return null;
  // frozen Host reason enum (m3-decisions §8)
  switch (inspection.capability.reasonKey) {
    case 'update.reason.hmrUnknown':
      return 'hmr-unknown';
    case 'update.reason.devSource':
      return 'dev-source';
    case 'update.reason.adapterUnavailable':
      return 'adapter-unavailable';
    case 'update.reason.noTarget':
      return 'no-target';
    case 'update.reason.versionCommitAnomaly':
      return 'commit-anomaly';
    case 'update.reason.alreadyAtTarget':
      return 'already-at-target';
    default:
      break;
  }
  if (inspection.capability.hmr === 'unknown') return 'hmr-unknown';
  if (inspection.capability.updatePath === 'unsupported') return 'unsupported';
  return 'unknown';
}

function detailKeyForVerificationFailure(reason) {
  if (reason === 'version-mismatch') return 'update.state.verificationFailed.versionMismatch';
  if (reason === 'ambiguous-install') return 'update.state.verificationFailed.ambiguousInstall';
  return 'update.state.verificationFailed.responseLost';
}

function detailKeyForStaleRuntime(reason) {
  if (reason === 'host-old') return 'update.state.staleRuntime.hostOld';
  if (reason === 'dev-row-shadows-package') return 'update.state.staleRuntime.devRow';
  return 'update.state.staleRuntime.clientOld';
}

/**
 * Project one observation into the exact copy/actions the UI may show.
 *
 * `success` is true only for the `updated` terminal state; `applied` and
 * `activating` are progress, `pending-restart` is installed-but-not-effective.
 */
export function describeObservation(observation, options) {
  const opts = options && typeof options === 'object' ? options : {};
  if (!observation) return null;
  const targetVersion = typeof opts.targetVersion === 'string' && opts.targetVersion.length > 0 ? opts.targetVersion : null;
  const state = observation.state;
  const active = UPDATE_ACTIVE_STATES.indexOf(state) !== -1;
  const progressIndex = UPDATE_PROGRESS_STATES.indexOf(state);
  const result = {
    operationId: observation.operationId,
    state: state,
    active: active,
    terminal: !active,
    success: state === UPDATE_SUCCESS_STATE,
    titleKey: 'update.state.unknown.title',
    detailKey: 'update.state.unknown.body',
    detailParams: {},
    action: null,
    cancellable: state === 'inspecting' || state === 'installing',
    showProgress: active,
    progressIndex: progressIndex === -1 ? null : progressIndex,
    errorCode: observation.error ? observation.error.code : null,
    oldVersionStillRunning: observation.oldVersionStillRunning === true,
    awaitsRestart: observation.awaiting === 'restart',
    coordinationPending: null,
    coordinationFailed: false,
    showRecovery: false,
  };

  if (state === 'inspecting') {
    result.titleKey = 'update.state.inspecting.title';
    const coordination = observation.coordination;
    if (coordination && coordination.failed) {
      result.detailKey = 'update.state.inspecting.coordinationFailed';
      result.coordinationFailed = true;
      result.showRecovery = true;
    } else if (coordination && typeof coordination.pending === 'number' && coordination.pending > 0) {
      result.detailKey = 'update.state.inspecting.coordination';
      result.detailParams = { pending: String(coordination.pending) };
      result.coordinationPending = coordination.pending;
    } else {
      result.detailKey = 'update.state.inspecting.body';
    }
    result.action = 'cancel';
    return result;
  }
  if (state === 'installing') {
    result.titleKey = 'update.state.installing.title';
    result.detailKey = 'update.state.installing.body';
    if (targetVersion !== null) result.detailParams = { version: targetVersion };
    result.action = 'cancel';
    return result;
  }
  if (state === 'applied') {
    // Intermediate: installation is applied, but nothing is verified yet.
    result.titleKey = 'update.state.applied.title';
    result.detailKey = 'update.state.applied.body';
    return result;
  }
  if (state === 'activating') {
    result.titleKey = 'update.state.activating.title';
    result.detailKey = observation.awaiting === 'restart' ? 'update.state.activating.restart' : 'update.state.activating.body';
    return result;
  }
  if (state === 'updated') {
    result.titleKey = 'update.state.updated.title';
    result.detailKey = 'update.state.updated.body';
    result.detailParams = { version: observation.version || targetVersion || '' };
    return result;
  }
  if (state === 'pending-restart') {
    result.titleKey = 'update.state.pendingRestart.title';
    result.detailKey = 'update.state.pendingRestart.body';
    result.detailParams = { version: observation.installedVersion || targetVersion || '' };
    return result;
  }
  if (state === 'already-at-target') {
    result.titleKey = 'update.state.already.title';
    result.detailKey = 'update.state.already.body';
    result.detailParams = { version: targetVersion || '' };
    return result;
  }
  if (state === 'verification-failed') {
    result.titleKey = 'update.state.verificationFailed.title';
    result.detailKey = detailKeyForVerificationFailure(observation.reason);
    result.action = 'retry';
    result.showRecovery = true;
    return result;
  }
  if (state === 'stale-runtime') {
    result.titleKey = 'update.state.staleRuntime.title';
    result.detailKey = detailKeyForStaleRuntime(observation.reason);
    if (observation.reason === 'client-old') result.action = 'refresh-page';
    result.showRecovery = observation.reason === 'dev-row-shadows-package';
    return result;
  }
  if (state === 'too-late') {
    result.titleKey = 'update.state.tooLate.title';
    result.detailKey = 'update.state.tooLate.body';
    return result;
  }
  if (state === 'cancelled') {
    result.titleKey = 'update.state.cancelled.title';
    result.detailKey = 'update.state.cancelled.body';
    return result;
  }
  if (state === 'failed') {
    result.titleKey = 'update.state.failed.title';
    result.detailKey = observation.oldVersionStillRunning
      ? 'update.state.failed.oldVersionRunning'
      : 'update.state.failed.recoveryNeeded';
    result.action = 'retry';
    result.showRecovery = true;
    return result;
  }
  return result;
}

/**
 * Full UI projection.
 *
 * @param {{status?: string, inspection?: object|null, operation?: object|null,
 *   error?: object|null, starting?: boolean, clientIdentity?: object,
 *   now?: number}} slice
 */
export function deriveUpdateView(slice) {
  const input = slice && typeof slice === 'object' ? slice : {};
  const status = typeof input.status === 'string' ? input.status : 'unknown';
  const inspection = normalizeInspection(input.inspection);
  const operation = normalizeObservation(input.operation) || (inspection ? inspection.operation : null);
  const client = normalizeClientIdentity(input.clientIdentity);
  const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : 0;

  const view = {
    hidden: status === 'unsupported',
    status: status,
    loading: status === 'loading' || status === 'idle',
    error: input.error && typeof input.error === 'object' ? { code: textValue(input.error.code) || GM.INTERNAL } : null,
    actionError:
      input.actionError && typeof input.actionError === 'object'
        ? { code: textValue(input.actionError.code) || GM.INTERNAL, retryable: input.actionError.retryable === true }
        : null,
    coordination: null,
    starting: input.starting === true,
    identity: {
      hostVersion: inspection ? inspection.host.version : null,
      hostCommit: inspection ? inspection.host.commit : null,
      clientVersion: client.version,
      clientCommit: client.buildCommit,
      clientEmbedded: client.embedded,
    },
    inspection: inspection,
    discovery: null,
    update: null,
    blocked: null,
    operation: null,
    refresh: { busy: input.refreshing === true, availableAt: null, secondsUntil: null },
  };

  if (input.coordination && typeof input.coordination === 'object') {
    const status = input.coordination.status;
    if (status === 'working' || status === 'reported' || status === 'failed') {
      view.coordination = {
        status: status,
        failedCount:
          typeof input.coordination.failedCount === 'number' && Number.isFinite(input.coordination.failedCount)
            ? input.coordination.failedCount
            : 0,
      };
    }
  }

  if (inspection) {
    const comparison = compareTarget(inspection);
    const blocked = blockedReason(inspection);
    view.blocked = blocked === null ? null : { reason: blocked };
    view.discovery = {
      state: inspection.discovery.state,
      canRefresh: inspection.discovery.canRefresh,
      lastSuccessAt: inspection.discovery.fetchedAt,
      checkedAt: inspection.discovery.checkedAt,
      nextCheckAt: inspection.discovery.nextCheckAt,
      error: inspection.discovery.lastError,
      target: inspection.target,
      comparison: comparison.kind,
    };
    view.refresh.availableAt = inspection.discovery.nextCheckAt;
    const throttleMs = timestampMs(inspection.discovery.nextCheckAt);
    if (throttleMs !== null && now > 0 && throttleMs > now) {
      view.refresh.secondsUntil = Math.ceil((throttleMs - now) / 1000);
      view.refresh.availableAt = inspection.discovery.nextCheckAt;
    }
    view.update = {
      kind: comparison.kind,
      target: inspection.target,
      currentVersion: comparison.currentVersion,
      currentCommit: comparison.currentCommit,
      fromVersion: comparison.currentVersion,
      toVersion: inspection.target ? inspection.target.version : null,
    };
    const targetVersion = inspection.target ? inspection.target.version : null;
    view.operation = input.starting === true && !operation
      ? {
          operationId: null,
          state: 'starting',
          active: true,
          terminal: false,
          success: false,
          titleKey: 'update.state.starting.title',
          detailKey: 'update.state.starting.body',
          detailParams: {},
          action: null,
          cancellable: false,
          showProgress: false,
          progressIndex: null,
          errorCode: null,
          oldVersionStillRunning: false,
          awaitsRestart: false,
          coordinationPending: null,
          coordinationFailed: false,
          showRecovery: false,
        }
      : describeObservation(operation, { targetVersion: targetVersion });
  } else if (operation) {
    view.operation = describeObservation(operation, { targetVersion: null });
  } else if (input.starting === true) {
    view.operation = {
      operationId: null,
      state: 'starting',
      active: true,
      terminal: false,
      success: false,
      titleKey: 'update.state.starting.title',
      detailKey: 'update.state.starting.body',
      detailParams: {},
      action: null,
      cancellable: false,
      showProgress: false,
      progressIndex: null,
      errorCode: null,
      oldVersionStillRunning: false,
      awaitsRestart: false,
      coordinationPending: null,
      coordinationFailed: false,
      showRecovery: false,
    };
  }

  // A manual refresh is unavailable while a request is in flight or while the
  // Host throttle window is still open.
  view.refresh.disabled = view.refresh.busy || view.refresh.secondsUntil !== null;
  return view;
}
