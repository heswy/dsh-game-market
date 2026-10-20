import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMarketApi, readFileBytes, readFileText, buildRequestQuery } from '../src/api-v1.js';
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

test('request timeouts are reported as timed out transport errors', async function (t) {
  // The fake fetch has no socket handle; unlike real I/O it cannot keep Node
  // alive while the API's unref'd timeout fires. Own that lifetime in this test.
  const keepAlive = setInterval(function keepPendingFetchAlive() {}, 1000);
  t.after(function cleanup() { clearInterval(keepAlive); });
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


// ---------------------------------------------------------------------------
// Local asset-zip-v2 install: raw bytes, application/zip (CR7-03)
// ---------------------------------------------------------------------------

/**
 * 2384-byte ZIP-shaped sample with high bytes and invalid-UTF-8 sequences.
 * Any text()/readAsText() round-trip corrupts it (Codex measured 2384 -> 2474).
 */
function makeZipSample() {
  const size = 2384;
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) bytes[index] = (index * 37 + 0x5a) & 0xff;
  bytes.set([0x50, 0x4b, 0x03, 0x04], 0);
  bytes.set([0xff, 0xfe, 0x80, 0xc3, 0x28, 0x00, 0xf0, 0x9f, 0x92, 0xa9, 0x7f, 0xed, 0xa0, 0x80], 32);
  return bytes.buffer;
}

function sha256Of(buffer) {
  return createHash('sha256').update(Buffer.from(new Uint8Array(buffer))).digest('hex');
}

function assertSameBytes(actual, expected) {
  assert.ok(actual instanceof ArrayBuffer, 'uploaded body must be an ArrayBuffer, not text');
  assert.equal(typeof actual, 'object');
  assert.equal(actual.byteLength, expected.byteLength);
  assert.equal(
    sha256Of(actual),
    sha256Of(expected),
    'source and uploaded bytes must have the same sha256'
  );
  assert.deepEqual(Buffer.from(new Uint8Array(actual)), Buffer.from(new Uint8Array(expected)));
}

test('install-local zip uploads the exact raw bytes with Content-Type application/zip', async function () {
  const calls = [];
  const api = createMarketApi({
    fetchImpl: captureFetch(okResponse({ gameId: 'orbit-courier', version: '1.0.0', source: 'local' }), calls),
  });
  const source = makeZipSample();
  const sourceSha256 = sha256Of(source);
  const result = await api.installLocal({
    fileName: 'orbit-courier-1.0.0.dshgame.zip',
    format: 'asset-zip-v2',
    bytes: source,
    operationId: 'op-zip',
  });
  assert.equal(result.source, 'local');

  assert.equal(calls.length, 1);
  const init = calls[0].init;
  const url = new URL(calls[0].url, 'http://x/');
  assert.equal(url.pathname, '/api/game-market/install-local');
  assert.equal(url.searchParams.get('operationId'), 'op-zip');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['content-type'], 'application/zip');
  assert.notEqual(typeof init.body, 'string', 'no text encoding may be involved');
  assertSameBytes(init.body, source);
  // Evidence for the report: the uploaded byte length is the true source size
  // (the browser derives Content-Length from this ArrayBuffer body).
  assert.equal(init.body.byteLength, 2384);
  assert.equal(sha256Of(init.body), sourceSha256);
});

test('install-local zip reads a File via arrayBuffer() and never calls text()', async function () {
  const calls = [];
  const api = createMarketApi({
    fetchImpl: captureFetch(okResponse({ gameId: 'orbit-courier', version: '1.0.0' }), calls),
  });
  const source = makeZipSample();
  let textCalls = 0;
  const file = {
    name: 'orbit-courier-1.0.0.dshgame.zip',
    type: 'application/zip',
    size: source.byteLength,
    arrayBuffer: async function arrayBuffer() {
      return source;
    },
    text: async function text() {
      textCalls += 1;
      return '\ufffd'.repeat(2474);
    },
  };
  await api.installLocal({ file: file, operationId: 'op-zip-file' });
  assert.equal(textCalls, 0, 'zip path must not use text()');
  assert.equal(calls[0].init.headers['content-type'], 'application/zip');
  assertSameBytes(calls[0].init.body, source);
});

test('install-local zip falls back to FileReader.readAsArrayBuffer', async function () {
  const calls = [];
  const api = createMarketApi({ fetchImpl: captureFetch(okResponse({ gameId: 'orbit-courier' }), calls) });
  const source = makeZipSample();
  class FakeReader {
    readAsArrayBuffer(file) {
      this.result = file.rawBytes;
      if (this.onload) this.onload();
    }
  }
  const file = { name: 'orbit-courier-1.0.0.dshgame.zip', type: 'application/zip', rawBytes: source };
  await api.installLocal({ file: file, FileReader: FakeReader, operationId: 'op-zip-reader' });
  assert.equal(calls[0].init.headers['content-type'], 'application/zip');
  assertSameBytes(calls[0].init.body, source);
});

test('install-local zip accepts an inline Blob-like bytes source', async function () {
  const calls = [];
  const api = createMarketApi({ fetchImpl: captureFetch(okResponse({ gameId: 'orbit-courier' }), calls) });
  const source = makeZipSample();
  await api.installLocal({
    fileName: 'orbit-courier-1.0.0.dshgame.zip',
    bytes: { arrayBuffer: async function arrayBuffer() { return source; } },
    operationId: 'op-zip-blob',
  });
  assertSameBytes(calls[0].init.body, source);
});

test('install-local rejects an unsupported local package type with GM-4150', async function () {
  const calls = [];
  const api = createMarketApi({ fetchImpl: captureFetch(okResponse({ gameId: 'x' }), calls) });
  await assert.rejects(
    function upload() {
      return api.installLocal({ fileName: 'notes.txt', file: { name: 'notes.txt', type: 'text/plain' } });
    },
    function check(error) {
      assert.ok(error instanceof GameMarketApiError);
      assert.equal(error.code, 'GM-4150');
      return true;
    }
  );
  assert.equal(calls.length, 0);
});

test('install-local still sends HTML as text/html (no regression)', async function () {
  const calls = [];
  const api = createMarketApi({ fetchImpl: captureFetch(okResponse({ gameId: 'mine' }), calls) });
  const text = '<!doctype html><html><body>ok</body></html>';
  await api.installLocal({ text: text, operationId: 'op-html' });
  assert.equal(calls[0].init.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(calls[0].init.body, text);
  assert.equal(typeof calls[0].init.body, 'string');
});

test('readFileBytes normalizes ArrayBuffer/views and surfaces reader failures', async function () {
  const buffer = makeZipSample();
  assertSameBytes(await readFileBytes({ arrayBuffer: async function arrayBuffer() { return buffer; } }), buffer);
  assertSameBytes(
    await readFileBytes({ arrayBuffer: async function arrayBuffer() { return new Uint8Array(buffer); } }),
    buffer
  );
  await assert.rejects(function noReader() { return readFileBytes({ name: 'x.zip' }, { FileReader: null }); }, /FileReader/);
  class BrokenReader {
    readAsArrayBuffer() {
      this.error = new Error('disk');
      if (this.onerror) this.onerror();
    }
  }
  await assert.rejects(
    function broken() {
      return readFileBytes({ name: 'x.zip' }, { FileReader: BrokenReader });
    },
    /disk/
  );
});
