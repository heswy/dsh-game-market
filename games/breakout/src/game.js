/**
 * Breakout game entry. Runs inside the sandboxed Runtime iframe and talks to
 * the platform only through the inlined `DSH_GAME_SDK` global (PRD §8.3).
 *
 * Responsibilities kept out of logic.js: DOM/canvas wiring, keyboard/mouse
 * input, the fixed-step loop, platform lifecycle, save/Continue and score
 * submission. Game rules live in logic.js and are unit-tested in Node.
 */

import { FIELD, LEVELS, SAVE_KEY, STEP_MS, createState, deserialize, launchBall, movePaddle, nudgePaddle, serialize, setPaused, step } from './logic.js';
import { createRenderer } from './render.js';

const game = DSH_GAME_SDK.createGameSDK();
const canvas = document.getElementById('board');
const renderer = createRenderer(canvas);

const overlayEl = document.getElementById('overlay');
const overlayCard = document.getElementById('overlay-card');
const overlayKicker = document.getElementById('overlay-kicker');
const overlayTitle = document.getElementById('overlay-title');
const overlayHint = document.getElementById('overlay-hint');
const overlayActions = document.getElementById('overlay-actions');
const primaryButton = document.getElementById('primary');
const secondaryButton = document.getElementById('secondary');
const toastEl = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');
const toastAction = document.getElementById('toast-action');
const saveStatusEl = document.getElementById('save-status');
const agentHintEl = document.getElementById('agent-hint');
const liveEl = document.getElementById('live');

const COPY = {
  zh: {
    loading: '正在载入',
    loadingHint: '正在连接游戏运行时，请稍候',
    startKicker: 'BREAKOUT · 街机弹球',
    startTitle: '打砖块',
    startHint: '鼠标移动挡板 · ← → / A D 操作\nSPACE / ENTER 发射 · P 暂停 · ESC 留给平台',
    start: '开始游戏',
    continueKicker: '已恢复上一局',
    continueTitle: '继续上一局',
    continueHint: '第 {level} 关 · 生命 {lives} · 得分 {score}',
    continue: '继续游戏',
    restart: '重新开始',
    pausedKicker: 'PAUSED',
    pausedTitle: '已暂停',
    pausedHint: '按 P 继续',
    pausedPlatform: '请在平台的暂停菜单中继续',
    resume: '继续',
    overKicker: 'GAME OVER',
    overTitle: '本局结束',
    wonKicker: 'VICTORY',
    wonTitle: '全部通关',
    finalScore: '本局得分',
    best: '最高分',
    newRecord: '新纪录',
    playAgain: '再来一局',
    saved: '已保存',
    saveFailed: '保存失败',
    saveReady: '等待保存',
    level: '关卡',
    levelClear: '清关',
    levelClearSub: '过关奖励 +{bonus}',
    lifeLost: '还剩 {lives} 条命',
    scoreFailed: '分数提交失败',
    sessionFailed: '会话结束失败',
    loadFailed: '存档读取失败',
    corruptSave: '存档不可用，已开始新游戏',
    fatalKicker: '无法开始',
    fatalTitle: '游戏暂时不可用',
    fatalHint: '请返回市场后重新进入',
    retry: '重试',
    agent: 'Agent 状态更新',
  },
  en: {
    loading: 'LOADING',
    loadingHint: 'Connecting to the game runtime',
    startKicker: 'BREAKOUT · ARCADE',
    startTitle: 'Breakout',
    startHint: 'Mouse moves the paddle · ← → / A D\nSPACE / ENTER launches · P pauses · ESC belongs to the platform',
    start: 'Start game',
    continueKicker: 'RUN RESTORED',
    continueTitle: 'Continue',
    continueHint: 'Level {level} · {lives} lives · {score} points',
    continue: 'Continue',
    restart: 'New run',
    pausedKicker: 'PAUSED',
    pausedTitle: 'Paused',
    pausedHint: 'Press P to resume',
    pausedPlatform: 'Resume from the platform pause menu',
    resume: 'Resume',
    overKicker: 'GAME OVER',
    overTitle: 'Run over',
    wonKicker: 'VICTORY',
    wonTitle: 'All cleared',
    finalScore: 'Score',
    best: 'Best',
    newRecord: 'New record',
    playAgain: 'Play again',
    saved: 'Saved',
    saveFailed: 'Save failed',
    saveReady: 'Not saved yet',
    level: 'LEVEL',
    levelClear: 'LEVEL CLEAR',
    levelClearSub: 'Bonus +{bonus}',
    lifeLost: '{lives} lives left',
    scoreFailed: 'Score submission failed',
    sessionFailed: 'Could not end the session',
    loadFailed: 'Save load failed',
    corruptSave: 'Save was unusable; started a new run',
    fatalKicker: 'UNABLE TO START',
    fatalTitle: 'Game unavailable',
    fatalHint: 'Return to the market and open it again',
    retry: 'Retry',
    agent: 'Agent status changed',
  },
};

let lang = 'zh';
let locale = 'zh-CN';
let theme = 'dark';
let reducedMotion = false;
let runtimeReady = false;

let state = createState({ seed: makeSeed() });
let best = 0;
let restoredSave = false;
let resultHandled = false;
let newRecord = false;
let sessionActive = false;
let sessionEnded = false;

let runtimePaused = false;
let localPaused = false;

let loopRunning = false;
let rafId = null;
let lastFrameTime = 0;
let accumulator = 0;

let keyLeft = false;
let keyRight = false;
let banner = null;

let overlay = { kind: null, primary: null, secondary: null };
let toastTimer = null;
let toastActionHandler = null;
let lastSaveErrorAt = 0;
let lastSaveErrorCode = '';

function makeSeed() {
  const value = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  return value || 1;
}

function text(key, vars) {
  const table = COPY[lang] || COPY.zh;
  let value = table[key] !== undefined ? table[key] : COPY.zh[key];
  if (value === undefined) value = key;
  if (vars) {
    for (const name of Object.keys(vars)) {
      value = value.replaceAll('{' + name + '}', String(vars[name]));
    }
  }
  return value;
}

function formatScore(value) {
  const safe = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
  return String(safe).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function levelName(levelNumber) {
  const index = Math.min(LEVELS.length - 1, Math.max(0, levelNumber - 1));
  const level = LEVELS[index];
  return lang === 'zh' ? level.nameZh : level.nameEn;
}

function errorCode(error) {
  return error && typeof error.code === 'string' ? ' (' + error.code + ')' : '';
}

function announce(message) {
  if (!liveEl) return;
  liveEl.textContent = message;
}

function isPaused() {
  return localPaused || runtimePaused;
}

function overlayVisible() {
  return overlay.kind !== null;
}

function showOverlay(config) {
  overlay.kind = config.kind || 'info';
  overlay.primary = typeof config.onPrimary === 'function' ? config.onPrimary : null;
  overlay.secondary = typeof config.onSecondary === 'function' ? config.onSecondary : null;
  overlayKicker.textContent = config.kicker || '';
  overlayTitle.textContent = config.title || '';
  overlayHint.textContent = config.hint || '';
  primaryButton.textContent = config.primaryLabel || text('resume');
  primaryButton.hidden = !config.primaryLabel;
  secondaryButton.hidden = !config.secondaryLabel;
  secondaryButton.textContent = config.secondaryLabel || text('restart');
  overlayActions.hidden = !config.primaryLabel && !config.secondaryLabel;
  overlayEl.hidden = false;
  announce(config.title + (config.hint ? '. ' + config.hint : ''));
  if (config.focus !== false) {
    if (config.primaryLabel) {
      try {
        primaryButton.focus({ preventScroll: true });
      } catch (_error) {
        primaryButton.focus();
      }
    } else {
      try {
        overlayCard.focus({ preventScroll: true });
      } catch (_error) {
        overlayCard.focus();
      }
    }
  }
}

function hideOverlay(focusBoard) {
  overlayEl.hidden = true;
  overlay.kind = null;
  overlay.primary = null;
  overlay.secondary = null;
  if (focusBoard) focusCanvas();
}

function focusCanvas() {
  try {
    if (typeof window.focus === 'function') window.focus();
  } catch (_error) {
    // focus is best-effort
  }
  try {
    canvas.focus({ preventScroll: true });
  } catch (_error) {
    // focus is best-effort
  }
}

function showLoadingOverlay() {
  showOverlay({
    kind: 'boot',
    kicker: 'BREAKOUT',
    title: text('loading'),
    hint: text('loadingHint'),
    focus: false,
  });
}

function showStartOverlay() {
  if (restoredSave) {
    showOverlay({
      kind: 'start',
      kicker: text('continueKicker'),
      title: text('continueTitle'),
      hint: text('continueHint', {
        level: state.level,
        lives: state.lives,
        score: formatScore(state.score),
      }),
      primaryLabel: text('continue'),
      onPrimary: continueRun,
      secondaryLabel: text('restart'),
      onSecondary: startNewRun,
      focus: true,
    });
    return;
  }
  showOverlay({
    kind: 'start',
    kicker: text('startKicker'),
    title: text('startTitle'),
    hint: text('startHint'),
    primaryLabel: text('start'),
    onPrimary: startNewRun,
    focus: true,
  });
}

function showPausedOverlay() {
  if (overlay.kind && overlay.kind !== 'paused') return;
  const actionable = !runtimePaused && localPaused;
  showOverlay({
    kind: 'paused',
    kicker: text('pausedKicker'),
    title: text('pausedTitle'),
    hint: actionable ? text('pausedHint') : text('pausedPlatform'),
    primaryLabel: actionable ? text('resume') : '',
    onPrimary: resumeLocal,
    focus: false,
  });
}

function showResultOverlay(kind, focus) {
  const won = kind === 'won';
  const bestShown = Math.max(best, state.score);
  const parts = [
    text('finalScore') + ' ' + formatScore(state.score),
    text('best') + ' ' + formatScore(bestShown),
  ];
  if (newRecord) parts.unshift(text('newRecord'));
  showOverlay({
    kind: 'result',
    kicker: won ? text('wonKicker') : text('overKicker'),
    title: won ? text('wonTitle') : text('overTitle'),
    hint: parts.join(' · '),
    primaryLabel: text('playAgain'),
    onPrimary: startNewRun,
    focus: focus !== false,
  });
}

function showFatal(error) {
  stopLoop();
  const code = errorCode(error);
  const message = error && error.message ? error.message : text('fatalHint');
  showOverlay({
    kind: 'fatal',
    kicker: text('fatalKicker'),
    title: text('fatalTitle'),
    hint: message + code,
    primaryLabel: text('retry'),
    onPrimary: function retryBoot() {
      try {
        location.reload();
      } catch (_error) {
        // the platform overlay remains the recovery path
      }
    },
    focus: true,
  });
  renderOnce();
}

function showToast(message, options) {
  const config = options || {};
  toastMessage.textContent = message;
  toastEl.dataset.tone = config.tone || 'info';
  toastActionHandler = typeof config.onAction === 'function' ? config.onAction : null;
  toastAction.hidden = !config.actionLabel;
  toastAction.textContent = config.actionLabel || '';
  toastEl.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  if (config.tone !== 'error') {
    toastTimer = setTimeout(function hideLater() {
      hideToast();
    }, config.duration || 2200);
  }
}

function hideToast() {
  toastEl.hidden = true;
  toastActionHandler = null;
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
}

function setSaveStatus(kind, message) {
  if (!saveStatusEl) return;
  saveStatusEl.dataset.state = kind;
  saveStatusEl.textContent = message;
}

function renderOptions() {
  return {
    theme,
    reducedMotion,
    best: Math.max(best, state.score),
    now: performance.now(),
    locale,
    lang,
    overlay: overlay.kind,
    banner,
  };
}

function renderOnce() {
  renderer.draw(state, renderOptions());
}

function applyRuntimeInfo(info) {
  if (!info) return;
  theme = info.theme === 'light' ? 'light' : 'dark';
  reducedMotion = info.reducedMotion === true;
  locale = typeof info.locale === 'string' && info.locale ? info.locale : 'zh-CN';
  lang = locale.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
  document.documentElement.dataset.theme = theme;
  document.documentElement.lang = locale;
  document.documentElement.classList.toggle('reduced', reducedMotion);
  document.documentElement.classList.toggle('reduced-motion', reducedMotion);
}

function syncRuntime() {
  if (!runtimeReady) return;
  const nextTheme = game.runtime.theme === 'light' ? 'light' : 'dark';
  if (nextTheme !== theme) {
    theme = nextTheme;
    document.documentElement.dataset.theme = theme;
  }
  const nextReduced = game.runtime.reducedMotion === true;
  if (nextReduced !== reducedMotion) {
    reducedMotion = nextReduced;
    document.documentElement.classList.toggle('reduced', reducedMotion);
    document.documentElement.classList.toggle('reduced-motion', reducedMotion);
  }
  const nextLocale = typeof game.runtime.locale === 'string' ? game.runtime.locale : locale;
  if (nextLocale && nextLocale !== locale) {
    locale = nextLocale;
    lang = locale.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
    document.documentElement.lang = locale;
  }
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

function frame(timestamp) {
  rafId = null;
  if (!loopRunning) return;
  const now = typeof timestamp === 'number' ? timestamp : performance.now();
  if (lastFrameTime === 0) lastFrameTime = now;
  const delta = Math.min(120, Math.max(0, now - lastFrameTime));
  lastFrameTime = now;

  if (!isPaused()) {
    if (state.status === 'playing' || state.status === 'level-clear') {
      accumulator += delta;
      let steps = 0;
      while (accumulator >= STEP_MS && steps < 10) {
        accumulator -= STEP_MS;
        steps += 1;
        const events = step(state, STEP_MS);
        handleEvents(events);
        if (state.status === 'over' || state.status === 'won') {
          accumulator = 0;
          break;
        }
      }
      if (steps >= 10) accumulator = 0;
    } else {
      accumulator = 0;
    }
    if (!overlayVisible() && (state.status === 'playing' || state.status === 'ready')) {
      const direction = (keyRight ? 1 : 0) - (keyLeft ? 1 : 0);
      if (direction !== 0) nudgePaddle(state, direction, Math.min(50, delta));
    }
  } else {
    accumulator = 0;
  }

  syncRuntime();
  renderer.update(delta, reducedMotion);
  renderer.draw(state, renderOptions());
  if (loopRunning) rafId = requestAnimationFrame(frame);
}

function handleEvents(events) {
  for (const event of events) {
    if (event.type === 'brick-hit') {
      if (event.brickType !== 'solid') {
        const count = event.destroyed ? 12 : 6;
        renderer.burst(event.x, event.y, event.brickType, count);
      } else {
        renderer.burst(event.x, event.y, 'solid', 4);
      }
    } else if (event.type === 'paddle-hit') {
      renderer.burst(event.x, event.y, 'normal', 4);
    } else if (event.type === 'life-lost') {
      renderer.flash();
      showToast(text('lifeLost', { lives: event.lives }), { tone: 'warn', duration: 1600 });
      saveState('life-lost');
    } else if (event.type === 'level-clear') {
      banner = {
        kicker: text('level'),
        title: text('levelClear'),
        subtitle: text('levelClearSub', { bonus: event.bonus }),
        startedAt: performance.now(),
        duration: 1400,
      };
      saveState('level-clear');
    } else if (event.type === 'level-advanced') {
      banner = {
        kicker: text('level'),
        title: levelName(event.level),
        subtitle: 'LEVEL ' + event.level + ' / ' + LEVELS.length,
        startedAt: performance.now(),
        duration: 1400,
      };
      saveState('level-advanced');
    } else if (event.type === 'game-over') {
      finishRun('over');
    } else if (event.type === 'won') {
      finishRun('won');
    }
  }
}

function finishRun(kind) {
  if (resultHandled) return;
  resultHandled = true;
  localPaused = false;
  const finalScore = state.score;
  newRecord = false;
  showResultOverlay(kind, true);
  submitScore(finalScore);
  endSession(finalScore);
}

function submitScore(score) {
  game.score.submit(score).then(function onScored(result) {
    if (result) {
      if (Number.isFinite(result.best)) best = Math.max(best, Math.floor(result.best));
      if (resultHandled && result.isBest === true) newRecord = true;
    }
    if (resultHandled && overlay.kind === 'result') {
      showResultOverlay(state.status === 'won' ? 'won' : 'over', false);
    }
  }).catch(function onScoreError(error) {
    showToast(text('scoreFailed') + errorCode(error), {
      tone: 'error',
      actionLabel: text('retry'),
      onAction: function retryScore() {
        hideToast();
        submitScore(score);
      },
    });
  });
}

function endSession(score) {
  if (sessionEnded) return;
  sessionEnded = true;
  sessionActive = false;
  game.session.end({ outcome: 'completed', score: score }).catch(function onEndError(error) {
    if (overlay.kind !== 'result') return;
    showToast(text('sessionFailed') + errorCode(error), {
      tone: 'error',
      actionLabel: text('retry'),
      onAction: function retryEnd() {
        hideToast();
        requestSessionEnd(score);
      },
    });
  });
}

function requestSessionEnd(score) {
  game.session.end({ outcome: 'completed', score: score }).catch(function onEndRetry(error) {
    if (overlay.kind !== 'result') return;
    showToast(text('sessionFailed') + errorCode(error), {
      tone: 'error',
      actionLabel: text('retry'),
      onAction: function retryEndAgain() {
        hideToast();
        requestSessionEnd(score);
      },
    });
  });
}

function ensureSession() {
  if (sessionActive) return;
  sessionActive = true;
  sessionEnded = false;
  game.session.start().catch(function ignore() {
    // The platform auto-starts a session on first play; a failure here is not fatal.
  });
}

function saveState(reason) {
  if (!runtimeReady || !state) return Promise.resolve(null);
  if (state.status === 'over' || state.status === 'won') return Promise.resolve(null);
  let payload;
  try {
    payload = serialize(state);
  } catch (_error) {
    return Promise.resolve(null);
  }
  return game.storage.save(SAVE_KEY, payload).then(function onSaved(result) {
    setSaveStatus('saved', text('saved'));
    if (reason === 'before-save' || reason === 'retry') announce(text('saved'));
    return result;
  }).catch(function onSaveError(error) {
    setSaveStatus('failed', text('saveFailed'));
    const code = errorCode(error);
    const now = Date.now();
    if (code !== lastSaveErrorCode || now - lastSaveErrorAt > 4000) {
      lastSaveErrorAt = now;
      lastSaveErrorCode = code;
      showToast(text('saveFailed') + code, {
        tone: 'error',
        actionLabel: text('retry'),
        onAction: function retrySave() {
          hideToast();
          saveState('retry');
        },
      });
    }
    return null;
  });
}

async function loadBest() {
  try {
    const result = await game.score.getBest();
    if (result && Number.isFinite(result.score)) {
      return Math.max(0, Math.min(10000000, Math.floor(result.score)));
    }
  } catch (_error) {
    // A missing score capability or Host hiccup must not block play.
  }
  return 0;
}

async function loadSavedState() {
  try {
    const saved = await game.storage.load(SAVE_KEY);
    if (!saved || saved.data === undefined || saved.data === null) {
      return { state: null, error: null, corrupt: false, empty: true };
    }
    const restored = deserialize(saved.data);
    if (!restored) return { state: null, error: null, corrupt: true, empty: false };
    return { state: restored, error: null, corrupt: false, empty: false };
  } catch (error) {
    return { state: null, error, corrupt: false, empty: false };
  }
}

async function retryLoadSave() {
  hideToast();
  const loaded = await loadSavedState();
  if (loaded.state) {
    state = loaded.state;
    restoredSave = true;
    showStartOverlay();
    startLoop();
    return;
  }
  if (loaded.corrupt) {
    showToast(text('corruptSave'), { tone: 'error', duration: 3200 });
    return;
  }
  if (loaded.error) {
    showToast(text('loadFailed') + errorCode(loaded.error), {
      tone: 'error',
      actionLabel: text('retry'),
      onAction: retryLoadSave,
    });
  }
}

function launchFromServe() {
  if (isPaused() || overlayVisible()) return;
  if (state.status !== 'ready') return;
  const launched = launchBall(state);
  if (!launched) return;
  ensureSession();
  accumulator = 0;
  if (!loopRunning) startLoop();
  focusCanvas();
}

function startNewRun() {
  if (runtimePaused) return;
  state = createState({ seed: makeSeed() });
  restoredSave = false;
  resultHandled = false;
  newRecord = false;
  localPaused = false;
  banner = null;
  hideToast();
  hideOverlay(true);
  ensureSession();
  saveState('new-run');
  accumulator = 0;
  startLoop();
  focusCanvas();
  announce(text('startHint'));
}

function continueRun() {
  if (runtimePaused) return;
  hideToast();
  hideOverlay(true);
  if (state.status === 'paused') setPaused(state, false);
  if (state.status === 'playing' && !state.ball.launched) state.status = 'ready';
  ensureSession();
  saveState('continue');
  accumulator = 0;
  startLoop();
  focusCanvas();
  if (state.status === 'ready') announce(text('startHint'));
}

function resumeLocal() {
  if (runtimePaused) return;
  localPaused = false;
  if (state.status === 'paused') setPaused(state, false);
  hideOverlay(true);
  saveState('resume');
  accumulator = 0;
  startLoop();
  focusCanvas();
}

function togglePause() {
  if (overlay.kind === 'fatal' || overlay.kind === 'boot') return;
  if (runtimePaused) return;
  if (!localPaused) {
    if (state.status !== 'playing' && state.status !== 'ready' && state.status !== 'level-clear') return;
    localPaused = true;
    if (state.status === 'playing') setPaused(state, true);
    stopLoop();
    saveState('pause');
    showPausedOverlay();
    renderOnce();
    announce(text('pausedTitle'));
    return;
  }
  resumeLocal();
}

function onRuntimePause() {
  if (overlay.kind === 'fatal') return;
  runtimePaused = true;
  stopLoop();
  if (state.status === 'playing') setPaused(state, true);
  if (!overlay.kind || overlay.kind === 'paused') showPausedOverlay();
  if (state.status !== 'over' && state.status !== 'won') saveState('pause');
  renderOnce();
}

function onRuntimeResume() {
  runtimePaused = false;
  if (localPaused) {
    saveState('resume');
    showPausedOverlay();
    renderOnce();
    return;
  }
  if (overlay.kind === 'paused') hideOverlay(false);
  if (state.status === 'paused') setPaused(state, false);
  if (overlay.kind === 'start' || overlay.kind === 'result') {
    if (!primaryButton.hidden) {
      try {
        primaryButton.focus({ preventScroll: true });
      } catch (_error) {
        // focus is best-effort
      }
    }
  } else if (!overlay.kind) {
    focusCanvas();
  }
  if (state.status !== 'over' && state.status !== 'won') saveState('resume');
  accumulator = 0;
  startLoop();
}

function onAgentStatus(snapshot) {
  if (!snapshot || !agentHintEl) return;
  if (snapshot.state === 'waiting-user' || snapshot.state === 'completed' || snapshot.state === 'error') {
    agentHintEl.textContent = snapshot.label || text('agent');
    agentHintEl.dataset.state = snapshot.state;
    agentHintEl.classList.add('visible');
  } else {
    agentHintEl.textContent = '';
    agentHintEl.dataset.state = snapshot.state || 'idle';
    agentHintEl.classList.remove('visible');
  }
}

function handleKeyDown(event) {
  if (!event || typeof event.key !== 'string') return;
  const key = event.key;
  if (key === 'Escape') return;
  const lower = key.toLowerCase();
  const isActivation = key === 'Enter' || key === ' ' || key === 'Spacebar';
  const isLeft = key === 'ArrowLeft' || lower === 'a';
  const isRight = key === 'ArrowRight' || lower === 'd';
  const isPause = lower === 'p';
  const onButton = event.target && event.target.tagName === 'BUTTON';

  if (isActivation) {
    if (onButton) return;
    if (overlayVisible()) {
      if (overlay.primary) {
        event.preventDefault();
        overlay.primary();
      }
      return;
    }
    if (state.status === 'ready') {
      event.preventDefault();
      launchFromServe();
      return;
    }
    if (state.status === 'over' || state.status === 'won') {
      event.preventDefault();
      startNewRun();
      return;
    }
    if (state.status === 'playing') event.preventDefault();
    return;
  }

  if (isPause) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (overlay.kind === 'fatal' || overlay.kind === 'boot' || overlay.kind === 'start' || overlay.kind === 'result') {
      return;
    }
    event.preventDefault();
    togglePause();
    return;
  }

  if (isLeft || isRight) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isPaused() || overlayVisible()) return;
    if (state.status !== 'playing' && state.status !== 'ready') return;
    event.preventDefault();
    if (isLeft) keyLeft = true;
    else keyRight = true;
  }
}

function handleKeyUp(event) {
  if (!event || typeof event.key !== 'string') return;
  const key = event.key;
  const lower = key.toLowerCase();
  if (key === 'ArrowLeft' || lower === 'a') keyLeft = false;
  if (key === 'ArrowRight' || lower === 'd') keyRight = false;
}

function clearKeys() {
  keyLeft = false;
  keyRight = false;
}

function contentBox() {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / 960, rect.height / 540);
  const width = 960 * scale;
  const height = 540 * scale;
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  };
}

function handlePointerMove(event) {
  if (!event || isPaused() || overlayVisible()) return;
  if (state.status !== 'playing' && state.status !== 'ready') return;
  const box = contentBox();
  if (!(box.width > 0)) return;
  const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  movePaddle(state, FIELD.left + ratio * (FIELD.right - FIELD.left));
}

function handlePointerDown(event) {
  if (!event || isPaused() || overlayVisible()) return;
  focusCanvas();
  if (state.status === 'ready') launchFromServe();
}

function onVisibilityChange() {
  if (document.hidden) {
    stopLoop();
    saveState('hidden');
    return;
  }
  if (!isPaused()) startLoop();
  else renderOnce();
}

function boot() {
  showLoadingOverlay();
  setSaveStatus('idle', text('saveReady'));
  renderOnce();

  game.lifecycle.on('pause', onRuntimePause);
  game.lifecycle.on('resume', onRuntimeResume);
  game.lifecycle.on('hidden', function onHidden() {
    stopLoop();
    saveState('hidden');
  });
  game.lifecycle.on('visible', function onVisible() {
    if (!isPaused()) startLoop();
  });
  game.lifecycle.on('before-save', function onBeforeSave() {
    return saveState('before-save');
  });
  game.agent.on('status', onAgentStatus);

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', clearKeys);
  window.addEventListener('pointermove', handlePointerMove);
  canvas.addEventListener('pointerdown', handlePointerDown);
  document.addEventListener('visibilitychange', onVisibilityChange);
  primaryButton.addEventListener('click', function onPrimaryClick() {
    if (typeof overlay.primary === 'function') overlay.primary();
  });
  secondaryButton.addEventListener('click', function onSecondaryClick() {
    if (typeof overlay.secondary === 'function') overlay.secondary();
  });
  toastAction.addEventListener('click', function onToastAction() {
    if (typeof toastActionHandler === 'function') toastActionHandler();
  });

  startLoop();

  game.ready().then(async function onReady(info) {
    runtimeReady = true;
    applyRuntimeInfo(info);
    best = await loadBest();
    const loaded = await loadSavedState();
    if (loaded.error) {
      showToast(text('loadFailed') + errorCode(loaded.error), {
        tone: 'error',
        actionLabel: text('retry'),
        onAction: retryLoadSave,
      });
    } else if (loaded.corrupt) {
      showToast(text('corruptSave'), { tone: 'error', duration: 3200 });
    }
    if (loaded.state) {
      state = loaded.state;
      restoredSave = true;
    }
    ensureSession();
    setSaveStatus('idle', text('saveReady'));
    showStartOverlay();
    renderOnce();
    if (!runtimePaused) startLoop();
  }).catch(function onBootError(error) {
    runtimeReady = false;
    showFatal(error);
  });
}

// Small read-only diagnostic hook for the isolated verification harness.
if (typeof window !== 'undefined') {
  window.__dshBreakoutDebug = function __dshBreakoutDebug() {
    return {
      status: state && state.status,
      level: state && state.level,
      lives: state && state.lives,
      score: state && state.score,
      best: best,
      paddleX: state && state.paddle.x,
      ball: state && { x: state.ball.x, y: state.ball.y, launched: state.ball.launched },
      remaining: state && state.bricks.filter(function alive(brick) { return brick.type !== 'solid'; }).length,
      loopRunning: loopRunning,
      runtimePaused: runtimePaused,
      localPaused: localPaused,
      overlay: overlay.kind,
      sessionActive: sessionActive,
      restoredSave: restoredSave,
      saveStatus: saveStatusEl ? saveStatusEl.dataset.state : null,
    };
  };
}

boot();
