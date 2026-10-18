/**
 * Plugin-owned JSON persistence (PRD §8.6, D-009).
 *
 * - Atomic write: same-directory `.tmp` → fsync → copy previous to `.bak` →
 *   rename → directory fsync.
 * - In-process writes for one path are serialised with a promise chain.
 * - Cross-process writes use `<file>.lock` (`open(..., 'wx')`) with bounded
 *   retries and stale-lock takeover.
 * - Reads recover from `.bak`; unrecoverable files are quarantined as
 *   `.<name>.corrupt-<timestamp>` and treated as missing.
 * - An unwritable root flips the store to read-only and returns GM-5025; data
 *   is never silently dropped.
 */

import { constants as fsConstants, promises as fs } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';

import { GM } from '../../shared/src/errors.js';
import { GM_STORE_IO, GM_STORE_READONLY, hostError, isHostError } from './errors.js';
import { randomHex } from './ids.js';
import { isInside, isPlainObject } from './validation.js';

const MAX_READ_BYTES = 8 * 1024 * 1024;
const LOCK_STALE_MS = 10 * 1000;
const LOCK_RETRY_DELAYS_MS = Object.freeze([50, 150, 400]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


export class HostStorage {
  constructor({ root, logger = null }) {
    this.root = root;
    this.logger = logger;
    this.readOnly = false;
    this.initialized = false;
    this.initFailure = null;
    this.readyPromise = null;
    this.writeChains = new Map();
    this.corruptSequence = 0;
  }

  /** Resolve a path under the storage root, rejecting escapes. */
  filePath(...segments) {
    const target = path.resolve(this.root, ...segments.map((segment) => String(segment)));
    if (!isInside(this.root, target)) {
      throw hostError(GM.INVALID_PARAM, 'Invalid storage path');
    }
    return target;
  }

  async ensureReady() {
    if (this.initialized || this.readOnly) return;
    if (!this.readyPromise) this.readyPromise = this.#initialise();
    await this.readyPromise;
  }

  async #initialise() {
    try {
      await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
      const info = await fs.stat(this.root);
      if (!info.isDirectory()) {
        const error = new Error('storage root is not a directory');
        error.code = 'ENOTDIR';
        throw error;
      }
      await fs.access(this.root, fsConstants.W_OK);
      this.initialized = true;
      this.readOnly = false;
      this.initFailure = null;
    } catch (error) {
      this.initialized = false;
      this.readOnly = true;
      this.initFailure = error && typeof error.code === 'string' ? error.code : 'EACCES';
      this.logger?.warn?.('[game-market/host] storage-readonly', `code=${this.initFailure}`);
    }
  }

  /** Real read-only probe used by `/health` (re-checks the filesystem). */
  async checkStatus() {
    this.readyPromise = null;
    this.initialized = false;
    this.readOnly = false;
    await this.#initialise();
    return { ok: !this.readOnly, root: this.root, readOnly: this.readOnly };
  }

  status() {
    return { ok: !this.readOnly, root: this.root, readOnly: this.readOnly };
  }

  #markReadOnly(code) {
    if (!this.readOnly) {
      this.logger?.warn?.('[game-market/host] storage-readonly', `code=${code || 'EACCES'}`);
    }
    this.readOnly = true;
    this.initialized = false;
  }

  #readOnlyError() {
    return hostError(GM_STORE_READONLY, 'Storage is read-only', { retryable: false });
  }

  #ioError(error) {
    return hostError(GM_STORE_IO, 'Storage I/O failed', {
      retryable: true,
      cause: error,
    });
  }

  async readJson(file, { schemaVersion } = {}) {
    await this.ensureReady();
    if (!isInside(this.root, path.resolve(file))) {
      throw hostError(GM.INVALID_PARAM, 'Invalid storage path');
    }
    const primary = await this.#readCandidate(file, schemaVersion);
    if (primary.state === 'newer') throw this.#schemaNewerError();
    if (primary.state === 'ok') return { value: primary.value, recovered: false, source: 'primary' };

    if (primary.state === 'missing') {
      const backup = await this.#readCandidate(`${file}.bak`, schemaVersion);
      if (backup.state === 'newer') throw this.#schemaNewerError();
      if (backup.state === 'ok') {
        return { value: backup.value, recovered: true, source: 'backup' };
      }
      if (backup.state === 'corrupt') await this.#quarantine(`${file}.bak`);
      return null;
    }

    // Primary is corrupt: preserve the evidence, then prefer the backup.
    await this.#quarantine(file);
    const backup = await this.#readCandidate(`${file}.bak`, schemaVersion);
    if (backup.state === 'newer') throw this.#schemaNewerError();
    if (backup.state === 'ok') {
      this.logger?.warn?.('[game-market/host] storage-recovered', 'source=backup');
      return { value: backup.value, recovered: true, source: 'backup' };
    }
    if (backup.state === 'corrupt') await this.#quarantine(`${file}.bak`);
    this.logger?.warn?.('[game-market/host] storage-corrupt', 'source=missing');
    return null;
  }

  #schemaNewerError() {
    return hostError(GM.SCHEMA_READ_TOO_NEW, 'Stored data needs a newer Game Market', {
      retryable: false,
    });
  }

  async #readCandidate(file, expectedSchemaVersion) {
    let info;
    try {
      info = await fs.stat(file);
    } catch (error) {
      if (error && error.code === 'ENOENT') return { state: 'missing' };
      throw this.#ioError(error);
    }
    if (!info.isFile()) return { state: 'corrupt' };
    if (info.size > MAX_READ_BYTES) {
      this.logger?.warn?.('[game-market/host] storage-file-too-large', `bytes=${info.size}`);
      return { state: 'corrupt' };
    }
    let raw;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') return { state: 'missing' };
      throw this.#ioError(error);
    }
    let value;
    try {
      value = JSON.parse(raw);
    } catch (_error) {
      return { state: 'corrupt' };
    }
    if (!isPlainObject(value)) return { state: 'corrupt' };
    if (expectedSchemaVersion !== undefined) {
      const version = value.schemaVersion;
      if (version !== undefined && (!Number.isInteger(version) || version < 0)) {
        return { state: 'corrupt' };
      }
      if (Number.isInteger(version) && version > expectedSchemaVersion) return { state: 'newer' };
    }
    return { state: 'ok', value, stats: info };
  }

  async #quarantine(file) {
    this.corruptSequence += 1;
    const directory = path.dirname(file);
    const base = path.basename(file);
    const target = path.join(
      directory,
      `.${base}.corrupt-${Date.now()}-${this.corruptSequence}-${randomHex(4)}`
    );
    try {
      await fs.rename(file, target);
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        this.logger?.warn?.('[game-market/host] storage-quarantine-failed', `code=${error.code || 'EUNKNOWN'}`);
      }
    }
  }

  /**
   * Atomically write one JSON file. Serialised per path in-process and guarded
   * by a cross-process lock file.
   */
  async writeJson(file, value, { lock = true } = {}) {
    await this.ensureReady();
    if (this.readOnly) throw this.#readOnlyError();
    this.filePath(); // touch root validation
    if (!isInside(this.root, path.resolve(file))) {
      throw hostError(GM.INVALID_PARAM, 'Invalid storage path');
    }
    let text;
    try {
      text = JSON.stringify(value);
    } catch (_error) {
      throw hostError(GM.VALUE_NOT_SERIALIZABLE, 'Value is not JSON-serializable', { retryable: false });
    }
    if (typeof text !== 'string') {
      throw hostError(GM.VALUE_NOT_SERIALIZABLE, 'Value is not JSON-serializable', { retryable: false });
    }
    return this.#enqueue(file, () => this.#writeAtomic(file, text, lock));
  }

  #enqueue(file, task) {
    const previous = this.writeChains.get(file) || Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.writeChains.set(file, current);
    const cleanup = () => {
      if (this.writeChains.get(file) === current) this.writeChains.delete(file);
    };
    current.then(cleanup, cleanup);
    return current;
  }

  async #writeAtomic(file, text, lock) {
    const directory = path.dirname(file);
    const base = path.basename(file);
    const temporary = path.join(directory, `.${base}.${process.pid}.${randomHex(6)}.tmp`);
    let release = async () => {};
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      if (lock) release = await this.#acquireLock(`${file}.lock`);
      const handle = await fs.open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(text, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.copyFile(file, `${file}.bak`).catch(() => undefined);
      await fs.rename(temporary, file);
      await this.#syncDirectory(directory);
      return { bytes: Buffer.byteLength(text, 'utf8') };
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      if (isHostError(error)) throw error;
      if (error && ['EACCES', 'EPERM', 'EROFS', 'ENOTDIR'].includes(error.code)) {
        this.#markReadOnly(error.code);
        throw this.#readOnlyError();
      }
      throw hostError(GM.SAVE_WRITE_FAILED, 'Could not write storage file', {
        retryable: true,
        cause: error,
      });
    } finally {
      await release().catch(() => undefined);
    }
  }

  async #syncDirectory(directory) {
    let handle;
    try {
      handle = await fs.open(directory, 'r');
      await handle.sync();
    } catch (_error) {
      // Directory fsync is unavailable on some platforms; rename is still atomic.
    } finally {
      if (handle) await handle.close().catch(() => undefined);
    }
  }

  async #acquireLock(lockPath) {
    for (let attempt = 0; attempt <= LOCK_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const handle = await fs.open(lockPath, 'wx', 0o600);
        try {
          await handle.writeFile(
            JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), host: hostname() }),
            'utf8'
          );
        } finally {
          await handle.close();
        }
        return async () => {
          await fs.rm(lockPath, { force: true }).catch(() => undefined);
        };
      } catch (error) {
        if (!error || error.code !== 'EEXIST') throw error;
        if (await this.#breakStaleLock(lockPath)) continue;
        if (attempt >= LOCK_RETRY_DELAYS_MS.length) break;
        await sleep(LOCK_RETRY_DELAYS_MS[attempt]);
      }
    }
    throw hostError(GM.STORAGE_CONFLICT, 'Storage is busy', { retryable: true });
  }

  async #breakStaleLock(lockPath) {
    let info;
    try {
      info = await fs.stat(lockPath);
    } catch (error) {
      if (error && error.code === 'ENOENT') return true;
      return false;
    }
    if (Date.now() - info.mtimeMs <= LOCK_STALE_MS) return false;
    let owner = null;
    try {
      owner = JSON.parse(await fs.readFile(lockPath, 'utf8'));
    } catch (_error) {
      owner = null;
    }
    if (owner && Number.isInteger(owner.pid) && owner.pid > 0 && owner.pid !== process.pid) {
      try {
        process.kill(owner.pid, 0);
        return false;
      } catch (error) {
        if (!error || error.code !== 'ESRCH') return false;
      }
    }
    try {
      await fs.rm(lockPath, { force: true });
      return true;
    } catch (_error) {
      return false;
    }
  }

  /** Wait for every queued write (used on plugin dispose). */
  async flush() {
    while (this.writeChains.size > 0) {
      await Promise.allSettled([...this.writeChains.values()]);
    }
  }

  /** List regular files inside a directory under the root; missing → []. */
  async listDirectory(relativeDirectory) {
    await this.ensureReady();
    const directory = this.filePath(relativeDirectory);
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') return [];
      throw this.#ioError(error);
    }
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(directory, entry.name))
      .sort();
  }
}

export function createStorage(options) {
  return new HostStorage(options);
}

export { MAX_READ_BYTES };
