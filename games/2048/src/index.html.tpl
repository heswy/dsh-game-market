<!doctype html>
<html lang="zh-CN" data-theme="dark" data-reduced-motion="false">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="dark light" />
    <title>__GAME_TITLE__ · __GAME_VERSION__</title>
    <script>
      // Avoid a dark flash in light mode before the SDK reports the platform theme.
      (function () {
        try {
          if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            document.documentElement.dataset.theme = 'light';
          }
          if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            document.documentElement.dataset.reducedMotion = 'true';
          }
        } catch (error) {
          // Theme detection is best effort.
        }
      })();
    </script>
    <script type="application/json" id="dsh-game-manifest">__MANIFEST_JSON__</script>
    <style>
      /* ------------------------------------------------------------------ *
       * Tokens
       * ------------------------------------------------------------------ */
      :root {
        color-scheme: dark;
        --font-display: 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, 'Songti SC',
          'Noto Serif SC', 'Times New Roman', serif;
        --font-ui: ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
          'Microsoft YaHei', sans-serif;
        --font-mono: ui-monospace, 'SFMono-Regular', 'Cascadia Mono', 'Segoe UI Mono', Menlo, Consolas, monospace;

        --bg: #0b0d0c;
        --bg-warm: rgba(206, 168, 78, 0.11);
        --bg-cool: rgba(88, 128, 110, 0.1);
        --grain: rgba(255, 255, 255, 0.014);
        --ink: #ede8dc;
        --ink-soft: #b9b2a2;
        --ink-faint: #908a7d;
        --hairline: rgba(237, 232, 220, 0.11);
        --hairline-strong: rgba(237, 232, 220, 0.2);
        --brass: #d8b364;
        --brass-strong: #f0d79a;
        --brass-deep: #a97f2c;
        --brass-ink: #221a09;
        --danger: #e8897a;
        --ok: #9dc3a9;
        --panel: rgba(22, 26, 23, 0.72);
        --panel-solid: #151916;
        --board: #141814;
        --board-top: rgba(255, 255, 255, 0.025);
        --board-edge: rgba(216, 179, 100, 0.2);
        --cell: rgba(237, 232, 220, 0.042);
        --cell-edge: rgba(237, 232, 220, 0.05);
        --focus: #f0d79a;
        --overlay-bg: rgba(6, 8, 7, 0.66);
        --shadow-lg: 0 34px 80px rgba(0, 0, 0, 0.42);
        --tile-shadow: 0 12px 26px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.26);
        --tile-shadow-light: 0 2px 0 rgba(47, 38, 22, 0.14), 0 10px 22px rgba(60, 46, 22, 0.14),
          inset 0 1px 0 rgba(255, 255, 255, 0.5);
        --stat-panel: rgba(20, 24, 21, 0.6);
      }

      html[data-theme='light'] {
        color-scheme: light;
        --bg: #f2ece0;
        --bg-warm: rgba(180, 128, 44, 0.13);
        --bg-cool: rgba(88, 128, 110, 0.09);
        --grain: rgba(35, 28, 18, 0.02);
        --ink: #241f17;
        --ink-soft: #5c5345;
        --ink-faint: #6a6153;
        --hairline: rgba(58, 47, 30, 0.16);
        --hairline-strong: rgba(58, 47, 30, 0.28);
        --brass: #8a5c16;
        --brass-strong: #6d470d;
        --brass-deep: #b0812f;
        --brass-ink: #fbf4e4;
        --danger: #a33526;
        --ok: #3f7159;
        --panel: rgba(255, 253, 247, 0.66);
        --panel-solid: #faf5ea;
        --board: #d7cab4;
        --board-top: rgba(255, 255, 255, 0.45);
        --board-edge: rgba(120, 88, 30, 0.3);
        --cell: rgba(64, 50, 28, 0.12);
        --cell-edge: rgba(64, 50, 28, 0.08);
        --focus: #6d470d;
        --overlay-bg: rgba(54, 45, 30, 0.42);
        --shadow-lg: 0 30px 70px rgba(68, 52, 26, 0.2);
        --tile-shadow: var(--tile-shadow-light);
        --stat-panel: rgba(255, 253, 247, 0.6);
      }

      /* ------------------------------------------------------------------ *
       * Base
       * ------------------------------------------------------------------ */
      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        padding: 0;
        min-width: 320px;
        min-height: 100%;
        background: var(--bg);
        color: var(--ink);
        font-family: var(--font-ui);
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
      }

      html {
        height: 100%;
      }

      body {
        height: 100%;
        overflow: hidden;
        background-image: radial-gradient(120% 90% at 6% -12%, var(--bg-warm), transparent 58%),
          radial-gradient(100% 82% at 108% 110%, var(--bg-cool), transparent 62%),
          linear-gradient(155deg, rgba(255, 255, 255, 0.018), transparent 42%);
        background-attachment: fixed;
        touch-action: manipulation;
      }

      .app {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: auto minmax(0, 1fr) auto;
        gap: clamp(8px, 1.5vmin, 16px);
        width: 100%;
        max-width: 1180px;
        height: 100vh;
        height: 100dvh;
        margin: 0 auto;
        padding: clamp(14px, 2.2vmin, 26px) clamp(14px, 3.2vw, 44px) clamp(10px, 1.6vmin, 18px);
      }

      .app::after {
        content: '';
        position: fixed;
        inset: 0;
        z-index: 0;
        pointer-events: none;
        background-image: repeating-linear-gradient(112deg, var(--grain) 0 1px, transparent 1px 3px);
        opacity: 0.55;
      }

      .ambient {
        position: fixed;
        z-index: 0;
        border-radius: 50%;
        pointer-events: none;
        filter: blur(90px);
      }

      .ambient-brass {
        top: -16vmin;
        left: -13vmin;
        width: 46vmin;
        height: 46vmin;
        background: radial-gradient(circle, rgba(216, 179, 100, 0.2), transparent 68%);
        opacity: 0.55;
      }

      .ambient-jade {
        right: -19vmin;
        bottom: -22vmin;
        width: 56vmin;
        height: 56vmin;
        background: radial-gradient(circle, rgba(94, 138, 116, 0.18), transparent 70%);
        opacity: 0.5;
      }

      .sr-only {
        position: absolute !important;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
        border: 0;
      }

      :focus-visible {
        outline: 2px solid var(--focus);
        outline-offset: 2px;
      }

      /* ------------------------------------------------------------------ *
       * Masthead
       * ------------------------------------------------------------------ */
      .masthead {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: clamp(12px, 3vw, 40px);
        padding-bottom: clamp(8px, 1.5vmin, 16px);
        border-bottom: 1px solid var(--hairline);
      }

      .identity {
        min-width: 0;
      }

      .kicker {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 clamp(5px, 0.9vmin, 9px);
        font-family: var(--font-mono);
        font-size: clamp(8px, 1.12vmin, 10.5px);
        line-height: 1.2;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: var(--ink-faint);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .kicker-mark {
        flex: 0 0 auto;
        width: 8px;
        height: 8px;
        border-radius: 2px;
        background: var(--brass);
        box-shadow: 0 0 0 3px rgba(216, 179, 100, 0.13);
      }

      .kicker-sep {
        color: var(--brass);
        opacity: 0.8;
      }

      .wordmark {
        display: flex;
        align-items: flex-start;
        margin: 0;
        font-family: var(--font-display);
        font-size: clamp(40px, 7.6vmin, 72px);
        font-weight: 600;
        line-height: 0.86;
        letter-spacing: -0.045em;
        color: var(--ink);
        font-variant-numeric: tabular-nums lining-nums;
      }

      .wordmark-tick {
        width: clamp(5px, 0.85vmin, 8px);
        height: clamp(5px, 0.85vmin, 8px);
        margin: clamp(7px, 1.3vmin, 12px) 0 0 clamp(5px, 0.9vmin, 9px);
        border-radius: 1px;
        background: var(--brass);
      }

      .tagline {
        margin: clamp(6px, 1vmin, 10px) 0 0;
        font-family: var(--font-display);
        font-style: italic;
        font-size: clamp(11px, 1.5vmin, 14px);
        line-height: 1.3;
        letter-spacing: 0.015em;
        color: var(--ink-soft);
      }

      .ledger {
        display: flex;
        flex: 0 0 auto;
        align-items: flex-end;
        gap: clamp(6px, 1.1vw, 12px);
      }

      .stat {
        position: relative;
        min-width: clamp(54px, 7.6vmin, 86px);
        padding: clamp(6px, 1vmin, 9px) clamp(8px, 1.2vmin, 12px) clamp(5px, 0.8vmin, 8px);
        border: 1px solid var(--hairline);
        border-radius: 10px;
        background: var(--stat-panel);
        text-align: right;
        backdrop-filter: blur(9px);
        -webkit-backdrop-filter: blur(9px);
        transition: border-color 180ms ease, box-shadow 180ms ease;
      }

      .stat-label {
        display: block;
        font-family: var(--font-mono);
        font-size: clamp(7px, 1.02vmin, 9.5px);
        line-height: 1.1;
        letter-spacing: 0.2em;
        color: var(--ink-faint);
      }

      .stat-value {
        display: block;
        margin-top: 1px;
        font-family: var(--font-mono);
        font-size: clamp(17px, 2.8vmin, 26px);
        font-weight: 500;
        line-height: 1.2;
        font-variant-numeric: tabular-nums;
        color: var(--ink);
      }

      .stat-best .stat-value {
        color: var(--brass);
      }

      .stat-note {
        display: block;
        margin-top: 1px;
        font-family: var(--font-mono);
        font-size: clamp(5.5px, 0.8vmin, 7.5px);
        letter-spacing: 0.16em;
        color: var(--ink-faint);
        opacity: 0.85;
      }

      .stat-best.is-record {
        border-color: var(--brass);
        box-shadow: 0 0 0 1px rgba(216, 179, 100, 0.22), 0 10px 28px rgba(216, 179, 100, 0.1);
      }

      .stat-best.is-record .stat-note {
        color: var(--brass);
        opacity: 1;
      }

      .score-delta {
        position: absolute;
        top: 1px;
        right: clamp(8px, 1.2vmin, 12px);
        font-family: var(--font-mono);
        font-size: clamp(9px, 1.2vmin, 11px);
        letter-spacing: 0.02em;
        color: var(--brass-strong);
        opacity: 0;
        pointer-events: none;
      }

      .score-delta.show {
        animation: delta-rise 820ms cubic-bezier(0.2, 0.7, 0.25, 1) both;
      }

      @keyframes delta-rise {
        0% {
          opacity: 0;
          transform: translateY(7px);
        }
        22% {
          opacity: 1;
        }
        100% {
          opacity: 0;
          transform: translateY(-15px);
        }
      }

      /* ------------------------------------------------------------------ *
       * Board
       * ------------------------------------------------------------------ */
      .board-zone {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        min-height: 0;
      }

      .board-frame {
        --board-size: min(520px, calc(100vw - 40px));
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: clamp(7px, 1.15vmin, 12px);
        max-width: 100%;
      }

      .board {
        --gap: clamp(7px, calc(var(--board-size) * 0.018), 13px);
        position: relative;
        width: var(--board-size);
        height: var(--board-size);
        padding: var(--gap);
        border: 1px solid var(--board-edge);
        border-radius: calc(var(--board-size) * 0.028);
        background: linear-gradient(180deg, var(--board-top), transparent 36%), var(--board);
        box-shadow: var(--shadow-lg), inset 0 1px 0 rgba(255, 255, 255, 0.05),
          inset 0 -24px 46px rgba(0, 0, 0, 0.22);
        outline: none;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
      }

      html[data-theme='light'] .board {
        box-shadow: var(--shadow-lg), inset 0 1px 0 rgba(255, 255, 255, 0.6),
          inset 0 -20px 40px rgba(90, 68, 34, 0.1);
      }

      .board::after {
        content: '';
        position: absolute;
        inset: -5px;
        border: 1px solid rgba(216, 179, 100, 0.11);
        border-radius: calc(var(--board-size) * 0.034);
        pointer-events: none;
      }

      .board:focus-visible {
        outline: 2px solid var(--focus);
        outline-offset: 5px;
      }

      .board.is-bumped {
        animation: board-bump 220ms ease-out;
      }

      @keyframes board-bump {
        0% {
          border-color: var(--board-edge);
        }
        38% {
          border-color: rgba(240, 215, 154, 0.55);
          box-shadow: var(--shadow-lg), 0 0 0 1px rgba(240, 215, 154, 0.22);
        }
        100% {
          border-color: var(--board-edge);
        }
      }

      .board-grid {
        position: absolute;
        inset: var(--gap);
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        grid-template-rows: repeat(4, 1fr);
        gap: var(--gap);
      }

      .grid-row {
        display: contents;
      }

      .cell {
        position: relative;
        border-radius: calc(var(--gap) * 0.82);
        background: var(--cell);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02), inset 0 -1px 0 var(--cell-edge);
      }

      .cell::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 3px;
        height: 3px;
        margin: -1.5px 0 0 -1.5px;
        border-radius: 50%;
        background: var(--hairline);
        opacity: 0.85;
      }

      .tile-layer {
        --cell: calc((100% - 3 * var(--gap)) / 4);
        position: absolute;
        inset: var(--gap);
        pointer-events: none;
      }

      .tile {
        --dx: 0;
        --dy: 0;
        position: absolute;
        left: calc(var(--col) * (var(--cell) + var(--gap)));
        top: calc(var(--row) * (var(--cell) + var(--gap)));
        display: grid;
        place-items: center;
        width: var(--cell);
        height: var(--cell);
        border-radius: calc(var(--gap) * 0.82);
        background: var(--tile-bg, #2a2a26);
        color: var(--tile-fg, #f4efe3);
        box-shadow: var(--tile-shadow), 0 0 0 1px var(--tile-edge, rgba(0, 0, 0, 0.06));
        font-family: var(--font-display);
        font-weight: 600;
        line-height: 1;
        letter-spacing: -0.04em;
        font-variant-numeric: tabular-nums lining-nums;
        transform: translate(calc(var(--dx) * (100% + var(--gap))), calc(var(--dy) * (100% + var(--gap))));
        transition: transform 155ms cubic-bezier(0.2, 0.75, 0.25, 1);
        will-change: transform;
      }

      .tile.settled {
        transform: translate(0, 0);
      }

      .tile::before {
        content: '';
        position: absolute;
        inset: 1px 1px auto;
        height: 44%;
        border-radius: inherit;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.24), transparent);
        opacity: 0.55;
        pointer-events: none;
      }

      .tile-face {
        position: relative;
        display: block;
        transform-origin: 50% 52%;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.14);
      }

      .tile[data-digits='1'] {
        font-size: calc(var(--board-size) * 0.098);
      }

      .tile[data-digits='2'] {
        font-size: calc(var(--board-size) * 0.086);
      }

      .tile[data-digits='3'] {
        font-size: calc(var(--board-size) * 0.07);
      }

      .tile[data-digits='4'] {
        font-size: calc(var(--board-size) * 0.057);
      }

      .tile[data-digits='5'] {
        font-size: calc(var(--board-size) * 0.046);
      }

      .tile.is-spawn .tile-face {
        animation: face-arrive 190ms cubic-bezier(0.2, 0.8, 0.3, 1) both;
      }

      .tile.is-merge .tile-face {
        animation: face-merge 240ms cubic-bezier(0.2, 0.85, 0.3, 1.25) 120ms both;
      }

      @keyframes face-arrive {
        0% {
          opacity: 0;
          transform: scale(0.56);
        }
        100% {
          opacity: 1;
          transform: scale(1);
        }
      }

      @keyframes face-merge {
        0% {
          transform: scale(1);
        }
        42% {
          transform: scale(1.16);
        }
        100% {
          transform: scale(1);
        }
      }

      /* Warm mineral progression: bone -> ember -> gold -> black foil. */
      .tile[data-value='2'] {
        --tile-bg: #ded7c6;
        --tile-fg: #2a2417;
        --tile-edge: rgba(42, 36, 23, 0.12);
      }
      .tile[data-value='4'] {
        --tile-bg: #d2c2a1;
        --tile-fg: #2a2417;
        --tile-edge: rgba(42, 36, 23, 0.14);
      }
      .tile[data-value='8'] {
        --tile-bg: #dda264;
        --tile-fg: #2a1a07;
        --tile-edge: rgba(61, 36, 8, 0.2);
      }
      .tile[data-value='16'] {
        --tile-bg: #d08045;
        --tile-fg: #2a1606;
        --tile-edge: rgba(61, 30, 6, 0.22);
      }
      .tile[data-value='32'] {
        --tile-bg: #b95433;
        --tile-fg: #fdf4e6;
        --tile-edge: rgba(74, 24, 10, 0.24);
      }
      .tile[data-value='64'] {
        --tile-bg: #9e3f2b;
        --tile-fg: #fdf4e6;
        --tile-edge: rgba(64, 18, 8, 0.28);
      }
      .tile[data-value='128'] {
        --tile-bg: #d2ad4f;
        --tile-fg: #291e06;
        --tile-edge: rgba(78, 55, 8, 0.24);
      }
      .tile[data-value='256'] {
        --tile-bg: #ddbd63;
        --tile-fg: #291e06;
        --tile-edge: rgba(78, 55, 8, 0.24);
      }
      .tile[data-value='512'] {
        --tile-bg: #e7cc7a;
        --tile-fg: #291e06;
        --tile-edge: rgba(78, 55, 8, 0.24);
      }
      .tile[data-value='1024'] {
        --tile-bg: #f0dda2;
        --tile-fg: #291e06;
        --tile-edge: rgba(78, 55, 8, 0.22);
      }
      .tile[data-value='2048'] {
        --tile-bg: #f6e8bb;
        --tile-fg: #241a05;
        --tile-edge: rgba(120, 84, 12, 0.34);
      }
      .tile[data-value='4096'] {
        --tile-bg: #23231e;
        --tile-fg: #e8c979;
        --tile-edge: rgba(232, 201, 121, 0.32);
      }
      .tile[data-value='8192'] {
        --tile-bg: #2b2a22;
        --tile-fg: #f0d79a;
        --tile-edge: rgba(240, 215, 154, 0.34);
      }
      .tile.is-beyond {
        --tile-bg: #181a17;
        --tile-fg: #f5e6b8;
        --tile-edge: rgba(245, 230, 184, 0.4);
      }

      html[data-theme='light'] .tile[data-value='2'] {
        --tile-bg: #f8f2e4;
        --tile-fg: #3a3123;
        --tile-edge: rgba(58, 49, 35, 0.2);
      }
      html[data-theme='light'] .tile[data-value='4'] {
        --tile-bg: #ede0c8;
        --tile-fg: #3a3123;
        --tile-edge: rgba(58, 49, 35, 0.2);
      }
      html[data-theme='light'] .tile[data-value='8'] {
        --tile-bg: #e8ac6d;
        --tile-fg: #3a2409;
        --tile-edge: rgba(92, 54, 12, 0.2);
      }
      html[data-theme='light'] .tile[data-value='16'] {
        --tile-bg: #d98a4e;
        --tile-fg: #341d07;
        --tile-edge: rgba(84, 44, 8, 0.22);
      }
      html[data-theme='light'] .tile[data-value='32'] {
        --tile-bg: #c25e3b;
        --tile-fg: #fff6e9;
        --tile-edge: rgba(92, 34, 12, 0.24);
      }
      html[data-theme='light'] .tile[data-value='64'] {
        --tile-bg: #a94a32;
        --tile-fg: #fff6e9;
        --tile-edge: rgba(82, 28, 12, 0.28);
      }
      html[data-theme='light'] .tile[data-value='128'] {
        --tile-bg: #c9a443;
        --tile-fg: #2f2307;
        --tile-edge: rgba(90, 64, 10, 0.24);
      }
      html[data-theme='light'] .tile[data-value='256'] {
        --tile-bg: #d6b451;
        --tile-fg: #2f2307;
        --tile-edge: rgba(90, 64, 10, 0.24);
      }
      html[data-theme='light'] .tile[data-value='512'] {
        --tile-bg: #e3c46c;
        --tile-fg: #2f2307;
        --tile-edge: rgba(90, 64, 10, 0.24);
      }
      html[data-theme='light'] .tile[data-value='1024'] {
        --tile-bg: #ecd693;
        --tile-fg: #2f2307;
        --tile-edge: rgba(90, 64, 10, 0.22);
      }
      html[data-theme='light'] .tile[data-value='2048'] {
        --tile-bg: #f3e4b4;
        --tile-fg: #2a1f05;
        --tile-edge: rgba(120, 84, 12, 0.36);
      }
      html[data-theme='light'] .tile[data-value='4096'] {
        --tile-bg: #2a2a24;
        --tile-fg: #eed69a;
        --tile-edge: rgba(74, 58, 22, 0.4);
      }
      html[data-theme='light'] .tile[data-value='8192'] {
        --tile-bg: #34342c;
        --tile-fg: #f2dfa8;
        --tile-edge: rgba(74, 58, 22, 0.44);
      }
      html[data-theme='light'] .tile.is-beyond {
        --tile-bg: #1e201c;
        --tile-fg: #f7ecc4;
        --tile-edge: rgba(30, 32, 28, 0.5);
      }

      .tile.is-target {
        box-shadow: var(--tile-shadow), 0 0 0 1px rgba(240, 215, 154, 0.5), 0 0 24px rgba(216, 179, 100, 0.16);
      }

      .tile.is-target::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: linear-gradient(128deg, transparent 24%, rgba(255, 255, 255, 0.42) 46%, transparent 64%);
        opacity: 0.45;
        pointer-events: none;
      }

      .tile.is-win {
        animation: tile-win 900ms ease-out;
      }

      @keyframes tile-win {
        0% {
          box-shadow: var(--tile-shadow), 0 0 0 1px rgba(240, 215, 154, 0.9), 0 0 0 0 rgba(240, 215, 154, 0.55);
        }
        100% {
          box-shadow: var(--tile-shadow), 0 0 0 1px rgba(240, 215, 154, 0.5), 0 0 0 26px rgba(240, 215, 154, 0);
        }
      }

      /* ------------------------------------------------------------------ *
       * Board meta
       * ------------------------------------------------------------------ */
      .board-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: var(--board-size);
        max-width: 100%;
        min-width: 0;
      }

      .undo-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        padding: 0 12px;
        border: 1px solid var(--hairline);
        border-radius: 10px;
        background: var(--panel);
        color: var(--ink);
        font-family: var(--font-ui);
        font-size: clamp(11.5px, 1.55vmin, 13.5px);
        font-weight: 500;
        cursor: pointer;
        transition: border-color 140ms ease, background 140ms ease, opacity 140ms ease;
      }

      .undo-btn:hover:not(:disabled) {
        border-color: var(--hairline-strong);
        background: var(--panel-solid);
      }

      .undo-btn:active:not(:disabled) {
        transform: translateY(1px);
      }

      .undo-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .undo-icon {
        flex: 0 0 auto;
        color: var(--brass);
      }

      .undo-btn:disabled .undo-icon {
        color: var(--ink-faint);
      }

      .undo-count {
        padding-left: 8px;
        border-left: 1px solid var(--hairline);
        font-family: var(--font-mono);
        font-size: clamp(8.5px, 1.15vmin, 10.5px);
        letter-spacing: 0.04em;
        color: var(--brass);
        white-space: nowrap;
      }

      .undo-btn:disabled .undo-count {
        color: var(--ink-faint);
      }

      .meta-right {
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        justify-content: flex-end;
        gap: clamp(6px, 1vmin, 10px);
        min-width: 0;
      }

      .save-indicator {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 6px;
        min-height: 32px;
        padding: 4px 2px;
        border: 0;
        background: none;
        font-family: var(--font-mono);
        font-size: clamp(8px, 1.12vmin, 10px);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--ink-faint);
        white-space: nowrap;
        cursor: default;
      }

      .save-indicator:disabled {
        opacity: 1;
      }

      .save-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--ink-faint);
        box-shadow: 0 0 0 3px rgba(144, 138, 125, 0.12);
      }

      .save-indicator[data-state='saving'] .save-dot {
        background: var(--brass);
        animation: save-pulse 1s ease-in-out infinite;
      }

      .save-indicator[data-state='saved'] .save-dot {
        background: var(--ok);
        box-shadow: 0 0 0 3px rgba(157, 195, 169, 0.14);
      }

      .save-indicator[data-state='failed'] {
        color: var(--danger);
        cursor: pointer;
        text-decoration: underline;
        text-decoration-style: dotted;
        text-underline-offset: 3px;
      }

      .save-indicator[data-state='failed'] .save-dot {
        background: var(--danger);
        box-shadow: 0 0 0 3px rgba(232, 137, 122, 0.16);
      }

      @keyframes save-pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.35;
        }
      }

      .meta-divider {
        width: 1px;
        height: 11px;
        background: var(--hairline);
      }

      .meta-hint {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        font-size: clamp(9.5px, 1.3vmin, 11.5px);
        line-height: 1.4;
        color: var(--ink-faint);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .meta-hint.is-alert {
        color: var(--danger);
      }

      .meta-hint.is-brass {
        color: var(--brass);
      }

      /* ------------------------------------------------------------------ *
       * Footer
       * ------------------------------------------------------------------ */
      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding-top: clamp(6px, 1vmin, 10px);
        border-top: 1px solid var(--hairline);
      }

      .keys {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 12px;
        font-size: clamp(9.5px, 1.28vmin, 11.5px);
        color: var(--ink-faint);
      }

      .key-group {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        white-space: nowrap;
      }

      kbd {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 19px;
        padding: 0 4px;
        border: 1px solid var(--hairline-strong);
        border-bottom-width: 2px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.035);
        color: var(--ink-soft);
        font-family: var(--font-mono);
        font-size: clamp(8px, 1.02vmin, 9.5px);
        line-height: 1;
      }

      html[data-theme='light'] kbd {
        background: rgba(255, 255, 255, 0.42);
      }

      .key-or {
        opacity: 0.6;
      }

      .key-sep {
        width: 1px;
        height: 11px;
        background: var(--hairline);
      }

      .footer-mark {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 8px;
        font-family: var(--font-mono);
        font-size: clamp(8px, 1.06vmin, 10px);
        letter-spacing: 0.14em;
        color: var(--ink-faint);
        white-space: nowrap;
      }

      .footer-rule {
        width: 24px;
        height: 1px;
        background: var(--hairline-strong);
      }

      /* ------------------------------------------------------------------ *
       * Overlay
       * ------------------------------------------------------------------ */
      .overlay {
        position: fixed;
        inset: 0;
        z-index: 20;
        display: grid;
        place-items: center;
        padding: clamp(18px, 4vw, 40px);
        background: var(--overlay-bg);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        animation: overlay-in 180ms ease-out both;
      }

      .overlay.hidden {
        display: none;
      }

      @keyframes overlay-in {
        0% {
          opacity: 0;
        }
        100% {
          opacity: 1;
        }
      }

      .overlay-card {
        width: min(430px, 100%);
        padding: clamp(22px, 4vmin, 34px);
        border: 1px solid rgba(216, 179, 100, 0.3);
        border-radius: 18px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.045), transparent 40%), var(--panel-solid);
        box-shadow: 0 40px 110px rgba(0, 0, 0, 0.56), inset 0 1px 0 rgba(255, 255, 255, 0.06);
        text-align: left;
      }

      html[data-theme='light'] .overlay-card {
        box-shadow: 0 34px 90px rgba(58, 44, 22, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.8);
      }

      .overlay-ornament {
        display: flex;
        gap: 5px;
        margin-bottom: clamp(12px, 2vmin, 18px);
      }

      .overlay-ornament span {
        width: 16px;
        height: 2px;
        border-radius: 1px;
        background: var(--brass);
      }

      .overlay-ornament span:nth-child(2) {
        opacity: 0.55;
      }

      .overlay-ornament span:nth-child(3) {
        opacity: 0.25;
      }

      .overlay-kicker {
        margin: 0 0 9px;
        font-family: var(--font-mono);
        font-size: clamp(7.5px, 1.05vmin, 9.5px);
        letter-spacing: 0.24em;
        text-transform: uppercase;
        color: var(--brass);
      }

      .overlay-title {
        margin: 0 0 10px;
        font-family: var(--font-display);
        font-size: clamp(25px, 4vmin, 34px);
        font-weight: 600;
        line-height: 1.16;
        letter-spacing: -0.02em;
        color: var(--ink);
        text-wrap: balance;
      }

      .overlay-hint {
        margin: 0 0 18px;
        font-size: clamp(11.5px, 1.5vmin, 13px);
        line-height: 1.7;
        color: var(--ink-soft);
      }

      .overlay-detail {
        margin: -6px 0 18px;
        font-family: var(--font-mono);
        font-size: clamp(9px, 1.2vmin, 11px);
        line-height: 1.6;
        letter-spacing: 0.04em;
        color: var(--brass);
      }

      .overlay-detail.hidden {
        display: none;
      }

      .overlay-detail.is-alert {
        color: var(--danger);
      }

      .overlay-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
      }

      .primary {
        min-height: 46px;
        padding: 0 22px;
        border: 1px solid var(--brass-strong);
        border-radius: 12px;
        background: linear-gradient(180deg, #ecd8a4, #c9a45a);
        color: #221a09;
        font-family: var(--font-ui);
        font-size: clamp(13px, 1.7vmin, 14px);
        font-weight: 700;
        letter-spacing: 0.01em;
        cursor: pointer;
        box-shadow: 0 10px 24px rgba(216, 179, 100, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.5);
        transition: filter 120ms ease, transform 120ms ease;
      }

      .primary:hover {
        filter: brightness(1.05);
      }

      .primary:active {
        transform: translateY(1px);
      }

      .overlay-footnote {
        margin: clamp(12px, 2vmin, 18px) 0 0;
        font-family: var(--font-mono);
        font-size: clamp(7px, 0.95vmin, 8.5px);
        line-height: 1.5;
        letter-spacing: 0.11em;
        text-transform: uppercase;
        color: var(--ink-faint);
      }

      /* ------------------------------------------------------------------ *
       * Responsive
       * ------------------------------------------------------------------ */
      html[data-embed='true'] .app {
        padding-top: calc(clamp(14px, 2.2vmin, 26px) + 40px);
      }

      /* Keep save/status text clear of the Agent Presence whale (bottom-right). */
      html[data-embed='true'] .board-meta {
        padding-right: 64px;
      }

      html[data-embed='true'] .footer-mark {
        display: none;
      }

      @media (max-height: 760px) {
        html[data-embed='true'] .app {
          padding-top: calc(10px + 44px);
        }
        html[data-embed='true'] .board-meta {
          padding-right: 58px;
        }
        .tagline {
          display: none;
        }
        .app {
          gap: 6px;
          padding-top: 10px;
        }
        .masthead {
          padding-bottom: 8px;
        }
      }

      @media (max-height: 620px) {
        .footer {
          display: none;
        }
        .kicker {
          margin-bottom: 4px;
        }
        .wordmark {
          font-size: clamp(32px, 6.4vmin, 54px);
        }
      }

      @media (max-width: 640px) {
        .app {
          padding-right: 12px;
          padding-left: 12px;
        }
        .masthead {
          gap: 10px;
        }
        .kicker {
          font-size: 7px;
          letter-spacing: 0.14em;
        }
        .tagline {
          display: none;
        }
        .ledger {
          gap: 5px;
        }
        .stat {
          min-width: 50px;
          padding: 5px 7px 4px;
        }
        .stat-note {
          display: none;
        }
        .stat-value {
          font-size: clamp(15px, 3.4vw, 20px);
        }
        .stat-label {
          letter-spacing: 0.12em;
        }
        .board-meta {
          gap: 6px;
        }
        .undo-btn {
          padding: 0 9px;
          gap: 6px;
        }
        .undo-label {
          display: none;
        }
        .meta-divider {
          display: none;
        }
        .meta-hint {
          font-size: 9px;
        }
        .keys {
          gap: 3px 8px;
        }
        .footer-mark {
          display: none;
        }
        .overlay-card {
          width: 100%;
        }
      }

      @media (max-width: 480px) {
        .masthead {
          flex-direction: column;
          align-items: stretch;
          gap: 8px;
        }
        .ledger {
          justify-content: flex-start;
        }
        .stat {
          flex: 1 1 0;
        }
        .wordmark {
          font-size: clamp(34px, 12vw, 52px);
        }
        .keys {
          gap: 3px 6px;
        }
        .key-sep,
        .key-or {
          display: none;
        }
      }

      /* ------------------------------------------------------------------ *
       * Motion preferences
       * ------------------------------------------------------------------ */
      html[data-reduced-motion='true'] .tile,
      html[data-reduced-motion='true'] .undo-btn,
      html[data-reduced-motion='true'] .stat,
      html[data-reduced-motion='true'] .primary,
      html[data-reduced-motion='true'] .overlay {
        transition: none !important;
        animation: none !important;
      }

      html[data-reduced-motion='true'] .tile.is-spawn .tile-face,
      html[data-reduced-motion='true'] .tile.is-merge .tile-face,
      html[data-reduced-motion='true'] .tile.is-win,
      html[data-reduced-motion='true'] .board.is-bumped,
      html[data-reduced-motion='true'] .score-delta.show {
        animation: none !important;
      }

      @media (prefers-reduced-motion: reduce) {
        .tile,
        .undo-btn,
        .stat,
        .primary,
        .overlay {
          transition-duration: 1ms !important;
          animation-duration: 1ms !important;
          animation-iteration-count: 1 !important;
        }
        .tile.is-spawn .tile-face,
        .tile.is-merge .tile-face,
        .tile.is-win,
        .board.is-bumped,
        .score-delta.show {
          animation: none !important;
        }
      }
    </style>
  </head>
  <body>
    <div class="app" id="app">
      <div class="ambient ambient-brass" aria-hidden="true"></div>
      <div class="ambient ambient-jade" aria-hidden="true"></div>

      <header class="masthead">
        <div class="identity">
          <p class="kicker">
            <span class="kicker-mark" aria-hidden="true"></span>
            <span>DSH Game Market</span>
            <span class="kicker-sep">/</span>
            <span>Puzzle No. 2048</span>
          </p>
          <h1 class="wordmark">2048<span class="wordmark-tick" aria-hidden="true"></span></h1>
          <p class="tagline">把相同的数字，推到一起。</p>
        </div>
        <div class="ledger" role="group" aria-label="计分板">
          <div class="stat" id="score-stat">
            <span class="stat-label">SCORE</span>
            <span class="stat-value" id="score">0</span>
            <span class="score-delta" id="score-delta" aria-hidden="true"></span>
          </div>
          <div class="stat stat-best" id="best-stat">
            <span class="stat-label">BEST</span>
            <span class="stat-value" id="best">0</span>
            <span class="stat-note" id="best-note">PERSONAL</span>
          </div>
          <div class="stat stat-moves" id="moves-stat">
            <span class="stat-label">MOVES</span>
            <span class="stat-value" id="moves">0</span>
          </div>
        </div>
      </header>

      <main class="board-zone" id="board-zone">
        <div class="board-frame" id="board-frame">
          <div
            class="board"
            id="board"
            tabindex="0"
            role="grid"
            aria-rowcount="4"
            aria-colcount="4"
            aria-label="2048 棋盘，4 行 4 列"
            aria-describedby="board-help"
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight W A S D P U Enter"
          >
            <div class="board-grid" id="board-grid"></div>
            <div class="tile-layer" id="tile-layer" aria-hidden="true"></div>
          </div>
          <div class="board-meta" id="board-meta">
            <button id="undo" class="undo-btn" type="button" disabled>
              <svg class="undo-icon" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                <path
                  d="M7.6 4.6 4 8.2l3.6 3.6M4.5 8.2h6.1a4.7 4.7 0 0 1 4.7 4.7v1.2"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <span class="undo-label">撤销</span>
              <span class="undo-count" id="undo-count">剩 1 次</span>
            </button>
            <div class="meta-right">
              <button id="save-indicator" class="save-indicator" type="button" data-state="idle" disabled>
                <span class="save-dot" aria-hidden="true"></span>
                <span id="save-text">未保存</span>
              </button>
              <span class="meta-divider" aria-hidden="true"></span>
              <span class="meta-hint" id="status-line">方向键或 WASD 开始</span>
            </div>
          </div>
          <p id="board-help" class="sr-only">
            使用方向键或 WASD 滑动棋盘，相同数字合并。按 P 暂停或继续，按 U 撤销一次，按回车开始或重开。斜向滑动手势也可以操作棋盘。
          </p>
        </div>
      </main>

      <footer class="footer">
        <div class="keys" aria-hidden="true">
          <span class="key-group"><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd></span>
          <span class="key-or">或</span>
          <span class="key-group"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span>
          <span class="key-sep"></span>
          <span class="key-group"><kbd>P</kbd> 暂停</span>
          <span class="key-group"><kbd>U</kbd> 撤销</span>
          <span class="key-group"><kbd>↵</kbd> 开始 / 重开</span>
        </div>
        <div class="footer-mark">
          <span class="footer-rule" aria-hidden="true"></span>
          <span>No. 2048 · v__GAME_VERSION__</span>
        </div>
      </footer>

      <div
        id="overlay"
        class="overlay hidden"
        role="dialog"
        aria-modal="false"
        aria-labelledby="overlay-title"
        aria-describedby="overlay-hint"
      >
        <div class="overlay-card">
          <div class="overlay-ornament" aria-hidden="true"><span></span><span></span><span></span></div>
          <p id="overlay-kicker" class="overlay-kicker">2048</p>
          <h2 id="overlay-title" class="overlay-title">把相同的数字推到一起</h2>
          <p id="overlay-hint" class="overlay-hint">方向键 / WASD 滑动 · 每局一次撤销</p>
          <p id="overlay-detail" class="overlay-detail hidden"></p>
          <div id="overlay-actions" class="overlay-actions">
            <button id="primary" class="primary" type="button">开始游戏</button>
          </div>
          <p id="overlay-footnote" class="overlay-footnote">进度会自动保存 · 离开后可继续</p>
        </div>
      </div>

      <div id="live-region" class="sr-only" role="status" aria-live="polite"></div>
    </div>

    <script>__INLINE_SCRIPT__</script>
  </body>
</html>
