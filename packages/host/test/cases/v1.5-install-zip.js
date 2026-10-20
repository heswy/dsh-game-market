/**
 * Host integration cases for `asset-zip-v2` (V1.5-CONTRACTS §1.8, §4.1, §5.4,
 * §6.2, §6.3, §6.5). Registered explicitly from `packages/host/test/index.js`.
 *
 * The full 40+ case A03 rejection matrix lives in
 * `tests/v1.5-zip-policy.test.js`; this module covers the cross-cutting Host
 * behaviour that the matrix cannot: registry (v2) installs, format policy and
 * updates, `installations.json` V1.5 persistence/migration, sealed version
 * trees, crash recovery and the exported `verifyInstalledRecord` helper.
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { ROUTES } from '../../../shared/src/contracts.js';
import { GM, httpStatusFor } from '../../../shared/src/errors.js';
import { normalizeInstallationRecord, validateInstallationRecordV15 } from '../../../shared/src/installation.js';
import { fileManifestDigest } from '../../../shared/src/package-v2.js';
import { verifyInstalledRecord } from '../../src/installations.js';
import { createHostHarness } from '../support/harness.js';
import { buildManifest } from '../support/packages.js';
import { buildZip } from '../../../../tests/helpers/zip-builder.mjs';
import { buildPackage, defaultFiles, packageEntries, sha256Hex } from '../../../../tests/helpers/zip-package.mjs';

const GAME_ID = 'orbit-courier';
const VERSION = '1.0.0';

let operationCounter = 0;
function nextOperation(label) {
  operationCounter += 1;
  return `${label}-${operationCounter}`;
}

function offlineConfig() {
  return { registry: { url: '/nonexistent/games.json', allowLocalFile: true } };
}

async function installLocalZip(host, bytes, options = {}) {
  return host.requestJson(ROUTES.INSTALL_LOCAL, {
    rawBody: bytes,
    contentType: 'application/zip',
    query: { operationId: options.operationId || nextOperation('zip') },
  });
}

async function installLocalHtml(host, bytes) {
  return host.requestJson(ROUTES.INSTALL_LOCAL, {
    rawBody: bytes,
    contentType: 'text/html',
    query: { operationId: nextOperation('html') },
  });
}

function htmlPackage({ id = GAME_ID, version = VERSION } = {}) {
  const manifest = buildManifest({ id, name: 'Orbit Courier', version });
  return Buffer.from(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <script type="application/json" id="dsh-game-manifest">${JSON.stringify(manifest)}</script>
    <title>Orbit Courier</title>
  </head>
  <body><div id="app"></div></body>
</html>
`);
}

function zipFileName(id = GAME_ID, version = VERSION) {
  return `${id}-${version}.dshgame.zip`;
}

/** Local file Registry emitting a v2 index with one `asset-zip-v2` game. */
async function createV2FileRegistry(t, zip, { filesDigest, version = VERSION, indexOverrides = {} } = {}) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'dsh-gm-registry-v2-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const fileName = zipFileName(GAME_ID, version);
  await fs.mkdir(path.join(directory, 'packages'), { recursive: true });
  await fs.writeFile(path.join(directory, 'packages', fileName), zip);
  const document = {
    registryVersion: 2,
    generatedAt: '2026-10-18T00:00:00.000Z',
    games: [
      {
        id: GAME_ID,
        name: 'Orbit Courier',
        version,
        description: 'A test resource package used by host tests.',
        author: { name: 'Test Studio' },
        categories: ['arcade'],
        capabilities: ['storage', 'score'],
        sdkVersion: '^1.0.0',
        runtimeVersion: '^1.0.0',
        package: {
          format: 'asset-zip-v2',
          url: `packages/${fileName}`,
          sha256: sha256Hex(zip),
          size: zip.length,
          releasedAt: '2026-10-18T00:00:00.000Z',
          ...(filesDigest === undefined ? {} : { filesDigest }),
        },
        cover: 'https://cdn.example.com/cover.png',
        publishedAt: '2026-10-18T00:00:00.000Z',
        updatedAt: '2026-10-18T00:00:00.000Z',
        ...indexOverrides,
      },
    ],
  };
  const indexPath = path.join(directory, 'games.json');
  await fs.writeFile(indexPath, JSON.stringify(document, null, 2));
  return { directory, indexPath, document };
}

async function readRecord(host, id = GAME_ID) {
  const file = await host.readDataJson('installations.json');
  return file.games[id] || null;
}

/** Deterministic `asset-zip-v2` package for one game version (CR7-02 tests). */
function zipPackageFor(version, { scriptContent } = {}) {
  const files = defaultFiles();
  files.set('game.json', Buffer.from(JSON.stringify(buildManifest({ id: GAME_ID, name: 'Orbit Courier', version }), null, 2)));
  if (scriptContent !== undefined) files.set('scripts/main.js', Buffer.from(scriptContent));
  return buildPackage(files);
}

/** Relative path -> sha256 for every file in a published version directory. */
async function versionTreeHashes(host, version) {
  const root = host.filePath('packages', GAME_ID, version);
  const output = new Map();
  async function walk(current, prefix) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute, relative);
      else output.set(relative, sha256Hex(await fs.readFile(absolute)));
    }
  }
  await walk(root, '');
  return output;
}

async function saveProgress(host, data) {
  return host.data(ROUTES.SAVE, {
    body: { gameId: GAME_ID, key: 'progress', data, operationId: nextOperation('save') },
  });
}

async function readProgress(host) {
  return host.data(ROUTES.SAVE, { query: { gameId: GAME_ID, include: 'data' } });
}

async function expectInstallRejected(host, request, expectedCode) {
  const { response, payload } = request;
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, expectedCode, JSON.stringify(payload.error));
  assert.equal(response.status, httpStatusFor(expectedCode));
  assert.deepEqual(await host.listDataFiles('staging'), []);
  assert.deepEqual(await host.listDataFiles('packages'), []);
}

export function register() {
  test('local asset-zip-v2 install persists the V1.5 installation record', async (t) => {
    const host = await createHostHarness(t, { config: offlineConfig() });
    const pkg = buildPackage(defaultFiles());
    const { response, payload } = await installLocalZip(host, pkg.zip, { operationId: 'zip-install' });
    assert.equal(response.status, 200, JSON.stringify(payload.error));
    assert.equal(payload.ok, true);

    const installation = payload.data.installation;
    assert.equal(installation.format, 'asset-zip-v2');
    assert.equal(installation.entry, 'index.html');
    assert.equal(installation.fileCount, pkg.descriptor.files.length);
    assert.equal(installation.sha256, sha256Hex(pkg.zip));
    assert.equal(installation.fileManifestDigest, fileManifestDigest(pkg.descriptor.files, sha256Hex));
    assert.equal(installation.previousFormat, null);
    assert.equal(installation.source, 'local');
    assert.deepEqual(await host.listDataFiles('staging'), []);

    const record = await readRecord(host);
    assert.equal(record.format, 'asset-zip-v2');
    assert.equal(record.entry, 'index.html');
    assert.equal(record.sha256, sha256Hex(pkg.zip));
    assert.equal(record.fileManifestDigest, installation.fileManifestDigest);
    assert.equal(record.fileCount, pkg.descriptor.files.length);
    assert.ok(Number.isSafeInteger(record.unpackedBytes));
    assert.equal(record.previousFormat, null);
    assert.equal(record.version, VERSION);
    assert.equal(record.packagePath, `${GAME_ID}/${VERSION}`);
    assert.deepEqual(validateInstallationRecordV15(record), { ok: true, errors: [] });

    // The schemaVersion stays 1 (§6.2) and old readers are not broken.
    const file = await host.readDataJson('installations.json');
    assert.equal(file.schemaVersion, 1);

    const descriptor = await host.readDataJson('packages', GAME_ID, VERSION, 'dsh-package.json');
    assert.equal(descriptor.formatVersion, 2);
    assert.equal(
      fileManifestDigest(descriptor.files, sha256Hex),
      installation.fileManifestDigest
    );

    // Idempotent when the very same outer ZIP is uploaded again.
    const again = await installLocalZip(host, pkg.zip);
    assert.equal(again.response.status, 200);
    assert.equal(again.payload.data.changed, false);
    assert.equal(again.payload.data.installation.fileManifestDigest, installation.fileManifestDigest);
  });

  test('registry asset-zip-v2 install binds format/url/filesDigest from the v2 index', async (t) => {
    const pkg = buildPackage(defaultFiles());
    const filesDigest = fileManifestDigest(pkg.descriptor.files, sha256Hex);
    const registry = await createV2FileRegistry(t, pkg.zip, { filesDigest });
    const host = await createHostHarness(t, {
      config: { registry: { url: registry.indexPath, allowLocalFile: true } },
    });
    await host.host.registry.ready();
    const { response, payload } = await host.requestJson(ROUTES.INSTALL, {
      body: { gameId: GAME_ID, operationId: nextOperation('registry-zip') },
    });
    assert.equal(response.status, 200, JSON.stringify(payload.error));
    assert.equal(payload.ok, true);
    assert.equal(payload.data.installation.format, 'asset-zip-v2');
    assert.equal(payload.data.sha256, sha256Hex(pkg.zip));

    const record = await readRecord(host);
    assert.equal(record.format, 'asset-zip-v2');
    assert.equal(record.entry, 'index.html');
    assert.equal(record.fileManifestDigest, filesDigest);
    assert.equal(record.sha256, sha256Hex(pkg.zip));
    assert.equal(record.source, 'registry');
    assert.deepEqual(await host.listDataFiles('staging'), []);

    // A registry `filesDigest` that disagrees with the archive rejects (§5.2 rule 5).
    const pkg2 = buildPackage(defaultFiles({ 'levels/level-02.json': '{"level":"level-02"}' }));
    const badRegistry = await createV2FileRegistry(t, pkg2.zip, { filesDigest: 'f'.repeat(64) });
    const host2 = await createHostHarness(t, {
      config: { registry: { url: badRegistry.indexPath, allowLocalFile: true } },
    });
    await host2.host.registry.ready();
    const rejected = await host2.requestJson(ROUTES.INSTALL, {
      body: { gameId: GAME_ID, operationId: nextOperation('registry-bad-digest') },
    });
    await expectInstallRejected(host2, rejected, GM.DESCRIPTOR_MISMATCH);
    assert.equal(rejected.payload.error.code, GM.DESCRIPTOR_MISMATCH);
  });

  test('local ZIP upload separates Content-Type, magic and size limits (§1.8/§3)', async (t) => {
    const host = await createHostHarness(t, { config: offlineConfig() });
    const pkg = buildPackage(defaultFiles());

    // ZIP bytes through the raw text/html path must be rejected (§14).
    const spoofedHtml = await host.requestJson(ROUTES.INSTALL_LOCAL, {
      rawBody: pkg.zip,
      contentType: 'text/html',
      query: { operationId: nextOperation('spoof') },
    });
    await expectInstallRejected(host, spoofedHtml, GM.UNSUPPORTED_MEDIA_TYPE);

    // application/zip with a non-ZIP body is a media-type mismatch (§1.8).
    const spoofedZip = await host.requestJson(ROUTES.INSTALL_LOCAL, {
      rawBody: Buffer.from('<!doctype html><html></html>'),
      contentType: 'application/zip',
      query: { operationId: nextOperation('spoof2') },
    });
    await expectInstallRejected(host, spoofedZip, GM.UNSUPPORTED_MEDIA_TYPE);

    // Unrelated media type never reaches either pipeline.
    const otherMedia = await host.requestJson(ROUTES.INSTALL_LOCAL, {
      rawBody: pkg.zip,
      contentType: 'application/octet-stream',
      query: { operationId: nextOperation('media') },
    });
    await expectInstallRejected(host, otherMedia, GM.UNSUPPORTED_MEDIA_TYPE);

    // application/x-zip-compressed is an accepted alias.
    const alias = await host.requestJson(ROUTES.INSTALL_LOCAL, {
      rawBody: pkg.zip,
      contentType: 'application/x-zip-compressed',
      query: { operationId: nextOperation('alias') },
    });
    assert.equal(alias.response.status, 200, JSON.stringify(alias.payload.error));
    // Remove the accepted install so later limit cases assert a clean store.
    const removed = await host.requestJson(ROUTES.UNINSTALL, {
      body: { gameId: GAME_ID, operationId: nextOperation('alias-uninstall') },
    });
    assert.equal(removed.payload.ok, true);
    assert.deepEqual(await host.listDataFiles('packages'), []);

    // Content-Length is checked before the body is consumed (§1.8: "MUST 在收到
    // 正文前按 Content-Length 预判并拒绝超限"); the body here is a legal archive,
    // so only the declared length can trigger the rejection.
    const declaredTooLarge = await host.requestJson(ROUTES.INSTALL_LOCAL, {
      rawBody: pkg.zip,
      contentType: 'application/zip',
      headers: { 'content-length': String(20 * 1024 * 1024 + 1) },
      query: { operationId: nextOperation('declared-too-large') },
    });
    await expectInstallRejected(host, declaredTooLarge, GM.PACKAGE_TOO_LARGE);

    // The application layer also enforces the outer-ZIP ceiling while streaming.
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1);
    oversized.writeUInt32LE(0x04034b50, 0);
    const tooLarge = await installLocalZip(host, oversized, { operationId: 'too-large' });
    assert.equal(tooLarge.payload.ok, false);
    assert.equal(tooLarge.payload.error.code, GM.PACKAGE_TOO_LARGE);
    assert.equal(tooLarge.response.status, httpStatusFor(GM.PACKAGE_TOO_LARGE));
    assert.deepEqual(await host.listDataFiles('staging'), []);
  });

  test('format changes require a new version and html-v1 keeps working (§5.4, A01)', async (t) => {
    const host = await createHostHarness(t, { config: offlineConfig() });

    const html = await installLocalHtml(host, htmlPackage());
    assert.equal(html.response.status, 200, JSON.stringify(html.payload.error));
    assert.equal(html.payload.data.installation.format, 'html-v1');
    assert.equal(html.payload.data.installation.entry, 'entry.html');
    assert.equal(await host.pathExists(`packages/${GAME_ID}/${VERSION}/entry.html`), true);
    const htmlRecord = await readRecord(host);
    assert.equal(htmlRecord.format, 'html-v1');
    assert.equal(htmlRecord.fileManifestDigest, null);
    assert.equal(htmlRecord.fileCount, null);

    // Same id + same version as a ZIP: format policy violation, old install intact.
    const sameVersion = buildPackage(defaultFiles());
    const rejected = await installLocalZip(host, sameVersion.zip, { operationId: 'format-same' });
    assert.equal(rejected.payload.ok, false);
    assert.equal(rejected.payload.error.code, GM.FORMAT_POLICY);
    assert.equal(rejected.response.status, httpStatusFor(GM.FORMAT_POLICY));
    assert.equal(await host.pathExists(`packages/${GAME_ID}/${VERSION}/entry.html`), true);
    assert.equal(await host.pathExists(`packages/${GAME_ID}/${VERSION}/dsh-package.json`), false);
    assert.deepEqual(await host.listDataFiles('staging'), []);
    assert.equal((await readRecord(host)).format, 'html-v1');

    // A new version may switch format (html-v1 1.0.0 -> asset-zip-v2 1.0.1).
    const upgradedZip = buildPackage(
      new Map([
        ['game.json', Buffer.from(JSON.stringify({ ...buildManifest({ id: GAME_ID, name: 'Orbit Courier', version: '1.0.1' }) }, null, 2))],
        ['index.html', Buffer.from('<!doctype html><html><head><link rel="stylesheet" href="styles/game.css"></head><body><div id="app"></div><script src="scripts/main.js"></script></body></html>')],
        ['scripts/main.js', Buffer.from("document.getElementById('app').textContent = 'v101';\n")],
        ['styles/game.css', Buffer.from('body { margin: 0; }\n')],
      ])
    );
    const upgrade = await installLocalZip(host, upgradedZip.zip, { operationId: 'format-upgrade' });
    assert.equal(upgrade.response.status, 200, JSON.stringify(upgrade.payload.error));
    const upgradedRecord = await readRecord(host);
    assert.equal(upgradedRecord.version, '1.0.1');
    assert.equal(upgradedRecord.format, 'asset-zip-v2');
    assert.equal(upgradedRecord.previousVersion, '1.0.0');
    assert.equal(upgradedRecord.previousFormat, 'html-v1');
    // The rollback version is retained and still complete (html-v1 unaffected).
    assert.equal(await host.pathExists(`packages/${GAME_ID}/${VERSION}/entry.html`), true);
    assert.equal(await host.pathExists(`packages/${GAME_ID}/1.0.1/dsh-package.json`), true);

    // A second zip update prunes the html-v1 version (current + 1 window) and the
    // sealed zip tree is removable (unseal-then-trash path).
    const upgraded2 = buildPackage(
      new Map([
        ['game.json', Buffer.from(JSON.stringify({ ...buildManifest({ id: GAME_ID, name: 'Orbit Courier', version: '1.0.2' }) }, null, 2))],
        ['index.html', Buffer.from('<!doctype html><html><head><link rel="stylesheet" href="styles/game.css"></head><body><div id="app"></div><script src="scripts/main.js"></script></body></html>')],
        ['scripts/main.js', Buffer.from("document.getElementById('app').textContent = 'v102';\n")],
        ['styles/game.css', Buffer.from('body { margin: 0; }\n')],
      ])
    );
    const upgrade2 = await installLocalZip(host, upgraded2.zip, { operationId: 'format-upgrade-2' });
    assert.equal(upgrade2.response.status, 200, JSON.stringify(upgrade2.payload.error));
    const finalRecord = await readRecord(host);
    assert.equal(finalRecord.version, '1.0.2');
    assert.equal(finalRecord.previousVersion, '1.0.1');
    assert.equal(finalRecord.previousFormat, 'asset-zip-v2');
    assert.equal(await host.pathExists(`packages/${GAME_ID}/${VERSION}`), false);
    assert.deepEqual(await host.listDataFiles('staging'), []);
  });

  test('startup recovery marks inconsistent asset-zip-v2 records broken without deleting data (§6.5)', async (t) => {
    // Build a healthy installation in an isolated data root first.
    const sourceHost = await createHostHarness(t, { config: offlineConfig() });
    const pkg = buildPackage(defaultFiles());
    const installed = await installLocalZip(sourceHost, pkg.zip, { operationId: 'recovery-source' });
    assert.equal(installed.response.status, 200, JSON.stringify(installed.payload.error));
    const healthyRoot = sourceHost.dataRoot;

    async function bootWith(t, mutate) {
      const host = await createHostHarness(t, {
        config: offlineConfig(),
        prepareDataRoot: async (dataRoot) => {
          await fs.cp(healthyRoot, dataRoot, { recursive: true, preserveTimestamps: true });
          if (mutate) await mutate(dataRoot);
        },
      });
      await host.host.maintenance.ready();
      return host;
    }

    // (a) healthy store: record stays usable.
    const healthy = await bootWith(t, null);
    const healthyRecord = await readRecord(healthy);
    assert.equal(healthyRecord.compatibility.status, 'ok');
    assert.equal(healthyRecord.format, 'asset-zip-v2');

    // (b) descriptor removed: broken, version directory preserved.
    const noDescriptor = await bootWith(t, async (dataRoot) => {
      await fs.rm(path.join(dataRoot, 'packages', GAME_ID, VERSION, 'dsh-package.json'));
    });
    const brokenMissing = await readRecord(noDescriptor);
    assert.equal(brokenMissing.compatibility.status, 'broken');
    assert.ok(brokenMissing.compatibility.reasons.includes('descriptor-missing'));
    assert.equal(
      await noDescriptor.pathExists(`packages/${GAME_ID}/${VERSION}`),
      true,
      'recovery must not delete the version directory'
    );

    // (c) descriptor contents changed: digest mismatch is detected.
    const digestMismatch = await bootWith(t, async (dataRoot) => {
      const descriptorPath = path.join(dataRoot, 'packages', GAME_ID, VERSION, 'dsh-package.json');
      await fs.chmod(descriptorPath, 0o644);
      const descriptor = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));
      descriptor.files[0] = { ...descriptor.files[0], size: descriptor.files[0].size + 1 };
      await fs.writeFile(descriptorPath, JSON.stringify(descriptor, null, 2));
    });
    const brokenDigest = await readRecord(digestMismatch);
    assert.equal(brokenDigest.compatibility.status, 'broken');
    // `verifyInstalledRecord` reports `file-manifest-digest`; the in-maintenance
    // detector that predates it uses `descriptor-digest-mismatch`. Both mean the
    // same §6.5 condition and the reason name is not part of the public contract.
    assert.ok(
      brokenDigest.compatibility.reasons.some((reason) =>
        ['file-manifest-digest', 'descriptor-digest-mismatch'].includes(reason)
      ),
      JSON.stringify(brokenDigest.compatibility.reasons)
    );

    // (d) version directory missing entirely: broken, record kept (not silently dropped).
    const missing = await bootWith(t, async (dataRoot) => {
      await fs.rm(path.join(dataRoot, 'packages', GAME_ID), { recursive: true, force: true });
    });
    const brokenEntry = await readRecord(missing);
    assert.equal(brokenEntry.compatibility.status, 'broken');
    assert.ok(brokenEntry.compatibility.reasons.includes('entry-missing'));

    // (d2) a broken record can be repaired by reinstalling the same package
    //      (§6.5: "Play 禁用并提示重装" means reinstall must actually work).
    const repair = await installLocalZip(digestMismatch, pkg.zip, { operationId: 'repair-broken' });
    assert.equal(repair.response.status, 200, JSON.stringify(repair.payload.error));
    const repaired = await readRecord(digestMismatch);
    assert.equal(repaired.compatibility.status, 'ok');
    assert.equal(repaired.format, 'asset-zip-v2');
    assert.equal(repaired.fileManifestDigest, fileManifestDigest(pkg.descriptor.files, sha256Hex));
    const repairedDescriptor = await digestMismatch.readDataJson('packages', GAME_ID, VERSION, 'dsh-package.json');
    assert.equal(fileManifestDigest(repairedDescriptor.files, sha256Hex), repaired.fileManifestDigest);

    // (e) abandoned staging from a crash is cleaned at startup (§6.5).
    const cleaned = await bootWith(t, async (dataRoot) => {
      await fs.mkdir(path.join(dataRoot, 'staging', 'job_crashed'), { recursive: true });
      await fs.writeFile(path.join(dataRoot, 'staging', 'job_crashed', 'leftover.part'), 'x');
    });
    assert.deepEqual(await cleaned.listDataFiles('staging'), []);
  });

  test('legacy installations.json records are normalized on read and persisted on write (§6.2)', async (t) => {
    const legacyRecord = {
      id: 'legacy-game',
      version: '0.1.0',
      source: 'registry',
      packagePath: 'legacy-game/0.1.0',
      sha256: null,
      sizeBytes: 8,
      previousVersion: null,
      compatibility: { status: 'ok', reasons: [], checkedAt: '2026-10-01T00:00:00.000Z' },
      update: { available: false, latestVersion: '0.1.0', checkedAt: '2026-10-01T00:00:00.000Z', reason: null },
      lastPlayedAt: null,
      playCount: 0,
      totalPlayMinutes: 0,
      installedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      manifest: null,
      iconPath: null,
    };
    const host = await createHostHarness(t, {
      config: offlineConfig(),
      prepareDataRoot: async (dataRoot) => {
        await fs.mkdir(path.join(dataRoot, 'packages', 'legacy-game', '0.1.0'), { recursive: true });
        await fs.writeFile(path.join(dataRoot, 'packages', 'legacy-game', '0.1.0', 'entry.html'), '<html></html>');
        await fs.mkdir(path.join(dataRoot, 'saves', 'legacy-game'), { recursive: true });
        await fs.writeFile(
          path.join(dataRoot, 'installations.json'),
          JSON.stringify({
            schemaVersion: 1,
            updatedAt: '2026-10-01T00:00:00.000Z',
            games: { 'legacy-game': legacyRecord },
          })
        );
      },
    });
    // Read-time normalization: the in-memory record carries the V1.5 defaults
    // without the file being rewritten (no write has happened yet).
    const normalized = await host.host.installations.get('legacy-game');
    assert.equal(normalized.format, 'html-v1');
    assert.equal(normalized.entry, 'entry.html');
    assert.equal(normalized.fileManifestDigest, null);
    assert.equal(normalized.fileCount, null);
    assert.equal(normalized.unpackedBytes, null);
    assert.equal(normalized.previousFormat, null);
    const before = await host.readDataJson('installations.json');
    assert.equal(before.games['legacy-game'].format, undefined);

    // Write-time persistence: the next write persists the normalized fields.
    await host.host.installations.patch('legacy-game', { playCount: 1 });
    const after = await host.readDataJson('installations.json');
    assert.equal(after.games['legacy-game'].format, 'html-v1');
    assert.equal(after.games['legacy-game'].entry, 'entry.html');
    assert.equal(after.games['legacy-game'].fileManifestDigest, null);
    assert.equal(after.games['legacy-game'].previousFormat, null);
    assert.equal(after.games['legacy-game'].playCount, 1);
    assert.equal(after.schemaVersion, 1);
  });

  test('verifyInstalledRecord: html-v1 sha256 and asset-zip-v2 descriptor digests (§6.5)', async (t) => {
    const host = await createHostHarness(t, { config: offlineConfig() });
    const pkg = buildPackage(defaultFiles());
    const installed = await installLocalZip(host, pkg.zip, { operationId: 'verify-source' });
    assert.equal(installed.response.status, 200);

    let record = await readRecord(host);
    const healthy = await verifyInstalledRecord(record, { storage: host.host.storage });
    assert.deepEqual(healthy, { ok: true, reason: null });

    // A record digest mismatch is reported, not thrown.
    const tampered = normalizeInstallationRecord({ ...record, fileManifestDigest: 'f'.repeat(64) });
    const rejected = await verifyInstalledRecord(tampered, { storage: host.host.storage });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, 'file-manifest-digest');

    // Missing descriptor is reported as such.
    await fs.chmod(host.filePath('packages', GAME_ID, VERSION, 'dsh-package.json'), 0o644);
    await fs.rm(host.filePath('packages', GAME_ID, VERSION, 'dsh-package.json'));
    const missing = await verifyInstalledRecord(record, { storage: host.host.storage });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, 'descriptor-missing');

    // html-v1: existence plus the trusted outer sha256 when one is recorded.
    const htmlHost = await createHostHarness(t, { config: offlineConfig() });
    const html = await installLocalHtml(htmlHost, htmlPackage());
    assert.equal(html.response.status, 200);
    let htmlRecord = await readRecord(htmlHost);
    // Local html-v1 installs record `sha256: null` (V1 semantics) -> only existence.
    assert.equal(htmlRecord.sha256, null);
    assert.deepEqual(
      await verifyInstalledRecord(htmlRecord, { storage: htmlHost.host.storage }),
      { ok: true, reason: null }
    );
    // Registry-style records carry an outer digest; corrupting the file is detected.
    htmlRecord = normalizeInstallationRecord({
      ...htmlRecord,
      sha256: sha256Hex(await fs.readFile(htmlHost.filePath('packages', GAME_ID, VERSION, 'entry.html'))),
    });
    assert.deepEqual(
      await verifyInstalledRecord(htmlRecord, { storage: htmlHost.host.storage }),
      { ok: true, reason: null }
    );
    await fs.writeFile(htmlHost.filePath('packages', GAME_ID, VERSION, 'entry.html'), 'tampered');
    const corrupt = await verifyInstalledRecord(htmlRecord, { storage: htmlHost.host.storage });
    assert.equal(corrupt.ok, false);
    assert.equal(corrupt.reason, 'sha256-mismatch');
    void record;
  });

  test('A03 representative rejections also hold in the Host test harness', async (t) => {
    const host = await createHostHarness(t, { config: offlineConfig() });
    const baseEntries = packageEntries(defaultFiles()).entries;

    const cases = [
      ['path traversal', buildZip([...baseEntries, { name: '../evil.js', data: Buffer.from('x') }]), GM.ZIP_PATH_INVALID],
      ['forged CRC', buildZip(baseEntries.map((entry) => (entry.name === 'index.html' ? { ...entry, crc32: 0xdeadbeef } : entry))), GM.ZIP_CRC_MISMATCH],
      ['entry count 513', (() => {
        const files = new Map(defaultFiles());
        for (let index = 0; index < 507; index += 1) files.set(`levels/f${String(index).padStart(4, '0')}.txt`, Buffer.from(`x${index}`));
        return buildPackage(files).zip;
      })(), GM.ZIP_LIMIT],
      ['inline script', buildPackage(defaultFiles({ 'index.html': '<!doctype html><html><head><script>x()</script></head><body></body></html>' })).zip, GM.ASSET_INLINE_FORBIDDEN],
      ['truncated archive', (() => {
        const zip = buildPackage(defaultFiles()).zip;
        return zip.subarray(0, 100);
      })(), GM.ZIP_INVALID],
    ];
    for (const [label, zip, code] of cases) {
      const request = await installLocalZip(host, zip);
      assert.equal(request.payload.ok, false, `${label}: must be rejected`);
      assert.equal(request.payload.error.code, code, `${label}: ${JSON.stringify(request.payload.error)}`);
      assert.equal(request.response.status, httpStatusFor(code), `${label}: HTTP status`);
      assert.deepEqual(await host.listDataFiles('staging'), [], `${label}: staging must be empty`);
      assert.deepEqual(await host.listDataFiles('packages'), [], `${label}: no version directory`);
    }

    // Positive control: the same harness installs a legal package afterwards.
    const control = await installLocalZip(host, buildPackage(defaultFiles()).zip);
    assert.equal(control.response.status, 200, JSON.stringify(control.payload.error));
    assert.equal(control.payload.data.installation.format, 'asset-zip-v2');
  });

  // -------------------------------------------------------------------------
  // CR7-02: retained version directories are reusable for rollback
  // -------------------------------------------------------------------------

  test('CR7-02 rollback: a retained asset-zip-v2 directory is reused, bytes untouched', async (t) => {
    const host = await createHostHarness(t, { config: offlineConfig() });
    const v100 = zipPackageFor('1.0.0');
    const v100Digest = fileManifestDigest(v100.descriptor.files, sha256Hex);

    const first = await installLocalZip(host, v100.zip, { operationId: 'cr7-first' });
    assert.equal(first.response.status, 200, JSON.stringify(first.payload.error));
    const tree100 = await versionTreeHashes(host, '1.0.0');

    // Save data must survive the whole update -> rollback cycle.
    await saveProgress(host, { level: 3, score: 120 });
    const saveBefore = await readProgress(host);
    assert.deepEqual(saveBefore.values, { progress: { level: 3, score: 120 } });

    // Upgrade to 1.1.0 (new version directory, 1.0.0 kept as previous).
    const v110 = zipPackageFor('1.1.0', { scriptContent: "document.body.textContent = 'v110';\n" });
    const upgrade = await installLocalZip(host, v110.zip, { operationId: 'cr7-upgrade' });
    assert.equal(upgrade.response.status, 200, JSON.stringify(upgrade.payload.error));
    const upgradedRecord = await readRecord(host);
    assert.equal(upgradedRecord.version, '1.1.0');
    assert.equal(upgradedRecord.previousVersion, '1.0.0');
    assert.equal(upgradedRecord.previousFormat, 'asset-zip-v2');
    assert.deepEqual(await versionTreeHashes(host, '1.0.0'), tree100, 'upgrade must not touch the retained 1.0.0 tree');

    // Reinstall the ORIGINAL 1.0.0 package: this is the rollback Codex could not do.
    const rollback = await installLocalZip(host, v100.zip, { operationId: 'cr7-rollback' });
    assert.equal(rollback.response.status, 200, JSON.stringify(rollback.payload.error));
    assert.equal(rollback.payload.data.changed, true);
    assert.equal(rollback.payload.data.version, '1.0.0');
    assert.equal(rollback.payload.data.sha256, sha256Hex(v100.zip));

    const rolledBack = await readRecord(host);
    assert.equal(rolledBack.version, '1.0.0');
    assert.equal(rolledBack.format, 'asset-zip-v2');
    assert.equal(rolledBack.previousVersion, '1.1.0', 'rollback must keep the replaced version for the next rollback');
    assert.equal(rolledBack.previousFormat, 'asset-zip-v2');
    assert.equal(rolledBack.sha256, sha256Hex(v100.zip));
    assert.equal(rolledBack.fileManifestDigest, v100Digest);

    // The retained directory is reused as-is: same files, same hashes, both
    // version directories still present (current + 1 previous).
    assert.deepEqual(await versionTreeHashes(host, '1.0.0'), tree100, 'rollback must not rewrite the reused tree');
    assert.equal(await host.pathExists('packages/orbit-courier/1.1.0/dsh-package.json'), true);
    assert.deepEqual(await host.listDataFiles('staging'), []);
    assert.deepEqual((await readProgress(host)).values, saveBefore.values, 'save data must survive the rollback');

    // Repeating the same rollback is an idempotent no-op.
    const again = await installLocalZip(host, v100.zip, { operationId: 'cr7-rollback-again' });
    assert.equal(again.response.status, 200, JSON.stringify(again.payload.error));
    assert.equal(again.payload.data.changed, false);
    assert.equal(again.payload.data.version, '1.0.0');
  });

  test('CR7-02 rollback: tampered retained directory or same-version bytes are still GM-4094', async (t) => {
    // (a) The retained directory itself was tampered with (one byte changed in a
    //     resource that the descriptor's file list still claims the old hash for).
    const host = await createHostHarness(t, { config: offlineConfig() });
    const v100 = zipPackageFor('1.0.0');
    const first = await installLocalZip(host, v100.zip, { operationId: 'cr7t-first' });
    assert.equal(first.response.status, 200, JSON.stringify(first.payload.error));
    const v101 = zipPackageFor('1.0.1', { scriptContent: "document.body.textContent = 'v101';\n" });
    const upgrade = await installLocalZip(host, v101.zip, { operationId: 'cr7t-upgrade' });
    assert.equal(upgrade.response.status, 200, JSON.stringify(upgrade.payload.error));

    const tamperedPath = host.filePath('packages', GAME_ID, '1.0.0', 'scripts/main.js');
    await fs.chmod(tamperedPath, 0o644);
    await fs.appendFile(tamperedPath, '\n// tampered\n');
    const tamperedHash = sha256Hex(await fs.readFile(tamperedPath));

    const tamperedRollback = await installLocalZip(host, v100.zip, { operationId: 'cr7t-tampered' });
    assert.equal(tamperedRollback.payload.ok, false);
    assert.equal(tamperedRollback.payload.error.code, GM.INSTALL_VERSION_CONFLICT);
    assert.equal(tamperedRollback.response.status, httpStatusFor(GM.INSTALL_VERSION_CONFLICT));
    assert.equal(await host.pathExists('packages/orbit-courier/1.0.0'), true, 'a rejected rollback must not delete the retained tree');
    assert.equal(sha256Hex(await fs.readFile(tamperedPath)), tamperedHash, 'a rejected rollback must not rewrite the retained tree');
    assert.equal((await readRecord(host)).version, '1.0.1');
    assert.deepEqual(await host.listDataFiles('staging'), []);

    // (b) Same id+version with different package bytes against a CLEAN retained
    //     directory: must be rejected, clean directory preserved.
    const host2 = await createHostHarness(t, { config: offlineConfig() });
    const cleanRollback = await installLocalZip(host2, v100.zip, { operationId: 'cr7t2-first' });
    assert.equal(cleanRollback.response.status, 200);
    const cleanTree = await versionTreeHashes(host2, '1.0.0');
    const next = zipPackageFor('1.0.1', { scriptContent: "document.body.textContent = 'v101b';\n" });
    const upgrade2 = await installLocalZip(host2, next.zip, { operationId: 'cr7t2-upgrade' });
    assert.equal(upgrade2.response.status, 200, JSON.stringify(upgrade2.payload.error));

    const differentContent = zipPackageFor('1.0.0', { scriptContent: "document.body.textContent = 'not-the-original';\n" });
    const rejected = await installLocalZip(host2, differentContent.zip, { operationId: 'cr7t2-different' });
    assert.equal(rejected.payload.ok, false);
    assert.equal(rejected.payload.error.code, GM.INSTALL_VERSION_CONFLICT);
    assert.equal(rejected.response.status, 409);
    assert.deepEqual(await versionTreeHashes(host2, '1.0.0'), cleanTree, 'rejected same-version install must not touch the directory');
    assert.equal((await readRecord(host2)).version, '1.0.1');
    assert.deepEqual(await host2.listDataFiles('staging'), []);

    // (c) html-v1 same-version different bytes are rejected the same way.
    const host3 = await createHostHarness(t, { config: offlineConfig() });
    const html100 = htmlPackage({ version: '1.0.0' });
    assert.equal((await installLocalHtml(host3, html100)).response.status, 200);
    const html101 = htmlPackage({ version: '1.0.1' });
    assert.equal((await installLocalHtml(host3, html101)).response.status, 200);
    const htmlTree = await versionTreeHashes(host3, '1.0.0');
    const differentHtml = Buffer.from(html100.toString('utf8').replace('<div id="app"></div>', '<div id="app">changed</div>'));
    const htmlRejected = await installLocalHtml(host3, differentHtml);
    assert.equal(htmlRejected.payload.ok, false);
    assert.equal(htmlRejected.payload.error.code, GM.INSTALL_VERSION_CONFLICT);
    assert.equal(htmlRejected.response.status, 409);
    assert.deepEqual(await versionTreeHashes(host3, '1.0.0'), htmlTree);
    assert.equal((await readRecord(host3)).version, '1.0.1');
  });

  test('CR7-02 rollback: local html-v1 with a null record sha256 still rolls back', async (t) => {
    const host = await createHostHarness(t, { config: offlineConfig() });
    const v100 = htmlPackage({ version: '1.0.0' });
    const first = await installLocalHtml(host, v100);
    assert.equal(first.response.status, 200, JSON.stringify(first.payload.error));
    const firstRecord = await readRecord(host);
    assert.equal(firstRecord.format, 'html-v1');
    // Local html-v1 installs keep the V1 non-trust-anchor semantics.
    assert.equal(firstRecord.sha256, null);
    const tree100 = await versionTreeHashes(host, '1.0.0');

    const v101 = htmlPackage({ version: '1.0.1' });
    const upgrade = await installLocalHtml(host, v101);
    assert.equal(upgrade.response.status, 200, JSON.stringify(upgrade.payload.error));
    assert.equal((await readRecord(host)).version, '1.0.1');
    assert.equal((await readRecord(host)).previousVersion, '1.0.0');

    // Reuse decision is made from the bytes on disk vs the bytes in hand, not
    // from the (null) recorded sha256.
    const rollback = await installLocalHtml(host, v100);
    assert.equal(rollback.response.status, 200, JSON.stringify(rollback.payload.error));
    assert.equal(rollback.payload.data.changed, true);
    assert.equal(rollback.payload.data.version, '1.0.0');
    const record = await readRecord(host);
    assert.equal(record.version, '1.0.0');
    assert.equal(record.sha256, null);
    assert.equal(record.previousVersion, '1.0.1');
    assert.equal(record.previousFormat, 'html-v1');
    assert.deepEqual(await versionTreeHashes(host, '1.0.0'), tree100);
    assert.equal(sha256Hex(await fs.readFile(host.filePath('packages', GAME_ID, '1.0.0', 'entry.html'))), sha256Hex(v100));
    assert.deepEqual(await host.listDataFiles('staging'), []);
  });

  // -------------------------------------------------------------------------
  // M2-FIX: uninstall must prune the retained previous ZIP version directory
  // -------------------------------------------------------------------------

  test('M2-FIX uninstall removes current and retained previous ZIP directories', async (t) => {
    const host = await createHostHarness(t, { config: offlineConfig() });
    assert.equal(
      (await installLocalZip(host, zipPackageFor('1.0.0').zip, { operationId: 'unzip-first' })).response.status,
      200
    );
    assert.equal(
      (await installLocalZip(host, zipPackageFor('1.0.1', { scriptContent: "document.body.textContent = '1.0.1';\n" }).zip, { operationId: 'unzip-upgrade' })).response.status,
      200
    );
    const record = await readRecord(host);
    assert.equal(record.version, '1.0.1');
    assert.equal(record.previousVersion, '1.0.0');
    assert.equal(await host.pathExists('packages/orbit-courier/1.0.0/dsh-package.json'), true);
    assert.equal(await host.pathExists('packages/orbit-courier/1.0.1/dsh-package.json'), true);
    await saveProgress(host, { level: 7 });
    const savesBefore = (await readProgress(host)).values;
    const savePath = host.filePath('saves', GAME_ID, 'current.json');
    const saveBytesBefore = await fs.readFile(savePath);
    assert.equal((await versionTreeHashes(host, '1.0.0')).size > 0, true);

    const removed = await host.data(ROUTES.UNINSTALL, {
      body: { gameId: GAME_ID, operationId: nextOperation('unzip-uninstall') },
    });
    assert.deepEqual(removed, { gameId: GAME_ID, removed: true, dataDeleted: false, ignored: false });
    assert.equal(await host.pathExists('packages/orbit-courier'), false, 'all version directories must be pruned');
    assert.equal(await host.pathExists('packages/1.0.0'), false);
    assert.equal(await readRecord(host), null);
    // deleteData:false keeps the save data (existing semantics unchanged). The
    // save API is unavailable once the game is uninstalled, so assert the file.
    assert.equal(await host.pathExists(`saves/${GAME_ID}/current.json`), true);
    assert.deepEqual(await fs.readFile(savePath), saveBytesBefore);
    const saveJson = JSON.parse(await fs.readFile(savePath, 'utf8'));
    assert.deepEqual(saveJson.values, savesBefore);

    const again = await host.data(ROUTES.UNINSTALL, {
      body: { gameId: GAME_ID, operationId: nextOperation('unzip-uninstall-again') },
    });
    assert.equal(again.removed, false);
    assert.equal(again.ignored, true);
  });

  test('M2-FIX deleteData:true uninstall removes both versions and the save data', async (t) => {
    const host = await createHostHarness(t, { config: offlineConfig() });
    assert.equal((await installLocalZip(host, zipPackageFor('1.0.0').zip, { operationId: 'unzip-del-first' })).response.status, 200);
    assert.equal((await installLocalZip(host, zipPackageFor('1.0.1').zip, { operationId: 'unzip-del-upgrade' })).response.status, 200);
    await saveProgress(host, { level: 9 });

    const removed = await host.data(ROUTES.UNINSTALL, {
      body: {
        gameId: GAME_ID,
        deleteData: true,
        confirmDataDeletion: true,
        operationId: nextOperation('unzip-delete'),
      },
    });
    assert.equal(removed.dataDeleted, true);
    assert.equal(await host.pathExists('packages/orbit-courier'), false);
    assert.equal(await host.pathExists(`saves/${GAME_ID}`), false);
    assert.equal(await host.pathExists('saves'), true);
  });

  test('CR7-02 failure: record-write failure keeps reused bytes and cleans only new directories', async (t) => {
    // (a) A brand-new placement whose record write fails must be cleaned up: no
    //     orphan version directory may be left behind.
    const freshHost = await createHostHarness(t, { config: offlineConfig() });
    const store = freshHost.host.installations;
    const originalPut = store.put;
    store.put = async () => {
      throw new Error('injected record-write failure');
    };
    try {
      const failed = await installLocalZip(freshHost, zipPackageFor('1.0.0').zip, { operationId: 'cr7f-new' });
      assert.equal(failed.payload.ok, false);
      assert.equal(failed.response.status, 500);
      assert.equal(await freshHost.pathExists('packages/orbit-courier/1.0.0'), false, 'a failed new install must not leave a version directory');
      assert.deepEqual(await freshHost.listDataFiles('staging'), []);
    } finally {
      store.put = originalPut;
    }

    // (b) A reused rollback directory belongs to an earlier install: a record
    //     write failure must NOT move it to trash (data destruction).
    const host = await createHostHarness(t, { config: offlineConfig() });
    const v100 = zipPackageFor('1.0.0');
    assert.equal((await installLocalZip(host, v100.zip)).response.status, 200);
    const tree100 = await versionTreeHashes(host, '1.0.0');
    const v101 = zipPackageFor('1.0.1', { scriptContent: "document.body.textContent = 'v101';\n" });
    assert.equal((await installLocalZip(host, v101.zip)).response.status, 200);
    const recordBefore = await readRecord(host);
    assert.equal(recordBefore.version, '1.0.1');

    const reuseStore = host.host.installations;
    const originalReusePut = reuseStore.put;
    reuseStore.put = async () => {
      throw new Error('injected record-write failure');
    };
    try {
      const failedRollback = await installLocalZip(host, v100.zip, { operationId: 'cr7f-reuse' });
      assert.equal(failedRollback.payload.ok, false);
      assert.equal(failedRollback.response.status, 500);
      assert.equal(await host.pathExists('packages/orbit-courier/1.0.0'), true, 'reused rollback directory must survive a record-write failure');
      assert.deepEqual(await versionTreeHashes(host, '1.0.0'), tree100, 'reused directory bytes must be untouched');
      const recordAfter = await readRecord(host);
      assert.equal(recordAfter.version, '1.0.1');
      assert.equal(recordAfter.previousVersion, '1.0.0');
      assert.deepEqual(await host.listDataFiles('staging'), []);
    } finally {
      reuseStore.put = originalReusePut;
    }
  });
}
