import test from 'node:test';
import assert from 'node:assert/strict';

import { createGameSDK, GameError, isGameError } from '../src/sdk.js';
import { createClock, flushAsync } from '../../runtime/test/helpers/fakes.js';
import { SDK_VERSION } from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import { EVENTS, METHODS, createRequest, createResponse } from '../../shared/src/protocol.js';

const INSTANCE = 'a'.repeat(32);
const NONCE = 'b'.repeat(32);

function makeInit(overrides = {}) {
  return {
    protocolVersion: 1,
    instanceId: INSTANCE,
    nonce: NONCE,
    gameId: 'snake',
    gameVersion: '0.1.0',
    runtimeVersion: '0.1.0',
    sdkVersion: '0.1.0',
    supportedSdkRange: '>=0.1.0 <0.2.0',
    locale: 'zh',
    theme: 'dark',
    reducedMotion: false,
    capabilities: ['storage', 'score'],
    limits: { saveBytes: 1024 * 1024, saveKeys: 32, scoreMetaBytes: 2048 },
    viewport: { width: 960, height: 540, dpr: 2 },
    ...overrides,
  };
}

function makeRuntimeInfo(overrides = {}) {
  return {
    sdkVersion: '0.1.0',
    protocolVersion: 1,
    runtimeVersion: '0.1.0',
    gameId: 'snake',
    gameVersion: '0.1.0',
    locale: 'zh',
    theme: 'dark',
    reducedMotion: false,
    capabilities: ['storage', 'score'],
    viewport: { width: 960, height: 540, dpr: 2 },
    ready: true,
    ...overrides,
  };
}

function createHarness(options = {}) {
  const clock = createClock();
  const sent = [];
  let uuid = 0;
  const winListeners = new Map();

  const host = {
    postMessage(message, targetOrigin) {
      sent.push({ message, targetOrigin });
    },
  };

  const win = {
    parent: host,
    location: {
      search: options.search === undefined ? `?instance=${INSTANCE}&nonce=${NONCE}` : options.search,
    },
    crypto: {
      randomUUID() {
        uuid += 1;
        return `uuid-${uuid}`;
      },
    },
    addEventListener(type, handler) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const list = winListeners.get(type);
      if (!list) return;
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    listenerCount(type) {
      return (winListeners.get(type) || []).length;
    },
  };
  if (options.detachedParent === true) win.parent = win;

  const game = createGameSDK({
    window: win,
    location: win.location,
    timers: clock,
    now: clock.now,
    crypto: win.crypto,
  });

  function deliver(data, source) {
    for (const handler of (winListeners.get('message') || []).slice()) {
      handler({ source: source || host, data });
    }
  }

  function messages(predicate) {
    return sent.map((entry) => entry.message).filter(predicate);
  }

  function events(name) {
    return messages((message) => message.kind === 'evt' && message.event === name);
  }

  function requests(method) {
    return messages((message) => message.kind === 'req' && message.method === method);
  }

  function respond(request, result) {
    deliver(createResponse(request.id, result));
  }

  function respondError(request, code, message, retryable) {
    deliver({
      v: 1,
      id: request.id,
      kind: 'res',
      ok: false,
      error: { code, message: message || code, retryable: retryable === true },
    });
  }

  async function handshake(initOverrides) {
    const readyPromise = game.ready();
    const hello = events(EVENTS.HELLO)[0];
    assert.ok(hello, 'hello was sent');
    deliver({ v: 1, kind: 'evt', event: EVENTS.INIT, data: makeInit(initOverrides) });
    const readyRequest = requests(METHODS.READY)[0];
    assert.ok(readyRequest, 'ready request was sent');
    respond(readyRequest, makeRuntimeInfo());
    return readyPromise;
  }

  return { clock, sent, host, win, game, deliver, messages, events, requests, respond, respondError, handshake };
}

test('ready performs the hello -> init -> ready handshake and exposes runtime info', async () => {
  const harness = createHarness();
  const pending = harness.game.ready();
  const hello = harness.events(EVENTS.HELLO)[0];
  assert.equal(hello.data.instanceId, INSTANCE);
  assert.equal(hello.data.nonce, NONCE);
  assert.equal(hello.data.protocolVersion, 1);
  assert.equal(hello.data.sdkVersion, SDK_VERSION);
  assert.equal(harness.sent[0].targetOrigin, '*');

  harness.deliver({ v: 1, kind: 'evt', event: EVENTS.INIT, data: makeInit() });
  const readyRequest = harness.requests(METHODS.READY)[0];
  assert.equal(readyRequest.params.protocolVersion, 1);
  harness.respond(readyRequest, makeRuntimeInfo());

  const info = await pending;
  assert.equal(info.gameId, 'snake');
  assert.equal(info.theme, 'dark');
  assert.equal(info.ready, true);
  assert.equal(info.protocolVersion, 1);
  assert.deepEqual(info.capabilities, ['storage', 'score']);
  assert.deepEqual(info.viewport, { width: 960, height: 540, dpr: 2 });
  assert.equal(harness.game.runtime, info);
  assert.equal(harness.game.runtime.ready, true);
});

test('hello retries every 250ms until init arrives', async () => {
  const harness = createHarness();
  const pending = harness.game.ready();
  assert.equal(harness.events(EVENTS.HELLO).length, 1);
  harness.clock.tick(250);
  assert.equal(harness.events(EVENTS.HELLO).length, 2);
  harness.clock.tick(250);
  assert.equal(harness.events(EVENTS.HELLO).length, 3);

  harness.deliver({ v: 1, kind: 'evt', event: EVENTS.INIT, data: makeInit() });
  harness.respond(harness.requests(METHODS.READY)[0], makeRuntimeInfo());
  await pending;
  harness.clock.tick(250);
  assert.equal(harness.events(EVENTS.HELLO).length, 3);
});

test('ready times out with GM-5001', async () => {
  const harness = createHarness();
  const pending = harness.game.ready(1000);
  harness.clock.tick(1000);
  await assert.rejects(pending, (error) => error.code === GM.HANDSHAKE_TIMEOUT);
  await assert.rejects(harness.game.storage.load('current'), (error) => error.code === GM.HANDSHAKE_TIMEOUT);
});

test('hello stops after 30 attempts with GM-5001', async () => {
  const harness = createHarness();
  const pending = harness.game.ready();
  harness.clock.tick(250 * 30);
  await assert.rejects(pending, (error) => error.code === GM.HANDSHAKE_TIMEOUT);
});

test('ready rejects with GM-5003 outside an iframe', async () => {
  const harness = createHarness({ detachedParent: true });
  await assert.rejects(harness.game.ready(), (error) => error.code === GM.NO_RUNTIME);
});

test('ready rejects with GM-5003 when the launch query is missing', async () => {
  const harness = createHarness({ search: '' });
  await assert.rejects(harness.game.ready(), (error) => error.code === GM.NO_RUNTIME);
});

test('init messages with a mismatched nonce are ignored', async () => {
  const harness = createHarness();
  const pending = harness.game.ready();
  harness.deliver({ v: 1, kind: 'evt', event: EVENTS.INIT, data: makeInit({ nonce: 'c'.repeat(32) }) });
  assert.equal(harness.requests(METHODS.READY).length, 0);
  harness.deliver({ v: 1, kind: 'evt', event: EVENTS.INIT, data: makeInit() });
  assert.equal(harness.requests(METHODS.READY).length, 1);
  harness.respond(harness.requests(METHODS.READY)[0], makeRuntimeInfo());
  await pending;
});

test('an unsupported protocol version fails with GM-5002', async () => {
  const harness = createHarness();
  const pending = harness.game.ready();
  harness.deliver({ v: 1, kind: 'evt', event: EVENTS.INIT, data: makeInit({ protocolVersion: 2 }) });
  await assert.rejects(pending, (error) => error.code === GM.PROTOCOL_MISMATCH);
});

test('storage.save posts data and resolves the Host result', async () => {
  const harness = createHarness();
  await harness.handshake();
  const pending = harness.game.storage.save('current', { snake: [1, 2], score: 10 });
  const request = harness.requests(METHODS.STORAGE_SAVE)[0];
  assert.equal(request.params.key, 'current');
  assert.deepEqual(request.params.data, { snake: [1, 2], score: 10 });
  harness.respond(request, { key: 'current', bytes: 33, revision: 4, updatedAt: '2026-10-18T00:00:00.000Z' });
  assert.deepEqual(await pending, {
    key: 'current',
    bytes: 33,
    revision: 4,
    updatedAt: '2026-10-18T00:00:00.000Z',
  });
});

test('storage.save surfaces GM errors as GameError with retryable', async () => {
  const harness = createHarness();
  await harness.handshake();
  const pending = harness.game.storage.save('current', { huge: true });
  harness.respondError(harness.requests(METHODS.STORAGE_SAVE)[0], GM.STORAGE_QUOTA, 'too big', true);
  await assert.rejects(pending, (error) => {
    assert.ok(error instanceof GameError);
    assert.equal(error.code, GM.STORAGE_QUOTA);
    assert.equal(error.retryable, true);
    assert.ok(harness.game.isGameError(error));
    return true;
  });
});

test('pre-ready methods reject with GM-4031 without queueing', async () => {
  const harness = createHarness();
  await assert.rejects(harness.game.storage.save('current', 1), (error) => error.code === GM.NOT_READY);
  await assert.rejects(harness.game.session.start(), (error) => error.code === GM.NOT_READY);
  await assert.rejects(harness.game.score.getBest(), (error) => error.code === GM.NOT_READY);
});

test('storage.load returns null for a missing key', async () => {
  const harness = createHarness();
  await harness.handshake();
  const pending = harness.game.storage.load('current');
  harness.respond(harness.requests(METHODS.STORAGE_LOAD)[0], null);
  assert.equal(await pending, null);
});

test('request timeouts reject with GM-5005', async () => {
  const harness = createHarness();
  await harness.handshake();
  const pending = harness.game.storage.load('current');
  harness.clock.tick(3000);
  await assert.rejects(pending, (error) => error.code === GM.BRIDGE_TIMEOUT);
});

test('invalid storage keys are rejected locally with GM-4133', async () => {
  const harness = createHarness();
  await harness.handshake();
  await assert.rejects(harness.game.storage.save('Bad Key', 1), (error) => error.code === GM.STORAGE_KEY_INVALID);
  assert.equal(harness.requests(METHODS.STORAGE_SAVE).length, 0);
});

test('unserializable values are rejected locally with GM-4134', async () => {
  const harness = createHarness();
  await harness.handshake();
  await assert.rejects(harness.game.storage.save('current', { fn: () => 1 }), (error) => error.code === GM.VALUE_NOT_SERIALIZABLE);
  await assert.rejects(harness.game.storage.save('current', { when: new Date() }), (error) => error.code === GM.VALUE_NOT_SERIALIZABLE);
});

test('oversized values are rejected locally with GM-4131', async () => {
  const harness = createHarness();
  await harness.handshake();
  await assert.rejects(
    harness.game.storage.save('current', 'x'.repeat(300000)),
    (error) => error.code === GM.SAVE_TOO_LARGE
  );
});

test('session.start and session.end map onto the bridge protocol', async () => {
  const harness = createHarness();
  await harness.handshake();
  const startPending = harness.game.session.start();
  const startRequest = harness.requests(METHODS.SESSION_START)[0];
  harness.respond(startRequest, {
    playSessionId: 'ps_1234567890abcdef',
    startedAt: '2026-10-18T00:00:00.000Z',
    adopted: true,
  });
  assert.equal((await startPending).adopted, true);

  const endPending = harness.game.session.end({ outcome: 'completed', score: 40 });
  const endRequest = harness.requests(METHODS.SESSION_END)[0];
  assert.deepEqual(endRequest.params, { outcome: 'completed', score: 40 });
  harness.respond(endRequest, {
    playSessionId: 'ps_1234567890abcdef',
    startedAt: '2026-10-18T00:00:00.000Z',
    endedAt: '2026-10-18T00:01:00.000Z',
    outcome: 'completed',
    score: 40,
    ignored: false,
  });
  assert.equal((await endPending).outcome, 'completed');
});

test('session.end defaults to completed and validates unknown outcomes', async () => {
  const harness = createHarness();
  await harness.handshake();
  await assert.rejects(harness.game.session.end({ outcome: 'ragequit' }), (error) => error.code === GM.INVALID_PARAM);
  const pending = harness.game.session.end();
  assert.equal(harness.requests(METHODS.SESSION_END)[0].params.outcome, 'completed');
  harness.respond(harness.requests(METHODS.SESSION_END)[0], null);
  assert.equal(await pending, null);
});

test('score.submit validates input and returns best/isBest', async () => {
  const harness = createHarness();
  await harness.handshake();
  await assert.rejects(harness.game.score.submit(Number.NaN), (error) => error.code === GM.INVALID_PARAM);
  await assert.rejects(
    harness.game.score.submit(10, { blob: 'x'.repeat(3000) }),
    (error) => error.code === GM.INVALID_PARAM
  );
  const pending = harness.game.score.submit(40, { level: 2 });
  const request = harness.requests(METHODS.SCORE_SUBMIT)[0];
  assert.deepEqual(request.params, { score: 40, meta: { level: 2 } });
  harness.respond(request, { best: 100, isBest: true, submittedAt: '2026-10-18T00:00:00.000Z' });
  assert.deepEqual(await pending, { best: 100, isBest: true, submittedAt: '2026-10-18T00:00:00.000Z' });
});

test('score.getBest returns null when nothing was submitted', async () => {
  const harness = createHarness();
  await harness.handshake();
  const pending = harness.game.score.getBest();
  harness.respond(harness.requests(METHODS.SCORE_GET_BEST)[0], null);
  assert.equal(await pending, null);
});

test('lifecycle events registered before ready are buffered and delivered', async () => {
  const harness = createHarness();
  const seen = [];
  harness.game.lifecycle.on('pause', (payload) => seen.push(payload));
  const pending = harness.game.ready();
  harness.deliver({ v: 1, kind: 'evt', event: EVENTS.INIT, data: makeInit() });
  harness.deliver({
    v: 1,
    kind: 'evt',
    event: EVENTS.PAUSE,
    data: { reason: 'hidden', at: 1700000000000 },
  });
  assert.equal(seen.length, 0, 'buffered until ready');
  harness.respond(harness.requests(METHODS.READY)[0], makeRuntimeInfo());
  await pending;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].reason, 'hidden');
});

test('lifecycle callback exceptions are isolated and unsubscribe works', async () => {
  const harness = createHarness();
  await harness.handshake();
  const seen = [];
  harness.game.lifecycle.on('resume', () => {
    throw new Error('handler boom');
  });
  const off = harness.game.lifecycle.on('resume', () => seen.push('ok'));
  harness.deliver({ v: 1, kind: 'evt', event: EVENTS.RESUME, data: { reason: 'user', at: 1 } });
  assert.deepEqual(seen, ['ok']);
  off();
  harness.deliver({ v: 1, kind: 'evt', event: EVENTS.RESUME, data: { reason: 'user', at: 2 } });
  assert.deepEqual(seen, ['ok']);
});

test('agent.on backfills the current status after ready', async () => {
  const harness = createHarness();
  await harness.handshake();
  const statuses = [];
  harness.game.agent.on('status', (status) => statuses.push(status));
  await flushAsync();
  const request = harness.requests(METHODS.AGENT_GET_STATUS)[0];
  assert.ok(request);
  harness.respond(request, {
    state: 'running',
    label: '正在工作…',
    sessionId: 's1',
    updatedAt: '2026-10-18T00:00:00.000Z',
    source: 'turn',
    seq: 2,
    since: '2026-10-18T00:00:00.000Z',
  });
  await flushAsync();
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].state, 'running');
  assert.equal(statuses[0].seq, 2);
});

test('agent-status events reach subscribers', async () => {
  const harness = createHarness();
  await harness.handshake();
  const statuses = [];
  harness.game.agent.on('status', (status) => statuses.push(status));
  harness.deliver({
    v: 1,
    kind: 'evt',
    event: EVENTS.AGENT_STATUS,
    data: { state: 'waiting-user', label: '需要你回答一个问题', seq: 5 },
  });
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].state, 'waiting-user');
});

test('theme and viewport events update the live runtime view', async () => {
  const harness = createHarness();
  await harness.handshake();
  const runtime = harness.game.runtime;
  harness.deliver({ v: 1, kind: 'evt', event: EVENTS.THEME, data: { theme: 'light', reducedMotion: true } });
  assert.equal(runtime.theme, 'light');
  assert.equal(runtime.reducedMotion, true);
  harness.deliver({ v: 1, kind: 'evt', event: EVENTS.VIEWPORT, data: { width: 1280, height: 720, dpr: 3 } });
  assert.deepEqual(runtime.viewport, { width: 1280, height: 720, dpr: 3 });
  assert.equal(harness.game.runtime, runtime);
  assert.ok(Object.isFrozen(runtime));
});

test('runtime pings receive a pong response', async () => {
  const harness = createHarness();
  await harness.handshake();
  harness.deliver(createRequest('ping-1', METHODS.PING, { at: 12345 }));
  const response = harness.messages((message) => message.kind === 'res' && message.id === 'ping-1')[0];
  assert.equal(response.ok, true);
  assert.equal(response.result.at, 12345);
});

test('unknown or foreign messages are ignored without crashing', async () => {
  const harness = createHarness();
  await harness.handshake();
  harness.deliver({ v: 1, kind: 'evt', event: 'mystery', data: {} });
  harness.deliver({ v: 99, kind: 'evt', event: 'pause' });
  harness.deliver({ v: 1, kind: 'res', id: 'unknown', ok: true, result: 1 });
  harness.deliver(createRequest('ping-2', METHODS.PING, { at: 1 }), { stranger: true });
  const response = harness.messages((message) => message.id === 'ping-2');
  assert.equal(response.length, 0);
  assert.equal(harness.win.listenerCount('message'), 1);
});

test('at most 32 bridge requests are in flight', async () => {
  const harness = createHarness();
  await harness.handshake();
  const pending = [];
  for (let index = 0; index < 32; index += 1) pending.push(harness.game.storage.load('current'));
  await assert.rejects(
    harness.game.storage.load('current'),
    (error) => error.code === GM.BACKPRESSURE
  );
  assert.equal(harness.requests(METHODS.STORAGE_LOAD).length, 32);
  // Leave no dangling rejections: reject all outstanding requests explicitly.
  for (const request of harness.requests(METHODS.STORAGE_LOAD)) {
    harness.respondError(request, GM.SAVE_NOT_FOUND, 'gone', false);
  }
  await Promise.allSettled(pending);
});

test('isGameError recognises SDK errors and plain GM-shaped errors', () => {
  assert.equal(isGameError(new GameError(GM.NOT_READY)), true);
  assert.equal(isGameError({ code: GM.SAVE_NOT_FOUND, message: 'x', retryable: false }), true);
  assert.equal(isGameError(new Error('plain')), false);
  assert.equal(isGameError(null), false);
});
