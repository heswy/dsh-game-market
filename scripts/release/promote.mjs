#!/usr/bin/env node
/**
 * `npm run release:promote -- --release <40hex R> [--channel stable|test] [--out <path>] [--write] [--json]`
 *
 * Default: DRY RUN. Validates the immutable release commit R from git objects
 * (existence/reachability, package version at the version commit P, artifact
 * digest, self-proving client identity, self-reference) and prints the DSH
 * plugin market index format 1 document pinning plugin `dsh-game-market` to R.
 *
 * `--write` requires an explicit `--out <path>` and writes only that
 * working-tree file: no commit, no push, no tag. Writing the production index
 * path additionally requires `--production-index` (authorised index PR only).
 *
 * The index must be committed in a separate commit I referencing R — never
 * inside R. This tool refuses to promote when R contains the index.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { emit, parseReleaseArgs, runCli } from './lib/cli.mjs';
import { promoteRelease } from './lib/promote.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const PROGRAM = 'release:promote';

const HELP = `Usage: npm run release:promote -- --release <40hex> [options]

Required:
  --release <sha>    immutable release commit R (full lowercase 40-hex; not a branch/tag/short SHA)

Options:
  --channel <name>      stable (default) or test; stable rejects prerelease versions
  --version <X.Y.Z>     assert the release version
  --out <path>          working-tree path for the generated index (required with --write)
  --write               write the index to --out (no commit/push/tag)
  --production-index    acknowledge writing platform-updates/plugins.json (separate index PR only)
  --json                machine-readable result
  --help                show this help

Dry-run prints the index and writes nothing. The index is committed in a
separate commit I referencing R; R must never contain it.`;

function human(result) {
  const lines = [];
  lines.push(`${PROGRAM} — ${result.version} -> ${result.channel} (${result.mode === 'write' ? 'WRITE' : 'DRY RUN'})`);
  lines.push(`  release commit R  ${result.release}`);
  lines.push(`  build commit P    ${result.buildCommit}`);
  lines.push(`  publishTimestamp  ${result.publishTimestamp}`);
  lines.push(`  engines.dsh       ${result.engineDsh}`);
  lines.push('  artifacts         verified from git objects against release.json digest');
  lines.push(`  install spec      ${result.target.installSpec}`);
  lines.push('  index             1 plugin (dsh-game-market), 1 exact version pinned to R');
  lines.push('  self-reference    none: R does not contain the index; commit I must reference R separately');
  lines.push('');
  if (result.written) {
    lines.push(`  WRITTEN ${result.out} (not staged/committed: commit it separately and open the index PR)`);
  } else if (result.alreadyUpToDate) {
    lines.push(`  ${result.out} already contains this exact index; nothing written`);
  } else if (result.out) {
    lines.push(`  index target ${result.out} (dry-run: not written)`);
  } else {
    lines.push('  index document:');
    for (const line of result.indexText.trimEnd().split('\n')) lines.push(`  ${line}`);
  }
  return lines;
}

await runCli({
  program: PROGRAM,
  help: HELP,
  async main({ argv, json }) {
    const values = parseReleaseArgs(argv, {
      release: { type: 'string' },
      channel: { type: 'string', default: 'stable' },
      version: { type: 'string' },
      out: { type: 'string' },
      write: { type: 'boolean', default: false },
      'production-index': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    });
    if (values.help) {
      process.stdout.write(`${HELP}\n`);
      return;
    }
    const result = await promoteRelease({
      root,
      release: values.release,
      channel: values.channel,
      version: values.version,
      out: values.out,
      write: values.write === true,
      productionIndex: values['production-index'] === true,
    });
    emit({ program: PROGRAM, result, json: json || values.json === true, human });
  },
});
