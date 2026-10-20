/**
 * `asset-zip-v2` project support for the developer CLI (V1.5-CONTRACTS §1–§4).
 *
 * This module is the ONLY place the CLI builds/packs a resource package. It
 * never re-implements validation policy: paths/descriptors/content/conflicts
 * come from `packages/shared/src/package-v2.js`, and installability is proven
 * by running the Host reader `packages/host/src/zip.js#extractPackageArchive`.
 *
 * Two project shapes are supported:
 *   - source projects (vanilla template): CLI bundles the game entry to
 *     `scripts/main.js`, writes the shared SDK as `dsh-sdk.js`, externalises
 *     styles/assets and writes `game.json` + `dsh-package.json`;
 *   - prebuilt projects (React/Vite template): `dsh-game.config.json` names a
 *     `buildCommand` and a `prebuiltDir`; the CLI runs/uses that build and only
 *     finalises the package manifest + descriptor around its output.
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { bundleExpression } from '../../bundle-lib.mjs';
import { DESCRIPTOR_FILE, LIMITS, PACKAGE_ZIP_EXTENSION } from '../../../packages/shared/src/constants.js';
import { validateManifest } from '../../../packages/shared/src/manifest.js';
import {
  checkCssContent,
  checkHtmlContent,
  checkManifestConflict,
  checkPathConflicts,
  checkZipEntryPath,
  compareFileManifest,
  fileManifestDigest,
  normalizeZipPath,
  validateDescriptor,
} from '../../../packages/shared/src/package-v2.js';
import { EXIT_CODES, CliError, ValidationFailure, usageError } from './cli-error.mjs';
import { ASSET_ZIP_V2, isZipFormat, packageFileName, resolveFormat } from './formats.mjs';
import { dirExists, fileExists, listFilesRecursive, readBuffer, readText, toPosix, writeBuffer, writeText } from './fs-utils.mjs';
import { makeReport, toIssue } from './issues.mjs';
import { REPO_ROOT, SDK_ENTRY, isInside } from './paths.mjs';
import { loadConfig, loadProjectManifest, serializeManifest } from './project.mjs';
import { checkCompatibility } from './validator.mjs';
import { buildZip } from './zip-writer.mjs';

export const TOOLCHAIN_DEPS_CODE = 'E_TOOLCHAIN_DEPS_MISSING';

const HOST_ZIP_MODULE = '../../../packages/host/src/zip.js';
let hostZipModulePromise = null;

/**
 * Map a bare-module failure from the Host archive reader to an actionable CLI
 * error. Clean checkouts have no `node_modules`; `asset-zip-v2` validation/pack
 * needs the repository dependencies (`yauzl`), while html-v1 commands don't.
 */
export function toolchainDepsError(error) {
  if (error && error.code === 'ERR_MODULE_NOT_FOUND') {
    return new CliError(
      'Missing toolchain dependency: asset-zip-v2 validation/packing needs the repository dependencies (the Host archive reader uses "yauzl")',
      EXIT_CODES.USAGE,
      {
        code: TOOLCHAIN_DEPS_CODE,
        hint: 'Run `npm install` (or `npm ci`) at the repository root, then retry. html-v1 commands work without it.',
        cause: error,
      }
    );
  }
  return error;
}

/** Lazily import `packages/host/src/zip.js`; never breaks html-v1-only commands. */
export async function loadHostZipModule() {
  if (hostZipModulePromise === null) {
    hostZipModulePromise = import(HOST_ZIP_MODULE).catch((error) => {
      throw toolchainDepsError(error);
    });
  }
  return hostZipModulePromise;
}

export const ZIP_ENTRY_FILE = 'index.html';
export const ZIP_GAME_MANIFEST_FILE = 'game.json';
export const ZIP_SDK_FILE = 'dsh-sdk.js';
export const DESCRIPTOR_FILE_NAME = DESCRIPTOR_FILE;
const DEFAULT_PREBUILT_DIR = 'dist';
const DEFAULT_RESOURCE_DIRS = Object.freeze(['assets', 'levels', 'audio']);

function zipBuildError(message, hint) {
  return new CliError(message, EXIT_CODES.INVALID, { hint });
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function sortedPaths(map) {
  return [...map.keys()].sort(compareUtf8);
}

/** Read a directory tree into `Map<posixRelativePath, Buffer>`; never follows links. */
export function readTreeMap(directory) {
  const files = new Map();
  if (!dirExists(directory)) return files;
  for (const abs of listFilesRecursive(directory, { skip: ['node_modules', '.git'] })) {
    const rel = toPosix(path.relative(directory, abs));
    const stat = fs.lstatSync(abs);
    if (stat.isSymbolicLink()) throw zipBuildError(`Symbolic links are not allowed in packages: ${rel}`);
    if (!stat.isFile()) throw zipBuildError(`Only regular files are allowed in packages: ${rel}`);
    files.set(rel, readBuffer(abs));
  }
  return files;
}

/** Read a built package directory via its descriptor (ignores packed artifacts). */
export function readPackageDirectory(directory) {
  const descriptorPath = path.join(directory, DESCRIPTOR_FILE_NAME);
  if (!fileExists(descriptorPath)) {
    throw zipBuildError(`No ${DESCRIPTOR_FILE_NAME} in ${directory}`, 'Run `dsh-game build --format asset-zip-v2` first.');
  }
  const descriptorBuffer = readBuffer(descriptorPath);
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(descriptorBuffer));
  } catch (_error) {
    throw zipBuildError(`${DESCRIPTOR_FILE_NAME} is not valid JSON`);
  }
  const validated = validateDescriptor(parsed);
  if (!validated.ok) throw zipBuildError(`${DESCRIPTOR_FILE_NAME} is invalid (${validated.code})`);
  const files = new Map([[DESCRIPTOR_FILE_NAME, descriptorBuffer]]);
  for (const file of validated.value.files) {
    const abs = path.join(directory, file.path);
    if (!isInside(directory, abs)) throw zipBuildError(`Descriptor path escapes the package: ${file.path}`);
    if (!fileExists(abs)) throw zipBuildError(`Package file is missing: ${file.path}`, 'Rebuild the package.');
    files.set(file.path, readBuffer(abs));
  }
  return { files, descriptor: validated.value, entry: validated.value.entry };
}

let cachedSdkGlobal = null;
/** The shared SDK as a classic-script global (`var DSH_GAME_SDK = …;`). */
export function buildSdkGlobalSource() {
  if (cachedSdkGlobal !== null) return cachedSdkGlobal;
  const expression = bundleExpression({ entry: path.relative(REPO_ROOT, SDK_ENTRY), root: REPO_ROOT });
  cachedSdkGlobal = `var DSH_GAME_SDK = ${expression};\n`;
  return cachedSdkGlobal;
}

function attrValue(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag);
  return match ? match[2] : null;
}

function replaceAttr(tag, name, value) {
  const re = new RegExp(`(\\b${name}\\s*=\\s*)(["'])(.*?)\\2`, 'i');
  if (re.test(tag)) return tag.replace(re, (_match, prefix, quote) => `${prefix}${quote}${value}${quote}`);
  return tag;
}

function isExternalReference(reference) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(reference);
}

function resolveProjectFile(projectDir, baseDir, reference, label) {
  const cleaned = String(reference).split('#')[0].split('?')[0];
  const abs = path.resolve(baseDir, cleaned);
  if (!isInside(projectDir, abs)) throw zipBuildError(`${label} escapes the project directory: ${reference}`);
  if (!fileExists(abs)) throw zipBuildError(`${label} not found: ${reference}`, 'Check the path or add the file to the project.');
  return abs;
}

/** Collect externalised assets with deterministic, collision-free names. */
function createAssetAllocator() {
  const bySource = new Map();
  const byOutput = new Map();
  return {
    allocate(absPath, directory, preferredName) {
      if (bySource.has(absPath)) return bySource.get(absPath);
      const data = readBuffer(absPath);
      const digest = sha256(data);
      const ext = path.extname(preferredName || absPath);
      const stem = path.basename(preferredName || absPath, ext);
      let name = `${stem}${ext}`;
      let output = `${directory}/${name}`;
      let counter = 1;
      while (byOutput.has(output) && byOutput.get(output) !== digest) {
        counter += 1;
        name = `${stem}-${digest.slice(0, 8)}${counter > 2 ? `-${counter}` : ''}${ext}`;
        output = `${directory}/${name}`;
      }
      if (!byOutput.has(output)) byOutput.set(output, digest);
      bySource.set(absPath, output);
      return output;
    },
    files() {
      const entries = new Map();
      for (const [absPath, output] of bySource) entries.set(output, readBuffer(absPath));
      return entries;
    },
  };
}

function rewriteCssUrls(projectDir, cssPath, cssText, allocator) {
  return cssText.replace(/url\(\s*(["']?)([^'")]+)\1\s*\)/gi, (match, _quote, reference) => {
    const value = String(reference).trim();
    if (!value || value.startsWith('data:') || value.startsWith('#')) return match;
    if (isExternalReference(value)) {
      throw zipBuildError(`External CSS url() is not allowed in asset-zip-v2: ${value}`, 'Move the asset into the project and reference it relatively.');
    }
    const abs = resolveProjectFile(projectDir, path.dirname(cssPath), value, 'CSS asset');
    const output = allocator.allocate(abs, 'assets');
    return `url("../${output}")`;
  });
}

/**
 * Turn an authored template into the package entry document:
 * inline code is forbidden, so every script/style becomes an external file.
 */
function transformEntryHtml({ projectDir, templatePath, config, manifest, allocator }) {
  let html = readText(templatePath);
  const templateDir = path.dirname(templatePath);
  const styleFiles = new Map();

  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*(["'])stylesheet\1/i.test(tag)) return tag;
    const href = attrValue(tag, 'href');
    if (!href) throw zipBuildError('Stylesheet link is missing href', 'Use a relative href.');
    if (isExternalReference(href)) {
      throw zipBuildError(`External stylesheet is not allowed in asset-zip-v2: ${href}`, 'Ship the CSS inside the package.');
    }
    const abs = resolveProjectFile(projectDir, templateDir, href, 'Stylesheet');
    const data = readBuffer(abs);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    const checked = checkCssContent(text);
    if (!checked.ok) throw zipBuildError(`CSS is not package-safe: ${checked.code}`, 'Remove external @import/url() references.');
    const rewritten = rewriteCssUrls(projectDir, abs, text, allocator);
    const output = `styles/${path.basename(abs)}`;
    if (styleFiles.has(output) && styleFiles.get(output).toString('utf8') !== rewritten) {
      throw zipBuildError(`Two different stylesheets map to ${output}`, 'Rename one of the stylesheets.');
    }
    styleFiles.set(output, Buffer.from(rewritten, 'utf8'));
    return replaceAttr(tag, 'href', output);
  });

  // Media/asset references in markup: local files are externalised under assets/.
  html = html.replace(/<(img|audio|video|source|track)\b[^>]*>/gi, (tag) => {
    const src = attrValue(tag, 'src');
    if (!src) return tag;
    if (src.startsWith('data:')) return tag;
    if (isExternalReference(src)) {
      throw zipBuildError(`External asset is not allowed in asset-zip-v2: ${src}`, 'Move the file into the project.');
    }
    const abs = resolveProjectFile(projectDir, templateDir, src, 'Asset');
    const output = allocator.allocate(abs, 'assets');
    return replaceAttr(tag, 'src', output);
  });

  // Inline scripts are forbidden (D-C) and external ones are replaced by the
  // CLI-built SDK + game bundle, so remove the authored script tags entirely.
  if (/<\s*script\b(?![^>]*\bsrc\s*=)[^>]*>/i.test(html)) {
    throw zipBuildError(
      'asset-zip-v2 packages must not contain inline <script> blocks (contract D-C)',
      'Move the code to the project entry file; the CLI emits scripts/main.js.'
    );
  }
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  html = html.replace(/<script\b[^>]*\/>/gi, '');
  if (!/<\/body>/i.test(html)) throw zipBuildError('Template is missing </body>', 'Start from an official template.');
  html = html.replace(
    /<\/body>/i,
    `    <script src="${ZIP_SDK_FILE}"></script>\n    <script src="scripts/main.js"></script>\n  </body>`
  );

  const conflicts = checkManifestConflict(html);
  if (!conflicts.ok) {
    throw zipBuildError('Entry HTML must not contain an inline game manifest', 'Remove the inline manifest; asset-zip-v2 uses game.json.');
  }
  const content = checkHtmlContent(html, { inlineForbidden: true });
  if (!content.ok) {
    throw zipBuildError(`Entry HTML is not package-safe: ${content.code}`, 'Remove inline styles/handlers, iframes and external URLs.');
  }
  const output = new Map(styleFiles);
  for (const [assetPath, data] of allocator.files()) output.set(assetPath, data);
  return { html, files: output };
}

function entryRelative(projectDir, reference) {
  const abs = path.resolve(projectDir, reference);
  if (!isInside(projectDir, abs)) throw zipBuildError(`entry escapes the project directory: ${reference}`);
  if (!fileExists(abs)) throw zipBuildError(`entry not found: ${reference}`, 'Check "entry" in dsh-game.config.json.');
  return abs;
}

function validateTreeSyntax(entries) {
  const errors = [];
  const warnings = [];
  const paths = sortedPaths(entries);
  for (const entryPath of paths) {
    const checked = checkZipEntryPath(entryPath);
    if (!checked.ok) {
      errors.push({ code: checked.code, message: `archive path ${entryPath} is not allowed`, field: 'path', value: { path: entryPath } });
    }
  }
  const conflicts = checkPathConflicts(paths);
  if (!conflicts.ok) {
    errors.push({ code: conflicts.code, message: 'archive paths conflict', field: 'path', value: conflicts.details });
  }
  for (const entryPath of paths) {
    const lower = entryPath.toLowerCase();
    const data = entries.get(entryPath);
    if (lower.endsWith('.html')) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(data);
      const conflict = checkManifestConflict(text);
      if (!conflict.ok) errors.push({ code: conflict.code, message: `inline manifest in ${entryPath}`, field: 'entry' });
      const content = checkHtmlContent(text, { inlineForbidden: true });
      if (!content.ok) errors.push({ code: content.code, message: `HTML is not package-safe: ${entryPath}`, field: 'entry' });
    } else if (lower.endsWith('.css')) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(data);
      const content = checkCssContent(text);
      if (!content.ok) errors.push({ code: content.code, message: `CSS is not package-safe: ${entryPath}`, field: 'entry' });
    }
  }
  return { errors, warnings };
}

/**
 * Validate a package tree in memory: shared descriptor/path/content policy plus
 * the descriptor-vs-files consistency check. Returns the descriptor + entries.
 */
export function validatePackageTree(entries, options = {}) {
  const map = new Map(entries);
  const entry = options.entry || ZIP_ENTRY_FILE;
  const errors = [];
  const warnings = [];
  const descriptorBuffer = map.get(DESCRIPTOR_FILE_NAME);
  if (!descriptorBuffer) {
    return { ok: false, errors: [{ code: 'E_DESCRIPTOR_INVALID', message: 'dsh-package.json is missing', field: 'descriptor' }], warnings, files: [] };
  }
  let descriptor;
  try {
    descriptor = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(descriptorBuffer));
  } catch (_error) {
    return { ok: false, errors: [{ code: 'E_DESCRIPTOR_INVALID', message: 'dsh-package.json is not valid JSON', field: 'descriptor' }], warnings, files: [] };
  }
  const validated = validateDescriptor(descriptor);
  if (!validated.ok) {
    return { ok: false, errors: [{ code: validated.code, message: 'dsh-package.json is invalid', field: 'descriptor', value: validated.details }], warnings, files: [] };
  }
  warnings.push(...validated.warnings);
  const real = [];
  for (const entryPath of sortedPaths(map)) {
    if (entryPath === DESCRIPTOR_FILE_NAME) continue;
    real.push({ path: entryPath, size: map.get(entryPath).length });
  }
  const consistency = compareFileManifest(validated.value.files, real);
  if (!consistency.ok) {
    errors.push({ code: consistency.code, message: 'descriptor file manifest does not match the package', field: 'files', value: consistency.details });
  }
  const syntax = validateTreeSyntax(map);
  errors.push(...syntax.errors);
  warnings.push(...syntax.warnings);
  for (const file of validated.value.files) {
    const data = map.get(file.path);
    if (!data) continue;
    if (data.length !== file.size) {
      errors.push({ code: 'E_DESCRIPTOR_MISMATCH', message: `size mismatch for ${file.path}`, field: 'files', value: { path: file.path } });
    } else if (sha256(data) !== file.sha256) {
      errors.push({ code: 'E_DESCRIPTOR_MISMATCH', message: `sha256 mismatch for ${file.path}`, field: 'files', value: { path: file.path } });
    }
  }
  if (validated.value.entry !== entry) {
    errors.push({ code: 'E_DESCRIPTOR_INVALID', message: `entry must be ${entry}`, field: 'descriptor' });
  }
  return { ok: errors.length === 0, errors, warnings, descriptor: validated.value, files: validated.value.files };
}

function descriptorFor(files, entry, manifest) {
  const sorted = files.slice().sort((left, right) => compareUtf8(left.path, right.path));
  return {
    formatVersion: 2,
    entry,
    gameManifest: ZIP_GAME_MANIFEST_FILE,
    files: sorted,
  };
}

function packageTreeFromSource(projectDir, config, manifest) {
  const templateRef = typeof config.template === 'string' && config.template ? config.template : ZIP_ENTRY_FILE;
  const templatePath = resolveProjectFile(projectDir, projectDir, templateRef, 'Template');
  const entryRef = typeof config.entry === 'string' && config.entry ? config.entry : 'src/main.js';
  const entryAbs = entryRelative(projectDir, entryRef);
  const allocator = createAssetAllocator();
  const transformed = transformEntryHtml({ projectDir, templatePath, config, manifest, allocator });

  const files = new Map(transformed.files);
  files.set(ZIP_ENTRY_FILE, Buffer.from(transformed.html, 'utf8'));
  files.set(ZIP_SDK_FILE, Buffer.from(buildSdkGlobalSource(), 'utf8'));
  let gameCode;
  try {
    gameCode = bundleExpression({ entry: path.relative(projectDir, entryAbs), root: projectDir });
  } catch (error) {
    throw zipBuildError(`game bundle failed: ${error.message}`, 'asset-zip-v2 source projects must use relative imports only; React projects use prebuiltDir + buildCommand.');
  }
  files.set('scripts/main.js', Buffer.from(`${gameCode};\n`, 'utf8'));

  const resourceDirs = Array.isArray(config.resources) && config.resources.length > 0 ? config.resources : DEFAULT_RESOURCE_DIRS;
  for (const dirRef of resourceDirs) {
    if (typeof dirRef !== 'string' || dirRef.length === 0) continue;
    const absDir = path.resolve(projectDir, dirRef);
    if (!isInside(projectDir, absDir) || !dirExists(absDir)) continue;
    for (const [rel, data] of readTreeMap(absDir)) {
      const output = toPosix(path.join(dirRef, rel));
      if (files.has(output)) throw zipBuildError(`Duplicate package file: ${output}`, 'Rename the resource.');
      files.set(output, data);
    }
  }

  // Enforce the static type whitelist before hashing the descriptor.
  for (const entryPath of files.keys()) {
    const checked = checkZipEntryPath(entryPath);
    if (!checked.ok) throw zipBuildError(`Package file is not allowed: ${entryPath} (${checked.code})`, 'Use a whitelisted static asset type.');
  }

  files.set(ZIP_GAME_MANIFEST_FILE, Buffer.from(serializeManifest(manifest), 'utf8'));
  const fileList = sortedPaths(files).map((entryPath) => ({
    path: entryPath,
    size: files.get(entryPath).length,
    sha256: sha256(files.get(entryPath)),
  }));
  const descriptor = descriptorFor(fileList, ZIP_ENTRY_FILE, manifest);
  files.set(DESCRIPTOR_FILE_NAME, Buffer.from(stableJson(descriptor), 'utf8'));
  return files;
}

function runBuildCommand(projectDir, command) {
  if (typeof command !== 'string' || command.trim().length === 0) return;
  const result = spawnSync(command, {
    cwd: projectDir,
    shell: true,
    stdio: 'pipe',
    encoding: 'utf8',
    env: process.env,
  });
  if (result.error) throw zipBuildError(`buildCommand could not start: ${result.error.message}`, `Check "buildCommand" in dsh-game.config.json.`);
  if (result.status !== 0) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim().slice(-2000);
    throw zipBuildError(`buildCommand failed with exit ${result.status}`, output || `Run it manually in ${projectDir}.`);
  }
}

function packageTreeFromPrebuilt(projectDir, config) {
  const prebuiltRef = typeof config.prebuiltDir === 'string' && config.prebuiltDir ? config.prebuiltDir : DEFAULT_PREBUILT_DIR;
  const prebuiltDir = path.resolve(projectDir, prebuiltRef);
  if (!isInside(projectDir, prebuiltDir) || !dirExists(prebuiltDir)) {
    throw zipBuildError(`prebuiltDir does not exist: ${prebuiltRef}`, 'Run the template build (e.g. `npm run build`) first.');
  }
  const files = readTreeMap(prebuiltDir);
  files.delete(DESCRIPTOR_FILE_NAME);
  files.delete(ZIP_GAME_MANIFEST_FILE);
  const entry = typeof config.entryFile === 'string' && config.entryFile ? config.entryFile : ZIP_ENTRY_FILE;
  if (!files.has(entry)) throw zipBuildError(`prebuilt output has no ${entry}`, `Expected ${prebuiltRef}/${entry}.`);
  return { files, outDir: prebuiltDir, entry };
}

/**
 * Build (or finalise) an `asset-zip-v2` package for a project.
 *
 * @param {string} projectDir
 * @param {{format?:string, write?:boolean, runBuildCommand?:boolean, usePrebuilt?:boolean, quiet?:boolean}} [options]
 */
export async function buildPackageV2(projectDir, options = {}) {
  const root = path.resolve(projectDir);
  const opts = options && typeof options === 'object' ? options : {};
  const config = loadConfig(root);
  const format = resolveFormat({ format: opts.format }, config);
  if (!isZipFormat(format)) throw usageError(`buildPackageV2 only handles ${ASSET_ZIP_V2}`);
  const loaded = loadProjectManifest(root, config);
  const manifestResult = validateManifest(loaded.manifest);
  const errors = [...(manifestResult.errors || [])];
  if (manifestResult.manifest) errors.push(...checkCompatibility(manifestResult.manifest));
  const warnings = [...(manifestResult.warnings || [])];
  if (errors.length > 0) {
    throw new ValidationFailure(makeReport({ errors, warnings, manifest: manifestResult.manifest, source: loaded.manifestPath }), loaded.manifestPath);
  }
  const manifest = manifestResult.manifest;

  let files;
  let outDir;
  let entry = ZIP_ENTRY_FILE;
  const hasBuildCommand = typeof config.buildCommand === 'string' && config.buildCommand.trim().length > 0;
  if (hasBuildCommand) {
    if (opts.usePrebuilt !== true && opts.runBuildCommand !== false) runBuildCommand(root, config.buildCommand);
    const prebuilt = packageTreeFromPrebuilt(root, config);
    files = prebuilt.files;
    outDir = opts.outDir ? path.resolve(opts.outDir) : prebuilt.outDir;
    entry = prebuilt.entry;
    files.set(ZIP_GAME_MANIFEST_FILE, Buffer.from(serializeManifest(manifest), 'utf8'));
    const fileList = sortedPaths(files).map((entryPath) => ({
      path: entryPath,
      size: files.get(entryPath).length,
      sha256: sha256(files.get(entryPath)),
    }));
    files.set(DESCRIPTOR_FILE_NAME, Buffer.from(stableJson(descriptorFor(fileList, entry, manifest)), 'utf8'));
  } else {
    files = packageTreeFromSource(root, config, manifest);
    outDir = opts.outDir ? path.resolve(opts.outDir) : path.resolve(root, typeof config.outDir === 'string' && config.outDir ? config.outDir : DEFAULT_PREBUILT_DIR);
  }

  const tree = validatePackageTree(files, { entry });
  if (!tree.ok) {
    const report = makeReport({ errors: tree.errors, warnings: [...warnings, ...tree.warnings], manifest, source: root });
    throw new ValidationFailure(report, root);
  }

  if (opts.write !== false) {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    for (const entryPath of sortedPaths(files)) {
      const outFile = path.join(outDir, entryPath);
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, files.get(entryPath));
    }
  }

  const zip = buildZip(
    [...sortedPaths(files)]
      .filter((entryPath) => entryPath !== DESCRIPTOR_FILE_NAME)
      .map((entryPath) => ({ path: entryPath, data: files.get(entryPath) }))
      .concat([{ path: DESCRIPTOR_FILE_NAME, data: files.get(DESCRIPTOR_FILE_NAME) }])
  );
  const filesDigest = fileManifestDigest(tree.descriptor.files, sha256);
  const bytes = [...files.values()].reduce((total, data) => total + data.length, 0);
  return {
    ok: true,
    format: ASSET_ZIP_V2,
    entry,
    outDir,
    manifest,
    files: tree.descriptor.files,
    fileCount: tree.descriptor.files.length,
    filesDigest,
    bytes,
    zip: zip.buffer,
    zipEntries: zip.entries,
    /** In-memory package tree (`Map<posixPath, Buffer>`, descriptor included). */
    entries: files,
    warnings: [...warnings, ...tree.warnings],
  };
}

function zipPacketInfo(archive) {
  return {
    format: ASSET_ZIP_V2,
    entry: archive.entry,
    fileCount: archive.fileCount,
    unpackedBytes: archive.unpackedBytes,
    outerBytes: archive.outerBytes,
    filesDigest: archive.fileManifestDigest,
    files: archive.files,
    descriptor: archive.descriptor,
    manifest: archive.manifest,
  };
}

/**
 * Validate a project directory / package directory / `.dshgame.zip` file by
 * actually extracting it with the Host reader. Returns a CLI report plus info.
 */
export async function validatePackageV2(inputPath, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const resolved = path.resolve(inputPath);
  const stat = fs.statSync(resolved);
  let zipBuffer = null;
  let source = resolved;
  let warnings = [];

  if (stat.isFile()) {
    if (!resolved.toLowerCase().endsWith(PACKAGE_ZIP_EXTENSION)) {
      throw usageError(`Not an asset-zip-v2 archive: ${path.basename(resolved)}`, `Expected *${PACKAGE_ZIP_EXTENSION}.`);
    }
    zipBuffer = readBuffer(resolved);
  } else if (stat.isDirectory()) {
    const config = loadConfig(resolved);
    const hasProject = fileExists(path.join(resolved, 'manifest.json')) || fileExists(path.join(resolved, 'src/manifest.json'));
    const hasDescriptor = fileExists(path.join(resolved, DESCRIPTOR_FILE_NAME));
    if (hasProject) {
      const built = await buildPackageV2(resolved, { format: ASSET_ZIP_V2, write: false, usePrebuilt: opts.usePrebuilt === true });
      zipBuffer = built.zip;
      warnings = built.warnings || [];
      source = `${resolved} (built in memory)`;
    } else if (hasDescriptor) {
      const files = readPackageDirectory(resolved).files;
      const tree = validatePackageTree(files);
      if (!tree.ok) {
        const measuredBytes = [...files.values()].reduce((total, data) => total + data.length, 0);
        return {
          report: makeReport({ errors: tree.errors, warnings: tree.warnings, manifest: null, bytes: measuredBytes, source: resolved }),
          info: null,
        };
      }
      const zip = buildZip(
        [...sortedPaths(files)]
          .filter((entryPath) => entryPath !== DESCRIPTOR_FILE_NAME)
          .map((entryPath) => ({ path: entryPath, data: files.get(entryPath) }))
          .concat([{ path: DESCRIPTOR_FILE_NAME, data: files.get(DESCRIPTOR_FILE_NAME) }])
      );
      zipBuffer = zip.buffer;
    } else {
      throw usageError(`${resolved} is not an asset-zip-v2 project or package directory`, 'Pass the project directory, dist/ or the .dshgame.zip file.');
    }
  } else {
    throw usageError(`Not a file or directory: ${resolved}`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-game-validate-'));
  const zipPath = path.join(tempRoot, `package${PACKAGE_ZIP_EXTENSION}`);
  const outDir = path.join(tempRoot, 'unpacked');
  try {
    writeBuffer(zipPath, zipBuffer);
    const { extractPackageArchive } = await loadHostZipModule();
    const archive = await extractPackageArchive({ zipPath, outDir });
    // Bonus: compare the in-memory descriptor digest with the extracted one.
    const info = zipPacketInfo(archive);
    const report = makeReport({
      errors: [],
      warnings,
      manifest: archive.manifest,
      bytes: archive.outerBytes,
      source,
    });
    return { report: { ...report, format: ASSET_ZIP_V2, entry: info.entry, fileCount: info.fileCount, filesDigest: info.filesDigest }, info, html: null, outFile: null };
  } catch (error) {
    // Missing repository deps is an actionable toolchain error, not a package
    // validation failure: keep the CLI hint/exit-code and don't wrap it.
    if (error && error.code === TOOLCHAIN_DEPS_CODE) throw error;
    const code = error && typeof error.code === 'string' ? error.code : 'E_ZIP_INVALID';
    const report = makeReport({
      errors: [toIssue({ code, message: error && error.message ? error.message : 'package archive is not installable', field: 'package' }, 'error')],
      warnings,
      manifest: null,
      bytes: zipBuffer.length,
      source,
    });
    return { report, info: null, html: null, outFile: null };
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    } catch (_error) {
      // best effort cleanup
    }
  }
}

/**
 * Pack an `asset-zip-v2` project/package directory into a deterministic ZIP.
 * Self-test: the produced archive is extracted again with the Host reader and
 * its `fileManifestDigest` and file hashes must match the build result.
 */
export async function packPackageV2(projectDir, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const root = path.resolve(projectDir);
  const config = loadConfig(root);
  const format = resolveFormat({ format: opts.format }, config);
  if (!isZipFormat(format)) throw usageError(`packPackageV2 only handles ${ASSET_ZIP_V2}`);

  let built = null;
  if (!opts.input && (fileExists(path.join(root, 'manifest.json')) || fileExists(path.join(root, 'src/manifest.json')))) {
    built = await buildPackageV2(root, { format: ASSET_ZIP_V2, write: true, usePrebuilt: opts.usePrebuilt === true });
  } else {
    const inputPath = opts.input ? path.resolve(opts.input) : root;
    const stat = fs.statSync(inputPath);
    let files;
    let entry = ZIP_ENTRY_FILE;
    let manifest = null;
    if (stat.isFile()) {
      if (!inputPath.toLowerCase().endsWith(PACKAGE_ZIP_EXTENSION)) {
        throw usageError(`Not an asset-zip-v2 archive: ${path.basename(inputPath)}`, `Expected *${PACKAGE_ZIP_EXTENSION}.`);
      }
      // `extractPackageArchive` returns metadata only; the caller owns the
      // extraction directory it passed in. Read the bytes from there and clean
      // the temp tree up afterwards (no temp paths leak into reports).
      const unpackedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-game-pack-'));
      try {
        const { extractPackageArchive } = await loadHostZipModule();
        const archive = await extractPackageArchive({ zipPath: inputPath, outDir: unpackedDir });
        files = new Map();
        for (const file of archive.files) files.set(file.path, readBuffer(path.join(unpackedDir, file.path)));
        entry = archive.entry;
        manifest = archive.manifest;
      } finally {
        fs.rmSync(unpackedDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
      }
      files.set(ZIP_GAME_MANIFEST_FILE, Buffer.from(serializeManifest(manifest), 'utf8'));
      const list = sortedPaths(files).map((entryPath) => ({ path: entryPath, size: files.get(entryPath).length, sha256: sha256(files.get(entryPath)) }));
      files.set(DESCRIPTOR_FILE_NAME, Buffer.from(stableJson(descriptorFor(list, entry, manifest)), 'utf8'));
    } else if (stat.isDirectory()) {
      files = readPackageDirectory(inputPath).files;
      const tree = validatePackageTree(files);
      if (!tree.ok) throw new ValidationFailure(makeReport({ errors: tree.errors, warnings: tree.warnings, source: inputPath }), inputPath);
      entry = tree.descriptor.entry;
      manifest = JSON.parse(new TextDecoder('utf-8').decode(files.get(ZIP_GAME_MANIFEST_FILE)));
    } else {
      throw usageError(`Not a package file or directory: ${inputPath}`);
    }
    const tree = validatePackageTree(files, { entry });
    if (!tree.ok) throw new ValidationFailure(makeReport({ errors: tree.errors, warnings: tree.warnings, source: inputPath }), inputPath);
    const zip = buildZip(
      [...sortedPaths(files)]
        .filter((entryPath) => entryPath !== DESCRIPTOR_FILE_NAME)
        .map((entryPath) => ({ path: entryPath, data: files.get(entryPath) }))
        .concat([{ path: DESCRIPTOR_FILE_NAME, data: files.get(DESCRIPTOR_FILE_NAME) }])
    );
    built = {
      ok: true,
      format: ASSET_ZIP_V2,
      entry,
      outDir: stat.isDirectory() ? inputPath : path.dirname(inputPath),
      manifest,
      files: tree.descriptor.files,
      fileCount: tree.descriptor.files.length,
      filesDigest: fileManifestDigest(tree.descriptor.files, sha256),
      bytes: [...files.values()].reduce((total, data) => total + data.length, 0),
      zip: zip.buffer,
      zipEntries: zip.entries,
      warnings: tree.warnings,
    };
  }

  if (!built.manifest || typeof built.manifest.id !== 'string' || typeof built.manifest.version !== 'string') {
    throw zipBuildError('manifest has no usable id/version');
  }
  const fileName = packageFileName(built.manifest.id, built.manifest.version, ASSET_ZIP_V2);
  const outDir = opts.outDir ? path.resolve(opts.outDir) : built.outDir;
  const outFile = path.join(outDir, fileName);
  const sha256Value = sha256(built.zip);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-game-selftest-'));
  let selfTest;
  try {
    const zipPath = path.join(tempRoot, fileName);
    const unpacked = path.join(tempRoot, 'unpacked');
    writeBuffer(zipPath, built.zip);
    const { extractPackageArchive } = await loadHostZipModule();
    const archive = await extractPackageArchive({ zipPath, outDir: unpacked });
    const matches = archive.fileManifestDigest === built.filesDigest && archive.entry === built.entry && archive.fileCount === built.fileCount;
    selfTest = {
      ok: matches,
      entry: archive.entry,
      fileCount: archive.fileCount,
      filesDigest: archive.fileManifestDigest,
      matchesBuild: matches,
    };
    if (!matches) throw zipBuildError('packed archive failed its self-test', 'Descriptor/files/digest do not round-trip; please report this.');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
  if (opts.write !== false) {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    writeBuffer(outFile, built.zip);
    writeText(`${outFile}.sha256`, `${sha256Value}  ${fileName}\n`);
  }
  return {
    ok: true,
    format: ASSET_ZIP_V2,
    id: built.manifest.id,
    version: built.manifest.version,
    entry: built.entry,
    input: built.outDir,
    outDir,
    outFile,
    digestFile: `${outFile}.sha256`,
    fileName,
    sha256: sha256Value,
    bytes: built.zip.length,
    fileCount: built.fileCount,
    filesDigest: built.filesDigest,
    permissions: built.zipEntries.map((entry) => ({ path: entry.path, mode: entry.mode.toString(8) })),
    selfTest,
    manifest: built.manifest,
    warnings: built.warnings,
  };
}
