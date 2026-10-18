/**
 * Package entry (`packages/sdk/package.json` main). The bundle target used by
 * games is still `src/sdk.js`; this file only mirrors its public exports.
 */

import { GameError as GameErrorClass, createGameSDK as createSDK, isGameError as isGameErrorImpl } from './sdk.js';

export function createGameSDK(options = {}) {
  return createSDK(options);
}

export function isGameError(error) {
  return isGameErrorImpl(error);
}

export const GameError = GameErrorClass;
