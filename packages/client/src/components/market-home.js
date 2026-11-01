/** Market home: Hero / Quick Play / Popular / New / All games (PRD 9.3). */
import React from 'react';
import { authorName, categoryLabel, coverTone, filterCatalog, installedGames, isInstalled, primaryCategory, selectHero, selectSections } from '../catalog.js';
import { countColumns, nextGridIndex } from '../keyboard.js';
import { formatCount, formatRelativeTime, formatScore } from '../format.js';
import { PlayIcon } from '../icons.js';
import { EmptyBlock, ErrorBlock, InlineBanner, LoadingBlock, SectionHeader, SkeletonCards } from './state-views.js';
import { GameCard } from './game-card.js';
import { GameCover } from './cover.js';
import { FilterChips } from './filter-chips.js';
import { SKELETON_DELAY_MS, SLOW_LOAD_MS } from '../constants.js';
import { useDelayedFlag } from '../hooks.js';

const h = React.createElement;

function Hero(props) {
  const game = props.hero;
  const t = props.t;
  const locale = props.locale;
  const now = props.now;
  if (!game) {
    return h(
      'section',
      { className: 'dgm-hero dgm-hero-intro', 'aria-labelledby': 'dgm-hero-title' },
      h(
        'div',
        { className: 'dgm-hero-intro-copy' },
        h('p', { className: 'dgm-hero-kicker' }, t('market.intro.title')),
        h('h2', { className: 'dgm-hero-title', id: 'dgm-hero-title' }, t('market.hero.empty.title')),
        h('p', { className: 'dgm-hero-body' }, t('market.hero.empty.body')),
        h(
          'p',
          { className: 'dgm-hero-count' },
          t('market.library.count', { count: formatCount(props.count || 0, locale) })
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dgm-btn dgm-btn-primary dgm-hero-cta',
            onClick: props.onBrowse,
          },
          h(PlayIcon, { size: 13 }),
          t('market.hero.empty.action')
        )
      ),
      h(
        'div',
        { className: 'dgm-hero-intro-art', 'aria-hidden': 'true' },
        h('span', { className: 'dgm-hero-intro-ring dgm-hero-intro-ring-a' }),
        h('span', { className: 'dgm-hero-intro-ring dgm-hero-intro-ring-b' }),
        h('span', { className: 'dgm-hero-intro-glyph' }, h(PlayIcon, { size: 28 }))
      )
    );
  }
  const tone = coverTone(game);
  const meta = [];
  if (game.lastPlayedAt) {
    meta.push(t('market.hero.lastPlayed', { relativeTime: formatRelativeTime(game.lastPlayedAt, now, locale) }));
  }
  if (typeof game.bestScore === 'number') {
    meta.push(t('market.hero.best', { score: formatScore(game.bestScore, locale) }));
  }
  const category = primaryCategory(game);
  if (category) meta.push(categoryLabel(category, locale));

  function openDetails() {
    if (props.onOpen) props.onOpen(game.id);
  }

  return h(
    'section',
    {
      className: 'dgm-hero',
      'aria-labelledby': 'dgm-hero-title',
      style: { '--dgm-tone-h': String(tone.hue), '--dgm-tone-h2': String(tone.hue2), '--dgm-tone-s': String(tone.saturation) + '%' },
    },
    h(
      'div',
      { className: 'dgm-hero-art' },
      h(GameCover, { game: game, variant: 'hero' }),
      h('span', { className: 'dgm-hero-art-fade', 'aria-hidden': 'true' }),
      h('span', { className: 'dgm-hero-art-edge', 'aria-hidden': 'true' })
    ),
    h(
      'div',
      { className: 'dgm-hero-copy' },
      h('p', { className: 'dgm-hero-kicker' }, t('market.hero.eyebrow')),
      h(
        'h2',
        { className: 'dgm-hero-title', id: 'dgm-hero-title' },
        h(
          'button',
          {
            type: 'button',
            className: 'dgm-hero-title-btn',
            onClick: openDetails,
          },
          game.name || game.id
        )
      ),
      h('p', { className: 'dgm-hero-body' }, t('market.hero.description')),
      meta.length > 0 ? h('p', { className: 'dgm-hero-meta' }, meta.map(function line(value, index) {
        return h('span', { key: 'meta-' + index }, value);
      })) : null,
      h(
        'div',
        { className: 'dgm-hero-actions' },
        h(
          'button',
          {
            type: 'button',
            className: 'dgm-btn dgm-btn-primary dgm-hero-cta',
            onClick: function play() {
              if (props.onPlay) props.onPlay(game);
            },
            'aria-label': t('market.hero.a11y', {
              gameName: game.name || game.id,
              relativeTime: game.lastPlayedAt ? formatRelativeTime(game.lastPlayedAt, now, locale) : '',
            }),
          },
          h(PlayIcon, { size: 13 }),
          t('market.card.continue')
        ),
        h('button', { type: 'button', className: 'dgm-hero-details', onClick: openDetails }, t('market.hero.details'))
      )
    )
  );
}

function GameGrid(props) {
  const gridRef = React.useRef(null);
  const games = props.games;
  const emptyLabel = props.emptyLabel;

  function handleKeyDown(event) {
    if (!event || !gridRef.current) return;
    const key = event.key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Home' && key !== 'End') {
      return;
    }
    const target = event.target;
    const card = target && typeof target.closest === 'function' ? target.closest('[data-card-id]') : null;
    if (!card) return;
    const cards = Array.prototype.slice.call(gridRef.current.querySelectorAll('[data-card-id]'));
    const index = cards.indexOf(card);
    if (index === -1) return;
    const offsets = cards.map(function offset(node) {
      return node.offsetTop;
    });
    const columns = countColumns(offsets);
    const next = nextGridIndex(index, key, columns, cards.length);
    if (next !== index) {
      event.preventDefault();
      cards[next].focus();
    }
  }

  if (games.length === 0) return emptyLabel || null;

  return h(
    'div',
    { className: 'dgm-grid', ref: gridRef, onKeyDown: handleKeyDown },
    games.map(function render(game, index) {
      return h(GameCard, {
        key: game.id,
        game: game,
        index: index,
        t: props.t,
        locale: props.locale,
        onOpen: props.onOpen,
        onPlay: props.onPlay,
      });
    })
  );
}

function Section(props) {
  return h(
    'section',
    { className: 'dgm-section', 'aria-labelledby': props.id },
    h(SectionHeader, {
      id: props.id,
      title: props.title,
      meta: props.meta,
    }),
    props.children
  );
}

/** Home page. */
export function MarketHome(props) {
  const state = props.state;
  const t = props.t;
  const locale = props.locale;
  const now = props.now;
  const ui = state.ui;
  const market = state.market;
  const games = Array.isArray(market.games) ? market.games : [];
  const loading = market.status === 'loading' || market.status === 'idle';
  const showSkeleton = useDelayedFlag(loading && games.length === 0, SKELETON_DELAY_MS);
  const slow = useDelayedFlag(loading && games.length === 0, SLOW_LOAD_MS);
  const query = ui.query.trim();
  const searching = query.length > 0;
  const sections = selectSections(games, {
    now: now,
    locale: locale,
    offline: market.offline === true,
    query: ui.query,
    category: ui.category,
  });
  const installedCount = installedGames(games).length;
  const seen = new Set();
  if (sections.hero) seen.add(sections.hero.id);
  const recentPool = games
    .filter(function played(game) {
      if (!isInstalled(game)) return false;
      if (!game.lastPlayedAt) return false;
      return sections.hero ? game.id !== sections.hero.id : true;
    })
    .sort(function compare(left, right) {
      return Date.parse(right.lastPlayedAt) - Date.parse(left.lastPlayedAt);
    });
  const recent = recentPool.slice(0, 8);
  // A shelf of one or two cards reads like a layout accident; only show it when
  // there is enough history to form a row.
  const showRecent = recent.length >= 4;
  if (showRecent) {
    for (const game of recent) seen.add(game.id);
  }
  const quick = sections.quick.filter(function unused(game) {
    if (seen.has(game.id)) return false;
    seen.add(game.id);
    return true;
  });
  const popular = sections.popular.filter(function unused(game) {
    if (seen.has(game.id)) return false;
    seen.add(game.id);
    return true;
  });
  const newGames = sections.newGames.filter(function unused(game) {
    if (seen.has(game.id)) return false;
    seen.add(game.id);
    return true;
  });
  const registry = market.registry;
  const registryFallback = Boolean(registry && registry.state === 'seed');
  const allFiltered = searching
    ? filterCatalog(games, { query: ui.query, category: ui.category, offline: market.offline === true, locale: locale })
    : sections.all;
  const hasCatalog = games.length > 0;
  const showCollections = ui.category === 'all';

  function browseAll() {
    if (props.onBrowseAll) props.onBrowseAll();
  }

  if (!hasCatalog) {
    if (market.status === 'error') {
      return h(
        'div',
        { className: 'dgm-home' },
        h(ErrorBlock, {
          t: t,
          title: t('market.error.title'),
          body: t('market.error.installedOnly'),
          code: market.error ? market.error.code : null,
          onRetry: props.onRetry,
          retryLabel: t('market.retry'),
        })
      );
    }
    if (showSkeleton) {
      return h(
        'div',
        { className: 'dgm-home' },
        h('span', { className: 'dgm-sr-only', role: 'status' }, t('market.loading')),
        h(SkeletonCards, { count: 8 }),
        slow ? h(LoadingBlock, { label: t('market.loading') }) : null
      );
    }
    return h(
      'div',
      { className: 'dgm-home' },
      h(EmptyBlock, {
        t: t,
        title: market.offline ? t('market.empty.offline') : t('market.empty.all'),
        body: market.offline ? t('market.empty.offline.body') : null,
        actionLabel: t('market.retry'),
        onAction: props.onRetry,
      })
    );
  }

  return h(
    'div',
    { className: 'dgm-home' },
    !sections.hero && !searching ? h('h1', { className: 'dgm-sr-only', 'data-page-heading': true, tabIndex: -1 }, t('market.intro.title')) : null,
    market.offline
      ? h(InlineBanner, {
          text: t('market.offline'),
          actionLabel: t('market.offline.retry'),
          onAction: props.onRetry,
        })
      : null,
    registryFallback
      ? h(InlineBanner, {
          text: t('market.seed'),
          actionLabel: t('market.seed.retry'),
          onAction: props.onRefreshRegistry || props.onRetry,
        })
      : null,
    market.status === 'error'
      ? h(InlineBanner, {
          text: t('market.error.title'),
          actionLabel: t('market.retry'),
          onAction: props.onRetry,
          role: 'alert',
        })
      : null,
    searching
      ? h(
          'div',
          { className: 'dgm-home-results' },
          h(
            'p',
            { className: 'dgm-results-count', role: 'status', 'aria-live': 'polite' },
            t('market.search.results', { count: formatCount(allFiltered.length, locale) })
          ),
          allFiltered.length === 0
            ? h(EmptyBlock, {
                t: t,
                title: t('market.search.empty'),
                onClear: props.onClearSearch,
              })
            : h(GameGrid, {
                games: allFiltered,
                t: t,
                locale: locale,
                onOpen: props.onOpenGame,
                onPlay: props.onPlay,
              })
        )
      : h(
          React.Fragment,
          null,
          ui.category === 'all' ? h(Hero, {
            hero: sections.hero,
            t: t,
            locale: locale,
            now: now,
            count: games.length,
            onPlay: props.onPlay,
            onOpen: props.onOpenGame,
            onBrowse: browseAll,
          }) : null,
          showCollections && showRecent
            ? h(
                Section,
                { id: 'dgm-recent-title', title: t('market.section.recent'), meta: null },
                h(GameGrid, {
                  games: recent,
                  t: t,
                  locale: locale,
                  onOpen: props.onOpenGame,
                  onPlay: props.onPlay,
                })
              )
            : null,
          showCollections && quick.length >= 3
            ? h(
                Section,
                { id: 'dgm-quick-title', title: t('market.section.quick'), meta: null },
                h(GameGrid, {
                  games: quick,
                  t: t,
                  locale: locale,
                  onOpen: props.onOpenGame,
                  onPlay: props.onPlay,
                })
              )
            : null,
          showCollections && popular.length >= 3
            ? h(
                Section,
                { id: 'dgm-popular-title', title: t('market.section.popular'), meta: null },
                h(GameGrid, {
                  games: popular,
                  t: t,
                  locale: locale,
                  onOpen: props.onOpenGame,
                  onPlay: props.onPlay,
                })
              )
            : null,
          showCollections && newGames.length >= 3
            ? h(
                Section,
                { id: 'dgm-new-title', title: t('market.section.new'), meta: null },
                h(GameGrid, {
                  games: newGames,
                  t: t,
                  locale: locale,
                  onOpen: props.onOpenGame,
                  onPlay: props.onPlay,
                })
              )
            : null,
          h(
            'section',
            { className: 'dgm-section dgm-section-all', 'aria-labelledby': 'dgm-all-title' },
            h(
              'div',
              { className: 'dgm-section-head' },
              h(
                'div',
                { className: 'dgm-section-titles' },
                h('h2', { className: 'dgm-section-title', id: 'dgm-all-title' }, t('market.section.all')),
                h('span', { className: 'dgm-catalog-count' }, t('market.library.count', { count: formatCount(sections.all.length, locale) }))
              ),
              h(FilterChips, {
                value: ui.category,
                games: games,
                onChange: props.onCategory,
                t: t,
              })
            ),
            sections.all.length === 0
              ? h(EmptyBlock, {
                  t: t,
                  title: market.offline && installedCount === 0 ? t('market.empty.offline') : t('market.empty.all'),
                  body: market.offline && installedCount === 0 ? t('market.empty.offline.body') : null,
                  actionLabel: t('market.retry'),
                  onAction: props.onRetry,
                })
              : h(GameGrid, {
                  games: sections.all,
                  t: t,
                  locale: locale,
                  onOpen: props.onOpenGame,
                  onPlay: props.onPlay,
                })
          )
        ),
  );
}

/** Small helper reused by My Games/Detail for the author/category line. */
export function gameSubtitle(game, t, locale) {
  const author = authorName(game);
  const category = primaryCategory(game);
  const parts = [];
  if (author) parts.push(author);
  if (category) parts.push(categoryLabel(category, locale));
  if (parts.length === 0) return t('market.card.noAuthor');
  return parts.join(' · ');
}
