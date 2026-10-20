# __GAME_TITLE__

__GAME_DESCRIPTION__

A **Vite + React** game project in the `asset-zip-v2` resource-package format.

- Game id: `__GAME_ID__`
- Author: `__GAME_AUTHOR__`
- SDK: `^1.0.0` · Runtime: `^1.0.0`
- Package format: `asset-zip-v2` (see `dsh-game.config.json`)
- Vite `base: './'` → external relative `assets/*.js|css`; **not** single-file/inline

## Build & validate

```bash
export DSH_GAME_CLI=/path/to/dsh-game-market/scripts/cli/dsh-game.mjs
npm install
npm run build       # vite build -> CLI finalize (game.json + dsh-package.json) -> pack ZIP -> validate ZIP
npm run validate    # validate dist/ + the final packed .dshgame.zip
npm run dev         # simulator: wrapper iframe + resource origin
npm run pack        # deterministic <id>-<version>.dshgame.zip (0444 entries) + .sha256
npm run publish -- --url https://…/__GAME_ID__-1.0.0.dshgame.zip --cover https://…/cover.png
```

The package layout is produced by Vite plus the CLI finalize step:

```text
dist/index.html          Vite entry (relative ./assets/*.js|css)
dist/dsh-sdk.js          platform SDK copied from public/ (loaded before the bundle)
dist/assets/*.js|*.css   external bundle + stylesheet
dist/game.json           authoritative manifest inside the package
dist/dsh-package.json    file manifest (sorted path/size/sha256)
```

Runtime assets referenced by the game can use `game.runtime.assetUrl(...)`;
external URLs and inline code are rejected by validation (contract D-C).
