/**
 * Read and validate an immutable release commit R *from git objects only*.
 *
 * Used by `release:promote`, `release:verify` and the post-commit gate of
 * `release:prepare --write`. Nothing here reads the working tree: the release
 * commit is the install target, so the bytes an installer would get must be the
 * bytes validated here.
 *
 * Checks (decisions §5, contract §9.4):
 *   - R is a real full 40-hex commit object in this repository;
 *   - package.json in R is installable (bundle/client/engines/files whitelist);
 *   - platform-updates/release.json exists, is valid and pins
 *     clientBuildCommit = P, an ancestor of R whose package.json version is the
 *     same version (P is the reviewed version commit, not a random ancestor);
 *   - the artifact digest in release.json matches the blobs in R exactly;
 *   - client.js in R embeds version + clientBuildCommit (self-proving Client);
 *   - R does not contain the plugin index pointing at R (self-reference).
 */
import {
  ARTIFACT_ROOTS,
  INDEX_PATH,
  RELEASE_IDENTITY_PATH,
} from './constants.mjs';
import { fail } from './errors.mjs';
import { inventoryFromGitTree } from './fs-tree.mjs';
import { indexReferencesCommit } from './index-format.mjs';
import {
  assertClientIdentity,
  assertPackageFiles,
  assertReleasePackage,
} from './package-manifest.mjs';
import { assertReleaseIdentity, isFullCommit } from './release-identity.mjs';

function parseJsonText(text, code, what) {
  if (typeof text !== 'string') {
    fail(code, `${what} is not present in the commit tree`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(code, `${what} is not valid JSON: ${error.message}`);
  }
}

/**
 * @param {{git: ReturnType<import('./git.mjs').createGit>, release: string, version?: string, requireReachable?: boolean}} options
 */
export function inspectReleaseCommit({ git, release, version, requireReachable = false }) {
  if (!isFullCommit(release)) {
    fail('E_RELEASE_BAD_COMMIT', `release target ${JSON.stringify(release)} is not a full 40-hex commit SHA`, {
      guidance: 'pass the immutable release commit R exactly as printed by `release:prepare --write`; branches, tags, HEAD and short SHAs are not install targets',
    });
  }
  if (!git.commitExists(release)) {
    fail('E_RELEASE_UNKNOWN_COMMIT', `commit ${release} does not exist in this repository`, {
      guidance: 'fetch/merge the release commit first; release:promote only validates local git objects',
    });
  }
  if (requireReachable) {
    const refs = git.refsContaining(release);
    if (refs.length === 0) {
      fail('E_RELEASE_UNREACHABLE', `commit ${release} is not reachable from any local branch or remote-tracking ref`, {
        guidance: 'push the release commit (Lead/authorised maintainer) before promoting; an unreachable commit cannot be installed from the index',
        details: { release },
      });
    }
  }

  const pkg = parseJsonText(git.readTextFile(release, 'package.json'), 'E_RELEASE_PACKAGE', 'package.json');
  assertReleasePackage(pkg, { where: `package.json@${release.slice(0, 12)}` });
  assertPackageFiles(pkg);
  const patchFile = pkg.dsh && pkg.dsh.bundle ? pkg.dsh.bundle.patch : null;
  if (!patchFile || !git.objectExists(release, patchFile)) {
    fail('E_RELEASE_PACKAGE', `bundle patch ${JSON.stringify(patchFile)} is missing from the release commit`, {
      guidance: 'the installed bundle must carry dsh.bundle.patch; run release:prepare --write to rebuild the release commit',
    });
  }

  const identityText = git.readTextFile(release, RELEASE_IDENTITY_PATH);
  if (identityText === null) {
    fail('E_RELEASE_RELEASE_JSON', `release commit ${release} does not contain ${RELEASE_IDENTITY_PATH}`, {
      guidance: 'only commits produced by `release:prepare --write` are promotable; a plain source commit is not a release identity',
    });
  }
  const identity = parseJsonText(identityText, 'E_RELEASE_RELEASE_JSON', RELEASE_IDENTITY_PATH);
  assertReleaseIdentity(identity, {
    requireArtifacts: true,
    expect: { version: version === undefined ? pkg.version : version },
  });
  if (identity.version !== pkg.version) {
    fail('E_RELEASE_VERSION_MISMATCH', `release.json version ${JSON.stringify(identity.version)} != package.json version ${JSON.stringify(pkg.version)}`, {
      guidance: 'release.json is generated from the version commit; regenerate it with release:prepare --write',
    });
  }

  // P: the version commit the artifacts were built from.
  const buildCommit = identity.clientBuildCommit;
  if (!git.commitExists(buildCommit)) {
    fail('E_RELEASE_VERSION_MISMATCH', `clientBuildCommit ${buildCommit} does not exist in this repository`, {
      guidance: 'release.json must pin the version commit P that is pushed with the release history',
    });
  }
  if (buildCommit === release) {
    fail('E_RELEASE_SELF_REFERENCE', 'release.json.clientBuildCommit must be an ancestor of R, not R itself', {
      guidance: 'a commit cannot declare its own hash; re-run release:prepare --write on the version commit P',
    });
  }
  if (!git.isAncestor(buildCommit, release)) {
    fail('E_RELEASE_VERSION_MISMATCH', `clientBuildCommit ${buildCommit} is not an ancestor of release commit ${release}`, {
      guidance: 'the release commit must be built from the version commit P (P is R\'s parent/ancestor)',
    });
  }
  const pkgBuildText = git.readTextFile(buildCommit, 'package.json');
  const pkgBuild = parseJsonText(pkgBuildText, 'E_RELEASE_VERSION_MISMATCH', `package.json@${buildCommit.slice(0, 12)}`);
  if (pkgBuild.version !== identity.version) {
    fail(
      'E_RELEASE_VERSION_MISMATCH',
      `version commit ${buildCommit.slice(0, 12)} declares package version ${JSON.stringify(pkgBuild.version)}, but the release is ${identity.version}`,
      {
        guidance: 'the version bump belongs to the version commit P; bump package.json in P, then re-run release:prepare --write',
      },
    );
  }

  // Artifacts in R must match the digest recorded in release.json.
  const entries = git.listTree(release, [...ARTIFACT_ROOTS]);
  if (entries.length === 0) {
    fail('E_RELEASE_ARTIFACTS', 'release commit contains no build artifacts', {
      guidance: 'run release:prepare --write so built client.js/games/registry are committed with the release identity',
    });
  }
  const blobs = git.readBlobs(entries.map((entry) => entry.oid));
  const inventory = inventoryFromGitTree(entries, (oid) => blobs.get(oid));
  const actual = identity.artifacts;
  if (
    inventory.digest !== actual.sha256
    || inventory.files.length !== actual.files
    || inventory.bytes !== actual.bytes
  ) {
    fail('E_RELEASE_ARTIFACT_DIGEST', 'artifact digest in release.json does not match the release commit tree', {
      guidance: 'rebuild and recreate the release commit with release:prepare --write; never hand-edit artifacts or release.json',
      details: {
        expected: { sha256: actual.sha256, files: actual.files, bytes: actual.bytes },
        actual: { sha256: inventory.digest, files: inventory.files.length, bytes: inventory.bytes },
      },
    });
  }

  // The Client bundle must be self-proving: it embeds the version and P.
  const clientBytes = blobs.size > 0 ? git.readFile(release, 'client.js') : null;
  const clientText = clientBytes === null ? null : clientBytes.toString('utf8');
  const clientIdentity = assertClientIdentity(clientText, {
    version: identity.version,
    clientBuildCommit: buildCommit,
    where: `client.js@${release.slice(0, 12)}`,
  });

  const indexInRelease = assertNoIndexInsideRelease(git, release);

  return {
    release,
    buildCommit,
    version: identity.version,
    pkg,
    identity,
    identityText,
    inventory,
    clientIdentity,
    engineDsh: pkg.engines.dsh,
    commitEpoch: git.commitEpoch(release),
    subject: git.commitSubject(release),
    parents: git.parents(release),
    indexInRelease,
  };
}

/**
 * Refuse a release commit R that introduces the mutable plugin index.
 *
 * The index is a mutable discovery entry and must be committed in a *separate*
 * commit I that references the immutable install target R (plan §5.4.4). Three
 * cases:
 *   - R contains an index that pins R itself -> impossible-by-construction
 *     self-reference, always fatal;
 *   - R adds or modifies `platform-updates/plugins.json` relative to all of its
 *     parents -> discovery metadata is being mixed into the install target,
 *     fatal;
 *   - R merely inherits an existing index unchanged from main (later releases
 *     after the first index PR) -> allowed; R does not introduce it.
 *
 * @returns {{present: boolean, inherited?: boolean}}
 */
export function assertNoIndexInsideRelease(git, release) {
  if (!git.objectExists(release, INDEX_PATH)) return { present: false };
  const text = git.readTextFile(release, INDEX_PATH);
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (parsed === null) {
    fail('E_RELEASE_INDEX_IN_RELEASE', `release commit ${release} contains an unreadable ${INDEX_PATH}`, {
      guidance: 'fix the plugin index in main before preparing a release',
    });
  }
  if (indexReferencesCommit(parsed, release)) {
    fail('E_RELEASE_SELF_REFERENCE', `release commit ${release} contains ${INDEX_PATH} pointing at itself`, {
      guidance: 'the index must be committed separately (commit I) and reference R; it can never live inside R',
    });
  }
  const parents = git.parents(release);
  const inherited = parents.some((parent) => git.objectExists(parent, INDEX_PATH)
    && git.readTextFile(parent, INDEX_PATH) === text);
  if (!inherited) {
    fail('E_RELEASE_INDEX_IN_RELEASE', `release commit ${release} adds or changes ${INDEX_PATH}; the plugin index must be a separate commit/PR`, {
      guidance: `R is an immutable install target: remove ${INDEX_PATH} from R, recreate R with release:prepare --write, and commit the index in a separate commit I that references R`,
      details: { release, path: INDEX_PATH },
    });
  }
  return { present: true, inherited: true };
}
