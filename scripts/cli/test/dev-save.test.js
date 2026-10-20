/**
 * Dev-only Simulator save import/export (P1 upgrade-path testing) and the
 * format-aware `dev --help` (PD-4). These endpoints/flags are simulator-only;
 * nothing here is part of the package format or the production Host.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { startDevServer } from '../dev-server.mjs';
import { createFixture, runCli, tempDir } from '../test-support/helpers.mjs';

const SAVE = { 'game:save': { schemaVersion: 1, best: 12, board: [1, 2, 3] } };

test('dev --help documents dev-only options, endpoints and two-iframe zip loading (PD-4)', () => {
  const result = runCli(['dev', '--help']);
  assert.equal(result.status, 0);
  for (const needle of [
    '--port',
    '--host',
    '--no-build',
    '--seed-save',
    '--save-out',
    '/wrapper',
    '/res/<instance>/<token>/<path>',
    '/dev/save/export',
    '/dev/save/import',
    '/health',
    'Ctrl+C',
    'TWO iframes',
    'html-v1 only',
  ]) {
    assert.ok(result.stdout.includes(needle), `dev --help is missing ${needle}\n${result.stdout}`);
  }
});

test('dev save export/import + --seed-save/--save-out round-trip (upgrade path)', async () => {
  const fixtureDir = createFixture();
  const seedFile = path.join(tempDir(), 'seed.save.json');
  const saveOut = path.join(tempDir(), 'out.save.json');
  fs.writeFileSync(seedFile, `${JSON.stringify({ game: { id: 'fixture', version: '1.0.0' }, save: SAVE }, null, 2)}\n`);

  const sim = await startDevServer({ projectDir: fixtureDir, port: 0, build: true, seedSave: seedFile, saveOut });
  try {
    assert.equal(sim.saveApi, true);
    assert.equal(sim.saveOut, saveOut);
    const home = await (await fetch(sim.url)).text();
    assert.match(home, /"saveApi":true/);
    assert.match(home, /"initialSave":\{/);
    assert.ok(home.includes('"best":12'));

    const exported = await (await fetch(new URL('/dev/save/export', sim.url))).json();
    assert.equal(exported.ok, true);
    assert.deepEqual(exported.save, SAVE);
    assert.equal(typeof exported.game.id, 'string');
    assert.equal(typeof exported.game.version, 'string');

    // The game saving via the fake Host persists through the dev-only bridge.
    const posted = await fetch(new URL('/dev/save', sim.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ save: { 'game:save': { schemaVersion: 1, best: 99 } } }),
    });
    assert.equal(posted.status, 200);
    assert.equal(fs.existsSync(saveOut), true);
    assert.equal(JSON.parse(fs.readFileSync(saveOut, 'utf8')).save['game:save'].best, 99);

    const imported = await fetch(new URL('/dev/save/import', sim.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ save: { 'game:save': { schemaVersion: 1, best: 7 } } }),
    });
    assert.equal(imported.status, 200);
    const afterImport = await (await fetch(new URL('/dev/save/export', sim.url))).json();
    assert.equal(afterImport.save['game:save'].best, 7);
    assert.equal(JSON.parse(fs.readFileSync(saveOut, 'utf8')).save['game:save'].best, 7);

    // Non-dev POSTs stay rejected, and invalid bodies are actionable.
    assert.equal((await fetch(new URL('/health', sim.url), { method: 'POST' })).status, 405);
    const bad = await fetch(new URL('/dev/save/import', sim.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json' });
    assert.equal(bad.status, 400);
  } finally {
    await sim.close();
  }

  // Second run (e.g. new version) starts from the previous save.
  const second = await startDevServer({ projectDir: fixtureDir, port: 0, build: true, seedSave: saveOut });
  try {
    const home = await (await fetch(second.url)).text();
    assert.ok(home.includes('"best":7'), 'the previous run\'s save must seed the next run');
    const exported = await (await fetch(new URL('/dev/save/export', second.url))).json();
    assert.equal(exported.save['game:save'].best, 7);
  } finally {
    await second.close();
  }
});

test('dev without --seed-save starts empty and export reports no save', async () => {
  const fixtureDir = createFixture();
  const sim = await startDevServer({ projectDir: fixtureDir, port: 0, build: true });
  try {
    const home = await (await fetch(sim.url)).text();
    assert.match(home, /"initialSave":null/);
    const exported = await fetch(new URL('/dev/save/export', sim.url));
    assert.equal(exported.status, 404);
    const payload = await exported.json();
    assert.deepEqual(payload, { ok: false, error: 'no_save', hint: 'The game has not saved yet; trigger before-save or import a save.' });
  } finally {
    await sim.close();
  }
});
