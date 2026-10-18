import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ROUTES } from '../../../shared/src/contracts.js';
import { GM } from '../../../shared/src/errors.js';
import { createHostHarness } from '../support/harness.js';
import {
  PNG_BYTES,
  buildManifest,
  buildPackage,
  buildPackageHtml,
  createFileRegistry,
} from '../support/packages.js';

function assertError(payload, code) {
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, code);
}

async function setup(t, specs, config = {}) {
  const fixture = await createFileRegistry(t, specs);
  const host = await createHostHarness(t, {
    config: { registry: { url: fixture.indexPath, allowLocalFile: true }, ...config },
  });
  await host.host.registry.ready();
  return { fixture, host };
}

export function register() {
  test('GET /games merges built-in, Registry and installed entries', async (t) => {
    const { host } = await setup(t, [
      {
        manifest: { id: 'jump', name: 'Jump', version: '1.0.0' },
        entry: { featured: true, quickPlay: true },
      },
    ]);
    const before = await host.data(ROUTES.GAMES);
    assert.equal(before.source, 'merged');
    assert.equal(before.nextCursor, null);
    const ids = before.items.map((item) => item.id);
    assert.deepEqual(ids, ['jump', 'snake']); // featured first, then installed built-in
    const jump = before.items[0];
    assert.equal(jump.installed, false);
    assert.equal(jump.builtin, false);
    assert.equal(jump.source, 'registry');
    assert.equal(jump.dev, false);
    assert.equal(jump.installedVersion, null);
    assert.equal(jump.updateAvailable, false);
    assert.equal(jump.featured, true);
    assert.equal(jump.quickPlay, true);
    assert.deepEqual(jump.tags, ['test', 'keyboard']);
    assert.deepEqual(jump.author, { name: 'Test Studio' });
    assert.equal(jump.compatibility.ok, true);
    assert.equal(before.registry.state, 'fresh');

    await host.data(ROUTES.INSTALL, { body: { gameId: 'jump', operationId: 'games-install' } });
    const after = await host.data(ROUTES.GAMES);
    const installedJump = after.items.find((item) => item.id === 'jump');
    assert.equal(installedJump.installed, true);
    assert.equal(installedJump.source, 'registry');
    assert.equal(installedJump.installedVersion, '1.0.0');
    assert.equal(installedJump.version, '1.0.0');
  });

  test('GET /games filters by q/category, limits and cursors', async (t) => {
    const { host } = await setup(t, [
      { manifest: { id: 'jump', name: 'Jump' } },
      { manifest: { id: 'puzzle-box', name: 'Puzzle Box', categories: ['puzzle'], tags: ['braintwister'] } },
    ]);
    const byQuery = await host.data(ROUTES.GAMES, { query: { q: 'puzzle' } });
    assert.deepEqual(byQuery.items.map((item) => item.id), ['puzzle-box']);
    const byTag = await host.data(ROUTES.GAMES, { query: { q: 'BRAIN' } });
    assert.deepEqual(byTag.items.map((item) => item.id), ['puzzle-box']);
    const byCategory = await host.data(ROUTES.GAMES, { query: { category: 'puzzle' } });
    assert.deepEqual(byCategory.items.map((item) => item.id), ['puzzle-box']);
    const arcade = await host.data(ROUTES.GAMES, { query: { category: 'arcade' } });
    assert.deepEqual(arcade.items.map((item) => item.id).sort(), ['jump', 'snake']);

    const invalid = await host.requestJson(ROUTES.GAMES, { query: { category: 'nope' } });
    assert.equal(invalid.response.status, 400);
    assertError(invalid.payload, GM.INVALID_PARAM);

    const pageOne = await host.data(ROUTES.GAMES, { query: { limit: 1 } });
    assert.equal(pageOne.items.length, 1);
    assert.equal(pageOne.nextCursor, '1');
    const pageTwo = await host.data(ROUTES.GAMES, {
      query: { limit: 1, cursor: pageOne.nextCursor },
    });
    assert.equal(pageTwo.items.length, 1);
    assert.notEqual(pageTwo.items[0].id, pageOne.items[0].id);
    const pageThree = await host.data(ROUTES.GAMES, {
      query: { limit: 1, cursor: pageTwo.nextCursor },
    });
    assert.equal(pageThree.nextCursor, null);
    const badCursor = await host.requestJson(ROUTES.GAMES, { query: { cursor: 'nope' } });
    assert.equal(badCursor.response.status, 400);
    assertError(badCursor.payload, GM.INVALID_PARAM);
  });

  test('GET /game returns the V1 detail envelope plus legacy fields', async (t) => {
    const { host } = await setup(t, [{ manifest: { id: 'jump', name: 'Jump' } }]);
    const registryOnly = await host.data(ROUTES.GAME, { query: { id: 'jump' } });
    assert.equal(registryOnly.installed, null);
    assert.equal(registryOnly.registry.id, 'jump');
    assert.equal(registryOnly.game.installed, false);
    assert.equal(registryOnly.game.registry, undefined);
    assert.equal(registryOnly.canContinue, false);
    assert.equal(registryOnly.bestScore, null);
    assert.equal(registryOnly.id, 'jump');
    assert.equal(registryOnly.game.saveInfo, null);
    assert.equal(registryOnly.game.activePlaySession, null);

    await host.data(ROUTES.INSTALL, { body: { gameId: 'jump', operationId: 'detail-install' } });
    await host.data(ROUTES.SAVE, {
      body: { gameId: 'jump', key: 'current', data: { score: 3 }, operationId: 'detail-save' },
    });
    await host.data(ROUTES.SCORE, {
      body: { gameId: 'jump', score: 3, operationId: 'detail-score' },
    });
    const session = await host.data(ROUTES.SESSION, {
      body: { gameId: 'jump', action: 'start', operationId: 'detail-session' },
    });
    const detail = await host.data(ROUTES.GAME, { query: { id: 'jump' } });
    assert.equal(detail.installed.version, '1.0.0');
    assert.equal(detail.installed.source, 'registry');
    assert.equal(detail.bestScore, 3);
    assert.equal(detail.canContinue, true);
    assert.deepEqual(detail.activePlaySession, {
      playSessionId: session.playSessionId,
      startedAt: session.startedAt,
    });
    assert.equal(detail.game.canContinue, true);
    assert.equal(detail.game.bestScore, 3);
    assert.deepEqual(detail.game.saveInfo.saveSchemaVersion, 1);
    assert.equal(typeof detail.game.saveInfo.savedAt, 'string');

    const unknown = await host.requestJson(ROUTES.GAME, { query: { id: 'missing-game' } });
    assert.equal(unknown.response.status, 404);
    assertError(unknown.payload, GM.GAME_NOT_FOUND);
    const badId = await host.requestJson(ROUTES.GAME, { query: { id: 'Bad_ID' } });
    assert.equal(badId.response.status, 400);
    assertError(badId.payload, GM.BAD_GAME_ID);
  });

  test('updateAvailable is computed from the Registry and clears after installing', async (t) => {
    const { fixture, host } = await setup(t, [{ manifest: { id: 'jump', version: '1.0.0' } }]);
    await host.data(ROUTES.INSTALL, { body: { gameId: 'jump', operationId: 'update-install' } });
    fixture.remove('jump');
    await fixture.add({ manifest: { id: 'jump', version: '1.1.0' } });
    await fixture.writeIndex();
    await host.data(ROUTES.REGISTRY_REFRESH, { body: { force: true } });

    const list = await host.data(ROUTES.GAMES);
    const jump = list.items.find((item) => item.id === 'jump');
    assert.equal(jump.version, '1.0.0');
    assert.equal(jump.installedVersion, '1.0.0');
    assert.equal(jump.updateAvailable, true);
    const health = await host.data(ROUTES.HEALTH);
    assert.equal(health.installations.count, 1);
    assert.equal(health.installations.updateAvailable, 1);

    await host.data(ROUTES.INSTALL, { body: { gameId: 'jump', operationId: 'update-install-2' } });
    const updated = (await host.data(ROUTES.GAMES)).items.find((item) => item.id === 'jump');
    assert.equal(updated.version, '1.1.0');
    assert.equal(updated.updateAvailable, false);
  });

  test('local installs are listed with source local and no Registry entry', async (t) => {
    const { host } = await setup(t, []);
    const icon = `data:image/png;base64,${PNG_BYTES.toString('base64')}`;
    const pkg = buildPackage(buildManifest({ id: 'local-game', name: 'Local Game', icon }));
    await host.data(ROUTES.INSTALL_LOCAL, { rawBody: pkg.html, contentType: 'text/html' });
    const list = await host.data(ROUTES.GAMES);
    const local = list.items.find((item) => item.id === 'local-game');
    assert.equal(local.source, 'local');
    assert.equal(local.installed, true);
    assert.equal(local.updateAvailable, false);
    assert.equal(local.cover, null);
    // The inline manifest icon is served through the same-origin /preview route.
    assert.ok(local.icon.startsWith('/api/game-market/preview?'));
    const iconResponse = await host.request(ROUTES.PREVIEW, {
      query: { gameId: 'local-game', file: 'icon' },
    });
    assert.equal(iconResponse.status, 200);
    assert.equal(iconResponse.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await iconResponse.arrayBuffer()), PNG_BYTES);
    const detail = await host.data(ROUTES.GAME, { query: { id: 'local-game' } });
    assert.equal(detail.registry, null);
    assert.equal(detail.installed.source, 'local');
  });

  test('GET /installed excludes registry-only entries', async (t) => {
    const { host } = await setup(t, [
      { manifest: { id: 'jump' } },
      { manifest: { id: '2048' } },
    ]);
    await host.data(ROUTES.INSTALL, { body: { gameId: '2048', operationId: 'installed-2048' } });
    const installed = await host.data(ROUTES.INSTALLED);
    assert.deepEqual(installed.items.map((item) => item.id).sort(), ['2048', 'snake']);
    assert.equal(installed.items.find((item) => item.id === '2048').installed, true);
  });

  test('devMode lists dev games in /games but not /installed, and serves their entry', async (t) => {
    const devRoot = await fs.mkdtemp(path.join(tmpdir(), 'dsh-gm-dev-'));
    t.after(() => fs.rm(devRoot, { recursive: true, force: true }));
    await fs.mkdir(path.join(devRoot, 'dev-game'));
    const manifest = buildManifest({ id: 'dev-game', name: 'Dev Game' });
    await fs.writeFile(
      path.join(devRoot, 'dev-game', 'dev-game-1.0.0.html'),
      buildPackageHtml(manifest)
    );

    const host = await createHostHarness(t, {
      config: { devMode: true, devGameRoots: [devRoot] },
    });
    const games = await host.data(ROUTES.GAMES);
    const dev = games.items.find((item) => item.id === 'dev-game');
    assert.ok(dev);
    assert.equal(dev.source, 'dev');
    assert.equal(dev.dev, true);
    assert.equal(dev.compatibility.ok, true);
    const installed = await host.data(ROUTES.INSTALLED);
    assert.equal(installed.items.some((item) => item.id === 'dev-game'), false);
    assert.equal(await host.pathExists('installations.json'), false);

    const info = await host.data(ROUTES.LAUNCH, { body: { gameId: 'dev-game' } });
    const response = await host.request(info.entryUrl);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes('data-test-entry="dev-game"'));
  });

  test('dev games without devMode are ignored and invalid dev roots are reported', async (t) => {
    const devRoot = await fs.mkdtemp(path.join(tmpdir(), 'dsh-gm-dev2-'));
    t.after(() => fs.rm(devRoot, { recursive: true, force: true }));
    await fs.mkdir(path.join(devRoot, 'dev-game'));
    await fs.writeFile(
      path.join(devRoot, 'dev-game', 'dev-game-1.0.0.html'),
      buildPackageHtml(buildManifest({ id: 'dev-game' }))
    );
    const disabled = await createHostHarness(t, {
      config: { devGameRoots: [devRoot] },
    });
    const games = await disabled.data(ROUTES.GAMES);
    assert.equal(games.items.some((item) => item.id === 'dev-game'), false);

    const invalid = await createHostHarness(t, {
      config: { devMode: true, devGameRoots: [42] },
    });
    const health = await invalid.data(ROUTES.HEALTH);
    assert.ok(health.configIssues.includes('devGameRoots:invalid'));
  });

  test('health exposes registry and installation counts', async (t) => {
    const { host } = await setup(t, [{ manifest: { id: 'jump' } }]);
    await host.data(ROUTES.INSTALL, { body: { gameId: 'jump', operationId: 'health-install' } });
    const health = await host.data(ROUTES.HEALTH);
    assert.equal(health.registry.state, 'fresh');
    assert.equal(health.registry.count, 1);
    assert.equal(health.installations.count, 1);
    assert.equal(health.installations.updateAvailable, 0);
    assert.equal(health.sessions.staleRunningPreserved, true);
    assert.equal(health.games.builtinCount, 1);
  });
}
