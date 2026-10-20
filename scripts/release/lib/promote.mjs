/**
 * `release:promote` orchestration — dry-run by default; never commits/pushes.
 *
 * Validates an immutable release commit R (from git objects), then generates the
 * DSH plugin market index format 1 document that pins exactly one plugin
 * (`dsh-game-market`) to exactly one version at `source: {type: 'git',
 * url: <repo>, commit: R}`.
 *
 * Self-reference rules (decisions §5, plan §5.4.4):
 *   - R must not contain the index (the index is a separate commit I);
 *   - R must not contain an index pinning R;
 *   - the generated index is only written to an explicit `--out` working-tree
 *     path with `--write`, and never staged/committed by this tool;
 *   - writing the production index path requires an explicit acknowledgement
 *     flag, so no default invocation can ever touch production.
 *
 * Channel rules: the stable channel refuses prerelease versions; test builds
 * are rehearsal-only and never enabled by default anywhere.
 *
 * Immutability: if an existing index (working tree out path or HEAD's index)
 * already pins this version to a different commit, promotion fails; publishing
 * an older version than the trusted index is refused (never downgrade).
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  INDEX_PATH,
  PLUGIN_NAME,
  REPO_URL,
} from './constants.mjs';
import { fail } from './errors.mjs';
import { createGit, normalizeRepoUrl } from './git.mjs';
import {
  assertPluginIndex,
  buildPluginIndex,
  collectIndexCommits,
  collectIndexVersions,
  installTargetFor,
  serializePluginIndex,
} from './index-format.mjs';
import { inspectReleaseCommit } from './release-commit.mjs';
import { compareVersions, isPrerelease, isValidVersion } from './semver.mjs';

export const CHANNELS = Object.freeze(['stable', 'test']);

const OUT_FORBIDDEN_PREFIX = ['.git', 'node_modules'];

function readExistingIndex(git, root, outPath) {
  const candidates = [];
  const headText = git.objectExists('HEAD', INDEX_PATH) ? git.readTextFile('HEAD', INDEX_PATH) : null;
  if (headText !== null) candidates.push({ source: `HEAD:${INDEX_PATH}`, text: headText });
  if (outPath && fs.existsSync(outPath)) {
    const outText = fs.readFileSync(outPath, 'utf8');
    if (headText === null || outText !== headText) candidates.push({ source: path.relative(root, outPath), text: outText });
  }
  const results = [];
  for (const candidate of candidates) {
    let parsed;
    try {
      parsed = JSON.parse(candidate.text);
    } catch {
      fail('E_RELEASE_INDEX_INVALID', `existing plugin index (${candidate.source}) is not valid JSON`, {
        guidance: 'fix or remove the existing index before promoting; never overwrite an unreadable trusted index',
      });
    }
    results.push({ source: candidate.source, index: parsed });
  }
  return results;
}

function checkImmutability(existingIndexes, { version, release, channel }) {
  for (const existing of existingIndexes) {
    const versions = collectIndexVersions(existing.index).filter((candidate) => isValidVersion(candidate));
    if (versions.length === 0) continue;
    const commits = collectIndexCommits(existing.index);
    if (versions.includes(version) && commits.length > 0 && !commits.includes(release)) {
      fail('E_RELEASE_VERSION_IMMUTABLE', `version ${version} is already published with a different commit in ${existing.source}`, {
        guidance: 'never replace a published version (same version different commit would be a silent reinstall); publish a new version instead',
        details: { version, existing: commits, release },
      });
    }
    for (const candidate of versions) {
      if (compareVersions(candidate, version) > 0) {
        fail('E_RELEASE_VERSION_ROLLBACK', `cannot publish ${version} over trusted ${candidate} in ${existing.source}`, {
          guidance: 'never downgrade the trusted index; publish a newer fix release or revert the stable promotion through a new commit',
          details: { channel, version, trusted: candidate },
        });
      }
    }
  }
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${String(process.pid)}`;
  fs.writeFileSync(temp, text, { mode: 0o644 });
  fs.renameSync(temp, file);
}

/**
 * @param {object} options
 * @param {string} options.root repository root
 * @param {string} options.release full 40-hex release commit R
 * @param {'stable'|'test'} [options.channel]
 * @param {string} [options.version] expected version (asserted)
 * @param {string} [options.out] explicit working-tree output path (required with --write)
 * @param {boolean} [options.write]
 * @param {boolean} [options.productionIndex] acknowledge writing platform-updates/plugins.json
 * @param {object} [options.git]
 * @returns {Promise<object>}
 */
export async function promoteRelease(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const git = options.git || createGit({ cwd: root });
  const write = options.write === true;
  const channel = options.channel === undefined ? 'stable' : options.channel;
  if (!CHANNELS.includes(channel)) {
    fail('E_RELEASE_USAGE', `--channel must be one of ${CHANNELS.join('|')}`, { details: { channel } });
  }
  const release = options.release;
  if (typeof release !== 'string' || release.trim() === '') {
    fail('E_RELEASE_USAGE', 'missing --release <40-hex release commit R>', {
      guidance: 'pass the immutable release commit printed by `release:prepare --write`',
    });
  }
  if (!git.isRepo()) {
    fail('E_RELEASE_NOT_GIT', `${root} is not a git worktree`);
  }
  const remote = git.remoteUrl('origin');
  if (normalizeRepoUrl(remote) !== REPO_URL) {
    fail('E_RELEASE_REPO_MISMATCH', `origin remote ${JSON.stringify(remote)} does not identify ${REPO_URL}`, {
      guidance: 'release:promote only promotes releases of the official platform repository',
    });
  }

  const inspected = inspectReleaseCommit({
    git,
    release,
    version: options.version,
    requireReachable: true,
  });

  if (isPrerelease(inspected.version) && channel === 'stable') {
    fail('E_RELEASE_PRERELEASE_STABLE', `stable channel rejects prerelease version ${inspected.version}`, {
      guidance: 'rehearse prerelease builds on the test channel, and promote only a final version to stable',
      details: { version: inspected.version, channel },
    });
  }

  // Resolve and guard the output path before generating anything.
  let outPath = null;
  let outRelative = null;
  if (options.out !== undefined && options.out !== null) {
    if (typeof options.out !== 'string' || options.out.trim() === '') {
      fail('E_RELEASE_OUT_INVALID', '--out must be a non-empty working-tree path');
    }
    outPath = path.resolve(root, options.out);
    outRelative = path.relative(root, outPath);
    if (outRelative === '' || outRelative.startsWith('..') || path.isAbsolute(outRelative)) {
      fail('E_RELEASE_OUT_INVALID', `--out ${JSON.stringify(options.out)} must point inside the release worktree`, {
        guidance: 'the generated index is a working-tree file; the tool never writes outside the repository',
      });
    }
    const posixRelative = outRelative.split(path.sep).join('/');
    if (OUT_FORBIDDEN_PREFIX.some((prefix) => posixRelative === prefix || posixRelative.startsWith(`${prefix}/`))) {
      fail('E_RELEASE_OUT_INVALID', `--out ${JSON.stringify(options.out)} points at a forbidden location`, {
        details: { path: posixRelative },
      });
    }
    if (git.objectExists(release, posixRelative)) {
      if (posixRelative === INDEX_PATH) {
        fail('E_RELEASE_INDEX_IN_RELEASE', `the production index path ${INDEX_PATH} already exists inside release commit ${release}`, {
          guidance: 'the index must be committed in a separate commit I, never added to the release commit R',
        });
      }
      fail('E_RELEASE_OUT_INVALID', `--out ${JSON.stringify(options.out)} already exists inside release commit ${release}`, {
        guidance: 'the generated index must be a new file committed in a separate index commit I; choose a new --out path',
        details: { release, path: posixRelative },
      });
    }
    if (posixRelative === INDEX_PATH && options.productionIndex !== true) {
      fail('E_RELEASE_PRODUCTION_INDEX_GUARD', `refusing to write the production index ${INDEX_PATH} without an explicit acknowledgement`, {
        guidance: `the production index is written only from an authorised index branch/PR: re-run with --production-index --write --out ${INDEX_PATH}`,
      });
    }
    if (fs.existsSync(outPath) && fs.statSync(outPath).isDirectory()) {
      fail('E_RELEASE_OUT_INVALID', `--out ${JSON.stringify(options.out)} is a directory`);
    }
    const tracked = git.objectExists('HEAD', posixRelative);
    if (tracked && posixRelative !== INDEX_PATH) {
      fail('E_RELEASE_OUT_INVALID', `--out ${JSON.stringify(options.out)} is a tracked file; refusing to overwrite it`, {
        guidance: 'the generated index must be a new file (or the production index path with --production-index)',
      });
    }
  }

  const existing = readExistingIndex(git, root, outPath);
  checkImmutability(existing, { version: inspected.version, release, channel });

  const index = buildPluginIndex({
    version: inspected.version,
    commit: release,
    publishTimestamp: inspected.commitEpoch,
    engineDsh: inspected.engineDsh,
  });
  assertPluginIndex(index, { expect: { commit: release, version: inspected.version } });
  const indexText = serializePluginIndex(index);
  const target = installTargetFor(PLUGIN_NAME, index.plugins[0].versions[0]);
  const expectedSpec = `git+${REPO_URL}.git#${release}`;
  if (target.spec !== expectedSpec) {
    fail('E_RELEASE_INDEX_INVALID', `derived install target ${JSON.stringify(target.spec)} does not match the expected pinned git spec`, {
      details: { expected: expectedSpec, actual: target.spec },
    });
  }

  const result = {
    ok: true,
    tool: 'release:promote',
    mode: write ? 'write' : 'dry-run',
    root,
    release,
    version: inspected.version,
    channel,
    publishTimestamp: inspected.commitEpoch,
    buildCommit: inspected.buildCommit,
    engineDsh: inspected.engineDsh,
    target: {
      id: `${PLUGIN_NAME}@${inspected.version}+${release}`,
      plugin: PLUGIN_NAME,
      version: inspected.version,
      commit: release,
      installSpec: target.spec,
    },
    index,
    indexText,
    installSpec: target.spec,
    selfReference: {
      indexInsideRelease: inspected.indexInRelease,
      indexOutputPath: outRelative === null ? null : outRelative.split(path.sep).join('/'),
      verdict: 'separate-commit-required',
    },
    out: outRelative === null ? null : outRelative.split(path.sep).join('/'),
    written: false,
    alreadyUpToDate: false,
  };

  if (!write) return result;
  if (outPath === null) {
    fail('E_RELEASE_OUT_REQUIRED', '--write requires an explicit --out <path>', {
      guidance: 'dry-run prints the index to stdout and writes nothing; --write only ever writes to an explicit working-tree path (never a production path by default)',
    });
  }

  const existingText = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
  if (existingText === indexText) {
    return { ...result, written: false, alreadyUpToDate: true };
  }
  atomicWrite(outPath, indexText);
  const finalText = fs.readFileSync(outPath, 'utf8');
  if (finalText !== indexText) {
    fail('E_RELEASE_OUT_INVALID', 'index file verification failed after writing', { details: { out: result.out } });
  }
  assertPluginIndex(JSON.parse(finalText), { expect: { commit: release, version: inspected.version } });
  return { ...result, written: true };
}
