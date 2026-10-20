#!/usr/bin/env node
/** Pack the built tree into a deterministic <id>-<version>.dshgame.zip. */
import { projectDir, runCli } from './cli.mjs';

process.exit(runCli(['pack', projectDir, '--format', 'asset-zip-v2', ...process.argv.slice(2)]));
