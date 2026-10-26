/**
 * V1.5 M3 platform-update orchestration (m3-decisions §2 / §4).
 *
 * Responsibilities:
 *  - inspect the Host update surface and keep the store's update slice fresh;
 *  - report this Client's own embedded build identity (never a Host-provided one);
 *  - start exactly one Host operation per target (idempotent; multi-window safe);
 *  - poll `observe` (~1s) and follow the Host state machine without inventing
 *    states or progress, resuming after page refresh / RPC loss;
 *  - during the Host coordination phase pause+save every Runtime instance in
 *    this window and report per-instance results (`saved` only when the platform
 *    pause resolved ok and the save was not stale);
 *  - cancel only through the Host route; `too-late` keeps observing.
 *
 * The module holds no React state; components read the store slice.
 */
import { GM } from '../../shared/src/errors.js';
import { UPDATE_TIMING, UPDATE_SUCCESS_STATE } from './constants.js';
import { isContinuingObservation, isDevSource, normalizeInspection, normalizeObservation } from './update-state.js';
import { normalizeUiError } from './ui-errors.js';
import { CLIENT_BUILD, isBuildVersion } from './build-identity.js';
import { getPageIdentity as defaultPageIdentity } from './page-identity.js';
import { listRuntimeInstances as defaultRuntimeInstances } from './runtime-registry.js';
import { pauseRuntimeBounded as defaultPauseInstance } from './runtime-adapter.js';
import { store as defaultStore, toastPushed, updateActionCleared, updateActionFailed, updateClientReported, updateCoordinated, updateInspectFailed, updateInspectReady, updateInspectStarted, updateObservation, updateRefreshFinished, updateRefreshStarted, updateStarting, updateUnsupported } from './store.js';
import { getUpdateApi } from './api.js';
import { reportDiagnostic } from './diagnostics.js';

const MAX_REMEMBERED_OPERATIONS = 4;
let toastCounter = 0;

function noop() {}

function defaultScheduler() {
  return {
    now: function now() {
      return Date.now();
    },
    setTimeout: function schedule(callback, delay) {
      return setTimeout(callback, delay);
    },
    clearTimeout: function clear(handle) {
      clearTimeout(handle);
    },
  };
}

function isUnsupportedError(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.code === GM.UNKNOWN_METHOD) return true;
  return error.status === 404 || error.status === 405 || error.status === 501;
}

/**
 * @param {{
 *   store?: object,
 *   getApi?: Function,
 *   getClientIdentity?: Function,
 *   getPageIdentity?: Function,
 *   getRuntimeInstances?: Function,
 *   pauseInstance?: Function,
 *   scheduler?: object,
 *   getVisibility?: Function,
 * }} [options]
 */
export function createUpdateManager(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const target = opts.store || defaultStore;
  const getApi = typeof opts.getApi === 'function' ? opts.getApi : function unavailable() {
    return null;
  };
  const clientIdentitySource = typeof opts.getClientIdentity === 'function' ? opts.getClientIdentity : function identity() {
    return CLIENT_BUILD;
  };
  const pageIdentity = typeof opts.getPageIdentity === 'function' ? opts.getPageIdentity : defaultPageIdentity;
  const runtimeInstances = typeof opts.getRuntimeInstances === 'function' ? opts.getRuntimeInstances : defaultRuntimeInstances;
  const pauseInstance = typeof opts.pauseInstance === 'function' ? opts.pauseInstance : defaultPauseInstance;
  const scheduler = opts.scheduler && typeof opts.scheduler.setTimeout === 'function' ? opts.scheduler : defaultScheduler();
  const getVisibility = typeof opts.getVisibility === 'function' ? opts.getVisibility : function visible() {
    return 'visible';
  };

  let started = false;
  // Polling is inert until a method is called; `stop()` latches it off. This
  // keeps direct `inspect()` usable in tests/probes without a start handshake.
  let stopped = false;
  let inspectTimer = null;
  let observeTimer = null;
  let reportTimer = null;
  let inspectInFlight = false;
  let observeInFlight = false;
  let coordinateInFlight = false;
  let beginInFlight = false;
  let refreshInFlight = false;
  let currentOperationId = null;
  let observeFailures = 0;
  let inspectFailures = 0;
  let unsupported = false;
  let reportedOperations = [];
  const heldRuntimes = new Map();

  function dispatch(action) {
    if (target && typeof target.dispatch === 'function') return target.dispatch(action);
    return null;
  }

  function readUpdate() {
    const state = target && typeof target.getState === 'function' ? target.getState() : null;
    return state && state.update ? state.update : null;
  }

  function now() {
    try {
      return scheduler.now();
    } catch (_error) {
      return Date.now();
    }
  }

  function identity() {
    try {
      const value = pageIdentity();
      return value && typeof value === 'object' ? value : null;
    } catch (_error) {
      return null;
    }
  }

  function clientIdentity() {
    try {
      const value = clientIdentitySource();
      return value && typeof value === 'object' ? value : { version: null, buildCommit: null };
    } catch (_error) {
      return { version: null, buildCommit: null };
    }
  }

  function visibility() {
    try {
      const value = getVisibility();
      return value === 'hidden' ? 'hidden' : 'visible';
    } catch (_error) {
      return 'visible';
    }
  }

  function toastError(textKey, params) {
    toastCounter += 1;
    dispatch(
      toastPushed({
        id: 'update-toast-' + String(toastCounter),
        kind: 'error',
        textKey: textKey,
        params: params || {},
        at: now(),
      })
    );
  }

  function clearTimer(name) {
    if (name === 'inspect' && inspectTimer !== null) {
      scheduler.clearTimeout(inspectTimer);
      inspectTimer = null;
    } else if (name === 'observe' && observeTimer !== null) {
      scheduler.clearTimeout(observeTimer);
      observeTimer = null;
    } else if (name === 'report' && reportTimer !== null) {
      scheduler.clearTimeout(reportTimer);
      reportTimer = null;
    }
  }

  function clearAllTimers() {
    clearTimer('inspect');
    clearTimer('observe');
    clearTimer('report');
  }

  function sleep(ms) {
    return new Promise(function wait(resolve) {
      scheduler.setTimeout(function done() {
        resolve();
      }, ms);
    });
  }

  // ---- identity reporting -------------------------------------------------

  function reportClient() {
    const api = getApi();
    const page = identity();
    const build = clientIdentity();
    if (!api || typeof api.clientReport !== 'function' || !page) return Promise.resolve(false);
    if (!isBuildVersion(build.version)) {
      // A bundle without an embedded identity must not invent a version: the
      // Host validates buildVersion as an exact semver and treats a missing
      // report as an old/unknown Client (stale-runtime) instead.
      reportDiagnostic('update-client-identity-missing');
      return Promise.resolve(false);
    }
    const body = {
      clientId: page.clientId,
      windowId: page.windowId,
      buildVersion: build.version,
      buildCommit: typeof build.buildCommit === 'string' ? build.buildCommit : null,
      pageToken: page.pageToken,
      startedAt: page.startedAt,
    };
    return Promise.resolve()
      .then(function send() {
        return api.clientReport(body);
      })
      .then(function sent() {
        dispatch(updateClientReported(now()));
        return true;
      })
      .catch(function failed(error) {
        reportDiagnostic('update-client-report-failed', error);
        return false;
      });
  }

  function scheduleClientReport() {
    if (stopped || reportTimer !== null) return;
    reportTimer = scheduler.setTimeout(function onReport() {
      reportTimer = null;
      const update = readUpdate();
      const operation = update ? update.operation : null;
      const active = isContinuingObservation(operation) || (update && update.starting === true);
      if (!active) return;
      void reportClient();
      scheduleClientReport();
    }, UPDATE_TIMING.clientReportMs);
    if (reportTimer && typeof reportTimer.unref === 'function') reportTimer.unref();
  }

  // ---- inspection ---------------------------------------------------------

  function scheduleInspect(delay) {
    if (stopped) return;
    clearTimer('inspect');
    const wait = typeof delay === 'number' ? delay : visibility() === 'hidden' ? UPDATE_TIMING.inspectHiddenMs : UPDATE_TIMING.inspectVisibleMs;
    inspectTimer = scheduler.setTimeout(function onInspect() {
      inspectTimer = null;
      void inspect();
    }, wait);
    if (inspectTimer && typeof inspectTimer.unref === 'function') inspectTimer.unref();
  }

  function releaseRuntimeHolds(operationId) {
    for (const [id, controllers] of heldRuntimes) {
      if (id !== operationId) continue;
      for (const controller of controllers) controller.setUpdateHold(id, false);
      heldRuntimes.delete(id);
    }
  }

  function applyInspection(inspection) {
    dispatch(updateInspectReady(inspection, now()));
    const operation = inspection.operation;
    if (operation && !isContinuingObservation(operation)) releaseRuntimeHolds(operation.operationId);
    if (operation && isContinuingObservation(operation)) {
      ensureObserve(operation.operationId);
      scheduleClientReport();
      if (operation.state === 'inspecting') void coordinateOperation(operation.operationId);
    } else if (!operation) {
      clearTimer('observe');
      currentOperationId = null;
      observeFailures = 0;
    }
  }

  function inspect() {
    if (stopped || inspectInFlight || unsupported) return Promise.resolve(null);
    const api = getApi();
    if (!api || typeof api.inspect !== 'function') {
      dispatch(updateInspectFailed({ code: GM.HOST_UNAVAILABLE, retryable: true }));
      scheduleInspect();
      return Promise.resolve(null);
    }
    inspectInFlight = true;
    dispatch(updateInspectStarted());
    return Promise.resolve()
      .then(function request() {
        return api.inspect();
      })
      .then(function apply(data) {
        const inspection = normalizeInspection(data);
        if (!inspection) {
          inspectFailures += 1;
          dispatch(updateInspectFailed({ code: GM.INTERNAL, retryable: true }));
          return null;
        }
        inspectFailures = 0;
        applyInspection(inspection);
        return inspection;
      })
      .catch(function failed(error) {
        if (isUnsupportedError(error)) {
          unsupported = true;
          dispatch(updateUnsupported());
          clearAllTimers();
          return null;
        }
        inspectFailures += 1;
        reportDiagnostic('update-inspect-failed', error);
        dispatch(updateInspectFailed(normalizeUiError(error, GM.HOST_UNAVAILABLE)));
        return null;
      })
      .finally(function done() {
        inspectInFlight = false;
        if (!stopped && !unsupported) scheduleInspect();
      });
  }

  // ---- observation --------------------------------------------------------

  function ensureObserve(operationId) {
    if (typeof operationId !== 'string' || operationId.length === 0) return;
    if (currentOperationId === operationId) return;
    currentOperationId = operationId;
    observeFailures = 0;
    clearTimer('observe');
    scheduleObserve(0, operationId);
  }

  function scheduleObserve(delay, operationId) {
    if (stopped) return;
    clearTimer('observe');
    observeTimer = scheduler.setTimeout(function onObserve() {
      observeTimer = null;
      void observeTick(operationId);
    }, typeof delay === 'number' ? delay : UPDATE_TIMING.observeMs);
    if (observeTimer && typeof observeTimer.unref === 'function') observeTimer.unref();
  }

  function observeTick(operationId) {
    if (stopped || observeInFlight) return Promise.resolve(null);
    if (currentOperationId !== operationId) return Promise.resolve(null);
    const api = getApi();
    if (!api || typeof api.observe !== 'function') return Promise.resolve(null);
    observeInFlight = true;
    return Promise.resolve()
      .then(function request() {
        return api.observe(operationId);
      })
      .then(function apply(data) {
        const observation = normalizeObservation(data);
        if (!observation || observation.operationId !== operationId) {
          return false;
        }
        observeFailures = 0;
        dispatch(updateObservation(observation, now()));
        if (isContinuingObservation(observation)) {
          if (observation.state === 'inspecting') void coordinateOperation(operationId);
          return true;
        }
        onTerminalObservation(observation);
        return true;
      })
      .catch(function failed(error) {
        observeFailures += 1;
        reportDiagnostic('update-observe-failed', error);
        if (error && error.code === GM.INVALID_PARAM) {
          // The Host no longer knows this operation (restart/record loss).
          // Stop polling the dead id; a fresh inspection adopts the persisted
          // operation if there is one.
          currentOperationId = null;
          clearTimer('observe');
          scheduleInspect(0);
          return 'unknown-operation';
        }
        return false;
      })
      .finally(function done() {
        observeInFlight = false;
        if (stopped || currentOperationId !== operationId) return;
        const update = readUpdate();
        const operation = update ? update.operation : null;
        if (operation && isContinuingObservation(operation)) {
          const backoff = Math.min(UPDATE_TIMING.observeMs * Math.pow(2, Math.max(0, observeFailures - 1)), UPDATE_TIMING.backoffMaxMs);
          scheduleObserve(backoff, operationId);
        }
      });
  }

  function onTerminalObservation(observation) {
    releaseRuntimeHolds(observation.operationId);
    clearTimer('observe');
    if (observation.state === UPDATE_SUCCESS_STATE) {
      void reportClient();
    }
    // Re-read the inspection so identity/capability/discovery fields are fresh;
    // the terminal observation is retained by the Host until the next begin.
    scheduleInspect(0);
  }

  // ---- coordination -------------------------------------------------------

  function wasReported(operationId) {
    return reportedOperations.indexOf(operationId) !== -1;
  }

  function rememberReported(operationId) {
    reportedOperations = reportedOperations.filter(function keep(id) {
      return id !== operationId;
    });
    reportedOperations.push(operationId);
    if (reportedOperations.length > MAX_REMEMBERED_OPERATIONS) reportedOperations.shift();
  }

  function normalizePauseResult(result) {
    const value = result && typeof result === 'object' ? result : {};
    return {
      unresponsive: value.unresponsive === true,
      // Tri-state on purpose: `null` means the pause result did not state
      // whether the save is stale, and that must never count as saved.
      saveStale: typeof value.saveStale === 'boolean' ? value.saveStale : null,
      ok: value.ok === true,
      error: value.error && typeof value.error === 'object' ? value.error : null,
    };
  }

  async function collectCoordinatedInstances(operationId) {
    const instances = runtimeInstances();
    const reports = [];
    let failedCount = 0;
    for (const instance of instances) {
      let pauseResult;
      try {
        if (typeof instance.controller?.setUpdateHold !== 'function') throw { code: GM.NO_RUNTIME };
        instance.controller.setUpdateHold(operationId, true);
        if (!heldRuntimes.has(operationId)) heldRuntimes.set(operationId, new Set());
        heldRuntimes.get(operationId).add(instance.controller);
        pauseResult = normalizePauseResult(await pauseInstance(instance.controller));
      } catch (error) {
        pauseResult = normalizePauseResult({
          ok: false,
          saveStale: true,
          unresponsive: true,
          error: normalizeUiError(error, GM.IFRAME_UNRESPONSIVE),
        });
      }
      const paused = pauseResult.unresponsive !== true;
      // Honest save semantics (AUD-02): only a platform pause that resolved
      // ok AND explicitly reported a non-stale save counts as saved. A missing
      // saveStale is unknown and therefore treated as stale (fail closed).
      const saved = pauseResult.ok === true && pauseResult.saveStale === false;
      const saveStale = pauseResult.saveStale !== false;
      const entry = {
        instanceId: instance.instanceId,
        gameId: instance.gameId,
        playSessionId: null,
        paused: paused,
        saved: saved,
        saveStale: saveStale,
        saveRevision: null,
      };
      if (!saved) {
        failedCount += 1;
        const code = pauseResult.error && typeof pauseResult.error.code === 'string' ? pauseResult.error.code : GM.SAVE_WRITE_FAILED;
        entry.error = { code: code };
      }
      reports.push(entry);
    }
    return { reports: reports, failedCount: failedCount };
  }

  function coordinateOperation(operationId) {
    if (coordinateInFlight || stopped || wasReported(operationId)) return Promise.resolve(null);
    const api = getApi();
    const page = identity();
    if (!api || typeof api.coordinate !== 'function' || !page) return Promise.resolve(null);
    // A new Host operation supersedes the old one; retire its holds before
    // acquiring the new hold synchronously in collectCoordinatedInstances.
    for (const id of heldRuntimes.keys()) if (id !== operationId) releaseRuntimeHolds(id);
    coordinateInFlight = true;
    dispatch(updateCoordinated({ operationId: operationId, status: 'working', failedCount: 0, at: now() }));
    return collectCoordinatedInstances(operationId)
      .then(async function send(collected) {
        const payload = {
          windowId: page.windowId,
          instances: collected.reports,
          idle: collected.reports.length === 0,
        };
        let lastError = null;
        let response = null;
        for (let attempt = 0; attempt < UPDATE_TIMING.coordinateAttempts; attempt += 1) {
          try {
            response = await api.coordinate(payload);
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            if (attempt < UPDATE_TIMING.coordinateAttempts - 1) await sleep(UPDATE_TIMING.coordinateRetryMs);
          }
        }
        if (lastError !== null) throw lastError;
        const phase = response && typeof response.phase === 'string' ? response.phase : null;
        const hostFailed = phase === 'failed';
        const failedCount = collected.failedCount > 0 ? collected.failedCount : hostFailed ? 1 : 0;
        rememberReported(operationId);
        dispatch(
          updateCoordinated({
            operationId: operationId,
            status: failedCount > 0 ? 'failed' : 'reported',
            failedCount: failedCount,
            at: now(),
          })
        );
        if (failedCount > 0) {
          toastError('update.toast.coordinationFailed');
        }
        return { ok: true, failedCount: failedCount, phase: phase };
      })
      .catch(function failed(error) {
        reportDiagnostic('update-coordinate-failed', error);
        dispatch(updateCoordinated({ operationId: operationId, status: 'failed', failedCount: 1, at: now() }));
        toastError('update.toast.coordinationFailed');
        return { ok: false, failedCount: 1 };
      })
      .finally(function done() {
        coordinateInFlight = false;
      });
  }

  // ---- user actions -------------------------------------------------------

  function refresh() {
    if (refreshInFlight) return Promise.resolve({ ok: false, busy: true });
    const api = getApi();
    if (!api || typeof api.refresh !== 'function') {
      dispatch(updateActionFailed({ code: GM.HOST_UNAVAILABLE, retryable: true }));
      return Promise.resolve({ ok: false });
    }
    refreshInFlight = true;
    dispatch(updateRefreshStarted());
    return Promise.resolve()
      .then(function request() {
        return api.refresh();
      })
      .then(function applied(data) {
        const inspection = normalizeInspection(data);
        dispatch(updateRefreshFinished(now(), inspection));
        if (inspection) applyInspection(inspection);
        else void inspect();
        return { ok: true };
      })
      .catch(function failed(error) {
        if (isUnsupportedError(error)) {
          unsupported = true;
          dispatch(updateUnsupported());
          clearAllTimers();
          return { ok: false, unsupported: true };
        }
        const normalized = normalizeUiError(error, GM.HOST_UNAVAILABLE);
        dispatch(updateRefreshFinished(now(), null));
        dispatch(updateActionFailed(normalized));
        reportDiagnostic('update-refresh-failed', error);
        return { ok: false, error: normalized };
      })
      .finally(function done() {
        refreshInFlight = false;
      });
  }

  function begin(targetId) {
    if (beginInFlight) return Promise.resolve({ ok: false, busy: true });
    const update = readUpdate();
    if (!update) return Promise.resolve({ ok: false, error: { code: GM.HOST_UNAVAILABLE } });
    const activeOperation = update.operation && isContinuingObservation(update.operation) ? update.operation : null;
    if (activeOperation !== null) {
      // Idempotent: repeated clicks / another window's operation keep the same
      // operationId; never start a second install.
      ensureObserve(activeOperation.operationId);
      return Promise.resolve({ ok: true, operationId: activeOperation.operationId, existing: true });
    }
    if (update.starting === true) return Promise.resolve({ ok: false, busy: true });
    const inspection = update.inspection;
    if (!inspection || !inspection.target) {
      dispatch(updateActionFailed({ code: GM.INVALID_PARAM, retryable: false }));
      return Promise.resolve({ ok: false, error: { code: GM.INVALID_PARAM } });
    }
    if (typeof targetId !== 'string' || targetId !== inspection.target.id) {
      // The UI may only begin a target that came from the verified discovery.
      dispatch(updateActionFailed({ code: GM.UPDATE_TARGET_INVALID, retryable: false }));
      return Promise.resolve({ ok: false, error: { code: GM.UPDATE_TARGET_INVALID } });
    }
    if (isDevSource(inspection.installed)) {
      dispatch(updateActionFailed({ code: GM.UPDATE_ADAPTER_UNAVAILABLE, retryable: false }));
      return Promise.resolve({ ok: false, blocked: true });
    }
    if (inspection.capability.canBeginUpdate !== true) {
      // Fail closed exactly like the Host: never show/allow a begin the Host
      // would refuse (unknown capability, dev source, anomaly, no target...).
      dispatch(updateActionFailed({ code: GM.UPDATE_ADAPTER_UNAVAILABLE, retryable: true }));
      return Promise.resolve({ ok: false, blocked: true });
    }
    const api = getApi();
    if (!api || typeof api.begin !== 'function') {
      dispatch(updateActionFailed({ code: GM.UPDATE_ADAPTER_UNAVAILABLE, retryable: false }));
      return Promise.resolve({ ok: false, error: { code: GM.UPDATE_ADAPTER_UNAVAILABLE } });
    }
    beginInFlight = true;
    dispatch(updateStarting(true));
    return Promise.resolve()
      .then(function request() {
        return api.begin(targetId);
      })
      .then(function started(data) {
        const operationId = data && typeof data.operationId === 'string' ? data.operationId : null;
        if (operationId === null) throw { code: GM.INTERNAL, retryable: true };
        currentOperationId = operationId;
        observeFailures = 0;
        scheduleObserve(0, operationId);
        scheduleClientReport();
        return { ok: true, operationId: operationId };
      })
      .catch(function failed(error) {
        const normalized = normalizeUiError(error, GM.INSTALL_FAILED);
        dispatch(updateStarting(false));
        dispatch(updateActionFailed(normalized));
        reportDiagnostic('update-begin-failed', error);
        return { ok: false, error: normalized };
      })
      .finally(function done() {
        beginInFlight = false;
      });
  }

  function cancel() {
    const update = readUpdate();
    const operation = update && update.operation ? update.operation : null;
    if (!operation || !isContinuingObservation(operation)) {
      return Promise.resolve({ ok: false, status: 'not-running' });
    }
    const api = getApi();
    if (!api || typeof api.cancel !== 'function') {
      dispatch(updateActionFailed({ code: GM.HOST_UNAVAILABLE, retryable: true }));
      return Promise.resolve({ ok: false });
    }
    dispatch(updateActionCleared());
    return Promise.resolve()
      .then(function request() {
        return api.cancel(operation.operationId);
      })
      .then(function applied(data) {
        const status = data && typeof data.status === 'string' ? data.status : 'not-running';
        const observation = normalizeObservation(data && data.observation);
        if (observation) dispatch(updateObservation(observation, now()));
        else if (status === 'too-late') scheduleObserve(0, operation.operationId);
        else if (status === 'cancelled') scheduleInspect(0);
        return { ok: true, status: status };
      })
      .catch(function failed(error) {
        const normalized = normalizeUiError(error, GM.INSTALL_FAILED);
        dispatch(updateActionFailed(normalized));
        reportDiagnostic('update-cancel-failed', error);
        return { ok: false, error: normalized };
      });
  }

  // ---- lifecycle ----------------------------------------------------------

  function start() {
    if (started) return;
    started = true;
    stopped = false;
    unsupported = false;
    void reportClient();
    scheduleInspect(0);
  }

  function stop() {
    stopped = true;
    started = false;
    clearAllTimers();
    currentOperationId = null;
  }

  function setVisibility(next) {
    if (next !== 'hidden' && next !== 'visible') return;
    if (stopped) return;
    if (next === 'visible') {
      inspectFailures = 0;
      observeFailures = 0;
      scheduleInspect(0);
      if (currentOperationId !== null) scheduleObserve(0, currentOperationId);
    } else {
      // Keep a slower poll running: a hidden tab may still own an active game
      // that the Host's coordination phase needs paused+saved.
      scheduleInspect();
    }
  }

  return {
    start: start,
    stop: stop,
    setVisibility: setVisibility,
    inspect: inspect,
    refresh: refresh,
    begin: begin,
    cancel: cancel,
    reportClient: reportClient,
    coordinateOperation: coordinateOperation,
    /** Tests: run one observation tick for the current operation. */
    tickObserve: function tickObserve() {
      if (currentOperationId === null) return Promise.resolve(null);
      return observeTick(currentOperationId);
    },
    getDiagnostics: function getDiagnostics() {
      return {
        started: started,
        unsupported: unsupported,
        inspectInFlight: inspectInFlight,
        observeInFlight: observeInFlight,
        currentOperationId: currentOperationId,
        reportedOperations: reportedOperations.slice(),
        inspectFailures: inspectFailures,
        observeFailures: observeFailures,
      };
    },
  };
}

let manager = null;

/** Plugin-wide manager wired to the real store and the update API route. */
export function getUpdateManager() {
  if (manager === null) {
    manager = createUpdateManager({
      store: defaultStore,
      getApi: function getUpdateApiClient() {
        return getUpdateApi();
      },
    });
  }
  return manager;
}

/** Test seam for the singleton. */
export function configureUpdateManager(next) {
  manager = next && typeof next === 'object' ? next : null;
  return function reset() {
    manager = null;
  };
}
