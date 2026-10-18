/**
 * Package entry (`packages/sdk/package.json` main). The bundle target used by
 * games is still `src/sdk.js`; this file mirrors its public exports, including
 * the lazy `game` singleton declared by PRD §8.3.
 */

import { GameError as GameErrorClass, createGameSDK as createSDK, isGameError as isGameErrorImpl } from './sdk.js';

export function createGameSDK(options = {}) {
  return createSDK(options);
}

export function isGameError(error) {
  return isGameErrorImpl(error);
}

export const GameError = GameErrorClass;

/** Lazy singleton: building it does not start the bridge handshake. */
export const game = createSDK();
