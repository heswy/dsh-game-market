import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketApi, readFileText, buildRequestQuery } from '../src/api-v1.js';
import { GameMarketApiError } from '../../shared/src/api-client.js';

function envelope(data) {
  return { ok: true, data: data, requestId: 'req_test', serverTime: '2026-10-18T12:00:00.000Z' };
}

function failure(code, retryable, status) {
  return {
    status: status || 400,
    json: async function json() {
      return { ok: false, error: { code: code, message: 'diagnostic', retryable: retryable === true } };
    },
  };
}

function okResponse(data, status) {
  return {
    status: status || 200,
    json: async function json() {
      return envelope(data);
    },
  };
}

function captureFetch(response, calls) {
  return async function fetchImpl(url, init) {
    calls.push({ url: url, init: init });
    return typeof response === 'function' ? response(url, init) : response;
  };
}

test('listGames only sends the provided query parameters and unwraps the envelope', async function () {
  const calls = [];
  const api = createMarketApi({ fetchImpl: captureFetch(okResponse({ items: [{ id: 'jump' }], source: 'merged' }), calls) });
  const result = await api.listGames({ q: 'ju', category: 'arcade', limit: 10 });
  assert.deepEqual(result, { items: [{ id: 'jump' }], source: 'merged' });
  assert.equal(calls[0].init.method, 'GET');
  const url = new URL(calls[0].url, 'http://127.0.0.1:51025/');
  assert.equal(url.pathname, '/api/game-market/games');
  assert.equal(url.searchParams.get('q'), 'ju');
  assert.equal(url.searchParams.get('category'), 'arcade');
  assert.equal(url.searchParams.get('limit'), '10');
  assert.equal(url.searchParams.has('cursor'), false);

  await api.listGames();
  assert.equal(new URL(calls[1].url, 'http://x/').search, '');
});

test('getGame and getScores use the id query', async function () {
  const calls = [];
  const api = createMarketApi({ fetchImpl: captureFetch(okResponse({ game: { id: 'snake' } }), calls) });
  await api.getGame('snake');
  assert.equal(new URL(calls[0].url, 'http://x/').searchParams.get('id'), 'snake');
  await api.getScores('snake');
  assert.equal(new URL(calls[1].url, 'http://x/').pathname, '/api/game-market/scores');
  assert.equal(new URL(calls[1].url, 'http://x/').searchParams.get('gameId'), 'snake');
});

test('install posts the frozen JSON body with a stable operation id', async function () {
  const calls = [];
  const api = createMarketApi({ fetchImpl: captureFetch(okResponse({ gameId: 'jump', version: '1.0.0', changed: true }), calls) });
  const result = await api.install({ gameId: 'jump', version: '1.0.0', operationId: 'op-1' });
  assert.equal(result.changed, true);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { gameId: 'jump', version: '1.0.0', operationId: 'op-1' });
  await api.install({ gameId: 'jump' });
  const body = JSON.parse(calls[1].init.body);
  assert.equal(typeof body.operationId, 'string');
  assert.ok(body.operationId.length > 3);
  assert.equal(body.version, undefined);
});

test('uninstall only confirms data deletion when explicitly requested', async function () {
  const calls = [];
  const api = createMarketApi({ fetchImpl: captureFetch(okResponse({ gameId: 'jump', removed: true, dataDeleted: false }), calls) });
  await api.uninstall({ gameId: 'jump', operationId: 'op-2' });
  let body = JSON.parse(calls[0].init.body);
  assert.equal(body.deleteData, false);
  assert.equal(body.confirmDataDeletion, undefined);
  await api.uninstall({ gameId: 'jump', operationId: 'op-3', deleteData: true });
  body = JSON.parse(calls[1].init.body);
  assert.equal(body.deleteData, true);
  assert.equal(body.confirmDataDeletion, true);
});

test('registry refresh posts force and operationId', async function () {
  const calls = [];
  const api = createMarketApi({ fetchImpl: captureFetch(okResponse({ refreshedAt: '2026-10-18T12:00:00.000Z', count: 3 }), calls) });
  const result = await api.refreshRegistry({ force: true, operationId: 'op-4' });
  assert.equal(result.count, 3);
  assert.equal(new URL(calls[0].url, 'http://x/').pathname, '/api/game-market/registry-refresh');
  assert.deepEqual(JSON.parse(calls[0].init.body), { force: true, operationId: 'op-4' });
});

test('install-local sends raw text/html with the operation id in the query', async function () {
  const calls = [];
  const api = createMarketApi({ fetchImpl: captureFetch(okResponse({ gameId: 'local', version: '1.0.0', source: 'local' }), calls) });
  const text = '<!doctype html><html><script type="application/json" id="dsh-game-manifest">{}</script></html>';
  const result = await api.installLocal({ text: text, operationId: 'op-local' });
  assert.equal(result.source, 'local');
  const url = new URL(calls[0].url, 'http://x/');
  assert.equal(url.pathname, '/api/game-market/install-local');
  assert.equal(url.searchParams.get('operationId'), 'op-local');
  assert.equal(calls[0].init.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(calls[0].init.body, text);
});

test('install-local can read a File through FileReader when .text() is absent', async function () {
  const calls = [];
  const api = createMarketApi({ fetchImpl: captureFetch(okResponse({ gameId: 'local', version: '1.0.0' }), calls) });
  class FakeReader {
    readAsText(file) {
      this.result = '<html>' + file.name + '</html>';
      if (this.onload) this.onload();
    }
  }
  const file = { name: 'mine.html', size: 12 };
  await api.installLocal({ file: file, FileReader: FakeReader, operationId: 'op-5' });
  assert.equal(calls[0].init.body, '<html>mine.html</html>');
});

test('readFileText prefers File.text() and surfaces reader failures', async function () {
  assert.equal(await readFileText({ text: async function text() { return 'hello'; } }), 'hello');
  await assert.rejects(() => readFileText({ name: 'x.html' }, { FileReader: null }), /FileReader/);
  class BrokenReader {
    readAsText() {
      this.error = new Error('disk');
      if (this.onerror) this.onerror();
    }
  }
  await assert.rejects(() => readFileText({ name: 'x.html' }, { FileReader: BrokenReader }), /disk/);
});

test('error envelopes become GameMarketApiError with code and retryability', async function () {
  const api = createMarketApi({ fetchImpl: async function fetchImpl() { return failure('GM-4091', true, 429); } });
  await assert.rejects(
    () => api.install({ gameId: 'jump', operationId: 'op-6' }),
    function check(error) {
      assert.ok(error instanceof GameMarketApiError);
      assert.equal(error.code, 'GM-4091');
      assert.equal(error.retryable, true);
      assert.equal(error.status, 429);
      return true;
    }
  );
});

test('a non-JSON response from an older Host maps to GM-5031', async function () {
  const api = createMarketApi({
    fetchImpl: async function fetchImpl() {
      return { status: 404, json: async function json() { throw new Error('not json'); } };
    },
    timeouts: { install: 1000 },
  });
  await assert.rejects(
    () => api.install({ gameId: 'jump', operationId: 'op-7' }),
    function check(error) {
      assert.equal(error.code, 'GM-5031');
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test('network failures and caller aborts are distinguishable', async function () {
  const api = createMarketApi({
    fetchImpl: async function fetchImpl() {
      throw new Error('offline');
    },
    timeouts: { games: 1000 },
  });
  await assert.rejects(
    () => api.listGames(),
    function check(error) {
      assert.equal(error.code, 'GM-5031');
      assert.equal(error.retryable, true);
      assert.equal(Boolean(error.cancelled), false);
      return true;
    }
  );

  const controller = new AbortController();
  controller.abort();
  const abortable = createMarketApi({
    fetchImpl: function fetchImpl(url, init) {
      return new Promise(function pending(resolve, reject) {
        if (init.signal.aborted) {
          reject(new Error('aborted'));
          return;
        }
        init.signal.addEventListener('abort', function onAbort() {
          reject(new Error('aborted'));
        });
      });
    },
    timeouts: { install: 1000 },
  });
  await assert.rejects(
    () => abortable.install({ gameId: 'jump', operationId: 'op-8', signal: controller.signal }),
    function check(error) {
      assert.equal(error.cancelled, true);
      assert.equal(error.retryable, false);
      return true;
    }
  );
});

test('request timeouts are reported as timed out transport errors', async function () {
  const api = createMarketApi({
    fetchImpl: function fetchImpl(url, init) {
      return new Promise(function pending(resolve, reject) {
        init.signal.addEventListener('abort', function onAbort() {
          reject(new Error('aborted'));
        });
      });
    },
    timeouts: { games: 15, health: 15 },
  });
  await assert.rejects(
    () => api.listGames(),
    function check(error) {
      assert.equal(error.code, 'GM-5031');
      assert.equal(error.timedOut, true);
      return true;
    }
  );
});

test('query builder drops empty values', function () {
  assert.equal(buildRequestQuery({ a: 1, b: null, c: '', d: 'x' }), '?a=1&d=x');
  assert.equal(buildRequestQuery({}), '');
});
