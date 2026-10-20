/**
 * Startup maintenance (V1-CONTRACTS §6.3 step 12, §6.8 "崩溃恢复"; PRD §8.7.4).
 *
 * Runs once on Host start, under the global install lock when it is free:
 *   - clears abandoned `staging/<jobId>/` directories;
 *   - deletes `trash/` entries older than 7 days;
 *   - removes package version directories outside the current+previous window
 *     and whole `packages/<id>` trees that have no installation record;
 *   - marks records whose `entry.html` disappeared as `compatibility.broken`.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { ASSET_ZIP_V2, DESCRIPTOR_FILE } from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import {
  ENTRY_FILE,
  PACKAGES_DIR,
  PREVIEW_CACHE_DIR,
  STAGING_DIR,
  TRASH_DIR,
} from '../../shared/src/installation.js';
import { hostError } from './errors.js';
import { verifyInstalledRecord } from './installations.js';
import { INSTALL_LOCK_FILE } from './install-lock.js';
import { parseVersion } from './semver.js';
import { isInside } from './validation.js';

const TRASH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TRASH_NAME_RE = /^(.+)-(\d{8}T\d{9}Z)(?:-[a-f0-9]{2,8})?$/;

function trashTimestamp(name) {
  const match = TRASH_NAME_RE.exec(name);
  if (!match) return null;
  const compact = match[2];
  const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(
    9,
    11
  )}:${compact.slice(11, 13)}:${compact.slice(13, 15)}.${compact.slice(15, 18)}Z`;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

async function pathExists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (_error) {
    return false;
  }
}

async function listDirectory(directory) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (_error) {
    return [];
  }
}

export function createMaintenanceService({
  storage,
  installations,
  registry = null,
  lock,
  logger = null,
  now = () => new Date(),
  trashTtlMs = TRASH_TTL_MS,
  resources = null,
}) {
  let ready = null;

  /** A fresh storage root stays empty: maintenance only runs when needed. */
  async function hasAnythingToClean() {
    for (const relative of [STAGING_DIR, TRASH_DIR, PACKAGES_DIR]) {
      if (await pathExists(storage.filePath(relative))) return true;
    }
    return false;
  }

  async function cleanStaging() {
    const directory = storage.filePath(STAGING_DIR);
    let removed = 0;
    for (const entry of await listDirectory(directory)) {
      if (entry.name === INSTALL_LOCK_FILE) continue;
      const target = path.join(directory, entry.name);
      if (!isInside(directory, target)) continue;
      try {
        await fs.rm(target, { recursive: true, force: true });
        removed += 1;
      } catch (error) {
        logger?.warn?.('[game-market/host] staging-cleanup-failed', `code=${error?.code || 'E_UNKNOWN'}`);
      }
    }
    return removed;
  }

  async function cleanTrash() {
    const directory = storage.filePath(TRASH_DIR);
    const cutoff = now().getTime() - trashTtlMs;
    let removed = 0;
    for (const entry of await listDirectory(directory)) {
      const target = path.join(directory, entry.name);
      if (!isInside(directory, target)) continue;
      let timestamp = trashTimestamp(entry.name);
      if (timestamp === null) {
        try {
          const stats = await fs.lstat(target);
          timestamp = stats.mtimeMs;
        } catch (_error) {
          timestamp = null;
        }
      }
      if (timestamp === null || timestamp > cutoff) continue;
      try {
        await fs.rm(target, { recursive: true, force: true });
        removed += 1;
      } catch (error) {
        logger?.warn?.('[game-market/host] trash-cleanup-failed', `code=${error?.code || 'E_UNKNOWN'}`);
      }
    }
    return removed;
  }

  async function moveToTrash(targetPath, id) {
    const stamp = now().toISOString().replace(/[-:.]/g, '');
    let target = storage.filePath(TRASH_DIR, `${id}-${stamp}`);
    if (await pathExists(target)) {
      target = storage.filePath(TRASH_DIR, `${id}-${stamp}-${Math.random().toString(16).slice(2, 6)}`);
    }
    try {
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.rename(targetPath, target);
    } catch (error) {
      if (error && error.code === 'ENOENT') return false;
      throw error;
    }
    return true;
  }

  /**
   * §6.5 consistency check. One implementation only: the installer's
   * `verifyInstalledRecord` (host-zip) decides entry existence, html-v1 sha256
   * and the `asset-zip-v2` descriptor/digest checks. Maintenance only records
   * the verdict and never deletes data.
   */
  async function recordIssue(record) {
    const verification = await verifyInstalledRecord(record, { storage });
    return verification.ok ? null : verification.reason || 'record-invalid';
  }

  function markBroken(record, reasons = ['entry-missing']) {
    const already = record.compatibility && record.compatibility.status === 'broken';
    const wanted = Array.isArray(reasons) && reasons.length > 0 ? reasons.slice() : ['entry-missing'];
    // Keep the first observed reason set: it is the actual state maintenance saw.
    if (already) return false;
    record.compatibility = {
      ...(record.compatibility || {}),
      status: 'broken',
      reasons: wanted,
      checkedAt: now().toISOString(),
    };
    return true;
  }

  async function cleanPackages(file) {
    const summary = { removedDirectories: 0, prunedVersions: 0, brokenRecords: 0 };
    const directory = storage.filePath(PACKAGES_DIR);
    const records = file.games || {};
    let recordsChanged = false;

    for (const entry of await listDirectory(directory)) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const idDirectory = path.join(directory, id);
      if (!isInside(directory, idDirectory)) continue;
      const record = records[id];
      if (!record) {
        try {
          if (await moveToTrash(idDirectory, id)) summary.removedDirectories += 1;
        } catch (_error) {
          logger?.warn?.('[game-market/host] orphan-package-cleanup-failed', `gameId=${id}`);
        }
        continue;
      }
      const keep = new Set([record.version, record.previousVersion].filter((value) => typeof value === 'string'));
      for (const child of await listDirectory(idDirectory)) {
        if (!child.isDirectory()) continue;
        const versionDirectory = path.join(idDirectory, child.name);
        if (!isInside(idDirectory, versionDirectory)) continue;
        if (keep.has(child.name) && parseVersion(child.name) !== null) continue;
        if (parseVersion(child.name) === null) continue;
        try {
          if (await moveToTrash(versionDirectory, id)) summary.prunedVersions += 1;
        } catch (_error) {
          logger?.warn?.('[game-market/host] version-cleanup-failed', `gameId=${id}`);
        }
      }
      const issue = await recordIssue(record);
      if (issue !== null && markBroken(record, [issue])) {
        recordsChanged = true;
        summary.brokenRecords += 1;
        logger?.warn?.('[game-market/host] package-inconsistent', `gameId=${id}`, `reason=${issue}`);
      }
      if (record.previousVersion) {
        const previousDirectory = path.join(idDirectory, record.previousVersion);
        const previousFormat = record.previousFormat === ASSET_ZIP_V2 ? ASSET_ZIP_V2 : 'html-v1';
        const previousMarker = previousFormat === ASSET_ZIP_V2
          ? path.join(previousDirectory, DESCRIPTOR_FILE)
          : path.join(previousDirectory, ENTRY_FILE);
        if (!(await pathExists(previousMarker))) {
          record.previousVersion = null;
          recordsChanged = true;
        }
      }
    }

    for (const [id, record] of Object.entries(records)) {
      const issue = await recordIssue(record);
      if (issue !== null && markBroken(record, [issue])) {
        recordsChanged = true;
        summary.brokenRecords += 1;
        logger?.warn?.('[game-market/host] package-inconsistent', `gameId=${id}`, `reason=${issue}`);
      }
    }

    if (recordsChanged) {
      try {
        await installations.write(file);
      } catch (error) {
        logger?.warn?.('[game-market/host] installations-repair-failed', `code=${error?.code || 'E_UNKNOWN'}`);
      }
    }
    return summary;
  }

  async function cleanPreviewCache(file) {
    if (!registry) return 0;
    let removed = 0;
    const directory = storage.filePath(PREVIEW_CACHE_DIR);
    const records = file.games || {};
    for (const entry of await listDirectory(directory)) {
      if (!entry.isDirectory()) continue;
      const record = records[entry.name];
      if (!record) continue; // Registry-only entries keep their previews.
      const versions = new Set(
        [record.version, record.previousVersion].filter((value) => typeof value === 'string')
      );
      const gameDirectory = path.join(directory, entry.name);
      for (const child of await listDirectory(gameDirectory)) {
        if (!child.isDirectory() || versions.has(child.name)) continue;
        const target = path.join(gameDirectory, child.name);
        if (!isInside(gameDirectory, target)) continue;
        try {
          await fs.rm(target, { recursive: true, force: true });
          removed += 1;
        } catch (_error) {
          // Best effort.
        }
      }
    }
    return removed;
  }

  async function cleanup() {
    await storage.ensureReady();
    if (storage.readOnly) return { skipped: 'store-readonly' };
    const file = await installations.read();
    const staging = await cleanStaging();
    const trash = await cleanTrash();
    const packages = await cleanPackages(file);
    const previews = await cleanPreviewCache(file);
    // Expired/released runtime resource credentials are memory-only; a sweep
    // keeps the instance map from accumulating across a long-lived session.
    let resourceInstancesPruned = 0;
    if (resources && typeof resources.pruneExpired === 'function') {
      try {
        resourceInstancesPruned = resources.pruneExpired();
      } catch (error) {
        logger?.warn?.('[game-market/host] resource-sweep-failed', `code=${error?.code || 'E_UNKNOWN'}`);
      }
    }
    return {
      stagingRemoved: staging,
      trashRemoved: trash,
      packages,
      previewEntriesRemoved: previews,
      resourceInstancesPruned,
    };
  }

  async function runStartup() {
    try {
      // Resource credentials are memory-only; a restart starts from an empty
      // instance map, but pruning keeps the observable promise explicit.
      if (resources && typeof resources.pruneExpired === 'function') {
        try {
          resources.pruneExpired();
        } catch (_error) {
          // Never let a credential sweep block filesystem maintenance.
        }
      }
      await storage.ensureReady();
      if (!(await hasAnythingToClean())) return { skipped: 'empty' };
      if (!lock) return await cleanup();
      const result = await lock.tryRun(cleanup);
      return result === null ? { skipped: 'install-busy' } : result;
    } catch (error) {
      if (error && error.code === GM.INSTALL_IO) logger?.warn?.('[game-market/host] maintenance-failed');
      else logger?.warn?.('[game-market/host] maintenance-failed', `code=${error?.code || 'E_UNKNOWN'}`);
      throw hostError(GM.INSTALL_IO, 'Startup maintenance failed', { retryable: true, cause: error });
    }
  }

  function start() {
    if (ready) return ready;
    ready = runStartup().catch((error) => {
      logger?.warn?.('[game-market/host] maintenance-skipped', `code=${error?.code || 'E_UNKNOWN'}`);
      return null;
    });
    return ready;
  }

  return { start, runStartup, ready: () => start() };
}
