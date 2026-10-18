/**
 * `/health` snapshot (PRD §8.5/§8.12).
 *
 * Storage is probed against the filesystem on every call; session/save state is
 * never trusted from memory alone.
 */

import { GM } from '../../shared/src/errors.js';
import { hostError } from './errors.js';

export function createHealthService({
  storage,
  catalog,
  sessions,
  availability,
  version,
  hostEpoch,
  devMode,
  startedAt,
  now = () => new Date(),
  logger = null,
}) {
  async function snapshot() {
    if (!availability.available) {
      throw hostError(GM.HOST_UNAVAILABLE, 'Game Market Host is unavailable', { retryable: true });
    }
    const storageStatus = await storage.checkStatus();
    let running = null;
    try {
      running = await sessions.countRunning();
    } catch (error) {
      logger?.warn?.('[game-market/host] health-sessions-failed', `code=${error?.code || 'E_UNKNOWN'}`);
    }
    let gameDiagnostics = null;
    try {
      gameDiagnostics = await catalog.diagnostics();
    } catch (error) {
      logger?.warn?.('[game-market/host] health-games-failed', `code=${error?.code || 'E_UNKNOWN'}`);
    }
    return {
      ok: storageStatus.ok,
      version,
      hostEpoch,
      devMode,
      storage: {
        ok: storageStatus.ok,
        root: storageStatus.root,
        readOnly: storageStatus.readOnly,
      },
      uptimeMs: Math.max(0, now().getTime() - startedAt),
      sessions: {
        running,
        staleRunningPreserved: true,
      },
      games: {
        builtinCount: gameDiagnostics ? gameDiagnostics.items.length : null,
        issues: gameDiagnostics
          ? gameDiagnostics.items
              .filter((item) => item.issue !== null || item.entryAvailable === false)
              .map((item) => ({ gameId: item.gameId, issue: item.issue }))
          : [],
      },
    };
  }

  return { snapshot, availability };
}
