#!/usr/bin/env node
/**
 * `npm run release:prepare -- [--version X.Y.Z] [--write] [--json]`
 *
 * Default: DRY RUN. Validates a clean version commit P, builds twice in
 * isolated copies (byte-identical artifacts), validates the release identity,
 * and prints exactly what a release commit R would contain. Writes nothing.
 *
 * `--write` (maintainer authorisation, explicit): writes
 * `platform-updates/release.json`, rebuilds the worktree, and creates the
 * release commit R = child(P) with message
 * `chore(release): vX.Y.Z build <P>`. Prints R's SHA. Never pushes or tags.
 *
 * There is no --allow-dirty and no automatic version bump: P must already be a
 * clean, reviewed version commit (decisions §5).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseReleaseArgs, emit, formatBytes, runCli } from './lib/cli.mjs';
import { prepareRelease } from './lib/prepare.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const PROGRAM = 'release:prepare';

const HELP = `Usage: npm run release:prepare -- [options]

Options:
  --version <X.Y.Z>  assert package.json.version (never bumps it; P must be pre-bumped)
  --write            create the release commit R (maintainer authorisation); prints R
  --json             machine-readable result
  --help             show this help

Dry-run validates everything and writes nothing. --write never pushes/tags.`;

function human(result) {
  const lines = [];
  lines.push(`${PROGRAM} — ${result.version} (${result.mode === 'write' ? 'WRITE' : 'DRY RUN'})`);
  lines.push(`  repo              ${result.repo}`);
  lines.push(`  branch            ${result.branch}`);
  lines.push(`  version commit P  ${result.clientBuildCommit}`);
  lines.push(`  artifacts         ${result.artifacts.files} files, ${formatBytes(result.artifacts.bytes)}, ${result.artifacts.algorithm} ${result.artifacts.sha256}`);
  lines.push(`  determinism       ${String(result.builds)} isolated builds byte-identical`);
  lines.push(`  client identity   version=${result.clientIdentity.version} buildCommit=${result.clientIdentity.buildCommit}`);
  lines.push(`  identity file     ${'platform-updates/release.json'}`);
  lines.push(`  commit message    ${result.commitMessage}`);
  if (result.commit) {
    lines.push('');
    lines.push(`  RELEASE COMMIT R  ${result.commit}`);
    lines.push('  next: push/merge R (Lead), run CI, then `npm run release:promote -- --release <R>` (dry-run)');
    lines.push('  R is immutable: never amend or rewrite it; the plugin index pins this exact hash.');
  } else {
    lines.push('');
    lines.push('  DRY RUN — nothing written. Re-run with --write to create the release commit.');
  }
  return lines;
}

await runCli({
  program: PROGRAM,
  help: HELP,
  async main({ argv, json }) {
    const values = parseReleaseArgs(argv, {
      version: { type: 'string' },
      write: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    });
    if (values.help) {
      process.stdout.write(`${HELP}\n`);
      return;
    }
    const result = await prepareRelease({ root, version: values.version, write: values.write === true });
    emit({ program: PROGRAM, result, json: json || values.json === true, human });
  },
});
