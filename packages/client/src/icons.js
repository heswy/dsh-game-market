/** Inline SVG icons. Every glyph follows `currentColor` and carries no text. */
import React from 'react';

const h = React.createElement;

function svgProps(size, viewBox, extra) {
  const base = {
    width: size,
    height: size,
    viewBox: viewBox || '0 0 16 16',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': 'true',
    focusable: 'false',
    stroke: 'currentColor',
    strokeWidth: 1.3,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
  return extra ? { ...base, ...extra } : base;
}

export function GamepadIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h(
    'svg',
    svgProps(size, '0 0 16 16'),
    h('rect', { x: 1.5, y: 4.5, width: 13, height: 7.5, rx: 3 }),
    h('path', { d: 'M4.5 6.9v2.6M3.2 8.2h2.6' }),
    h('circle', { cx: 11, cy: 7.6, r: 0.7, fill: 'currentColor', stroke: 'none' }),
    h('circle', { cx: 12.6, cy: 9.2, r: 0.7, fill: 'currentColor', stroke: 'none' })
  );
}

export function BackIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h('svg', svgProps(size, '0 0 16 16'), h('path', { d: 'M9.8 3.5 5.3 8l4.5 4.5' }));
}

export function PlayIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h('svg', svgProps(size, '0 0 16 16'), h('path', { d: 'M5.2 3.4 12 8l-6.8 4.6V3.4Z', fill: 'currentColor', stroke: 'none' }));
}

export function PauseIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h(
    'svg',
    svgProps(size, '0 0 16 16'),
    h('rect', { x: 4.4, y: 3.5, width: 2.4, height: 9, rx: 0.8, fill: 'currentColor', stroke: 'none' }),
    h('rect', { x: 9.2, y: 3.5, width: 2.4, height: 9, rx: 0.8, fill: 'currentColor', stroke: 'none' })
  );
}

export function SaveIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h(
    'svg',
    svgProps(size, '0 0 16 16'),
    h('path', { d: 'M4 2.8h6.2L13 5.6v7.6H4V2.8Z' }),
    h('path', { d: 'M6 2.8v3.1h4V2.8M6 13.2V9.4h4v3.8' })
  );
}

export function GameMarketIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 18;
  return h(
    'svg',
    svgProps(size, '0 0 24 24'),
    h('rect', { x: 2.5, y: 7, width: 19, height: 11, rx: 4 }),
    h('path', { d: 'M7 10.5v3M5.5 12h3' }),
    h('circle', { cx: 16, cy: 11, r: 1, fill: 'currentColor', stroke: 'none' }),
    h('circle', { cx: 18.2, cy: 13.6, r: 1, fill: 'currentColor', stroke: 'none' })
  );
}

/**
 * V0 placeholder whale (D-007). Kept at `viewBox="0 0 48 48"` with the four
 * groups the final artwork must preserve: body, spout, eye, halo.
 */
export function WhaleIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 48;
  const state = props && typeof props.state === 'string' ? props.state : 'idle';
  return h(
    'svg',
    {
      className: 'dgm-whale',
      'data-state': state,
      width: size,
      height: size,
      viewBox: '0 0 48 48',
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    h(
      'g',
      { id: 'whale-halo', className: 'dgm-whale-halo' },
      h('circle', { cx: 24, cy: 27, r: 21, stroke: 'currentColor', strokeWidth: 1.5, opacity: 0.5 })
    ),
    h(
      'g',
      { id: 'whale-spout', className: 'dgm-whale-spout' },
      h('path', { d: 'M22.5 14.5c.2-2.5 1-4.4 2.5-5.8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      h('path', { d: 'M22.5 14.5c-.2-2.2-.9-3.9-2.1-5.1', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' })
    ),
    h(
      'g',
      { id: 'whale-body', className: 'dgm-whale-body' },
      h('path', {
        d: 'M9.6 27.4c0-6.2 5.2-11.1 11.7-11.1h5.1c4.7 0 8.9 2.7 10.9 6.9l2.6 5.5c.6 1.3-.3 2.8-1.7 2.8h-2.9c-.8 0-1.5-.5-1.8-1.3l-.6-1.5H20.4c-2.9 2.4-7.3 3.4-10.8 2.2v-3.5Z',
        fill: 'currentColor',
        opacity: 0.92,
      }),
      h('path', {
        d: 'M12 18.2c-2.7.6-4.9 1.9-6.4 3.9-.5.7-.2 1.6.6 1.9.5.2 1.1.1 1.5-.3l2.1-2.1 1.5 1.8c.4.5 1.1.6 1.6.3.6-.3.9-1 .7-1.6l-1.6-3.9Z',
        fill: 'currentColor',
        opacity: 0.55,
      }),
      h('path', {
        d: 'M15.5 32.2c4 3.4 13.7 3.6 19.3-.4-1.6 4.3-5.4 6.4-10.5 6.4-4.1 0-7.3-2.2-8.8-6Z',
        fill: 'currentColor',
        opacity: 0.28,
      })
    ),
    h(
      'g',
      { id: 'whale-eye', className: 'dgm-whale-eye' },
      h('circle', { cx: 32.6, cy: 24.4, r: 2.2, fill: 'var(--dsw-alias-bg-base, #ffffff)' }),
      h('circle', { cx: 33.1, cy: 24.6, r: 1.1, fill: 'var(--dsw-alias-label-primary, #1f2328)' })
    )
  );
}
