/** Single-select category chips (PRD 9.3.5) with roving focus. */
import React from 'react';
import { CATEGORY_FILTERS } from '../constants.js';
import { categoryLabelKey } from '../catalog.js';
import { nextChipIndex } from '../keyboard.js';

const h = React.createElement;

export function FilterChips(props) {
  const t = props.t;
  const value = props.value;
  const buttons = React.useRef([]);
  const categories = Array.isArray(props.games)
    ? CATEGORY_FILTERS.filter(function available(id) {
        return id === 'all' || id === value || props.games.some(function matches(game) {
          return Array.isArray(game.categories) && game.categories.includes(id);
        });
      })
    : CATEGORY_FILTERS;
  const selectedIndex = Math.max(0, categories.indexOf(value));

  function handleKeyDown(event, index) {
    if (!event) return;
    const key = event.key;
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      event.preventDefault();
      if (props.onChange) props.onChange(categories[index]);
      return;
    }
    const next = nextChipIndex(index, key, categories.length);
    if (next !== index) {
      event.preventDefault();
      const target = buttons.current[next];
      if (target && typeof target.focus === 'function') target.focus();
    }
  }

  return h(
    'div',
    { className: 'dgm-chips', role: 'group', 'aria-label': t('market.filter.a11y') },
    categories.map(function renderChip(category, index) {
      const active = category === value;
      const label = category === 'all' ? t('market.filter.all') : t(categoryLabelKey(category));
      return h(
        'button',
        {
          key: category,
          type: 'button',
          ref: function keep(button) {
            buttons.current[index] = button;
          },
          className: 'dgm-chip',
          'data-active': active ? 'true' : 'false',
          'aria-pressed': active ? 'true' : 'false',
          tabIndex: index === selectedIndex ? 0 : -1,
          onClick: function select() {
            if (props.onChange) props.onChange(category);
          },
          onKeyDown: function keydown(event) {
            handleKeyDown(event, index);
          },
        },
        active ? h('span', { className: 'dgm-chip-mark', 'aria-hidden': 'true' }) : null,
        h('span', { className: 'dgm-chip-label' }, label)
      );
    })
  );
}
