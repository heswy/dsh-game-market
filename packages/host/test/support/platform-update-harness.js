/**
 * Deterministic fakes for V1.5 platform update adapter/operations tests.
 *
 * A fake `pluginManager` exposes exactly the public methods the adapter uses
 * (`listBundles`, `listPlugins`, `installBundle`, `waitForInstall`,
 * `cancelInstall`) plus an `ownerContext` fallback for the documented HMR probe
 * source. A mutable identity lets tests simulate an HMR re-apply or a process
 * restart (running identity changes) without touching the real DSH tree.
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { GM } from '../../../shared/src/errors.js';
import {
  updateGitSpecForCommit,
  updateTargetIdFor,
} from '../../../shared/src/platform-update.js';
import { createStorage } from '../../src/storage.js';
import { createUpdateAdmissionBarrier } from '../../src/update-admission.js';
import { createPlatformUpdateAdapter } from '../../src/update-adapter.js';
import { createUpdateOperationService } from '../../src/update-operations.js';

export const COMMIT_A = 'a'.repeat(40);
export const COMMIT_B = 'b'.repeat(40);
export const COMMIT_CLIENT = 'c'.repeat(40);
export const INSTANCE_A = '1'.repeat(32);
export const INSTANCE_B = '2'.repeat(32);

export function makeTarget({ version = '1.3.0', commit = COMMIT_A } = {}) {
  return {
    id: updateTargetIdFor(version, commit),
    version,
    commit,
    channel: 'stable',
    publishedAt: '2023-11-14T22:13:20.000Z',
    spec: updateGitSpecForCommit(commit),
  };
}

export function makeBundleState({
  version = '1.2.0',
  installed = true,
  enabled = true,
  availability = 'profile',
  source = `github:heswy/dsh-game-market#${'9'.repeat(40)}`,
} = {}) {
  return {
    name: 'dsh-game-market',
    official: false,
    availability,
    ...(source === null ? {} : { source }),
    version,
    enabled,
    installed,
    optional: false,
    removable: false,
    rows: [],
    overrides: [],
  };
}

/**
 * Fake native plugin manager. Behaviour of each public method is replaceable
 * per test; every call is recorded for ordering/idempotency assertions.
 */
export function createFakePluginManager({
  bundles = [makeBundleState()],
  plugins = [{ entryId: 'entry:market', moduleName: 'dsh-game-market', enabled: true, fiberPhase: 'active', patchId: 'dsh-game-market' }],
  hmr = undefined,
  install = async () => ({ stage: 'enable', target: 'dsh-game-market', enabled: true, changed: true, application: 'applied', bundle: 'dsh-game-market', version: '1.3.0' }),
  waitInstall = async () => null,
  cancel = async () => ({ status: 'not-running' }),
} = {}) {
  const calls = { listBundles: 0, listPlugins: 0, installBundle: [], waitForInstall: [], cancelInstall: [] };
  const state = { bundles, plugins, hmr, install, waitInstall, cancel };
  const manager = {
    listBundles() {
      calls.listBundles += 1;
      return state.bundles.map((entry) => ({ ...entry }));
    },
    listPlugins() {
      calls.listPlugins += 1;
      return state.plugins.map((entry) => ({ ...entry }));
    },
    installBundle(spec, options) {
      calls.installBundle.push({ spec, options });
      return state.install(spec, options);
    },
    waitForInstall(requestId) {
      calls.waitForInstall.push(requestId);
      return state.waitInstall(requestId);
    },
    cancelInstall(requestId) {
      calls.cancelInstall.push(requestId);
      return state.cancel(requestId);
    },
    ownerContext: {
      get(name) {
        return name === 'hmr' ? state.hmr : undefined;
      },
      emit() {},
    },
  };
  return { manager, calls, state };
}

/** Mutable Host running/disk identity for state-machine tests. */
export function createMutableIdentity({
  loadedVersion = '1.2.0',
  loadedCommit = COMMIT_B,
  diskVersion = '1.2.0',
  diskCommit = COMMIT_B,
  expectedClient = { buildVersion: '1.2.0', buildCommit: null },
  devSource = false,
} = {}) {
  const state = {
    loadedVersion,
    loadedCommit,
    diskVersion,
    diskCommit,
    expectedClient,
    devSource,
    specShape: 'git-url',
    profileDir: null,
  };
  const identity = {
    get loadedVersion() {
      return state.loadedVersion;
    },
    get buildCommit() {
      return state.loadedCommit;
    },
    get loadedAt() {
      return '2026-10-20T00:00:00.000Z';
    },
    get profileDir() {
      return state.profileDir;
    },
    get devSource() {
      return state.devSource;
    },
    get expectedClient() {
      return state.expectedClient;
    },
    snapshot() {
      return {
        bundleId: 'dsh-game-market',
        spec: state.loadedCommit === null ? null : `github:heswy/dsh-game-market#${state.diskCommit}`,
        specShape: state.specShape,
        version: state.diskVersion,
        enabled: true,
        loadedVersion: state.loadedVersion,
        loadedCommit: state.loadedCommit,
        devRowShadow: state.devSource === true,
        profileDir: state.profileDir,
        specCommit: state.diskCommit,
        diskVersion: state.diskVersion,
      };
    },
  };
  return {
    identity,
    state,
    setRunning({ version = state.loadedVersion, commit = state.loadedCommit } = {}) {
      state.loadedVersion = version;
      state.loadedCommit = commit;
    },
    setDisk({ version = state.diskVersion, commit = state.diskCommit } = {}) {
      state.diskVersion = version;
      state.diskCommit = commit;
    },
    setExpectedClient(value) {
      state.expectedClient = value;
    },
    /** Simulate a successful HMR install/restart: both running and disk move. */
    applyTarget(target, { clientCommit = COMMIT_CLIENT } = {}) {
      state.loadedVersion = target.version;
      state.loadedCommit = target.commit;
      state.diskVersion = target.version;
      state.diskCommit = target.commit;
      state.expectedClient = { buildVersion: target.version, buildCommit: clientCommit };
    },
  };
}

/** Fake discovery surface used by the operations service. */
export function createFakeDiscovery(target = makeTarget()) {
  const state = { target, previousTarget: null };
  return {
    state,
    resolveTarget: (targetId) =>
      state.target !== null && typeof targetId === 'string' && state.target.id === targetId ? state.target : null,
    previousTarget: () => state.previousTarget,
    whenReady: async () => undefined,
    setTarget(next) {
      state.previousTarget = state.target;
      state.target = next;
    },
    setPreviousTarget(previous) {
      state.previousTarget = previous;
    },
  };
}

export function makeActiveInstance({
  instanceId = INSTANCE_A,
  gameId = 'snake',
  version = '1.2.0',
} = {}) {
  return {
    instanceId,
    gameId,
    version,
    dshSessionId: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Build a full operations harness (real atomic storage + real adapter + fakes).
 *
 * @param {import('node:test').TestContext} t
 */
export async function createUpdateHarness(t, {
  target = makeTarget(),
  identity: identityOptions = {},
  managerOptions = {},
  instances = [],
  health = true,
  hmr = { value: { runExclusive: async (task) => task() } },
  adapterTiming = { hmrProbeIntervalMs: 2, hmrAbsenceSettleMs: 5, hmrProbeTimeoutMs: 60 },
  operationTiming = {
    coordinateTimeoutMs: 120,
    activationHostWaitMs: 400,
    activationClientWaitMs: 1500,
    recoveryProbeMs: 120,
    recoveryPollMs: 5,
    operationPollMs: 2,
    clientReportTtlMs: 60000,
  },
} = {}) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'dsh-gm-update-'));
  const dataRoot = path.join(directory, 'data');
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }).catch(() => undefined);
  });

  const fake = createFakePluginManager({ hmr: hmr.value, ...managerOptions });
  const managerRef = { current: fake.manager };
  const mutable = createMutableIdentity(identityOptions);
  const discovery = createFakeDiscovery(target);
  const storage = createStorage({ root: dataRoot });
  const admission = createUpdateAdmissionBarrier();
  const coordinationState = { instances: instances.slice() };
  let healthOk = health;
  const adapter = createPlatformUpdateAdapter({
    pluginManagerResolver: () => managerRef.current,
    hmrResolver: () => managerRef.current?.ownerContext?.get?.('hmr'),
    identity: mutable.identity,
    hostEpoch: 'he_0123456789abcdef',
    timing: adapterTiming,
  });
  const operations = createUpdateOperationService({
    storage,
    discovery,
    adapter,
    admission,
    identity: mutable.identity,
    coordination: { listActiveInstances: () => coordinationState.instances.slice() },
    healthCheck: async () => ({ ok: healthOk }),
    hostEpoch: 'he_0123456789abcdef',
    timing: operationTiming,
  });
  await operations.start();
  await operations.ready();

  const harness = {
    directory,
    dataRoot,
    storage,
    manager: fake.manager,
    managerCalls: fake.calls,
    managerState: fake.state,
    managerRef,
    identity: mutable.identity,
    identityState: mutable.state,
    mutable,
    discovery,
    adapter,
    operations,
    admission,
    coordinationState,
    setHealth: (ok) => {
      healthOk = ok;
    },
    setInstances: (list) => {
      coordinationState.instances = list.slice();
    },
    setManager: (manager) => {
      managerRef.current = manager;
    },
    target,
    timing: operationTiming,
    async stop() {
      await operations.stop();
      await storage.flush().catch(() => undefined);
    },
    async reopen({ identityState = {}, target: nextTarget = discovery.state.target, manager = fake.manager, waitRecovery = false } = {}) {
      // Simulate a fresh Host activation sharing the same storage root (HMR
      // re-apply or process restart): new identity, new adapter/operations.
      mutable.setRunning({
        version: identityState.loadedVersion ?? mutable.state.loadedVersion,
        commit: identityState.loadedCommit ?? mutable.state.loadedCommit,
      });
      mutable.setDisk({
        version: identityState.diskVersion ?? mutable.state.diskVersion,
        commit: identityState.diskCommit ?? mutable.state.diskCommit,
      });
      if (identityState.expectedClient !== undefined) mutable.setExpectedClient(identityState.expectedClient);
      const nextStorage = createStorage({ root: dataRoot });
      const nextAdapter = createPlatformUpdateAdapter({
        pluginManagerResolver: () => manager,
        hmrResolver: () => manager?.ownerContext?.get?.('hmr'),
        identity: mutable.identity,
        hostEpoch: 'he_fedcba9876543210',
        timing: adapterTiming,
      });
      const nextDiscovery = createFakeDiscovery(nextTarget);
      const nextOperations = createUpdateOperationService({
        storage: nextStorage,
        discovery: nextDiscovery,
        adapter: nextAdapter,
        admission,
        identity: mutable.identity,
        coordination: { listActiveInstances: () => coordinationState.instances.slice() },
        healthCheck: async () => ({ ok: healthOk }),
        hostEpoch: 'he_fedcba9876543210',
        timing: operationTiming,
      });
      await nextOperations.start();
      // Recovery runs in the background (like plugin activation): tests that
      // want to observe the mid-flight state DO NOT await it here.
      const recovered = nextOperations.ready();
      if (waitRecovery === true) await recovered;
      return {
        operations: nextOperations,
        adapter: nextAdapter,
        discovery: nextDiscovery,
        storage: nextStorage,
        ready: () => recovered,
      };
    },
    async begin(targetId = discovery.state.target.id) {
      return operations.begin({ targetId });
    },
    async observe(operationId) {
      return operations.observe(operationId);
    },
    async postClientReport({
      clientId = 'client-1',
      windowId = 'window-1',
      buildVersion,
      buildCommit = null,
    } = {}) {
      return operations.clientReport({
        clientId,
        windowId,
        buildVersion: buildVersion ?? mutable.state.expectedClient.buildVersion ?? mutable.state.loadedVersion,
        buildCommit,
        pageToken: 'page-1',
        startedAt: new Date().toISOString(),
      });
    },
    /** Poll the observation until `predicate` is true (or fail). */
    async waitFor(predicate, { timeoutMs = 3000, label = 'observation' } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const observation = operations.currentObservation();
        if (predicate(observation)) return observation;
        if (Date.now() >= deadline) {
          throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(observation)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
    async waitForState(states, options = {}) {
      const set = new Set(Array.isArray(states) ? states : [states]);
      return harness.waitFor((observation) => observation !== null && set.has(observation.state), {
        ...options,
        label: `state ${[...set].join('|')}`,
      });
    },
    /** Collect distinct observation states seen while polling (for ordering assertions). */
    trackStates() {
      const seen = [];
      const timer = setInterval(() => {
        const observation = operations.currentObservation();
        if (observation !== null && seen[seen.length - 1] !== observation.state) seen.push(observation.state);
      }, 1);
      if (typeof timer.unref === 'function') timer.unref();
      return {
        stop: () => clearInterval(timer),
        states: () => seen.slice(),
      };
    },
  };

  t.after(async () => {
    await harness.stop().catch(() => undefined);
  });
  return harness;
}

/** Error code assertion helper for rejected host-style errors. */
export function expectHostError(fn, code) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => {
        throw new Error(`expected ${code}`);
      },
      (error) => {
        assertErrorCode(error, code);
        return error;
      }
    );
}

function assertErrorCode(error, code) {
  if (error === null || typeof error !== 'object' || error.code !== code) {
    throw new Error(`expected ${code}, got ${error?.code}: ${error?.message}`);
  }
}

export { GM };
