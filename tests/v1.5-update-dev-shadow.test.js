import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { discoverProfile, createHostIdentity } from '../packages/host/src/host-identity.js';

test('a dev row cannot borrow an installed dependency identity in a single profile or explicit profile', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dgm-dev-shadow-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const profile = path.join(root, 'profiles/web');
  const bundleRoot = path.join(root, 'checkout');
  await fs.mkdir(profile, { recursive: true });
  await fs.mkdir(bundleRoot);
  await fs.writeFile(path.join(profile, 'package.json'), JSON.stringify({ dependencies: { 'dsh-game-market': 'github:heswy/dsh-game-market#' + 'a'.repeat(40) } }));
  await fs.writeFile(path.join(profile, 'cordis.patch.yml'), `- name: dsh-game-market\n  entry: ${pathToFileURL(path.join(bundleRoot, 'index.js')).href}\n`);
  for (const settings of [{}, { platformUpdate: { profileDir: profile } }]) {
    assert.equal(discoverProfile({ env: { DSH_HOME: root }, settings, bundleRoot }).devSource, true);
    const identity = createHostIdentity({ env: { DSH_HOME: root }, settings, bundleRoot, version: '1.3.0' });
    assert.equal(identity.buildCommit, null, 'dev code must never claim the installed Git commit');
  }
});
