/**
 * Build-determinism gate for `release:prepare`.
 *
 * The release commit must be reproducible: two independent builds of the same
 * version commit P must produce byte-identical artifacts, and the build must not
 * depend on the *release identity metadata it is about to be stamped with*
 * (only package.json.version and release.json.clientBuildCommit may influence
 * the bundle). Otherwise the release commit would contain artifacts that cannot
 * be reproduced, and the artifact digest in release.json would be stale the
 * moment it is written.
 *
 * Implementation: copy the source tree into two throwaway directories, stamp a
 * provisional release.json (identity without artifacts), build each copy, then
 * stamp the final identity and build again. Everything happens under the OS temp
 * directory; the source worktree is never written in this phase.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { RELEASE_IDENTITY_PATH } from './constants.mjs';
import { fail } from './errors.mjs';
import { collectArtifacts, compareInventories, compareText } from './fs-tree.mjs';
import { assertClientIdentity } from './package-manifest.mjs';
import { buildReleaseIdentity } from './release-identity.mjs';

/** Top-level directories that are never build inputs. */
const EXCLUDED_TOP = new Set(['.git', 'node_modules', 'worktrees', 'coverage', '.prd-draft']);

/** Run the repository build pipeline (`scripts/build.mjs`) inside `cwd`. */
export function runRepositoryBuild(cwd, options = {}) {
  const script = fs.existsSync(path.join(cwd, 'scripts', 'build.mjs'))
    ? path.join(cwd, 'scripts', 'build.mjs')
    : null;
  if (!script) {
    fail('E_RELEASE_BUILD_FAILED', 'missing scripts/build.mjs', {
      guidance: 'release:prepare builds player artifacts with the repository build pipeline; restore scripts/build.mjs',
    });
  }
  const result = spawnSync(process.execPath, [script], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: options.timeoutMs || 300_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) {
    fail('E_RELEASE_BUILD_FAILED', `build could not be executed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const tail = `${result.stdout || ''}\n${result.stderr || ''}`.trim().split('\n').slice(-12).join('\n');
    fail('E_RELEASE_BUILD_FAILED', `build failed with exit ${String(result.status)}`, {
      guidance: 'fix the build before preparing a release; a release commit must ship reproducible artifacts',
      details: { tail },
    });
  }
}

/** Recursively copy the build inputs of `root` into `target`. */
export function copySourceTree(root, target) {
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(root, target, {
    recursive: true,
    dereference: false,
    filter: (source) => {
      const relative = path.relative(root, source);
      if (relative === '') return true;
      const parts = relative.split(path.sep);
      if (parts.length === 1 && EXCLUDED_TOP.has(parts[0])) return false;
      if (parts.some((part) => part === 'node_modules' || part === '.git')) return false;
      return true;
    },
  });
}

function writeProvisionalIdentity(directory, { version, clientBuildCommit }) {
  const file = path.join(directory, RELEASE_IDENTITY_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify({
      schemaVersion: 1,
      version,
      clientBuildCommit,
      repo: 'https://github.com/heswy/dsh-game-market',
    }, null, 2)}\n`,
    'utf8',
  );
}

function writeFinalIdentity(directory, identity) {
  const file = path.join(directory, RELEASE_IDENTITY_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
}

/**
 * Build twice in isolated copies and return the verified release identity.
 *
 * @param {{root: string, version: string, clientBuildCommit: string, runBuild?: (cwd: string) => void, keepTemp?: boolean}} options
 * @returns {{identity: object, inventory: object, tempRoot: string|null, builds: number}}
 */
export function verifyBuildDeterminism(options) {
  const { root, version, clientBuildCommit } = options;
  const runBuild = options.runBuild || runRepositoryBuild;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-release-build-'));
  const copyA = path.join(tempRoot, 'a');
  const copyB = path.join(tempRoot, 'b');
  let builds = 0;
  try {
    copySourceTree(root, copyA);
    copySourceTree(root, copyB);
    writeProvisionalIdentity(copyA, { version, clientBuildCommit });
    writeProvisionalIdentity(copyB, { version, clientBuildCommit });

    runBuild(copyA);
    builds += 1;
    const provisionalA = collectArtifacts(copyA);
    runBuild(copyB);
    builds += 1;
    const provisionalB = collectArtifacts(copyB);
    const crossCopy = compareInventories(provisionalA, provisionalB);
    if (!crossCopy.equal) {
      fail('E_RELEASE_NONDETERMINISTIC', 'two independent builds produced different artifacts', {
        guidance: 'remove timestamps/random ids/absolute machine paths from the build output; a release commit must be reproducible',
        details: { copyA: 'first build', copyB: 'second build', differences: crossCopy },
      });
    }

    const identity = buildReleaseIdentity({
      version,
      clientBuildCommit,
      artifacts: { sha256: provisionalA.digest, files: provisionalA.files.length, bytes: provisionalA.bytes },
    });
    writeFinalIdentity(copyA, identity);
    writeFinalIdentity(copyB, identity);
    runBuild(copyA);
    builds += 1;
    const finalA = collectArtifacts(copyA);
    runBuild(copyB);
    builds += 1;
    const finalB = collectArtifacts(copyB);

    const finalDelta = compareInventories(provisionalA, finalA);
    if (!finalDelta.equal) {
      fail(
        'E_RELEASE_NONDETERMINISTIC',
        'build output depends on release.json fields other than version/clientBuildCommit (circular release identity)',
        {
          guidance: 'the build may read package.json.version and release.json.clientBuildCommit only; the artifact digest is computed from the build output',
          details: { differences: finalDelta },
        },
      );
    }
    const finalCrossCopy = compareInventories(finalA, finalB);
    if (!finalCrossCopy.equal) {
      fail('E_RELEASE_NONDETERMINISTIC', 'two independent builds of the stamped tree produced different artifacts', {
        guidance: 'make the build reproducible before preparing a release',
        details: { differences: finalCrossCopy },
      });
    }

    const clientText = fs.readFileSync(path.join(copyA, 'client.js'), 'utf8');
    const clientIdentity = assertClientIdentity(clientText, { version, clientBuildCommit });
    return { identity, inventory: finalA, clientIdentity, tempRoot: options.keepTemp ? tempRoot : null, builds, provisionalInventory: provisionalA };
  } finally {
    if (!options.keepTemp) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

export { compareText };
