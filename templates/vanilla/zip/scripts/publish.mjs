#!/usr/bin/env node
/** Emit the registry entry/upload plan for a packed .dshgame.zip. */
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, runCli } from './cli.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8'));
const packStatus = runCli(['pack', projectDir, '--format', 'asset-zip-v2']);
if (packStatus !== 0) process.exit(packStatus);
const packed = path.join(projectDir, 'dist', `${manifest.id}-${manifest.version}.dshgame.zip`);
process.exit(
  runCli(['publish', packed, '--format', 'asset-zip-v2', ...process.argv.slice(2)])
);
