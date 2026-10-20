#!/usr/bin/env node
/** Build the asset-zip-v2 package tree (dist/ + dsh-package.json). */
import { projectDir, runCli } from './cli.mjs';

process.exit(runCli(['build', projectDir, '--format', 'asset-zip-v2', ...process.argv.slice(2)]));
