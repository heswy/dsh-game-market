import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  BUILD_IDENTITY_TOKEN,
  CLIENT_BUILD,
  isBuildCommit,
  isBuildVersion,
  normalizeBuildIdentity,
  parseBuildIdentity,
  parseReleaseIdentity,
  serializeBuildIdentity,
} from '../src/build-identity.js';
import { createPageIdentity, createToken, isPageToken } from '../src/page-identity.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const buildScript = path.join(root, 'scripts', 'build-client.mjs');
const COMMIT = 'd'.repeat(40);

function fakeCrypto(bytes) {
  return {
    getRandomValues: function fill(target) {
      for (let i = 0; i < target.length; i += 1) target[i] = (bytes + i) % 256;
      return target;
    },
  };
}

function fakeStorage() {
  const map = new Map();
  return {
    getItem: function get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem: function set(key, value) {
      map.set(key, String(value));
    },
    size: function size() {
      return map.size;
    },
  };
}

function readPackageVersion() {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
}

function readTreeReleaseCommit() {
  const releasePath = path.join(root, 'platform-updates', 'release.json');
  if (!fs.existsSync(releasePath)) return null;
  const document = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
  return typeof document.clientBuildCommit === 'string' ? document.clientBuildCommit : null;
}

function runBuild(args) {
  return spawnSync(process.execPath, [buildScript, ...args], { cwd: root, encoding: 'utf8' });
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dgm-client-build-'));
}

test('build identity helpers validate semver and full commits only', function () {
  assert.equal(isBuildVersion('1.2.0'), true);
  assert.equal(isBuildVersion('1.3.0-rc.1'), true);
  assert.equal(isBuildVersion('1.2'), false);
  assert.equal(isBuildVersion(null), false);
  assert.equal(isBuildCommit(COMMIT), true);
  assert.equal(isBuildCommit('abc'), false);
  assert.equal(isBuildCommit('D'.repeat(40)), false);
  assert.deepEqual(normalizeBuildIdentity({ version: '1.2.0', buildCommit: COMMIT }), {
    version: '1.2.0',
    buildCommit: COMMIT,
    embedded: true,
  });
  assert.deepEqual(normalizeBuildIdentity({ version: 'nope', buildCommit: 'x' }), {
    version: null,
    buildCommit: null,
    embedded: false,
  });
});

test('the unbundled source parses as "not embedded" instead of claiming a version', function () {
  assert.equal(CLIENT_BUILD.embedded, false);
  assert.equal(CLIENT_BUILD.version, null);
  assert.equal(CLIENT_BUILD.buildCommit, null);
  assert.equal(parseBuildIdentity(BUILD_IDENTITY_TOKEN).embedded, false);
  assert.equal(parseBuildIdentity('{"version":"1.2.0","buildCommit":null}').version, '1.2.0');
  assert.equal(parseBuildIdentity('not json').embedded, false);
  assert.equal(serializeBuildIdentity('1.2.0', COMMIT), '{"version":"1.2.0","buildCommit":"' + COMMIT + '"}');
  assert.throws(function serializeInvalid() {
    serializeBuildIdentity('nope', null);
  });
});

test('release.json validation is strict (schema/version/commit)', function () {
  assert.deepEqual(parseReleaseIdentity({ schemaVersion: 1, version: '1.3.0', clientBuildCommit: COMMIT }), {
    ok: true,
    version: '1.3.0',
    clientBuildCommit: COMMIT,
  });
  assert.equal(parseReleaseIdentity({ schemaVersion: 1, version: '1.3.0', clientBuildCommit: null }).ok, true);
  assert.equal(parseReleaseIdentity({ schemaVersion: 2, version: '1.3.0' }).ok, false);
  assert.equal(parseReleaseIdentity({ schemaVersion: 1, version: 'x' }).ok, false);
  assert.equal(parseReleaseIdentity({ schemaVersion: 1, version: '1.3.0', clientBuildCommit: 'abc' }).ok, false);
  assert.equal(parseReleaseIdentity(null).ok, false);
});

test('page identity issues 32-hex tokens and keeps windowId across a reload', function () {
  const storage = fakeStorage();
  const first = createPageIdentity({ storage: storage, crypto: fakeCrypto(1), now: function now() {
    return Date.parse('2026-10-20T12:00:00.000Z');
  } });
  assert.equal(isPageToken(first.windowId), true);
  assert.equal(isPageToken(first.clientId), true);
  assert.equal(isPageToken(first.pageToken), true);
  assert.equal(first.startedAt, '2026-10-20T12:00:00.000Z');
  const second = createPageIdentity({ storage: storage, crypto: fakeCrypto(2), now: Date.now });
  assert.equal(second.windowId, first.windowId, 'windowId survives a reload in the same tab');
  assert.notEqual(second.clientId, first.clientId, 'clientId is per page load');
  assert.notEqual(second.pageToken, first.pageToken, 'pageToken is per page load');
  const freshTab = createPageIdentity({ storage: fakeStorage(), crypto: fakeCrypto(3) });
  assert.notEqual(freshTab.windowId, first.windowId);
});

test('page identity degrades safely without storage or crypto', function () {
  const identity = createPageIdentity({ storage: null, crypto: null, now: Date.now });
  assert.equal(isPageToken(identity.windowId), true);
  assert.equal(isPageToken(identity.clientId), true);
  assert.equal(createToken(null, 4).length, 8);
  assert.equal(isPageToken('nope'), false);
});

test('build-client embeds the identity from a release.json and stays byte deterministic', function () {
  const dir = tempDir();
  try {
    const releasePath = path.join(dir, 'release.json');
    fs.writeFileSync(
      releasePath,
      JSON.stringify({ schemaVersion: 1, version: readPackageVersion(), repo: 'heswy/dsh-game-market', clientBuildCommit: COMMIT }),
      'utf8'
    );
    const outOne = path.join(dir, 'one.js');
    const outTwo = path.join(dir, 'two.js');
    const first = runBuild(['--release', releasePath, '--out', outOne]);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const second = runBuild(['--release', releasePath, '--out', outTwo]);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    const bytesOne = fs.readFileSync(outOne);
    const bytesTwo = fs.readFileSync(outTwo);
    assert.equal(bytesOne.length > 0, true);
    assert.equal(Buffer.compare(bytesOne, bytesTwo), 0, 'two builds of the same tree are byte-identical');
    const code = bytesOne.toString('utf8');
    assert.ok(
      code.includes('// release-identity: version=' + readPackageVersion() + ' buildCommit=' + COMMIT),
      'banner line names the release identity'
    );
    assert.ok(code.includes('const RAW_IDENTITY = "{\\"version\\":\\"' + readPackageVersion() + '\\",\\"buildCommit\\":\\"' + COMMIT + '\\"}";'));
    assert.ok(code.includes('window.__ModuleLoader__.load'));
    assert.ok(code.includes('id: "dsh-game-market"'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a stale release.json (previous version) warns but embeds no buildCommit', function () {
  const dir = tempDir();
  try {
    const releasePath = path.join(dir, 'release.json');
    fs.writeFileSync(
      releasePath,
      JSON.stringify({ schemaVersion: 1, version: '0.0.1', repo: 'heswy/dsh-game-market', clientBuildCommit: COMMIT }),
      'utf8'
    );
    const outFile = path.join(dir, 'out.js');
    const result = runBuild(['--release', releasePath, '--out', outFile]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok((result.stderr || '').includes('stale'), 'warns about the stale release identity');
    const code = fs.readFileSync(outFile, 'utf8');
    assert.ok(code.includes('// release-identity: version=' + readPackageVersion() + ' buildCommit=none'));
    const rawAssignment = /const RAW_IDENTITY = (.*);/.exec(code);
    assert.ok(rawAssignment[1].includes('buildCommit'));
    assert.equal(rawAssignment[1].includes(COMMIT), false, 'old release commit is not embedded');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-client fails loudly on an unreadable/invalid release.json', function () {
  const dir = tempDir();
  try {
    const releasePath = path.join(dir, 'release.json');
    fs.writeFileSync(releasePath, '{not json', 'utf8');
    const badJson = runBuild(['--release', releasePath, '--out', path.join(dir, 'bad.js')]);
    assert.notEqual(badJson.status, 0);
    assert.ok((badJson.stderr || '').includes('E_RELEASE_CLIENT_IDENTITY_INVALID'));
    fs.writeFileSync(
      releasePath,
      JSON.stringify({ schemaVersion: 1, version: readPackageVersion(), clientBuildCommit: 'short-sha' }),
      'utf8'
    );
    const badCommit = runBuild(['--release', releasePath, '--out', path.join(dir, 'bad2.js')]);
    assert.notEqual(badCommit.status, 0);
    assert.ok((badCommit.stderr || '').includes('E_RELEASE_CLIENT_IDENTITY_INVALID'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('default build embeds the identity of the current tree (or null without release.json)', function () {
  const dir = tempDir();
  try {
    const outFile = path.join(dir, 'client.js');
    const result = runBuild(['--out', outFile]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const code = fs.readFileSync(outFile, 'utf8');
    const expectedCommit = readTreeReleaseCommit();
    const expected = '// release-identity: version=' + readPackageVersion() + ' buildCommit=' + (expectedCommit === null ? 'none' : expectedCommit);
    assert.ok(code.includes(expected), 'expected banner: ' + expected);
    assert.ok(code.includes('const RAW_IDENTITY = '));
    const rawAssignment = /const RAW_IDENTITY = (.*);/.exec(code);
    assert.ok(rawAssignment, 'identity literal is embedded');
    assert.equal(rawAssignment[1].includes(BUILD_IDENTITY_TOKEN), false, 'placeholder was replaced');
    assert.ok(rawAssignment[1].includes('buildCommit'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
