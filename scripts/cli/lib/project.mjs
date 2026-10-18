/**
 * `dsh-game build`: turn a template project (manifest source + src/) into one
 * deterministic, self-contained `dist/index.html` (PRD §8.2.1/§8.2.8).
 *
 * Determinism rules:
 *   - inline assets in document order; arrays/objects serialized with a fixed
 *     key order; no timestamps, machine paths, random ids or sourcemaps;
 *   - LF newlines, UTF-8 without BOM, exactly one trailing newline.
 *
 * The SDK (and its shared contract modules) is bundled into the output with
 * `scripts/bundle-lib.mjs`, the same zero-dependency bundler used by the
 * repository build. Game source is bundled relative to the project root so the
 * emitted module ids stay machine-independent.
 */

import fs from 'node:fs';
import path from 'node:path';

import { bundleExpression } from '../../bundle-lib.mjs';
import { validateManifest } from '../../../packages/shared/src/manifest.js';
import { EXIT_CODES, CliError, ValidationFailure, usageError } from './cli-error.mjs';
import {
  dirExists,
  fileExists,
  normalizeNewlines,
  readText,
  sha256Hex,
  stripBom,
  toPosix,
  writeText,
} from './fs-utils.mjs';
import { makeReport } from './issues.mjs';
import { REPO_ROOT, SDK_ENTRY, isInside, resolveInside } from './paths.mjs';
import { checkCompatibility, validateHtmlText } from './validator.mjs';

export const CONFIG_FILE = 'dsh-game.config.json';
export const MANIFEST_FILE = 'manifest.json';
export const OUTPUT_FILE = 'dist/index.html';

const TOP_LEVEL_ORDER = Object.freeze([
  'manifestVersion',
  'id',
  'name',
  'version',
  'author',
  'description',
  'categories',
  'capabilities',
  'sdkVersion',
  'runtimeVersion',
  'icon',
  'tags',
  'preferredTheme',
  'viewport',
  'score',
  'save',
  'permissions',
  'homepage',
  'repository',
  'license',
  'i18n',
]);

const MIME_TYPES = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
});

function buildError(message, hint) {
  return new CliError(message, EXIT_CODES.INVALID, { hint });
}

export function loadConfig(projectDir) {
  const configPath = path.join(projectDir, CONFIG_FILE);
  if (!fileExists(configPath)) return {};
  try {
    const parsed = JSON.parse(readText(configPath));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    throw usageError(`Invalid ${CONFIG_FILE}: ${error.message}`);
  }
}

function locate(projectDir, configured, candidates) {
  if (typeof configured === 'string' && configured.length > 0) {
    let abs;
    try {
      abs = resolveInside(projectDir, configured);
    } catch (error) {
      throw usageError(error.message);
    }
    if (!fileExists(abs)) throw usageError(`Configured file does not exist: ${configured}`);
    return abs;
  }
  for (const candidate of candidates) {
    const abs = path.join(projectDir, candidate);
    if (fileExists(abs)) return abs;
  }
  throw usageError(`Missing ${candidates.join(' or ')} in ${projectDir}`, 'Run `create-dsh-game` to get a complete project.');
}

export function loadProjectManifest(projectDir, config = loadConfig(projectDir)) {
  const manifestPath = locate(projectDir, config.manifest, [MANIFEST_FILE, 'src/manifest.json']);
  return { manifestPath, manifest: JSON.parse(readText(manifestPath)) };
}

function stableValue(value, topLevel) {
  if (Array.isArray(value)) return value.map((item) => stableValue(item, false));
  if (!value || typeof value !== 'object') return value;
  const keys = Object.keys(value);
  const ordered = topLevel
    ? [...TOP_LEVEL_ORDER.filter((key) => keys.includes(key)), ...keys.filter((key) => !TOP_LEVEL_ORDER.includes(key)).sort()]
    : keys.sort();
  const out = {};
  for (const key of ordered) out[key] = stableValue(value[key], false);
  return out;
}

/** Fixed-order, fixed-indent manifest JSON (no timestamps, no extra whitespace). */
export function serializeManifest(manifest) {
  return `${JSON.stringify(stableValue(manifest, true), null, 2)}\n`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function safeInlineScript(code) {
  return code.replace(/<\/script/gi, '<\\/script');
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
  return /^(?:[a-z]+:)?\/\//i.test(reference);
}

function mimeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function assertInsideProject(projectDir, absPath, label) {
  if (!isInside(projectDir, absPath)) {
    throw buildError(`${label} escapes the project directory: ${referenceLabel(projectDir, absPath)}`);
  }
}

function referenceLabel(projectDir, absPath) {
  return toPosix(path.relative(projectDir, absPath));
}

function dataUriFor(projectDir, absPath) {
  if (!isInside(projectDir, absPath)) {
    throw buildError(`Asset escapes the project directory: ${path.relative(projectDir, absPath)}`);
  }
  if (!fileExists(absPath)) {
    throw buildError(`Referenced asset not found: ${toPosix(path.relative(projectDir, absPath))}`, 'Check the path or move the file into the project.');
  }
  const buffer = fs.readFileSync(absPath);
  return `data:${mimeFor(absPath)};base64,${buffer.toString('base64')}`;
}

function resolveReference(projectDir, baseDir, reference) {
  const cleaned = reference.split('#')[0].split('?')[0];
  return path.resolve(baseDir, cleaned);
}

function inlineCssAssets(projectDir, css, cssDir) {
  return css.replace(/url\(\s*(["']?)([^'")]+)\1\s*\)/gi, (match, _quote, reference) => {
    const value = String(reference).trim();
    if (!value || value.startsWith('data:') || value.startsWith('#') || isExternalReference(value)) return match;
    const abs = resolveReference(projectDir, cssDir, value);
    return `url("${dataUriFor(projectDir, abs)}")`;
  });
}

function inlineStylesheets(projectDir, html) {
  return html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) return tag;
    const href = attrValue(tag, 'href');
    if (!href || isExternalReference(href) || href.startsWith('data:')) return tag;
    const abs = resolveReference(projectDir, projectDir, href);
    assertInsideProject(projectDir, abs, 'Stylesheet');
    if (!fileExists(abs)) {
      throw buildError(`Stylesheet not found: ${href}`, 'Check the <link rel="stylesheet"> path.');
    }
    const css = inlineCssAssets(projectDir, stripBom(fs.readFileSync(abs, 'utf8')), path.dirname(abs));
    return `<style>\n${normalizeNewlines(css).trimEnd()}\n</style>`;
  });
}

function inlineHtmlAssets(projectDir, html) {
  const assetTags = /<(img|source|audio|video|track|input)\b[^>]*>/gi;
  let output = html.replace(assetTags, (tag) => {
    if (/\bsrcset\s*=/i.test(tag)) {
      throw buildError(
        'srcset is not supported in a single-file package',
        'Inline one image per <img src="data:…"> or generate the sources in JS.'
      );
    }
    const src = attrValue(tag, 'src');
    if (!src || src.startsWith('data:') || src.startsWith('#') || isExternalReference(src)) return tag;
    const abs = resolveReference(projectDir, projectDir, src);
    return replaceAttr(tag, 'src', dataUriFor(projectDir, abs));
  });
  output = output.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\brel\s*=\s*["']?(?:icon|apple-touch-icon|shortcut icon)/i.test(tag)) return tag;
    const href = attrValue(tag, 'href');
    if (!href || href.startsWith('data:') || isExternalReference(href)) return tag;
    const abs = resolveReference(projectDir, projectDir, href);
    return replaceAttr(tag, 'href', dataUriFor(projectDir, abs));
  });
  return output;
}

let cachedSdkExpression = null;

function sdkExpression() {
  if (cachedSdkExpression === null) {
    cachedSdkExpression = bundleExpression({ entry: toPosix(path.relative(REPO_ROOT, SDK_ENTRY)), root: REPO_ROOT });
  }
  return cachedSdkExpression;
}

function inlineScripts(projectDir, html, config) {
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let bundledCount = 0;
  const output = html.replace(scriptRe, (match, attrs, _body) => {
    const src = attrValue(attrs, 'src');
    if (!src) return match;
    if (isExternalReference(src) || src.startsWith('data:')) return match;
    const abs = resolveReference(projectDir, projectDir, src);
    assertInsideProject(projectDir, abs, 'Script');
    if (!fileExists(abs)) {
      throw buildError(`Script not found: ${src}`, 'Check the <script src="..."> path.');
    }
    const extension = path.extname(abs).toLowerCase();
    let code;
    if (/\btype\s*=\s*["']module["']/i.test(attrs) || extension === '.js' || extension === '.mjs') {
      try {
        code = bundleExpression({ entry: toPosix(path.relative(projectDir, abs)), root: projectDir });
      } catch (error) {
        throw buildError(`Cannot bundle ${toPosix(path.relative(projectDir, abs))}: ${error.message}`, 'Only relative imports with explicit .js extensions and named exports are supported.');
      }
    } else {
      code = stripBom(fs.readFileSync(abs, 'utf8'));
    }
    bundledCount += 1;
    return `<script>\n${safeInlineScript(normalizeNewlines(code)).trimEnd()}\n</script>`;
  });

  if (typeof config.entry === 'string' && config.entry.length > 0 && bundledCount === 0) {
    let entryAbs;
    try {
      entryAbs = resolveInside(projectDir, config.entry);
    } catch (error) {
      throw usageError(error.message);
    }
    if (!fileExists(entryAbs)) throw usageError(`Configured entry does not exist: ${config.entry}`);
    let code;
    try {
      code = bundleExpression({ entry: toPosix(path.relative(projectDir, entryAbs)), root: projectDir });
    } catch (error) {
      throw buildError(`Cannot bundle ${config.entry}: ${error.message}`);
    }
    const script = `<script>\n${safeInlineScript(normalizeNewlines(code)).trimEnd()}\n</script>`;
    if (/<\/body>/i.test(output)) return output.replace(/<\/body>/i, `${script}\n</body>`);
    return `${output}\n${script}\n`;
  }

  return output;
}

/**
 * Inject the SDK as its own leading script so inline game scripts that run
 * before an external entry also see `DSH_GAME_SDK`. `config.sdk === false`
 * disables injection (advanced: the project ships its own runtime bundle).
 */
function injectSdk(html, config) {
  if (config.sdk === false) return html;
  const script = `<script>\nvar DSH_GAME_SDK = ${safeInlineScript(sdkExpression())};\n</script>`;
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (tag) => `${tag}\n${script}`);
  return `${script}\n${html}`;
}

function injectManifest(projectDir, html, manifestJson) {
  if (/<script\b[^>]*\bid\s*=\s*["']dsh-game-manifest["']/i.test(html)) {
    throw buildError(
      'Template already contains a dsh-game-manifest script',
      'Keep manifest values in manifest.json; build injects the inline manifest itself.'
    );
  }
  const tag = `<script type="application/json" id="dsh-game-manifest">\n${manifestJson.trimEnd()}\n</script>`;
  if (html.includes('<!-- __DSH_GAME_MANIFEST__ -->')) {
    return html.replaceAll('<!-- __DSH_GAME_MANIFEST__ -->', tag);
  }
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (match) => `${match}\n${tag}`);
  }
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tag}\n</head>`);
  const title = /<html\b[^>]*>/i;
  if (title.test(html)) return html.replace(title, (match) => `${match}\n${tag}`);
  throw buildError('Template is missing <html> and cannot embed the manifest', 'Start from the official template.');
}

function injectTitle(html, manifest) {
  const escaped = escapeHtml(manifest.name || manifest.id || 'Game');
  let output = html.replaceAll('__GAME_TITLE__', escaped);
  output = output.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escaped}</title>`);
  return output;
}

function manifestErrorReport(projectDir, error, manifest) {
  return makeReport({
    errors: [
      {
        code: 'E_PKG_MANIFEST_JSON',
        message: `manifest.json is not valid JSON: ${error.message}`,
        field: 'manifest',
      },
    ],
    warnings: [],
    manifest,
    bytes: 0,
    source: projectDir,
  });
}

/**
 * Build a project.
 *
 * @param {string} projectDir
 * @param {{out?: string, write?: boolean, validate?: boolean, sdk?: boolean, quiet?: boolean}} [options]
 * @returns {Promise<{html:string, bytes:number, sha256:string, manifest:object, warnings:object[], outFile:string|null}>}
 */
export async function buildProject(projectDir, options = {}) {
  const root = path.resolve(projectDir);
  if (!dirExists(root)) throw usageError(`Project directory does not exist: ${root}`);
  const config = loadConfig(root);
  if (options.sdk === false) config.sdk = false;

  const manifestPath = locate(root, config.manifest, [MANIFEST_FILE, 'src/manifest.json']);
  let manifest;
  try {
    manifest = JSON.parse(readText(manifestPath));
  } catch (error) {
    throw new ValidationFailure(manifestErrorReport(root, error, null), manifestPath);
  }

  const manifestResult = validateManifest(manifest);
  if (!manifestResult.ok) {
    throw new ValidationFailure(
      makeReport({
        errors: manifestResult.errors,
        warnings: manifestResult.warnings,
        manifest,
        bytes: 0,
        source: manifestPath,
      }),
      manifestPath
    );
  }
  const compatibility = checkCompatibility(manifest);
  if (compatibility.length > 0) {
    throw new ValidationFailure(
      makeReport({ errors: compatibility, warnings: manifestResult.warnings, manifest, bytes: 0, source: manifestPath }),
      manifestPath
    );
  }

  const templatePath = locate(root, config.template, ['index.html', 'src/index.html']);
  let html = normalizeNewlines(stripBom(readText(templatePath)));

  html = injectTitle(html, manifest);
  html = injectSdk(html, config);
  html = inlineStylesheets(root, html);
  html = inlineHtmlAssets(root, html);
  html = inlineScripts(root, html, config);
  html = injectManifest(root, html, serializeManifest(manifest));

  html = normalizeNewlines(html);
  if (!html.endsWith('\n')) html += '\n';

  const report = validateHtmlText(html, { source: root, fileName: null });
  if (!report.ok) throw new ValidationFailure(report, root);

  const warnings = [];
  const seen = new Set();
  for (const warning of [...manifestResult.warnings, ...report.warnings]) {
    const key = `${warning.code}:${warning.path || warning.field || ''}:${warning.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push(warning);
  }

  const bytes = Buffer.byteLength(html, 'utf8');
  const sha256 = sha256Hex(Buffer.from(html, 'utf8'));
  let outFile = null;
  if (options.write !== false) {
    if (typeof options.out === 'string' && options.out.length > 0) {
      outFile = path.resolve(options.out);
    } else {
      outFile = path.resolve(root, typeof config.out === 'string' && config.out ? config.out : OUTPUT_FILE);
    }
    writeText(outFile, html);
  }

  return { html, bytes, sha256, manifest, warnings, outFile };
}

/** Default built entry for a project (`config.out` or `dist/index.html`). */
export function defaultOutFile(projectDir) {
  const config = loadConfig(projectDir);
  return path.resolve(projectDir, typeof config.out === 'string' && config.out ? config.out : OUTPUT_FILE);
}
