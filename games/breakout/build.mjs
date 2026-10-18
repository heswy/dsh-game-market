#!/usr/bin/env node
/**
 * Zero-dependency build for the Breakout single-file package.
 *
 * Output: games/breakout/dist/index.html
 *   - one inline manifest (`<script type="application/json" id="dsh-game-manifest">`)
 *   - inlined SDK (packages/sdk), game modules (src/*.js) and CSS (src/index.html.tpl)
 *   - no external subresources; validated with the shared V1 package validator
 *   - deterministic: identical inputs produce byte-identical output
 *
 * Usage:
 *   node games/breakout/build.mjs          build dist/index.html
 *   node games/breakout/build.mjs --check  fail if dist/index.html is stale
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bundleExpression } from '../../scripts/bundle-lib.mjs';
import { validatePackageHtml } from '../../packages/shared/src/manifest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const gameDir = path.join(root, 'games/breakout');
const manifestPath = path.join(gameDir, 'game.json');
const templatePath = path.join(gameDir, 'src/index.html.tpl');
const gameEntry = 'games/breakout/src/game.js';
const sdkEntry = 'packages/sdk/src/sdk.js';
const outDir = path.join(gameDir, 'dist');
const outFile = path.join(outDir, 'index.html');
const checkOnly = process.argv.includes('--check');

for (const required of [manifestPath, templatePath, path.join(root, gameEntry), path.join(root, sdkEntry)]) {
  if (!fs.existsSync(required)) {
    console.error(`[build:breakout] missing ${path.relative(root, required)}`);
    process.exit(1);
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.id !== 'breakout') {
  console.error('[build:breakout] game.json id must be "breakout"');
  process.exit(1);
}
if (manifest.version !== '1.0.0') {
  console.error('[build:breakout] game.json version must be "1.0.0"');
  process.exit(1);
}

const sdkCode = bundleExpression({ entry: sdkEntry, root });
const gameCode = bundleExpression({ entry: gameEntry, root });
const combined = `var DSH_GAME_SDK = ${sdkCode};\n\n${gameCode};\n`;
const safeScript = combined.replace(/<\/script/gi, '<\\/script');

const template = fs.readFileSync(templatePath, 'utf8');
for (const placeholder of ['__GAME_MANIFEST__', '__INLINE_SCRIPT__', '__GAME_TITLE__', '__GAME_DESCRIPTION__']) {
  if (!template.includes(placeholder)) {
    console.error(`[build:breakout] template is missing ${placeholder}`);
    process.exit(1);
  }
}

const manifestJson = JSON.stringify(manifest, null, 2);
if (/<\/script/i.test(manifestJson)) {
  console.error('[build:breakout] manifest contains a script terminator');
  process.exit(1);
}

const html = template
  .replaceAll('__GAME_TITLE__', escapeHtml(manifest.name || 'Breakout'))
  .replaceAll('__GAME_DESCRIPTION__', escapeHtml(manifest.description || ''))
  .replace('__GAME_MANIFEST__', manifestJson)
  .replace('__INLINE_SCRIPT__', safeScript);

const validation = validatePackageHtml(html);
if (!validation.ok) {
  console.error('[build:breakout] package validation failed:');
  for (const error of validation.errors) {
    console.error(`  - ${error.code}: ${error.message}`);
  }
  process.exit(1);
}
for (const warning of validation.warnings) {
  console.warn(`[build:breakout] warning ${warning.code}: ${warning.message}`);
}
if (!validation.manifest || validation.manifest.id !== manifest.id || validation.manifest.version !== manifest.version) {
  console.error('[build:breakout] embedded manifest does not match game.json');
  process.exit(1);
}
if (/^\uFEFF/.test(html)) {
  console.error('[build:breakout] output must not start with a BOM');
  process.exit(1);
}
if (html.includes('\r')) {
  console.error('[build:breakout] output must use LF line endings');
  process.exit(1);
}

const bytes = Buffer.byteLength(html, 'utf8');
const sha256 = crypto.createHash('sha256').update(Buffer.from(html, 'utf8')).digest('hex');

if (checkOnly) {
  if (!fs.existsSync(outFile)) {
    console.error('[build:breakout] dist/index.html is missing; run the build');
    process.exit(1);
  }
  const current = fs.readFileSync(outFile);
  const currentSha = crypto.createHash('sha256').update(current).digest('hex');
  if (currentSha !== sha256) {
    console.error(`[build:breakout] dist/index.html is stale\n  expected ${sha256}\n  actual   ${currentSha}`);
    process.exit(1);
  }
  console.log(`[build:breakout] dist/index.html is up to date (${bytes} bytes, sha256 ${sha256})`);
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, html, 'utf8');
console.log(`[build:breakout] wrote ${path.relative(root, outFile)} (${bytes} bytes)`);
console.log(`[build:breakout] sha256 ${sha256}`);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
