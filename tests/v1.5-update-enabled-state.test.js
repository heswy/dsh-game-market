import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateHarness, makeBundleState } from '../packages/host/test/support/platform-update-harness.js';

test('updating a disabled bundle never silently enables it', async t => {
  const h = await createUpdateHarness(t, { managerOptions: { bundles: [makeBundleState({ enabled: false })] } });
  await h.begin();
  await h.waitFor(() => h.managerCalls.installBundle.length === 1);
  assert.equal(h.managerCalls.installBundle[0].options.enabled, false);
});


test('adapter rechecks a disable made after the initial update inspection', async t => {
  const h = await createUpdateHarness(t);
  const initial = await h.adapter.describe();
  assert.equal(initial.enabled, true);
  h.managerState.bundles[0].enabled = false;
  await h.adapter.install(h.target, { requestId: 'upd_0123456789abcdef', enabled: true });
  assert.equal(h.managerCalls.installBundle[0].options.enabled, false);
});
