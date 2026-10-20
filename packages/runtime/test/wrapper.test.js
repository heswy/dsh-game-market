/**
 * V1.5 wrapper navigation + reload credential state machine
 * (docs/V1.5-CONTRACTS.md §7.2 / §7.5.1 / §7.6).
 *
 * These tests pin the two things that are easy to get wrong with the extra
 * wrapper layer:
 *   1. the iframe points at the platform wrapper on the resource origin, and
 *      only the *first* navigation carries the one-shot launch credential;
 *      every reload/retry uses the instance resource credential;
 *   2. a postMessage is only accepted from the wrapper WindowProxy the Runtime
 *      created — not from the nested game window, not from any other window,
 *      even when the envelope carries a valid instance/nonce pair.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createGameRuntime } from '../src/index.js';
import { buildWrapperFrameUrl, isSafeEntryUrl, withLaunchQuery } from '../src/launch-url.js';
import { GM } from '../../shared/src/errors.js';
import { EVENTS, METHODS, createEvent, createRequest } from '../../shared/src/protocol.js';
import { createClock, createFakeApi, createFakeDocument, createFakeElement, createFakeWindow, flushAsync } from './helpers/fakes.js';

const RESOURCE_ORIGIN = 'http://127.0.0.1:58302';
const FILES_DIGEST = 'e'.repeat(64);

/**
 * Every LaunchInfo in this file uses a fresh instance/nonce pair. The Runtime
 * remembers consumed one-shot launch URLs at module scope (a Client retry may
 * replay the same LaunchInfo), so reusing one URL across independent tests
 * would let one test's consumption leak into the next.
 */
let identitySeq = 0;
function makeIdentity() {
  identitySeq += 1;
  const hex = identitySeq.toString(16).padStart(32, '0');
  return {
    instanceId: hex,
    nonce: hex.split('').reverse().join(''),
    token: identitySeq.toString(16).padStart(32, 'f'),
  };
}

function urlsOf(identity) {
  const resourceBase = `${RESOURCE_ORIGIN}/res/${identity.instanceId}/${identity.token}`;
  return {
    resourceBase,
    entryResourceUrl: `${resourceBase}/index.html`,
    launchUrl:
      `${RESOURCE_ORIGIN}/entry?gameId=snake&version=1.0.0&instance=${identity.instanceId}` +
      `&nonce=${identity.nonce}&launch=${identity.nonce}`,
  };
}

function makeLegacyLaunchInfo(overrides = {}) {
  const identity = overrides.identity || makeIdentity();
  return {
    instanceId: identity.instanceId,
    nonce: identity.nonce,
    entryUrl: `/api/game-market/entry?gameId=snake&version=1.0.0&instance=${identity.instanceId}&nonce=${identity.nonce}`,
    preview: { icon: null, cover: null },
    runtimeVersion: '1.0.0',
    sdkVersion: '1.0.0',
    capabilities: ['storage', 'score'],
    limits: { saveBytes: 1024 * 1024, saveKeys: 32, scoreMetaBytes: 2048 },
    viewport: { width: 960, height: 540, fit: 'contain' },
    hostEpoch: 'epoch-1',
    mode: 'start',
    ...overrides,
  };
}

function makeZipLaunchInfo(overrides = {}) {
  const identity = overrides.identity || makeIdentity();
  const urls = urlsOf(identity);
  return makeLegacyLaunchInfo({
    identity: identity,
    entryUrl: urls.launchUrl,
    resourceOrigin: RESOURCE_ORIGIN,
    resourceBase: urls.resourceBase,
    resourceTtlMs: 600000,
    entryResourceUrl: urls.entryResourceUrl,
    package: { format: 'asset-zip-v2', entry: 'index.html', filesDigest: FILES_DIGEST },
    ...overrides,
  });
}

function makeApi() {
  const api = createFakeApi();
  const released = [];
  api.releaseRuntime = function releaseRuntime(payload) {
    released.push(payload);
    return Promise.resolve({ ok: true });
  };
  api.released = released;
  return api;
}

function makeContext(overrides = {}) {
  const clock = createClock();
  const doc = createFakeDocument();
  const win = createFakeWindow(doc);
  const container = overrides.container || createFakeElement('div');
  const api = overrides.api || makeApi();
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

function frameOf(context) {
  return context.container.children[0];
}

function frameSrc(gameIframe) {
  return gameIframe.getAttribute('src');
}

function srcParam(frameUrl) {
  return new URL(frameUrl).searchParams.get('src');
}

function send(win, iframe, data, source) {
  win.dispatchEvent('message', { source: source === undefined ? iframe.contentWindow : source, data });
}

function helloOf(info, options = {}) {
  return createEvent(EVENTS.HELLO, {
    instanceId: options.instanceId || info.instanceId,
    nonce: options.nonce || info.nonce,
    sdkVersion: '1.0.0',
    protocolVersion: 1,
  });
}

function messagesOf(iframe, predicate) {
  return iframe.sent.map((entry) => entry.message).filter(predicate);
}

function initCount(iframe) {
  return messagesOf(iframe, (message) => message.kind === 'evt' && message.event === EVENTS.INIT).length;
}

/** Simulate the wrapper document finishing load, then the relayed handshake. */
async function handshakeWithLoad(context, iframe, info, requestId) {
  iframe.dispatchEvent('load', {});
  send(context.win, iframe, helloOf(info));
  send(context.win, iframe, createRequest(requestId || 'ready-1', METHODS.READY, { sdkVersion: '1.0.0', protocolVersion: 1 }));
  await flushAsync();
  context.clock.tick(0);
}

test('wrapper URL builder uses shared wrapper path/query and prefers Host URLs', function () {
  const info = makeZipLaunchInfo();
  const urls = urlsOf({ instanceId: info.instanceId, nonce: info.nonce, token: 'f'.repeat(32) });
  const derived = buildWrapperFrameUrl(info, urls.launchUrl, 'launch');
  assert.ok(derived.startsWith(`${RESOURCE_ORIGIN}/wrapper?`));
  assert.equal(srcParam(derived), urls.launchUrl);

  const hostWrapper = `${RESOURCE_ORIGIN}/wrapper?src=${encodeURIComponent('stale')}&theme=dark`;
  const preferred = buildWrapperFrameUrl(makeZipLaunchInfo({ wrapperUrl: hostWrapper }), urls.launchUrl, 'launch');
  assert.equal(new URL(preferred).searchParams.get('theme'), 'dark');
  assert.equal(srcParam(preferred), urls.launchUrl, 'Runtime owns ?src= and overwrites stale input');

  const reloadWrapper = buildWrapperFrameUrl(
    makeZipLaunchInfo({ wrapperResourceUrl: `${RESOURCE_ORIGIN}/wrapper?src=x` }),
    urls.entryResourceUrl,
    'resource'
  );
  assert.equal(srcParam(reloadWrapper), urls.entryResourceUrl);

  // A wrapper URL on another origin is a contract violation, not fixable.
  assert.equal(
    buildWrapperFrameUrl(makeZipLaunchInfo({ wrapperUrl: 'http://127.0.0.1:9999/wrapper?src=x' }), urls.launchUrl, 'launch'),
    null
  );
  // Entry URLs are only the legacy API path or an absolute http(s) URL.
  assert.equal(isSafeEntryUrl(urls.launchUrl), true);
  assert.equal(isSafeEntryUrl('/api/game-market/entry?gameId=snake'), true);
  assert.equal(isSafeEntryUrl('javascript:alert(1)'), false);
});

test('asset-zip-v2 launch points the iframe at the wrapper with the one-shot launch URL', async function () {
  const context = makeContext();
  const info = makeZipLaunchInfo();
  await context.controller.launch(info);
  const iframe = frameOf(context);

  assert.equal(context.container.children.length, 1);
  // Lead P0 decision (2026-10-20): the outer iframe is the trusted platform
  // wrapper on the resource origin and MUST NOT be sandboxed — a sandboxed
  // ancestor is opaque-origin and Chrome's frame-ancestors ancestor-chain check
  // then blocks the nested game document entirely. The sandbox lives on the
  // game iframe created by the wrapper instead.
  assert.equal(iframe.getAttribute('sandbox'), null, 'wrapper iframe must not be sandboxed');
  assert.equal(iframe.getAttribute('allow'), 'autoplay');
  assert.equal(iframe.getAttribute('referrerpolicy'), 'no-referrer');

  const src = frameSrc(iframe);
  assert.notEqual(src, info.entryUrl);
  assert.ok(src.startsWith(`${RESOURCE_ORIGIN}/wrapper?`), 'iframe must point at the platform wrapper');
  assert.equal(srcParam(src), withLaunchQuery(info.entryUrl, info.instanceId, info.nonce));
  // The one-shot launch credential is never placed in the top-level iframe URL.
  assert.equal(src.includes(`launch=${info.nonce}`), false);
});

test('wrapper load alone does not finish loading; the SDK handshake does', async function () {
  const context = makeContext();
  const info = makeZipLaunchInfo();
  await context.controller.launch(info);
  const iframe = frameOf(context);

  iframe.dispatchEvent('load', {});
  assert.equal(context.controller.getState().state, 'loading', 'the wrapper load is not a game load');

  send(context.win, iframe, helloOf(info));
  send(context.win, iframe, createRequest('ready-1', METHODS.READY, { sdkVersion: '1.0.0', protocolVersion: 1 }));
  await flushAsync();
  context.clock.tick(0);
  assert.equal(context.controller.getState().state, 'playing');

  const init = messagesOf(iframe, (message) => message.kind === 'evt' && message.event === EVENTS.INIT)[0];
  assert.ok(init, 'init was sent after the relayed hello');
  assert.equal(init.data.resourceBase, info.resourceBase);
  assert.equal(init.data.packageFormat, 'asset-zip-v2');
  // V1 fields are unchanged in the same init: an old SDK that ignores the two
  // new fields keeps working exactly as before (contract §7.6 backwards compat).
  assert.equal(init.data.protocolVersion, 1);
  assert.equal(init.data.gameId, 'snake');
  assert.equal(init.data.gameVersion, '1.0.0');
  assert.equal(init.data.instanceId, info.instanceId);
  assert.equal(init.data.nonce, info.nonce);
  assert.deepEqual(init.data.capabilities, ['storage', 'score']);
  assert.deepEqual(init.data.limits, { saveBytes: 1024 * 1024, saveKeys: 32, scoreMetaBytes: 2048 });

  // The wrapper's own load is not mistaken for a finished game load: after the
  // handshake the load timers are cancelled and no GM-5011 may fire.
  context.clock.tick(25000);
  assert.equal(context.events.filter((event) => event.type === 'error' && event.error.code === GM.LOAD_TIMEOUT).length, 0);
});

test('reload() navigates the instance resource credential URL, never the launch URL', async function () {
  const context = makeContext();
  const info = makeZipLaunchInfo();
  await context.controller.launch(info);
  let iframe = frameOf(context);
  await handshakeWithLoad(context, iframe, info);
  assert.equal(context.controller.getState().state, 'playing');

  const result = await context.controller.reload();
  assert.deepEqual(result, { ok: true });
  iframe = frameOf(context);
  const src = frameSrc(iframe);
  assert.ok(src.startsWith(`${RESOURCE_ORIGIN}/wrapper?`));
  const embedded = srcParam(src);
  assert.ok(embedded.startsWith(info.entryResourceUrl), 'reload must embed the resource credential URL');
  assert.equal(new URL(embedded).searchParams.get('launch'), null);
  assert.equal(new URL(embedded).searchParams.get('instance'), info.instanceId);
  assert.equal(new URL(embedded).searchParams.get('nonce'), info.nonce);
  assert.equal(context.controller.getState().state, 'loading');

  // The reloaded document handshakes again with the same instance identity.
  await handshakeWithLoad(context, iframe, info, 'ready-2');
  assert.equal(context.controller.getState().state, 'playing');
  assert.equal(initCount(iframe), 2, 'one init per document handshake');
});

test('a controller that reuses a consumed LaunchInfo starts on the resource credential URL', async function () {
  const info = makeZipLaunchInfo();
  const first = makeContext();
  await first.controller.launch(info);
  await handshakeWithLoad(first, frameOf(first), info);
  first.controller.destroy();

  const second = makeContext();
  await second.controller.launch(info);
  const src = frameSrc(frameOf(second));
  assert.equal(srcParam(src), withLaunchQuery(info.entryResourceUrl, info.instanceId, info.nonce));
});

test('a consumed launch navigation recovers with GM-4013 visible + resource credential URL', async function () {
  const context = makeContext();
  const info = makeZipLaunchInfo();
  await context.controller.launch(info);
  let iframe = frameOf(context);
  iframe.dispatchEvent('load', {}); // wrapper only; the nested game never handshakes

  context.clock.tick(10000);
  const recovered = context.events.filter((event) => event.type === 'error');
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].error.code, GM.ENTRY_LAUNCH_CONSUMED);
  assert.equal(recovered[0].error.retryable, true);
  assert.equal(context.controller.getState().state, 'loading', 'the frame must not stay blank/error');

  iframe = frameOf(context);
  const src = frameSrc(iframe);
  assert.equal(srcParam(src), withLaunchQuery(info.entryResourceUrl, info.instanceId, info.nonce));
  const navigation = context.events.filter((event) => event.type === 'navigation');
  assert.equal(navigation.length, 1);
  assert.equal(navigation[0].mode, 'resource-credential');

  // The fallback document can handshake normally.
  await handshakeWithLoad(context, iframe, info, 'ready-2');
  assert.equal(context.controller.getState().state, 'playing');

  // If the fallback itself cannot load, the failure is a real load error.
  const secondInfo = makeZipLaunchInfo();
  const second = makeContext();
  await second.controller.launch(secondInfo);
  second.clock.tick(10000);
  second.clock.tick(10000);
  const fatal = second.events.filter((event) => event.type === 'error');
  assert.equal(fatal[fatal.length - 1].error.code, GM.LOAD_TIMEOUT);
  assert.equal(fatal[fatal.length - 1].error.retryable, true);
});

test('reload() without an instance resource credential fails visibly (legacy Host)', async function () {
  const context = makeContext();
  await context.controller.launch(makeLegacyLaunchInfo());
  const result = await context.controller.reload();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, GM.ENTRY_LAUNCH_CONSUMED);
  assert.ok(context.events.some((event) => event.type === 'error' && event.error.code === GM.ENTRY_LAUNCH_CONSUMED));
});

test('only the wrapper window is trusted; nested/foreign windows are rejected', async function () {
  const context = makeContext();
  const info = makeZipLaunchInfo();
  await context.controller.launch(info);
  const iframe = frameOf(context);
  iframe.dispatchEvent('load', {});

  const hello = helloOf(info);
  // Simulates a message posted by the nested game window directly (no relay):
  // it carries the right instance/nonce but fails WindowProxy identity.
  const nestedGameWindow = { postMessage: function postMessage() {} };
  send(context.win, iframe, hello, nestedGameWindow);
  await flushAsync();
  assert.equal(initCount(iframe), 0, 'direct nested-frame messages must not reach the bridge');

  // A hello with a wrong nonce from the trusted wrapper window is also rejected.
  send(context.win, iframe, helloOf(info, { nonce: 'a'.repeat(32) }));
  await flushAsync();
  assert.equal(initCount(iframe), 0);

  // The relayed hello from the wrapper WindowProxy is accepted.
  send(context.win, iframe, hello);
  await flushAsync();
  assert.equal(initCount(iframe), 1);
});

test('a flood from untrusted windows revokes capabilities and tears down the frame', async function () {
  const context = makeContext();
  await context.controller.launch(makeZipLaunchInfo());
  const iframe = frameOf(context);
  const foreign = { postMessage: function postMessage() {} };
  for (let index = 0; index < 51; index += 1) {
    send(context.win, iframe, { v: 1, kind: 'bad' }, foreign);
  }
  await flushAsync();
  assert.equal(context.controller.getState().state, 'error');
  assert.ok(context.events.some((event) => event.type === 'error' && event.error.code === GM.MESSAGE_INVALID));
  assert.equal(context.container.children.length, 0);
  assert.equal(context.api.released.length, 1, 'the Host instance is released on capability revocation');
});

test('an unexpected iframe navigation revokes the instance instead of trusting the new document', async function () {
  const context = makeContext();
  const info = makeZipLaunchInfo();
  await context.controller.launch(info);
  const iframe = frameOf(context);
  await handshakeWithLoad(context, iframe, info);
  assert.equal(context.controller.getState().state, 'playing');

  iframe.dispatchEvent('load', {}); // not initiated by the Runtime
  assert.equal(context.controller.getState().state, 'error');
  const fatal = context.events.filter((event) => event.type === 'error');
  assert.equal(fatal[fatal.length - 1].error.code, GM.IFRAME_CRASHED);
  assert.equal(context.api.released.length, 1);
});

test('a foreign/missing wrapper URL fails closed instead of embedding the game directly', async function () {
  const context = makeContext();
  const foreign = makeZipLaunchInfo({ wrapperUrl: 'http://127.0.0.1:9999/wrapper?src=x' });
  await assert.rejects(
    function launch() {
      return context.controller.launch(foreign);
    },
    function matches(error) {
      assert.equal(error.code, GM.INVALID_PARAM);
      return true;
    }
  );
  assert.equal(context.container.children.length, 0, 'no unwrapped fallback iframe may be created');

  const malformed = makeZipLaunchInfo({ wrapperResourceUrl: 'https://evil.example/wrapper' });
  await assert.rejects(
    function launch() {
      return context.controller.launch(malformed);
    },
    function matches(error) {
      assert.equal(error.code, GM.INVALID_PARAM);
      return true;
    }
  );
  assert.equal(context.container.children.length, 0);
});

test('a wrapper iframe load error surfaces a real error and never falls back', async function () {
  const context = makeContext();
  const info = makeZipLaunchInfo();
  await context.controller.launch(info);
  const iframe = frameOf(context);
  iframe.dispatchEvent('error', {});
  assert.equal(context.controller.getState().state, 'error');
  const fatal = context.events.filter((event) => event.type === 'error');
  assert.equal(fatal[fatal.length - 1].error.code, GM.IFRAME_CRASHED);
  // Still the wrapper URL; no direct game navigation happened.
  const src = frameSrc(iframe);
  assert.ok(src.startsWith(`${RESOURCE_ORIGIN}/wrapper?`));
});

test('an insertion-time initial load is ignored: no GM-5013, no release, nav still works', async function () {
  // Chrome may dispatch a `load` for the iframe's initial empty document while
  // the element is being inserted. In the M1 A02 browser probe that load was
  // mistaken for an unexpected navigation, released the Host instance and then
  // the real wrapper navigation got 403. The fix: the initial `src` is written
  // before insertion and insertion-time loads are ignored.
  const container = createFakeElement('div');
  const originalAppend = container.appendChild.bind(container);
  let insertionLoads = 0;
  container.appendChild = function appendWithInitialLoad(child) {
    const appended = originalAppend(child);
    insertionLoads += 1;
    child.dispatchEvent('load', {});
    return appended;
  };
  const context = makeContext({ container });
  const info = makeZipLaunchInfo();
  await context.controller.launch(info);

  assert.equal(insertionLoads, 1, 'the simulated insertion-time load fired');
  assert.equal(context.events.filter((event) => event.type === 'error').length, 0, 'no GM-5013 on the initial load');
  assert.equal(context.api.released.length, 0, 'the Host instance must not be released during insertion');
  assert.equal(context.controller.getState().state, 'loading');

  // The real wrapper navigation still completes normally.
  const iframe = frameOf(context);
  await handshakeWithLoad(context, iframe, info);
  assert.equal(context.controller.getState().state, 'playing');
  assert.equal(context.api.released.length, 0);
});

test('an about:blank load before any committed navigation is ignored', async function () {
  const context = makeContext();
  const info = makeZipLaunchInfo();
  await context.controller.launch(info);
  const iframe = frameOf(context);
  const wrapperSrc = frameSrc(iframe);

  iframe.setAttribute('src', 'about:blank');
  iframe.dispatchEvent('load', {});
  assert.equal(context.events.filter((event) => event.type === 'error').length, 0);
  assert.equal(context.api.released.length, 0);
  assert.equal(context.controller.getState().state, 'loading');

  // Restore the wrapper target and finish the normal handshake.
  iframe.setAttribute('src', wrapperSrc);
  await handshakeWithLoad(context, iframe, info);
  assert.equal(context.controller.getState().state, 'playing');
});

test('a real unexpected navigation after ready still revokes and releases', async function () {
  const context = makeContext();
  const info = makeZipLaunchInfo();
  await context.controller.launch(info);
  const iframe = frameOf(context);
  await handshakeWithLoad(context, iframe, info);
  assert.equal(context.controller.getState().state, 'playing');
  assert.equal(context.api.released.length, 0);

  // Something moved the wrapper frame to a foreign origin: this is a genuine
  // non-ours navigation and MUST stay fail-closed.
  iframe.setAttribute('src', 'https://evil.example/');
  iframe.dispatchEvent('load', {});
  assert.equal(context.controller.getState().state, 'error');
  assert.ok(context.events.some((event) => event.type === 'error' && event.error.code === GM.IFRAME_CRASHED));
  assert.equal(context.api.released.length, 1, 'revocation releases the Host instance');
  assert.equal(context.container.children.length, 0, 'teardown removes the frame (no leak)');
});

test('legacy html-v1 LaunchInfo keeps the V1 direct entry navigation and init shape', async function () {
  const context = makeContext();
  const info = makeLegacyLaunchInfo();
  await context.controller.launch(info);
  const iframe = frameOf(context);
  assert.equal(frameSrc(iframe), info.entryUrl);
  assert.equal(iframe.getAttribute('sandbox'), 'allow-scripts', 'html-v1 keeps the V1 single-layer sandbox');

  await handshakeWithLoad(context, iframe, info);
  const init = messagesOf(iframe, (message) => message.kind === 'evt' && message.event === EVENTS.INIT)[0];
  assert.equal(init.data.resourceBase, null);
  assert.equal(init.data.packageFormat, null);
});
