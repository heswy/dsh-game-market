/**
 * Play Session records (PRD §8.6.6, contracts.js `SessionRecord`).
 *
 * `start` adopts an existing unfinished session for the same game; `end` is
 * idempotent and never overwrites an already-closed record. V0 keeps
 * `outcome: 'running'` records across restarts (the crashed migration is V1);
 * `/health` reports how many are preserved.
 */

import { LIMITS, SESSION_OUTCOMES } from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import { hostError } from './errors.js';
import { createPlaySessionId } from './ids.js';
import { createKeyedSerialiser } from './serial.js';
import {
  isPlainObject,
  validateDshSessionId,
  validateFiniteNumber,
  validateGameId,
  validateOperationId,
  validatePlaySessionId,
} from './validation.js';

const OUTCOMES = new Set(SESSION_OUTCOMES);

function emptyFile(gameId) {
  return { schemaVersion: 1, gameId, records: [] };
}

function validOutcome(value) {
  return value === 'running' || value === 'crashed' || OUTCOMES.has(value);
}

function validRecord(record) {
  return (
    isPlainObject(record) &&
    typeof record.playSessionId === 'string' &&
    typeof record.startedAt === 'string' &&
    validOutcome(record.outcome)
  );
}

function sortRecords(records) {
  return records
    .slice()
    .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
}

export function createSessionsService({ storage, catalog, logger = null, now }) {
  const serialiseSession = createKeyedSerialiser();

  function filePath(gameId) {
    return storage.filePath('sessions', `${gameId}.json`);
  }

  async function readRecords(gameId) {
    const path = filePath(gameId);
    const result = await storage.readJson(path, { schemaVersion: 1 });
    if (!result) return emptyFile(gameId);
    const value = result.value;
    if (!isPlainObject(value) || value.gameId !== gameId || !Array.isArray(value.records)) {
      logger?.warn?.('[game-market/host] sessions-corrupt', `gameId=${gameId}`);
      return emptyFile(gameId);
    }
    const records = value.records.filter(validRecord);
    return { schemaVersion: 1, gameId, records: sortRecords(records).slice(0, LIMITS.sessionRecords) };
  }

  async function writeRecords(gameId, records) {
    const value = {
      schemaVersion: 1,
      gameId,
      records: sortRecords(records).slice(0, LIMITS.sessionRecords),
    };
    await storage.writeJson(filePath(gameId), value);
    return value;
  }

  async function start(body) {
    if (!isPlainObject(body)) throw hostError(GM.INVALID_PARAM, 'Request body must be an object');
    const gameId = validateGameId(body.gameId);
    return serialiseSession(gameId, () => startLocked(gameId, body));
  }

  async function startLocked(gameId, body) {
    const info = await catalog.get(gameId);
    const dshSessionId = validateDshSessionId(body.dshSessionId);
    validateOperationId(body.operationId);
    const file = await readRecords(gameId);
    const running = file.records.find((record) => record.outcome === 'running');
    if (running) {
      return {
        playSessionId: running.playSessionId,
        startedAt: running.startedAt,
        adopted: true,
      };
    }
    const playSessionId = createPlaySessionId();
    const startedAt = now().toISOString();
    const record = {
      playSessionId,
      dshSessionId,
      startedAt,
      endedAt: null,
      durationMs: 0,
      outcome: 'running',
      score: null,
      saveSchemaVersion:
        Number.isInteger(info.manifest.save?.schemaVersion) && info.manifest.save.schemaVersion >= 1
          ? info.manifest.save.schemaVersion
          : 1,
    };
    await writeRecords(gameId, [record, ...file.records]);
    return { playSessionId, startedAt, adopted: false };
  }

  async function end(body) {
    if (!isPlainObject(body)) throw hostError(GM.INVALID_PARAM, 'Request body must be an object');
    const gameId = validateGameId(body.gameId);
    return serialiseSession(gameId, () => endLocked(gameId, body));
  }

  async function endLocked(gameId, body) {
    await catalog.get(gameId);
    const playSessionId = validatePlaySessionId(body.playSessionId);
    if (!OUTCOMES.has(body.outcome)) {
      throw hostError(GM.INVALID_PARAM, 'Invalid session outcome');
    }
    validateOperationId(body.operationId);
    let score = null;
    if (body.score !== undefined && body.score !== null) {
      score = validateFiniteNumber(body.score, 'score');
    }
    const file = await readRecords(gameId);
    const index = file.records.findIndex((record) => record.playSessionId === playSessionId);
    if (index === -1) {
      throw hostError(GM.SESSION_STATE_CONFLICT, 'Unknown play session', { retryable: false });
    }
    const record = file.records[index];
    if (record.outcome !== 'running') {
      return {
        playSessionId: record.playSessionId,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
        outcome: record.outcome,
        score: typeof record.score === 'number' ? record.score : null,
        ignored: true,
      };
    }
    const endedAt = now().toISOString();
    const started = Date.parse(record.startedAt);
    const ended = Date.parse(endedAt);
    const durationMs = Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0;
    const updated = {
      ...record,
      endedAt,
      durationMs,
      outcome: body.outcome,
      score: score === null && typeof record.score === 'number' ? record.score : score,
    };
    const records = file.records.slice();
    records[index] = updated;
    await writeRecords(gameId, records);
    return {
      playSessionId: updated.playSessionId,
      startedAt: updated.startedAt,
      endedAt: updated.endedAt,
      outcome: updated.outcome,
      score: typeof updated.score === 'number' ? updated.score : null,
      ignored: false,
    };
  }

  async function findRunning(gameId) {
    validateGameId(gameId);
    const file = await readRecords(gameId);
    return file.records.find((record) => record.outcome === 'running') || null;
  }

  async function lastPlayedAt(gameId) {
    validateGameId(gameId);
    const file = await readRecords(gameId);
    let latest = null;
    for (const record of file.records) {
      const candidate = typeof record.endedAt === 'string' ? record.endedAt : record.startedAt;
      if (typeof candidate !== 'string') continue;
      const time = Date.parse(candidate);
      if (!Number.isFinite(time)) continue;
      if (latest === null || time > latest.time) latest = { time, at: candidate };
    }
    return latest ? latest.at : null;
  }

  async function countRunning() {
    const files = await storage.listDirectory('sessions');
    let count = 0;
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const result = await storage.readJson(file, { schemaVersion: 1 });
        if (!result || !Array.isArray(result.value.records)) continue;
        for (const record of result.value.records) {
          if (isPlainObject(record) && record.outcome === 'running') count += 1;
        }
      } catch (_error) {
        // One unreadable session file must not make /health fail.
      }
    }
    return count;
  }

  return { start, end, findRunning, lastPlayedAt, countRunning, readRecords, filePath };
}
