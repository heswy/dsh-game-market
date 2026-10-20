#!/usr/bin/env node
/** CI entry: build, then validate the real ZIP produced by pack (not just dist/). */
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, runCli } from './cli.mjs';

const extra = process.argv.slice(2);
const buildStatus = runCli(['build', projectDir, '--format', 'asset-zip-v2', ...extra]);
if (buildStatus !== 0) process.exit(buildStatus);
let status = runCli(['validate', path.join(projectDir, 'dist'), '--format', 'asset-zip-v2', ...extra]);
if (status !== 0) process.exit(status);
const packStatus = runCli(['pack', projectDir, '--format', 'asset-zip-v2', ...extra]);
if (packStatus !== 0) process.exit(packStatus);
const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8'));
const packed = path.join(projectDir, 'dist', `${manifest.id}-${manifest.version}.dshgame.zip`);
if (!fs.existsSync(packed)) {
  console.error(`[dsh-game] expected packed archive at ${packed}`);
  process.exit(1);
}
status = runCli(['validate', packed, '--format', 'asset-zip-v2', ...extra]);
process.exit(status);
