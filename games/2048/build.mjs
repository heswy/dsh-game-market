#!/usr/bin/env node
/**
 * Build 2048 into a single self-contained HTML package:
 *   games/2048/dist/index.html
 *
 * Contract (docs/V1-CONTRACTS.md §2, §3; PRD v2.2 §8.2):
 *   - game.json is the build-time manifest source; it is serialized into the
 *     one and only `<script type="application/json" id="dsh-game-manifest">`.
 *   - No entry/cover/screenshots fields; no external resources; no network
 *     APIs; SDK + game + CSS are inlined.
 *   - Deterministic: two builds of the same sources produce byte-identical
 *     output (no timestamps, paths or random ids).
 *
 * The shared validators used by the Host/CLI are imported read-only so a
 * green build means the package would pass `validatePackageHtml`.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { bundleExpression } from '../../scripts/bundle-lib.mjs';
import { checkSelfContained, extractManifest, validateManifest, validatePackageHtml } from '../../packages/shared/src/manifest.js';
import { LIMITS } from '../../packages/shared/src/constants.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const gameDir = here;
const root = path.resolve(gameDir, '../..');

export const GAME_ID = '2048';
export const BUILD_FILE = 'dist/index.html';
const MANIFEST_FIELDS = [
  'manifestVersion',
  'id',
  'name',
  'version',
  'author',
  'description',
  'categories',
  'tags',
  'capabilities',
  'sdkVersion',
  'runtimeVersion',
  'preferredTheme',
  'viewport',
  'score',
  'save',
  'homepage',
  'repository',
  'license',
  'permissions',
];
const TEMPLATE_PLACEHOLDERS = ['__MANIFEST_JSON__', '__INLINE_SCRIPT__', '__GAME_TITLE__', '__GAME_VERSION__'];

function fail(message) {
  throw new Error(`[build:2048] ${message}`);
}

function readManifest() {
  const manifestPath = path.join(gameDir, 'game.json');
  if (!fs.existsSync(manifestPath)) fail('missing games/2048/game.json');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`game.json is not valid JSON: ${error.message}`);
  }
  if (manifest.id !== GAME_ID) fail(`manifest id must be "${GAME_ID}"`);

  const result = validateManifest(manifest);
  if (!result.ok) {
    const details = result.errors.map((error) => `${error.code}: ${error.message}`).join('\n  ');
    fail(`manifest failed validation:\n  ${details}`);
  }
  for (const warning of result.warnings) {
    console.warn(`[build:2048] warning ${warning.code}: ${warning.message}`);
  }
  return manifest;
}

/** Stable JSON text for the embedded manifest (key order fixed, `<` escaped). */
export function serializeManifest(manifest) {
  const ordered = {};
  for (const field of MANIFEST_FIELDS) {
    if (manifest[field] !== undefined) ordered[field] = manifest[field];
  }
  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_FIELDS.includes(key)) ordered[key] = manifest[key];
  }
  return JSON.stringify(ordered, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bundle(entry, label) {
  try {
    return bundleExpression({ entry, root });
  } catch (error) {
    fail(`${label} bundling failed: ${error.message}`);
  }
}

/**
 * Build the package in memory.
 * @returns {{html:string, bytes:number, sha256:string, manifest:object, warnings:object[]}}
 */
export function buildGame() {
  const manifest = readManifest();
  const templatePath = path.join(gameDir, 'src/index.html.tpl');
  if (!fs.existsSync(templatePath)) fail('missing games/2048/src/index.html.tpl');
  const template = fs.readFileSync(templatePath, 'utf8');
  for (const placeholder of TEMPLATE_PLACEHOLDERS) {
    if (!template.includes(placeholder)) fail(`template is missing ${placeholder}`);
  }

  const sdkCode = bundle('packages/sdk/src/sdk.js', 'SDK');
  const gameCode = bundle('games/2048/src/game.js', 'game');
  const combined = `var DSH_GAME_SDK = ${sdkCode};\n\n${gameCode};`;
  const safeScript = combined.replace(/<\/script/gi, '<\\/script');

  let html = template
    .replaceAll('__GAME_TITLE__', escapeHtml(manifest.name || '2048'))
    .replaceAll('__GAME_VERSION__', escapeHtml(manifest.version || '0.0.0'))
    .replace('__MANIFEST_JSON__', serializeManifest(manifest))
    .replace('__INLINE_SCRIPT__', safeScript);

  if (html.includes('__MANIFEST_JSON__') || html.includes('__INLINE_SCRIPT__')) {
    fail('template placeholders were not fully replaced');
  }

  const extracted = extractManifest(html);
  if (!extracted.ok) fail(`embedded manifest extraction failed: ${extracted.errors.map((error) => error.code).join(', ')}`);
  const embedded = JSON.parse(extracted.jsonText);
  if (embedded.id !== manifest.id || embedded.version !== manifest.version) {
    fail('embedded manifest does not match game.json');
  }

  const violations = checkSelfContained(html);
  if (violations.length > 0) {
    fail(`package is not self-contained:\n  ${violations.map((item) => item.message).join('\n  ')}`);
  }

  const packageResult = validatePackageHtml(html);
  if (!packageResult.ok) {
    fail(`validatePackageHtml failed:\n  ${packageResult.errors.map((error) => `${error.code}: ${error.message}`).join('\n  ')}`);
  }

  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > LIMITS.entryBytes) fail(`entry is too large: ${bytes} > ${LIMITS.entryBytes}`);
  if (html.startsWith('\uFEFF')) fail('entry must not start with a BOM');

  const sha256 = crypto.createHash('sha256').update(html, 'utf8').digest('hex');
  return { html, bytes, sha256, manifest, warnings: packageResult.warnings };
}

/** Build and write dist/index.html. Returns the build result plus the output path. */
export function writeBuild() {
  const result = buildGame();
  const outFile = path.join(gameDir, BUILD_FILE);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, result.html, 'utf8');
  return { ...result, outFile };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const result = writeBuild();
    const relative = path.relative(root, result.outFile);
    console.log(
      `[build:2048] ${result.manifest.id}@${result.manifest.version} · ${result.manifest.categories.join(',')} · ` +
        `${result.manifest.capabilities.join('+')} · viewport ${result.manifest.viewport.width}x${result.manifest.viewport.height}`
    );
    console.log(`[build:2048] wrote ${relative} (${result.bytes} bytes)`);
    console.log(`[build:2048] sha256 ${result.sha256}`);
    if (result.warnings.length > 0) {
      for (const warning of result.warnings) console.warn(`[build:2048] warning ${warning.code}: ${warning.message}`);
    }
  } catch (error) {
    console.error(error && error.message ? error.message : error);
    process.exit(1);
  }
}
