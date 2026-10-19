# Runtime presentation for games

The Runtime is **full-bleed**: the iframe fills the main panel; there is no
platform black letterbox or outer stage frame in V1.1+.

## Requirements

- `html, body, #app` fill the viewport; use flex/grid/`100dvh`, not a fixed
  pixel outer box.
- Paint a full-viewport background in both light and dark themes. No transparent
  edges, no inner “stage border”, no fixed aspect-ratio letterbox.
- Do not hard-code 960×540. Respond to window `resize`; read
  `game.runtime.viewport` as a measured CSS size/DPR snapshot when you need it.
- Keep key HUD/controls out of platform overlays:
  - **top 112px of the viewport**: back/pause/save controls and macOS clearance;
  - **bottom-right 96×96**: Agent presence (expanded bubble may reach 254×184).
  Gameplay objects may pass through, but scores/lives/buttons must stay visible.
- Respect `prefers-reduced-motion`/`game.runtime.reducedMotion` and the active
  theme (use `data-theme` + CSS variables, not only OS media queries).

## Self-check

Resize from wide to 375px, toggle light/dark, open the Runtime with an Agent
waiting, and verify the game is playable with no black bars and no essential UI
under the platform controls.
