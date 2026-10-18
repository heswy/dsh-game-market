#!/usr/bin/env node
/**
 * `dsh-game` CLI entry (PRD §8.2.8).
 *
 * MVP invocation from the repository checkout:
 *   node scripts/cli/dsh-game.mjs <command> [options]
 *
 * A `bin` entry in the root package.json (for `npx dsh-game`) is intentionally
 * not added here: the root package is owned by the Lead. See the M1b report.
 */

import { runCli } from './lib/cli.mjs';

process.exitCode = await runCli(process.argv.slice(2));
