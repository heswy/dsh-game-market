import test from 'node:test';
import assert from 'node:assert/strict';
import { channelLabel, describeDiscovery, platformUpdateDialogCopy, shortCommit } from '../src/update-copy.js';
import { deriveUpdateView, normalizeInspection } from '../src/update-state.js';
import { makeT } from '../src/locale.js';

const COMMIT_TARGET = 'b'.repeat(40);
const COMMIT_RUNNING = 'a'.repeat(40);
const zh = makeT(null, 'zh');
const en = makeT(null, 'en');

function dialogFixture(overrides) {
  return {
    kind: 'platform-update',
    targetId: 'tgt_1',
    targetVersion: '1.3.0',
    targetCommit: COMMIT_TARGET,
    currentVersion: '1.2.0',
    channel: 'stable',
    restartPossible: false,
    ...(overrides || {}),
  };
}

for (const [locale, t] of [
  ['zh', zh],
  ['en', en],
]) {
  test(locale + ' confirmation copy states all-sessions/restart and exact version+commit', function () {
    const copy = platformUpdateDialogCopy(dialogFixture(), t);
    assert.ok(copy.title.includes('1.3.0'), 'target version in title');
    assert.ok(copy.body.length > 0);
    const warnings = copy.warnings.join(' | ');
    assert.ok(/所有会话|all sessions/i.test(warnings), 'states it affects all sessions');
    assert.ok(/重启|restart/i.test(warnings), 'states a restart may be required');
    const commitRow = copy.meta.find(function find(row) {
      return row.value === COMMIT_TARGET;
    });
    assert.ok(commitRow, 'shows the full 40-hex target commit');
    assert.equal(commitRow.mono, true);
    assert.equal(commitRow.value.length, 40);
    assert.ok(
      copy.meta.some(function current(row) {
        return row.value === '1.2.0';
      }),
      'shows the current running version'
    );
    assert.ok(copy.primary.length > 0);
    assert.ok(copy.busyLabel.length > 0);
  });
}

test('confirmation copy adds the no-HMR restart note only when applicable', function () {
  const withoutNote = platformUpdateDialogCopy(dialogFixture({ restartPossible: false }), zh);
  assert.equal(withoutNote.warnings.length, 2);
  const withNote = platformUpdateDialogCopy(dialogFixture({ restartPossible: true }), zh);
  assert.equal(withNote.warnings.length, 3);
  assert.ok(/重启/.test(withNote.warnings[2]));
});

test('confirmation copy never invents a target version or commit', function () {
  const copy = platformUpdateDialogCopy(dialogFixture({ targetVersion: null, targetCommit: null, channel: null }), en);
  assert.ok(copy.title.length > 0);
  const commitRow = copy.meta.find(function find(row) {
    return row.mono === false && row.label === en('update.confirm.targetCommit');
  });
  assert.equal(commitRow.value, en('update.identity.commitMissing'));
  assert.equal(copy.meta.some(function channel(row) {
    return row.label === en('update.confirm.channel');
  }), false);
});

test('channel labels are localized and unknown channels stay verbatim', function () {
  assert.equal(channelLabel('stable', zh), zh('update.channel.stable'));
  assert.equal(channelLabel('test', en), en('update.channel.test'));
  assert.equal(channelLabel('nightly', en), 'nightly');
  assert.equal(channelLabel(null, en), en('update.channel.unknown'));
});

test('shortCommit keeps the full value for titles/data attributes', function () {
  assert.equal(shortCommit(COMMIT_TARGET), COMMIT_TARGET.slice(0, 12));
  assert.equal(shortCommit('abc'), 'abc');
  assert.equal(shortCommit(null), null);
});

function inspectionFixture(overrides) {
  const base = {
    schemaVersion: 1,
    host: { version: '1.2.0', commit: COMMIT_RUNNING, hostEpoch: 'epoch-1', loadedAt: null },
    installed: {
      bundleId: 'dsh-game-market',
      spec: 'github:heswy/dsh-game-market#' + COMMIT_RUNNING,
      specShape: 'git-url',
      version: '1.2.0',
      enabled: true,
      loadedVersion: '1.2.0',
      loadedCommit: COMMIT_RUNNING,
      devRowShadow: false,
    },
    target: { id: 'tgt_1', version: '1.3.0', commit: COMMIT_TARGET, channel: 'stable', publishedAt: null, spec: null },
    discovery: {
      channel: 'stable',
      indexUrl: 'https://example.invalid/plugins.json',
      state: 'ready',
      fetchedAt: '2026-10-20T09:59:00.000Z',
      checkedAt: '2026-10-20T09:59:00.000Z',
      nextCheckAt: null,
      lastError: null,
      canRefresh: true,
      anomaly: null,
    },
    capability: { hmr: 'present', updatePath: 'in-place-hmr', canBeginUpdate: true, reasonKey: null },
    operation: null,
  };
  return {
    ...base,
    ...(overrides || {}),
    host: { ...base.host, ...((overrides || {}).host || {}) },
    installed: { ...base.installed, ...((overrides || {}).installed || {}) },
    discovery: { ...base.discovery, ...((overrides || {}).discovery || {}) },
    capability: { ...base.capability, ...((overrides || {}).capability || {}) },
    target: Object.prototype.hasOwnProperty.call(overrides || {}, 'target') ? overrides.target : base.target,
    operation: (overrides || {}).operation !== undefined ? overrides.operation : base.operation,
  };
}

function viewFor(overrides, slice) {
  const inspection = normalizeInspection(inspectionFixture(overrides));
  return deriveUpdateView({
    status: 'ready',
    inspection: inspection,
    clientIdentity: { version: '1.2.0', buildCommit: COMMIT_RUNNING },
    now: Date.parse('2026-10-20T10:00:00.000Z'),
    ...(slice || {}),
  });
}

test('discovery copy maps update-available / up-to-date / no-target / unknown', function () {
  const available = describeDiscovery(viewFor({}), zh, 'zh', Date.parse('2026-10-20T10:00:00.000Z'));
  assert.equal(available.key, 'update.discovery.available');
  assert.deepEqual(available.params, { fromVersion: '1.2.0', toVersion: '1.3.0' });
  assert.equal(available.tone, 'info');

  const current = describeDiscovery(
    viewFor({ target: { id: 't', version: '1.2.0', commit: COMMIT_RUNNING, channel: 'stable', publishedAt: null, spec: null } }),
    en,
    'en',
    Date.parse('2026-10-20T10:00:00.000Z')
  );
  assert.equal(current.key, 'update.discovery.ready');
  assert.equal(current.tone, 'positive');

  const noTarget = describeDiscovery(viewFor({ target: null }), en, 'en', 0);
  assert.equal(noTarget.key, 'update.discovery.noTarget');

  const unknown = describeDiscovery(
    viewFor({ target: { id: 't', version: '1.2.0', commit: COMMIT_TARGET, channel: 'stable', publishedAt: null, spec: null } }),
    en,
    'en',
    0
  );
  assert.equal(unknown.key, 'update.discovery.unknown');
});

test('offline/stale/invalid discovery never claims up to date and keeps last success', function () {
  const now = Date.parse('2026-10-20T10:00:00.000Z');
  const offline = describeDiscovery(
    viewFor({
      discovery: {
        state: 'offline',
        fetchedAt: '2026-10-19T00:00:00.000Z',
        lastError: { code: 'GM-5039', message: 'offline', retryable: true, at: '2026-10-20T09:59:00.000Z' },
      },
    }),
    en,
    'en',
    now
  );
  assert.equal(offline.key, 'update.discovery.offline');
  assert.equal(offline.tone, 'warn');
  assert.match(offline.meta, /success/i);

  assert.equal(describeDiscovery(viewFor({ discovery: { state: 'stale' } }), en, 'en', now).key, 'update.discovery.stale');
  assert.equal(describeDiscovery(viewFor({ discovery: { state: 'invalid' } }), en, 'en', now).key, 'update.discovery.invalid');
});

test('never-checked discovery is explicit instead of pretending up to date', function () {
  const view = viewFor({ target: null, discovery: { state: 'never', fetchedAt: null, checkedAt: null } });
  assert.equal(describeDiscovery(view, en, 'en', 0).key, 'update.discovery.never');
});

test('missing inspection with an error maps to an actionable error copy', function () {
  const view = deriveUpdateView({ status: 'error', error: { code: 'GM-5039' } });
  const description = describeDiscovery(view, en, 'en', 0);
  assert.equal(description.key, 'update.error.indexUnavailable');
  assert.equal(description.tone, 'warn');
});
