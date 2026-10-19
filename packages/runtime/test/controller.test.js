import test from 'node:test';
import assert from 'node:assert/strict';

import { createGameRuntime } from '../src/index.js';
import { createClock, createFakeApi, createFakeDocument, createFakeElement, createFakeWindow, flushAsync } from './helpers/fakes.js';
import { GM } from '../../shared/src/errors.js';
import {
  EVENTS,
  METHODS,
  createEvent,
  createRequest,
} from '../../shared/src/protocol.js';

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

function messageList(iframe) {
  return iframe.sent.map((entry) => entry.message);
}

function messagesOf(iframe, predicate) {
  return messageList(iframe).filter(predicate);
}

function send(win, iframe, data) {
  win.dispatchEvent('message', { source: iframe.contentWindow, data });
}

function makeContext(overrides = {}) {
  const clock = createClock();
  const doc = createFakeDocument();
  const win = createFakeWindow(doc);
  const container = createFakeElement('div');
  const api = overrides.api || createFakeApi();
  const events = [];
  const controller = createGameRuntime({
    container,
    api,
    environment: overrides.environment || { theme: 'dark', reducedMotion: false, locale: 'zh' },
    onEvent: (event) => events.push(event),
    window: win,
    document: doc,
    timers: clock,
    now: clock.now,
  });
  return { controller, clock, doc, win, container, api, events };
}

async function handshake(context, options = {}) {
  const iframe = context.container.children[0];
  if (options.load !== false) iframe.dispatchEvent('load', {});
  send(
    context.win,
    iframe,
    createEvent(EVENTS.HELLO, { instanceId: INSTANCE, nonce: NONCE, sdkVersion: '0.1.0', protocolVersion: 1 })
  );
  send(
    context.win,
    iframe,
    createRequest('ready-req', METHODS.READY, { sdkVersion: '0.1.0', protocolVersion: options.protocolVersion || 1 })
  );
  await flushAsync();
  if (options.finalize !== false) context.clock.tick(0);
  return iframe;
}

test('launch creates exactly one sandboxed iframe and enters loading', async () => {
  const context = makeContext();
  const info = makeLaunchInfo();
  await context.controller.launch(info);

  assert.equal(context.container.children.length, 1);
  const iframe = context.container.children[0];
  assert.equal(iframe.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(iframe.getAttribute('allow'), 'autoplay');
  assert.equal(iframe.getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(iframe.getAttribute('loading'), 'eager');
  assert.equal(iframe.getAttribute('src'), info.entryUrl);
  assert.equal(iframe.style.width, '100%');
  assert.equal(iframe.style.border, '0');

  assert.deepEqual(context.controller.getState(), { state: 'loading', gameId: 'snake' });
  assert.ok(context.events.some((event) => event.type === 'state' && event.state === 'loading'));
  assert.ok(context.events.some((event) => event.type === 'save-status' && event.status === 'idle' && event.at === null));
});

test('handshake sends init with instance, limits, theme and viewport then acknowledges ready', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = await handshake(context);

  const init = messagesOf(iframe, (message) => message.kind === 'evt' && message.event === EVENTS.INIT)[0];
  assert.ok(init, 'init event was sent');
  assert.equal(init.data.instanceId, INSTANCE);
  assert.equal(init.data.nonce, NONCE);
  assert.equal(init.data.gameId, 'snake');
  assert.equal(init.data.gameVersion, '0.1.0');
  assert.equal(init.data.protocolVersion, 1);
  assert.equal(init.data.theme, 'dark');
  assert.equal(init.data.reducedMotion, false);
  assert.equal(init.data.locale, 'zh');
  assert.deepEqual(init.data.capabilities, ['storage', 'score']);
  assert.deepEqual(init.data.limits, { saveBytes: 1024 * 1024, saveKeys: 32, scoreMetaBytes: 2048 });
  assert.deepEqual(init.data.viewport, { width: 960, height: 540, dpr: 2 });

  const readyResponse = messagesOf(iframe, (message) => message.kind === 'res' && message.id === 'ready-req')[0];
  assert.equal(readyResponse.ok, true);
  assert.equal(readyResponse.result.protocolVersion, 1);
  assert.equal(readyResponse.result.gameId, 'snake');
  assert.equal(readyResponse.result.ready, true);

  assert.equal(context.controller.getState().state, 'playing');
  assert.deepEqual(
    context.events.filter((event) => event.type === 'state').map((event) => event.state),
    ['loading', 'ready', 'playing']
  );
});

test('init and ready report measured viewport, independent of manifest design size', async () => {
  const context = makeContext();
  context.container.rect = { width: 640, height: 480 };
  await context.controller.launch(makeLaunchInfo({ viewport: { width: 720, height: 720, fit: 'contain' } }));
  const iframe = await handshake(context);
  const init = messagesOf(iframe, (message) => message.event === EVENTS.INIT)[0];
  const ready = messagesOf(iframe, (message) => message.kind === 'res' && message.id === 'ready-req')[0];
  assert.deepEqual(init.data.viewport, { width: 640, height: 480, dpr: 2 });
  assert.deepEqual(ready.result.viewport, init.data.viewport);
  context.controller.destroy();
});

test('hello retries re-send init with the same identity', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = context.container.children[0];
  const hello = createEvent(EVENTS.HELLO, { instanceId: INSTANCE, nonce: NONCE, sdkVersion: '0.1.0', protocolVersion: 1 });
  send(context.win, iframe, hello);
  send(context.win, iframe, hello);
  const inits = messagesOf(iframe, (message) => message.kind === 'evt' && message.event === EVENTS.INIT);
  assert.equal(inits.length, 2);
  assert.equal(inits[0].data.nonce, inits[1].data.nonce);
});

test('resume-paused mode pauses before playing and resume() starts it', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo({ mode: 'resume-paused' }));
  const iframe = await handshake(context);

  assert.equal(context.controller.getState().state, 'paused');
  const pause = messagesOf(iframe, (message) => message.kind === 'evt' && message.event === EVENTS.PAUSE);
  assert.equal(pause.length, 1);
  assert.equal(pause[0].data.reason, 'user');
  assert.equal(typeof pause[0].data.at, 'number');

  context.controller.resume();
  assert.equal(context.controller.getState().state, 'playing');
  const resume = messagesOf(iframe, (message) => message.kind === 'evt' && message.event === EVENTS.RESUME);
  assert.equal(resume.length, 1);
  assert.equal(resume[0].data.reason, 'user');
});

test('handshake timeout reports GM-5001 and enters error', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  context.clock.tick(10000);

  assert.equal(context.controller.getState().state, 'error');
  const fatal = context.events.filter((event) => event.type === 'error');
  assert.equal(fatal.length, 1);
  assert.equal(fatal[0].error.code, GM.HANDSHAKE_TIMEOUT);
  assert.equal(fatal[0].error.retryable, false);
  assert.ok(context.events.some((event) => event.type === 'state' && event.state === 'error'));
});

test('slow load warns at 10s (still loading) and fails at 20s with GM-5011', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  await handshake(context, { load: false });
  assert.equal(context.controller.getState().state, 'playing');

  context.clock.tick(10000);
  const slow = context.events.filter((event) => event.type === 'error');
  assert.equal(slow.length, 1);
  assert.equal(slow[0].error.code, GM.LOAD_TIMEOUT);
  assert.equal(slow[0].error.retryable, true);
  assert.equal(context.controller.getState().state, 'playing');

  context.clock.tick(10000);
  assert.equal(context.controller.getState().state, 'error');
  const fatal = context.events.filter((event) => event.type === 'error');
  assert.equal(fatal.length, 2);
  assert.equal(fatal[1].error.code, GM.LOAD_TIMEOUT);
});

test('a fired iframe load event cancels the load timers', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  await handshake(context);
  context.clock.tick(25000);
  assert.equal(context.events.filter((event) => event.type === 'error' && event.error.code === GM.LOAD_TIMEOUT).length, 0);
  assert.equal(context.controller.getState().state, 'playing');
});

test('three missed pings report GM-5012', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = await handshake(context);
  const pingBefore = messagesOf(iframe, (message) => message.method === METHODS.PING).length;
  assert.equal(pingBefore, 1);

  context.clock.tick(2000);
  context.clock.tick(3000);
  context.clock.tick(2000);
  context.clock.tick(3000);
  context.clock.tick(2000);
  await flushAsync();

  assert.equal(context.controller.getState().state, 'error');
  const fatal = context.events.filter((event) => event.type === 'error');
  assert.equal(fatal[0].error.code, GM.IFRAME_UNRESPONSIVE);
});

test('pause() sends pause + before-save and resolves after storage.save', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = await handshake(context);

  const pending = context.controller.pause('user');
  assert.equal(context.controller.getState().state, 'saving');
  const pauseEvents = messagesOf(iframe, (message) => message.event === EVENTS.PAUSE);
  const beforeSave = messagesOf(iframe, (message) => message.event === EVENTS.BEFORE_SAVE);
  assert.equal(pauseEvents.length, 1);
  assert.equal(pauseEvents[0].data.reason, 'user');
  assert.equal(beforeSave.length, 1);
  assert.equal(beforeSave[0].data.reason, 'pause');
  assert.equal(beforeSave[0].data.deadlineMs, 1500);

  send(
    context.win,
    iframe,
    createRequest('save-1', METHODS.STORAGE_SAVE, { key: 'current', data: { score: 20 } })
  );
  await flushAsync();
  const result = await pending;
  assert.deepEqual(result, { ok: true, saveStale: false });
  assert.equal(context.controller.getState().state, 'paused');
  assert.equal(context.api.calls.filter((call) => call[0] === 'setSave').length, 1);
  assert.ok(context.events.some((event) => event.type === 'save-status' && event.status === 'saved'));
});

test('a failed save keeps the old data and reports saveStale', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = await handshake(context);
  context.api.state.failNextSave = { code: 'GM-5021', message: 'disk full', retryable: true };

  const pending = context.controller.pause('leave');
  send(
    context.win,
    iframe,
    createRequest('save-1', METHODS.STORAGE_SAVE, { key: 'current', data: { score: 20 } })
  );
  await flushAsync();
  const result = await pending;
  assert.deepEqual(result, { ok: false, saveStale: true });
  assert.equal(context.controller.getState().state, 'paused');
  assert.ok(context.events.some((event) => event.type === 'save-status' && event.status === 'failed'));
});

test('pause() skips before-save when the game did not declare storage', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo({ capabilities: [] }));
  const iframe = await handshake(context);
  const result = await context.controller.pause('user');
  assert.deepEqual(result, { ok: true, saveStale: false });
  assert.equal(messagesOf(iframe, (message) => message.event === EVENTS.BEFORE_SAVE).length, 0);
  assert.equal(context.controller.getState().state, 'paused');
});

test('destroy removes listeners and iframe, then emits exited + exit', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  await handshake(context);
  assert.equal(context.win.listenerCount('message'), 1);
  assert.equal(context.doc.listenerCount('visibilitychange'), 1);

  context.controller.destroy();
  assert.equal(context.container.children.length, 0);
  assert.equal(context.win.listenerCount('message'), 0);
  assert.equal(context.doc.listenerCount('visibilitychange'), 0);
  assert.equal(context.controller.getState().state, 'exited');
  assert.ok(context.events.some((event) => event.type === 'state' && event.state === 'exited'));
  assert.deepEqual(
    context.events.filter((event) => event.type === 'exit').map((event) => event.reason),
    ['destroy']
  );

  context.controller.destroy();
  assert.equal(context.events.filter((event) => event.type === 'exit').length, 1);
});

test('relaunch keeps a single iframe and a single message listener', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const first = context.container.children[0];
  await context.controller.launch(makeLaunchInfo({ mode: 'resume-paused' }));
  assert.equal(context.container.children.length, 1);
  assert.notEqual(context.container.children[0], first);
  assert.equal(context.win.listenerCount('message'), 1);
});

test('agent snapshots are forwarded to the game and exposed as events', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = await handshake(context);
  const snapshot = {
    state: 'waiting-user',
    label: '需要你回答一个问题',
    labelKey: null,
    sessionId: 's1',
    updatedAt: '2026-10-18T00:00:00.000Z',
    source: 'question',
    seq: 7,
    since: '2026-10-18T00:00:00.000Z',
    turnId: 't1',
  };
  context.controller.handleAgentState(snapshot);

  const forwarded = messagesOf(iframe, (message) => message.kind === 'evt' && message.event === EVENTS.AGENT_STATUS);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].data.seq, 7);
  assert.ok(context.events.some((event) => event.type === 'agent-state' && event.snapshot.seq === 7));
});

test('agent completed triggers one non-blocking save while playing', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = await handshake(context);
  context.controller.handleAgentState({ state: 'completed', seq: 1 });
  const beforeSaves = messagesOf(iframe, (message) => message.event === EVENTS.BEFORE_SAVE);
  assert.equal(beforeSaves.length, 1);
  assert.equal(beforeSaves[0].data.reason, 'agent-complete');
  context.controller.handleAgentState({ state: 'completed', seq: 2 });
  assert.equal(messagesOf(iframe, (message) => message.event === EVENTS.BEFORE_SAVE).length, 1);
});

test('updateEnvironment forwards theme changes', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = await handshake(context);
  context.controller.updateEnvironment({ theme: 'light', reducedMotion: true });
  const theme = messagesOf(iframe, (message) => message.event === EVENTS.THEME);
  assert.equal(theme.length, 1);
  assert.deepEqual(theme[0].data, { theme: 'light', reducedMotion: true });

  context.controller.handleAgentState(null);
  assert.equal(messagesOf(iframe, (message) => message.event === EVENTS.AGENT_STATUS).length, 0);
});

test('viewport updates are throttled to one event per 200ms', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = await handshake(context);
  assert.equal(messagesOf(iframe, (message) => message.event === EVENTS.VIEWPORT).length, 0);

  context.container.rect = { width: 1200, height: 700 };
  context.win.dispatchEvent('resize', {});
  context.win.dispatchEvent('resize', {});
  context.clock.tick(199);
  assert.equal(messagesOf(iframe, (message) => message.event === EVENTS.VIEWPORT).length, 0);
  context.clock.tick(1);
  const updates = messagesOf(iframe, (message) => message.event === EVENTS.VIEWPORT);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].data, { width: 1200, height: 700, dpr: 2 });
});

test('visibility change pauses and saves, then resumes when visible again', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = await handshake(context);
  context.doc.setHidden(true);
  assert.equal(messagesOf(iframe, (message) => message.event === EVENTS.HIDDEN).length, 1);
  assert.equal(context.controller.getState().state, 'saving');

  send(
    context.win,
    iframe,
    createRequest('save-hidden', METHODS.STORAGE_SAVE, { key: 'current', data: { score: 5 } })
  );
  await flushAsync();
  assert.equal(context.controller.getState().state, 'paused');

  context.doc.setHidden(false);
  await flushAsync();
  assert.equal(context.controller.getState().state, 'playing');
  assert.equal(messagesOf(iframe, (message) => message.event === EVENTS.VISIBLE).length, 1);
  const resumed = messagesOf(iframe, (message) => message.event === EVENTS.RESUME);
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].data.reason, 'visible');
});

test('protocol mismatch in ready is rejected with GM-5002', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = await handshake(context, { protocolVersion: 2, finalize: false });
  const response = messagesOf(iframe, (message) => message.kind === 'res' && message.id === 'ready-req')[0];
  assert.equal(response.ok, false);
  assert.equal(response.error.code, GM.PROTOCOL_MISMATCH);
  assert.equal(context.controller.getState().state, 'error');
});

test('game requests are served: session.start, storage.load, agent.getStatus and unknown method', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = await handshake(context);

  send(context.win, iframe, createRequest('q1', METHODS.SESSION_START, {}));
  send(context.win, iframe, createRequest('q2', METHODS.STORAGE_LOAD, { key: 'current' }));
  send(context.win, iframe, createRequest('q3', METHODS.AGENT_GET_STATUS, {}));
  send(context.win, iframe, createRequest('q4', 'storage.evil', {}));
  await flushAsync();

  const byId = Object.fromEntries(
    messagesOf(iframe, (message) => message.kind === 'res').map((message) => [message.id, message])
  );
  assert.equal(byId.q1.ok, true);
  assert.equal(byId.q1.result.playSessionId, 'ps_1234567890abcdef');
  assert.equal(byId.q2.ok, true);
  assert.equal(byId.q2.result, null);
  assert.equal(byId.q3.ok, true);
  assert.equal(byId.q3.result.state, 'idle');
  assert.equal(byId.q4.ok, false);
  assert.equal(byId.q4.error.code, GM.UNKNOWN_METHOD);
});

test('iframe error event reports GM-5013', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = context.container.children[0];
  iframe.dispatchEvent('error', {});
  assert.equal(context.controller.getState().state, 'error');
  const fatal = context.events.filter((event) => event.type === 'error');
  assert.equal(fatal[0].error.code, GM.IFRAME_CRASHED);
});

test('a bridge message flood terminates the iframe with GM-5004', async () => {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = context.container.children[0];
  for (let index = 0; index < 51; index += 1) {
    context.win.dispatchEvent('message', { source: iframe.contentWindow, data: { v: 1, kind: 'bad' } });
  }
  await flushAsync();
  assert.equal(context.controller.getState().state, 'error');
  assert.ok(context.events.some((event) => event.type === 'error' && event.error.code === GM.MESSAGE_INVALID));
  assert.equal(context.container.children.length, 0);
});

test('invalid LaunchInfo rejects without creating an iframe', async () => {
  const context = makeContext();
  await assert.rejects(
    context.controller.launch({ entryUrl: 'x' }),
    (error) => error.code === GM.INVALID_PARAM
  );
  assert.equal(context.container.children.length, 0);
  assert.equal(context.controller.getState().state, 'idle');
});

test('getState reports idle + null before launch', () => {
  const context = makeContext();
  assert.deepEqual(context.controller.getState(), { state: 'idle', gameId: null });
});
