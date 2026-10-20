import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const NODE = process.execPath;

/**
 * The Skill is versioned independently of the platform (it ships to outside
 * authors), so CLI assertions derive the archive name from VERSION instead of
 * pinning one literal — otherwise every Skill release breaks unrelated CLI
 * tests. The archive name is still verified end to end here.
 */
async function skillVersion() {
  return (await fs.readFile(path.join(ROOT, 'skills/dsh-game-developer/VERSION'), 'utf8')).trim();
}

function run(script, args, options = {}) {
  return spawnSync(NODE, [path.join(ROOT, script), ...args], {
    cwd: options.cwd || ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
}

test('content-repo CLI scripts run from a checkout path containing spaces', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-registry-cli-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'content repo');
  const init = run('scripts/registry/init-content-repo.mjs', [
    '--target', target,
    '--platform-repo', 'example/platform',
    '--platform-commit', '0123456789abcdef0123456789abcdef01234567',
    '--version', '1.1.0',
  ]);
  assert.equal(init.status, 0, init.stderr + init.stdout);
  assert.match(init.stdout, /initialised/i);

  const validate = run('scripts/registry/validate-catalog.mjs', ['--registry-dir', target, '--json'], { cwd: target });
  assert.equal(validate.status, 0, validate.stderr + validate.stdout);
  assert.equal(JSON.parse(validate.stdout).ok, true);

  const generate = run('scripts/registry/generate-catalog.mjs', ['--registry-dir', target, '--check'], { cwd: target });
  assert.equal(generate.status, 0, generate.stderr + generate.stdout);

  const assets = run('scripts/registry/validate-assets.mjs', ['--registry-dir', target, '--json'], { cwd: target });
  assert.equal(assets.status, 0, assets.stderr + assets.stdout);
  assert.equal(JSON.parse(assets.stdout).ok, true);

  const base = path.join(directory, 'trusted base');
  await fs.cp(target, base, { recursive: true });
  const history = run('scripts/registry/validate-catalog.mjs', ['--registry-dir', target, '--base-dir', base, '--json'], { cwd: target });
  assert.equal(history.status, 0, history.stderr + history.stdout);
  assert.equal(JSON.parse(history.stdout).history.ok, true);

  const packed = run('scripts/registry/pack-skill.mjs', ['--out', path.join(directory, 'skill out')]);
  assert.equal(packed.status, 0, packed.stderr + packed.stdout);
  const version = await skillVersion();
  const escapedVersion = version.replace(/\./g, '\\.');
  assert.match(packed.stdout, new RegExp(`dsh-game-developer-${escapedVersion}\\.tar\\.gz`));
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'skill out', 'manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'dsh-game-developer');

  const help = run('scripts/registry/prepare.mjs', ['--help']);
  assert.equal(help.status, 0, help.stderr + help.stdout);
  assert.match(help.stderr, /--submission/);
});

test('publishing tool refuses to run without the required arguments', () => {
  const missing = spawnSync(NODE, [path.join(ROOT, 'scripts/registry/prepare.mjs')], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
  const unknown = spawnSync(NODE, [path.join(ROOT, 'scripts/registry/prepare.mjs'), '--wat'], { encoding: 'utf8' });
  assert.equal(unknown.status, 2);
});
