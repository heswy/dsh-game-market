/**
 * SDK-side error type. Every error crossing the bridge uses a `GM-*` code so
 * games can branch on a stable, documented surface (PRD §8.3 / D-030).
 */

import { GM, defaultMessageFor, isGmCode } from '../../shared/src/errors.js';

export class GameError extends Error {
  /**
   * @param {string} code GM code
   * @param {string} [message]
   * @param {{retryable?: boolean, details?: object}} [options]
   */
  constructor(code, message, options = {}) {
    const gmCode = isGmCode(code) ? code : GM.INTERNAL;
    super(message || defaultMessageFor(gmCode));
    this.name = 'GameError';
    this.code = gmCode;
    this.retryable = options.retryable === true;
    if (options.details !== undefined) this.details = options.details;
  }
}

export function createGameError(code, message, options = {}) {
  return new GameError(code, message, options);
}

export function isGameError(error) {
  if (error instanceof GameError) return true;
  return Boolean(error) && typeof error === 'object' && isGmCode(error.code) && typeof error.message === 'string';
}

/** Never leak a non-GM error object across the public SDK surface. */
export function toGameError(error) {
  if (isGameError(error)) {
    if (error instanceof GameError) return error;
    return new GameError(error.code, error.message, {
      retryable: error.retryable === true,
      details: error.details,
    });
  }
  return new GameError(GM.INTERNAL, defaultMessageFor(GM.INTERNAL), { retryable: false });
}
