import test from 'node:test';
import assert from 'node:assert/strict';

import { createRuntimeBridge } from '../src/bridge.js';
import { createClock } from './helpers/fakes.js';
import { GM } from '../../shared/src/errors.js';
import {
  EVENTS,
  METHODS,
  createEvent,
  createRequest,
  createResponse,
} from '../../shared/src/protocol.js';

const INSTANCE = 'a'.repeat(32);
const NONCE = 'b'.repeat(32);

function makeBridge(overrides = {}) {
  const clock = createClock();
  const sent = [];
  const hellos = [];
  const fatals = [];
  const trusted = { name: 'iframe-window' };
  const bridge = createRuntimeBridge({
    instanceId: INSTANCE,
    nonce: NONCE,
    isTrustedSource: (source) => Boolean(source) && source.name === 'iframe-window',
    send: (message) => sent.push(message),
    onRequest: async (method) => ({ method }),
    onHello: (data) => hellos.push(data),
    onFatal: (error) => fatals.push(error),
    timers: clock,
    now: clock.now,
    ...overrides,
  });
  return { bridge, clock, sent, hellos, fatals, trusted };
}

test('bridge ignores messages from an untrusted source', async () => {
  const { bridge, sent } = makeBridge();
  const result = await bridge.handleIncoming(
    createEvent(EVENTS.HELLO, { instanceId: INSTANCE, nonce: NONCE, protocolVersion: 1 }),
    { name: 'other-frame' }
  );
  assert.equal(result, null);
  assert.equal(sent.length, 0);
  assert.equal(bridge.getInvalidCount(), 1);
});

test('bridge rejects malformed envelopes without replying', async () => {
  const { bridge, sent, trusted } = makeBridge();
  await bridge.handleIncoming({ v: 99, kind: 'req', id: 'x', method: 'ready' }, trusted);
  await bridge.handleIncoming({ v: 1, kind: 'nope' }, trusted);
  assert.equal(sent.length, 0);
  assert.ok(bridge.getInvalidCount() >= 2);
});

test('bridge accepts a matching hello and reports it once per message', async () => {
  const { bridge, hellos } = makeBridge();
  const hello = { instanceId: INSTANCE, nonce: NONCE, sdkVersion: '0.1.0', protocolVersion: 1 };
  await bridge.handleIncoming(createEvent(EVENTS.HELLO, hello), { name: 'iframe-window' });
  await bridge.handleIncoming(createEvent(EVENTS.HELLO, hello), { name: 'iframe-window' });
  assert.equal(hellos.length, 2);
  assert.equal(hellos[0].nonce, NONCE);
});

test('bridge drops a hello with the wrong nonce', async () => {
  const { bridge, hellos } = makeBridge();
  await bridge.handleIncoming(
    createEvent(EVENTS.HELLO, { instanceId: INSTANCE, nonce: 'c'.repeat(32), protocolVersion: 1 }),
    { name: 'iframe-window' }
  );
  assert.equal(hellos.length, 0);
  assert.equal(bridge.getInvalidCount(), 1);
});

test('bridge answers ready before the ready gate opens', async () => {
  const { bridge, sent } = makeBridge();
  bridge.markInitialized();
  await bridge.handleIncoming(createRequest('r1', METHODS.READY, { protocolVersion: 1 }), {
    name: 'iframe-window',
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].ok, true);
  assert.deepEqual(sent[0].result, { method: 'ready' });
});

test('bridge rejects requests before hello with GM-4031', async () => {
  const { bridge, sent } = makeBridge();
  await bridge.handleIncoming(createRequest('r0', METHODS.READY, {}), { name: 'iframe-window' });
  assert.equal(sent[0].error.code, GM.NOT_READY);
});

test('bridge rejects non-ready requests before the ready handshake', async () => {
  const { bridge, sent } = makeBridge();
  bridge.markInitialized();
  await bridge.handleIncoming(createRequest('r1', METHODS.STORAGE_LOAD, { key: 'current' }), {
    name: 'iframe-window',
  });
  assert.equal(sent[0].ok, false);
  assert.equal(sent[0].error.code, GM.NOT_READY);
});

test('bridge rejects unknown methods with GM-4004 after ready', async () => {
  const { bridge, sent } = makeBridge();
  bridge.markInitialized();
  bridge.markReady();
  await bridge.handleIncoming(createRequest('r1', 'storage.hack', {}), { name: 'iframe-window' });
  assert.equal(sent[0].ok, false);
  assert.equal(sent[0].error.code, GM.UNKNOWN_METHOD);
});

test('bridge maps handler failures to GM error responses', async () => {
  const { bridge, sent } = makeBridge({
    onRequest: async () => {
      const error = new Error('no capability');
      error.code = GM.CAPABILITY_DENIED;
      error.retryable = false;
      throw error;
    },
  });
  bridge.markInitialized();
  bridge.markReady();
  await bridge.handleIncoming(createRequest('r1', METHODS.STORAGE_SAVE, { key: 'current', data: 1 }), {
    name: 'iframe-window',
  });
  assert.equal(sent[0].ok, false);
  assert.equal(sent[0].error.code, GM.CAPABILITY_DENIED);
  assert.equal(sent[0].error.retryable, false);
});

test('bridge times out a slow request with GM-5005', async () => {
  const clock = createClock();
  const sent = [];
  const bridge = createRuntimeBridge({
    instanceId: INSTANCE,
    nonce: NONCE,
    isTrustedSource: () => true,
    send: (message) => sent.push(message),
    onRequest: () => new Promise(() => {}),
    onHello: () => {},
    timers: clock,
    now: clock.now,
  });
  bridge.markInitialized();
  bridge.markReady();
  const pending = bridge.handleIncoming(createRequest('r1', METHODS.STORAGE_LOAD, { key: 'current' }), {});
  clock.tick(3000);
  await pending;
  assert.equal(sent[0].ok, false);
  assert.equal(sent[0].error.code, GM.BRIDGE_TIMEOUT);
});

test('bridge serializes write methods and keeps reads concurrent', async () => {
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const { bridge, sent } = makeBridge({
    onRequest: async (method, params) => {
      order.push(`${method}:start:${params.key || ''}`);
      if (method === METHODS.STORAGE_SAVE && order.filter((line) => line.includes('storage.save:start')).length === 1) {
        await firstGate;
      }
      order.push(`${method}:end:${params.key || ''}`);
      return params;
    },
  });
  bridge.markInitialized();
  bridge.markReady();
  const first = bridge.handleIncoming(createRequest('r1', METHODS.STORAGE_SAVE, { key: 'a', data: 1 }), { name: 'iframe-window' });
  const second = bridge.handleIncoming(createRequest('r2', METHODS.STORAGE_SAVE, { key: 'b', data: 2 }), { name: 'iframe-window' });
  const read = bridge.handleIncoming(createRequest('r3', METHODS.STORAGE_LOAD, { key: 'c' }), { name: 'iframe-window' });
  await read;
  assert.ok(sent.some((message) => message.id === 'r3' && message.ok === true));
  assert.deepEqual(order.filter((line) => line.includes('storage.save:start')), ['storage.save:start:a']);
  releaseFirst();
  await first;
  await second;
  assert.deepEqual(order.filter((line) => line.includes('storage.save:start')), [
    'storage.save:start:a',
    'storage.save:start:b',
  ]);
  const firstEnd = order.indexOf('storage.save:end:a');
  const secondStart = order.indexOf('storage.save:start:b');
  assert.ok(firstEnd >= 0 && firstEnd < secondStart, 'second write starts only after the first finishes');
});

test('bridge matches ping responses by id and rejects on timeout', async () => {
  const { bridge, clock, sent } = makeBridge();
  const pong = bridge.sendRequest(METHODS.PING, { at: 123 }, 2000);
  const ping = sent.find((message) => message.kind === 'req' && message.method === METHODS.PING);
  assert.ok(ping);
  await bridge.handleIncoming(createResponse(ping.id, { at: 123 }), { name: 'iframe-window' });
  assert.deepEqual(await pong, { at: 123 });

  const timedOut = bridge.sendRequest(METHODS.PING, { at: 456 }, 2000);
  clock.tick(2000);
  await assert.rejects(timedOut, (error) => error.code === GM.BRIDGE_TIMEOUT);
});

test('bridge terminates after more than 50 invalid messages in 10s', async () => {
  const { bridge, fatals } = makeBridge();
  for (let index = 0; index < 51; index += 1) {
    await bridge.handleIncoming({ v: 1, kind: 'bad' }, { name: 'iframe-window' });
  }
  assert.equal(fatals.length, 1);
  assert.equal(fatals[0].code, GM.MESSAGE_INVALID);
});

test('unknown responses are ignored rather than crashing', async () => {
  const { bridge, sent } = makeBridge();
  const result = await bridge.handleIncoming(createResponse('never-sent', { ok: true }), {
    name: 'iframe-window',
  });
  assert.equal(result, null);
  assert.equal(sent.length, 0);
});
