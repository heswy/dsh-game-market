#!/usr/bin/env node
/**
 * Build the single-file, self-contained snake entry:
 *   games/snake/dist/index.html
 *
 * Contract (packages/shared/src/contracts.js):
 *   - SDK entry: packages/sdk/src/sdk.js exports { createGameSDK }
 *   - Game source: games/snake/src/game.js uses global `DSH_GAME_SDK`
 *   - Template: games/snake/src/index.html.tpl with __INLINE_SCRIPT__,
 *     __GAME_TITLE__, __GAME_VERSION__ placeholders.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleExpression } from './bundle-lib.mjs';
import { LIMITS } from '../packages/shared/src/constants.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const gameDir = path.join(root, 'games/snake');
const manifestPath = path.join(gameDir, 'game.json');
const templatePath = path.join(gameDir, 'src/index.html.tpl');
const gameSourcePath = path.join(gameDir, 'src/game.js');
const sdkEntry = path.join(root, 'packages/sdk/src/sdk.js');
const outDir = path.join(gameDir, 'dist');
const outFile = path.join(outDir, 'index.html');

for (const required of [manifestPath, templatePath, gameSourcePath, sdkEntry]) {
  if (!fs.existsSync(required)) {
    console.error(`[build:snake] missing ${path.relative(root, required)}`);
    process.exit(1);
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!manifest.id || manifest.id !== 'snake') {
  console.error('[build:snake] game.json id must be "snake"');
  process.exit(1);
}
if (manifest.entry !== 'dist/index.html') {
  console.error('[build:snake] game.json entry must be "dist/index.html"');
  process.exit(1);
}

const sdkCode = bundleExpression({ entry: path.relative(root, sdkEntry), root });
const gameCode = fs.readFileSync(gameSourcePath, 'utf8');
const combined = `var DSH_GAME_SDK = ${sdkCode};\n\n${gameCode}`;
const safeScript = combined.replace(/<\/script/gi, '<\\/script');

const template = fs.readFileSync(templatePath, 'utf8');
if (!template.includes('__INLINE_SCRIPT__')) {
  console.error('[build:snake] template is missing __INLINE_SCRIPT__');
  process.exit(1);
}
const html = template
  .replaceAll('__GAME_TITLE__', escapeHtml(manifest.name || 'Snake'))
  .replaceAll('__GAME_VERSION__', escapeHtml(manifest.version || '0.0.0'))
  .replace('__INLINE_SCRIPT__', safeScript);

// Self-contained check (PRD D-023): no external runtime resources.
const violations = [
  [/<script\b[^>]*\bsrc=/i, 'external <script src>'],
  [/<link\b[^>]*\bhref=/i, 'external <link href>'],
  [/<img\b[^>]*\bsrc=["'](?:https?:)?\/\//i, 'remote <img src>'],
  [/@import\s/i, 'CSS @import'],
  [/url\(\s*["']?(?:https?:)?\/\//i, 'remote CSS url()'],
  [/<iframe\b/i, 'nested iframe'],
];
for (const [re, label] of violations) {
  if (re.test(html)) {
    console.error(`[build:snake] entry is not self-contained: ${label}`);
    process.exit(1);
  }
}

const bytes = Buffer.byteLength(html, 'utf8');
if (bytes > LIMITS.entryBytes) {
  console.error(`[build:snake] entry too large: ${bytes} > ${LIMITS.entryBytes}`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, html, 'utf8');
console.log(`[build:snake] wrote ${path.relative(root, outFile)} (${bytes} bytes)`);

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
