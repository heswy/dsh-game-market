#!/usr/bin/env node
/**
 * `npm run release:verify -- --release <40hex R> [--index <path>] [--json]`
 *
 * Read-only helper: re-validates a release commit R (identity, version commit
 * P, artifact digest, client identity, self-reference) and optionally an
 * already generated plugin index file. Writes nothing and never commits.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { emit, formatBytes, parseReleaseArgs, runCli } from './lib/cli.mjs';
import { verifyRelease } from './lib/verify.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const PROGRAM = 'release:verify';

const HELP = `Usage: npm run release:verify -- --release <40hex> [options]

Options:
  --release <sha>   immutable release commit R (full lowercase 40-hex)
  --index <path>    additionally validate a generated plugin index file
  --version <X.Y.Z> assert the release version
  --json            machine-readable result
  --help            show this help`;

function human(result) {
  const lines = [];
  lines.push(`${PROGRAM} — v${result.version} (${result.release.slice(0, 12)}…)`);
  lines.push(`  build commit P    ${result.buildCommit} (R's first parent, P/R version ${result.correspondence.versionAtBuildCommit === result.version ? 'matches' : 'MISMATCH'})`);
  lines.push(`  release message   ${result.correspondence.releaseMessage}`);
  lines.push(`  artifacts         ${result.deterministicIdentity.files} files, ${formatBytes(result.deterministicIdentity.bytes)}, sha256 ${result.deterministicIdentity.digest}`);
  lines.push(`  client identity   version=${result.clientIdentity.version} buildCommit=${result.clientIdentity.buildCommit} (matches release.json)`);
  lines.push(`  engines.dsh       ${result.engineDsh}`);
  lines.push(`  self-reference    ${result.selfReference.indexInsideRelease.present ? 'INDEX INSIDE R (fatal)' : 'none (index must be a separate commit)'}`);
  if (result.index) {
    lines.push(`  index             ${result.index.path}: ${result.index.versions.join(', ')} -> ${result.index.installSpec}`);
  }
  lines.push('  verify OK');
  return lines;
}

await runCli({
  program: PROGRAM,
  help: HELP,
  async main({ argv, json }) {
    const values = parseReleaseArgs(argv, {
      release: { type: 'string' },
      index: { type: 'string' },
      version: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    });
    if (values.help) {
      process.stdout.write(`${HELP}\n`);
      return;
    }
    if (values.release === undefined) {
      process.stderr.write(`${PROGRAM}: E_RELEASE_USAGE: missing --release <40hex>\n`);
      process.exitCode = 1;
      return;
    }
    const result = await verifyRelease({ root, release: values.release, index: values.index, version: values.version });
    emit({ program: PROGRAM, result, json: json || values.json === true, human });
  },
});
