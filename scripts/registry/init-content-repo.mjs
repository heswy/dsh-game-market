#!/usr/bin/env node
/**
 * Initialise a content repository from `templates/registry`.
 *
 * Usage:
 *   node scripts/registry/init-content-repo.mjs --target <empty-dir> \
 *     [--platform-repo heswy/dsh-game-market] [--platform-commit <sha>] [--version 1.1.0]
 *
 * Refuses non-empty targets. After copying, fills the toolchain lock and
 * generates the initial (possibly empty) `registry/games.json`.
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildRegistry, initContentRepo } from './lib/catalog.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function gitOutput(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  } catch (_error) {
    return '';
  }
}

export async function main(argv = process.argv.slice(2)) {
  let target = null;
  let platformRepo = 'heswy/dsh-game-market';
  let platformCommit = '';
  let version = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--target') { target = argv[index + 1] || null; index += 1; }
    else if (arg === '--platform-repo') { platformRepo = argv[index + 1] || platformRepo; index += 1; }
    else if (arg === '--platform-commit') { platformCommit = argv[index + 1] || ''; index += 1; }
    else if (arg === '--version') { version = argv[index + 1] || ''; index += 1; }
    else { console.error(`[registry] unknown argument: ${arg}`); return 2; }
  }
  if (!target) {
    console.error('usage: node scripts/registry/init-content-repo.mjs --target <empty-dir> [--platform-repo owner/name] [--platform-commit sha] [--version x.y.z]');
    return 2;
  }
  if (!platformCommit) platformCommit = gitOutput(['rev-parse', 'HEAD'], ROOT);
  if (!version) {
    try {
      version = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8')).version;
    } catch (_error) { version = '0.0.0'; }
  }
  try {
    await initContentRepo({
      target,
      templateDir: path.join(ROOT, 'templates', 'registry'),
      platformRepo,
      platformCommit,
      platformVersion: version,
      generatedAt: new Date(0).toISOString(),
    });
  } catch (error) {
    console.error(`[registry] init failed: ${error.message}`);
    return 1;
  }
  const generated = await buildRegistry(path.resolve(target), { write: true });
  if (!generated.ok) {
    console.error('[registry] initial index generation failed');
    for (const error of generated.errors) console.error(`  - ${error.code} ${error.field || ''}: ${error.message}`);
    return 1;
  }
  console.log(`[registry] initialised ${path.resolve(target)} (platform ${platformRepo}@${platformCommit.slice(0, 7)}, version ${version})`);
  return 0;
}

const __isMain = typeof process.argv[1] === 'string' && pathToFileURL(process.argv[1]).href === import.meta.url;
if (__isMain) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`[registry] ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  });
}
