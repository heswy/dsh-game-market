/**
 * Tiny CLI helpers shared by `release:prepare` / `release:promote` /
 * `release:verify`: strict argument parsing (no positional args), deterministic
 * human output, and a JSON envelope for automation/tests.
 */
import { parseArgs } from 'node:util';

import { errorPayload, ReleaseError } from './errors.mjs';

/**
 * @param {string[]} argv process.argv.slice(2)
 * @param {object} options node:util parseArgs options
 * @returns {object} parsed values
 */
export function parseReleaseArgs(argv, options) {
  try {
    const parsed = parseArgs({ args: argv, options, strict: true, allowPositionals: false });
    return parsed.values;
  } catch (error) {
    throw new ReleaseError('E_RELEASE_USAGE', error.message, {
      guidance: 'run with --help for the exact flags',
    });
  }
}

/**
 * Run a CLI entry point: parse, execute, print failures consistently.
 *
 * @param {{program: string, help: string, main: (argv: {argv: string[], json: boolean}) => Promise<void>}} spec
 */
export async function runCli(spec) {
  const rawArgs = process.argv.slice(2);
  let json = rawArgs.includes('--json');
  try {
    await spec.main({ argv: rawArgs, json });
    json = rawArgs.includes('--json');
  } catch (error) {
    const payload = errorPayload(error);
    if (json) {
      process.stderr.write(`${JSON.stringify({ tool: spec.program, ...payload }, null, 2)}\n`);
    } else {
      process.stderr.write(`${spec.program}: ${payload.code}: ${payload.message}\n`);
      if (payload.guidance) process.stderr.write(`  fix: ${payload.guidance}\n`);
      if (error instanceof ReleaseError && error.details !== undefined && !isJsonOutput(rawArgs)) {
        const detail = JSON.stringify(error.details);
        if (detail.length <= 1200) process.stderr.write(`  details: ${detail}\n`);
      }
    }
    process.exitCode = 1;
  }
}

/** Print a structured success payload (JSON) or a human summary. */
export function emit({ program, result, json, human }) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  for (const line of human(result)) process.stdout.write(`${line}\n`);
}

export function formatBytes(bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return '?';
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function isJsonOutput(argv) {
  return argv.includes('--json');
}
