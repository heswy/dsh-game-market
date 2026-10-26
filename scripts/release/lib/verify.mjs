/**
 * Read-only re-validation of a release commit and (optionally) a generated
 * plugin index. Intended for CI and for maintainers checking an already
 * published release commit without writing anything.
 */
import fs from 'node:fs';
import path from 'node:path';

import { INDEX_PATH, PLUGIN_NAME, REPO_URL } from './constants.mjs';
import { fail } from './errors.mjs';
import { createGit, normalizeRepoUrl } from './git.mjs';
import {
  assertPluginIndex,
  collectIndexCommits,
  collectIndexVersions,
  installTargetFor,
  serializePluginIndex,
} from './index-format.mjs';
import { inspectReleaseCommit } from './release-commit.mjs';

/**
 * @param {{root: string, release: string, index?: string, version?: string, git?: object}} options
 */
export async function verifyRelease(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const git = options.git || createGit({ cwd: root });
  if (!git.isRepo()) fail('E_RELEASE_NOT_GIT', `${root} is not a git worktree`);
  const remote = git.remoteUrl('origin');
  if (normalizeRepoUrl(remote) !== REPO_URL) {
    fail('E_RELEASE_REPO_MISMATCH', `origin remote ${JSON.stringify(remote)} does not identify ${REPO_URL}`);
  }

  const inspected = inspectReleaseCommit({ git, release: options.release, version: options.version });
  const result = {
    ok: true,
    tool: 'release:verify',
    release: inspected.release,
    version: inspected.version,
    buildCommit: inspected.buildCommit,
    publishTimestamp: inspected.commitEpoch,
    engineDsh: inspected.engineDsh,
    deterministicIdentity: {
      digest: inspected.identity.artifacts.sha256,
      files: inspected.identity.artifacts.files,
      bytes: inspected.identity.artifacts.bytes,
    },
    // Q2 proof (contract §17.6): release.json ↔ commit message ↔ first parent
    // P ↔ P's package version ↔ client.js banner ↔ artifact digest all agree.
    correspondence: inspected.correspondence,
    clientIdentity: inspected.clientIdentity,
    selfReference: {
      indexInsideRelease: inspected.indexInRelease,
      verdict: 'separate-commit-required',
    },
    index: null,
  };

  if (options.index !== undefined && options.index !== null) {
    const indexPath = path.resolve(root, options.index);
    let text;
    try {
      text = fs.readFileSync(indexPath, 'utf8');
    } catch (error) {
      fail('E_RELEASE_INDEX_INVALID', `cannot read index file ${options.index}: ${error.message}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      fail('E_RELEASE_INDEX_INVALID', `index file ${options.index} is not valid JSON: ${error.message}`);
    }
    assertPluginIndex(parsed, { expect: { commit: inspected.release, version: inspected.version } });
    const versions = collectIndexVersions(parsed);
    if (versions.length !== 1 || versions[0] !== inspected.version) {
      fail('E_RELEASE_INDEX_INVALID', 'index must pin exactly one version (the release version)', {
        details: { versions, expected: inspected.version },
      });
    }
    const plugins = parsed.plugins || [];
    if (plugins.length !== 1 || plugins[0].name !== PLUGIN_NAME) {
      fail('E_RELEASE_INDEX_INVALID', `index must contain exactly one plugin (${PLUGIN_NAME})`);
    }
    const version = plugins[0].versions[0];
    if (!version.source || version.source.type !== 'git' || version.source.url !== REPO_URL || version.source.commit !== inspected.release) {
      fail('E_RELEASE_INDEX_INVALID', 'index source must be the official git repository pinned to the release commit', {
        details: { actual: version.source, expected: { type: 'git', url: REPO_URL, commit: inspected.release } },
      });
    }
    if (version.publishTimestamp !== inspected.commitEpoch) {
      fail('E_RELEASE_INDEX_INVALID', 'index publishTimestamp must equal the release commit committer timestamp', {
        details: { actual: version.publishTimestamp, expected: inspected.commitEpoch },
      });
    }
    const engineDsh = version.engines ? version.engines.dsh : undefined;
    if (engineDsh !== inspected.engineDsh) {
      fail('E_RELEASE_INDEX_INVALID', 'index engines.dsh must match the release package engines.dsh', {
        details: { actual: engineDsh, expected: inspected.engineDsh },
      });
    }
    const target = installTargetFor(PLUGIN_NAME, version);
    const canonical = serializePluginIndex(parsed);
    result.index = {
      path: path.relative(root, indexPath).split(path.sep).join('/'),
      commits: collectIndexCommits(parsed),
      versions,
      installSpec: target.spec,
      canonicalBytes: Buffer.byteLength(canonical, 'utf8'),
    };
  }

  if (fs.existsSync(path.join(root, INDEX_PATH))) {
    result.indexInWorkingTree = INDEX_PATH;
  }
  return result;
}
