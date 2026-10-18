/**
 * Personal best + score history (PRD §8.3/§8.6.6, contracts.js `/scores`).
 *
 * Directions: higher-better is the default; lower-better is supported.
 * Best is never evicted; history is capped at 200 entries.
 */

import { LIMITS } from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import { hostError } from './errors.js';
import { createKeyedSerialiser } from './serial.js';
import {
  isPlainObject,
  jsonByteLength,
  validateFiniteNumber,
  validateGameId,
  validateOperationId,
  validatePlaySessionId,
  validateStoredValue,
} from './validation.js';

function emptyState(gameId, direction) {
  return { schemaVersion: 1, gameId, direction, best: null, history: [], submitCount: 0 };
}

function normalizeBest(value) {
  if (!isPlainObject(value)) return null;
  if (typeof value.value !== 'number' || !Number.isFinite(value.value)) return null;
  if (typeof value.at !== 'string') return null;
  return {
    value: value.value,
    at: value.at,
    playSessionId: typeof value.playSessionId === 'string' ? value.playSessionId : null,
  };
}

function normalizeHistory(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    if (typeof item.value !== 'number' || !Number.isFinite(item.value)) continue;
    if (typeof item.at !== 'string') continue;
    out.push({
      value: item.value,
      at: item.at,
      playSessionId: typeof item.playSessionId === 'string' ? item.playSessionId : null,
      ...(isPlainObject(item.meta) ? { meta: item.meta } : {}),
    });
  }
  return out.slice(0, LIMITS.scoreHistory);
}

function apiEntry(entry) {
  if (!entry) return null;
  return {
    value: entry.value,
    achievedAt: entry.at,
    playSessionId: entry.playSessionId,
    ...(isPlainObject(entry.meta) ? { meta: entry.meta } : {}),
  };
}

export function createScoresService({ storage, catalog, logger = null, now }) {
  const serialiseScore = createKeyedSerialiser();

  function filePath(gameId) {
    return storage.filePath('scores', `${gameId}.json`);
  }

  // operationId → result. In-memory only; a restart may replay a submission.
  const operationResults = new Map();

  async function readState(gameId, info) {
    const result = await storage.readJson(filePath(gameId), { schemaVersion: 1 });
    const manifestDirection = info.manifest.score?.direction === 'lower-better' ? 'lower-better' : 'higher-better';
    if (!result) return emptyState(gameId, manifestDirection);
    const value = result.value;
    if (!isPlainObject(value) || value.gameId !== gameId) {
      logger?.warn?.('[game-market/host] scores-corrupt', `gameId=${gameId}`);
      throw hostError(GM.SAVE_CORRUPT, 'Score file is corrupt');
    }
    const direction =
      value.direction === 'lower-better' || value.direction === 'higher-better'
        ? value.direction
        : manifestDirection;
    const submitCount = Number.isInteger(value.submitCount) && value.submitCount >= 0 ? value.submitCount : 0;
    return {
      schemaVersion: 1,
      gameId,
      direction,
      best: normalizeBest(value.best),
      history: normalizeHistory(value.history),
      submitCount,
    };
  }

  function validateManifestScore(info, score) {
    const config = info.manifest.score;
    if (!config) return;
    if (config.integer === true && !Number.isSafeInteger(score)) {
      throw hostError(GM.SCORE_OUT_OF_RANGE, 'Score must be an integer', {
        details: { min: config.min, max: config.max, integer: true },
      });
    }
    if (score < config.min || score > config.max) {
      throw hostError(GM.SCORE_OUT_OF_RANGE, 'Score is outside the declared range', {
        details: { min: config.min, max: config.max },
      });
    }
  }

  async function get(gameId) {
    validateGameId(gameId);
    const info = await catalog.get(gameId);
    const value = await readState(gameId, info);
    return {
      best: apiEntry(value.best),
      history: value.history.map(apiEntry),
      direction: value.direction,
    };
  }

  async function bestValue(gameId) {
    const value = await get(gameId);
    return value.best;
  }

  async function submit(body) {
    if (!isPlainObject(body)) throw hostError(GM.INVALID_PARAM, 'Request body must be an object');
    const gameId = validateGameId(body.gameId);
    return serialiseScore(gameId, () => submitLocked(gameId, body));
  }

  async function submitLocked(gameId, body) {
    const info = await catalog.get(gameId);
    if (!Array.isArray(info.manifest.capabilities) || !info.manifest.capabilities.includes('score')) {
      throw hostError(GM.CAPABILITY_DENIED, 'Game did not declare the score capability');
    }
    const score = validateFiniteNumber(body.score, 'score');
    validateManifestScore(info, score);
    const operationId = validateOperationId(body.operationId);
    const playSessionId =
      body.playSessionId === undefined || body.playSessionId === null
        ? null
        : validatePlaySessionId(body.playSessionId);

    let meta = null;
    if (body.meta !== undefined && body.meta !== null) {
      meta = validateStoredValue(body.meta);
      if (jsonByteLength(meta) > LIMITS.scoreMetaBytes) {
        throw hostError(GM.SAVE_TOO_LARGE, 'Score meta exceeds 2 KiB', {
          details: { limitBytes: LIMITS.scoreMetaBytes },
        });
      }
    }

    const operationKey = operationId ? `${gameId}:${operationId}` : null;
    if (operationKey && operationResults.has(operationKey)) {
      return operationResults.get(operationKey);
    }

    const value = await readState(gameId, info);
    const isBest =
      value.best === null
        ? true
        : value.direction === 'lower-better'
          ? score < value.best.value
          : score > value.best.value;
    const submittedAt = now().toISOString();
    const entry = {
      value: score,
      at: submittedAt,
      playSessionId,
      ...(meta ? { meta } : {}),
    };
    const best = isBest
      ? { value: score, at: submittedAt, playSessionId }
      : value.best;
    const history = [entry, ...value.history].slice(0, LIMITS.scoreHistory);
    const next = {
      schemaVersion: 1,
      gameId,
      direction: value.direction,
      best,
      history,
      submitCount: value.submitCount + 1,
    };
    await storage.writeJson(filePath(gameId), next);

    const result = { best: apiEntry(best), isBest, submittedAt };
    if (operationKey) {
      operationResults.set(operationKey, result);
      if (operationResults.size > 500) {
        const oldest = operationResults.keys().next().value;
        if (oldest !== undefined) operationResults.delete(oldest);
      }
    }
    return result;
  }

  return { get, submit, bestValue, filePath };
}
