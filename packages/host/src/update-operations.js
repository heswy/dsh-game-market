/**
 * Platform update operations (docs/V1.5-CONTRACTS.md §9.1/§9.5.1).
 *
 * M3-H1 skeleton: the route surface exists and is honest about unavailable
 * capability (fail-closed `GM-5038`), and the per-window client identity report
 * store is already live so the Client half can integrate against the frozen
 * shapes. M3-H2 fills the native adapter pipeline, coordination gate, persisted
 * update record and recovery into this module (same public service interface).
 */

import { GM } from '../../shared/src/errors.js';
import {
  PLATFORM_UPDATE_REASON_KEYS,
  PLATFORM_UPDATE_TIMING,
  isUpdateOperationId,
  parseExactSemver,
  isPinnedCommit,
} from '../../shared/src/platform-update.js';
import { hostError } from './errors.js';

const LOG = '[game-market/host]';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireObjectBody(body) {
  if (!isPlainObject(body)) throw hostError(GM.INVALID_PARAM, 'Request body must be a JSON object');
  return body;
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

/**
 * @param {{
 *   storage: object,
 *   discovery: object,
 *   adapter?: object|null,
 *   identity?: object|null,
 *   coordination?: object|null,
 *   healthCheck?: (() => Promise<object>)|null,
 *   hostEpoch: string,
 *   logger?: object,
 *   now?: () => Date,
 *   timing?: object,
 * }} options
 */
export function createUpdateOperationService({
  storage = null,
  discovery,
  adapter = null,
  identity = null,
  coordination = null,
  healthCheck = null,
  hostEpoch,
  logger = null,
  now = () => new Date(),
  timing = {},
}) {
  const limits = { ...PLATFORM_UPDATE_TIMING, ...(isPlainObject(timing) ? timing : {}) };

  /** Per-window client build identity reports (client-report). */
  const clientReports = new Map();
  let lastObservation = null;

  function reportKey(windowId) {
    return windowId;
  }

  function liveReports() {
    const stamp = now().getTime();
    const live = [];
    for (const [key, report] of clientReports) {
      if (stamp - report.receivedAtMs <= limits.clientReportTtlMs) live.push({ key, report });
      else clientReports.delete(key);
    }
    return live;
  }

  /** Record one window's *self-reported* build identity; never trust Host values. */
  function clientReport(rawBody) {
    const body = requireObjectBody(rawBody);
    const clientId = boundedString(body.clientId, { name: 'clientId' });
    const windowId = boundedString(body.windowId, { name: 'windowId' });
    const buildVersion = boundedString(body.buildVersion, { maxLength: 64, name: 'buildVersion' });
    if (parseExactSemver(buildVersion) === null) {
      throw hostError(GM.INVALID_PARAM, 'Invalid buildVersion');
    }
    let buildCommit = null;
    if (body.buildCommit !== undefined && body.buildCommit !== null) {
      if (!isPinnedCommit(body.buildCommit)) throw hostError(GM.INVALID_PARAM, 'Invalid buildCommit');
      buildCommit = body.buildCommit;
    }
    const pageToken =
      body.pageToken === undefined || body.pageToken === null
        ? null
        : boundedString(body.pageToken, { maxLength: 128, name: 'pageToken' });
    const startedAt = optionalIsoString(body.startedAt, 'startedAt');
    const report = {
      clientId,
      windowId,
      buildVersion,
      buildCommit,
      pageToken,
      startedAt,
      receivedAt: now().toISOString(),
      receivedAtMs: now().getTime(),
    };
    clientReports.set(reportKey(windowId), report);
    const active = lastObservation !== null && !isTerminalObservation(lastObservation);
    const expected = identity === null ? undefined : identity.expectedClient;
    return {
      accepted: true,
      state: active ? 'updating' : 'idle',
      ...(expected === undefined ? {} : { expected }),
    };
  }

  function isTerminalObservation(observation) {
    return (
      observation !== null &&
      typeof observation === 'object' &&
      ['updated', 'pending-restart', 'already-at-target', 'verification-failed', 'stale-runtime', 'cancelled', 'failed'].includes(
        observation.state
      )
    );
  }

  function unavailableError() {
    return hostError(GM.UPDATE_ADAPTER_UNAVAILABLE, 'Plugin update capability is unavailable', {
      retryable: true,
      details: { reasonKey: PLATFORM_UPDATE_REASON_KEYS.ADAPTER_UNAVAILABLE },
    });
  }

  async function begin(rawBody) {
    const body = requireObjectBody(rawBody);
    const targetId = boundedString(body.targetId, { maxLength: 64, name: 'targetId' });
    if (adapter === null) throw unavailableError();
    const target = discovery.resolveTarget(targetId);
    if (target === null) {
      throw hostError(GM.UPDATE_TARGET_INVALID, 'Update target is not the current validated discovery record', {
        retryable: false,
      });
    }
    // M3-H2 replaces this call with the native adapter pipeline.
    return adapter.beginUpdate(target);
  }

  async function observe(rawOperationId) {
    if (adapter === null) throw unavailableError();
    if (typeof rawOperationId !== 'string' || !isUpdateOperationId(rawOperationId)) {
      throw hostError(GM.INVALID_PARAM, 'Invalid operationId');
    }
    return adapter.observeUpdate(rawOperationId);
  }

  async function cancel(rawBody) {
    const body = requireObjectBody(rawBody);
    if (adapter === null) throw unavailableError();
    const operationId = boundedString(body.operationId, { maxLength: 64, name: 'operationId' });
    if (!isUpdateOperationId(operationId)) throw hostError(GM.INVALID_PARAM, 'Invalid operationId');
    return adapter.cancelUpdate(operationId);
  }

  async function coordinate(rawBody) {
    const body = requireObjectBody(rawBody);
    if (adapter === null) throw unavailableError();
    return adapter.coordinate(body);
  }

  function currentObservation() {
    return lastObservation;
  }

  async function start() {
    return undefined;
  }

  async function stop() {
    return undefined;
  }

  async function ready() {
    return undefined;
  }

  return {
    start,
    stop,
    ready,
    begin,
    observe,
    cancel,
    coordinate,
    clientReport,
    currentObservation,
    clientReports: liveReports,
    /** @internal exposed for H2 tests */
    _setLastObservation: (observation) => {
      lastObservation = observation;
    },
  };
}
