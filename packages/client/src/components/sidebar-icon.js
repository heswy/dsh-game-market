/**
 * Sidebar entry icon.
 *
 * The host sidebar owns the row button, focus ring, aria-label and the
 * `selectPanel` click (verified in `ui-sidebar`'s `PanelRow`). This component is
 * therefore the glyph + status dot only. `interactive` is an opt-in fallback for
 * hosts that do not wrap the glyph; it is never enabled by the DSH row.
 */
import React from 'react';
import { store, sessionBound } from '../store.js';
import { deriveSidebarStatus, sidebarLabelKey } from '../chip-state.js';
import { GameMarketIcon } from '../icons.js';
import { makeT, detectLocale } from '../locale.js';
import { openGameMarket } from '../navigation.js';
import { useActivePanel, useClock, useSessionBinding, useStoreState } from '../hooks.js';

const h = React.createElement;

const STATUS_COLORS = Object.freeze({
  running: 'var(--dsw-alias-label-secondary, #5c6470)',
  waiting: 'var(--dsw-alias-state-business-primary, #4d6bfe)',
  error: 'var(--dsw-alias-state-error-primary, #c93c37)',
  completed: 'var(--dsw-alias-state-success-primary, #1a7f37)',
  resume: 'var(--dsw-alias-label-tertiary, #7a828e)',
});

function StatusGlyph(props) {
  const status = props.status;
  const color = STATUS_COLORS[status] || STATUS_COLORS.running;
  const base = {
    position: 'absolute',
    top: '-3px',
    right: '-3px',
    width: '10px',
    height: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  };
  let glyph = null;
  if (status === 'waiting') {
    glyph = h('circle', { cx: 5, cy: 5, r: 3.6, fill: 'transparent', stroke: color, strokeWidth: 2 });
  } else if (status === 'completed') {
    glyph = [
      h('circle', { key: 'ring', cx: 5, cy: 5, r: 4.1, fill: 'transparent', stroke: color, strokeWidth: 1 }),
      h('circle', { key: 'dot', cx: 5, cy: 5, r: 2.7, fill: color }),
    ];
  } else if (status === 'error') {
    glyph = h('circle', { cx: 5, cy: 5, r: 3.4, fill: color });
  } else if (status === 'resume') {
    glyph = [
      h('rect', { key: 'a', x: 2.4, y: 2.2, width: 1.7, height: 5.6, rx: 0.8, fill: color }),
      h('rect', { key: 'b', x: 5.9, y: 2.2, width: 1.7, height: 5.6, rx: 0.8, fill: color }),
    ];
  } else if (status === 'running') {
    glyph = h('circle', { cx: 5, cy: 5, r: 2.4, fill: color });
  }
  if (!glyph) return null;
  return h(
    'span',
    { style: base, 'data-status': status },
    h('svg', { width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': 'true', focusable: 'false' }, glyph)
  );
}

export function GameMarketSidebarIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 18;
  const interactive = Boolean(props && props.interactive === true);
  const state = useStoreState();
  const now = useClock(1000);
  const diagnosticRef = React.useRef(false);
  const binding = useSessionBinding(props || {}, diagnosticRef);
  const activePanelId = useActivePanel(props || {}, diagnosticRef);
  const locale = detectLocale();
  const t = makeT(props && props.t, locale);

  React.useEffect(
    function bindCurrentSession() {
      if (binding.sessionId && binding.sessionId !== store.getState().bindingSessionId) {
        store.dispatch(sessionBound(binding.sessionId));
      }
    },
    [binding.sessionId]
  );

  const status = deriveSidebarStatus(state, now, {
    sessionId: binding.sessionId || state.bindingSessionId,
    dshStatus: binding.dshStatus,
    activePanelId: activePanelId,
  });
  const label = t(sidebarLabelKey(status));
  const buttonProps = interactive
    ? {
        role: 'button',
        tabIndex: 0,
        'aria-label': label,
        'data-status': status,
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

  return h('span', buttonProps, h(GameMarketIcon, { size: size }), h(StatusGlyph, { status: status }));
}
