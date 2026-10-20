/**
 * Continue support: persist the resumable part of a run through the SDK storage
 * capability, and decide whether the start screen should offer "continue".
 *
 * Save key `run` (game-scoped by the host storage). The save envelope mirrors
 * `logic.serializeRun()`; `savedAt` is added by this module so the UI can show
 * how old a run is without the rule engine knowing about wall-clock time.
 */

import { RUN_STORAGE_KEY, hydrateRun, shouldOfferContinue, createRunState } from './logic.js';
import { bestScoreOf, unwrapStorageValue } from './storage-shapes.js';

export const SAVE_VERSION = 1;

export async function loadSave(adapter) {
  try {
    // The host returns `{key,data,revision,updatedAt}`; the payload we persist
    // lives in `.data`. Never treat the envelope as the save itself.
    const loaded = await adapter.storage.load(RUN_STORAGE_KEY);
    const save = unwrapStorageValue(loaded);
    if (!shouldOfferContinue(save)) return null;
    return save;
  } catch (error) {
    return null;
  }
}

export async function writeSave(adapter, state) {
  const payload = {
    ...(state && typeof state === 'object' ? { ...state } : {}),
    savedAt: new Date().toISOString(),
  };
  try {
    await adapter.storage.save(RUN_STORAGE_KEY, payload);
    return true;
  } catch (error) {
    return false;
  }
}

export async function clearSave(adapter) {
  try {
    await adapter.storage.remove(RUN_STORAGE_KEY);
    return true;
  } catch (error) {
    return false;
  }
}

/** Build a paused run from a save, or a fresh run when the save is unusable. */
export function resumeFromSave(level, save, options = {}) {
  const state = hydrateRun(level, save, options);
  if (!state) return createRunState(level, options);
  return state;
}

/** Read the personal best once per boot; failures degrade to "no best". */
export async function readBest(adapter) {
  try {
    const best = await adapter.score.getBest();
    return bestScoreOf(best);
  } catch (error) {
    return 0;
  }
}

export async function submitScore(adapter, score) {
  if (!Number.isFinite(score) || score < 0) return null;
  try {
    return await adapter.score.submit(Math.round(score));
  } catch (error) {
    return null;
  }
}
