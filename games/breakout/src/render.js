/**
 * Canvas presentation layer for Breakout. Visual-only: it reads the pure state
 * produced by logic.js and never changes gameplay. Theme, reduced-motion and
 * locale come from the SDK runtime.
 */

import { BALL, FIELD, LEVELS, PADDLE, LOGICAL_HEIGHT, LOGICAL_WIDTH, brickRect, currentSpeed } from './logic.js';

const FONT_SANS =
  'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const FONT_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

const PALETTES = {
  dark: {
    bgTop: '#060a12',
    bgBottom: '#04060b',
    glowA: 'rgba(34, 211, 238, 0.18)',
    glowB: 'rgba(167, 139, 250, 0.16)',
    panelTop: '#0c1626',
    panelBottom: '#070d18',
    fieldTop: '#0a1320',
    fieldBottom: '#060b14',
    fieldBorder: 'rgba(148, 197, 255, 0.18)',
    fieldLine: 'rgba(148, 197, 255, 0.055)',
    text: '#eaf2ff',
    muted: '#8fa3bf',
    faint: 'rgba(143, 163, 191, 0.45)',
    accent: '#22d3ee',
    accent2: '#a78bfa',
    success: '#34d399',
    danger: '#fb7185',
    panel: 'rgba(13, 23, 40, 0.82)',
    panelBorder: 'rgba(148, 197, 255, 0.16)',
    ballCore: '#f8fafc',
    ballRim: '#67e8f9',
    ballGlow: 'rgba(103, 232, 249, 0.5)',
    paddleTop: '#67e8f9',
    paddleBottom: '#0ea5e9',
    paddleGlow: 'rgba(34, 211, 238, 0.5)',
    bricks: {
      normal: { top: '#34d399', bottom: '#0f766e', edge: '#a7f3d0', glow: 'rgba(52, 211, 153, 0.36)' },
      hard: { top: '#fbbf24', bottom: '#b45309', edge: '#fde68a', glow: 'rgba(251, 191, 36, 0.36)' },
      solid: { top: '#64748b', bottom: '#334155', edge: '#cbd5e1', glow: 'rgba(148, 163, 184, 0.2)' },
    },
  },
  light: {
    bgTop: '#eef4fb',
    bgBottom: '#e2ebf6',
    glowA: 'rgba(8, 145, 178, 0.12)',
    glowB: 'rgba(124, 58, 237, 0.1)',
    panelTop: '#ffffff',
    panelBottom: '#f1f6fd',
    fieldTop: '#fbfdff',
    fieldBottom: '#eaf2fb',
    fieldBorder: 'rgba(15, 23, 42, 0.14)',
    fieldLine: 'rgba(15, 23, 42, 0.055)',
    text: '#0b1220',
    muted: '#4c5f78',
    faint: 'rgba(76, 95, 120, 0.42)',
    accent: '#0891b2',
    accent2: '#7c3aed',
    success: '#047857',
    danger: '#be123c',
    panel: 'rgba(255, 255, 255, 0.88)',
    panelBorder: 'rgba(15, 23, 42, 0.1)',
    ballCore: '#0f172a',
    ballRim: '#0e7490',
    ballGlow: 'rgba(8, 145, 178, 0.32)',
    paddleTop: '#0891b2',
    paddleBottom: '#0e7490',
    paddleGlow: 'rgba(8, 145, 178, 0.34)',
    bricks: {
      normal: { top: '#10b981', bottom: '#047857', edge: '#a7f3d0', glow: 'rgba(5, 150, 105, 0.24)' },
      hard: { top: '#f59e0b', bottom: '#b45309', edge: '#fde68a', glow: 'rgba(217, 119, 6, 0.24)' },
      solid: { top: '#64748b', bottom: '#475569', edge: '#e2e8f0', glow: 'rgba(71, 85, 105, 0.18)' },
    },
  },
};

const LABELS = {
  zh: {
    score: '得分',
    best: '最高',
    level: '关卡',
    lives: '生命',
    speed: '球速',
    serve: '按 SPACE 或点击发射',
    levelWord: '关',
  },
  en: {
    score: 'SCORE',
    best: 'BEST',
    level: 'LEVEL',
    lives: 'LIVES',
    speed: 'SPEED',
    serve: 'PRESS SPACE OR CLICK TO LAUNCH',
    levelWord: 'LEVEL',
  },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function formatScore(value) {
  const safe = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
  return String(safe).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function labelSet(locale) {
  return typeof locale === 'string' && locale.toLowerCase().indexOf('zh') === 0 ? LABELS.zh : LABELS.en;
}

function levelName(levelNumber, lang) {
  const level = LEVELS[clamp(levelNumber - 1, 0, LEVELS.length - 1)] || LEVELS[0];
  return lang === 'zh' ? level.nameZh : level.nameEn;
}

function makeStars(count) {
  const stars = [];
  let seed = 0x51f15e;
  for (let index = 0; index < count; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = 26 + ((seed >>> 8) % 908);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const y = 96 + ((seed >>> 8) % 420);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const size = 1 + ((seed >>> 20) % 18) / 10;
    stars.push({ x, y, size, phase: (seed % 100) / 100 });
  }
  return stars;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const stars = makeStars(30);
  let palette = PALETTES.dark;
  let dpr = 1;
  let particles = [];
  let flashLife = 0;
  let lastState = null;
  let lastOptions = null;

  function resize() {
    dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = Math.round(LOGICAL_WIDTH * dpr);
    canvas.height = Math.round(LOGICAL_HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (lastState) draw(lastState, lastOptions || {});
  }

  function drawBackground(now, options) {
    const bg = ctx.createLinearGradient(0, 0, 0, LOGICAL_HEIGHT);
    bg.addColorStop(0, palette.bgTop);
    bg.addColorStop(1, palette.bgBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    const glowA = ctx.createRadialGradient(170, -60, 20, 170, -60, 560);
    glowA.addColorStop(0, palette.glowA);
    glowA.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glowA;
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    const glowB = ctx.createRadialGradient(820, 620, 40, 820, 620, 600);
    glowB.addColorStop(0, palette.glowB);
    glowB.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glowB;
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    for (const star of stars) {
      const pulse =
        options.reducedMotion === true ? 0.5 : 0.35 + 0.35 * Math.sin(now / 900 + star.phase * Math.PI * 2);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = palette.accent;
      ctx.fillRect(star.x, star.y, star.size, star.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawLogo() {
    const x = 26;
    const y = 15;
    const gradient = ctx.createLinearGradient(x, y, x + 30, y + 30);
    gradient.addColorStop(0, palette.accent);
    gradient.addColorStop(1, palette.accent2);
    ctx.save();
    ctx.shadowColor = palette.accent;
    ctx.shadowBlur = 16;
    roundRect(ctx, x, y, 30, 30, 9);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(4, 10, 18, 0.72)';
    roundRect(ctx, x + 7, y + 8, 16, 4, 2);
    ctx.fill();
    roundRect(ctx, x + 7, y + 15, 7, 4, 2);
    ctx.fill();
    roundRect(ctx, x + 16, y + 15, 7, 4, 2);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.fillStyle = palette.text;
    ctx.font = `800 16px ${FONT_MONO}`;
    ctx.fillText('BREAKOUT', x + 40, 34);
    ctx.fillStyle = palette.muted;
    ctx.font = `600 10px ${FONT_SANS}`;
    ctx.fillText('ARCADE / 打砖块', x + 40, 49);
  }

  function drawStat(label, value, rightX, y) {
    ctx.textAlign = 'right';
    ctx.fillStyle = palette.muted;
    ctx.font = `700 9px ${FONT_SANS}`;
    ctx.fillText(label, rightX, y);
    ctx.fillStyle = palette.text;
    ctx.font = `700 21px ${FONT_MONO}`;
    ctx.fillText(formatScore(value), rightX, y + 24);
  }

  function drawLevelPill(state, lang) {
    const width = 196;
    const height = 46;
    const x = (LOGICAL_WIDTH - width) / 2;
    const y = 10;
    roundRect(ctx, x, y, width, height, 14);
    ctx.fillStyle = palette.panel;
    ctx.fill();
    ctx.strokeStyle = palette.panelBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = palette.accent;
    ctx.font = `700 9px ${FONT_SANS}`;
    const word = lang === 'zh' ? '关卡' : 'LEVEL';
    ctx.fillText(`${word} ${String(state.level).padStart(2, '0')} / ${String(LEVELS.length).padStart(2, '0')}`, 480, y + 17);
    ctx.fillStyle = palette.text;
    ctx.font = `700 14px ${FONT_SANS}`;
    ctx.fillText(levelName(state.level, lang), 480, y + 35);
  }

  function drawLivesAndSpeed(state, lang) {
    const labels = LABELS[lang];
    ctx.textAlign = 'left';
    ctx.fillStyle = palette.muted;
    ctx.font = `700 9px ${FONT_SANS}`;
    ctx.fillText(labels.lives, 26, 72);
    const startX = 64;
    for (let index = 0; index < 3; index += 1) {
      const alive = index < state.lives;
      roundRect(ctx, startX + index * 27, 64, 19, 8, 4);
      if (alive) {
        ctx.fillStyle = palette.accent;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.strokeStyle = palette.faint;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = palette.muted;
    ctx.font = `700 9px ${FONT_SANS}`;
    const speed = (currentSpeed(state) / BALL.baseSpeed).toFixed(2);
    ctx.fillText(`${labels.speed} ×${speed}`, LOGICAL_WIDTH - 26, 72);

    const dotY = 68;
    const total = LEVELS.length;
    const spacing = 12;
    const start = 480 - ((total - 1) * spacing) / 2;
    for (let index = 0; index < total; index += 1) {
      const reached = index + 1 < state.level;
      const active = index + 1 === state.level;
      ctx.beginPath();
      ctx.arc(start + index * spacing, dotY, active ? 3.4 : 2.4, 0, Math.PI * 2);
      ctx.fillStyle = active ? palette.accent : reached ? palette.success : palette.faint;
      ctx.fill();
    }
  }

  function drawField() {
    ctx.save();
    roundRect(ctx, FIELD.left - 10, FIELD.top + 5, FIELD.right - FIELD.left + 20, FIELD.bottom - FIELD.top + 16, 20);
    ctx.fillStyle = palette.panel;
    ctx.fill();
    ctx.strokeStyle = palette.fieldBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    roundRect(ctx, FIELD.left, FIELD.top, FIELD.right - FIELD.left, FIELD.bottom - FIELD.top, 14);
    const gradient = ctx.createLinearGradient(0, FIELD.top, 0, FIELD.bottom);
    gradient.addColorStop(0, palette.fieldTop);
    gradient.addColorStop(1, palette.fieldBottom);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.save();
    ctx.clip();

    ctx.strokeStyle = palette.fieldLine;
    ctx.lineWidth = 1;
    for (let x = FIELD.left + 36; x < FIELD.right; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, FIELD.top);
      ctx.lineTo(x, FIELD.bottom);
      ctx.stroke();
    }
    for (let y = FIELD.top + 36; y < FIELD.bottom; y += 48) {
      ctx.beginPath();
      ctx.moveTo(FIELD.left, y);
      ctx.lineTo(FIELD.right, y);
      ctx.stroke();
    }

    const topLine = ctx.createLinearGradient(FIELD.left, 0, FIELD.right, 0);
    topLine.addColorStop(0, 'rgba(34, 211, 238, 0)');
    topLine.addColorStop(0.5, palette.accent);
    topLine.addColorStop(1, 'rgba(34, 211, 238, 0)');
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = topLine;
    ctx.fillRect(FIELD.left, FIELD.top, FIELD.right - FIELD.left, 1.5);
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.restore();
  }

  function brickColors(brick) {
    const set = palette.bricks[brick.type] || palette.bricks.normal;
    return set;
  }

  function drawBrick(brick) {
    const rect = brickRect(brick);
    const colors = brickColors(brick);
    const inset = 0.75;
    const x = rect.x + inset;
    const y = rect.y + inset;
    const width = rect.width - inset * 2;
    const height = rect.height - inset * 2;

    ctx.save();
    ctx.shadowColor = colors.glow;
    ctx.shadowBlur = 9;
    roundRect(ctx, x, y, width, height, 5);
    const gradient = ctx.createLinearGradient(0, y, 0, y + height);
    gradient.addColorStop(0, colors.top);
    gradient.addColorStop(1, colors.bottom);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, x, y, width, height, 5);
    ctx.clip();

    const shine = ctx.createLinearGradient(0, y, 0, y + height * 0.55);
    shine.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
    shine.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = shine;
    ctx.fillRect(x, y, width, height * 0.55);

    if (brick.type === 'hard') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 1.4;
      const gap = width / 3;
      for (let index = 1; index <= 2; index += 1) {
        ctx.beginPath();
        ctx.moveTo(x + gap * index, y + 5);
        ctx.lineTo(x + gap * index, y + height - 5);
        ctx.stroke();
      }
      if (brick.hp < 2) {
        ctx.strokeStyle = 'rgba(12, 18, 30, 0.55)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(x + width * 0.32, y + 1);
        ctx.lineTo(x + width * 0.46, y + height * 0.4);
        ctx.lineTo(x + width * 0.36, y + height * 0.62);
        ctx.lineTo(x + width * 0.52, y + height - 1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + width * 0.68, y + height - 1);
        ctx.lineTo(x + width * 0.58, y + height * 0.52);
        ctx.stroke();
      }
    } else if (brick.type === 'solid') {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 2;
      for (let offset = -height; offset < width + height; offset += 8) {
        ctx.beginPath();
        ctx.moveTo(x + offset, y + height);
        ctx.lineTo(x + offset + height, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(15, 23, 42, 0.42)';
      roundRect(ctx, x + width / 2 - 9, y + height / 2 - 3, 18, 6, 3);
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 1;
      roundRect(ctx, x + 5, y + 4, width - 10, height - 8, 3);
      ctx.stroke();
    }
    ctx.restore();

    roundRect(ctx, x, y, width, height, 5);
    ctx.strokeStyle = colors.edge;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawPaddle(state) {
    const x = state.paddle.x - PADDLE.width / 2;
    const y = PADDLE.y;
    ctx.save();
    ctx.shadowColor = palette.paddleGlow;
    ctx.shadowBlur = 20;
    roundRect(ctx, x, y, PADDLE.width, PADDLE.height, 7);
    const gradient = ctx.createLinearGradient(0, y, 0, y + PADDLE.height);
    gradient.addColorStop(0, palette.paddleTop);
    gradient.addColorStop(1, palette.paddleBottom);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();

    roundRect(ctx, x + 2, y + 2, PADDLE.width - 4, 3, 1.5);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fill();

    ctx.strokeStyle = 'rgba(4, 12, 20, 0.35)';
    ctx.lineWidth = 1.5;
    for (let index = -1; index <= 1; index += 1) {
      const cx = state.paddle.x + index * 9;
      ctx.beginPath();
      ctx.moveTo(cx, y + 5);
      ctx.lineTo(cx, y + PADDLE.height - 5);
      ctx.stroke();
    }
  }

  function drawBall(state, options) {
    const ball = state.ball;
    if (state.status === 'won' || state.status === 'over') return;

    if (!options.reducedMotion && ball.launched) {
      for (let index = 1; index <= 3; index += 1) {
        const factor = index * 0.011;
        ctx.globalAlpha = 0.2 / index;
        ctx.beginPath();
        ctx.arc(ball.x - ball.vx * factor, ball.y - ball.vy * factor, BALL.radius * (1 - index * 0.16), 0, Math.PI * 2);
        ctx.fillStyle = palette.ballRim;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    const glow = ctx.createRadialGradient(ball.x, ball.y, 1, ball.x, ball.y, BALL.radius * 3.1);
    glow.addColorStop(0, palette.ballGlow);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL.radius * 3.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL.radius, 0, Math.PI * 2);
    const core = ctx.createRadialGradient(
      ball.x - BALL.radius * 0.35,
      ball.y - BALL.radius * 0.35,
      0.5,
      ball.x,
      ball.y,
      BALL.radius,
    );
    core.addColorStop(0, palette.ballCore);
    core.addColorStop(1, palette.ballRim);
    ctx.fillStyle = core;
    ctx.fill();
    ctx.strokeStyle = palette.ballRim;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawServeHint(state, options) {
    if (options.overlay || state.status !== 'ready' || state.ball.launched) return;
    const labels = LABELS[options.lang || 'en'];
    const pulse = options.reducedMotion ? 0.85 : 0.62 + 0.24 * Math.sin(options.now / 420);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.font = `700 11px ${FONT_MONO}`;
    const width = Math.min(420, ctx.measureText(labels.serve).width + 36);
    const x = 480 - width / 2;
    const y = 430;
    roundRect(ctx, x, y, width, 30, 15);
    ctx.fillStyle = palette.panel;
    ctx.fill();
    ctx.strokeStyle = palette.panelBorder;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = palette.text;
    ctx.textAlign = 'center';
    ctx.fillText(labels.serve, 480, y + 19);
    ctx.restore();
  }

  function drawParticles() {
    for (const particle of particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
    }
    ctx.globalAlpha = 1;
    if (flashLife > 0) {
      const alpha = (flashLife / 480) * 0.3;
      const vignette = ctx.createRadialGradient(480, 300, 120, 480, 300, 560);
      vignette.addColorStop(0, 'rgba(0,0,0,0)');
      vignette.addColorStop(1, palette.danger);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      ctx.globalAlpha = 1;
    }
  }

  function drawBanner(options) {
    const banner = options.banner;
    if (!banner) return;
    const now = options.now;
    const age = now - banner.startedAt;
    if (age < 0 || age > banner.duration) return;
    const fadeIn = Math.min(1, age / 180);
    const fadeOut = Math.min(1, (banner.duration - age) / 220);
    const alpha = Math.max(0, Math.min(fadeIn, fadeOut));
    const scale = options.reducedMotion ? 1 : 0.94 + 0.06 * Math.min(1, age / 220);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(480, 276);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';

    ctx.fillStyle = palette.panel;
    roundRect(ctx, -190, -58, 380, 116, 20);
    ctx.fill();
    ctx.strokeStyle = palette.panelBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = palette.accent;
    ctx.font = `800 10px ${FONT_MONO}`;
    ctx.fillText(banner.kicker || '', 0, -30);
    ctx.fillStyle = palette.text;
    ctx.font = `800 34px ${FONT_SANS}`;
    ctx.fillText(banner.title || '', 0, 8);
    if (banner.subtitle) {
      ctx.fillStyle = palette.muted;
      ctx.font = `600 12px ${FONT_SANS}`;
      ctx.fillText(banner.subtitle, 0, 34);
    }

    const line = ctx.createLinearGradient(-110, 0, 110, 0);
    line.addColorStop(0, 'rgba(34, 211, 238, 0)');
    line.addColorStop(0.5, palette.accent);
    line.addColorStop(1, 'rgba(34, 211, 238, 0)');
    ctx.fillStyle = line;
    ctx.fillRect(-110, 46, 220, 1.5);
    ctx.restore();
  }

  function draw(state, options) {
    lastState = state;
    lastOptions = options;
    palette = PALETTES[options.theme === 'light' ? 'light' : 'dark'];
    const lang = options.lang || 'en';
    const labels = LABELS[lang];

    ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    drawBackground(options.now, options);
    drawLogo();
    drawLevelPill(state, lang);
    drawStat(labels.score, state.score, 934, 22);
    drawStat(labels.best, options.best, 826, 22);
    drawLivesAndSpeed(state, lang);

    ctx.strokeStyle = palette.fieldBorder;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(26, 84);
    ctx.lineTo(934, 84);
    ctx.stroke();
    ctx.globalAlpha = 1;

    drawField();
    for (const brick of state.bricks) drawBrick(brick);
    drawPaddle(state);
    drawBall(state, options);
    drawServeHint(state, options);
    drawParticles();
    drawBanner(options);
  }

  function update(dtMs, reducedMotion) {
    const dt = Math.max(0, Math.min(80, dtMs));
    if (flashLife > 0) flashLife = Math.max(0, flashLife - dt);
    if (reducedMotion) {
      particles = [];
      return;
    }
    for (const particle of particles) {
      particle.life -= dt;
      particle.x += (particle.vx * dt) / 1000;
      particle.y += (particle.vy * dt) / 1000;
      particle.vy += (720 * dt) / 1000;
      particle.vx *= 0.995;
    }
    particles = particles.filter((particle) => particle.life > 0);
  }

  function burst(x, y, type, count) {
    if (lastOptions && lastOptions.reducedMotion) return;
    const colors = palette.bricks[type] || palette.bricks.normal;
    const total = typeof count === 'number' ? count : 10;
    for (let index = 0; index < total; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 150;
      const life = 260 + Math.random() * 260;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        life,
        maxLife: life,
        size: 2 + Math.random() * 3,
        color: index % 3 === 0 ? colors.edge : colors.top,
      });
    }
    if (particles.length > 160) particles = particles.slice(particles.length - 160);
  }

  function flash() {
    flashLife = 480;
  }

  window.addEventListener('resize', resize);
  resize();

  return {
    draw,
    update,
    burst,
    flash,
    resize,
  };
}
