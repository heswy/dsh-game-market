#!/usr/bin/env node
/**
 * Build the single-file, self-contained Jump package:
 *   games/jump/dist/index.html
 *
 * The output embeds, in this order:
 *   - the manifest v1 JSON (`<script id="dsh-game-manifest">`, exactly one)
 *   - all CSS (from src/index.html.tpl)
 *   - the SDK bundle (packages/sdk/src/sdk.js, bundled with scripts/bundle-lib.mjs)
 *   - the game bundle (src/game.js + src/logic.js)
 *   - the icon as a data URI inside the manifest (src/icon.png)
 *
 * The build is deterministic: the same sources always produce byte-identical
 * output (no timestamps, machine paths or random ids). It prints the size and
 * sha256 so `build twice → same hash` can be checked from the shell.
 *
 * Zero third-party dependencies. Run with: node games/jump/build.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bundleExpression } from '../../scripts/bundle-lib.mjs';
import { validatePackageHtml } from '../../packages/shared/src/manifest.js';
import { LIMITS } from '../../packages/shared/src/constants.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const gameDir = path.join(root, 'games/jump');
const manifestPath = path.join(gameDir, 'game.json');
const templatePath = path.join(gameDir, 'src/index.html.tpl');
const gameSourcePath = path.join(gameDir, 'src/game.js');
const iconPath = path.join(gameDir, 'src/icon.png');
const sdkEntry = path.join(root, 'packages/sdk/src/sdk.js');
const outDir = path.join(gameDir, 'dist');
const outFile = path.join(outDir, 'index.html');

const MANIFEST_KEY_ORDER = [
  'manifestVersion',
  'id',
  'name',
  'version',
  'author',
  'description',
  'icon',
  'categories',
  'capabilities',
  'sdkVersion',
  'runtimeVersion',
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
];

function fail(message) {
  console.error(`[build:jump] ${message}`);
  process.exit(1);
}

function readText(file, label) {
  if (!fs.existsSync(file)) fail(`missing ${label}: ${path.relative(root, file)}`);
  return fs.readFileSync(file, 'utf8');
}

function canonicalize(source) {
  const manifest = {};
  for (const key of MANIFEST_KEY_ORDER) {
    if (source[key] !== undefined) manifest[key] = source[key];
  }
  // Unknown/x-* fields are allowed by the manifest contract; keep them so a
  // future extension is not silently dropped, in deterministic key order.
  for (const key of Object.keys(source).sort()) {
    if (manifest[key] === undefined && key !== 'icon') manifest[key] = source[key];
  }
  if (manifest.author && typeof manifest.author === 'object') {
    manifest.author = pick(manifest.author, ['name', 'url']);
  }
  if (manifest.viewport) manifest.viewport = pick(manifest.viewport, ['width', 'height', 'fit']);
  if (manifest.score) manifest.score = pick(manifest.score, ['direction', 'min', 'max', 'integer']);
  if (manifest.save) manifest.save = pick(manifest.save, ['schemaVersion']);
  if (manifest.i18n && typeof manifest.i18n === 'object') {
    const i18n = { default: manifest.i18n.default, locales: {} };
    const locales = manifest.i18n.locales && typeof manifest.i18n.locales === 'object' ? manifest.i18n.locales : {};
    for (const locale of Object.keys(locales).sort()) {
      i18n.locales[locale] = pick(locales[locale] || {}, ['name', 'description']);
    }
    manifest.i18n = i18n;
  }
  return manifest;
}

function pick(source, keys) {
  const out = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function dataUri(file) {
  const bytes = fs.readFileSync(file);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ---------------------------------------------------------------- manifest

const rawManifest = JSON.parse(readText(manifestPath, 'manifest source'));
for (const removed of ['entry', 'cover', 'screenshots', 'category']) {
  if (rawManifest[removed] !== undefined) fail(`game.json must not contain the V0/Registry field "${removed}"`);
}
if (rawManifest.id !== 'jump') fail('game.json id must be "jump"');
if (typeof rawManifest.version !== 'string') fail('game.json version is missing');
if (fs.existsSync(iconPath)) rawManifest.icon = dataUri(iconPath);
const manifest = canonicalize(rawManifest);
const manifestJson = JSON.stringify(manifest, null, 2).replaceAll('<', '\\u003c');

const sdkCode = bundleExpression({ entry: path.relative(root, sdkEntry), root });
const gameCode = bundleExpression({ entry: path.relative(root, gameSourcePath), root });
const combined = `var DSH_GAME_SDK = ${sdkCode};\n\n${gameCode};\n`;
const safeScript = combined.replace(/<\/script/gi, '<\\/script');

// ---------------------------------------------------------------- template

const template = readText(templatePath, 'template');
for (const placeholder of ['__GAME_TITLE__', '__GAME_VERSION__', '__MANIFEST_JSON__', '__INLINE_SCRIPT__']) {
  if (!template.includes(placeholder)) fail(`template is missing ${placeholder}`);
}

const html = template
  .replaceAll('__GAME_TITLE__', escapeHtml(manifest.name || 'Jump'))
  .replaceAll('__GAME_VERSION__', escapeHtml(manifest.version || '0.0.0'))
  .replace('__MANIFEST_JSON__', manifestJson)
  .replace('__INLINE_SCRIPT__', safeScript);

if (/__[A-Z][A-Z0-9_]*__/.test(html)) {
  const leftover = html.match(/__[A-Z][A-Z0-9_]*__/);
  fail(`template placeholder was not replaced: ${leftover ? leftover[0] : 'unknown'}`);
}

// ---------------------------------------------------------------- validate

const validation = validatePackageHtml(html);
if (!validation.ok) {
  for (const error of validation.errors.slice(0, 20)) {
    console.error(`[build:jump] ${error.code}: ${error.message}`);
  }
  fail('package validation failed');
}
for (const warning of validation.warnings) {
  console.warn(`[build:jump] warning ${warning.code}: ${warning.message}`);
}
if (!validation.manifest || validation.manifest.id !== 'jump') {
  fail('embedded manifest id mismatch');
}

const bytes = Buffer.byteLength(html, 'utf8');
if (bytes > LIMITS.packageBytes) fail(`package too large: ${bytes} > ${LIMITS.packageBytes}`);

// ---------------------------------------------------------------- write

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, html, 'utf8');

const sha256 = crypto.createHash('sha256').update(html, 'utf8').digest('hex');
console.log(
  `[build:jump] wrote ${path.relative(root, outFile)} (${bytes} bytes, manifest ${Buffer.byteLength(manifestJson, 'utf8')} bytes, sha256 ${sha256})`
);
