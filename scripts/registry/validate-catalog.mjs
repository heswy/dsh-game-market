#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
/**
 * Read-only validation for a content repository. Intended for CI:
 * `node scripts/registry/validate-catalog.mjs --registry-dir .`
 */
import { buildRegistry, validateAgainstBase } from './lib/catalog.mjs';

export async function main(argv = process.argv.slice(2)) {
  let registryDir = null;
  let baseDir = null;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--registry-dir') { registryDir = argv[index + 1] || null; index += 1; }
    else if (argv[index] === '--base-dir') { baseDir = argv[index + 1] || null; index += 1; }
    else if (argv[index] === '--json') json = true;
    else {
      console.error(`[registry] unknown argument: ${argv[index]}`);
      return 2;
    }
  }
  if (!registryDir) {
    console.error('usage: node scripts/registry/validate-catalog.mjs --registry-dir <dir> [--base-dir <trusted-main-checkout>] [--json]');
    return 2;
  }
  const result = await buildRegistry(registryDir, { check: true });
  let history = null;
  if (result.ok && baseDir) {
    history = await validateAgainstBase(registryDir, baseDir);
  }
  const ok = result.ok && (!history || history.ok);
  const errors = [...result.errors, ...(history ? history.errors : [])];
  if (json) console.log(JSON.stringify({
    ok,
    count: result.index ? result.index.games.length : 0,
    countV2: result.indexV2 ? result.indexV2.games.length : 0,
    history: history ? { ok: history.ok, baseCount: history.baseCount, candidateCount: history.candidateCount } : null,
    errors,
  }, null, 2));
  else if (ok) console.log(`[registry] OK v1=${result.index.games.length} v2=${result.indexV2.games.length}${history ? ' history=ok' : ''}`);
  else {
    console.error('[registry] FAILED');
    for (const error of errors) console.error(`  - ${error.code} ${error.field || ''}: ${error.message}`);
  }
  return ok ? 0 : 1;
}

const __isMain = typeof process.argv[1] === 'string' && pathToFileURL(process.argv[1]).href === import.meta.url;
if (__isMain) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`[registry] ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  });
}
