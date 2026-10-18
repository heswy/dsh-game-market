/**
 * Persistent Game tab in the conversation tab strip.
 *
 * First selection in a Session opens the Game Market; after the user has
 * played a game and returned to work, the next selection resumes that game.
 * Browsing the Market again stays available from the sidebar / the game's own
 * back-to-market action. The decision + side effects live in `entry-flow.js`
 * so they can be unit-tested without React.
 */
import React from 'react';
import { makeT, detectLocale } from '../locale.js';
import { openGameMarket } from '../navigation.js';
import { StyleTag } from '../styles.js';
import { store } from '../store.js';
import { beginGame } from '../actions.js';
import { enterGameSpace } from '../entry-flow.js';
import { useSessionBinding, useStoreState } from '../hooks.js';

const h = React.createElement;

export function GameEntryView(props) {
  const t = makeT(props && props.t, detectLocale());
  const openView = props && typeof props.openView === 'function' ? props.openView : null;
  const diagnosticRef = React.useRef(false);
  const state = useStoreState();
  const binding = useSessionBinding(props, diagnosticRef);
  const sessionId = binding.sessionId || state.bindingSessionId;
  const handledRef = React.useRef(null);

  React.useEffect(
    function enterTab() {
      const key = typeof sessionId === 'string' ? sessionId : '';
      if (handledRef.current === key) return;
      handledRef.current = key;
      enterGameSpace({
        store: store,
        sessionId: typeof sessionId === 'string' ? sessionId : null,
        openView: openView,
        openMarket: openGameMarket,
        startGame: function startGame(options) {
          beginGame(store, options);
        },
      });
    },
    [openView, sessionId]
  );

  return h(
    'div',
    { className: 'dgm-entry-view', role: 'status', 'aria-live': 'polite' },
    h(StyleTag),
    h('p', null, t('entry.tab.opening'))
  );
}
