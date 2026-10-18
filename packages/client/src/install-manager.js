/**
 * Serialized install/uninstall orchestration for the Client (PRD 9.5.3 / D-021,
 * V1-CONTRACTS 6.8 "global install lock").
 *
 * The Host serializes installs too; doing it on the Client as well keeps the UI
 * honest: one visible job runs at a time, later requests queue, and a busy Host
 * (GM-4091 / GM-4097) is retried a couple of times before surfacing an error.
 */
import { GM } from '../../shared/src/errors.js';
import { INSTALL_BUSY_RETRY_DELAYS_MS, INSTALL_STAGE_HINT_MS } from './constants.js';
import { installCleared, installStageChanged } from './store.js';
import { isBusyError, installFailureReasonKey, installFailureStage } from './errors-text.js';
import { normalizeUiError } from './ui-errors.js';
import { getMarketApi } from './api.js';
import { reportDiagnostic } from './diagnostics.js';
import { store } from './store.js';

function defaultScheduler() {
  return {
    setTimeout: function schedule(callback, delay) {
      const handle = setTimeout(callback, delay);
      if (handle && typeof handle.unref === 'function') handle.unref();
      return handle;
    },
    clearTimeout: function clear(handle) {
      clearTimeout(handle);
    },
  };
}

function sleep(ms, signal, scheduler) {
  return new Promise(function wait(resolve) {
    let settled = false;
    function finish() {
      if (settled) return;
      settled = true;
      scheduler.clearTimeout(timer);
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', finish);
      resolve();
    }
    const timer = scheduler.setTimeout(finish, ms);
    if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', finish);
  });
}

function noop() {}

/**
 * @param {{store: object, getApi: Function, now?: Function, scheduler?: object,
 *   stageHintMs?: number, retryDelays?: number[]}} options
 */
export function createInstallManager(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const target = opts.store;
  const getApi = typeof opts.getApi === 'function' ? opts.getApi : function unavailable() {
    return null;
  };
  const now = typeof opts.now === 'function' ? opts.now : function clock() {
    return Date.now();
  };
  const scheduler = opts.scheduler && typeof opts.scheduler.setTimeout === 'function' ? opts.scheduler : defaultScheduler();
  const stageHintMs = typeof opts.stageHintMs === 'number' ? opts.stageHintMs : INSTALL_STAGE_HINT_MS;
  const retryDelays = Array.isArray(opts.retryDelays) ? opts.retryDelays : INSTALL_BUSY_RETRY_DELAYS_MS;

  let tail = Promise.resolve();
  let active = null;
  const pending = new Map();

  function dispatch(action) {
    if (target && typeof target.dispatch === 'function') return target.dispatch(action);
    return null;
  }

  function enqueue(task) {
    const run = tail.then(task, task);
    tail = run.then(noop, noop);
    return run;
  }

  function jobFor(gameId) {
    const state = target && typeof target.getState === 'function' ? target.getState() : null;
    return state && state.installJobs ? state.installJobs[gameId] || null : null;
  }

  function finishFailure(gameId, kind, failure) {
    const code = failure && failure.code ? failure.code : GM.INTERNAL;
    dispatch(
      installStageChanged(gameId, 'failed', {
        kind: kind,
        error: { code: code, retryable: failure && failure.retryable === true },
        failureStage: installFailureStage(code),
        reasonKey: installFailureReasonKey(code),
        at: now(),
      })
    );
    return {
      ok: false,
      kind: kind,
      gameId: gameId,
      error: { code: code, retryable: Boolean(failure && failure.retryable === true) },
    };
  }

  async function runInstall(gameId, kind, request) {
    const operationId = request.operationId;
    const controller = request.controller;
    const signal = controller.signal;
    if (signal.aborted) {
      dispatch(installStageChanged(gameId, 'cancelled', { kind: kind, operationId: operationId, at: now() }));
      return { ok: false, kind: kind, gameId: gameId, cancelled: true, error: { code: GM.INSTALL_FAILED, retryable: false } };
    }
    dispatch(installStageChanged(gameId, 'queued', { kind: kind, operationId: operationId, at: now() }));
    if (typeof signal.addEventListener === 'function') {
      active = { gameId: gameId, kind: kind, controller: controller, operationId: operationId };
    }
    const hintTimer = scheduler.setTimeout(function showDownloading() {
      if (controller.signal.aborted) return;
      if (kind === 'uninstall') return;
      const job = jobFor(gameId);
      if (job && job.stage === 'queued') {
        dispatch(installStageChanged(gameId, 'downloading', { kind: kind, operationId: operationId, percent: null, at: now() }));
      }
    }, stageHintMs);

    try {
      let attempt = 0;
      for (;;) {
        try {
          const data = await request.call(controller);
          if (kind === 'uninstall') dispatch(installCleared(gameId));
          else dispatch(installStageChanged(gameId, 'installed', { kind: kind, operationId: operationId, at: now() }));
          return { ok: true, kind: kind, gameId: gameId, data: data, operationId: operationId };
        } catch (error) {
          if (controller.signal.aborted) {
            dispatch(installStageChanged(gameId, 'cancelled', { kind: kind, operationId: operationId, at: now() }));
            return { ok: false, kind: kind, gameId: gameId, cancelled: true, error: { code: GM.INSTALL_FAILED, retryable: false } };
          }
          const normalized = normalizeUiError(error, GM.INSTALL_FAILED);
          if (isBusyError(normalized.code) && attempt < retryDelays.length) {
            const delay = retryDelays[attempt];
            attempt += 1;
            await sleep(delay, signal, scheduler);
            continue;
          }
          if (error && error.code) {
            reportDiagnostic('install-failed:' + error.code, error);
          }
          return finishFailure(gameId, kind, normalized);
        }
      }
    } finally {
      scheduler.clearTimeout(hintTimer);
      if (active && active.gameId === gameId && active.kind === kind) active = null;
    }
  }

  function start(kind, gameId, request) {
    if (pending.has(gameId)) return pending.get(gameId);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (!controller) {
      return Promise.resolve(finishFailure(gameId, kind, { code: GM.HOST_UNAVAILABLE, retryable: false }));
    }
    const promise = enqueue(function run() {
      return runInstall(gameId, kind, {
        operationId: request.operationId,
        controller: controller,
        call: function call() {
          return request.call(controller.signal);
        },
      });
    });
    pending.set(gameId, promise);
    promise.then(noop, noop).then(function clear() {
      pending.delete(gameId);
    });
    return promise;
  }

  return {
    install: function install(gameId, request) {
      const input = request && typeof request === 'object' ? request : {};
      const api = getApi();
      if (!api || typeof api.install !== 'function') {
        return Promise.resolve(finishFailure(gameId, 'install', { code: GM.HOST_UNAVAILABLE, retryable: true }));
      }
      const operationId = input.operationId || (typeof api.operationId === 'function' ? api.operationId() : undefined);
      return start('install', gameId, {
        operationId: operationId,
        call: function call(signal) {
          return api.install({
            gameId: gameId,
            version: input.version,
            operationId: operationId,
            signal: signal,
          });
        },
      });
    },
    update: function update(gameId, request) {
      return this.install(gameId, request);
    },
    installLocal: function installLocal(input) {
      const request = input && typeof input === 'object' ? input : {};
      const gameId = typeof request.gameId === 'string' && request.gameId.length > 0 ? request.gameId : 'local:' + now();
      const api = getApi();
      if (!api || typeof api.installLocal !== 'function') {
        return Promise.resolve(finishFailure(gameId, 'local', { code: GM.HOST_UNAVAILABLE, retryable: true }));
      }
      const operationId = request.operationId || (typeof api.operationId === 'function' ? api.operationId() : undefined);
      return start('local', gameId, {
        operationId: operationId,
        call: function call(signal) {
          return api.installLocal({
            file: request.file,
            text: request.text,
            FileReader: request.FileReader,
            operationId: operationId,
            signal: signal,
          });
        },
      });
    },
    uninstall: function uninstall(gameId, request) {
      const input = request && typeof request === 'object' ? request : {};
      const api = getApi();
      if (!api || typeof api.uninstall !== 'function') {
        return Promise.resolve(finishFailure(gameId, 'uninstall', { code: GM.HOST_UNAVAILABLE, retryable: true }));
      }
      const operationId = input.operationId || (typeof api.operationId === 'function' ? api.operationId() : undefined);
      return start('uninstall', gameId, {
        operationId: operationId,
        call: function call(signal) {
          return api.uninstall({
            gameId: gameId,
            deleteData: input.deleteData === true,
            operationId: operationId,
            signal: signal,
          });
        },
      });
    },
    cancel: function cancel(gameId) {
      if (!active || active.gameId !== gameId) return false;
      try {
        active.controller.abort('cancelled');
      } catch (_error) {
        return false;
      }
      return true;
    },
    reportPercent: function reportPercent(gameId, percent) {
      if (typeof percent !== 'number' || !Number.isFinite(percent)) return;
      dispatch(installStageChanged(gameId, 'downloading', { percent: percent, at: now() }));
    },
    activeJob: function activeJob() {
      return active ? { gameId: active.gameId, kind: active.kind } : null;
    },
    isBusy: function isBusy() {
      return active !== null;
    },
  };
}

let manager = null;

/** Plugin-wide manager wired to the real store + Market API. */
export function getInstallManager() {
  if (manager === null) {
    manager = createInstallManager({ store: store, getApi: getMarketApi });
  }
  return manager;
}
