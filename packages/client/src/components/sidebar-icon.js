/**
 * Sidebar entry icon.
 *
 * The host sidebar owns the row button, focus ring, aria-label and the
 * `selectPanel` click. This component is the glyph only: runtime state lives on
 * the session Game tab, not on the sidebar row (UX review 2026-10-19).
 */
import React from 'react';
import { store, sessionBound } from '../store.js';
import { GameMarketIcon } from '../icons.js';
import { detectLocale, translate } from '../locale.js';
import { openGameMarket } from '../navigation.js';
import { useSessionBinding } from '../hooks.js';

const h = React.createElement;

export function GameMarketSidebarIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 18;
  const interactive = Boolean(props && props.interactive === true);
  const diagnosticRef = React.useRef(false);
  const binding = useSessionBinding(props || {}, diagnosticRef);

  React.useEffect(
    function bindCurrentSession() {
      if (binding.sessionId && binding.sessionId !== store.getState().bindingSessionId) {
        store.dispatch(sessionBound(binding.sessionId));
      }
    },
    [binding.sessionId]
  );

  const buttonProps = interactive
    ? {
        role: 'button',
        tabIndex: 0,
        'aria-label': translate(detectLocale(), 'sidebar.label'),
        style: { cursor: 'pointer', position: 'relative', display: 'inline-flex', color: 'inherit' },
        onClick: openGameMarket,
        onKeyDown: function activate(event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openGameMarket();
          }
        },
      }
    : { 'aria-hidden': 'true', style: { position: 'relative', display: 'inline-flex', color: 'inherit' } };

  return h('span', buttonProps, h(GameMarketIcon, { size: size }));
}
