/**
 * Keyboard navigation helpers shared by the Market grid, category chips, menus
 * and dialogs (PRD 9.3.7 / 9.4.4 / 9.5.6 / 9.10).
 *
 * Pure index math so every path is unit-testable without a DOM.
 */

export function isTypingTarget(target) {
  if (!target || typeof target !== 'object') return false;
  if (target.isContentEditable === true) return true;
  const tag = typeof target.tagName === 'string' ? target.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** IME composition must never trigger navigation/close shortcuts (PRD 9.10.3). */
export function isImeComposing(event) {
  if (!event || typeof event !== 'object') return false;
  return event.isComposing === true || event.keyCode === 229;
}

/** `/` focuses search only outside text inputs and without modifiers. */
export function isSearchShortcut(event) {
  if (!event || event.key !== '/') return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return !isTypingTarget(event.target);
}

function clampIndex(index, total) {
  if (total <= 0) return -1;
  if (index < 0) return 0;
  if (index >= total) return total - 1;
  return index;
}

/**
 * Four-way grid movement. `columns` is the measured column count of the grid.
 * Home/End move to the first/last cell of the current row.
 */
export function nextGridIndex(index, key, columns, total) {
  if (total <= 0) return -1;
  const current = clampIndex(index, total);
  const cols = Math.max(1, Math.floor(columns) || 1);
  switch (key) {
    case 'ArrowRight':
      return Math.min(current + 1, total - 1);
    case 'ArrowLeft':
      return Math.max(current - 1, 0);
    case 'ArrowDown':
      return Math.min(current + cols, total - 1);
    case 'ArrowUp':
      return Math.max(current - cols, 0);
    case 'Home': {
      const rowStart = Math.floor(current / cols) * cols;
      return rowStart;
    }
    case 'End': {
      const rowStart = Math.floor(current / cols) * cols;
      return Math.min(rowStart + cols - 1, total - 1);
    }
    default:
      return current;
  }
}

/** Category chip roving focus: left/right, Home/End. */
export function nextChipIndex(index, key, total) {
  if (total <= 0) return -1;
  const current = clampIndex(index, total);
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % total;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + total) % total;
    case 'Home':
      return 0;
    case 'End':
      return total - 1;
    default:
      return current;
  }
}

/** Menu roving focus: Up/Down with wraparound, Home/End. */
export function nextMenuIndex(index, key, total) {
  if (total <= 0) return -1;
  const current = clampIndex(index, total);
  switch (key) {
    case 'ArrowDown':
      return (current + 1) % total;
    case 'ArrowUp':
      return (current - 1 + total) % total;
    case 'Home':
      return 0;
    case 'End':
      return total - 1;
    default:
      return current;
  }
}

/** Tab/Shift+Tab loop used by the modal focus trap. */
export function trapTabIndex(index, shift, total) {
  if (total <= 0) return -1;
  const current = clampIndex(index, total);
  if (shift) return current <= 0 ? total - 1 : current - 1;
  return current >= total - 1 ? 0 : current + 1;
}

/**
 * Esc priority table (PRD 9.10.3): the innermost surface closes first.
 * Returns a stable action id so components can dispatch in one place.
 */
export function resolveEscapeAction(scope) {
  const input = scope && typeof scope === 'object' ? scope : {};
  if (input.lightbox === true) return 'close-lightbox';
  if (input.dialog === true) return 'close-dialog';
  if (input.menu === true) return 'close-menu';
  if (input.searchOpen === true) return 'close-search';
  if (input.searchFocused === true) {
    return input.searchHasValue === true ? 'clear-search' : 'blur-search';
  }
  if (input.detail === true) return 'back-detail';
  return 'none';
}

/** Row menu opener: Shift+F10 or ArrowRight on the more button (PRD 9.4.4). */
export function isMenuOpenKey(event) {
  if (!event) return false;
  if (event.key === 'F10' && event.shiftKey) return true;
  return (event.key === 'ArrowRight' || event.key === 'ArrowDown') && !event.metaKey && !event.ctrlKey && !event.altKey;
}

/** Enter/Space activation helper for role="link"/"button" nodes. */
export function isActivationKey(event) {
  if (!event) return false;
  return event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar';
}

/** Number of cards in the first grid row, measured from DOM offsets. */
export function countColumns(offsets) {
  if (!Array.isArray(offsets) || offsets.length === 0) return 1;
  const first = offsets[0];
  let columns = 0;
  for (const offset of offsets) {
    if (offset === first) columns += 1;
    else break;
  }
  return Math.max(1, columns);
}
