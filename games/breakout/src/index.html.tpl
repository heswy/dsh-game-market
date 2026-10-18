<!doctype html>
<html lang="zh-CN" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark light" />
    <meta name="description" content="__GAME_DESCRIPTION__" />
    <title>__GAME_TITLE__</title>
    <script type="application/json" id="dsh-game-manifest">__GAME_MANIFEST__</script>
    <style>
      :root {
        color-scheme: dark;
        --bg: #05080f;
        --panel: rgba(11, 20, 34, 0.92);
        --panel-solid: #0b1422;
        --panel-border: rgba(148, 197, 255, 0.16);
        --text: #eaf2ff;
        --muted: #9fb1c9;
        --faint: rgba(159, 177, 201, 0.5);
        --accent: #22d3ee;
        --accent-2: #a78bfa;
        --on-accent: #04121a;
        --success: #34d399;
        --warn: #fbbf24;
        --danger: #fb7185;
        --focus: #fbbf24;
        --focus-soft: rgba(34, 211, 238, 0.5);
        --shadow: rgba(0, 0, 0, 0.6);
        --backdrop: rgba(3, 7, 13, 0.56);
        --scrim-line: rgba(148, 197, 255, 0.12);
      }

      html[data-theme='light'] {
        color-scheme: light;
        --bg: #eef4fb;
        --panel: rgba(255, 255, 255, 0.94);
        --panel-solid: #ffffff;
        --panel-border: rgba(15, 23, 42, 0.12);
        --text: #0b1220;
        --muted: #4c5f78;
        --faint: rgba(76, 95, 120, 0.48);
        --accent: #0e7490;
        --accent-2: #6d28d9;
        --on-accent: #ffffff;
        --success: #047857;
        --warn: #b45309;
        --danger: #be123c;
        --focus: #b45309;
        --focus-soft: rgba(14, 116, 144, 0.45);
        --shadow: rgba(15, 23, 42, 0.2);
        --backdrop: rgba(226, 236, 247, 0.62);
        --scrim-line: rgba(15, 23, 42, 0.1);
      }

      * {
        box-sizing: border-box;
      }

      [hidden] {
        display: none !important;
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
        -webkit-font-smoothing: antialiased;
      }

      #app {
        position: relative;
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        min-height: 100dvh;
        background:
          radial-gradient(120% 90% at 18% 0%, rgba(34, 211, 238, 0.07), transparent 58%),
          radial-gradient(100% 90% at 82% 100%, rgba(167, 139, 250, 0.07), transparent 60%),
          var(--bg);
      }

      .stage {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      #board {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        outline: none;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
      }

      #board:focus,
      #board:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 2px var(--focus-soft);
      }

      .overlay {
        position: absolute;
        inset: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: clamp(16px, 4vw, 40px);
        background: var(--backdrop);
        backdrop-filter: blur(5px);
        -webkit-backdrop-filter: blur(5px);
      }

      .overlay-card {
        position: relative;
        width: min(460px, 100%);
        padding: clamp(22px, 3.4vw, 34px);
        border-radius: 22px;
        border: 1px solid var(--panel-border);
        background: var(--panel);
        box-shadow: 0 26px 80px var(--shadow);
        text-align: center;
        overflow: hidden;
        animation: card-in 190ms cubic-bezier(0.22, 1, 0.36, 1);
      }

      .overlay-card::before {
        content: '';
        position: absolute;
        inset: 0 0 auto;
        height: 2px;
        background: linear-gradient(90deg, transparent, var(--accent), var(--accent-2), transparent);
        opacity: 0.9;
      }

      .overlay-card:focus {
        outline: none;
      }

      .overlay-kicker {
        margin: 0 0 10px;
        color: var(--accent);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.22em;
        text-transform: uppercase;
      }

      .overlay-title {
        margin: 0 0 10px;
        font-size: clamp(26px, 4.2vw, 36px);
        line-height: 1.1;
        font-weight: 800;
        letter-spacing: -0.025em;
        color: var(--text);
      }

      .overlay-hint {
        margin: 0 auto 22px;
        max-width: 40ch;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.65;
        white-space: pre-line;
      }

      .overlay-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 10px;
      }

      .btn {
        appearance: none;
        min-height: 44px;
        padding: 0 22px;
        border-radius: 999px;
        border: 1px solid transparent;
        font: inherit;
        font-size: 14px;
        font-weight: 700;
        cursor: pointer;
        transition:
          transform 120ms ease,
          filter 120ms ease,
          background-color 120ms ease;
        touch-action: manipulation;
      }

      .btn:focus-visible {
        outline: 2px solid var(--focus);
        outline-offset: 3px;
      }

      .btn-primary {
        background: var(--accent);
        color: var(--on-accent);
        box-shadow: 0 10px 26px rgba(34, 211, 238, 0.22);
      }

      .btn-primary:hover {
        filter: brightness(1.07);
      }

      .btn-primary:active {
        transform: translateY(1px);
      }

      .btn-quiet {
        background: transparent;
        color: var(--muted);
        border-color: var(--panel-border);
      }

      .btn-quiet:hover {
        background: rgba(148, 197, 255, 0.08);
        color: var(--text);
      }

      .btn-quiet:active {
        transform: translateY(1px);
      }

      .statusbar {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 6;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 0 20px calc(10px + env(safe-area-inset-bottom));
        pointer-events: none;
        font-size: 10.5px;
        line-height: 1.4;
        color: var(--muted);
      }

      .status-left {
        display: inline-flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
      }

      .save-status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
        color: var(--muted);
      }

      .save-status::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: var(--faint);
      }

      .save-status[data-state='saved'] {
        color: var(--success);
      }

      .save-status[data-state='saved']::before {
        background: var(--success);
        box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.14);
      }

      .save-status[data-state='failed'] {
        color: var(--danger);
      }

      .save-status[data-state='failed']::before {
        background: var(--danger);
      }

      .agent-hint {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: 34vw;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        opacity: 0;
        transition: opacity 180ms ease;
      }

      .agent-hint.visible {
        opacity: 1;
      }

      .agent-hint::before {
        content: '';
        flex: 0 0 auto;
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: var(--warn);
      }

      .agent-hint[data-state='completed']::before {
        background: var(--success);
      }

      .agent-hint[data-state='error']::before {
        background: var(--danger);
      }

      .controls-hint {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-end;
        text-align: right;
        white-space: nowrap;
      }

      kbd {
        display: inline-block;
        min-width: 18px;
        padding: 1px 5px;
        border-radius: 5px;
        border: 1px solid var(--panel-border);
        border-bottom-width: 2px;
        background: rgba(148, 197, 255, 0.08);
        color: var(--text);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 9.5px;
        line-height: 1.5;
      }

      .toast {
        position: absolute;
        left: 50%;
        bottom: calc(42px + env(safe-area-inset-bottom));
        z-index: 20;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 12px;
        width: max-content;
        max-width: min(560px, calc(100vw - 32px));
        padding: 10px 14px;
        border-radius: 12px;
        border: 1px solid var(--panel-border);
        background: var(--panel);
        color: var(--text);
        box-shadow: 0 16px 40px var(--shadow);
        font-size: 12px;
        line-height: 1.5;
        animation: toast-in 160ms ease-out;
      }

      .toast[data-tone='error'] {
        border-color: var(--danger);
      }

      .toast[data-tone='warn'] {
        border-color: var(--warn);
      }

      .toast-action {
        appearance: none;
        flex: 0 0 auto;
        min-height: 30px;
        padding: 0 10px;
        border-radius: 8px;
        border: 1px solid var(--panel-border);
        background: rgba(148, 197, 255, 0.08);
        color: var(--text);
        font: inherit;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
      }

      .toast-action:focus-visible {
        outline: 2px solid var(--focus);
        outline-offset: 2px;
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

      @keyframes card-in {
        from {
          opacity: 0;
          transform: translateY(8px) scale(0.985);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @keyframes toast-in {
        from {
          opacity: 0;
          transform: translate(-50%, 6px);
        }
        to {
          opacity: 1;
          transform: translate(-50%, 0);
        }
      }

      @media (max-width: 720px) {
        .statusbar {
          padding: 0 12px calc(8px + env(safe-area-inset-bottom));
        }
        .controls-hint {
          display: none;
        }
        .agent-hint {
          max-width: 52vw;
        }
        .overlay-hint {
          font-size: 12.5px;
        }
      }

      @media (max-height: 520px) {
        .statusbar {
          display: none;
        }
        .overlay-card {
          padding: 18px 20px;
        }
        .overlay-title {
          font-size: 24px;
        }
        .overlay-hint {
          margin-bottom: 16px;
        }
        .toast {
          bottom: 14px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .overlay-card,
        .toast {
          animation: none;
        }
        .btn,
        .agent-hint {
          transition: none;
        }
      }

      html.reduced .overlay-card,
      html.reduced .toast {
        animation: none;
      }

      html.reduced .btn,
      html.reduced .agent-hint {
        transition: none;
      }
    </style>
  </head>
  <body>
    <div id="app">
      <div class="stage">
        <canvas
          id="board"
          width="960"
          height="540"
          tabindex="0"
          role="img"
          aria-label="打砖块游戏画面：移动挡板反弹球，击碎砖块，共 5 个关卡"
        ></canvas>
      </div>

      <div id="overlay" class="overlay" hidden>
        <div
          id="overlay-card"
          class="overlay-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="overlay-title"
          aria-describedby="overlay-hint"
          tabindex="-1"
        >
          <p id="overlay-kicker" class="overlay-kicker"></p>
          <h1 id="overlay-title" class="overlay-title"></h1>
          <p id="overlay-hint" class="overlay-hint"></p>
          <div id="overlay-actions" class="overlay-actions">
            <button id="primary" class="btn btn-primary" type="button"></button>
            <button id="secondary" class="btn btn-quiet" type="button" hidden></button>
          </div>
        </div>
      </div>

      <div class="statusbar" aria-hidden="true">
        <div class="status-left">
          <span id="save-status" class="save-status" data-state="idle">等待保存</span>
          <span id="agent-hint" class="agent-hint" data-state="idle"></span>
        </div>
        <span class="controls-hint">
          <kbd>←</kbd><kbd>→</kbd> / <kbd>A</kbd><kbd>D</kbd> 移动 · <kbd>SPACE</kbd> 发射 · <kbd>P</kbd> 暂停
        </span>
      </div>

      <div id="toast" class="toast" hidden role="status" aria-live="polite">
        <span id="toast-message"></span>
        <button id="toast-action" class="toast-action" type="button" hidden></button>
      </div>

      <p id="live" class="sr-only" aria-live="polite"></p>
    </div>

    <script>
      __INLINE_SCRIPT__
    </script>
  </body>
</html>
