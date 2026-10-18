import test from 'node:test';
import assert from 'node:assert/strict';

import { createGameRuntime } from '../src/index.js';
import { createGameSDK } from '../../sdk/src/sdk.js';
import { EVENTS, METHODS } from '../../shared/src/protocol.js';
import { createClock, createFakeApi, createFakeDocument, createFakeElement, createFakeWindow, flushAsync } from './helpers/fakes.js';

const INSTANCE = 'a'.repeat(32);
const NONCE = 'b'.repeat(32);

function makeLaunchInfo(overrides = {}) {
  return {
    instanceId: INSTANCE,
    nonce: NONCE,
    entryUrl: `/api/game-market/entry?gameId=snake&version=0.1.0&instance=${INSTANCE}&nonce=${NONCE}`,
    preview: { icon: null, cover: null },
    runtimeVersion: '0.1.0',
    sdkVersion: '0.1.0',
    capabilities: ['storage', 'score'],
    limits: { saveBytes: 1024 * 1024, saveKeys: 32, scoreMetaBytes: 2048 },
    viewport: { width: 960, height: 540, fit: 'contain' },
    hostEpoch: 'epoch-1',
    mode: 'start',
    ...overrides,
  };
}

function makeContext(overrides = {}) {
  const clock = createClock();
  const doc = createFakeDocument();
  const win = createFakeWindow(doc);
  const container = createFakeElement('div');
  const api = createFakeApi();
  const events = [];
  const controller = createGameRuntime({
    container,
    api,
    environment: { theme: 'dark', reducedMotion: false, locale: 'zh' },
    onEvent: (event) => events.push(event),
    window: win,
    document: doc,
    timers: clock,
    now: clock.now,
  });
  return { controller, clock, doc, win, container, api, events };
}

/**
 * Wire a real SDK instance to the real Runtime through the same postMessage
 * envelopes. `iframeWindow` is the shared transport; direction is decided by
 * the envelope shape (this is exactly what the browser does with two windows).
 */
function connectGameWindow(context) {
  const iframe = context.container.children[0];
  const iframeWindow = iframe.contentWindow;
  iframe.dispatchEvent('load', {});
  const sdkDoc = createFakeDocument();
  const sdkWin = createFakeWindow(sdkDoc);
  sdkWin.parent = iframeWindow;
  sdkWin.location = { search: `?instance=${INSTANCE}&nonce=${NONCE}` };
  let uuid = 0;
  sdkWin.crypto = {
    randomUUID() {
      uuid += 1;
      return `uuid-${uuid}`;
    },
  };

  iframeWindow.postMessage = function postMessage(message) {
    if (message.kind === 'req' && message.method === METHODS.PING) {
      sdkWin.dispatchEvent('message', { source: iframeWindow, data: message });
      return;
    }
    if (message.kind === 'req' || (message.kind === 'evt' && message.event === EVENTS.HELLO)) {
      context.win.dispatchEvent('message', { source: iframeWindow, data: message });
      return;
    }
    if (message.kind === 'res' && !String(message.id).startsWith('rt-')) {
      sdkWin.dispatchEvent('message', { source: iframeWindow, data: message });
      return;
    }
    if (message.kind === 'res') {
      context.win.dispatchEvent('message', { source: iframeWindow, data: message });
      return;
    }
    sdkWin.dispatchEvent('message', { source: iframeWindow, data: message });
  };

  const game = createGameSDK({
    window: sdkWin,
    location: sdkWin.location,
    timers: context.clock,
    now: context.clock.now,
    crypto: sdkWin.crypto,
  });
  return { game, iframe, iframeWindow, sdkWin };
}

test('real Runtime + real SDK: handshake, autosave, pause and destroy', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const { game } = connectGameWindow(context);

  const lifecycle = [];
  const savedDuringBeforeSave = [];
  game.lifecycle.on('before-save', async (payload) => {
    savedDuringBeforeSave.push(payload.reason);
    await game.storage.save('current', { snake: [{ x: 1, y: 1 }], score: 30 });
  });
  game.lifecycle.on('pause', (payload) => lifecycle.push(['pause', payload.reason]));
  game.lifecycle.on('resume', (payload) => lifecycle.push(['resume', payload.reason]));

  const info = await game.ready();
  await flushAsync();
  context.clock.tick(0);
  await flushAsync();
  assert.equal(info.gameId, 'snake');
  assert.equal(info.capabilities.includes('storage'), true);
  assert.equal(context.controller.getState().state, 'playing');

  // Chunked ticks keep the 5s heartbeat in lockstep with the 30s autosave.
  for (let index = 0; index < 6; index += 1) {
    context.clock.tick(5000);
    await flushAsync();
  }
  assert.deepEqual(savedDuringBeforeSave, ['interval']);
  assert.deepEqual(context.api.state.save.values.current, { snake: [{ x: 1, y: 1 }], score: 30 });
  assert.ok(context.events.some((event) => event.type === 'save-status' && event.status === 'saved'));

  const pauseResult = await context.controller.pause('user');
  await flushAsync();
  assert.deepEqual(pauseResult, { ok: true, saveStale: false });
  assert.equal(context.controller.getState().state, 'paused');
  assert.deepEqual(lifecycle, [['pause', 'user']]);

  context.controller.resume();
  await flushAsync();
  assert.equal(context.controller.getState().state, 'playing');
  assert.deepEqual(lifecycle, [
    ['pause', 'user'],
    ['resume', 'user'],
  ]);

  context.controller.destroy();
  assert.equal(context.controller.getState().state, 'exited');
  assert.ok(context.events.some((event) => event.type === 'exit'));
});

test('real Runtime + real SDK: resume-paused waits for resume()', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo({ mode: 'resume-paused' }));
  const { game } = connectGameWindow(context);
  const lifecycle = [];
  game.lifecycle.on('pause', (payload) => lifecycle.push(['pause', payload.reason]));
  game.lifecycle.on('resume', (payload) => lifecycle.push(['resume', payload.reason]));

  const info = await game.ready();
  await flushAsync();
  context.clock.tick(0);
  await flushAsync();
  assert.equal(info.ready, true);
  assert.equal(context.controller.getState().state, 'paused');
  assert.deepEqual(lifecycle, [['pause', 'user']]);

  context.controller.resume();
  await flushAsync();
  assert.equal(context.controller.getState().state, 'playing');
  assert.deepEqual(lifecycle, [
    ['pause', 'user'],
    ['resume', 'user'],
  ]);
});

test('real Runtime + real SDK: storage, score, session and agent round-trips', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const { game } = connectGameWindow(context);
  await game.ready();
  await flushAsync();

  assert.equal(await game.storage.load('current'), null);

  const saveResult = await game.storage.save('current', { score: 10 });
  assert.equal(saveResult.key, 'current');
  assert.equal(saveResult.revision, 1);
  const loaded = await game.storage.load('current');
  assert.deepEqual(loaded.data, { score: 10 });

  const removed = await game.storage.remove('current');
  assert.equal(removed.removed, true);
  assert.equal(await game.storage.load('current'), null);

  const started = await game.session.start();
  assert.equal(started.playSessionId, 'ps_1234567890abcdef');
  const ended = await game.session.end({ outcome: 'completed', score: 10 });
  assert.equal(ended.outcome, 'completed');

  const submitted = await game.score.submit(10);
  assert.equal(submitted.best, 100);
  const best = await game.score.getBest();
  assert.equal(best.score, 120);

  const status = await game.agent.getStatus();
  assert.equal(status.state, 'idle');

  const snapshot = {
    state: 'running',
    label: '正在工作…',
    labelKey: null,
    sessionId: 's1',
    updatedAt: '2026-10-18T00:00:00.000Z',
    source: 'turn',
    seq: 1,
    since: '2026-10-18T00:00:00.000Z',
    turnId: null,
  };
  context.controller.handleAgentState(snapshot);
  await flushAsync();
  assert.equal((await game.agent.getStatus()).seq, 1);
});

test('real Runtime + real SDK: unsupported protocol is rejected end-to-end', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = context.container.children[0];
  const iframeWindow = iframe.contentWindow;
  iframe.dispatchEvent('load', {});
  const sdkDoc = createFakeDocument();
  const sdkWin = createFakeWindow(sdkDoc);
  sdkWin.parent = iframeWindow;
  sdkWin.location = { search: `?instance=${INSTANCE}&nonce=${NONCE}` };
  sdkWin.crypto = { randomUUID: () => 'uuid-fixed' };

  // Deliberately break the protocol version in the Runtime -> game init.
  let first = true;
  iframeWindow.postMessage = function postMessage(message) {
    if (message.kind === 'evt' && message.event === EVENTS.INIT && first) {
      first = false;
      sdkWin.dispatchEvent('message', {
        source: iframeWindow,
        data: { ...message, data: { ...message.data, protocolVersion: 2 } },
      });
      return;
    }
    if (message.kind === 'req' || (message.kind === 'evt' && message.event === EVENTS.HELLO)) {
      context.win.dispatchEvent('message', { source: iframeWindow, data: message });
      return;
    }
    sdkWin.dispatchEvent('message', { source: iframeWindow, data: message });
  };

  const game = createGameSDK({
    window: sdkWin,
    location: sdkWin.location,
    timers: context.clock,
    now: context.clock.now,
    crypto: sdkWin.crypto,
  });
  await assert.rejects(game.ready(), (error) => error.code === 'GM-5002');
});
