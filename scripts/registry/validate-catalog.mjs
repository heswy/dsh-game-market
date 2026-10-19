#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
/**
 * Read-only validation for a content repository. Intended for CI:
 * `node scripts/registry/validate-catalog.mjs --registry-dir .`
 */
import { buildRegistry } from './lib/catalog.mjs';

export async function main(argv = process.argv.slice(2)) {
  let registryDir = null;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--registry-dir') { registryDir = argv[index + 1] || null; index += 1; }
    else if (argv[index] === '--json') json = true;
    else {
      console.error(`[registry] unknown argument: ${argv[index]}`);
      return 2;
    }
  }
  if (!registryDir) {
    console.error('usage: node scripts/registry/validate-catalog.mjs --registry-dir <dir> [--json]');
    return 2;
  }
  const result = await buildRegistry(registryDir, { check: true });
  if (json) console.log(JSON.stringify({ ok: result.ok, count: result.index ? result.index.games.length : 0, errors: result.errors }, null, 2));
  else if (result.ok) console.log(`[registry] OK games=${result.index.games.length}`);
  else {
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
