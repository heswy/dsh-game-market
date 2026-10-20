#!/usr/bin/env node
/** Emit registry-entry/upload-plan for the packed resource package (offline). */
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, runCli } from './cli.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8'));
const packed = path.join(projectDir, 'dist', `${manifest.id}-${manifest.version}.dshgame.zip`);
if (!fs.existsSync(packed)) {
  const status = runCli(['pack', projectDir, '--format', 'asset-zip-v2']);
  if (status !== 0) process.exit(status);
}
process.exit(runCli(['publish', packed, '--format', 'asset-zip-v2', ...process.argv.slice(2)]));
