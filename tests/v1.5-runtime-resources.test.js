/**
 * V1.5 cross-module runtime/resource contract test.
 *
 * Covers the seams that no single package can prove alone:
 *   - Client `validateLaunchInfo` → Runtime controller → wrapper iframe URL;
 *   - wrapper relay semantics (up: game → parent → Runtime; down: Runtime →
 *     wrapper window → game) with the real SDK on the other side;
 *   - `init.resourceBase` → `game.runtime.assetUrl()`;
 *   - reload/retry uses `entryResourceUrl`, never the one-shot launch URL;
 *   - V1 `html-v1` / legacy LaunchInfo keeps the direct entry navigation;
 *   - the bundler's reviewed external allowlist (contract §12.4).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGameRuntime } from '../packages/runtime/src/index.js';
import { EXTERNAL_MODULES } from '../scripts/bundle-lib.mjs';
import { createGameSDK } from '../packages/sdk/src/sdk.js';
import { validateLaunchInfo } from '../packages/client/src/runtime-utils.js';
import { GM } from '../packages/shared/src/errors.js';
import { assetUrl as sharedAssetUrl } from '../packages/shared/src/resources.js';
import { buildResourceHref } from '../packages/sdk/src/asset-url.js';
import { EVENTS, METHODS, createEvent, createRequest } from '../packages/shared/src/protocol.js';
import {
  createClock,
  createFakeApi,
  createFakeDocument,
  createFakeElement,
  createFakeWindow,
  flushAsync,
} from '../packages/runtime/test/helpers/fakes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const RESOURCE_ORIGIN = 'http://127.0.0.1:58302';
const INSTANCE = 'a'.repeat(32);
const NONCE = 'b'.repeat(32);
const TOKEN = 'c'.repeat(32);
const RESOURCE_BASE = `${RESOURCE_ORIGIN}/res/${INSTANCE}/${TOKEN}`;
const ENTRY_RESOURCE_URL = `${RESOURCE_BASE}/index.html`;
const LAUNCH_URL =
  `${RESOURCE_ORIGIN}/entry?gameId=orbit&version=1.0.0&instance=${INSTANCE}&nonce=${NONCE}&launch=${NONCE}`;
const FILES_DIGEST = 'd'.repeat(64);

function legacyLaunchInfo(overrides = {}) {
  return {
    instanceId: INSTANCE,
    nonce: NONCE,
    entryUrl: `/api/game-market/entry?gameId=snake&version=1.0.0&instance=${INSTANCE}&nonce=${NONCE}`,
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

function zipLaunchInfo(overrides = {}) {
  return legacyLaunchInfo({
    entryUrl: LAUNCH_URL,
    resourceOrigin: RESOURCE_ORIGIN,
    resourceBase: RESOURCE_BASE,
    resourceTtlMs: 600000,
    entryResourceUrl: ENTRY_RESOURCE_URL,
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

function makeRuntimeContext() {
  const clock = createClock();
  const doc = createFakeDocument();
  const win = createFakeWindow(doc);
  const container = createFakeElement('div');
  const api = makeApi();
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

function frameOf(context) {
  return context.container.children[0];
}

function srcParam(frameUrl) {
  return new URL(frameUrl).searchParams.get('src');
}

/**
 * Build a game-side window that talks through `window.parent` (the wrapper),
 * and a wrapper `postMessage` shim that records game → Runtime traffic. The
 * test `relay` then shuttles messages in both directions exactly like the
 * production wrapper does (point-to-point, no payload rewriting).
 */
function createGameSide(instanceId, nonce) {
  const listeners = new Map();
  const up = [];
  const wrapperWindow = {
    postMessage(message) {
      up.push(message);
    },
  };
  let uuid = 0;
  const win = {
    parent: wrapperWindow,
    location: { search: `?instance=${instanceId}&nonce=${nonce}` },
    crypto: { randomUUID: () => `uuid-${(uuid += 1)}` },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const list = listeners.get(type);
      if (!list) return;
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
  };
  function deliver(data) {
    for (const handler of (listeners.get('message') || []).slice()) {
      handler({ source: wrapperWindow, data });
    }
  }
  return { win, wrapperWindow, up, deliver };
}

/**
 * Pump relay traffic until `settled()` or a bounded number of rounds. Up: game
 * messages are posted to the Runtime window with `source === wrapper window`
 * (the identity check the Runtime relies on). Down: Runtime messages are handed
 * to the game side with `source === wrapper window` (the game SDK checks the
 * same identity for its `parent`).
 */
async function relayUntil(runtime, gameSide, settled) {
  const iframe = frameOf(runtime);
  let sentIndex = 0;
  for (let round = 0; round < 200 && !settled(); round += 1) {
    while (gameSide.up.length > 0) {
      const message = gameSide.up.shift();
      runtime.win.dispatchEvent('message', { source: iframe.contentWindow, data: message });
    }
    await flushAsync();
    const sent = iframe.sent;
    for (; sentIndex < sent.length; sentIndex += 1) {
      gameSide.deliver(sent[sentIndex].message);
    }
    await flushAsync();
  }
  runtime.clock.tick(0);
  await flushAsync();
}

function wrapSrcOf(runtime, predicate) {
  const frameSrc = frameOf(runtime).getAttribute('src');
  assert.ok(frameSrc.startsWith(`${RESOURCE_ORIGIN}/wrapper?`), `expected wrapper iframe src, got ${frameSrc}`);
  if (predicate) assert.ok(predicate(frameSrc), `unexpected wrapper src: ${frameSrc}`);
  return frameSrc;
}

test('V1.5 asset-zip-v2: client validation -> wrapper iframe -> relayed SDK handshake -> assetUrl', async function () {
  const info = zipLaunchInfo();
  const checked = validateLaunchInfo(info);
  assert.equal(checked.ok, true, 'client accepts the V1.5 LaunchInfo');

  const runtime = makeRuntimeContext();
  await runtime.controller.launch(info);

  const firstSrc = wrapSrcOf(runtime, (src) => srcParam(src) === LAUNCH_URL);
  assert.equal(firstSrc.includes(`launch=${NONCE}`), false, 'launch credential stays inside the wrapper src');
  assert.equal(
    frameOf(runtime).getAttribute('sandbox'),
    null,
    'wrapper iframe is trusted platform UI and must not be sandboxed (frame-ancestors ancestor chain)'
  );

  // Real SDK on the game side, talking only through the relay.
  const gameSide = createGameSide(INSTANCE, NONCE);
  const sdk = createGameSDK({
    window: gameSide.win,
    location: gameSide.win.location,
    timers: runtime.clock,
    now: runtime.clock.now,
    crypto: gameSide.win.crypto,
  });
  let ready = false;
  let readyError = null;
  const readyPromise = sdk.ready().then(
    () => {
      ready = true;
    },
    (error) => {
      readyError = error;
    }
  );
  await relayUntil(runtime, gameSide, () => ready || readyError !== null);
  await readyPromise;
  assert.equal(readyError, null, `SDK handshake failed: ${readyError && readyError.message}`);

  assert.equal(runtime.controller.getState().state, 'playing');
  assert.equal(sdk.runtime.resourceBase, RESOURCE_BASE);
  assert.equal(sdk.runtime.packageFormat, 'asset-zip-v2');
  assert.equal(sdk.runtime.gameId, 'orbit');
  assert.equal(
    sdk.runtime.assetUrl('levels/level-01.json'),
    `${RESOURCE_BASE}/levels/level-01.json`
  );
  assert.throws(() => sdk.runtime.assetUrl('../escape.json'), (error) => error.code === GM.RESOURCE_SCOPE_DENIED);
});

test('V1.5 reload re-navigates the wrapper with the resource credential and re-handshakes', async function () {
  const info = zipLaunchInfo({ entryUrl: `${LAUNCH_URL}&reloadCase=1` });
  const runtime = makeRuntimeContext();
  await runtime.controller.launch(info);

  // Minimal raw relayed handshake (the SDK path is covered above).
  const iframe = frameOf(runtime);
  const dispatchUp = (data) => runtime.win.dispatchEvent('message', { source: iframe.contentWindow, data });
  iframe.dispatchEvent('load', {});
  dispatchUp(createEvent(EVENTS.HELLO, { instanceId: INSTANCE, nonce: NONCE, sdkVersion: '1.0.0', protocolVersion: 1 }));
  dispatchUp(createRequest('ready-1', METHODS.READY, { sdkVersion: '1.0.0', protocolVersion: 1 }));
  await flushAsync();
  runtime.clock.tick(0);
  assert.equal(runtime.controller.getState().state, 'playing');

  const result = await runtime.controller.reload();
  assert.deepEqual(result, { ok: true });
  const reloadSrc = wrapSrcOf(runtime, (src) => {
    const embedded = srcParam(src);
    return embedded !== null && embedded.startsWith(info.entryResourceUrl);
  });
  const embedded = new URL(srcParam(reloadSrc));
  assert.equal(embedded.searchParams.get('launch'), null, 'the launch URL must never be replayed');
  assert.equal(embedded.searchParams.get('instance'), INSTANCE);
  assert.equal(embedded.searchParams.get('nonce'), NONCE);

  // Second document handshake over the relay.
  const frame = frameOf(runtime);
  frame.dispatchEvent('load', {});
  dispatchUp(createEvent(EVENTS.HELLO, { instanceId: INSTANCE, nonce: NONCE, sdkVersion: '1.0.0', protocolVersion: 1 }));
  dispatchUp(createRequest('ready-2', METHODS.READY, { sdkVersion: '1.0.0', protocolVersion: 1 }));
  await flushAsync();
  runtime.clock.tick(0);
  assert.equal(runtime.controller.getState().state, 'playing');
});

test('html-v1 / legacy LaunchInfo keeps the V1 direct iframe and the V1 SDK surface', async function () {
  const info = legacyLaunchInfo();
  assert.equal(validateLaunchInfo(info).ok, true);
  const runtime = makeRuntimeContext();
  await runtime.controller.launch(info);
  const iframe = frameOf(runtime);
  assert.equal(iframe.getAttribute('src'), info.entryUrl, 'html-v1 must not be wrapped (M1 scope)');
  assert.equal(iframe.getAttribute('sandbox'), 'allow-scripts', 'html-v1 keeps the single-layer sandbox');

  iframe.dispatchEvent('load', {});
  runtime.win.dispatchEvent('message', {
    source: iframe.contentWindow,
    data: createEvent(EVENTS.HELLO, { instanceId: INSTANCE, nonce: NONCE, sdkVersion: '0.1.0', protocolVersion: 1 }),
  });
  runtime.win.dispatchEvent('message', {
    source: iframe.contentWindow,
    data: createRequest('ready-1', METHODS.READY, { sdkVersion: '0.1.0', protocolVersion: 1 }),
  });
  await flushAsync();
  runtime.clock.tick(0);
  assert.equal(runtime.controller.getState().state, 'playing');

  const init = iframe.sent
    .map((entry) => entry.message)
    .filter((message) => message.kind === 'evt' && message.event === EVENTS.INIT)[0];
  assert.equal(init.data.resourceBase, null);
  assert.equal(init.data.packageFormat, null);
});

test('SDK asset URL rules stay aligned with the shared resources implementation', function () {
  const cases = [
    'levels/level-01.json',
    './assets/ship.webp',
    'a/../b.png',
    'assets/game.css',
    '../escape.png',
    '/etc/passwd',
    'C:/windows/x',
    'nested/game.json',
    'dsh-package.json',
    'assets//double.png',
    'assets/',
    '',
  ];
  for (const candidate of cases) {
    const shared = sharedAssetUrl(RESOURCE_BASE, candidate);
    const local = buildResourceHref(RESOURCE_BASE, candidate);
    assert.equal(local.ok, shared.ok, `ok mismatch for ${JSON.stringify(candidate)}`);
    if (shared.ok && local.ok) {
      assert.equal(local.value, shared.value, `URL mismatch for ${JSON.stringify(candidate)}`);
    }
  }
  // The inlined SDK additionally rejects query/fragment fragments: a resource
  // path is a path, and keeping them out avoids surprising URL semantics.
  assert.equal(buildResourceHref(RESOURCE_BASE, 'levels/a.json?cache=1').ok, false);
});

test('the bundler external allowlist stays the reviewed minimal set and client.js honours it', function () {
  assert.deepEqual([...EXTERNAL_MODULES], ['react', 'react-dom/client', '@deepseek-ai/dsh-client-ui-primitives']);
  const clientCode = fs.readFileSync(path.join(root, 'client.js'), 'utf8');
  const requires = [];
  const re = /require\((['"])([^'"]+)\1\)/g;
  let match = re.exec(clientCode);
  while (match !== null) {
    requires.push(match[2]);
    match = re.exec(clientCode);
  }
  assert.ok(requires.length > 0);
  for (const specifier of requires) {
    assert.ok(EXTERNAL_MODULES.includes(specifier), `client.js requires un-allowlisted "${specifier}"`);
  }
});

 test('M4 html-v1 additive wrapper uses resource entry and relay while old Host stays direct', async () => {
  const ctx = makeRuntimeContext();
  const info = zipLaunchInfo({package: {format:'html-v1',entry:'entry.html',filesDigest:null}, entryUrl:legacyLaunchInfo().entryUrl,
    wrapperUrl: RESOURCE_ORIGIN + '/wrapper?src=' + encodeURIComponent(ENTRY_RESOURCE_URL + '?launch=' + NONCE),
    wrapperResourceUrl: RESOURCE_ORIGIN + '/wrapper?src=' + encodeURIComponent(ENTRY_RESOURCE_URL)});
  await ctx.controller.launch(info);
  const frame = ctx.container.children[0];
  assert.equal(new URL(frame.getAttribute('src')).pathname, '/wrapper');
  assert.equal(new URL(new URL(frame.getAttribute('src')).searchParams.get('src')).origin, RESOURCE_ORIGIN);
  assert.equal(frame.getAttribute('sandbox'), null);
  ctx.controller.destroy();
 });
