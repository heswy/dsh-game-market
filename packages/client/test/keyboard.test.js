import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countColumns,
  isActivationKey,
  isImeComposing,
  isMenuOpenKey,
  isSearchShortcut,
  isTypingTarget,
  nextChipIndex,
  nextGridIndex,
  nextMenuIndex,
  resolveEscapeAction,
  trapTabIndex,
} from '../src/keyboard.js';

function keyEvent(overrides) {
  return Object.assign({ key: 'Enter', target: { tagName: 'DIV' } }, overrides || {});
}

test('grid navigation handles four directions, rows and Home/End', function () {
  assert.equal(nextGridIndex(5, 'ArrowRight', 4, 10), 6);
  assert.equal(nextGridIndex(5, 'ArrowLeft', 4, 10), 4);
  assert.equal(nextGridIndex(5, 'ArrowDown', 4, 10), 9);
  assert.equal(nextGridIndex(5, 'ArrowUp', 4, 10), 1);
  assert.equal(nextGridIndex(5, 'Home', 4, 10), 4);
  assert.equal(nextGridIndex(5, 'End', 4, 10), 7);
  assert.equal(nextGridIndex(0, 'ArrowLeft', 4, 10), 0);
  assert.equal(nextGridIndex(9, 'ArrowRight', 4, 10), 9);
  assert.equal(nextGridIndex(3, 'Home', 2, 4), 2);
  assert.equal(nextGridIndex(3, 'End', 2, 4), 3);
  assert.equal(nextGridIndex(0, 'ArrowDown', 4, 2), 1);
  assert.equal(nextGridIndex(-1, 'ArrowRight', 4, 3), 1);
  assert.equal(nextGridIndex(0, 'x', 4, 0), -1);
});

test('chip and menu focus move with wraparound', function () {
  assert.equal(nextChipIndex(0, 'ArrowLeft', 9), 8);
  assert.equal(nextChipIndex(8, 'ArrowRight', 9), 0);
  assert.equal(nextChipIndex(4, 'Home', 9), 0);
  assert.equal(nextChipIndex(4, 'End', 9), 8);
  assert.equal(nextMenuIndex(0, 'ArrowUp', 3), 2);
  assert.equal(nextMenuIndex(2, 'ArrowDown', 3), 0);
  assert.equal(nextMenuIndex(1, 'End', 3), 2);
  assert.equal(nextMenuIndex(0, 'Enter', 3), 0);
});

test('dialog tab trap loops in both directions', function () {
  assert.equal(trapTabIndex(0, false, 3), 1);
  assert.equal(trapTabIndex(2, false, 3), 0);
  assert.equal(trapTabIndex(0, true, 3), 2);
  assert.equal(trapTabIndex(1, true, 3), 0);
  assert.equal(trapTabIndex(-1, false, 3), 1);
  assert.equal(trapTabIndex(0, false, 0), -1);
});

test('Esc priority closes the innermost surface first', function () {
  assert.equal(
    resolveEscapeAction({
      lightbox: true,
      dialog: true,
      menu: true,
      searchOpen: true,
      searchFocused: true,
      searchHasValue: true,
      detail: true,
    }),
    'close-lightbox'
  );
  assert.equal(resolveEscapeAction({ dialog: true, menu: true, detail: true }), 'close-dialog');
  assert.equal(resolveEscapeAction({ menu: true, searchOpen: true, detail: true }), 'close-menu');
  assert.equal(resolveEscapeAction({ searchOpen: true, detail: true }), 'close-search');
  assert.equal(resolveEscapeAction({ searchFocused: true, searchHasValue: true, detail: true }), 'clear-search');
  assert.equal(resolveEscapeAction({ searchFocused: true, detail: true }), 'blur-search');
  assert.equal(resolveEscapeAction({ detail: true }), 'back-detail');
  assert.equal(resolveEscapeAction({}), 'none');
  assert.equal(resolveEscapeAction(null), 'none');
});

test('search shortcut ignores inputs and modifiers, IME and activation keys work', function () {
  assert.equal(isSearchShortcut(keyEvent({ key: '/' })), true);
  assert.equal(isSearchShortcut(keyEvent({ key: '/', metaKey: true })), false);
  assert.equal(isSearchShortcut(keyEvent({ key: '/', ctrlKey: true })), false);
  assert.equal(isSearchShortcut(keyEvent({ key: '/', target: { tagName: 'INPUT' } })), false);
  assert.equal(isSearchShortcut(keyEvent({ key: '/', target: { isContentEditable: true } })), false);
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isTypingTarget(null), false);
  assert.equal(isImeComposing({ isComposing: true }), true);
  assert.equal(isImeComposing({ keyCode: 229 }), true);
  assert.equal(isImeComposing({ keyCode: 13 }), false);
  assert.equal(isActivationKey({ key: 'Enter' }), true);
  assert.equal(isActivationKey({ key: ' ' }), true);
  assert.equal(isActivationKey({ key: 'Escape' }), false);
});

test('row menus open with Shift+F10 or ArrowRight', function () {
  assert.equal(isMenuOpenKey({ key: 'F10', shiftKey: true }), true);
  assert.equal(isMenuOpenKey({ key: 'F10', shiftKey: false }), false);
  assert.equal(isMenuOpenKey({ key: 'ArrowRight' }), true);
  assert.equal(isMenuOpenKey({ key: 'ArrowRight', ctrlKey: true }), false);
  assert.equal(isMenuOpenKey({ key: 'Enter' }), false);
});

test('measured first-row offsets yield the column count', function () {
  assert.equal(countColumns([0, 0, 0, 0, 200, 200]), 4);
  assert.equal(countColumns([0, 0, 200, 200]), 2);
  assert.equal(countColumns([0]), 1);
  assert.equal(countColumns([]), 1);
  assert.equal(countColumns(null), 1);
});
