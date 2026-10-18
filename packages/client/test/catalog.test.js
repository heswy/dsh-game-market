import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES as SHARED_CATEGORIES } from '../../shared/src/manifest.js';
import { CATEGORIES } from '../src/constants.js';
import {
  coverTone,
  detailActionReasonKey,
  filterCatalog,
  hasUpdate,
  initialFor,
  installedGames,
  isBuiltin,
  isNewGame,
  matchesCategory,
  matchesQuery,
  normalizeCatalog,
  normalizeDetailPayload,
  normalizeGame,
  progressSummary,
  resolveDetailAction,
  resolvePermissions,
  screenshotsFor,
  selectHero,
  selectSections,
  sortCatalog,
  sortMyGames,
} from '../src/catalog.js';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');

function makeGame(id, overrides) {
  return normalizeGame(
    Object.assign(
      {
        id: id,
        name: id,
        version: '1.0.0',
        description: '',
        author: { name: 'Test Author' },
        categories: ['arcade'],
        capabilities: ['score'],
        installed: false,
        canContinue: false,
        compatibility: { ok: true, reason: null },
      },
      overrides || {}
    )
  );
}

function ids(games) {
  return games.map(function id(game) {
    return game.id;
  });
}

test('client category list matches the frozen manifest enum', function () {
  assert.deepEqual([...CATEGORIES], [...SHARED_CATEGORIES]);
});

test('normalizeGame accepts V0 records and canonical V1 summaries', function () {
  const v0 = normalizeGame({ id: 'snake', name: 'Snake', version: '0.1.0', author: 'DSH', builtin: true, installed: true, canContinue: true });
  assert.equal(v0.author.name, 'DSH');
  assert.equal(v0.builtin, true);
  assert.equal(v0.source, 'builtin');
  assert.equal(v0.installed, true);
  assert.equal(v0.installedVersion, '0.1.0');
  assert.equal(v0.canContinue, true);

  const v1 = normalizeGame({
    id: 'jump',
    name: 'Jump',
    version: '1.0.0',
    author: { name: 'Studio', url: 'https://example.com' },
    categories: ['arcade', 'action'],
    capabilities: ['storage', 'score'],
    source: 'registry',
    installed: false,
    quickPlay: true,
    featured: true,
    publishedAt: '2026-09-01T00:00:00.000Z',
    icon: '/api/game-market/preview?gameId=jump&file=icon',
    cover: '/api/game-market/preview?gameId=jump&file=cover',
    screenshots: ['/api/game-market/preview?gameId=jump&file=screenshot-1'],
  });
  assert.equal(v1.author.name, 'Studio');
  assert.equal(v1.categories.length, 2);
  assert.equal(v1.quickPlay, true);
  assert.equal(v1.featured, true);
  assert.match(v1.cover, /^\/api\/game-market\/preview/);
  assert.equal(v1.screenshots.length, 1);
  assert.equal(normalizeGame({ name: 'no id' }), null);
  assert.equal(normalizeGame(null), null);
});

test('image URLs stay same-origin (no CDN or external hosts reach the renderer)', function () {
  const external = normalizeGame({
    id: 'ext',
    cover: 'https://cdn.example.com/cover.png',
    icon: 'https://cdn.example.com/icon.png',
    screenshots: ['https://cdn.example.com/a.png', '/api/game-market/preview?gameId=ext&file=screenshot-1'],
  });
  assert.equal(external.cover, null);
  assert.equal(external.icon, null);
  assert.deepEqual(external.screenshots, ['/api/game-market/preview?gameId=ext&file=screenshot-1']);

  const dataIcon = normalizeGame({ id: 'local-one', icon: 'data:image/png;base64,AAAA' });
  assert.equal(dataIcon.icon, 'data:image/png;base64,AAAA');
});

test('compatibility, update and size fields normalize from the installation view', function () {
  const game = normalizeGame(
    {
      id: 'jump',
      version: '1.0.0',
      installed: false,
      compatibility: { ok: true, reason: null },
    },
    {
      installedView: {
        id: 'jump',
        version: '1.0.0',
        sizeBytes: 482133,
        installedAt: '2026-10-01T00:00:00.000Z',
        compatibility: { status: 'incompatible', runtimeRange: '^2.0.0', reasons: ['runtime'] },
        update: { available: true, latestVersion: '1.1.0', reason: 'incompatible' },
      },
      registry: { id: 'jump', version: '1.1.0', package: { size: 500000 } },
    }
  );
  assert.equal(game.installed, true);
  assert.equal(game.installedVersion, '1.0.0');
  assert.equal(game.sizeBytes, 482133);
  assert.equal(game.compatibility.ok, false);
  assert.equal(game.compatibility.status, 'incompatible');
  assert.equal(game.compatibility.requiredRuntime, '2.0.0');
  assert.equal(game.updateAvailable, true);
  assert.equal(game.updateVersion, '1.1.0');
  assert.equal(game.updateReason, 'incompatible');
  assert.equal(game.installedAt, '2026-10-01T00:00:00.000Z');
});

test('normalizeDetailPayload handles the V1 wrapper and bare V0 records', function () {
  const wrapped = normalizeDetailPayload({
    game: { id: 'jump', name: 'Jump', version: '1.0.0', installed: true, capabilities: ['score'] },
    installed: { id: 'jump', version: '1.0.0', sizeBytes: 1000 },
    canContinue: true,
    bestScore: 42,
    registry: { id: 'jump', version: '1.0.0', package: { size: 1000 } },
  });
  assert.equal(wrapped.game.id, 'jump');
  assert.equal(wrapped.canContinue, true);
  assert.equal(wrapped.bestScore, 42);
  assert.equal(wrapped.game.installed, true);

  const bare = normalizeDetailPayload({ id: 'snake', name: 'Snake', version: '0.1.0', installed: true, canContinue: true, bestScore: 7 });
  assert.equal(bare.game.id, 'snake');
  assert.equal(bare.canContinue, true);
  assert.equal(bare.bestScore, 7);
  assert.equal(normalizeDetailPayload({}), null);
});

test('local search matches name, author, category label, tags and id', function () {
  const games = [
    makeGame('snake', { name: 'Snake', author: { name: 'DSH' }, categories: ['arcade'], tags: ['classic'] }),
    makeGame('jump', { name: '跳跃', author: { name: 'Studio X' }, categories: ['action'], tags: ['endless'] }),
    makeGame('2048', { name: '2048', author: { name: 'Puzzle Co' }, categories: ['puzzle'] }),
  ];
  assert.deepEqual(ids(filterCatalog(games, { query: 'snak', locale: 'en' })), ['snake']);
  assert.deepEqual(ids(filterCatalog(games, { query: 'STUDIO', locale: 'en' })), ['jump']);
  assert.deepEqual(ids(filterCatalog(games, { query: '街机', locale: 'zh' })), ['snake']);
  assert.deepEqual(ids(filterCatalog(games, { query: 'endless', locale: 'en' })), ['jump']);
  assert.deepEqual(ids(filterCatalog(games, { query: '2048', locale: 'en' })), ['2048']);
  assert.deepEqual(ids(filterCatalog(games, { query: 'studio puzzle', locale: 'en' })), []);
  assert.equal(filterCatalog(games, { query: '', locale: 'en' }).length, 3);
  assert.equal(matchesQuery(games[0], 'SNAKE', 'en'), true);
  assert.equal(matchesQuery(games[0], 'zzz', 'en'), false);
});

test('category filters accept ids and "all"', function () {
  const games = [makeGame('a', { categories: ['arcade'] }), makeGame('b', { categories: ['puzzle', 'strategy'] })];
  assert.deepEqual(ids(filterCatalog(games, { category: 'all', locale: 'en' })), ['a', 'b']);
  assert.deepEqual(ids(filterCatalog(games, { category: 'puzzle', locale: 'en' })), ['b']);
  assert.deepEqual(ids(filterCatalog(games, { category: 'card', locale: 'en' })), []);
  assert.equal(matchesCategory(games[0], 'arcade'), true);
  assert.equal(matchesCategory(games[0], 'ALL'), true);
});

test('catalog ordering puts installed games first and then uses name order', function () {
  const games = [
    makeGame('zeta', { installed: true }),
    makeGame('beta'),
    makeGame('alpha'),
    makeGame('gamma', { installed: true }),
  ];
  assert.deepEqual(ids(sortCatalog(games, 'en')), ['gamma', 'zeta', 'alpha', 'beta']);
});

test('hero picks the most recent resumable installed game', function () {
  const games = [
    makeGame('old', { installed: true, canContinue: true, lastPlayedAt: '2026-10-01T00:00:00.000Z' }),
    makeGame('newer', { installed: true, canContinue: true, lastPlayedAt: '2026-10-10T00:00:00.000Z' }),
    makeGame('not-installed', { canContinue: true, lastPlayedAt: '2026-10-17T00:00:00.000Z' }),
    makeGame('no-save', { installed: true }),
  ];
  assert.equal(selectHero(games).id, 'newer');
  assert.equal(selectHero([makeGame('installed-only', { installed: true })]), null);
});

test('sections follow PRD ordering, limits and offline rules', function () {
  const games = [
    makeGame('hero', { installed: true, canContinue: true, lastPlayedAt: '2026-10-01T00:00:00.000Z' }),
    makeGame('quick-installed', { quickPlay: true, installed: true, publishedAt: '2026-01-01T00:00:00.000Z' }),
    makeGame('quick-popular', { quickPlay: true, playCount: 9, publishedAt: '2026-02-01T00:00:00.000Z' }),
    makeGame('popular', { featured: true, publishedAt: '2026-03-01T00:00:00.000Z' }),
    makeGame('new', { publishedAt: '2026-10-10T00:00:00.000Z' }),
    makeGame('old', { publishedAt: '2025-10-10T00:00:00.000Z' }),
  ];
  const sections = selectSections(games, { now: NOW, locale: 'en' });
  assert.equal(sections.hero.id, 'hero');
  assert.deepEqual(ids(sections.quick), ['quick-installed', 'quick-popular']);
  assert.deepEqual(ids(sections.popular), ['popular']);
  assert.deepEqual(ids(sections.newGames), ['new']);
  assert.equal(sections.quick.some(function dup(game) { return game.id === 'hero'; }), false);
  assert.equal(isNewGame(games[4], NOW), true);
  assert.equal(isNewGame(games[5], NOW), false);
  assert.equal(isNewGame(makeGame('future', { publishedAt: '2027-01-01T00:00:00.000Z' }), NOW), false);

  const offline = selectSections(games, { now: NOW, locale: 'en', offline: true });
  assert.deepEqual(offline.quick, []);
  assert.deepEqual(offline.popular, []);
  assert.deepEqual(offline.newGames, []);
  assert.deepEqual(ids(offline.all), ['hero', 'quick-installed']);
});

test('section lists are capped at eight entries', function () {
  const quick = [];
  for (let index = 0; index < 12; index += 1) quick.push(makeGame('quick-' + index, { quickPlay: true }));
  const sections = selectSections(quick, { now: NOW, locale: 'en' });
  assert.equal(sections.quick.length, 8);
});

test('My Games ordering: resumable, then played, then newest install, then name', function () {
  const games = [
    makeGame('resume-old', { installed: true, canContinue: true, lastPlayedAt: '2026-10-01T00:00:00.000Z' }),
    makeGame('resume-new', { installed: true, canContinue: true, lastPlayedAt: '2026-10-02T00:00:00.000Z' }),
    makeGame('played', { installed: true, lastPlayedAt: '2026-09-01T00:00:00.000Z' }),
    makeGame('fresh-a', { installed: true, installedAt: '2026-10-03T00:00:00.000Z' }),
    makeGame('fresh-b', { installed: true, installedAt: '2026-10-04T00:00:00.000Z' }),
    makeGame('not-installed', {}),
  ];
  assert.deepEqual(ids(sortMyGames(games, 'en')), ['resume-new', 'resume-old', 'played', 'fresh-b', 'fresh-a']);
  assert.equal(installedGames(games).length, 5);
});

test('progress summary prefers score, then generic progress', function () {
  assert.equal(progressSummary(makeGame('a', { capabilities: ['score'], bestScore: 12 }), 'en').key, 'mygames.progress.score');
  assert.equal(progressSummary(makeGame('b', { capabilities: ['storage'], canContinue: true }), 'en').key, 'mygames.progress.generic');
  assert.equal(progressSummary(makeGame('c', { capabilities: ['storage'] }), 'en').key, 'mygames.progress.none');
});

test('permission line follows capabilities and rejects unknown declarations', function () {
  assert.equal(resolvePermissions(makeGame('none', { capabilities: [] })).key, 'detail.permissions.none');
  assert.equal(resolvePermissions(makeGame('both', { capabilities: ['storage', 'score'] })).key, 'detail.permissions.storageScore');
  assert.equal(resolvePermissions(makeGame('storage', { capabilities: ['storage'] })).key, 'detail.permissions.storage');
  const unknown = resolvePermissions(makeGame('unknown', { capabilities: ['network'] }));
  assert.equal(unknown.unknown, true);
  assert.equal(unknown.key, 'detail.permissions.unknown');
  const permissions = resolvePermissions(makeGame('perm', { capabilities: ['score'], permissions: { clipboard: true } }));
  assert.equal(permissions.unknown, true);
});

test('detail action matrix: install / incompatible / offline / cancel / retry', function () {
  const notInstalled = makeGame('jump');
  assert.equal(resolveDetailAction({ game: notInstalled, detailStatus: 'ready' }).kind, 'install');
  assert.equal(resolveDetailAction({ game: notInstalled, detailStatus: 'ready', offline: true }).disabled, true);
  const incompatible = makeGame('jump', { compatibility: { ok: false, reason: 'runtime', runtimeRange: '^2.0.0' } });
  const blocked = resolveDetailAction({ game: incompatible, detailStatus: 'ready' });
  assert.equal(blocked.kind, 'incompatible');
  assert.equal(blocked.disabled, true);
  assert.equal(blocked.reasonKey, 'detail.incompatible.reason');
  assert.equal(blocked.reasonParams.version, '2.0.0');

  const downloading = resolveDetailAction({
    game: notInstalled,
    detailStatus: 'ready',
    job: { stage: 'downloading', kind: 'install', percent: 42 },
  });
  assert.equal(downloading.kind, 'cancel-install');
  assert.equal(downloading.cleanup, false);
  assert.equal(downloading.percent, 42);
  const verifying = resolveDetailAction({
    game: notInstalled,
    detailStatus: 'ready',
    job: { stage: 'verifying', kind: 'install' },
  });
  assert.equal(verifying.cleanup, true);
  assert.equal(verifying.labelKey, 'detail.install.cancelCleanup');

  const failed = resolveDetailAction({
    game: notInstalled,
    detailStatus: 'ready',
    job: { stage: 'failed', kind: 'install', reasonKey: 'detail.install.failed.download', error: { code: 'GM-5034' } },
  });
  assert.equal(failed.kind, 'retry-install');
  assert.equal(failed.reasonKey, 'detail.install.failed.download');

  assert.equal(resolveDetailAction({ game: null, detailStatus: 'loading' }).kind, 'loading');
  assert.equal(resolveDetailAction({ game: null, detailStatus: 'error' }).kind, 'unavailable');
});

test('detail action matrix: play / continue / resume / update / reinstall', function () {
  const installed = makeGame('jump', { installed: true });
  assert.equal(resolveDetailAction({ game: installed, detailStatus: 'ready' }).kind, 'play');
  assert.equal(resolveDetailAction({ game: installed, detailStatus: 'ready', paused: true }).kind, 'resume');
  assert.equal(resolveDetailAction({ game: installed, detailStatus: 'ready', canContinue: true }).kind, 'continue');

  const update = makeGame('jump', { installed: true, updateAvailable: true, updateVersion: '1.1.0' });
  const updateAction = resolveDetailAction({ game: update, detailStatus: 'ready' });
  assert.equal(updateAction.kind, 'update');
  assert.equal(updateAction.secondary.kind, 'play-current');

  const blockedUpdate = makeGame('jump', { installed: true, updateAvailable: true, updateReason: 'incompatible' });
  const blockedAction = resolveDetailAction({ game: blockedUpdate, detailStatus: 'ready' });
  assert.equal(blockedAction.kind, 'play');
  assert.equal(blockedAction.secondary.kind, 'update-unavailable');
  assert.equal(blockedAction.secondary.disabled, true);

  const missing = makeGame('jump', { installed: true, missing: true });
  assert.equal(resolveDetailAction({ game: missing, detailStatus: 'ready' }).kind, 'reinstall');
  const broken = normalizeGame({ id: 'broken', version: '1.0.0', installed: true, compatibility: { status: 'broken' } });
  assert.equal(resolveDetailAction({ game: broken, detailStatus: 'ready' }).kind, 'reinstall');

  const offlineUpdate = makeGame('jump', { installed: true, updateAvailable: true, updateVersion: '1.1.0' });
  const offlineAction = resolveDetailAction({ game: offlineUpdate, detailStatus: 'ready', offline: true });
  assert.equal(offlineAction.kind, 'play');
  assert.equal(offlineAction.secondary.disabled, true);
  assert.equal(offlineAction.secondary.reasonKey, 'detail.reason.offline');

  const uninstalling = resolveDetailAction({
    game: installed,
    detailStatus: 'ready',
    job: { stage: 'installing', kind: 'uninstall' },
  });
  assert.equal(uninstalling.kind, 'uninstalling');
  assert.equal(uninstalling.disabled, true);
  assert.equal(detailActionReasonKey({ reasonKey: 'x' }), 'x');
});

test('screenshots, builtin/update helpers and cover tones behave deterministically', function () {
  const game = makeGame('shot', {
    screenshots: [
      '/api/game-market/preview?gameId=shot&file=screenshot-1',
      '/api/game-market/preview?gameId=shot&file=screenshot-2',
      '/api/game-market/preview?gameId=shot&file=screenshot-3',
      '/api/game-market/preview?gameId=shot&file=screenshot-4',
    ],
  });
  assert.equal(screenshotsFor(game, 3).length, 3);
  assert.equal(screenshotsFor(game).length, 3);
  assert.equal(isBuiltin(makeGame('snake', { builtin: true })), true);
  assert.equal(hasUpdate(makeGame('u', { updateAvailable: true })), true);
  assert.equal(initialFor('snake'), 'S');
  assert.equal(initialFor('跳跃'), '跳');
  assert.equal(initialFor(''), '?');
  const toneA = coverTone({ id: 'snake' });
  const toneB = coverTone({ id: 'snake' });
  assert.deepEqual(toneA, toneB);
  assert.ok(toneA.hue >= 0 && toneA.hue < 360);
});

test('local filtering of 500 games stays well under the 150ms budget', function () {
  const games = [];
  for (let index = 0; index < 500; index += 1) {
    games.push(makeGame('game-' + index, { name: 'Game ' + index, categories: [SHARED_CATEGORIES[index % SHARED_CATEGORIES.length]] }));
  }
  const started = process.hrtime.bigint();
  const result = filterCatalog(games, { query: 'game 42', category: 'all', locale: 'en' });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(result.length >= 1);
  assert.ok(elapsedMs < 150, 'filter took ' + elapsedMs + 'ms');
});

test('normalizeCatalog tolerates bare arrays and drops invalid entries', function () {
  const list = normalizeCatalog([{ id: 'a', name: 'A' }, { name: 'no id' }, null]);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'a');
  assert.deepEqual(normalizeCatalog(null), []);
});
