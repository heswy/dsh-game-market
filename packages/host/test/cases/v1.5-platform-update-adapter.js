/**
 * V1.5 M3-H2: PlatformUpdateAdapter against the public plugin-manager surface.
 *
 * Locks the adapter contract: lazy service resolution (t0-missing → later
 * present), HMR capability polling/absence settle/fail-closed, dev-row shadow
 * detection, bundle state mapping, exact pinned spec construction and the
 * pass-through semantics of `waitForInstall` (null is NOT success).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { GM } from '../../../shared/src/errors.js';
import { createPlatformUpdateAdapter } from '../../src/update-adapter.js';
import {
  COMMIT_A,
  COMMIT_B,
  createFakePluginManager,
  createMutableIdentity,
  makeBundleState,
  makeTarget,
} from '../support/platform-update-harness.js';

const HMR_SERVICE = { runExclusive: async (task) => task() };
const FAST_TIMING = { hmrProbeIntervalMs: 2, hmrAbsenceSettleMs: 8, hmrProbeTimeoutMs: 120 };

function makeAdapter({ managerRef, identity, hmrResolver, timing = FAST_TIMING } = {}) {
  const mutable = identity ?? createMutableIdentity();
  const adapter = createPlatformUpdateAdapter({
    pluginManagerResolver: () => managerRef.current,
    hmrResolver: hmrResolver ?? (() => managerRef.current?.ownerContext?.get?.('hmr')),
    identity: mutable.identity ?? mutable,
    hostEpoch: 'he_0123456789abcdef',
    timing,
  });
  return { adapter, mutable };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function register() {
  test('adapter resolves the plugin manager lazily (t0 missing, later present)', async () => {
    const fake = createFakePluginManager({ hmr: HMR_SERVICE });
    const managerRef = { current: null };
    const { adapter } = makeAdapter({ managerRef });
    assert.equal(adapter.available(), false);
    const before = await adapter.describe();
    assert.equal(before.available, false);
    assert.equal(before.pluginManager, 'missing');
    assert.equal(before.reasonKey, 'update.reason.adapterUnavailable');
    // The service appears after activation stabilises (M0 race).
    managerRef.current = fake.manager;
    assert.equal(adapter.available(), true);
    const after = await adapter.describe();
    assert.equal(after.available, true);
    assert.equal(after.pluginManager, 'present');
    assert.equal(after.hmr, 'present');
  });

  test('adapter reports unavailable when a public method is missing', async () => {
    const managerRef = {
      current: {
        listBundles: () => [],
        listPlugins: () => [],
        installBundle: () => undefined,
        waitForInstall: () => null,
        // cancelInstall missing → capability must fail closed.
      },
    };
    const { adapter } = makeAdapter({ managerRef });
    assert.equal(adapter.available(), false);
    assert.equal((await adapter.describe()).available, false);
  });

  test('describe maps bundle state (enabled/version/availability) from listBundles', async () => {
    const fake = createFakePluginManager({ hmr: HMR_SERVICE, bundles: [makeBundleState({ version: '1.2.0', enabled: false })] });
    const { adapter } = makeAdapter({ managerRef: { current: fake.manager } });
    const described = await adapter.describe();
    assert.equal(described.available, true);
    assert.equal(described.enabled, false);
    assert.equal(described.diskVersion, '1.2.0');
    assert.equal(described.installed, true);
    assert.equal(described.availability, 'profile');
    assert.equal(described.devRowShadow, false);
    assert.match(described.recordSource, /^github:heswy\/dsh-game-market#/);
  });

  test('describe detects a dev row shadowing the installed package', async () => {
    const fake = createFakePluginManager({
      hmr: HMR_SERVICE,
      bundles: [makeBundleState()],
      plugins: [
        {
          entryId: 'entry:dev',
          moduleName: 'file:///tmp/checkout/dsh-game-market/index.js',
          enabled: true,
          fiberPhase: 'active',
          patchId: 'dsh-game-market',
        },
      ],
    });
    const { adapter } = makeAdapter({ managerRef: { current: fake.manager } });
    const described = await adapter.describe();
    assert.equal(described.devRowShadow, true);
  });

  test('describe treats an explicit dev-source identity as shadowed without plugins', async () => {
    const fake = createFakePluginManager({ hmr: HMR_SERVICE });
    const mutable = createMutableIdentity({ devSource: true });
    const { adapter } = makeAdapter({ managerRef: { current: fake.manager }, identity: mutable });
    const described = await adapter.describe();
    assert.equal(described.devRowShadow, true);
  });

  test('HMR capability: present is detected once the service registers (stable samples)', async () => {
    const fake = createFakePluginManager({ hmr: undefined });
    const managerRef = { current: fake.manager };
    const { adapter } = makeAdapter({ managerRef });
    setTimeout(() => {
      fake.state.hmr = HMR_SERVICE;
    }, 15);
    const { adapter: patient } = makeAdapter({
      managerRef,
      timing: { hmrProbeIntervalMs: 2, hmrAbsenceSettleMs: 60, hmrProbeTimeoutMs: 300 },
    });
    assert.equal(await patient.detectHmrCapability(fake.manager, { signature: 'sig' }), 'present');
  });

  test('HMR capability: absent requires continuous absence (t0 race cannot produce a false absent)', async () => {
    const fake = createFakePluginManager({ hmr: undefined });
    const { adapter } = makeAdapter({ managerRef: { current: fake.manager } });
    assert.equal(await adapter.detectHmrCapability(fake.manager, { signature: 'sig' }), 'absent');
  });

  test('HMR capability: unresolvable/throwing probes fail closed as unknown', async () => {
    const fake = createFakePluginManager({ hmr: undefined });
    const { adapter } = makeAdapter({
      managerRef: { current: fake.manager },
      hmrResolver: () => {
        throw new Error('service unavailable');
      },
    });
    assert.equal(await adapter.detectHmrCapability(fake.manager, { signature: 'sig' }), 'unknown');
  });

  test('HMR capability: a single transient presence then absence is unknown, never absent', async () => {
    const fake = createFakePluginManager({ hmr: undefined });
    let samples = 0;
    const { adapter } = makeAdapter({
      managerRef: { current: fake.manager },
      hmrResolver: () => {
        samples += 1;
        return samples === 1 ? HMR_SERVICE : undefined;
      },
      timing: { hmrProbeIntervalMs: 2, hmrAbsenceSettleMs: 4, hmrProbeTimeoutMs: 40 },
    });
    assert.equal(await adapter.detectHmrCapability(fake.manager, { signature: 'sig' }), 'unknown');
  });

  test('HMR capability cache is per hostEpoch and invalidated by tree changes', async () => {
    const fake = createFakePluginManager({ hmr: undefined });
    let resolverCalls = 0;
    const { adapter } = makeAdapter({
      managerRef: { current: fake.manager },
      hmrResolver: () => {
        resolverCalls += 1;
        return fake.state.hmr;
      },
    });
    fake.state.hmr = HMR_SERVICE;
    assert.equal(await adapter.detectHmrCapability(fake.manager, { signature: 'tree-a' }), 'present');
    assert.equal(await adapter.detectHmrCapability(fake.manager, { signature: 'tree-a' }), 'present');
    assert.ok(resolverCalls <= 4, 'second call must reuse the cached capability');
    const afterCache = resolverCalls;
    fake.state.hmr = undefined;
    assert.equal(await adapter.detectHmrCapability(fake.manager, { signature: 'tree-b' }), 'absent');
    assert.ok(resolverCalls > afterCache, 'tree change must invalidate the cache');
  });

  test('install constructs the exact frozen spec and never forwards a foreign target', async () => {
    const fake = createFakePluginManager({
      hmr: HMR_SERVICE,
      install: async (spec, options) => {
        assert.equal(spec, `https://github.com/heswy/dsh-game-market.git#${COMMIT_A}`);
        assert.equal(options.enabled, true);
        assert.equal(options.saveExact, true);
        assert.match(options.requestId, /^upd_[a-f0-9]{16}$/);
        return { application: 'applied', changed: true, version: '1.3.0', bundle: 'dsh-game-market' };
      },
    });
    const { adapter } = makeAdapter({ managerRef: { current: fake.manager } });
    const target = makeTarget();
    const result = await adapter.install(target, { requestId: 'upd_0123456789abcdef' });
    assert.equal(result.application, 'applied');
    assert.equal(fake.calls.installBundle.length, 1);

    // A tampered target (spec mismatch / non-official commit form) is refused
    // before the native manager is ever called.
    const tampered = { ...target, spec: 'https://evil.example.com/dsh-game-market.git#abc' };
    await assert.rejects(
      () => adapter.install(tampered, { requestId: 'upd_0123456789abcdef' }),
      (error) => {
        assert.equal(error.code, GM.UPDATE_TARGET_INVALID);
        return true;
      }
    );
    const shortCommit = { ...target, commit: 'abc1234', spec: `https://github.com/heswy/dsh-game-market.git#abc1234` };
    await assert.rejects(
      () => adapter.install(shortCommit, { requestId: 'upd_0123456789abcdef' }),
      (error) => {
        assert.equal(error.code, GM.UPDATE_TARGET_INVALID);
        return true;
      }
    );
    assert.equal(fake.calls.installBundle.length, 1);
  });

  test('install fails closed when the plugin manager is unreachable', async () => {
    const { adapter } = makeAdapter({ managerRef: { current: null } });
    await assert.rejects(
      () => adapter.install(makeTarget(), { requestId: 'upd_0123456789abcdef' }),
      (error) => {
        assert.equal(error.code, GM.UPDATE_ADAPTER_UNAVAILABLE);
        return true;
      }
    );
  });

  test('waitForInstall passes through null (null is not success) and active results', async () => {
    const result = { application: 'applied', changed: true, version: '1.3.0', bundle: 'dsh-game-market' };
    let mode = 'null';
    const fake = createFakePluginManager({
      hmr: HMR_SERVICE,
      waitInstall: async () => (mode === 'null' ? null : result),
    });
    const { adapter } = makeAdapter({ managerRef: { current: fake.manager } });
    assert.equal(await adapter.waitForInstall('upd_0123456789abcdef'), null);
    mode = 'result';
    assert.deepEqual(await adapter.waitForInstall('upd_0123456789abcdef'), result);
    // Without a manager the adapter must not invent an outcome.
    const { adapter: missing } = makeAdapter({ managerRef: { current: null } });
    assert.equal(await missing.waitForInstall('upd_0123456789abcdef'), null);
  });

  test('cancelInstall passes the native three-state answer through', async () => {
    let status = 'not-running';
    const fake = createFakePluginManager({ hmr: HMR_SERVICE, cancel: async () => ({ status }) });
    const { adapter } = makeAdapter({ managerRef: { current: fake.manager } });
    assert.deepEqual(await adapter.cancelInstall('upd_0123456789abcdef'), { status: 'not-running' });
    status = 'cancelled';
    assert.deepEqual(await adapter.cancelInstall('upd_0123456789abcdef'), { status: 'cancelled' });
    status = 'too-late';
    assert.deepEqual(await adapter.cancelInstall('upd_0123456789abcdef'), { status: 'too-late' });
    assert.equal(fake.calls.cancelInstall.length, 3);
  });

  test('expected client identity comes from the running bundle release identity', async () => {
    const mutable = createMutableIdentity({ expectedClient: { buildVersion: '1.3.0', buildCommit: COMMIT_B } });
    const { adapter } = makeAdapter({ managerRef: { current: null }, identity: mutable });
    assert.deepEqual(adapter.expectedClientIdentity(), { buildVersion: '1.3.0', buildCommit: COMMIT_B });
  });
}
