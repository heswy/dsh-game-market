#!/usr/bin/env node
/**
 * Build the V1 single-file, self-contained snake package:
 *   games/snake/dist/index.html
 *
 * V1 contract (docs/V1-CONTRACTS.md §2, §3, §8.6):
 *   - `games/snake/game.json` is the build-time manifest source. The embedded
 *     manifest must pass `validateManifest` (manifest v1) and is written exactly
 *     once into `<script type="application/json" id="dsh-game-manifest">`
 *     (<= 64 KiB), with no `entry` / `cover` / `screenshots` field.
 *   - The package is one HTML file with no external resources. It is validated
 *     with the shared `validatePackageHtml` (the same scanner Host/CLI use), so
 *     "build green" always means "installable package".
 *   - The SDK inlined below is version 1.0.0 (packages/sdk/src/sdk.js); the
 *     manifest range must accept the platform SDK/Runtime versions.
 *   - Build output is deterministic: same inputs => byte-identical HTML.
 *
 * Layout:
 *   - SDK entry: packages/sdk/src/sdk.js exports { createGameSDK }
 *   - Game entry: games/snake/src/game.js (ESM, imports ./logic.js and ./resume.js)
 *   - Template: games/snake/src/index.html.tpl with __INLINE_SCRIPT__,
 *     __MANIFEST_JSON__, __GAME_TITLE__, __GAME_VERSION__ placeholders.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleExpression } from './bundle-lib.mjs';
import { LIMITS, RUNTIME_VERSION, SDK_VERSION } from '../packages/shared/src/constants.js';
import {
  MANIFEST_BYTES_MAX,
  MANIFEST_SCRIPT_ID,
  extractManifest,
  validateManifest,
  validatePackageHtml,
} from '../packages/shared/src/manifest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const gameDir = path.join(root, 'games/snake');
const manifestPath = path.join(gameDir, 'game.json');
const templatePath = path.join(gameDir, 'src/index.html.tpl');
const gameSourcePath = path.join(gameDir, 'src/game.js');
const sdkEntry = path.join(root, 'packages/sdk/src/sdk.js');
const outDir = path.join(gameDir, 'dist');
const outFile = path.join(outDir, 'index.html');

/** V0 package entry path; kept only for the legacy source field. */
const LEGACY_ENTRY = 'dist/index.html';
/** V1 package manifests never carry file-list fields. */
const REMOVED_FIELDS = ['cover', 'screenshots'];
/** The V1 build pins the current platform versions; bump together with shared/constants.js. */
const EXPECTED_RANGE = '^1.0.0';

function fail(message) {
  console.error(`[build:snake] ${message}`);
  process.exit(1);
}

for (const required of [manifestPath, templatePath, gameSourcePath, sdkEntry]) {
  if (!fs.existsSync(required)) fail(`missing ${path.relative(root, required)}`);
}

// ---------------------------------------------------------------------------
// 1. Manifest source -> manifest v1 (embedded in the package)
// ---------------------------------------------------------------------------
let sourceManifest;
try {
  sourceManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (error) {
  fail(`games/snake/game.json is not valid JSON: ${error.message}`);
}
if (!sourceManifest || typeof sourceManifest !== 'object' || Array.isArray(sourceManifest)) {
  fail('games/snake/game.json must be a JSON object');
}

const manifest = { ...sourceManifest };

// The repository-level V0 checker still requires `entry` in the build-time
// source (scripts/check.mjs), so the source may keep it. It is *not* part of
// the V1 package manifest and is stripped before embedding/validation. When the
// checker is migrated to V1, simply delete the field from game.json; this build
// works either way.
if (manifest.entry !== undefined) {
  if (manifest.entry !== LEGACY_ENTRY) {
    fail(`game.json entry, when present, must be "${LEGACY_ENTRY}" (or omit it in V1)`);
  }
  delete manifest.entry;
}
for (const removed of REMOVED_FIELDS) {
  if (manifest[removed] !== undefined) {
    fail(`game.json must not declare "${removed}" (V1 packages carry no cover/screenshots)`);
  }
}

if (manifest.id !== 'snake') fail('game.json id must be "snake"');
if (manifest.version !== '1.0.0') fail('game.json version must be 1.0.0 for the V1 release');
if (manifest.sdkVersion !== EXPECTED_RANGE) fail(`game.json sdkVersion must be "${EXPECTED_RANGE}"`);
if (manifest.runtimeVersion !== EXPECTED_RANGE) fail(`game.json runtimeVersion must be "${EXPECTED_RANGE}"`);

const manifestCheck = validateManifest(manifest);
if (!manifestCheck.ok) {
  for (const error of manifestCheck.errors) {
    console.error(`[build:snake] manifest ${error.code}: ${error.message}`);
  }
  fail('game.json failed manifest v1 validation');
}
for (const warning of manifestCheck.warnings) {
  console.warn(`[build:snake] manifest warning ${warning.code}: ${warning.message}`);
}

if (SDK_VERSION !== '1.0.0' || RUNTIME_VERSION !== '1.0.0') {
  fail(`platform SDK/Runtime version changed (sdk=${SDK_VERSION}, runtime=${RUNTIME_VERSION}); review the V1 pin`);
}

// Deterministic JSON text: the source key order is preserved by JSON.stringify.
// `<` becomes \u003c so the embedded JSON can never close the <script> tag.
const manifestJson = JSON.stringify(manifest, null, 2).replace(/</g, '\\u003c');
const manifestBytes = Buffer.byteLength(manifestJson, 'utf8');
if (manifestBytes > MANIFEST_BYTES_MAX) {
  fail(`embedded manifest is ${manifestBytes} bytes (limit ${MANIFEST_BYTES_MAX})`);
}

// ---------------------------------------------------------------------------
// 2. Bundle SDK + game, then assemble the single HTML file
// ---------------------------------------------------------------------------
const sdkCode = bundleExpression({ entry: path.relative(root, sdkEntry), root });
const gameCode = bundleExpression({ entry: path.relative(root, gameSourcePath), root });
const combined = `var DSH_GAME_SDK = ${sdkCode};\n\n${gameCode};`;
const safeScript = combined.replace(/<\/script/gi, '<\\/script');

const template = fs.readFileSync(templatePath, 'utf8');
for (const placeholder of ['__INLINE_SCRIPT__', '__MANIFEST_JSON__', '__GAME_TITLE__', '__GAME_VERSION__']) {
  if (!template.includes(placeholder)) fail(`template is missing ${placeholder}`);
}
const html = template
  .replace('__GAME_TITLE__', () => escapeHtml(manifest.name))
  .replace('__GAME_VERSION__', () => escapeHtml(manifest.version))
  .replace('__MANIFEST_JSON__', () => manifestJson)
  .replace('__INLINE_SCRIPT__', () => safeScript);

// ---------------------------------------------------------------------------
// 3. Validate the finished package with the shared V1 scanners
// ---------------------------------------------------------------------------
const occurrences = html.split(MANIFEST_SCRIPT_ID).length - 1;
if (occurrences !== 1) fail(`package must embed the manifest exactly once (found ${occurrences})`);

const extracted = extractManifest(html);
if (!extracted.ok) {
  for (const error of extracted.errors) console.error(`[build:snake] ${error.code}: ${error.message}`);
  fail('embedded manifest could not be extracted');
}
const embedded = JSON.parse(extracted.jsonText);
if (JSON.stringify(embedded) !== JSON.stringify(manifest)) {
  fail('embedded manifest does not match the build-time manifest source');
}

const packageCheck = validatePackageHtml(html);
if (!packageCheck.ok) {
  for (const error of packageCheck.errors) {
    console.error(`[build:snake] package ${error.code}: ${error.message}`);
  }
  fail('dist/index.html failed V1 single-file package validation');
}
for (const warning of packageCheck.warnings) {
  console.warn(`[build:snake] package warning ${warning.code}: ${warning.message}`);
}

const bytes = Buffer.byteLength(html, 'utf8');
if (bytes > LIMITS.entryBytes) fail(`entry too large: ${bytes} > ${LIMITS.entryBytes}`);
if (html.startsWith('\uFEFF')) fail('entry must be UTF-8 without BOM');

// ---------------------------------------------------------------------------
// 4. Write (deterministic bytes)
// ---------------------------------------------------------------------------
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, html, 'utf8');
console.log(
  `[build:snake] wrote ${path.relative(root, outFile)} (${bytes} bytes, manifest ${manifestBytes} bytes, ` +
    `sdk ${SDK_VERSION}, runtime ${RUNTIME_VERSION})`
);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
