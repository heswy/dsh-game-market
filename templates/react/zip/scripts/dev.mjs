#!/usr/bin/env node
/** Simulator for the resource package: wrapper + resource origin, like the Host. */
import { projectDir, runCli } from './cli.mjs';

process.exit(runCli(['dev', projectDir, '--format', 'asset-zip-v2', '--no-build', ...process.argv.slice(2)]));
