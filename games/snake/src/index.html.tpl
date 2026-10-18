<!doctype html>
<html lang="zh-CN" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark light" />
    <title>__GAME_TITLE__</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #07080a;
        --stage: #0b0c0e;
        --panel: rgba(18, 20, 24, 0.78);
        --panel-border: rgba(255, 255, 255, 0.08);
        --text: #e8edf2;
        --muted: #8b95a1;
        --accent: #34d399;
        --accent-strong: #a7f3d0;
        --food: #fbbf24;
        --danger: #fb7185;
        --grid: rgba(255, 255, 255, 0.035);
        --shadow: rgba(0, 0, 0, 0.55);
      }

      html[data-theme='light'] {
        color-scheme: light;
        --bg: #eef1f4;
        --stage: #f6f8fa;
        --panel: rgba(255, 255, 255, 0.82);
        --panel-border: rgba(15, 23, 42, 0.1);
        --text: #101418;
        --muted: #5b6673;
        --accent: #059669;
        --accent-strong: #065f46;
        --food: #d97706;
        --danger: #e11d48;
        --grid: rgba(15, 23, 42, 0.05);
        --shadow: rgba(15, 23, 42, 0.16);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: var(--bg);
        color: var(--text);
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
          'Microsoft YaHei', sans-serif;
      }

      #app {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        padding: 0;
        background:
          radial-gradient(120% 90% at 50% 0%, rgba(52, 211, 153, 0.08), transparent 60%),
          radial-gradient(90% 70% at 50% 100%, rgba(14, 165, 233, 0.06), transparent 65%),
          var(--bg);
      }

      .stage {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
      }

      #board {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        outline: none;
        touch-action: none;
      }

      .hud {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 18px 26px 0;
        pointer-events: none;
        z-index: 2;
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.22em;
        color: var(--muted);
        text-transform: uppercase;
      }

      .brand .dot {
        width: 9px;
        height: 9px;
        border-radius: 999px;
        background: var(--accent);
        box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.12);
      }

      .brand .version {
        letter-spacing: 0.08em;
        font-weight: 500;
        opacity: 0.7;
        text-transform: none;
      }

      .scores {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-left: auto;
      }

      .score-card {
        min-width: 86px;
        padding: 7px 12px;
        border-radius: 12px;
        border: 1px solid var(--panel-border);
        background: var(--panel);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        text-align: right;
      }

      .score-card span {
        display: block;
        font-size: 10px;
        letter-spacing: 0.16em;
        color: var(--muted);
        text-transform: uppercase;
      }

      .score-card b {
        display: block;
        font-size: 20px;
        line-height: 1.15;
        font-variant-numeric: tabular-nums;
      }

      .score-card.best b {
        color: var(--accent);
      }

      .overlay {
        position: absolute;
        inset: 0;
        z-index: 3;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(4, 6, 8, 0.46);
        backdrop-filter: blur(3px);
        -webkit-backdrop-filter: blur(3px);
        transition: opacity 160ms ease;
      }

      html[data-theme='light'] .overlay {
        background: rgba(238, 241, 244, 0.55);
      }

      .overlay.hidden {
        display: none;
      }

      .card {
        width: min(420px, 86vw);
        padding: 26px 26px 22px;
        border-radius: 18px;
        border: 1px solid var(--panel-border);
        background: var(--panel);
        box-shadow: 0 24px 70px var(--shadow);
        text-align: center;
      }

      .kicker {
        margin: 0 0 8px;
        font-size: 11px;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--accent);
      }

      .card h1 {
        margin: 0 0 8px;
        font-size: 26px;
        line-height: 1.2;
        letter-spacing: -0.01em;
      }

      .card p.hint {
        margin: 0 0 18px;
        font-size: 13px;
        line-height: 1.6;
        color: var(--muted);
      }

      .actions {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
      }

      button.primary {
        appearance: none;
        border: 1px solid transparent;
        border-radius: 999px;
        background: var(--accent);
        color: #04120c;
        font-size: 14px;
        font-weight: 700;
        padding: 10px 22px;
        cursor: pointer;
        transition: transform 120ms ease, filter 120ms ease;
      }

      button.primary:hover {
        filter: brightness(1.06);
      }

      button.primary:active {
        transform: translateY(1px);
      }

      button.primary:focus-visible {
        outline: 2px solid var(--accent-strong);
        outline-offset: 2px;
      }

      .footer {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 0 26px 16px;
        pointer-events: none;
        z-index: 2;
        font-size: 11px;
        color: var(--muted);
      }

      .agent-hint {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        min-height: 20px;
        opacity: 0;
        transition: opacity 200ms ease;
      }

      .agent-hint.visible {
        opacity: 1;
      }

      .agent-hint::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: var(--food);
      }

      .keys {
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.02em;
      }

      .fatal {
        padding: 10px 14px;
        border-radius: 10px;
        border: 1px solid rgba(251, 113, 133, 0.4);
        color: var(--danger);
        font-size: 12px;
      }

      @media (max-width: 720px) {
        .hud {
          padding: 12px 14px 0;
        }
        .footer {
          padding: 0 14px 10px;
        }
        .brand {
          font-size: 11px;
        }
        .score-card {
          min-width: 70px;
          padding: 6px 9px;
        }
        .score-card b {
          font-size: 17px;
        }
        .keys {
          display: none;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .overlay,
        .agent-hint,
        button.primary {
          transition: none;
        }
      }
    </style>
  </head>
  <body>
    <div id="app">
      <div class="hud" aria-hidden="true">
        <div class="scores">
          <div class="score-card"><span>得分</span><b id="score">0</b></div>
          <div class="score-card best"><span>最高</span><b id="best">0</b></div>
        </div>
      </div>

      <div class="stage">
        <canvas id="board" width="960" height="540" tabindex="0" aria-label="贪吃蛇棋盘"></canvas>
      </div>

      <div id="overlay" class="overlay hidden" role="status" aria-live="polite">
        <div class="card">
          <p id="overlay-kicker" class="kicker">贪吃蛇</p>
          <h1 id="overlay-title">按方向键开始</h1>
          <p id="overlay-hint" class="hint">方向键 / WASD 移动 · 空格暂停 · Enter 重开</p>
          <div id="overlay-actions" class="actions">
            <button id="primary" class="primary" type="button">开始游戏</button>
          </div>
        </div>
      </div>

      <div class="footer" aria-hidden="true">
        <span id="agent-hint" class="agent-hint"></span>
        <span class="keys">↑ ← ↓ → / WASD 移动 · Space / P 暂停 · Enter 重开</span>
      </div>
    </div>

    <script>
      __INLINE_SCRIPT__
    </script>
  </body>
</html>
