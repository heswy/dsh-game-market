/**
 * asset-zip-v2 SDK access (V1.5-CONTRACTS §1.10).
 *
 * The platform serves the SDK as the package file `dsh-sdk.js`, loaded by
 * `index.html` as a classic script before the game bundle, so the app reads the
 * global instead of importing the vendor ESM wrapper (single-file mode).
 */

import type { Game, GameError } from '@dsh-game/sdk';

interface PlatformSdk {
  createGameSDK(): Game;
  /** Type predicate so `catch (error: unknown)` narrows like the vendor ESM wrapper. */
  isGameError(error: unknown): error is GameError;
}

function platformSdk(): PlatformSdk {
  const sdk = (globalThis as unknown as { DSH_GAME_SDK?: PlatformSdk }).DSH_GAME_SDK;
  if (!sdk || typeof sdk.createGameSDK !== 'function') {
    throw new Error('DSH_GAME_SDK is missing; entry docs must load dsh-sdk.js before the game bundle.');
  }
  return sdk;
}

export type { Game };

export function createGameSDK(): Game {
  return platformSdk().createGameSDK();
}

export function isGameError(error: unknown): error is GameError {
  return platformSdk().isGameError(error);
}

export function getGame(): Game {
  return createGameSDK();
}
