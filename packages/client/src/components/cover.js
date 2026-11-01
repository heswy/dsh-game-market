/**
 * Game artwork with a deterministic, asset-free fallback.
 *
 * Registry covers reach the Client through the same-origin `/preview` route; a
 * failed or missing image degrades to a procedural "poster" built from the game
 * id, so the Market always has a visual anchor without external assets.
 */
import React from 'react';
import { coverTone, initialFor } from '../catalog.js';
import { GameArtwork, hasGameArtwork } from './game-artwork.js';

const h = React.createElement;

function toneStyle(game) {
  const tone = coverTone(game);
  return {
    '--dgm-tone-h': String(tone.hue),
    '--dgm-tone-h2': String(tone.hue2),
    '--dgm-tone-s': String(tone.saturation) + '%',
  };
}

/**
 * Poster composition for games without illustrated artwork. Category picks the
 * family (motion / grid / rhythm) so the fallback still reads as that game.
 */
function compositionFor(game) {
  const category = game && Array.isArray(game.categories) && game.categories.length > 0 ? game.categories[0] : '';
  if (category === 'action' || category === 'arcade') return 0;
  if (category === 'puzzle' || category === 'strategy' || category === 'card' || category === 'trivia') return 2;
  if (category === 'idle' || category === 'sandbox') return 1;
  const seed = String((game && (game.id || game.name)) || 'game');
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33 + seed.charCodeAt(index)) % 1000;
  }
  return hash % 3;
}

/**
 * @param {{game: object, variant?: 'card'|'hero'|'row'|'banner', className?: string}} props
 */
export function GameCover(props) {
  const game = props.game || {};
  const variant = props.variant || 'card';
  const illustrated = hasGameArtwork(game.id);
  const source = game.cover || (illustrated ? null : game.icon) || null;
  const [failed, setFailed] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(
    function resetOnSourceChange() {
      setFailed(false);
      setLoaded(false);
    },
    [source]
  );

  const showImage = typeof source === 'string' && source.length > 0 && !failed;
  const composition = compositionFor(game);
  const className = ['dgm-cover', 'dgm-cover-' + variant, props.className || ''].filter(Boolean).join(' ');
  return h(
    'span',
    {
      className: className,
      style: toneStyle(game),
      'data-loaded': showImage && loaded ? 'true' : 'false',
      'data-composition': illustrated ? null : String(composition),
      'aria-hidden': 'true',
    },
    h(
      'span',
      { className: 'dgm-cover-art' },
      illustrated ? h(GameArtwork, { id: game.id }) : null
    ),
    showImage
      ? h('img', {
          className: 'dgm-cover-img',
          src: source,
          alt: '',
          draggable: false,
          decoding: 'async',
          loading: variant === 'card' ? 'lazy' : 'eager',
          onLoad: function onLoad() {
            setLoaded(true);
          },
          onError: function onError() {
            setFailed(true);
            setLoaded(false);
          },
        })
      : null,
    illustrated ? null : h('span', { className: 'dgm-cover-shapes' }),
    illustrated ? null : h('span', { className: 'dgm-cover-grain' }),
    illustrated
      ? null
      : h(
          'span',
          { className: 'dgm-cover-mark' },
          h('span', { className: 'dgm-cover-mark-letter' }, initialFor(game.name || game.id)),
          variant === 'row'
            ? h('span', { className: 'dgm-cover-mark-line' })
            : h('span', { className: 'dgm-cover-mark-name' }, game.name || game.id)
        )
  );
}

/** Small square icon used in lists; degrades to the same procedural art. */
export function GameIcon(props) {
  const game = props.game || {};
  const size = typeof props.size === 'number' ? props.size : 32;
  const source = game.icon || game.cover || null;
  const [failed, setFailed] = React.useState(false);
  React.useEffect(
    function resetOnSourceChange() {
      setFailed(false);
    },
    [source]
  );
  const showImage = typeof source === 'string' && source.length > 0 && !failed;
  return h(
    'span',
    { className: 'dgm-game-icon', style: Object.assign(toneStyle(game), { width: size, height: size }), 'aria-hidden': 'true' },
    showImage
      ? h('img', {
          src: source,
          alt: '',
          draggable: false,
          onError: function onError() {
            setFailed(true);
          },
        })
      : h('span', { className: 'dgm-game-icon-initial' }, initialFor(game.name || game.id))
  );
}
