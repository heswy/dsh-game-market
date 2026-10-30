/** My Games library (PRD 9.4): ordered rows, update/uninstall/delete entry points. */
import React from 'react';
import { hasUpdate, isBuiltin, progressSummary, sortMyGames } from '../catalog.js';
import { formatCount, formatRelativeTime, formatScore } from '../format.js';
import { isMenuOpenKey } from '../keyboard.js';
import { MoreIcon, TrashIcon } from '../icons.js';
import { EmptyBlock, ErrorBlock, InlineBanner, SkeletonRows } from './state-views.js';
import { GameCover } from './cover.js';
import { useDelayedFlag } from '../hooks.js';
import { INSTALL_ACTIVE_STAGES } from '../constants.js';

const h = React.createElement;

function activeJob(job) {
  return job && INSTALL_ACTIVE_STAGES.indexOf(job.stage) !== -1 ? job : null;
}

function rowProgress(game, t, locale) {
  const summary = progressSummary(game);
  if (summary.key === 'mygames.progress.score') {
    return t(summary.key, { score: formatScore(summary.params.score, locale) });
  }
  return t(summary.key);
}

function RowMenu(props) {
  const t = props.t;
  const game = props.game;
  const onClose = props.onClose;
  const menuRef = React.useRef(null);
  const itemsRef = React.useRef([]);
  const [opensUp, setOpensUp] = React.useState(false);
  const builtin = isBuiltin(game);
  const items = [];
  if (hasUpdate(game) && !builtin) {
    items.push({
      id: 'update',
      label: t('mygames.action.update'),
      onSelect: function update() {
        if (props.onUpdate) props.onUpdate(game);
      },
    });
  }
  for(const action of ['export','import','backup'])items.push({
    id:'save-'+action,label:t(({export:'transfer.action.export',import:'transfer.action.import',backup:'transfer.action.backup'})[action]),
    onSelect:()=>{if(props.onTransfer)props.onTransfer(game,action);},
  });
  items.push({
    id: 'uninstall',
    label: t('mygames.menu.uninstall'),
    danger: true,
    disabled: builtin,
    note: builtin ? t('mygames.menu.builtinNote') : null,
    onSelect: function uninstall() {
      if (props.onUninstall) props.onUninstall(game);
    },
  });
  items.push({
    id: 'delete-data',
    label: t('mygames.menu.deleteData'),
    danger: true,
    disabled: builtin,
    onSelect: function deleteData() {
      if (props.onDeleteData) props.onDeleteData(game);
    },
  });

  React.useEffect(
    function focusFirst() {
      const first = itemsRef.current.find(function usable(button) {
        return button && button.disabled !== true && typeof button.focus === 'function';
      });
      if (first) first.focus();
      if (menuRef.current) {
        const menu = menuRef.current;
        const scroller = menu.closest('.dgm-content');
        const edge = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
        if (menu.getBoundingClientRect().bottom > edge - 12) setOpensUp(true);
      }
    },
    []
  );

  React.useEffect(
    function closeOnOutside() {
      function onPointerDown(event) {
        if (props.triggerRef && props.triggerRef.current && props.triggerRef.current.contains(event.target)) return;
        if (menuRef.current && !menuRef.current.contains(event.target)) onClose();
      }
      document.addEventListener('mousedown', onPointerDown, true);
      return function cleanup() {
        document.removeEventListener('mousedown', onPointerDown, true);
      };
    },
    [onClose]
  );

  function focusItem(index) {
    const enabled = [];
    for (let i = 0; i < items.length; i += 1) {
      if (!items[i].disabled) enabled.push(i);
    }
    if (enabled.length === 0) return;
    const position = enabled.indexOf(index);
    const next = enabled[(position + 1) % enabled.length];
    const target = itemsRef.current[next];
    if (target) target.focus();
  }

  function handleKeyDown(event, index) {
    if (!event) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }
    if (event.key === 'Tab') {
      onClose(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(index);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const enabled = [];
      for (let i = 0; i < items.length; i += 1) if (!items[i].disabled) enabled.push(i);
      const position = enabled.indexOf(index);
      const next = enabled[(position - 1 + enabled.length) % enabled.length];
      const target = itemsRef.current[next];
      if (target) target.focus();
    }
  }

  return h(
    'div',
    {
      className: 'dgm-menu',
      'data-opens-up': opensUp ? 'true' : 'false',
      role: 'menu',
      ref: menuRef,
      'aria-label': t('mygames.menu'),
    },
    items.map(function renderItem(item, index) {
      return h(
        'button',
        {
          key: item.id,
          ref: function keep(button) {
            itemsRef.current[index] = button;
          },
          type: 'button',
          role: 'menuitem',
          className: 'dgm-menu-item',
          'data-danger': item.danger ? 'true' : 'false',
          disabled: item.disabled === true,
          title: item.note || undefined,
          onClick: function select() {
            if (item.disabled) return;
            onClose(false);
            item.onSelect();
          },
          onKeyDown: function keydown(event) {
            handleKeyDown(event, index);
          },
        },
        item.danger ? h(TrashIcon, { size: 13 }) : null,
        h('span', { className: 'dgm-menu-label' }, item.label),
        item.note ? h('span', { className: 'dgm-menu-note' }, item.note) : null
      );
    })
  );
}

function MyGameRow(props) {
  const game = props.game;
  const t = props.t;
  const locale = props.locale;
  const now = props.now;
  const job = activeJob(props.job);
  const builtin = isBuiltin(game);
  const update = hasUpdate(game);
  const percent = job && typeof job.percent === 'number' ? job.percent : null;
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuButtonRef = React.useRef(null);
  const listRef = props.listRef;
  const progressText = rowProgress(game, t, locale);
  const lastPlayed = game.lastPlayedAt
    ? t('mygames.lastPlayed', { relativeTime: formatRelativeTime(game.lastPlayedAt, now, locale) })
    : t('mygames.neverPlayed');
  const best = typeof game.bestScore === 'number' ? t('mygames.best', { score: formatScore(game.bestScore, locale) }) : null;
  const status = job
    ? t('mygames.row.status.updating')
    : game.canContinue
      ? t('mygames.row.status.continue')
      : t('mygames.row.status.play');
  const progress = job
    ? percent === null
      ? t('mygames.row.installingUnknown')
      : t('mygames.row.installing', { percent: percent + '%' })
    : progressText;

  function closeMenu(returnFocus) {
    setMenuOpen(false);
    if (returnFocus && menuButtonRef.current) menuButtonRef.current.focus();
  }

  function handlePrimaryKeyDown(event) {
    if (!event || !listRef || !listRef.current) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = Array.prototype.slice.call(listRef.current.querySelectorAll('[data-row-primary]'));
    const index = buttons.indexOf(event.currentTarget);
    if (index === -1) return;
    const next = event.key === 'ArrowDown' ? Math.min(index + 1, buttons.length - 1) : Math.max(index - 1, 0);
    if (next !== index) {
      event.preventDefault();
      buttons[next].focus();
    }
  }

  return h(
    'div',
    {
      className: 'dgm-row',
      role: 'listitem',
      'data-row-id': game.id,
      'data-installing': job ? 'true' : 'false',
    },
    h(
      'button',
      {
        type: 'button',
        className: 'dgm-row-cover',
        onClick: function open() {
          if (!job && props.onOpen) props.onOpen(game.id);
        },
        disabled: Boolean(job),
        'aria-label': t('market.card.open'),
        tabIndex: -1,
      },
      h(GameCover, { game: game, variant: 'row' })
    ),
    h(
      'div',
      { className: 'dgm-row-main' },
      h(
        'div',
        { className: 'dgm-row-title-line' },
        h(
          'button',
          {
            type: 'button',
            className: 'dgm-row-title-btn',
            'data-row-primary': true,
            disabled: Boolean(job),
            onClick: function open() {
              if (!job && props.onOpen) props.onOpen(game.id);
            },
            onKeyDown: handlePrimaryKeyDown,
            'aria-label': t('mygames.row.a11y', {
              name: game.name || game.id,
              status: status,
              progress: progress,
            }),
          },
          game.name || game.id
        ),
        builtin ? h('span', { className: 'dgm-row-badge' }, t('market.source.builtin')) : null,
        update && !job
          ? h(
              'span',
              { className: 'dgm-row-update' },
              h('span', { className: 'dgm-dot', 'aria-hidden': 'true' }),
              t('mygames.update.available', { version: game.updateVersion || '' })
            )
          : null
      ),
      job
        ? h(
            'div',
            { className: 'dgm-row-progress' },
            h(
              'div',
              {
                className: 'dgm-progress-track',
                role: 'progressbar',
                'aria-valuemin': 0,
                'aria-valuemax': 100,
                'aria-valuenow': percent === null ? undefined : percent,
                'aria-valuetext': progress,
              },
              percent === null
                ? h('span', { className: 'dgm-progress-fill dgm-progress-indeterminate' })
                : h('span', { className: 'dgm-progress-fill', style: { transform: 'scaleX(' + percent / 100 + ')' } })
            ),
            h('span', { className: 'dgm-row-progress-text' }, progress)
          )
        : h(
            'p',
            { className: 'dgm-row-meta' },
            progressText,
            h('span', { className: 'dgm-sep', 'aria-hidden': 'true' }, '·'),
            lastPlayed,
            best
              ? h(
                  React.Fragment,
                  null,
                  h('span', { className: 'dgm-sep', 'aria-hidden': 'true' }, '·'),
                  h('span', { className: 'dgm-row-best' }, best)
                )
              : null
          )
    ),
    h(
      'div',
      { className: 'dgm-row-controls' },
      props.job && props.job.stage === 'failed' && props.job.kind === 'install'
        ? h('span', { className: 'dgm-row-update-failed', role: 'alert' }, t('mygames.action.updateFailed'))
        : null,
      update && !job
        ? h(
            'button',
            {
              type: 'button',
              className: 'dgm-btn dgm-btn-ghost dgm-row-update-btn',
              onClick: function updateNow() {
                if (props.onUpdate) props.onUpdate(game);
              },
              disabled: game.updateReason === 'incompatible',
              title: game.updateReason === 'incompatible' ? t('mygames.update.incompatible') : undefined,
            },
            t('mygames.action.update')
          )
        : null,
      job
        ? null
        : h(
            'button',
            {
              type: 'button',
              className: game.canContinue ? 'dgm-btn dgm-btn-primary dgm-row-play' : 'dgm-btn dgm-row-play',
              'data-row-primary': true,
              onClick: function play() {
                if (job) return;
                if (game.missing === true && props.onReinstall) props.onReinstall(game);
                else if (props.onPlay) props.onPlay(game);
              },
              onKeyDown: handlePrimaryKeyDown,
            },
            game.canContinue ? t('mygames.action.continue') : game.missing === true ? t('mygames.action.reinstall') : t('mygames.action.play')
          ),
      h(
        'button',
        {
          type: 'button',
          ref: menuButtonRef,
          className: 'dgm-icon-btn dgm-row-menu-btn',
          'data-row-menu': true,
          'aria-label': t('mygames.menu'),
          title: t('mygames.menu'),
          'aria-haspopup': 'menu',
          'aria-expanded': menuOpen ? 'true' : 'false',
          onClick: function toggle() {
            setMenuOpen(!menuOpen);
          },
          onKeyDown: function keydown(event) {
            if (isMenuOpenKey(event)) {
              event.preventDefault();
              setMenuOpen(true);
            }
          },
        },
        h(MoreIcon, { size: 14 })
      ),
      menuOpen
        ? h(RowMenu, {
            t: t,
            game: game,
            triggerRef: menuButtonRef,
            onUpdate: props.onUpdate,
            onUninstall: props.onUninstall,
            onDeleteData: props.onDeleteData,
            onTransfer: props.onTransfer,
            onClose: closeMenu,
          })
        : null
    )
  );
}

export function MyGamesPage(props) {
  const state = props.state;
  const t = props.t;
  const locale = props.locale;
  const now = props.now;
  const market = state.market;
  const installed = sortMyGames(Array.isArray(market.games) ? market.games : [], locale);
  const loading = market.status === 'loading' || market.status === 'idle';
  const showSkeleton = useDelayedFlag(loading && installed.length === 0, 250);
  const listRef = React.useRef(null);

  if (installed.length === 0) {
    if (showSkeleton) {
      return h(
        'div',
        { className: 'dgm-mygames' },
        h('span', { className: 'dgm-sr-only', role: 'status' }, t('mygames.loading')),
        h(SkeletonRows, { count: 6 })
      );
    }
    if (market.status === 'error') {
      return h(
        'div',
        { className: 'dgm-mygames' },
        h(ErrorBlock, {
          t: t,
          title: t('mygames.error.load'),
          code: market.error ? market.error.code : null,
          onRetry: props.onRetry,
          retryLabel: t('market.retry'),
        })
      );
    }
    return h(
      'div',
      { className: 'dgm-mygames' },
      h(EmptyBlock, {
        t: t,
        title: t('mygames.empty.title'),
        body: t('mygames.empty.body'),
        actionLabel: t('mygames.empty.action'),
        onAction: props.onBrowse,
      })
    );
  }

  return h(
    'div',
    { className: 'dgm-mygames' },
    market.offline
      ? h(InlineBanner, {
          text: t('market.offline'),
          actionLabel: t('market.offline.retry'),
          onAction: props.onRetry,
        })
      : null,
    market.status === 'error'
      ? h(InlineBanner, {
          text: t('mygames.error.load'),
          actionLabel: t('market.retry'),
          onAction: props.onRetry,
          role: 'alert',
        })
      : null,
    h(
      'div',
      { className: 'dgm-library-head' },
      h(
        'div',
        null,
        h('h1', { className: 'dgm-page-title', 'data-page-heading': true, tabIndex: -1 }, t('mygames.title')),
        h('p', null, t('mygames.intro'))
      ),
      h('span', { className: 'dgm-library-count' }, t('mygames.count', { count: formatCount(installed.length, locale) }))
    ),
    h(
      'div',
      { className: 'dgm-list', role: 'list', ref: listRef },
      installed.map(function renderRow(game) {
        return h(MyGameRow, {
          key: game.id,
          game: game,
          job: state.installJobs ? state.installJobs[game.id] || null : null,
          t: t,
          locale: locale,
          now: now,
          listRef: listRef,
          onOpen: props.onOpen,
          onPlay: props.onPlay,
          onReinstall: props.onReinstall,
          onUpdate: props.onUpdate,
          onUninstall: props.onUninstall,
          onDeleteData: props.onDeleteData,
          onTransfer: props.onTransfer,
        });
      })
    ),
    market.offline
      ? h(
          'footer',
          { className: 'dgm-footer' },
          h('span', { className: 'dgm-footer-offline' },
            h('span', { className: 'dgm-dot', 'aria-hidden': 'true' }),
            t('market.footer.offline'))
        )
      : null
  );
}
