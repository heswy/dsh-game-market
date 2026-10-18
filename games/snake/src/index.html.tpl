<!doctype html>
<html lang="zh-CN" data-theme="dark" data-reduced-motion="false">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark light" />
    <title>__GAME_TITLE__</title>
    <script type="application/json" id="dsh-game-manifest">__MANIFEST_JSON__</script>
    <style>
      :root {
        color-scheme: dark;
        --bg: #06080a;
        --stage: #0a0d11;
        --panel: rgba(17, 21, 27, 0.86);
        --panel-border: rgba(255, 255, 255, 0.1);
        --text: #eef2f6;
        --muted: #9aa6b2;
        --accent: #34d399;
        --accent-strong: #a7f3d0;
        --accent-solid: #34d399;
        --on-accent: #04120c;
        --accent-soft: rgba(52, 211, 153, 0.18);
        --accent-tint: rgba(52, 211, 153, 0.12);
        --food: #fbbf24;
        --danger: #fb7185;
        --grid: rgba(255, 255, 255, 0.05);
        --shadow: rgba(0, 0, 0, 0.55);
        --kbd-bg: rgba(255, 255, 255, 0.06);
        --stat-bg: rgba(255, 255, 255, 0.035);
        --scrim: rgba(3, 5, 8, 0.52);
        --scrim-vignette: rgba(3, 5, 8, 0.26);
      }

      html[data-theme='light'] {
        color-scheme: light;
        --bg: #e7ebef;
        --stage: #f3f6f8;
        --panel: rgba(255, 255, 255, 0.9);
        --panel-border: rgba(15, 23, 42, 0.12);
        --text: #0d1319;
        --muted: #4d5a68;
        --accent: #047857;
        --accent-strong: #065f46;
        --accent-solid: #065f46;
        --on-accent: #ffffff;
        --accent-soft: rgba(4, 120, 87, 0.16);
        --accent-tint: rgba(4, 120, 87, 0.08);
        --food: #b45309;
        --danger: #be123c;
        --grid: rgba(15, 23, 42, 0.06);
        --shadow: rgba(15, 23, 42, 0.2);
        --kbd-bg: rgba(15, 23, 42, 0.05);
        --stat-bg: rgba(15, 23, 42, 0.035);
        --scrim: rgba(231, 235, 239, 0.62);
        --scrim-vignette: rgba(15, 23, 42, 0.08);
      }

      * {
        box-sizing: border-box;
      }

      html {
        -webkit-text-size-adjust: 100%;
        /* One rem = 16 logical px at the 960x540 reference frame; scales with the
           16:9 stage so HUD, overlays and the canvas board keep their proportions. */
        font-size: min(1.66667vw, 2.96296vh);
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

      [hidden] {
        display: none !important;
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
        border: 0;
      }

      #app {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        background:
          radial-gradient(120% 90% at 50% 0%, rgba(52, 211, 153, 0.1), transparent 60%),
          radial-gradient(90% 70% at 50% 100%, rgba(14, 165, 233, 0.08), transparent 65%),
          var(--bg);
      }

      html[data-theme='light'] #app {
        background:
          radial-gradient(120% 90% at 50% 0%, rgba(4, 120, 87, 0.09), transparent 60%),
          radial-gradient(90% 70% at 50% 100%, rgba(2, 132, 199, 0.07), transparent 65%),
          var(--bg);
      }

      /* The 16:9 stage: the canvas and every DOM overlay share this box, so the
         HUD never drifts away from the board at wide or narrow sizes. */
      .frame {
        position: relative;
        width: min(100vw, 177.7778vh);
        height: min(100vh, 56.25vw);
        overflow: hidden;
        background:
          radial-gradient(120% 90% at 50% 0%, rgba(52, 211, 153, 0.06), transparent 58%),
          radial-gradient(80% 60% at 50% 100%, rgba(14, 165, 233, 0.05), transparent 62%),
          var(--stage);
        box-shadow: 0 0 0 1px var(--panel-border), 0 2rem 5rem var(--shadow);
      }

      html[data-theme='light'] .frame {
        background:
          radial-gradient(120% 90% at 50% 0%, rgba(4, 120, 87, 0.06), transparent 58%),
          radial-gradient(80% 60% at 50% 100%, rgba(2, 132, 199, 0.05), transparent 62%),
          var(--stage);
      }

      #board {
        position: absolute;
        inset: 0;
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        outline: none;
        touch-action: none;
      }

      #board:focus-visible {
        outline: 2px solid var(--accent-strong);
        outline-offset: -6px;
      }

      .hud {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1.25rem 0;
        pointer-events: none;
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-size: clamp(10px, 0.75rem, 14px);
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--muted);
        white-space: nowrap;
      }

      .brand .dot {
        width: clamp(6px, 0.4375rem, 9px);
        height: clamp(6px, 0.4375rem, 9px);
        border-radius: 999px;
        background: var(--accent);
        box-shadow: 0 0 0 0.25rem var(--accent-soft);
      }

      .brand .version {
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: none;
        opacity: 0.75;
      }

      .hud-right {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-left: auto;
      }

      .dir-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: clamp(22px, 1.75rem, 34px);
        height: clamp(22px, 1.75rem, 34px);
        border-radius: 0.625rem;
        border: 1px solid var(--panel-border);
        background: var(--panel);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        transition: border-color 140ms ease, background-color 140ms ease;
      }

      .dir-arrow {
        width: 0;
        height: 0;
        border-left: 0.28rem solid transparent;
        border-right: 0.28rem solid transparent;
        border-bottom: 0.46rem solid var(--accent);
        transform: rotate(var(--dir, 0deg));
        transition: transform 140ms ease;
        filter: drop-shadow(0 0 4px var(--accent-soft));
      }

      .dir-chip.turn {
        border-color: var(--accent);
        background: var(--accent-tint);
      }

      .score-card {
        display: inline-flex;
        align-items: baseline;
        gap: 0.4rem;
        min-width: clamp(60px, 4.5rem, 92px);
        padding: clamp(3px, 0.3125rem, 7px) clamp(8px, 0.6875rem, 15px);
        border-radius: 999px;
        border: 1px solid var(--panel-border);
        background: var(--panel);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        transition: border-color 160ms ease, box-shadow 160ms ease;
      }

      .score-card span {
        font-size: clamp(9px, 0.625rem, 12px);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
        white-space: nowrap;
      }

      .score-card b {
        margin-left: auto;
        font-size: clamp(14px, 1.3125rem, 26px);
        font-weight: 800;
        line-height: 1;
        font-variant-numeric: tabular-nums;
      }

      .score-card.best b {
        color: var(--accent);
      }

      .score-card.best.is-record {
        border-color: var(--accent);
        box-shadow: 0 0 0 1px var(--accent-tint), 0 0.5rem 1.5rem var(--accent-soft);
      }

      .score-card.best.is-record span {
        color: var(--accent);
      }

      .agent-hint {
        position: absolute;
        top: 0.75rem;
        left: 50%;
        max-width: min(42%, 20rem);
        padding: 0.3rem 0.7rem;
        border-radius: 999px;
        border: 1px solid var(--panel-border);
        background: var(--panel);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        font-size: clamp(9px, 0.6875rem, 13px);
        color: var(--text);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        opacity: 0;
        visibility: hidden;
        transform: translate(-50%, -0.25rem);
        transition: opacity 200ms ease, transform 200ms ease, visibility 200ms ease;
      }

      .agent-hint::before {
        content: '';
        display: inline-block;
        width: 0.4rem;
        height: 0.4rem;
        margin-right: 0.4rem;
        border-radius: 999px;
        background: var(--food);
        vertical-align: 0.08em;
      }

      .agent-hint.visible {
        opacity: 1;
        visibility: visible;
        transform: translate(-50%, 0);
      }

      .overlay {
        position: absolute;
        inset: 0;
        z-index: 3;
        display: grid;
        place-items: center;
        padding: 1.5rem;
        background:
          radial-gradient(62% 62% at 50% 44%, transparent, var(--scrim-vignette)),
          var(--scrim);
        backdrop-filter: blur(3px);
        -webkit-backdrop-filter: blur(3px);
        transition: opacity 160ms ease;
      }

      .overlay.hidden {
        display: none;
      }

      .card {
        width: min(27.5rem, 88%);
        max-height: 92%;
        overflow: auto;
        padding: clamp(16px, 1.75rem, 34px) clamp(16px, 1.75rem, 34px) clamp(14px, 1.5rem, 28px);
        border-radius: clamp(14px, 1.25rem, 24px);
        border: 1px solid var(--panel-border);
        background: var(--panel);
        box-shadow: 0 1.5rem 4.5rem var(--shadow);
        text-align: center;
        outline: none;
        scrollbar-width: thin;
      }

      .card:focus-visible {
        outline: 2px solid var(--accent-strong);
        outline-offset: 3px;
      }

      .kicker {
        margin: 0 0 0.5rem;
        font-size: clamp(9px, 0.6875rem, 12px);
        font-weight: 700;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: var(--accent);
      }

      .overlay[data-variant='over'] .kicker,
      .overlay[data-variant='error'] .kicker {
        color: var(--danger);
      }

      .overlay[data-variant='paused'] .kicker {
        color: var(--food);
      }

      .card h1 {
        margin: 0 0 0.5rem;
        font-size: clamp(20px, 1.875rem, 34px);
        font-weight: 800;
        line-height: 1.15;
        letter-spacing: -0.01em;
        text-wrap: balance;
      }

      .card .hint {
        margin: 0 0 1rem;
        font-size: clamp(11px, 0.8125rem, 14px);
        line-height: 1.6;
        color: var(--muted);
      }

      .stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.5rem;
        margin: 0 0 1rem;
        padding: 0.75rem 0.5rem;
        border-radius: 0.75rem;
        border: 1px solid var(--panel-border);
        background: var(--stat-bg);
      }

      .stats div {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        min-width: 0;
      }

      .stats dt {
        font-size: clamp(9px, 0.625rem, 12px);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--muted);
      }

      .stats dd {
        margin: 0;
        font-size: clamp(15px, 1.125rem, 22px);
        font-weight: 800;
        line-height: 1.1;
        font-variant-numeric: tabular-nums;
      }

      .stats div:first-child dd {
        color: var(--accent);
      }

      .keycaps {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 0.375rem 0.5rem;
        margin: 0 0 1.125rem;
        font-size: clamp(9px, 0.625rem, 12px);
        color: var(--muted);
      }

      .keycaps span {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        white-space: nowrap;
      }

      .keycaps .slash {
        margin: 0 0.05rem;
        opacity: 0.7;
      }

      kbd {
        font-family: inherit;
        font-size: inherit;
        font-weight: 600;
        line-height: 1;
        min-width: 1.25rem;
        padding: 0.22rem 0.4rem;
        border-radius: 0.35rem;
        border: 1px solid var(--panel-border);
        border-bottom-width: 2px;
        background: var(--kbd-bg);
        color: var(--text);
        text-align: center;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 0.625rem;
      }

      button.primary,
      button.ghost {
        appearance: none;
        min-height: 44px;
        padding: 0 clamp(18px, 1.5rem, 30px);
        border: 1px solid transparent;
        border-radius: 999px;
        font: inherit;
        font-size: clamp(13px, 0.9375rem, 17px);
        font-weight: 700;
        cursor: pointer;
        transition: transform 120ms ease, filter 120ms ease, box-shadow 120ms ease, background-color 120ms ease;
      }

      button.primary {
        background: var(--accent-solid);
        color: var(--on-accent);
        box-shadow: 0 0.5rem 1.5rem var(--accent-soft);
      }

      button.primary:hover {
        filter: brightness(1.07);
      }

      button.primary:active,
      button.ghost:active {
        transform: translateY(1px);
      }

      button.primary:focus-visible,
      button.ghost:focus-visible {
        outline: 2px solid var(--accent-strong);
        outline-offset: 2px;
      }

      button.ghost {
        min-height: 40px;
        background: transparent;
        border-color: var(--panel-border);
        color: var(--text);
      }

      button.ghost:hover {
        background: var(--accent-tint);
      }

      @media (max-width: 720px) {
        .hud {
          padding: 0.55rem 0.8rem 0;
        }

        .brand .version {
          display: none;
        }

        .agent-hint {
          top: 0.55rem;
          max-width: 46%;
        }

        .overlay {
          padding: 0.75rem;
        }
      }

      @media (max-width: 520px) {
        .dir-chip,
        .brand .word {
          display: none;
        }
      }

      @media (max-height: 380px) {
        .keycaps {
          margin-bottom: 0.75rem;
        }

        .card .hint {
          margin-bottom: 0.75rem;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .overlay,
        .agent-hint,
        .dir-arrow,
        .dir-chip,
        .score-card,
        button.primary,
        button.ghost {
          transition: none;
        }
      }

      html[data-reduced-motion='true'] .overlay,
      html[data-reduced-motion='true'] .agent-hint,
      html[data-reduced-motion='true'] .dir-arrow,
      html[data-reduced-motion='true'] .dir-chip,
      html[data-reduced-motion='true'] .score-card,
      html[data-reduced-motion='true'] button.primary,
      html[data-reduced-motion='true'] button.ghost {
        transition: none;
      }
    </style>
  </head>
  <body>
    <div id="app">
      <div class="frame" id="frame">
        <canvas id="board" width="960" height="540" tabindex="0" aria-label="贪吃蛇棋盘"></canvas>

        <div class="hud" aria-hidden="true">
          <div class="brand">
            <span class="dot"></span>
            <span class="word">贪吃蛇</span>
            <span class="version">v__GAME_VERSION__</span>
          </div>
          <div class="hud-right">
            <span id="dir-chip" class="dir-chip"><span class="dir-arrow"></span></span>
            <div class="score-card"><span>得分</span><b id="score">0</b></div>
            <div id="best-card" class="score-card best"><span id="best-label">最高</span><b id="best">0</b></div>
          </div>
          <span id="agent-hint" class="agent-hint"></span>
        </div>

        <div
          id="overlay"
          class="overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="overlay-title"
          aria-describedby="overlay-hint"
          data-variant="start"
        >
          <div id="overlay-card" class="card" tabindex="-1">
            <p id="overlay-kicker" class="kicker">贪吃蛇</p>
            <h1 id="overlay-title">按方向键开始</h1>
            <p id="overlay-hint" class="hint">方向键 / WASD 开始 · 吃到食物 +10</p>
            <dl id="overlay-stats" class="stats" hidden>
              <div><dt>得分</dt><dd id="stat-score">0</dd></div>
              <div><dt>最高</dt><dd id="stat-best">0</dd></div>
              <div><dt>长度</dt><dd id="stat-length">4</dd></div>
            </dl>
            <p class="keycaps" aria-hidden="true">
              <span><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd><span class="slash">/</span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 转向</span>
              <span><kbd>Space</kbd><kbd>P</kbd> 暂停</span>
              <span><kbd>Enter</kbd> 重开</span>
            </p>
            <div id="overlay-actions" class="actions">
              <button id="primary" class="primary" type="button">开始游戏</button>
              <button id="retry" class="ghost" type="button" hidden>重试</button>
            </div>
          </div>
        </div>

        <p id="sr-status" class="sr-only" aria-live="polite"></p>
      </div>
    </div>

    <script>
      __INLINE_SCRIPT__
    </script>
  </body>
</html>
