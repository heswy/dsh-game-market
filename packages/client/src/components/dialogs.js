/** Confirmation dialogs and the screenshot lightbox (PRD 9.4.4 / 9.5.1 / 9.10). */
import React from 'react';
import { CloseIcon, ChevronLeftIcon, ChevronRightIcon, RefreshIcon, SettingsIcon, TrashIcon } from '../icons.js';
import { formatRelativeTime } from '../format.js';
import { trapTabIndex } from '../keyboard.js';
import { platformUpdateDialogCopy } from '../update-copy.js';
import { UpdateSection } from './update-section.js';

const h = React.createElement;

function focusables(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  return Array.prototype.slice
    .call(root.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
    .filter(function visible(node) {
      return node.offsetParent !== null || node === document.activeElement;
    });
}

function useFocusTrap(rootRef, onEscape, active) {
  const escapeRef = React.useRef(onEscape);
  escapeRef.current = onEscape;
  React.useEffect(
    function trap() {
      if (!active) return undefined;
      const root = rootRef.current;
      const nodes = focusables(root);
      const initial = root && root.querySelector('[data-autofocus="true"]');
      const first = initial || nodes[0];
      if (first && typeof first.focus === 'function') {
        try {
          first.focus({ preventScroll: true });
        } catch (_error) {
          first.focus();
        }
      }
      function handleKeyDown(event) {
        if (!event) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (escapeRef.current) escapeRef.current();
          return;
        }
        if (event.key !== 'Tab') return;
        const current = focusables(root);
        if (current.length === 0) return;
        const index = current.indexOf(document.activeElement);
        const next = trapTabIndex(index, event.shiftKey, current.length);
        const target = current[next];
        if (target) {
          event.preventDefault();
          target.focus();
        }
      }
      if (typeof document !== 'undefined') document.addEventListener('keydown', handleKeyDown, true);
      return function cleanup() {
        if (typeof document !== 'undefined') document.removeEventListener('keydown', handleKeyDown, true);
      };
    },
    [active, rootRef]
  );
}

export function ConfirmDialog(props) {
  const dialog = props.dialog;
  const t = props.t;
  const game = props.game || {};
  const gameName = game.name || game.id || '';
  const rootRef = React.useRef(null);
  const busy = dialog.busy === true;
  useFocusTrap(rootRef, function escape() {
    if (!busy) props.onClose();
  }, true);

  if (!dialog) return null;

  let title = '';
  let body = '';
  let primaryLabel = t('common.confirm');
  let danger = false;
  let showCheckbox = false;
  let showDeleteWarning = false;
  let noteKey = null;
  let twoClick = false;
  let confirmAgain = false;

  if (dialog.kind === 'uninstall') {
    title = t('mygames.uninstall.title', { gameName: gameName });
    body = t('mygames.uninstall.body');
    showCheckbox = true;
    showDeleteWarning = dialog.deleteData === true;
    primaryLabel = dialog.deleteData ? t('mygames.uninstall.confirmDelete') : t('mygames.uninstall.confirm');
    danger = true;
  } else if (dialog.kind === 'delete-data') {
    title = t('mygames.deleteData.title', { gameName: gameName });
    body = t('mygames.deleteData.body');
    primaryLabel = dialog.confirmAgain ? t('mygames.deleteData.confirmAgain') : t('mygames.deleteData.confirm');
    danger = true;
    noteKey = 'mygames.deleteData.uninstallNote';
    twoClick = true;
    confirmAgain = dialog.confirmAgain === true;
  } else if (dialog.kind === 'restart') {
    title = t('mygames.restart.title', { gameName: gameName });
    body = t('mygames.restart.body');
    primaryLabel = t('mygames.restart.confirm');
    danger = true;
  } else if (dialog.kind === 'install-local') {
    title = t('dialog.installLocal.title', { fileName: dialog.fileName || '' });
    body = t('dialog.installLocal.body');
    primaryLabel = t('dialog.installLocal.confirm');
  }

  function handlePrimary() {
    if (busy) return;
    if (twoClick && !confirmAgain) {
      props.onConfirmAgain();
      return;
    }
    props.onConfirm();
  }

  return h(
    'div',
    {
      className: 'dgm-overlay dgm-dialog-overlay',
      role: 'presentation',
      onMouseDown: function backdrop(event) {
        if (event.target === event.currentTarget && !busy) props.onClose();
      },
    },
    h(
      'div',
      {
        className: 'dgm-dialog',
        role: danger ? 'alertdialog' : 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'dgm-dialog-title',
        'aria-describedby': 'dgm-dialog-body',
        ref: rootRef,
      },
      h('h2', { className: 'dgm-dialog-title', id: 'dgm-dialog-title' }, title),
      h('p', { className: 'dgm-dialog-body', id: 'dgm-dialog-body' }, body),
      noteKey ? h('p', { className: 'dgm-dialog-note' }, t(noteKey)) : null,
      dialog.kind === 'install-local'
        ? h(
            'dl',
            { className: 'dgm-dialog-meta' },
            dialog.fileSizeLabel
              ? h(
                  'div',
                  { className: 'dgm-dialog-meta-row' },
                  h('dt', null, t('dialog.installLocal.fileSize')),
                  h('dd', null, dialog.fileSizeLabel)
                )
              : null,
            dialog.formatLabel
              ? h(
                  'div',
                  { className: 'dgm-dialog-meta-row' },
                  h('dt', null, t('dialog.installLocal.format')),
                  h('dd', null, dialog.formatLabel)
                )
              : null
          )
        : null,
      dialog.kind === 'install-local' && dialog.overwrite
        ? h(
            'p',
            { className: 'dgm-dialog-note' },
            t('dialog.installLocal.overwrite', {
              gameName: dialog.overwrite.gameName || dialog.overwrite.gameId || '',
              currentVersion: dialog.overwrite.currentVersion || '',
              version: dialog.overwrite.version || '',
            })
          )
        : null,
      dialog.kind === 'install-local' ? h('p', { className: 'dgm-dialog-warning' }, t('market.localInstall.warning')) : null,
      showCheckbox
        ? h(
            'label',
            { className: 'dgm-checkbox' },
            h('input', {
              type: 'checkbox',
              checked: dialog.deleteData === true,
              disabled: busy,
              onChange: function toggle(event) {
                props.onToggleDeleteData(event.target.checked);
              },
            }),
            h('span', null, t('mygames.uninstall.deleteData'))
          )
        : null,
      showDeleteWarning ? h('p', { className: 'dgm-dialog-warning' }, t('mygames.uninstall.warning')) : null,
      h(
        'div',
        { className: 'dgm-dialog-actions' },
        h(
          'button',
          {
            type: 'button',
            className: 'dgm-btn dgm-btn-quiet',
            'data-autofocus': 'true',
            disabled: busy,
            onClick: function cancel() {
              if (!busy) props.onClose();
            },
          },
          t('common.cancel')
        ),
        h(
          'button',
          {
            type: 'button',
            className: danger ? 'dgm-btn dgm-btn-danger' : 'dgm-btn dgm-btn-primary',
            disabled: busy,
            onClick: handlePrimary,
          },
          danger && dialog.kind !== 'install-local' ? h(TrashIcon, { size: 13 }) : null,
          busy ? t('dialog.pending') : primaryLabel
        )
      )
    )
  );
}

export function Lightbox(props) {
  const images = Array.isArray(props.images) ? props.images : [];
  const index = typeof props.index === 'number' ? props.index : 0;
  const t = props.t;
  const [failed, setFailed] = React.useState(false);
  React.useEffect(
    function resetFailure() {
      setFailed(false);
    },
    [index]
  );
  const rootRef = React.useRef(null);
  const returnFocusRef = React.useRef(null);

  React.useEffect(
    function rememberFocus() {
      returnFocusRef.current = document.activeElement;
      return function restore() {
        const node = returnFocusRef.current;
        if (node && typeof node.focus === 'function') {
          try {
            node.focus({ preventScroll: true });
          } catch (_error) {
            node.focus();
          }
        }
      };
    },
    []
  );

  useFocusTrap(rootRef, function escape() {
    props.onClose();
  }, true);

  const changeRef = React.useRef(props.onChange);
  changeRef.current = props.onChange;
  React.useEffect(
    function arrowKeys() {
      function onKeyDown(event) {
        if (!event) return;
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          if (changeRef.current) changeRef.current((index - 1 + images.length) % images.length);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          if (changeRef.current) changeRef.current((index + 1) % images.length);
        }
      }
      document.addEventListener('keydown', onKeyDown);
      return function cleanup() {
        document.removeEventListener('keydown', onKeyDown);
      };
    },
    [index, images.length]
  );

  if (images.length === 0) return null;
  const current = images[Math.min(Math.max(index, 0), images.length - 1)];

  return h(
    'div',
    {
      className: 'dgm-lightbox',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': t('detail.preview'),
      ref: rootRef,
      onMouseDown: function backdrop(event) {
        if (event.target === event.currentTarget) props.onClose();
      },
    },
    h(
      'div',
      { className: 'dgm-lightbox-bar' },
      h(
        'span',
        { className: 'dgm-lightbox-count' },
        String(index + 1) + ' / ' + String(images.length)
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'dgm-icon-btn dgm-lightbox-close',
          'data-autofocus': 'true',
          onClick: props.onClose,
          'aria-label': t('detail.screenshot.close'),
          title: t('detail.screenshot.close'),
        },
        h(CloseIcon, { size: 15 })
      )
    ),
    failed
      ? h('div', { className: 'dgm-lightbox-fallback' }, t('detail.screenshot.failed'))
      : h('img', {
          className: 'dgm-lightbox-img',
          src: current,
          alt: '',
          draggable: false,
          onError: function onError() {
            setFailed(true);
          },
        }),
    images.length > 1
      ? h(
          React.Fragment,
          null,
          h(
            'button',
            {
              type: 'button',
              className: 'dgm-lightbox-nav dgm-lightbox-prev',
              onClick: function prev() {
                props.onChange((index - 1 + images.length) % images.length);
              },
              'aria-label': t('detail.screenshot.prev'),
              title: t('detail.screenshot.prev'),
            },
            h(ChevronLeftIcon, { size: 18 })
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dgm-lightbox-nav dgm-lightbox-next',
              onClick: function next() {
                props.onChange((index + 1) % images.length);
              },
              'aria-label': t('detail.screenshot.next'),
              title: t('detail.screenshot.next'),
            },
            h(ChevronRightIcon, { size: 18 })
          )
        )
      : null
  );
}


/**
 * V1.5 M3 platform-update confirmation (m3-decisions §2/§4).
 *
 * Explicit copy: the update affects every session in the current profile, may
 * require a DSH restart, and targets an exact version + full 40-hex commit.
 */
export function PlatformUpdateDialog(props) {
  const dialog = props.dialog;
  const t = props.t;
  const rootRef = React.useRef(null);
  const busy = Boolean(dialog && dialog.busy === true);
  useFocusTrap(
    rootRef,
    function escape() {
      if (!busy) props.onClose();
    },
    true
  );
  if (!dialog) return null;
  const copy = platformUpdateDialogCopy(dialog, t);
  return h(
    'div',
    {
      className: 'dgm-overlay dgm-dialog-overlay',
      role: 'presentation',
      onMouseDown: function backdrop(event) {
        if (event.target === event.currentTarget && !busy) props.onClose();
      },
    },
    h(
      'div',
      {
        className: 'dgm-dialog dgm-update-dialog',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-labelledby': 'dgm-dialog-title',
        'aria-describedby': 'dgm-dialog-body',
        ref: rootRef,
      },
      h('h2', { className: 'dgm-dialog-title', id: 'dgm-dialog-title' }, copy.title),
      h('p', { className: 'dgm-dialog-body', id: 'dgm-dialog-body' }, copy.body),
      h(
        'dl',
        { className: 'dgm-dialog-meta dgm-update-dialog-meta' },
        copy.meta.map(function row(entry, index) {
          return h(
            'div',
            { className: 'dgm-dialog-meta-row', key: 'meta-' + String(index) },
            h('dt', null, entry.label),
            h(entry.mono ? 'dd' : 'dd', { className: entry.mono ? 'dgm-mono dgm-update-dialog-commit' : undefined }, entry.value)
          );
        })
      ),
      h(
        'ul',
        { className: 'dgm-update-dialog-warnings' },
        copy.warnings.map(function warning(text, index) {
          return h('li', { key: 'warning-' + String(index) }, text);
        })
      ),
      h(
        'div',
        { className: 'dgm-dialog-actions' },
        h(
          'button',
          {
            type: 'button',
            className: 'dgm-btn dgm-btn-quiet',
            'data-autofocus': 'true',
            disabled: busy,
            onClick: function cancel() {
              if (!busy) props.onClose();
            },
          },
          t('common.cancel')
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dgm-btn dgm-btn-primary',
            disabled: busy,
            onClick: function confirm() {
              if (!busy) props.onConfirm();
            },
          },
          busy ? copy.busyLabel : copy.primary
        )
      )
    )
  );
}

/** Registry states that mean the official catalog could not be read right now. */
const REGISTRY_DEGRADED_STATES = Object.freeze(['offline', 'expired', 'seed', 'missing']);

/** Settings surface: catalog refresh and platform version/update diagnostics. */
export function SettingsDialog(props) {
  const t = props.t;
  const rootRef = React.useRef(null);
  const busy = props.catalogBusy === true;
  useFocusTrap(rootRef, props.onClose, true);

  const registry = props.registry && typeof props.registry === 'object' ? props.registry : null;
  const registryState = registry && typeof registry.state === 'string' ? registry.state : 'missing';
  const registryDegraded = REGISTRY_DEGRADED_STATES.includes(registryState);
  const registryNotes = {
    stale: t('settings.catalog.state.stale'),
    offline: t('settings.catalog.state.offline'),
    expired: t('settings.catalog.state.expired'),
    seed: t('settings.catalog.state.seed'),
    missing: t('settings.catalog.state.missing'),
  };
  const registryNote = registryNotes[registryState] || null;
  const registryFetchedAt =
    registry && typeof registry.fetchedAt === 'string' ? formatRelativeTime(registry.fetchedAt, props.now, props.locale) : null;

  return h(
    'div',
    {
      className: 'dgm-overlay dgm-dialog-overlay',
      role: 'presentation',
      onMouseDown: function backdrop(event) {
        if (event.target === event.currentTarget) props.onClose();
      },
    },
    h(
      'div',
      {
        className: 'dgm-dialog dgm-settings-dialog',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'dgm-settings-title',
        ref: rootRef,
      },
      h(
        'div',
        { className: 'dgm-settings-head' },
        h(
          'div',
          { className: 'dgm-settings-head-main' },
          h('h2', { className: 'dgm-settings-title', id: 'dgm-settings-title' }, t('settings.title')),
          h(
            'span',
            { className: 'dgm-settings-status', 'data-offline': registryDegraded ? 'true' : 'false' },
            h('span', { className: 'dgm-dot' }),
            registryDegraded ? t('settings.catalog.offline') : t('settings.catalog.online')
          )
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'dgm-icon-btn dgm-settings-close',
            'data-autofocus': 'true',
            'aria-label': t('common.close'),
            title: t('common.close'),
            onClick: props.onClose,
          },
          h(CloseIcon, { size: 15 })
        )
      ),
      h(
        'div',
        { className: 'dgm-settings-body' },
        h(
          'section',
          { className: 'dgm-settings-block', 'aria-labelledby': 'dgm-settings-catalog-title' },
          h(
            'div',
            { className: 'dgm-settings-block-head' },
            h(
              'h3',
              { className: 'dgm-settings-block-title', id: 'dgm-settings-catalog-title' },
              h(SettingsIcon, { size: 13 }),
              t('settings.catalog.title')
            )
          ),
          h('p', { className: 'dgm-settings-note' }, t('settings.catalog.note')),
          registryNote || registryFetchedAt
            ? h(
                'p',
                { className: 'dgm-settings-registry', role: 'status' },
                registryNote ? h('span', { className: 'dgm-settings-registry-state' }, registryNote) : null,
                registryFetchedAt
                  ? h('span', { className: 'dgm-settings-registry-time' }, t('settings.catalog.updated', { relativeTime: registryFetchedAt }))
                  : null
              )
            : null,
          h(
            'div',
            { className: 'dgm-settings-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dgm-btn dgm-settings-action',
                disabled: busy,
                onClick: props.onRefreshCatalog,
              },
              h(RefreshIcon, { size: 13 }),
              busy ? t('settings.catalog.refreshing') : t('market.refresh')
            )
          )
        ),
        props.updateView && !props.updateView.hidden
          ? h(UpdateSection, {
              view: props.updateView,
              t: t,
              locale: props.locale,
              now: props.now,
              compact: true,
              onRefresh: props.onRefreshUpdate,
              onOpenUpdate: props.onOpenUpdate,
              onCancel: props.onCancelUpdate,
              onRefreshPage: props.onRefreshPage,
            })
          : null
      )
    )
  );
}
