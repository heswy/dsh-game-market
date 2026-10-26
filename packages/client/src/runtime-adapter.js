/**
 * Thin, defensive wrapper around the Runtime package contract
 * (`createGameRuntime` from packages/runtime).
 *
 * The current checkout ships a stub that throws; the Client must degrade to an
 * error card instead of crashing the panel. The factory is injectable so tests
 * can exercise the wrapper without a browser.
 */
import { createGameRuntime } from '../../runtime/src/index.js';
import { GM, isGmCode, makeGameError } from '../../shared/src/errors.js';
import { TIMING } from '../../shared/src/constants.js';
import { normalizeUiError } from './ui-errors.js';

const CONTROLLER_METHODS = Object.freeze(['launch', 'pause', 'resume', 'destroy', 'getState']);

/** Check the documented RuntimeController surface. */
export function isRuntimeController(value) {
  if (!value || typeof value !== 'object') return false;
  for (const method of CONTROLLER_METHODS) {
    if (typeof value[method] !== 'function') return false;
  }
  return true;
}

/** Create a controller through a factory without letting exceptions escape. */
export function safeCreateRuntime(factory, options) {
  if (typeof factory !== 'function') {
    return { ok: false, error: makeGameError(GM.NO_RUNTIME, null, { retryable: false }) };
  }
  let controller = null;
  try {
    controller = factory(options);
  } catch (error) {
    return {
      ok: false,
      error: makeGameError(isGmCode(error && error.code) ? error.code : GM.NO_RUNTIME, null, {
        retryable: false,
      }),
    };
  }
  if (!isRuntimeController(controller)) {
    return { ok: false, error: makeGameError(GM.NO_RUNTIME, null, { retryable: false }) };
  }
  return { ok: true, controller: controller };
}

/** Production factory: the shared Runtime package entry. */
export function createRuntimeController(options) {
  return safeCreateRuntime(createGameRuntime, options);
}

/**
 * Run the leave protocol's pause step. A rejection is treated as an
 * unresponsive game; a resolved `{ok:false}` is a failed save.
 */
export async function pauseRuntime(controller) {
  if (!controller || typeof controller.pause !== 'function') {
    return {
      ok: false,
      saveStale: true,
      unresponsive: true,
      error: makeGameError(GM.NO_RUNTIME, null, { retryable: false }),
    };
  }
  try {
    const result = await controller.pause();
    const ok = Boolean(result && result.ok === true);
    if (!ok) {
      return {
        ok: false,
        saveStale: true,
        unresponsive: false,
        error: makeGameError(GM.SAVE_WRITE_FAILED, null, { retryable: true }),
      };
    }
    return { ok: true, saveStale: result.saveStale !== false, unresponsive: false, error: null };
  } catch (error) {
    return {
      ok: false,
      saveStale: true,
      unresponsive: true,
      error: normalizeUiError(error, GM.IFRAME_UNRESPONSIVE),
    };
  }
}

/**
 * Bound the leave protocol in the UI as a backstop: the Runtime should resolve
 * `pause()` within its save window, but a hung bridge must never freeze the
 * panel in a saving state.
 */
export async function pauseRuntimeBounded(controller, timeoutMs) {
  const limit = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : TIMING.saveTimeoutMs + 1000;
  let timer = null;
  const timeout = new Promise(function resolveTimeout(resolve) {
    timer = setTimeout(function fire() {
      resolve({
        ok: false,
        saveStale: true,
        unresponsive: true,
        error: makeGameError(GM.IFRAME_UNRESPONSIVE, null, { retryable: true }),
      });
    }, limit);
  });
  try {
    return await Promise.race([pauseRuntime(controller), timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** Resume a lightly paused Runtime; returns whether the call was accepted. */
export function resumeRuntime(controller) {
  if (!controller || typeof controller.resume !== 'function') return false;
  try {
    return controller.resume() !== false;
  } catch (_error) {
    return false;
  }
}

/**
 * Reload the current instance with its resource credential (V1.5 contract §7.2).
 * Returns whether the controller accepted the reload; failures surface through
 * the controller's own events/state machine.
 */
export function reloadRuntime(controller) {
  if (!controller || typeof controller.reload !== 'function') return false;
  try {
    const result = controller.reload();
    if (result && typeof result.then === 'function') {
      result.then(undefined, function ignore() {});
    }
    return true;
  } catch (_error) {
    return false;
  }
}

/** Destroy the catalogued controller exactly once, swallowing teardown errors. */
export function destroyRuntime(controller) {
  if (!controller || typeof controller.destroy !== 'function') return false;
  try {
    controller.destroy();
    return true;
  } catch (_error) {
    return false;
  }
}

/** Forward the latest Agent snapshot to the Runtime (used for SDK status). */
export function forwardAgentState(controller, snapshot) {
  if (!controller || typeof controller.handleAgentState !== 'function') return false;
  try {
    controller.handleAgentState(snapshot);
    return true;
  } catch (_error) {
    return false;
  }
}

/** Forward theme/reduced-motion changes when the Runtime exposes the method. */
export function updateRuntimeEnvironment(controller, environment) {
  if (!controller || typeof controller.updateEnvironment !== 'function') return false;
  try {
    controller.updateEnvironment(environment);
    return true;
  } catch (_error) {
    return false;
  }
}
