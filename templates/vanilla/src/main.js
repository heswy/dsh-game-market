/**
 * Vanilla game — reference Game SDK v1 integration (PRD §8.2.9).
 *
 * Demonstrates, in order:
 *   1. await game.ready() before the main loop, visible error state on failure;
 *   2. pure synchronous serialize/deserialize (storage.js);
 *   3. lifecycle pause/resume/before-save with no paused time added to dt;
 *   4. visibilitychange/blur pause handling;
 *   5. keyboard (canvas focus, Tab leaves, Escape untouched);
 *   6. resize + DPR handling in render.js;
 *   7. no network / no external resources;
 *   8. score.submit at the end with visible GM-4006 handling;
 *   9. zh/en copy in i18n.js;
 *  10. Local Runtime Simulator through scripts/dev.mjs;
 *  11. README with rename/capability/build/publish instructions.
 */

import { createInitialState, deserializeState, serializeState } from './storage.js';
import { createI18n } from './i18n.js';
import { createRenderer } from './render.js';

const canvas = document.getElementById('game');
const hintEl = document.getElementById('hint');
const announcer = document.getElementById('announcer');
const sdk = globalThis.DSH_GAME_SDK;
if (!sdk) throw new Error('DSH_GAME_SDK is missing; build with `npm run build` from the official template.');

const game = sdk.createGameSDK();
const renderer = createRenderer(canvas);

let i18n = createI18n('en');
let state = createInitialState();
let phase = 'loading'; // loading | ready | playing | paused | over | error
let best = null;
let canContinue = false;
let sessionActive = false;
let running = false;
let rafId = 0;
let lastTs = 0;
let saveInFlight = null;
let toast = '';
let toastIsError = false;
let toastTimer = null;
let errorCode = '';
let errorMessage = '';
let lastAnnouncedPhase = '';
let theme = 'dark';
let reducedMotion = false;

function render() {
  renderer.draw({
    state,
    phase,
    i18n,
    best,
    canContinue,
    toast,
    toastIsError,
    errorCode,
    errorMessage,
    reducedMotion,
  });
  const hints = {
    loading: i18n.t('loading'),
    ready: canContinue ? i18n.t('continueHint') : i18n.t('readyHint'),
    playing: i18n.t('catchHint'),
    paused: i18n.t('pausedHint'),
    over: i18n.t('restartHint'),
    error: i18n.t('readyFailed', { code: errorCode || 'GM-5000' }),
  };
  hintEl.textContent = hints[phase] || '';
  if (phase !== lastAnnouncedPhase) {
    lastAnnouncedPhase = phase;
    announcer.textContent = `${i18n.t('title')} — ${hints[phase] || ''}`;
  }
}

function setToast(text, isError, ttl = 2400) {
  toast = text;
  toastIsError = isError;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  if (text) {
    toastTimer = setTimeout(() => {
      toastTimer = null;
      toast = '';
      render();
    }, ttl);
  }
  render();
}

function applyTheme(nextTheme) {
  theme = nextTheme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  renderer.refreshPalette();
}

function syncRuntime() {
  if (!game.runtime) return;
  if (game.runtime.theme !== theme) applyTheme(game.runtime.theme);
  if (typeof game.runtime.reducedMotion === 'boolean' && game.runtime.reducedMotion !== reducedMotion) {
    reducedMotion = game.runtime.reducedMotion;
    render();
  }
}

// ---------------------------------------------------------------------------
// Loop. `lastTs` is reset on resume so paused time never becomes game time.
// ---------------------------------------------------------------------------

function startLoop() {
  if (running) return;
  running = true;
  lastTs = performance.now();
  rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function tick(timestamp) {
  if (!running) return;
  const dt = Math.min(0.05, Math.max(0, (timestamp - lastTs) / 1000));
  lastTs = timestamp;
  if (phase === 'playing') {
    update(dt);
    if (phase === 'over') {
      stopLoop();
      render();
      return;
    }
  }
  syncRuntime();
  render();
  rafId = requestAnimationFrame(tick);
}

function spawnStar() {
  const meteor = state.elapsed > 20 && Math.random() < 0.18;
  state.stars.push({
    x: 0.1 + Math.random() * 0.8,
    y: -0.05,
    vy: (meteor ? 0.34 : 0.2) + Math.random() * 0.16 + Math.min(0.4, state.elapsed * 0.004),
    r: 8 + Math.random() * 7,
    tone: meteor ? 'meteor' : 'star',
  });
  if (state.stars.length > 24) state.stars.shift();
}

function update(dt) {
  state.elapsed += dt;
  state.speed = Math.min(0.9, 0.2 + state.elapsed * 0.012);
  state.spawnIn -= dt;
  if (state.spawnIn <= 0) {
    spawnStar();
    state.spawnIn = Math.max(0.34, 0.95 - state.elapsed * 0.008);
  }

  const { width, height } = renderer.getSize();
  const basketWidth = Math.min(128, Math.max(64, width * 0.16));
  const basketX = state.basket * width;
  const basketTop = height - Math.max(42, height * 0.08);
  const scale = Math.min(width, height) / 540;
  const survivors = [];

  for (const star of state.stars) {
    star.y += star.vy * dt;
    const x = star.x * width;
    const y = star.y * height;
    const radius = Math.max(4, star.r * scale);
    const caught =
      y + radius * 0.6 >= basketTop &&
      y - radius <= basketTop + 28 &&
      Math.abs(x - basketX) <= basketWidth / 2 + radius;
    if (caught) {
      state.score += star.tone === 'meteor' ? 25 : 10;
      continue;
    }
    if (y - radius > height) {
      state.lives -= 1;
      continue;
    }
    survivors.push(star);
  }
  state.stars = survivors;
  if (state.lives <= 0) {
    state.lives = 0;
    finishGame();
  }
}

// ---------------------------------------------------------------------------
// SDK integration
// ---------------------------------------------------------------------------

async function saveNow() {
  if (phase === 'loading' || phase === 'error') return;
  if (saveInFlight) return saveInFlight;
  const snapshot = serializeState(state);
  saveInFlight = game.storage
    .save('current', snapshot)
    .then(() => {
      setToast(i18n.t('saveOk'), false, 1200);
    })
    .catch((error) => {
      if (error && error.code === 'GM-4031') return; // pre-ready autosave: platform will retry
      if (error && error.code === 'GM-4032') return; // storage capability not granted
      setToast(i18n.t('saveFailed', { code: error && error.code ? error.code : 'GM-5000' }), true, 3600);
    })
    .finally(() => {
      saveInFlight = null;
    });
  return saveInFlight;
}

async function ensureSession() {
  if (sessionActive) return;
  try {
    await game.session.start();
    sessionActive = true;
  } catch (error) {
    if (error && (error.code === 'GM-4033' || error.code === 'GM-4093')) return;
    setToast(error && error.code ? error.code : 'GM-5000', true, 2400);
  }
}

function beginOrContinue() {
  if (phase !== 'ready') return;
  phase = 'playing';
  canContinue = false;
  ensureSession();
  startLoop();
  render();
}

function startFreshGame() {
  state = createInitialState();
  canContinue = false;
  phase = 'ready';
  game.storage.remove('current').catch(() => {});
  beginOrContinue();
}

function restartGame() {
  state = createInitialState();
  canContinue = false;
  sessionActive = false;
  phase = 'playing';
  ensureSession();
  startLoop();
  render();
}

function finishGame() {
  state.gameOver = true;
  phase = 'over';
  canContinue = false;
  stopLoop();
  render();
  const finalScore = Math.round(state.score);

  game.score
    .submit(finalScore, { seconds: Math.round(state.elapsed) })
    .then((result) => {
      if (result && typeof result.best === 'number') best = result.best;
      else if (best === null || finalScore > best) best = finalScore;
      render();
    })
    .catch((error) => {
      if (error && error.code === 'GM-4006') {
        setToast(i18n.t('scoreRange', { code: error.code }), true, 5000);
      } else if (error && error.code !== 'GM-4032') {
        setToast(i18n.t('saveFailed', { code: error && error.code ? error.code : 'GM-5000' }), true, 3600);
      }
    })
    .finally(() => {
      game.session
        .end({ outcome: 'completed', score: finalScore })
        .catch(() => {})
        .finally(() => {
          sessionActive = false;
          saveNow();
          render();
        });
    });
}

// Register lifecycle and Agent listeners before ready (events may be buffered).
game.lifecycle.on('pause', () => {
  if (phase === 'playing') {
    stopLoop();
    phase = 'paused';
    saveNow();
    render();
    return;
  }
  if (phase === 'over' || phase === 'error' || phase === 'loading') return;
  saveNow();
  render();
});

game.lifecycle.on('resume', () => {
  if (phase === 'paused') {
    phase = 'playing';
    startLoop();
    render();
    return;
  }
  if (phase === 'ready') beginOrContinue();
});

game.lifecycle.on('hidden', () => {
  if (phase === 'playing') {
    stopLoop();
    phase = 'paused';
    saveNow();
    render();
  } else if (phase === 'over' || phase === 'error' || phase === 'loading') {
    stopLoop();
  }
});

game.lifecycle.on('visible', () => {
  render();
});

game.lifecycle.on('before-save', () => saveNow());

document.addEventListener('visibilitychange', () => {
  if (document.hidden && phase === 'playing') {
    stopLoop();
    phase = 'paused';
    saveNow();
    render();
  } else if (!document.hidden) {
    render();
  }
});

window.addEventListener('blur', () => {
  if (phase === 'playing') {
    stopLoop();
    phase = 'paused';
    saveNow();
    render();
  }
});

game.onError((error) => {
  if (phase === 'error') return;
  phase = 'error';
  errorCode = error && error.code ? error.code : 'GM-5000';
  errorMessage = error && error.message ? error.message : '';
  stopLoop();
  render();
});

async function boot() {
  renderer.resize();
  render();
  try {
    const info = await game.ready();
    i18n = createI18n(info.locale);
    applyTheme(info.theme);
    reducedMotion = info.reducedMotion === true;

    try {
      const bestScore = await game.score.getBest();
      best = bestScore && typeof bestScore.score === 'number' ? bestScore.score : null;
    } catch (error) {
      if (!error || error.code !== 'GM-4032') setToast(error && error.code ? error.code : 'GM-5000', true);
    }

    let restored = null;
    try {
      const saved = await game.storage.load('current');
      if (saved) restored = deserializeState(saved.data);
    } catch (error) {
      if (!error || error.code !== 'GM-4032') setToast(error && error.code ? error.code : 'GM-5000', true);
    }

    state = restored || createInitialState();
    canContinue = Boolean(restored);
    phase = 'ready';
    canvas.focus({ preventScroll: true });
    render();
  } catch (error) {
    phase = 'error';
    errorCode = error && error.code ? error.code : 'GM-5000';
    errorMessage = error && error.message ? error.message : '';
    render();
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function moveBasketToClientX(clientX) {
  const rect = canvas.getBoundingClientRect();
  if (!rect || rect.width <= 0) return;
  state.basket = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  if (phase === 'playing') render();
}

canvas.addEventListener('pointermove', (event) => {
  moveBasketToClientX(event.clientX);
});

canvas.addEventListener('pointerdown', (event) => {
  canvas.focus({ preventScroll: true });
  moveBasketToClientX(event.clientX);
  if (phase === 'ready') beginOrContinue();
  else if (phase === 'over') restartGame();
});

canvas.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
    if (phase === 'playing') state.basket = Math.max(0, state.basket - 0.055);
    event.preventDefault();
    return;
  }
  if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
    if (phase === 'playing') state.basket = Math.min(1, state.basket + 0.055);
    event.preventDefault();
    return;
  }
  if (event.key === ' ' || event.key === 'Enter') {
    if (phase === 'ready') beginOrContinue();
    else if (phase === 'over') restartGame();
    event.preventDefault();
    return;
  }
  if ((event.key === 'n' || event.key === 'N') && phase === 'ready' && canContinue) {
    startFreshGame();
    event.preventDefault();
    return;
  }
  // Escape and Tab are deliberately not intercepted: Runtime uses Escape to
  // leave the game and Tab must be able to leave the canvas.
});

window.addEventListener('resize', () => {
  renderer.resize();
  render();
});

boot();
