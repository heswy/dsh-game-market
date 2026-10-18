import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ROUTES } from '../../../shared/src/contracts.js';
import { GM } from '../../../shared/src/errors.js';
import { createHost } from '../../src/host.js';
import { createHarness, FIXTURE_ROOT } from '../support/harness.js';

function assertErrorEnvelope(payload, code) {
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, code);
}

export function register() {
  test('GET /save is 404 before the first save', async (t) => {
    const host = await createHarness(t);
    const { response, payload } = await host.requestJson(ROUTES.SAVE, { query: { gameId: 'snake' } });
    assert.equal(response.status, 404);
    assertErrorEnvelope(payload, GM.SAVE_NOT_FOUND);
  });

  test('POST /save creates revision 1 and GET include=data returns values', async (t) => {
    const host = await createHarness(t);
    const saved = await host.data(ROUTES.SAVE, {
      body: {
        gameId: 'snake',
        key: 'current',
        data: { score: 42, board: [[1, 2], [3, 4]] },
        reason: 'pause',
        operationId: 'op-save-1',
      },
    });
    assert.equal(saved.gameId, 'snake');
    assert.equal(saved.keys, 1);
    assert.ok(saved.bytes > 0);
    assert.equal(saved.revision, 1);
    assert.ok(!Number.isNaN(Date.parse(saved.updatedAt)));

    const summary = await host.data(ROUTES.SAVE, { query: { gameId: 'snake' } });
    assert.equal(summary.revision, 1);
    assert.equal(summary.keys, 1);
    assert.equal(summary.bytes, saved.bytes);
    assert.equal(Object.prototype.hasOwnProperty.call(summary, 'values'), false);

    const full = await host.data(ROUTES.SAVE, { query: { gameId: 'snake', include: 'data' } });
    assert.deepEqual(full.values, { current: { score: 42, board: [[1, 2], [3, 4]] } });
    assert.equal(full.revision, 1);

    const envelope = await host.readDataJson('saves', 'snake', 'current.json');
    assert.equal(envelope.schemaVersion, 1);
    assert.equal(envelope.gameId, 'snake');
    assert.equal(envelope.saveSchemaVersion, 1);
    assert.equal(envelope.reason, 'pause');
    assert.equal(envelope.revision, 1);
    const meta = await host.readDataJson('saves', 'snake', 'meta.json');
    assert.equal(meta.hasSave, true);
    assert.equal(meta.revision, 1);
    assert.equal(meta.saveCount, 1);
    assert.equal(meta.keys, 1);
  });

  test('subsequent saves increment revision, merge keys and keep a .bak', async (t) => {
    const host = await createHarness(t);
    await host.data(ROUTES.SAVE, { body: { gameId: 'snake', key: 'a', data: 1 } });
    const second = await host.data(ROUTES.SAVE, { body: { gameId: 'snake', key: 'b', data: 2 } });
    assert.equal(second.revision, 2);
    assert.equal(second.keys, 2);
    const third = await host.data(ROUTES.SAVE, { body: { gameId: 'snake', key: 'a', data: 3 } });
    assert.equal(third.revision, 3);
    assert.equal(third.keys, 2);
    const full = await host.data(ROUTES.SAVE, { query: { gameId: 'snake', include: 'data' } });
    assert.deepEqual(full.values, { a: 3, b: 2 });
    const files = await host.listDataFiles(path.join('saves', 'snake'));
    assert.ok(files.includes('current.json'));
    assert.ok(files.includes('current.json.bak'));
    assert.equal(files.some((file) => file.endsWith('.tmp')), false);
    const meta = await host.readDataJson('saves', 'snake', 'meta.json');
    assert.equal(meta.saveCount, 3);
    assert.equal(meta.revision, 3);
  });

  test('expectedRevision is enforced and 0 creates the first save', async (t) => {
    const host = await createHarness(t);
    const created = await host.data(ROUTES.SAVE, {
      body: { gameId: 'snake', key: 'current', data: 1, expectedRevision: 0 },
    });
    assert.equal(created.revision, 1);
    const conflict = await host.requestJson(ROUTES.SAVE, {
      body: { gameId: 'snake', key: 'current', data: 2, expectedRevision: 0 },
    });
    assert.equal(conflict.response.status, 409);
    assertErrorEnvelope(conflict.payload, GM.STORAGE_CONFLICT);
    assert.equal(conflict.payload.error.details.expectedRevision, 0);
    assert.equal(conflict.payload.error.details.actualRevision, 1);
    const ok = await host.data(ROUTES.SAVE, {
      body: { gameId: 'snake', key: 'current', data: 2, expectedRevision: 1 },
    });
    assert.equal(ok.revision, 2);
    const invalid = await host.requestJson(ROUTES.SAVE, {
      body: { gameId: 'snake', key: 'current', data: 3, expectedRevision: -1 },
    });
    assert.equal(invalid.response.status, 400);
    assertErrorEnvelope(invalid.payload, GM.INVALID_PARAM);
  });

  test('concurrent expectedRevision writes are serialised (one wins, one conflicts)', async (t) => {
    const host = await createHarness(t);
    await host.data(ROUTES.SAVE, { body: { gameId: 'snake', key: 'current', data: 1 } });
    const [first, second] = await Promise.all([
      host.requestJson(ROUTES.SAVE, {
        body: { gameId: 'snake', key: 'current', data: 2, expectedRevision: 1 },
      }),
      host.requestJson(ROUTES.SAVE, {
        body: { gameId: 'snake', key: 'current', data: 3, expectedRevision: 1 },
      }),
    ]);
    const statuses = [first.response.status, second.response.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const conflict = first.response.status === 409 ? first : second;
    assertErrorEnvelope(conflict.payload, GM.STORAGE_CONFLICT);
    const full = await host.data(ROUTES.SAVE, { query: { gameId: 'snake', include: 'data' } });
    assert.equal(full.revision, 2);
    assert.ok([2, 3].includes(full.values.current));
  });

  test('storage key validation rejects invalid and prototype-pollution keys', async (t) => {
    const host = await createHarness(t);
    for (const key of ['Bad Key', '__proto__', 'constructor', 'UPPER']) {
      const { response, payload } = await host.requestJson(ROUTES.SAVE, {
        body: { gameId: 'snake', key, data: 1 },
      });
      assert.equal(response.status, 413);
      assertErrorEnvelope(payload, GM.STORAGE_KEY_INVALID);
    }
    const nested = await host.requestJson(ROUTES.SAVE, {
      rawBody: JSON.stringify({ gameId: 'snake', key: 'current', data: JSON.parse('{"__proto__":{"polluted":true}}') }),
      contentType: 'application/json',
    });
    assert.equal(nested.response.status, 413);
    assertErrorEnvelope(nested.payload, GM.VALUE_NOT_SERIALIZABLE);
    assert.equal({}.polluted, undefined);
  });

  test('single-value and key-count quotas are enforced without partial writes', async (t) => {
    const host = await createHarness(t);
    const tooBig = await host.requestJson(ROUTES.SAVE, {
      body: { gameId: 'snake', key: 'big', data: 'x'.repeat(256 * 1024 + 1) },
    });
    assert.equal(tooBig.response.status, 413);
    assertErrorEnvelope(tooBig.payload, GM.SAVE_TOO_LARGE);
    assert.equal((await host.requestJson(ROUTES.SAVE, { query: { gameId: 'snake' } })).response.status, 404);

    for (let index = 0; index < 32; index += 1) {
      await host.data(ROUTES.SAVE, {
        body: { gameId: 'snake', key: `k${index}`, data: index },
      });
    }
    const overKeys = await host.requestJson(ROUTES.SAVE, {
      body: { gameId: 'snake', key: 'overflow', data: 1 },
    });
    assert.equal(overKeys.response.status, 413);
    assertErrorEnvelope(overKeys.payload, GM.STORAGE_QUOTA);
    const full = await host.data(ROUTES.SAVE, { query: { gameId: 'snake', include: 'data' } });
    assert.equal(Object.keys(full.values).length, 32);
    assert.equal(Object.prototype.hasOwnProperty.call(full.values, 'overflow'), false);
  });

  test('total 1 MiB quota is enforced at the service level', async (t) => {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'dsh-gm-quota-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const host = createHost({
      config: {
        builtinGamesRoot: FIXTURE_ROOT,
        dataRoot: path.join(directory, 'data'),
      },
    });
    t.after(() => host.storage.flush());
    let quotaError = null;
    for (let index = 0; index < 40; index += 1) {
      try {
        await host.services.saves.save({
          gameId: 'snake',
          key: `chunk${index % 32}`,
          data: 'y'.repeat(33 * 1024),
        });
      } catch (error) {
        quotaError = error;
        break;
      }
    }
    assert.ok(quotaError, 'expected the 1 MiB quota to be reached');
    assert.equal(quotaError.code, GM.STORAGE_QUOTA);
    const meta = await host.services.saves.meta('snake');
    assert.ok(meta.revision > 0);
    await host.storage.flush();
  });

  test('save schema newer than the game manifest returns GM-4099', async (t) => {
    const host = await createHarness(t);
    await host.data(ROUTES.SAVE, { body: { gameId: 'snake', key: 'current', data: 1 } });
    await host.writeDataFile(
      path.join('saves', 'snake', 'current.json'),
      JSON.stringify({
        schemaVersion: 1,
        gameId: 'snake',
        saveSchemaVersion: 2,
        savedAt: new Date().toISOString(),
        reason: 'manual',
        bytes: 2,
        revision: 2,
        values: { current: 1 },
      })
    );
    const { response, payload } = await host.requestJson(ROUTES.SAVE, { query: { gameId: 'snake' } });
    assert.equal(response.status, 409);
    assertErrorEnvelope(payload, GM.SAVE_SCHEMA_TOO_NEW);
  });

  test('a corrupt current.json recovers from .bak and quarantines evidence', async (t) => {
    const host = await createHarness(t);
    await host.data(ROUTES.SAVE, { body: { gameId: 'snake', key: 'a', data: 1 } });
    await host.data(ROUTES.SAVE, { body: { gameId: 'snake', key: 'b', data: 2 } });
    await fs.writeFile(host.filePath('saves', 'snake', 'current.json'), '{broken json', 'utf8');
    const recovered = await host.data(ROUTES.SAVE, {
      query: { gameId: 'snake', include: 'data' },
    });
    assert.deepEqual(recovered.values, { a: 1 });
    assert.equal(recovered.revision, 1);
    const files = await host.listDataFiles(path.join('saves', 'snake'));
    assert.equal(files.some((file) => file.includes('.corrupt-')), true);

    await fs.writeFile(host.filePath('saves', 'snake', 'current.json.bak'), 'also broken', 'utf8');
    const missing = await host.requestJson(ROUTES.SAVE, { query: { gameId: 'snake' } });
    assert.equal(missing.response.status, 404);
    assertErrorEnvelope(missing.payload, GM.SAVE_NOT_FOUND);
    const after = await host.listDataFiles(path.join('saves', 'snake'));
    assert.ok(after.filter((file) => file.includes('.corrupt-')).length >= 2);
  });

  test('unknown games and malformed bodies are rejected', async (t) => {
    const host = await createHarness(t);
    const unknown = await host.requestJson(ROUTES.SAVE, {
      body: { gameId: 'unknown-game', key: 'current', data: 1 },
    });
    assert.equal(unknown.response.status, 404);
    assertErrorEnvelope(unknown.payload, GM.GAME_NOT_FOUND);
    const missingData = await host.requestJson(ROUTES.SAVE, {
      body: { gameId: 'snake', key: 'current' },
    });
    assert.equal(missingData.response.status, 400);
    assertErrorEnvelope(missingData.payload, GM.INVALID_PARAM);
    const badGameId = await host.requestJson(ROUTES.SAVE, {
      body: { gameId: 'no', key: 'current', data: 1 },
    });
    assert.equal(badGameId.response.status, 400);
    assertErrorEnvelope(badGameId.payload, GM.BAD_GAME_ID);
  });
}
