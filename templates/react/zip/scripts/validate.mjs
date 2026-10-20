#!/usr/bin/env node
/** Validate the built resource package and, when present, the final packed ZIP. */
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, runCli } from './cli.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8'));
const extra = process.argv.slice(2);
let status = runCli(['validate', path.join(projectDir, 'dist'), '--format', 'asset-zip-v2', ...extra]);
if (status !== 0) process.exit(status);
const packed = path.join(projectDir, 'dist', `${manifest.id}-${manifest.version}.dshgame.zip`);
if (fs.existsSync(packed)) {
  status = runCli(['validate', packed, '--format', 'asset-zip-v2', ...extra]);
}
process.exit(status);
