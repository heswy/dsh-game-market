/**
 * Snake game entry. Runs inside the sandbox iframe and talks to the platform
 * only through the inlined SDK global (`DSH_GAME_SDK`).
 *
 * Recovery contract: a stored board is restored and shown on a "continue"
 * screen; the snake never starts moving by itself. In `resume-paused` mode the
 * Runtime sends `pause` and only a later `resume` event restarts the loop.
 */

import { BOARD_COLS, BOARD_ROWS, CELL_SIZE, SCORE_PER_FOOD, advance, createGame, deserialize, normalizeDirection, restartGame, serialize, setDirection, tickMsFor } from './logic.js';

const LOGICAL_WIDTH = 960;
const LOGICAL_HEIGHT = 540;
const boardWidth = BOARD_COLS * CELL_SIZE;
const boardHeight = BOARD_ROWS * CELL_SIZE;
const boardX = Math.round((LOGICAL_WIDTH - boardWidth) / 2);
const boardY = 72;

const game = DSH_GAME_SDK.createGameSDK();

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const overlayEl = document.getElementById('overlay');
const overlayKickerEl = document.getElementById('overlay-kicker');
const overlayTitleEl = document.getElementById('overlay-title');
const overlayHintEl = document.getElementById('overlay-hint');
const overlayActionsEl = document.getElementById('overlay-actions');
const primaryButton = document.getElementById('primary');
const agentHintEl = document.getElementById('agent-hint');

let state = createGame({ seed: 1 });
let mode = 'boot';
let runtimePaused = false;
let moving = false;
let wasMovingBeforePause = false;
let restoredSave = false;
let best = 0;
let loopRunning = false;
let rafId = null;
let lastFrameTime = 0;
let accumulator = 0;
let overlayAction = null;
let sessionActive = false;
let theme = 'dark';
let reducedMotion = false;

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

function setupCanvas() {
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = Math.round(LOGICAL_WIDTH * dpr);
  canvas.height = Math.round(LOGICAL_HEIGHT * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function updateScores() {
  scoreEl.textContent = String(state.score);
  bestEl.textContent = String(Math.max(best, state.score));
}

function setOverlay(config) {
  overlayKickerEl.textContent = config.kicker || '';
  overlayTitleEl.textContent = config.title || '';
  overlayHintEl.textContent = config.hint || '';
  overlayAction = typeof config.onAction === 'function' ? config.onAction : null;
  if (config.actionLabel && overlayAction) {
    primaryButton.textContent = config.actionLabel;
    overlayActionsEl.style.display = '';
  } else {
    overlayActionsEl.style.display = 'none';
  }
  overlayEl.classList.remove('hidden');
}

function hideOverlay() {
  overlayEl.classList.add('hidden');
  overlayAction = null;
}

function showContinueOverlay() {
  setOverlay({
    kicker: '已恢复上一局',
    title: '继续上一局',
    hint: '棋盘与分数已恢复 · 按方向键开始',
    actionLabel: '开始游戏',
    onAction: function onAction() {
      startFromReady(true);
    },
  });
}

function showStartOverlay() {
  setOverlay({
    kicker: '贪吃蛇',
    title: '按方向键开始',
    hint: '方向键 / WASD 移动 · Space 暂停 · 吃到食物 +' + SCORE_PER_FOOD,
    actionLabel: '开始游戏',
    onAction: function onAction() {
      startFromReady(false);
    },
  });
}

function showPausedOverlay() {
  if (runtimePaused) {
    setOverlay({
      kicker: '已暂停',
      title: '已恢复上一局',
      hint: '在平台的暂停菜单中点击“继续”后开始',
    });
    return;
  }
  setOverlay({
    kicker: '已暂停',
    title: '休息一下',
    hint: '按空格 / P 继续',
    actionLabel: '继续',
    onAction: toggleLocalPause,
  });
}

function showGameOverOverlay() {
  const reason =
    state.status === 'won' ? '棋盘填满了' : state.overReason === 'self' ? '撞到自己了' : '撞到墙了';
  setOverlay({
    kicker: '本局结束',
    title: '得分 ' + state.score,
    hint: reason + ' · 按 Enter 再来一局',
    actionLabel: '再来一局',
    onAction: function onAction() {
      restart();
    },
  });
}

function showFatal(error) {
  mode = 'error';
  stopLoop();
  const code = error && error.code ? ' · ' + error.code : '';
  setOverlay({
    kicker: '无法开始',
    title: '游戏暂时不可用',
    hint: (error && error.message ? error.message : '请返回市场后重新进入') + code,
  });
}

function startFromReady(resumeMotion) {
  if (mode !== 'ready') return;
  hideOverlay();
  mode = 'playing';
  moving = resumeMotion === true;
  render();
  startLoop();
}

function startLoop() {
  if (loopRunning) return;
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

function onGameOver() {
  if (mode === 'over') return;
  mode = 'over';
  moving = false;
  stopLoop();
  updateScores();
  render();
  showGameOverOverlay();
  saveState();
  game.score.submit(state.score).then(function onSubmitted(result) {
    if (result && typeof result.best === 'number' && result.best > best) {
      best = result.best;
      updateScores();
    }
  }).catch(function ignore() {});
  if (sessionActive) {
    sessionActive = false;
    game.session.end({ outcome: 'completed', score: state.score }).catch(function ignore() {});
  }
}

function restart() {
  state = restartGame(state, makeSeed());
  restoredSave = false;
  moving = true;
  mode = 'playing';
  hideOverlay();
  setupCanvas();
  render();
  updateScores();
  startLoop();
  if (!sessionActive) {
    sessionActive = true;
    game.session.start().catch(function ignore() {});
  }
}

function toggleLocalPause() {
  if (runtimePaused || mode === 'boot' || mode === 'over' || mode === 'error') return;
  if (mode === 'playing') {
    mode = 'paused';
    stopLoop();
    saveState();
    showPausedOverlay();
    render();
    return;
  }
  if (mode === 'paused') {
    mode = 'playing';
    hideOverlay();
    startLoop();
  }
}

function saveState() {
  if (!state) return Promise.resolve();
  return game.storage.save('current', serialize(state)).then(undefined, function ignore() {});
}

function frame(timestamp) {
  rafId = null;
  if (!loopRunning) return;
  const nowMs = typeof timestamp === 'number' ? timestamp : performance.now();
  if (lastFrameTime === 0) lastFrameTime = nowMs;
  const delta = Math.min(120, Math.max(0, nowMs - lastFrameTime));
  lastFrameTime = nowMs;
  if (moving && state.status === 'playing') {
    accumulator += delta;
    let guard = 0;
    while (accumulator >= tickMsFor(state.score) && state.status === 'playing' && guard < 8) {
      accumulator -= tickMsFor(state.score);
      guard += 1;
      state = advance(state);
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

function render() {
  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  const isLight = theme === 'light';
  ctx.save();
  roundRectPath(ctx, boardX - 16, boardY - 16, boardWidth + 32, boardHeight + 32, 22);
  ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.06)' : 'rgba(255, 255, 255, 0.035)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255, 255, 255, 0.08)';
  ctx.stroke();

  roundRectPath(ctx, boardX, boardY, boardWidth, boardHeight, 14);
  ctx.fillStyle = isLight ? '#0f141b' : '#0b0c0e';
  ctx.fill();
  ctx.save();
  ctx.clip();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
  ctx.lineWidth = 1;
  for (let column = 1; column < BOARD_COLS; column += 1) {
    const x = boardX + column * CELL_SIZE + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, boardY);
    ctx.lineTo(x, boardY + boardHeight);
    ctx.stroke();
  }
  for (let row = 1; row < BOARD_ROWS; row += 1) {
    const y = boardY + row * CELL_SIZE + 0.5;
    ctx.beginPath();
    ctx.moveTo(boardX, y);
    ctx.lineTo(boardX + boardWidth, y);
    ctx.stroke();
  }

  if (state.food) {
    const pulse = reducedMotion ? 1 : 1 + Math.sin(nowMs / 260) * 0.08;
    const centerX = boardX + state.food.x * CELL_SIZE + CELL_SIZE / 2;
    const centerY = boardY + state.food.y * CELL_SIZE + CELL_SIZE / 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, CELL_SIZE * 0.34 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(251, 191, 36, 0.16)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(centerX, centerY, CELL_SIZE * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();
  }

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
    ctx.fillStyle = head ? '#a7f3d0' : mixHex('#34d399', '#0ea5e9', ratio);
    ctx.fill();
    if (head) {
      const direction = state.direction;
      const centerX = boardX + segment.x * CELL_SIZE + CELL_SIZE / 2;
      const centerY = boardY + segment.y * CELL_SIZE + CELL_SIZE / 2;
      const perpendicularX = direction.y !== 0 ? 1 : 0;
      const perpendicularY = direction.x !== 0 ? 1 : 0;
      const forwardX = direction.x * 6;
      const forwardY = direction.y * 6;
      const spread = 5;
      ctx.fillStyle = '#04120c';
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
  }
  ctx.restore();
  ctx.restore();
}

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
      startFromReady(true);
      return;
    }
    if (mode === 'playing' || mode === 'paused') {
      state = setDirection(state, direction);
      if (mode === 'paused') {
        mode = 'playing';
        hideOverlay();
        startLoop();
      }
      moving = true;
    }
    return;
  }
  const key = event.key.toLowerCase();
  if (key === ' ' || key === 'p' || key === 'spacebar') {
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
      startFromReady(false);
    }
  }
}

function handleResize() {
  setupCanvas();
  render();
}

function applyTheme(nextTheme) {
  theme = nextTheme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
}

function onRuntimePause() {
  if (mode === 'over' || mode === 'error') return;
  runtimePaused = true;
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
  if (mode !== 'paused' && mode !== 'ready') return;
  hideOverlay();
  mode = 'playing';
  moving = restoredSave || wasMovingBeforePause;
  wasMovingBeforePause = false;
  startLoop();
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
  primaryButton.addEventListener('click', function onPrimary() {
    if (overlayAction) overlayAction();
  });
  render();

  // Register before ready(): the Runtime may deliver `pause` immediately after
  // the ready handshake in `resume-paused` mode.
  game.lifecycle.on('pause', onRuntimePause);
  game.lifecycle.on('resume', onRuntimeResume);
  game.lifecycle.on('before-save', onBeforeSave);
  game.agent.on('status', onAgentStatus);

  try {
    const info = await game.ready();
    applyTheme(info.theme);
    reducedMotion = info.reducedMotion === true;
    best = await loadBest();
    const saved = await loadSave();
    const restored = saved ? deserialize(saved.data) : null;
    if (restored) {
      state = restored;
      restoredSave = true;
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
    if (!runtimePaused && mode === 'ready') startLoop();
    if (mode === 'over') render();
    if (!sessionActive && mode !== 'over') {
      sessionActive = true;
      game.session.start().catch(function ignore() {});
    }
  } catch (error) {
    showFatal(error);
  }
}

boot();
