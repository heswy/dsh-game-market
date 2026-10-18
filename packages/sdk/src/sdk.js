/**
 * Public game SDK (PRD §8.3 / D-011).
 *
 *   const game = DSH_GAME_SDK.createGameSDK();
 *   const info = await game.ready();
 *   await game.storage.save('current', state);
 *
 * The API surface is intentionally tiny: ready / storage / session / score /
 * lifecycle / agent / runtime. Anything else is out of scope by contract.
 */

import { PROTOCOL_VERSION, SDK_VERSION } from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import { METHODS } from '../../shared/src/protocol.js';
import { createBridgeClient, SDK_METHOD_TIMEOUTS } from './bridge-client.js';
import { GameError as GameErrorImpl, createGameError, isGameError as isGameErrorImpl } from './errors.js';
import { createEventHub, isLifecycleEvent } from './event-hub.js';
import { assertScoreValue, assertSessionOutcome, assertStorageKey, prepareScoreMeta, prepareStorageValue } from './validate.js';

/** Re-export the error class as a const (the repo bundler only supports named declarations). */
export const GameError = GameErrorImpl;

export function isGameError(error) {
  return isGameErrorImpl(error);
}

function createRuntimeState() {
  return {
    sdkVersion: SDK_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    runtimeVersion: null,
    gameId: '',
    gameVersion: '',
    locale: 'zh',
    theme: 'light',
    reducedMotion: false,
    capabilities: Object.freeze([]),
    viewport: Object.freeze({ width: 0, height: 0, dpr: 1 }),
    ready: false,
  };
}

function createRuntimeView(state) {
  const view = {};
  for (const key of Object.keys(state)) {
    Object.defineProperty(view, key, {
      enumerable: true,
      get: function get() {
        return state[key];
      },
    });
  }
  return Object.freeze(view);
}

function normalizeAgentState(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    state: value.state,
    label: typeof value.label === 'string' ? value.label : '',
    sessionId: value.sessionId === undefined ? null : value.sessionId,
    updatedAt: value.updatedAt,
    source: value.source,
    seq: value.seq,
    since: value.since,
    turnId: value.turnId === undefined ? null : value.turnId,
  };
}

function normalizeViewport(value) {
  const source = value && typeof value === 'object' ? value : {};
  const width = Number.isFinite(source.width) ? source.width : 0;
  const height = Number.isFinite(source.height) ? source.height : 0;
  const dpr = Number.isFinite(source.dpr) && source.dpr > 0 ? source.dpr : 1;
  return Object.freeze({ width, height, dpr });
}

export function createGameSDK(options = {}) {
  const win = options.window || (typeof window !== 'undefined' ? window : null);
  const parent = options.parent || (win && win.parent) || null;
  const location = options.location || (win && win.location) || null;
  const timers = options.timers || globalThis;
  const now = typeof options.now === 'function' ? options.now : Date.now;

  const hub = createEventHub();
  const runtimeState = createRuntimeState();
  const runtimeView = createRuntimeView(runtimeState);

  let readyPromise = null;
  let backfillPromise = null;
  let lastAgent = null;

  function applyViewport(value) {
    runtimeState.viewport = normalizeViewport(value);
  }

  function applyInit(init) {
    if (!init || typeof init !== 'object') return;
    if (typeof init.gameId === 'string') runtimeState.gameId = init.gameId;
    if (typeof init.gameVersion === 'string') runtimeState.gameVersion = init.gameVersion;
    if (typeof init.runtimeVersion === 'string') runtimeState.runtimeVersion = init.runtimeVersion;
    if (typeof init.sdkVersion === 'string') runtimeState.sdkVersion = init.sdkVersion;
    if (typeof init.locale === 'string') runtimeState.locale = init.locale;
    if (init.theme === 'dark' || init.theme === 'light') runtimeState.theme = init.theme;
    if (typeof init.reducedMotion === 'boolean') runtimeState.reducedMotion = init.reducedMotion;
    if (Array.isArray(init.capabilities)) runtimeState.capabilities = Object.freeze(init.capabilities.slice());
    if (init.viewport) applyViewport(init.viewport);
  }

  function applyReadyResult(result) {
    if (!result || typeof result !== 'object') return;
    if (typeof result.runtimeVersion === 'string') runtimeState.runtimeVersion = result.runtimeVersion;
    if (typeof result.gameId === 'string') runtimeState.gameId = result.gameId;
    if (typeof result.gameVersion === 'string') runtimeState.gameVersion = result.gameVersion;
    if (typeof result.sdkVersion === 'string') runtimeState.sdkVersion = result.sdkVersion;
    if (typeof result.locale === 'string') runtimeState.locale = result.locale;
    if (result.theme === 'dark' || result.theme === 'light') runtimeState.theme = result.theme;
    if (typeof result.reducedMotion === 'boolean') runtimeState.reducedMotion = result.reducedMotion;
    if (Array.isArray(result.capabilities)) runtimeState.capabilities = Object.freeze(result.capabilities.slice());
    if (result.viewport) applyViewport(result.viewport);
    if (typeof result.protocolVersion === 'number') runtimeState.protocolVersion = result.protocolVersion;
    runtimeState.ready = true;
  }

  function handleRuntimeEvent(name, data) {
    if (name === 'theme') {
      if (!data || typeof data !== 'object') return;
      if (data.theme === 'dark' || data.theme === 'light') runtimeState.theme = data.theme;
      if (typeof data.reducedMotion === 'boolean') runtimeState.reducedMotion = data.reducedMotion;
      return;
    }
    if (name === 'viewport') {
      applyViewport(data);
      return;
    }
    if (name === 'agent-status') {
      const snapshot = normalizeAgentState(data);
      if (!snapshot) return;
      lastAgent = snapshot;
      hub.emit('agent-status', snapshot, { buffer: false });
      return;
    }
    if (isLifecycleEvent(name)) {
      hub.emit(name, data && typeof data === 'object' ? data : {});
    }
  }

  function handleFatal(error) {
    hub.emit('fatal', error, { buffer: false });
  }

  const bridge = createBridgeClient({
    window: win,
    parent,
    location,
    timers,
    now,
    crypto: options.crypto,
    onInit: applyInit,
    onEvent: handleRuntimeEvent,
    onFatal: handleFatal,
  });

  function requireReady() {
    const fatal = bridge.getFatalError();
    if (fatal) throw fatal;
    if (!bridge.isReady()) {
      throw createGameError(GM.NOT_READY, 'Game is not ready yet');
    }
  }

  function ready(timeoutMs) {
    if (!readyPromise) {
      readyPromise = bridge.ready(timeoutMs).then(function onReady(info) {
        const payload = info && typeof info === 'object' ? info : {};
        applyInit(payload.init);
        applyReadyResult(payload.result);
        runtimeState.ready = true;
        hub.open();
        ensureAgentBackfill();
        return runtimeView;
      });
      // A game may register listeners without ever awaiting ready().
      readyPromise.then(undefined, function ignore() {});
    }
    return readyPromise;
  }

  function ensureAgentBackfill() {
    if (backfillPromise) return backfillPromise;
    if (!hub.has('agent-status')) return null;
    backfillPromise = bridge.ready().then(function onReady() {
      return bridge.request(METHODS.AGENT_GET_STATUS, {}, SDK_METHOD_TIMEOUTS['agent.getStatus']);
    }).then(function onStatus(snapshot) {
      const normalized = normalizeAgentState(snapshot);
      if (!normalized) return;
      lastAgent = normalized;
      hub.emit('agent-status', normalized, { buffer: false });
    }).then(undefined, function ignore() {});
    return backfillPromise;
  }

  async function storageSave(key, data) {
    requireReady();
    assertStorageKey(key);
    const prepared = prepareStorageValue(data);
    return bridge.request(METHODS.STORAGE_SAVE, { key, data: prepared.value }, SDK_METHOD_TIMEOUTS['storage.save']);
  }

  async function storageLoad(key) {
    requireReady();
    assertStorageKey(key);
    return bridge.request(METHODS.STORAGE_LOAD, { key }, SDK_METHOD_TIMEOUTS['storage.load']).then(function onLoaded(
      result
    ) {
      return result === undefined ? null : result;
    });
  }

  async function storageRemove(key) {
    requireReady();
    assertStorageKey(key);
    return bridge.request(METHODS.STORAGE_REMOVE, { key }, SDK_METHOD_TIMEOUTS['storage.remove']);
  }

  async function sessionStart() {
    requireReady();
    return bridge.request(METHODS.SESSION_START, {}, SDK_METHOD_TIMEOUTS['session.start']);
  }

  async function sessionEnd(endOptions) {
    requireReady();
    const input = endOptions && typeof endOptions === 'object' ? endOptions : {};
    const outcome = input.outcome === undefined ? 'completed' : input.outcome;
    assertSessionOutcome(outcome);
    let score = null;
    if (input.score !== undefined && input.score !== null) {
      assertScoreValue(input.score);
      score = input.score;
    }
    return bridge.request(METHODS.SESSION_END, { outcome, score }, SDK_METHOD_TIMEOUTS['session.end']);
  }

  async function scoreSubmit(score, meta) {
    requireReady();
    assertScoreValue(score);
    const preparedMeta = prepareScoreMeta(meta);
    return bridge.request(
      METHODS.SCORE_SUBMIT,
      { score, meta: preparedMeta },
      SDK_METHOD_TIMEOUTS['score.submit']
    );
  }

  async function scoreGetBest() {
    requireReady();
    return bridge.request(METHODS.SCORE_GET_BEST, {}, SDK_METHOD_TIMEOUTS['score.getBest']).then(function onBest(
      result
    ) {
      return result === undefined ? null : result;
    });
  }

  async function agentGetStatus() {
    requireReady();
    return bridge.request(METHODS.AGENT_GET_STATUS, {}, SDK_METHOD_TIMEOUTS['agent.getStatus']).then(function onStatus(
      snapshot
    ) {
      const normalized = normalizeAgentState(snapshot);
      if (normalized) lastAgent = normalized;
      return normalized || snapshot;
    });
  }

  function agentOn(event, handler) {
    if (event !== 'status') throw createGameError(GM.INVALID_PARAM, `Unknown agent event: ${String(event)}`);
    const off = hub.on('agent-status', handler);
    bridge.start();
    if (bridge.isReady()) ensureAgentBackfill();
    else bridge.ready().then(ensureAgentBackfill, function ignore() {});
    return off;
  }

  function lifecycleOn(event, handler) {
    if (!isLifecycleEvent(event)) {
      throw createGameError(GM.INVALID_PARAM, `Unknown lifecycle event: ${String(event)}`);
    }
    const off = hub.on(event, handler);
    bridge.start();
    return off;
  }

  const storage = Object.freeze({
    save: storageSave,
    load: storageLoad,
    remove: storageRemove,
  });

  const session = Object.freeze({
    start: sessionStart,
    end: sessionEnd,
  });

  const score = Object.freeze({
    submit: scoreSubmit,
    getBest: scoreGetBest,
  });

  const lifecycle = Object.freeze({
    on: lifecycleOn,
  });

  const agent = Object.freeze({
    getStatus: agentGetStatus,
    on: agentOn,
  });

  const game = {
    runtime: runtimeView,
    ready,
    storage,
    session,
    score,
    lifecycle,
    agent,
    onError: function onError(handler) {
      return hub.on('fatal', handler);
    },
    isGameError,
  };

  return Object.freeze(game);
}
