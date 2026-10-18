/**
 * Snake game entry. Runs inside the sandbox iframe and talks to the platform
 * only through the inlined SDK global (`DSH_GAME_SDK`).
 *
 * V1 notes:
 *   - The manifest is embedded in the HTML by scripts/build-snake.mjs; this file
 *     never reads it (the Runtime owns manifest/version negotiation).
 *   - Recovery contract: a stored board is restored and shown on a "continue"
 *     screen; the snake never starts moving by itself. In `resume-paused` mode
 *     the Runtime sends `pause` and only a later `resume` event restarts the loop.
 *   - Everything visual is DOM/CSS + Canvas: no external assets, no network.
 */

import { BOARD_COLS, BOARD_ROWS, CELL_SIZE, SCORE_PER_FOOD, advance, createGame, deserialize, normalizeDirection, restartGame, serialize, setDirection, startGame, tickMsFor } from './logic.js';
import { RESUME_PLAN, planResume } from './resume.js';

const LOGICAL_WIDTH = 960;
const LOGICAL_HEIGHT = 540;
const boardWidth = BOARD_COLS * CELL_SIZE;
const boardHeight = BOARD_ROWS * CELL_SIZE;
const boardX = Math.round((LOGICAL_WIDTH - boardWidth) / 2);
const boardY = 64;
const FRAME_PAD = 16;
const FONT_STACK =
  "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";
const SCORE_POP_MS = 720;
const DEATH_FLASH_MS = 380;

const PALETTES = {
  dark: {
    board: '#0b0e12',
    frameFill: 'rgba(255, 255, 255, 0.035)',
    frameLine: 'rgba(255, 255, 255, 0.1)',
    grid: 'rgba(255, 255, 255, 0.055)',
    accent: '#34d399',
    corner: 'rgba(52, 211, 153, 0.32)',
    head: '#a7f3d0',
    body: '#34d399',
    tail: '#0ea5e9',
    eye: '#04120c',
    food: '#fbbf24',
    foodGlow: 'rgba(251, 191, 36, 0.18)',
    foodHighlight: 'rgba(255, 255, 255, 0.55)',
    danger: '#fb7185',
    vignette: 'rgba(0, 0, 0, 0.24)',
    headGlow: 'rgba(52, 211, 153, 0.4)',
  },
  light: {
    board: '#0f141b',
    frameFill: 'rgba(15, 23, 42, 0.06)',
    frameLine: 'rgba(15, 23, 42, 0.14)',
    grid: 'rgba(255, 255, 255, 0.06)',
    accent: '#34d399',
    corner: 'rgba(52, 211, 153, 0.28)',
    head: '#a7f3d0',
    body: '#34d399',
    tail: '#0ea5e9',
    eye: '#04120c',
    food: '#fbbf24',
    foodGlow: 'rgba(251, 191, 36, 0.18)',
    foodHighlight: 'rgba(255, 255, 255, 0.55)',
    danger: '#fb7185',
    vignette: 'rgba(0, 0, 0, 0.24)',
    headGlow: 'rgba(52, 211, 153, 0.4)',
  },
};

const game = DSH_GAME_SDK.createGameSDK();

const frameEl = document.getElementById('frame');
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const bestCardEl = document.getElementById('best-card');
const bestLabelEl = document.getElementById('best-label');
const dirChipEl = document.getElementById('dir-chip');
const overlayEl = document.getElementById('overlay');
const overlayCardEl = document.getElementById('overlay-card');
const overlayKickerEl = document.getElementById('overlay-kicker');
const overlayTitleEl = document.getElementById('overlay-title');
const overlayHintEl = document.getElementById('overlay-hint');
const overlayStatsEl = document.getElementById('overlay-stats');
const overlayStatScoreEl = document.getElementById('stat-score');
const overlayStatBestEl = document.getElementById('stat-best');
const overlayStatLengthEl = document.getElementById('stat-length');
const overlayActionsEl = document.getElementById('overlay-actions');
const primaryButton = document.getElementById('primary');
const retryButton = document.getElementById('retry');
const agentHintEl = document.getElementById('agent-hint');
const srStatusEl = document.getElementById('sr-status');

let state = createGame({ seed: 1 });
let mode = 'boot';
let runtimePaused = false;
let runtimeHidden = false;
let moving = false;
let wasMovingBeforePause = false;
let restoredSave = false;
let resumeRequested = false;
let personalBest = 0;
let recordThisRun = false;
let loopRunning = false;
let rafId = null;
let lastFrameTime = 0;
let accumulator = 0;
let overlayAction = null;
let sessionActive = false;
let theme = 'dark';
let reducedMotion = false;
let pixelRatio = 1;
let bgCanvas = null;
let pops = [];
let deathFlashAt = 0;
let resizeQueued = false;
let dirPulseTimer = null;
let lastDirectionAngle = -1;
let lastAgentState = '';
let lastScoreValue = -1;
let lastBestValue = -1;
let lastRecordState = false;
let announceTimer = null;

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function palette() {
  return theme === 'light' ? PALETTES.light : PALETTES.dark;
}

function makeSeed() {
  const value = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  return value || 1;
}

function roundRectPath(target, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  target.beginPath();
  target.moveTo(x + r, y);
  target.arcTo(x + width, y, x + width, y + height, r);
  target.arcTo(x + width, y + height, x, y + height, r);
  target.arcTo(x, y + height, x, y, r);
  target.arcTo(x, y, x + width, y, r);
  target.closePath();
}

function mixHex(from, to, ratio) {
  const parse = function parse(value) {
    return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
  };
  const a = parse(from);
  const b = parse(to);
  const t = Math.max(0, Math.min(1, ratio));
  const channel = function channel(index) {
    return Math.round(a[index] + (b[index] - a[index]) * t)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

// ---------------------------------------------------------------------------
// Canvas sizing / static board layer
// ---------------------------------------------------------------------------

function setupCanvas() {
  const rect = frameEl && typeof frameEl.getBoundingClientRect === 'function' ? frameEl.getBoundingClientRect() : null;
  const cssWidth = rect && rect.width > 0 ? rect.width : window.innerWidth || LOGICAL_WIDTH;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const ratio = Math.max(1, Math.min(3, (cssWidth / LOGICAL_WIDTH) * dpr));
  pixelRatio = ratio;
  canvas.width = Math.round(LOGICAL_WIDTH * ratio);
  canvas.height = Math.round(LOGICAL_HEIGHT * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  buildBackgroundLayer();
}

function buildBackgroundLayer() {
  if (!bgCanvas) bgCanvas = document.createElement('canvas');
  bgCanvas.width = canvas.width;
  bgCanvas.height = canvas.height;
  const g = bgCanvas.getContext('2d');
  if (!g) return;
  g.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  g.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  drawBoardBackdrop(g, palette());
}

function drawBoardBackdrop(g, p) {
  const frameX = boardX - FRAME_PAD;
  const frameY = boardY - FRAME_PAD;
  const frameW = boardWidth + FRAME_PAD * 2;
  const frameH = boardHeight + FRAME_PAD * 2;

  roundRectPath(g, frameX, frameY, frameW, frameH, 24);
  g.fillStyle = p.frameFill;
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = p.frameLine;
  g.stroke();

  roundRectPath(g, frameX, frameY, frameW, frameH, 24);
  g.save();
  g.clip();
  roundRectPath(g, boardX, boardY, boardWidth, boardHeight, 16);
  g.fillStyle = p.board;
  g.fill();

  g.save();
  g.clip();
  g.strokeStyle = p.grid;
  g.lineWidth = 1;
  for (let column = 1; column < BOARD_COLS; column += 1) {
    const x = boardX + column * CELL_SIZE + 0.5;
    g.beginPath();
    g.moveTo(x, boardY);
    g.lineTo(x, boardY + boardHeight);
    g.stroke();
  }
  for (let row = 1; row < BOARD_ROWS; row += 1) {
    const y = boardY + row * CELL_SIZE + 0.5;
    g.beginPath();
    g.moveTo(boardX, y);
    g.lineTo(boardX + boardWidth, y);
    g.stroke();
  }

  const topLight = g.createLinearGradient(boardX, boardY, boardX + boardWidth, boardY);
  topLight.addColorStop(0, 'rgba(52, 211, 153, 0)');
  topLight.addColorStop(0.5, 'rgba(52, 211, 153, 0.55)');
  topLight.addColorStop(1, 'rgba(14, 165, 233, 0)');
  g.fillStyle = topLight;
  g.fillRect(boardX, boardY, boardWidth, 2);

  const centerX = boardX + boardWidth / 2;
  const centerY = boardY + boardHeight / 2;
  const vignette = g.createRadialGradient(centerX, centerY, Math.min(boardWidth, boardHeight) * 0.24, centerX, centerY, Math.max(boardWidth, boardHeight) * 0.7);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, p.vignette);
  g.fillStyle = vignette;
  g.fillRect(boardX, boardY, boardWidth, boardHeight);
  g.restore();
  g.restore();

  // Arcade corner ticks just outside the board frame.
  g.save();
  g.strokeStyle = p.corner;
  g.lineWidth = 2;
  g.lineCap = 'round';
  const tick = 14;
  const gap = 8;
  const corners = [
    [frameX - gap, frameY - gap, 1, 1],
    [frameX + frameW + gap, frameY - gap, -1, 1],
    [frameX - gap, frameY + frameH + gap, 1, -1],
    [frameX + frameW + gap, frameY + frameH + gap, -1, -1],
  ];
  for (const [cornerX, cornerY, signX, signY] of corners) {
    g.beginPath();
    g.moveTo(cornerX + signX * tick, cornerY);
    g.lineTo(cornerX, cornerY);
    g.lineTo(cornerX, cornerY + signY * tick);
    g.stroke();
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// Dynamic canvas rendering
// ---------------------------------------------------------------------------

function drawFood(p, nowMs_) {
  if (!state.food) return;
  const pulse = reducedMotion ? 1 : 1 + Math.sin(nowMs_ / 260) * 0.08;
  const centerX = boardX + state.food.x * CELL_SIZE + CELL_SIZE / 2;
  const centerY = boardY + state.food.y * CELL_SIZE + CELL_SIZE / 2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, CELL_SIZE * 0.34 * pulse, 0, Math.PI * 2);
  ctx.fillStyle = p.foodGlow;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(centerX, centerY, CELL_SIZE * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = p.food;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(centerX - CELL_SIZE * 0.06, centerY - CELL_SIZE * 0.07, CELL_SIZE * 0.055, 0, Math.PI * 2);
  ctx.fillStyle = p.foodHighlight;
  ctx.fill();
}

function drawSnake(p) {
  const length = state.snake.length;
  for (let index = length - 1; index >= 0; index -= 1) {
    const segment = state.snake[index];
    const head = index === 0;
    const inset = head ? 2 : 3;
    const ratio = length <= 1 ? 0 : index / Math.max(1, length - 1);
    roundRectPath(
      ctx,
      boardX + segment.x * CELL_SIZE + inset,
      boardY + segment.y * CELL_SIZE + inset,
      CELL_SIZE - inset * 2,
      CELL_SIZE - inset * 2,
      head ? 10 : 8
    );
    if (head) {
      ctx.save();
      if (!reducedMotion) {
        ctx.shadowColor = p.headGlow;
        ctx.shadowBlur = 10;
      }
      ctx.fillStyle = p.head;
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = mixHex(p.body, p.tail, ratio);
      ctx.fill();
    }
  }

  const head = state.snake[0];
  if (!head) return;
  const direction = state.direction;
  const centerX = boardX + head.x * CELL_SIZE + CELL_SIZE / 2;
  const centerY = boardY + head.y * CELL_SIZE + CELL_SIZE / 2;
  const perpendicularX = direction.y !== 0 ? 1 : 0;
  const perpendicularY = direction.x !== 0 ? 1 : 0;
  const forwardX = direction.x * 6;
  const forwardY = direction.y * 6;
  const spread = 5;
  ctx.fillStyle = p.eye;
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(
      centerX + forwardX + perpendicularX * spread * sign,
      centerY + forwardY + perpendicularY * spread * sign,
      2.4,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
}

function drawHeading(p) {
  const head = state.snake[0];
  if (!head) return;
  const direction = state.direction;
  const centerX = boardX + head.x * CELL_SIZE + CELL_SIZE / 2;
  const centerY = boardY + head.y * CELL_SIZE + CELL_SIZE / 2;
  const base = CELL_SIZE * 0.5 + 2;
  const tip = base + 8;
  const half = 5.5;
  const perpendicularX = -direction.y;
  const perpendicularY = direction.x;
  ctx.beginPath();
  ctx.moveTo(centerX + direction.x * tip, centerY + direction.y * tip);
  ctx.lineTo(centerX + direction.x * base + perpendicularX * half, centerY + direction.y * base + perpendicularY * half);
  ctx.lineTo(centerX + direction.x * base - perpendicularX * half, centerY + direction.y * base - perpendicularY * half);
  ctx.closePath();
  ctx.globalAlpha = mode === 'paused' ? 0.22 : 0.55;
  ctx.fillStyle = p.accent;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawPops(p, nowMs_) {
  if (pops.length === 0) return;
  pops = pops.filter(function stillAlive(pop) {
    return nowMs_ - pop.t0 < SCORE_POP_MS;
  });
  if (pops.length === 0) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 16px ${FONT_STACK}`;
  for (const pop of pops) {
    const progress = Math.min(1, (nowMs_ - pop.t0) / SCORE_POP_MS);
    ctx.globalAlpha = Math.max(0, 1 - progress);
    ctx.fillStyle = p.food;
    ctx.fillText(`+${pop.amount}`, pop.x, pop.y - progress * 26);
  }
  ctx.restore();
}

function drawDeathFlash(p, nowMs_) {
  if (!deathFlashAt) return;
  const elapsed = nowMs_ - deathFlashAt;
  if (elapsed >= DEATH_FLASH_MS) {
    deathFlashAt = 0;
    return;
  }
  ctx.save();
  ctx.globalAlpha = (1 - elapsed / DEATH_FLASH_MS) * 0.5;
  ctx.strokeStyle = p.danger;
  ctx.lineWidth = 6;
  roundRectPath(ctx, boardX + 3, boardY + 3, boardWidth - 6, boardHeight - 6, 14);
  ctx.stroke();
  ctx.restore();
}

function render() {
  const nowMs_ = nowMs();
  const p = palette();
  ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  if (bgCanvas) ctx.drawImage(bgCanvas, 0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  ctx.save();
  roundRectPath(ctx, boardX, boardY, boardWidth, boardHeight, 16);
  ctx.clip();
  drawFood(p, nowMs_);
  drawSnake(p);
  drawHeading(p);
  drawPops(p, nowMs_);
  drawDeathFlash(p, nowMs_);
  ctx.restore();

  updateDirectionChip();
}

// ---------------------------------------------------------------------------
// HUD + overlays
// ---------------------------------------------------------------------------

function currentBestDisplay() {
  return Math.max(personalBest, recordThisRun ? state.score : 0);
}

function updateScores() {
  if (!state) return;
  if (state.score !== lastScoreValue) {
    scoreEl.textContent = String(state.score);
    lastScoreValue = state.score;
  }
  const bestValue = currentBestDisplay();
  if (bestValue !== lastBestValue) {
    bestEl.textContent = String(bestValue);
    lastBestValue = bestValue;
  }
  const isRecord = recordThisRun && state.score > 0;
  if (isRecord !== lastRecordState) {
    bestCardEl.classList.toggle('is-record', isRecord);
    bestLabelEl.textContent = isRecord ? '新纪录' : '最高';
    lastRecordState = isRecord;
  }
}

function updateStats() {
  overlayStatScoreEl.textContent = String(state.score);
  overlayStatBestEl.textContent = String(currentBestDisplay());
  overlayStatLengthEl.textContent = String(state.snake.length);
}

function directionAngle(direction) {
  if (direction.x === 1) return 90;
  if (direction.x === -1) return 270;
  if (direction.y === 1) return 180;
  return 0;
}

function updateDirectionChip() {
  const shown = state.pendingDirections.length > 0 ? state.pendingDirections[0] : state.direction;
  const angle = directionAngle(shown);
  if (angle === lastDirectionAngle) return;
  lastDirectionAngle = angle;
  if (dirChipEl) {
    dirChipEl.style.setProperty('--dir', `${angle}deg`);
    if (!reducedMotion) {
      dirChipEl.classList.add('turn');
      if (dirPulseTimer !== null) window.clearTimeout(dirPulseTimer);
      dirPulseTimer = window.setTimeout(function clearTurn() {
        dirPulseTimer = null;
        dirChipEl.classList.remove('turn');
      }, 170);
    }
  }
}

function announce(message) {
  if (!srStatusEl || typeof message !== 'string' || message.length === 0) return;
  if (announceTimer !== null) window.clearTimeout(announceTimer);
  srStatusEl.textContent = '';
  announceTimer = window.setTimeout(function speak() {
    announceTimer = null;
    srStatusEl.textContent = message;
  }, 40);
}

function setOverlay(config) {
  overlayKickerEl.textContent = config.kicker || '';
  overlayTitleEl.textContent = config.title || '';
  overlayHintEl.textContent = config.hint || '';
  overlayEl.dataset.variant = config.variant || 'start';

  const showStats = config.stats === true;
  overlayStatsEl.hidden = !showStats;
  if (showStats) updateStats();

  overlayAction = typeof config.onAction === 'function' ? config.onAction : null;
  if (config.actionLabel && overlayAction) {
    primaryButton.textContent = config.actionLabel;
    primaryButton.hidden = false;
  } else {
    primaryButton.hidden = true;
  }
  retryButton.hidden = config.showRetry !== true;
  overlayActionsEl.hidden = primaryButton.hidden && retryButton.hidden;

  overlayEl.hidden = false;
  overlayEl.classList.remove('hidden');
  if (overlayCardEl && typeof overlayCardEl.focus === 'function') {
    try {
      overlayCardEl.focus({ preventScroll: true });
    } catch (_error) {
      // focus is best-effort
    }
  }
}

function hideOverlay() {
  overlayEl.hidden = true;
  overlayEl.classList.add('hidden');
  overlayAction = null;
  focusBoard();
}

function showContinueOverlay() {
  setOverlay({
    kicker: '已恢复上一局',
    title: '继续上一局',
    hint: '棋盘与分数已恢复 · 按方向键继续',
    variant: 'continue',
    stats: true,
    actionLabel: '继续游戏',
    onAction: function onAction() {
      startFromReady();
    },
  });
}

function showStartOverlay() {
  setOverlay({
    kicker: '贪吃蛇',
    title: '按方向键开始',
    hint: `方向键 / WASD 开始 · 吃到食物 +${SCORE_PER_FOOD}`,
    variant: 'start',
    actionLabel: '开始游戏',
    onAction: function onAction() {
      startFromReady();
    },
  });
}

function showPausedOverlay() {
  if (runtimePaused) {
    setOverlay({
      kicker: '已暂停',
      title: '等待平台继续',
      hint: '在平台的暂停菜单中点击“继续”后回到游戏',
      variant: 'paused',
      stats: true,
    });
    return;
  }
  setOverlay({
    kicker: '已暂停',
    title: '休息一下',
    hint: '按空格 / P 继续 · Esc 也可',
    variant: 'paused',
    stats: true,
    actionLabel: '继续',
    onAction: toggleLocalPause,
  });
}

function showGameOverOverlay() {
  const won = state.status === 'won';
  const reason = won ? '棋盘填满了' : state.overReason === 'self' ? '撞到自己了' : '撞到墙了';
  setOverlay({
    kicker: won ? '完美通关' : '本局结束',
    title: `得分 ${state.score}`,
    hint: `${reason} · 按 Enter 再来一局`,
    variant: 'over',
    stats: true,
    actionLabel: '再来一局',
    onAction: function onAction() {
      restart();
    },
  });
}

function showFatal(error) {
  mode = 'error';
  stopLoop();
  const code = error && error.code ? ` · ${error.code}` : '';
  const message = error && error.message ? error.message : '请返回市场后重新进入';
  setOverlay({
    kicker: '无法开始',
    title: '游戏暂时不可用',
    hint: message + code,
    variant: 'error',
    showRetry: true,
  });
  announce('游戏暂时不可用');
}

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function startFromReady() {
  if (mode !== 'ready') return;
  mode = 'playing';
  // A restored board or a fresh `createGame()` is still `ready` in the pure
  // rules module; entering play must flip it to `playing` or the loop would
  // never advance (notably when the first key equals the initial direction).
  if (state.status !== 'playing') state = startGame(state);
  moving = true;
  hideOverlay();
  render();
  updateScores();
  startLoop();
  announce('游戏开始');
}

function startLoop() {
  if (loopRunning || runtimeHidden) return;
  loopRunning = true;
  lastFrameTime = 0;
  accumulator = 0;
  rafId = requestAnimationFrame(frame);
}

function stopLoop() {
  loopRunning = false;
  if (rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
  rafId = null;
}

// The Runtime may deliver `resume` while boot() is still loading best/save
// (the platform overlay appears as soon as the pause handshake lands). Remember
// it and start playing once the restored board is ready instead of leaving the
// game in its `ready` overlay.
function focusBoard() {
  // After the platform overlay is dismissed, keyboard focus stays on the parent
  // document; hand it back to the game so arrow keys work immediately.
  try {
    if (typeof window !== 'undefined' && typeof window.focus === 'function') window.focus();
  } catch (_error) {
    // focus is best-effort
  }
  try {
    if (canvas && typeof canvas.focus === 'function') canvas.focus({ preventScroll: true });
  } catch (_error) {
    // focus is best-effort
  }
}

function beginPlayingFromResume() {
  wasMovingBeforePause = false;
  runtimePaused = false;
  resumeRequested = false;
  const plan = planResume(mode, state.status);
  if (plan === RESUME_PLAN.IGNORE) return;
  // The platform modal is the single confirmation; start immediately and put
  // keyboard focus back on the board, so there is no second prompt and no static
  // ready board. A board saved before its first key simply starts moving.
  hideOverlay();
  mode = 'playing';
  if (state.status === 'ready' || state.status === 'playing') state = startGame(state);
  moving = true;
  startLoop();
  focusBoard();
  announce('继续游戏');
}

function checkRecord() {
  if (recordThisRun || !state || state.score <= 0 || state.score <= personalBest) return;
  recordThisRun = true;
  updateScores();
  announce(`新纪录，${state.score} 分`);
}

function onGameOver() {
  if (mode === 'over') return;
  mode = 'over';
  moving = false;
  stopLoop();
  deathFlashAt = reducedMotion ? 0 : nowMs();
  personalBest = Math.max(personalBest, state.score);
  updateScores();
  render();
  showGameOverOverlay();
  saveState();
  announce(state.status === 'won' ? `通关，得分 ${state.score}` : `本局结束，得分 ${state.score}`);
  game.score
    .submit(state.score)
    .then(function onSubmitted(result) {
      if (result && typeof result.best === 'number' && result.best > personalBest) {
        personalBest = result.best;
        updateScores();
        if (mode === 'over') updateStats();
      }
    })
    .catch(function ignore() {});
  if (sessionActive) {
    sessionActive = false;
    game.session.end({ outcome: 'completed', score: state.score }).catch(function ignore() {});
  }
}

function restart() {
  state = startGame(restartGame(state, makeSeed()));
  restoredSave = false;
  recordThisRun = false;
  pops = [];
  deathFlashAt = 0;
  moving = true;
  mode = 'playing';
  hideOverlay();
  setupCanvas();
  render();
  updateScores();
  saveState();
  startLoop();
  if (!sessionActive) {
    sessionActive = true;
    game.session.start().catch(function ignore() {});
  }
  announce('新的一局');
}

function toggleLocalPause() {
  if (runtimePaused || mode === 'boot' || mode === 'over' || mode === 'error') return;
  if (mode === 'playing') {
    mode = 'paused';
    stopLoop();
    saveState();
    showPausedOverlay();
    render();
    announce('已暂停');
    return;
  }
  if (mode === 'paused') {
    mode = 'playing';
    hideOverlay();
    startLoop();
    announce('继续');
  }
}

function saveState() {
  if (!state) return Promise.resolve();
  return game.storage.save('current', serialize(state)).then(undefined, function ignore() {});
}

function frame(timestamp) {
  rafId = null;
  if (!loopRunning) return;
  const nowMs_ = typeof timestamp === 'number' ? timestamp : nowMs();
  if (lastFrameTime === 0) lastFrameTime = nowMs_;
  const delta = Math.min(120, Math.max(0, nowMs_ - lastFrameTime));
  lastFrameTime = nowMs_;
  if (moving && state.status === 'playing') {
    accumulator += delta;
    let guard = 0;
    while (accumulator >= tickMsFor(state.score) && state.status === 'playing' && guard < 8) {
      accumulator -= tickMsFor(state.score);
      guard += 1;
      const eatenCell = state.food ? { x: state.food.x, y: state.food.y } : null;
      const foodEatenBefore = state.foodEaten;
      state = advance(state);
      if (state.foodEaten > foodEatenBefore) {
        if (!reducedMotion && eatenCell) {
          pops.push({
            x: boardX + eatenCell.x * CELL_SIZE + CELL_SIZE / 2,
            y: boardY + eatenCell.y * CELL_SIZE + CELL_SIZE / 2,
            t0: nowMs_,
            amount: SCORE_PER_FOOD,
          });
          if (pops.length > 12) pops.shift();
        }
        checkRecord();
      }
      if (state.status === 'over' || state.status === 'won') {
        onGameOver();
        break;
      }
    }
  }
  render();
  updateScores();
  if (loopRunning) rafId = requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function handleKeydown(event) {
  if (!event || typeof event.key !== 'string') return;
  const direction = normalizeDirection(event.key);
  if (runtimePaused) {
    if (direction) event.preventDefault();
    return;
  }
  if (direction) {
    if (mode === 'boot' || mode === 'over' || mode === 'error') return;
    event.preventDefault();
    if (mode === 'ready') {
      state = setDirection(state, direction);
      startFromReady();
      return;
    }
    if (mode === 'playing' || mode === 'paused') {
      state = setDirection(state, direction);
      render();
      if (mode === 'paused') {
        mode = 'playing';
        hideOverlay();
        startLoop();
        announce('继续');
      }
      moving = true;
    }
    return;
  }
  const key = event.key.toLowerCase();
  if (event.repeat) return;
  if (key === ' ' || key === 'p' || key === 'escape' || key === 'spacebar') {
    if (mode === 'playing' || mode === 'paused') {
      event.preventDefault();
      toggleLocalPause();
    }
    return;
  }
  if (key === 'enter') {
    if (mode === 'over') {
      event.preventDefault();
      restart();
    } else if (mode === 'ready') {
      event.preventDefault();
      startFromReady();
    }
  }
}

function handleResize() {
  if (resizeQueued) return;
  resizeQueued = true;
  const run = function run() {
    resizeQueued = false;
    setupCanvas();
    render();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else window.setTimeout(run, 60);
}

// ---------------------------------------------------------------------------
// Theme / motion
// ---------------------------------------------------------------------------

function applyTheme(nextTheme) {
  theme = nextTheme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  buildBackgroundLayer();
  render();
}

function applyReducedMotion(value) {
  reducedMotion = value === true;
  document.documentElement.dataset.reducedMotion = reducedMotion ? 'true' : 'false';
  if (reducedMotion) {
    pops = [];
    deathFlashAt = 0;
  }
}

function systemPrefersReducedMotion() {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (_error) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Platform lifecycle
// ---------------------------------------------------------------------------

function onRuntimePause() {
  if (mode === 'over' || mode === 'error') return;
  runtimePaused = true;
  resumeRequested = false;
  stopLoop();
  if (mode === 'playing' || mode === 'ready') {
    const wasPlaying = mode === 'playing';
    if (wasPlaying) wasMovingBeforePause = moving;
    mode = 'paused';
    if (wasPlaying) saveState();
    showPausedOverlay();
    render();
  }
}

function onRuntimeResume() {
  runtimePaused = false;
  resumeRequested = true;
  if (mode === 'paused' || mode === 'ready') beginPlayingFromResume();
}

// `hidden` stops the render/tick loop immediately (PRD §8.5). `visible` may
// restore rendering, but a paused Runtime keeps the loop stopped until its
// `resume` event so the player never loses a frame or a tick while away.
function onRuntimeHidden() {
  runtimeHidden = true;
  stopLoop();
}

function onRuntimeVisible() {
  runtimeHidden = false;
  if (runtimePaused) {
    render();
    return;
  }
  if (mode === 'playing' || mode === 'ready') startLoop();
  else render();
}

function onBeforeSave() {
  return saveState();
}

function onAgentStatus(snapshot) {
  if (!snapshot || !agentHintEl) return;
  if (snapshot.state === 'waiting-user') {
    agentHintEl.textContent = snapshot.label || 'Agent 需要你';
    agentHintEl.classList.add('visible');
  } else if (snapshot.state === 'completed') {
    agentHintEl.textContent = snapshot.label || '任务完成';
    agentHintEl.classList.add('visible');
  } else {
    agentHintEl.textContent = '';
    agentHintEl.classList.remove('visible');
  }
  if (snapshot.state !== lastAgentState) {
    lastAgentState = snapshot.state;
    if (snapshot.state === 'waiting-user' || snapshot.state === 'completed') {
      announce(snapshot.label || (snapshot.state === 'waiting-user' ? 'Agent 需要你' : '任务完成'));
    }
  }
}

async function loadSave() {
  try {
    return await game.storage.load('current');
  } catch (_error) {
    return null;
  }
}

async function loadBest() {
  try {
    const result = await game.score.getBest();
    if (result && typeof result.score === 'number' && result.score > 0) return result.score;
  } catch (_error) {
    // `score` capability missing or Host unavailable: the game still plays.
  }
  return 0;
}

async function boot() {
  setupCanvas();
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('resize', handleResize);
  if (typeof ResizeObserver === 'function' && frameEl) {
    try {
      new ResizeObserver(handleResize).observe(frameEl);
    } catch (_error) {
      // resize is best-effort
    }
  }
  primaryButton.addEventListener('click', function onPrimary() {
    if (overlayAction) overlayAction();
  });
  retryButton.addEventListener('click', function onRetry() {
    try {
      window.location.reload();
    } catch (_error) {
      // The Runtime error overlay remains the fallback.
    }
  });
  render();

  // Register before ready(): the Runtime may deliver `pause` immediately after
  // the ready handshake in `resume-paused` mode.
  game.lifecycle.on('pause', onRuntimePause);
  game.lifecycle.on('resume', onRuntimeResume);
  game.lifecycle.on('hidden', onRuntimeHidden);
  game.lifecycle.on('visible', onRuntimeVisible);
  game.lifecycle.on('before-save', onBeforeSave);
  game.agent.on('status', onAgentStatus);

  try {
    const info = await game.ready();
    applyTheme(info.theme);
    applyReducedMotion(info.reducedMotion === true || systemPrefersReducedMotion());
    personalBest = await loadBest();
    const saved = await loadSave();
    const restored = saved ? deserialize(saved.data) : null;
    if (restored) {
      state = restored;
      restoredSave = true;
      personalBest = Math.max(personalBest, state.score);
      recordThisRun = false;
      if (state.status === 'over' || state.status === 'won') {
        mode = 'over';
        showGameOverOverlay();
      } else {
        mode = 'ready';
        if (runtimePaused) showPausedOverlay();
        else showContinueOverlay();
      }
    } else {
      state = createGame({ seed: makeSeed() });
      mode = 'ready';
      if (runtimePaused) showPausedOverlay();
      else showStartOverlay();
    }
    updateScores();
    render();
    if (resumeRequested && mode === 'ready') beginPlayingFromResume();
    else if (!runtimePaused && mode === 'ready') startLoop();
    if (!sessionActive && mode !== 'over') {
      sessionActive = true;
      game.session.start().catch(function ignore() {});
    }
  } catch (error) {
    showFatal(error);
  }
}

// Read-only diagnostic hook used by the live-verification harness. It exposes
// only the game's own transient lifecycle state, no user data.
if (typeof window !== 'undefined') {
  window.__dshSnakeDebug = function __dshSnakeDebug() {
    return {
      mode: mode,
      runtimePaused: runtimePaused,
      runtimeHidden: runtimeHidden,
      resumeRequested: resumeRequested,
      restoredSave: restoredSave,
      moving: moving,
      loopRunning: loopRunning,
      status: state && state.status,
      score: state && state.score,
      best: currentBestDisplay(),
      record: recordThisRun,
      theme: theme,
      reducedMotion: reducedMotion,
    };
  };
}

boot();
