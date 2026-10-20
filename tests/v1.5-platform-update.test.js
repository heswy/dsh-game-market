/**
 * V1.5 M3-H1 shared contracts: official plugin-market index format 1 strict
 * validation, `dsh-game-market` target binding, target identity, release
 * identity, profile spec helpers and the frozen update vocabulary.
 *
 * The production path does **not** import the DSH installation's
 * `@deepseek-ai/dsh-plugin-market-index` (Q1); this suite locks the independent
 * validator that must enforce the same format-1 document rules.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ROUTES } from '../packages/shared/src/contracts.js';
import { GM, INTERNAL_TO_GM, httpStatusFor } from '../packages/shared/src/errors.js';
import {
  PLATFORM_UPDATE_CHANNELS,
  PLATFORM_UPDATE_INDEX_MAX_BYTES,
  PLATFORM_UPDATE_INDEX_URL,
  PLATFORM_UPDATE_REASON_KEYS,
  PLATFORM_UPDATE_REPOSITORY,
  PLATFORM_UPDATE_STATES,
  PLATFORM_UPDATE_TERMINAL_STATES,
  PLATFORM_UPDATE_TIMING,
  compareExactSemver,
  detectUpdateTargetAnomaly,
  isBoundOfficialSource,
  isPinnedCommit,
  isPrereleaseVersion,
  isUpdateOperationId,
  isUpdateTargetId,
  normaliseUpdateChannel,
  parseExactSemver,
  parsePluginMarketIndex,
  parseProfileDependencyCommit,
  parseReleaseManifest,
  profileDependencySpecShape,
  selectOfficialUpdateTarget,
  updateGitSpecForCommit,
  updateTargetIdFor,
} from '../packages/shared/src/platform-update.js';

const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const REPO = PLATFORM_UPDATE_REPOSITORY;

function version({ name = '1.3.0', commit = COMMIT_A, source, publishTimestamp = 1700000000 } = {}) {
  return {
    version: name,
    publishTimestamp,
    source: source ?? { type: 'git', url: REPO.url, commit },
  };
}

function indexDocument(versions = [version()], overrides = {}) {
  return {
    format: 1,
    title: 'DSH Game Market plugins',
    plugins: [
      {
        name: 'dsh-game-market',
        repository: { url: 'https://github.com/heswy/dsh-game-market' },
        versions,
      },
    ],
    ...overrides,
  };
}

function parse(document) {
  return parsePluginMarketIndex(document, { indexUrl: PLATFORM_UPDATE_INDEX_URL });
}

function select(document, options = {}) {
  const validation = parse(document);
  assert.equal(validation.ok, true, JSON.stringify(validation));
  return selectOfficialUpdateTarget(validation.value, options);
}

test('the fixed discovery policy constants are the frozen ones', () => {
  assert.equal(
    PLATFORM_UPDATE_INDEX_URL,
    'https://raw.githubusercontent.com/heswy/dsh-game-market/main/platform-updates/plugins.json'
  );
  assert.equal(PLATFORM_UPDATE_INDEX_MAX_BYTES, 256 * 1024);
  assert.equal(PLATFORM_UPDATE_TIMING.indexTotalMs, 5000);
  assert.equal(PLATFORM_UPDATE_TIMING.indexConnectMs, 5000);
  assert.equal(PLATFORM_UPDATE_TIMING.maxRedirects, 3);
  assert.equal(PLATFORM_UPDATE_TIMING.startupCheckMs, 6 * 60 * 60 * 1000);
  assert.equal(PLATFORM_UPDATE_TIMING.manualRefreshThrottleMs, 60 * 1000);
  assert.deepEqual(PLATFORM_UPDATE_CHANNELS, ['stable', 'test']);
  assert.equal(REPO.url, 'https://github.com/heswy/dsh-game-market.git');
  assert.equal(PLATFORM_UPDATE_INDEX_URL.includes(REPO.owner), true);
  assert.deepEqual(PLATFORM_UPDATE_STATES, [
    'inspecting',
    'installing',
    'applied',
    'activating',
    'updated',
    'pending-restart',
    'already-at-target',
    'verification-failed',
    'stale-runtime',
    'too-late',
    'cancelled',
    'failed',
  ]);
  assert.equal(PLATFORM_UPDATE_TERMINAL_STATES.includes('applied'), false);
  assert.equal(PLATFORM_UPDATE_TERMINAL_STATES.includes('updated'), true);
  assert.equal(PLATFORM_UPDATE_REASON_KEYS.HMR_UNKNOWN, 'update.reason.hmrUnknown');
  assert.deepEqual(
    [
      ROUTES.PLATFORM_UPDATE,
      ROUTES.PLATFORM_UPDATE_REFRESH,
      ROUTES.PLATFORM_UPDATE_BEGIN,
      ROUTES.PLATFORM_UPDATE_OBSERVE,
      ROUTES.PLATFORM_UPDATE_CANCEL,
      ROUTES.PLATFORM_UPDATE_COORDINATE,
      ROUTES.PLATFORM_UPDATE_CLIENT_REPORT,
    ],
    [
      '/api/game-market/platform-update',
      '/api/game-market/platform-update/refresh',
      '/api/game-market/platform-update/begin',
      '/api/game-market/platform-update/observe',
      '/api/game-market/platform-update/cancel',
      '/api/game-market/platform-update/coordinate',
      '/api/game-market/platform-update/client-report',
    ]
  );
});

test('GM-5039 is the documented index-unavailable code (503) with mappings', () => {
  assert.equal(GM.UPDATE_INDEX_UNAVAILABLE, 'GM-5039');
  assert.equal(httpStatusFor(GM.UPDATE_INDEX_UNAVAILABLE), 503);
  assert.equal(INTERNAL_TO_GM.E_UPDATE_INDEX_UNAVAILABLE, GM.UPDATE_INDEX_UNAVAILABLE);
  assert.equal(GM.UPDATE_TARGET_INVALID, 'GM-4090');
  assert.equal(GM.UPDATE_ADAPTER_UNAVAILABLE, 'GM-5038');
  assert.equal(GM.UPDATE_OBSERVE_TIMEOUT, 'GM-5040');
  assert.equal(httpStatusFor(GM.UPDATE_TARGET_INVALID), 409);
  assert.equal(httpStatusFor(GM.UPDATE_ADAPTER_UNAVAILABLE), 503);
  assert.equal(httpStatusFor(GM.UPDATE_OBSERVE_TIMEOUT), 504);
});

test('format 1: a minimal official index validates and undefined members are dropped', () => {
  const result = parse({
    format: 1,
    title: { en: 'Official plugins', zh: '官方插件' },
    description: 'Official DSH plugin index',
    unknownRoot: { ignored: true },
    plugins: [
      {
        name: 'dsh-game-market',
        title: { en: 'Game Market' },
        unknownPlugin: true,
        versions: [
          { ...version({ name: '1.2.0', commit: COMMIT_A }), engines: { dsh: '>=0.2.0 <0.3.0' } },
          { ...version({ name: '1.3.0', commit: COMMIT_B }), unknownVersion: true },
        ],
      },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.format, 1);
  assert.equal(result.value.plugins.length, 1);
  assert.equal(result.value.unknownRoot, undefined);
  assert.equal(result.value.plugins[0].unknownPlugin, undefined);
  // Versions are ordered by SemVer precedence, highest first.
  assert.deepEqual(
    result.value.plugins[0].versions.map((entry) => entry.version),
    ['1.3.0', '1.2.0']
  );
  assert.equal(result.value.plugins[0].versions[1].engines.dsh, '>=0.2.0 <0.3.0');
});

test('format 1: structural violations are rejected with a JSON path', () => {
  const cases = [
    [{ format: 2, title: 'x', plugins: [] }, '$.format'],
    [{ format: 1, plugins: [] }, '$.title'],
    [{ format: 1, title: 'x', plugins: {} }, '$.plugins'],
    [indexDocument([{ ...version(), publishTimestamp: 1.5 }]), 'publishTimestamp'],
    [indexDocument([{ ...version(), version: '1.3' }]), 'version'],
    [indexDocument([version(), version()]), 'duplicates'],
    [indexDocument([version({ name: '1.2.0' }), version({ name: '1.2.0', commit: COMMIT_B })]), 'duplicates'],
    [indexDocument([{ ...version(), source: { type: 'svn', url: REPO.url } }]), 'type'],
    [indexDocument([{ ...version(), source: { type: 'git', url: 'http://github.com/heswy/dsh-game-market.git', commit: COMMIT_A } }]), 'https'],
    [
      indexDocument([
        { ...version(), source: { type: 'git', url: REPO.url, commit: COMMIT_A.toUpperCase() } },
      ]),
      'commit',
    ],
    [
      indexDocument([{ ...version(), source: { type: 'git', url: REPO.url, commit: 'abc1234' } }]),
      'commit',
    ],
    [
      indexDocument([
        {
          ...version(),
          source: { type: 'git', url: 'https://github.com/heswy/dsh-game-market.git', commit: COMMIT_A, path: '../escape' },
        },
      ]),
      'path',
    ],
    [indexDocument([version()], { plugins: [{ name: 'Not A Package', versions: [version()] }] }), 'name'],
    [indexDocument([version()], { plugins: [indexDocument().plugins[0], indexDocument().plugins[0]] }), 'duplicates'],
    [
      indexDocument([version()], {
        plugins: [{ name: 'dsh-game-market', versions: [version()], title: { zh: '缺少英文' } }],
      }),
      'must contain en',
    ],
    [
      indexDocument([version()], {
        plugins: [{ name: 'dsh-game-market', versions: [version()], icon: 'data:image/svg+xml;base64,%%%' }],
      }),
      'icon',
    ],
    [
      indexDocument([version()], {
        plugins: [{ name: 'dsh-game-market', versions: [version()], repository: { url: 'ftp://example.com/x' } }],
      }),
      'url',
    ],
    [indexDocument([{ ...version(), engines: { dsh: 'workspace:*' } }]), 'engines'],
  ];
  for (const [document, expectedPath] of cases) {
    const result = parse(document);
    assert.equal(result.ok, false, `expected rejection for ${expectedPath}`);
    assert.equal(result.code, 'E_UPDATE_INDEX_INVALID');
    assert.equal(typeof result.details.path, 'string');
    assert.match(result.details.path, /^\$/, 'path must be a JSON path');
    const combined = `${result.details.path} ${result.details.reason}`;
    assert.equal(
      combined.includes(expectedPath),
      true,
      `expected ${expectedPath} in ${combined}`
    );
  }
  const notJson = parsePluginMarketIndex(undefined);
  assert.equal(notJson.ok, false);
  assert.equal(notJson.code, 'E_UPDATE_INDEX_INVALID');
});

test('format 1: icons accept bounded inline data URLs and same-origin references', () => {
  const inline = parse(
    indexDocument([version()], {
      plugins: [
        {
          name: 'dsh-game-market',
          versions: [version()],
          icon: 'data:image/svg+xml;base64,PHN2Zy8+',
        },
      ],
    })
  );
  assert.equal(inline.ok, true);
  const relative = parse(
    indexDocument([version()], {
      plugins: [{ name: 'dsh-game-market', versions: [version()], icon: './icons/market.svg' }],
    })
  );
  assert.equal(relative.ok, true);
  assert.equal(
    relative.value.plugins[0].icon,
    new URL('./icons/market.svg', PLATFORM_UPDATE_INDEX_URL).href
  );
  const external = parse(
    indexDocument([version()], {
      plugins: [{ name: 'dsh-game-market', versions: [version()], icon: 'http://example.com/icon.png' }],
    })
  );
  assert.equal(external.ok, false);
});

test('target binding: only the official repo root git pin is selectable', () => {
  const selected = select(
    indexDocument([version({ name: '1.3.0', commit: COMMIT_A })]),
    { channel: 'stable' }
  );
  assert.equal(selected.ok, true);
  assert.equal(selected.target.version, '1.3.0');
  assert.equal(selected.target.commit, COMMIT_A);
  assert.equal(selected.target.channel, 'stable');
  assert.equal(selected.target.spec, `https://github.com/heswy/dsh-game-market.git#${COMMIT_A}`);
  assert.equal(selected.target.id, updateTargetIdFor('1.3.0', COMMIT_A));
  assert.match(selected.target.id, /^tgt_[a-f0-9]{16}$/);
  assert.equal(selected.target.publishedAt, new Date(1700000000 * 1000).toISOString());

  const variants = [
    // wrong owner/repo
    { type: 'git', url: 'https://github.com/evil/dsh-game-market.git', commit: COMMIT_A },
    // wrong scheme (validator rejects, but binding must also reject)
    { type: 'git', url: 'http://github.com/heswy/dsh-game-market.git', commit: COMMIT_A },
    // npm source for our plugin
    { type: 'npm' },
    // a package sub-directory pin (our bundle lives at the repository root)
    { type: 'git', url: 'https://github.com/heswy/dsh-game-market.git', commit: COMMIT_A, path: 'packages/market' },
  ];
  for (const source of variants) {
    const document = indexDocument([version({ source })]);
    const validation = parse(document);
    if (validation.ok === false) continue; // rejected even earlier by format 1
    const result = selectOfficialUpdateTarget(validation.value, { channel: 'stable' });
    assert.equal(result.ok, false, `must reject ${JSON.stringify(source)}`);
    assert.equal(result.code, 'E_UPDATE_INDEX_INVALID');
    assert.equal(result.details.reason, 'source-binding');
  }

  assert.equal(isBoundOfficialSource({ type: 'git', url: REPO.url, commit: COMMIT_A }), true);
  assert.equal(isBoundOfficialSource({ type: 'git', url: 'https://github.com/heswy/dsh-game-market', commit: COMMIT_A }), true);
  assert.equal(isBoundOfficialSource({ type: 'git', url: 'https://github.com/heswy/dsh-game-market.git/', commit: COMMIT_A }), true);
  assert.equal(isBoundOfficialSource({ type: 'git', url: REPO.url, commit: 'a'.repeat(39) }), false);
  assert.equal(isBoundOfficialSource({ type: 'git', url: 'https://github.com/other/repo.git', commit: COMMIT_A }), false);
});

test('target channels: stable excludes prereleases; test is explicit opt-in', () => {
  const versions = [
    version({ name: '1.3.0', commit: COMMIT_A }),
    version({ name: '1.3.1-rc.1', commit: COMMIT_B }),
    version({ name: '1.2.5', commit: COMMIT_A }),
  ];
  const stable = select(indexDocument(versions), { channel: 'stable' });
  assert.equal(stable.target.version, '1.3.0');
  const testChannel = select(indexDocument(versions), { channel: 'test' });
  assert.equal(testChannel.target.version, '1.3.1-rc.1');
  // Highest published version wins within the channel.
  const newestStable = select(indexDocument([version({ name: '1.9.0', commit: COMMIT_A }), version({ name: '2.0.0' })]), {
    channel: 'stable',
  });
  assert.equal(newestStable.target.version, '2.0.0');
  // Only prereleases → stable has no target (healthy, not an error).
  const onlyPrerelease = select(indexDocument([version({ name: '2.0.0-rc.1' })]), { channel: 'stable' });
  assert.equal(onlyPrerelease.ok, true);
  assert.equal(onlyPrerelease.target, null);
  assert.equal(onlyPrerelease.reason, 'no-stable-version');
  assert.equal(select(indexDocument([version({ name: '2.0.0-rc.1' })]), { channel: 'test' }).target.version, '2.0.0-rc.1');
  // Plugin absent from a healthy index is "not listed", not an invalid index.
  const notListed = select(indexDocument([], { plugins: [{ name: 'other-plugin', versions: [version()] }] }));
  assert.equal(notListed.ok, true);
  assert.equal(notListed.target, null);
  assert.equal(notListed.reason, 'not-listed');
  // Invalid channel is an adapter-level target error.
  const badChannel = select(indexDocument(), { channel: 'beta' });
  assert.equal(badChannel.ok, false);
  assert.equal(badChannel.code, 'E_UPDATE_TARGET_INVALID');
});

test('target identity is deterministic, opaque and validated', () => {
  assert.equal(updateTargetIdFor('1.3.0', COMMIT_A), updateTargetIdFor('1.3.0', COMMIT_A));
  assert.notEqual(updateTargetIdFor('1.3.0', COMMIT_A), updateTargetIdFor('1.3.0', COMMIT_B));
  assert.notEqual(updateTargetIdFor('1.3.0', COMMIT_A), updateTargetIdFor('1.3.1', COMMIT_A));
  assert.equal(updateTargetIdFor('1.3', COMMIT_A), null);
  assert.equal(updateTargetIdFor('1.3.0', 'abc'), null);
  assert.equal(isUpdateTargetId(updateTargetIdFor('1.3.0', COMMIT_A)), true);
  assert.equal(isUpdateTargetId('tgt_XYZ'), false);
  assert.equal(updateGitSpecForCommit(COMMIT_A), `${REPO.url}#${COMMIT_A}`);
  assert.equal(updateGitSpecForCommit('main'), null);
  assert.equal(isPinnedCommit(COMMIT_A), true);
  assert.equal(isPinnedCommit(COMMIT_A.toUpperCase()), false);
  assert.equal(isUpdateOperationId('upd_0123456789abcdef'), true);
  assert.equal(isUpdateOperationId('upd_x'), false);
});

test('SemVer helpers implement SemVer 2.0.0 precedence', () => {
  assert.equal(compareExactSemver('1.3.0', '1.3.0'), 0);
  assert.equal(compareExactSemver('1.3.0', '1.2.9'), 1);
  assert.equal(compareExactSemver('1.3.0-rc.1', '1.3.0'), -1);
  assert.equal(compareExactSemver('1.3.0-rc.2', '1.3.0-rc.1'), 1);
  assert.equal(compareExactSemver('1.3.0-alpha', '1.3.0-alpha.1'), -1);
  assert.equal(compareExactSemver('1.3.0-beta.2', '1.3.0-beta.11'), -1);
  assert.equal(compareExactSemver('1.3.0+build.1', '1.3.0+build.2'), 0);
  assert.equal(parseExactSemver('1.3.0')?.major, 1);
  assert.equal(parseExactSemver('01.3.0'), null);
  assert.equal(parseExactSemver('1.3'), null);
  assert.equal(isPrereleaseVersion('1.3.0-rc.1'), true);
  assert.equal(isPrereleaseVersion('1.3.0'), false);
});

test('profile dependency specs map to the frozen specShape/specCommit vocabulary', () => {
  const matrix = [
    [`github:heswy/dsh-game-market#${COMMIT_A}`, 'git-url', COMMIT_A],
    [`git+https://github.com/heswy/dsh-game-market.git#${COMMIT_A}`, 'git-url', COMMIT_A],
    [`https://github.com/heswy/dsh-game-market.git#${COMMIT_A}`, 'git-url', COMMIT_A],
    [`https://github.com/heswy/dsh-game-market.git#${COMMIT_A}&path:/packages/market`, 'git-url', COMMIT_A],
    ['heswy/dsh-game-market#main', 'git-url', null],
    ['dsh-game-market', 'registry', null],
    ['dsh-game-market@1.2.0', 'registry', null],
    ['file:/tmp/dsh-game-market', 'file', null],
    ['link:/tmp/dsh-game-market', 'path', null],
    ['./dsh-game-market-worktrees/v1.5-platform-update', 'path', null],
    ['/Users/someone/checkout/dsh-game-market', 'path', null],
    ['git@github.com:heswy/dsh-game-market.git#abcdef', 'git-url', null],
  ];
  for (const [spec, shape, commit] of matrix) {
    assert.equal(profileDependencySpecShape(spec), shape, spec);
    assert.equal(parseProfileDependencyCommit(spec), commit, spec);
  }
  assert.equal(profileDependencySpecShape(null), 'unknown');
  assert.equal(profileDependencySpecShape(''), 'unknown');
});

test('release identity validates schemaVersion/version/clientBuildCommit/repo', () => {
  const valid = parseReleaseManifest({
    schemaVersion: 1,
    version: '1.3.0',
    clientBuildCommit: COMMIT_A,
    repo: 'heswy/dsh-game-market',
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.clientBuildCommit, COMMIT_A);
  const noClientCommit = parseReleaseManifest({
    schemaVersion: 1,
    version: '1.3.0',
    clientBuildCommit: null,
    repo: 'heswy/dsh-game-market',
  });
  assert.equal(noClientCommit.ok, true);
  assert.equal(noClientCommit.value.clientBuildCommit, null);
  for (const invalid of [
    null,
    { schemaVersion: 2, version: '1.3.0', repo: 'heswy/dsh-game-market' },
    { schemaVersion: 1, version: '1.3', repo: 'heswy/dsh-game-market' },
    { schemaVersion: 1, version: '1.3.0', clientBuildCommit: 'abc', repo: 'heswy/dsh-game-market' },
    { schemaVersion: 1, version: '1.3.0', repo: 'evil/dsh-game-market' },
    { schemaVersion: 1, version: '1.3.0', repo: 42 },
  ]) {
    const result = parseReleaseManifest(invalid);
    assert.equal(result.ok, false, JSON.stringify(invalid));
    assert.equal(result.code, 'E_RELEASE_INVALID');
  }
});

test('same-version-different-commit anomaly is detected against cache or profile', () => {
  const target = { version: '1.3.0', commit: COMMIT_A };
  assert.equal(
    detectUpdateTargetAnomaly({ target, previousTarget: { version: '1.3.0', commit: COMMIT_A } }),
    null
  );
  assert.equal(
    detectUpdateTargetAnomaly({ target, previousTarget: { version: '1.2.0', commit: COMMIT_B } }),
    null
  );
  const fromCache = detectUpdateTargetAnomaly({
    target,
    previousTarget: { version: '1.3.0', commit: COMMIT_B },
  });
  assert.equal(fromCache.kind, 'same-version-different-commit');
  assert.equal(fromCache.source, 'previous-target');
  const fromProfile = detectUpdateTargetAnomaly({
    target,
    installedVersion: '1.3.0',
    installedCommit: COMMIT_B,
  });
  assert.equal(fromProfile.source, 'profile-dependency');
  assert.equal(
    detectUpdateTargetAnomaly({ target, installedVersion: '1.3.0', installedCommit: COMMIT_A }),
    null
  );
  assert.equal(detectUpdateTargetAnomaly({ target: null }), null);
});

test('channel normalisation defaults to stable and rejects unknown names', () => {
  assert.equal(normaliseUpdateChannel(undefined), 'stable');
  assert.equal(normaliseUpdateChannel(''), 'stable');
  assert.equal(normaliseUpdateChannel('STABLE'), 'stable');
  assert.equal(normaliseUpdateChannel(' test '), 'test');
  assert.equal(normaliseUpdateChannel('beta'), null);
  assert.equal(normaliseUpdateChannel(42), 'stable');
});
