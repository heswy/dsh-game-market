import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateHarness } from '../packages/host/test/support/platform-update-harness.js';

test('an unavailable active-instance inventory blocks package changes and allows retry', async t => {
  const h = await createUpdateHarness(t);
  h.coordinationState.instances = { slice() { throw new Error('inventory unavailable'); } };
  await assert.rejects(() => h.begin(), error => /active game|inspect/i.test(error.cause?.message ?? error.message));
  assert.equal(h.managerCalls.installBundle.length, 0);
  assert.equal(h.admission.isBlocked(), false);
  h.coordinationState.instances = [];
  await h.begin();
  await h.waitFor(() => h.managerCalls.installBundle.length === 1);
});
