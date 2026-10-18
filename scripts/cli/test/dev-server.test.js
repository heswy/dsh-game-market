import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createProject } from '../lib/create.mjs';
import { startDevServer } from '../dev-server.mjs';
import { tempDir } from '../test-support/helpers.mjs';

async function generatedProject(name = 'sim-game') {
  const parent = tempDir();
  return createProject({ name, template: 'vanilla', parentDir: parent }).targetDir;
}

test('the simulator serves the harness, the built package and health', async () => {
  const projectDir = await generatedProject();
  const simulator = await startDevServer({ projectDir, port: 0 });
  try {
    assert.match(simulator.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

    const health = await fetch(new URL('/health', simulator.url));
    assert.equal(health.status, 200);
    const healthJson = await health.json();
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.simulator, true);
    assert.equal(healthJson.game.id, 'sim-game');

    const home = await fetch(simulator.url);
    assert.equal(home.status, 200);
    const harness = await home.text();
    assert.match(harness, /Game Runtime Simulator/);
    assert.match(harness, /sandbox="allow-scripts"/);
    assert.match(harness, /supportedSdkRange/);
    assert.match(harness, /data-command="agent-waiting"/);
    assert.match(harness, /data-command="before-save"/);
    assert.match(harness, /data-command="clear-save"/);
    assert.match(harness, /data-command="resume"/);
    assert.match(harness, /\[simulator\]/);

    const game = await fetch(new URL('/game?instance=' + 'a'.repeat(32) + '&nonce=' + 'b'.repeat(32), simulator.url));
    assert.equal(game.status, 200);
    const html = await game.text();
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /id="dsh-game-manifest"/);
    assert.match(html, /var DSH_GAME_SDK/);
    assert.match(html, /DSH_GAME_SDK\.createGameSDK/);

    const missing = await fetch(new URL('/manifest.json', simulator.url));
    assert.equal(missing.status, 404);
  } finally {
    await simulator.close();
  }
});

test('the simulator rebuilds on reload so edits are visible', async () => {
  const projectDir = await generatedProject('reload-game');
  const simulator = await startDevServer({ projectDir, port: 0 });
  try {
    const first = await (await fetch(new URL('/game', simulator.url))).text();
    assert.equal(first.includes('reload marker 12345'), false);

    const mainPath = path.join(projectDir, 'src/main.js');
    fs.appendFileSync(mainPath, '\n// reload marker 12345\n', 'utf8');
    const second = await (await fetch(new URL('/game', simulator.url))).text();
    assert.equal(second.includes('reload marker 12345'), true);
  } finally {
    await simulator.close();
  }
});

test('build errors are shown in the iframe instead of a white screen', async () => {
  const projectDir = await generatedProject('broken-game');
  const simulator = await startDevServer({ projectDir, port: 0 });
  try {
    const indexPath = path.join(projectDir, 'index.html');
    fs.writeFileSync(
      indexPath,
      fs.readFileSync(indexPath, 'utf8').replace('</body>', '<script src="https://cdn.example.com/x.js"></script></body>'),
      'utf8'
    );
    const response = await fetch(new URL('/game', simulator.url));
    assert.equal(response.status, 500);
    const page = await response.text();
    assert.match(page, /Game build failed/);
    assert.match(page, /E_PKG_ENTRY_NOT_SELF_CONTAINED/);
  } finally {
    await simulator.close();
  }
});

test('--no-build serves dist/index.html and reports a missing build', async () => {
  const projectDir = await generatedProject('no-build-game');
  const missingSimulator = await startDevServer({ projectDir, port: 0, build: false });
  try {
    const response = await fetch(new URL('/game', missingSimulator.url));
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.ok, false);
  } finally {
    await missingSimulator.close();
  }
});
