# __GAME_TITLE__

__GAME_DESCRIPTION__

A **Vite + React** template for the DSH Game Market. It demonstrates the V1
single-file package pipeline: React renders UI chrome only, while mutable game
state, the animation loop and the renderer live outside React state.

> This template requires `npm install` (React/Vite tooling). The repository does
> not build it as part of `npm run verify`; the vanilla template is the
> dependency-free reference. Generated projects are complete and buildable.

## Files

```text
manifest.json                 build-time manifest v1 source
index.html                    Vite entry HTML (manifest is injected by the plugin)
vite.config.ts                React + singlefile + dsh-game-manifest plugin
src/main.tsx                  React root
src/App.tsx                   UI chrome, lifecycle wiring, score/session
src/sdk.ts                    typed SDK access (generated vendor bundle)
src/game/loop.ts              pause-safe requestAnimationFrame loop
src/game/render.ts            canvas renderer (DPR cap 2, actual canvas size)
src/game/storage.ts           pure serialize/deserialize (Continue)
src/game/i18n.ts              zh / en copy
vendor/dsh-game-sdk.js        offline @dsh-game/sdk v1 ESM bundle (generated)
vendor/dsh-game-sdk.d.ts      generated bundle typings
sdk/index.d.ts                canonical @dsh-game/sdk v1 typings
scripts/dev.mjs               Local Runtime Simulator against dist/index.html
scripts/validate.mjs          CI validation of the built package
scripts/pack.mjs              dist/<id>-<version>.html + .sha256
scripts/publish.mjs           registry entry + upload plan + checklist
```

## Setup

Generated projects are portable: set the CLI path once (or use the CLI directly).

```bash
export DSH_GAME_CLI=/path/to/dsh-game-market/scripts/cli/dsh-game.mjs
npm install
npm run build       # vite build -> dist/index.html (single file)
npm run validate    # dsh-game validate dist/index.html (+ packed file if present)
npm run runtime     # Local Runtime Simulator (serves the built file)
```

`npm run dev` is the normal Vite dev server for fast UI iteration; the **Game
Runtime Simulator** is `npm run runtime` (it uses `scripts/dev.mjs` and serves
`dist/index.html` through the real sandbox/bridge contract).

### How the package stays self-contained

- `vite-plugin-singlefile` inlines JS and CSS into `dist/index.html`.
- `vite.config.ts` injects `manifest.json` as the single
  `<script id="dsh-game-manifest">` tag.
- `vendor/dsh-game-sdk.js` is a generated, dependency-free bundle of the SDK;
  Vite inlines it, so the game imports no external packages at runtime.
- No external fonts, images or network calls: keep assets as `data:` URIs or
  generated in code. `npm run validate` rejects external subresources.

## The 11 template behaviors

1. `await game.ready()` before the loop; a visible error panel on failure.
2. Pure synchronous `serialize()`/`deserialize()` in `src/game/storage.ts`.
3. `pause` stops the loop and saves immediately; `resume` resets `dt` so paused
   time never counts as game time.
4. `visibilitychange` and window `blur` pause the game.
5. Canvas receives focus; `Tab` leaves it; `Escape` is never intercepted.
6. Resize handling at the actual canvas size, DPR capped at 2.
7. No network or external resources; system fonts only.
8. `game.score.submit()` on game over, with visible `GM-4006` handling.
9. All copy in `src/game/i18n.ts` (`zh` / `en`).
10. `npm run validate` is CI-ready; `npm run runtime` is the simulator.
11. This README covers rename/capabilities/preview/package/publish.

## Runtime presentation (V1.1)

The canvas and background fill the iframe, without an outer frame. Keep critical
HUD and controls below the top **112px full-width band** and outside the
**bottom-right 96×96** permanent Agent button area. The renderer demonstrates the
HUD offset; the footer avoids the Agent corner. Expanded Agent messages can
briefly cover the bottom-right **254×184** area; avoid unique controls there.
These are CSS pixels from iframe edges; no parent CSS access is needed.

`manifest.viewport` is a recommended design size. `game.runtime.viewport` after
ready is a read-only snapshot of the **measured container size and DPR**, not a
lifecycle event. The template measures the canvas on window `resize`.

## Rename / capabilities

1. Edit `manifest.json` (`id`, `name`, `description`, `author`, `version`).
2. Keep `id` matching `^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$`, no `--`, no
   reserved names.
3. V1 capabilities are only `storage` and `score`; `storage` requires
   `save.schemaVersion`, `score` requires the `score` range object.
4. Change `src/game/i18n.ts` title/copy and `index.html` `<title>`.

## Package / publish

```bash
npm run build
npm run validate
npm run pack
npm run publish -- \
  --url https://github.com/<you>/<repo>/releases/download/v1.0.0/__GAME_ID__-1.0.0.html \
  --cover https://raw.githubusercontent.com/<you>/<repo>/main/cover.png
```

`publish` runs offline and emits `dist/registry-entry.json`,
`dist/upload-plan.md` and `dist/review-checklist.md`; add
`--registry-dir ../my-registry` to merge into a local `registry/games.json`.

## Notes

- The generated `vendor/dsh-game-sdk.js` is pinned to the SDK version that
  `create-dsh-game` bundled. Re-generate the project (or copy the vendor file
  from a fresh project) when the platform SDK changes.
- React StrictMode is intentionally not used in `src/main.tsx`: its development
  double-effect would create two SDK instances and two game loops.
- Game state must not go into React state per frame; keep it in refs. React
  state is only for phase/HUD/toast updates.
- Local install is unverified by design; confirm the file in the Market.
