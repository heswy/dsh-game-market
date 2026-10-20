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
}
