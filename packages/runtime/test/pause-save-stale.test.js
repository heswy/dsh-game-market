/**
 * V1.5 AUD-02 regression: paused != saved.
 *
 * pause() must never claim `{ok:true, saveStale:false}` for an already-paused
 * instance whose last save failed. A coordination pause retry performs a REAL
 * forced save and reports its true outcome, without sending duplicate PAUSE
 * events and while keeping pausePromise coalescing intact.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createGameRuntime } from '../src/index.js';
import { createClock, createFakeApi, createFakeDocument, createFakeElement, createFakeWindow, flushAsync } from './helpers/fakes.js';
import { EVENTS, METHODS, createEvent, createRequest } from '../../shared/src/protocol.js';

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

function messagesOf(iframe, predicate) {
  return iframe.sent.map((entry) => entry.message).filter(predicate);
}

function pauseEvents(iframe) {
  return messagesOf(iframe, (message) => message.event === EVENTS.PAUSE);
}

function beforeSaveEvents(iframe) {
  return messagesOf(iframe, (message) => message.event === EVENTS.BEFORE_SAVE);
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

async function handshake(context) {
  const iframe = context.container.children[0];
  iframe.dispatchEvent('load', {});
  send(
    context.win,
    iframe,
    createEvent(EVENTS.HELLO, { instanceId: INSTANCE, nonce: NONCE, sdkVersion: '0.1.0', protocolVersion: 1 })
  );
  send(context.win, iframe, createRequest('ready-req', METHODS.READY, { sdkVersion: '0.1.0', protocolVersion: 1 }));
  await flushAsync();
  context.clock.tick(0);
  return iframe;
}

function setSaveCalls(api) {
  return api.calls.filter((call) => call[0] === 'setSave').length;
}

/** Answer the next before-save request with a storage.save from the game. */
async function answerNextSave(context, iframe, id) {
  send(context.win, iframe, createRequest(id, METHODS.STORAGE_SAVE, { key: 'current', data: { score: 20 } }));
  await flushAsync();
}

test('a failed pause save is not reported as saved by a second pause on the same instance', async function () {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = await handshake(context);
  context.api.state.failNextSave = { code: 'GM-5021', message: 'disk full', retryable: true };

  // First coordination pause: real save fails.
  const first = context.controller.pause('leave');
  assert.equal(beforeSaveEvents(iframe).length, 1);
  await answerNextSave(context, iframe, 'save-1');
  const firstResult = await first;
  assert.deepEqual(firstResult, { ok: false, saveStale: true });
  assert.equal(context.controller.getState().state, 'paused');
  assert.equal(setSaveCalls(context.api), 1);
  assert.equal(pauseEvents(iframe).length, 1);

  // Retry pause without resuming the game: it must attempt a REAL save again.
  context.api.state.failNextSave = { code: 'GM-5021', message: 'disk still full', retryable: true };
  const second = context.controller.pause('user');
  assert.equal(beforeSaveEvents(iframe).length, 2, 'second pause triggered a new before-save');
  assert.equal(pauseEvents(iframe).length, 1, 'no duplicate PAUSE event for an already-paused game');
  await answerNextSave(context, iframe, 'save-2');
  const secondResult = await second;
  assert.deepEqual(secondResult, { ok: false, saveStale: true }, 'a stale retry is never reported saved');
  assert.equal(setSaveCalls(context.api), 2, 'storage.save was called a second time');
  assert.equal(context.controller.getState().state, 'paused');

  // Third pause while still stale also retries instead of claiming saved.
  context.api.state.failNextSave = { code: 'GM-5021', message: 'nope', retryable: true };
  const third = context.controller.pause('user');
  assert.equal(beforeSaveEvents(iframe).length, 3);
  await answerNextSave(context, iframe, 'save-3');
  assert.deepEqual(await third, { ok: false, saveStale: true });
  assert.equal(setSaveCalls(context.api), 3);
  context.controller.destroy();
});

test('after storage recovers, the retry performs exactly one real save and clears staleness', async function () {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = await handshake(context);
  context.api.state.failNextSave = { code: 'GM-5021', message: 'disk full', retryable: true };

  const first = context.controller.pause('leave');
  await answerNextSave(context, iframe, 'save-1');
  assert.deepEqual(await first, { ok: false, saveStale: true });

  const retry = context.controller.pause('leave');
  assert.equal(beforeSaveEvents(iframe).length, 2);
  await answerNextSave(context, iframe, 'save-2');
  assert.deepEqual(await retry, { ok: true, saveStale: false });
  assert.equal(setSaveCalls(context.api), 2, 'exactly one new save on the retry');

  // Once saved, a further pause is honest without another write.
  const alreadySaved = await context.controller.pause('leave');
  assert.deepEqual(alreadySaved, { ok: true, saveStale: false });
  assert.equal(setSaveCalls(context.api), 2, 'no redundant storage write when already saved');
  assert.equal(pauseEvents(iframe).length, 1);
  context.controller.destroy();
});

test('the first successful pause path is unchanged', async function () {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = await handshake(context);

  const pending = context.controller.pause('user');
  assert.equal(pauseEvents(iframe).length, 1);
  assert.equal(beforeSaveEvents(iframe).length, 1);
  await answerNextSave(context, iframe, 'save-1');
  assert.deepEqual(await pending, { ok: true, saveStale: false });
  assert.equal(context.controller.getState().state, 'paused');
  assert.equal(setSaveCalls(context.api), 1);
  assert.ok(context.events.some((event) => event.type === 'save-status' && event.status === 'saved'));
  context.controller.destroy();
});

test('a save timeout leaves the instance stale and the next pause retries for real', async function () {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = await handshake(context);

  const first = context.controller.pause('leave');
  context.clock.tick(1500); // scheduler saveTimeoutMs: the game never answers
  assert.deepEqual(await first, { ok: false, saveStale: true });
  assert.equal(context.controller.getState().state, 'paused');

  const retry = context.controller.pause('user');
  assert.equal(beforeSaveEvents(iframe).length, 2);
  await answerNextSave(context, iframe, 'save-retry');
  assert.deepEqual(await retry, { ok: true, saveStale: false });
  assert.equal(setSaveCalls(context.api), 1);
  context.controller.destroy();
});

test('games without the storage capability keep the nothing-to-save semantics', async function () {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo({ capabilities: [] }));
  const iframe = await handshake(context);
  assert.deepEqual(await context.controller.pause('user'), { ok: true, saveStale: false });
  assert.deepEqual(await context.controller.pause('user'), { ok: true, saveStale: false });
  assert.equal(beforeSaveEvents(iframe).length, 0);
  assert.equal(pauseEvents(iframe).length, 1);
  context.controller.destroy();
});

test('pause after the Runtime was destroyed reports an honest stale result', async function () {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  await handshake(context);
  context.controller.destroy();
  assert.deepEqual(await context.controller.pause('leave'), { ok: false, saveStale: true });
});

test('coalesced pause calls share one save and one result', async function () {
  const context = makeContext();
  await context.controller.launch(makeLaunchInfo());
  const iframe = await handshake(context);

  const first = context.controller.pause('leave');
  const second = context.controller.pause('leave');
  assert.equal(first, second, 'pausePromise coalescing is preserved');
  await answerNextSave(context, iframe, 'save-1');
  assert.deepEqual(await first, { ok: true, saveStale: false });
  assert.equal(beforeSaveEvents(iframe).length, 1);
  assert.equal(setSaveCalls(context.api), 1);
  context.controller.destroy();
});
