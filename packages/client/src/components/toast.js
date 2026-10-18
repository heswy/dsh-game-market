/** In-app toasts anchored to the content area, not the screen edge (PRD 9.9.5). */
import React from 'react';
import { CloseIcon, PlayIcon } from '../icons.js';
import { TOAST_MS } from '../constants.js';

const h = React.createElement;

function ToastItem(props) {
  const toast = props.toast;
  const t = props.t;
  const dismissRef = React.useRef(props.onDismiss);
  dismissRef.current = props.onDismiss;
  React.useEffect(
    function autoDismiss() {
      const duration = typeof toast.duration === 'number' ? toast.duration : TOAST_MS;
      const timer = setTimeout(function dismiss() {
        if (dismissRef.current) dismissRef.current(toast.id);
      }, duration);
      return function cleanup() {
        clearTimeout(timer);
      };
    },
    [toast.id, toast.duration]
  );

  const text = toast.textKey ? t(toast.textKey, toast.params) : '';
  return h(
    'div',
    { className: 'dgm-toast', 'data-kind': toast.kind || 'info', role: 'status' },
    h('span', { className: 'dgm-toast-text' }, text),
    toast.action
      ? h(
          'button',
          {
            type: 'button',
            className: 'dgm-toast-action',
            onClick: function act() {
              props.onAction(toast);
            },
          },
          toast.action.kind === 'play' ? h(PlayIcon, { size: 11 }) : null,
          toast.action.kind === 'play' ? t('toast.installed.action') : t('common.done')
        )
      : null,
    h(
      'button',
      {
        type: 'button',
        className: 'dgm-toast-close',
        onClick: function dismiss() {
          props.onDismiss(toast.id);
        },
        'aria-label': t('toast.dismiss'),
        title: t('toast.dismiss'),
      },
      h(CloseIcon, { size: 11 })
    )
  );
}

export function ToastViewport(props) {
  const toasts = Array.isArray(props.toasts) ? props.toasts : [];
  if (toasts.length === 0) return null;
  return h(
    'div',
    { className: 'dgm-toasts', 'aria-live': 'polite', 'aria-atomic': 'false' },
    toasts.map(function render(toast) {
      return h(ToastItem, {
        key: toast.id,
        toast: toast,
        t: props.t,
        onDismiss: props.onDismiss,
        onAction: props.onAction,
      });
    })
  );
}
