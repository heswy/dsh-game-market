import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildProject } from '../lib/project.mjs';
import { ValidationFailure } from '../lib/cli-error.mjs';
import { REPO_ROOT, createFixture, fixtureFiles, runCli, sha256File, tempDir, writeFiles } from '../test-support/helpers.mjs';

test('build produces a deterministic, self-contained single-file package', async () => {
  const dir = createFixture();
  const first = await buildProject(dir, { write: false });
  const html = first.html;

  assert.equal((html.match(/id="dsh-game-manifest"/g) || []).length, 1);
  assert.ok(html.includes('var DSH_GAME_SDK'));
  assert.ok(html.includes('createScore'), 'the game module is bundled');
  assert.ok(html.includes('data:image/png;base64,'));
  assert.equal(html.includes('<link rel="stylesheet"'), false);
  assert.equal(/<script[^>]+src=/.test(html), false);
  assert.equal(/<img[^>]+src="(?!data:)/.test(html), false);
  assert.equal(html.includes('sourceMappingURL'), false);
  assert.equal(html.includes(dir), false, 'no machine paths leak into the package');
  assert.ok(html.endsWith('\n'));
});

test('two builds of the same input are byte-identical', async () => {
  const dir = createFixture();
  const outA = path.join(tempDir(), 'a.html');
  const outB = path.join(tempDir(), 'b.html');
  const first = await buildProject(dir, { out: outA });
  const second = await buildProject(dir, { out: outB });
  assert.equal(first.sha256, second.sha256);
  assert.deepEqual(fs.readFileSync(outA), fs.readFileSync(outB));
  assert.equal(sha256File(outA), first.sha256);
});

test('build output does not depend on the project directory path', async () => {
  const first = await buildProject(createFixture(), { write: false });
  const second = await buildProject(createFixture(), { write: false });
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.bytes, second.bytes);
});

test('the CLI build writes dist/index.html and reports the same sha256 twice', () => {
  const dir = createFixture();
  const one = runCli(['build', dir, '--json']);
  assert.equal(one.status, 0, one.stderr);
  const first = JSON.parse(one.stdout);
  assert.equal(first.ok, true);
  assert.ok(first.sha256.match(/^[a-f0-9]{64}$/));
  assert.equal(fs.existsSync(path.join(dir, 'dist/index.html')), true);

  const two = runCli(['build', dir, '--json']);
  assert.equal(two.status, 0, two.stderr);
  const second = JSON.parse(two.stdout);
  assert.equal(second.sha256, first.sha256);
});

test('build rejects an invalid manifest with exit 1 and a validation report', () => {
  const dir = createFixture({ manifest: { capabilities: ['network'] } });
  const result = runCli(['build', dir, '--json']);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((item) => item.code === 'E_PKG_CAPABILITY_UNSUPPORTED'));
  assert.equal(fs.existsSync(path.join(dir, 'dist/index.html')), false);
});

test('build rejects a package that is not self-contained', async () => {
  const files = fixtureFiles();
  files['index.html'] = files['index.html'].replace('</body>', '<script src="https://cdn.example.com/x.js"></script></body>');
  const dir = tempDir();
  writeFiles(dir, files);
  await assert.rejects(
    () => buildProject(dir, { write: false }),
    (error) => {
      assert.ok(error instanceof ValidationFailure);
      assert.ok(error.report.errors.some((item) => item.code === 'E_PKG_ENTRY_NOT_SELF_CONTAINED'));
      return true;
    }
  );
});

test('build supports --no-sdk and keeps the game script inline', async () => {
  const dir = createFixture();
  const result = await buildProject(dir, { write: false, sdk: false });
  assert.equal(result.html.includes('var DSH_GAME_SDK'), false);
  assert.ok(result.html.includes('createScore'));
});

test('build rejects srcset instead of silently leaving an external URL', async () => {
  const files = fixtureFiles();
  files['index.html'] = files['index.html'].replace(
    '<img id="pixel" src="assets/pixel.png" alt="" />',
    '<img id="pixel" src="assets/pixel.png" srcset="https://example.com/2x.png 2x" alt="" />'
  );
  const dir = tempDir();
  writeFiles(dir, files);
  await assert.rejects(
    () => buildProject(dir, { write: false }),
    (error) => /srcset/.test(error.message)
  );
});

test('the repository vanilla template itself builds and validates', async () => {
  const templateDir = path.join(REPO_ROOT, 'templates/vanilla');
  const result = await buildProject(templateDir, { write: false });
  assert.equal(result.manifest.id, 'vanilla-demo');
  assert.ok(result.html.includes('id="dsh-game-manifest"'));
  assert.ok(result.html.includes('var DSH_GAME_SDK'));
  const { validateHtmlText } = await import('../lib/validator.mjs');
  const report = validateHtmlText(result.html, { source: 'templates/vanilla' });
  assert.equal(report.ok, true, JSON.stringify(report.errors));
});
