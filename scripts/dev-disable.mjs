#!/usr/bin/env node
/**
 * Remove the managed dsh-game-market dev row from a DSH profile patch file.
 *
 * Usage:
 *   node scripts/dev-disable.mjs [--profile=desktop] [--dry-run] [--yes]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const START = '# >>> dsh-game-market dev (managed) >>>';
const END = '# <<< dsh-game-market dev (managed) <<<';

const args = parseArgs(process.argv.slice(2));
const profile = args.profile || process.env.DSH_PROFILE || 'desktop';
const dshHome = process.env.DSH_HOME && process.env.DSH_HOME.trim()
  ? process.env.DSH_HOME.trim()
  : path.join(os.homedir(), '.dsh');
const profileDir = args.profileDir
  || (process.env.DSH_PROFILE_DIR && process.env.DSH_PROFILE_DIR.trim())
  || path.join(dshHome, 'profiles', profile);
const patchPath = path.join(profileDir, 'cordis.patch.yml');

if (!fs.existsSync(patchPath)) {
  console.log(`[dev:disable] patch file does not exist: ${patchPath}`);
  process.exit(0);
}

const current = fs.readFileSync(patchPath, 'utf8');
const startIndex = current.indexOf(START);
const endIndex = current.indexOf(END);
if (startIndex === -1 && endIndex === -1) {
  console.log('[dev:disable] no managed block found; nothing to do.');
  process.exit(0);
}
if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
  console.error('[dev:disable] managed markers are inconsistent; refusing to edit. Fix manually.');
  process.exit(1);
}

const before = current.slice(0, startIndex).replace(/\s+$/, '');
const after = current.slice(endIndex + END.length).replace(/^\s+/, '');
const updated = [before, after].filter(Boolean).join('\n\n') + (before || after ? '\n' : '');

if (args.dryRun) {
  console.log('[dev:disable] --dry-run; would write:\n');
  console.log(updated);
  process.exit(0);
}
if (!args.yes) {
  console.log('[dev:disable] plan (no changes applied):\n');
  console.log(updated);
  console.log('\n[dev:disable] rerun with --yes to apply.');
  process.exit(0);
}

const backup = `${patchPath}.bak-dsh-game-market-${timestamp()}`;
fs.copyFileSync(patchPath, backup);
fs.writeFileSync(patchPath, updated, 'utf8');
console.log(`[dev:disable] removed managed block. Backup: ${backup}`);
console.log('[dev:disable] restart DSH to unload the Host half.');

function parseArgs(argv) {
  const out = { dryRun: false, yes: false, profile: null, profileDir: null };
  for (const arg of argv) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--yes' || arg === '-y') out.yes = true;
    else if (arg.startsWith('--profile=')) out.profile = arg.slice('--profile='.length);
    else if (arg.startsWith('--profile-dir=')) out.profileDir = arg.slice('--profile-dir='.length);
    else if (arg === '--profile-dir') { out.profileDir = argv[i + 1] || null; i += 1; }
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/dev-disable.mjs [--profile=desktop] [--profile-dir=<path>] [--dry-run] [--yes]');
      process.exit(0);
    } else {
      console.error(`[dev:disable] unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
