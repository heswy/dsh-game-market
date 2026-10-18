/** Resizable header search with a 150ms local debounce (PRD 9.3.5). */
import React from 'react';
import { SEARCH_DEBOUNCE_MS } from '../constants.js';
import { createQueryDebouncer } from '../debounce.js';
import { CloseIcon, SearchIcon } from '../icons.js';

const h = React.createElement;

export function SearchBox(props) {
  const t = props.t;
  const inputRef = props.inputRef;
  const [open, setOpen] = React.useState(false);
  const draft = props.draft || '';
  const onApplyRef = React.useRef(props.onApply);
  const setOpenRef = React.useRef(props.onOpenChange);
  onApplyRef.current = props.onApply;
  setOpenRef.current = props.onOpenChange;

  const debouncerRef = React.useRef(null);
  if (debouncerRef.current === null) {
    debouncerRef.current = createQueryDebouncer({
      delayMs: SEARCH_DEBOUNCE_MS,
      apply: function apply(value) {
        if (onApplyRef.current) onApplyRef.current(value);
      },
    });
  }

  React.useEffect(
    function cleanupDebouncer() {
      return function cancel() {
        if (debouncerRef.current) debouncerRef.current.cancel();
      };
    },
    []
  );

  function handleChange(event) {
    const value = event && event.target ? event.target.value : '';
    if (props.onDraft) props.onDraft(value);
    debouncerRef.current.push(value);
  }

  function handleKeyDown(event) {
    if (!event) return;
    if (event.key === 'Enter') {
      debouncerRef.current.flush();
      return;
    }
    if (event.key === 'Escape') {
      debouncerRef.current.cancel();
    }
  }

  function handleFocus() {
    if (!open) {
      setOpen(true);
      if (setOpenRef.current) setOpenRef.current(true);
    }
  }

  function handleBlur() {
    if (draft.length === 0) {
      setOpen(false);
      if (setOpenRef.current) setOpenRef.current(false);
    }
  }

  function clear() {
    debouncerRef.current.cancel();
    if (props.onDraft) props.onDraft('');
    debouncerRef.current.push('');
    if (inputRef && inputRef.current) inputRef.current.focus();
  }

  return h(
    'div',
    { className: 'dgm-search', 'data-open': open || draft.length > 0 ? 'true' : 'false' },
    h('span', { className: 'dgm-search-icon', 'aria-hidden': 'true' }, h(SearchIcon, { size: 15 })),
    h('input', {
      ref: inputRef,
      className: 'dgm-search-input',
      type: 'text',
      role: 'searchbox',
      value: draft,
      placeholder: t('market.search.placeholder'),
      'aria-label': t('market.search.a11y'),
      autoComplete: 'off',
      spellCheck: false,
      onChange: handleChange,
      onKeyDown: handleKeyDown,
      onFocus: handleFocus,
      onBlur: handleBlur,
    }),
    draft.length > 0
      ? h(
          'button',
          {
            type: 'button',
            className: 'dgm-search-clear',
            onClick: clear,
            'aria-label': t('market.search.clear'),
            title: t('market.search.clear'),
          },
          h(CloseIcon, { size: 12 })
        )
      : null
  );
}

/** Narrow-window icon that opens the overlay search field. */
export function SearchToggle(props) {
  const t = props.t;
  return h(
    'button',
    {
      type: 'button',
      className: 'dgm-icon-btn dgm-search-toggle',
      onClick: props.onClick,
      'aria-label': t('market.search.open'),
      title: t('market.search.open'),
      'aria-expanded': props.expanded === true ? 'true' : 'false',
    },
    h(SearchIcon, { size: 16 })
  );
}
