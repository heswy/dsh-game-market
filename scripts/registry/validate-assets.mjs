#!/usr/bin/env node
/**
 * Read-only CI check: every published catalog asset is still byte-identical to
 * its approved package/media hashes. This downloads from the official HTTPS
 * URLs but never executes author code or mutates a repository.
 *
 *   node scripts/registry/validate-assets.mjs --registry-dir .
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { downloadVerified, validateMediaBytes, validatePackageBytes } from './lib/assets.mjs';

async function listCatalog(root) {
  const directory = path.join(root, 'catalog');
  let names;
  try { names = await fs.readdir(directory); } catch (_error) { return []; }
  return names.filter((name) => name.endsWith('.json') && !name.startsWith('.')).sort();
}

export async function validateAssets(registryDir, http = {}) {
  const errors = [];
  const entries = [];
  for (const file of await listCatalog(registryDir)) {
    const id = file.slice(0, -'.json'.length);
    let entry;
    try {
      entry = JSON.parse(await fs.readFile(path.join(registryDir, 'catalog', file), 'utf8'));
    } catch (error) {
      errors.push({ code: 'E_CATALOG_JSON', field: `catalog/${file}`, message: error.message });
      continue;
    }
    try {
      const pkg = await downloadVerified(entry.release.packageUrl, {
        sha256: entry.release.packageSha256,
        size: entry.release.packageSize,
      }, http, `${id} package`);
      validatePackageBytes({ bytes: pkg.bytes, id: entry.gameId, version: entry.game.version });
      await downloadVerified(entry.release.cover.url, entry.release.cover, http, `${id} cover`);
      for (let index = 0; index < entry.release.screenshots.length; index += 1) {
        const shot = entry.release.screenshots[index];
        const downloaded = await downloadVerified(shot.url, shot, http, `${id} screenshot ${index + 1}`);
        validateMediaBytes({ bytes: downloaded.bytes, media: shot, label: `${id} screenshot ${index + 1}` });
      }
      entries.push({ gameId: id, version: entry.game.version, ok: true });
    } catch (error) {
      errors.push({
        code: error.code || 'E_PUBLISH_ASSET_INVALID',
        field: `catalog/${file}`,
        message: error.message,
        details: error.details || null,
      });
    }
  }
  return { ok: errors.length === 0, count: entries.length, entries, errors };
}

export async function main(argv = process.argv.slice(2)) {
  let registryDir = null;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--registry-dir') { registryDir = argv[index + 1] || null; index += 1; }
    else if (argv[index] === '--json') json = true;
    else { console.error(`[assets] unknown argument: ${argv[index]}`); return 2; }
  }
  if (!registryDir) {
    console.error('usage: node scripts/registry/validate-assets.mjs --registry-dir <dir> [--json]');
    return 2;
  }
  const result = await validateAssets(registryDir);
  if (json) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) console.log(`[assets] OK entries=${result.count}`);
  else {
    console.error('[assets] FAILED');
    for (const error of result.errors) console.error(`  - ${error.code} ${error.field || ''}: ${error.message}`);
  }
  return result.ok ? 0 : 1;
}

const __isMain = typeof process.argv[1] === 'string' && pathToFileURL(process.argv[1]).href === import.meta.url;
if (__isMain) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`[assets] ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  });
}
