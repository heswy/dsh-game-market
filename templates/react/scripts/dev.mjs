#!/usr/bin/env node
/** Start the Local Runtime Simulator against the Vite-built dist/index.html. */
import { projectDir, runCli } from './cli.mjs';

process.exit(runCli(['dev', projectDir, '--no-build', ...process.argv.slice(2)]));
