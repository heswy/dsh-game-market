/** Agent Presence: placeholder whale + one-line bubble with one action. */
import React from 'react';
import { WhaleIcon } from '../icons.js';
import { PRESENCE, presenceActionKey, presenceBubbleDefaultOpen, presenceLabelKey, presencePillKey } from '../presence.js';

const h = React.createElement;

const COLLAPSE_DELAYS = Object.freeze({
  'waiting-user': 45000,
  completed: 12000,
  error: 15000,
});

function actionIdFor(presence) {
  if (presence === PRESENCE.WAITING) return 'waiting';
  if (presence === PRESENCE.COMPLETED) return 'results';
  if (presence === PRESENCE.ERROR) return 'results';
  return 'return';
}

export function AgentPresence(props) {
  const presence = props && typeof props.presence === 'string' ? props.presence : PRESENCE.IDLE;
  const agent = props && props.agent ? props.agent : null;
  const t = typeof props.t === 'function' ? props.t : function noTranslate(key) {
    return key;
  };
  const onAction = typeof props.onAction === 'function' ? props.onAction : function noop() {};
  const busy = props.busy === true;
  const dimmed = props.dimmed === true;
  const defaultOpen = presenceBubbleDefaultOpen(presence);
  const [open, setOpen] = React.useState(defaultOpen);
  const [collapsed, setCollapsed] = React.useState(!defaultOpen);

  React.useEffect(
    function syncPresence() {
      const nextOpen = presenceBubbleDefaultOpen(presence);
      setOpen(nextOpen);
      setCollapsed(!nextOpen);
      if (!nextOpen) return undefined;
      const delay = COLLAPSE_DELAYS[presence] || 12000;
      const timer = setTimeout(function collapse() {
        setCollapsed(true);
      }, delay);
      return function cleanup() {
        clearTimeout(timer);
      };
    },
    [presence]
  );

  const labelKey = presenceLabelKey(presence, agent);
  const actionKey = presenceActionKey(presence);
  const label = t(labelKey);
  const actionLabel = t(actionKey);
  const ariaLabel = t('agent.a11y.whale', { state: label, action: actionLabel });
  const showBubble = open && !collapsed;
  const pillKey = presencePillKey(presence);

  function activate() {
    if (busy) return;
    if (presence === PRESENCE.WAITING) {
      onAction(actionIdFor(presence));
      return;
    }
    if (showBubble && presence !== PRESENCE.COMPLETED && presence !== PRESENCE.ERROR) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setCollapsed(false);
  }

  function runAction() {
    if (busy) return;
    onAction(actionIdFor(presence));
  }

  return h(
    'div',
    { className: 'dgm-presence', 'data-presence': presence, style: dimmed ? { opacity: 0.7 } : undefined },
    showBubble
      ? h(
          'div',
          { className: 'dgm-whale-bubble', role: 'status', 'aria-label': t('agent.a11y.bubble') },
          h('p', { className: 'dgm-bubble-text' }, busy ? t('agent.a11y.saveBusy') : label),
          h(
            'button',
            { type: 'button', className: 'dgm-bubble-action', onClick: runAction, disabled: busy },
            actionLabel
          )
        )
      : collapsed && pillKey
        ? h(
            'button',
            {
              type: 'button',
              className: 'dgm-whale-pill',
              onClick: function expand() {
                setOpen(true);
                setCollapsed(false);
              },
              'aria-label': ariaLabel,
            },
            t(pillKey)
          )
        : null,
    h(
      'button',
      {
        type: 'button',
        className: 'dgm-whale-btn',
        'data-state': presence,
        'aria-label': ariaLabel,
        'aria-expanded': showBubble ? 'true' : 'false',
        onClick: activate,
      },
      h(WhaleIcon, { state: presence, size: 44 })
    )
  );
}
