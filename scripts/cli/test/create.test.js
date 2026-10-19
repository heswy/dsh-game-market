import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createProject } from '../lib/create.mjs';
import { buildProject, loadProjectManifest } from '../lib/project.mjs';
import { validateFile } from '../lib/validator.mjs';
import { CLI, readJson, runCli, runCreate, tempDir } from '../test-support/helpers.mjs';

test('create-dsh-game generates a complete vanilla project', () => {
  const parent = tempDir();
  const result = createProject({
    name: 'orbit-catch',
    template: 'vanilla',
    parentDir: parent,
    author: 'Test Author',
    description: 'A generated test game.',
  });
  assert.equal(result.id, 'orbit-catch');
  assert.equal(result.targetDir, path.join(fs.realpathSync(parent), 'orbit-catch'));

  for (const file of [
    'manifest.json',
    'index.html',
    'src/main.js',
    'src/render.js',
    'src/storage.js',
    'src/i18n.js',
    'src/styles.css',
    'scripts/build.mjs',
    'scripts/dev.mjs',
    'scripts/validate.mjs',
    'scripts/pack.mjs',
    'scripts/publish.mjs',
    'sdk/index.d.ts',
    'sdk/VERSION',
    'README.md',
    'package.json',
    'dsh-game.config.json',
  ]) {
    assert.equal(fs.existsSync(path.join(result.targetDir, file)), true, `missing ${file}`);
  }

  const manifest = readJson(path.join(result.targetDir, 'manifest.json'));
  assert.equal(manifest.id, 'orbit-catch');
  assert.equal(manifest.name, 'Orbit Catch');
  assert.equal(manifest.author.name, 'Test Author');
  assert.equal(manifest.description, 'A generated test game.');
  assert.equal(manifest.sdkVersion, '^1.0.0');

  const config = readJson(path.join(result.targetDir, 'dsh-game.config.json'));
  assert.equal(fs.existsSync(path.resolve(result.targetDir, config.cli)), true);
  assert.equal(path.resolve(result.targetDir, config.cli), CLI);

  const readme = fs.readFileSync(path.join(result.targetDir, 'README.md'), 'utf8');
  assert.ok(readme.includes('Orbit Catch'));
  assert.ok(readme.includes('orbit-catch-1.0.0.html'));
  assert.equal(readme.includes('__GAME_'), false, 'tokens were substituted');

  const html = fs.readFileSync(path.join(result.targetDir, 'index.html'), 'utf8');
  assert.ok(html.includes('<title>Orbit Catch</title>'));
  const i18n = fs.readFileSync(path.join(result.targetDir, 'src/i18n.js'), 'utf8');
  assert.ok(i18n.includes('"Orbit Catch"'));
});

test('a generated vanilla project builds and validates out of the box', async () => {
  const parent = tempDir();
  const result = createProject({ name: 'buildable-game', template: 'vanilla', parentDir: parent });
  const built = await buildProject(result.targetDir);
  assert.ok(built.html.includes('id="dsh-game-manifest"'));
  assert.ok(built.html.includes('var DSH_GAME_SDK'));
  assert.ok(built.html.includes('<title>Buildable Game</title>'));
  assert.equal(validateFile(built.outFile).ok, true);

  const loaded = loadProjectManifest(result.targetDir);
  assert.equal(loaded.manifest.id, 'buildable-game');
});

test('the create-dsh-game CLI scaffolds into --dir and supports --dry-run', () => {
  const parent = tempDir();
  const dry = runCreate(['dry-game', '--template', 'vanilla', '--dir', parent, '--dry-run', '--json']);
  assert.equal(dry.status, 0, dry.stderr);
  const dryJson = JSON.parse(dry.stdout);
  assert.equal(dryJson.dryRun, true);
  assert.equal(fs.existsSync(path.join(parent, 'dry-game')), false);

  const created = runCreate(['cli-game', '--template', 'vanilla', '--dir', parent, '--json']);
  assert.equal(created.status, 0, created.stderr);
  const json = JSON.parse(created.stdout);
  assert.equal(json.ok, true);
  assert.equal(fs.existsSync(path.join(parent, 'cli-game/src/main.js')), true);
});

test('create-dsh-game supports the react template with a generated vendor SDK', () => {
  const parent = tempDir();
  const result = createProject({ name: 'react-game', template: 'react', parentDir: parent });
  for (const file of [
    'index.html',
    'vite.config.ts',
    'tsconfig.json',
    'src/App.tsx',
    'src/sdk.ts',
    'src/game/loop.ts',
    'src/game/storage.ts',
    'src/game/render.ts',
    'src/game/i18n.ts',
    'vendor/dsh-game-sdk.js',
    'vendor/dsh-game-sdk.d.ts',
    'sdk/index.d.ts',
    'scripts/dev.mjs',
  ]) {
    assert.equal(fs.existsSync(path.join(result.targetDir, file)), true, `missing ${file}`);
  }
  const pkg = readJson(path.join(result.targetDir, 'package.json'));
  assert.equal(pkg.name, 'react-game');
  assert.ok(pkg.dependencies.react);
  assert.ok(pkg.devDependencies.vite);
  assert.equal(pkg.scripts.build, 'tsc --noEmit && vite build');
  const vendor = fs.readFileSync(path.join(result.targetDir, 'vendor/dsh-game-sdk.js'), 'utf8');
  assert.ok(vendor.includes('createGameSDK'));
  assert.ok(vendor.includes('isGameError'));
});

test('create rejects invalid/reserved ids and non-empty targets', () => {
  const parent = tempDir();
  assert.throws(() => createProject({ name: 'Bad Id', parentDir: parent }), /Invalid game id/);
  assert.throws(() => createProject({ name: 'conversation', parentDir: parent }), /reserved/);
  assert.throws(() => createProject({ name: 'a', parentDir: parent }), /Invalid game id/);
  assert.throws(() => createProject({ name: 'games/foo', parentDir: parent }), /bare game id/);
  assert.throws(() => createProject({ name: 'unknown', template: 'svelte', parentDir: parent }), /Unknown template/);

  createProject({ name: 'occupied', parentDir: parent });
  assert.throws(() => createProject({ name: 'occupied', parentDir: parent }), /not empty/);
  assert.doesNotThrow(() => createProject({ name: 'occupied', parentDir: parent, force: true }));
});

test('dsh-game init is an alias for create', () => {
  const parent = tempDir();
  const result = runCli(['init', 'init-game', '--template', 'vanilla', '--dir', parent, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(json.id, 'init-game');
  assert.equal(fs.existsSync(path.join(parent, 'init-game/src/main.js')), true);
});

test('create escapes quotes/markup in metadata and still builds', async () => {
  const parent = tempDir();
  const description = 'He said "hi" & <tag>\nsecond line';
  const result = createProject({
    name: 'quote-game',
    template: 'vanilla',
    parentDir: parent,
    displayName: 'Quote "Game"',
    description,
    author: 'A & B <studio>',
  });
  const manifest = readJson(path.join(result.targetDir, 'manifest.json'));
  assert.equal(manifest.description, description);
  assert.equal(manifest.name, 'Quote "Game"');
  assert.equal(manifest.author.name, 'A & B <studio>');
  const html = fs.readFileSync(path.join(result.targetDir, 'index.html'), 'utf8');
  assert.ok(html.includes('<title>Quote &quot;Game&quot;</title>'));
  const i18n = fs.readFileSync(path.join(result.targetDir, 'src/i18n.js'), 'utf8');
  assert.ok(i18n.includes(JSON.stringify('Quote "Game"')));
  const built = await buildProject(result.targetDir);
  assert.equal(validateFile(built.outFile).ok, true);
});
