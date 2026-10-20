/**
 * V1.5 package-format selection for the developer CLI (docs/V1.5-CONTRACTS §1).
 *
 * The CLI keeps `html-v1` as the default so every pre-V1.5 command/behavior is
 * byte-identical. `asset-zip-v2` must be requested explicitly (`--format
 * asset-zip-v2` or `"format": "asset-zip-v2"` in dsh-game.config.json).
 */

import { PACKAGE_FORMATS, PACKAGE_ZIP_EXTENSION } from '../../../packages/shared/src/constants.js';
import { packageFileNameForFormat } from '../../../packages/shared/src/package-v2.js';
import { usageError } from './cli-error.mjs';

export const HTML_V1 = 'html-v1';
export const ASSET_ZIP_V2 = 'asset-zip-v2';
export const DEFAULT_FORMAT = HTML_V1;
export const SUPPORTED_FORMATS = PACKAGE_FORMATS;
export { PACKAGE_ZIP_EXTENSION };

/** Normalize a user/config format value; `null`/`''` means "not specified". */
export function normalizeFormat(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim().toLowerCase();
  if (text === HTML_V1 || text === ASSET_ZIP_V2) return text;
  return null;
}

/** Human-readable format list for help/errors. */
export function formatChoices() {
  return SUPPORTED_FORMATS.join('|');
}

/**
 * Resolve the effective format: explicit option > project config > html-v1.
 * Throws a usage error for an explicit unknown value (fail closed).
 */
export function resolveFormat(options, config) {
  const source = options && typeof options === 'object' ? options : {};
  const projectConfig = config && typeof config === 'object' ? config : {};
  const explicit = source.format !== undefined && source.format !== null && source.format !== '';
  const candidate = explicit ? source.format : projectConfig.format;
  if (candidate === undefined || candidate === null || candidate === '') return DEFAULT_FORMAT;
  const normalized = normalizeFormat(candidate);
  if (normalized === null) {
    throw usageError(
      `Unsupported package format "${candidate}"`,
      `Use --format ${formatChoices()} (default: ${DEFAULT_FORMAT}).`
    );
  }
  return normalized;
}

export function isZipFormat(format) {
  return normalizeFormat(format) === ASSET_ZIP_V2;
}

/** `<id>-<version>.html` or `<id>-<version>.dshgame.zip`. */
export function packageFileName(id, version, format) {
  return packageFileNameForFormat(id, version, normalizeFormat(format) || DEFAULT_FORMAT);
}

export function formatSummary(format) {
  return isZipFormat(format) ? 'asset-zip-v2 (resource package)' : 'html-v1 (single-file HTML)';
}
