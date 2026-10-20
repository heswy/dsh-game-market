/**
 * M3-R1: maintainer release tooling (`release:prepare` / `release:promote` /
 * `release:verify`) tested against real local git repositories.
 *
 * Falsifiability: every rejection test first builds a valid fixture release and
 * then mutates exactly one property, so a "rejected" assertion cannot pass
 * because the happy path never worked. All git operations are local and
 * temporary; the suite asserts from a PATH git shim that no push/tag/fetch is
 * ever executed and that dry-runs write nothing.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  INDEX_PATH,
  RELEASE_IDENTITY_PATH,
} from '../scripts/release/lib/constants.mjs';
import {
  buildPluginIndex,
  collectIndexCommits,
  installTargetFor,
  serializePluginIndex,
  validatePluginIndex,
} from '../scripts/release/lib/index-format.mjs';
import { validateReleaseIdentity } from '../scripts/release/lib/release-identity.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_URL = 'https://github.com/heswy/dsh-game-market';
const STABLE_VERSION = '1.3.0';
const PRERELEASE_VERSION = '1.3.0-rc.1';

const FIXTURE_BUILD = `#!/usr/bin/env node
/**
 * Deterministic fixture build for the release-tool tests. It mirrors the real
 * contract: client.js embeds package.json.version + release.json.clientBuildCommit
 * (literal "none" before a release identity exists), and every artifact is
 * generated from inputs only (never timestamps/absolute paths).
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
let identity = null;
try {
  identity = JSON.parse(fs.readFileSync(path.join(root, 'platform-updates/release.json'), 'utf8'));
} catch {
  identity = null;
}
if (process.env.FIXTURE_BUILD_FAIL === '1') {
  console.error('[fixture] requested build failure');
  process.exit(1);
}
const stamp = process.env.FIXTURE_NONDETERMINISTIC === '1' ? String(Date.now()) : 'deterministic';
const version = pkg.version;
// Mirror the agreed build-client rule: a release identity is only usable when
// it belongs to the current package version; an inherited stale release.json
// from a previous release is ignored (buildCommit=null), never hard-fails.
const identityUsable = identity !== null
  && identity.version === version
  && typeof identity.clientBuildCommit === 'string';
const buildCommit = identityUsable ? identity.clientBuildCommit : 'none';

fs.mkdirSync(path.join(root, 'games/jump/dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'games/jump/dist/index.html'), '<html data-stamp="' + stamp + '">jump ' + version + '</html>\\n');
fs.mkdirSync(path.join(root, 'registry/packages'), { recursive: true });
fs.mkdirSync(path.join(root, 'registry/v2'), { recursive: true });
fs.writeFileSync(path.join(root, 'registry/games.json'), JSON.stringify({
  registryVersion: 1,
  generatedAt: '1970-01-01T00:00:00.000Z',
  games: [{ id: 'jump', version: '1.0.0', package: { url: 'packages/jump-1.0.0.html', sha256: '0'.repeat(64), size: 1 } }],
}, null, 2) + '\\n');
fs.writeFileSync(path.join(root, 'registry/v2/games.json'), JSON.stringify({
  registryVersion: 2,
  generatedAt: '1970-01-01T00:00:00.000Z',
  games: [],
}, null, 2) + '\\n');
fs.writeFileSync(path.join(root, 'registry/packages/jump-1.0.0.html'), '<html>jump</html>\\n');
const banner = process.env.FIXTURE_NO_IDENTITY === '1'
  ? ''
  : '// release-identity: version=' + version + ' buildCommit=' + buildCommit + '\\n';
if (process.env.FIXTURE_SKIP_CLIENT !== '1') {
  fs.writeFileSync(path.join(root, 'client.js'), banner + 'window.__ModuleLoader__.load({ id: "dsh-game-market", factory: function () { return {}; } });\\n');
}
`;

function git(dir, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com', ...options.env },
    ...options.spawn,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function fixturePackageJson({ version = STABLE_VERSION, engines = { node: '>=20', dsh: '>=0.2.0 <0.3.0' }, files } = {}) {  return {
    name: 'dsh-game-market',
    version,
    private: true,
    type: 'module',
    main: 'index.js',
    exports: { '.': './index.js', './client': './client.js', './package.json': './package.json' },
    files: files === undefined
      ? ['index.js', 'client.js', 'cordis.patch.yml', 'games/**', 'registry/**', 'platform-updates/release.json', 'scripts/release/**']
      : files,
    engines,
    scripts: {
      build: 'node scripts/build.mjs',
      verify: 'node scripts/build.mjs && node scripts/check.mjs && node --test',
    },
    dsh: {
      manifestVersion: 1,
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web', immediately: true, inject: [] },
    },
  };
}

/**
 * Create a real local git fixture repository with a clean version commit P.
 * `scripts/release/**` is copied from the real repository so the CLIs under
 * test are the production entry points (root resolves to the fixture).
 */
function makeFixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-release-fixture-'));
  const pkg = fixturePackageJson(options);
  const write = (relative, content) => {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  write('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  write('index.js', 'export default {};\n');
  write('cordis.patch.yml', "- insert:\n    - id: dsh-game-market\n");
  if (options.withClient !== false) write('client.js', '// placeholder client bundle\n');
  write('games/jump/game.json', `${JSON.stringify({ id: 'jump', version: '1.0.0', name: 'Jump' }, null, 2)}\n`);
  write('scripts/build.mjs', FIXTURE_BUILD);
  fs.cpSync(path.join(REPO_ROOT, 'scripts/release'), path.join(dir, 'scripts/release'), { recursive: true });

  git(dir, ['init', '-q']);
  git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(dir, ['config', 'user.name', 'Fixture']);
  git(dir, ['config', 'user.email', 'fixture@example.com']);
  if (options.remote !== null) {
    git(dir, ['remote', 'add', 'origin', options.remote || 'https://github.com/heswy/dsh-game-market.git']);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', `chore: version ${pkg.version}`]);
  const p = git(dir, ['rev-parse', 'HEAD']);
  return {
    dir,
    p,
    pkg,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function runTool(fixture, script, args, options = {}) {
  const entry = path.join(fixture.dir, 'scripts/release', script);
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: fixture.dir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...(options.env || {}) },
    timeout: 120_000,
  });
  let stdoutJson = null;
  let stderrJson = null;
  try {
    stdoutJson = JSON.parse(result.stdout);
  } catch {
    stdoutJson = null;
  }
  try {
    stderrJson = JSON.parse(result.stderr);
  } catch {
    stderrJson = null;
  }
  return { ...result, stdoutJson, stderrJson };
}

function prepare(fixture, args = [], options = {}) {
  return runTool(fixture, 'prepare.mjs', ['--json', ...args], options);
}

function promote(fixture, args = [], options = {}) {
  return runTool(fixture, 'promote.mjs', ['--json', ...args], options);
}

function writeRelease(fixture) {
  const result = prepare(fixture, ['--version', fixture.pkg.version, '--write']);
  assert.equal(result.status, 0, `prepare --write failed: ${result.stderr}`);
  assert.ok(result.stdoutJson && result.stdoutJson.commit, 'prepare --write must print the release commit R');
  return result.stdoutJson;
}

function commitEpoch(dir, ref) {
  return Number.parseInt(git(dir, ['show', '-s', '--format=%ct', ref]), 10);
}

function validationOf(identity) {
  return validateReleaseIdentity(identity, { requireArtifacts: true });
}

function head(dir) {
  return git(dir, ['rev-parse', 'HEAD']);
}

function status(dir) {
  return git(dir, ['status', '--porcelain', '--untracked-files=all']);
}

function readAt(dir, ref, file) {
  const result = spawnSync('git', ['cat-file', 'blob', `${ref}:${file}`], { cwd: dir, encoding: null });
  return result.status === 0 ? result.stdout : null;
}

// ---------------------------------------------------------------------------
// prepare: dry-run and fail-closed input validation
// ---------------------------------------------------------------------------

test('prepare dry-run validates everything and writes nothing', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const beforeHead = head(fixture.dir);
  const result = prepare(fixture, ['--version', STABLE_VERSION]);
  assert.equal(result.status, 0, result.stderr);
  const json = result.stdoutJson;
  assert.equal(json.mode, 'dry-run');
  assert.equal(json.commit, null);
  assert.equal(json.version, STABLE_VERSION);
  assert.equal(json.repo, REPO_URL);
  assert.equal(json.clientBuildCommit, fixture.p);
  assert.equal(json.deterministic, true);
  assert.ok(json.builds >= 2, 'dry-run must build in at least two isolated copies');
  assert.equal(json.artifacts.algorithm, 'sha256-tree-v1');
  assert.match(json.artifacts.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(json.commitMessage, `chore(release): v${STABLE_VERSION} build ${fixture.p}`);
  assert.equal(json.identity.clientBuildCommit, fixture.p);
  assert.equal(json.identity.repo, REPO_URL);

  // zero writes and no git mutation
  assert.equal(head(fixture.dir), beforeHead);
  assert.equal(status(fixture.dir), '');
  assert.equal(fs.existsSync(path.join(fixture.dir, RELEASE_IDENTITY_PATH)), false);
  assert.equal(fs.readFileSync(path.join(fixture.dir, 'client.js'), 'utf8').includes('release-identity:'), false);
});

test('prepare human dry-run output states it writes nothing', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const result = runTool(fixture, 'prepare.mjs', ['--version', STABLE_VERSION]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DRY RUN/u);
  assert.match(result.stdout, /version commit P/u);
  assert.equal(status(fixture.dir), '');
});

test('prepare rejects a dirty worktree', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  fs.writeFileSync(path.join(fixture.dir, 'uncommitted.txt'), 'dirty\n');
  const result = prepare(fixture);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_DIRTY');
  assert.equal(fs.existsSync(path.join(fixture.dir, RELEASE_IDENTITY_PATH)), false);
});

test('prepare refuses to bump the version itself (P must be pre-bumped)', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const result = prepare(fixture, ['--version', '1.4.0']);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_VERSION_MISMATCH');
  assert.match(result.stderrJson.guidance, /version commit P/u);
  assert.equal(status(fixture.dir), '');
});

test('prepare rejects a non-official origin remote', (t) => {
  const fixture = makeFixture({ remote: 'https://github.com/someone-else/dsh-game-market.git' });
  t.after(() => fixture.cleanup());
  const result = prepare(fixture);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_REPO_MISMATCH');
});

test('prepare rejects an invalid engines declaration', (t) => {
  const fixture = makeFixture({ engines: { node: '>=20', dsh: 'latest' } });
  t.after(() => fixture.cleanup());
  const result = prepare(fixture);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_ENGINES');
  assert.match(result.stderrJson.message, /engines\.dsh/u);
});

test('prepare rejects a files whitelist that would not ship the release identity', (t) => {
  const fixture = makeFixture({
    files: ['index.js', 'client.js', 'cordis.patch.yml', 'games/**', 'registry/**', 'scripts/release/**'],
  });
  t.after(() => fixture.cleanup());
  const result = prepare(fixture);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_FILES_INCOMPLETE');
  assert.match(result.stderrJson.message, /platform-updates\/release\.json/u);
});

test('prepare rejects a client bundle that does not embed the release identity', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const result = prepare(fixture, [], { env: { FIXTURE_NO_IDENTITY: '1' } });
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_CLIENT_IDENTITY_MISSING');
  assert.match(result.stderrJson.guidance, /build-client\.mjs/u);
});

test('prepare rejects a non-deterministic build', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const result = prepare(fixture, [], { env: { FIXTURE_NONDETERMINISTIC: '1' } });
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_NONDETERMINISTIC');
  assert.match(result.stderrJson.guidance, /reproducible/u);
});

test('prepare rejects a failed build', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const result = prepare(fixture, [], { env: { FIXTURE_BUILD_FAIL: '1' } });
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_BUILD_FAILED');
});

test('prepare rejects missing artifacts', (t) => {
  const fixture = makeFixture({ withClient: false });
  t.after(() => fixture.cleanup());
  const result = prepare(fixture, [], { env: { FIXTURE_SKIP_CLIENT: '1' } });
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_ARTIFACTS');
  assert.match(result.stderrJson.message, /client\.js/u);
});

// ---------------------------------------------------------------------------
// prepare --write: release commit R
// ---------------------------------------------------------------------------

test('prepare --write creates the release commit R with identity + artifacts', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const p = fixture.p;
  const release = writeRelease(fixture);
  const r = release.commit;
  assert.match(r, /^[a-f0-9]{40}$/u);
  assert.notEqual(r, p);
  assert.equal(release.mode, 'write');

  assert.equal(head(fixture.dir), r, 'HEAD must be the release commit');
  assert.equal(git(fixture.dir, ['show', '-s', '--format=%s', r]), `chore(release): v${STABLE_VERSION} build ${p}`);
  assert.deepEqual(git(fixture.dir, ['show', '-s', '--format=%P', r]).split(' '), [p], 'R must be the child of the version commit P');

  const identityText = readAt(fixture.dir, r, RELEASE_IDENTITY_PATH).toString('utf8');
  const identity = JSON.parse(identityText);
  assert.equal(identity.schemaVersion, 1);
  assert.equal(identity.version, STABLE_VERSION);
  assert.equal(identity.repo, REPO_URL);
  assert.equal(identity.clientBuildCommit, p);
  assert.match(identity.artifacts.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(validationOf(identity).ok, true);

  const pkgAtR = JSON.parse(readAt(fixture.dir, r, 'package.json').toString('utf8'));
  assert.equal(pkgAtR.version, STABLE_VERSION);
  assert.equal(JSON.parse(readAt(fixture.dir, p, 'package.json').toString('utf8')).version, STABLE_VERSION);

  const clientAtR = readAt(fixture.dir, r, 'client.js').toString('utf8');
  assert.match(clientAtR, new RegExp(`release-identity: version=${STABLE_VERSION} buildCommit=${p}`, 'u'));
  assert.ok(readAt(fixture.dir, r, 'games/jump/dist/index.html'), 'game dist must be committed');
  assert.ok(readAt(fixture.dir, r, 'registry/games.json'), 'registry seed must be committed');

  assert.equal(status(fixture.dir), '', 'worktree must be clean after --write');
  assert.equal(git(fixture.dir, ['tag']), '', 'release tooling must never create tags');
  assert.equal(git(fixture.dir, ['rev-list', '--count', 'HEAD']), '2', 'exactly one release commit on top of P');

  // release:verify re-validates the committed release identity read-only
  const verified = runTool(fixture, 'verify.mjs', ['--json', '--release', r]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(verified.stdoutJson.version, STABLE_VERSION);
  assert.equal(verified.stdoutJson.buildCommit, p);
  assert.equal(status(fixture.dir), '');
});

test('prepare --write is refused twice on the same release commit', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const release = writeRelease(fixture);
  const result = prepare(fixture, ['--write']);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_HEAD_IS_RELEASE');
  assert.equal(head(fixture.dir), release.commit);
});

test('release commit content is deterministic across repeated runs', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const first = writeRelease(fixture);
  const firstTree = git(fixture.dir, ['rev-parse', `${first.commit}^{tree}`]);
  git(fixture.dir, ['reset', '-q', '--hard', fixture.p]);
  const second = writeRelease(fixture);
  const secondTree = git(fixture.dir, ['rev-parse', `${second.commit}^{tree}`]);
  assert.equal(secondTree, firstTree, 'two runs from the same P must produce the same commit tree');
  assert.equal(readAt(fixture.dir, first.commit, RELEASE_IDENTITY_PATH).toString('utf8'), readAt(fixture.dir, second.commit, RELEASE_IDENTITY_PATH).toString('utf8'));
});

test('prepare overwrites a stale release identity inherited from the previous release', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  // A version commit P normally still carries the previous release's identity
  // file (main moved on); prepare must replace it with the new identity rather
  // than trust or reject it.
  const stale = {
    schemaVersion: 1,
    version: '1.2.0',
    clientBuildCommit: 'f'.repeat(40),
    repo: REPO_URL,
    artifacts: {
      algorithm: 'sha256-tree-v1',
      roots: ['client.js', 'games', 'registry'],
      sha256: 'a'.repeat(64),
      files: 1,
      bytes: 1,
    },
  };
  fs.mkdirSync(path.join(fixture.dir, 'platform-updates'), { recursive: true });
  fs.writeFileSync(path.join(fixture.dir, RELEASE_IDENTITY_PATH), `${JSON.stringify(stale, null, 2)}\n`);
  git(fixture.dir, ['add', RELEASE_IDENTITY_PATH]);
  git(fixture.dir, ['commit', '-q', '-m', 'chore: previous release identity']);
  const staleCommit = head(fixture.dir);
  const dry = prepare(fixture, ['--version', STABLE_VERSION]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdoutJson.clientBuildCommit, staleCommit);
  assert.equal(dry.stdoutJson.identity.clientBuildCommit, staleCommit);
  const written = writeRelease(fixture);
  assert.equal(written.version, STABLE_VERSION);
  const identity = JSON.parse(readAt(fixture.dir, written.commit, RELEASE_IDENTITY_PATH).toString('utf8'));
  assert.equal(identity.version, STABLE_VERSION);
  assert.equal(identity.clientBuildCommit, staleCommit);
  assert.equal(identity.artifacts.sha256, written.artifacts.sha256);
});

// ---------------------------------------------------------------------------
// promote: dry-run index generation + fail-closed validation
// ---------------------------------------------------------------------------

test('promote dry-run emits an exact DSH plugin-market-index format 1 document', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const release = writeRelease(fixture).commit;
  const result = promote(fixture, ['--release', release, '--channel', 'test']);
  assert.equal(result.status, 0, result.stderr);
  const json = result.stdoutJson;
  assert.equal(json.mode, 'dry-run');
  assert.equal(json.release, release);
  assert.equal(json.version, STABLE_VERSION);
  assert.equal(json.channel, 'test');
  assert.equal(json.written, false);
  assert.equal(json.publishTimestamp, commitEpoch(fixture.dir, release));

  const index = json.index;
  assert.equal(index.format, 1);
  assert.equal(typeof index.title, 'string');
  assert.equal(index.plugins.length, 1);
  const plugin = index.plugins[0];
  assert.equal(plugin.name, 'dsh-game-market');
  assert.equal(plugin.versions.length, 1, 'index must pin exactly one version');
  const version = plugin.versions[0];
  assert.equal(version.version, STABLE_VERSION);
  assert.deepEqual(version.source, { type: 'git', url: REPO_URL, commit: release });
  assert.equal(version.engines.dsh, '>=0.2.0 <0.3.0');
  assert.match(version.source.commit, /^[a-f0-9]{40}$/u);
  assert.equal(validatePluginIndex(index, { expect: { commit: release, version: STABLE_VERSION } }).ok, true);
  assert.equal(json.installSpec, `git+https://github.com/heswy/dsh-game-market.git#${release}`);
  assert.equal(serializePluginIndex(index), json.indexText);

  // dry-run writes nothing: no index file, clean worktree, HEAD unchanged
  assert.equal(status(fixture.dir), '');
  assert.equal(fs.existsSync(path.join(fixture.dir, INDEX_PATH)), false);
  assert.equal(head(fixture.dir), release);
});

test('promote human dry-run prints the index and writes nothing', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const release = writeRelease(fixture).commit;
  const result = runTool(fixture, 'promote.mjs', ['--release', release]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"format": 1/u);
  assert.match(result.stdout, /install spec/u);
  assert.equal(status(fixture.dir), '');
});

test('promote rejects branches, tags, short SHAs and non-existent commits', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const release = writeRelease(fixture).commit;
  const cases = [
    ['main', 'E_RELEASE_BAD_COMMIT'],
    ['HEAD', 'E_RELEASE_BAD_COMMIT'],
    ['origin/main', 'E_RELEASE_BAD_COMMIT'],
    [release.slice(0, 12), 'E_RELEASE_BAD_COMMIT'],
    [release.toUpperCase(), 'E_RELEASE_BAD_COMMIT'],
    ['f'.repeat(40), 'E_RELEASE_UNKNOWN_COMMIT'],
    ['v1.3.0', 'E_RELEASE_BAD_COMMIT'],
  ];
  for (const [target, code] of cases) {
    const result = promote(fixture, ['--release', target]);
    assert.notEqual(result.status, 0, `promote somehow accepted ${target}`);
    assert.equal(result.stderrJson.code, code, `unexpected code for ${target}: ${result.stderr}`);
  }
});

test('promote rejects an unreachable (dangling) commit', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  writeRelease(fixture);
  const dangling = git(fixture.dir, ['commit-tree', `${fixture.p}^{tree}`, '-p', fixture.p, '-m', 'dangling release']);
  const result = promote(fixture, ['--release', dangling]);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_UNREACHABLE');
});

test('promote rejects a release commit whose release.json version was tampered with', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const release = writeRelease(fixture).commit;
  const identity = JSON.parse(readAt(fixture.dir, release, RELEASE_IDENTITY_PATH).toString('utf8'));
  identity.version = '1.2.9';
  fs.writeFileSync(path.join(fixture.dir, RELEASE_IDENTITY_PATH), `${JSON.stringify(identity, null, 2)}\n`);
  git(fixture.dir, ['add', RELEASE_IDENTITY_PATH]);
  git(fixture.dir, ['commit', '-q', '-m', 'tamper identity']);
  const tampered = head(fixture.dir);
  const result = promote(fixture, ['--release', tampered]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderrJson.code} ${result.stderrJson.message}`, /VERSION|version/u);
});

test('promote rejects an artifact digest mismatch', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const release = writeRelease(fixture).commit;
  const client = readAt(fixture.dir, release, 'client.js').toString('utf8');
  fs.writeFileSync(path.join(fixture.dir, 'client.js'), `${client}// tampered\n`);
  git(fixture.dir, ['add', 'client.js']);
  git(fixture.dir, ['commit', '-q', '-m', 'tamper artifact']);
  const tampered = head(fixture.dir);
  const result = promote(fixture, ['--release', tampered]);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_ARTIFACT_DIGEST');
  assert.ok(result.stderrJson.details.expected.sha256 !== result.stderrJson.details.actual.sha256);
});

test('promote stable rejects prerelease versions; test channel accepts them', (t) => {
  const fixture = makeFixture({ version: PRERELEASE_VERSION });
  t.after(() => fixture.cleanup());
  const release = writeRelease(fixture).commit;
  const stable = promote(fixture, ['--release', release]);
  assert.notEqual(stable.status, 0);
  assert.equal(stable.stderrJson.code, 'E_RELEASE_PRERELEASE_STABLE');
  const testChannel = promote(fixture, ['--release', release, '--channel', 'test']);
  assert.equal(testChannel.status, 0, testChannel.stderr);
  assert.equal(testChannel.stdoutJson.channel, 'test');
  assert.equal(testChannel.stdoutJson.version, PRERELEASE_VERSION);
});

test('promote rejects an invalid channel/target combination', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const release = writeRelease(fixture).commit;
  const invalidChannel = promote(fixture, ['--release', release, '--channel', 'beta']);
  assert.notEqual(invalidChannel.status, 0);
  assert.equal(invalidChannel.stderrJson.code, 'E_RELEASE_USAGE');
  const missing = promote(fixture, []);
  assert.notEqual(missing.status, 0);
  assert.equal(missing.stderrJson.code, 'E_RELEASE_USAGE');
});

test('promote refuses an index introduced inside a release-style commit (no self-reference)', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const release = writeRelease(fixture).commit;
  // A valid index pinning R that is then committed inside a descendant whose
  // release identity still points at R's tree: the index must be a separate
  // commit, not mixed into a release commit.
  const index = buildPluginIndex({
    version: STABLE_VERSION,
    commit: release,
    publishTimestamp: commitEpoch(fixture.dir, release),
    engineDsh: '>=0.2.0 <0.3.0',
  });
  fs.mkdirSync(path.join(fixture.dir, 'platform-updates'), { recursive: true });
  fs.writeFileSync(path.join(fixture.dir, INDEX_PATH), serializePluginIndex(index));
  git(fixture.dir, ['add', INDEX_PATH]);
  git(fixture.dir, ['commit', '-q', '-m', 'sneak index into release']);
  const sneak = head(fixture.dir);
  const result = promote(fixture, ['--release', sneak]);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_INDEX_IN_RELEASE');
  assert.match(result.stderrJson.guidance, /separate commit/u);
});

test('index self-reference detector identifies an index pinning the target commit', () => {
  const target = 'a'.repeat(40);
  const index = buildPluginIndex({ version: STABLE_VERSION, commit: target, publishTimestamp: 1_700_000_000, engineDsh: '>=0.2.0 <0.3.0' });
  assert.equal(collectIndexCommits(index).includes(target), true);
  assert.equal(collectIndexCommits(index).includes('b'.repeat(40)), false);
});

test('promote --write requires an explicit --out path (never a default production write)', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const release = writeRelease(fixture).commit;
  const result = promote(fixture, ['--release', release, '--write']);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_OUT_REQUIRED');
  assert.equal(head(fixture.dir), release);
  assert.equal(fs.existsSync(path.join(fixture.dir, INDEX_PATH)), false);
});

test('promote --write writes only the explicit working-tree index and never commits', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const release = writeRelease(fixture).commit;
  const dryRun = promote(fixture, ['--release', release, '--channel', 'test']);
  const write = promote(fixture, ['--release', release, '--channel', 'test', '--write', '--out', 'release-out/plugins.json']);
  assert.equal(write.status, 0, write.stderr);
  assert.equal(write.stdoutJson.written, true);
  assert.equal(write.stdoutJson.out, 'release-out/plugins.json');
  const writtenPath = path.join(fixture.dir, 'release-out/plugins.json');
  assert.equal(fs.readFileSync(writtenPath, 'utf8'), dryRun.stdoutJson.indexText);
  assert.equal(head(fixture.dir), release, 'index write must not create a commit');
  assert.equal(status(fixture.dir), '?? release-out/plugins.json');
  // idempotent replay: same content is not rewritten, still no commit
  const again = promote(fixture, ['--release', release, '--channel', 'test', '--write', '--out', 'release-out/plugins.json']);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.stdoutJson.alreadyUpToDate, true);
  assert.equal(head(fixture.dir), release);
});

test('promote --write refuses the production index path without explicit acknowledgement', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const release = writeRelease(fixture).commit;
  const guarded = promote(fixture, ['--release', release, '--write', '--out', INDEX_PATH]);
  assert.notEqual(guarded.status, 0);
  assert.equal(guarded.stderrJson.code, 'E_RELEASE_PRODUCTION_INDEX_GUARD');
  assert.equal(fs.existsSync(path.join(fixture.dir, INDEX_PATH)), false);
  // authorised index-PR flow (future release): explicit acknowledgement writes,
  // then a *separate* commit I references R; R itself still does not contain it.
  const authorised = promote(fixture, ['--release', release, '--write', '--out', INDEX_PATH, '--production-index']);
  assert.equal(authorised.status, 0, authorised.stderr);
  assert.equal(fs.existsSync(path.join(fixture.dir, INDEX_PATH)), true);
  assert.equal(readAt(fixture.dir, release, INDEX_PATH), null, 'release commit R must not contain the index');
  git(fixture.dir, ['add', INDEX_PATH]);
  git(fixture.dir, ['commit', '-q', '-m', `chore(release): publish plugin index for v${STABLE_VERSION} (build ${release})`]);
  const indexCommit = head(fixture.dir);
  assert.notEqual(indexCommit, release);
  assert.equal(git(fixture.dir, ['show', '-s', '--format=%P', indexCommit]), release, 'index commit I is a separate child referencing R');
  const verified = runTool(fixture, 'verify.mjs', ['--json', '--release', release, '--index', INDEX_PATH]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(verified.stdoutJson.index.commits.length, 1);
  assert.equal(verified.stdoutJson.index.commits[0], release);
  assert.equal(verified.stdoutJson.index.installSpec, `git+https://github.com/heswy/dsh-game-market.git#${release}`);
});

test('promote refuses an --out path that is part of the release commit', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const release = writeRelease(fixture).commit;
  const result = promote(fixture, ['--release', release, '--write', '--out', 'package.json']);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_OUT_INVALID');
});

test('promote refuses to replace a published version with a different commit', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const release = writeRelease(fixture).commit;
  // Commit an index I (separate commit) pinning R, then rewrite release.json's
  // version? Reuse the same version with a *different* release commit: rebuild
  // a second release from a new version commit, but keep the same version by
  // resetting P? Instead simulate a trusted index on HEAD that pins a different
  // commit for this version.
  const fakeIndex = buildPluginIndex({
    version: STABLE_VERSION,
    commit: 'c'.repeat(40),
    publishTimestamp: 1_700_000_000,
    engineDsh: '>=0.2.0 <0.3.0',
  });
  fs.mkdirSync(path.join(fixture.dir, 'platform-updates'), { recursive: true });
  fs.writeFileSync(path.join(fixture.dir, INDEX_PATH), serializePluginIndex(fakeIndex));
  git(fixture.dir, ['add', INDEX_PATH]);
  git(fixture.dir, ['commit', '-q', '-m', 'trusted index']);
  const result = promote(fixture, ['--release', release]);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_VERSION_IMMUTABLE');
});

test('promote refuses to publish an older version than the trusted index', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const release = writeRelease(fixture).commit;
  const newerIndex = buildPluginIndex({
    version: '1.4.0',
    commit: 'd'.repeat(40),
    publishTimestamp: 1_700_000_000,
    engineDsh: '>=0.2.0 <0.3.0',
  });
  fs.mkdirSync(path.join(fixture.dir, 'platform-updates'), { recursive: true });
  fs.writeFileSync(path.join(fixture.dir, INDEX_PATH), serializePluginIndex(newerIndex));
  git(fixture.dir, ['add', INDEX_PATH]);
  git(fixture.dir, ['commit', '-q', '-m', 'trusted newer index']);
  const result = promote(fixture, ['--release', release]);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_VERSION_ROLLBACK');
});

test('promote validates the release from git objects, not from the working tree', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const release = writeRelease(fixture).commit;
  // Corrupt the working-tree release.json/artifacts; promote must still read R.
  fs.writeFileSync(path.join(fixture.dir, RELEASE_IDENTITY_PATH), '{"garbage":true}\n');
  fs.writeFileSync(path.join(fixture.dir, 'client.js'), 'corrupted working tree\n');
  const result = promote(fixture, ['--release', release, '--channel', 'test']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdoutJson.version, STABLE_VERSION);
});

// ---------------------------------------------------------------------------
// verify + index validator unit coverage
// ---------------------------------------------------------------------------

test('release:verify rejects a wrong index pin', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const release = writeRelease(fixture).commit;
  const index = JSON.parse(serializePluginIndex(buildPluginIndex({
    version: STABLE_VERSION,
    commit: release,
    publishTimestamp: commitEpoch(fixture.dir, release),
    engineDsh: '>=0.2.0 <0.3.0',
  })));
  index.plugins[0].versions[0].source.commit = 'e'.repeat(40);
  fs.mkdirSync(path.join(fixture.dir, 'release-out'), { recursive: true });
  fs.writeFileSync(path.join(fixture.dir, 'release-out/plugins.json'), `${JSON.stringify(index, null, 2)}\n`);
  const result = runTool(fixture, 'verify.mjs', ['--json', '--release', release, '--index', 'release-out/plugins.json']);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderrJson.code, 'E_RELEASE_INDEX_INVALID');
});

test('format-1 validator rejects malformed / unsafe index documents', () => {
  const base = buildPluginIndex({
    version: STABLE_VERSION,
    commit: 'a'.repeat(40),
    publishTimestamp: 1_700_000_000,
    engineDsh: '>=0.2.0 <0.3.0',
  });
  const clone = () => JSON.parse(JSON.stringify(base));
  assert.equal(validatePluginIndex(base).ok, true);

  const mutations = [
    (index) => { index.format = 2; },
    (index) => { delete index.title; },
    (index) => { index.plugins[0].versions[0].source.commit = 'main'; },
    (index) => { index.plugins[0].versions[0].source.commit = 'A'.repeat(40); },
    (index) => { index.plugins[0].versions[0].source.commit = 'a'.repeat(12); },
    (index) => { index.plugins[0].versions[0].source.type = 'npm'; },
    (index) => { index.plugins[0].versions[0].source.url = 'http://github.com/heswy/dsh-game-market'; },
    (index) => { index.plugins[0].versions[0].source.url = 'https://github.com/heswy/dsh-game-market?x=1'; },
    (index) => { index.plugins[0].versions.push({ ...index.plugins[0].versions[0] }); },
    (index) => { index.plugins[0].versions[0].publishTimestamp = 1.5; },
    (index) => { index.plugins[0].versions[0].version = '1.3'; },
    (index) => { index.plugins[0].versions[0].engines = { dsh: 'workspace:*' }; },
    (index) => { index.plugins.push({ ...index.plugins[0] }); },
    (index) => { index.unexpected = true; },
  ];
  for (const mutate of mutations) {
    const candidate = clone();
    mutate(candidate);
    assert.equal(validatePluginIndex(candidate).ok, false, `validator accepted mutation: ${String(mutate)}`);
  }

  const target = installTargetFor('dsh-game-market', base.plugins[0].versions[0]);
  assert.deepEqual(target, { spec: `git+https://github.com/heswy/dsh-game-market.git#${'a'.repeat(40)}` });
});

test('release identity validator enforces the frozen schema', () => {
  const identity = {
    schemaVersion: 1,
    version: STABLE_VERSION,
    clientBuildCommit: 'a'.repeat(40),
    repo: REPO_URL,
    artifacts: {
      algorithm: 'sha256-tree-v1',
      roots: ['client.js', 'games', 'registry'],
      sha256: 'b'.repeat(64),
      files: 3,
      bytes: 10,
    },
  };
  assert.equal(validateReleaseIdentity(identity, { requireArtifacts: true }).ok, true);
  const clone = () => JSON.parse(JSON.stringify(identity));
  const mutations = [
    (value) => { value.schemaVersion = 2; },
    (value) => { value.repo = 'heswy/dsh-game-market'; },
    (value) => { value.clientBuildCommit = 'R'.repeat(40); },
    (value) => { value.version = 'v1.3.0'; },
    (value) => { value.artifacts.sha256 = 'not-a-digest'; },
    (value) => { value.artifacts.roots = ['client.js']; },
    (value) => { value.artifacts.algorithm = 'sha1'; },
    (value) => { value.extra = true; },
  ];
  for (const mutate of mutations) {
    const candidate = clone();
    mutate(candidate);
    assert.equal(validateReleaseIdentity(candidate, { requireArtifacts: true }).ok, false, `validator accepted mutation: ${String(mutate)}`);
  }
});

// ---------------------------------------------------------------------------
// no network / no push / no tag: assert from a git PATH shim
// ---------------------------------------------------------------------------

const REAL_GIT = (() => {
  const found = spawnSync('which', ['git'], { encoding: 'utf8' });
  const path = found.stdout.trim();
  return path || '/usr/bin/git';
})();

const FORBIDDEN_GIT = new Set(['push', 'tag', 'fetch', 'pull', 'ls-remote', 'clone', 'remote-update', 'submodule', 'send-pack', 'receive-pack']);

function makeGitShim(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-release-gitshim-'));
  const log = path.join(directory, 'git-calls.log');
  fs.writeFileSync(log, '');
  const shim = path.join(directory, 'git');
  fs.writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "$*" >> "$GIT_CALL_LOG"\nexec ${JSON.stringify(REAL_GIT)} "$@"\n`, { mode: 0o755 });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { env: { PATH: `${directory}${path.delimiter}${process.env.PATH}`, GIT_CALL_LOG: log }, log };
}

function readGitCalls(log) {
  return fs
    .readFileSync(log, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const tokens = line.split(/\s+/u);
      let index = 0;
      while (index < tokens.length && tokens[index].startsWith('-')) index += 1;
      return tokens[index] || '';
    });
}

test('release tooling never runs push/tag/fetch (git shim audit, dry-run + write)', (t) => {
  const fixture = makeFixture();
  t.after(() => fixture.cleanup());
  const shim = makeGitShim(t);
  const dryPrepare = prepare(fixture, [], { env: shim.env });
  assert.equal(dryPrepare.status, 0, dryPrepare.stderr);
  const writePrepare = prepare(fixture, ['--write'], { env: shim.env });
  assert.equal(writePrepare.status, 0, writePrepare.stderr);
  const release = writePrepare.stdoutJson.commit;
  const dryPromote = promote(fixture, ['--release', release, '--channel', 'test'], { env: shim.env });
  assert.equal(dryPromote.status, 0, dryPromote.stderr);
  const writePromote = promote(fixture, ['--release', release, '--channel', 'test', '--write', '--out', 'release-out/plugins.json'], { env: shim.env });
  assert.equal(writePromote.status, 0, writePromote.stderr);
  const verified = runTool(fixture, 'verify.mjs', ['--json', '--release', release], { env: shim.env });
  assert.equal(verified.status, 0, verified.stderr);

  const calls = readGitCalls(shim.log);
  assert.ok(calls.length > 0, 'git shim must have observed the tooling git calls');
  const forbidden = calls.filter((call) => FORBIDDEN_GIT.has(call));
  assert.deepEqual(forbidden, [], `forbidden git subcommands executed: ${forbidden.join(', ')}`);
  const allowed = new Set([
    'rev-parse', 'status', 'remote', 'symbolic-ref', 'show', 'cat-file', 'merge-base',
    'for-each-ref', 'ls-tree', 'ls-files', 'add', 'commit', 'reset', 'log', 'diff',
  ]);
  const unknown = [...new Set(calls)].filter((call) => !allowed.has(call));
  assert.deepEqual(unknown, [], `unexpected git subcommands executed: ${unknown.join(', ')}`);
});
