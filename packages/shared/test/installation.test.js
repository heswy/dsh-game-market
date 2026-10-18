/**
 * V1 installation layout/model tests (PRD §8.6/§8.7, M0).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPAT_STATUSES,
  ENTRY_FILE,
  INSTALLATIONS_FILE,
  INSTALL_SOURCES,
  KEPT_PREVIOUS_VERSIONS,
  entryStoragePath,
  installationPackagePath,
  packageStoragePath,
  savesPath,
  scoreRecordPath,
  sessionRecordPath,
  stagingPath,
  trashPath,
  validateInstallationsFile,
  versionsToPrune,
} from '../src/installation.js';

const SHA = 'b'.repeat(64);

function installation(overrides = {}) {
  return {
    id: 'block-drop',
    version: '1.2.0',
    installedAt: '2026-10-17T11:02:10.000Z',
    updatedAt: '2026-10-18T08:12:31.402Z',
    source: 'registry',
    packagePath: 'block-drop/1.2.0',
    sha256: SHA,
    sizeBytes: 921004,
    previousVersion: '1.1.3',
    manifest: {
      name: 'Block Drop',
      authorName: 'Orange',
      description: '把下落的方块叠成完整横行。',
      categories: ['puzzle'],
      capabilities: ['storage', 'score'],
      icon: null,
      cover: null,
      viewport: { width: 960, height: 540, fit: 'contain' },
    },
    lastPlayedAt: null,
    playCount: 0,
    totalPlayMinutes: 0,
    compatibility: { status: 'ok', reason: null, checkedAt: '2026-10-18T08:12:31.402Z' },
    update: { available: false, version: null, checkedAt: '2026-10-18T08:12:31.402Z' },
    ...overrides,
  };
}

function installationsFile(games = { 'block-drop': installation() }) {
  return {
    schemaVersion: 1,
    updatedAt: '2026-10-18T08:12:31.402Z',
    games,
  };
}

test('storage layout uses packages/<id>/<version>/entry.html', () => {
  assert.equal(ENTRY_FILE, 'entry.html');
  assert.equal(installationPackagePath('block-drop', '1.2.0'), 'block-drop/1.2.0');
  assert.equal(packageStoragePath('block-drop', '1.2.0'), 'packages/block-drop/1.2.0');
  assert.equal(entryStoragePath('block-drop', '1.2.0'), 'packages/block-drop/1.2.0/entry.html');
  assert.equal(savesPath('block-drop'), 'saves/block-drop');
  assert.equal(sessionRecordPath('block-drop'), 'sessions/block-drop.json');
  assert.equal(scoreRecordPath('block-drop'), 'scores/block-drop.json');
  assert.equal(stagingPath('job_1'), 'staging/job_1');
  assert.equal(trashPath('block-drop', 123), 'trash/block-drop-123');
  assert.equal(INSTALLATIONS_FILE, 'installations.json');
  assert.deepEqual([...INSTALL_SOURCES], ['registry', 'local', 'dev', 'builtin']);
  assert.deepEqual([...COMPAT_STATUSES], ['ok', 'incompatible', 'broken']);
});

test('accepts a valid installations.json', () => {
  assert.deepEqual(validateInstallationsFile(installationsFile()), { ok: true, errors: [] });
  const dev = installation({ source: 'dev', sha256: null, previousVersion: null });
  assert.equal(validateInstallationsFile(installationsFile({ 'block-drop': dev })).ok, true);
});

test('rejects inconsistent installation records', () => {
  const wrongId = validateInstallationsFile(installationsFile({ 'block-drop': installation({ id: 'other' }) }));
  assert.equal(wrongId.ok, false);

  const wrongPath = validateInstallationsFile(
    installationsFile({ 'block-drop': installation({ packagePath: 'installed/block-drop/1.2.0' }) }),
  );
  assert.equal(wrongPath.ok, false);

  const badSource = validateInstallationsFile(
    installationsFile({ 'block-drop': installation({ source: 'zip' }) }),
  );
  assert.equal(badSource.ok, false);

  const badSha = validateInstallationsFile(
    installationsFile({ 'block-drop': installation({ sha256: 'xyz' }) }),
  );
  assert.equal(badSha.ok, false);

  const badSchema = validateInstallationsFile({ ...installationsFile(), schemaVersion: 2 });
  assert.equal(badSchema.ok, false);
  assert.ok(badSchema.errors.some((error) => error.code === 'E_STORE_SCHEMA_NEWER'));
});

test('rollback window keeps current + 1 previous version', () => {
  assert.equal(KEPT_PREVIOUS_VERSIONS, 1);
  const versions = ['1.3.0', '1.2.0', '1.1.3', '1.0.0'];
  assert.deepEqual(versionsToPrune(versions, '1.3.0'), ['1.1.3', '1.0.0']);
  assert.deepEqual(versionsToPrune(['1.2.0', '1.1.3'], '1.2.0'), []);
  assert.deepEqual(versionsToPrune(['1.2.0'], '1.2.0'), []);
});
