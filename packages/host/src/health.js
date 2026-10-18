/**
 * `/health` snapshot (PRD §8.5/§8.12, V1-CONTRACTS §7.3).
 *
 * Storage is probed against the filesystem on every call; registry and
 * installation counts are derived from the live services.
 */

import { GM } from '../../shared/src/errors.js';
import { hostError } from './errors.js';
import { compareVersions } from './semver.js';

export function createHealthService({
  storage,
  catalog,
  sessions,
  registry = null,
  installations = null,
  settings = null,
  availability,
  version,
  hostEpoch,
  devMode,
  startedAt,
  now = () => new Date(),
  logger = null,
}) {
  async function registrySnapshot() {
    if (!registry) {
      return {
        state: 'missing',
        sourceUrl: null,
        fetchedAt: null,
        truncated: false,
        count: 0,
        lastError: null,
      };
    }
    try {
      return await registry.snapshot();
    } catch (error) {
      logger?.warn?.('[game-market/host] health-registry-failed', `code=${error?.code || 'E_UNKNOWN'}`);
      return {
        state: 'missing',
        sourceUrl: null,
        fetchedAt: null,
        truncated: false,
        count: 0,
        lastError: error && error.code === GM.REGISTRY_UNAVAILABLE ? error.code : GM.REGISTRY_UNAVAILABLE,
      };
    }
  }

  async function installationSnapshot() {
    if (!installations) return { count: 0, updateAvailable: 0 };
    try {
      const file = await installations.read();
      const records = Object.values(file.games || {});
      let updateAvailable = 0;
      for (const record of records) {
        if (!registry || !record) continue;
        const entry = registry.findEntry(record.id);
        if (entry && typeof entry.version === 'string' && compareVersions(entry.version, record.version) > 0) {
          updateAvailable += 1;
        }
      }
      return { count: records.length, updateAvailable };
    } catch (error) {
      logger?.warn?.('[game-market/host] health-installations-failed', `code=${error?.code || 'E_UNKNOWN'}`);
      return { count: 0, updateAvailable: 0 };
    }
  }

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
    const [registryInfo, installationInfo] = await Promise.all([
      registrySnapshot(),
      installationSnapshot(),
    ]);
    const configIssues =
      settings && Array.isArray(settings.configIssues) && settings.configIssues.length > 0
        ? settings.configIssues.slice()
        : undefined;
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
      registry: registryInfo,
      installations: installationInfo,
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
      ...(configIssues ? { configIssues } : {}),
    };
  }

  return { snapshot, availability };
}
