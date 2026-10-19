#!/usr/bin/env node
/** Run all V1 builds in order. Zero dependencies; no npm install required. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function run(label, scriptPath) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`\n[build] ${label} failed (exit ${result.status})`);
    process.exit(result.status || 1);
  }
}

// Bundle half + builtin snake (builtin keeps its V0 directory layout, V1 manifest).
for (const step of ['build-client.mjs', 'build-snake.mjs']) run(step, path.join(root, 'scripts', step));

// Every other game package owns a deterministic single-file build script.
const gamesDir = path.join(root, 'games');
for (const entry of fs.readdirSync(gamesDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'snake') continue;
  const scriptPath = path.join(gamesDir, entry.name, 'build.mjs');
  if (!fs.existsSync(scriptPath)) continue;
  run(`games/${entry.name}/build.mjs`, scriptPath);
}

// Bundled default Registry (CR-01): static index + package files for the
// three installable first-party games, derived deterministically from dist.
run('build-registry.mjs', path.join(root, 'scripts', 'build-registry.mjs'));

console.log('\n[build] all artifacts built');
