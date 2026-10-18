/**
 * React shell for the template game.
 *
 * React owns *UI chrome* only (phase label, toast, a11y status). The mutable
 * game state, loop and renderer live in refs/plain modules, so no React render
 * happens per animation frame (PRD §8.2.9: "游戏状态放 useRef").
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';

import { createI18n } from './game/i18n';
import { createLoop, type Loop } from './game/loop';
import { createRenderer, type DrawModel, type Phase, type Renderer } from './game/render';
import { createInitialState, deserializeState, serializeState, type GameState } from './game/storage';
import { getGame, isGameError, type Game } from './sdk';
import type { JsonValue } from '@dsh-game/sdk';

export interface Hud {
  score: number;
  best: number | null;
  lives: number;
  time: number;
}

interface Toast {
  text: string;
  error: boolean;
}

function hintFor(phase: Phase, canContinue: boolean, i18n: ReturnType<typeof createI18n>): string {
  if (phase === 'loading') return i18n.t('loading');
  if (phase === 'ready') return canContinue ? i18n.t('continueHint') : i18n.t('controls');
  if (phase === 'playing') return i18n.t('controls');
  if (phase === 'paused') return i18n.t('pausedHint');
  if (phase === 'over') return i18n.t('restartHint');
  return i18n.t('readyFailed', { code: 'GM-5000' });
}

export function App(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const gameRef = useRef<Game | null>(null);
  const stateRef = useRef<GameState>(createInitialState());
  const bestRef = useRef<number | null>(null);
  const i18nRef = useRef(createI18n('en'));
  const phaseRef = useRef<Phase>('loading');
  const canContinueRef = useRef(false);
  const sessionActiveRef = useRef(false);
  const saveRef = useRef<Promise<void> | null>(null);
  const loopRef = useRef<Loop | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const errorCodeRef = useRef('');
  const errorMessageRef = useRef('');
  const lastHudRef = useRef(0);

  const [phase, setPhase] = useState<Phase>('loading');
  const [canContinue, setCanContinue] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [hud, setHud] = useState<Hud>({ score: 0, best: null, lives: 3, time: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = getGame();
    gameRef.current = game;
    const renderer = createRenderer(canvas);
    rendererRef.current = renderer;
    renderer.resize();

    const offList: Array<() => void> = [];

    function setPhaseSafe(next: Phase): void {
      phaseRef.current = next;
      setPhase(next);
    }

    function strings(): DrawModel['strings'] {
      const t = i18nRef.current.t;
      return {
        title: t('title'),
        score: t('score'),
        best: t('best'),
        lives: t('lives'),
        time: t('time'),
        loading: t('loading'),
        ready: canContinueRef.current ? t('continue') : t('ready'),
        readyHint: t('readyHint'),
        continueHint: t('continueHint'),
        paused: t('paused'),
        pausedHint: t('pausedHint'),
        gameOver: t('gameOver'),
        finalScore: t('finalScore'),
        restartHint: t('restartHint'),
        error: t('readyFailed', { code: errorCodeRef.current || 'GM-5000' }),
      };
    }

    function render(): void {
      renderer.draw({
        state: stateRef.current,
        phase: phaseRef.current,
        strings: strings(),
        best: bestRef.current,
        canContinue: canContinueRef.current,
        errorMessage: errorMessageRef.current,
      });
    }

    function showToast(text: string, error = false, ttl = 2400): void {
      setToast({ text, error });
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => {
        toastTimerRef.current = null;
        setToast(null);
      }, ttl);
    }

    let loop: Loop;
    loop = createLoop((dt) => {
      if (phaseRef.current === 'playing') {
        update(dt);
        if (phaseRef.current === 'over') {
          loop.stop();
          render();
          return false;
        }
      }
      render();
      const now = performance.now();
      if (now - lastHudRef.current > 250) {
        lastHudRef.current = now;
        setHud({
          score: Math.round(stateRef.current.score),
          best: bestRef.current,
          lives: stateRef.current.lives,
          time: Math.floor(stateRef.current.elapsed),
        });
      }
      return true;
    });
    loopRef.current = loop;

    function spawnStar(): void {
      const state = stateRef.current;
      state.stars.push({
        x: 0.1 + Math.random() * 0.8,
        y: -0.05,
        vy: 0.22 + Math.random() * 0.16 + Math.min(0.4, state.elapsed * 0.004),
        r: 8 + Math.random() * 7,
      });
      if (state.stars.length > 24) state.stars.shift();
    }

    function finishGame(): void {
      const state = stateRef.current;
      state.gameOver = true;
      canContinueRef.current = false;
      setCanContinue(false);
      setPhaseSafe('over');
      loop.stop();
      render();
      const finalScore = Math.round(state.score);
      game.score
        .submit(finalScore, { seconds: Math.round(state.elapsed) })
        .then((result) => {
          if (result && typeof result.best === 'number') bestRef.current = result.best;
          else if (bestRef.current === null || finalScore > bestRef.current) bestRef.current = finalScore;
          render();
        })
        .catch((error: unknown) => {
          if (isGameError(error) && error.code === 'GM-4006') {
            showToast(i18nRef.current.t('scoreRange', { code: error.code }), true, 5000);
          } else if (!isGameError(error) || error.code !== 'GM-4032') {
            showToast(i18nRef.current.t('saveFailed', { code: isGameError(error) ? error.code : 'GM-5000' }), true, 3600);
          }
        })
        .finally(() => {
          game.session
            .end({ outcome: 'completed', score: finalScore })
            .catch(() => undefined)
            .finally(() => {
              sessionActiveRef.current = false;
              void saveNow();
              render();
            });
        });
    }

    function update(dt: number): void {
      const state = stateRef.current;
      state.elapsed += dt;
      state.spawnIn -= dt;
      if (state.spawnIn <= 0) {
        spawnStar();
        state.spawnIn = Math.max(0.34, 0.95 - state.elapsed * 0.008);
      }
      const { width, height } = renderer.size();
      const basketWidth = Math.min(128, Math.max(64, width * 0.16));
      const basketX = state.basket * width;
      const basketTop = height - Math.max(42, height * 0.08);
      const scale = Math.min(width, height) / 540;
      const survivors: GameState['stars'] = [];
      for (const star of state.stars) {
        star.y += star.vy * dt;
        const x = star.x * width;
        const y = star.y * height;
        const radius = Math.max(4, star.r * scale);
        if (
          y + radius * 0.6 >= basketTop &&
          y - radius <= basketTop + 28 &&
          Math.abs(x - basketX) <= basketWidth / 2 + radius
        ) {
          state.score += 10;
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

    function saveNow(): Promise<void> {
      if (phaseRef.current === 'loading' || phaseRef.current === 'error') return Promise.resolve();
      if (saveRef.current) return saveRef.current;
      saveRef.current = game.storage
        .save('current', serializeState(stateRef.current) as unknown as JsonValue)
        .then(() => undefined)
        .catch((error: unknown) => {
          if (isGameError(error) && (error.code === 'GM-4031' || error.code === 'GM-4032')) return;
          showToast(i18nRef.current.t('saveFailed', { code: isGameError(error) ? error.code : 'GM-5000' }), true, 3600);
        })
        .finally(() => {
          saveRef.current = null;
        });
      return saveRef.current;
    }

    function ensureSession(): void {
      if (sessionActiveRef.current) return;
      game.session
        .start()
        .then(() => {
          sessionActiveRef.current = true;
        })
        .catch((error: unknown) => {
          if (isGameError(error) && (error.code === 'GM-4033' || error.code === 'GM-4093')) return;
          showToast(isGameError(error) ? error.code : 'GM-5000', true);
        });
    }

    function beginOrContinue(): void {
      if (phaseRef.current !== 'ready') return;
      canContinueRef.current = false;
      setCanContinue(false);
      setPhaseSafe('playing');
      ensureSession();
      loop.start();
      render();
    }

    function startFreshGame(): void {
      stateRef.current = createInitialState();
      canContinueRef.current = false;
      setCanContinue(false);
      phaseRef.current = 'ready';
      void game.storage.remove('current').catch(() => undefined);
      beginOrContinue();
    }

    function restartGame(): void {
      stateRef.current = createInitialState();
      sessionActiveRef.current = false;
      canContinueRef.current = false;
      setCanContinue(false);
      setPhaseSafe('playing');
      ensureSession();
      loop.start();
      render();
    }

    function onKeyDown(event: KeyboardEvent): void {
      const state = stateRef.current;
      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
        if (phaseRef.current === 'playing') state.basket = Math.max(0, state.basket - 0.055);
        event.preventDefault();
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
        if (phaseRef.current === 'playing') state.basket = Math.min(1, state.basket + 0.055);
        event.preventDefault();
        return;
      }
      if (event.key === ' ' || event.key === 'Enter') {
        if (phaseRef.current === 'ready') beginOrContinue();
        else if (phaseRef.current === 'over') restartGame();
        event.preventDefault();
        return;
      }
      if ((event.key === 'n' || event.key === 'N') && phaseRef.current === 'ready' && canContinueRef.current) {
        startFreshGame();
        event.preventDefault();
      }
      // Escape and Tab are intentionally left to the Runtime/browser.
    }

    function onPointerMove(event: PointerEvent): void {
      if (phaseRef.current !== 'playing') return;
      const rect = canvas.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      stateRef.current.basket = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    }

    function onPointerDown(event: PointerEvent): void {
      canvas.focus({ preventScroll: true });
      onPointerMove(event);
      if (phaseRef.current === 'ready') beginOrContinue();
      else if (phaseRef.current === 'over') restartGame();
    }

    function pauseLocally(): void {
      if (phaseRef.current !== 'playing') return;
      loop.stop();
      setPhaseSafe('paused');
      void saveNow();
      render();
    }

    function onVisibility(): void {
      if (document.hidden) pauseLocally();
      else render();
    }

    function onResize(): void {
      renderer.resize();
      render();
    }

    canvas.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', pauseLocally);
    document.addEventListener('visibilitychange', onVisibility);

    offList.push(
      game.lifecycle.on('pause', () => {
        if (phaseRef.current === 'playing') pauseLocally();
        else void saveNow();
      })
    );
    offList.push(
      game.lifecycle.on('resume', () => {
        if (phaseRef.current === 'paused') {
          setPhaseSafe('playing');
          loop.start();
          render();
        } else if (phaseRef.current === 'ready') {
          beginOrContinue();
        }
      })
    );
    offList.push(
      game.lifecycle.on('hidden', () => {
        if (phaseRef.current === 'playing') pauseLocally();
        else loop.stop();
      })
    );
    offList.push(game.lifecycle.on('visible', () => render()));
    offList.push(game.lifecycle.on('before-save', () => void saveNow()));
    offList.push(
      game.onError((error) => {
        errorCodeRef.current = error.code;
        errorMessageRef.current = error.message;
        loop.stop();
        setPhaseSafe('error');
        render();
      })
    );

    void (async () => {
      try {
        const info = await game.ready();
        i18nRef.current = createI18n(info.locale);
        document.documentElement.dataset.theme = info.theme === 'light' ? 'light' : 'dark';
        renderer.resize();
        try {
          const best = await game.score.getBest();
          bestRef.current = best && typeof best.score === 'number' ? best.score : null;
        } catch (error) {
          if (!isGameError(error) || error.code !== 'GM-4032') {
            showToast(i18nRef.current.t('saveFailed', { code: isGameError(error) ? error.code : 'GM-5000' }), true);
          }
        }
        let restored: GameState | null = null;
        try {
          const saved = await game.storage.load('current');
          if (saved) restored = deserializeState(saved.data);
        } catch (error) {
          if (!isGameError(error) || error.code !== 'GM-4032') {
            showToast(i18nRef.current.t('saveFailed', { code: isGameError(error) ? error.code : 'GM-5000' }), true);
          }
        }
        stateRef.current = restored ?? createInitialState();
        canContinueRef.current = Boolean(restored);
        setCanContinue(Boolean(restored));
        setPhaseSafe('ready');
        canvas.focus({ preventScroll: true });
        render();
      } catch (error) {
        errorCodeRef.current = isGameError(error) ? error.code : 'GM-5000';
        errorMessageRef.current = error instanceof Error ? error.message : '';
        setPhaseSafe('error');
        render();
      }
    })();

    return () => {
      loop.stop();
      loopRef.current = null;
      rendererRef.current = null;
      for (const off of offList) off();
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', pauseLocally);
      document.removeEventListener('visibilitychange', onVisibility);
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const i18n = i18nRef.current;
  const hint = hintFor(phase, canContinue, i18n);
  const time = `${Math.floor(hud.time / 60)}:${String(hud.time % 60).padStart(2, '0')}`;

  return (
    <main className="app">
      <header className="app-header">
        <span className="app-title">{i18n.t('title')}</span>
        <span className="app-stats" aria-hidden="true">
          {i18n.t('score')} {hud.score} · {i18n.t('best')} {hud.best === null ? '—' : hud.best} · {i18n.t('lives')}{' '}
          {'●'.repeat(Math.max(0, hud.lives)) || '—'} · {i18n.t('time')} {time}
        </span>
      </header>
      <canvas ref={canvasRef} className="game-canvas" tabIndex={0} aria-label={i18n.t('title')} />
      <footer className="app-footer">
        <span>{hint}</span>
        <span className={`phase phase-${phase}`}>{phase}</span>
      </footer>
      {toast ? <div className={`toast ${toast.error ? 'toast-error' : ''}`}>{toast.text}</div> : null}
      <p className="sr-only" aria-live="polite">
        {i18n.t('score')}: {hud.score}, {i18n.t('lives')}: {hud.lives}, {i18n.t('time')}: {time}
      </p>
    </main>
  );
}
