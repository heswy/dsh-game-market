#!/usr/bin/env node
/**
 * asset-zip-v2 React build:
 *   1. Vite build (relative base, external assets, no inline manifest/SDK);
 *   2. CLI finalize: run vite:build, write game.json + dsh-package.json;
 *   3. pack the deterministic ZIP and validate the FINAL ZIP with the Host
 *      archive reader (not just the dist directory).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, runCli } from './cli.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8'));
const extra = process.argv.slice(2);

const vite = spawnSync('npm', ['run', 'vite:build'], {
  cwd: projectDir,
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});
if (vite.status !== 0) {
  console.error(`[dsh-game] vite:build failed with exit ${vite.status === null ? 'null' : vite.status}`);
  process.exit(vite.status === null ? 1 : vite.status);
}

let status = runCli(['build', projectDir, '--format', 'asset-zip-v2', '--no-build-command', ...extra]);
if (status !== 0) process.exit(status);
status = runCli(['pack', projectDir, '--format', 'asset-zip-v2', ...extra]);
if (status !== 0) process.exit(status);
const packed = path.join(projectDir, 'dist', `${manifest.id}-${manifest.version}.dshgame.zip`);
if (!fs.existsSync(packed)) {
  console.error(`[dsh-game] expected packed archive at ${packed}`);
  process.exit(1);
}
status = runCli(['validate', packed, '--format', 'asset-zip-v2', ...extra]);
process.exit(status);
