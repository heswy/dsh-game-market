# __GAME_TITLE__

__GAME_DESCRIPTION__

A **vanilla canvas** game project for the DSH Game Market. No framework, no build
dependencies, no `npm install`: it is built into one self-contained HTML file by
the local `dsh-game` CLI.

- Game id: `__GAME_ID__`
- Author: `__GAME_AUTHOR__`
- SDK: `^1.0.0` · Runtime: `^1.0.0`
- Entry: `src/main.js` → `dist/index.html` → `dist/__GAME_ID__-1.0.0.html`

## Files

```text
manifest.json            build-time manifest v1 source (embedded into the package)
index.html               HTML template (manifest, SDK and assets are inlined by build)
src/main.js              bootstrap, game loop, SDK lifecycle, score/session
src/render.js            canvas renderer, DPR/resize handling
src/storage.js           pure serialize/deserialize (Continue)
src/i18n.js              zh / en copy
scripts/cli.mjs          resolves the local dsh-game CLI (DSH_GAME_CLI override)
scripts/build.mjs        npm run build
scripts/validate.mjs     npm run validate (build + full validation, CI-ready)
scripts/dev.mjs          npm run dev (Local Runtime Simulator)
scripts/pack.mjs         npm run pack
scripts/publish.mjs      npm run publish
sdk/index.d.ts           @dsh-game/sdk v1 public typings
```

## Quick start

```bash
npm run build       # -> dist/index.html
npm run validate    # build + validate (exit 0/1/2/3)
npm run dev         # -> http://127.0.0.1:4321/ (fake Runtime + controls)
```

The build is deterministic: the same sources produce byte-identical
`dist/index.html`, so `sha256` values are reproducible.

## Local Runtime Simulator

`npm run dev` opens the Game Runtime Simulator. It loads the game inside
`sandbox="allow-scripts"` and plays the trusted Runtime side of the bridge:

- **Agent:** Running / Waiting user / Completed / Error / Idle
- **Runtime:** Pause / Resume / `before-save` / Clear save / Reload / theme / locale / viewport / Ping
- **Bridge log:** every request/event/response is shown in the page and logged to
  the browser console.

`Waiting user` sends `pause` with `reason: 'waiting-user'`; `Completed` does
**not** pause the game (the platform shows its own reminder). `before-save`
verifies your autosave path. `Clear save` + `Reload` verifies the first-run flow;
play, wait for an autosave or press `before-save`, then reload to verify
**Continue**.

## Rename the package / game id

1. Edit `manifest.json`: `id`, `name`, `description`, `author`, `version`.
2. The id must match `^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$`, must not contain
   `--` and must not be reserved. The directory name does not have to match, but
   the built package is always named `<id>-<version>.html`.
3. `npm run build && npm run pack` after changing the id.
4. Update the title in `index.html`/`src/i18n.js` if you want different copy.

## Add a capability

V1 supports exactly `storage` and `score`. Add them to `manifest.json`:

```json
"capabilities": ["storage", "score"],
"save": { "schemaVersion": 1 },
"score": { "direction": "higher-better", "min": 0, "max": 1000000, "integer": true }
```

- `storage` requires `save.schemaVersion` and lets the game call
  `game.storage.save/load/remove`.
- `score` requires `score` and lets the game call `game.score.submit/getBest`.
- Do not add a capability unless you use it. Network, filesystem, clipboard,
  DSH APIs and other games' data are **not** available in V1.

## SDK cheatsheet

```js
const game = DSH_GAME_SDK.createGameSDK();
game.lifecycle.on('pause', () => stopLoop());
game.lifecycle.on('resume', () => startLoop());
game.lifecycle.on('before-save', () => saveNow());
const info = await game.ready();                      // 10s timeout
const saved = await game.storage.load('current');     // null when missing
await game.storage.save('current', state);            // JSON value, <=256 KiB
await game.session.start();                           // idempotent, Continue
game.score.submit(score).catch(handleScoreError);     // GM-4006 visible
await game.session.end({ outcome: 'completed', score });
```

The full published surface is in `sdk/index.d.ts`; errors always have a
`GM-*` `code`, `retryable` and optional `details`.

## Build / validate / pack / publish

```bash
npm run build
npm run validate
npm run pack
npm run publish -- \
  --url https://github.com/<you>/<repo>/releases/download/v1.0.0/__GAME_ID__-1.0.0.html \
  --cover https://raw.githubusercontent.com/<you>/<repo>/main/cover.png

# optional: merge the entry into a local registry checkout
npm run publish -- --url ... --cover ... --registry-dir ../my-registry
```

`publish` is offline. It writes:

- `dist/registry-entry.json` — paste into `registry/games.json`
- `dist/upload-plan.md` — GitHub Release upload commands and checks
- `dist/review-checklist.md` — automatic + manual review checklist

Upload the `.html` and `.sha256` to a GitHub Release (or any https host on the
Registry allowlist), then merge the registry entry via PR.

## Install in the Market

1. Build/pack the package.
2. In DSH open **Game Market → My Games → Install local** (or the Market's
   local install action), choose `dist/__GAME_ID__-1.0.0.html`, and confirm —
   local packages are unverified, so the Market asks for confirmation.
3. The game appears in My Games and runs in the sandboxed Runtime.
4. To update locally, install the newer `<id>-<version>.html`.

## i18n

All visible strings are in `src/i18n.js` (`zh` / `en`). The initial locale comes
from `game.runtime.locale`; there is no runtime locale switch inside the game
(DSH passes the locale when the game launches).

## Constraints (V1)

- One self-contained HTML file, UTF-8 without BOM, ≤20 MiB.
- No network APIs, external scripts/styles/images/fonts, `@import`, `<iframe>`
  or `srcset` (the build/validate step rejects them).
- System fonts only; images must be `data:` URIs.
- Persist data only through `game.storage`; never `localStorage`/IndexedDB.
- Pause/resume saving is platform-driven (`lifecycle` + `before-save`); never
  keep counting time while paused.
