/** Game detail page: hero, two columns, the single primary action (PRD 9.5). */
import React from 'react';
import { authorName, categoryLabel, detailActionReasonKey, initialFor, resolveDetailAction, resolvePermissions, screenshotsFor } from '../catalog.js';
import { formatAbsoluteTime, formatBytes, formatRelativeTime, formatScore } from '../format.js';
import { installStageTextKey } from '../errors-text.js';
import { MAX_SCREENSHOTS } from '../constants.js';
import { CheckIcon, PlayIcon, ShieldIcon, TrophyIcon } from '../icons.js';
import { ErrorBlock, SectionHeader, SkeletonDetail } from './state-views.js';
import { GameCover } from './cover.js';

const h = React.createElement;

function primaryLabel(action, t) {
  switch (action.kind) {
    case 'install':
      return t('detail.action.install');
    case 'reinstall':
      return t('detail.action.reinstall');
    case 'retry-install':
      return t('detail.action.retry');
    case 'cancel-install':
      return t(action.cleanup ? 'detail.install.cancelCleanup' : 'detail.action.cancelInstall');
    case 'update':
      return t('detail.action.update');
    case 'play':
      return t('detail.action.play');
    case 'continue':
      return t('detail.action.continue');
    case 'resume':
      return t('detail.action.resume');
    case 'incompatible':
      return t('detail.action.incompatible');
    case 'uninstalling':
      return t('mygames.remove.busy');
    default:
      return t('detail.action.install');
  }
}

function PrimaryAction(props) {
  const action = props.action;
  const t = props.t;
  const job = props.job;
  const percent = job && typeof job.percent === 'number' ? job.percent : null;
  const stageKey = job ? installStageTextKey(job.stage, percent) : null;
  const stageText = stageKey ? t(stageKey, { percent: percent === null ? '' : percent }) : '';
  const reason = detailActionReasonKey(action);
  const reasonText = reason ? t(reason, action.reasonParams || {}) : '';
  const busy = action.kind === 'cancel-install';

  function handleClick() {
    if (action.disabled) return;
    switch (action.kind) {
      case 'install':
      case 'reinstall':
      case 'retry-install':
        if (props.onInstall) props.onInstall();
        break;
      case 'cancel-install':
        if (props.onCancelInstall) props.onCancelInstall();
        break;
      case 'update':
        if (props.onUpdate) props.onUpdate();
        break;
      case 'play':
      case 'continue':
      case 'resume':
        if (props.onPlay) props.onPlay(action.kind);
        break;
      default:
        break;
    }
  }

  if (action.kind === 'loading') {
    return h('span', { className: 'dgm-skeleton-button', 'aria-hidden': 'true' });
  }
  if (action.kind === 'unavailable') return null;

  return h(
    'div',
    { className: 'dgm-primary' },
    h(
      'button',
      {
        type: 'button',
        className: 'dgm-btn dgm-btn-primary dgm-primary-btn',
        'data-action': action.kind,
        disabled: action.disabled === true,
        'aria-disabled': action.disabled === true ? 'true' : undefined,
        onClick: handleClick,
      },
      action.kind === 'retry-install' ? h(PlayIcon, { size: 13 }) : null,
      primaryLabel(action, t)
    ),
    busy
      ? h(
          'div',
          { className: 'dgm-install-progress' },
          h(
            'div',
            {
              className: 'dgm-progress-track',
              role: 'progressbar',
              'aria-valuemin': 0,
              'aria-valuemax': 100,
              'aria-valuenow': percent === null ? undefined : percent,
              'aria-valuetext': stageText,
            },
            percent === null
              ? h('span', { className: 'dgm-progress-fill dgm-progress-indeterminate' })
              : h('span', { className: 'dgm-progress-fill', style: { transform: 'scaleX(' + percent / 100 + ')' } })
          ),
          h('p', { className: 'dgm-install-stage' }, stageText)
        )
      : null,
    action.kind === 'retry-install' && job
      ? h(
          'div',
          { className: 'dgm-install-failure', role: 'alert' },
          h('p', { className: 'dgm-install-failure-reason' }, t(job.reasonKey || 'detail.install.failed.unknown')),
          job.error && job.error.code
            ? h('p', { className: 'dgm-install-failure-code' }, t('runtime.diagnostic', { code: job.error.code }))
            : null
        )
      : null,
    reasonText && action.disabled
      ? h('p', { className: 'dgm-primary-reason' }, reasonText)
      : null
  );
}

function SecondaryAction(props) {
  const secondary = props.secondary;
  const t = props.t;
  if (!secondary) return null;
  if (secondary.kind === 'restart') return null;
  let label = secondary.labelKey ? t(secondary.labelKey, secondary.reasonParams || {}) : '';
  if (secondary.kind === 'update-unavailable') {
    label = t('detail.action.updateUnavailable');
  }
  function handleClick() {
    if (secondary.disabled) return;
    if (props.onClick) props.onClick(secondary);
  }
  return h(
    'button',
    {
      type: 'button',
      className: 'dgm-btn dgm-btn-quiet dgm-secondary-btn',
      'data-action': secondary.kind,
      disabled: secondary.disabled === true,
      onClick: handleClick,
      title: secondary.reasonKey ? t(secondary.reasonKey, secondary.reasonParams || {}) : undefined,
    },
    label
  );
}

function PermissionBlock(props) {
  const t = props.t;
  const permissions = resolvePermissions(props.game);
  return h(
    'section',
    { className: 'dgm-rail-block dgm-permissions' },
    h(
      'h3',
      { className: 'dgm-rail-title' },
      h(ShieldIcon, { size: 13 }),
      t('detail.permissions.title')
    ),
    h('p', { className: 'dgm-rail-body' }, t(permissions.key)),
    permissions.noteKey ? h('p', { className: 'dgm-rail-note' }, t(permissions.noteKey)) : null
  );
}

function LeaderboardBlock(props) {
  const t = props.t;
  const locale = props.locale;
  const now = props.now;
  const scores = props.scores;
  const bestValue =
    typeof props.bestScore === 'number'
      ? props.bestScore
      : scores && scores.best && typeof scores.best.value === 'number'
        ? scores.best.value
        : null;
  const history = scores && Array.isArray(scores.history) ? scores.history.slice(-3).reverse() : [];
  if (bestValue === null && history.length === 0) return null;
  return h(
    'section',
    { className: 'dgm-rail-block dgm-leaderboard' },
    h(
      'h3',
      { className: 'dgm-rail-title' },
      h(TrophyIcon, { size: 13 }),
      t('detail.leaderboard.title')
    ),
    bestValue !== null
      ? h('p', { className: 'dgm-leaderboard-best' }, t('detail.leaderboard.best', { score: formatScore(bestValue, locale) }))
      : null,
    history.length > 0
      ? h(
          'div',
          { className: 'dgm-leaderboard-list' },
          h('p', { className: 'dgm-rail-note' }, t('detail.leaderboard.recent')),
          history.map(function row(entry, index) {
            const value = entry && typeof entry.value === 'number' ? entry.value : entry && typeof entry.score === 'number' ? entry.score : null;
            const at = entry && typeof entry.achievedAt === 'string' ? entry.achievedAt : null;
            return h(
              'div',
              { className: 'dgm-leaderboard-row', key: 'score-' + index },
              h('span', { className: 'dgm-leaderboard-value' }, value === null ? '—' : formatScore(value, locale)),
              at ? h('span', { className: 'dgm-leaderboard-time' }, formatRelativeTime(at, now, locale)) : null
            );
          })
        )
      : null
  );
}

function PreviewThumb(props) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(
    function reset() {
      setFailed(false);
    },
    [props.url]
  );
  return h(
    'button',
    {
      type: 'button',
      className: 'dgm-preview-btn',
      onClick: props.onOpen,
      'aria-label': props.t('detail.screenshot.open'),
      'data-screenshot-index': props.index,
    },
    failed
      ? h(
          'span',
          { className: 'dgm-preview-fallback' },
          h('span', { className: 'dgm-preview-fallback-initial', 'aria-hidden': 'true' }, initialFor(props.gameName)),
          h('span', { className: 'dgm-preview-fallback-text' }, props.t('detail.screenshot.failed'))
        )
      : h('img', {
          src: props.url,
          alt: '',
          loading: 'lazy',
          draggable: false,
          onError: function onError() {
            setFailed(true);
          },
        })
  );
}

function DetailHero(props) {
  const game = props.game;
  return h(
    'div',
    { className: 'dgm-detail-hero' },
    h(GameCover, { game: game, variant: 'detail' }),
    h('span', { className: 'dgm-detail-hero-fade', 'aria-hidden': 'true' })
  );
}

/** Detail page body. */
export function GameDetail(props) {
  const state = props.state;
  const t = props.t;
  const locale = props.locale;
  const now = props.now;
  const detail = state.detail;
  const view = detail.view;
  const game = view ? view.game : null;
  const job = game && state.installJobs ? state.installJobs[game.id] || null : null;
  const paused = Boolean(game && state.pausedGame && state.pausedGame.gameId === game.id);
  const offline = state.market.offline === true;
  const action = resolveDetailAction({
    game: game,
    detailStatus: detail.status,
    detailError: detail.error,
    job: job,
    paused: paused,
    offline: offline,
    canContinue: view ? view.canContinue === true : false,
  });
  const [expanded, setExpanded] = React.useState(false);

  React.useEffect(
    function resetExpanded() {
      setExpanded(false);
    },
    [detail.gameId]
  );

  if (detail.status === 'loading') {
    return h(
      'div',
      { className: 'dgm-detail' },
      h('span', { className: 'dgm-sr-only', role: 'status' }, t('detail.loading')),
      h(SkeletonDetail)
    );
  }

  if (detail.status === 'error' || !game) {
    const code = detail.error ? detail.error.code : 'GM-4042';
    const notFound = code === 'GM-4042' || code === 'GM-4044';
    const offlineError = code === 'GM-5031' || code === 'GM-5032';
    return h(
      'div',
      { className: 'dgm-detail dgm-detail-error' },
      h(ErrorBlock, {
        t: t,
        title: notFound ? t('detail.error.missing') : offlineError ? t('detail.error.offline') : t('detail.error.load'),
        code: code,
        onRetry: offlineError ? props.onRetry : notFound ? null : props.onRetry,
        retryLabel: offlineError ? t('detail.error.offline.action') : t('detail.error.retry'),
        actionLabel: notFound ? t('detail.error.missing.action') : null,
        onAction: notFound ? props.onBack : null,
      })
    );
  }

  const description = game.description || '';
  const longDescription = description.length > 220;
  const screenshots = screenshotsFor(game, MAX_SCREENSHOTS);
  const categories = Array.isArray(game.categories) ? game.categories : [];
  const tags = Array.isArray(game.tags) ? game.tags : [];
  const updated = game.updatedAt || game.publishedAt;
  const author = authorName(game);
  const subtitleParts = [];
  if (author) subtitleParts.push(t('detail.meta.by', { author: author }));
  if (categories.length > 0) subtitleParts.push(categories.map(function label(category) {
    return categoryLabel(category, locale);
  }).join(' / '));

  function handleSecondary(secondary) {
    if (secondary.kind === 'play-current') {
      if (props.onPlayCurrent) props.onPlayCurrent();
    } else if (secondary.kind === 'check-update') {
      if (props.onCheckUpdate) props.onCheckUpdate();
    } else if (secondary.kind === 'uninstall') {
      if (props.onUninstall) props.onUninstall();
    }
  }

  return h(
    'div',
    { className: 'dgm-detail' },
    h(DetailHero, { game: game }),
    h(
      'div',
      { className: 'dgm-detail-cols' },
      h(
        'div',
        { className: 'dgm-detail-main' },
        h(
          'div',
          { className: 'dgm-detail-title-line' },
          h('h1', { className: 'dgm-detail-title', tabIndex: -1, 'data-page-heading': true }, game.name || game.id),
          game.updateAvailable && game.updateVersion
            ? h('span', { className: 'dgm-pill dgm-pill-update' }, t('detail.update.available', { version: game.updateVersion }))
            : null,
          game.installed
            ? h(
                'span',
                { className: 'dgm-pill dgm-pill-installed' },
                h(CheckIcon, { size: 11 }),
                t('market.card.installed')
              )
            : null
        ),
        subtitleParts.length > 0 ? h('p', { className: 'dgm-detail-subtitle' }, subtitleParts.join(' · ')) : null,
        h(
          'div',
          { className: `dgm-detail-description${longDescription && !expanded ? ' is-collapsed' : ''}` },
          h('p', null, description)
        ),
        longDescription
          ? h(
              'button',
              {
                type: 'button',
                className: 'dgm-link-btn',
                onClick: function toggle() {
                  setExpanded(!expanded);
                },
                'aria-expanded': expanded ? 'true' : 'false',
              },
              t(expanded ? 'detail.collapse' : 'detail.expand')
            )
          : null,
        screenshots.length > 0
          ? h(
              'section',
              { className: 'dgm-detail-previews' },
              h(SectionHeader, { title: t('detail.preview') }),
              h(
                'div',
                { className: 'dgm-preview-grid' },
                screenshots.map(function preview(url, index) {
                  return h(PreviewThumb, {
                    key: 'preview-' + index,
                    url: url,
                    index: index,
                    gameName: game.name || game.id,
                    t: t,
                    onOpen: function open() {
                      if (props.onOpenLightbox) props.onOpenLightbox(index);
                    },
                  });
                })
              )
            )
          : null,
        h(
          'div',
          { className: 'dgm-detail-taxonomy' },
          categories.length > 0
            ? h(
                'div',
                { className: 'dgm-taxonomy-row' },
                h('span', { className: 'dgm-taxonomy-label' }, t('detail.meta.categories')),
                categories.map(function category(categoryId) {
                  return h('span', { className: 'dgm-tag', key: categoryId }, categoryLabel(categoryId, locale));
                })
              )
            : null,
          tags.length > 0
            ? h(
                'div',
                { className: 'dgm-taxonomy-row' },
                h('span', { className: 'dgm-taxonomy-label' }, t('detail.meta.tags')),
                tags.map(function tag(value) {
                  return h('span', { className: 'dgm-tag', key: value }, value);
                })
              )
            : null
        )
      ),
      h(
        'aside',
        { className: 'dgm-detail-rail', 'aria-label': t('market.title') },
        h(PrimaryAction, {
          action: action,
          job: job,
          t: t,
          onInstall: props.onInstall,
          onCancelInstall: props.onCancelInstall,
          onUpdate: props.onUpdate,
          onPlay: props.onPlay,
        }),
        action.secondary ? h(SecondaryAction, { secondary: action.secondary, t: t, onClick: handleSecondary }) : null,
        h(
          'dl',
          { className: 'dgm-detail-meta' },
          game.version ? h('dt', null, t('detail.meta.versionLabel')) : null,
          game.version ? h('dd', null, game.version) : null,
          typeof game.sizeBytes === 'number' ? h('dt', null, t('detail.meta.sizeLabel')) : null,
          typeof game.sizeBytes === 'number' ? h('dd', null, formatBytes(game.sizeBytes, locale)) : null,
          updated ? h('dt', null, t('detail.meta.updatedLabel')) : null,
          updated
            ? h('dd', { title: formatAbsoluteTime(updated, locale) }, formatRelativeTime(updated, now, locale))
            : null
        ),
        h(PermissionBlock, { t: t, game: game }),
        h(LeaderboardBlock, {
          t: t,
          locale: locale,
          now: now,
          scores: detail.scores,
          bestScore: view.bestScore,
        }),
        game.installed && game.source !== 'builtin'
          ? h(
              'div',
              { className: 'dgm-rail-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dgm-btn dgm-btn-quiet dgm-danger-text',
                  onClick: props.onUninstall,
                },
                t('detail.action.uninstall')
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dgm-btn dgm-btn-quiet dgm-danger-text',
                  onClick: props.onDeleteData,
                },
                t('mygames.menu.deleteData')
              )
            )
          : null
      )
    ),
    h(
      'p',
      { className: 'dgm-sr-only', 'aria-live': 'polite' },
      job ? t(installStageTextKey(job.stage, job.percent), { percent: job.percent === null ? '' : job.percent }) : ''
    )
  );
}
