/**
 * Transient leave confirmation above the composer.
 *
 * After returning to the Session the Runtime dispatches `leaveNoticeSet`:
 * "saved" when the pause save persisted, "no-progress" when the game chose not
 * to write (menus). Both offer a one-click resume ("continue game").
 */
import React from 'react';
import { store, leaveNoticeCleared } from '../store.js';
import { beginGame } from '../actions.js';
import { openGameMarket } from '../navigation.js';
import { detectLocale, makeT } from '../locale.js';
import { useStoreState } from '../hooks.js';
import { StyleTag } from '../styles.js';

const h = React.createElement;

const DISMISS_MS = 8000;

export function GameLeaveNotice(props) {
  const state = useStoreState();
  const notice = state.leaveNotice;
  const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : null;
  // Prefer the host-bound translator so the chip follows the DSH locale
  // instead of navigator.language; the built-in dictionaries stay the fallback.
  const t = makeT(props && props.t, detectLocale());
  const matchesSession =
    notice !== null && (notice.sessionId === null || sessionId === null || notice.sessionId === sessionId);
  const at = notice ? notice.at : 0;
  const labels = props && props.labels && typeof props.labels === 'object' ? props.labels : {};
  function label(name, fallbackKey) {
    const value = labels[name];
    return typeof value === 'string' && value.length > 0 ? value : t(fallbackKey);
  }

  React.useEffect(
    function autoDismiss() {
      if (!matchesSession) return undefined;
      const timer = setTimeout(function dismiss() {
        store.dispatch(leaveNoticeCleared());
      }, DISMISS_MS);
      return function cleanup() {
        clearTimeout(timer);
      };
    },
    [matchesSession, at]
  );

  if (!matchesSession) return null;

  const gameId = typeof notice.gameId === 'string' && notice.gameId.length > 0 ? notice.gameId : null;

  function continueGame() {
    if (!gameId) return;
    store.dispatch(leaveNoticeCleared());
    beginGame(store, {
      gameId: gameId,
      mode: 'resume-paused',
      sessionId: notice.sessionId || sessionId,
      autoResume: true,
    });
    openGameMarket();
  }

  function dismiss() {
    store.dispatch(leaveNoticeCleared());
  }

  return h(
    'div',
    { className: 'dgm-leave-notice', 'data-kind': notice.kind, role: 'status', 'aria-live': 'polite' },
    h(StyleTag),
    h('span', { className: 'dgm-leave-notice-dot', 'aria-hidden': 'true' }),
    h(
      'span',
      { className: 'dgm-leave-notice-text' },
      notice.kind === 'saved' ? label('saved', 'leave.saved') : label('noProgress', 'leave.noProgress')
    ),
    gameId
      ? h('button', { type: 'button', className: 'dgm-leave-notice-action', onClick: continueGame }, label('continue', 'leave.continue'))
      : null,
    h(
      'button',
      {
        type: 'button',
        className: 'dgm-leave-notice-dismiss',
        'aria-label': label('dismiss', 'leave.dismiss'),
        title: label('dismiss', 'leave.dismiss'),
        onClick: dismiss,
      },
      '×'
    )
  );
}
