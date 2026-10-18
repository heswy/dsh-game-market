/**
 * Minimal semver subset used for game ↔ Runtime/SDK compatibility (PRD §8.11.2).
 *
 * Accepted range forms: caret, tilde, exact, and bounded `>=x <y`. Anything
 * else is a manifest error (`GM-4221`); an unsatisfied range maps to
 * `GM-4260`/`GM-4261`.
 */

import { LEGACY_V0_VERSION, RUNTIME_VERSION, SDK_VERSION } from '../../shared/src/constants.js';
import { GM } from '../../shared/src/errors.js';
import { hostError } from './errors.js';

const VERSION_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const SUPPORTED_CAPABILITIES = new Set(['storage', 'score']);

/** @returns {{major:number,minor:number,patch:number,pre:string[],raw:string}|null} */
export function parseVersion(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const match = VERSION_RE.exec(value);
  if (!match) return null;
  const pre = match[4] ? match[4].split('.') : [];
  // Numeric prerelease identifiers must not have leading zeros (semver).
  for (const identifier of pre) {
    if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0')) return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre,
    raw: value,
  };
}

function comparePre(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  const max = Math.max(a.length, b.length);
  for (let index = 0; index < max; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

export function compareVersions(a, b) {
  const left = typeof a === 'string' ? parseVersion(a) : a;
  const right = typeof b === 'string' ? parseVersion(b) : b;
  if (!left || !right) return 0;
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  return comparePre(left.pre, right.pre);
}

/** Parse one range string; returns null for unsupported syntax. */
export function parseRange(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text.length === 0 || text.length > 120) return null;
  if (text.startsWith('^')) {
    const minimum = parseVersion(text.slice(1).trim());
    return minimum ? { kind: 'caret', min: minimum } : null;
  }
  if (text.startsWith('~')) {
    const minimum = parseVersion(text.slice(1).trim());
    return minimum ? { kind: 'tilde', min: minimum } : null;
  }
  const bounded = /^>=([^\s]+)\s+<([^\s]+)$/.exec(text);
  if (bounded) {
    const minimum = parseVersion(bounded[1]);
    const maximum = parseVersion(bounded[2]);
    if (!minimum || !maximum) return null;
    if (compareVersions(minimum, maximum) >= 0) return null;
    return { kind: 'bounded', min: minimum, max: maximum };
  }
  const exact = parseVersion(text);
  return exact ? { kind: 'exact', exact } : null;
}

export function satisfies(versionText, rangeText) {
  const version = typeof versionText === 'string' ? parseVersion(versionText) : versionText;
  const range = typeof rangeText === 'string' ? parseRange(rangeText) : rangeText;
  if (!version || !range) {
    throw hostError(GM.MANIFEST_INVALID, 'Unsupported version range');
  }
  if (version.pre.length > 0) {
    return range.kind === 'exact' && range.exact.pre.length > 0 && compareVersions(version, range.exact) === 0;
  }
  switch (range.kind) {
    case 'caret':
      return compareVersions(version, range.min) >= 0 && version.major === range.min.major;
    case 'tilde':
      return (
        compareVersions(version, range.min) >= 0 &&
        version.major === range.min.major &&
        version.minor === range.min.minor
      );
    case 'exact':
      return compareVersions(version, range.exact) === 0;
    case 'bounded':
      return compareVersions(version, range.min) >= 0 && compareVersions(version, range.max) < 0;
    default:
      return false;
  }
}

/**
 * V0 games declared `sdkVersion`/`runtimeVersion` as 0.1.x ranges. V1 keeps the
 * V0 SDK surface unchanged (V1-07), so those ranges stay accepted as a legacy
 * compatibility window instead of forcing every old game to republish.
 */
export function isLegacyV0Range(value) {
  const range = typeof value === 'string' ? parseRange(value) : null;
  if (!range) return false;
  const minimum = range.kind === 'exact' ? range.exact : range.min;
  const legacy = parseVersion(LEGACY_V0_VERSION);
  return Boolean(minimum && legacy && minimum.major === legacy.major && minimum.minor === legacy.minor);
}

/**
 * Validate Runtime/SDK compatibility + supported capabilities for a manifest.
 * Missing ranges are tolerated (defensive V0 builtin catalog), malformed ones
 * are not.
 */
export function checkCompatibility(manifest) {
  const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  for (const capability of capabilities) {
    if (!SUPPORTED_CAPABILITIES.has(capability)) {
      throw hostError(GM.MANIFEST_INVALID, `Unsupported capability: ${String(capability)}`);
    }
  }
  if (manifest.runtimeVersion !== null && manifest.runtimeVersion !== undefined) {
    if (!satisfies(RUNTIME_VERSION, manifest.runtimeVersion) && !isLegacyV0Range(manifest.runtimeVersion)) {
      throw hostError(GM.RUNTIME_INCOMPATIBLE, 'Game requires a different Runtime version', {
        details: { required: manifest.runtimeVersion, actual: RUNTIME_VERSION },
      });
    }
  }
  if (manifest.sdkVersion !== null && manifest.sdkVersion !== undefined) {
    if (!satisfies(SDK_VERSION, manifest.sdkVersion) && !isLegacyV0Range(manifest.sdkVersion)) {
      throw hostError(GM.SDK_INCOMPATIBLE, 'Game requires a different SDK version', {
        details: { required: manifest.sdkVersion, actual: SDK_VERSION },
      });
    }
  }
  return true;
}
