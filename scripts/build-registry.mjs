#!/usr/bin/env node
/**
 * Build the bundled default Registry (V1 consumer path, CR-01).
 *
 * Ships the three installable first-party games as single-file packages plus a
 * static `registry/games.json`, so a fresh plugin storage can discover and
 * install them without any extra configuration or network (file Registry).
 *
 * Deterministic: fixed timestamps and sorted inputs; `.bak`/temp files are not
 * produced. Run after the game builds (see scripts/build.mjs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { validatePackageHtml } from '../packages/shared/src/manifest.js';

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

fs.rmSync(packagesDir, { recursive: true, force: true });
fs.mkdirSync(packagesDir, { recursive: true });

const games = [];
for (const id of GAME_IDS) {
  const source = path.join(root, 'games', id, 'dist', 'index.html');
  if (!fs.existsSync(source)) {
    console.error(`[build:registry] missing game build: games/${id}/dist/index.html`);
    process.exit(1);
  }
  const bytes = fs.readFileSync(source);
  const text = bytes.toString('utf8');
  const validation = validatePackageHtml(text, { packageBytes: 20 * 1024 * 1024 });
  if (!validation.ok || !validation.manifest) {
    console.error(`[build:registry] games/${id}/dist/index.html failed validation`);
    process.exit(1);
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
const index = {
  registryVersion: 1,
  generatedAt: RELEASED_AT,
  games,
};
fs.writeFileSync(path.join(registryDir, 'games.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`[build:registry] wrote registry/games.json + ${games.length} packages`);
