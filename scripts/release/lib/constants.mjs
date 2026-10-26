/**
 * Constants for the V1.5 maintainer release tooling (`release:prepare` /
 * `release:promote`).
 *
 * Frozen by docs/verification/v1.5/m3-decisions.md §5 and
 * docs/V1.5-CONTRACTS.md §9.4:
 *   - the platform repository is https://github.com/heswy/dsh-game-market;
 *   - the target of an update is an immutable full 40-hex commit;
 *   - the fixed production index is `platform-updates/plugins.json` (format 1
 *     of the DSH plugin market index) and is committed in a *separate* commit;
 *   - the release commit carries `platform-updates/release.json` with
 *     `clientBuildCommit = P` (the commit the artifacts were built from).
 *
 * `repo` is stored in release.json as the canonical HTTPS URL (Lead-frozen
 * coordination schema), while git remotes are normalised to the same URL.
 */
export const REPO_SLUG = 'heswy/dsh-game-market';
export const REPO_URL = 'https://github.com/heswy/dsh-game-market';
export const REPO_GIT_URL = 'https://github.com/heswy/dsh-game-market.git';

export const PLUGIN_NAME = 'dsh-game-market';
export const PLUGIN_TITLE = 'DSH Game Market';
export const PLUGIN_DESCRIPTION = 'Game market and runtime plugin for DeepSeek Harness.';
export const PLUGIN_AUTHOR = 'heswy';

export const RELEASE_IDENTITY_PATH = 'platform-updates/release.json';
export const INDEX_PATH = 'platform-updates/plugins.json';

/** Build outputs that make up an installed bundle; the release digest covers exactly these. */
export const ARTIFACT_ROOTS = Object.freeze(['client.js', 'games', 'registry']);
export const ARTIFACT_DIGEST_ALGORITHM = 'sha256-tree-v1';

export const RELEASE_SCHEMA_VERSION = 1;
export const INDEX_FORMAT = 1;

/** Commit message of the generated release commit R. */
export const releaseCommitMessage = (version, buildCommit) => `chore(release): v${version} build ${buildCommit}`;
export const RELEASE_COMMIT_RE = /^chore\(release\): v(\S+) build ([0-9a-f]{40})$/;

/** npm `files` entries an installable release must ship (see decisions §5 / plan §5.4). */
export const REQUIRED_PACKAGE_FILES = Object.freeze([
  'index.js',
  'client.js',
  'cordis.patch.yml',
  'games/**',
  'registry/**',
  'platform-updates/release.json',
  'scripts/release/**',
]);

/** Release commit header line embedded in every generated Client bundle. */
export const CLIENT_IDENTITY_PREFIX = 'release-identity:';

/** HTTP(S) source URL emitted into the plugin index for the git source. */
export const sourceUrl = () => REPO_URL;
