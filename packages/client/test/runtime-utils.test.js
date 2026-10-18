import test from 'node:test';
import assert from 'node:assert/strict';
import { TIMING } from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import {
  deriveLoadPhase,
  isRuntimeLoadingState,
  isSafeEntryUrl,
  validateLaunchInfo,
} from '../src/runtime-utils.js';
import {
  isRuntimeController,
  pauseRuntime,
  pauseRuntimeBounded,
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
