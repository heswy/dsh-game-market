import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DEFAULT_OFFICIAL_REGISTRY_URL,
  DEFAULT_OFFICIAL_REGISTRY_V2_URL,
} from '../../../shared/src/constants.js';
import { ROUTES } from '../../../shared/src/contracts.js';
import { GM } from '../../../shared/src/errors.js';
import { normaliseConfig } from '../../src/config.js';
import { createHostHarness } from '../support/harness.js';
import {
  PNG_BYTES,
  buildManifest,
  buildPackage,
  sha256Hex,
} from '../support/packages.js';

/**
 * M1-B: V1.5 Host reads both Registry generations (docs/V1.5-CONTRACTS §5).
 *
 * The V1.5 Host defaults to the v2 index and keeps the v1 index as a migration
 * fallback; each generation has its own cache file and a v1 cache is never
 * accepted as a v2 snapshot (§5.3).
 */

function v2EntryOf(manifest, pkg, packageBase, overrides = {}) {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    author: { name: 'Test Studio' },
    categories: [...manifest.categories],
    tags: ['test'],
    capabilities: [...manifest.capabilities],
    sdkVersion: manifest.sdkVersion,
    runtimeVersion: manifest.runtimeVersion,
    package: {
      format: 'html-v1',
      url: `${packageBase}/${manifest.id}-${manifest.version}.html`,
      sha256: pkg.sha256,
      size: pkg.size,
      releasedAt: '2026-10-19T12:00:00.000Z',
    },
    cover: 'https://cdn.example.com/cover.png',
    publishedAt: '2026-10-19T12:00:00.000Z',
    updatedAt: '2026-10-19T12:00:00.000Z',
    ...overrides,
  };
}

function buildV2Fixture({ id = 'jump', version = '1.0.0', packageBase = 'https://github.com/dsh-games/releases/download/v1.0.0' } = {}) {
  const manifest = buildManifest({ id, version });
  const pkg = buildPackage(manifest);
  const entry = v2EntryOf(manifest, pkg, packageBase);
  return {
    manifest,
    entry,
    document: { registryVersion: 2, generatedAt: '2026-10-19T12:00:00.000Z', games: [entry] },
  };
}

/** Fake fetch serving v2/v1 official indexes, packages and previews. */
function officialFetch({ v2, v1 }) {
  return async (url) => {
    const href = String(url);
    if (href === DEFAULT_OFFICIAL_REGISTRY_V2_URL) {
      if (v2 === null) return new Response('not found', { status: 404 });
      return new Response(typeof v2 === 'string' ? v2 : JSON.stringify(v2), { status: 200 });
    }
    if (href === DEFAULT_OFFICIAL_REGISTRY_URL) {
      if (v1 === null) return new Response('not found', { status: 404 });
      return new Response(typeof v1 === 'string' ? v1 : JSON.stringify(v1), { status: 200 });
    }
    if (href.startsWith('https://github.com/dsh-games/releases/')) {
      return new Response('unused package bytes', { status: 200 });
    }
    if (href.startsWith('https://cdn.example.com/')) {
      return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return new Response('not found', { status: 404 });
  };
}

async function settledRegistry(host, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = await host.host.registry.snapshot();
    if (predicate(snapshot) || Date.now() >= deadline) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function register() {
  test('explicit source: a v2 index is validated strictly and cached in registry-cache-v2.json only', async (t) => {
    const fixture = buildV2Fixture();
    const indexUrl = 'https://registry.example.com/v2/games.json';
    const host = await createHostHarness(t, {
      config: { registry: { url: indexUrl, allowedHosts: ['cdn.example.com'] } },
      http: {
        fetch: async (url) => {
          if (String(url) === indexUrl) {
            return new Response(JSON.stringify(fixture.document), { status: 200 });
          }
          if (String(url).startsWith('https://cdn.example.com/')) {
            return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } });
          }
          return new Response('not found', { status: 404 });
        },
      },
    });
    await host.host.registry.ready();
    const snapshot = await host.host.registry.snapshot();
    assert.equal(snapshot.state, 'fresh');
    assert.equal(snapshot.generation, 'v2');
    assert.equal(snapshot.registryVersion, 2);
    assert.equal(snapshot.count, 1);
    assert.equal(host.host.registry.findEntry('jump').package.format, 'html-v1');

    const cache = await host.readDataJson('registry-cache-v2.json');
    assert.equal(cache.schemaVersion, 2);
    assert.equal(cache.registryVersion, 2);
    assert.equal(cache.sourceUrl, indexUrl);
    assert.equal(cache.games[0].package.format, 'html-v1');
    assert.equal(await host.pathExists('registry-cache.json'), false, 'a v2 source must not write the v1 cache');

    const list = await host.data(ROUTES.GAMES, { query: { limit: 50 } });
    assert.equal(list.items.some((item) => item.id === 'jump'), true);
    assert.equal(list.registry.generation, 'v2');
  });

  test('v2 index: package.format is mandatory and one bad entry rejects the whole document (GM-5032)', async (t) => {
    const fixture = buildV2Fixture();
    const missingFormat = JSON.parse(JSON.stringify(fixture.entry));
    missingFormat.id = 'broken-game';
    missingFormat.package.url = 'https://github.com/dsh-games/releases/download/v1.0.0/broken-game-1.0.0.html';
    delete missingFormat.package.format;
    fixture.document.games.push(missingFormat);

    const indexUrl = 'https://registry.example.com/v2/games.json';
    const host = await createHostHarness(t, {
      config: { registry: { url: indexUrl } },
      http: {
        fetch: async (url) => {
          if (String(url) === indexUrl) return new Response(JSON.stringify(fixture.document), { status: 200 });
          return new Response('not found', { status: 404 });
        },
      },
    });
    await host.host.registry.ready();
    const snapshot = await host.host.registry.snapshot();
    assert.equal(snapshot.state, 'missing');
    assert.equal(snapshot.count, 0);
    assert.equal(snapshot.lastError, GM.REGISTRY_UNAVAILABLE);
    assert.equal(await host.pathExists('registry-cache-v2.json'), false, 'an invalid index must not be cached');

    const { response, payload } = await host.requestJson(ROUTES.REGISTRY_REFRESH, { body: { force: true } });
    assert.equal(response.status, 503);
    assert.equal(payload.error.code, GM.REGISTRY_UNAVAILABLE);
  });

  test('v2 index: a ZIP entry is accepted (format explicit) and listed by the Host', async (t) => {
    const manifest = buildManifest({ id: 'orbit-courier', version: '1.2.0' });
    const pkg = buildPackage(manifest);
    const entry = v2EntryOf(manifest, pkg, 'https://github.com/dsh-games/releases/download/v1.2.0', {
      package: {
        format: 'asset-zip-v2',
        url: 'https://github.com/dsh-games/releases/download/v1.2.0/orbit-courier-1.2.0.dshgame.zip',
        sha256: sha256Hex(Buffer.from('zip-placeholder')),
        size: 4096,
        filesDigest: sha256Hex(Buffer.from('[]')),
        releasedAt: '2026-10-19T12:00:00.000Z',
      },
    });
    const indexUrl = 'https://registry.example.com/v2/games.json';
    const host = await createHostHarness(t, {
      config: { registry: { url: indexUrl, allowedHosts: ['cdn.example.com'] } },
      http: {
        fetch: async (url) => {
          const href = String(url);
          if (href === indexUrl) {
            return new Response(JSON.stringify({ registryVersion: 2, generatedAt: '2026-10-19T12:00:00.000Z', games: [entry] }), { status: 200 });
          }
          if (href.startsWith('https://cdn.example.com/')) {
            return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } });
          }
          return new Response('not found', { status: 404 });
        },
      },
    });
    await host.host.registry.ready();
    const snapshot = await host.host.registry.snapshot();
    assert.equal(snapshot.count, 1);
    const cached = await host.readDataJson('registry-cache-v2.json');
    assert.equal(cached.games[0].package.format, 'asset-zip-v2');
    assert.equal(cached.games[0].package.filesDigest, entry.package.filesDigest);
    const list = await host.data(ROUTES.GAMES, { query: { limit: 50 } });
    assert.equal(list.items.some((item) => item.id === 'orbit-courier'), true);
  });

  test('v1 index: an asset-zip-v2 entry rejects the whole document and falls back (GM-5032)', async (t) => {
    const fixture = buildV2Fixture();
    const zipEntry = JSON.parse(JSON.stringify(fixture.entry));
    zipEntry.package.format = 'asset-zip-v2';
    zipEntry.package.url = 'https://github.com/dsh-games/releases/download/v1.0.0/jump-1.0.0.dshgame.zip';
    const v1Document = {
      registryVersion: 1,
      generatedAt: '2026-10-19T12:00:00.000Z',
      games: [zipEntry],
    };
    const indexUrl = 'https://registry.example.com/games.json';
    const host = await createHostHarness(t, {
      config: { registry: { url: indexUrl } },
      http: {
        fetch: async (url) => {
          if (String(url) === indexUrl) return new Response(JSON.stringify(v1Document), { status: 200 });
          return new Response('not found', { status: 404 });
        },
      },
    });
    await host.host.registry.ready();
    const snapshot = await host.host.registry.snapshot();
    assert.equal(snapshot.state, 'missing');
    assert.equal(snapshot.count, 0);
    assert.equal(snapshot.lastError, GM.REGISTRY_UNAVAILABLE);
    assert.equal(await host.pathExists('registry-cache.json'), false);
  });

  test('default source: v2 is used first and cached separately', async (t) => {
    const fixture = buildV2Fixture({ id: 'v2-only', version: '2.0.0' });
    const host = await createHostHarness(t, {
      useDefaultRegistry: true,
      config: { registry: { allowedHosts: ['cdn.example.com'] } },
      http: { fetch: officialFetch({ v2: fixture.document, v1: null }) },
    });
    await host.host.registry.ready();
    const snapshot = await settledRegistry(host, (value) => value.activeSource === 'official');
    assert.equal(snapshot.activeSource, 'official');
    assert.equal(snapshot.fallback, false);
    assert.equal(snapshot.generation, 'v2');
    assert.equal(snapshot.officialV2.state, 'fresh');
    assert.equal(snapshot.count, 1);
    assert.equal(await host.pathExists('registry-cache-v2.json'), true);
    assert.equal(await host.pathExists('registry-cache.json'), false);
    const list = await host.data(ROUTES.GAMES, { query: { limit: 50 } });
    const ids = list.items.map((item) => item.id);
    assert.ok(ids.includes('v2-only'));
  });

  test('default source: an unavailable v2 index falls back to the v1 official index', async (t) => {
    const manifest = buildManifest({ id: 'v1-fallback', version: '1.0.0' });
    const pkg = buildPackage(manifest);
    const v1Document = {
      registryVersion: 1,
      generatedAt: '2026-10-19T12:00:00.000Z',
      games: [v2EntryOf(manifest, pkg, 'https://github.com/dsh-games/releases/download/v1.0.0', {
        package: {
          url: 'https://github.com/dsh-games/releases/download/v1.0.0/v1-fallback-1.0.0.html',
          sha256: pkg.sha256,
          size: pkg.size,
          releasedAt: '2026-10-19T12:00:00.000Z',
        },
      })],
    };
    // v1 entries have no package.format; strip it from the shared fixture.
    delete v1Document.games[0].package.format;
    const host = await createHostHarness(t, {
      useDefaultRegistry: true,
      config: { registry: { allowedHosts: ['cdn.example.com'] } },
      http: { fetch: officialFetch({ v2: null, v1: v1Document }) },
    });
    await host.host.registry.ready();
    const snapshot = await settledRegistry(host, (value) => value.activeSource === 'official');
    assert.equal(snapshot.activeSource, 'official');
    assert.equal(snapshot.generation, 'v1');
    assert.equal(snapshot.officialV1.state, 'fresh');
    assert.equal(snapshot.officialV2.state, 'missing');
    assert.equal(snapshot.count, 1);
    assert.equal(host.host.registry.sourceUrl, DEFAULT_OFFICIAL_REGISTRY_URL);
    assert.equal(await host.pathExists('registry-cache.json'), true);
    assert.equal(await host.pathExists('registry-cache-v2.json'), false);
  });

  test('cache isolation: a fresh v1 cache is used as the v1 fallback, never as a v2 snapshot', async (t) => {
    const manifest = buildManifest({ id: 'cached-v1', version: '1.0.0' });
    const pkg = buildPackage(manifest);
    const v1Games = [v2EntryOf(manifest, pkg, 'https://github.com/dsh-games/releases/download/v1.0.0', {
      package: {
        url: 'https://github.com/dsh-games/releases/download/v1.0.0/cached-v1-1.0.0.html',
        sha256: pkg.sha256,
        size: pkg.size,
        releasedAt: '2026-10-19T12:00:00.000Z',
      },
    })];
    delete v1Games[0].package.format;
    const host = await createHostHarness(t, {
      useDefaultRegistry: true,
      config: { registry: { allowedHosts: ['cdn.example.com'] } },
      http: {
        fetch: async () => {
          throw new TypeError('simulated offline network');
        },
      },
      prepareDataRoot: async (dataRoot) => {
        await fs.mkdir(dataRoot, { recursive: true });
        await fs.writeFile(path.join(dataRoot, 'registry-cache.json'), JSON.stringify({
          schemaVersion: 1,
          fetchedAt: new Date().toISOString(),
          sourceUrl: DEFAULT_OFFICIAL_REGISTRY_URL,
          etag: null,
          lastModified: null,
          truncated: false,
          games: v1Games,
        }, null, 2));
      },
    });
    await host.host.registry.ready();
    const snapshot = await settledRegistry(host, (value) => value.activeSource === 'official');
    assert.equal(snapshot.activeSource, 'official');
    assert.equal(snapshot.generation, 'v1', 'the v1 cache may only serve the v1 generation');
    assert.equal(snapshot.officialV2.state, 'missing', 'a v1 cache must never masquerade as v2');
    assert.equal(snapshot.officialV2.count, 0);
    assert.equal(await host.pathExists('registry-cache-v2.json'), false);
    const list = await host.data(ROUTES.GAMES, { query: { limit: 50 } });
    assert.equal(list.items.some((item) => item.id === 'cached-v1'), true);
  });

  test('cache isolation: a malformed registry-cache-v2.json is treated as no cache and falls back to seed', async (t) => {
    const host = await createHostHarness(t, {
      useDefaultRegistry: true,
      config: { registry: { allowedHosts: ['cdn.example.com'] } },
      http: {
        fetch: async () => {
          throw new TypeError('simulated offline network');
        },
      },
      prepareDataRoot: async (dataRoot) => {
        await fs.mkdir(dataRoot, { recursive: true });
        // schemaVersion 1 in the v2 file name: the exact "v1 cache reused as v2"
        // failure mode the contract forbids (§5.3).
        await fs.writeFile(path.join(dataRoot, 'registry-cache-v2.json'), JSON.stringify({
          schemaVersion: 1,
          fetchedAt: new Date().toISOString(),
          sourceUrl: DEFAULT_OFFICIAL_REGISTRY_V2_URL,
          etag: null,
          lastModified: null,
          truncated: false,
          games: [],
        }, null, 2));
      },
    });
    await host.host.registry.ready();
    const snapshot = await host.host.registry.snapshot();
    assert.equal(snapshot.activeSource, 'seed');
    assert.equal(snapshot.fallback, true);
    assert.equal(snapshot.generation, null);
    assert.equal(snapshot.count, 3, 'the bundled HTML seed is the only usable source');
  });

  test('v2 cache: sourceUrl mismatch means "no cache" (no stale directory is reused)', async (t) => {
    const fixture = buildV2Fixture({ id: 'other-source', version: '3.0.0' });
    const host = await createHostHarness(t, {
      useDefaultRegistry: true,
      config: { registry: { allowedHosts: ['cdn.example.com'] } },
      http: {
        fetch: async () => {
          throw new TypeError('simulated offline network');
        },
      },
      prepareDataRoot: async (dataRoot) => {
        await fs.mkdir(dataRoot, { recursive: true });
        await fs.writeFile(path.join(dataRoot, 'registry-cache-v2.json'), JSON.stringify({
          schemaVersion: 2,
          registryVersion: 2,
          fetchedAt: new Date().toISOString(),
          sourceUrl: 'https://elsewhere.example/registry/v2/games.json',
          etag: null,
          lastModified: null,
          truncated: false,
          games: fixture.document.games,
        }, null, 2));
      },
    });
    await host.host.registry.ready();
    const snapshot = await host.host.registry.snapshot();
    assert.equal(snapshot.activeSource, 'seed');
    assert.equal(snapshot.count, 3);
    assert.equal(snapshot.officialV2.count, 0);
  });

  test('v2 package URL admission reuses the V1 host allowlist/same-host rules', async (t) => {
    const manifest = buildManifest({ id: 'mirror-v2', version: '1.0.0' });
    const pkg = buildPackage(manifest);
    const document = {
      registryVersion: 2,
      generatedAt: '2026-10-19T12:00:00.000Z',
      games: [v2EntryOf(manifest, pkg, 'https://cdn.example.com/v2-packages')],
    };
    const indexUrl = 'https://registry.example.com/v2/games.json';
    const fetchImpl = async (url) => {
      const href = String(url);
      if (href === indexUrl) return new Response(JSON.stringify(document), { status: 200 });
      if (href.startsWith('https://cdn.example.com/')) {
        return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } });
      }
      return new Response('not found', { status: 404 });
    };
    const rejected = await createHostHarness(t, {
      config: { registry: { url: indexUrl } },
      http: { fetch: fetchImpl },
    });
    await rejected.host.registry.ready();
    assert.equal((await rejected.host.registry.snapshot()).lastError, GM.REGISTRY_UNAVAILABLE);

    const accepted = await createHostHarness(t, {
      config: { registry: { url: indexUrl, allowedHosts: ['cdn.example.com'] } },
      http: { fetch: fetchImpl },
    });
    await accepted.host.registry.ready();
    const snapshot = await accepted.host.registry.snapshot();
    assert.equal(snapshot.state, 'fresh');
    assert.equal(snapshot.generation, 'v2');
    assert.equal(snapshot.count, 1);
  });

  test('default layered config points at the v2 policy source with the v1 index as fallback', () => {
    const config = normaliseConfig({});
    assert.equal(config.registry.mode, 'layered');
    assert.equal(config.registry.officialV2Url, DEFAULT_OFFICIAL_REGISTRY_V2_URL);
    assert.equal(config.registry.officialUrl, DEFAULT_OFFICIAL_REGISTRY_URL);
    assert.equal(config.registry.sourceUrl, DEFAULT_OFFICIAL_REGISTRY_V2_URL);
    assert.ok(config.registry.seedSource && config.registry.seedSource.kind === 'file');
  });

  test('explicit file Registry: a v2 index is detected and validated with the v2 rules', async (t) => {
    const manifest = buildManifest({ id: 'file-v2', version: '1.0.0' });
    const pkg = buildPackage(manifest);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-v15-file-v2-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    await fs.mkdir(path.join(directory, 'packages'), { recursive: true });
    const fileName = `${manifest.id}-${manifest.version}.html`;
    await fs.writeFile(path.join(directory, 'packages', fileName), pkg.bytes);
    const indexPath = path.join(directory, 'v2-games.json');
    const entry = v2EntryOf(manifest, pkg, 'https://unused.example', {
      package: {
        format: 'html-v1',
        url: `packages/${fileName}`,
        sha256: pkg.sha256,
        size: pkg.size,
        releasedAt: '2026-10-19T12:00:00.000Z',
      },
    });
    await fs.writeFile(indexPath, JSON.stringify({
      registryVersion: 2,
      generatedAt: '2026-10-19T12:00:00.000Z',
      games: [entry],
    }));
    const host = await createHostHarness(t, {
      config: { registry: { url: indexPath, allowLocalFile: true } },
    });
    await host.host.registry.ready();
    const snapshot = await host.host.registry.snapshot();
    assert.equal(snapshot.state, 'fresh');
    assert.equal(snapshot.generation, 'v2');
    assert.equal(snapshot.count, 1);
    const cache = await host.readDataJson('registry-cache-v2.json');
    assert.equal(cache.sourceUrl, indexPath);
    assert.equal(await host.pathExists('registry-cache.json'), false);
  });

  test('v2 index with one bad entry keeps the previous v2 cache (whole-index validation)', async (t) => {
    const fixture = buildV2Fixture();
    const indexUrl = 'https://registry.example.com/v2/games.json';
    let body = JSON.stringify(fixture.document);
    const host = await createHostHarness(t, {
      config: { registry: { url: indexUrl, allowedHosts: ['cdn.example.com'] } },
      http: {
        fetch: async (url) => {
          const href = String(url);
          if (href === indexUrl) return new Response(body, { status: 200 });
          if (href.startsWith('https://cdn.example.com/')) {
            return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } });
          }
          return new Response('not found', { status: 404 });
        },
      },
    });
    await host.host.registry.ready();
    assert.equal((await host.host.registry.snapshot()).count, 1);

    const broken = JSON.parse(body);
    broken.games[0].package.sha256 = 'not-a-sha';
    body = JSON.stringify(broken);
    const { response, payload } = await host.requestJson(ROUTES.REGISTRY_REFRESH, { body: { force: true } });
    assert.equal(response.status, 503);
    assert.equal(payload.error.code, GM.REGISTRY_UNAVAILABLE);
    const snapshot = await host.host.registry.snapshot();
    assert.equal(snapshot.state, 'offline');
    assert.equal(snapshot.count, 1);
    assert.equal(snapshot.lastError, GM.REGISTRY_UNAVAILABLE);
    const cache = await host.readDataJson('registry-cache-v2.json');
    assert.equal(cache.games.length, 1);
    assert.equal(cache.games[0].package.sha256, fixture.entry.package.sha256);
  });
}
