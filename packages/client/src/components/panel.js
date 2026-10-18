/** Game Market main panel: header, Market / My Games, and the Runtime switch. */
import React from 'react';
import { store, pageChanged, sessionBound, surfaceChanged } from '../store.js';
import { PAGES, MAIN_PANEL_KEY } from '../constants.js';
import { agentMatchesSession, isAgentFresh } from '../chip-state.js';
import { beginGame, launchModeFor, refreshMarket } from '../actions.js';
import { getApiClient } from '../api.js';
import { makeT, detectLocale } from '../locale.js';
import { formatCategory, formatRelativeTime, formatScore } from '../format.js';
import { BackIcon, GamepadIcon, PlayIcon } from '../icons.js';
import { StyleTag } from '../styles.js';
import { backToConversation, openGameMarket } from '../navigation.js';
import { useActivePanel, useClock, useSessionBinding, useStoreState } from '../hooks.js';
import { RuntimeView } from './runtime.js';

const h = React.createElement;

function headerBack() {
  backToConversation();
}

function openPanel() {
  openGameMarket();
}

function metaLine(game, t) {
  const author = game && typeof game.author === 'string' && game.author.length > 0 ? game.author : t('market.source.builtin');
  const category = formatCategory(game && game.categories);
  if (!category) return author;
  return t('market.card.authorMeta', { author: author, category: category });
}

function bestText(value, t, locale) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return t('market.card.noBest');
  return t('market.card.best', { score: formatScore(value, locale) });
}

function lastPlayedText(value, now, t, locale) {
  if (typeof value !== 'string' || value.length === 0) return t('market.card.neverPlayed');
  const relative = formatRelativeTime(value, now, locale);
  return relative ? t('market.card.lastPlayed', { relativeTime: relative }) : t('market.card.neverPlayed');
}

function LoadingState(props) {
  return h(
    'div',
    { className: 'dgm-state', role: 'status' },
    h('span', { className: 'dgm-spinner', 'aria-hidden': 'true' }),
    h('p', { className: 'dgm-state-body' }, props.label)
  );
}

function ErrorState(props) {
  return h(
    'div',
    { className: 'dgm-state', role: 'alert' },
    h('p', { className: 'dgm-state-title' }, props.title),
    h(
      'button',
      { type: 'button', className: 'dgm-btn dgm-btn-quiet', onClick: props.onRetry },
      props.retryLabel
    )
  );
}

function EmptyState(props) {
  return h(
    'div',
    { className: 'dgm-state' },
    h(GamepadIcon, { size: 30 }),
    h('p', { className: 'dgm-state-title' }, props.title),
    props.actionLabel
      ? h('button', { type: 'button', className: 'dgm-btn', onClick: props.onAction }, props.actionLabel)
      : null
  );
}

function launchGame(game) {
  if (!game || typeof game.id !== 'string') return;
  beginGame(store, { gameId: game.id, mode: launchModeFor(game) });
}

function GameCard(props) {
  const game = props.game;
  const t = props.t;
  const locale = props.locale;
  const now = props.now;
  const continueAvailable = game.canContinue === true;
  return h(
    'article',
    { className: 'dgm-card', 'data-game-id': game.id },
    h(
      'div',
      { className: 'dgm-card-cover' },
      h('span', { className: 'dgm-card-cover-mark' }, h(GamepadIcon, { size: 34 })),
      game.builtin ? h('span', { className: 'dgm-card-source' }, t('market.source.builtin')) : null
    ),
    h('h3', { className: 'dgm-card-title' }, game.name || game.id),
    h('p', { className: 'dgm-card-meta' }, metaLine(game, t)),
    h(
      'div',
      { className: 'dgm-card-foot' },
      h(
        'div',
        { className: 'dgm-card-stats' },
        h('span', { className: 'dgm-card-stat-strong' }, bestText(game.bestScore, t, locale)),
        h('span', { className: 'dgm-card-stat' }, lastPlayedText(game.lastPlayedAt, now, t, locale))
      ),
      continueAvailable
        ? h('span', { className: 'dgm-badge dgm-badge-continue' }, t('market.card.continueAvailable'))
        : game.installed
          ? h('span', { className: 'dgm-badge dgm-badge-installed' }, t('market.card.installed'))
          : null
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'dgm-btn dgm-btn-primary',
        onClick: function play() {
          launchGame(game);
        },
      },
      h(PlayIcon),
      continueAvailable ? t('market.card.continue') : t('market.card.play')
    )
  );
}

function MarketPage(props) {
  const state = props.state;
  const t = props.t;
  const locale = props.locale;
  const now = props.now;
  const games = Array.isArray(state.market.games) ? state.market.games : [];

  if (games.length === 0) {
    if (state.market.status === 'loading') return h(LoadingState, { label: t('market.loading') });
    if (state.market.status === 'error') {
      return h(ErrorState, {
        title: t('market.error.title'),
        retryLabel: t('market.error.retry'),
        onRetry: props.onRetry,
      });
    }
    return h(EmptyState, { title: t('market.empty.all') });
  }

  return h(
    React.Fragment,
    null,
    state.market.status === 'error'
      ? h(
          'div',
          { className: 'dgm-banner', role: 'alert' },
          h('span', { className: 'dgm-banner-text' }, t('market.error.title')),
          h('button', { type: 'button', className: 'dgm-banner-action', onClick: props.onRetry }, t('market.error.retry'))
        )
      : null,
    h('h2', { className: 'dgm-section-title' }, t('market.section.all')),
    h(
      'div',
      { className: 'dgm-grid' },
      games.map(function renderCard(game) {
        return h(GameCard, { key: game.id, game: game, t: t, locale: locale, now: now });
      })
    )
  );
}

function MyGamesPage(props) {
  const state = props.state;
  const t = props.t;
  const locale = props.locale;
  const now = props.now;
  const installed = (Array.isArray(state.market.games) ? state.market.games : []).filter(function isInstalled(game) {
    return game && game.installed !== false;
  });

  if (installed.length === 0) {
    if (state.market.status === 'loading') return h(LoadingState, { label: t('mygames.loading') });
    if (state.market.status === 'error') {
      return h(ErrorState, {
        title: t('mygames.error.load'),
        retryLabel: t('market.error.retry'),
        onRetry: props.onRetry,
      });
    }
    return h(EmptyState, {
      title: t('mygames.empty.title'),
      actionLabel: t('mygames.empty.action'),
      onAction: function goMarket() {
        store.dispatch(pageChanged(PAGES.MARKET));
      },
    });
  }

  return h(
    'div',
    { className: 'dgm-list', role: 'list' },
    installed.map(function renderRow(game) {
      const continueAvailable = game.canContinue === true;
      return h(
        'div',
        { key: game.id, className: 'dgm-row', role: 'listitem', 'data-game-id': game.id },
        h('span', { className: 'dgm-row-cover' }, h(GamepadIcon, { size: 24 })),
        h(
          'span',
          { className: 'dgm-row-main' },
          h('span', { className: 'dgm-row-title' }, game.name || game.id),
          h('span', { className: 'dgm-row-meta' }, bestText(game.bestScore, t, locale)),
          h('span', { className: 'dgm-row-meta' }, lastPlayedText(game.lastPlayedAt, now, t, locale))
        ),
        h(
          'span',
          { className: 'dgm-row-actions' },
          continueAvailable ? h('span', { className: 'dgm-badge dgm-badge-continue' }, t('market.card.continueAvailable')) : null,
          h(
            'button',
            {
              type: 'button',
              className: continueAvailable ? 'dgm-btn dgm-btn-primary' : 'dgm-btn',
              onClick: function play() {
                launchGame(game);
              },
            },
            continueAvailable ? t('mygames.action.continue') : t('mygames.action.play')
          )
        )
      );
    })
  );
}

export function GameMarketPanel(props) {
  const state = useStoreState();
  const now = useClock(1000);
  const diagnosticRef = React.useRef(false);
  const activePanelId = useActivePanel(props, diagnosticRef);
  const binding = useSessionBinding(props, diagnosticRef);
  const locale = detectLocale();
  const t = makeT(props && props.t, locale);
  const headingRef = React.useRef(null);

  const sessionId = binding.sessionId || state.bindingSessionId;

  React.useEffect(
    function bindPanelSession() {
      if (binding.sessionId && binding.sessionId !== store.getState().bindingSessionId) {
        store.dispatch(sessionBound(binding.sessionId));
      }
    },
    [binding.sessionId]
  );

  React.useEffect(
    function markActivePanel() {
      store.dispatch(surfaceChanged('activePanelId', activePanelId === undefined ? null : activePanelId));
      return function unmountPanel() {
        store.dispatch(surfaceChanged('activePanelId', null));
      };
    },
    [activePanelId]
  );

  React.useEffect(
    function loadMarketWhenNeeded() {
      if (state.page === PAGES.RUNTIME) return;
      if (state.market.status !== 'idle') return;
      void refreshMarket({ store: store, api: getApiClient(), now: Date.now() });
    },
    [state.page, state.market.status]
  );

  React.useEffect(
    function focusHeadingOnMount() {
      if (state.page === PAGES.RUNTIME) return;
      const heading = headingRef.current;
      if (heading && typeof heading.focus === 'function') {
        try {
          heading.focus({ preventScroll: true });
        } catch (_error) {
          heading.focus();
        }
      }
    },
    [state.page]
  );

  const waiting =
    isAgentFresh(state.agentFetchedAt, now) &&
    state.agent &&
    state.agent.state === 'waiting-user' &&
    agentMatchesSession(state.agent, sessionId);

  if (state.page === PAGES.RUNTIME) {
    return h(
      'div',
      { className: 'dgm-root', 'data-page': PAGES.RUNTIME, 'data-panel': MAIN_PANEL_KEY },
      h(StyleTag),
      h(RuntimeView, { t: props && props.t, onBack: headerBack, onOpenPanel: openPanel })
    );
  }

  return h(
    'div',
    { className: 'dgm-root', 'data-page': state.page, 'data-panel': MAIN_PANEL_KEY },
    h(StyleTag),
    h(
      'header',
      { className: 'dgm-header' },
      h(
        'button',
        {
          type: 'button',
          className: 'dgm-icon-btn',
          onClick: headerBack,
          'aria-label': t('panel.backToConversation'),
          title: t('panel.backToConversation'),
        },
        h(BackIcon)
      ),
      h('h1', { className: 'dgm-title', ref: headingRef, tabIndex: -1 }, t('panel.title')),
      h(
        'div',
        { className: 'dgm-tabs', role: 'tablist', 'aria-label': t('panel.title') },
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            className: 'dgm-tab',
            'data-active': state.page === PAGES.MARKET ? 'true' : 'false',
            'aria-selected': state.page === PAGES.MARKET ? 'true' : 'false',
            onClick: function marketTab() {
              store.dispatch(pageChanged(PAGES.MARKET));
            },
          },
          t('panel.tab.market')
        ),
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            className: 'dgm-tab',
            'data-active': state.page === PAGES.MY_GAMES ? 'true' : 'false',
            'aria-selected': state.page === PAGES.MY_GAMES ? 'true' : 'false',
            onClick: function myGamesTab() {
              store.dispatch(pageChanged(PAGES.MY_GAMES));
            },
          },
          t('panel.tab.mygames')
        )
      ),
      h('span', { className: 'dgm-spacer' }),
      state.market.refreshedAt > 0
        ? h(
            'span',
            { className: 'dgm-card-stat' },
            t('panel.synced', {
              relativeTime: formatRelativeTime(new Date(state.market.refreshedAt).toISOString(), now, locale),
            })
          )
        : null
    ),
    waiting
      ? h(
          'div',
          { className: 'dgm-banner', 'aria-live': 'polite' },
          h('span', { className: 'dgm-banner-icon' }, h(GamepadIcon, { size: 14 })),
          h('span', { className: 'dgm-banner-text' }, t('market.waiting.banner')),
          h(
            'button',
            { type: 'button', className: 'dgm-banner-action', onClick: headerBack },
            t('market.waiting.action')
          )
        )
      : null,
    h(
      'main',
      { className: 'dgm-content' },
      h(
        'div',
        { className: 'dgm-content-narrow' },
        state.page === PAGES.MY_GAMES
          ? h(MyGamesPage, {
              state: state,
              t: t,
              locale: locale,
              now: now,
              onRetry: function retry() {
                void refreshMarket({ store: store, api: getApiClient(), now: Date.now() });
              },
            })
          : h(MarketPage, {
              state: state,
              t: t,
              locale: locale,
              now: now,
              onRetry: function retry() {
                void refreshMarket({ store: store, api: getApiClient(), now: Date.now() });
              },
            })
      )
    )
  );
}
