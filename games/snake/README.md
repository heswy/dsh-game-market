# Snake (V1 built-in game)

Classic Snake used as the Runtime/SDK reference game. V1 ships it as a single,
self-contained HTML package with an **embedded manifest v1**, zero external
assets, zero network access and zero third-party dependencies.

## Build

```bash
node scripts/build-snake.mjs     # writes games/snake/dist/index.html (committed)
npm run build                    # client bundle + snake, in order
```

The build:

1. reads `games/snake/game.json` as the build-time manifest source and validates
   it with the shared `validateManifest` (manifest v1, SDK/Runtime `^1.0.0`);
2. bundles `packages/sdk/src/sdk.js` (SDK 1.0.0) as `DSH_GAME_SDK` and
   `src/game.js` + `src/logic.js` + `src/resume.js` into one inline script;
3. embeds the manifest exactly once as
   `<script type="application/json" id="dsh-game-manifest">` (≤ 64 KiB);
4. validates the finished HTML with the same `validatePackageHtml` scanner the
   Host/CLI use (single file, manifest, self-containment) and writes
   `games/snake/dist/index.html`.

The output is deterministic: two consecutive builds produce byte-identical
files. `dist/index.html` is committed because the Bundle serves it directly.

V1 packages do not carry `entry` / `cover` / `screenshots`. The build strips a
legacy `entry` key from `game.json` before embedding, so the manifest inside
`dist/index.html` is always strict manifest v1; the field can be deleted from the
source once the repository-level V0 checker stops requiring it.

## Manifest (embedded)

| Field | Value |
|---|---|
| `manifestVersion` | `1` |
| `id` / `name` / `version` | `snake` / `Snake` / `1.0.0` |
| `categories` / `capabilities` | `["arcade"]` / `["storage", "score"]` |
| `sdkVersion` / `runtimeVersion` | `^1.0.0` / `^1.0.0` |
| `viewport` | `960×540`, `contain` |
| `score` | `higher-better`, `0–1000000`, integer |
| `save` | `schemaVersion: 1` |

## Controls

- Arrow keys / WASD: turn (the first press also starts a restored board)
- Space / P: local pause / resume; Esc also toggles pause
- Enter: restart after game over, start a fresh board
- The primary button is keyboard focusable; the `Space`/`P`/`Enter` bindings are
  shown on the ready / paused / game-over cards.

## UX / accessibility

- HUD: brand + version, heading chip, score and personal best (personal best is
  highlighted when the current run sets a new record).
- Direction feedback: the heading chip, the head eyes and a heading wedge on the
  board all follow the queued turn.
- Ready / continue / paused / game-over / error overlays share one card with
  stats, keycaps and a 44 px primary action.
- The whole game is a 16:9 stage; HUD and overlays scale with the frame, so
  1440 px and 640 px windows keep the board visible without overlap or
  horizontal scroll.
- Dark and light palettes are selected from `game.runtime.theme` and re-applied
  if the Runtime changes it while a game is open; text/surface pairs meet WCAG AA
  contrast.
- `game.runtime.reducedMotion` (or `prefers-reduced-motion`) disables the food
  pulse, score pops, death flash and CSS transitions, and is re-checked on every
  frame so a mid-game setting change takes effect immediately.
- `lifecycle.on('hidden')` stops the tick/render loop immediately;
  `lifecycle.on('visible')` restores rendering, while a platform pause keeps the
  loop stopped until the matching `resume` (no ticks are lost or replayed).
- An `aria-live` status announces start/pause/game-over/new-record events; the
  error overlay shows the `GM-*` code and offers a retry.

## Save

`storage.save('current', serialize(state))` with `schemaVersion: 1`:

```json
{
  "schemaVersion": 1,
  "cols": 26,
  "rows": 14,
  "snake": [{ "x": 13, "y": 7 }],
  "direction": { "x": 1, "y": 0 },
  "pendingDirections": [],
  "food": { "x": 3, "y": 3 },
  "score": 20,
  "foodEaten": 2,
  "status": "playing",
  "rngState": 123456
}
```

A mid-run save is restored as `ready` (continue screen); the snake never moves
by itself after a restore. `resume-paused` launches additionally wait for the
Runtime `resume` lifecycle event; the platform confirmation is the only prompt.

Saves are written by the platform `before-save` window (30 s interval,
pause/hidden/leave) and by the game on pause/wall/self-collision. Session start
happens once on boot; `session.end({outcome:'completed', score})` and
`score.submit(score)` fire once on game over.

## Test

```bash
node --test "games/snake/test/*.test.js"
npm test
```

Pure logic tests cover board setup, turning, collisions, food, scoring, speed,
save round-trips, deterministic seeds, the win condition and the resume policy.
Node 24 needs the glob form (or plain `npm test`); a directory argument
(`node --test games/snake/test`) is not expanded by the Node 24 runner.

## Manual smoke

Open `games/snake/dist/index.html` inside the DSH Runtime (or any host that
provides the `DSH_GAME_SDK` bridge). The page must render the 16:9 board and show
the ready card; no network requests are made.
