import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { ROUTES } from '../../../shared/src/contracts.js';
import { GM } from '../../../shared/src/errors.js';
import { createHarness, createHostHarness } from '../support/harness.js';
import {
  PNG_BYTES,
  createFileRegistry,
  createFakeFetch,
  createHttpsRegistry,
} from '../support/packages.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function fileRegistryConfig(fixture) {
  return { registry: { url: fixture.indexPath, allowLocalFile: true } };
}

test('bundled default registry lets a fresh storage discover and install first-party games', async (t) => {
  const host = await createHostHarness(t);
  await host.host.registry.ready();
  const list = await host.data(ROUTES.GAMES, { query: { limit: 50 } });
  const ids = new Set(list.items.map((item) => item.id));
  for (const id of ['snake', 'jump', '2048', 'breakout']) assert.equal(ids.has(id), true, id);
  assert.equal(list.items.find((item) => item.id === 'jump').installed, false);

  const installed = await host.data(ROUTES.INSTALL, {
    body: { gameId: 'jump', operationId: 'default-registry-install' },
  });
  assert.equal(installed.version, '1.0.0');
  assert.equal(installed.source, 'registry');
  const launchInfo = await host.data(ROUTES.LAUNCH, { body: { gameId: 'jump' } });
  const entry = await host.request(launchInfo.entryUrl);
  assert.equal(entry.status, 200);
  assert.equal(entry.headers.get('x-entry-sha256'), installed.sha256);
});

async function writeCacheFile(dataRoot, sourceUrl, games, fetchedAt) {
  await fs.mkdir(dataRoot, { recursive: true });
  await fs.writeFile(
    path.join(dataRoot, 'registry-cache.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        fetchedAt,
        sourceUrl,
        etag: null,
        lastModified: null,
        truncated: false,
        games,
      },
      null,
      2
    )
  );
}

function assertErrorEnvelope(payload, code) {
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, code);
}

export function register() {
  test('file Registry loads, validates, caches and merges with built-ins', async (t) => {
    const fixture = await createFileRegistry(t, [{ manifest: { id: 'jump', name: 'Jump' } }]);
    const host = await createHostHarness(t, { config: fileRegistryConfig(fixture) });
    await host.host.registry.ready();

    const health = await host.data(ROUTES.HEALTH);
    assert.equal(health.registry.state, 'fresh');
    assert.equal(health.registry.count, 1);
    assert.equal(health.registry.truncated, false);
    assert.equal(health.registry.lastError, null);
    assert.equal(health.registry.sourceUrl, fixture.indexPath);

    const cache = await host.readDataJson('registry-cache.json');
    assert.equal(cache.schemaVersion, 1);
    assert.equal(cache.sourceUrl, fixture.indexPath);
    assert.equal(cache.games.length, 1);
    assert.equal(cache.games[0].id, 'jump');

    const list = await host.data(ROUTES.GAMES);
    assert.equal(list.source, 'merged');
    assert.deepEqual(
      list.items.map((item) => item.id).sort(),
      ['jump', 'snake']
    );
    const jump = list.items.find((item) => item.id === 'jump');
    assert.equal(jump.installedVersion, null);
    assert.equal(jump.source, 'registry');
    assert.deepEqual(jump.author, { name: 'Test Studio' });
    assert.equal(list.registry.state, 'fresh');
    // File (dev/offline) registries never fetch remote preview art.
    assert.equal(await host.pathExists('preview-cache/jump'), false);
  });

  test('DSH_GAME_REGISTRY_URL wins over config.registry.url', async (t) => {
    const configRegistry = await createFileRegistry(t, [{ manifest: { id: 'jump', version: '1.0.0' } }]);
    const envRegistry = await createFileRegistry(t, [{ manifest: { id: 'env-game', version: '2.0.0' } }]);
    const host = await createHostHarness(t, {
      config: fileRegistryConfig(configRegistry),
      env: { DSH_GAME_REGISTRY_URL: envRegistry.indexPath },
    });
    await host.host.registry.ready();
    const list = await host.data(ROUTES.GAMES);
    const ids = list.items.map((item) => item.id);
    assert.ok(ids.includes('env-game'));
    assert.equal(ids.includes('jump'), false);
    assert.equal(host.host.registry.source.kind, 'file');
    assert.equal(host.host.registry.source.path, envRegistry.indexPath);
  });

  test('config file Registry requires allowLocalFile and reports a config issue', async (t) => {
    const fixture = await createFileRegistry(t, [{ manifest: { id: 'jump' } }]);
    const host = await createHostHarness(t, { config: { registry: { url: fixture.indexPath } } });
    const health = await host.data(ROUTES.HEALTH);
    assert.equal(health.registry.state, 'missing');
    assert.ok(health.configIssues.includes('registry.allowLocalFile:required'));
    const list = await host.data(ROUTES.GAMES);
    assert.deepEqual(list.items.map((item) => item.id), ['snake']);
    assert.equal(list.source, 'builtin');
  });

  test('file Registry without allowLocalFile but non-file url is rejected (https only)', async (t) => {
    const host = await createHostHarness(t, {
      config: { registry: { url: 'http://registry.example.com/games.json' } },
    });
    const health = await host.data(ROUTES.HEALTH);
    assert.equal(health.registry.state, 'missing');
    assert.ok(health.configIssues.includes('registry.url:invalid'));
  });

  test('ETag / If-None-Match: a 304 refreshes fetchedAt without rewriting games', async (t) => {
    const fixture = await createHttpsRegistry(t, [{ manifest: { id: 'jump' } }], { etag: '"v1"' });
    const host = await createHostHarness(t, {
      config: { registry: { url: fixture.indexUrl } },
      http: { fetch: fixture.fetch },
    });
    await host.host.registry.ready();
    assert.equal(fixture.state.indexRequests, 1);
    const first = await host.readDataJson('registry-cache.json');
    assert.equal(first.etag, '"v1"');

    const refreshed = await host.data(ROUTES.REGISTRY_REFRESH, { body: { force: true } });
    assert.equal(refreshed.count, 1);
    assert.equal(refreshed.etag, '"v1"');
    assert.equal(fixture.state.indexRequests, 2);
    const second = await host.readDataJson('registry-cache.json');
    assert.equal(second.games.length, 1);
    assert.ok(Date.parse(second.fetchedAt) >= Date.parse(first.fetchedAt));
  });

  test('stale (7h) and expired (15d) caches fall back without remote games', async (t) => {
    const fixture = await createFileRegistry(t, [{ manifest: { id: 'jump' } }]);
    const games = fixture.document.games;
    const missingPath = path.join(fixture.directory, 'gone.json');

    const staleHost = await createHostHarness(t, {
      config: { registry: { url: missingPath, allowLocalFile: true } },
      prepareDataRoot: (dataRoot) =>
        writeCacheFile(dataRoot, missingPath, games, new Date(Date.now() - 7 * HOUR).toISOString()),
    });
    await staleHost.host.registry.ready();
    const staleState = await staleHost.host.registry.snapshot();
    // The startup refresh failed, so the usable stale cache is reported as offline.
    assert.equal(staleState.state, 'offline');
    assert.equal(staleState.count, 1);
    assert.equal(staleState.lastError, GM.REGISTRY_UNAVAILABLE);
    const staleList = await staleHost.data(ROUTES.GAMES);
    assert.ok(staleList.items.some((item) => item.id === 'jump'));

    const expiredHost = await createHostHarness(t, {
      config: { registry: { url: missingPath, allowLocalFile: true } },
      prepareDataRoot: (dataRoot) =>
        writeCacheFile(dataRoot, missingPath, games, new Date(Date.now() - 15 * DAY).toISOString()),
    });
    await expiredHost.host.registry.ready();
    const expiredState = await expiredHost.host.registry.snapshot();
    assert.equal(expiredState.state, 'expired');
    assert.equal(expiredState.count, 0);
    const expiredList = await expiredHost.data(ROUTES.GAMES);
    assert.deepEqual(expiredList.items.map((item) => item.id), ['snake']);
  });

  test('whole-index validation rejects one bad entry and keeps the previous cache', async (t) => {
    const fixture = await createHttpsRegistry(t, [{ manifest: { id: 'jump' } }]);
    const host = await createHostHarness(t, {
      config: { registry: { url: fixture.indexUrl } },
      http: { fetch: fixture.fetch },
    });
    await host.host.registry.ready();
    assert.equal((await host.data(ROUTES.HEALTH)).registry.state, 'fresh');

    fixture.document.games[0].version = 'not-semver';
    fixture.state.etag = '"reg-2"';
    const { response, payload } = await host.requestJson(ROUTES.REGISTRY_REFRESH, {
      body: { force: true },
    });
    assert.equal(response.status, 503);
    assertErrorEnvelope(payload, GM.REGISTRY_UNAVAILABLE);
    const health = await host.data(ROUTES.HEALTH);
    assert.equal(health.registry.state, 'offline');
    assert.equal(health.registry.lastError, GM.REGISTRY_UNAVAILABLE);
    assert.equal(health.registry.count, 1);
    const list = await host.data(ROUTES.GAMES);
    assert.ok(list.items.some((item) => item.id === 'jump'));
  });

  test('index size and entry-count limits reject the whole document', async (t) => {
    const oversized = await createHttpsRegistry(t, [{ manifest: { id: 'jump' } }]);
    oversized.state.indexBody = `{"registryVersion":1,"generatedAt":"2026-10-18T00:00:00.000Z","games":[]}${' '.repeat(2 * 1024 * 1024)}`;
    const sizeHost = await createHostHarness(t, {
      config: { registry: { url: oversized.indexUrl } },
      http: { fetch: oversized.fetch },
    });
    await sizeHost.host.registry.ready();
    assert.equal((await sizeHost.host.registry.snapshot()).lastError, GM.REGISTRY_UNAVAILABLE);

    const tooMany = await createHttpsRegistry(t, [{ manifest: { id: 'jump' } }]);
    const base = tooMany.document.games[0];
    for (let index = 0; index < 500; index += 1) {
      tooMany.document.games.push({
        ...base,
        id: `game-${index}`,
        package: {
          ...base.package,
          url: `https://github.com/dsh-games/releases/download/v1.0.0/game-${index}-1.0.0.html`,
        },
      });
    }
    const countHost = await createHostHarness(t, {
      config: { registry: { url: tooMany.indexUrl } },
      http: { fetch: tooMany.fetch },
    });
    await countHost.host.registry.ready();
    const { response, payload } = await countHost.requestJson(ROUTES.REGISTRY_REFRESH, {
      body: { force: true },
    });
    assert.equal(response.status, 503);
    assertErrorEnvelope(payload, GM.REGISTRY_UNAVAILABLE);
  });

  test('manual refresh is throttled to 5 minutes unless force is set', async (t) => {
    const fixture = await createFileRegistry(t, [{ manifest: { id: 'jump' } }]);
    const host = await createHostHarness(t, { config: fileRegistryConfig(fixture) });
    await host.host.registry.ready();

    const first = await host.data(ROUTES.REGISTRY_REFRESH, { body: {} });
    assert.equal(first.count, 1);
    const throttled = await host.requestJson(ROUTES.REGISTRY_REFRESH, { body: {} });
    assert.equal(throttled.response.status, 429);
    assertErrorEnvelope(throttled.payload, GM.RATE_LIMITED);
    assert.equal(throttled.response.headers.get('retry-after'), '1');
    const forced = await host.data(ROUTES.REGISTRY_REFRESH, { body: { force: true } });
    assert.equal(forced.count, 1);
  });

  test('concurrent refreshes share a single flight', async (t) => {
    const fixture = await createHttpsRegistry(t, [{ manifest: { id: 'jump' } }]);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fetchImpl = async (url, init) => {
      if (String(url) === fixture.indexUrl) await gate;
      return fixture.fetch(url, init);
    };
    const host = await createHostHarness(t, {
      config: { registry: { url: fixture.indexUrl } },
      http: { fetch: fetchImpl },
    });
    await new Promise((resolve) => setImmediate(resolve));
    const a = host.host.registry.refresh({ force: true });
    const b = host.host.registry.refresh({ force: true });
    release();
    const [first, second] = await Promise.all([a, b]);
    assert.equal(first.count, 1);
    assert.equal(second.count, 1);
    assert.equal(fixture.state.indexRequests, 1);
  });

  test('network failure keeps the cached games and reports offline', async (t) => {
    const fixture = await createHttpsRegistry(t, [{ manifest: { id: 'jump' } }]);
    const host = await createHostHarness(t, {
      config: { registry: { url: fixture.indexUrl } },
      http: { fetch: fixture.fetch },
    });
    await host.host.registry.ready();
    fixture.state.indexFailures = 1;
    const { response, payload } = await host.requestJson(ROUTES.REGISTRY_REFRESH, {
      body: { force: true },
    });
    assert.equal(response.status, 503);
    assertErrorEnvelope(payload, GM.REGISTRY_UNAVAILABLE);
    const health = await host.data(ROUTES.HEALTH);
    assert.equal(health.registry.state, 'offline');
    assert.equal(health.registry.count, 1);
    assert.equal((await host.data(ROUTES.GAMES)).items.some((item) => item.id === 'jump'), true);
  });

  test('preview assets are cached and served from /preview only', async (t) => {
    const fixture = await createHttpsRegistry(t, [{ manifest: { id: 'jump' } }]);
    const host = await createHostHarness(t, {
      config: { registry: { url: fixture.indexUrl } },
      http: { fetch: fixture.fetch },
    });
    await host.host.registry.ready();
    const cacheDir = host.filePath('preview-cache', 'jump', '1.0.0');
    const names = (await fs.readdir(cacheDir)).sort();
    assert.deepEqual(names, ['cover.png', 'icon.png', 'screenshot-1.png']);

    const icon = await host.request(ROUTES.PREVIEW, {
      query: { gameId: 'jump', version: '1.0.0', file: 'icon' },
    });
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get('content-type'), 'image/png');
    assert.equal(icon.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(icon.headers.get('x-content-type-options'), 'nosniff');
    assert.match(icon.headers.get('etag'), /^"[a-f0-9]{32}"$/);
    assert.deepEqual(Buffer.from(await icon.arrayBuffer()), PNG_BYTES);

    const missing = await host.requestJson(ROUTES.PREVIEW, {
      query: { gameId: 'jump', version: '1.0.0', file: 'screenshot-5' },
    });
    assert.equal(missing.response.status, 404);
    assertErrorEnvelope(missing.payload, GM.ASSET_NOT_FOUND);
    const badFile = await host.requestJson(ROUTES.PREVIEW, {
      query: { gameId: 'jump', version: '1.0.0', file: '../games.json' },
    });
    assert.equal(badFile.response.status, 404);
    assertErrorEnvelope(badFile.payload, GM.ASSET_NOT_FOUND);

    // The Market list points at the same-origin cache, never the remote URL.
    const list = await host.data(ROUTES.GAMES);
    const jump = list.items.find((item) => item.id === 'jump');
    assert.ok(jump.icon.startsWith('/api/game-market/preview?'));
    assert.equal(jump.icon.includes('cdn.example.com'), false);
  });

  test('preview downloads are skipped when type/size do not match', async (t) => {
    const fixture = await createHttpsRegistry(t, [{ manifest: { id: 'jump' } }]);
    fixture.state.previewOverrides.set(
      'https://cdn.example.com/jump/icon.png',
      new Response('<html>not an image</html>', { status: 200, headers: { 'content-type': 'image/png' } })
    );
    fixture.state.previewOverrides.set(
      'https://cdn.example.com/jump/shot-1.webp',
      new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'text/html' } })
    );
    const host = await createHostHarness(t, {
      config: { registry: { url: fixture.indexUrl } },
      http: { fetch: fixture.fetch },
    });
    await host.host.registry.ready();
    const cacheDir = host.filePath('preview-cache', 'jump', '1.0.0');
    const names = (await fs.readdir(cacheDir)).sort();
    assert.deepEqual(names, ['cover.png']);
    assert.equal(
      host.logs.some((entry) => entry.some((part) => String(part).includes('preview-cache-skipped'))),
      true
    );
    const icon = await host.requestJson(ROUTES.PREVIEW, {
      query: { gameId: 'jump', version: '1.0.0', file: 'icon' },
    });
    assert.equal(icon.response.status, 404);
    assertErrorEnvelope(icon.payload, GM.ASSET_NOT_FOUND);
  });

  test('config.allowedHosts extends package URL admission', async (t) => {
    const fixture = await createHttpsRegistry(t, [{ manifest: { id: 'mirror-game' } }], {
      packageBase: 'https://cdn.example.com/packages',
    });
    const rejectedHost = await createHostHarness(t, {
      config: { registry: { url: fixture.indexUrl } },
      http: { fetch: fixture.fetch },
    });
    await rejectedHost.host.registry.ready();
    assert.equal((await rejectedHost.host.registry.snapshot()).lastError, GM.REGISTRY_UNAVAILABLE);

    const allowedHost = await createHostHarness(t, {
      config: { registry: { url: fixture.indexUrl, allowedHosts: ['cdn.example.com'] } },
      http: { fetch: fixture.fetch },
    });
    await allowedHost.host.registry.ready();
    const health = await allowedHost.data(ROUTES.HEALTH);
    assert.equal(health.registry.state, 'fresh');
    assert.equal(health.registry.count, 1);
  });

  test('the bundle default file Registry is used when nothing is configured', async (t) => {
    const host = await createHarness(t);
    const health = await host.data(ROUTES.HEALTH);
    assert.equal(health.registry.state, 'missing');
    assert.equal(health.registry.count, 0);
    assert.equal((await host.data(ROUTES.GAMES)).source, 'builtin');
  });

  test('invalid UTF-8/BOM/JSON Registry payloads map to GM-5032', async (t) => {
    const cases = [
      Buffer.from([0xff, 0xfe, 0x00]),
      Buffer.from(`\uFEFF{"registryVersion":1,"generatedAt":"2026-10-18T00:00:00.000Z","games":[]}`, 'utf8'),
      Buffer.from('{not json', 'utf8'),
    ];
    for (const body of cases) {
      const fetchImpl = createFakeFetch([
        {
          match: 'https://registry.example.com/games.json',
          response: { status: 200, headers: { 'content-type': 'application/json' }, body },
        },
      ]);
      const host = await createHostHarness(t, {
        config: { registry: { url: 'https://registry.example.com/games.json' } },
        http: { fetch: fetchImpl },
      });
      await host.host.registry.ready();
      const { response, payload } = await host.requestJson(ROUTES.REGISTRY_REFRESH, {
        body: { force: true },
      });
      assert.equal(response.status, 503);
      assertErrorEnvelope(payload, GM.REGISTRY_UNAVAILABLE);
    }
  });
}
