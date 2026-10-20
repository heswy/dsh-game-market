/**
 * "Version & updates" section of the Market panel (V1.5 M3).
 *
 * Quiet editorial surface: current Host + Client identity, discovery state,
 * manual refresh, and — only when the Host state machine says so — the update
 * operation card. Progress is a four-step stage list; no percentages exist in
 * this component, and only `updated` may render as success (the derived view
 * marks it, `applied`/`installing`/`activating` never do).
 */
import React from 'react';
import { formatAbsoluteTime, formatRelativeTime } from '../format.js';
import { updateActionErrorKey } from '../errors-text.js';
import { channelLabel, describeDiscovery, shortCommit } from '../update-copy.js';

const h = React.createElement;

function identityCommit(commit, t) {
  if (typeof commit !== 'string' || commit.length === 0) return t('update.identity.commitMissing');
  return shortCommit(commit) || commit;
}

function IdentityRow(props) {
  const commit = props.commit;
  return h(
    'div',
    { className: 'dgm-update-identity', 'data-commit': typeof commit === 'string' ? commit : '' },
    h('span', { className: 'dgm-update-identity-label' }, props.label),
    h('span', { className: 'dgm-update-identity-version' }, props.version || props.t('update.identity.unknown')),
    h(
      'span',
      {
        className: 'dgm-update-identity-commit',
        title: typeof commit === 'string' && commit.length > 0 ? commit : props.t('update.identity.commitMissing'),
      },
      identityCommit(commit, props.t)
    ),
    props.hint ? h('span', { className: 'dgm-update-identity-hint' }, props.hint) : null
  );
}

const BLOCKED_KEYS = Object.freeze({
  'dev-source': { title: 'update.blocked.devSource', body: 'update.blocked.devSource.body' },
  'dev-row': { title: 'update.blocked.devRow', body: 'update.blocked.devRow.body' },
  'hmr-unknown': { title: 'update.blocked.hmrUnknown', body: 'update.blocked.hmrUnknown.body' },
  unsupported: { title: 'update.blocked.unsupported', body: 'update.blocked.unsupported.body' },
  'adapter-unavailable': { title: 'update.blocked.adapter', body: 'update.blocked.adapter.body' },
  'no-target': { title: 'update.blocked.noTarget', body: 'update.blocked.noTarget.body' },
  'already-at-target': { title: 'update.blocked.already', body: 'update.blocked.already.body' },
  'commit-anomaly': { title: 'update.blocked.commitAnomaly', body: 'update.blocked.commitAnomaly.body' },
  unknown: { title: 'update.blocked.unknown', body: 'update.blocked.unknown.body' },
});

function ProgressRow(props) {
  const t = props.t;
  const current = props.index;
  const labels = ['inspecting', 'installing', 'applied', 'activating'];
  const keys = [
    'update.progress.inspecting',
    'update.progress.installing',
    'update.progress.applied',
    'update.progress.activating',
  ];
  return h(
    'ol',
    { className: 'dgm-update-stages', 'aria-label': t('update.progress.label'), 'data-stages': labels.join(',') },
    labels.map(function stage(index) {
      const status = current === null ? 'pending' : index < current ? 'done' : index === current ? 'current' : 'pending';
      return h(
        'li',
        { key: stage, className: 'dgm-update-stage', 'data-status': status, 'aria-current': status === 'current' ? 'step' : undefined },
        h('span', { className: 'dgm-update-stage-dot', 'aria-hidden': 'true' }),
        h('span', null, t(keys[index]))
      );
    })
  );
}

function OperationCard(props) {
  const t = props.t;
  const operation = props.operation;
  const errorSummary = operation.errorCode
    ? t('update.state.errorCode', { code: operation.errorCode }) + ' · ' + t(updateActionErrorKey(operation.errorCode))
    : null;
  let action = null;
  if (operation.action === 'cancel') {
    action = h(
      'button',
      {
        type: 'button',
        className: 'dgm-btn dgm-btn-quiet',
        'data-action': 'cancel-update',
        onClick: props.onCancel,
      },
      t('update.action.cancel')
    );
  } else if (operation.action === 'retry') {
    action = h(
      'button',
      {
        type: 'button',
        className: 'dgm-btn dgm-btn-primary',
        'data-action': 'retry-update',
        onClick: props.onOpenUpdate,
      },
      t('update.action.retry')
    );
  } else if (operation.action === 'refresh-page') {
    action = h(
      'button',
      {
        type: 'button',
        className: 'dgm-btn dgm-btn-primary',
        'data-action': 'refresh-page',
        onClick: props.onRefreshPage,
      },
      t('update.action.refreshPage')
    );
  }
  return h(
    'div',
    {
      className: 'dgm-update-operation',
      'data-state': operation.state,
      'data-success': operation.success ? 'true' : 'false',
      'aria-live': 'polite',
    },
    h(
      'div',
      { className: 'dgm-update-operation-head' },
      h('span', { className: 'dgm-update-operation-dot', 'data-state': operation.state, 'aria-hidden': 'true' }),
      h('h3', { className: 'dgm-update-operation-title' }, t(operation.titleKey, operation.detailParams))
    ),
    h('p', { className: 'dgm-update-operation-body' }, t(operation.detailKey, operation.detailParams)),
    operation.showProgress ? h(ProgressRow, { t: t, index: operation.progressIndex }) : null,
    errorSummary ? h('p', { className: 'dgm-update-operation-code' }, errorSummary) : null,
    operation.showRecovery ? h('p', { className: 'dgm-update-recovery' }, t('update.recovery.hint')) : null,
    action ? h('div', { className: 'dgm-update-operation-actions' }, action) : null
  );
}

export function UpdateSection(props) {
  const t = props.t;
  const view = props.view;
  const locale = props.locale;
  const now = props.now;
  if (!view || view.hidden) return null;
  const discovery = describeDiscovery(view, t, locale, now);
  const identity = view.identity;
  const inspection = view.inspection;
  const blocked = view.blocked ? BLOCKED_KEYS[view.blocked.reason] || BLOCKED_KEYS.unknown : null;
  const refreshBusy = view.refresh.busy === true;
  const refreshDisabled =
    refreshBusy ||
    view.refresh.secondsUntil !== null ||
    (inspection !== null && inspection.discovery.canRefresh === false);
  const refreshTitle = view.refresh.secondsUntil !== null
    ? t('update.refresh.throttled', { seconds: String(view.refresh.secondsUntil) })
    : t('update.refresh');
  const channel = inspection && inspection.target ? channelLabel(inspection.target.channel, t) : null;
  const lastChecked = inspection && inspection.discovery.checkedAt
    ? t('update.discovery.checked', { time: formatRelativeTime(inspection.discovery.checkedAt, now, locale) })
    : null;
  const anomaly = inspection && inspection.discovery ? inspection.discovery.anomaly : null;
  const anomalyText = anomaly && anomaly.kind === 'same-version-different-commit'
    ? t('update.anomaly.sameVersion', { expected: anomaly.expectedCommit || '', found: anomaly.foundCommit || '' })
    : null;
  const coordination = view.coordination;
  const coordinationText =
    coordination && coordination.status === 'working'
      ? t('update.coordination.working')
      : coordination && coordination.status === 'reported'
        ? t('update.coordination.reported')
        : coordination && coordination.status === 'failed'
          ? t('update.coordination.failed')
          : null;

  return h(
    'section',
    { className: 'dgm-section dgm-update', 'aria-labelledby': 'dgm-update-title', 'data-update-hidden': 'false' },
    h(
      'div',
      { className: 'dgm-section-head' },
      h(
        'div',
        { className: 'dgm-section-titles' },
        h('h2', { className: 'dgm-section-title', id: 'dgm-update-title' }, t('update.section.title')),
        h('span', { className: 'dgm-section-kicker' }, t('update.section.kicker'))
      )
    ),
    h('p', { className: 'dgm-update-note' }, t('update.section.note')),
    h(
      'div',
      { className: 'dgm-update-identities' },
      h(IdentityRow, {
        t: t,
        label: t('update.identity.host'),
        version: identity.hostVersion,
        commit: identity.hostCommit,
      }),
      h(IdentityRow, {
        t: t,
        label: t('update.identity.client'),
        version: identity.clientEmbedded ? identity.clientVersion : null,
        commit: identity.clientEmbedded ? identity.clientCommit : null,
        hint: identity.clientEmbedded ? null : t('update.identity.notEmbedded'),
      })
    ),
    h(
      'div',
      { className: 'dgm-update-discovery', 'data-tone': discovery.tone, 'data-testid': 'update-discovery' },
      h('span', { className: 'dgm-update-discovery-dot', 'aria-hidden': 'true' }),
      h(
        'div',
        { className: 'dgm-update-discovery-text' },
        h('p', { className: 'dgm-update-discovery-line' }, t(discovery.key, discovery.params)),
        discovery.meta ? h('p', { className: 'dgm-update-discovery-meta' }, discovery.meta) : null,
        anomalyText ? h('p', { className: 'dgm-update-discovery-meta', 'data-anomaly': 'same-version-different-commit' }, anomalyText) : null,
        channel !== null ? h('p', { className: 'dgm-update-discovery-meta' }, t('update.discovery.channel', { channel: channel })) : null
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'dgm-btn dgm-btn-ghost dgm-update-refresh',
          disabled: refreshDisabled,
          title: refreshTitle,
          'aria-label': refreshTitle,
          'data-action': 'refresh-update',
          onClick: function refresh() {
            if (!refreshDisabled && props.onRefresh) props.onRefresh();
          },
        },
        refreshBusy ? t('update.refresh.busy') : t('update.refresh')
      )
    ),
    view.update && view.update.kind === 'available' && view.blocked === null && view.operation === null
      ? h(
          'div',
          { className: 'dgm-update-offer' },
          h(
            'button',
            {
              type: 'button',
              className: 'dgm-btn dgm-btn-primary',
              'data-action': 'open-update',
              onClick: props.onOpenUpdate,
            },
            t('update.action.update', { version: view.update.toVersion || '' })
          )
        )
      : null,
    view.actionError
      ? h(
          'p',
          { className: 'dgm-update-error', role: 'alert' },
          t('update.error.action') + ' · ' + t(updateActionErrorKey(view.actionError.code))
        )
      : null,
    blocked
      ? h(
          'div',
          { className: 'dgm-update-blocked', 'data-reason': view.blocked.reason, role: 'note' },
          h('p', { className: 'dgm-update-blocked-title' }, t(blocked.title)),
          h('p', { className: 'dgm-update-blocked-body' }, t(blocked.body)),
          h('p', { className: 'dgm-update-recovery' }, t('update.recovery.hint'))
        )
      : null,
    coordinationText
      ? h(
          'p',
          { className: 'dgm-update-coordination', 'data-status': coordination.status, 'aria-live': 'polite' },
          coordinationText
        )
      : null,
    view.operation
      ? h(OperationCard, {
          t: t,
          operation: view.operation,
          onCancel: props.onCancel,
          onOpenUpdate: props.onOpenUpdate,
          onRefreshPage: props.onRefreshPage,
        })
      : null,
    lastChecked ? h('p', { className: 'dgm-update-footnote' }, lastChecked) : null
  );
}

/** Quiet "update available" banner shown at the top of the Market page. */
export function UpdateBanner(props) {
  const t = props.t;
  const view = props.view;
  if (!view || view.hidden || view.blocked || !view.update || view.update.kind !== 'available') return null;
  if (view.operation !== null) return null;
  const target = view.update.target;
  if (!target || !target.version) return null;
  return h(
    'div',
    { className: 'dgm-banner dgm-update-banner', role: 'status', 'data-testid': 'update-banner' },
    h('span', { className: 'dgm-banner-icon', 'aria-hidden': 'true' }, h('span', { className: 'dgm-dot dgm-dot-info' })),
    h(
      'span',
      { className: 'dgm-banner-text' },
      t('update.banner.text', { version: target.version }),
      view.update.currentVersion ? ' · ' + t('update.banner.current', { fromVersion: view.update.currentVersion }) : ''
    ),
    h(
      'button',
      {
        type: 'button',
        className: 'dgm-banner-action',
        'data-action': 'open-update',
        onClick: function open() {
          if (props.onOpenUpdate) props.onOpenUpdate();
        },
      },
      t('update.banner.action')
    )
  );
}
