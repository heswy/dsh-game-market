#!/usr/bin/env node
/**
 * `create-dsh-game` entry (PRD §4.4).
 *
 *   node scripts/cli/create-dsh-game.mjs my-game --template vanilla
 *
 * Shares the implementation with `dsh-game create`.
 */

import { runCli } from './lib/cli.mjs';

process.exitCode = await runCli(['create', ...process.argv.slice(2)]);
