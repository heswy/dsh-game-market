/**
 * Diagnostic formatting for `dsh-game validate/build/pack/publish`.
 *
 * Internal validators emit `E_*` codes (shared/manifest.js). This module maps
 * each item to its public `GM-*` code (PRD §8.13 / D-030), attaches an
 * author-facing `path` and `hint`, and renders the human/JSON reports described
 * by PRD §8.2.7.
 */

import { gmForInternal, isGmCode } from '../../../packages/shared/src/errors.js';

const MAX_REPORT_ITEMS = 50;

/** CLI-only codes that are not part of the shared `INTERNAL_TO_GM` table. */
const EXTRA_GM = Object.freeze({
  E_COMPAT_SDK: 'GM-4261',
  E_COMPAT_RUNTIME: 'GM-4260',
  E_REGISTRY_FIELD_MISSING: 'GM-5032',
  E_REGISTRY_FIELD_TYPE: 'GM-5032',
  E_REGISTRY_FIELD_RANGE: 'GM-5032',
  E_INSTALL_HASH_MISMATCH: 'GM-5015',
  E_PKG_FILENAME_MISMATCH: 'GM-4095',
  E_CLI_IO: 'GM-5000',
  E_CLI_PATH_ESCAPE: 'GM-4002',
});

const HINTS = Object.freeze({
  E_PKG_HTML_INVALID:
    'The package must be a non-empty UTF-8 HTML document without a BOM and must contain an <html> tag.',
  E_PKG_TOO_LARGE: 'Keep the built single-file package at or below 20 MiB (20,971,520 bytes).',
  E_PKG_MANIFEST_MISSING:
    'Add <script type="application/json" id="dsh-game-manifest">…</script> or run `dsh-game build` from a manifest.json project.',
  E_PKG_MANIFEST_DUPLICATE: 'A package may contain exactly one inline dsh-game-manifest script.',
  E_PKG_MANIFEST_TOO_LARGE: 'Keep the serialized inline manifest at or below 64 KiB.',
  E_PKG_MANIFEST_JSON: 'Fix the JSON syntax of manifest.json (duplicate keys and trailing commas are not allowed).',
  E_PKG_MANIFEST_VERSION: 'Set "manifestVersion": 1.',
  E_PKG_FIELD_MISSING: 'Add the required manifest field listed in path.',
  E_PKG_FIELD_TYPE: 'Use the documented type for this manifest field (see docs/developer-guide.md).',
  E_PKG_FIELD_RANGE: 'Adjust the value to the documented length, enum or numeric range.',
  E_PKG_ID_INVALID:
    'Use 3–48 lowercase letters/digits/hyphens, must start and end with an alphanumeric, and must not contain "--".',
  E_PKG_ID_RESERVED: 'Pick another id: this one is reserved by DSH or the Game Market.',
  E_PKG_VERSION_INVALID: 'Use a strict semver subset such as 1.0.0 or 1.0.0-beta.1 (no "+build").',
  E_PKG_LEGACY_FIELD:
    'V1 manifests use author:{name} and categories:[…]; entry/cover/screenshots live in the Registry, not in the package.',
  E_PKG_CATEGORY_UNKNOWN: 'Allowed categories: arcade, puzzle, card, idle, action, strategy, trivia, sandbox.',
  E_PKG_CAPABILITY_UNKNOWN: 'V1 capabilities are exactly "storage" and "score".',
  E_PKG_CAPABILITY_UNSUPPORTED:
    'This capability is known but disabled in V1. Remove it; games cannot access network, files or DSH APIs.',
  E_PKG_CAPABILITY_DUPLICATE: 'List each capability only once.',
  E_PKG_PERMISSION_UNSUPPORTED: 'Omit "permissions" or set it to {}.',
  E_PKG_SCORE_RANGE: 'Set score.min < score.max with a span of at most 1e9, and a valid direction/integer.',
  E_PKG_SAVE_SCHEMA: 'Set save.schemaVersion to an integer between 1 and 2147483647.',
  E_PKG_RANGE_SYNTAX: 'Use ^1.0.0, ~1.0.0, 1.0.0 or ">=1.0.0 <2.0.0".',
  E_PKG_ICON_FORMAT: 'icon must be a data:image/png|webp|jpeg;base64,… URI.',
  E_PKG_ICON_TOO_LARGE: 'Keep the decoded icon at or below 256 KiB.',
  E_PKG_ENTRY_NOT_SELF_CONTAINED:
    'Inline every script/style/image/font (data: URI) and remove network APIs. Run `dsh-game build` from the official template.',
  E_INSTALL_VERSION_MISMATCH:
    'Rename the package to <id>-<version>.html (e.g. snake-1.0.0.html) or fix the manifest id/version.',
  E_COMPAT_SDK: 'Lower sdkVersion (V1 platform is 1.0.0) or target the current SDK with ^1.0.0.',
  E_COMPAT_RUNTIME: 'Lower runtimeVersion (V1 platform is 1.0.0) or target the current Runtime with ^1.0.0.',
  E_CLI_IO: 'Check that the path exists and is readable/writable.',
  E_CLI_PATH_ESCAPE: 'Only reference files inside the game project directory.',
  E_REGISTRY_INVALID: 'Fix the registry entry/package URL: it must be https, end with the exact package file name (<id>-<version>.html or <id>-<version>.dshgame.zip) and use an allowed host.',
  E_REGISTRY_FIELD_MISSING: 'Fill in the required registry field (cover is mandatory).',
  E_REGISTRY_FIELD_TYPE: 'Use the documented Registry field type.',
  E_REGISTRY_FIELD_RANGE: 'Use https URLs and valid ISO timestamps for Registry metadata.',
  E_INSTALL_HASH_MISMATCH: 'Re-run `dsh-game pack` to regenerate the package and .sha256 sidecar.',
});

const WARNING_HINTS = Object.freeze({
  W_PKG_UNKNOWN_FIELD: 'Remove the field or prefix experimental fields with "x-".',
  W_PKG_IGNORED_FIELD: 'Add the matching capability or remove the field.',
});

export function gmFor(code) {
  if (isGmCode(code)) return code;
  return EXTRA_GM[code] || gmForInternal(code);
}

export function hintFor(code) {
  return HINTS[code] || WARNING_HINTS[code] || '';
}

function pathOf(item) {
  if (item && typeof item.field === 'string' && item.field.length > 0) return item.field;
  return 'entry';
}

/**
 * Normalize raw validator errors/warnings into the CLI report item shape:
 * `{code, gm, path, message, hint, value?}`.
 */
export function toIssue(item, kind) {
  const code = item && typeof item.code === 'string' ? item.code : 'E_CLI_IO';
  return {
    code,
    gm: kind === 'error' ? gmFor(code) : null,
    path: pathOf(item),
    message: item && typeof item.message === 'string' ? item.message : 'Unknown diagnostic',
    hint: hintFor(code),
    ...(item && item.value !== undefined ? { value: item.value } : {}),
  };
}

/**
 * Build the report object. `errors` are capped at 50 with `truncated: true`
 * (PRD §8.2.7). Warnings are informational and share the cap.
 */
export function makeReport({ errors = [], warnings = [], manifest = null, bytes = 0, source = null } = {}) {
  const mappedErrors = errors.map((item) => (item.gm ? item : toIssue(item, 'error')));
  const mappedWarnings = warnings.map((item) =>
    item && typeof item.path === 'string'
      ? { ...item, hint: item.hint || hintFor(item.code) }
      : toIssue(item, 'warning')
  );
  const truncated = mappedErrors.length > MAX_REPORT_ITEMS || mappedWarnings.length > MAX_REPORT_ITEMS;
  return {
    ok: mappedErrors.length === 0,
    errors: mappedErrors.slice(0, MAX_REPORT_ITEMS),
    warnings: mappedWarnings.slice(0, MAX_REPORT_ITEMS),
    truncated,
    manifest: manifest
      ? { id: manifest.id || null, name: manifest.name || null, version: manifest.version || null }
      : null,
    bytes,
    source,
  };
}

export function formatReport(report, options = {}) {
  const lines = [];
  // Never print "(0 bytes)" for a failed validation: 0 means "not measured",
  // not an empty package (e.g. a build/in-memory validation failure).
  const sizeSuffix =
    report.ok || (Number.isFinite(report.bytes) && report.bytes > 0) ? ` (${report.bytes} bytes)` : ' (size not measured)';
  if (report.ok) {
    lines.push(`OK  ${report.source || 'package'}${sizeSuffix}`);
    if (report.manifest && report.manifest.id) {
      lines.push(`    manifest: ${report.manifest.id}@${report.manifest.version} (${report.manifest.name})`);
    }
  } else {
    lines.push(`FAIL  ${report.source || 'package'}${sizeSuffix}`);
  }
  for (const [index, error] of report.errors.entries()) {
    lines.push(`  ${index + 1}. ${error.code} (${error.gm}) ${error.path}: ${error.message}`);
    if (error.hint) lines.push(`     hint: ${error.hint}`);
  }
  if (report.warnings.length > 0) {
    lines.push(`  warnings (${report.warnings.length}):`);
    for (const warning of report.warnings) {
      lines.push(`    - ${warning.code} ${warning.path}: ${warning.message}`);
      if (warning.hint) lines.push(`      hint: ${warning.hint}`);
    }
  }
  if (report.truncated) lines.push('  … report truncated at 50 items');
  if (options.hint && !report.ok) lines.push(`  ${options.hint}`);
  return `${lines.join('\n')}\n`;
}

export { MAX_REPORT_ITEMS };
