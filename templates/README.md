# DSH Game Market templates

Two starting points for a V1 single-file game (PRD §8.2.9):

| Template | Tooling | Use when |
|---|---|---|
| [`vanilla/`](vanilla/) | None; the zero-dependency `dsh-game` CLI builds/inlines everything | You want the smallest project and a fully offline workflow (`npm run build` with no `npm install`) |
| [`react/`](react/) | Vite + React + `vite-plugin-singlefile` | You prefer React/TS; `create-dsh-game` generates a complete project (needs `npm install`) |

Both templates must keep the 11 required behaviors from PRD §8.2.9:

1. `await game.ready()` before the main loop; visible error state on failure.
2. Pure synchronous, idempotent `serialize()` / `deserialize()`.
3. `pause` stops rAF/timers and saves; `resume` recomputes `dt` without paused time.
4. `visibilitychange` and `blur` behave like pause.
5. Canvas focus, `Tab` leaves the canvas, `Escape` is not intercepted.
6. `resize` handling, minimum 320×240, DPR capped at 2.
7. No network or external resources; system fonts only.
8. `score.submit` on completion with visible `GM-4006` handling.
9. zh/en copy in a dedicated i18n module.
10. Runtime Simulator via `scripts/dev.mjs`; CI-friendly `validate`.
11. README covers rename/capabilities/preview/pack/publish.

## Creating a project

```bash
node scripts/cli/create-dsh-game.mjs my-game --template vanilla
node scripts/cli/create-dsh-game.mjs my-game --template react
```

`create-dsh-game` copies the template, substitutes game metadata, generates
`manifest.json` / `package.json` / `dsh-game.config.json`, copies SDK typings and
(for React) generates the offline `vendor/dsh-game-sdk.js` bundle.

The templates themselves are **sources**: `templates/vanilla` is buildable in the
repository (`node scripts/cli/dsh-game.mjs build templates/vanilla`), while
`templates/react` is illustrative and requires its project dependencies.

See `docs/developer-guide.md` for the full tutorial and `docs/developer-cli.md`
for command reference.
