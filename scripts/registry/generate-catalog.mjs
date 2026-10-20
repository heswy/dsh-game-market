#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
/**
 * Generate/check `registry/games.json` from `catalog/*.json` in a content repo.
 *
 * Usage:
 *   node scripts/registry/generate-catalog.mjs --registry-dir <dir> [--check] [--json]
 *
 * Default writes both generated indexes (`registry/games.json` for v1 and
 * `registry/v2/games.json` for v2); `--check` is read-only and exits 1 if either
 * committed index is stale (content-repo CI uses this).
 */
import { buildRegistry } from './lib/catalog.mjs';

export function parseArgs(argv) {
  const options = { registryDir: null, check: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--registry-dir') {
      options.registryDir = argv[index + 1] || null;
      index += 1;
    } else if (arg === '--check') options.check = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`[registry] ${error.message}`);
    return 2;
  }
  if (options.help || !options.registryDir) {
    console.error('usage: node scripts/registry/generate-catalog.mjs --registry-dir <dir> [--check] [--json]');
    return 2;
  }
  const result = await buildRegistry(options.registryDir, { write: !options.check, check: options.check });
  if (options.json) {
    console.log(JSON.stringify({
      ok: result.ok,
      registryDir: options.registryDir,
      check: options.check,
      changed: result.changed,
      changedV2: result.changedV2,
      count: result.index ? result.index.games.length : 0,
      countV2: result.indexV2 ? result.indexV2.games.length : 0,
      generatedAt: result.generatedAt,
      errors: result.errors,
    }, null, 2));
  } else if (result.ok) {
    console.log(`[registry] ${options.check ? 'OK (up to date)' : 'generated'} v1=${result.index.games.length} v2=${result.indexV2.games.length} generatedAt=${result.generatedAt}`);
  } else {
    console.error('[registry] FAILED');
    for (const error of result.errors) console.error(`  - ${error.code} ${error.field || ''}: ${error.message}`);
  }
  return result.ok ? 0 : 1;
}

const __isMain = typeof process.argv[1] === 'string' && pathToFileURL(process.argv[1]).href === import.meta.url;
if (__isMain) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`[registry] ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  });
}
