# __GAME_TITLE__

__GAME_DESCRIPTION__

A **vanilla canvas** game project in the `asset-zip-v2` resource-package format:
the game ships as an entry HTML document plus external scripts, styles and
assets, packed into a deterministic `<id>-<version>.dshgame.zip`.

- Game id: `__GAME_ID__`
- Author: `__GAME_AUTHOR__`
- SDK: `^1.0.0` · Runtime: `^1.0.0`
- Package format: `asset-zip-v2` (see `dsh-game.config.json`)

## Files

```text
manifest.json            authoritative game manifest (becomes game.json)
index.html               entry template (external references; no inline code)
src/main.js              bootstrap, game loop, SDK lifecycle, score/session
src/render.js            canvas renderer, DPR/resize handling
src/storage.js           pure serialize/deserialize (Continue)
src/i18n.js              zh / en copy
assets/                  external images/audio/sprites (served from the resource origin)
levels/                  JSON level data (use game.runtime.assetUrl('levels/...'))
audio/                   optional audio files
scripts/                 CLI wrappers (build/validate/dev/pack/publish)
dsh-game.config.json     format + layout config
```

Build output (`dist/`):

```text
dist/index.html          entry document (external script/style references)
dist/dsh-sdk.js          platform Game SDK, loaded before the game bundle
dist/scripts/main.js     bundled game code
dist/styles/styles.css   external stylesheet (source CSS basename preserved; e.g. src/styles.css)
dist/assets/…            external resources
dist/levels/…  dist/audio/…
dist/game.json           manifest inside the package
dist/dsh-package.json    file manifest (path/size/sha256), sorted
```

## Quick start

```bash
export DSH_GAME_CLI=/path/to/dsh-game-market/scripts/cli/dsh-game.mjs
npm run build       # -> dist/ tree + dsh-package.json (deterministic)
npm run validate    # build -> validate dist -> pack -> validate final ZIP
npm run dev         # simulator; loads through a wrapper + resource origin like the Host
npm run pack        # -> dist/__GAME_ID__-1.0.0.dshgame.zip + .sha256 (deterministic, 0444 entries)
npm run publish -- --url https://…/__GAME_ID__-1.0.0.dshgame.zip --cover https://…/cover.png
```

Load package files at runtime with the SDK:

```js
const levelUrl = game.runtime.assetUrl('levels/level-01.json');
const level = await (await fetch(levelUrl)).json(); // connect-src allows the resource origin
```

Static references in HTML/CSS are rewritten by build: local `src/styles.css`
becomes `dist/styles/styles.css` (the source basename is kept), local images
become `assets/<file>`, and the CLI rejects any external URL / inline script /
inline style.

The wrapper scripts resolve the CLI in this order: `DSH_GAME_CLI` env var →
`cli` field in `dsh-game.config.json` → repository-template fallback. `create`
does **not** write an absolute `cli` path (projects stay portable), so export
`DSH_GAME_CLI=/path/to/dsh-game-market/scripts/cli/dsh-game.mjs` or add
`"cli": "<path>"` to the config before running `npm run build`.
