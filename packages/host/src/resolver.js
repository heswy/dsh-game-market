/**
 * "Known game" resolver for save/session/score services (V1).
 *
 * V0 services were built around the built-in catalog only. V1 installed and
 * dev games must be able to save/score too, so those services receive this
 * resolver, which exposes the same `get(gameId) -> {manifest, ...}` shape.
 */

import { GM } from '../../shared/src/errors.js';
import { hostError } from './errors.js';
import { validateGameId } from './validation.js';

export function createGameResolver({ catalog, installations, devCatalog = null }) {
  async function get(gameId) {
    validateGameId(gameId);
    if (devCatalog) {
      const dev = await devCatalog.get(gameId);
      if (dev) return { gameId, version: dev.version, manifest: dev.manifest, source: 'dev' };
    }
    const record = await installations.get(gameId);
    if (record && record.manifest) {
      return { gameId, version: record.version, manifest: record.manifest, source: record.source };
    }
    try {
      return await catalog.get(gameId);
    } catch (error) {
      if (error && error.code === GM.GAME_NOT_FOUND) {
        throw hostError(GM.GAME_NOT_FOUND, 'Game not found', { retryable: false });
      }
      throw error;
    }
  }

  async function exists(gameId) {
    try {
      await get(gameId);
      return true;
    } catch (_error) {
      return false;
    }
  }

  return { get, exists };
}
