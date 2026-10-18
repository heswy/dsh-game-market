/**
 * Game Runtime entry (RuntimeController contract, packages/shared/src/contracts.js).
 *
 * `createGameRuntime({ container, api, environment, onEvent })` returns the
 * controller used by the Client. Runtime owns the sandbox iframe, the
 * postMessage bridge and the save scheduling; it never imports Client modules.
 */

import { createGameController } from './controller.js';
import { RUNTIME_STATES } from './state-machine.js';

export function createGameRuntime(options = {}) {
  return createGameController(options);
}

/** Introspection list for the Client / tests; not part of the controller API. */
export const RUNTIME_STATE_NAMES = RUNTIME_STATES;
