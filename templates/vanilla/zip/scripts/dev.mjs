#!/usr/bin/env node
/** Local Runtime Simulator for the asset-zip-v2 package (resource origin + wrapper). */
import { projectDir, runCli } from './cli.mjs';

process.exit(runCli(['dev', projectDir, '--format', 'asset-zip-v2', ...process.argv.slice(2)]));
