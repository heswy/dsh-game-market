/**
 * Activation-frozen Host running identity (docs/V1.5-CONTRACTS.md §9,
 * m3-decisions §4).
 *
 * The update protocol compares *running* identities, never disk versions. The
 * bundle version is frozen when the plugin is activated (`readBundleVersion()`
 * of the running code) and the running commit is parsed **once** at activation
 * from the profile dependency spec. `/health` and `inspect().installed` reuse
 * this frozen value; a package change on disk therefore never masquerades as a
 * running version (M0 measured exactly that mismatch on non-HMR profiles).
 *
 * Profile discovery is best-effort and defensive: a missing/ambiguous profile is
 * reported as `identitySource:'unknown'` with `buildCommit:null`, never guessed.
 * Explicit `config.platformUpdate.profileDir` wins (tests/isolated probes).
 */

import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BUNDLE_ID } from '../../shared/src/constants.js';
import {
  PLATFORM_UPDATE_RELEASE_FILE,
  parseProfileDependencyCommit,
  parseReleaseManifest,
  profileDependencySpecShape,
} from '../../shared/src/platform-update.js';

const BUNDLE_ROOT_URL = new URL('../../../', import.meta.url);

function readJsonFileSync(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function realpathOrNull(target) {
  try {
    return realpathSync(target);
  } catch (_error) {
    return null;
  }
}

function readProfileDependencies(profileDir) {
  const manifest = readJsonFileSync(path.join(profileDir, 'package.json'));
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return null;
  const dependencies = manifest.dependencies;
  if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) return {};
  return dependencies;
}

function localSpecTarget(directory, spec) {
  if (typeof spec !== 'string') return null;
  let value = spec.trim();
  if (value.startsWith('link:')) value = value.slice('link:'.length);
  if (/^file:/i.test(value)) {
    try {
      return realpathOrNull(fileURLToPath(value));
    } catch (_error) {
      return null;
    }
  }
  if (path.isAbsolute(value)) return realpathOrNull(value);
  if (value.startsWith('.')) return realpathOrNull(path.resolve(directory, value));
  return null;
}

function profilePatchMentions(profileDir, bundleRoot) {
  let text;
  try {
    text = readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8');
  } catch (_error) {
    return false;
  }
  if (typeof bundleRoot !== 'string' || bundleRoot.length === 0) return false;
  if (text.includes(bundleRoot)) return true;
  try {
    return text.includes(pathToFileURL(bundleRoot).href);
  } catch (_error) {
    return false;
  }
}

/**
 * Find the profile this running bundle belongs to.
 *
 * 1. explicit `settings.platformUpdate.profileDir` (configuration/test seam);
 * 2. profiles whose `node_modules/<bundle>` realpath equals the running bundle;
 * 3. the only profile declaring a `dsh-game-market` dependency;
 * 4. a profile whose patch layer loads the running bundle by `file:` URL (dev row).
 *
 * @returns {{dir:string|null, source:'config'|'installed'|'single-profile'|'dev-row'|'unknown', dependencies:object|null, devSource:boolean}}
 */
export function discoverProfile({ env = process.env, settings = {}, bundleRoot = resolveBundleRoot() } = {}) {
  const configured = settings?.platformUpdate?.profileDir;
  if (typeof configured === 'string' && configured.length > 0) {
    const dependencies = readProfileDependencies(configured);
    if (dependencies !== null) {
      return { dir: configured, source: 'config', dependencies, devSource: profilePatchMentions(configured, bundleRoot) || ['path', 'file'].includes(profileDependencySpecShape(dependencies[BUNDLE_ID])) };
    }
  }

  const home = resolveDshHome(env);
  const profilesDir = path.join(home, 'profiles');
  let entries;
  try {
    entries = readdirSync(profilesDir, { withFileTypes: true });
  } catch (_error) {
    return { dir: null, source: 'unknown', dependencies: null, devSource: false };
  }
  const profiles = [];
  for (const entry of entries) {
    if (!entry || entry.isDirectory() !== true) continue;
    const dir = path.join(profilesDir, entry.name);
    let stats;
    try {
      stats = statSync(dir);
    } catch (_error) {
      continue;
    }
    if (!stats.isDirectory()) continue;
    const dependencies = readProfileDependencies(dir);
    if (dependencies === null) continue;
    profiles.push({ dir, dependencies });
  }

  const bundleReal = realpathOrNull(bundleRoot);
  const declared = profiles.filter((profile) => Object.prototype.hasOwnProperty.call(profile.dependencies, BUNDLE_ID));
  if (bundleReal !== null) {
    for (const profile of declared) {
      const installed = realpathOrNull(path.join(profile.dir, 'node_modules', BUNDLE_ID));
      if (installed !== null && installed === bundleReal) {
        return { dir: profile.dir, source: 'installed', dependencies: profile.dependencies, devSource: false };
      }
    }
  }
  if (declared.length === 1) {
    const spec = declared[0].dependencies[BUNDLE_ID];
    const shape = profileDependencySpecShape(spec);
    const target = localSpecTarget(declared[0].dir, spec);
    const devSource = shape === 'path' || shape === 'file' || (bundleReal !== null && target === bundleReal) || profilePatchMentions(declared[0].dir, bundleRoot);
    return { dir: declared[0].dir, source: 'single-profile', dependencies: declared[0].dependencies, devSource };
  }
  // Multiple (or zero) declared profiles: only a dev row that points at the
  // running checkout identifies the profile without guessing.
  for (const profile of profiles) {
    if (profilePatchMentions(profile.dir, bundleRoot)) {
      const spec = profile.dependencies[BUNDLE_ID] ?? null;
      const shape = profileDependencySpecShape(spec);
      // A dev row means the profile loads the running checkout by `file:` URL;
      // whether or not a package dependency is also declared, the running code
      // is a development source and must never be silently migrated.
      return {
        dir: profile.dir,
        source: 'dev-row',
        dependencies: profile.dependencies,
        devSource: true,
        specShapeHint: shape,
      };
    }
  }
  return { dir: null, source: 'unknown', dependencies: null, devSource: false };
}

/** `$DSH_HOME` (default `~/.dsh`). */
export function resolveDshHome(env = process.env) {
  try {
    const configured = env && typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
    return configured.length > 0 ? path.resolve(configured) : path.join(homedir(), '.dsh');
  } catch (_error) {
    return path.join(process.cwd(), '.dsh');
  }
}

/** Absolute bundle (package) root of the running code. */
export function resolveBundleRoot() {
  try {
    return path.resolve(fileURLToPath(BUNDLE_ROOT_URL));
  } catch (_error) {
    return path.resolve(process.cwd());
  }
}

/** Read the release identity shipped in the running bundle (or null). */
export function readOwnRelease(bundleRoot = resolveBundleRoot()) {
  const file = path.join(bundleRoot, PLATFORM_UPDATE_RELEASE_FILE);
  const raw = readJsonFileSync(file);
  if (raw === null) return { release: null, error: null };
  const parsed = parseReleaseManifest(raw);
  if (!parsed.ok) return { release: null, error: parsed.code };
  return { release: parsed.value, error: null };
}

function readInstalledDiskVersion(profileDir) {
  if (typeof profileDir !== 'string') return null;
  const manifest = readJsonFileSync(path.join(profileDir, 'node_modules', BUNDLE_ID, 'package.json'));
  if (manifest === null || typeof manifest !== 'object') return null;
  return typeof manifest.version === 'string' && manifest.version.length > 0 ? manifest.version : null;
}

/**
 * Build the Host identity snapshot used by `/health` and `inspect()`.
 *
 * @param {{env?: object, settings?: object, version?: string, now?: () => Date, logger?: object, bundleRoot?: string}} [options]
 */
export function createHostIdentity({
  env = process.env,
  settings = {},
  version = '0.0.0',
  now = () => new Date(),
  logger = null,
  bundleRoot = resolveBundleRoot(),
} = {}) {
  const loadedAt = now().toISOString();
  const profile = discoverProfile({ env, settings, bundleRoot });
  const ownRelease = readOwnRelease(bundleRoot);
  const release = ownRelease.release;
  // The browser bundle is built from the version commit P; a release manifest
  // only describes *this* running version, otherwise it is stale and ignored.
  const releaseMatchesVersion = release !== null && release.version === version;
  if (release !== null && !releaseMatchesVersion) {
    logger?.warn?.('[game-market/host] release-identity-mismatch', `field=version`);
  }
  const expectedClient = releaseMatchesVersion
    ? { buildVersion: release.version, buildCommit: release.clientBuildCommit }
    : { buildVersion: version, buildCommit: null };

  function activationSpec() {
    if (profile.dependencies === null) return null;
    const spec = profile.dependencies[BUNDLE_ID];
    return typeof spec === 'string' ? spec : null;
  }

  const specAtActivation = activationSpec();
  const buildCommit = profile.devSource ? null : parseProfileDependencyCommit(specAtActivation);
  const initialShape = profileDependencySpecShape(specAtActivation);

  /**
   * Current disk-side view for `inspect().installed`. `loadedVersion`/
   * `loadedCommit` are frozen; only `version` (disk) and `spec` are re-read.
   */
  function snapshot() {
    const currentDependencies = profile.dir === null ? null : readProfileDependencies(profile.dir);
    const spec =
      currentDependencies !== null && typeof currentDependencies[BUNDLE_ID] === 'string'
        ? currentDependencies[BUNDLE_ID]
        : specAtActivation;
    const specShape = profileDependencySpecShape(spec);
    const diskVersion = readInstalledDiskVersion(profile.dir);
    return {
      bundleId: BUNDLE_ID,
      spec,
      specShape,
      version: diskVersion,
      enabled: null,
      loadedVersion: version,
      loadedCommit: buildCommit,
      devRowShadow: profile.devSource === true || specShape === 'path' || specShape === 'file',
      profileDir: profile.dir,
      profileSource: profile.source,
      specCommit: profile.devSource ? null : parseProfileDependencyCommit(spec),
      diskVersion,
    };
  }

  return {
    bundleId: BUNDLE_ID,
    loadedVersion: version,
    buildCommit,
    loadedAt,
    hostEpoch: null,
    profileDir: profile.dir,
    profileSource: profile.source,
    specAtActivation,
    specShapeAtActivation: initialShape,
    devSource: profile.devSource === true,
    release: releaseMatchesVersion ? release : null,
    releaseError: ownRelease.error ?? (release !== null && !releaseMatchesVersion ? 'E_RELEASE_VERSION_MISMATCH' : null),
    expectedClient,
    snapshot,
  };
}
