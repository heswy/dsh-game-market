/**
 * package.json / browser-bundle gates for an installable platform release.
 *
 * `release:prepare` validates the version commit P; `release:promote` repeats
 * the same gates against the release commit R *from git objects* (never from
 * the working tree). `scripts/check.mjs` reuses the `files` coverage check so
 * the npm whitelist and the release identity cannot drift apart.
 */
import {
  CLIENT_IDENTITY_PREFIX,
  PLUGIN_NAME,
  REQUIRED_PACKAGE_FILES,
} from './constants.mjs';
import { fail } from './errors.mjs';
import { isPrerelease, isValidComparatorRange, isValidVersion, satisfiesSimpleRange } from './semver.mjs';

/**
 * Validate the plugin package manifest shipped in a release bundle.
 *
 * @param {object} pkg parsed package.json
 * @param {{where?: string}} [options]
 * @returns {Array<{code: string, message: string}>}
 */
export function validateReleasePackage(pkg, options = {}) {
  const where = options.where || 'package.json';
  const errors = [];
  const add = (code, message) => errors.push({ code, message: `${where}: ${message}` });
  if (typeof pkg !== 'object' || pkg === null || Array.isArray(pkg)) {
    add('E_RELEASE_PACKAGE', 'must be a JSON object');
    return errors;
  }
  if (pkg.name !== PLUGIN_NAME) add('E_RELEASE_PACKAGE_NAME', `name must be "${PLUGIN_NAME}"`);
  if (!isValidVersion(pkg.version)) add('E_RELEASE_PACKAGE_VERSION', 'version must be an exact SemVer 2.0.0 version');
  if (pkg.type !== 'module') add('E_RELEASE_PACKAGE_TYPE', 'type must be "module"');
  if (pkg.main !== 'index.js') add('E_RELEASE_PACKAGE_MAIN', 'main must be "index.js"');
  if (pkg.private !== true) add('E_RELEASE_PACKAGE_PRIVATE', 'private must stay true (git installs do not require a public npm package)');
  if (pkg.exports === undefined || pkg.exports['./client'] !== './client.js') {
    add('E_RELEASE_PACKAGE_EXPORTS', 'exports["./client"] must point at "./client.js"');
  }
  if (!pkg.dsh || !pkg.dsh.bundle || typeof pkg.dsh.bundle.patch !== 'string' || pkg.dsh.bundle.patch.length === 0) {
    add('E_RELEASE_PACKAGE_BUNDLE', 'dsh.bundle.patch must declare the bundle patch file');
  }
  if (!pkg.dsh || !pkg.dsh.client || pkg.dsh.client.platform !== 'web') {
    add('E_RELEASE_PACKAGE_CLIENT', 'dsh.client.platform must be "web"');
  }
  const engines = pkg.engines;
  if (!engines || typeof engines !== 'object') {
    add('E_RELEASE_ENGINES', 'engines must declare node and dsh ranges');
  } else {
    if (typeof engines.node !== 'string' || !isValidComparatorRange(engines.node)) {
      add('E_RELEASE_ENGINES', 'engines.node must be a SemVer range (e.g. ">=20")');
    } else {
      const satisfied = satisfiesSimpleRange(process.versions.node, engines.node);
      if (satisfied === false) {
        add('E_RELEASE_ENGINES', `the release tooling runs on Node ${process.versions.node}, which does not satisfy engines.node ${JSON.stringify(engines.node)}`);
      }
    }
    if (typeof engines.dsh !== 'string' || !isValidComparatorRange(engines.dsh)) {
      add('E_RELEASE_ENGINES', 'engines.dsh must be a SemVer range (e.g. ">=0.2.0 <0.3.0")');
    } else if (engines.dsh.trim().startsWith('workspace:')) {
      add('E_RELEASE_ENGINES', 'engines.dsh must not be a workspace: range');
    }
  }
  return errors;
}

/** Assert `validateReleasePackage` and throw a `ReleaseError` for the first problem. */
export function assertReleasePackage(pkg, options = {}) {
  const errors = validateReleasePackage(pkg, options);
  if (errors.length > 0) {
    const first = errors[0];
    fail(first.code, first.message, {
      guidance: 'fix package.json before preparing a release; the installed bundle must stay installable via the native git path',
      details: { errors },
    });
  }
  return pkg;
}

/** The exact engines.dsh range emitted into the plugin index. */
export function engineDshFromPackage(pkg) {
  return pkg && pkg.engines ? pkg.engines.dsh : undefined;
}

/**
 * npm `files` whitelist coverage.
 *
 * `files` has no directory-prefix inheritance for our purposes (npm packs a
 * listed directory recursively), so a listed `games/**`, `games` or `games/`
 * all cover `games/anything`. Kept deliberately small: exact entries and
 * `dir/**` prefixes, which is all this repository uses.
 *
 * @param {string[]} files
 * @param {string[]} required
 * @returns {string[]} required entries not covered by the whitelist
 */
export function missingPackageFiles(files, required = REQUIRED_PACKAGE_FILES) {
  const patterns = Array.isArray(files) ? files : [];
  return required.filter((target) => !patterns.some((pattern) => patternCovers(pattern, target)));
}

function patternCovers(pattern, target) {
  if (typeof pattern !== 'string' || pattern.length === 0) return false;
  if (pattern === target) return true;
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return target === prefix || target.startsWith(`${prefix}/`);
  }
  if (pattern.endsWith('/')) return target.startsWith(pattern);
  if (pattern.endsWith('*')) return target.startsWith(pattern.slice(0, -1));
  // npm also packs a listed directory recursively (`games` covers `games/x`).
  return target.startsWith(`${pattern}/`);
}

/** Assert the bundle `files` whitelist ships everything a release needs. */
export function assertPackageFiles(pkg) {
  const missing = missingPackageFiles(pkg && pkg.files);
  if (missing.length > 0) {
    fail('E_RELEASE_FILES_INCOMPLETE', `package.json files whitelist is missing release entries: ${missing.join(', ')}`, {
      guidance: `add them to package.json "files" so an installed git bundle carries the build artifacts and release identity (${missing.join(', ')})`,
      details: { missing },
    });
  }
}

/**
 * Read the identity banner that `scripts/build-client.mjs` embeds into client.js.
 * Missing banner => the Client cannot report its own build identity and the
 * two-sided verification in decisions §4 is impossible.
 *
 * @param {string} bundleText
 * @returns {{version: string, buildCommit: string|null}|null}
 */
export function clientIdentityFromBundle(bundleText) {
  if (typeof bundleText !== 'string') return null;
  const line = bundleText
    .split('\n')
    .slice(0, 40)
    .find((candidate) => candidate.includes(CLIENT_IDENTITY_PREFIX));
  if (!line) return null;
  const versionMatch = /version=([^\s]+)/u.exec(line);
  const commitMatch = /buildCommit=([^\s]+)/u.exec(line);
  if (!versionMatch || !commitMatch) return null;
  const buildCommit = commitMatch[1] === 'none' ? null : commitMatch[1];
  return { version: versionMatch[1], buildCommit };
}

/**
 * Assert the browser bundle carries the expected release identity.
 *
 * @param {string} bundleText client.js content
 * @param {{version: string, clientBuildCommit: string, where?: string}} expected
 */
export function assertClientIdentity(bundleText, expected) {
  const where = expected.where || 'client.js';
  if (typeof bundleText !== 'string' || !bundleText.includes('__ModuleLoader__.load')) {
    fail('E_RELEASE_CLIENT_IDENTITY_MISSING', `${where} is not a DSH module-loader bundle`, {
      guidance: 'rebuild with `npm run build` and commit the generated client.js',
    });
  }
  const identity = clientIdentityFromBundle(bundleText);
  if (!identity) {
    fail('E_RELEASE_CLIENT_IDENTITY_MISSING', `${where} has no "${CLIENT_IDENTITY_PREFIX}" banner`, {
      guidance: 'scripts/build-client.mjs must embed `version` + `clientBuildCommit` from platform-updates/release.json (decisions §4); coordinate with the client-ui owner',
    });
  }
  if (identity.version !== expected.version) {
    fail('E_RELEASE_CLIENT_IDENTITY_MISSING', `${where} embeds version ${JSON.stringify(identity.version)}, expected ${JSON.stringify(expected.version)}`, {
      guidance: 'release.json.version and package.json.version must agree; rebuild after writing release.json',
    });
  }
  if (identity.buildCommit !== expected.clientBuildCommit) {
    fail('E_RELEASE_CLIENT_IDENTITY_MISSING', `${where} embeds buildCommit ${JSON.stringify(identity.buildCommit)}, expected ${JSON.stringify(expected.clientBuildCommit)}`, {
      guidance: 'the Client must embed release.json.clientBuildCommit (the version commit P), not the release commit hash',
    });
  }
  return identity;
}

export { isPrerelease };
