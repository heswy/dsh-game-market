import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { GM } from '../../../shared/src/errors.js';
import { HostStorage } from '../../src/storage.js';

async function createStore(t, suffix = '') {
  const directory = await fs.mkdtemp(path.join(tmpdir(), `dsh-gm-storage-${suffix}`));
  const root = path.join(directory, 'data');
  const logs = [];
  const logger = {
    info: (...parts) => logs.push(['info', ...parts]),
    warn: (...parts) => logs.push(['warn', ...parts]),
    error: (...parts) => logs.push(['error', ...parts]),
    debug: (...parts) => logs.push(['debug', ...parts]),
  };
  const storage = new HostStorage({ root, logger });
  t.after(async () => {
    await storage.flush();
    await fs.chmod(root, 0o700).catch(() => undefined);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { storage, root, directory, logs };
}

function assertHostError(error, code) {
  assert.equal(error.name, 'HostError');
  assert.equal(error.code, code);
}

export function register() {
  test('atomic writes create .tmp-free files, .bak, lock cleanup and 0600 mode', async (t) => {
    const { storage, root } = await createStore(t);
    const file = storage.filePath('saves', 'snake', 'current.json');
    await storage.writeJson(file, { schemaVersion: 1, value: 1 });
    const first = await storage.readJson(file, { schemaVersion: 1 });
    assert.equal(first.value.value, 1);
    assert.equal(first.recovered, false);
    await storage.writeJson(file, { schemaVersion: 1, value: 2 });
    const second = await storage.readJson(file, { schemaVersion: 1 });
    assert.equal(second.value.value, 2);
    const backup = await storage.readJson(`${file}.bak`, { schemaVersion: 1 });
    assert.equal(backup.value.value, 1);
    const entries = (await fs.readdir(path.dirname(file))).sort();
    assert.deepEqual(entries, ['current.json', 'current.json.bak']);
    assert.equal(entries.some((entry) => entry.endsWith('.tmp') || entry.endsWith('.lock')), false);
    const stats = await fs.stat(file);
    assert.equal(stats.mode & 0o777, 0o600);
    assert.equal(root.endsWith('data'), true);
  });

  test('writes to the same path are serialised in call order', async (t) => {
    const { storage } = await createStore(t);
    const file = storage.filePath('preferences.json');
    const writes = [];
    for (let index = 0; index < 10; index += 1) {
      writes.push(storage.writeJson(file, { schemaVersion: 1, index }));
    }
    await Promise.all(writes);
    const result = await storage.readJson(file, { schemaVersion: 1 });
    assert.equal(result.value.index, 9);
    await storage.flush();
    assert.equal(storage.writeChains.size, 0);
  });

  test('a corrupt primary recovers from .bak and quarantines the evidence', async (t) => {
    const { storage } = await createStore(t);
    const file = storage.filePath('saves', 'snake', 'current.json');
    await storage.writeJson(file, { schemaVersion: 1, value: 'first' });
    await storage.writeJson(file, { schemaVersion: 1, value: 'second' });
    await fs.writeFile(file, '{broken', 'utf8');
    const recovered = await storage.readJson(file, { schemaVersion: 1 });
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.source, 'backup');
    assert.equal(recovered.value.value, 'first');
    const files = await fs.readdir(path.dirname(file));
    assert.equal(files.some((name) => name.includes('.corrupt-')), true);
    assert.equal(files.includes('current.json'), false);
  });

  test('a .bak-only file is used without quarantining', async (t) => {
    const { storage } = await createStore(t);
    const file = storage.filePath('saves', 'snake', 'current.json');
    await storage.writeJson(file, { schemaVersion: 1, value: 1 });
    await storage.writeJson(file, { schemaVersion: 1, value: 2 });
    await fs.rm(file);
    const recovered = await storage.readJson(file, { schemaVersion: 1 });
    assert.equal(recovered.value.value, 1);
    const files = await fs.readdir(path.dirname(file));
    assert.equal(files.some((name) => name.includes('.corrupt-')), false);
  });

  test('two corrupt copies yield null and keep both quarantine files', async (t) => {
    const { storage } = await createStore(t);
    const file = storage.filePath('saves', 'snake', 'current.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'not json', 'utf8');
    await fs.writeFile(`${file}.bak`, 'also not json', 'utf8');
    const result = await storage.readJson(file, { schemaVersion: 1 });
    assert.equal(result, null);
    const files = await fs.readdir(path.dirname(file));
    assert.ok(files.filter((name) => name.includes('.corrupt-')).length >= 2);
  });

  test('a newer schema is rejected without modifying the file', async (t) => {
    const { storage } = await createStore(t);
    const file = storage.filePath('preferences.json');
    await storage.writeJson(file, { schemaVersion: 2, theme: 'dark' });
    await assert.rejects(
      () => storage.readJson(file, { schemaVersion: 1 }),
      (error) => {
        assertHostError(error, GM.SCHEMA_READ_TOO_NEW);
        return true;
      }
    );
    const stillThere = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(stillThere.schemaVersion, 2);
  });

  test('an unwritable root flips to read-only and writes return GM-5025', async (t) => {
    const { storage, root } = await createStore(t);
    await storage.writeJson(storage.filePath('preferences.json'), { schemaVersion: 1 });
    await fs.chmod(root, 0o500);
    const status = await storage.checkStatus();
    assert.equal(status.ok, false);
    assert.equal(status.readOnly, true);
    assert.equal(status.root, root);
    await assert.rejects(
      () => storage.writeJson(storage.filePath('preferences.json'), { schemaVersion: 1 }),
      (error) => {
        assertHostError(error, 'GM-5025');
        return true;
      }
    );
    await fs.chmod(root, 0o700);
    const repaired = await storage.checkStatus();
    assert.equal(repaired.ok, true);
    assert.equal(repaired.readOnly, false);
  });

  test('paths cannot escape the storage root and directories can be listed', async (t) => {
    const { storage } = await createStore(t);
    assert.throws(
      () => storage.filePath('..', 'outside.json'),
      (error) => {
        assertHostError(error, GM.INVALID_PARAM);
        return true;
      }
    );
    assert.deepEqual(await storage.listDirectory('sessions'), []);
    await storage.writeJson(storage.filePath('sessions', 'snake.json'), { schemaVersion: 1 });
    const files = await storage.listDirectory('sessions');
    assert.equal(files.length, 1);
    assert.equal(path.basename(files[0]), 'snake.json');
  });

  test('non-serialisable values are rejected before touching disk', async (t) => {
    const { storage } = await createStore(t);
    const value = {};
    value.self = value;
    await assert.rejects(
      () => storage.writeJson(storage.filePath('preferences.json'), value),
      (error) => {
        assertHostError(error, GM.VALUE_NOT_SERIALIZABLE);
        return true;
      }
    );
    assert.deepEqual(await storage.listDirectory('.'), []);
  });
}
