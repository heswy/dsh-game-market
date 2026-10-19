/** Game Market main panel: header, Market / My Games / Detail, and the Runtime switch. */
import React from 'react';
import { store, pageChanged, sessionBound, surfaceChanged, queryDraftChanged, queryApplied, categoryChanged, filtersCleared, searchOpenChanged, scrollSaved, lightboxChanged, dialogOpened, dialogDeleteDataChanged, dialogConfirmAgain, dialogBusyChanged, dialogClosed, toastDismissed, focusConsumed, } from '../store.js';
import { PAGES, MAIN_PANEL_KEY, MAX_SCREENSHOTS } from '../constants.js';
import { agentMatchesSession, isAgentFresh } from '../chip-state.js';
import { isBuiltin, screenshotsFor } from '../catalog.js';
import { acknowledgeCompleted, beginGame, cancelInstall, closeDetail, installLocalGame, launchModeFor, loadCatalog, loadDetail, openDetail, pushToast, refreshRegistryAction, startInstall, uninstallGame, } from '../actions.js';
import { getApiClient, getMarketApi } from '../api.js';
import { makeT, detectLocale } from '../locale.js';
import { BackIcon, MoreIcon, UploadIcon } from '../icons.js';
import { StyleTag } from '../styles.js';
import { backToConversation, openGameMarket } from '../navigation.js';
import { useActivePanel, useClock, useSessionBinding, useStoreState } from '../hooks.js';
import { isImeComposing, isSearchShortcut, resolveEscapeAction } from '../keyboard.js';
import { RuntimeView } from './runtime.js';
import { MarketHome } from './market-home.js';
import { MyGamesPage } from './my-games.js';
import { GameDetail } from './detail.js';
import { ConfirmDialog, Lightbox } from './dialogs.js';
import { ToastViewport } from './toast.js';
import { PopoverMenu } from './menu.js';
import { SearchBox, SearchToggle } from './search-box.js';

const h = React.createElement;
const MAX_LOCAL_BYTES = 20 * 1024 * 1024;

function pageScrollKey(page) {
  return page === PAGES.MY_GAMES ? 'my-games' : 'market';
}

function headerBack() {
  const current = store.getState();
  const agent = current.agent;
  if (agent && agent.state === 'completed' && agent.sessionId) {
    void acknowledgeCompleted({
      store: store,
      api: getApiClient(),
      sessionId: agent.sessionId,
      seq: agent.seq,
    });
  }
  backToConversation();
}

function openPanel() {
  openGameMarket();
}

export function GameMarketPanel(props) {
  const state = useStoreState();
  const now = useClock(1000);
  const diagnosticRef = React.useRef(false);
  const activePanelId = useActivePanel(props, diagnosticRef);
  const binding = useSessionBinding(props, diagnosticRef);
  const locale = detectLocale(props && props.t);
  const t = makeT(props && props.t, locale);
  const rootRef = React.useRef(null);
  const scrollRef = React.useRef(null);
  const searchRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const menuButtonRef = React.useRef(null);
  const prevPageRef = React.useRef(null);
  const staleRefreshRef = React.useRef(false);
  const [headerMenuOpen, setHeaderMenuOpen] = React.useState(false);

  const sessionId = binding.sessionId || state.bindingSessionId;
  const api = getMarketApi();
  const detailGame = state.detail.view ? state.detail.view.game : null;
  const detailScreenshots = detailGame ? screenshotsFor(detailGame, MAX_SCREENSHOTS) : [];
  const scrollKey = pageScrollKey(state.page);

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
      void loadCatalog({ store: store, api: getMarketApi(), now: Date.now() });
    },
    [state.page, state.market.status]
  );

  React.useEffect(
    function closeHeaderMenuOnPageChange() {
      setHeaderMenuOpen(false);
    },
    [state.page]
  );

  React.useEffect(
    function refreshStaleRegistryOnce() {
      if (state.page === PAGES.RUNTIME) return;
      if (staleRefreshRef.current) return;
      const registry = state.market.registry;
      if (!registry || registry.state !== 'stale') return;
      staleRefreshRef.current = true;
      void refreshRegistryAction({ store: store, api: getMarketApi(), force: false, silent: true });
    },
    [state.page, state.market.registry]
  );

  React.useEffect(
    function refreshWhenBackOnline() {
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined;
      function onOnline() {
        void loadCatalog({ store: store, api: getMarketApi(), now: Date.now() });
      }
      window.addEventListener('online', onOnline);
      return function cleanup() {
        window.removeEventListener('online', onOnline);
      };
    },
    []
  );

  React.useEffect(
    function restoreScrollAndFocus() {
      const previous = prevPageRef.current;
      const scrollNode = scrollRef.current;
      if (scrollNode && previous !== null && previous !== state.page) {
        if (state.page === PAGES.DETAIL) {
          if (previous === PAGES.MARKET || previous === PAGES.MY_GAMES) {
            store.dispatch(scrollSaved(pageScrollKey(previous), scrollNode.scrollTop));
          }
          scrollNode.scrollTop = 0;
        } else if (previous === PAGES.DETAIL) {
          const top = state.scroll[pageScrollKey(state.page)] || 0;
          requestAnimationFrame(function restore() {
            if (scrollRef.current) scrollRef.current.scrollTop = top;
          });
        }
      }
      prevPageRef.current = state.page;

      const pageChangedSince = previous !== state.page;
      const intent = state.focus;
      const frame = requestAnimationFrame(function applyFocus() {
        const root = rootRef.current;
        if (!root) {
          if (intent) store.dispatch(focusConsumed());
          return;
        }
        function focusHeading() {
          const node = root.querySelector('[data-page-heading]');
          if (node && typeof node.focus === 'function') node.focus();
        }
        if (intent && intent.kind === 'card' && intent.gameId) {
          const card = root.querySelector('[data-card-id="' + intent.gameId + '"]');
          if (card && typeof card.focus === 'function') card.focus();
          else focusHeading();
          store.dispatch(focusConsumed());
          return;
        }
        if (intent && intent.kind === 'row' && intent.gameId) {
          const rowButton = root.querySelector('[data-row-id="' + intent.gameId + '"] [data-row-primary]');
          if (rowButton && typeof rowButton.focus === 'function') rowButton.focus();
          else focusHeading();
          store.dispatch(focusConsumed());
          return;
        }
        if (intent && intent.kind === 'menu' && intent.gameId) {
          const button = root.querySelector('[data-row-id="' + intent.gameId + '"] [data-row-menu]');
          if (button && typeof button.focus === 'function') button.focus();
          else focusHeading();
          store.dispatch(focusConsumed());
          return;
        }
        if (intent && intent.kind === 'heading') {
          const headingNode = root.querySelector('[data-page-heading]');
          if (headingNode && typeof headingNode.focus === 'function') headingNode.focus();
          store.dispatch(focusConsumed());
          return;
        }
        if (intent && intent.kind === 'local-install') {
          const localButton = root.querySelector('.dgm-local-install');
          if (localButton && typeof localButton.focus === 'function') localButton.focus();
          store.dispatch(focusConsumed());
          return;
        }
        if (intent) {
          store.dispatch(focusConsumed());
          return;
        }
        if (pageChangedSince) {
          const heading = root.querySelector('[data-page-heading]');
          if (heading && typeof heading.focus === 'function') {
            try {
              heading.focus({ preventScroll: true });
            } catch (_error) {
              heading.focus();
            }
          }
        }
      });
      return function cancelFrame() {
        cancelAnimationFrame(frame);
      };
    },
    [state.page, state.focus, state.scroll]
  );

  React.useEffect(
    function globalKeys() {
      function onKeyDown(event) {
        if (isImeComposing(event)) return;
        if (state.dialog || state.ui.lightbox !== null) return;
        if (isSearchShortcut(event)) {
          event.preventDefault();
          focusSearch();
          return;
        }
        if (event.key !== 'Escape') return;
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        const searchFocused = Boolean(searchRef.current && active === searchRef.current);
        const action = resolveEscapeAction({
          searchOpen: state.ui.searchOpen,
          searchFocused: searchFocused,
          searchHasValue: state.ui.draftQuery.length > 0,
          detail: state.page === PAGES.DETAIL,
          menu: headerMenuOpen,
        });
        if (action === 'none') return;
        event.preventDefault();
        if (action === 'close-menu') {
          setHeaderMenuOpen(false);
          if (menuButtonRef.current) menuButtonRef.current.focus();
        } else if (action === 'close-search') {
          store.dispatch(searchOpenChanged(false));
        } else if (action === 'clear-search') {
          clearSearch();
        } else if (action === 'blur-search' && searchRef.current) {
          searchRef.current.blur();
        } else if (action === 'back-detail') {
          closeDetail(store);
        }
      }
      document.addEventListener('keydown', onKeyDown);
      return function cleanup() {
        document.removeEventListener('keydown', onKeyDown);
      };
    },
    [state.dialog, state.ui.lightbox, state.ui.searchOpen, state.ui.draftQuery, state.page, headerMenuOpen]
  );

  const waiting =
    isAgentFresh(state.agentFetchedAt, now) &&
    state.agent &&
    state.agent.state === 'waiting-user' &&
    agentMatchesSession(state.agent, sessionId);

  function focusSearch() {
    store.dispatch(searchOpenChanged(true));
    requestAnimationFrame(function focusInput() {
      const input = searchRef.current;
      if (input && typeof input.focus === 'function') input.focus();
    });
  }

  function clearSearch() {
    store.dispatch(queryDraftChanged(''));
    store.dispatch(queryApplied(''));
    if (searchRef.current) searchRef.current.focus();
  }

  function switchPage(next) {
    if (state.page === next) return;
    const node = scrollRef.current;
    if (node && (state.page === PAGES.MARKET || state.page === PAGES.MY_GAMES)) {
      store.dispatch(scrollSaved(pageScrollKey(state.page), node.scrollTop));
    }
    store.dispatch(pageChanged(next));
    const top = store.getState().scroll[pageScrollKey(next)] || 0;
    requestAnimationFrame(function restore() {
      if (scrollRef.current) scrollRef.current.scrollTop = top;
    });
  }

  function openGame(gameId) {
    if (typeof gameId !== 'string' || gameId.length === 0) return;
    const node = scrollRef.current;
    if (node && (state.page === PAGES.MARKET || state.page === PAGES.MY_GAMES)) {
      store.dispatch(scrollSaved(pageScrollKey(state.page), node.scrollTop));
    }
    void openDetail({
      store: store,
      api: api,
      gameId: gameId,
      returnPage: state.page === PAGES.MY_GAMES ? PAGES.MY_GAMES : PAGES.MARKET,
    });
  }

  function retryCatalog() {
    if (state.market.offline) {
      void refreshRegistryAction({ store: store, api: api });
      return;
    }
    void loadCatalog({ store: store, api: api, now: Date.now() });
  }

  function browseAll() {
    store.dispatch(filtersCleared());
    store.dispatch(searchOpenChanged(false));
    requestAnimationFrame(function focusFirst() {
      const root = rootRef.current;
      const card = root ? root.querySelector('.dgm-section-all [data-card-id]') : null;
      if (card && typeof card.focus === 'function') card.focus();
      else focusSearch();
    });
  }

  function launchGame(game) {
    if (!game || typeof game.id !== 'string') return;
    beginGame(store, { gameId: game.id, mode: launchModeFor(game) });
  }

  function installGame(game, update) {
    if (!game || typeof game.id !== 'string') return;
    void startInstall({
      store: store,
      api: api,
      gameId: game.id,
      version: game.registryVersion || undefined,
      update: update === true,
    });
  }

  function handleDetailPlay(kind) {
    if (!detailGame) return;
    const mode = kind === 'play' ? 'start' : 'resume-paused';
    beginGame(store, { gameId: detailGame.id, mode: mode });
  }

  function handlePlayCurrent() {
    if (detailGame) launchGame(detailGame);
  }

  function openUninstallDialog(gameId, returnFocus) {
    store.dispatch(dialogOpened('uninstall', gameId, { returnFocus: returnFocus }));
  }

  function openDeleteDataDialog(gameId, returnFocus) {
    store.dispatch(dialogOpened('delete-data', gameId, { returnFocus: returnFocus }));
  }

  function handleDetailUninstall() {
    if (detailGame) openUninstallDialog(detailGame.id, { kind: 'heading', page: PAGES.DETAIL });
  }

  function handleDetailDeleteData() {
    if (detailGame) openDeleteDataDialog(detailGame.id, { kind: 'heading', page: PAGES.DETAIL });
  }

  async function confirmDialogAction() {
    const dialog = store.getState().dialog;
    if (!dialog) return;
    if (dialog.kind === 'install-local') {
      store.dispatch(dialogBusyChanged(true));
      await installLocalGame({
        store: store,
        api: api,
        file: dialog.file,
        fileName: dialog.fileName,
      });
      store.dispatch(dialogBusyChanged(false));
      store.dispatch(dialogClosed());
      return;
    }
    if (dialog.kind === 'restart') {
      store.dispatch(dialogClosed());
      return;
    }
    const deleteData = dialog.kind === 'delete-data' ? true : dialog.deleteData === true;
    store.dispatch(dialogBusyChanged(true));
    await uninstallGame({
      store: store,
      api: api,
      gameId: dialog.gameId,
      deleteData: deleteData,
    });
    store.dispatch(dialogBusyChanged(false));
    store.dispatch(dialogClosed());
  }

  function handlePickFile() {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }

  function handleFileSelected(event) {
    const input = event && event.target ? event.target : null;
    const file = input && input.files && input.files[0] ? input.files[0] : null;
    if (input) input.value = '';
    if (!file) return;
    const name = typeof file.name === 'string' && file.name.length > 0 ? file.name : 'game.html';
    const type = typeof file.type === 'string' ? file.type : '';
    if (!/\.html?$/i.test(name) && type !== 'text/html') {
      pushToast(store, { kind: 'error', textKey: 'market.localInstall.unsupported' });
      return;
    }
    if (typeof file.size === 'number' && file.size > MAX_LOCAL_BYTES) {
      pushToast(store, { kind: 'error', textKey: 'market.localInstall.tooLarge' });
      return;
    }
    store.dispatch(
      dialogOpened('install-local', null, {
        fileName: name,
        file: file,
        returnFocus: { kind: 'local-install' },
      })
    );
  }

  function handleToastAction(toast) {
    if (!toast || !toast.action) return;
    if (toast.action.kind === 'play' && typeof toast.action.gameId === 'string') {
      beginGame(store, { gameId: toast.action.gameId, mode: toast.action.mode || 'start' });
    }
    store.dispatch(toastDismissed(toast.id));
  }

  const headerMenuItems =
    detailGame && detailGame.installed && !isBuiltin(detailGame)
      ? [
          {
            id: 'uninstall',
            label: t('detail.action.uninstall'),
            danger: true,
            onSelect: handleDetailUninstall,
          },
          {
            id: 'delete-data',
            label: t('mygames.menu.deleteData'),
            danger: true,
            onSelect: handleDetailDeleteData,
          },
        ]
      : [];

  if (state.page === PAGES.RUNTIME) {
    return h(
      'div',
      { className: 'dgm-root', 'data-page': PAGES.RUNTIME, 'data-panel': MAIN_PANEL_KEY },
      h(StyleTag),
      h(RuntimeView, { t: props && props.t, onBack: headerBack, onOpenPanel: openPanel })
    );
  }

  const isDetail = state.page === PAGES.DETAIL;
  const isMyGames = state.page === PAGES.MY_GAMES;

  const headerContent = isDetail
    ? [
        h(
          'button',
          {
            key: 'back',
            type: 'button',
            className: 'dgm-icon-btn',
            onClick: function back() {
              closeDetail(store);
            },
            'aria-label': t('detail.back'),
            title: t('detail.back'),
          },
          h(BackIcon)
        ),
        h(
          'nav',
          { className: 'dgm-crumbs', key: 'crumbs', 'aria-label': t('detail.breadcrumb', { page: t('market.tab.market'), gameName: detailGame ? detailGame.name : '' }) },
          h(
            'button',
            {
              type: 'button',
              className: 'dgm-crumb-btn',
              onClick: function toMarket() {
                closeDetail(store);
              },
            },
            t('market.tab.market')
          ),
          h('span', { className: 'dgm-crumb-sep', 'aria-hidden': 'true' }, '/'),
          h('span', { className: 'dgm-crumb-current' }, detailGame ? detailGame.name : '')
        ),
        h('span', { className: 'dgm-spacer', key: 'spacer' }),
        headerMenuItems.length > 0
          ? h(
              'div',
              { className: 'dgm-header-menu-wrap', key: 'menu' },
              h(
                'button',
                {
                  type: 'button',
                  ref: menuButtonRef,
                  className: 'dgm-icon-btn',
                  'aria-label': t('detail.more'),
                  title: t('detail.more'),
                  'aria-haspopup': 'menu',
                  'aria-expanded': headerMenuOpen ? 'true' : 'false',
                  onClick: function toggle() {
                    setHeaderMenuOpen(!headerMenuOpen);
                  },
                },
                h(MoreIcon, { size: 15 })
              ),
              headerMenuOpen
                ? h(PopoverMenu, {
                    t: t,
                    items: headerMenuItems,
                    onClose: function close(returnFocus) {
                      setHeaderMenuOpen(false);
                      if (returnFocus && menuButtonRef.current) menuButtonRef.current.focus();
                    },
                  })
                : null
            )
          : null,
      ]
    : [
        h(
          'button',
          {
            key: 'back',
            type: 'button',
            className: 'dgm-icon-btn',
            onClick: headerBack,
            'aria-label': t('panel.backToConversation'),
            title: t('panel.backToConversation'),
          },
          h(BackIcon)
        ),
        h(
          'h1',
          {
            key: 'title',
            className: 'dgm-sr-only',
            tabIndex: -1,
            'data-page-heading': true,
          },
          isMyGames ? t('mygames.title') : t('market.title')
        ),
        h(
          'div',
          { key: 'tabs', className: 'dgm-tabs', role: 'tablist', 'aria-label': t('market.title') },
          h(
            'button',
            {
              type: 'button',
              role: 'tab',
              id: 'dgm-tab-market',
              className: 'dgm-tab',
              'data-active': state.page === PAGES.MARKET ? 'true' : 'false',
              'aria-selected': state.page === PAGES.MARKET ? 'true' : 'false',
              'aria-controls': 'dgm-tabpanel',
              onClick: function marketTab() {
                switchPage(PAGES.MARKET);
              },
            },
            t('market.tab.market')
          ),
          h(
            'button',
            {
              type: 'button',
              role: 'tab',
              id: 'dgm-tab-mygames',
              className: 'dgm-tab',
              'data-active': state.page === PAGES.MY_GAMES ? 'true' : 'false',
              'aria-selected': state.page === PAGES.MY_GAMES ? 'true' : 'false',
              'aria-controls': 'dgm-tabpanel',
              onClick: function myGamesTab() {
                switchPage(PAGES.MY_GAMES);
              },
            },
            t('market.tab.mygames')
          )
        ),
        h('span', { key: 'spacer', className: 'dgm-spacer' }),
        state.page === PAGES.MARKET
          ? h(
              'div',
              { key: 'search', className: 'dgm-header-search' },
              h(SearchBox, {
                t: t,
                inputRef: searchRef,
                draft: state.ui.draftQuery,
                onDraft: function draft(value) {
                  store.dispatch(queryDraftChanged(value));
                },
                onApply: function apply(value) {
                  store.dispatch(queryApplied(value));
                },
                onOpenChange: function open(open) {
                  store.dispatch(searchOpenChanged(open));
                },
              }),
              h(SearchToggle, {
                t: t,
                expanded: state.ui.searchOpen,
                onClick: focusSearch,
              })
            )
          : null,
        state.market.offline
          ? h('span', {
              key: 'offline',
              className: 'dgm-header-dot',
              title: t('market.offline'),
              'aria-label': t('a11y.offline'),
              role: 'img',
            })
          : null,
        state.page === PAGES.MARKET
          ? h(
              'button',
              {
                key: 'local',
                type: 'button',
                className: 'dgm-btn dgm-upload dgm-local-install',
                onClick: handlePickFile,
                'aria-label': t('market.upload'),
                title: t('market.localInstall.body'),
              },
              h(UploadIcon, { size: 14 }),
              h('span', { className: 'dgm-upload-label' }, t('market.upload'))
            )
          : null,
      ];

  return h(
    'div',
    {
      className: 'dgm-root',
      'data-page': state.page,
      'data-panel': MAIN_PANEL_KEY,
      'data-search-open': state.ui.searchOpen ? 'true' : 'false',
      ref: rootRef,
    },
    h(StyleTag),
    h('header', { className: 'dgm-header' }, headerContent),
    h('input', {
      type: 'file',
      className: 'dgm-sr-only',
      accept: '.html,text/html',
      tabIndex: -1,
      ref: fileInputRef,
      onChange: handleFileSelected,
    }),
    waiting
      ? h(
          'div',
          { className: 'dgm-banner', 'aria-live': 'polite' },
          h('span', { className: 'dgm-banner-icon', 'aria-hidden': 'true' }, h('span', { className: 'dgm-dot dgm-dot-waiting' })),
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
      { className: 'dgm-content', ref: scrollRef },
      h(
        'div',
        {
          className: 'dgm-page',
          id: isDetail ? undefined : 'dgm-tabpanel',
          role: isDetail ? undefined : 'tabpanel',
          'aria-labelledby': isDetail ? undefined : state.page === PAGES.MY_GAMES ? 'dgm-tab-mygames' : 'dgm-tab-market',
        },
        isDetail
          ? h(GameDetail, {
              state: state,
              t: t,
              locale: locale,
              now: now,
              onBack: function back() {
                closeDetail(store);
              },
              onRetry: function retryDetail() {
                if (state.detail.gameId) void loadDetail({ store: store, api: api, gameId: state.detail.gameId });
              },
              onInstall: function installNow() {
                if (detailGame) installGame(detailGame);
              },
              onUpdate: function updateNow() {
                if (detailGame) installGame(detailGame, true);
              },
              onCancelInstall: function cancelNow() {
                if (detailGame) cancelInstall(detailGame.id);
              },
              onPlay: handleDetailPlay,
              onPlayCurrent: handlePlayCurrent,
              onCheckUpdate: function checkUpdate() {
                void refreshRegistryAction({ store: store, api: api });
              },
              onUninstall: handleDetailUninstall,
              onDeleteData: handleDetailDeleteData,
              onOpenLightbox: function openLightbox(index) {
                store.dispatch(lightboxChanged(index));
              },
            })
          : isMyGames
            ? h(MyGamesPage, {
                state: state,
                t: t,
                locale: locale,
                now: now,
                onOpen: openGame,
                onPlay: launchGame,
                onReinstall: function reinstall(game) {
                  installGame(game);
                },
                onUpdate: function update(game) {
                  installGame(game, true);
                },
                onUninstall: function uninstall(game) {
                  openUninstallDialog(game.id, { kind: 'menu', gameId: game.id });
                },
                onDeleteData: function deleteData(game) {
                  openDeleteDataDialog(game.id, { kind: 'menu', gameId: game.id });
                },
                onRetry: retryCatalog,
                onBrowse: function browse() {
                  switchPage(PAGES.MARKET);
                },
                onRefreshRegistry: function refresh() {
                  void refreshRegistryAction({ store: store, api: api });
                },
              })
            : h(MarketHome, {
                state: state,
                t: t,
                locale: locale,
                now: now,
                onOpenGame: openGame,
                onPlay: launchGame,
                onRetry: retryCatalog,
                onBrowseAll: browseAll,
                onClearSearch: clearSearch,
                onCategory: function category(value) {
                  store.dispatch(categoryChanged(value));
                },
                onRefreshRegistry: function refresh() {
                  void refreshRegistryAction({ store: store, api: api });
                },
              })
      )
    ),
    state.ui.lightbox !== null && detailScreenshots.length > 0
      ? h(Lightbox, {
          t: t,
          images: detailScreenshots,
          index: Math.min(state.ui.lightbox, detailScreenshots.length - 1),
          onClose: function close() {
            store.dispatch(lightboxChanged(null));
          },
          onChange: function change(index) {
            store.dispatch(lightboxChanged(index));
          },
        })
      : null,
    state.dialog
      ? h(ConfirmDialog, {
          dialog: state.dialog,
          t: t,
          game: state.dialog.gameId ? detailGame && detailGame.id === state.dialog.gameId ? detailGame : findGame(state, state.dialog.gameId) : null,
          onClose: function close() {
            store.dispatch(dialogClosed());
          },
          onToggleDeleteData: function toggle(value) {
            store.dispatch(dialogDeleteDataChanged(value));
          },
          onConfirmAgain: function again() {
            store.dispatch(dialogConfirmAgain());
          },
          onConfirm: confirmDialogAction,
        })
      : null,
    h(ToastViewport, {
      toasts: state.toasts,
      t: t,
      onDismiss: function dismiss(id) {
        store.dispatch(toastDismissed(id));
      },
      onAction: handleToastAction,
    })
  );
}

function findGame(state, gameId) {
  if (!state || !state.market || !Array.isArray(state.market.games)) return null;
  for (const game of state.market.games) {
    if (game && game.id === gameId) return game;
  }
  return null;
}
