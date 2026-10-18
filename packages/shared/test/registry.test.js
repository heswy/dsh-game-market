/**
 * V1 static Registry contract tests (PRD §8.8, M0).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_ALLOWED_HOSTS,
  REGISTRY_GAMES_MAX,
  REGISTRY_TTL_MS,
  allowedHostSet,
  hostOf,
  isAllowedHost,
  packageFileName,
  validatePackageUrl,
  validateRegistry,
  validateRegistryCache,
} from '../src/registry.js';

const SHA = 'a'.repeat(64);

function game(overrides = {}) {
  return {
    id: 'block-drop',
    name: 'Block Drop',
    version: '1.2.0',
    description: '把下落的方块叠成完整横行。',
    author: { name: 'Orange', url: 'https://github.com/orange' },
    categories: ['puzzle', 'arcade'],
    capabilities: ['storage', 'score'],
    sdkVersion: '^1.0.0',
    runtimeVersion: '^1.0.0',
    package: {
      url: `https://github.com/example/dsh-game-block-drop/releases/download/v1.2.0/${packageFileName('block-drop', '1.2.0')}`,
      sha256: SHA,
      size: 921004,
      releasedAt: '2026-10-17T10:40:00Z',
    },
    icon: 'https://github.com/example/dsh-game-block-drop/raw/v1.2.0/assets/icon.png',
    cover: 'https://github.com/example/dsh-game-block-drop/raw/v1.2.0/assets/cover.webp',
    publishedAt: '2026-09-30T00:00:00Z',
    updatedAt: '2026-10-17T10:40:00Z',
    ...overrides,
  };
}

function registry(games = [game()]) {
  return { registryVersion: 1, generatedAt: '2026-10-18T00:00:00Z', games };
}

test('accepts a valid registry index with GitHub package URLs', () => {
  const result = validateRegistry(registry(), {
    sourceType: 'https',
    sourceUrl: 'https://raw.githubusercontent.com/example/dsh-game-market/main/registry/games.json',
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.registry.games.length, 1);
  assert.equal(result.registry.registryVersion, 1);
});

test('resolves relative package URLs against the registry and enforces same host', () => {
  const result = validateRegistry(
    registry([
      game({
        package: {
          url: './packages/block-drop-1.2.0.html',
          sha256: SHA,
          size: 100,
          releasedAt: '2026-10-17T10:40:00Z',
        },
      }),
    ]),
    {
      sourceType: 'https',
      sourceUrl: 'https://games.example.com/registry/games.json',
    },
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));

  const custom = validatePackageUrl('https://games.example.com/pkgs/block-drop-1.2.0.html', {
    id: 'block-drop',
    version: '1.2.0',
    sourceType: 'https',
    sourceUrl: 'https://games.example.com/registry/games.json',
  });
  assert.equal(custom.ok, true);
  assert.equal(custom.url, 'https://games.example.com/pkgs/block-drop-1.2.0.html');
});

test('rejects non-https, disallowed hosts, credential URLs and wrong file names', () => {
  const base = { id: 'block-drop', version: '1.2.0', sourceType: 'https', sourceUrl: 'https://raw.githubusercontent.com/example/dsh-game-market/main/registry/games.json' };
  assert.equal(validatePackageUrl('http://github.com/example/x/block-drop-1.2.0.html', base).ok, false);
  assert.equal(validatePackageUrl('https://evil.example.com/block-drop-1.2.0.html', base).ok, false);
  assert.equal(validatePackageUrl('https://user:pass@github.com/example/x/block-drop-1.2.0.html', base).ok, false);
  assert.equal(validatePackageUrl('https://github.com/example/x/block-drop-1.2.1.html', base).ok, false);

  const badHost = validateRegistry(
    registry([game({ package: { ...game().package, url: 'https://evil.example.com/block-drop-1.2.0.html' } })]),
    { sourceType: 'https', sourceUrl: 'https://raw.githubusercontent.com/example/dsh-game-market/main/registry/games.json' },
  );
  assert.equal(badHost.ok, false);
  assert.ok(badHost.errors.some((error) => error.code === 'E_REGISTRY_INVALID'));
});

test('file registries accept only safe relative paths inside the registry dir', () => {
  const options = { sourceType: 'file', sourceUrl: '/tmp/registry/games.json' };
  assert.equal(validatePackageUrl('packages/block-drop-1.2.0.html', { ...options, id: 'block-drop', version: '1.2.0' }).ok, true);
  assert.equal(validatePackageUrl('../evil/block-drop-1.2.0.html', { ...options, id: 'block-drop', version: '1.2.0' }).ok, false);
  assert.equal(validatePackageUrl('/abs/block-drop-1.2.0.html', { ...options, id: 'block-drop', version: '1.2.0' }).ok, false);
  assert.equal(validatePackageUrl('packages/block-drop-1.2.1.html', { ...options, id: 'block-drop', version: '1.2.0' }).ok, false);
});

test('rejects invalid registry documents', () => {
  assert.equal(validateRegistry(null).ok, false);
  assert.equal(validateRegistry({ registryVersion: 2, generatedAt: '2026-10-18T00:00:00Z', games: [] }).ok, false);
  assert.equal(validateRegistry({ registryVersion: 1, games: [] }).ok, false);

  const duplicate = validateRegistry(registry([game(), game({ name: 'Copy' })]), { sourceType: 'https' });
  assert.equal(duplicate.ok, false);
  assert.ok(duplicate.errors.some((error) => error.message.includes('duplicate game id')));

  const badPackage = validateRegistry(
    registry([game({ package: { ...game().package, sha256: 'xyz' } })]),
    { sourceType: 'https' },
  );
  assert.equal(badPackage.ok, false);

  const tooMany = registry(Array.from({ length: REGISTRY_GAMES_MAX + 1 }, (_, index) => game({ id: `game-${index}` })));
  assert.equal(validateRegistry(tooMany, { sourceType: 'https' }).ok, false);
});

test('requires a cover and https-only preview assets', () => {
  const missingCover = game();
  delete missingCover.cover;
  const noCover = validateRegistry(registry([missingCover]), { sourceType: 'https' });
  assert.equal(noCover.ok, false);
  assert.ok(noCover.errors.some((error) => error.code === 'E_REGISTRY_FIELD_MISSING'));

  const dataUriCover = validateRegistry(
    registry([game({ cover: 'data:image/png;base64,AAAA' })]),
    { sourceType: 'https' },
  );
  assert.equal(dataUriCover.ok, false);

  const httpIcon = validateRegistry(
    registry([game({ icon: 'http://github.com/example/icon.png' })]),
    { sourceType: 'https' },
  );
  assert.equal(httpIcon.ok, false);
});

test('registry cache validation', () => {
  const cache = {
    schemaVersion: 1,
    fetchedAt: '2026-10-18T08:12:31.402Z',
    sourceUrl: 'https://raw.githubusercontent.com/example/dsh-game-market/main/registry/games.json',
    etag: 'W/"1a2b3c"',
    lastModified: null,
    truncated: false,
    games: [game()],
  };
  assert.equal(validateRegistryCache(cache).ok, true);
  assert.equal(validateRegistryCache({ ...cache, schemaVersion: 9 }).ok, false);
  assert.equal(validateRegistryCache({ ...cache, fetchedAt: 'yesterday' }).ok, false);
});

test('allowlist defaults and helpers', () => {
  assert.ok(DEFAULT_ALLOWED_HOSTS.includes('github.com'));
  assert.equal(isAllowedHost('github.com', {}), true);
  assert.equal(isAllowedHost('GITHUB.COM', {}), true);
  assert.equal(isAllowedHost('evil.example.com', {}), false);
  const hosts = allowedHostSet({ sourceUrl: 'https://games.example.com/registry/games.json' });
  assert.ok(hosts.has('games.example.com'));
  assert.equal(hostOf('https://github.com/a/b'), 'github.com');
  assert.equal(hostOf('not a url'), null);
  assert.equal(REGISTRY_TTL_MS, 6 * 60 * 60 * 1000);
});
