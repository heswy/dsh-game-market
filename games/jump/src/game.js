/**
 * Jump — renderer, input and platform integration.
 *
 * Everything that can be deterministic lives in `logic.js`. This file owns the
 * canvas, the HUD/overlays and the SDK handshake:
 *   ready → (Continue) → session.start → play → score.submit + session.end
 * Pause/hidden/leave stop the rAF loop, save `current`, and never count the
 * paused time as game time.
 */

import { PLATFORM_HEIGHT, PLAYER_HALF_HEIGHT, PLAYER_HALF_WIDTH, STEP_SECONDS, VIEW_HEIGHT, VIEW_WIDTH, clamp, createGame, deserialize, nextRandom, serialize, startRun, stepGame } from './logic.js';

const STEP_MS = STEP_SECONDS * 1000;
const DPR_CAP = 2;
const SAVE_KEY = 'current';

const game = DSH_GAME_SDK.createGameSDK();

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const els = {
  canvas,
  brandLabel: document.getElementById('brand-label'),
  scoreLabel: document.getElementById('score-label'),
  score: document.getElementById('score'),
  bestLabel: document.getElementById('best-label'),
  best: document.getElementById('best'),
  newBest: document.getElementById('new-best'),
  milestone: document.getElementById('milestone'),
  overlay: document.getElementById('overlay'),
  card: document.getElementById('overlay-card'),
  kicker: document.getElementById('overlay-kicker'),
  title: document.getElementById('overlay-title'),
  hint: document.getElementById('overlay-hint'),
  summary: document.getElementById('overlay-summary'),
  finalScore: document.getElementById('final-score'),
  finalBest: document.getElementById('final-best'),
  finalScoreLabel: document.getElementById('final-score-label'),
  finalBestLabel: document.getElementById('final-best-label'),
  finalRecord: document.getElementById('final-record'),
  keys: document.getElementById('overlay-keys'),
  keyMove: document.getElementById('key-move'),
  keyStart: document.getElementById('key-start'),
  keyPause: document.getElementById('key-pause'),
  keySpace: document.getElementById('key-space'),
  keyGroupPause: document.getElementById('key-group-pause'),
  keyPauseDivider: document.getElementById('key-pause-divider'),
  primary: document.getElementById('primary'),
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toast-message'),
  toastCode: document.getElementById('toast-code'),
  toastRetry: document.getElementById('toast-retry'),
  agentHint: document.getElementById('agent-hint'),
  saveIndicator: document.getElementById('save-indicator'),
  footerHint: document.getElementById('footer-hint'),
  a11y: document.getElementById('a11y-status'),
};

const TEXT = {
  zh: {
    brand: '跳跃',
    score: '得分',
    best: '最高',
    thisRun: '本局',
    height: '高度',
    canvasLabel: 'Jump 跳跃游戏：自动弹跳，左右移动踩上平台',
    startKicker: '跳跃 / JUMP',
    startTitle: '踩上云端',
    startHint: '自动弹跳，左右移动。踩空一次，就真的掉下去了。',
    bestHint: function (best) {
      return '个人最高 ' + best + ' m。';
    },
    space: '空格',
    continueKicker: '已恢复上一局',
    continueTitle: '继续向上',
    continueHint: function (score) {
      return '高度 ' + score + ' m · 平台、相机与随机序列都已恢复。';
    },
    pauseKicker: '已暂停',
    pauseTitle: '喘口气',
    pauseHint: '按 P 继续。',
    runtimePauseTitle: '在平台菜单里继续',
    runtimePauseHint: '游戏已暂停并保存，确认恢复后会从当前高度继续。',
    overKicker: '本局结束',
    overTitle: function (score) {
      return '本局 ' + score + ' m';
    },
    overHint: '再来一次，冲过自己的纪录。',
    record: '新纪录！',
    startButton: '开始跳跃',
    continueButton: '继续跳跃',
    resumeButton: '继续',
    restartButton: '再来一局',
    reloadButton: '重新加载',
    errorKicker: '无法开始',
    errorTitle: '游戏暂时不可用',
    errorHint: function (code) {
      return '请返回市场后重试' + (code ? ' · ' + code : '') + '。';
    },
    saveFailed: '存档失败，进度仍在本局中',
    scoreFailed: '分数提交失败',
    sessionFailed: '会话结束失败',
    saveCorrupt: '存档无法读取，已开始新局',
    loadFailed: '存档读取失败，已开始新局',
    retry: '重试',
    keyMove: '移动',
    keyStart: '开始',
    keyRestart: '重来',
    keyPause: '暂停',
    footerHint: '← → / A D 移动 · P 暂停',
    saved: '已保存',
    milestone: function (metres) {
      return metres + ' m';
    },
    agentWaiting: 'Agent 需要你',
    agentCompleted: '任务完成',
    a11yStarted: '游戏开始，自动弹跳',
    a11yPaused: '游戏已暂停',
    a11yResumed: '继续游戏',
    a11yOver: function (score) {
      return '本局结束，得分 ' + score + ' 米';
    },
    a11yBest: '新的个人最高分',
  },
  en: {
    brand: 'Jump',
    score: 'Score',
    best: 'Best',
    thisRun: 'Run',
    height: 'Height',
    canvasLabel: 'Jump: an auto-bounce vertical platform game. Move left and right to land on platforms.',
    startKicker: 'Jump / Arcade',
    startTitle: 'Head for the clouds',
    startHint: 'You bounce automatically. Move left and right — miss once and the run is over.',
    bestHint: function (best) {
      return 'Personal best ' + best + ' m.';
    },
    space: 'Space',
    continueKicker: 'Run restored',
    continueTitle: 'Keep climbing',
    continueHint: function (score) {
      return 'At ' + score + ' m · platforms, camera and random sequence restored.';
    },
    pauseKicker: 'Paused',
    pauseTitle: 'Catch your breath',
    pauseHint: 'Press P to continue.',
    runtimePauseTitle: 'Continue from the platform menu',
    runtimePauseHint: 'The game is paused and saved. Confirming resume continues from this height.',
    overKicker: 'Run over',
    overTitle: function (score) {
      return 'You reached ' + score + ' m';
    },
    overHint: 'One more run — beat your own record.',
    record: 'New best!',
    startButton: 'Start jumping',
    continueButton: 'Keep jumping',
    resumeButton: 'Resume',
    restartButton: 'Play again',
    reloadButton: 'Reload',
    errorKicker: 'Cannot start',
    errorTitle: 'Game unavailable',
    errorHint: function (code) {
      return 'Return to the market and try again' + (code ? ' · ' + code : '') + '.';
    },
    saveFailed: 'Save failed — the current run is still in memory',
    scoreFailed: 'Score submit failed',
    sessionFailed: 'Session end failed',
    saveCorrupt: 'Save could not be read — a new run was started',
    loadFailed: 'Save could not be loaded — a new run was started',
    retry: 'Retry',
    keyMove: 'move',
    keyStart: 'start',
    keyRestart: 'again',
    keyPause: 'pause',
    footerHint: '← → / A D move · P pause',
    saved: 'Saved',
    milestone: function (metres) {
      return metres + ' m';
    },
    agentWaiting: 'Agent needs you',
    agentCompleted: 'Task complete',
    a11yStarted: 'Game started. You bounce automatically.',
    a11yPaused: 'Game paused',
    a11yResumed: 'Game resumed',
    a11yOver: function (score) {
      return 'Run over. Score ' + score + ' metres.';
    },
    a11yBest: 'New personal best',
  },
};

const SKY_PALETTES = {
  dark: [
    { at: 0, top: '#101a3f', mid: '#1c2b59', bottom: '#46356f' },
    { at: 1500, top: '#0b1434', mid: '#14234e', bottom: '#29396d' },
    { at: 3600, top: '#070c24', mid: '#0e1838', bottom: '#241f55' },
    { at: 7000, top: '#04060f', mid: '#080f26', bottom: '#1b163d' },
    { at: 12000, top: '#020309', mid: '#060a1a', bottom: '#130f2c' },
  ],
  light: [
    { at: 0, top: '#f9f0df', mid: '#ffead0', bottom: '#ffd3b4' },
    { at: 1500, top: '#f2f5ff', mid: '#dcecff', bottom: '#c2e3ff' },
    { at: 3600, top: '#eefaff', mid: '#d6f6ff', bottom: '#bee8f6' },
    { at: 7000, top: '#fdf7ff', mid: '#efe0ff', bottom: '#d8c7ff' },
    { at: 12000, top: '#faf7ff', mid: '#e8e1ff', bottom: '#cfc3ff' },
  ],
};

const PLATFORM_STYLES = {
  dark: {
    normal: ['#4ee7c9', '#118ab2'],
    moving: ['#c4b5fd', '#7c3aed'],
    fragile: ['#fcd34d', '#b45309'],
    spring: ['#d9f99d', '#4d7c0f'],
  },
  light: {
    normal: ['#2dd4bf', '#0e7490'],
    moving: ['#8b5cf6', '#6d28d9'],
    fragile: ['#f59e0b', '#b45309'],
    spring: ['#84cc16', '#3f6212'],
  },
};

const DUST_COLORS = {
  dark: { normal: '#8df5e5', moving: '#c4b5fd', fragile: '#fcd34d', spring: '#d9f99d' },
  light: { normal: '#0e7490', moving: '#6d28d9', fragile: '#b45309', spring: '#3f6212' },
};

let locale = 'zh';
let text = TEXT.zh;
let numberFormatter = new Intl.NumberFormat('zh-CN');
let state = createGame({ seed: 1 });
let mode = 'boot';
let runtimePaused = false;
let runtimeReducedMotion = false;
let resumeRequested = false;
let restoredSave = false;
let theme = 'dark';
let reducedMotion = false;
let best = 0;
let bestAtRunStart = 0;
let bestA11yAnnounced = false;
let sessionActive = false;
let pendingSessionEnd = null;
let finishedRun = false;
let loopRunning = false;
let rafId = null;
let lastFrameTime = 0;
let accumulator = 0;
let visualTime = 0;
let input = { left: false, right: false };
let overlayAction = null;
let toastRetryAction = null;
let toastTimer = null;
let activeToastKind = 'general';
let saveIndicatorTimer = null;
let milestoneTimer = null;
let lastMilestone = 0;
let particles = [];
let starField = [];
let cloudField = [];
let canvasDpr = 0;
let visualTilt = 0;
let landSquash = 0;
let shake = 0;

const prefersReducedMotion =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

// ---------------------------------------------------------------- helpers

function formatNumber(value) {
  const safe = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return numberFormatter.format(safe);
}

function errorCode(error) {
  if (!error) return '';
  if (typeof error.code === 'string' && error.code) return error.code;
  if (typeof error.message === 'string' && error.message) return error.message.slice(0, 80);
  return '';
}

function makeSeed() {
  const value = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  return value || 1;
}

function a11y(message) {
  if (!els.a11y) return;
  els.a11y.textContent = '';
  window.setTimeout(function announce() {
    els.a11y.textContent = message;
  }, 20);
}

function mixColor(from, to, ratio) {
  const parse = function parse(value) {
    return [
      parseInt(value.slice(1, 3), 16),
      parseInt(value.slice(3, 5), 16),
      parseInt(value.slice(5, 7), 16),
    ];
  };
  const a = parse(from);
  const b = parse(to);
  const t = clamp(ratio, 0, 1);
  const channel = function channel(index) {
    return Math.round(a[index] + (b[index] - a[index]) * t);
  };
  return 'rgb(' + channel(0) + ', ' + channel(1) + ', ' + channel(2) + ')';
}

function roundRectPath(target, x, y, width, height, radius) {
  const r = Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2);
  target.beginPath();
  target.moveTo(x + r, y);
  target.arcTo(x + width, y, x + width, y + height, r);
  target.arcTo(x + width, y + height, x, y + height, r);
  target.arcTo(x, y + height, x, y, r);
  target.arcTo(x, y, x + width, y, r);
  target.closePath();
}

// ---------------------------------------------------------------- text / theme

function applyLocale(nextLocale) {
  const normalized = String(nextLocale || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  locale = normalized;
  text = TEXT[locale];
  numberFormatter = new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US');
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  els.brandLabel.textContent = text.brand;
  els.scoreLabel.textContent = text.score;
  els.bestLabel.textContent = text.best;
  els.finalScoreLabel.textContent = text.thisRun;
  els.finalBestLabel.textContent = text.best;
  els.saveIndicator.textContent = text.saved;
  els.keyMove.textContent = text.keyMove;
  els.keyStart.textContent = text.keyStart;
  els.keyPause.textContent = text.keyPause;
  els.keySpace.textContent = text.space;
  els.footerHint.textContent = text.footerHint;
  els.toastRetry.textContent = text.retry;
  canvas.setAttribute('aria-label', text.canvasLabel);
  updateScores();
}

function applyTheme(nextTheme) {
  const resolved = nextTheme === 'light' ? 'light' : 'dark';
  if (resolved === theme) return;
  theme = resolved;
  document.documentElement.dataset.theme = resolved;
  render();
}

function applyReducedMotion() {
  const effective = runtimeReducedMotion || (prefersReducedMotion ? prefersReducedMotion.matches : false);
  if (effective === reducedMotion) {
    document.documentElement.dataset.reducedMotion = effective ? 'true' : 'false';
    return;
  }
  reducedMotion = effective;
  document.documentElement.dataset.reducedMotion = reducedMotion ? 'true' : 'false';
}

function updateLiveRuntime() {
  if (!game.runtime || game.runtime.ready !== true) return;
  const nextTheme = game.runtime.theme === 'light' ? 'light' : 'dark';
  if (nextTheme !== theme) {
    theme = nextTheme;
    document.documentElement.dataset.theme = nextTheme;
  }
  const nextReduced = game.runtime.reducedMotion === true;
  if (nextReduced !== runtimeReducedMotion) {
    runtimeReducedMotion = nextReduced;
    applyReducedMotion();
  }
}

// ---------------------------------------------------------------- HUD / overlays

function updateScores() {
  els.score.textContent = formatNumber(state.score);
  const liveBest = Math.max(best, state.score);
  els.best.textContent = formatNumber(liveBest);
  const isRecord = state.score > bestAtRunStart && state.score > 0;
  els.newBest.hidden = !isRecord;
  if (isRecord && !bestA11yAnnounced && mode === 'playing') {
    bestA11yAnnounced = true;
    a11y(text.a11yBest);
  }
}

function setOverlayStats(stats) {
  els.summary.hidden = !stats;
  if (!stats) return;
  els.finalScore.textContent = formatNumber(stats.score);
  els.finalBest.textContent = formatNumber(stats.best);
  els.finalScoreLabel.textContent = stats.scoreLabel || text.thisRun;
  els.finalBestLabel.textContent = text.best;
  els.finalRecord.hidden = !stats.record;
  els.finalRecord.textContent = text.record;
}

function showOverlay(config) {
  els.kicker.textContent = config.kicker;
  els.title.textContent = config.title;
  els.hint.textContent = config.hint;
  setOverlayStats(config.stats || null);
  els.keys.hidden = !config.keys;
  if (config.keys) {
    els.keyMove.textContent = text.keyMove;
    els.keyStart.textContent = config.startKey || text.keyStart;
    els.keyPause.textContent = text.keyPause;
    const showPause = config.pauseKey !== false;
    els.keyGroupPause.hidden = !showPause;
    els.keyPauseDivider.hidden = !showPause;
  }
  els.primary.hidden = !config.primary;
  if (config.primary) els.primary.textContent = config.primary;
  overlayAction = typeof config.action === 'function' ? config.action : null;
  els.overlay.hidden = false;
  const target = config.primary ? els.primary : els.card;
  window.requestAnimationFrame(function focusOverlay() {
    if (els.overlay.hidden) return;
    try {
      target.focus({ preventScroll: true });
    } catch (_error) {
      try {
        target.focus();
      } catch (_ignored) {
        // focus is best effort inside the sandbox
      }
    }
  });
}

function hideOverlay() {
  els.overlay.hidden = true;
  overlayAction = null;
}

function showStartOverlay() {
  const hint = best > 0 ? text.startHint + '\n' + text.bestHint(formatNumber(best)) : text.startHint;
  showOverlay({
    kicker: text.startKicker,
    title: text.startTitle,
    hint: hint,
    primary: text.startButton,
    action: startFromReady,
    keys: true,
  });
}

function showContinueOverlay() {
  showOverlay({
    kicker: text.continueKicker,
    title: text.continueTitle,
    hint: text.continueHint(formatNumber(state.score)),
    primary: text.continueButton,
    action: startFromReady,
    stats: { score: state.score, best: Math.max(best, state.score), record: false, scoreLabel: text.height },
    keys: true,
  });
  els.keyStart.textContent = text.keyStart;
}

function showPausedOverlay() {
  showOverlay({
    kicker: text.pauseKicker,
    title: text.pauseTitle,
    hint: text.pauseHint,
    primary: text.resumeButton,
    action: togglePause,
    keys: false,
  });
}

function showRuntimePauseOverlay() {
  showOverlay({
    kicker: text.pauseKicker,
    title: text.runtimePauseTitle,
    hint: text.runtimePauseHint,
    keys: false,
  });
}

function showGameOverOverlay() {
  const record = state.score > bestAtRunStart && state.score > 0;
  showOverlay({
    kicker: text.overKicker,
    title: text.overTitle(formatNumber(state.score)),
    hint: text.overHint,
    primary: text.restartButton,
    action: restart,
    stats: { score: state.score, best: Math.max(best, state.score), record },
    keys: true,
    startKey: text.keyRestart,
    pauseKey: false,
  });
}

function showFatal(error) {
  if (mode === 'error') return;
  mode = 'error';
  stopLoop();
  clearInput();
  const code = errorCode(error);
  showOverlay({
    kicker: text.errorKicker,
    title: text.errorTitle,
    hint: text.errorHint(code),
    primary: text.reloadButton,
    action: function reloadGame() {
      try {
        window.location.reload();
      } catch (_error) {
        // loading a new document is best effort
      }
    },
    keys: false,
  });
  render();
}

// ---------------------------------------------------------------- toast

function hideToast() {
  els.toast.hidden = true;
  toastRetryAction = null;
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
}

function showToast(message, options) {
  const config = options || {};
  const code = config.code || '';
  if (!els.toast.hidden && els.toastMessage.textContent === message && els.toastCode.textContent === code) return;
  if (toastTimer) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
  activeToastKind = config.kind || 'general';
  els.toastMessage.textContent = message;
  els.toastCode.textContent = code;
  els.toastCode.hidden = !code;
  els.toastRetry.hidden = typeof config.retry !== 'function';
  els.toastRetry.textContent = text.retry;
  toastRetryAction = typeof config.retry === 'function' ? config.retry : null;
  els.toast.hidden = false;
  if (!config.sticky) {
    toastTimer = window.setTimeout(hideToast, 6500);
  }
}

function flashSaved() {
  els.saveIndicator.classList.add('visible');
  if (saveIndicatorTimer) window.clearTimeout(saveIndicatorTimer);
  saveIndicatorTimer = window.setTimeout(function hideSaved() {
    els.saveIndicator.classList.remove('visible');
  }, 1600);
}

// ---------------------------------------------------------------- canvas

function dprFor() {
  return Math.max(1, Math.min(DPR_CAP, window.devicePixelRatio || 1));
}

function setupCanvas() {
  canvasDpr = dprFor();
  canvas.width = Math.round(VIEW_WIDTH * canvasDpr);
  canvas.height = Math.round(VIEW_HEIGHT * canvasDpr);
  ctx.setTransform(canvasDpr, 0, 0, canvasDpr, 0, 0);
}

function buildBackdrop() {
  let rng = 0x9e3779b9;
  const stars = [];
  for (let index = 0; index < 120; index += 1) {
    const x = nextRandom(rng);
    rng = x.rngState;
    const offset = nextRandom(rng);
    rng = offset.rngState;
    const size = nextRandom(rng);
    rng = size.rngState;
    const depth = nextRandom(rng);
    rng = depth.rngState;
    stars.push({
      x: x.value * VIEW_WIDTH,
      offset: offset.value * 1400,
      size: 0.55 + size.value * 1.7,
      depth: 0.035 + depth.value * 0.12,
      phase: x.value * Math.PI * 2,
      speed: 0.35 + size.value * 0.65,
      bright: 0.5 + depth.value * 0.5,
    });
  }
  starField = stars;

  const clouds = [];
  for (let index = 0; index < 10; index += 1) {
    const x = nextRandom(rng);
    rng = x.rngState;
    const scale = nextRandom(rng);
    rng = scale.rngState;
    clouds.push({ x: x.value, scale: 0.7 + scale.value * 0.8, index });
  }
  cloudField = clouds;
}

function worldToScreenY(worldY) {
  return VIEW_HEIGHT - (worldY - state.camera.y);
}

// ---------------------------------------------------------------- backdrop rendering

function skyColorsFor(cameraY) {
  const palette = SKY_PALETTES[theme] || SKY_PALETTES.dark;
  let index = 0;
  while (index < palette.length - 2 && cameraY >= palette[index + 1].at) index += 1;
  const a = palette[index];
  const b = palette[Math.min(index + 1, palette.length - 1)];
  const span = b.at - a.at || 1;
  const t = clamp((cameraY - a.at) / span, 0, 1);
  return {
    top: mixColor(a.top, b.top, t),
    mid: mixColor(a.mid, b.mid, t),
    bottom: mixColor(a.bottom, b.bottom, t),
  };
}

function drawSky() {
  const colors = skyColorsFor(state.camera.y);
  const gradient = ctx.createLinearGradient(0, 0, 0, VIEW_HEIGHT);
  gradient.addColorStop(0, colors.top);
  gradient.addColorStop(0.55, colors.mid);
  gradient.addColorStop(1, colors.bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

  if (theme === 'dark') {
    const glow = ctx.createLinearGradient(0, VIEW_HEIGHT * 0.55, 0, VIEW_HEIGHT);
    glow.addColorStop(0, 'rgba(124, 247, 212, 0)');
    glow.addColorStop(1, 'rgba(124, 247, 212, 0.045)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, VIEW_HEIGHT * 0.55, VIEW_WIDTH, VIEW_HEIGHT * 0.45);
  } else {
    const glow = ctx.createLinearGradient(0, VIEW_HEIGHT * 0.62, 0, VIEW_HEIGHT);
    glow.addColorStop(0, 'rgba(255, 255, 255, 0)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0.25)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, VIEW_HEIGHT * 0.62, VIEW_WIDTH, VIEW_HEIGHT * 0.38);
  }
}

function drawStars() {
  ctx.save();
  for (let index = 0; index < starField.length; index += 1) {
    const star = starField[index];
    const span = VIEW_HEIGHT + 280;
    let y = (star.offset - state.camera.y * star.depth) % span;
    if (y < 0) y += span;
    y -= 140;
    const twinkle = reducedMotion
      ? 0.72
      : 0.5 + 0.34 * Math.sin(visualTime * 0.001 * star.speed + star.phase);
    ctx.globalAlpha = twinkle * star.bright * (theme === 'dark' ? 0.85 : 0.3);
    ctx.fillStyle = theme === 'dark' ? '#e4f2ff' : '#64748b';
    ctx.beginPath();
    ctx.arc(star.x, y, star.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawPlanet() {
  const light = theme === 'light';
  const cy = 300 + Math.sin(state.camera.y / 1400) * 24;
  const cx = light ? 398 : 410;
  const radius = light ? 86 : 96;
  ctx.save();
  ctx.globalAlpha = light ? 0.5 : 0.62;

  const halo = ctx.createRadialGradient(cx, cy, radius * 0.75, cx, cy, radius * 2.3);
  halo.addColorStop(0, theme === 'dark' ? 'rgba(124, 247, 212, 0.16)' : 'rgba(245, 158, 11, 0.16)');
  halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 2.3, 0, Math.PI * 2);
  ctx.fill();

  const body = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
  if (theme === 'dark') {
    body.addColorStop(0, '#24436f');
    body.addColorStop(0.55, '#14294d');
    body.addColorStop(1, '#0a1634');
  } else {
    body.addColorStop(0, '#ffe1a8');
    body.addColorStop(0.6, '#f7c27a');
    body.addColorStop(1, '#e9a45c');
  }
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = theme === 'dark' ? 'rgba(147, 197, 253, 0.22)' : 'rgba(180, 83, 9, 0.22)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.34);
  ctx.scale(1, 0.3);
  ctx.strokeStyle = theme === 'dark' ? 'rgba(196, 181, 253, 0.34)' : 'rgba(180, 83, 9, 0.28)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.54, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.45)';
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.66, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // A soft highlight crescent makes the sphere feel lit.
  const highlight = ctx.createRadialGradient(cx - radius * 0.35, cy - radius * 0.4, 2, cx - radius * 0.2, cy - radius * 0.25, radius * 1.2);
  highlight.addColorStop(0, 'rgba(255, 255, 255, 0.28)');
  highlight.addColorStop(0.55, 'rgba(255, 255, 255, 0.04)');
  highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = highlight;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCloud(x, y, scale, index) {
  const width = 108 * scale;
  const height = 34 * scale;
  const color = theme === 'dark' ? 'rgba(129, 174, 255, 0.055)' : 'rgba(255, 255, 255, 0.52)';
  const gradient = ctx.createRadialGradient(x, y, 4, x, y, width);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(x, y, width, height, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + width * 0.42, y + height * 0.1, width * 0.52, height * 0.7, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x - width * 0.48, y + height * 0.14, width * 0.38 * (index % 2 === 0 ? 1 : 0.8), height * 0.55, -0.1, 0, Math.PI * 2);
  ctx.fill();
}

function drawClouds() {
  const band = 860;
  const base = state.camera.y * 0.3;
  const first = Math.floor((base - VIEW_HEIGHT) / band) - 1;
  for (let index = first; index < first + 4; index += 1) {
    const worldOffset = index * band + 460;
    const y = VIEW_HEIGHT - (worldOffset - base);
    if (y < -160 || y > VIEW_HEIGHT + 160) continue;
    const cloud = cloudField[Math.abs(index) % cloudField.length];
    const x = 60 + ((index * 173 + 100000) % 420) + cloud.x * 40;
    drawCloud(x, y, cloud.scale, index);
  }
}

function drawMilestones() {
  const step = 1000;
  const startY = state.startY;
  const firstMetre = Math.max(1, Math.floor((state.camera.y - startY) / step));
  const lastMetre = Math.ceil((state.camera.y + VIEW_HEIGHT - startY) / step);
  ctx.save();
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textAlign = 'right';
  for (let metre = firstMetre; metre <= lastMetre; metre += 1) {
    const y = worldToScreenY(startY + metre * step);
    if (y < 76 || y > VIEW_HEIGHT - 44) continue;
    ctx.strokeStyle = theme === 'dark' ? 'rgba(160, 210, 255, 0.085)' : 'rgba(20, 32, 58, 0.085)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 8]);
    ctx.beginPath();
    ctx.moveTo(26, y);
    ctx.lineTo(VIEW_WIDTH - 26, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = theme === 'dark' ? 'rgba(190, 220, 255, 0.24)' : 'rgba(20, 32, 58, 0.28)';
    ctx.fillText(metre * 100 + ' m', VIEW_WIDTH - 30, y - 6);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- world rendering

function platformStyle(type) {
  return (PLATFORM_STYLES[theme] || PLATFORM_STYLES.dark)[type] || PLATFORM_STYLES.dark.normal;
}

function drawPlatform(platform) {
  const screenY = worldToScreenY(platform.y);
  if (screenY < -60 || screenY > VIEW_HEIGHT + 80) return;
  const x = platform.x;
  const w = platform.w;
  const h = PLATFORM_HEIGHT;
  const bounceAge = Number.isFinite(platform.bounceAt) ? state.elapsed - platform.bounceAt : 99;
  const fresh = bounceAge >= 0 && bounceAge < 0.32;
  const style = platformStyle(platform.type);

  if (platform.broken) {
    const breakAge = Number.isFinite(platform.brokenAt) ? state.elapsed - platform.brokenAt : 1;
    const fade = clamp(1 - breakAge * 0.7, 0.22, 0.6);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = style[1];
    const split = w / 2;
    const fall = Math.min(52, breakAge * 120);
    const drift = Math.min(26, breakAge * 58);
    ctx.fillRect(x + 2, screenY + fall, split - 8, h * 0.7);
    ctx.fillRect(x + split + 6 + drift, screenY + fall * 0.8, split - 8, h * 0.7);
    ctx.restore();
    return;
  }

  ctx.save();
  // shadow / depth
  ctx.fillStyle = theme === 'dark' ? 'rgba(0, 0, 0, 0.32)' : 'rgba(78, 62, 36, 0.2)';
  roundRectPath(ctx, x + 3, screenY + 4, w, h, 7);
  ctx.fill();

  if (platform.type === 'spring') {
    const glow = ctx.createRadialGradient(x + w / 2, screenY, 4, x + w / 2, screenY, w * 0.8);
    glow.addColorStop(0, theme === 'dark' ? 'rgba(217, 249, 157, 0.22)' : 'rgba(132, 204, 22, 0.18)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.ellipse(x + w / 2, screenY, w * 0.8, 34, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const gradient = ctx.createLinearGradient(0, screenY, 0, screenY + h);
  gradient.addColorStop(0, style[0]);
  gradient.addColorStop(1, style[1]);
  roundRectPath(ctx, x, screenY, w, h, 7);
  ctx.fillStyle = gradient;
  ctx.fill();

  // top rim
  roundRectPath(ctx, x + 5, screenY + 2, w - 10, 3, 2);
  ctx.fillStyle = theme === 'dark' ? 'rgba(255, 255, 255, 0.38)' : 'rgba(255, 255, 255, 0.55)';
  ctx.fill();

  if (theme === 'light') {
    roundRectPath(ctx, x + 0.5, screenY + 0.5, w - 1, h - 1, 7);
    ctx.strokeStyle = 'rgba(20, 32, 58, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (fresh) {
    ctx.globalAlpha = 1 - bounceAge / 0.32;
    ctx.strokeStyle = theme === 'dark' ? 'rgba(255, 255, 255, 0.7)' : 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    roundRectPath(ctx, x - 1, screenY - 1, w + 2, h + 2, 8);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (platform.type === 'moving') {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    for (let side = 0; side < 2; side += 1) {
      const cx = side === 0 ? x + 9 : x + w - 9;
      const dir = side === 0 ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(cx - dir * 3, screenY + h / 2 - 3);
      ctx.lineTo(cx + dir * 2, screenY + h / 2);
      ctx.lineTo(cx - dir * 3, screenY + h / 2 + 3);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (platform.type === 'fragile') {
    ctx.save();
    ctx.strokeStyle = theme === 'dark' ? 'rgba(68, 30, 4, 0.6)' : 'rgba(68, 30, 4, 0.5)';
    ctx.lineWidth = 1.4;
    const seedOffset = (platform.id * 37) % 41;
    const crackX = x + 18 + seedOffset;
    ctx.beginPath();
    ctx.moveTo(crackX, screenY + 2);
    ctx.lineTo(crackX + 4, screenY + 6);
    ctx.lineTo(crackX - 1, screenY + 10);
    ctx.lineTo(crackX + 3, screenY + h - 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(crackX + 18, screenY + 2);
    ctx.lineTo(crackX + 14, screenY + 7);
    ctx.lineTo(crackX + 19, screenY + 12);
    ctx.stroke();
    ctx.restore();
  }

  if (platform.type === 'spring' && !platform.broken) {
    const compress =
      reducedMotion || !Number.isFinite(platform.bounceAt)
        ? 0
        : clamp(1 - (state.elapsed - platform.bounceAt) / 0.26, 0, 1) * 8;
    const baseY = screenY - 4;
    const topY = baseY - 22 + compress;
    const midX = x + w / 2;
    ctx.save();
    ctx.strokeStyle = theme === 'dark' ? '#ffd166' : '#b45309';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(midX - 11, baseY);
    const segments = 5;
    for (let step = 1; step <= segments; step += 1) {
      const t = step / segments;
      ctx.lineTo(midX + (step % 2 === 0 ? 11 : -11), baseY + (topY - baseY) * t);
    }
    ctx.stroke();
    roundRectPath(ctx, midX - 15, topY - 4, 30, 5, 2.5);
    ctx.fillStyle = theme === 'dark' ? '#ffd166' : '#b45309';
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

function drawPlatforms() {
  const platforms = state.platforms;
  for (let index = 0; index < platforms.length; index += 1) {
    drawPlatform(platforms[index]);
  }
}

function drawPlayer() {
  const player = state.player;
  let screenY = worldToScreenY(player.y);
  if (mode === 'ready' && !reducedMotion) {
    screenY += Math.sin(visualTime / 620) * 2.4;
  }
  if (screenY < -100 || screenY > VIEW_HEIGHT + 100) return;

  const targetTilt = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  visualTilt += (targetTilt * 0.2 - visualTilt) * 0.14;
  if (landSquash > 0.002) landSquash *= 0.8;
  else landSquash = 0;

  const stretch = clamp(player.vy / 3400, -0.13, 0.16);
  const scaleX = 1 - stretch * 0.5 + landSquash * 0.55;
  const scaleY = 1 + stretch - landSquash;
  const blinkPhase = visualTime % 4300;
  const blinking = !reducedMotion && blinkPhase > 4120 && blinkPhase < 4250;

  const glow = ctx.createRadialGradient(player.x, screenY, 2, player.x, screenY, 58);
  glow.addColorStop(0, theme === 'dark' ? 'rgba(124, 247, 212, 0.22)' : 'rgba(11, 143, 122, 0.14)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(player.x, screenY, 58, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(player.x, screenY);
  ctx.rotate(visualTilt);
  ctx.scale(scaleX, scaleY);

  const bodyTop = theme === 'dark' ? '#d8ffe9' : '#b9fbd9';
  const bodyBottom = theme === 'dark' ? '#5eead4' : '#14b8a6';
  const body = ctx.createLinearGradient(0, -22, 0, 22);
  body.addColorStop(0, bodyTop);
  body.addColorStop(1, bodyBottom);
  ctx.fillStyle = body;
  roundRectPath(ctx, -PLAYER_HALF_WIDTH, -PLAYER_HALF_HEIGHT, PLAYER_HALF_WIDTH * 2, PLAYER_HALF_HEIGHT * 2, 16);
  ctx.fill();
  ctx.strokeStyle = theme === 'dark' ? 'rgba(3, 30, 25, 0.5)' : 'rgba(6, 78, 59, 0.34)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // belly highlight
  ctx.globalAlpha = theme === 'dark' ? 0.28 : 0.22;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(-6, -8, 7, 4.5, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // visor
  ctx.fillStyle = theme === 'dark' ? '#071426' : '#0b1728';
  roundRectPath(ctx, -13.5, -11, 27, 16.5, 8);
  ctx.fill();
  const eyeColor = theme === 'dark' ? '#7cf7d4' : '#d9fff6';
  ctx.fillStyle = eyeColor;
  if (blinking) {
    ctx.fillRect(-8.5, -3, 6, 1.6);
    ctx.fillRect(2.5, -3, 6, 1.6);
  } else {
    ctx.beginPath();
    ctx.arc(-5.5, -3.2, 2.5, 0, Math.PI * 2);
    ctx.arc(5.5, -3.2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(-4.7, -4, 0.9, 0, Math.PI * 2);
    ctx.arc(6.3, -4, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }

  // cheeks
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#ff7ad9';
  ctx.beginPath();
  ctx.ellipse(-13, 3.5, 3.6, 2.2, 0, 0, Math.PI * 2);
  ctx.ellipse(13, 3.5, 3.6, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // feet
  ctx.fillStyle = theme === 'dark' ? '#102039' : '#0b1728';
  roundRectPath(ctx, -14, PLAYER_HALF_HEIGHT - 4, 12, 6, 3);
  ctx.fill();
  roundRectPath(ctx, 2, PLAYER_HALF_HEIGHT - 4, 12, 6, 3);
  ctx.fill();

  // antenna
  ctx.strokeStyle = theme === 'dark' ? '#dcfff6' : '#064e3b';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(0, -PLAYER_HALF_HEIGHT);
  ctx.lineTo(0, -PLAYER_HALF_HEIGHT - 9);
  ctx.stroke();
  ctx.fillStyle = theme === 'dark' ? '#ffd166' : '#b45309';
  ctx.beginPath();
  ctx.arc(0, -PLAYER_HALF_HEIGHT - 11, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.arc(0, -PLAYER_HALF_HEIGHT - 11, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // tiny thruster trail while rising quickly
  if (!reducedMotion && player.vy > 600) {
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = theme === 'dark' ? '#7cf7d4' : '#0b8f7a';
    ctx.beginPath();
    ctx.arc(0, PLAYER_HALF_HEIGHT + 8, 4.5, 0, Math.PI * 2);
    ctx.arc(0, PLAYER_HALF_HEIGHT + 17, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// ---------------------------------------------------------------- particles

function spawnLandingBurst(platform) {
  if (reducedMotion) return;
  const color = (DUST_COLORS[theme] || DUST_COLORS.dark)[platform.type] || '#8df5e5';
  const spring = platform.type === 'spring';
  const count = spring ? 18 : 9;
  for (let index = 0; index < count; index += 1) {
    const angle = Math.PI * (0.2 + Math.random() * 0.6);
    const speed = 30 + Math.random() * (spring ? 260 : 130);
    const life = 0.3 + Math.random() * 0.35;
    particles.push({
      x: platform.x + Math.random() * platform.w,
      y: platform.y + 3,
      vx: Math.cos(angle) * speed * (Math.random() < 0.5 ? -1 : 1),
      vy: Math.sin(angle) * speed + 80,
      life,
      maxLife: life,
      size: 1.3 + Math.random() * (spring ? 3.2 : 2),
      color,
    });
  }
  if (particles.length > 90) particles.splice(0, particles.length - 90);
}

function spawnBreakBurst(platform) {
  if (reducedMotion) return;
  const color = (DUST_COLORS[theme] || DUST_COLORS.dark).fragile || '#fcd34d';
  for (let index = 0; index < 14; index += 1) {
    const life = 0.35 + Math.random() * 0.4;
    particles.push({
      x: platform.x + Math.random() * platform.w,
      y: platform.y,
      vx: (Math.random() * 2 - 1) * 150,
      vy: 60 + Math.random() * 140,
      life,
      maxLife: life,
      size: 1.5 + Math.random() * 2.4,
      color,
    });
  }
  if (particles.length > 90) particles.splice(0, particles.length - 90);
}

function updateParticles(dt) {
  if (!particles.length) return;
  const next = [];
  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index];
    particle.life -= dt;
    if (particle.life <= 0) continue;
    particle.vy -= 1050 * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    next.push(particle);
  }
  particles = next;
}

function drawParticles() {
  if (!particles.length) return;
  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index];
    const screenY = worldToScreenY(particle.y);
    if (screenY < -20 || screenY > VIEW_HEIGHT + 20) continue;
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, screenY, particle.size * (0.4 + alpha * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- render

function render() {
  if (!ctx) return;
  ctx.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  drawSky();
  drawStars();
  drawPlanet();
  drawClouds();

  const shakeX = shake > 0 && !reducedMotion ? Math.sin(visualTime * 0.18) * shake : 0;
  const shakeY = shake > 0 && !reducedMotion ? Math.cos(visualTime * 0.23) * shake * 0.7 : 0;
  ctx.save();
  ctx.translate(shakeX, shakeY);
  drawMilestones();
  drawPlatforms();
  drawParticles();
  drawPlayer();
  ctx.restore();
}

// ---------------------------------------------------------------- overlay actions

function focusCanvas() {
  try {
    window.focus();
  } catch (_error) {
    // focus is best effort
  }
  try {
    canvas.focus({ preventScroll: true });
  } catch (_error) {
    try {
      canvas.focus();
    } catch (_ignored) {
      // focus is best effort
    }
  }
}

function clearInput() {
  input.left = false;
  input.right = false;
}

function resetClock() {
  lastFrameTime = 0;
  accumulator = 0;
}

function startFromReady(preserveInput) {
  if (mode !== 'ready' || runtimePaused) return;
  hideOverlay();
  state = startRun(state);
  mode = 'playing';
  finishedRun = false;
  bestAtRunStart = best;
  bestA11yAnnounced = false;
  lastMilestone = 0;
  if (preserveInput !== true) clearInput();
  resetClock();
  updateScores();
  ensureSessionStarted();
  saveState();
  startLoop();
  focusCanvas();
  a11y(text.a11yStarted);
}

function restart() {
  if (mode !== 'over' && mode !== 'paused' && mode !== 'ready') return;
  if (runtimePaused) return;
  state = startRun(createGame({ seed: makeSeed() }));
  mode = 'playing';
  restoredSave = false;
  finishedRun = false;
  bestAtRunStart = best;
  bestA11yAnnounced = false;
  lastMilestone = 0;
  particles = [];
  shake = 0;
  landSquash = 0;
  clearInput();
  hideOverlay();
  resetClock();
  updateScores();
  startLoop();
  focusCanvas();
  ensureSessionStarted();
  saveState();
  a11y(text.a11yStarted);
}

function togglePause() {
  if (runtimePaused || mode === 'boot' || mode === 'over' || mode === 'error' || mode === 'ready') return;
  if (mode === 'playing') {
    mode = 'paused';
    stopLoop();
    clearInput();
    saveState();
    render();
    showPausedOverlay();
    a11y(text.a11yPaused);
    return;
  }
  if (mode === 'paused') {
    mode = 'playing';
    hideOverlay();
    resetClock();
    startLoop();
    focusCanvas();
    a11y(text.a11yResumed);
  }
}

function beginPlayingFromResume() {
  runtimePaused = false;
  resumeRequested = false;
  hideOverlay();
  if (state.status !== 'playing') state = startRun(state);
  mode = 'playing';
  finishedRun = false;
  bestAtRunStart = best;
  bestA11yAnnounced = false;
  clearInput();
  resetClock();
  updateScores();
  ensureSessionStarted();
  startLoop();
  focusCanvas();
  a11y(text.a11yResumed);
}

// ---------------------------------------------------------------- game over / scoring / saving

function onGameOver() {
  if (mode === 'over') return;
  mode = 'over';
  stopLoop();
  clearInput();
  shake = 0;
  updateScores();
  saveState();
  render();
  showGameOverOverlay();
  a11y(text.a11yOver(formatNumber(state.score)));
  finishRun();
}

function applyBestResult(result) {
  if (result && Number.isFinite(result.best)) {
    best = Math.max(best, Math.floor(result.best));
  }
  if (result && result.isBest === true) {
    if (mode === 'over') {
      els.finalRecord.hidden = false;
      els.finalRecord.textContent = text.record;
      els.finalBest.textContent = formatNumber(Math.max(best, state.score));
    }
  }
  updateScores();
}

function finishRun() {
  if (finishedRun) return;
  finishedRun = true;
  const score = state.score;
  const submission = game.score.submit(score).then(
    function onScoreSubmitted(result) {
      applyBestResult(result);
    },
    function onScoreFailed(error) {
      showToast(text.scoreFailed, {
        code: errorCode(error),
        kind: 'score',
        sticky: true,
        retry: function retryFailedScore() {
          retryScoreSubmit(score);
        },
      });
    }
  );
  pendingSessionEnd = submission.then(
    function endAfterSubmit() {
      return endSession(score);
    },
    function endAfterFailure() {
      return endSession(score);
    }
  );
}

function endSession(score) {
  if (!sessionActive) return Promise.resolve();
  sessionActive = false;
  const request = game.session.end({ outcome: 'completed', score }).then(
    function sessionEnded() {
      pendingSessionEnd = null;
    },
    function sessionEndFailed(error) {
      sessionActive = true;
      pendingSessionEnd = null;
      showToast(text.sessionFailed, {
        code: errorCode(error),
        kind: 'session',
        sticky: true,
        retry: function retrySessionEnd() {
          return endSession(score);
        },
      });
    }
  );
  return request;
}

function settleRestoredOver() {
  const score = state.score;
  const submission =
    score > best
      ? game.score.submit(score).then(
          function onScoreSubmitted(result) {
            applyBestResult(result);
          },
          function onScoreFailed(error) {
            showToast(text.scoreFailed, {
              code: errorCode(error),
              kind: 'score',
              sticky: true,
              retry: function retryFailedScore() {
                retryScoreSubmit(score);
              },
            });
          }
        )
      : Promise.resolve();
  submission.then(function closeLingeringSession() {
    game.session.end({ outcome: 'completed', score: score }).catch(function onSessionEndFailed(error) {
      showToast(text.sessionFailed, {
        code: errorCode(error),
        kind: 'session',
        sticky: true,
        retry: function retrySessionEnd() {
          return game.session.end({ outcome: 'completed', score: score }).catch(function ignore() {});
        },
      });
    });
  });
}

function retryScoreSubmit(score) {
  const failedScore = Number.isFinite(score) ? score : state.score;
  if (!sessionActive) ensureSessionStarted();
  game.score.submit(failedScore).then(
    function onRetrySubmitted(result) {
      applyBestResult(result);
      hideToast();
      endSession(failedScore);
    },
    function onRetryFailed(error) {
      showToast(text.scoreFailed, {
        code: errorCode(error),
        kind: 'score',
        sticky: true,
        retry: function retryAgain() {
          retryScoreSubmit(failedScore);
        },
      });
    }
  );
}

function ensureSessionStarted() {
  if (sessionActive) return;
  const start = function start() {
    if (sessionActive) return;
    sessionActive = true;
    game.session.start().catch(function sessionStartFailed(error) {
      sessionActive = false;
      showToast(text.sessionFailed, {
        code: errorCode(error),
        kind: 'session',
        sticky: true,
        retry: ensureSessionStarted,
      });
    });
  };
  if (pendingSessionEnd) {
    pendingSessionEnd.then(start, start);
  } else {
    start();
  }
}

function saveState() {
  if (!game.runtime || game.runtime.ready !== true) return Promise.resolve();
  const payload = serialize(state);
  return game.storage.save(SAVE_KEY, payload).then(
    function saved() {
      flashSaved();
      if (!els.toast.hidden && activeToastKind === 'save') hideToast();
    },
    function saveFailed(error) {
      showToast(text.saveFailed, {
        code: errorCode(error),
        kind: 'save',
        sticky: true,
        retry: saveState,
      });
    }
  );
}

// ---------------------------------------------------------------- loop

function startLoop() {
  if (loopRunning) return;
  if (mode !== 'playing' && mode !== 'ready') return;
  loopRunning = true;
  resetClock();
  rafId = window.requestAnimationFrame(frame);
}

function stopLoop() {
  loopRunning = false;
  if (rafId !== null && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(rafId);
  }
  rafId = null;
}

function advanceOneStep() {
  const previous = state;
  state = stepGame(state, input);
  if (state === previous) return;

  const elapsed = state.elapsed;
  let landed = null;
  let broken = null;
  for (let index = 0; index < state.platforms.length; index += 1) {
    const platform = state.platforms[index];
    if (platform.bounceAt === elapsed) landed = platform;
    if (platform.brokenAt === elapsed) broken = platform;
  }
  if (landed) {
    spawnLandingBurst(landed);
    landSquash = Math.max(landSquash, landed.type === 'spring' ? 0.16 : 0.1);
    if (!reducedMotion) shake = Math.max(shake, landed.type === 'spring' ? 5 : 1.6);
  }
  if (broken) spawnBreakBurst(broken);

  const milestone = Math.floor(state.score / 100) * 100;
  if (milestone > 0 && milestone > lastMilestone) {
    lastMilestone = milestone;
    announceMilestone(milestone);
  }

  if (state.score > bestAtRunStart && state.score > 0 && !bestA11yAnnounced) {
    bestA11yAnnounced = true;
    a11y(text.a11yBest);
  }

  if (state.status === 'over') onGameOver();
}

function frame(timestamp) {
  rafId = null;
  if (!loopRunning) return;
  const now = typeof timestamp === 'number' ? timestamp : window.performance.now();
  if (lastFrameTime === 0) lastFrameTime = now;
  let delta = now - lastFrameTime;
  lastFrameTime = now;
  if (!(delta >= 0)) delta = 0;
  if (delta > 120) delta = 120;
  visualTime += delta;

  if (mode === 'playing' && !runtimePaused) {
    accumulator += delta;
    let steps = 0;
    while (accumulator >= STEP_MS && steps < 5) {
      accumulator -= STEP_MS;
      steps += 1;
      advanceOneStep();
      if (mode !== 'playing') break;
    }
    updateParticles(delta / 1000);
    if (shake > 0) shake = Math.max(0, shake - delta * 0.022);
    updateScores();
  } else if (mode === 'ready') {
    updateParticles(delta / 1000);
  }

  updateLiveRuntime();
  render();
  if (loopRunning && (mode === 'playing' || mode === 'ready')) {
    rafId = window.requestAnimationFrame(frame);
  }
}

function announceMilestone(metres) {
  if (!els.milestone) return;
  els.milestone.textContent = text.milestone(formatNumber(metres));
  els.milestone.classList.remove('show');
  // Force a reflow so the same class can replay the animation.
  void els.milestone.offsetWidth;
  els.milestone.classList.add('show');
  if (milestoneTimer) window.clearTimeout(milestoneTimer);
  milestoneTimer = window.setTimeout(function hideMilestone() {
    els.milestone.classList.remove('show');
  }, 1700);
}

// ---------------------------------------------------------------- SDK lifecycle

function onRuntimePause() {
  if (mode === 'boot') {
    runtimePaused = true;
    return;
  }
  runtimePaused = true;
  stopLoop();
  clearInput();
  if (mode === 'over' || mode === 'error') {
    render();
    return;
  }
  if (mode === 'paused') {
    showRuntimePauseOverlay();
    render();
    return;
  }
  mode = 'paused';
  saveState();
  render();
  showRuntimePauseOverlay();
  a11y(text.a11yPaused);
}

function onRuntimeResume() {
  runtimePaused = false;
  if (mode === 'boot') {
    resumeRequested = true;
    return;
  }
  if (mode === 'paused' || mode === 'ready') {
    beginPlayingFromResume();
    return;
  }
  if (mode === 'playing') {
    resetClock();
    startLoop();
    focusCanvas();
  }
}

function onHidden() {
  if (mode === 'boot' || mode === 'error') return;
  stopLoop();
  clearInput();
  if (mode === 'playing' || mode === 'ready') saveState();
}

function onVisible() {
  if (mode === 'error' || mode === 'over') return;
  render();
  if ((mode === 'playing' && !runtimePaused) || mode === 'ready') {
    resetClock();
    startLoop();
  }
}

function onBeforeSave() {
  return saveState();
}

function onAgentStatus(snapshot) {
  if (!snapshot || !els.agentHint) return;
  if (snapshot.state === 'waiting-user') {
    els.agentHint.textContent = snapshot.label || text.agentWaiting;
    els.agentHint.classList.add('visible');
    els.agentHint.classList.remove('completed');
  } else if (snapshot.state === 'completed') {
    els.agentHint.textContent = snapshot.label || text.agentCompleted;
    els.agentHint.classList.add('visible', 'completed');
  } else {
    els.agentHint.textContent = '';
    els.agentHint.classList.remove('visible', 'completed');
  }
}

async function loadBest() {
  try {
    const result = await game.score.getBest();
    if (result && Number.isFinite(result.score)) return Math.max(0, Math.floor(result.score));
  } catch (_error) {
    // A missing score capability must not prevent play.
  }
  return 0;
}

async function loadSave() {
  try {
    const result = await game.storage.load(SAVE_KEY);
    if (!result) return { state: null, corrupt: false, failed: false, code: '' };
    const restored = deserialize(result.data);
    return { state: restored, corrupt: !restored, failed: false, code: '' };
  } catch (error) {
    return { state: null, corrupt: false, failed: true, code: errorCode(error) };
  }
}

function applyRuntimeInfo(info) {
  const runtimeLocale = info && typeof info.locale === 'string' ? info.locale : 'zh';
  applyLocale(runtimeLocale);
  runtimeReducedMotion = info ? info.reducedMotion === true : false;
  applyReducedMotion();
  const nextTheme = info && info.theme === 'light' ? 'light' : 'dark';
  theme = 'dark';
  document.documentElement.dataset.theme = 'dark';
  applyTheme(nextTheme);
}

// ---------------------------------------------------------------- input

function onKeyDown(event) {
  if (!event || typeof event.key !== 'string') return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const key = event.key;
  if (key === 'Escape' || key === 'Esc') return; // the platform owns Escape
  const lower = key.toLowerCase();
  const target = event.target;
  const onButton = target && target.tagName === 'BUTTON';
  const toggleKey = key === ' ' || key === 'Spacebar' || key === 'Enter' || lower === 'p';
  if (event.repeat && toggleKey) return;

  if (key === 'ArrowLeft' || lower === 'a') {
    if (mode === 'boot' || mode === 'error') return;
    event.preventDefault();
    input.left = true;
    if (mode === 'ready' && !runtimePaused) startFromReady(true);
    return;
  }
  if (key === 'ArrowRight' || lower === 'd') {
    if (mode === 'boot' || mode === 'error') return;
    event.preventDefault();
    input.right = true;
    if (mode === 'ready' && !runtimePaused) startFromReady(true);
    return;
  }
  if (key === ' ' || key === 'Spacebar' || key === 'Enter') {
    if (onButton) {
      // The overlay's primary button is the only focusable in-game control.
      // Activating it explicitly keeps Enter/Space reliable across browsers
      // while leaving the toast retry button to its native activation.
      if (target === els.primary && typeof overlayAction === 'function') {
        event.preventDefault();
        overlayAction();
      }
      return;
    }
    if (mode === 'ready' && !runtimePaused) {
      event.preventDefault();
      startFromReady();
      return;
    }
    if (mode === 'over' && !runtimePaused) {
      event.preventDefault();
      restart();
      return;
    }
    if (mode === 'paused' && !runtimePaused) {
      event.preventDefault();
      togglePause();
      return;
    }
    if (mode === 'playing' && !runtimePaused) {
      event.preventDefault();
      togglePause();
    }
    return;
  }
  if (lower === 'p') {
    if (mode === 'playing' || (mode === 'paused' && !runtimePaused)) {
      event.preventDefault();
      togglePause();
    }
  }
}

function onKeyUp(event) {
  if (!event || typeof event.key !== 'string') return;
  const key = event.key.toLowerCase();
  if (key === 'arrowleft' || key === 'a') input.left = false;
  if (key === 'arrowright' || key === 'd') input.right = false;
}

function onResize() {
  if (dprFor() !== canvasDpr) setupCanvas();
  render();
}

function bindEvents() {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', clearInput);
  window.addEventListener('resize', onResize);
  canvas.addEventListener('pointerdown', focusCanvas);
  els.primary.addEventListener('click', function onPrimaryClick() {
    if (typeof overlayAction === 'function') overlayAction();
  });
  els.toastRetry.addEventListener('click', function onToastRetry() {
    const action = toastRetryAction;
    hideToast();
    if (typeof action === 'function') action();
  });
  if (prefersReducedMotion) {
    if (typeof prefersReducedMotion.addEventListener === 'function') {
      prefersReducedMotion.addEventListener('change', applyReducedMotion);
    } else if (typeof prefersReducedMotion.addListener === 'function') {
      prefersReducedMotion.addListener(applyReducedMotion);
    }
  }
}

// ---------------------------------------------------------------- boot

function registerLifecycle() {
  game.lifecycle.on('pause', onRuntimePause);
  game.lifecycle.on('resume', onRuntimeResume);
  game.lifecycle.on('hidden', onHidden);
  game.lifecycle.on('visible', onVisible);
  game.lifecycle.on('before-save', onBeforeSave);
  if (game.agent && typeof game.agent.on === 'function') {
    game.agent.on('status', onAgentStatus);
  }
  game.onError(function onSdkError(error) {
    if (mode !== 'error') showFatal(error);
  });
}

async function boot() {
  setupCanvas();
  buildBackdrop();
  bindEvents();
  applyLocale('zh');
  applyReducedMotion();
  document.documentElement.dataset.theme = 'dark';
  render();

  registerLifecycle();

  try {
    const info = await game.ready();
    applyRuntimeInfo(info);
    if (info.launchMode === 'resume-paused') runtimePaused = true;
    best = await loadBest();
    bestAtRunStart = best;
    updateScores();

    const loaded = await loadSave();
    const saved = loaded.state;
    if (loaded.failed) {
      showToast(text.loadFailed, { code: loaded.code, kind: 'load' });
    } else if (loaded.corrupt) {
      showToast(text.saveCorrupt, { kind: 'load' });
    }
    if (saved) {
      state = saved;
      restoredSave = true;
      if (state.status === 'over') {
        mode = 'over';
        bestAtRunStart = best;
        updateScores();
        render();
        showGameOverOverlay();
        settleRestoredOver();
      } else {
        mode = 'ready';
        bestAtRunStart = best;
        if (runtimePaused) {
          showRuntimePauseOverlay();
          render();
        } else {
          showContinueOverlay();
          startLoop();
        }
      }
    } else {
      state = createGame({ seed: makeSeed() });
      mode = 'ready';
      bestAtRunStart = best;
      if (runtimePaused) {
        showRuntimePauseOverlay();
        render();
      } else {
        showStartOverlay();
        startLoop();
      }
    }

    if (resumeRequested) {
      resumeRequested = false;
      if (mode === 'ready' || mode === 'paused') beginPlayingFromResume();
    }

    updateScores();
    render();
  } catch (error) {
    showFatal(error);
  }
}

// Read-only diagnostic hook used by the V1 live-verification harness. It only
// exposes this game's own transient state — no user or platform data.
if (typeof window !== 'undefined') {
  window.__dshJumpDebug = function __dshJumpDebug() {
    return {
      mode: mode,
      status: state.status,
      score: state.score,
      best: best,
      theme: theme,
      reducedMotion: reducedMotion,
      runtimePaused: runtimePaused,
      restoredSave: restoredSave,
      elapsed: state.elapsed,
      camera: state.camera.y,
      player: { x: state.player.x, y: state.player.y, vy: state.player.vy },
      platforms: state.platforms.length,
      overlay: !els.overlay.hidden,
      overlayTitle: els.title.textContent,
      sessionActive: sessionActive,
    };
  };
}

boot();
