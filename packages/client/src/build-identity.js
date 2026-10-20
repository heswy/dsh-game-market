/**
 * Build identity of the Client bundle (V1.5 contract §4 / m3-decisions §4).
 *
 * `scripts/build-client.mjs` replaces the RAW_IDENTITY literal below at build
 * time with a JSON object:
 *
 *   { version: <package.json version>, buildCommit: <platform-updates/release.json.clientBuildCommit | null> }
 *
 * The identity MUST come from the built bundle only. It is never derived from
 * Host responses, `/health`, or the running Host version: an old Client talking
 * to a new Host has to report its own (old) identity so the Host can detect
 * `stale-runtime(client-old)`. The unbundled source keeps the placeholder, which
 * parses as "not embedded" so a mis-built bundle fails closed instead of
 * claiming a version.
 */

/** Replaced at build time; keep the assignment on one line. */
const RAW_IDENTITY = '__DGM_CLIENT_BUILD_IDENTITY__';

// Mirrors packages/shared/src/platform-update.js SEMVER_RE (no leading zeros,
// standard prerelease/build identifiers). packages/client/test/update-contract-mirror.test.js
// keeps the two in sync.
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const FULL_COMMIT_RE = /^[a-f0-9]{40}$/;

export const BUILD_IDENTITY_TOKEN = '__DGM_CLIENT_BUILD_IDENTITY__';

/** True for a full lowercase 40-hex git commit. */
export function isBuildCommit(value) {
  return typeof value === 'string' && FULL_COMMIT_RE.test(value);
}

/** True for a plain / prerelease semver version string. */
export function isBuildVersion(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && SEMVER_RE.test(value);
}

/**
 * Normalize one build identity record.
 * Missing/invalid fields degrade to null (never guessed).
 * @returns {{version: string|null, buildCommit: string|null, embedded: boolean}}
 */
export function normalizeBuildIdentity(source) {
  const input = source && typeof source === 'object' ? source : {};
  const version = isBuildVersion(input.version) ? input.version : null;
  const buildCommit = isBuildCommit(input.buildCommit) ? input.buildCommit : null;
  return Object.freeze({ version: version, buildCommit: buildCommit, embedded: version !== null });
}

/**
 * Parse the embedded literal. In the unbundled source this is the placeholder
 * token, which is deliberately reported as "not embedded" rather than as a
 * made-up version.
 */
export function parseBuildIdentity(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return normalizeBuildIdentity(null);
  if (raw === BUILD_IDENTITY_TOKEN) return normalizeBuildIdentity(null);
  try {
    return normalizeBuildIdentity(JSON.parse(raw));
  } catch (_error) {
    return normalizeBuildIdentity(null);
  }
}

/** Parse/validate the optional `platform-updates/release.json` document. */
export function parseReleaseIdentity(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return { ok: false, error: 'release.json is not an object' };
  }
  if (document.schemaVersion !== 1) {
    return { ok: false, error: 'release.json schemaVersion must be 1' };
  }
  if (!isBuildVersion(document.version)) {
    return { ok: false, error: 'release.json version must be a semver string' };
  }
  if (document.clientBuildCommit !== null && document.clientBuildCommit !== undefined && !isBuildCommit(document.clientBuildCommit)) {
    return { ok: false, error: 'release.json clientBuildCommit must be a full 40-hex commit or null' };
  }
  return {
    ok: true,
    version: document.version,
    clientBuildCommit: isBuildCommit(document.clientBuildCommit) ? document.clientBuildCommit : null,
  };
}

/** The identity compiled into this bundle (placeholder before a real build). */
export const CLIENT_BUILD = parseBuildIdentity(RAW_IDENTITY);

/** Build the JSON literal the build script substitutes for RAW_IDENTITY. */
export function serializeBuildIdentity(version, buildCommit) {
  const normalized = normalizeBuildIdentity({ version: version, buildCommit: buildCommit });
  if (!normalized.embedded) throw new Error('serializeBuildIdentity requires a valid version');
  return JSON.stringify({ version: normalized.version, buildCommit: normalized.buildCommit });
}
