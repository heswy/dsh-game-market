#!/usr/bin/env node
/** Pack the Vite-built tree into a deterministic .dshgame.zip (after a build). */
import { projectDir, runCli } from './cli.mjs';

process.exit(runCli(['pack', projectDir, '--format', 'asset-zip-v2', ...process.argv.slice(2)]));
