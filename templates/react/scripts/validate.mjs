#!/usr/bin/env node
/** Validate the Vite-built package, plus the packed file when present (after `npm run pack`). */
import fs from 'node:fs';
import path from 'node:path';
import { projectDir, runCli } from './cli.mjs';

const extra = process.argv.slice(2);
let status = runCli(['validate', path.join(projectDir, 'dist/index.html'), ...extra]);
if (status !== 0) process.exit(status);
const manifest = JSON.parse(fs.readFileSync(path.join(projectDir, 'manifest.json'), 'utf8'));
const packed = path.join(projectDir, 'dist', `${manifest.id}-${manifest.version}.html`);
if (fs.existsSync(packed)) {
  status = runCli(['validate', packed, ...extra]);
  if (status !== 0) process.exit(status);
}
process.exit(0);
