#!/usr/bin/env node
/**
 * Build the bundled default Registry (V1 consumer path, CR-01; V1.5 two
 * generations, V1.5-CONTRACTS §5.1/§5.2/§5.3).
 *
 * Ships the three installable first-party games as single-file packages plus
 * both static indexes:
 *   - `registry/games.json`     Registry v1, `registryVersion: 1`, HTML only —
 *                               the only index an old client reads;
 *   - `registry/v2/games.json`  Registry v2, `registryVersion: 2`, every
 *                               `package.format` explicit (`html-v1`), so a
 *                               V1.5 Host has a complete seed to validate.
 *
 * The bundled seed deliberately contains **HTML only** (V1.5-CONTRACTS §5.3,
 * V1-28/community contract §3): ZIP packages are never shipped in the bundle,
 * keeping the old-client and offline fallback path simple.
 *
 * Deterministic: fixed timestamps and sorted inputs; `.bak`/temp files are not
 * produced. Same input => byte-identical output (verified in tests). Run after
 * the game builds (see scripts/build.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { REGISTRY_V2_FILE, REGISTRY_V2_VERSION } from '../packages/shared/src/constants.js';
import { validatePackageHtml } from '../packages/shared/src/manifest.js';
import { validateRegistry } from '../packages/shared/src/registry.js';
import { validateRegistryV2 } from '../packages/shared/src/catalog-v2.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const registryDir = path.join(root, 'registry');
const packagesDir = path.join(registryDir, 'packages');
const GAME_IDS = ['jump', '2048', 'breakout'];
// File Registries never fetch remote previews; the cover only has to be a
// valid absolute https URL for schema validation.
const COVER = 'https://raw.githubusercontent.com/heswy/dsh-game-market/main/docs/verification/v0/market.png';
const RELEASED_AT = '2026-10-18T00:00:00.000Z';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fail(message) {
  console.error(`[build:registry] ${message}`);
  process.exit(1);
}

function writeIndex(file, document) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
}

fs.rmSync(packagesDir, { recursive: true, force: true });
fs.mkdirSync(packagesDir, { recursive: true });

const games = [];
for (const id of GAME_IDS) {
  const source = path.join(root, 'games', id, 'dist', 'index.html');
  if (!fs.existsSync(source)) {
    fail(`missing game build: games/${id}/dist/index.html`);
  }
  const bytes = fs.readFileSync(source);
  const text = bytes.toString('utf8');
  const validation = validatePackageHtml(text, { packageBytes: 20 * 1024 * 1024 });
  if (!validation.ok || !validation.manifest) {
    fail(`games/${id}/dist/index.html failed validation`);
  }
  const manifest = validation.manifest;
  const fileName = `${manifest.id}-${manifest.version}.html`;
  fs.writeFileSync(path.join(packagesDir, fileName), bytes);
  games.push({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: { name: manifest.author && manifest.author.name ? manifest.author.name : 'DSH Game Market' },
    categories: manifest.categories,
    tags: manifest.tags || [],
    capabilities: manifest.capabilities,
    sdkVersion: manifest.sdkVersion,
    runtimeVersion: manifest.runtimeVersion,
    ...(manifest.preferredTheme ? { preferredTheme: manifest.preferredTheme } : {}),
    package: {
      url: `packages/${fileName}`,
      sha256: sha256(bytes),
      size: bytes.length,
      releasedAt: RELEASED_AT,
    },
    cover: COVER,
    license: manifest.license || 'MIT',
    featured: false,
    quickPlay: id === 'jump',
    publishedAt: RELEASED_AT,
    updatedAt: RELEASED_AT,
  });
}

games.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// Registry v1: unchanged V1 schema and bytes (no `format` field).
const v1Index = {
  registryVersion: 1,
  generatedAt: RELEASED_AT,
  games,
};
const v1Path = path.join(registryDir, 'games.json');
const v1Check = validateRegistry(v1Index, {
  sourceType: 'file',
  sourceUrl: path.join(registryDir, 'games.json'),
  allowedHosts: ['github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'],
});
if (!v1Check.ok) {
  fail(`generated v1 index is invalid: ${v1Check.errors.map((error) => `${error.field || '$'}: ${error.message}`).join('; ')}`);
}

// Registry v2: same HTML-only seed, but `package.format` is explicit (§5.2).
const v2Path = path.join(registryDir, REGISTRY_V2_FILE);
const v2Index = {
  registryVersion: REGISTRY_V2_VERSION,
  generatedAt: RELEASED_AT,
  games: games.map((game) => ({
    ...game,
    package: { ...game.package, format: 'html-v1' },
  })),
};
const v2Check = validateRegistryV2(v2Index, {
  sourceType: 'file',
  sourceUrl: v2Path,
});
if (!v2Check.ok) {
  fail(`generated v2 index is invalid: ${v2Check.errors.map((error) => `${error.field || '$'}: ${error.message}`).join('; ')}`);
}

writeIndex(v1Path, v1Index);
writeIndex(v2Path, v2Index);
console.log(`[build:registry] wrote registry/games.json (v1) + ${REGISTRY_V2_FILE} (v2) + ${games.length} HTML packages`);
