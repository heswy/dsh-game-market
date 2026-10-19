/**
 * Conversation "Game" tab label with a compact state badge.
 *
 * The host renders a view's `label` as the tab button child, so this component
 * is mounted inside that button and subscribes to the module store directly.
 * The sidebar entry deliberately carries no state (UX review 2026-10-19): the
 * status belongs to this session-level Game button.
 */
import React from 'react';
import { store } from '../store.js';
import { deriveTabStatus } from '../chip-state.js';
import { detectLocale, translate } from '../locale.js';
import { useClock, useStoreState } from '../hooks.js';

const h = React.createElement;

const BADGE_STYLES = Object.freeze({
  waiting: { color: '#4d6bfe', background: 'rgba(77, 107, 254, 0.13)' },
  completed: { color: '#178a4c', background: 'rgba(23, 138, 76, 0.13)' },
  error: { color: '#c93c37', background: 'rgba(201, 60, 55, 0.13)' },
  resume: { color: '#b26b00', background: 'rgba(178, 107, 0, 0.14)' },
});

const BADGE_KEYS = Object.freeze({
  waiting: 'entry.tab.badge.waiting',
  completed: 'entry.tab.badge.completed',
  error: 'entry.tab.badge.error',
  resume: 'entry.tab.badge.resume',
});

export function GameTabLabel() {
  const state = useStoreState();
  const now = useClock(1000);
  const locale = detectLocale();
  const status = deriveTabStatus(state, now, { sessionId: state.bindingSessionId });
  const badge = status ? BADGE_STYLES[status] : null;
  return h(
    'span',
    {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        lineHeight: '1',
      },
    },
    translate(locale, 'entry.tab.game'),
    badge
      ? h(
          'span',
          {
            'data-game-tab-status': status,
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              height: '18px',
              padding: '0 7px',
              borderRadius: '999px',
              fontSize: '10.5px',
              fontWeight: 700,
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap',
              color: badge.color,
              background: badge.background,
            },
          },
          h('span', {
            'aria-hidden': 'true',
            style: {
              width: '5px',
              height: '5px',
              borderRadius: '50%',
              background: 'currentColor',
            },
          }),
          translate(locale, BADGE_KEYS[status])
        )
      : null
  );
}
