/**
 * Shared validation pipeline for CLI commands (PRD §8.2.7 / docs/V1-CONTRACTS §4).
 *
 * The file-level/manifest/self-containment rules come from
 * `packages/shared/src/manifest.js#validatePackageHtml` so CLI and Host agree.
 * The CLI adds the author-facing compatibility check (V-10) and an optional
 * package-file-name check (V-05) for files already named `<id>-<version>.html`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { RUNTIME_VERSION, SDK_VERSION } from '../../../packages/shared/src/constants.js';
import {
  isPackageFileName,
  isValidRange,
  packageFileName,
  utf8ByteLength,
  validatePackageHtml,
} from '../../../packages/shared/src/manifest.js';
import { isLegacyV0Range, satisfies } from '../../../packages/host/src/semver.js';
import { EXIT_CODES, CliError, usageError } from './cli-error.mjs';
import { decodeUtf8, readBuffer } from './fs-utils.mjs';
import { makeReport, toIssue } from './issues.mjs';

const PACKAGE_NAME_RE = /^[a-z0-9][a-z0-9-]*-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.html$/;
export const PACKAGE_BYTES_MAX = 20 * 1024 * 1024;

/**
 * Compatibility check (V-10). Accepts the V0 0.1.x legacy window (V1-07).
 * @returns {object[]} raw errors `{code, message, field, value}`
 */
export function checkCompatibility(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') return errors;
  const checks = [
    { field: 'runtimeVersion', value: manifest.runtimeVersion, actual: RUNTIME_VERSION, code: 'E_COMPAT_RUNTIME' },
    { field: 'sdkVersion', value: manifest.sdkVersion, actual: SDK_VERSION, code: 'E_COMPAT_SDK' },
  ];
  for (const check of checks) {
    if (typeof check.value !== 'string' || !isValidRange(check.value)) continue;
    if (satisfies(check.actual, check.value) || isLegacyV0Range(check.value)) continue;
    errors.push({
      code: check.code,
      message: `${check.field} ${check.value} does not include the current platform ${check.actual}`,
      field: check.field,
      value: { required: check.value, actual: check.actual },
    });
  }
  return errors;
}

/** Package file-name check for inputs that already look like `<id>-<version>.html`. */
export function checkFileName(fileName, manifest) {
  if (!fileName || !manifest || typeof manifest.id !== 'string' || typeof manifest.version !== 'string') return [];
  if (!PACKAGE_NAME_RE.test(fileName)) return [];
  if (isPackageFileName(fileName, manifest.id, manifest.version)) return [];
  return [
    {
      code: 'E_INSTALL_VERSION_MISMATCH',
      message: `file name ${fileName} does not match the package name ${packageFileName(manifest.id, manifest.version)}`,
      field: 'filename',
    },
  ];
}

/**
 * Validate decoded package HTML.
 * @param {string} html
 * @param {{source?: string, fileName?: string|null, packageBytes?: number, skipCompatibility?: boolean}} [options]
 */
export function validateHtmlText(html, options = {}) {
  const bytes = options.packageBytes === undefined ? utf8ByteLength(html) : options.packageBytes;
  const result = validatePackageHtml(html, { packageBytes: PACKAGE_BYTES_MAX });
  const errors = [...result.errors];
  const warnings = [...result.warnings];
  if (result.manifest) {
    if (!options.skipCompatibility) errors.push(...checkCompatibility(result.manifest));
    errors.push(...checkFileName(options.fileName || null, result.manifest));
  }
  return makeReport({
    errors,
    warnings,
    manifest: result.manifest,
    bytes,
    source: options.source || null,
  });
}

/**
 * Read and validate a package file. Detects invalid UTF-8 and oversize files
 * before handing text to the shared validator.
 */
export function validateFile(absPath, options = {}) {
  const fileName = path.basename(absPath);
  let buffer;
  try {
    buffer = readBuffer(absPath);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw usageError(`Cannot read ${absPath}`, 'Pass an existing .html package or a project directory.');
  }
  if (buffer.length > PACKAGE_BYTES_MAX) {
    return makeReport({
      errors: [
        toIssue(
          {
            code: 'E_PKG_TOO_LARGE',
            message: `package is ${buffer.length} bytes; the limit is ${PACKAGE_BYTES_MAX}`,
            field: 'entry',
          },
          'error'
        ),
      ],
      manifest: null,
      bytes: buffer.length,
      source: absPath,
    });
  }
  const decoded = decodeUtf8(buffer);
  if (!decoded.ok) {
    return makeReport({
      errors: [
        toIssue(
          { code: 'E_PKG_HTML_INVALID', message: `package is not valid UTF-8: ${decoded.message}`, field: 'entry' },
          'error'
        ),
      ],
      manifest: null,
      bytes: buffer.length,
      source: absPath,
    });
  }
  return validateHtmlText(decoded.text, {
    source: absPath,
    fileName: options.checkFileName === false ? null : fileName,
    packageBytes: buffer.length,
    skipCompatibility: options.skipCompatibility === true,
  });
}

/**
 * Validate a path: a `.html` file, or a project directory (built in memory
 * first, never written). Returns the report plus optional built HTML.
 */
export async function validatePath(inputPath, options = {}) {
  let stat;
  try {
    stat = fs.statSync(inputPath);
  } catch (_error) {
    throw usageError(`Path does not exist: ${inputPath}`, 'Pass dist/index.html or the game project directory.');
  }
  if (stat.isDirectory()) {
    const { buildProject } = await import('./project.mjs');
    const built = await buildProject(inputPath, {
      write: false,
      validate: false,
      sdk: options.sdk,
      quiet: true,
    });
    const report = validateHtmlText(built.html, {
      source: `${inputPath} (built in memory)`,
      fileName: null,
      skipCompatibility: options.skipCompatibility === true,
    });
    return { report, html: built.html, outFile: null };
  }
  if (!stat.isFile()) throw usageError(`Not a file: ${inputPath}`);
  if (!inputPath.toLowerCase().endsWith('.html')) {
    throw usageError(
      `validate expects a .html package or a project directory, got ${path.basename(inputPath)}`,
      'Run `dsh-game build` first, then validate dist/index.html.'
    );
  }
  return { report: validateFile(inputPath, options), html: null, outFile: null };
}

/** Exit code for a report: 1 when there are errors, 0 otherwise. */
export function exitCodeForReport(report) {
  return report.ok ? EXIT_CODES.OK : EXIT_CODES.INVALID;
}
