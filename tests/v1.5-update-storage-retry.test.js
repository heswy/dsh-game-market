import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createUpdateHarness } from '../packages/host/test/support/platform-update-harness.js';

test('explicit update retry rechecks storage after a real permission failure is repaired', async t => {
  const h = await createUpdateHarness(t);
  const dir = h.storage.filePath('saves', 'snake');
  await fs.mkdir(dir, { recursive: true });
  await fs.chmod(dir, 0o555);
  try {
    await assert.rejects(() => h.storage.writeJson(h.storage.filePath('saves', 'snake', 'current.json'), { value: 1 }));
    assert.equal(h.storage.status().readOnly, true);
  } finally { await fs.chmod(dir, 0o755); }
  // No health call or Host restart: explicit retry must recover the sticky
  // read-only flag before collecting new save acknowledgements.
  const operation = await h.begin();
  assert.match(operation.operationId, /^upd_/);
  await h.waitFor(() => h.managerCalls.installBundle.length === 1);
  assert.equal(h.storage.status().readOnly, false);
});
