/** Market home: Hero / Quick Play / Popular / New / All games (PRD 9.3). */
import React from 'react';
import { authorName, categoryLabel, filterCatalog, installedGames, primaryCategory, selectHero, selectSections, } from '../catalog.js';
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

function heroLastPlayed(game, t, locale, now) {
  const relative = game.lastPlayedAt ? formatRelativeTime(game.lastPlayedAt, now, locale) : '';
  return relative ? t('market.hero.lastPlayed', { relativeTime: relative }) : '';
}

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
        h('p', { className: 'dgm-hero-kicker' }, t('market.section.continue')),
        h('h2', { className: 'dgm-hero-title', id: 'dgm-hero-title' }, t('market.hero.empty.title')),
        h('p', { className: 'dgm-hero-body' }, t('market.hero.empty.body')),
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
  const meta = heroLastPlayed(game, t, locale, now);
  const best = typeof game.bestScore === 'number' ? t('market.hero.best', { score: formatScore(game.bestScore, locale) }) : '';
  const tone = coverTone(game);
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
      h('span', { className: 'dgm-hero-art-fade', 'aria-hidden': 'true' })
    ),
    h(
      'div',
      { className: 'dgm-hero-copy' },
      h('p', { className: 'dgm-hero-kicker' }, t('market.section.continue')),
      h(
        'h2',
        { className: 'dgm-hero-title', id: 'dgm-hero-title' },
        h(
          'button',
          {
            type: 'button',
            className: 'dgm-hero-title-btn',
            onClick: function open() {
              if (props.onOpen) props.onOpen(game.id);
            },
          },
          game.name || game.id
        )
      ),
      h(
        'p',
        { className: 'dgm-hero-meta' },
        meta,
        meta && best ? h('span', { className: 'dgm-hero-sep', 'aria-hidden': 'true' }, '·') : null,
        best
      ),
      game.canContinue
        ? h('p', { className: 'dgm-hero-status' }, t('market.hero.paused'))
        : null,
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
        t('market.hero.continue')
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
      kicker: h('span', { 'aria-hidden': 'true' }, props.index),
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
  const allFiltered = searching
    ? filterCatalog(games, { query: ui.query, category: ui.category, offline: market.offline === true, locale: locale })
    : sections.all;
  const hasCatalog = games.length > 0;

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
    market.offline
      ? h(InlineBanner, {
          text: t('market.offline'),
          actionLabel: t('market.offline.retry'),
          onAction: props.onRetry,
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
          h(Hero, {
            hero: sections.hero,
            t: t,
            locale: locale,
            now: now,
            onPlay: props.onPlay,
            onOpen: props.onOpenGame,
            onBrowse: browseAll,
          }),
          sections.quick.length > 0
            ? h(
                Section,
                { index: '01', id: 'dgm-quick-title', title: t('market.section.quick'), meta: null },
                h(GameGrid, {
                  games: sections.quick,
                  t: t,
                  locale: locale,
                  onOpen: props.onOpenGame,
                  onPlay: props.onPlay,
                })
              )
            : null,
          sections.popular.length > 0
            ? h(
                Section,
                { index: '02', id: 'dgm-popular-title', title: t('market.section.popular'), meta: null },
                h(GameGrid, {
                  games: sections.popular,
                  t: t,
                  locale: locale,
                  onOpen: props.onOpenGame,
                  onPlay: props.onPlay,
                })
              )
            : null,
          sections.newGames.length > 0
            ? h(
                Section,
                { index: '03', id: 'dgm-new-title', title: t('market.section.new'), meta: null },
                h(GameGrid, {
                  games: sections.newGames,
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
                h('p', { className: 'dgm-section-kicker', 'aria-hidden': 'true' }, '04'),
                h('h2', { className: 'dgm-section-title', id: 'dgm-all-title' }, t('market.section.all'))
              ),
              h(FilterChips, {
                value: ui.category,
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
    h(
      'footer',
      { className: 'dgm-footer' },
      market.refreshedAt > 0
        ? h(
            'span',
            { className: 'dgm-footer-text' },
            t('market.footer.synced', {
              relativeTime: formatRelativeTime(new Date(market.refreshedAt).toISOString(), now, locale),
            })
          )
        : null,
      market.offline
        ? h(
            'span',
            { className: 'dgm-footer-offline' },
            h('span', { className: 'dgm-dot', 'aria-hidden': 'true' }),
            t('market.footer.offline')
          )
        : null
    )
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
