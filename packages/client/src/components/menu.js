/** Small anchored popover menu for the detail header (PRD 9.4.4 / 9.10). */
import React from 'react';

const h = React.createElement;

export function PopoverMenu(props) {
  const t = props.t;
  const items = Array.isArray(props.items) ? props.items : [];
  const menuRef = React.useRef(null);
  const buttons = React.useRef([]);
  const closeRef = React.useRef(props.onClose);
  closeRef.current = props.onClose;

  React.useEffect(
    function mount() {
      const first = buttons.current.find(function usable(button) {
        return button && !button.disabled;
      });
      if (first) first.focus();
      function onPointerDown(event) {
        if (menuRef.current && !menuRef.current.contains(event.target) && !menuRef.current.parentNode.contains(event.target)) {
          if (closeRef.current) closeRef.current(false);
        }
      }
      document.addEventListener('mousedown', onPointerDown, true);
      return function cleanup() {
        document.removeEventListener('mousedown', onPointerDown, true);
      };
    },
    []
  );

  function move(index, delta) {
    const enabled = [];
    for (let i = 0; i < items.length; i += 1) if (!items[i].disabled) enabled.push(i);
    if (enabled.length === 0) return;
    const position = enabled.indexOf(index);
    const next = enabled[(position + delta + enabled.length) % enabled.length];
    const target = buttons.current[next];
    if (target) target.focus();
  }

  function handleKeyDown(event, index) {
    if (!event) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (closeRef.current) closeRef.current(true);
      return;
    }
    if (event.key === 'Tab') {
      if (closeRef.current) closeRef.current(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(index, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(index, -1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move(index, -index);
    } else if (event.key === 'End') {
      event.preventDefault();
      move(index, items.length - 1 - index);
    }
  }

  return h(
    'div',
    { className: 'dgm-menu dgm-menu-header', role: 'menu', ref: menuRef, 'aria-label': t('detail.more') },
    items.map(function render(item, index) {
      return h(
        'button',
        {
          key: item.id,
          type: 'button',
          role: 'menuitem',
          ref: function keep(node) {
            buttons.current[index] = node;
          },
          className: 'dgm-menu-item',
          'data-danger': item.danger ? 'true' : 'false',
          disabled: item.disabled === true,
          title: item.note || undefined,
          onClick: function select() {
            if (item.disabled) return;
            if (closeRef.current) closeRef.current(false);
            if (item.onSelect) item.onSelect();
          },
          onKeyDown: function keydown(event) {
            handleKeyDown(event, index);
          },
        },
        h('span', { className: 'dgm-menu-label' }, item.label),
        item.note ? h('span', { className: 'dgm-menu-note' }, item.note) : null
      );
    })
  );
}
