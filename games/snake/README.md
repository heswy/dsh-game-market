# Snake (V0 built-in game)

Classic Snake used as the Runtime/SDK reference game. Single self-contained
HTML entry, no network, no external assets.

## Build

```bash
node scripts/build-snake.mjs   # writes games/snake/dist/index.html (committed)
```

The build inlines `packages/sdk/src/sdk.js` (as `DSH_GAME_SDK`) and
`src/game.js` + `src/logic.js` into `dist/index.html`. The output is checked for
external `<script src>`, `<link href>`, `@import` and nested iframes.

## Controls

- Arrow keys / WASD: turn (the first press also starts a restored board)
- Space / P: local pause / resume
- Enter: restart after game over

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
Runtime `resume` lifecycle event.

## Test

```bash
node --test "games/snake/test/*.test.js"
```
