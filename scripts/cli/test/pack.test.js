import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildProject } from '../lib/project.mjs';
import { packProject } from '../lib/pack.mjs';
import { createFixture, runCli, sha256File, tempDir } from '../test-support/helpers.mjs';

test('pack writes <id>-<version>.html and a shasum-compatible .sha256 sidecar', async () => {
  const dir = createFixture();
  await buildProject(dir);
  const result = packProject(dir);
  assert.equal(result.fileName, 'demo-game-1.0.0.html');
  assert.equal(path.basename(result.outFile), 'demo-game-1.0.0.html');
  assert.equal(fs.existsSync(result.outFile), true);
  assert.equal(sha256File(result.outFile), result.sha256);

  const sidecar = fs.readFileSync(result.digestFile, 'utf8');
  assert.match(sidecar, /^[a-f0-9]{64}  demo-game-1\.0\.0\.html\n$/);
  assert.equal(fs.readFileSync(result.outFile).length, result.bytes);
  assert.equal(fs.readFileSync(result.outFile).toString('utf8'), fs.readFileSync(path.join(dir, 'dist/index.html'), 'utf8'));
});

test('the CLI pack command reports the packed paths as JSON', () => {
  const dir = createFixture();
  assert.equal(runCli(['build', dir]).status, 0);
  const packed = runCli(['pack', dir, '--json']);
  assert.equal(packed.status, 0, packed.stderr);
  const json = JSON.parse(packed.stdout);
  assert.equal(json.id, 'demo-game');
  assert.equal(json.version, '1.0.0');
  assert.equal(path.basename(json.file), 'demo-game-1.0.0.html');
  assert.equal(path.basename(json.digestFile), 'demo-game-1.0.0.html.sha256');
  assert.equal(json.sha256, sha256File(json.file));
});

test('pack refuses to run before build', () => {
  const dir = createFixture();
  const result = runCli(['pack', dir]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /No built package/i);
});

test('pack can target a different output directory', async () => {
  const dir = createFixture();
  await buildProject(dir);
  const outDir = tempDir();
  const result = packProject(dir, { outDir });
  assert.equal(path.dirname(result.outFile), outDir);
  assert.equal(fs.existsSync(path.join(outDir, 'demo-game-1.0.0.html')), true);
});
