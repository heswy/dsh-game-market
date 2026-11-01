/**
 * DSH Client plugin entry.
 *
 * Verified registration forms (DSH Desktop 0.2.1-rc.3 / rc.5):
 *   - `main` keyed slot + `sidebar.panellist` row with the same id
 *   - `conversation.view` list slot for the persistent Game tab
 *   - `ctx.locale.register(ns, { zh, en })` inside `ctx.effect`
 *   - `ctx.layout.selectPanel(id | null)` for panel navigation
 *
 * rc.5 estimates every View tab label's glyph width (`for … of label`), so the
 * Game tab label must be a plain string; a React element crashes the whole
 * session header (title row + tab row disappear).
 */
import React from 'react';
import { configureQuestions } from './questions.js';
import { NS, ZH, EN, translate } from './locale.js';
import { store } from './store.js';
import { MAIN_PANEL_KEY, SIDEBAR_ORDER } from './constants.js';
import { reportDiagnostic } from './diagnostics.js';
import { configureNavigation, backToConversation, openGameMarket } from './navigation.js';
import { getApiClient } from './api.js';
import { createAgentPoller } from './agent-polling.js';
import { getUpdateManager } from './update-manager.js';
import { GameMarketPanel } from './components/panel.js';
import { GameMarketSidebarIcon } from './components/sidebar-icon.js';
import { GameEntryView } from './components/game-entry-view.js';
import { GameLeaveNotice } from './components/leave-notice.js';

export const inject = ['slots', 'layout', 'locale'];

function noopDisposer() {
  return function noop() {};
}

function marketShare() {
  return {
    onBack: backToConversation,
    onOpenPanel: openGameMarket,
  };
}

export function apply(ctx) {
  ctx.effect(
    function registerDictionaries() {
      try {
        if (!ctx.locale || typeof ctx.locale.register !== 'function') {
          throw new Error('locale.register is unavailable');
        }
        return ctx.locale.register(NS, { zh: ZH, en: EN });
      } catch (error) {
        // Built-in dictionaries remain the fallback in makeT().
        reportDiagnostic('locale-register-failed', error);
        return noopDisposer();
      }
    },
    'dsh-game-market: dictionaries'
  );

  ctx.effect(
    function wirePanelNavigation() {
      try {
        if (!ctx.layout || typeof ctx.layout.selectPanel !== 'function') {
          throw new Error('layout.selectPanel is unavailable');
        }
        return configureNavigation(ctx.layout);
      } catch (error) {
        reportDiagnostic('layout-unavailable', error);
        return noopDisposer();
      }
    },
    'dsh-game-market: navigation'
  );

  let boundTranslate = null;
  function hostTranslate(key) {
    try {
      if (boundTranslate === null && ctx.locale && typeof ctx.locale.bind === 'function') {
        boundTranslate = ctx.locale.bind(NS);
      }
      if (typeof boundTranslate === 'function') {
        const value = boundTranslate(key);
        if (typeof value === 'string' && value.length > 0 && value !== key) return value;
      }
    } catch (error) {
      reportDiagnostic('host-translate-failed:' + key, error);
    }
    return null;
  }

  function sidebarLabel() {
    const value = hostTranslate('sidebar.label');
    return typeof value === 'string' && value.length > 0 ? value : translate('zh', 'sidebar.label');
  }

  // rc.5 measures View tab label glyphs, so this must stay a plain string. The
  // host re-runs the thunk when the locale changes.
  function gameTabLabel() {
    const value = hostTranslate('entry.tab.game');
    return typeof value === 'string' && value.length > 0 ? value : translate('zh', 'entry.tab.game');
  }

  /** Resolve one leave-notice string in the host locale (built-in zh as fallback). */
  function leaveLabel(key) {
    try {
      if (ctx.locale && typeof ctx.locale.bind === 'function') {
        const bound = ctx.locale.bind(NS);
        if (typeof bound === 'function') {
          const value = bound(key);
          if (typeof value === 'string' && value.length > 0 && value !== key) return value;
        }
      }
    } catch (error) {
      reportDiagnostic('leave-label-failed:' + key, error);
    }
    return translate('zh', key);
  }

  function injectSlot(slotName, callback) {
    try {
      if (!ctx.slots || typeof ctx.slots.inject !== 'function') {
        throw new Error('slots.inject is unavailable');
      }
      return ctx.slots.inject(slotName, callback);
    } catch (error) {
      reportDiagnostic('slot-inject-failed:' + slotName, error);
      return null;
    }
  }

  function registerSlot(options, Component, label) {
    try {
      return ctx.slots.register(options, Component);
    } catch (error) {
      reportDiagnostic('slot-register-failed:' + label, error);
      return noopDisposer();
    }
  }

  const mainController = injectSlot('main', function registerMain() {
    return registerSlot(
      {
        name: 'main',
        key: MAIN_PANEL_KEY,
        locale: NS,
        inject: marketShare,
      },
      GameMarketPanel,
      'main'
    );
  });
  if (mainController === null) reportDiagnostic('main-panel-registration-failed');

  const sidebarController = injectSlot('sidebar.panellist', function registerSidebarEntry() {
    return registerSlot(
      {
        name: 'sidebar.panellist',
        id: MAIN_PANEL_KEY,
        order: SIDEBAR_ORDER,
        label: sidebarLabel,
        locale: NS,
      },
      GameMarketSidebarIcon,
      'sidebar.panellist'
    );
  });
  if (sidebarController === null) reportDiagnostic('sidebar-registration-failed');

  const gameTabController = injectSlot('conversation.view', function registerGameTab() {
    return registerSlot(
      {
        name: 'conversation.view',
        id: 'game',
        order: 100,
        label: gameTabLabel,
        locale: NS,
      },
      GameEntryView,
      'conversation.view'
    );
  });
  if (gameTabController === null) reportDiagnostic('game-tab-registration-failed');

  // Session header chip: shows the saved / no-progress notice with a one-click
  // resume after returning from a game, then auto-dismisses.
  const leaveNoticeController = injectSlot('conversation.session.header.utilities', function registerLeaveNotice() {
    return registerSlot(
      {
        name: 'conversation.session.header.utilities',
        id: 'leave-notice',
        order: 20,
        locale: NS,
        inject: function injectLeaveNotice(sessionId) {
          return {
            sessionId: typeof sessionId === 'string' ? sessionId : '',
            labels: {
              saved: leaveLabel('leave.saved'),
              noProgress: leaveLabel('leave.noProgress'),
              continue: leaveLabel('leave.continue'),
              dismiss: leaveLabel('leave.dismiss'),
            },
          };
        },
      },
      GameLeaveNotice,
      'conversation.session.header.utilities'
    );
  });
  if (leaveNoticeController === null) reportDiagnostic('leave-notice-registration-failed');

  ctx.effect(function startQuestions() { return configureQuestions(ctx); }, 'dsh-game-market: questions');

  ctx.effect(
    function startPlatformUpdates() {
      // V1.5 M3: identity reporting + discovery/observation polling run for the
      // whole page lifetime (not only while the Market panel is mounted), so an
      // idle window can answer the Host coordination phase and a refreshed page
      // resumes the persisted operation.
      const manager = getUpdateManager();
      manager.start();
      const doc = typeof document !== 'undefined' ? document : null;
      if (!doc || typeof doc.addEventListener !== 'function') {
        return function stopUpdates() {
          manager.stop();
        };
      }
      function onVisibilityChange() {
        manager.setVisibility(doc.visibilityState === 'hidden' ? 'hidden' : 'visible');
      }
      doc.addEventListener('visibilitychange', onVisibilityChange);
      return function stopUpdates() {
        doc.removeEventListener('visibilitychange', onVisibilityChange);
        manager.stop();
      };
    },
    'dsh-game-market: platform updates'
  );

  ctx.effect(
    function startAgentPolling() {
      const doc = typeof document !== 'undefined' ? document : null;
      const poller = createAgentPoller({
        store: store,
        getApi: getApiClient,
        getVisibility: function getVisibility() {
          return doc && typeof doc.visibilityState === 'string' ? doc.visibilityState : 'visible';
        },
        scheduler: {
          now: function now() {
            return Date.now();
          },
          setTimeout: function schedule(callback, delay) {
            return setTimeout(callback, delay);
          },
          clearTimeout: function clear(handle) {
            clearTimeout(handle);
          },
        },
      });
      poller.start();
      if (doc) poller.setVisibility(doc.visibilityState || 'visible');

      function onVisibilityChange() {
        poller.setVisibility(doc && doc.visibilityState ? doc.visibilityState : 'visible');
      }
      if (doc && typeof doc.addEventListener === 'function') {
        doc.addEventListener('visibilitychange', onVisibilityChange);
      }
      return function stopPolling() {
        if (doc && typeof doc.removeEventListener === 'function') {
          doc.removeEventListener('visibilitychange', onVisibilityChange);
        }
        poller.stop();
      };
    },
    'dsh-game-market: agent polling'
  );
}
