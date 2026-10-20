/**
 * Orbit Courier shell: owns the frame loop, HUD, overlays and SDK integration.
 *
 * The rules live in `logic.js` (pure, unit-tested). This module only wires them
 * to the DOM, the renderer, audio, input and the host adapter:
 *
 *   - fixed-step simulation (16 ms) with a capped catch-up;
 *   - pause on lifecycle/hidden/blur, autosave every 5 s and before-save;
 *   - score submission + session start/end through the adapter;
 *   - keyboard/screen-reader friendly overlays, reduced-motion support.
 */

import {
  createRunState,
  startRun,
  pauseRun,
  resumeRun,
  stepRun,
  serializeRun,
  shouldOfferContinue,
  shouldPersistRun,
  scoreOf,
  currentAct,
} from './logic.js';
import { createRenderer, loadSprites } from './render.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { loadSave, writeSave, clearSave, readBest, submitScore, resumeFromSave } from './resume.js';
import { createRunSessions } from './run-sessions.js';

export const FIXED_STEP_MS = 16;
export const MAX_STEPS_PER_FRAME = 5;
export const AUTOSAVE_MS = 5000;

const TEXT = Object.freeze({
  title: '轨道信使',
  subtitle: 'Orbit Courier · 夜航第一班',
  start: '开始这一班',
  continue: '继续上一班',
  resume: '回到轨道',
  restart: '重新开始',
  pause: '暂停',
  paused: '已暂停',
  muted: '静音',
  unmuted: '开声',
  score: '分数',
  best: '最高分',
  time: '剩余',
  combo: '连击',
  shield: '船体',
  act: '航段',
  shiftComplete: '这一班完成',
  wrecked: '船体报废',
  newBest: '新纪录！',
  hintKeyboard: '方向键 / WASD 转向与换轨 · 空格暂停 · M 静音',
  hintPointer: '拖动旋转 · 轻点轨道换轨',
  saveFailed: '存档失败，本局仍在继续',
  loadFailed: '关卡数据加载失败',
  fatal: '游戏遇到问题，请返回会话后重试',
});

function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function byId(documentRef, id) {
  return documentRef.getElementById(id);
}

/**
 * Boot the shell.
 * @param {object} options
 * @param {object} options.adapter SDK adapter (platform or offline)
 * @param {object} options.level Parsed level document
 * @param {HTMLCanvasElement} options.canvas 720×1280 stage
 * @param {Document} options.document
 * @param {() => number} [options.now]
 * @param {() => number} [options.seed]
 */
export function boot(options) {
  const adapter = options.adapter;
  const level = options.level;
  const documentRef = options.document || document;
  const canvas = options.canvas;
  const now = typeof options.now === 'function' ? options.now : () => (window.performance ? window.performance.now() : Date.now());
  const seed = typeof options.seed === 'function' ? options.seed : () => Date.now() >>> 0;

  const dom = {
    score: byId(documentRef, 'hud-score'),
    best: byId(documentRef, 'hud-best'),
    time: byId(documentRef, 'hud-time'),
    act: byId(documentRef, 'hud-act'),
    combo: byId(documentRef, 'hud-combo'),
    shield: byId(documentRef, 'hud-shield'),
    pause: byId(documentRef, 'btn-pause'),
    mute: byId(documentRef, 'btn-mute'),
    overlay: byId(documentRef, 'overlay'),
    overlayTitle: byId(documentRef, 'overlay-title'),
    overlaySubtitle: byId(documentRef, 'overlay-subtitle'),
    overlayBody: byId(documentRef, 'overlay-body'),
    overlayActions: byId(documentRef, 'overlay-actions'),
    toast: byId(documentRef, 'toast'),
    actBanner: byId(documentRef, 'act-banner'),
  };

  const audio = createAudio(adapter, { onMutedChange: () => renderMuted() });
  const input = createInput({
    pointerEnabled: true,
    onGesture: () => {
      audio.unlock();
      ensurePlayableGesture();
    },
    onPauseToggle: () => togglePause(),
    onMuteToggle: () => toggleMute(),
    onConfirm: () => confirmOverlay(),
    onEscape: () => {
      if (state.phase === 'playing') pause();
    },
  });
  audio.restoreMuted().then(() => renderMuted());

  let renderer = null;
  let state = createRunState(level, { seed: seed() });
  let pausedByHost = false;
  // CR8-03: session/settlement state is per run token, never a cross-run boolean.
  const sessions = createRunSessions({
    startSession: () => (adapter.session && typeof adapter.session.start === 'function' ? adapter.session.start() : null),
    endSession: (request) => (adapter.session && typeof adapter.session.end === 'function' ? adapter.session.end(request) : null),
    submitScore: (score) => submitScore(adapter, score),
    clearSave: () => clearSave(adapter),
  });
  let lastFrameAt = now();
  let accumulator = 0;
  let saveTimer = 0;
  let frameHandle = 0;
  let disposed = false;
  let lastUiAt = 0;
  let pendingContinue = null;

  renderer = createRenderer(canvas, { level, reducedMotion: Boolean(adapter.runtime && adapter.runtime.reducedMotion) });
  loadSprites(documentRef).then((sprites) => {
    renderer = createRenderer(canvas, {
      level,
      sprites,
      reducedMotion: Boolean(adapter.runtime && adapter.runtime.reducedMotion),
    });
    drawOnce();
  });

  function motionReduced() {
    return Boolean(adapter.runtime && adapter.runtime.reducedMotion) || renderer.reducedMotion;
  }

  function toast(message) {
    if (!dom.toast) return;
    dom.toast.textContent = message;
    dom.toast.classList.add('visible');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => dom.toast.classList.remove('visible'), 2400);
  }

  function banner(message) {
    if (!dom.actBanner) return;
    dom.actBanner.textContent = message;
    dom.actBanner.classList.add('visible');
    clearTimeout(banner.timer);
    banner.timer = setTimeout(() => dom.actBanner.classList.remove('visible'), 2200);
  }

  function renderMuted() {
    if (!dom.mute) return;
    dom.mute.setAttribute('aria-pressed', String(audio.muted));
    dom.mute.textContent = audio.muted ? '🔇' : '🔊';
    dom.mute.setAttribute('aria-label', `${TEXT.muted}：${audio.muted ? '已开' : '已关'}`);
    documentRef.body.classList.toggle('is-muted', audio.muted);
  }

  function toggleMute() {
    audio.unlock();
    audio.toggleMuted();
    renderMuted();
  }

  function updateHud(force) {
    const t = now();
    if (!force && t - lastUiAt < 80) return;
    lastUiAt = t;
    if (dom.score) dom.score.textContent = String(scoreOf(state));
    if (dom.best) dom.best.textContent = String(sessions.best);
    if (dom.time) dom.time.textContent = formatTime(state.timeLeftMs);
    if (dom.act) dom.act.textContent = currentAct(level, state).label;
    if (dom.combo) {
      dom.combo.textContent = `×${state.combo}`;
      dom.combo.classList.toggle('hot', state.combo > 1);
    }
    if (dom.shield) {
      const total = Math.max(1, Number(level.shield) || 3);
      const hearts = [];
      for (let index = 0; index < total; index += 1) hearts.push(index < state.shield ? '◆' : '◇');
      dom.shield.textContent = hearts.join(' ');
      dom.shield.setAttribute('aria-label', `${TEXT.shield} ${state.shield}/${total}`);
    }
    if (dom.pause) {
      dom.pause.disabled = state.phase === 'ready' || state.phase === 'ended';
      dom.pause.setAttribute('aria-pressed', String(state.phase === 'paused'));
    }
    documentRef.body.dataset.phase = state.phase;
    documentRef.body.classList.toggle('reduced-motion', motionReduced());
  }

  function drawOnce() {
    renderer.draw(state, now(), null);
  }

  function showOverlay({ title, subtitle, body, actions, focus }) {
    if (!dom.overlay) return;
    dom.overlay.hidden = false;
    if (dom.overlayTitle) dom.overlayTitle.textContent = title;
    if (dom.overlaySubtitle) dom.overlaySubtitle.textContent = subtitle || '';
    if (dom.overlayBody) dom.overlayBody.innerHTML = body || '';
    if (dom.overlayActions) {
      dom.overlayActions.textContent = '';
      for (const action of actions) {
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.className = action.primary ? 'action primary' : 'action';
        button.textContent = action.label;
        if (action.id) button.id = action.id;
        button.addEventListener('click', action.onClick);
        dom.overlayActions.appendChild(button);
      }
    }
    const target = focus
      ? byId(documentRef, focus)
      : dom.overlayActions && dom.overlayActions.querySelector('button');
    if (target && typeof target.focus === 'function') target.focus();
  }

  function hideOverlay() {
    if (dom.overlay) dom.overlay.hidden = true;
  }

  function menuOverlay() {
    const continueAvailable = Boolean(pendingContinue && shouldOfferContinue(pendingContinue));
    const body = [
      `<p class="lead">在三层轨道间穿梭，收取货舱，穿过站门交付，别撞上碎岩。</p>`,
      `<p class="meta">一局约 ${Math.round(level.durationSeconds)} 秒 · ${level.acts.length} 段航程 · 连击最高 ×${level.combo.max}</p>`,
      `<ul class="hints">`,
      `<li>${TEXT.hintKeyboard}</li>`,
      `<li>${TEXT.hintPointer}</li>`,
      `<li>音效在第一次点击/按键后才会播放，可随时静音。</li>`,
      `</ul>`,
    ].join('');
    showOverlay({
      title: TEXT.title,
      subtitle: TEXT.subtitle,
      body,
      actions: [
        continueAvailable
          ? { label: TEXT.continue, primary: true, id: 'btn-continue', onClick: () => beginFromSave() }
          : { label: TEXT.start, primary: true, id: 'btn-start', onClick: () => beginNewRun() },
        ...(continueAvailable
          ? [{ label: TEXT.start, id: 'btn-start', onClick: () => beginNewRun() }]
          : []),
      ],
      focus: continueAvailable ? 'btn-continue' : 'btn-start',
    });
  }

  function pausedOverlay() {
    const body = [
      `<p class="lead">${TEXT.paused}</p>`,
      `<p class="meta">分数 ${scoreOf(state)} · 剩余 ${formatTime(state.timeLeftMs)} · 连击 ×${state.combo}</p>`,
    ].join('');
    showOverlay({
      title: TEXT.paused,
      subtitle: '',
      body,
      actions: [
        { label: TEXT.resume, primary: true, id: 'btn-resume', onClick: () => resume() },
        { label: TEXT.restart, id: 'btn-restart', onClick: () => beginNewRun() },
      ],
      focus: 'btn-resume',
    });
  }

  function endedOverlay(finalScore, isBest) {
    const reason = state.endReason === 'wrecked' ? TEXT.wrecked : TEXT.shiftComplete;
    const body = [
      `<p class="final">${finalScore}</p>`,
      `<p class="meta">${isBest ? TEXT.newBest : `${TEXT.best} ${sessions.best}`}</p>`,
      `<dl class="stats">`,
      `<div><dt>交付</dt><dd>${state.deliveries}</dd></div>`,
      `<div><dt>最快连击</dt><dd>×${state.bestCombo}</dd></div>`,
      `<div><dt>碰撞</dt><dd>${state.stats.hits}</dd></div>`,
      `</dl>`,
    ].join('');
    showOverlay({
      title: reason,
      subtitle: state.endReason === 'wrecked' ? '船体耗尽，回到站台重新出发' : '夜航结束，这一班的分数已记录',
      body,
      actions: [{ label: TEXT.restart, primary: true, id: 'btn-restart', onClick: () => beginNewRun() }],
      focus: 'btn-restart',
    });
  }

  function ensurePlayableGesture() {
    if (state.phase === 'playing' || state.phase === 'paused') sessions.ensureSessionStart();
  }

  async function beginNewRun() {
    const fresh = createRunState(level, { seed: seed() });
    state = fresh;
    startRun(state);
    pausedByHost = false;
    sessions.beginRun();
    sessions.ensureSessionStart();
    hideOverlay();
    audio.unlock();
    updateHud(true);
    // A new run supersedes the previous one: drop its Continue save now, then
    // the first autosave persists this run once it has real progress.
    clearSave(adapter).catch(() => {});
    toast('出发 · 收取货舱并穿过站门');
  }

  async function beginFromSave() {
    const resumed = resumeFromSave(level, pendingContinue, { seed: seed() });
    state = resumed;
    state.phase = 'playing';
    pausedByHost = false;
    sessions.beginRun();
    sessions.ensureSessionStart();
    hideOverlay();
    audio.unlock();
    updateHud(true);
    toast('已恢复上一班');
  }

  function pause() {
    if (state.phase !== 'playing') return;
    pauseRun(state);
    saveNow();
    updateHud(true);
    pausedOverlay();
  }

  function resume() {
    if (state.phase !== 'paused') return;
    resumeRun(state);
    hideOverlay();
    updateHud(true);
    lastFrameAt = now();
  }

  function togglePause() {
    if (state.phase === 'playing') pause();
    else if (state.phase === 'paused') resume();
  }

  function saveNow() {
    // Never persist a menu/fresh state: a host lifecycle pause can arrive
    // before the first run starts (resume-paused relaunch) and would otherwise
    // overwrite the very save Continue needs. See shouldPersistRun().
    if (!shouldPersistRun(state)) return;
    const payload = serializeRun(state);
    writeSave(adapter, payload).catch(() => {});
  }

  function finishRun() {
    const finalScore = scoreOf(state);
    const outcome = state.endReason === 'wrecked' ? 'lost' : 'completed';
    updateHud(true);
    audio.play('end');
    // Settlement is idempotent per run token: a duplicate end event is dropped,
    // and a slow host answer can only ever report `stale`, never touch a newer run.
    return sessions.settle({
      score: finalScore,
      outcome,
      onIssued: ({ isBest }) => endedOverlay(finalScore, isBest),
    }).then((result) => {
      if (result.status === 'settled') updateHud(true);
      return result;
    });
  }

  function handleEvents(events) {
    if (!events || events.length === 0) return;
    for (const event of events) {
      if (event === 'collect') audio.play('collect');
      else if (event === 'deliver') audio.play('deliver');
      else if (event === 'deliver-fast') audio.play('fast');
      else if (event === 'hit') audio.play('hit');
    }
    renderer.spawnParticles(events, state);
    if (events.includes('act')) {
      const act = currentAct(level, state);
      banner(`${TEXT.act} ${act.id} · ${act.label}`);
      audio.play('act');
    }
    if (events.includes('end')) finishRun();
  }

  function frame() {
    if (disposed) return;
    frameHandle = window.requestAnimationFrame(frame);
    const t = now();
    let dt = t - lastFrameAt;
    lastFrameAt = t;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 120);

    if (state.phase === 'playing' && !pausedByHost) {
      accumulator += dt;
      let steps = 0;
      while (accumulator >= FIXED_STEP_MS && steps < MAX_STEPS_PER_FRAME) {
        const intent = input.read();
        const { events } = stepRun(level, state, FIXED_STEP_MS, intent);
        accumulator -= FIXED_STEP_MS;
        steps += 1;
        if (events.length > 0) handleEvents(events);
        if (state.phase !== 'playing') break;
      }
      if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
      saveTimer += dt;
      if (saveTimer >= AUTOSAVE_MS) {
        saveTimer = 0;
        saveNow();
      }
      updateHud(false);
    }

    renderer.draw(state, t, { dtMs: dt });
  }

  function onVisibility() {
    if (documentRef.visibilityState === 'hidden') {
      if (state.phase === 'playing') {
        pausedByHost = true;
        saveNow();
      }
    } else {
      pausedByHost = false;
      lastFrameAt = now();
    }
  }

  function onLifecycle(event) {
    if (event === 'pause') {
      // The runtime may pause before the player has started a run (continue
      // relaunch starts paused). Only a live run is affected by that pause.
      if (state.phase === 'playing') {
        pausedByHost = true;
        saveNow();
      }
      if (state.phase === 'paused') pausedOverlay();
    } else if (event === 'resume' || event === 'visible') {
      pausedByHost = false;
      lastFrameAt = now();
    } else if (event === 'before-save' || event === 'hidden') {
      saveNow();
    }
  }

  function confirmOverlay() {
    if (state.phase === 'ready' || state.phase === 'ended') {
      if (pendingContinue && shouldOfferContinue(pendingContinue) && state.phase === 'ready') beginFromSave();
      else beginNewRun();
      return;
    }
    if (state.phase === 'paused') resume();
  }

  function fatal(error) {
    const message = error && error.message ? error.message : TEXT.fatal;
    showOverlay({
      title: '出错了',
      subtitle: '',
      body: `<p class="lead">${message}</p><p class="meta">${TEXT.fatal}</p>`,
      actions: [{ label: TEXT.restart, primary: true, onClick: () => beginNewRun() }],
    });
  }

  /**
   * Read-only automation probe hook (A08 acceptance).
   *
   * `window.__ORBIT_PROBE__.snapshot()` returns a frozen copy of the current
   * render/rule state (lanes, angles, hazards, cargo, clock, score). It exists
   * so acceptance bots can dodge asteroids instead of playing blind. The hook is
   * deliberately one-way: it exposes no setter, no input injection and no way to
   * change score/phase, and taking a snapshot never mutates the run.
   */
  function installProbeHook() {
    if (typeof window === 'undefined') return;
    if (Object.prototype.hasOwnProperty.call(window, '__ORBIT_PROBE__')) return;
    const snapshot = () => {
      const current = state;
      const levelShield = Math.max(1, Number(level.shield) || 3);
      return Object.freeze({
        probeVersion: 1,
        at: now(),
        phase: current.phase,
        endReason: current.endReason,
        levelId: current.levelId,
        elapsedMs: Math.round(current.elapsedMs),
        timeLeftMs: Math.round(current.timeLeftMs),
        durationMs: current.durationMs,
        score: current.score,
        finalScore: current.finalScore,
        deliveries: current.deliveries,
        combo: current.combo,
        hull: current.shield,
        maxHull: levelShield,
        invulnerableMs: Math.round(current.invulnerableMs),
        lane: current.ship.ring,
        laneCount: level.geometry.rings.length,
        stationAngle: level.geometry.stationAngle,
        ship: Object.freeze({
          lane: current.ship.ring,
          angle: current.ship.angle,
          carrying: Boolean(current.ship.carry),
        }),
        cargo: Object.freeze(current.parcels.map((parcel) => Object.freeze({
          id: parcel.id,
          lane: parcel.ring,
          angle: parcel.angle,
          ttlMs: parcel.ttlMs,
          ageMs: Math.max(0, current.elapsedMs - parcel.bornAtMs),
        }))),
        asteroids: Object.freeze(current.asteroids.map((rock) => Object.freeze({
          id: rock.id,
          lane: rock.ring,
          angle: rock.angle,
          direction: rock.dir,
          ttlMs: rock.ttlMs,
        }))),
        best: sessions.best,
        audio: Object.freeze({ muted: audio.muted, unlocked: audio.unlocked, supported: audio.supported }),
      });
    };
    Object.defineProperty(window, '__ORBIT_PROBE__', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: Object.freeze({ probeVersion: 1, readOnly: true, snapshot }),
    });
  }

  function wireUi() {
    if (typeof window.matchMedia === 'function') {
      try {
        const query = window.matchMedia('(prefers-reduced-motion: reduce)');
        const onChange = () => {
          renderer.setReducedMotion(Boolean(query.matches) || Boolean(adapter.runtime && adapter.runtime.reducedMotion));
          updateHud(true);
        };
        if (typeof query.addEventListener === 'function') query.addEventListener('change', onChange);
        else if (typeof query.addListener === 'function') query.addListener(onChange);
      } catch (error) {
        /* no media query support: boot-time detection stands */
      }
    }
    if (dom.pause) dom.pause.addEventListener('click', () => togglePause());
    if (dom.mute) dom.mute.addEventListener('click', () => toggleMute());
    documentRef.addEventListener('visibilitychange', onVisibility);
    if (adapter.lifecycle && typeof adapter.lifecycle.on === 'function') {
      for (const event of ['pause', 'resume', 'hidden', 'visible', 'before-save']) {
        adapter.lifecycle.on(event, () => onLifecycle(event));
      }
    }
    if (typeof adapter.onFatal === 'function') adapter.onFatal(fatal);
    canvas.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
  }

  async function start() {
    // Read persisted progress before subscribing to lifecycle events: a host
    // pause delivered during boot must not race the Continue load.
    sessions.setBest(await readBest(adapter));
    pendingContinue = await loadSave(adapter);
    wireUi();
    input.attachPointer(canvas, () => ({
      center: renderer.geometry.center,
      rings: renderer.geometry.rings,
      currentRing: state.ship.ring,
      scale: 1,
    }));
    if (adapter.runtime && typeof adapter.runtime.reducedMotion === 'boolean') {
      renderer.setReducedMotion(adapter.runtime.reducedMotion);
    }
    lastFrameAt = now();
    updateHud(true);
    drawOnce();
    menuOverlay();
    installProbeHook();
    frameHandle = window.requestAnimationFrame(frame);
    return api;
  }

  const api = {
    start,
    beginNewRun,
    beginFromSave,
    pause,
    resume,
    togglePause,
    toggleMute,
    saveNow,
    get state() {
      return state;
    },
    get best() {
      return sessions.best;
    },
    get audio() {
      return audio;
    },
    dispose() {
      disposed = true;
      if (frameHandle) window.cancelAnimationFrame(frameHandle);
      input.dispose();
      audio.stopAll();
      documentRef.removeEventListener('visibilitychange', onVisibility);
      saveNow();
    },
  };

  return api;
}
