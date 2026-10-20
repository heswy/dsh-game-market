# Runtime presentation for games

The Runtime is **full-bleed**: the iframe fills the main panel; there is no
platform black letterbox or outer stage frame in V1.1+.

## Requirements (both formats)

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
- Load the game SDK with `await game.ready()` before the main loop in both
  formats; keep pause/resume, `before-save`, visibility handling and Continue.

## `asset-zip-v2` specifics

- Styles must live in external `styles/*.css` files (inline `<style>` blocks and
  `on*=` handlers are rejected, `GM-4283`). Use classes + `addEventListener`.
- Load levels/audio/images with package-relative URLs
  (`fetch('./levels/level-01.json')`, `<audio src="audio/step.wav">`) or
  `game.runtime.assetUrl(...)` for dynamically built URLs. Never use absolute
  or external URLs.
- A ZIP game has no inline SDK: `<script src="dsh-sdk.js">` must load before
  your game module (the template already does this).
- The game document is served from an isolated resource origin with a strict
  CSP; package-relative requests are allowed, everything else is blocked. The
  full-bleed/safe-area rules are identical to `html-v1`.

## Local Simulator note (ZIP)

In `dsh-game dev`, a ZIP game is shown through the platform **wrapper iframe**
(`/wrapper?src=/res/<instance>/<token>/index.html`) which embeds the game frame;
`html-v1` uses a single game iframe. The wrapper exists only for local
simulation and is not part of the package. Debug inside the inner game frame
(console/network), and do not copy wrapper CSS into the game: the game document
must be full-bleed on its own. The real Runtime CSP applies to the game
document; package-relative `/res/…` requests should return 200.

## Self-check

Resize from wide to 375px, toggle light/dark, open the Runtime with an Agent
waiting. For ZIP packages also confirm in the network panel that every
script/style/level/audio request is package-relative (no external origin) and
that no console CSP violation appears. Verify the game is playable with no
black bars and no essential UI under the platform controls.
