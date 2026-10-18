/**
 * Persistent Game tab in the conversation tab strip.
 *
 * The tab is the user's everyday entry into the game. Selecting it opens the
 * Game Market main panel and resets the conversation view back to Chat, so the
 * Back action from the market returns to the normal conversation.
 */
import React from 'react';
import { makeT, detectLocale } from '../locale.js';
import { openGameMarket } from '../navigation.js';
import { StyleTag } from '../styles.js';

const h = React.createElement;

export function GameEntryView(props) {
  const t = makeT(props && props.t, detectLocale());
  const openView = props && typeof props.openView === 'function' ? props.openView : null;

  React.useEffect(
    function enterGameMarket() {
      if (openView) openView('chat');
      openGameMarket();
    },
    [openView]
  );

  return h(
    'div',
    { className: 'dgm-entry-view', role: 'status', 'aria-live': 'polite' },
    h(StyleTag),
    h('p', null, t('entry.tab.opening'))
  );
}
