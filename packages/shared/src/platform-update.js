/**
 * V1.5 platform update contracts (docs/V1.5-CONTRACTS.md §9,
 * docs/verification/v1.5/m3-decisions.md §2–§4).
 *
 * This module is pure JS (no Node built-ins, no network, no I/O). It owns:
 *
 *   1. the frozen discovery policy constants (fixed official index URL, size,
 *      timing, channels, cache/operation/release file names);
 *   2. a strict validator for the official **DSH plugin-market index format 1**
 *      document (README of `@deepseek-ai/dsh-plugin-market-index`; Q1's fallback
 *      implementation — the public parser is preferred when reachable, but the
 *      frozen URL/shape rules must hold either way);
 *   3. target binding for `dsh-game-market` only: git source, exact 40-hex
 *      commit, canonical repository URL, exact SemVer; stable excludes
 *      prereleases, the test channel is explicit opt-in;
 *   4. target identity: deterministic opaque `targetId` + the exact install spec
 *      the adapter may construct (`https://github.com/...git#<commit>`);
 *   5. the release identity shipped in `platform-updates/release.json` and the
 *      profile-dependency spec helpers needed to freeze the Host running
 *      identity (commit/specShape);
 *   6. the frozen `UpdateObservation` state vocabulary and reason keys.
 *
 * Validation helpers follow the M1 shared convention: `{ok:true, value}` on
 * success and `{ok:false, code, details?}` on rejection, where `code` is an
 * internal `E_*` translated by `errors.js#INTERNAL_TO_GM`.
 */

import { BUNDLE_ID } from './constants.js';

/** Height of the frozen GET /platform-update payload (`schemaVersion`). */
export const PLATFORM_UPDATE_SCHEMA_VERSION = 1;

/** DSH plugin-market index document format implemented by this module. */
export const PLATFORM_UPDATE_INDEX_FORMAT = 1;

/**
 * The one fixed official index URL (m3-decisions §3). Intentionally a constant:
 * there is no configuration surface that can replace it (the transport seam is
 * a code-level test/probe hook, never a product setting).
 */
export const PLATFORM_UPDATE_INDEX_URL =
  'https://raw.githubusercontent.com/heswy/dsh-game-market/main/platform-updates/plugins.json';

/** The only repository the official index may point the update at. */
export const PLATFORM_UPDATE_REPOSITORY = Object.freeze({
  owner: 'heswy',
  name: 'dsh-game-market',
  /** Canonical HTTPS clone URL; `.git` is part of the frozen install shape. */
  url: 'https://github.com/heswy/dsh-game-market.git',
});

/** Largest accepted index document (m3-decisions §3). */
export const PLATFORM_UPDATE_INDEX_MAX_BYTES = 256 * 1024;

/** Cache file under `$DSH_HOME/storages/dsh-game-market/` (atomic JSON). */
export const PLATFORM_UPDATE_CACHE_FILE = 'platform-update-cache.json';

/** Persisted in-flight/terminal update record (recovery across HMR dispose). */
export const PLATFORM_UPDATE_OPERATION_FILE = 'platform-update-operation.json';

/** Release identity file shipped inside the installed bundle (m3-decisions §4). */
export const PLATFORM_UPDATE_RELEASE_FILE = 'platform-updates/release.json';
export const PLATFORM_UPDATE_RELEASE_SCHEMA_VERSION = 1;

/** Discovery channels: stable is the default; test must be explicitly opted in. */
export const PLATFORM_UPDATE_CHANNELS = Object.freeze(['stable', 'test']);
export const PLATFORM_UPDATE_DEFAULT_CHANNEL = 'stable';

/**
 * Timing policy. Values are frozen by the contract; tests may override a subset
 * through the Host test seam (`http.platformUpdateTiming`), production never.
 */
export const PLATFORM_UPDATE_TIMING = Object.freeze({
  /** Whole index fetch budget (connect + body), m3-decisions §3. */
  indexConnectMs: 5000,
  indexTotalMs: 5000,
  indexIdleMs: 5000,
  /** Redirect budget; `http` downgrade is never allowed (download.js enforces). */
  maxRedirects: 3,
  /** A silent startup check runs when the last attempt is older than this. */
  startupCheckMs: 6 * 60 * 60 * 1000,
  /** Manual refresh throttle (POST /platform-update/refresh). */
  manualRefreshThrottleMs: 60 * 1000,
  /** Automatic retry backoff after a failed check (keeps offline state fresh). */
  failureRetryMs: 5 * 60 * 1000,
  /** Coordination window: all active runtime instances must pause+save in time. */
  coordinateTimeoutMs: 15000,
  /** After an HMR install, how long to wait for the Host running identity to move. */
  activationHostWaitMs: 30000,
  /** After the Host identity matches, how long to wait for a matching client report. */
  activationClientWaitMs: 60000,
  /** Recovery: how long to wait for waitForInstall()/disk state after a restart. */
  recoveryProbeMs: 5000,
  recoveryPollMs: 250,
  /** Client reports older than this no longer count as a live window. */
  clientReportTtlMs: 120000,
  /** HMR capability probe cadence (contract §9.2). */
  hmrProbeIntervalMs: 250,
  hmrProbeTimeoutMs: 5000,
  /** How long a missing service must be observed before it means "absent". */
  hmrAbsenceSettleMs: 2500,
});

/** `capability.reasonKey` values (Client localizes; Host never localizes). */
export const PLATFORM_UPDATE_REASON_KEYS = Object.freeze({
  ADAPTER_UNAVAILABLE: 'update.reason.adapterUnavailable',
  HMR_UNKNOWN: 'update.reason.hmrUnknown',
  DEV_SOURCE: 'update.reason.devSource',
  NO_TARGET: 'update.reason.noTarget',
  VERSION_COMMIT_ANOMALY: 'update.reason.versionCommitAnomaly',
  ALREADY_AT_TARGET: 'update.reason.alreadyAtTarget',
});

/** `inspect().capability.updatePath` values. */
export const PLATFORM_UPDATE_PATHS = Object.freeze(['in-place-hmr', 'restart-required', 'unsupported']);

/**
 * The only states the update observation union may use (contract §9.1/§9.5.1).
 * `applied` is an intermediate state and MUST NOT be rendered as success.
 */
export const PLATFORM_UPDATE_STATES = Object.freeze([
  'inspecting',
  'installing',
  'applied',
  'activating',
  'updated',
  'pending-restart',
  'already-at-target',
  'verification-failed',
  'stale-runtime',
  'too-late',
  'cancelled',
  'failed',
]);

/** Terminal states retained until the next `beginUpdate` (contract §9.1). */
export const PLATFORM_UPDATE_TERMINAL_STATES = Object.freeze([
  'updated',
  'pending-restart',
  'already-at-target',
  'verification-failed',
  'stale-runtime',
  'cancelled',
  'failed',
]);

/** `installed.specShape` vocabulary (contract §9.1). */
export const UPDATE_SPEC_SHAPES = Object.freeze(['git-url', 'registry', 'path', 'file', 'unknown']);

/** `verification-failed.reason` / `stale-runtime.reason` vocabularies. */
export const VERIFICATION_FAILED_REASONS = Object.freeze([
  'response-lost',
  'version-mismatch',
  'ambiguous-install',
]);
export const STALE_RUNTIME_REASONS = Object.freeze([
  'client-old',
  'host-old',
  'dev-row-shadows-package',
]);

/** Opaque discovery targets: `tgt_` + 16 lowercase hex. */
export const UPDATE_TARGET_ID_PATTERN = /^tgt_[a-f0-9]{16}$/;
/** Operation ids: `upd_` + 16 lowercase hex (also the plugin-manager requestId core). */
export const UPDATE_OPERATION_ID_PATTERN = /^upd_[a-f0-9]{16}$/;

const COMMIT_RE = /^[0-9a-f]{40}$/;
const PACKAGE_PATH_SEGMENT_RE = /^[A-Za-z0-9._@+-]+$/;
const LANGUAGE_ID_RE = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/;
const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const PACKAGE_NAME_MAX_LENGTH = 214;
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const MAX_PUBLISH_TIMESTAMP = 1e11;
const MAX_INLINE_ICON_BYTES = 32 * 1024;
const DATA_ICON_RE = /^data:(?:image\/svg\+xml|image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/]*={0,2})$/;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/* ------------------------------------------------------------------ *
 * SemVer (strict, SemVer 2.0.0 grammar; also used for ordering)
 * ------------------------------------------------------------------ */

function parsePrereleaseIdentifiers(text) {
  if (text === undefined) return [];
  return text.split('.');
}

function numericIdentifier(value) {
  return /^\d+$/.test(value) ? Number(value) : null;
}

/**
 * Parse one exact SemVer 2.0.0 version.
 * @returns {{major:number,minor:number,patch:number,prerelease:string[],build:string|null,raw:string}|null}
 */
export function parseExactSemver(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) return null;
  const match = SEMVER_RE.exec(value);
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: parsePrereleaseIdentifiers(match[4]),
    build: match[5] === undefined ? null : match[5],
    raw: value,
  };
}

/** True for an exact SemVer version carrying a prerelease tag. */
export function isPrereleaseVersion(value) {
  const parsed = parseExactSemver(value);
  return parsed !== null && parsed.prerelease.length > 0;
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const aNumeric = numericIdentifier(a);
    const bNumeric = numericIdentifier(b);
    if (aNumeric !== null && bNumeric !== null) {
      if (aNumeric !== bNumeric) return aNumeric < bNumeric ? -1 : 1;
    } else if (aNumeric !== null) {
      return -1;
    } else if (bNumeric !== null) {
      return 1;
    } else if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return 0;
}

/** Compare two exact SemVer versions (ascending, SemVer precedence). */
export function compareExactSemver(left, right) {
  const a = typeof left === 'string' ? parseExactSemver(left) : left;
  const b = typeof right === 'string' ? parseExactSemver(right) : right;
  if (a === null || b === null) return 0;
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return comparePrerelease(a.prerelease, b.prerelease);
}

/* ------------------------------------------------------------------ *
 * Deterministic opaque ids (FNV-1a 64-bit; not a security boundary)
 * ------------------------------------------------------------------ */

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

function fnv1a64Hex(text) {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

/** True for a full lowercase 40-hex commit SHA (the only accepted pin form). */
export function isPinnedCommit(value) {
  return typeof value === 'string' && COMMIT_RE.test(value);
}

/** True for a well-formed opaque discovery target id. */
export function isUpdateTargetId(value) {
  return typeof value === 'string' && UPDATE_TARGET_ID_PATTERN.test(value);
}

/** True for a well-formed update operation id. */
export function isUpdateOperationId(value) {
  return typeof value === 'string' && UPDATE_OPERATION_ID_PATTERN.test(value);
}

/**
 * Derive the opaque target id for one `{version, commit}` pair.
 * Ids are not capability tokens: `beginUpdate` only accepts the id that matches
 * the currently validated discovery record.
 */
export function updateTargetIdFor(version, commit) {
  if (parseExactSemver(version) === null || !isPinnedCommit(commit)) return null;
  return `tgt_${fnv1a64Hex(`${BUNDLE_ID}@${version}#${commit}`)}`;
}

/**
 * The exact install spec the adapter may construct from a validated target.
 * M0's probe (`docs/verification/v1.5/plugin-update.md`) proved this HTTPS form
 * with an exact commit is applied by the native plugin manager during HMR; the
 * spec is deliberately NOT `git+https` (that is pnpm's recorded form) and it is
 * never derived from UI input.
 */
export function updateGitSpecForCommit(commit) {
  if (!isPinnedCommit(commit)) return null;
  return `${PLATFORM_UPDATE_REPOSITORY.url}#${commit}`;
}

/* ------------------------------------------------------------------ *
 * Profile dependency spec helpers (Host activation-frozen identity)
 * ------------------------------------------------------------------ */

function isAbsoluteLocalSpec(text) {
  if (text.startsWith('.') || text.startsWith('/') || text.startsWith('\\')) return true;
  if (/^[A-Za-z]:[\\/]/.test(text)) return true;
  return false;
}

/**
 * Classify the exact profile `package.json` dependency string recorded for this
 * bundle (`inspect().installed.specShape`).
 * @returns {'git-url'|'registry'|'path'|'file'|'unknown'}
 */
export function profileDependencySpecShape(spec) {
  if (typeof spec !== 'string') return 'unknown';
  const text = spec.trim();
  if (text.length === 0) return 'unknown';
  if (/^file:/i.test(text)) return 'file';
  if (/^(?:link|workspace|portal):/i.test(text)) return 'path';
  if (isAbsoluteLocalSpec(text)) return 'path';
  if (/^(?:git\+)?(?:https?|ssh|git):\/\//i.test(text)) return 'git-url';
  if (/^github:/i.test(text) || /^git@[^:\s]+:/i.test(text)) return 'git-url';
  // pnpm/GitHub shorthand recorded by older tooling: `owner/repo#ref`.
  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+(?:#.*)?$/.test(text)) return 'git-url';
  if (/^(?:npm:)?(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+(?:@[^\s]+)?$/i.test(text)) return 'registry';
  return 'unknown';
}

/**
 * Extract the pinned 40-hex commit from a recorded git dependency spec.
 * Branch/tag refs, local paths and registry specs yield `null` — the Host then
 * reports `buildCommit:null` rather than guessing a running commit.
 */
export function parseProfileDependencyCommit(spec) {
  if (profileDependencySpecShape(spec) !== 'git-url') return null;
  const text = spec.trim();
  const hashIndex = text.indexOf('#');
  if (hashIndex < 0) return null;
  let fragment = text.slice(hashIndex + 1);
  const pathIndex = fragment.indexOf('&');
  if (pathIndex >= 0) fragment = fragment.slice(0, pathIndex);
  const commit = fragment.trim().toLowerCase();
  return COMMIT_RE.test(commit) ? commit : null;
}

/* ------------------------------------------------------------------ *
 * Release identity (`platform-updates/release.json`)
 * ------------------------------------------------------------------ */

function isReleaseRepository(value) {
  if (typeof value !== 'string') return false;
  const repo = PLATFORM_UPDATE_REPOSITORY;
  const expected = `${repo.owner}/${repo.name}`;
  return value === expected || value === `github.com/${expected}` || value === repo.url || value === `https://${repo.url.replace(/\.git$/, '')}` || value === `https://${repo.url}`;
}

/**
 * Validate the release identity shipped by release tooling inside the bundle.
 *
 * `clientBuildCommit` is the commit the browser bundle was built from (the
 * version commit P), i.e. the **expected Client running identity** — a file can
 * never contain the commit of the release commit R that contains it.
 *
 * @returns {{ok:true, value:{schemaVersion:1, version:string, clientBuildCommit:string|null, repo:string}}|{ok:false, code:string, details?:object}}
 */
export function parseReleaseManifest(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'E_RELEASE_INVALID', details: { field: 'document' } };
  }
  if (value.schemaVersion !== PLATFORM_UPDATE_RELEASE_SCHEMA_VERSION) {
    return { ok: false, code: 'E_RELEASE_INVALID', details: { field: 'schemaVersion' } };
  }
  if (parseExactSemver(value.version) === null) {
    return { ok: false, code: 'E_RELEASE_INVALID', details: { field: 'version' } };
  }
  let clientBuildCommit = null;
  if (value.clientBuildCommit !== undefined && value.clientBuildCommit !== null) {
    if (!isPinnedCommit(value.clientBuildCommit)) {
      return { ok: false, code: 'E_RELEASE_INVALID', details: { field: 'clientBuildCommit' } };
    }
    clientBuildCommit = value.clientBuildCommit;
  }
  if (!isReleaseRepository(value.repo)) {
    return { ok: false, code: 'E_RELEASE_INVALID', details: { field: 'repo' } };
  }
  return {
    ok: true,
    value: {
      schemaVersion: PLATFORM_UPDATE_RELEASE_SCHEMA_VERSION,
      version: value.version,
      clientBuildCommit,
      repo: `${PLATFORM_UPDATE_REPOSITORY.owner}/${PLATFORM_UPDATE_REPOSITORY.name}`,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Format-1 official index: strict validation
 * ------------------------------------------------------------------ */

function indexFail(path, reason) {
  const error = new Error(`${path} ${reason}`);
  error.code = 'E_UPDATE_INDEX_INVALID';
  error.indexPath = path;
  error.indexReason = reason;
  error.isIndexValidationFailure = true;
  throw error;
}

function indexObjectAt(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) indexFail(path, 'must be an object');
  return value;
}

function indexStringAt(value, path) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    indexFail(path, 'must be a non-empty string');
  }
  return value;
}

function indexOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function indexOptional(object, key, path, read) {
  return indexOwn(object, key) ? read(object[key], `${path}.${key}`) : undefined;
}

function localizedText(value, path) {
  if (typeof value === 'string') return indexStringAt(value, path);
  const object = indexObjectAt(value, path);
  const text = {};
  for (const [language, member] of Object.entries(object)) {
    if (!LANGUAGE_ID_RE.test(language)) indexFail(`${path}.${language}`, 'must be keyed by a lowercase language id');
    Object.defineProperty(text, language, {
      value: indexStringAt(member, `${path}.${language}`),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  if (!indexOwn(text, 'en')) indexFail(path, 'must contain en');
  return text;
}

function indexDeclarations(value, path, read) {
  const result = {};
  for (const [id, member] of Object.entries(indexObjectAt(value, path))) {
    if (id.length === 0) indexFail(path, 'must not declare an empty id');
    Object.defineProperty(result, id, {
      value: read(indexObjectAt(member, `${path}.${id}`), `${path}.${id}`),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}

function indexDeclaration(object, path) {
  return { title: localizedText(object.title, `${path}.title`) };
}

function indexSortKeyDeclaration(object, path) {
  if (object.order !== 'asc' && object.order !== 'desc') {
    indexFail(`${path}.order`, 'must be "asc" or "desc"');
  }
  return { title: localizedText(object.title, `${path}.title`), order: object.order };
}

function indexMetadata(value, path) {
  const object = value === undefined ? {} : indexObjectAt(value, path);
  return {
    categories:
      indexOptional(object, 'categories', path, (member, at) => indexDeclarations(member, at, indexDeclaration)) ?? {},
    labels: indexOptional(object, 'labels', path, (member, at) => indexDeclarations(member, at, indexDeclaration)) ?? {},
    sortKeys:
      indexOptional(object, 'sortKeys', path, (member, at) => indexDeclarations(member, at, indexSortKeyDeclaration)) ?? {},
  };
}

function declaredId(value, path, declared) {
  const id = indexStringAt(value, path);
  if (!indexOwn(declared, id)) indexFail(path, `references undeclared id ${JSON.stringify(id)}`);
  return id;
}

function indexPluginMetadata(value, path, index) {
  const object = value === undefined ? {} : indexObjectAt(value, path);
  const category = indexOptional(object, 'category', path, (member, at) => declaredId(member, at, index.categories));
  const keywords =
    indexOptional(object, 'keywords', path, (member, at) => {
      if (!Array.isArray(member)) indexFail(at, 'must be an array');
      return member.map((keyword, position) => {
        if (typeof keyword !== 'string') indexFail(`${at}[${String(position)}]`, 'must be a string');
        return keyword;
      });
    }) ?? [];
  const labels =
    indexOptional(object, 'labels', path, (member, at) => {
      if (!Array.isArray(member)) indexFail(at, 'must be an array');
      const ids = member.map((label, position) => declaredId(label, `${at}[${String(position)}]`, index.labels));
      if (new Set(ids).size !== ids.length) indexFail(at, 'must not repeat a label');
      return ids;
    }) ?? [];
  const sortKeys =
    indexOptional(object, 'sortKeys', path, (member, at) => {
      const values = {};
      for (const [id, sortValue] of Object.entries(indexObjectAt(member, at))) {
        declaredId(id, `${at}.${id}`, index.sortKeys);
        if (typeof sortValue !== 'number' || !Number.isFinite(sortValue)) indexFail(`${at}.${id}`, 'must be a finite number');
        Object.defineProperty(values, id, { value: sortValue, enumerable: true, writable: true, configurable: true });
      }
      return values;
    }) ?? {};
  return {
    ...(category === undefined ? {} : { category }),
    keywords,
    labels,
    sortKeys,
  };
}

function indexHttpsUrl(value, path, { allowHttp = false, allowQueryOrFragment = false } = {}) {
  const text = indexStringAt(value, path);
  let url;
  try {
    url = new URL(text);
  } catch (_error) {
    indexFail(path, 'must be an absolute URL');
  }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    indexFail(path, allowHttp ? 'must use https: or http:' : 'must use https:');
  }
  if (url.username !== '' || url.password !== '') indexFail(path, 'must not contain credentials');
  if (!allowQueryOrFragment && (url.search !== '' || url.hash !== '')) {
    indexFail(path, 'must not contain a query or fragment');
  }
  return url.href;
}

function indexPathSegmentList(value, path) {
  const text = indexStringAt(value, path);
  const segments = text.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..' || !PACKAGE_PATH_SEGMENT_RE.test(segment))) {
    indexFail(path, 'must be a safe relative directory');
  }
  return text;
}

function indexIcon(value, path, indexUrl) {
  const text = indexStringAt(value, path);
  if (text.startsWith('data:')) {
    const match = DATA_ICON_RE.exec(text);
    if (match === null || match[1] === '' || !BASE64_RE.test(match[1])) {
      indexFail(path, 'must be a base64 SVG, PNG, JPEG, or WebP data URL');
    }
    const padding = match[1].endsWith('==') ? 2 : match[1].endsWith('=') ? 1 : 0;
    const decodedBytes = (match[1].length / 4) * 3 - padding;
    if (decodedBytes > MAX_INLINE_ICON_BYTES) {
      indexFail(path, `must not exceed ${String(MAX_INLINE_ICON_BYTES / 1024)} KiB of decoded bytes`);
    }
    return text;
  }
  let resolved;
  try {
    resolved = new URL(text, indexUrl);
  } catch (_error) {
    indexFail(path, 'must be a URL reference');
  }
  const base = new URL(indexUrl);
  if (resolved.protocol !== 'https:' && resolved.origin !== base.origin) {
    indexFail(path, 'must resolve to https or the index origin');
  }
  return resolved.href;
}

function indexRepository(value, path) {
  const object = indexObjectAt(value, path);
  return {
    url: indexHttpsUrl(object.url, `${path}.url`, { allowHttp: true, allowQueryOrFragment: true }),
    ...(indexOwn(object, 'directory')
      ? { directory: indexPathSegmentList(object.directory, `${path}.directory`) }
      : {}),
  };
}

function indexSource(value, path) {
  const object = indexObjectAt(value, path);
  if (object.type === 'npm') {
    return {
      type: 'npm',
      ...(indexOwn(object, 'registry')
        ? { registry: indexHttpsUrl(object.registry, `${path}.registry`, { allowHttp: true }) }
        : {}),
    };
  }
  if (object.type === 'git') {
    const commit = indexStringAt(object.commit, `${path}.commit`);
    if (!COMMIT_RE.test(commit)) indexFail(`${path}.commit`, 'must be a lowercase 40-hex commit');
    const url = indexHttpsUrl(object.url, `${path}.url`);
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (_error) {
      indexFail(`${path}.url`, 'must be an absolute URL');
    }
    // Canonical form only: no default port/../-folding, and a repository path.
    if (parsedUrl.href !== url) indexFail(`${path}.url`, 'must be a canonical URL');
    if (!/^(?:\/[^/]+){2,}$/u.test(parsedUrl.pathname)) {
      indexFail(`${path}.url`, 'must name a repository with at least two path segments');
    }
    if (/\.(?:tgz|tar\.gz)$/iu.test(parsedUrl.pathname)) {
      indexFail(`${path}.url`, 'must name a repository, not a tarball');
    }
    return {
      type: 'git',
      url,
      commit,
      ...(indexOwn(object, 'path') ? { path: indexPathSegmentList(object.path, `${path}.path`) } : {}),
    };
  }
  return indexFail(`${path}.type`, 'must be "npm" or "git"');
}

function indexEngines(value, path) {
  const object = indexObjectAt(value, path);
  const dsh = indexOptional(object, 'dsh', path, (member, at) => {
    const range = indexStringAt(member, at);
    if (range.startsWith('workspace:')) indexFail(at, 'must not be a workspace: range');
    if (range.length > 120 || /[\u0000-\u001f]/.test(range)) indexFail(at, 'must be a bounded SemVer range');
    return range;
  });
  return dsh === undefined ? {} : { dsh };
}

function indexMarketVersion(value, path) {
  const object = indexObjectAt(value, path);
  const version = indexStringAt(object.version, `${path}.version`);
  if (parseExactSemver(version) === null) indexFail(`${path}.version`, 'must be an exact SemVer version');
  const publishTimestamp = object.publishTimestamp;
  if (
    typeof publishTimestamp !== 'number' ||
    !Number.isInteger(publishTimestamp) ||
    publishTimestamp < 0 ||
    publishTimestamp >= MAX_PUBLISH_TIMESTAMP
  ) {
    indexFail(`${path}.publishTimestamp`, 'must be an integer number of Unix seconds in [0, 10^11)');
  }
  return {
    version,
    publishTimestamp,
    source: indexSource(object.source, `${path}.source`),
    engines: indexOptional(object, 'engines', path, indexEngines) ?? {},
  };
}

function indexVersions(value, path) {
  if (!Array.isArray(value) || value.length === 0) indexFail(path, 'must be a non-empty array');
  const seen = new Set();
  const parsed = value.map((member, position) => {
    const at = `${path}[${String(position)}]`;
    const entry = indexMarketVersion(member, at);
    if (seen.has(entry.version)) indexFail(`${at}.version`, `duplicates ${entry.version}`);
    seen.add(entry.version);
    return entry;
  });
  parsed.sort((left, right) => compareExactSemver(right.version, left.version));
  return parsed;
}

function indexPlugin(value, path, index, indexUrl) {
  const object = indexObjectAt(value, path);
  const name = indexStringAt(object.name, `${path}.name`);
  if (name.length > PACKAGE_NAME_MAX_LENGTH || !PACKAGE_NAME_RE.test(name)) {
    indexFail(`${path}.name`, 'must be a valid npm package name');
  }
  const title = indexOptional(object, 'title', path, localizedText);
  const description = indexOptional(object, 'description', path, localizedText);
  const icon = indexOptional(object, 'icon', path, (member, at) => indexIcon(member, at, indexUrl));
  const author = indexOptional(object, 'author', path, indexStringAt);
  const homepage = indexOptional(object, 'homepage', path, (member, at) =>
    indexHttpsUrl(member, at, { allowHttp: true, allowQueryOrFragment: true })
  );
  const repository = indexOptional(object, 'repository', path, indexRepository);
  return {
    name,
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(icon === undefined ? {} : { icon }),
    ...(author === undefined ? {} : { author }),
    ...(homepage === undefined ? {} : { homepage }),
    ...(repository === undefined ? {} : { repository }),
    metadata: indexPluginMetadata(object.metadata, `${path}.metadata`, index),
    versions: indexVersions(object.versions, `${path}.versions`),
  };
}

/**
 * Strictly validate a parsed official plugin-market index (format 1).
 *
 * The validator is intentionally independent of the DSH installation package
 * (Q1: a profile bundle may or may not be able to import
 * `@deepseek-ai/dsh-plugin-market-index`; discovery must never depend on that).
 * Undefined members are dropped, exactly like the public format allows.
 *
 * @param {unknown} value Parsed JSON document.
 * @param {{indexUrl?: string}} [options]
 * @returns {{ok:true, value:object}|{ok:false, code:'E_UPDATE_INDEX_INVALID', details:{path:string,reason:string}}}
 */
export function parsePluginMarketIndex(value, { indexUrl = PLATFORM_UPDATE_INDEX_URL } = {}) {
  const baseUrl = typeof indexUrl === 'string' && indexUrl.length > 0 ? indexUrl : PLATFORM_UPDATE_INDEX_URL;
  try {
    const object = indexObjectAt(value, '$');
    if (object.format !== PLATFORM_UPDATE_INDEX_FORMAT) indexFail('$.format', 'must be 1');
    const metadata = indexMetadata(object.metadata, '$.metadata');
    if (!Array.isArray(object.plugins)) indexFail('$.plugins', 'must be an array');
    const names = new Set();
    const plugins = object.plugins.map((entry, position) => {
      const parsed = indexPlugin(entry, `$.plugins[${String(position)}]`, metadata, baseUrl);
      if (names.has(parsed.name)) indexFail(`$.plugins[${String(position)}].name`, `duplicates ${parsed.name}`);
      names.add(parsed.name);
      return parsed;
    });
    const title = localizedText(object.title, '$.title');
    const description = indexOptional(object, 'description', '$', localizedText);
    return {
      ok: true,
      value: {
        format: PLATFORM_UPDATE_INDEX_FORMAT,
        title,
        ...(description === undefined ? {} : { description }),
        metadata,
        plugins,
      },
    };
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.isIndexValidationFailure === true) {
      const path = typeof error.indexPath === 'string' ? error.indexPath.slice(0, 200) : '$';
      const reason = typeof error.indexReason === 'string' ? error.indexReason.slice(0, 200) : 'invalid index';
      return { ok: false, code: 'E_UPDATE_INDEX_INVALID', details: { path, reason } };
    }
    return { ok: false, code: 'E_UPDATE_INDEX_INVALID', details: { path: '$', reason: 'unreadable index document' } };
  }
}

/* ------------------------------------------------------------------ *
 * Target binding + selection
 * ------------------------------------------------------------------ */

/**
 * True when a format-1 version source is a git pin to the official repository
 * at its root (no `path:` package directory) with a full 40-hex commit.
 */
export function isBoundOfficialSource(source) {
  if (source === null || typeof source !== 'object' || source.type !== 'git') return false;
  if (typeof source.url !== 'string' || !isPinnedCommit(source.commit)) return false;
  if (source.path !== undefined) return false;
  let parsed;
  try {
    parsed = new URL(source.url);
  } catch (_error) {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') return false;
  if (parsed.hostname !== 'github.com') return false;
  const pathname = parsed.pathname.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  return pathname === `/${PLATFORM_UPDATE_REPOSITORY.owner}/${PLATFORM_UPDATE_REPOSITORY.name}`;
}

/**
 * Select the update target from a validated index.
 *
 * - the official index must list `dsh-game-market`; a missing plugin is a
 *   healthy "not listed" result (target:null), not a broken index;
 * - **every** version of our plugin must be a git pin to the official repo
 *   (a wrong/npm/local source means the index was tampered with → reject);
 * - `stable` (default) drops prerelease versions; `test` is explicit opt-in and
 *   may select the highest version including prereleases;
 * - versions are ordered by SemVer precedence.
 *
 * @param {object} index Value returned by `parsePluginMarketIndex`.
 * @param {{channel?: string}} [options]
 * @returns {{ok:true, target:object|null, reason?:string}|{ok:false, code:'E_UPDATE_INDEX_INVALID'|'E_UPDATE_TARGET_INVALID', details?:object}}
 */
export function selectOfficialUpdateTarget(index, { channel = PLATFORM_UPDATE_DEFAULT_CHANNEL } = {}) {
  const selectedChannel = normaliseUpdateChannel(channel);
  if (selectedChannel === null) {
    return { ok: false, code: 'E_UPDATE_TARGET_INVALID', details: { reason: 'channel' } };
  }
  if (index === null || typeof index !== 'object' || index.format !== PLATFORM_UPDATE_INDEX_FORMAT) {
    return { ok: false, code: 'E_UPDATE_INDEX_INVALID', details: { reason: 'format' } };
  }
  const plugins = Array.isArray(index.plugins) ? index.plugins : [];
  const plugin = plugins.find((entry) => entry.name === BUNDLE_ID);
  if (plugin === undefined) return { ok: true, target: null, reason: 'not-listed' };
  for (const version of plugin.versions) {
    if (!isBoundOfficialSource(version.source)) {
      return { ok: false, code: 'E_UPDATE_INDEX_INVALID', details: { reason: 'source-binding' } };
    }
  }
  const candidates = plugin.versions.filter(
    (entry) => selectedChannel === 'test' || !isPrereleaseVersion(entry.version)
  );
  if (candidates.length === 0) {
    return { ok: true, target: null, reason: selectedChannel === 'stable' ? 'no-stable-version' : 'no-version' };
  }
  const ordered = candidates.slice().sort((left, right) => compareExactSemver(right.version, left.version));
  const chosen = ordered[0];
  const spec = updateGitSpecForCommit(chosen.source.commit);
  const id = updateTargetIdFor(chosen.version, chosen.source.commit);
  if (spec === null || id === null) {
    return { ok: false, code: 'E_UPDATE_INDEX_INVALID', details: { reason: 'source-binding' } };
  }
  return {
    ok: true,
    target: {
      id,
      version: chosen.version,
      commit: chosen.source.commit,
      channel: selectedChannel,
      publishedAt: new Date(chosen.publishTimestamp * 1000).toISOString(),
      spec,
    },
  };
}

/** Validate a channel string; returns the canonical channel or `null`. */
export function normaliseUpdateChannel(value) {
  if (typeof value !== 'string') return PLATFORM_UPDATE_DEFAULT_CHANNEL;
  const channel = value.trim().toLowerCase();
  if (channel.length === 0) return PLATFORM_UPDATE_DEFAULT_CHANNEL;
  return PLATFORM_UPDATE_CHANNELS.includes(channel) ? channel : null;
}

/* ------------------------------------------------------------------ *
 * Anomaly detection: same version, different commit
 * ------------------------------------------------------------------ */

/**
 * Detect the "same version, different commit" anomaly (m3-decisions §3).
 *
 * A published version must be immutable. Finding the same version pinned to a
 * different commit — either versus the previously observed target or versus the
 * commit recorded by the profile — is a security anomaly: the target stays
 * visible for diagnostics, but `canBeginUpdate` must be `false` and the update
 * must never start automatically.
 *
 * @param {{target:object|null, previousTarget?:object|null, installedVersion?:string|null, installedCommit?:string|null}} input
 * @returns {{kind:'same-version-different-commit', version:string, expectedCommit:string, foundCommit:string, source:'previous-target'|'profile-dependency'}|null}
 */
export function detectUpdateTargetAnomaly({ target, previousTarget = null, installedVersion = null, installedCommit = null } = {}) {
  if (target === null || typeof target !== 'object' || typeof target.version !== 'string') return null;
  if (previousTarget !== null && typeof previousTarget === 'object') {
    if (previousTarget.version === target.version && previousTarget.commit !== target.commit) {
      return {
        kind: 'same-version-different-commit',
        version: target.version,
        expectedCommit: previousTarget.commit,
        foundCommit: target.commit,
        source: 'previous-target',
      };
    }
  }
  if (installedVersion !== null && installedVersion === target.version) {
    if (typeof installedCommit === 'string' && installedCommit !== target.commit) {
      return {
        kind: 'same-version-different-commit',
        version: target.version,
        expectedCommit: installedCommit,
        foundCommit: target.commit,
        source: 'profile-dependency',
      };
    }
  }
  return null;
}

/**
 * Normalize an untrusted observation into the frozen shape by dropping unknown
 * members. Used by the Client API layer and by tests; the Host emits exact
 * shapes and never needs this.
 */
export function normalizeUpdateObservation(value) {
  if (value === null || typeof value !== 'object' || typeof value.state !== 'string') return null;
  if (!PLATFORM_UPDATE_STATES.includes(value.state)) return null;
  return value;
}
