/** Market game card (PRD 9.3.4): cover-led, at most two text lines. */
import React from 'react';
import { authorName, categoryLabel, hasUpdate, isBuiltin, isInstalled, primaryCategory } from '../catalog.js';
import { isActivationKey } from '../keyboard.js';
import { CheckIcon, PlayIcon } from '../icons.js';
import { GameCover } from './cover.js';

const h = React.createElement;

export function cardAriaLabel(game, t, locale) {
  const category = primaryCategory(game);
  return t('market.card.a11y', {
    name: game.name || game.id,
    author: authorName(game) || t('market.card.noAuthor'),
    category: category ? categoryLabel(category, locale) : t('market.category.unknown'),
    installed: isInstalled(game) ? t('market.card.a11y.installed') : '',
    update: hasUpdate(game) ? t('market.card.a11y.update') : '',
  });
}

export function GameCard(props) {
  const game = props.game;
  const t = props.t;
  const locale = props.locale;
  const installed = isInstalled(game);
  const update = hasUpdate(game);
  const author = authorName(game) || t('market.card.noAuthor');
  const category = primaryCategory(game);
  const meta = category ? t('market.card.authorMeta', { author: author, category: categoryLabel(category, locale) }) : author;

  function open() {
    if (props.onOpen) props.onOpen(game.id);
  }

  return h(
    'div',
    {
      className: 'dgm-card',
      role: 'link',
      tabIndex: 0,
      'data-card-id': game.id,
      'data-card-index': props.index,
      'aria-label': cardAriaLabel(game, t, locale),
      onClick: open,
      onKeyDown: function keyDown(event) {
        if (isActivationKey(event)) {
          event.preventDefault();
          open();
        }
      },
    },
    h(
      'div',
      { className: 'dgm-card-cover' },
      h(GameCover, { game: game, variant: 'card' }),
      installed
        ? h(
            'span',
            { className: 'dgm-card-installed', title: t('market.card.installed') },
            h(CheckIcon, { size: 11 }),
            h('span', { className: 'dgm-sr-only' }, t('market.card.installed'))
          )
        : null,
      update
        ? h(
            'span',
            { className: 'dgm-card-update' },
            h('span', { className: 'dgm-card-update-dot', 'aria-hidden': 'true' }),
            h('span', { className: 'dgm-card-update-pill' }, t('market.card.update'))
          )
        : null,
      installed
        ? h(
            'button',
            {
              type: 'button',
              className: 'dgm-card-play',
              'aria-label': game.canContinue ? t('market.card.continue') : t('market.card.play'),
              title: game.canContinue ? t('market.card.continue') : t('market.card.play'),
              onClick: function play(event) {
                event.stopPropagation();
                if (props.onPlay) props.onPlay(game);
              },
              onKeyDown: function stopActivation(event) {
                if (isActivationKey(event)) event.stopPropagation();
              },
            },
            h(PlayIcon, { size: 13 })
          )
        : null
    ),
    h(
      'div',
      { className: 'dgm-card-text' },
      h(
        'h3',
        { className: 'dgm-card-title' },
        game.name || game.id,
        isBuiltin(game) ? h('span', { className: 'dgm-card-builtin' }, t('market.source.builtin')) : null
      ),
      h('p', { className: 'dgm-card-meta' }, meta)
    )
  );
}
