import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateApi, buildUpdateQuery } from '../src/api-update.js';
import { GameMarketApiError } from '../../shared/src/api-client.js';

const COMMIT = 'c'.repeat(40);
const OPERATION_ID = 'upd_0123456789abcdef';

function envelope(data) {
  return { ok: true, data: data, requestId: 'req_test', serverTime: '2026-10-20T12:00:00.000Z' };
}

function okResponse(data, status) {
  return {
    status: status || 200,
    json: async function json() {
      return envelope(data);
    },
  };
}

function failureResponse(code, retryable, status) {
  return {
    status: status || 400,
    json: async function json() {
      return { ok: false, error: { code: code, message: 'diagnostic only', retryable: retryable === true } };
    },
  };
}

function captureFetch(response, calls) {
  return async function fetchImpl(url, init) {
    calls.push({ url: url, init: init });
    return typeof response === 'function' ? response(url, init) : response;
  };
}

function pathOf(call) {
  return new URL(call.url, 'http://127.0.0.1:51025/').pathname;
}

test('inspect GETs the platform-update route and unwraps the envelope', async function () {
  const calls = [];
  const api = createUpdateApi({
    fetchImpl: captureFetch(okResponse({ schemaVersion: 1, target: null, discovery: { state: 'never' } }), calls),
  });
  const data = await api.inspect();
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(pathOf(calls[0]), '/api/game-market/platform-update');
  assert.equal(data.schemaVersion, 1);
});

test('refresh POSTs an empty JSON body', async function () {
  const calls = [];
  const api = createUpdateApi({ fetchImpl: captureFetch(okResponse({ refreshed: false, throttled: true }), calls) });
  const data = await api.refresh();
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(pathOf(calls[0]), '/api/game-market/platform-update/refresh');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.equal(calls[0].init.body, '{}');
  assert.equal(data.throttled, true);
});

test('begin sends only the verified target id and rejects a missing id locally', async function () {
  const calls = [];
  const api = createUpdateApi({ fetchImpl: captureFetch(okResponse({ operationId: OPERATION_ID }), calls) });
  const data = await api.begin('tgt_1');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(pathOf(calls[0]), '/api/game-market/platform-update/begin');
  assert.deepEqual(JSON.parse(calls[0].init.body), { targetId: 'tgt_1' });
  assert.equal(data.operationId, OPERATION_ID);

  await assert.rejects(
    function call() {
      return api.begin('');
    },
    function check(error) {
      return error instanceof GameMarketApiError && error.code === 'GM-4002';
    }
  );
  assert.equal(calls.length, 1);
});

test('observe passes the operation id as a query parameter', async function () {
  const calls = [];
  const api = createUpdateApi({
    fetchImpl: captureFetch(okResponse({ operationId: OPERATION_ID, state: 'installing', stage: 'install', progress: null }), calls),
  });
  const data = await api.observe(OPERATION_ID);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(pathOf(calls[0]), '/api/game-market/platform-update/observe');
  const url = new URL(calls[0].url, 'http://x/');
  assert.equal(url.searchParams.get('operationId'), OPERATION_ID);
  assert.equal(data.state, 'installing');
  await assert.rejects(
    function call() {
      return api.observe(null);
    },
    function check(error) {
      return error.code === 'GM-4002';
    }
  );
});

test('cancel posts the operation id and preserves the cancel status union', async function () {
  const calls = [];
  const api = createUpdateApi({
    fetchImpl: captureFetch(
      okResponse({ status: 'too-late', observation: { operationId: OPERATION_ID, state: 'too-late', note: 'install-continues' } }),
      calls
    ),
  });
  const data = await api.cancel(OPERATION_ID);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(pathOf(calls[0]), '/api/game-market/platform-update/cancel');
  assert.deepEqual(JSON.parse(calls[0].init.body), { operationId: OPERATION_ID });
  assert.equal(data.status, 'too-late');
});

test('coordinate posts the window payload verbatim (no invented fields)', async function () {
  const calls = [];
  const payload = {
    windowId: '1'.repeat(32),
    instances: [
      {
        instanceId: '2'.repeat(32),
        gameId: 'snake',
        playSessionId: null,
        paused: true,
        saved: true,
        saveStale: false,
        saveRevision: null,
      },
    ],
    idle: false,
  };
  const api = createUpdateApi({
    fetchImpl: captureFetch(okResponse({ accepted: true, phase: 'satisfied', pending: { windows: 0, instances: 0 } }), calls),
  });
  const data = await api.coordinate(payload);
  assert.equal(pathOf(calls[0]), '/api/game-market/platform-update/coordinate');
  assert.deepEqual(JSON.parse(calls[0].init.body), payload);
  assert.equal(data.phase, 'satisfied');
});

test('client-report posts the embedded build identity fields', async function () {
  const calls = [];
  const payload = {
    clientId: '3'.repeat(32),
    windowId: '4'.repeat(32),
    buildVersion: '1.2.0',
    buildCommit: COMMIT,
    pageToken: '5'.repeat(32),
    startedAt: '2026-10-20T12:00:00.000Z',
  };
  const api = createUpdateApi({
    fetchImpl: captureFetch(okResponse({ accepted: true, state: 'idle', expected: { buildVersion: '1.3.0', buildCommit: COMMIT } }), calls),
  });
  const data = await api.clientReport(payload);
  assert.equal(pathOf(calls[0]), '/api/game-market/platform-update/client-report');
  assert.deepEqual(JSON.parse(calls[0].init.body), payload);
  assert.equal(data.accepted, true);
});

test('error envelopes become GameMarketApiError with the GM code and retryable flag', async function () {
  const api = createUpdateApi({ fetchImpl: captureFetch(failureResponse('GM-4091', true, 409), []) });
  await assert.rejects(
    function call() {
      return api.begin('tgt_1');
    },
    function check(error) {
      return error instanceof GameMarketApiError && error.code === 'GM-4091' && error.retryable === true && error.status === 409;
    }
  );
});

test('an old Host without the route surfaces as GM-4004 with the HTTP status (UI hides itself)', async function () {
  const api = createUpdateApi({
    fetchImpl: captureFetch(
      {
        status: 404,
        json: async function json() {
          throw new Error('not json');
        },
      },
      []
    ),
  });
  await assert.rejects(
    function call() {
      return api.inspect();
    },
    function check(error) {
      return error instanceof GameMarketApiError && error.code === 'GM-4004' && error.status === 404;
    }
  );
});

test('query builder keeps only defined values', function () {
  assert.equal(buildUpdateQuery(null), '');
  assert.equal(buildUpdateQuery({ operationId: OPERATION_ID }), '?operationId=' + OPERATION_ID);
  assert.equal(buildUpdateQuery({ operationId: OPERATION_ID, empty: null }), '?operationId=' + OPERATION_ID);
});
