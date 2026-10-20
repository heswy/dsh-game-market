/**
 * `platform-updates/release.json` — the in-package release identity.
 *
 * Frozen coordination schema (docs/verification/v1.5/m3-decisions.md §5):
 *
 *   {
 *     "schemaVersion": 1,
 *     "version": "1.3.0",
 *     "clientBuildCommit": "<40-hex commit P>",
 *     "repo": "https://github.com/heswy/dsh-game-market",
 *     "artifacts": {
 *       "algorithm": "sha256-tree-v1",
 *       "roots": ["client.js", "games", "registry"],
 *       "sha256": "<64-hex>",
 *       "files": 42,
 *       "bytes": 1234567
 *     }
 *   }
 *
 * Why this file exists (and why `clientBuildCommit` is not the release commit):
 * a committed file cannot contain the hash of the commit that contains it.
 * The release commit R therefore declares `clientBuildCommit = P`, the version
 * commit its artifacts were built from. The Host runs R and reads this file to
 * know which Client build identity it expects; the Client embeds P at build
 * time. This is Q2 in m3-decisions §7.
 *
 * This module is the single validator for the file; it is reused by
 * `release:prepare`, `release:promote`, `release:verify`, and
 * `scripts/check.mjs`. It never writes anything.
 */
import {
  ARTIFACT_DIGEST_ALGORITHM,
  ARTIFACT_ROOTS,
  RELEASE_IDENTITY_PATH,
  RELEASE_SCHEMA_VERSION,
  REPO_URL,
} from './constants.mjs';
import { ReleaseError } from './errors.mjs';
import { isValidVersion } from './semver.mjs';

const COMMIT_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

const ROOT_KEYS = new Set(['schemaVersion', 'version', 'repo', 'clientBuildCommit', 'artifacts', 'builtAt']);
const ARTIFACT_KEYS = new Set(['algorithm', 'roots', 'sha256', 'files', 'bytes']);

export { RELEASE_IDENTITY_PATH };

/**
 * Build the release identity document (deterministic key order, no timestamps).
 *
 * @param {{version: string, clientBuildCommit: string, artifacts: {sha256: string, files: number, bytes: number}}} input
 */
export function buildReleaseIdentity({ version, clientBuildCommit, artifacts }) {
  return {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    version,
    clientBuildCommit,
    repo: REPO_URL,
    artifacts: {
      algorithm: ARTIFACT_DIGEST_ALGORITHM,
      roots: [...ARTIFACT_ROOTS],
      sha256: artifacts.sha256,
      files: artifacts.files,
      bytes: artifacts.bytes,
    },
  };
}

/** Deterministic serialisation: two-space JSON, trailing newline. */
export function serializeReleaseIdentity(identity) {
  return `${JSON.stringify(identity, null, 2)}\n`;
}

/**
 * Validate a parsed release identity document.
 *
 * @param {unknown} value
 * @param {{requireArtifacts?: boolean, expect?: {version?: string, clientBuildCommit?: string}}} [options]
 * @returns {{ok: boolean, errors: Array<{code: string, message: string, path: string}>}}
 */
export function validateReleaseIdentity(value, options = {}) {
  const errors = [];
  const add = (code, message, path = '$') => errors.push({ code, message, path });

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    add('E_RELEASE_IDENTITY_SHAPE', 'must be a JSON object');
    return { ok: false, errors };
  }
  for (const key of Object.keys(value)) {
    if (!ROOT_KEYS.has(key)) add('E_RELEASE_IDENTITY_UNKNOWN_KEY', `unexpected member ${JSON.stringify(key)}`, `$.${key}`);
  }
  if (value.schemaVersion !== RELEASE_SCHEMA_VERSION) {
    add('E_RELEASE_IDENTITY_SCHEMA', `schemaVersion must be ${String(RELEASE_SCHEMA_VERSION)}`, '$.schemaVersion');
  }
  if (!isValidVersion(value.version)) {
    add('E_RELEASE_IDENTITY_VERSION', 'version must be an exact SemVer 2.0.0 version', '$.version');
  }
  if (value.repo !== REPO_URL) {
    add('E_RELEASE_IDENTITY_REPO', `repo must be ${REPO_URL}`, '$.repo');
  }
  if (typeof value.clientBuildCommit !== 'string' || !COMMIT_RE.test(value.clientBuildCommit)) {
    add('E_RELEASE_IDENTITY_COMMIT', 'clientBuildCommit must be a lowercase 40-hex commit SHA', '$.clientBuildCommit');
  }
  if (value.builtAt !== undefined && (typeof value.builtAt !== 'string' || !ISO_RE.test(value.builtAt))) {
    add('E_RELEASE_IDENTITY_BUILT_AT', 'builtAt must be an ISO-8601 timestamp when present', '$.builtAt');
  }
  const requireArtifacts = options.requireArtifacts !== false;
  if (value.artifacts === undefined) {
    if (requireArtifacts) add('E_RELEASE_IDENTITY_ARTIFACTS', 'artifacts is required', '$.artifacts');
  } else if (typeof value.artifacts !== 'object' || value.artifacts === null || Array.isArray(value.artifacts)) {
    add('E_RELEASE_IDENTITY_ARTIFACTS', 'artifacts must be an object', '$.artifacts');
  } else {
    const artifacts = value.artifacts;
    for (const key of Object.keys(artifacts)) {
      if (!ARTIFACT_KEYS.has(key)) add('E_RELEASE_IDENTITY_ARTIFACTS', `unexpected artifacts member ${JSON.stringify(key)}`, `$.artifacts.${key}`);
    }
    if (artifacts.algorithm !== ARTIFACT_DIGEST_ALGORITHM) {
      add('E_RELEASE_IDENTITY_ARTIFACTS', `artifacts.algorithm must be ${JSON.stringify(ARTIFACT_DIGEST_ALGORITHM)}`, '$.artifacts.algorithm');
    }
    if (!Array.isArray(artifacts.roots)
      || artifacts.roots.length !== ARTIFACT_ROOTS.length
      || artifacts.roots.some((root, index) => root !== ARTIFACT_ROOTS[index])) {
      add('E_RELEASE_IDENTITY_ARTIFACTS', `artifacts.roots must be exactly ${JSON.stringify(ARTIFACT_ROOTS)}`, '$.artifacts.roots');
    }
    if (typeof artifacts.sha256 !== 'string' || !SHA256_RE.test(artifacts.sha256)) {
      add('E_RELEASE_IDENTITY_ARTIFACTS', 'artifacts.sha256 must be a lowercase 64-hex digest', '$.artifacts.sha256');
    }
    if (!Number.isSafeInteger(artifacts.files) || artifacts.files < 1) {
      add('E_RELEASE_IDENTITY_ARTIFACTS', 'artifacts.files must be a positive integer', '$.artifacts.files');
    }
    if (!Number.isSafeInteger(artifacts.bytes) || artifacts.bytes < 0) {
      add('E_RELEASE_IDENTITY_ARTIFACTS', 'artifacts.bytes must be a non-negative integer', '$.artifacts.bytes');
    }
  }

  const expect = options.expect || {};
  if (expect.version !== undefined && value.version !== expect.version) {
    add('E_RELEASE_IDENTITY_VERSION', `version ${JSON.stringify(value.version)} does not match expected ${JSON.stringify(expect.version)}`, '$.version');
  }
  if (expect.clientBuildCommit !== undefined && value.clientBuildCommit !== expect.clientBuildCommit) {
    add('E_RELEASE_IDENTITY_COMMIT', 'clientBuildCommit does not match the expected build commit', '$.clientBuildCommit');
  }

  return { ok: errors.length === 0, errors };
}

/** Throw the first validation error as a `ReleaseError`. */
export function assertReleaseIdentity(value, options = {}) {
  const result = validateReleaseIdentity(value, options);
  if (result.ok) return value;
  const first = result.errors[0];
  throw new ReleaseError(first.code, `${first.path}: ${first.message}`, {
    guidance: 'release.json is generated by `npm run release:prepare --write`; never hand-edit it',
    details: { errors: result.errors },
  });
}

export function isFullCommit(value) {
  return typeof value === 'string' && COMMIT_RE.test(value);
}
