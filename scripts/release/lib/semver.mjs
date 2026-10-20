/**
 * Minimal SemVer 2.0.0 helpers for the release tooling.
 *
 * The repository's shared manifest validator constrains game/package version
 * grammar; the platform plugin version and its `engines.dsh` range must obey
 * the same public rules (docs/V1.5-CONTRACTS.md §9.4: exact semver, engines
 * range). This module is intentionally self-contained: the release tooling has
 * zero dependencies and must be runnable even before `npm install`.
 *
 * Grammar: https://semver.org/spec/v2.0.0.html. Range grammar accepted by the
 * V1 contract (see packages/shared/src/manifest.js `isValidRange`):
 * `^1.0.0`, `~1.0.0`, `1.0.0`, `>=1.0.0 <2.0.0`.
 */

const NUMERIC = '(?:0|[1-9]\\d*)';
const PRERELEASE_PART = `(?:${NUMERIC}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const BUILD_PART = '[0-9A-Za-z-]+';
const VERSION = new RegExp(
  `^${NUMERIC}\\.${NUMERIC}\\.${NUMERIC}`
  + `(?:-${PRERELEASE_PART}(?:\\.${PRERELEASE_PART})*)?`
  + `(?:\\+${BUILD_PART}(?:\\.${BUILD_PART})*)?$`,
  'u',
);

/** True for an exact SemVer 2.0.0 version (no range operators). */
export function isValidVersion(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  return VERSION.test(value);
}

/** True when the version carries prerelease identifiers (`1.3.0-rc.1`). */
export function isPrerelease(value) {
  if (!isValidVersion(value)) return false;
  const withoutBuild = value.split('+', 1)[0];
  return withoutBuild.includes('-');
}

/**
 * Validate the range syntax accepted by the V1 contract. Satisfaction is
 * checked by the Host; the release tooling only freezes the grammar so an
 * invalid contract range can never reach an index.
 */
export function isValidRange(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text.length === 0 || text.length > 120) return false;
  if (text.startsWith('^') || text.startsWith('~')) return isValidVersion(text.slice(1).trim());
  const bounded = /^>=([^\s]+)\s+<([^\s]+)$/u.exec(text);
  if (bounded) return isValidVersion(bounded[1]) && isValidVersion(bounded[2]);
  return isValidVersion(text);
}

const COMPARATOR = /^(?:(?:\^|~|>=|<=|>|<|=)\s*)?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

/**
 * Validate a package `engines` range: npm-style comparators over 1-3 component
 * versions, whitespace separated (e.g. `>=20`, `>=0.2.0 <0.3.0`, `^0.2.0`).
 * This is intentionally separate from the stricter V1 manifest range: browsers
 * engines are not part of the game package grammar but must still be a real
 * SemVer range before it is emitted into the plugin index.
 */
export function isValidComparatorRange(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text.length === 0 || text.length > 120) return false;
  if (text.startsWith('workspace:')) return false;
  return text.split(/\s+/u).every((token) => COMPARATOR.test(token));
}

function parseVersion(value) {
  if (!isValidVersion(value)) return null;
  const [core, rest] = value.split('+', 1)[0].split('-', 2);
  const [major, minor, patch] = core.split('.').map(Number);
  const prerelease = rest === undefined ? [] : rest.split('.');
  return { major, minor, patch, prerelease };
}

/**
 * Check whether `version` satisfies the simple comparator ranges used by the
 * tooling (`>=20`, `>=0.2.0 <0.3.0`). Used only for the local Node engine gate;
 * unknown comparator forms return `null` ("cannot tell").
 */
export function satisfiesSimpleRange(version, range) {
  const parsed = parseVersion(version);
  if (!parsed || typeof range !== 'string') return null;
  const tokens = range.trim().split(/\s+/u);
  for (const token of tokens) {
    const match = /^([<>]=?|=)?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/u.exec(token);
    if (!match) return null;
    const operator = match[1] || '=';
    const target = {
      major: Number(match[2]),
      minor: match[3] === undefined ? 0 : Number(match[3]),
      patch: match[4] === undefined ? 0 : Number(match[4]),
    };
    const precision = match[4] !== undefined ? 3 : match[3] !== undefined ? 2 : 1;
    const cmp = compareWithPrecision(parsed, target, precision);
    const ok = {
      '>': cmp > 0,
      '>=': cmp >= 0,
      '<': cmp < 0,
      '<=': cmp <= 0,
      '=': cmp === 0,
    }[operator];
    if (!ok) return false;
  }
  return true;
}

function compareWithPrecision(left, right, precision) {
  const keys = ['major', 'minor', 'patch'].slice(0, precision);
  for (const key of keys) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return 0;
}

/**
 * SemVer 2.0.0 precedence comparison (prerelease-aware). Returns -1, 0 or 1.
 * Throws for invalid input: callers validate versions first.
 */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new TypeError(`compareVersions expects exact SemVer versions (${String(left)}, ${String(right)})`);
  const core = compareCore(a, b);
  if (core !== 0) return core;
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const cmp = Number(leftPart) - Number(rightPart);
      if (cmp !== 0) return cmp < 0 ? -1 : 1;
    } else if (leftNumeric) {
      return -1;
    } else if (rightNumeric) {
      return 1;
    } else if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1;
    }
  }
  return 0;
}

/** Highest version of a list of valid SemVer strings (or null for an empty list). */
export function highestVersion(versions) {
  let highest = null;
  for (const version of versions) {
    if (!isValidVersion(version)) continue;
    if (highest === null || compareVersions(version, highest) > 0) highest = version;
  }
  return highest;
}

function compareCore(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  return 0;
}
