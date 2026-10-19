# Package, manifest and SDK (author-facing summary)

Authoritative sources in the platform checkout (do not fork their rules):

- `PRD｜DSH Game Market.md` §8.2 (manifest/package), §8.3–8.4 (SDK/Runtime bridge)
- `packages/shared/src/manifest.js` — `validatePackageHtml` / manifest validation
- `docs/developer-guide.md` — complete developer workflow
- `packages/sdk/src/index.d.ts` — public SDK types

## Package

- Exactly one UTF-8 HTML file (no BOM), ≤20 MiB, no external resources at runtime.
- Exactly one `<script type="application/json" id="dsh-game-manifest">` with a
  manifest v1 JSON object; no `entry`/`cover`/`screenshots` fields in the package.
- Build with the generated project (`npm run build`); do not hand-edit
  `dist/index.html`. `npm run pack` emits `<id>-<version>.html` + `.sha256`.

## Manifest essentials

Required: `manifestVersion:1`, `id`, `name`, `version`, `author.name`,
`description`, 1–3 `categories`, `capabilities`, `sdkVersion`, `runtimeVersion`.

Conditional: `save` when `storage` is declared; `score` when `score` is declared.
V1 capabilities are only `storage` and `score`. `viewport` is **advisory** (see
presentation reference); `fit` is compatibility-only.

## SDK lifecycle

- Import/inject SDK per template; `await game.ready()` before the loop.
- Use `game.storage.save/load/remove`, `game.session.start/end`,
  `game.score.submit/getBest` only when declared.
- Handle lifecycle `pause`/`resume` and `before-save`; no paused time in game
  clocks; continue from a saved state.
- Read `game.runtime` read-only fields (theme, reducedMotion, viewport); do not
  mutate them or assume a subscription event for viewport.

## Validation

- `npm run validate` is the author-side gate; it runs the same shared validator
  as the platform. A failure includes field paths/codes—fix the source.
- `npm run pack` output sha256 must match a rebuilt package byte-for-byte.
