#!/usr/bin/env node
/** Run all V0 builds in order. Zero dependencies; no npm install required. */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const steps = ['build-client.mjs', 'build-snake.mjs'];
for (const step of steps) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', step)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`\n[build] ${step} failed (exit ${result.status})`);
    process.exit(result.status || 1);
  }
}
console.log('\n[build] all artifacts built');
