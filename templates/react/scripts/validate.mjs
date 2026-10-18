#!/usr/bin/env node
/** Validate the Vite-built package (run `npm run build` first). */
import path from 'node:path';
import { projectDir, runCli } from './cli.mjs';

process.exit(runCli(['validate', path.join(projectDir, 'dist/index.html'), ...process.argv.slice(2)]));
