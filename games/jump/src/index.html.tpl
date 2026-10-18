<!doctype html>
<html lang="zh-CN" data-theme="dark" data-reduced-motion="false">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark light" />
    <meta name="game-version" content="__GAME_VERSION__" />
    <title>__GAME_TITLE__</title>
    <script type="application/json" id="dsh-game-manifest">__MANIFEST_JSON__</script>
    <style>
      :root {
        color-scheme: dark;
        --surround: #05070f;
        --sky: #0a1024;
        --ink: #eef4ff;
        --muted: #9db0d0;
        --panel: rgba(9, 15, 31, 0.74);
        --panel-strong: rgba(13, 20, 40, 0.92);
        --panel-border: rgba(150, 200, 255, 0.16);
        --panel-border-strong: rgba(150, 200, 255, 0.26);
        --accent: #7cf7d4;
        --accent-deep: #2ec4a6;
        --accent-ink: #04231d;
        --gold: #ffd166;
        --gold-fill: #ffd166;
        --pink: #ff7ad9;
        --danger: #ff8d9d;
        --danger-border: rgba(255, 141, 157, 0.38);
        --ring: #7cf7d4;
        --card-shadow: 0 30px 80px rgba(0, 0, 0, 0.58);
        --frame-shadow: 0 40px 120px rgba(0, 0, 0, 0.65);
        --key-face: rgba(255, 255, 255, 0.08);
        --key-shadow: rgba(0, 0, 0, 0.3);
        --scrim: rgba(3, 6, 14, 0.42);
        --edge-top: rgba(4, 7, 16, 0.64);
        --edge-bottom: rgba(4, 7, 16, 0.4);
        --grid: rgba(120, 220, 255, 0.055);
      }

      html[data-theme='light'] {
        color-scheme: light;
        --surround: #e9e3d6;
        --sky: #f6f1e6;
        --ink: #14203a;
        --muted: #576481;
        --panel: rgba(255, 253, 247, 0.82);
        --panel-strong: rgba(255, 253, 247, 0.95);
        --panel-border: rgba(20, 32, 58, 0.13);
        --panel-border-strong: rgba(20, 32, 58, 0.22);
        --accent: #067a68;
        --accent-deep: #045c4f;
        --accent-ink: #f2fffb;
        --gold: #92400e;
        --gold-fill: #fbbf24;
        --pink: #a21caf;
        --danger: #b91c1c;
        --danger-border: rgba(185, 28, 28, 0.3);
        --ring: #067a68;
        --card-shadow: 0 30px 70px rgba(78, 62, 36, 0.22);
        --frame-shadow: 0 40px 110px rgba(78, 62, 36, 0.26);
        --key-face: rgba(20, 32, 58, 0.06);
        --key-shadow: rgba(20, 32, 58, 0.14);
        --scrim: rgba(246, 241, 230, 0.44);
        --edge-top: rgba(255, 252, 246, 0.74);
        --edge-bottom: rgba(255, 252, 246, 0.52);
        --grid: rgba(20, 32, 58, 0.05);
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
        background: var(--surround);
        color: var(--ink);
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
          'Microsoft YaHei', sans-serif;
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
      }

      body {
        user-select: none;
        -webkit-user-select: none;
        -webkit-tap-highlight-color: transparent;
      }

      #app {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 0;
        background:
          radial-gradient(80% 60% at 50% 0%, rgba(124, 247, 212, 0.06), transparent 65%),
          radial-gradient(70% 55% at 50% 100%, rgba(255, 122, 217, 0.05), transparent 70%),
          var(--surround);
      }

      .frame {
        position: relative;
        width: min(100vw, calc(100vh * 0.5625), 540px);
        width: min(100vw, calc(100dvh * 0.5625), 540px);
        aspect-ratio: 9 / 16;
        max-height: 960px;
        overflow: hidden;
        border-radius: clamp(0px, 2.6vmin, 24px);
        background: var(--sky);
        box-shadow:
          0 0 0 1px rgba(255, 255, 255, 0.055),
          var(--frame-shadow);
        container-type: size;
        isolation: isolate;
      }

      html[data-theme='light'] .frame {
        box-shadow:
          0 0 0 1px rgba(20, 32, 58, 0.08),
          var(--frame-shadow);
      }

      .frame::before {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 2;
        pointer-events: none;
        border-radius: inherit;
        background:
          linear-gradient(to bottom, var(--edge-top) 0, transparent 118px),
          linear-gradient(to top, var(--edge-bottom) 0, transparent 86px);
      }

      .frame::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 4;
        pointer-events: none;
        border-radius: inherit;
        box-shadow:
          inset 0 0 0 1px rgba(255, 255, 255, 0.06),
          inset 0 -90px 120px rgba(0, 0, 0, 0.22);
      }

      html[data-theme='light'] .frame::after {
        box-shadow:
          inset 0 0 0 1px rgba(20, 32, 58, 0.06),
          inset 0 -90px 120px rgba(120, 96, 56, 0.08);
      }

      #stage {
        position: absolute;
        inset: 0;
        display: block;
        width: 100%;
        height: 100%;
        outline: none;
        touch-action: manipulation;
      }

      #stage:focus-visible {
        outline: none;
      }

      .hud {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 3;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 2cqw;
        padding: 18px;
        padding: clamp(14px, 3.4cqw, 24px);
        pointer-events: none;
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: clamp(6px, 1.5cqw, 10px);
        min-height: 28px;
        padding-top: clamp(2px, 0.7cqw, 5px);
        color: var(--muted);
        font-size: clamp(10px, 2.1cqw, 15px);
        font-weight: 800;
        letter-spacing: 0.24em;
        text-transform: uppercase;
      }

      .brand svg {
        width: clamp(17px, 3.3cqw, 24px);
        height: clamp(17px, 3.3cqw, 24px);
        color: var(--accent);
        filter: drop-shadow(0 0 8px rgba(124, 247, 212, 0.42));
        flex: none;
      }

      .brand .brand-mark {
        display: inline-flex;
        align-items: center;
        gap: clamp(6px, 1.5cqw, 10px);
      }

      .stats {
        display: flex;
        align-items: flex-start;
        gap: clamp(6px, 1.4cqw, 10px);
        margin-left: auto;
      }

      .stat {
        position: relative;
        min-width: clamp(66px, 14.5cqw, 104px);
        padding: clamp(5px, 1.3cqw, 9px) clamp(8px, 1.9cqw, 14px);
        border: 1px solid var(--panel-border);
        border-radius: clamp(9px, 2.1cqw, 15px);
        background: var(--panel);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        text-align: right;
        box-shadow: 0 8px 26px rgba(0, 0, 0, 0.18);
      }

      .stat span {
        display: block;
        color: var(--muted);
        font-size: clamp(8px, 1.55cqw, 11px);
        font-weight: 700;
        letter-spacing: 0.16em;
        line-height: 1.3;
        text-transform: uppercase;
      }

      .stat b {
        display: block;
        margin-top: 1px;
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-variant-numeric: tabular-nums;
        font-size: clamp(17px, 3.5cqw, 26px);
        line-height: 1.1;
        letter-spacing: -0.02em;
      }

      .stat.best b {
        color: var(--accent);
      }

      .new-best {
        position: absolute;
        top: clamp(-9px, -1.4cqw, -5px);
        right: clamp(5px, 1.2cqw, 9px);
        padding: 2px 6px;
        border-radius: 999px;
        background: var(--gold-fill);
        color: #2a1a02;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: clamp(7px, 1.35cqw, 9px);
        font-style: normal;
        font-weight: 800;
        letter-spacing: 0.1em;
        line-height: 1.4;
        box-shadow: 0 4px 12px rgba(255, 209, 102, 0.3);
        animation: best-pop 700ms cubic-bezier(0.2, 1.6, 0.4, 1) both;
      }

      .new-best[hidden] {
        display: none;
      }

      .milestone {
        position: absolute;
        top: clamp(62px, 13cqw, 96px);
        left: 50%;
        z-index: 3;
        transform: translate(-50%, 0);
        padding: clamp(4px, 1cqw, 7px) clamp(10px, 2.2cqw, 16px);
        border: 1px solid var(--panel-border-strong);
        border-radius: 999px;
        background: var(--panel-strong);
        color: var(--gold);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: clamp(10px, 2cqw, 14px);
        font-weight: 700;
        letter-spacing: 0.12em;
        pointer-events: none;
        opacity: 0;
      }

      .milestone.show {
        animation: milestone-pop 1600ms cubic-bezier(0.2, 0.9, 0.2, 1) both;
      }

      .footer {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 3;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: clamp(8px, 2cqw, 14px);
        padding: 0 18px 14px;
        padding: 0 clamp(14px, 3.4cqw, 24px) clamp(10px, 2.6cqw, 18px);
        pointer-events: none;
        font-size: clamp(10px, 2.05cqw, 13px);
        line-height: 1.4;
        color: var(--muted);
      }

      .agent-hint {
        display: inline-flex;
        align-items: center;
        gap: clamp(5px, 1.1cqw, 8px);
        min-height: 18px;
        max-width: 55%;
        opacity: 0;
        transition: opacity 180ms ease;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .agent-hint.visible {
        opacity: 1;
      }

      .agent-hint::before {
        content: '';
        width: 6px;
        height: 6px;
        flex: none;
        border-radius: 999px;
        background: var(--gold);
        box-shadow: 0 0 0 3px rgba(255, 209, 102, 0.14);
      }

      .agent-hint.completed::before {
        background: var(--accent);
        box-shadow: 0 0 0 3px rgba(124, 247, 212, 0.14);
      }

      .save-indicator {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        margin-right: auto;
        opacity: 0;
        transition: opacity 180ms ease;
      }

      .save-indicator::before {
        content: '';
        width: 5px;
        height: 5px;
        border-radius: 999px;
        background: var(--accent);
      }

      .save-indicator.visible {
        opacity: 1;
      }

      .footer-right {
        display: inline-flex;
        align-items: center;
        gap: clamp(8px, 1.8cqw, 14px);
        white-space: nowrap;
      }

      .overlay {
        position: absolute;
        inset: 0;
        z-index: 6;
        display: grid;
        place-items: center;
        padding: clamp(18px, 5cqw, 40px);
        background: var(--scrim);
        backdrop-filter: blur(2px);
        -webkit-backdrop-filter: blur(2px);
      }

      .overlay[hidden] {
        display: none;
      }

      .card {
        position: relative;
        width: min(100%, 420px);
        padding: clamp(20px, 5.2cqw, 34px) clamp(18px, 4.8cqw, 32px);
        border: 1px solid var(--panel-border-strong);
        border-radius: clamp(16px, 3.8cqw, 26px);
        background: linear-gradient(165deg, var(--panel-strong), var(--panel));
        box-shadow: var(--card-shadow);
        text-align: center;
        overflow: hidden;
        outline: none;
        animation: card-in 200ms cubic-bezier(0.2, 0.9, 0.2, 1) both;
      }

      .card::before {
        content: '';
        position: absolute;
        top: -40%;
        left: 50%;
        width: 90%;
        height: 70%;
        transform: translateX(-50%);
        background: radial-gradient(ellipse at center, rgba(124, 247, 212, 0.14), transparent 68%);
        pointer-events: none;
      }

      html[data-theme='light'] .card::before {
        background: radial-gradient(ellipse at center, rgba(11, 143, 122, 0.1), transparent 68%);
      }

      .kicker {
        position: relative;
        margin: 0 0 clamp(6px, 1.4cqw, 10px);
        color: var(--accent);
        font-size: clamp(9px, 1.8cqw, 12px);
        font-weight: 800;
        letter-spacing: 0.22em;
        line-height: 1.4;
        text-transform: uppercase;
      }

      .card h1 {
        position: relative;
        margin: 0 0 clamp(6px, 1.5cqw, 10px);
        font-size: clamp(23px, 5.2cqw, 36px);
        font-weight: 800;
        line-height: 1.12;
        letter-spacing: -0.025em;
        text-wrap: balance;
      }

      .hint {
        position: relative;
        margin: 0 auto clamp(14px, 3.2cqw, 22px);
        max-width: 30ch;
        color: var(--muted);
        white-space: pre-line;
        font-size: clamp(11px, 2.3cqw, 15px);
        line-height: 1.55;
        text-wrap: pretty;
      }

      .summary {
        position: relative;
        display: flex;
        align-items: stretch;
        justify-content: center;
        gap: clamp(7px, 1.6cqw, 11px);
        margin: 0 0 clamp(14px, 3cqw, 20px);
      }

      .summary[hidden] {
        display: none;
      }

      .summary div {
        min-width: clamp(74px, 16cqw, 112px);
        padding: clamp(7px, 1.6cqw, 11px) clamp(10px, 2.2cqw, 16px);
        border: 1px solid var(--panel-border);
        border-radius: clamp(10px, 2.2cqw, 15px);
        background: var(--key-face);
      }

      .summary span {
        display: block;
        color: var(--muted);
        font-size: clamp(8px, 1.6cqw, 11px);
        font-weight: 700;
        letter-spacing: 0.15em;
        text-transform: uppercase;
      }

      .summary b {
        display: block;
        margin-top: 2px;
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
        font-variant-numeric: tabular-nums;
        font-size: clamp(19px, 4.1cqw, 29px);
        line-height: 1.15;
      }

      .summary .record {
        color: var(--gold);
      }

      .summary .record-mark {
        display: block;
        margin-top: 2px;
        color: var(--gold);
        font-size: clamp(8px, 1.5cqw, 10px);
        font-weight: 800;
        letter-spacing: 0.12em;
      }

      .keys-row {
        position: relative;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: clamp(5px, 1.2cqw, 8px);
        margin: 0 0 clamp(14px, 3.2cqw, 22px);
        color: var(--muted);
        font-size: clamp(9px, 1.85cqw, 12px);
      }

      .keys-row[hidden] {
        display: none;
      }

      .keycap {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: clamp(20px, 3.7cqw, 28px);
        height: clamp(20px, 3.7cqw, 28px);
        padding: 0 6px;
        border: 1px solid var(--panel-border-strong);
        border-radius: clamp(5px, 1.1cqw, 8px);
        background: var(--key-face);
        box-shadow: 0 2px 0 var(--key-shadow);
        color: var(--ink);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: clamp(8px, 1.7cqw, 11px);
        font-weight: 700;
        line-height: 1;
      }

      .keys-label {
        margin-right: clamp(2px, 0.7cqw, 5px);
      }

      .key-group {
        display: inline-flex;
        align-items: center;
        gap: clamp(4px, 1cqw, 7px);
      }

      .keys-divider {
        width: 1px;
        height: 12px;
        margin: 0 clamp(1px, 0.5cqw, 3px);
        background: var(--panel-border);
      }

      .primary {
        position: relative;
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: clamp(10px, 2.3cqw, 14px) clamp(24px, 5.2cqw, 36px);
        border: 0;
        border-radius: 999px;
        background: linear-gradient(180deg, var(--accent), var(--accent-deep));
        color: var(--accent-ink);
        font: inherit;
        font-size: clamp(13px, 2.55cqw, 17px);
        font-weight: 800;
        letter-spacing: 0.01em;
        cursor: pointer;
        box-shadow:
          0 12px 28px rgba(46, 196, 166, 0.26),
          inset 0 -2px 0 rgba(0, 0, 0, 0.16);
        transition: transform 120ms ease, filter 120ms ease, box-shadow 120ms ease;
        touch-action: manipulation;
      }

      .primary[hidden] {
        display: none;
      }

      .primary:hover {
        filter: brightness(1.06);
        box-shadow:
          0 14px 32px rgba(46, 196, 166, 0.32),
          inset 0 -2px 0 rgba(0, 0, 0, 0.16);
      }

      .primary:active {
        transform: translateY(1px) scale(0.99);
      }

      .primary:focus-visible {
        outline: 3px solid var(--ring);
        outline-offset: 3px;
      }

      .toast {
        position: absolute;
        left: 50%;
        bottom: clamp(46px, 10cqw, 78px);
        z-index: 8;
        display: flex;
        align-items: center;
        gap: clamp(7px, 1.6cqw, 11px);
        max-width: 88%;
        padding: clamp(8px, 1.9cqw, 12px) clamp(10px, 2.3cqw, 16px);
        border: 1px solid var(--danger-border);
        border-radius: clamp(9px, 2cqw, 14px);
        background: var(--panel-strong);
        box-shadow: 0 18px 44px rgba(0, 0, 0, 0.4);
        color: var(--ink);
        font-size: clamp(10px, 2.05cqw, 13px);
        line-height: 1.45;
        transform: translateX(-50%);
        animation: toast-in 160ms ease-out both;
      }

      .toast[hidden] {
        display: none;
      }

      .toast .toast-code {
        display: block;
        margin-top: 2px;
        color: var(--danger);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: clamp(8px, 1.6cqw, 11px);
        letter-spacing: 0.04em;
      }

      .toast-retry {
        flex: none;
        min-height: 44px;
        padding: 8px 14px;
        border: 1px solid var(--panel-border-strong);
        border-radius: 8px;
        background: var(--key-face);
        color: var(--ink);
        font: inherit;
        font-size: clamp(9px, 1.8cqw, 12px);
        font-weight: 700;
        cursor: pointer;
      }

      .toast-retry[hidden] {
        display: none;
      }

      .toast-retry:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 2px;
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
      }

      @keyframes card-in {
        from {
          opacity: 0;
          transform: translateY(10px) scale(0.975);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @keyframes best-pop {
        0% {
          opacity: 0;
          transform: translateY(4px) scale(0.7) rotate(-4deg);
        }
        55% {
          opacity: 1;
          transform: translateY(-2px) scale(1.08) rotate(2deg);
        }
        100% {
          opacity: 1;
          transform: translateY(0) scale(1) rotate(0deg);
        }
      }

      @keyframes milestone-pop {
        0% {
          opacity: 0;
          transform: translate(-50%, 8px) scale(0.9);
        }
        12% {
          opacity: 1;
          transform: translate(-50%, 0) scale(1);
        }
        78% {
          opacity: 1;
          transform: translate(-50%, 0) scale(1);
        }
        100% {
          opacity: 0;
          transform: translate(-50%, -10px) scale(1);
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

      html[data-reduced-motion='true'] .card,
      html[data-reduced-motion='true'] .new-best,
      html[data-reduced-motion='true'] .milestone.show,
      html[data-reduced-motion='true'] .toast {
        animation: none;
      }

      html[data-reduced-motion='true'] .milestone.show {
        opacity: 1;
      }

      html[data-reduced-motion='true'] .agent-hint,
      html[data-reduced-motion='true'] .save-indicator,
      html[data-reduced-motion='true'] .primary,
      html[data-reduced-motion='true'] .toast {
        transition: none;
      }

      @media (prefers-reduced-motion: reduce) {
        .card,
        .new-best,
        .milestone.show,
        .toast {
          animation: none;
        }
        .milestone.show {
          opacity: 1;
        }
        .agent-hint,
        .save-indicator,
        .primary,
        .toast {
          transition: none;
        }
      }

      @media (max-width: 400px) {
        .stat {
          min-width: 62px;
        }
        .footer .keys-label-long {
          display: none;
        }
        .keys-row .keys-label {
          display: none;
        }
      }
    </style>
  </head>
  <body>
    <div id="app">
      <div class="frame" id="frame">
        <canvas
          id="stage"
          width="540"
          height="960"
          tabindex="0"
          role="application"
          aria-label="Jump 跳跃游戏：自动弹跳，左右移动踩上平台"
        ></canvas>

        <header class="hud" aria-hidden="true">
          <div class="brand">
            <span class="brand-mark">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3l8 4.5v7.2c0 3.5-3.2 5.5-8 6.3-4.8-.8-8-2.8-8-6.3V7.5L12 3z" />
                <path d="M12 8v7" />
                <path d="M9 12l3-3 3 3" />
              </svg>
              <span id="brand-label">跳跃</span>
            </span>
          </div>
          <div class="stats">
            <div class="stat">
              <span id="score-label">得分</span>
              <b id="score">0</b>
            </div>
            <div class="stat best" id="best-stat">
              <span id="best-label">最高</span>
              <b id="best">0</b>
              <em class="new-best" id="new-best" hidden>NEW</em>
            </div>
          </div>
        </header>

        <div class="milestone" id="milestone" aria-hidden="true"></div>

        <div class="overlay" id="overlay" hidden>
          <div class="card" id="overlay-card" role="dialog" aria-modal="true" aria-labelledby="overlay-title" tabindex="-1">
            <p class="kicker" id="overlay-kicker">跳跃 / JUMP</p>
            <h1 id="overlay-title">踩上云端</h1>
            <p class="hint" id="overlay-hint"></p>

            <div class="summary" id="overlay-summary" hidden>
              <div>
                <span id="final-score-label">本局</span>
                <b id="final-score">0</b>
              </div>
              <div>
                <span id="final-best-label">最高</span>
                <b id="final-best">0</b>
                <span class="record-mark" id="final-record" hidden></span>
              </div>
            </div>

            <div class="keys-row" id="overlay-keys">
              <span class="key-group">
                <span class="keycap">←</span><span class="keycap">→</span><span class="keys-label" id="key-move">移动</span>
              </span>
              <span class="keys-divider"></span>
              <span class="key-group">
                <span class="keycap" id="key-space">Space</span><span class="keys-label" id="key-start">开始</span>
              </span>
              <span class="keys-divider" id="key-pause-divider"></span>
              <span class="key-group" id="key-group-pause">
                <span class="keycap">P</span><span class="keys-label" id="key-pause">暂停</span>
              </span>
            </div>

            <button class="primary" id="primary" type="button">开始跳跃</button>
          </div>
        </div>

        <div class="toast" id="toast" role="status" aria-live="polite" hidden>
          <span>
            <span id="toast-message"></span>
            <span class="toast-code" id="toast-code"></span>
          </span>
          <button class="toast-retry" id="toast-retry" type="button" hidden>重试</button>
        </div>

        <div class="footer" aria-hidden="true">
          <span class="agent-hint" id="agent-hint"></span>
          <span class="save-indicator" id="save-indicator">已保存</span>
          <span class="footer-right">
            <span class="keys-label-long" id="footer-hint">← → / A D 移动 · P 暂停</span>
          </span>
        </div>

        <p class="sr-only" id="a11y-status" aria-live="polite"></p>
      </div>
    </div>

    <script>
      __INLINE_SCRIPT__
    </script>
  </body>
</html>
