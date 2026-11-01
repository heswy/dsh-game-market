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
  const t = makeT(null, detectLocale());
  const matchesSession =
    notice !== null && (notice.sessionId === null || sessionId === null || notice.sessionId === sessionId);
  const at = notice ? notice.at : 0;

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
    h('span', { className: 'dgm-leave-notice-text' }, t(notice.kind === 'saved' ? 'leave.saved' : 'leave.noProgress')),
    gameId
      ? h('button', { type: 'button', className: 'dgm-leave-notice-action', onClick: continueGame }, t('leave.continue'))
      : null,
    h(
      'button',
      {
        type: 'button',
        className: 'dgm-leave-notice-dismiss',
        'aria-label': t('leave.dismiss'),
        title: t('leave.dismiss'),
        onClick: dismiss,
      },
      '×'
    )
  );
}
