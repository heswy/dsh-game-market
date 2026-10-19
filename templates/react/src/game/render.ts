/**
 * Canvas renderer for the React template. React never re-renders per frame:
 * the loop calls `renderer.draw()` and React state only changes on phase/HUD
 * updates (PRD §8.2.9 items 5–6 and §8.3 "游戏状态放 useRef").
 */

import type { GameState } from './storage';

export type Phase = 'loading' | 'ready' | 'playing' | 'paused' | 'over' | 'error';

export interface DrawModel {
  state: GameState;
  phase: Phase;
  strings: {
    title: string;
    score: string;
    best: string;
    lives: string;
    time: string;
    loading: string;
    ready: string;
    readyHint: string;
    continueHint: string;
    paused: string;
    pausedHint: string;
    gameOver: string;
    finalScore: string;
    restartHint: string;
    error: string;
  };
  best: number | null;
  canContinue: boolean;
  errorMessage?: string;
}

export interface Renderer {
  resize(): { width: number; height: number; dpr: number };
  draw(model: DrawModel): void;
  size(): { width: number; height: number };
}

const COLORS = {
  text: '#e8edf2',
  muted: '#8b95a1',
  accent: '#34d399',
  star: '#fbbf24',
  danger: '#fb7185',
  panel: 'rgba(18, 20, 24, 0.9)',
  border: 'rgba(255, 255, 255, 0.12)',
  stage: '#0b0c0e',
};

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable');
  const ctx: CanvasRenderingContext2D = context;
  let width = 960;
  let height = 540;
  let dpr = 1;

  function resize(): { width: number; height: number; dpr: number } {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width || 960));
    height = Math.max(1, Math.round(rect.height || 540));
    dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height, dpr };
  }

  function drawBackdrop(): void {
    ctx.fillStyle = COLORS.stage;
    ctx.fillRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(52, 211, 153, 0.08)');
    gradient.addColorStop(1, 'rgba(96, 165, 250, 0.06)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function drawHud(model: DrawModel): void {
    const minutes = Math.floor(model.state.elapsed / 60);
    const seconds = Math.floor(model.state.elapsed % 60);
    const items: Array<[string, string, string]> = [
      [model.strings.score, String(Math.round(model.state.score)), COLORS.accent],
      [model.strings.best, model.best === null ? '—' : String(Math.round(model.best)), COLORS.star],
      [model.strings.lives, '●'.repeat(Math.max(0, model.state.lives)) || '—', COLORS.danger],
      [model.strings.time, `${minutes}:${String(seconds).padStart(2, '0')}`, COLORS.muted],
    ];
    let x = 18;
    ctx.textBaseline = 'middle';
    for (const [label, value, color] of items) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = '500 11px ui-sans-serif, -apple-system, "PingFang SC", sans-serif';
      ctx.fillText(label, x, 128);
      ctx.fillStyle = color;
      ctx.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(value, x, 148);
      x += Math.max(ctx.measureText(label).width, ctx.measureText(value).width) + 28;
    }
  }

  function drawWorld(state: GameState): void {
    const scale = Math.min(width, height) / 540;
    for (const star of state.stars) {
      const x = star.x * width;
      const y = star.y * height;
      const radius = Math.max(4, star.r * scale);
      ctx.save();
      ctx.shadowColor = COLORS.star;
      ctx.shadowBlur = 16;
      ctx.fillStyle = COLORS.star;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const basketWidth = Math.min(128, Math.max(64, width * 0.16));
    const basketHeight = Math.max(14, height * 0.035);
    const x = state.basket * width;
    const y = height - Math.max(42, height * 0.08);
    ctx.save();
    ctx.shadowColor = COLORS.accent;
    ctx.shadowBlur = 20;
    ctx.fillStyle = COLORS.accent;
    rounded(ctx, x - basketWidth / 2, y, basketWidth, basketHeight, 8);
    ctx.fill();
    ctx.restore();
  }

  function panel(title: string, lines: string[], danger = false): void {
    const maxWidth = Math.min(width - 48, 460);
    const padding = 24;
    ctx.save();
    ctx.font = '13px ui-sans-serif, -apple-system, "PingFang SC", sans-serif';
    const body = lines.filter(Boolean);
    const panelHeight = padding * 2 + 38 + body.length * 22;
    const x = (width - maxWidth) / 2;
    const y = (height - panelHeight) / 2;
    ctx.fillStyle = COLORS.panel;
    rounded(ctx, x, y, maxWidth, panelHeight, 16);
    ctx.fill();
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = danger ? COLORS.danger : COLORS.text;
    ctx.font = '600 24px ui-sans-serif, -apple-system, "PingFang SC", sans-serif';
    ctx.fillText(title, width / 2, y + padding);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '13px ui-sans-serif, -apple-system, "PingFang SC", sans-serif';
    body.forEach((line, index) => {
      ctx.fillText(line, width / 2, y + padding + 38 + index * 22, maxWidth - padding * 2);
    });
    ctx.restore();
  }

  function draw(model: DrawModel): void {
    drawBackdrop();
    drawWorld(model.state);
    drawHud(model);
    if (model.phase === 'loading') panel(model.strings.loading, []);
    else if (model.phase === 'paused') panel(model.strings.paused, [model.strings.pausedHint]);
    else if (model.phase === 'ready') {
      panel(model.strings.ready, [model.strings.readyHint, model.canContinue ? model.strings.continueHint : '']);
    } else if (model.phase === 'over') {
      panel(model.strings.gameOver, [
        `${model.strings.finalScore}: ${Math.round(model.state.score)}`,
        `${model.strings.best}: ${model.best === null ? '—' : Math.round(model.best)}`,
        model.strings.restartHint,
      ]);
    } else if (model.phase === 'error') {
      panel(model.strings.error, [model.errorMessage || 'GM-5000'], true);
    }
  }

  return {
    resize,
    draw,
    size() {
      return { width, height };
    },
  };
}
