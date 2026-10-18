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

export function SearchIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h(
    'svg',
    svgProps(size, '0 0 16 16'),
    h('circle', { cx: 7.2, cy: 7.2, r: 4.4 }),
    h('path', { d: 'm10.6 10.6 3.1 3.1' })
  );
}

export function CloseIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h('svg', svgProps(size, '0 0 16 16'), h('path', { d: 'm4 4 8 8M12 4l-8 8' }));
}

export function CheckIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h('svg', svgProps(size, '0 0 16 16'), h('path', { d: 'm3.4 8.4 2.9 2.9 6.3-6.6' }));
}

export function MoreIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h(
    'svg',
    svgProps(size, '0 0 16 16'),
    h('circle', { cx: 3.4, cy: 8, r: 1.15, fill: 'currentColor', stroke: 'none' }),
    h('circle', { cx: 8, cy: 8, r: 1.15, fill: 'currentColor', stroke: 'none' }),
    h('circle', { cx: 12.6, cy: 8, r: 1.15, fill: 'currentColor', stroke: 'none' })
  );
}

export function TrashIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h(
    'svg',
    svgProps(size, '0 0 16 16'),
    h('path', { d: 'M3.5 4.6h9M6.5 4.6V3.2h3v1.4M5 4.6l.6 8.2h4.8l.6-8.2' }),
    h('path', { d: 'M6.9 7v3.4M9.1 7v3.4' })
  );
}

export function DownloadIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h(
    'svg',
    svgProps(size, '0 0 16 16'),
    h('path', { d: 'M8 2.6v7.2M5.4 7.4 8 10l2.6-2.6' }),
    h('path', { d: 'M3.4 12.4h9.2' })
  );
}

export function RefreshIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h(
    'svg',
    svgProps(size, '0 0 16 16'),
    h('path', { d: 'M13.1 8a5.1 5.1 0 1 1-1.5-3.6' }),
    h('path', { d: 'M13.4 2.9v3.2h-3.2' })
  );
}

export function ChevronRightIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h('svg', svgProps(size, '0 0 16 16'), h('path', { d: 'm6.2 3.5 4.5 4.5-4.5 4.5' }));
}

export function ChevronLeftIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h('svg', svgProps(size, '0 0 16 16'), h('path', { d: 'M9.8 3.5 5.3 8l4.5 4.5' }));
}

export function ClockIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h(
    'svg',
    svgProps(size, '0 0 16 16'),
    h('circle', { cx: 8, cy: 8, r: 5.4 }),
    h('path', { d: 'M8 5.1V8l2.1 1.4' })
  );
}

export function TrophyIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h(
    'svg',
    svgProps(size, '0 0 16 16'),
    h('path', { d: 'M5.2 3.2h5.6v3.3a2.8 2.8 0 0 1-5.6 0V3.2Z' }),
    h('path', { d: 'M5.2 4.3H3.4v1.1a2 2 0 0 0 2 2M10.8 4.3h1.8v1.1a2 2 0 0 1-2 2' }),
    h('path', { d: 'M8 9.3v2.1M6 12.8h4' })
  );
}

export function FolderOpenIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h(
    'svg',
    svgProps(size, '0 0 16 16'),
    h('path', { d: 'M2.4 11.9V4.4h4l1.2 1.6h5.8v1.1' }),
    h('path', { d: 'M2.8 11.9h9.7l1.3-4.4H4.1l-1.3 4.4Z' })
  );
}

export function ShieldIcon(props) {
  const size = props && typeof props.size === 'number' ? props.size : 14;
  return h(
    'svg',
    svgProps(size, '0 0 16 16'),
    h('path', { d: 'M8 2.4 13 4v3.7c0 2.7-1.9 4.9-5 5.9-3.1-1-5-3.2-5-5.9V4l5-1.6Z' }),
    h('path', { d: 'm5.9 8 1.5 1.5 2.8-2.9' })
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
