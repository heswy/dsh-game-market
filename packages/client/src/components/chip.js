/**
 * Waiting-entry chip in `conversation.header.leading`.
 *
 * Hard rules: never auto-open a game, never hide the chip behind a menu unless
 * the user asked, ignore only the current turn, and keep Enter/Space/Escape focus
 * behavior visible.
 */
import React from 'react';
import { store, pageChanged, sessionBound, turnIgnored, surfaceChanged } from '../store.js';
import { PAGES } from '../constants.js';
import { CHIP_STATUS, deriveChipState } from '../chip-state.js';
import { beginGame, gameNameFromState, refreshMarket } from '../actions.js';
import { makeT, detectLocale } from '../locale.js';
import { formatRelativeTime } from '../format.js';
import { GamepadIcon, PlayIcon } from '../icons.js';
import { StyleTag } from '../styles.js';
import { backToConversation, openGameMarket } from '../navigation.js';
import { getApiClient } from '../api.js';
import { useActivePanel, useClock, useSessionBinding, useStoreState } from '../hooks.js';

const h = React.createElement;

function clampMenuPosition(rect) {
  const width = 248;
  const height = 320;
  const viewportWidth = typeof window !== 'undefined' && typeof window.innerWidth === 'number' ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== 'undefined' && typeof window.innerHeight === 'number' ? window.innerHeight : 800;
  const left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8));
  const preferredTop = rect.bottom + 4;
  const top = Math.max(8, Math.min(preferredTop, viewportHeight - height - 8));
  return { left: left, top: top };
}

export function WaitEntryChip(props) {
  const state = useStoreState();
  const now = useClock(1000);
  const diagnosticRef = React.useRef(false);
  const activePanelId = useActivePanel(props, diagnosticRef);
  const binding = useSessionBinding(props, diagnosticRef);
  const locale = detectLocale();
  const t = makeT(props && props.t, locale);

  const triggerRef = React.useRef(null);
  const rootRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const popoverRef = React.useRef(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [waitingOpen, setWaitingOpen] = React.useState(false);
  const [anchor, setAnchor] = React.useState({ left: 8, top: 64 });
  const [toast, setToast] = React.useState(null);

  const sessionId = binding.sessionId || state.bindingSessionId;
  const view = sessionId === state.bindingSessionId ? state : { ...state, bindingSessionId: sessionId };
  const chip = deriveChipState(view, now, { sessionId: sessionId, activePanelId: activePanelId });
  const resumeGame =
    chip.resumeGameId && state.market.games
      ? state.market.games.find(function match(game) {
          return game && game.id === chip.resumeGameId;
        })
      : null;
  const resumeGameName = chip.resumeGameId ? gameNameFromState(state, chip.resumeGameId) : '';
  const pausedAt =
    state.pausedGame && state.pausedGame.gameId === chip.resumeGameId ? state.pausedGame.at : null;
  const relativeTime =
    typeof pausedAt === 'number'
      ? formatRelativeTime(new Date(pausedAt).toISOString(), now, locale)
      : resumeGame && typeof resumeGame.lastPlayedAt === 'string'
        ? formatRelativeTime(resumeGame.lastPlayedAt, now, locale)
        : '';

  React.useEffect(
    function closeLayersOnStatusChange() {
      if (chip.status !== CHIP_STATUS.RUNNING) setMenuOpen(false);
      if (chip.status !== CHIP_STATUS.WAITING) setWaitingOpen(false);
    },
    [chip.status]
  );

  React.useEffect(
    function ensureMarketCache() {
      // The chip needs canContinue/lastPlayedAt to label the resume action even
      // when the user has not opened the Market panel in this page session.
      if (state.market.status === 'ready' || state.market.status === 'loading') return;
      const api = getApiClient();
      if (!api) return;
      void refreshMarket({ store: store, api: api });
    },
    [state.market.status]
  );

  React.useEffect(
    function bindChipSurface() {
      store.dispatch(surfaceChanged('chip', true));
      return function unmountChip() {
        store.dispatch(surfaceChanged('chip', false));
      };
    },
    []
  );

  React.useEffect(
    function bindResolvedSession() {
      if (binding.sessionId && binding.sessionId !== store.getState().bindingSessionId) {
        store.dispatch(sessionBound(binding.sessionId));
      }
    },
    [binding.sessionId]
  );

  React.useEffect(
    function focusOpenedLayer() {
      if (menuOpen && menuRef.current) {
        const first = menuRef.current.querySelector('[role="menuitem"]');
        if (first && typeof first.focus === 'function') first.focus();
      }
      if (waitingOpen && popoverRef.current) {
        const primary = popoverRef.current.querySelector('button');
        if (primary && typeof primary.focus === 'function') primary.focus();
      }
    },
    [menuOpen, waitingOpen]
  );

  React.useEffect(
    function closeOnOutsidePointer() {
      if (!menuOpen && !waitingOpen) return undefined;
      function onPointerDown(event) {
        const root = rootRef.current;
        if (root && event && event.target && root.contains(event.target)) return;
        setMenuOpen(false);
        setWaitingOpen(false);
      }
      document.addEventListener('pointerdown', onPointerDown);
      return function cleanup() {
        document.removeEventListener('pointerdown', onPointerDown);
      };
    },
    [menuOpen, waitingOpen]
  );

  React.useEffect(
    function clearToast() {
      if (!toast) return undefined;
      const timer = setTimeout(function hide() {
        setToast(null);
      }, 1600);
      return function cleanup() {
        clearTimeout(timer);
      };
    },
    [toast]
  );

  function closeAll() {
    setMenuOpen(false);
    setWaitingOpen(false);
    if (triggerRef.current && typeof triggerRef.current.focus === 'function') triggerRef.current.focus();
  }

  function measureAndOpen(open) {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setAnchor(clampMenuPosition(rect));
    open();
  }

  function resumePausedGame(gameId) {
    if (!gameId) return;
    setMenuOpen(false);
    beginGame(store, { gameId: gameId, mode: 'resume-paused' });
    openGameMarket();
  }

  function chooseGame() {
    setMenuOpen(false);
    store.dispatch(pageChanged(PAGES.MARKET));
    openGameMarket();
  }

  function dismissTurn() {
    if (!chip.turnKey) return;
    store.dispatch(turnIgnored(chip.turnKey, sessionId));
    setMenuOpen(false);
    setToast(t('entry.toast.dismissed'));
  }

  function handleTriggerClick() {
    if (chip.status === CHIP_STATUS.WAITING) {
      // Idempotent: the header is already the Conversation in this state.
      backToConversation();
      measureAndOpen(function open() {
        setMenuOpen(false);
        setWaitingOpen(true);
      });
      return;
    }
    if (chip.status === CHIP_STATUS.RESUME) {
      resumePausedGame(chip.resumeGameId);
      return;
    }
    measureAndOpen(function open() {
      setWaitingOpen(false);
      setMenuOpen(function next(previous) {
        return !previous;
      });
    });
  }

  function handleTriggerKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      measureAndOpen(function open() {
        setWaitingOpen(false);
        setMenuOpen(true);
      });
    } else if (event.key === 'Escape') {
      closeAll();
    }
  }

  function handleMenuKeyDown(event) {
    const menu = menuRef.current;
    if (!menu) return;
    const items = Array.prototype.slice.call(menu.querySelectorAll('[role="menuitem"]'));
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(index + 1 + items.length) % items.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index - 1 + items.length) % items.length].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1].focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeAll();
    } else if (event.key === 'Tab') {
      setMenuOpen(false);
    }
  }

  function handlePopoverKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAll();
    }
  }

  if (chip.status === CHIP_STATUS.HIDDEN) {
    return h(
      React.Fragment,
      null,
      h(StyleTag),
      h('span', { className: 'dgm-sr-only', 'aria-live': 'polite' }),
      null
    );
  }

  const isWaiting = chip.status === CHIP_STATUS.WAITING;
  const label = isWaiting
    ? t('entry.chip.waiting')
    : chip.status === CHIP_STATUS.RESUME
      ? t('entry.chip.resume')
      : chip.canResume
        ? t('entry.chip.running.resume')
        : t('entry.chip.running.choose');
  const ariaLabel = isWaiting
    ? t('entry.chip.a11y.waiting')
    : chip.status === CHIP_STATUS.RESUME
      ? t('entry.chip.a11y.resume')
      : t('entry.chip.a11y.running');
  const waitingBodyKey = chip.waitingKind === 'approval' ? 'entry.waiting.approval' : chip.waitingKind === 'question' ? 'entry.waiting.question' : 'entry.waiting.generic';
  const hasResumeItem = Boolean(chip.resumeGameId);
  const menuItems = [];
  if (hasResumeItem) {
    menuItems.push({
      id: 'resume',
      label: t('entry.menu.resume'),
      meta: resumeGameName
        ? relativeTime
          ? t('entry.menu.resume.meta', { gameName: resumeGameName, relativeTime: relativeTime })
          : resumeGameName
        : '',
      icon: h(PlayIcon),
      run: function runResume() {
        resumePausedGame(chip.resumeGameId);
      },
    });
  }
  menuItems.push({
    id: 'choose',
    label: t('entry.menu.choose'),
    meta: '',
    icon: h(GamepadIcon),
    run: chooseGame,
  });
  if (chip.status === CHIP_STATUS.RUNNING) {
    menuItems.push({
      id: 'dismiss',
      label: t('entry.menu.dismiss'),
      meta: '',
      icon: null,
      run: dismissTurn,
    });
  }

  return h(
    'span',
    { className: 'dgm-chip-anchor', ref: rootRef },
    h(StyleTag),
    h('span', { className: 'dgm-sr-only', 'aria-live': isWaiting ? 'assertive' : 'polite' }, isWaiting ? t('a11y.live.waiting') : ''),
    h(
      'button',
      {
        type: 'button',
        ref: triggerRef,
        className: 'dgm-chip',
        'data-status': chip.status,
        'aria-label': ariaLabel,
        'aria-haspopup': isWaiting ? 'dialog' : chip.status === CHIP_STATUS.RUNNING ? 'menu' : undefined,
        'aria-expanded': isWaiting ? (waitingOpen ? 'true' : 'false') : chip.status === CHIP_STATUS.RUNNING ? (menuOpen ? 'true' : 'false') : undefined,
        title: label,
        onClick: handleTriggerClick,
        onKeyDown: handleTriggerKeyDown,
      },
      h(GamepadIcon, { size: 14 }),
      isWaiting ? h('span', { className: 'dgm-chip-dot' }) : null,
      h('span', { className: 'dgm-chip-label' }, label)
    ),
    menuOpen
      ? h(
          'div',
          {
            className: 'dgm-menu',
            ref: menuRef,
            role: 'menu',
            'aria-label': t('entry.menu.a11y'),
            style: { left: anchor.left + 'px', top: anchor.top + 'px' },
            onKeyDown: handleMenuKeyDown,
          },
          menuItems.map(function renderItem(item) {
            return h(
              'button',
              {
                type: 'button',
                key: item.id,
                className: 'dgm-menu-item',
                role: 'menuitem',
                tabIndex: -1,
                onClick: item.run,
              },
              item.icon ? h('span', { className: 'dgm-menu-icon' }, item.icon) : null,
              h(
                'span',
                { className: 'dgm-menu-text' },
                h('span', { className: 'dgm-menu-label' }, item.label),
                item.meta ? h('span', { className: 'dgm-menu-meta' }, item.meta) : null
              )
            );
          })
        )
      : null,
    waitingOpen
      ? h(
          'div',
          {
            className: 'dgm-popover',
            ref: popoverRef,
            role: 'dialog',
            'aria-label': t('entry.waiting.title'),
            style: { left: anchor.left + 'px', top: anchor.top + 'px' },
            onKeyDown: handlePopoverKeyDown,
          },
          h('p', { className: 'dgm-popover-title' }, t('entry.waiting.title')),
          h('p', { className: 'dgm-popover-body' }, t(waitingBodyKey)),
          h(
            'div',
            { className: 'dgm-popover-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dgm-btn dgm-btn-quiet',
                onClick: function later() {
                  setWaitingOpen(false);
                },
              },
              t('entry.waiting.later')
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dgm-btn dgm-btn-primary',
                onClick: function goBack() {
                  setWaitingOpen(false);
                  backToConversation();
                },
              },
              t('entry.waiting.action')
            )
          )
        )
      : null,
    toast
      ? h(
          'span',
          {
            className: 'dgm-toast',
            role: 'status',
            style: { left: anchor.left + 'px', top: anchor.top + 40 + 'px' },
          },
          toast
        )
      : null
  );
}
