# Ember Drift

A two-minute hand-painted space dodge for the DSH Game Market. Drift a small
skiff through a warm emberfall, gather fallen stars for score, and stay alight
until the clock runs out. Every visual is drawn procedurally on one canvas; the
package is a single self-contained HTML file.

- Game id: `ember-drift`
- Version: `1.0.0`
- SDK: `^1.0.0` · Runtime: `^1.0.0`
- Capabilities: `storage`, `score`
- Entry: `src/main.js` → `dist/index.html` → `dist/ember-drift-1.0.0.html`

## The run

- **Two minutes.** The clock starts at `2:00` and counts down to `0:00`.
- **Three hull hearts.** An asteroid contact costs one heart and grants a short
  shield; at zero hearts the run ends early.
- **Stars are score.** A star is worth `10 × streak`; the streak rises to `×5`
  and resets when an asteroid hits.
- **Controls.** `←` / `→` or `A` / `D` drift; `P` pauses/resumes; `Space`
  starts, continues, resumes or restarts; `N` starts fresh when a Continue save
  exists. `Tab` and `Escape` are deliberately not intercepted so they keep their
  Runtime meaning.
- **Pause/Continue.** The Runtime pause button and `P` both freeze the clock.
  Autosave runs every 2.5s while playing and also on pause, hidden/blur and
  `before-save`. Reloading an unfinished run offers **Space — continue your
  drift**; a finished run never does.

## Files

```text
manifest.json              manifest v1 source (embedded into the package)
index.html                 HTML shell (manifest, SDK and assets are inlined by build)
src/main.js                loop, SDK lifecycle, score/session, input
src/render.js              full-bleed canvas renderer: painted sky, ship, rocks, stars, HUD
src/storage.js             pure serialize/deserialize (Continue)
src/i18n.js                zh / en copy
src/rng.js                 seeded gameplay RNG
src/styles.css             light/dark palettes and full-viewport layout
scripts/cli.mjs            resolves the local dsh-game CLI (DSH_GAME_CLI override)
scripts/build.mjs          npm run build
scripts/validate.mjs       npm run validate (build + shared validator)
scripts/dev.mjs            npm run dev (Local Runtime Simulator)
scripts/pack.mjs           npm run pack
scripts/publish.mjs        npm run publish (offline author helper)
sdk/index.d.ts             @dsh-game/sdk v1 public typings
```

## Build and validate

The project has no third-party dependencies and no `npm install` step. The
generated `dsh-game.config.json` records the local platform CLI path used when
this project was created. On another machine, either point `DSH_GAME_CLI` at
`<platform-checkout>/scripts/cli/dsh-game.mjs` or regenerate the project with
`create-dsh-game`.

```bash
npm run build       # deterministic single-file build -> dist/index.html
npm run validate    # rebuild + shared package/manifest/security validation
npm run pack        # -> dist/ember-drift-1.0.0.html + .sha256
npm run dev         # Local Runtime Simulator, http://127.0.0.1:4321/
```

The build is deterministic: the same sources produced byte-identical output
across repeated builds (`156,912` bytes,
`sha256 f882e1159f7f2b3f73373793d4a6297b0c7a148d8472299b1f1193b72b38dfd9`).

## Runtime presentation

- The canvas fills the iframe; there is no letterbox, outer frame or fixed
  stage. Layout follows the real viewport through `resize`.
- The HUD begins at `y = 127` so the top 112px Runtime controls stay clear. The
  bottom-right 96×96 Agent presence area contains no HUD or controls; the hint
  pill stops 112px from the right edge.
- Palettes come from CSS custom properties on `data-theme`; the renderer reads
  them directly and repaints when `game.runtime.theme` changes.
- `game.runtime.reducedMotion` disables shake, particle density, flicker and
  ambient twinkle.
- No external scripts, styles, images, fonts or network calls at runtime.

## SDK notes

- `await game.ready()` gates the main loop; failures show a visible error panel.
- `state` is serialized synchronously and only through `game.storage` (key
  `current`, schema version 1, a few KiB per save).
- `pause`, `resume`, `hidden`, `visible` and `before-save` are registered before
  `ready`; paused time never enters the game clock.
- `score.submit` runs once at the end with a visible `GM-4006` toast path;
  `game.score.getBest()` seeds the HUD and finish panel.
- A finished or invalid save returns `null` from `deserializeState`, so Continue
  cannot resume a completed/lost run.

## Licensing

Code and procedurally generated art are released under the MIT license in
`LICENSE`. No third-party art, fonts, audio or assets are included; the package
uses system font families only.

## Author-side status

This project was produced during an independent evaluation of the
`dsh-game-developer` Skill (v1.0.0). Author GitHub identity, public source
hosting, public package/media URLs and maintainer review are **pending**; see
`submission/submission.json` and `submission/verification-report.md`.
