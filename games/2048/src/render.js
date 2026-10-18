/**
 * 2048 · DOM renderer.
 *
 * The renderer is a projection of the logic state: after every move the tile
 * layer is rebuilt from the authoritative board, so what is on screen can never
 * drift from what gets saved. Movement is conveyed with a short transform
 * transition from the source cell; merges and spawns use a restrained pop.
 * Reduced motion turns all of that into an instant update.
 *
 * It owns the presentation-only details: theme dataset, layout measurement,
 * score formatting, undo/save indicators, overlays and screen-reader text.
 */

const NUMBER_FORMAT = /(\d)(?=(\d{3})+(?!\d))/g;

export function formatNumber(value) {
  const number = Math.max(0, Math.floor(Number(value) || 0));
  return String(number).replace(NUMBER_FORMAT, '$1,');
}

function clearTimer(win, timer) {
  if (timer !== null && timer !== undefined && typeof win.clearTimeout === 'function') {
    win.clearTimeout(timer);
  }
  return null;
}

export function createRenderer(options) {
  const doc = options.document;
  const win = options.window;

  const els = {
    board: doc.getElementById('board'),
    boardFrame: doc.getElementById('board-frame'),
    boardZone: doc.getElementById('board-zone'),
    boardGrid: doc.getElementById('board-grid'),
    tileLayer: doc.getElementById('tile-layer'),
    boardMeta: doc.getElementById('board-meta'),
    score: doc.getElementById('score'),
    scoreStat: doc.getElementById('score-stat'),
    scoreDelta: doc.getElementById('score-delta'),
    best: doc.getElementById('best'),
    bestStat: doc.getElementById('best-stat'),
    bestNote: doc.getElementById('best-note'),
    moves: doc.getElementById('moves'),
    undo: doc.getElementById('undo'),
    undoCount: doc.getElementById('undo-count'),
    saveIndicator: doc.getElementById('save-indicator'),
    saveText: doc.getElementById('save-text'),
    statusLine: doc.getElementById('status-line'),
    overlay: doc.getElementById('overlay'),
    overlayKicker: doc.getElementById('overlay-kicker'),
    overlayTitle: doc.getElementById('overlay-title'),
    overlayHint: doc.getElementById('overlay-hint'),
    overlayDetail: doc.getElementById('overlay-detail'),
    overlayActions: doc.getElementById('overlay-actions'),
    overlayFootnote: doc.getElementById('overlay-footnote'),
    primary: doc.getElementById('primary'),
    liveRegion: doc.getElementById('live-region'),
  };

  const cells = [];
  let overlayOpen = false;
  let primaryAction = null;
  let undoHandler = null;
  let saveRetryHandler = null;
  let swipeHandler = null;
  let reducedMotion = false;
  let theme = 'dark';
  let lastScores = { score: 0, best: 0, moves: 0, record: false };
  let renderToken = 0;
  let deltaTimer = null;
  let bumpTimer = null;
  let announceTimer = null;
  let pointerStart = null;
  let resizeObserver = null;
  let inertTargets = null;

  function init() {
    buildGrid();
    theme = doc.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    reducedMotion = doc.documentElement.dataset.reducedMotion === 'true';
    applyTheme(theme);
    applyReducedMotion(reducedMotion);
    bindEvents();
    updateBoardSummary();
    layout();
    return api;
  }

  function buildGrid() {
    if (!els.boardGrid) return;
    els.boardGrid.textContent = '';
    for (let row = 0; row < 4; row += 1) {
      const rowEl = doc.createElement('div');
      rowEl.className = 'grid-row';
      rowEl.setAttribute('role', 'row');
      for (let col = 0; col < 4; col += 1) {
        const cell = doc.createElement('div');
        cell.className = 'cell';
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-label', `第${row + 1}行第${col + 1}列：空`);
        rowEl.appendChild(cell);
        cells.push(cell);
      }
      els.boardGrid.appendChild(rowEl);
    }
  }

  function bindEvents() {
    if (els.undo) {
      els.undo.addEventListener('click', function onUndoClick() {
        if (typeof undoHandler === 'function') undoHandler();
      });
    }
    if (els.saveIndicator) {
      els.saveIndicator.addEventListener('click', function onSaveClick() {
        if (els.saveIndicator.dataset.state === 'failed' && typeof saveRetryHandler === 'function') {
          saveRetryHandler();
        }
      });
    }
    if (els.primary) {
      els.primary.addEventListener('click', function onPrimaryClick() {
        const action = primaryAction;
        if (typeof action === 'function') action();
      });
    }
    if (els.board) {
      els.board.addEventListener('pointerdown', onPointerDown);
      els.board.addEventListener('pointerup', onPointerUp);
      els.board.addEventListener('pointercancel', onPointerCancel);
    }
    win.addEventListener('resize', layout);
    if (typeof win.ResizeObserver === 'function' && els.boardZone) {
      resizeObserver = new win.ResizeObserver(function onResize() {
        layout();
      });
      resizeObserver.observe(els.boardZone);
    }
  }

  function onPointerDown(event) {
    if (!event) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    if (typeof els.board.focus === 'function') {
      try {
        els.board.focus({ preventScroll: true });
      } catch (_error) {
        els.board.focus();
      }
    }
    if (typeof els.board.setPointerCapture === 'function' && event.pointerId !== undefined) {
      try {
        els.board.setPointerCapture(event.pointerId);
      } catch (_error) {
        // Pointer capture is optional.
      }
    }
  }

  function onPointerUp(event) {
    if (!pointerStart || !event) return;
    const start = pointerStart;
    pointerStart = null;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < 22) return;
    if (typeof swipeHandler !== 'function') return;
    const direction = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    swipeHandler(direction);
  }

  function onPointerCancel() {
    pointerStart = null;
  }

  function applyTheme(next) {
    theme = next === 'light' ? 'light' : 'dark';
    doc.documentElement.dataset.theme = theme;
    updateBoardSummary();
  }

  function applyReducedMotion(value) {
    reducedMotion = value === true;
    doc.documentElement.dataset.reducedMotion = reducedMotion ? 'true' : 'false';
  }

  function setTheme(next) {
    applyTheme(next);
  }

  function setReducedMotion(value) {
    applyReducedMotion(value);
  }

  function setScores(scores) {
    lastScores = {
      score: Math.max(0, Math.floor(Number(scores && scores.score) || 0)),
      best: Math.max(0, Math.floor(Number(scores && scores.best) || 0)),
      moves: Math.max(0, Math.floor(Number(scores && scores.moves) || 0)),
      record: Boolean(scores && scores.record),
    };
    if (els.score) els.score.textContent = formatNumber(lastScores.score);
    if (els.best) els.best.textContent = formatNumber(lastScores.best);
    if (els.moves) els.moves.textContent = formatNumber(lastScores.moves);
    if (els.bestStat) {
      els.bestStat.classList.toggle('is-record', lastScores.record);
      els.bestStat.setAttribute(
        'aria-label',
        lastScores.record ? `最高分 ${lastScores.best}，本局正在刷新纪录` : `最高分 ${lastScores.best}`
      );
    }
    if (els.bestNote) els.bestNote.textContent = lastScores.record ? 'NEW BEST' : 'PERSONAL';
    if (els.scoreStat) els.scoreStat.setAttribute('aria-label', `本局得分 ${lastScores.score}`);
    updateBoardSummary();
  }

  function flashScoreDelta(delta) {
    const gain = Math.floor(Number(delta) || 0);
    if (!els.scoreDelta || gain <= 0 || reducedMotion) return;
    els.scoreDelta.textContent = `+${formatNumber(gain)}`;
    els.scoreDelta.classList.remove('show');
    // Restart the CSS animation without keeping state in the DOM.
    void els.scoreDelta.offsetWidth;
    els.scoreDelta.classList.add('show');
    deltaTimer = clearTimer(win, deltaTimer);
    deltaTimer = win.setTimeout(function hideDelta() {
      deltaTimer = null;
      els.scoreDelta.classList.remove('show');
      els.scoreDelta.textContent = '';
    }, 880);
  }

  function setUndo(status) {
    const remaining = Number(status && status.remaining) === 0 ? 0 : 1;
    const enabled = Boolean(status && status.enabled);
    if (els.undo) {
      els.undo.disabled = !enabled;
      els.undo.setAttribute('aria-label', remaining > 0 ? `撤销上一步，本局还剩 ${remaining} 次` : '撤销已用完');
      els.undo.title = remaining > 0 ? '撤销上一步（本局 1 次）' : '本局撤销已用完';
    }
    if (els.undoCount) {
      els.undoCount.textContent = remaining > 0 ? `剩 ${remaining} 次` : '已用完';
    }
  }

  function setSaveStatus(kind, detail) {
    if (!els.saveIndicator) return;
    const state = ['saving', 'saved', 'failed'].includes(kind) ? kind : 'idle';
    els.saveIndicator.dataset.state = state;
    const code = detail ? ` ${detail}` : '';
    if (state === 'saving') {
      els.saveText.textContent = '保存中';
      els.saveIndicator.disabled = true;
      els.saveIndicator.title = '正在保存本局进度';
    } else if (state === 'saved') {
      els.saveText.textContent = '已保存';
      els.saveIndicator.disabled = true;
      els.saveIndicator.title = '本局进度已保存';
    } else if (state === 'failed') {
      els.saveText.textContent = '重试保存';
      els.saveIndicator.disabled = false;
      els.saveIndicator.title = `保存失败${code}，点击重试`;
      els.saveIndicator.setAttribute('aria-label', `保存失败${code}，点击重试`);
    } else {
      els.saveText.textContent = '未保存';
      els.saveIndicator.disabled = true;
      els.saveIndicator.title = '本局尚未保存';
    }
    if (state !== 'failed') els.saveIndicator.removeAttribute('aria-label');
  }

  function setStatus(text, tone) {
    if (!els.statusLine) return;
    els.statusLine.textContent = text || '';
    els.statusLine.classList.toggle('is-alert', tone === 'alert');
    els.statusLine.classList.toggle('is-brass', tone === 'brass');
  }

  function announce(text) {
    if (!els.liveRegion || !text) return;
    els.liveRegion.textContent = '';
    announceTimer = clearTimer(win, announceTimer);
    announceTimer = win.setTimeout(function pushAnnouncement() {
      announceTimer = null;
      if (els.liveRegion) els.liveRegion.textContent = text;
    }, 40);
  }

  function updateBoardSummary() {
    if (!els.board) return;
    const highest = highestValueFromCells();
    els.board.setAttribute(
      'aria-label',
      `2048 棋盘，4 行 4 列，最高方块 ${highest > 0 ? highest : '无'}，本局得分 ${lastScores.score}`
    );
  }

  function highestValueFromCells() {
    let highest = 0;
    for (const cell of cells) {
      const label = cell.getAttribute('aria-label') || '';
      const match = /：(\d+)$/.exec(label);
      if (match) {
        const value = Number(match[1]);
        if (value > highest) highest = value;
      }
    }
    return highest;
  }

  function updateGrid(board) {
    for (let index = 0; index < 16; index += 1) {
      const cell = cells[index];
      if (!cell) continue;
      const value = board[index];
      const row = Math.floor(index / 4) + 1;
      const col = (index % 4) + 1;
      cell.setAttribute('aria-label', value ? `第${row}行第${col}列：${value}` : `第${row}行第${col}列：空`);
    }
    updateBoardSummary();
  }

  function tileElement(value, index, effect, slideFrom, token) {
    const row = Math.floor(index / 4);
    const col = index % 4;
    const tile = doc.createElement('div');
    tile.className = 'tile';
    tile.setAttribute('data-value', String(value));
    tile.setAttribute('data-digits', String(String(value).length));
    tile.style.setProperty('--row', String(row));
    tile.style.setProperty('--col', String(col));
    if (value > 8192) tile.classList.add('is-beyond');
    if (value >= 2048) tile.classList.add('is-target');
    if (effect && effect.win && value >= 2048) tile.classList.add('is-win');

    const face = doc.createElement('span');
    face.className = 'tile-face';
    face.textContent = String(value);
    tile.appendChild(face);

    const animate = !reducedMotion && !(effect && effect.instant);
    const merged = Boolean(effect && Array.isArray(effect.merges) && effect.merges.some((m) => m.index === index));
    if (animate && merged) tile.classList.add('is-merge');
    if (animate && effect && effect.spawned && effect.spawned.index === index) tile.classList.add('is-spawn');

    if (animate && slideFrom !== null && slideFrom !== index) {
      const fromRow = Math.floor(slideFrom / 4);
      const fromCol = slideFrom % 4;
      tile.style.setProperty('--dx', String(fromCol - col));
      tile.style.setProperty('--dy', String(fromRow - row));
      win.requestAnimationFrame(function firstFrame() {
        win.requestAnimationFrame(function settle() {
          if (token !== renderToken) return;
          tile.classList.add('settled');
        });
      });
    } else {
      tile.classList.add('settled');
    }
    return tile;
  }

  function renderBoard(board, effect) {
    if (!els.tileLayer) return;
    const token = (renderToken += 1);
    const tileBoard = Array.isArray(board) ? board : new Array(16).fill(0);
    const slides = effect && Array.isArray(effect.slides) ? effect.slides : [];
    const slideByDestination = new Map();
    for (const slide of slides) {
      if (!slide || !Number.isInteger(slide.to) || slide.from === slide.to) continue;
      const existing = slideByDestination.get(slide.to);
      if (existing === undefined) {
        slideByDestination.set(slide.to, slide.from);
      } else {
        // Prefer the source farthest from the destination for a longer, more
        // legible slide when two tiles merge into the same cell.
        const existingDistance = Math.abs(Math.floor(existing / 4) - Math.floor(slide.to / 4)) +
          Math.abs((existing % 4) - (slide.to % 4));
        const nextDistance = Math.abs(Math.floor(slide.from / 4) - Math.floor(slide.to / 4)) +
          Math.abs((slide.from % 4) - (slide.to % 4));
        if (nextDistance > existingDistance) slideByDestination.set(slide.to, slide.from);
      }
    }

    const fragment = doc.createDocumentFragment();
    for (let index = 0; index < 16; index += 1) {
      const value = tileBoard[index];
      if (!value) continue;
      const from = slideByDestination.has(index) ? slideByDestination.get(index) : null;
      fragment.appendChild(tileElement(value, index, effect, from, token));
    }
    els.tileLayer.replaceChildren(fragment);
    updateGrid(tileBoard);
    if (reducedMotion || (effect && effect.instant)) {
      for (const tile of els.tileLayer.children) tile.classList.add('settled');
    }
  }

  function layout() {
    if (!els.boardZone || !els.boardFrame) return;
    const rect = els.boardZone.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const metaHeight = els.boardMeta ? els.boardMeta.offsetHeight : 44;
    const gap = 12;
    const app = doc.getElementById('app');
    const appStyles = app ? win.getComputedStyle(app) : null;
    const paddingX = appStyles
      ? (parseFloat(appStyles.paddingLeft) || 0) + (parseFloat(appStyles.paddingRight) || 0)
      : 0;
    const viewportWidth = Math.max(0, (doc.documentElement.clientWidth || win.innerWidth || 0) - paddingX);
    // The board itself can inflate the zone's min-content width while shrinking;
    // clamp against the real document width so a resize can never get stuck.
    const availableWidth = Math.max(0, Math.min(rect.width, viewportWidth));
    const availableHeight = Math.max(0, rect.height - metaHeight - gap);
    const size = Math.floor(Math.max(184, Math.min(availableWidth, availableHeight, 680)));
    els.boardFrame.style.setProperty('--board-size', `${size}px`);
  }

  function focusBoard() {
    try {
      if (typeof win.focus === 'function') win.focus();
    } catch (_error) {
      // Focus is best effort.
    }
    if (els.board && typeof els.board.focus === 'function') {
      try {
        els.board.focus({ preventScroll: true });
      } catch (_error) {
        els.board.focus();
      }
    }
  }

  function bumpBoard() {
    if (!els.board || reducedMotion) return;
    els.board.classList.remove('is-bumped');
    void els.board.offsetWidth;
    els.board.classList.add('is-bumped');
    bumpTimer = clearTimer(win, bumpTimer);
    bumpTimer = win.setTimeout(function clearBump() {
      bumpTimer = null;
      els.board.classList.remove('is-bumped');
    }, 240);
  }

  function setBackgroundInert(value) {
    if (!inertTargets) {
      inertTargets = ['.masthead', '.board-zone', '.footer']
        .map(function select(selector) {
          return doc.querySelector(selector);
        })
        .filter(Boolean);
    }
    for (const element of inertTargets) {
      if (value) element.setAttribute('inert', '');
      else element.removeAttribute('inert');
    }
  }

  function showOverlay(config) {
    const settings = config || {};
    if (!els.overlay) return;
    if (els.overlayKicker) els.overlayKicker.textContent = settings.kicker || '';
    if (els.overlayTitle) els.overlayTitle.textContent = settings.title || '';
    if (els.overlayHint) els.overlayHint.textContent = settings.hint || '';
    if (els.overlayDetail) {
      if (settings.detail) {
        els.overlayDetail.textContent = settings.detail;
        els.overlayDetail.classList.remove('hidden');
        els.overlayDetail.classList.toggle('is-alert', settings.detailTone === 'alert');
      } else {
        els.overlayDetail.textContent = '';
        els.overlayDetail.classList.add('hidden');
        els.overlayDetail.classList.remove('is-alert');
      }
    }
    if (els.overlayFootnote) {
      if (settings.footnote === false) {
        els.overlayFootnote.classList.add('hidden');
      } else {
        els.overlayFootnote.classList.remove('hidden');
        els.overlayFootnote.textContent = settings.footnote || '进度会自动保存 · 离开后可继续';
      }
    }
    primaryAction = typeof settings.onPrimary === 'function' ? settings.onPrimary : null;
    if (els.overlayActions && els.primary) {
      if (settings.primaryLabel && primaryAction) {
        els.overlayActions.style.display = '';
        els.primary.textContent = settings.primaryLabel;
        els.primary.disabled = false;
      } else {
        els.overlayActions.style.display = 'none';
      }
    }
    els.overlay.classList.remove('hidden');
    overlayOpen = true;
    setBackgroundInert(true);
    if (primaryAction && els.primary) {
      win.requestAnimationFrame(function focusPrimary() {
        try {
          els.primary.focus({ preventScroll: true });
        } catch (_error) {
          els.primary.focus();
        }
      });
    } else if (els.overlayTitle) {
      els.overlayTitle.setAttribute('tabindex', '-1');
      win.requestAnimationFrame(function focusTitle() {
        try {
          els.overlayTitle.focus({ preventScroll: true });
        } catch (_error) {
          els.overlayTitle.focus();
        }
      });
    }
  }

  function hideOverlay() {
    if (!els.overlay) return;
    els.overlay.classList.add('hidden');
    overlayOpen = false;
    primaryAction = null;
    setBackgroundInert(false);
  }

  function isOverlayOpen() {
    return overlayOpen;
  }

  function onUndo(handler) {
    undoHandler = typeof handler === 'function' ? handler : null;
  }

  function onSaveRetry(handler) {
    saveRetryHandler = typeof handler === 'function' ? handler : null;
  }

  function onSwipe(handler) {
    swipeHandler = typeof handler === 'function' ? handler : null;
  }

  function destroy() {
    deltaTimer = clearTimer(win, deltaTimer);
    bumpTimer = clearTimer(win, bumpTimer);
    announceTimer = clearTimer(win, announceTimer);
    if (resizeObserver && typeof resizeObserver.disconnect === 'function') resizeObserver.disconnect();
    resizeObserver = null;
  }

  const api = {
    init,
    layout,
    setTheme,
    setReducedMotion,
    setScores,
    flashScoreDelta,
    renderBoard,
    setUndo,
    setSaveStatus,
    setStatus,
    announce,
    showOverlay,
    hideOverlay,
    isOverlayOpen,
    focusBoard,
    bumpBoard,
    onUndo,
    onSaveRetry,
    onSwipe,
    destroy,
  };

  return api;
}
