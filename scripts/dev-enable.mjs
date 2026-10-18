#!/usr/bin/env node
/**
 * Enable the local dev row for dsh-game-market in a DSH profile patch file.
 *
 * This is a DELIBERATE user action: it edits ~/.dsh/profiles/<profile>/cordis.patch.yml.
 * - takes a timestamped backup first
 * - idempotent via managed markers
 * - only writes when --yes is passed (dry-run/preview otherwise)
 *
 * Usage:
 *   node scripts/dev-enable.mjs [--profile=desktop] [--dry-run] [--yes]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const hostEntry = path.join(root, 'index.js');

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

const block = [
  START,
  '# Managed by dsh-game-market/scripts/dev-enable.mjs — do not edit inside the markers.',
  '- insert:',
  '    - id: dsh-game-market',
  `      name: '${hostEntry.replaceAll("'", "''")}'`,
  '      config:',
  '        devMode: true',
  END,
].join('\n');

console.log(`[dev:enable] profile dir : ${profileDir}`);
console.log(`[dev:enable] patch file  : ${patchPath}`);
console.log(`[dev:enable] host entry  : ${hostEntry}`);
console.log(`[dev:enable] DSH_HOME    : ${dshHome}`);
console.log('');

if (!fs.existsSync(profileDir)) {
  console.error(`[dev:enable] profile directory does not exist: ${profileDir}`);
  console.error('[dev:enable] pass --profile=<name> or start DSH once to create the profile.');
  process.exit(1);
}

const current = fs.existsSync(patchPath) ? fs.readFileSync(patchPath, 'utf8') : '';
const updated = upsertBlock(current, block);

if (args.dryRun) {
  console.log('[dev:enable] --dry-run; would write:\n');
  console.log(updated);
  process.exit(0);
}

if (!args.yes) {
  console.log('[dev:enable] plan (no changes applied):\n');
  console.log(updated);
  console.log('\n[dev:enable] rerun with --yes to apply.');
  process.exit(0);
}

if (current === updated) {
  console.log('[dev:enable] already up to date; nothing to do.');
  process.exit(0);
}

if (current) {
  const backup = `${patchPath}.bak-dsh-game-market-${timestamp()}`;
  fs.copyFileSync(patchPath, backup);
  console.log(`[dev:enable] backup written: ${backup}`);
}

fs.writeFileSync(patchPath, updated, 'utf8');
console.log('[dev:enable] applied. Next steps:');
console.log('  1) Restart DSH (or disable/enable the dsh-game-market row) so the Host half loads.');
console.log('  2) Reload the DSH page; the Game Market sidebar icon should appear.');
console.log('  3) Run "npm run build" and reload the page after client changes.');
console.log('  4) Run "npm run dev:disable -- --yes" to undo.');

function upsertBlock(text, content) {
  const startIndex = text.indexOf(START);
  const endIndex = text.indexOf(END);
  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    return text.slice(0, startIndex) + content + text.slice(endIndex + END.length);
  }
  if (startIndex !== -1 || endIndex !== -1) {
    throw new Error('found only one managed marker; refusing to edit. Remove the stray marker manually.');
  }
  if (text.includes('id: dsh-game-market')) {
    throw new Error('a dsh-game-market row already exists outside the managed block; remove it first.');
  }
  // A profile patch may start as the YAML flow-style empty array `[]`. Appending
  // block items after it would be invalid, so drop that empty-array marker first.
  const withoutEmptyArray = text.replace(/^[ \t]*\[\][ \t]*(?:\r?\n|$)/m, '');
  const trimmed = withoutEmptyArray.replace(/\s+$/, '');
  return `${trimmed}${trimmed ? '\n\n' : ''}${content}\n`;
}

function parseArgs(argv) {
  const out = { dryRun: false, yes: false, profile: null, profileDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--yes' || arg === '-y') out.yes = true;
    else if (arg.startsWith('--profile=')) out.profile = arg.slice('--profile='.length);
    else if (arg.startsWith('--profile-dir=')) out.profileDir = arg.slice('--profile-dir='.length);
    else if (arg === '--profile-dir') { out.profileDir = argv[i + 1] || null; i += 1; }
    else if (arg === '--profile') {
      out.profile = argv[i + 1] || null;
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/dev-enable.mjs [--profile=desktop] [--profile-dir=<path>] [--dry-run] [--yes]');
      process.exit(0);
    } else {
      console.error(`[dev:enable] unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
