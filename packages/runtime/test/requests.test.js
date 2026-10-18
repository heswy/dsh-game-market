import test from 'node:test';
import assert from 'node:assert/strict';

import { createRequestService } from '../src/requests.js';
import { createFakeApi } from './helpers/fakes.js';
import { GM } from '../../shared/src/errors.js';
import { METHODS } from '../../shared/src/protocol.js';

function makeService(overrides = {}) {
  const api = overrides.api || createFakeApi();
  const outcomes = [];
  const service = createRequestService({
    api,
    getGameId: () => 'snake',
    getAgentSnapshot: () => null,
    onSaveOutcome: (outcome) => outcomes.push(outcome),
    capabilities: ['storage', 'score'],
    limits: { saveBytes: 1024, saveKeys: 2, scoreMetaBytes: 64 },
    now: () => 1700000000000,
    ...overrides,
  });
  return { service, api, outcomes };
}

test('storage.save maps onto api.setSave and reports bytes', async () => {
  const { service, api } = makeService();
  const result = await service.handle(METHODS.STORAGE_SAVE, { key: 'current', data: { score: 10 } });
  assert.equal(result.key, 'current');
  assert.equal(result.revision, 1);
  assert.ok(result.bytes > 0);
  assert.equal(api.calls[0][0], 'setSave');
  assert.deepEqual(api.calls[0][1].data, { score: 10 });
});

test('storage.save rejects invalid keys with GM-4133', async () => {
  const { service } = makeService();
  await assert.rejects(
    service.handle(METHODS.STORAGE_SAVE, { key: 'Bad Key!', data: 1 }),
    (error) => error.code === GM.STORAGE_KEY_INVALID
  );
});

test('storage.save rejects prototype-pollution keys with GM-4134', async () => {
  const { service } = makeService();
  const polluted = JSON.parse('{"__proto__":{"polluted":true}}');
  await assert.rejects(
    service.handle(METHODS.STORAGE_SAVE, { key: 'current', data: polluted }),
    (error) => error.code === GM.VALUE_NOT_SERIALIZABLE
  );
});

test('storage.save enforces the per-value and total byte limits', async () => {
  const { service } = makeService({ limits: { saveBytes: 80, saveKeys: 32, scoreMetaBytes: 64 } });
  await assert.rejects(
    service.handle(METHODS.STORAGE_SAVE, { key: 'current', data: 'x'.repeat(300000) }),
    (error) => error.code === GM.SAVE_TOO_LARGE
  );
  await service.handle(METHODS.STORAGE_SAVE, { key: 'a', data: 'x'.repeat(40) });
  await assert.rejects(
    service.handle(METHODS.STORAGE_SAVE, { key: 'b', data: 'x'.repeat(40) }),
    (error) => error.code === GM.STORAGE_QUOTA
  );
});

test('storage.save enforces the key-count limit', async () => {
  const { service } = makeService({ limits: { saveBytes: 100000, saveKeys: 1, scoreMetaBytes: 64 } });
  await service.handle(METHODS.STORAGE_SAVE, { key: 'a', data: 1 });
  await assert.rejects(
    service.handle(METHODS.STORAGE_SAVE, { key: 'b', data: 2 }),
    (error) => error.code === GM.STORAGE_QUOTA
  );
  // Replacing an existing key is still allowed at the key limit.
  const replaced = await service.handle(METHODS.STORAGE_SAVE, { key: 'a', data: 3 });
  assert.equal(replaced.key, 'a');
});

test('storage.load returns null when the Host has no save', async () => {
  const { service } = makeService();
  const result = await service.handle(METHODS.STORAGE_LOAD, { key: 'current' });
  assert.equal(result, null);
});

test('storage.load returns the stored value and revision', async () => {
  const { service } = makeService();
  await service.handle(METHODS.STORAGE_SAVE, { key: 'current', data: { snake: [1, 2, 3] } });
  const result = await service.handle(METHODS.STORAGE_LOAD, { key: 'current' });
  assert.deepEqual(result.data, { snake: [1, 2, 3] });
  assert.equal(result.revision, 1);
  const missing = await service.handle(METHODS.STORAGE_LOAD, { key: 'other' });
  assert.equal(missing, null);
});

test('storage.remove falls back to setSave({data:null}) for the V0 Host API', async () => {
  const { service, api } = makeService();
  const result = await service.handle(METHODS.STORAGE_REMOVE, { key: 'current' });
  assert.equal(result.removed, true);
  const call = api.calls.find((entry) => entry[0] === 'setSave');
  assert.equal(call[1].data, null);
});

test('capabilities are enforced before touching the Host API', async () => {
  const { service, api } = makeService({ capabilities: [] });
  await assert.rejects(
    service.handle(METHODS.STORAGE_SAVE, { key: 'current', data: 1 }),
    (error) => error.code === GM.CAPABILITY_DENIED
  );
  await assert.rejects(
    service.handle(METHODS.SCORE_SUBMIT, { score: 10 }),
    (error) => error.code === GM.CAPABILITY_DENIED
  );
  assert.equal(api.calls.length, 0);
});

test('session.start and session.end pass through and are idempotent-safe', async () => {
  const { service } = makeService();
  const beforeEnd = await service.handle(METHODS.SESSION_END, { outcome: 'completed', score: 10 });
  assert.equal(beforeEnd, null);

  const started = await service.handle(METHODS.SESSION_START, {});
  assert.equal(started.playSessionId, 'ps_1234567890abcdef');
  const ended = await service.handle(METHODS.SESSION_END, { outcome: 'completed', score: 30 });
  assert.equal(ended.outcome, 'completed');
  assert.equal(service.getPlaySessionId(), null);
});

test('session.end validates the outcome', async () => {
  const { service } = makeService();
  await service.handle(METHODS.SESSION_START, {});
  await assert.rejects(
    service.handle(METHODS.SESSION_END, { outcome: 'ragequit' }),
    (error) => error.code === GM.INVALID_PARAM
  );
});

test('score.submit normalizes the best value and validates the score', async () => {
  const { service } = makeService();
  const result = await service.handle(METHODS.SCORE_SUBMIT, { score: 30, meta: { level: 2 } });
  assert.equal(result.best, 100);
  await assert.rejects(
    service.handle(METHODS.SCORE_SUBMIT, { score: Number.NaN }),
    (error) => error.code === GM.INVALID_PARAM
  );
  await assert.rejects(
    service.handle(METHODS.SCORE_SUBMIT, { score: 10, meta: { blob: 'x'.repeat(80) } }),
    (error) => error.code === GM.INVALID_PARAM
  );
});

test('score.getBest maps the Host scores payload', async () => {
  const { service } = makeService();
  const result = await service.handle(METHODS.SCORE_GET_BEST, {});
  assert.deepEqual(result, { score: 120, achievedAt: '2026-10-18T00:00:00.000Z', meta: null });
});

test('agent.getStatus returns an idle snapshot when no Session is bound', async () => {
  const { service } = makeService();
  const snapshot = await service.handle(METHODS.AGENT_GET_STATUS, {});
  assert.equal(snapshot.state, 'idle');
  assert.equal(snapshot.sessionId, null);
  assert.equal(typeof snapshot.label, 'string');
});

test('agent.getStatus returns the current Host snapshot', async () => {
  const snapshot = {
    state: 'running',
    label: '正在工作…',
    sessionId: 's1',
    updatedAt: '2026-10-18T00:00:00.000Z',
    source: 'turn',
    seq: 3,
    since: '2026-10-18T00:00:00.000Z',
  };
  const { service } = makeService({ getAgentSnapshot: () => snapshot });
  assert.equal(await service.handle(METHODS.AGENT_GET_STATUS, {}), snapshot);
});

test('unknown methods return GM-4004', async () => {
  const { service } = makeService();
  await assert.rejects(
    service.handle('storage.explode', {}),
    (error) => error.code === GM.UNKNOWN_METHOD
  );
});

test('Host API errors pass through with their GM code and retryable flag', async () => {
  const api = createFakeApi();
  api.setSave = () => {
    const error = new Error('disk full');
    error.code = 'GM-5021';
    error.retryable = true;
    return Promise.reject(error);
  };
  const { service, outcomes } = makeService({ api });
  await assert.rejects(
    service.handle(METHODS.STORAGE_SAVE, { key: 'current', data: 1 }),
    (error) => error.code === 'GM-5021' && error.retryable === true
  );
  assert.equal(outcomes[0].ok, false);
});
