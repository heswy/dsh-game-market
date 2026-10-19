/**
 * Canvas renderer (PRD §8.2.9 items 5–6).
 *
 * - DPR-aware backing store, capped at 2 (item 6);
 * - logical size follows the actual canvas, including narrow/short panels;
 * - palette read from CSS custom properties so light/dark themes follow DSH;
 * - no external images or fonts.
 */

const DEFAULT_PALETTE = {
  text: '#e8edf2',
  muted: '#8b95a1',
  accent: '#34d399',
  accentStrong: '#a7f3d0',
  star: '#fbbf24',
  danger: '#fb7185',
  panel: 'rgba(18, 20, 24, 0.86)',
  border: 'rgba(255, 255, 255, 0.12)',
  stage: '#0b0c0e',
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

export function createRenderer(canvas, options = {}) {
  const context = canvas.getContext('2d');
  let width = 960;
  let height = 540;
  let dpr = 1;
  let palette = { ...DEFAULT_PALETTE };
  let paletteRead = false;

  function refreshPalette() {
    try {
      const style = getComputedStyle(canvas);
      const read = (name, fallback) => {
        const value = style.getPropertyValue(name).trim();
        return value || fallback;
      };
      palette = {
        text: read('--text', DEFAULT_PALETTE.text),
        muted: read('--muted', DEFAULT_PALETTE.muted),
        accent: read('--accent', DEFAULT_PALETTE.accent),
        accentStrong: read('--accent-strong', DEFAULT_PALETTE.accentStrong),
        star: read('--star', DEFAULT_PALETTE.star),
        danger: read('--danger', DEFAULT_PALETTE.danger),
        panel: read('--panel', DEFAULT_PALETTE.panel),
        border: read('--border', DEFAULT_PALETTE.border),
        stage: read('--stage', DEFAULT_PALETTE.stage),
      };
      paletteRead = true;
    } catch (_error) {
      palette = { ...DEFAULT_PALETTE };
    }
  }

  function resize() {
    const rect = typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
    const rawWidth = (rect && rect.width) || canvas.clientWidth || options.width || 960;
    const rawHeight = (rect && rect.height) || canvas.clientHeight || options.height || 540;
    width = Math.max(1, Math.round(rawWidth));
    height = Math.max(1, Math.round(rawHeight));
    const ratio = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    dpr = clamp(Number(ratio) || 1, 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    refreshPalette();
    return { width, height, dpr };
  }

  function drawBackdrop() {
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, 'rgba(52, 211, 153, 0.08)');
    gradient.addColorStop(0.55, palette.stage);
    gradient.addColorStop(1, 'rgba(14, 165, 233, 0.06)');
    context.fillStyle = palette.stage;
    context.fillRect(0, 0, width, height);
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    // Deterministic faint stars (no Math.random in the renderer).
    context.fillStyle = 'rgba(255, 255, 255, 0.10)';
    for (let index = 0; index < 48; index += 1) {
      const x = ((index * 97) % 101) / 101;
      const y = ((index * 53) % 97) / 97;
      const size = index % 5 === 0 ? 1.6 : 1;
      context.fillRect(Math.round(x * width), Math.round(y * height * 0.7), size, size);
    }
  }

  function drawHud(model) {
    const { state, i18n, best } = model;
    context.save();
    context.font = '600 13px ui-sans-serif, -apple-system, "PingFang SC", sans-serif';
    context.textBaseline = 'middle';
    const minutes = Math.floor(state.elapsed / 60);
    const seconds = Math.floor(state.elapsed % 60);
    const timeText = `${minutes}:${String(seconds).padStart(2, '0')}`;
    const items = [
      [i18n.t('score'), String(Math.round(state.score)), palette.accentStrong],
      [i18n.t('best'), best === null || best === undefined ? '—' : String(Math.round(best)), palette.star],
      [i18n.t('lives'), '●'.repeat(Math.max(0, state.lives)) || '—', palette.danger],
      [i18n.t('time'), timeText, palette.muted],
    ];
    let x = 18;
    for (const [label, value, color] of items) {
      context.fillStyle = palette.muted;
      context.font = '500 11px ui-sans-serif, -apple-system, "PingFang SC", sans-serif';
      const labelWidth = context.measureText(label).width;
      context.fillText(label, x, 128);
      context.fillStyle = color;
      context.font = '700 18px ui-monospace, SFMono-Regular, Menlo, monospace';
      context.fillText(value, x, 148);
      x += Math.max(labelWidth, context.measureText(value).width) + 28;
    }
    context.restore();
  }

  function drawStars(state, reducedMotion) {
    const radiusScale = Math.min(width, height) / 540;
    for (const star of state.stars) {
      const x = clamp(star.x, 0, 1) * width;
      const y = star.y * height;
      const radius = Math.max(4, star.r * radiusScale);
      if (y < -radius * 3 || y > height + radius * 3) continue;
      context.save();
      context.shadowColor = star.tone === 'meteor' ? palette.danger : palette.star;
      context.shadowBlur = reducedMotion ? 0 : 18;
      context.fillStyle = star.tone === 'meteor' ? palette.danger : palette.star;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 0.35;
      context.beginPath();
      context.arc(x, y, radius * 1.9, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }

  function drawBasket(state) {
    const basketWidth = clamp(width * 0.16, 64, 128);
    const basketHeight = clamp(height * 0.035, 14, 24);
    const x = clamp(state.basket, 0, 1) * width;
    const y = height - Math.max(42, height * 0.08);
    context.save();
    context.shadowColor = palette.accent;
    context.shadowBlur = 22;
    context.fillStyle = palette.accent;
    roundRect(context, x - basketWidth / 2, y, basketWidth, basketHeight, 8);
    context.fill();
    context.globalAlpha = 0.4;
    roundRect(context, x - basketWidth / 2, y + basketHeight + 3, basketWidth, 3, 2);
    context.fill();
    context.restore();
  }

  function wrapText(text, maxWidth) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (context.measureText(next).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function drawPanel(lines, options2 = {}) {
    const maxWidth = Math.min(width - 64, 460);
    const padding = 26;
    context.save();
    context.font = '600 26px ui-sans-serif, -apple-system, "PingFang SC", sans-serif';
    const title = lines[0] || '';
    context.font = '13px ui-sans-serif, -apple-system, "PingFang SC", sans-serif';
    const bodyLines = [];
    for (const line of lines.slice(1)) {
      bodyLines.push(...wrapText(line, maxWidth - padding * 2));
    }
    const titleHeight = title ? 36 : 0;
    const panelHeight = padding * 2 + titleHeight + bodyLines.length * 22;
    const panelWidth = maxWidth;
    const panelX = (width - panelWidth) / 2;
    const panelY = (height - panelHeight) / 2;
    context.globalAlpha = options2.alpha === undefined ? 0.94 : options2.alpha;
    context.fillStyle = palette.panel;
    roundRect(context, panelX, panelY, panelWidth, panelHeight, 18);
    context.fill();
    context.globalAlpha = 1;
    context.strokeStyle = palette.border;
    context.lineWidth = 1;
    context.stroke();
    let y = panelY + padding;
    if (title) {
      context.fillStyle = options2.danger ? palette.danger : palette.text;
      context.font = '600 26px ui-sans-serif, -apple-system, "PingFang SC", sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'top';
      context.fillText(title, width / 2, y);
      y += titleHeight;
    }
    context.fillStyle = palette.muted;
    context.font = '13px ui-sans-serif, -apple-system, "PingFang SC", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    for (const line of bodyLines) {
      context.fillText(line, width / 2, y);
      y += 22;
    }
    context.restore();
  }

  function drawToast(text, isError) {
    if (!text) return;
    context.save();
    context.font = '12px ui-sans-serif, -apple-system, "PingFang SC", sans-serif';
    const widthText = context.measureText(text).width;
    const boxWidth = Math.min(width - 32, widthText + 24);
    const x = 16;
    const y = height - 42;
    context.fillStyle = isError ? 'rgba(251, 113, 133, 0.16)' : 'rgba(52, 211, 153, 0.14)';
    roundRect(context, x, y, boxWidth, 26, 8);
    context.fill();
    context.fillStyle = isError ? palette.danger : palette.accentStrong;
    context.textBaseline = 'middle';
    context.fillText(text, x + 12, y + 13);
    context.restore();
  }

  function draw(model) {
    if (!paletteRead) refreshPalette();
    context.clearRect(0, 0, width, height);
    drawBackdrop();
    drawStars(model.state, model.reducedMotion === true);
    drawBasket(model.state);
    drawHud(model);

    if (model.phase === 'loading') {
      drawPanel([model.i18n.t('loading')]);
    } else if (model.phase === 'paused') {
      drawPanel([model.i18n.t('paused'), model.i18n.t('pausedHint')]);
    } else if (model.phase === 'ready') {
      const lines = [model.i18n.t('ready'), model.i18n.t('readyHint'), model.i18n.t('catchHint')];
      if (model.canContinue) lines.splice(1, 0, model.i18n.t('continueHint'));
      drawPanel(lines);
    } else if (model.phase === 'over') {
      drawPanel([
        model.i18n.t('gameOver'),
        `${model.i18n.t('finalScore')}: ${Math.round(model.state.score)}`,
        `${model.i18n.t('best')}: ${model.best === null || model.best === undefined ? '—' : Math.round(model.best)}`,
        model.i18n.t('restartHint'),
      ]);
    } else if (model.phase === 'error') {
      drawPanel([model.i18n.t('readyFailed', { code: model.errorCode || 'GM-5000' }), model.errorMessage || ''], {
        danger: true,
      });
    }

    drawToast(model.toast, model.toastIsError);
  }

  return {
    resize,
    draw,
    refreshPalette,
    getSize() {
      return { width, height, dpr };
    },
  };
}
