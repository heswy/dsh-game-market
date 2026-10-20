#!/usr/bin/env node
/**
 * Maintainer publishing tool (dry-run by default).
 *
 *   node scripts/registry/prepare.mjs \
 *     --submission /path/submission.json \
 *     --review /path/approved-review.json \
 *     --registry-dir /path/dsh-game-registry [--execute] [--repo owner/name]
 *     [--catalog-schema 1|2]
 *
 * `--catalog-schema` is optional: the default keeps the legacy V1.2 catalog
 * shape for a new HTML game and writes the V1.5 append-only `releases[]` shape
 * for a ZIP release or when the game's catalog is already schemaVersion 2.
 *
 * Without `--execute` this performs every local/download/validation step and
 * prints the planned release, assets and catalog diff; it never mutates GitHub
 * or the content repository. `--execute` creates a draft Release, uploads the
 * exact verified bytes, publishes it, updates the catalog and opens a PR. It
 * never merges the PR.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createGit } from './lib/git.mjs';
import { createGithub, parseGitHubRepo } from './lib/github.mjs';
import { preparePublish } from './lib/prepare.mjs';

function parseArgs(argv) {
  const options = { execute: false, json: false, baseBranch: 'main' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute') options.execute = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--submission') { options.submissionPath = argv[index + 1]; index += 1; }
    else if (arg === '--review') { options.reviewPath = argv[index + 1]; index += 1; }
    else if (arg === '--registry-dir') { options.registryDir = argv[index + 1]; index += 1; }
    else if (arg === '--repo') { options.repo = argv[index + 1]; index += 1; }
    else if (arg === '--base') { options.baseBranch = argv[index + 1] || 'main'; index += 1; }
    else if (arg === '--catalog-schema') {
      const value = Number(argv[index + 1]);
      if (value !== 1 && value !== 2) throw new Error('--catalog-schema must be 1 or 2');
      options.catalogSchema = value;
      index += 1;
    }
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
    console.error(`[publish] ${error.message}`);
    return 2;
  }
  if (options.help) {
    console.error('usage: node scripts/registry/prepare.mjs --submission <json> --review <json> --registry-dir <dir> [--execute] [--repo owner/name] [--base main] [--catalog-schema 1|2] [--json]');
    return 0;
  }
  if (!options.submissionPath || !options.reviewPath || !options.registryDir) {
    console.error('usage: node scripts/registry/prepare.mjs --submission <json> --review <json> --registry-dir <dir> [--execute] [--repo owner/name] [--catalog-schema 1|2]');
    return 2;
  }
  const registryDir = path.resolve(options.registryDir);
  const git = createGit({ cwd: registryDir });
  const repo = options.repo || parseGitHubRepo(git.remoteUrl()) || undefined;
  try {
    const result = await preparePublish({
      submissionPath: path.resolve(options.submissionPath),
      reviewPath: path.resolve(options.reviewPath),
      registryDir,
      execute: options.execute,
      repo,
      git,
      baseBranch: options.baseBranch,
      ...(options.catalogSchema ? { catalogSchema: options.catalogSchema } : {}),
    });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.mode === 'dry-run') {
      console.log(`[publish] DRY RUN (no remote mutation)`);
      console.log(`  game: ${result.plan.game.id}@${result.plan.game.version}`);
      console.log(`  repo: ${result.repo}`);
      console.log(`  release tag: ${result.plan.tag}`);
      console.log(`  package asset: ${result.plan.assetPlan.packageName} (${result.plan.assetPlan.hashes.package})`);
      console.log(`  package format: ${result.plan.package ? result.plan.package.format : 'html-v1'}`);
      if (result.plan.package && result.plan.package.filesDigest) {
        console.log(`  file manifest digest: ${result.plan.package.filesDigest} (${result.plan.package.fileCount} files)`);
      }
      console.log(`  catalog schemaVersion: ${result.plan.catalogEntry ? result.plan.catalogEntry.schemaVersion : '?'}`);
      console.log(`  assets: ${[result.plan.assetPlan.coverName, ...result.plan.assetPlan.screenshotNames].join(', ')}`);
      console.log(`  files: ${Object.values(result.plan.files).join(', ')}`);
      console.log('  next: re-run with --execute after reviewing this plan');
    } else if (result.alreadyPublished) {
      console.log(`[publish] already published: ${result.plan.game.id}@${result.plan.game.version}`);
    } else {
      console.log(`[publish] published release and opened PR: ${result.prUrl}`);
      console.log(`  release: ${result.releaseUrl}`);
    }
    return 0;
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ ok: false, code: error.code || 'E_PUBLISH', message: error.message, details: error.details || null }, null, 2));
    } else {
      console.error(`[publish] FAILED ${error.code || ''} ${error.message}`);
      if (error.details) console.error(JSON.stringify(error.details, null, 2));
    }
    return 1;
  }
}

const __isMain = typeof process.argv[1] === 'string' && pathToFileURL(process.argv[1]).href === import.meta.url;
if (__isMain) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(`[publish] ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  });
}
