/**
 * Market catalog logic: normalizes Host payloads, derives Home sections, applies
 * local search/category filters, orders My Games and resolves the single primary
 * action on the detail page (PRD 9.3 / 9.4 / 9.5).
 *
 * Everything here is pure so the interesting behaviour is testable without React.
 */
import { CATEGORY_ALL, CATEGORIES, NEW_WINDOW_MS, SECTION_LIMIT, INSTALL_ACTIVE_STAGES } from './constants.js';
import { translate } from './locale.js';
import { normalizeCategory } from './format.js';

const CAPABILITIES = Object.freeze(['storage', 'score']);
const SOURCES = Object.freeze(['builtin', 'registry', 'local', 'dev']);
const COMPAT_STATUSES = Object.freeze(['ok', 'incompatible', 'broken']);

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBool(value) {
  return value === true;
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  const output = [];
  for (const item of value) {
    const text = asString(item);
    if (text.length > 0 && output.indexOf(text) === -1) output.push(text);
  }
  return output;
}

function asIso(value) {
  const text = asString(value);
  if (text.length === 0) return null;
  return Number.isFinite(Date.parse(text)) ? text : null;
}

function pickNumber() {
  for (let index = 0; index < arguments.length; index += 1) {
    const value = asNumber(arguments[index]);
    if (value !== null) return value;
  }
  return null;
}

function sameOriginPreview(value) {
  const url = asString(value);
  if (url.length === 0) return null;
  if (url.indexOf('data:image/') === 0) return url;
  const relative = url.charAt(0) === '/' ? url : '/' + url;
  if (relative.indexOf('/api/game-market/preview') === 0) return relative;
  try {
    const location = globalThis.location;
    const origin = location && typeof location.origin === 'string' ? location.origin : '';
    if (!origin) return null;
    const parsed = new URL(url, origin);
    if (parsed.origin !== origin) return null;
    if (parsed.pathname !== '/api/game-market/preview') return null;
    return parsed.pathname + parsed.search;
  } catch (_error) {
    return null;
  }
}

function normalizeAuthor(value) {
  if (typeof value === 'string') {
    const name = asString(value);
    return name.length > 0 ? { name: name, url: null } : { name: '', url: null };
  }
  if (value && typeof value === 'object') {
    return { name: asString(value.name), url: asString(value.url) || null };
  }
  return { name: '', url: null };
}

function normalizeCategories(value, legacy) {
  const list = stringList(value);
  const categories = [];
  for (const item of list) {
    const key = normalizeCategory(item);
    if (CATEGORIES.indexOf(key) !== -1 && categories.indexOf(key) === -1) categories.push(key);
    else if (key.length > 0 && categories.indexOf(key) === -1) categories.push(key);
  }
  if (categories.length === 0) {
    const single = normalizeCategory(legacy);
    if (single.length > 0) categories.push(single);
  }
  return categories;
}

function normalizeCompatibility(raw, installedView) {
  const summary = raw && typeof raw.compatibility === 'object' ? raw.compatibility : null;
  const installed = installedView && typeof installedView.compatibility === 'object' ? installedView.compatibility : null;
  const source = installed || summary || {};
  const status = COMPAT_STATUSES.indexOf(source.status) !== -1 ? source.status : null;
  const ok = source.ok === false || status === 'incompatible' || status === 'broken' ? false : true;
  const reasons = stringList(source.reasons);
  const reason =
    asString(source.reason) ||
    reasons[0] ||
    (status === 'broken' ? 'missing-package' : status === 'incompatible' ? 'incompatible' : '');
  const range = asString(source.runtimeRange) || asString(source.sdkRange);
  return {
    ok: ok,
    status: status || (ok ? 'ok' : 'incompatible'),
    reason: reason.length > 0 ? reason : null,
    requiredRuntime: /^[\^~<>= ]*[0-9]/.test(range) ? range.replace(/^[\^~]\s*/, '') : null,
  };
}

function normalizeSource(rawSource, builtin, installed) {
  const source = asString(rawSource);
  if (SOURCES.indexOf(source) !== -1) return source;
  if (builtin === true) return 'builtin';
  if (installed) return 'registry';
  return 'registry';
}

/**
 * Normalize one GameSummary / GameDetail / V0 GameRecord.
 * Unknown fields are dropped; external image URLs never reach the renderer.
 */
export function normalizeGame(raw, options) {
  if (!raw || typeof raw !== 'object') return null;
  const opts = options && typeof options === 'object' ? options : {};
  const id = asString(raw.id);
  if (id.length === 0) return null;
  const installedView = opts.installedView || (raw.installedView && typeof raw.installedView === 'object' ? raw.installedView : null);
  const registry = opts.registry || (raw.registry && typeof raw.registry === 'object' ? raw.registry : null) || null;
  const registryPackage = registry && typeof registry.package === 'object' ? registry.package : null;
  const installedVersion =
    asString(raw.installedVersion) ||
    (installedView ? asString(installedView.version) : '') ||
    (raw.installed === true ? asString(raw.version) : '');
  const installed = raw.installed === true || installedVersion.length > 0 || Boolean(installedView);
  const update = installedView && installedView.update && typeof installedView.update === 'object' ? installedView.update : null;
  const updateAvailable = asBool(raw.updateAvailable) || Boolean(update && update.available === true);
  const updateVersion = asString(update && update.latestVersion) || asString(raw.latestVersion) || (updateAvailable ? asString(registry && registry.version) : '');
  const screenshots = stringList([].concat(Array.isArray(raw.screenshots) ? raw.screenshots : [], Array.isArray(registry && registry.screenshots) ? registry.screenshots : []))
    .map(sameOriginPreview)
    .filter(Boolean);
  const compatibility = normalizeCompatibility(raw, installedView);
  const missing = asBool(raw.missing) || asBool(raw.packageMissing) || asBool(raw.missingPackage);
  const description = asString(raw.description) || asString(registry && registry.description);
  const name = asString(raw.name) || asString(registry && registry.name) || id;
  return {
    id: id,
    name: name,
    version: asString(raw.version) || asString(installedView && installedView.version) || '',
    description: description,
    author: normalizeAuthor(raw.author && typeof raw.author === 'object' ? raw.author : registry && registry.author ? registry.author : raw.author),
    categories: normalizeCategories(raw.categories || (registry && registry.categories), raw.category),
    tags: stringList([].concat(Array.isArray(raw.tags) ? raw.tags : [], Array.isArray(registry && registry.tags) ? registry.tags : [])),
    capabilities: stringList(raw.capabilities || (registry && registry.capabilities)),
    permissions: raw.permissions && typeof raw.permissions === 'object' ? raw.permissions : null,
    sdkVersion: asString(raw.sdkVersion) || asString(registry && registry.sdkVersion),
    runtimeVersion: asString(raw.runtimeVersion) || asString(registry && registry.runtimeVersion),
    icon: sameOriginPreview(raw.icon) || sameOriginPreview(registry && registry.icon),
    cover: sameOriginPreview(raw.cover) || sameOriginPreview(registry && registry.cover),
    screenshots: screenshots.slice(0, 5),
    homepage: asString(raw.homepage) || asString(registry && registry.homepage) || null,
    repository: asString(raw.repository) || asString(registry && registry.repository) || null,
    license: asString(raw.license) || asString(registry && registry.license) || null,
    changelog: asString(registry && registry.changelog) || null,
    featured: asBool(raw.featured) || asBool(registry && registry.featured),
    quickPlay: asBool(raw.quickPlay) || asBool(registry && registry.quickPlay),
    publishedAt: asIso(raw.publishedAt) || asIso(registry && registry.publishedAt),
    updatedAt: asIso(raw.updatedAt) || asIso(installedView && installedView.updatedAt) || asIso(registry && registry.updatedAt),
    source: normalizeSource(raw.source, raw.builtin, installed),
    dev: asBool(raw.dev) || raw.source === 'dev',
    builtin: asBool(raw.builtin) || raw.source === 'builtin',
    installed: installed,
    installedVersion: installedVersion.length > 0 ? installedVersion : null,
    installedAt: asIso(raw.installedAt) || asIso(installedView && installedView.installedAt),
    updateAvailable: updateAvailable,
    updateVersion: updateVersion.length > 0 ? updateVersion : null,
    updateReason: asString(update && update.reason) || asString(raw.updateReason) || null,
    canContinue: asBool(raw.canContinue),
    bestScore: pickNumber(raw.bestScore, installedView && installedView.bestScore),
    lastPlayedAt: asIso(raw.lastPlayedAt) || asIso(installedView && installedView.lastPlayedAt),
    compatibility: compatibility,
    missing: Boolean(missing),
    activePlaySession: raw.activePlaySession && typeof raw.activePlaySession === 'object' ? raw.activePlaySession : null,
    saveInfo: raw.saveInfo && typeof raw.saveInfo === 'object' ? raw.saveInfo : null,
    preferredTheme: asString(raw.preferredTheme) || null,
    sizeBytes: pickNumber(installedView && installedView.sizeBytes, registryPackage && registryPackage.size, raw.sizeBytes),
    registryVersion: asString(registry && registry.version) || null,
    playCount: pickNumber(raw.playCount, installedView && installedView.playCount),
  };
}

/** Normalize a `GET /games` payload; tolerates a bare array and V0 records. */
export function normalizeCatalog(payload) {
  const items = Array.isArray(payload) ? payload : payload && Array.isArray(payload.items) ? payload.items : [];
  const games = [];
  for (const item of items) {
    const game = normalizeGame(item);
    if (game) games.push(game);
  }
  return games;
}

/** Normalize `GET /game` (V1 wrapper) or a bare V0 GameRecord. */
export function normalizeDetailPayload(payload) {
  const base = payload && typeof payload === 'object' ? payload : {};
  const rawGame = base.game && typeof base.game === 'object' ? base.game : base.id ? base : null;
  if (!rawGame) return null;
  const installed = base.installed && typeof base.installed === 'object' ? base.installed : base.installedView || null;
  const registry = base.registry && typeof base.registry === 'object' ? base.registry : null;
  const game = normalizeGame(rawGame, { installedView: installed, registry: registry });
  if (!game) return null;
  const canContinue = base.canContinue === true || game.canContinue;
  return {
    game: game,
    installed: installed,
    canContinue: canContinue,
    bestScore: asNumber(base.bestScore) !== null ? asNumber(base.bestScore) : game.bestScore,
    activePlaySession: base.activePlaySession && typeof base.activePlaySession === 'object' ? base.activePlaySession : game.activePlaySession,
    registry: registry,
  };
}

export function authorName(game) {
  return game && game.author && typeof game.author.name === 'string' && game.author.name.length > 0 ? game.author.name : '';
}

export function categoryLabelKey(category) {
  const key = normalizeCategory(category);
  if (CATEGORIES.indexOf(key) !== -1) return 'market.category.' + key;
  return 'market.category.unknown';
}

export function categoryLabel(category, locale) {
  return translate(locale || 'zh', categoryLabelKey(category));
}

/** First category id, or empty string. */
export function primaryCategory(game) {
  return game && Array.isArray(game.categories) && game.categories.length > 0 ? game.categories[0] : '';
}

export function isBuiltin(game) {
  return Boolean(game && (game.builtin === true || game.source === 'builtin'));
}

export function isInstalled(game) {
  return Boolean(game && game.installed === true);
}

export function hasUpdate(game) {
  return Boolean(game && game.updateAvailable === true);
}

/** Installed games, preserving caller order. */
export function installedGames(games) {
  return Array.isArray(games) ? games.filter(isInstalled) : [];
}

/** Collator with a deterministic fallback for old engines/tests. */
export function hasLocaleCollator() {
  return typeof Intl !== 'undefined' && typeof Intl.Collator === 'function';
}

export function createCollator(locale) {
  if (!hasLocaleCollator()) {
    return {
      compare: function compare(left, right) {
        const a = String(left || '').toLowerCase();
        const b = String(right || '').toLowerCase();
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      },
    };
  }
  try {
    return new Intl.Collator(locale || 'zh', { sensitivity: 'base', numeric: true });
  } catch (_error) {
    return new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  }
}

function compareNames(left, right, collator) {
  return collator.compare(left.name || left.id, right.name || right.id);
}

function timeValue(iso) {
  if (typeof iso !== 'string') return 0;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : 0;
}

function compareTimeDesc(leftIso, rightIso) {
  return timeValue(rightIso) - timeValue(leftIso);
}

/**
 * Local search over name, author, categories (id + localized label), tags and id.
 * Case-insensitive, prefix and substring; whitespace-separated tokens are ANDed.
 */
export function matchesQuery(game, query, locale) {
  const text = asString(query).toLowerCase();
  if (text.length === 0) return true;
  if (!game) return false;
  const fields = [game.name, game.id, authorName(game), game.description];
  for (const category of game.categories) {
    fields.push(category);
    fields.push(categoryLabel(category, locale));
  }
  for (const tag of game.tags) fields.push(tag);
  const haystack = fields
    .filter(function keep(value) {
      return typeof value === 'string' && value.length > 0;
    })
    .join(' ')
    .toLowerCase();
  const tokens = text.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (haystack.indexOf(token) === -1) return false;
  }
  return true;
}

/** Category filter; `all` (or empty) keeps everything. */
export function matchesCategory(game, category) {
  const key = normalizeCategory(category);
  if (key.length === 0 || key === CATEGORY_ALL) return true;
  return Boolean(game && Array.isArray(game.categories) && game.categories.indexOf(key) !== -1);
}

/** Default "All games" ordering: installed first, then locale-aware name order. */
export function sortCatalog(games, locale) {
  const collator = createCollator(locale);
  return [...games].sort(function compare(left, right) {
    const installedDelta = (isInstalled(right) ? 1 : 0) - (isInstalled(left) ? 1 : 0);
    if (installedDelta !== 0) return installedDelta;
    return compareNames(left, right, collator);
  });
}

/** Filter + order the searchable/paginated grid. */
export function filterCatalog(games, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const query = asString(opts.query);
  const category = normalizeCategory(opts.category || CATEGORY_ALL);
  const source = Array.isArray(games) ? games : [];
  const filtered = source.filter(function keep(game) {
    if (!game) return false;
    if (opts.offline === true && !isInstalled(game)) return false;
    if (!matchesCategory(game, category)) return false;
    return matchesQuery(game, query, opts.locale);
  });
  return sortCatalog(filtered, opts.locale);
}

/** Installed games with a resumable save, most recent first. */
export function selectHero(games) {
  const candidates = (Array.isArray(games) ? games : []).filter(function resumable(game) {
    return game && game.canContinue === true && isInstalled(game) && !game.missing;
  });
  if (candidates.length === 0) return null;
  candidates.sort(function compare(left, right) {
    return compareTimeDesc(left.lastPlayedAt, right.lastPlayedAt);
  });
  return candidates[0];
}

export function isNewGame(game, now) {
  if (!game || !game.publishedAt) return false;
  const clock = typeof now === 'number' ? now : Date.now();
  const published = Date.parse(game.publishedAt);
  if (!Number.isFinite(published)) return false;
  return published <= clock && clock - published <= NEW_WINDOW_MS;
}

function byLastPlayedThenName(locale) {
  const collator = createCollator(locale);
  return function compare(left, right) {
    const timeDelta = compareTimeDesc(left.lastPlayedAt, right.lastPlayedAt);
    if (timeDelta !== 0) return timeDelta;
    return compareNames(left, right, collator);
  };
}

/**
 * Home sections (PRD 9.3.3). Popular/New are hidden when empty; Quick Play puts
 * installed games first; Hero and Quick Play do not repeat.
 */
export function selectSections(games, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const locale = opts.locale;
  const offline = opts.offline === true;
  const source = (Array.isArray(games) ? games : []).filter(Boolean);
  const hero = selectHero(source);
  const collator = createCollator(locale);

  const quickPool = source.filter(function quick(game) {
    return game.quickPlay === true && !(hero && hero.id === game.id);
  });
  quickPool.sort(function compare(left, right) {
    const installedDelta = (isInstalled(right) ? 1 : 0) - (isInstalled(left) ? 1 : 0);
    if (installedDelta !== 0) return installedDelta;
    const playDelta = (right.playCount || 0) - (left.playCount || 0);
    if (playDelta !== 0) return playDelta;
    const timeDelta = compareTimeDesc(left.publishedAt, right.publishedAt);
    if (timeDelta !== 0) return timeDelta;
    return compareNames(left, right, collator);
  });

  const popular = source
    .filter(function featured(game) {
      return game.featured === true;
    })
    .sort(function compare(left, right) {
      const timeDelta = compareTimeDesc(left.publishedAt, right.publishedAt);
      if (timeDelta !== 0) return timeDelta;
      return compareNames(left, right, collator);
    })
    .slice(0, SECTION_LIMIT);

  const newest = source
    .filter(function published(game) {
      return isNewGame(game, now);
    })
    .sort(function compare(left, right) {
      const timeDelta = compareTimeDesc(left.publishedAt, right.publishedAt);
      if (timeDelta !== 0) return timeDelta;
      return compareNames(left, right, collator);
    })
    .slice(0, SECTION_LIMIT);

  return {
    hero: hero,
    quick: offline ? [] : quickPool.slice(0, SECTION_LIMIT),
    popular: offline ? [] : popular,
    newGames: offline ? [] : newest,
    all: filterCatalog(source, {
      query: opts.query,
      category: opts.category,
      offline: offline,
      locale: locale,
    }),
  };
}

/**
 * My Games ordering (PRD 9.4.1): resumable first, then played, then never played
 * (newest install first), and finally locale name order.
 */
export function sortMyGames(games, locale) {
  const collator = createCollator(locale);
  function rank(game) {
    if (game.canContinue === true) return 0;
    if (game.lastPlayedAt) return 1;
    return 2;
  }
  return (Array.isArray(games) ? games : []).filter(isInstalled).sort(function compare(left, right) {
    const rankDelta = rank(left) - rank(right);
    if (rankDelta !== 0) return rankDelta;
    if (rank(left) < 2) {
      const playedDelta = compareTimeDesc(left.lastPlayedAt, right.lastPlayedAt);
      if (playedDelta !== 0) return playedDelta;
    }
    const installedDelta = compareTimeDesc(left.installedAt || left.updatedAt, right.installedAt || right.updatedAt);
    if (installedDelta !== 0) return installedDelta;
    return compareNames(left, right, collator);
  });
}

/** Progress line for a My Games row (locale key + params). */
export function progressSummary(game, locale) {
  if (!game) return { key: 'mygames.progress.none', params: {} };
  const canScore = Array.isArray(game.capabilities) && game.capabilities.indexOf('score') !== -1;
  if (canScore && typeof game.bestScore === 'number') {
    return { key: 'mygames.progress.score', params: { score: game.bestScore } };
  }
  if (game.canContinue === true) return { key: 'mygames.progress.generic', params: {} };
  return { key: 'mygames.progress.none', params: {} };
}

/** Permit display line (PRD 9.5.4). */
export function resolvePermissions(game) {
  const capabilities = game && Array.isArray(game.capabilities) ? game.capabilities : [];
  const unknown = capabilities.some(function known(capability) {
    return CAPABILITIES.indexOf(capability) === -1;
  });
  const permissions = game && game.permissions && typeof game.permissions === 'object' ? game.permissions : null;
  const hasPermissions = permissions ? Object.keys(permissions).length > 0 : false;
  if (unknown || hasPermissions) {
    return { unknown: true, key: 'detail.permissions.unknown', noteKey: null };
  }
  const hasStorage = capabilities.indexOf('storage') !== -1;
  const hasScore = capabilities.indexOf('score') !== -1;
  let key = 'detail.permissions.none';
  if (hasStorage && hasScore) key = 'detail.permissions.storageScore';
  else if (hasStorage) key = 'detail.permissions.storage';
  else if (hasScore) key = 'detail.permissions.score';
  return { unknown: false, key: key, noteKey: 'detail.permissions.note' };
}

function activeJob(job) {
  return job && INSTALL_ACTIVE_STAGES.indexOf(job.stage) !== -1;
}

function isCancellable(stage) {
  return stage === 'queued' || stage === 'downloading' || stage === 'verifying' || stage === 'installing';
}

/**
 * Single primary action matrix (PRD 9.5.2).
 *
 * @param {{game: object|null, detailStatus: string, detailError: object|null,
 *   job: object|null, paused: boolean, offline: boolean, canContinue: boolean}} view
 */
export function resolveDetailAction(view) {
  const input = view && typeof view === 'object' ? view : {};
  if (input.detailStatus === 'loading') return { kind: 'loading', disabled: true };
  if (input.detailStatus === 'error' || !input.game) {
    return { kind: 'unavailable', disabled: true, error: input.detailError || null };
  }
  const game = input.game;
  const job = input.job || null;
  const installed = isInstalled(game);

  if (job && job.kind === 'uninstall' && (job.stage === 'queued' || job.stage === 'downloading' || job.stage === 'installing')) {
    return { kind: 'uninstalling', disabled: true, reasonKey: 'mygames.remove.busy' };
  }
  if (job && activeJob(job)) {
    const stage = job.stage;
    return {
      kind: 'cancel-install',
      stage: stage,
      percent: typeof job.percent === 'number' ? job.percent : null,
      cleanup: stage === 'verifying' || stage === 'installing',
      disabled: stage === 'queued' ? false : !isCancellable(stage),
      labelKey: stage === 'verifying' || stage === 'installing' ? 'detail.install.cancelCleanup' : 'detail.action.cancelInstall',
    };
  }
  if (job && job.stage === 'failed') {
    return {
      kind: 'retry-install',
      error: job.error || null,
      failureStage: job.failureStage || null,
      reasonKey: job.reasonKey || 'detail.install.failed.unknown',
      disabled: false,
    };
  }

  if (!installed) {
    if (input.offline === true) {
      return { kind: 'install', disabled: true, reasonKey: 'detail.reason.offline' };
    }
    if (!game.compatibility.ok) {
      return {
        kind: 'incompatible',
        disabled: true,
        reasonKey: 'detail.incompatible.reason',
        reasonParams: { version: game.compatibility.requiredRuntime || '1.0.0' },
        secondary: { kind: 'check-update', labelKey: 'detail.action.checkUpdate' },
      };
    }
    return { kind: 'install', disabled: false, labelKey: 'detail.action.install' };
  }

  if (game.missing === true || game.compatibility.status === 'broken') {
    return {
      kind: 'reinstall',
      disabled: false,
      labelKey: 'detail.action.reinstall',
      reasonKey: 'detail.reason.missingPackage',
      secondary: { kind: 'uninstall', labelKey: 'mygames.menu.uninstall' },
    };
  }

  if (game.updateAvailable === true) {
    if (input.offline === true) {
      const offlinePrimary = input.paused === true ? 'resume' : input.canContinue === true || game.canContinue === true ? 'continue' : 'play';
      return {
        kind: offlinePrimary,
        disabled: false,
        secondary: {
          kind: 'update-unavailable',
          disabled: true,
          labelKey: 'detail.action.updateUnavailable',
          reasonKey: 'detail.reason.offline',
        },
      };
    }
    const blocked = game.updateReason === 'incompatible' || game.compatibility.ok === false;
    if (blocked) {
      const primary = input.paused === true ? 'resume' : input.canContinue === true || game.canContinue === true ? 'continue' : 'play';
      return {
        kind: primary,
        disabled: false,
        secondary: {
          kind: 'update-unavailable',
          disabled: true,
          labelKey: 'detail.action.updateUnavailable',
          reasonKey: 'detail.update.incompatible',
          reasonParams: { reason: game.updateReason || 'incompatible' },
        },
      };
    }
    return {
      kind: 'update',
      disabled: false,
      labelKey: 'detail.action.update',
      secondary: { kind: 'play-current', labelKey: 'detail.action.playCurrent' },
    };
  }

  if (input.paused === true) {
    return { kind: 'resume', disabled: false, labelKey: 'detail.action.resume' };
  }
  if (input.canContinue === true || game.canContinue === true) {
    return {
      kind: 'continue',
      disabled: false,
      labelKey: 'detail.action.continue',
      secondary: { kind: 'restart', labelKey: 'mygames.menu.restart' },
    };
  }
  return { kind: 'play', disabled: false, labelKey: 'detail.action.play' };
}

/** Copy key for a primary action line under the button. */
export function detailActionReasonKey(action) {
  if (!action || typeof action !== 'object') return null;
  return action.reasonKey || null;
}

/** Deterministic hue pair used by procedural cover art (content layer only). */
export function coverTone(game) {
  const seed = String((game && (game.id || game.name)) || 'game');
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 360;
  }
  const hue = hash;
  return {
    hue: hue,
    hue2: (hue + 42) % 360,
    saturation: 48 + (hash % 17),
  };
}

/** First printable character for the cover placeholder. */
export function initialFor(name) {
  const text = asString(name);
  if (text.length === 0) return '?';
  const chars = Array.from(text);
  return chars[0].toUpperCase();
}

/** Selected screenshots for the detail gallery (max 3 by PRD 9.5.1). */
export function screenshotsFor(game, limit) {
  const list = game && Array.isArray(game.screenshots) ? game.screenshots : [];
  const max = typeof limit === 'number' ? limit : 3;
  return list.slice(0, max);
}

/** Image URL for a game cover, falling back to the icon. */
export function coverImageFor(game) {
  if (!game) return null;
  return game.cover || game.icon || null;
}
