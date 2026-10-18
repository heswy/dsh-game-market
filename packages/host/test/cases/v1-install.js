import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
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
  createHttpsRegistry,
  sha256Hex,
} from '../support/packages.js';

function fileRegistryConfig(fixture) {
  return { registry: { url: fixture.indexPath, allowLocalFile: true } };
}

function assertError(payload, code) {
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, code);
}

let opCounter = 0;
function nextOp(label = 'op') {
  opCounter += 1;
  return `${label}-${opCounter}`;
}

async function setup(t, specs, options = {}) {
  const fixture = await createFileRegistry(t, specs);
  const host = await createHostHarness(t, {
    config: { ...fileRegistryConfig(fixture), ...(options.config || {}) },
    http: options.http,
  });
  await host.host.registry.ready();
  return { fixture, host };
}

async function install(host, gameId, extra = {}) {
  return host.data(ROUTES.INSTALL, {
    body: { gameId, operationId: nextOp('install'), ...extra },
  });
}

async function rewriteRegistry(host, fixture) {
  await fixture.writeIndex();
  return host.data(ROUTES.REGISTRY_REFRESH, { body: { force: true } });
}

export function register() {
  test('POST /install downloads, verifies and atomically installs a package', async (t) => {
    const { fixture, host } = await setup(t, [
      { manifest: { id: 'jump', name: 'Jump', version: '1.0.0' } },
    ]);
    const entry = fixture.document.games[0];
    const result = await install(host, 'jump');
    assert.equal(result.gameId, 'jump');
    assert.equal(result.version, '1.0.0');
    assert.equal(result.changed, true);
    assert.equal(result.source, 'registry');
    assert.equal(result.sha256, entry.package.sha256);
    assert.ok(!Number.isNaN(Date.parse(result.installedAt)));
    assert.deepEqual(result.warnings, []);
    assert.equal(result.installation.packagePath, 'jump/1.0.0');
    assert.equal(result.installation.sizeBytes, entry.package.size);
    assert.equal(result.installation.compatibility.status, 'ok');
    assert.equal(result.installation.update.available, false);

    const installedEntry = await fs.readFile(host.filePath('packages', 'jump', '1.0.0', 'entry.html'));
    assert.equal(sha256Hex(installedEntry), entry.package.sha256);
    const installations = await host.readDataJson('installations.json');
    const record = installations.games.jump;
    assert.equal(record.version, '1.0.0');
    assert.equal(record.source, 'registry');
    assert.equal(record.packagePath, 'jump/1.0.0');
    assert.equal(record.sha256, entry.package.sha256);
    assert.equal(record.previousVersion, null);
    assert.equal(record.manifest.id, 'jump');
    assert.equal(record.playCount, 0);
    assert.deepEqual(await host.listDataFiles('staging'), []);

    const installed = await host.data(ROUTES.INSTALLED);
    const jump = installed.items.find((item) => item.id === 'jump');
    assert.equal(jump.version, '1.0.0');
    assert.equal(jump.installed, true);
    assert.equal(jump.source, 'registry');
    assert.equal(jump.updateAvailable, false);
  });

  test('operationId is idempotent and does not re-download', async (t) => {
    const { host } = await setup(t, [{ manifest: { id: 'jump' } }]);
    const operationId = nextOp('idem');
    const first = await host.data(ROUTES.INSTALL, { body: { gameId: 'jump', operationId } });
    const updatedAt = (await host.readDataJson('installations.json')).updatedAt;
    const second = await host.data(ROUTES.INSTALL, { body: { gameId: 'jump', operationId } });
    assert.deepEqual(second, first);
    assert.equal((await host.readDataJson('installations.json')).updatedAt, updatedAt);

    const reused = await host.requestJson(ROUTES.INSTALL, {
      body: { gameId: 'jump', operationId, version: '9.9.9' },
    });
    assert.equal(reused.response.status, 400);
    assertError(reused.payload, GM.INVALID_PARAM);
  });

  test('installing the same version with the same sha256 is a no-op', async (t) => {
    const { host } = await setup(t, [{ manifest: { id: 'jump' } }]);
    await install(host, 'jump');
    const again = await install(host, 'jump');
    assert.equal(again.changed, false);
    assert.equal(again.version, '1.0.0');
  });

  test('sha256 mismatch fails with GM-5015 and leaves no half install', async (t) => {
    const { host, fixture } = await setup(t, [
      { manifest: { id: 'jump' }, packageOverrides: { sha256: 'a'.repeat(64) } },
    ]);
    const { response, payload } = await host.requestJson(ROUTES.INSTALL, {
      body: { gameId: 'jump', operationId: nextOp('hash') },
    });
    assert.equal(response.status, 500);
    assertError(payload, GM.INSTALL_HASH_MISMATCH);
    assert.equal(await host.pathExists('packages/jump/1.0.0'), false);
    assert.equal(await host.pathExists('installations.json'), false);
    assert.deepEqual(await host.listDataFiles('staging'), []);
    assert.equal(fixture.document.games[0].id, 'jump');
  });

  test('package size mismatch fails with GM-5037', async (t) => {
    const fixture0 = buildPackage(buildManifest({ id: 'jump' }));
    const { host } = await setup(t, [
      { manifest: { id: 'jump' }, packageOverrides: { size: fixture0.size + 5 } },
    ]);
    const { response, payload } = await host.requestJson(ROUTES.INSTALL, {
      body: { gameId: 'jump', operationId: nextOp('size') },
    });
    assert.equal(response.status, 503);
    assertError(payload, GM.INSTALL_CORRUPT);
    assert.equal(await host.pathExists('packages/jump/1.0.0'), false);
  });

  test('packages over 20 MiB are rejected with GM-4135', async (t) => {
    const fixture = await createHttpsRegistry(t, [{ manifest: { id: 'big-game' } }]);
    const packageUrl = [...fixture.packages.keys()][0];
    const tiny = fixture.packages.get(packageUrl);
    const originalFetch = fixture.fetch;
    const fetchImpl = async (url, init) => {
      if (String(url) === packageUrl) {
        return new Response(tiny.bytes, {
          status: 200,
          headers: {
            'content-type': 'text/html',
            'content-length': String(20 * 1024 * 1024 + 1),
          },
        });
      }
      return originalFetch(url, init);
    };
    const host = await createHostHarness(t, {
      config: { registry: { url: fixture.indexUrl } },
      http: { fetch: fetchImpl },
    });
    await host.host.registry.ready();
    const { response, payload } = await host.requestJson(ROUTES.INSTALL, {
      body: { gameId: 'big-game', operationId: nextOp('big') },
    });
    assert.equal(response.status, 413);
    assertError(payload, GM.PACKAGE_TOO_LARGE);
  });

  test('non-self-contained packages fail with GM-4225', async (t) => {
    const { host } = await setup(t, [
      {
        manifest: { id: 'jump' },
        packageOptions: { extra: '<script src="https://evil.example.com/x.js"></script>' },
      },
    ]);
    const { response, payload } = await host.requestJson(ROUTES.INSTALL, {
      body: { gameId: 'jump', operationId: nextOp('sc') },
    });
    assert.equal(response.status, 422);
    assertError(payload, GM.ENTRY_NOT_SELF_CONTAINED);
    assert.equal(await host.pathExists('packages/jump/1.0.0'), false);
  });

  test('package encoding and manifest uniqueness are enforced at install', async (t) => {
    for (const [options, code] of [
      [{ bom: true }, GM.PACKAGE_INVALID],
      [{ duplicateManifest: true }, GM.MANIFEST_INVALID],
    ]) {
      const { host } = await setup(t, [{ manifest: { id: 'jump' }, packageOptions: options }]);
      const { response, payload } = await host.requestJson(ROUTES.INSTALL, {
        body: { gameId: 'jump', operationId: nextOp('encoding') },
      });
      assert.equal(response.status, 422);
      assertError(payload, code);
      assert.equal(await host.pathExists('packages/jump/1.0.0'), false);
    }
  });

  test('invalid inline manifests fail with package GM codes', async (t) => {
    const { host } = await setup(t, [
      {
        manifest: { id: 'jump' },
        packageOptions: { serializeManifest: (manifest) => ({ ...manifest, permissions: { network: true } }) },
      },
    ]);
    const { response, payload } = await host.requestJson(ROUTES.INSTALL, {
      body: { gameId: 'jump', operationId: nextOp('perm') },
    });
    assert.equal(response.status, 422);
    assertError(payload, 'GM-4242');
  });

  test('manifest id/version must match the Registry entry (GM-4095)', async (t) => {
    const { host } = await setup(t, [
      {
        manifest: { id: 'jump', version: '1.0.0' },
        packageOptions: { serializeManifest: (manifest) => ({ ...manifest, version: '2.0.0' }) },
      },
    ]);
    const { response, payload } = await host.requestJson(ROUTES.INSTALL, {
      body: { gameId: 'jump', operationId: nextOp('mismatch') },
    });
    assert.equal(response.status, 409);
    assertError(payload, GM.INSTALL_VERSION_MISMATCH);
  });

  test('unknown ids and built-in ids are rejected', async (t) => {
    const { host } = await setup(t, [
      { manifest: { id: 'snake' } },
    ]);
    const unknown = await host.requestJson(ROUTES.INSTALL, {
      body: { gameId: 'not-in-registry', operationId: nextOp('unknown') },
    });
    assert.equal(unknown.response.status, 404);
    assertError(unknown.payload, GM.NOT_IN_REGISTRY);

    const builtin = await host.requestJson(ROUTES.INSTALL, {
      body: { gameId: 'snake', operationId: nextOp('builtin') },
    });
    assert.equal(builtin.response.status, 400);
    assertError(builtin.payload, GM.INVALID_PARAM);
  });

  test('incompatible runtime/sdk ranges are rejected before writing', async (t) => {
    for (const [field, code] of [
      ['runtimeVersion', GM.RUNTIME_INCOMPATIBLE],
      ['sdkVersion', GM.SDK_INCOMPATIBLE],
    ]) {
      const { host } = await setup(t, [
        { manifest: { id: 'jump', [field]: '^2.0.0' } },
      ]);
      const { response, payload } = await host.requestJson(ROUTES.INSTALL, {
        body: { gameId: 'jump', operationId: nextOp('compat') },
      });
      assert.equal(response.status, 409);
      assertError(payload, code);
      assert.equal(await host.pathExists('packages/jump/1.0.0'), false);
    }
  });

  test('registry URL redirects are re-validated and http downgrades are rejected', async (t) => {
    const fixture = await createHttpsRegistry(t, [{ manifest: { id: 'jump' } }]);
    const packageUrl = [...fixture.packages.keys()][0];
    const fetchImpl = async (url, init) => {
      if (String(url) === packageUrl) {
        return new Response(null, { status: 302, headers: { location: 'http://github.com/downgrade.html' } });
      }
      return fixture.fetch(url, init);
    };
    const host = await createHostHarness(t, {
      config: { registry: { url: fixture.indexUrl } },
      http: { fetch: fetchImpl },
    });
    await host.host.registry.ready();
    const { response, payload } = await host.requestJson(ROUTES.INSTALL, {
      body: { gameId: 'jump', operationId: nextOp('redirect') },
    });
    assert.equal(response.status, 403);
    assertError(payload, GM.INSTALL_URL_REJECTED);
  });

  test('update keeps current+1 versions and records previousVersion', async (t) => {
    const { fixture, host } = await setup(t, [{ manifest: { id: 'jump', version: '1.0.0' } }]);
    await install(host, 'jump');

    fixture.remove('jump');
    await fixture.add({ manifest: { id: 'jump', version: '1.1.0' } });
    await rewriteRegistry(host, fixture);
    const updated = await install(host, 'jump');
    assert.equal(updated.version, '1.1.0');
    assert.equal(updated.changed, true);
    assert.equal(updated.installation.previousVersion, '1.0.0');
    assert.equal(await host.pathExists('packages/jump/1.0.0/entry.html'), true);
    assert.equal(await host.pathExists('packages/jump/1.1.0/entry.html'), true);

    fixture.remove('jump');
    await fixture.add({ manifest: { id: 'jump', version: '1.2.0' } });
    await rewriteRegistry(host, fixture);
    const third = await install(host, 'jump');
    assert.equal(third.version, '1.2.0');
    assert.equal(third.installation.previousVersion, '1.1.0');
    assert.equal(await host.pathExists('packages/jump/1.0.0'), false);
    assert.equal(await host.pathExists('packages/jump/1.1.0/entry.html'), true);
    assert.equal(await host.pathExists('packages/jump/1.2.0/entry.html'), true);
    const installed = await host.data(ROUTES.INSTALLED);
    assert.equal(installed.items.find((item) => item.id === 'jump').version, '1.2.0');
  });

  test('requesting an unavailable version returns GM-4094', async (t) => {
    const { host } = await setup(t, [{ manifest: { id: 'jump', version: '1.0.0' } }]);
    await install(host, 'jump');
    const { response, payload } = await host.requestJson(ROUTES.INSTALL, {
      body: { gameId: 'jump', version: '0.9.0', operationId: nextOp('down') },
    });
    assert.equal(response.status, 409);
    assertError(payload, GM.INSTALL_VERSION_CONFLICT);
  });

  test('updating while the game is running is refused with GM-4096', async (t) => {
    const { fixture, host } = await setup(t, [{ manifest: { id: 'jump', version: '1.0.0' } }]);
    await install(host, 'jump');
    await host.data(ROUTES.SESSION, {
      body: { gameId: 'jump', action: 'start', operationId: nextOp('session') },
    });
    fixture.remove('jump');
    await fixture.add({ manifest: { id: 'jump', version: '1.1.0' } });
    await rewriteRegistry(host, fixture);
    const { response, payload } = await host.requestJson(ROUTES.INSTALL, {
      body: { gameId: 'jump', operationId: nextOp('running') },
    });
    assert.equal(response.status, 409);
    assertError(payload, GM.UPDATE_GAME_RUNNING);
  });

  test('uninstall keeps saves/scores/sessions by default and is idempotent', async (t) => {
    const { host } = await setup(t, [{ manifest: { id: 'jump' } }]);
    await install(host, 'jump');
    await host.data(ROUTES.SAVE, {
      body: { gameId: 'jump', key: 'current', data: { score: 7 }, operationId: nextOp('save') },
    });
    await host.data(ROUTES.SCORE, {
      body: { gameId: 'jump', score: 7, operationId: nextOp('score') },
    });
    const session = await host.data(ROUTES.SESSION, {
      body: { gameId: 'jump', action: 'start', operationId: nextOp('start') },
    });
    await host.data(ROUTES.SESSION, {
      body: {
        gameId: 'jump',
        action: 'end',
        playSessionId: session.playSessionId,
        outcome: 'completed',
        operationId: nextOp('end'),
      },
    });
    await host.data(ROUTES.PREFERENCES, { body: { lastPlayedGameId: 'jump' } });

    const removed = await host.data(ROUTES.UNINSTALL, {
      body: { gameId: 'jump', operationId: nextOp('uninstall') },
    });
    assert.deepEqual(removed, { gameId: 'jump', removed: true, dataDeleted: false, ignored: false });
    assert.equal(await host.pathExists('packages/jump'), false);
    assert.equal(await host.pathExists('installations.json'), true);
    assert.equal(await host.pathExists('saves/jump/current.json'), true);
    assert.equal(await host.pathExists('scores/jump.json'), true);
    assert.equal(await host.pathExists('sessions/jump.json'), true);
    const installations = await host.readDataJson('installations.json');
    assert.equal(installations.games.jump, undefined);
    const preferences = await host.data(ROUTES.PREFERENCES);
    assert.equal(preferences.lastPlayedGameId, null);

    const again = await host.data(ROUTES.UNINSTALL, {
      body: { gameId: 'jump', operationId: nextOp('uninstall') },
    });
    assert.equal(again.removed, false);
    assert.equal(again.ignored, true);
  });

  test('deleteData needs confirmDataDeletion and removes game data', async (t) => {
    const { host } = await setup(t, [{ manifest: { id: 'jump' } }]);
    await install(host, 'jump');
    await host.data(ROUTES.SAVE, {
      body: { gameId: 'jump', key: 'current', data: { score: 1 }, operationId: nextOp('save') },
    });
    await host.data(ROUTES.SCORE, { body: { gameId: 'jump', score: 1, operationId: nextOp('score') } });

    const missingConfirm = await host.requestJson(ROUTES.UNINSTALL, {
      body: { gameId: 'jump', deleteData: true, operationId: nextOp('del') },
    });
    assert.equal(missingConfirm.response.status, 400);
    assertError(missingConfirm.payload, GM.INVALID_PARAM);

    const removed = await host.data(ROUTES.UNINSTALL, {
      body: {
        gameId: 'jump',
        deleteData: true,
        confirmDataDeletion: true,
        operationId: nextOp('del-confirm'),
      },
    });
    assert.equal(removed.removed, true);
    assert.equal(removed.dataDeleted, true);
    assert.equal(await host.pathExists('saves/jump'), false);
    assert.equal(await host.pathExists('scores/jump.json'), false);
    assert.equal(await host.pathExists('sessions/jump.json'), false);
  });

  test('built-in games cannot be uninstalled (GM-4038)', async (t) => {
    const { host } = await setup(t, []);
    const { response, payload } = await host.requestJson(ROUTES.UNINSTALL, {
      body: { gameId: 'snake', operationId: nextOp('builtin-uninstall') },
    });
    assert.equal(response.status, 403);
    assertError(payload, GM.UNINSTALL_BUILTIN);
  });

  test('uninstalling a running game is refused (GM-4096)', async (t) => {
    const { host } = await setup(t, [{ manifest: { id: 'jump' } }]);
    await install(host, 'jump');
    await host.data(ROUTES.SESSION, {
      body: { gameId: 'jump', action: 'start', operationId: nextOp('session') },
    });
    const { response, payload } = await host.requestJson(ROUTES.UNINSTALL, {
      body: { gameId: 'jump', operationId: nextOp('running-uninstall') },
    });
    assert.equal(response.status, 409);
    assertError(payload, GM.UPDATE_GAME_RUNNING);
  });

  test('POST /install-local accepts raw text/html and records source local', async (t) => {
    const { host } = await setup(t, []);
    const manifest = buildManifest({ id: 'local-game', name: 'Local Game' });
    const pkg = buildPackage(manifest);
    const result = await host.data(`${ROUTES.INSTALL_LOCAL}?operationId=local-op-1`, {
      rawBody: pkg.html,
      contentType: 'text/html; charset=utf-8',
    });
    assert.equal(result.gameId, 'local-game');
    assert.equal(result.version, '1.0.0');
    assert.equal(result.source, 'local');
    assert.equal(result.changed, true);
    assert.equal(result.sha256, null);
    const record = (await host.readDataJson('installations.json')).games['local-game'];
    assert.equal(record.source, 'local');
    assert.equal(record.sha256, null);
    assert.equal(record.sizeBytes, pkg.size);
    const entry = await fs.readFile(host.filePath('packages', 'local-game', '1.0.0', 'entry.html'));
    assert.equal(sha256Hex(entry), pkg.sha256);

    const again = await host.data(`${ROUTES.INSTALL_LOCAL}?operationId=local-op-2`, {
      rawBody: pkg.html,
      contentType: 'text/html',
    });
    assert.equal(again.changed, true);
    assert.equal(again.version, '1.0.0');
  });

  test('install-local validates content type, size and package contents', async (t) => {
    const { host } = await setup(t, []);
    const pkg = buildPackage();
    const wrongType = await host.requestJson(ROUTES.INSTALL_LOCAL, {
      rawBody: pkg.html,
      contentType: 'application/json',
    });
    assert.equal(wrongType.response.status, 415);
    assertError(wrongType.payload, GM.UNSUPPORTED_MEDIA_TYPE);

    const invalid = await host.requestJson(ROUTES.INSTALL_LOCAL, {
      rawBody: buildPackageHtml(buildManifest(), { omitManifest: true }),
      contentType: 'text/html',
    });
    assert.equal(invalid.response.status, 422);
    assertError(invalid.payload, GM.MANIFEST_INVALID);

    const notHtml = await host.requestJson(ROUTES.INSTALL_LOCAL, {
      rawBody: 'just text',
      contentType: 'text/html',
    });
    assert.equal(notHtml.response.status, 422);
    assertError(notHtml.payload, GM.PACKAGE_INVALID);

    const oversized = await host.requestJson(ROUTES.INSTALL_LOCAL, {
      rawBody: 'x'.repeat(20 * 1024 * 1024 + 1),
      contentType: 'text/html',
    });
    assert.equal(oversized.response.status, 413);
    assertError(oversized.payload, GM.PACKAGE_TOO_LARGE);
    assert.equal(await host.pathExists('packages/jump'), false);
  });

  test('install-local updates keep previousVersion like registry installs', async (t) => {
    const { host } = await setup(t, []);
    const first = buildPackage(buildManifest({ id: 'local-game', version: '1.0.0' }));
    await host.data(ROUTES.INSTALL_LOCAL, { rawBody: first.html, contentType: 'text/html' });
    const second = buildPackage(buildManifest({ id: 'local-game', version: '1.1.0' }));
    const updated = await host.data(ROUTES.INSTALL_LOCAL, {
      rawBody: second.html,
      contentType: 'text/html',
    });
    assert.equal(updated.version, '1.1.0');
    assert.equal(updated.installation.previousVersion, '1.0.0');
    assert.equal(await host.pathExists('packages/local-game/1.0.0/entry.html'), true);
    assert.equal(await host.pathExists('packages/local-game/1.1.0/entry.html'), true);
  });

  test('install lock is cross-process, stale-lock takeover works and staging is cleaned', async (t) => {
    const { host } = await setup(t, [{ manifest: { id: 'jump' } }], {
      http: { installLockWaitMs: 50 },
    });
    const lockPath = host.filePath('staging', '.install.lock');
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, token: 'held', startedAt: new Date().toISOString() })
    );

    const busy = await host.requestJson(ROUTES.INSTALL, {
      body: { gameId: 'jump', operationId: nextOp('locked') },
    });
    assert.equal(busy.response.status, 409);
    assertError(busy.payload, GM.INSTALL_IN_PROGRESS);
    assert.equal(busy.payload.error.retryable, true);

    const old = new Date(Date.now() - 60000);
    await fs.utimes(lockPath, old, old);
    const succeeded = await install(host, 'jump');
    assert.equal(succeeded.changed, true);
    assert.equal(await host.pathExists('staging/.install.lock'), false);
  });

  test('uninstall reports GM-4097 while another install/uninstall runs', async (t) => {
    const { host } = await setup(t, [{ manifest: { id: 'jump' } }]);
    await install(host, 'jump');
    const lockPath = host.filePath('staging', '.install.lock');
    await fs.writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, token: 'held', startedAt: new Date().toISOString() })
    );
    const { response, payload } = await host.requestJson(ROUTES.UNINSTALL, {
      body: { gameId: 'jump', operationId: nextOp('busy-uninstall') },
    });
    assert.equal(response.status, 409);
    assertError(payload, GM.UNINSTALL_BUSY);
    await fs.rm(lockPath, { force: true });
  });

  test('concurrent installs of different games are serialised without corrupting state', async (t) => {
    const { host } = await setup(t, [
      { manifest: { id: 'jump' } },
      { manifest: { id: '2048' } },
    ]);
    const [first, second] = await Promise.all([install(host, 'jump'), install(host, '2048')]);
    assert.equal(first.version, '1.0.0');
    assert.equal(second.version, '1.0.0');
    const installations = await host.readDataJson('installations.json');
    assert.deepEqual(Object.keys(installations.games).sort(), ['2048', 'jump']);
    assert.equal(await host.pathExists('staging/.install.lock'), false);
  });

  test('a placement I/O failure leaves the previous installation untouched', async (t) => {
    const { host } = await setup(t, [{ manifest: { id: 'jump' } }]);
    await fs.mkdir(host.filePath('packages'), { recursive: true });
    await fs.writeFile(host.filePath('packages', 'jump'), 'blocked');
    const { response, payload } = await host.requestJson(ROUTES.INSTALL, {
      body: { gameId: 'jump', operationId: nextOp('io') },
    });
    assert.equal(response.status, 503);
    assertError(payload, GM.INSTALL_IO);
    assert.equal(await host.pathExists('installations.json'), false);
    assert.deepEqual(await host.listDataFiles('staging'), []);
    await fs.rm(host.filePath('packages', 'jump'), { force: true });
  });

  test('registry preview assets are attached to the installed record', async (t) => {
    const fixture = await createHttpsRegistry(t, [{ manifest: { id: 'jump' } }]);
    const host = await createHostHarness(t, {
      config: { registry: { url: fixture.indexUrl } },
      http: { fetch: fixture.fetch },
    });
    await host.host.registry.ready();
    const result = await install(host, 'jump');
    assert.equal(result.installation.source, 'registry');
    const record = (await host.readDataJson('installations.json')).games.jump;
    assert.equal(record.iconPath, 'jump/1.0.0/icon.png');
    const icon = await host.request(ROUTES.PREVIEW, {
      query: { gameId: 'jump', file: 'icon' },
    });
    assert.equal(icon.status, 200);
    assert.deepEqual(Buffer.from(await icon.arrayBuffer()), PNG_BYTES);
  });
}
