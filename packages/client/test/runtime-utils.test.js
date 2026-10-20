import test from 'node:test';
import assert from 'node:assert/strict';
import { TIMING } from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import {
  canReloadRuntime,
  deriveLoadPhase,
  isRuntimeLoadingState,
  isSafeEntryUrl,
  isTerminalResourceError,
  shouldReloadRuntime,
  shouldReleaseRuntimeInstance,
  validateLaunchInfo,
} from '../src/runtime-utils.js';
import {
  isRuntimeController,
  pauseRuntime,
  pauseRuntimeBounded,
  reloadRuntime,
  safeCreateRuntime,
} from '../src/runtime-adapter.js';
import {
  runtimeErrorBodyKey,
  runtimeErrorRetryable,
  runtimeErrorTitleKey,
} from '../src/ui-errors.js';
import {
  PRESENCE,
  derivePresenceState,
  presenceActionKey,
  presenceBubbleDefaultOpen,
  presenceLabelKey,
} from '../src/presence.js';

const NOW = 1_800_000_000_000;
const INSTANCE = 'a'.repeat(32);
const NONCE = 'b'.repeat(32);

function launchInfo(overrides) {
  return {
    instanceId: INSTANCE,
    nonce: NONCE,
    entryUrl: '/api/game-market/entry?gameId=snake&instance=' + INSTANCE + '&nonce=' + NONCE,
    preview: { icon: null, cover: null },
    runtimeVersion: '0.1.0',
    sdkVersion: '0.1.0',
    capabilities: ['storage', 'score'],
    limits: { saveBytes: 1048576, saveKeys: 32, scoreMetaBytes: 2048 },
    viewport: { width: 960, height: 540, fit: 'contain' },
    hostEpoch: 'epoch-1',
    mode: 'start',
    ...(overrides || {}),
  };
}

test('runtime release requires our own instance id (CR-05)', () => {
  assert.equal(shouldReleaseRuntimeInstance('snake', 'a'.repeat(32)), true);
  for (const value of [null, undefined, '', 0, false, {}]) {
    assert.equal(shouldReleaseRuntimeInstance('snake', value), false);
  }
  assert.equal(shouldReleaseRuntimeInstance('', 'a'.repeat(32)), false);
});

test('entry URL guard only accepts the same-origin relative entry route', function () {
  assert.equal(isSafeEntryUrl('/api/game-market/entry?gameId=snake'), true);
  assert.equal(isSafeEntryUrl('api/game-market/entry?gameId=snake'), true);
  assert.equal(isSafeEntryUrl('https://evil.example/api/game-market/entry'), false);
  assert.equal(isSafeEntryUrl('//evil.example/api/game-market/entry'), false);
  assert.equal(isSafeEntryUrl('data:text/html,<h1>x</h1>'), false);
  assert.equal(isSafeEntryUrl('/api/game-market/../entry'), false);
  assert.equal(isSafeEntryUrl('/api/game-market/%2e%2e/entry'), false);
  assert.equal(isSafeEntryUrl('/api/game-market/other'), false);
  assert.equal(isSafeEntryUrl('/api\\game-market\\entry'), false);
  assert.equal(isSafeEntryUrl('/api/game-market/entry\u0000'), false);
  assert.equal(isSafeEntryUrl(null), false);
});

test('launch info validation rejects scheme, instance, nonce, mode and viewport errors', function () {
  assert.equal(validateLaunchInfo(launchInfo()).ok, true);
  assert.equal(validateLaunchInfo(launchInfo({ entryUrl: 'file:///etc/passwd' })).ok, false);
  assert.equal(validateLaunchInfo(launchInfo({ instanceId: 'short' })).ok, false);
  assert.equal(validateLaunchInfo(launchInfo({ nonce: 'B'.repeat(32) })).ok, false);
  assert.equal(validateLaunchInfo(launchInfo({ mode: 'reboot' })).ok, false);
  assert.equal(validateLaunchInfo(launchInfo({ viewport: { width: 0, height: 540 } })).ok, false);
  assert.equal(validateLaunchInfo(null).ok, false);
});

test('load deadlines match the shared slow/error thresholds', function () {
  assert.equal(deriveLoadPhase(0), 'loading');
  assert.equal(deriveLoadPhase(TIMING.loadSlowMs - 1), 'loading');
  assert.equal(deriveLoadPhase(TIMING.loadSlowMs), 'slow');
  assert.equal(deriveLoadPhase(TIMING.loadErrorMs), 'timeout');
  assert.equal(deriveLoadPhase(Number.NaN), 'loading');
  assert.equal(isRuntimeLoadingState('loading'), true);
  assert.equal(isRuntimeLoadingState('playing'), false);
});

test('runtime error codes map to explicit, existing copy keys', function () {
  assert.equal(runtimeErrorTitleKey(GM.NO_RUNTIME), 'runtime.error.noRuntime');
  assert.equal(runtimeErrorTitleKey(GM.LOAD_TIMEOUT), 'runtime.error.loadTimeout');
  assert.equal(runtimeErrorTitleKey(GM.IFRAME_CRASHED), 'runtime.error.crashed');
  assert.equal(runtimeErrorTitleKey(GM.SAVE_CORRUPT), 'runtime.error.saveCorrupt');
  assert.equal(runtimeErrorBodyKey(GM.NO_RUNTIME), 'runtime.error.noRuntime.body');
  assert.equal(runtimeErrorBodyKey(GM.RUNTIME_INCOMPATIBLE), null);
  assert.equal(runtimeErrorRetryable({ code: GM.LOAD_TIMEOUT, retryable: true }), true);
  assert.equal(runtimeErrorRetryable({ code: GM.NO_RUNTIME }), true);
  assert.equal(runtimeErrorRetryable({ code: GM.ASSET_INTEGRITY }), false);
});

test('presence prioritizes waiting over runtime errors and degrades to idle when stale', function () {
  const agent = {
    state: 'waiting-user',
    sessionId: 'session-A',
    labelKey: 'agent.state.waiting.approval',
  };
  assert.equal(
    derivePresenceState({ agent: agent, agentFetchedAt: NOW, runtimeError: { code: GM.IFRAME_CRASHED } }, NOW),
    PRESENCE.WAITING
  );
  assert.equal(
    derivePresenceState({ agent: null, agentFetchedAt: 0, runtimeError: { code: GM.IFRAME_CRASHED } }, NOW),
    PRESENCE.ERROR
  );
  assert.equal(
    derivePresenceState(
      { agent: { state: 'completed', sessionId: 'session-A' }, agentFetchedAt: NOW - 9000, runtimeError: null },
      NOW
    ),
    PRESENCE.IDLE
  );
  assert.equal(presenceLabelKey(PRESENCE.WAITING, agent), 'agent.state.waiting.approval');
  assert.equal(presenceLabelKey(PRESENCE.RUNNING, { labelKey: 'agent.state.test' }), 'agent.state.test');
  assert.equal(presenceLabelKey(PRESENCE.RUNNING, { labelKey: 'unknown' }), 'agent.state.running');
  assert.equal(presenceActionKey(PRESENCE.COMPLETED), 'agent.action.results');
  assert.equal(presenceBubbleDefaultOpen(PRESENCE.RUNNING), false);
  assert.equal(presenceBubbleDefaultOpen(PRESENCE.WAITING), true);
});

test('runtime controller factory degrades the stub to GM-NO_RUNTIME', function () {
  const stub = safeCreateRuntime(function throwing() {
    throw new Error('Game Runtime is not implemented');
  }, {});
  assert.equal(stub.ok, false);
  assert.equal(stub.error.code, GM.NO_RUNTIME);
  assert.equal(safeCreateRuntime(null, {}).error.code, GM.NO_RUNTIME);
  const invalid = safeCreateRuntime(function partial() {
    return { launch: function launch() {} };
  }, {});
  assert.equal(invalid.ok, false);
  const calls = [];
  const controller = {
    launch: function launch() {},
    pause: function pause() {},
    resume: function resume() {},
    destroy: function destroy() {},
    getState: function getState() {
      return { state: 'idle', gameId: null };
    },
  };
  assert.equal(isRuntimeController(controller), true);
  const created = safeCreateRuntime(function factory(options) {
    calls.push(options);
    return controller;
  }, { container: 'x' });
  assert.equal(created.ok, true);
  assert.equal(created.controller, controller);
  assert.deepEqual(calls, [{ container: 'x' }]);
});

test('pauseRuntime distinguishes success, failed save and thrown pause', async function () {
  const success = await pauseRuntime({
    pause: async function pause() {
      return { ok: true, saveStale: false };
    },
  });
  assert.equal(success.ok, true);
  assert.equal(success.saveStale, false);
  const failed = await pauseRuntime({
    pause: async function pause() {
      return { ok: false, saveStale: true };
    },
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.unresponsive, false);
  const thrown = await pauseRuntime({
    pause: async function pause() {
      throw new Error('bridge closed');
    },
  });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.unresponsive, true);
});

test('pauseRuntimeBounded never leaves the UI waiting forever', async function () {
  const result = await pauseRuntimeBounded(
    {
      pause: function pause() {
        return new Promise(function never() {});
      },
    },
    20
  );
  assert.equal(result.ok, false);
  assert.equal(result.unresponsive, true);
  assert.equal(result.error.code, GM.IFRAME_UNRESPONSIVE);
});

// ---------------------------------------------------------------------------
// V1.5 instance resource fields + resource-credential reload (contract §7.2/§7.6)
// ---------------------------------------------------------------------------

const RESOURCE_ORIGIN = 'http://127.0.0.1:58302';
const RESOURCE_BASE = `${RESOURCE_ORIGIN}/res/${'a'.repeat(32)}/${'c'.repeat(32)}`;
const RESOURCE_ENTRY = `${RESOURCE_BASE}/index.html`;
const ZIP_LAUNCH_URL =
  `${RESOURCE_ORIGIN}/entry?gameId=snake&version=1.0.0&instance=${'a'.repeat(32)}` +
  `&nonce=${'b'.repeat(32)}&launch=${'b'.repeat(32)}`;

function zipLaunchInfo(overrides) {
  return launchInfo({
    entryUrl: ZIP_LAUNCH_URL,
    resourceOrigin: RESOURCE_ORIGIN,
    resourceBase: RESOURCE_BASE,
    resourceTtlMs: 600000,
    entryResourceUrl: RESOURCE_ENTRY,
    package: { format: 'asset-zip-v2', entry: 'index.html', filesDigest: 'd'.repeat(64) },
    ...(overrides || {}),
  });
}

test('absolute loopback resource entry URLs are accepted; external ones are not', function () {
  assert.equal(isSafeEntryUrl(ZIP_LAUNCH_URL), true);
  assert.equal(isSafeEntryUrl(`${RESOURCE_BASE}/levels/a.json`), true);
  for (const bad of [
    'https://evil.example/entry?x=1',
    'http://192.168.1.10:8080/entry?x=1',
    'http://127.0.0.1:58302/entry/%2e%2e/x',
    'http://127.0.0.1:58302/entry\u0000',
    '//127.0.0.1:58302/entry',
    'file:///etc/passwd',
  ]) {
    assert.equal(isSafeEntryUrl(bad), false, `${bad} must be rejected`);
  }
});

test('launch info validation covers the V1.5 resource extension', function () {
  assert.equal(validateLaunchInfo(zipLaunchInfo()).ok, true);

  // asset-zip-v2 must carry the complete resource credential set.
  const missingResource = zipLaunchInfo();
  delete missingResource.resourceBase;
  assert.equal(validateLaunchInfo(missingResource).ok, false);
  assert.equal(validateLaunchInfo(missingResource).error.code, GM.INVALID_PARAM);

  const legacyEntryForZip = zipLaunchInfo({ entryUrl: '/api/game-market/entry?gameId=snake' });
  assert.equal(validateLaunchInfo(legacyEntryForZip).ok, false);
  assert.equal(validateLaunchInfo(legacyEntryForZip).error.code, GM.ASSET_INTEGRITY);

  const foreignEntry = zipLaunchInfo({ entryUrl: 'https://evil.example/entry' });
  assert.equal(validateLaunchInfo(foreignEntry).ok, false);

  const badBase = zipLaunchInfo({ resourceBase: `${RESOURCE_ORIGIN}/res/short/token` });
  assert.equal(validateLaunchInfo(badBase).ok, false);

  const badEntryResource = zipLaunchInfo({ entryResourceUrl: `${RESOURCE_ORIGIN}/res/x/y/z.html` });
  assert.equal(validateLaunchInfo(badEntryResource).ok, false);

  const badTtl = zipLaunchInfo({ resourceTtlMs: -1 });
  assert.equal(validateLaunchInfo(badTtl).ok, false);

  const foreignWrapper = zipLaunchInfo({ wrapperUrl: 'http://127.0.0.1:9999/wrapper?src=x' });
  assert.equal(validateLaunchInfo(foreignWrapper).ok, false);

  const goodWrapper = zipLaunchInfo({ wrapperUrl: `${RESOURCE_ORIGIN}/wrapper?src=x` });
  assert.equal(validateLaunchInfo(goodWrapper).ok, true);

  // html-v1 with no new fields stays valid (V1 compatibility).
  assert.equal(validateLaunchInfo(launchInfo()).ok, true);
});

test('resource-credential reload policy only applies to V1.5 launches', function () {
  assert.equal(canReloadRuntime(zipLaunchInfo()), true);
  assert.equal(canReloadRuntime(launchInfo()), false);
  assert.equal(canReloadRuntime(null), false);

  assert.equal(shouldReloadRuntime({ code: GM.LOAD_TIMEOUT }, zipLaunchInfo()), true);
  assert.equal(shouldReloadRuntime({ code: GM.HANDSHAKE_TIMEOUT }, zipLaunchInfo()), true);
  assert.equal(shouldReloadRuntime({ code: GM.ENTRY_LAUNCH_CONSUMED }, zipLaunchInfo()), true);
  assert.equal(shouldReloadRuntime({ code: GM.SAVE_CORRUPT }, zipLaunchInfo()), false);
  assert.equal(shouldReloadRuntime({ code: GM.LOAD_TIMEOUT }, launchInfo()), false);

  assert.equal(isTerminalResourceError({ code: GM.RESOURCE_CREDENTIAL_EXPIRED }), true);
  assert.equal(isTerminalResourceError({ code: GM.ENTRY_LAUNCH_CONSUMED }), true);
  assert.equal(isTerminalResourceError({ code: GM.HOST_UNAVAILABLE }), false);
  assert.equal(isTerminalResourceError(null), false);
});

test('reloadRuntime delegates to controller.reload and reports acceptance', function () {
  let calls = 0;
  const controller = {
    reload() {
      calls += 1;
      return Promise.resolve({ ok: true });
    },
  };
  assert.equal(reloadRuntime(controller), true);
  assert.equal(calls, 1);
  assert.equal(reloadRuntime({}), false);
  assert.equal(
    reloadRuntime({
      reload() {
        throw new Error('boom');
      },
    }),
    false
  );
});
