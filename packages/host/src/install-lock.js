/**
 * Global install lock (V1-CONTRACTS §6.8, TBD-07):
 *
 *   - in-process mutex so one Host process serialises installs/uninstalls;
 *   - cross-process lock file `staging/.install.lock` with a 5s heartbeat;
 *   - a lock without a heartbeat for 30s can be taken over after a crash;
 *   - install waits up to 10s then returns `GM-4091`;
 *   - uninstall does not queue and returns `GM-4097` when the lock is busy.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { GM } from '../../shared/src/errors.js';
import { STAGING_DIR } from '../../shared/src/installation.js';
import { hostError } from './errors.js';
import { randomHex } from './ids.js';

export const INSTALL_LOCK_FILE = '.install.lock';
export const LOCK_HEARTBEAT_MS = 5000;
export const LOCK_STALE_MS = 30000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function busyError(code, message) {
  return hostError(code, message, { retryable: true });
}

export function createInstallLock({
  storage,
  logger = null,
  heartbeatMs = LOCK_HEARTBEAT_MS,
  staleMs = LOCK_STALE_MS,
}) {
  let held = false;
  const waiters = [];

  function lockPath() {
    return storage.filePath(STAGING_DIR, INSTALL_LOCK_FILE);
  }

  function passOwnership() {
    const next = waiters.shift();
    if (next) next();
    else held = false;
  }

  function makeProcessRelease() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      passOwnership();
    };
  }

  async function acquireInProcess(deadline, factory) {
    if (!held) {
      held = true;
      return makeProcessRelease();
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw factory();
    let timer = null;
    let granted = false;
    let grantResolve;
    const grantPromise = new Promise((resolve) => {
      grantResolve = resolve;
    });
    const waiter = () => {
      granted = true;
      grantResolve(true);
    };
    waiters.push(waiter);
    const timedOut = await Promise.race([
      grantPromise.then(() => false),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(true), remaining);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (!timedOut) return makeProcessRelease();
    const index = waiters.indexOf(waiter);
    if (index >= 0) {
      waiters.splice(index, 1);
    } else if (granted) {
      // Ownership was handed to us just as the timer fired: pass it on.
      passOwnership();
    }
    throw factory();
  }

  async function isStale() {
    let stats;
    try {
      stats = await fs.stat(lockPath());
    } catch (error) {
      if (error && error.code === 'ENOENT') return true;
      return false;
    }
    return Date.now() - stats.mtimeMs > staleMs;
  }

  async function acquireFile(deadline, factory) {
    const target = lockPath();
    try {
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    } catch (error) {
      if (error && ['EACCES', 'EPERM', 'EROFS', 'ENOSPC'].includes(error.code)) {
        throw hostError(
          error.code === 'ENOSPC' ? GM.INSTALL_DISK_FULL : GM.INSTALL_IO,
          'Could not create the install lock',
          { retryable: true }
        );
      }
      throw error;
    }
    const token = randomHex(8);
    for (;;) {
      try {
        const handle = await fs.open(target, 'wx', 0o600);
        try {
          await handle.writeFile(
            JSON.stringify({
              pid: process.pid,
              token,
              startedAt: new Date().toISOString(),
              heartbeatAt: new Date().toISOString(),
            }),
            'utf8'
          );
          await handle.sync();
        } finally {
          await handle.close();
        }
        const heartbeat = setInterval(() => {
          const stamp = new Date();
          fs.utimes(target, stamp, stamp).catch(() => undefined);
        }, heartbeatMs);
        if (typeof heartbeat.unref === 'function') heartbeat.unref();
        let released = false;
        return async () => {
          if (released) return;
          released = true;
          clearInterval(heartbeat);
          try {
            const raw = await fs.readFile(target, 'utf8');
            const owner = JSON.parse(raw);
            if (owner && owner.token === token) await fs.rm(target, { force: true });
          } catch (_error) {
            // A taken-over lock is no longer ours to delete.
          }
        };
      } catch (error) {
        if (!error || error.code !== 'EEXIST') {
          if (error && error.code === 'ENOSPC') {
            throw hostError(GM.INSTALL_DISK_FULL, 'Not enough disk space for this install');
          }
          if (error && ['EACCES', 'EPERM', 'EROFS', 'ENOTDIR'].includes(error.code)) {
            throw hostError(GM.INSTALL_IO, 'Could not create the install lock', { retryable: true });
          }
          throw error;
        }
        if (await isStale()) {
          logger?.warn?.('[game-market/host] install-lock-stale-takeover');
          await fs.rm(target, { force: true }).catch(() => undefined);
          continue;
        }
        if (Date.now() >= deadline) throw factory();
        const wait = Math.max(10, Math.min(100, deadline - Date.now()));
        await sleep(wait);
      }
    }
  }

  /**
   * Run `task` while holding the global lock.
   * @param {Function} task
   * @param {{waitMs?: number, busyCode?: string}} [options]
   */
  async function run(task, { waitMs = 0, busyCode = GM.INSTALL_IN_PROGRESS } = {}) {
    const deadline = Date.now() + Math.max(0, waitMs);
    const factory = () =>
      busyError(
        busyCode,
        busyCode === GM.UNINSTALL_BUSY
          ? 'Another install or uninstall is in progress'
          : 'Another install is in progress'
      );
    const releaseProcess = await acquireInProcess(deadline, factory);
    let releaseFile = null;
    try {
      releaseFile = await acquireFile(deadline, factory);
      return await task();
    } finally {
      if (releaseFile) await releaseFile().catch(() => undefined);
      releaseProcess();
    }
  }

  /** Non-blocking attempt used by startup maintenance. */
  async function tryRun(task) {
    try {
      return await run(task, { waitMs: 0, busyCode: GM.INSTALL_IN_PROGRESS });
    } catch (error) {
      if (error && error.code === GM.INSTALL_IN_PROGRESS) {
        logger?.info?.('[game-market/host] maintenance-skipped', 'reason=install-busy');
        return null;
      }
      throw error;
    }
  }

  return { run, tryRun, lockPath, isHeld: () => held };
}
