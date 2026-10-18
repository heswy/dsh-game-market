/** Shared loading / empty / error / skeleton blocks for the Market surfaces. */
import React from 'react';
import { CloseIcon, GamepadIcon, RefreshIcon } from '../icons.js';

const h = React.createElement;

function SkeletonLine(props) {
  return h('span', { className: 'dgm-skeleton-line', style: props.width ? { width: props.width } : undefined });
}

export function SkeletonCards(props) {
  const count = typeof props.count === 'number' ? props.count : 8;
  const items = [];
  for (let index = 0; index < count; index += 1) {
    items.push(
      h(
        'div',
        { className: 'dgm-skeleton-card', key: 'skeleton-' + index, 'aria-hidden': 'true' },
        h('span', { className: 'dgm-skeleton-cover' }),
        h(SkeletonLine, { width: '64%' }),
        h(SkeletonLine, { width: '42%' })
      )
    );
  }
  return h('div', { className: 'dgm-grid dgm-grid-skeleton', 'aria-hidden': 'true' }, items);
}

export function SkeletonRows(props) {
  const count = typeof props.count === 'number' ? props.count : 6;
  const items = [];
  for (let index = 0; index < count; index += 1) {
    items.push(
      h(
        'div',
        { className: 'dgm-skeleton-row', key: 'skeleton-row-' + index, 'aria-hidden': 'true' },
        h('span', { className: 'dgm-skeleton-thumb' }),
        h('span', { className: 'dgm-skeleton-col' }, h(SkeletonLine, { width: '36%' }), h(SkeletonLine, { width: '58%' })),
        h('span', { className: 'dgm-skeleton-pill' })
      )
    );
  }
  return h('div', { className: 'dgm-skeleton-list', 'aria-hidden': 'true' }, items);
}

export function SkeletonDetail() {
  return h(
    'div',
    { className: 'dgm-skeleton-detail', 'aria-hidden': 'true' },
    h('span', { className: 'dgm-skeleton-hero' }),
    h(
      'div',
      { className: 'dgm-skeleton-detail-body' },
      h('span', { className: 'dgm-skeleton-col' }, h(SkeletonLine, { width: '46%' }), h(SkeletonLine, { width: '72%' }), h(SkeletonLine, { width: '88%' }), h(SkeletonLine, { width: '80%' })),
      h('span', { className: 'dgm-skeleton-rail' })
    )
  );
}

export function LoadingBlock(props) {
  return h(
    'div',
    { className: 'dgm-state', role: 'status', 'aria-live': 'polite' },
    h('span', { className: 'dgm-spinner', 'aria-hidden': 'true' }),
    h('p', { className: 'dgm-state-body' }, props.label)
  );
}

export function ErrorBlock(props) {
  const t = props.t;
  return h(
    'div',
    { className: 'dgm-state dgm-state-error', role: 'alert' },
    h('span', { className: 'dgm-state-icon', 'aria-hidden': 'true' }, h(GamepadIcon, { size: 26 })),
    h('p', { className: 'dgm-state-title', tabIndex: -1, ref: props.titleRef }, props.title),
    props.body ? h('p', { className: 'dgm-state-body' }, props.body) : null,
    props.code ? h('p', { className: 'dgm-state-code' }, props.code) : null,
    h(
      'div',
      { className: 'dgm-state-actions' },
      props.onRetry
        ? h(
            'button',
            { type: 'button', className: 'dgm-btn dgm-btn-primary', onClick: props.onRetry },
            h(RefreshIcon, { size: 13 }),
            props.retryLabel || t('market.retry')
          )
        : null,
      props.actionLabel && props.onAction
        ? h('button', { type: 'button', className: 'dgm-btn dgm-btn-quiet', onClick: props.onAction }, props.actionLabel)
        : null
    )
  );
}

export function EmptyBlock(props) {
  const t = props.t;
  return h(
    'div',
    { className: 'dgm-state' },
    h('span', { className: 'dgm-state-icon', 'aria-hidden': 'true' }, h(GamepadIcon, { size: 28 })),
    h('p', { className: 'dgm-state-title', tabIndex: -1, ref: props.titleRef }, props.title),
    props.body ? h('p', { className: 'dgm-state-body' }, props.body) : null,
    props.actionLabel && props.onAction
      ? h(
          'div',
          { className: 'dgm-state-actions' },
          h('button', { type: 'button', className: 'dgm-btn dgm-btn-primary', onClick: props.onAction }, props.actionLabel)
        )
      : null,
    props.onClear
      ? h(
          'div',
          { className: 'dgm-state-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'dgm-btn dgm-btn-quiet',
              onClick: props.onClear,
            },
            h(CloseIcon, { size: 12 }),
            t('market.search.clear')
          )
        )
      : null
  );
}

/** Inline banner used for offline / stale-cache notices (scrolls with content). */
export function InlineBanner(props) {
  return h(
    'div',
    { className: 'dgm-inline-banner', role: props.role || 'status' },
    h('span', { className: 'dgm-inline-banner-dot', 'aria-hidden': 'true' }),
    h('span', { className: 'dgm-inline-banner-text' }, props.text),
    props.actionLabel && props.onAction
      ? h('button', { type: 'button', className: 'dgm-inline-banner-action', onClick: props.onAction }, props.actionLabel)
      : null
  );
}

/** Section heading: quiet kicker + title, no enclosing card (PRD 9.3.2). */
export function SectionHeader(props) {
  return h(
    'div',
    { className: 'dgm-section-head' },
    h(
      'div',
      { className: 'dgm-section-titles' },
      props.kicker ? h('p', { className: 'dgm-section-kicker' }, props.kicker) : null,
      h('h2', { className: 'dgm-section-title', id: props.id }, props.title)
    ),
    props.meta ? h('span', { className: 'dgm-section-meta' }, props.meta) : null,
    props.children || null
  );
}
