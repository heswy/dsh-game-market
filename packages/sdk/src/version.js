/**
 * Tiny semver-subset helper used by the SDK version negotiation (PRD §8.3
 * "版本协商" / docs/V1-CONTRACTS §8.6).
 *
 * The authoritative range implementation lives on the Host
 * (`packages/host/src/semver.js`), but the SDK is inlined into a single-file
 * game and may not import Host/Node code. This module only needs the grammar
 * the Runtime emits in `init.supportedSdkRange` (`>=x <y` in V1, plus the
 * ^ / ~ / exact forms for forward compatibility).
 */

const VERSION_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** @returns {{major:number,minor:number,patch:number,pre:string[],raw:string}|null} */
export function parseVersion(value) {
  if (typeof value !== 'string' || value.length > 64) return null;
  const match = VERSION_RE.exec(value);
  if (!match) return null;
  const pre = match[4] ? match[4].split('.') : [];
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
    if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    } else if (/^\d+$/.test(left) !== /^\d+$/.test(right)) {
      return /^\d+$/.test(left) ? -1 : 1;
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

/** Parse one supported range form. @returns {object|null} */
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
    if (!minimum || !maximum || compareVersions(minimum, maximum) >= 0) return null;
    return { kind: 'bounded', min: minimum, max: maximum };
  }
  const exact = parseVersion(text);
  return exact ? { kind: 'exact', exact } : null;
}

/** @returns {boolean} */
export function satisfiesRange(versionText, rangeText) {
  const version = parseVersion(versionText);
  const range = parseRange(rangeText);
  if (!version || !range) return false;
  if (version.pre.length > 0) {
    return range.kind === 'exact' && range.exact.pre.length > 0 && compareVersions(version, range.exact) === 0;
  }
  if (range.kind === 'caret') {
    return compareVersions(version, range.min) >= 0 && version.major === range.min.major;
  }
  if (range.kind === 'tilde') {
    return (
      compareVersions(version, range.min) >= 0 &&
      version.major === range.min.major &&
      version.minor === range.min.minor
    );
  }
  if (range.kind === 'exact') return compareVersions(version, range.exact) === 0;
  return compareVersions(version, range.min) >= 0 && compareVersions(version, range.max) < 0;
}

/**
 * SDK-side check of the Runtime-advertised `supportedSdkRange` (PRD §8.3).
 *
 * - below the lower bound → the Runtime is older than this SDK: reject GM-5002.
 * - above the upper bound → this SDK is ahead of the Runtime: keep going with
 *   the "unknown fields ignored / unknown methods rejected" forward-compatible
 *   policy and flag `sdkAhead` in diagnostics (PRD §8.3 step 2).
 * - unparseable range → ignore the hint (the Runtime remains authoritative).
 *
 * @returns {{ok:boolean, ahead:boolean, checked:boolean}}
 */
export function negotiateSdkRange(sdkVersion, supportedRange) {
  if (typeof supportedRange !== 'string' || supportedRange.trim().length === 0) {
    return { ok: true, ahead: false, checked: false };
  }
  const range = parseRange(supportedRange);
  const version = parseVersion(sdkVersion);
  if (!range || !version) return { ok: true, ahead: false, checked: false };
  if (version.pre.length > 0) {
    return { ok: satisfiesRange(sdkVersion, supportedRange), ahead: false, checked: true };
  }
  if (range.kind === 'exact') {
    return { ok: compareVersions(version, range.exact) === 0, ahead: false, checked: true };
  }
  if (range.kind === 'caret' || range.kind === 'tilde' || range.kind === 'bounded') {
    if (compareVersions(version, range.min) < 0) return { ok: false, ahead: false, checked: true };
    if (range.kind === 'caret') {
      if (version.major === range.min.major) return { ok: true, ahead: false, checked: true };
      return { ok: true, ahead: compareVersions(version, range.min) > 0, checked: true };
    }
    if (range.kind === 'tilde') {
      if (version.major === range.min.major && version.minor === range.min.minor) {
        return { ok: true, ahead: false, checked: true };
      }
      return { ok: true, ahead: true, checked: true };
    }
    if (compareVersions(version, range.max) < 0) return { ok: true, ahead: false, checked: true };
    return { ok: true, ahead: true, checked: true };
  }
  return { ok: true, ahead: false, checked: false };
}
