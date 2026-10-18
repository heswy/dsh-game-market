/**
 * `dsh-game pack`: copy a validated build to `dist/<id>-<version>.html` and
 * write a `shasum -a 256` compatible digest file (PRD §8.2.8).
 *
 * The package bytes are copied exactly; only the file name changes. The digest
 * file format is `<64 lowercase hex><two spaces><file name>\n`.
 */

import fs from 'node:fs';
import path from 'node:path';

import { packageFileName } from '../../../packages/shared/src/manifest.js';
import { ValidationFailure, usageError } from './cli-error.mjs';
import { dirExists, fileExists, readBuffer, sha256Hex, writeBuffer, writeText } from './fs-utils.mjs';
import { makeReport, toIssue } from './issues.mjs';
import { defaultOutFile } from './project.mjs';
import { validateFile } from './validator.mjs';

/**
 * Locate the built `index.html` for a project (or accept an explicit file).
 * @returns {string} absolute package HTML path
 */
export function resolvePackInput(projectDir, explicitPath) {
  if (typeof explicitPath === 'string' && explicitPath.length > 0) {
    const abs = path.resolve(explicitPath);
    if (dirExists(abs)) {
      if (!dirExists(path.join(abs, 'dist'))) {
        throw usageError(`No dist/ directory in ${abs}`, 'Run `dsh-game build` first.');
      }
      return resolvePackInput(abs, null);
    }
    if (!fileExists(abs)) throw usageError(`Package file does not exist: ${abs}`);
    return abs;
  }
  const out = defaultOutFile(projectDir);
  if (fileExists(out)) return out;
  const indexFile = path.join(projectDir, 'dist/index.html');
  if (fileExists(indexFile)) return indexFile;
  const packaged = path.join(projectDir, 'dist');
  if (dirExists(packaged)) {
    const candidates = fs
      .readdirSync(packaged)
      .filter((name) => name.endsWith('.html'))
      .sort();
    if (candidates.length === 1) return path.join(packaged, candidates[0]);
  }
  throw usageError(`No built package found in ${projectDir}`, 'Run `dsh-game build` first.');
}

/**
 * @param {string} projectDir
 * @param {{input?: string, outDir?: string, write?: boolean}} [options]
 */
export function packProject(projectDir, options = {}) {
  const root = path.resolve(projectDir);
  const input = resolvePackInput(root, options.input);
  const report = validateFile(input);
  if (!report.ok) {
    throw new ValidationFailure(report, input);
  }
  const manifest = report.manifest;
  if (!manifest || typeof manifest.id !== 'string' || typeof manifest.version !== 'string') {
    throw new ValidationFailure(
      makeReport({
        errors: [toIssue({ code: 'E_PKG_ID_INVALID', message: 'manifest has no usable id/version', field: 'manifest' }, 'error')],
        source: input,
      }),
      input
    );
  }
  const fileName = packageFileName(manifest.id, manifest.version);
  const outDir = options.outDir ? path.resolve(options.outDir) : path.dirname(input);
  const outFile = path.join(outDir, fileName);
  const buffer = readBuffer(input);
  const sha256 = sha256Hex(buffer);

  if (options.write !== false) {
    writeBuffer(outFile, buffer);
    writeText(`${outFile}.sha256`, `${sha256}  ${fileName}\n`);
  }

  return {
    ok: true,
    id: manifest.id,
    version: manifest.version,
    input,
    outFile,
    digestFile: `${outFile}.sha256`,
    fileName,
    sha256,
    bytes: buffer.length,
    manifest,
    warnings: report.warnings,
  };
}
