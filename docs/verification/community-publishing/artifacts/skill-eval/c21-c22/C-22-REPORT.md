# C-22 — 1.0.0 → 1.0.1 update with save compatibility (independent evidence)

**Status: update package independently verified locally; save/Continue
compatibility is LOCALLY SIMULATED with the Local Runtime Simulator
(`dsh-game dev`, fake bridge) + headless Chrome driven over CDP.**
No DSH Host install, no real Runtime storage, no publish/release was performed.

Evidence root: `<tmp>/dsh-c21-c22/`
Machine summary: `<tmp>/dsh-c21-c22/evidence-summary.json`

## 1. The 1.0.1 update

Update project: `<tmp>/dsh-c21-c22/c22-update` (same id `c21-invalid`, copied from
the fixed 1.0.0 project of C-21). Full diff `1.0.0 → 1.0.1`:

| File | Change |
| --- | --- |
| `manifest.json` | `version` `1.0.0` → `1.0.1` |
| `package.json` | `version` `1.0.0` → `1.0.1` |
| `index.html` | new `<span class="build-badge" id="build-badge">v1.0.1</span>` (UI) |
| `src/styles.css` | `.build-badge` style (UI) |
| `src/main.js` | gameplay: star catch `10` → `12` points, meteor `25` → `30` |
| `CHANGELOG.md` | added (project-only, not in the package) |
| `src/storage.js`, `manifest.save` | **unchanged** — `SAVE_VERSION = 1`, `save.schemaVersion = 1`, identical serialized keys |

## 2. Build / validate / pack 1.0.1

```bash
cd <tmp>/dsh-c21-c22/c22-update
export DSH_GAME_CLI="<repo>/scripts/cli/dsh-game.mjs"
npm run build      # exit 0  logs/00-update-build.log
npm run validate   # exit 0  logs/01-update-validate.log
npm run pack       # exit 0  logs/02-update-pack.log
node "$DSH_GAME_CLI" validate dist/c21-invalid-1.0.1.html --json   # exit 0  logs/03-…json.log
cd dist && shasum -a 256 -c c21-invalid-1.0.1.html.sha256          # exit 0  logs/04-…check.log
```

| Field | 1.0.0 (C-21) | 1.0.1 (C-22) |
| --- | --- | --- |
| Package | `c21-invalid-1.0.0.html` | `c21-invalid-1.0.1.html` |
| Size | 108,202 bytes | **108,589 bytes** |
| SHA-256 | `6af1eb530dce0a5b9f4cee8269ddf5c740c3b2e1e3ca6c85814c10948bda7cb9` | **`4d6e30b691feeeb90f1a79d39e7fc637a86e7f70ea7c9ddb20d206ba21c29d49`** |
| `validate --json` | `ok: true`, no errors/warnings | `ok: true`, no errors/warnings |

Artifacts copied for durability:
`<tmp>/dsh-c21-c22/evidence-c22/artifacts/c21-invalid-1.0.1.html` (+ `.sha256`).

Re-confirmed after the checkout reached `dc646d84`: `npm run validate` / `pack`
exit 0 and the same sha256 (`logs/12-reconfirm-*.log`, `logs/13-reconfirm-pack.log`).

## 3. Save/Continue compatibility — what was actually done

Method: **locally simulated**. The Local Runtime Simulator serves the built game
into a sandboxed iframe and keeps saves in an in-page in-memory store
(`state.save`); it has no persistence across page loads and no DSH Host.
Two complementary runs were performed.

### Run A — natural persistence across the source update (`logs/08-save-compat-demo.log`)

Project `<tmp>/dsh-c21-c22/c22-demo` (clean 1.0.0 copy of the fixed project).

1. `node "$DSH_GAME_CLI" dev <tmp>/dsh-c21-c22/c22-demo --port 4391` (log `logs/06-dev-server-1.0.0.log`);
   simulator page opened in headless Chrome 155 (`--headless=new --remote-debugging-port=9333`),
   driven through CDP (`save-compat-demo.mjs`).
2. Real gameplay on 1.0.0: pointer-driven basket sweeps until a usable run, then
   the simulator's `pause` control (the game's own blur/pause → `before-save` path).
   Captured 1.0.0 save (exact JSON in `save-1.0.0.json`):
   `score 20, lives 2, elapsed 6.5477, saveVersion 1, stars 4, gameOver false`.
3. The 1.0.1 source files (the 5 files from §1) were copied into the **same**
   project directory while the simulator page stayed open; the dev server
   rebuilds on every `/game` request. `/health` then reported `1.0.1`
   (`{"game":{"id":"c21-invalid","version":"1.0.1"}}`) and the served package
   contained the `v1.0.1` badge.
4. `Reload game` — same page, same in-memory save store, 1.0.1 code. Result:
   hint `An unfinished save was found — press Space to continue`, badge `v1.0.1`,
   and the store still held the byte-identical 1.0.0 payload.
5. Space → playing, ~1.2 s of gameplay, then `pause` again. New save
   (`save-1.0.1-after-continue.json`):
   `score 44, lives 2, elapsed 7.7977, saveVersion 1, stars 3, gameOver false`.

| Check | Result |
| --- | --- |
| served version/badge after update | 1.0.1 ✅ |
| save survived the reload byte-identically | ✅ |
| Continue offered | ✅ |
| Space continued the run (playing hint, not game-over) | ✅ |
| score preserved/advanced 20 → 44 | ✅ |
| time advanced 6.5477 → 7.7977 | ✅ |
| lives preserved 2 → 2 | ✅ |
| `saveVersion`/key shape unchanged | ✅ |
| no external network request, no console error | ✅ |

All 15 checks in `save-compat-evidence.json` are `true`
(`failedChecks: []`); screenshots `shots/01-…` … `shots/05-…`.
The script exits 0.

> Simulator artifact: the page header still reads `c21-invalid@1.0.0` in
> `shots/03-…png` because the harness captures `CONFIG` when the **page** loads
> (`dev-harness.mjs` `runtimeInfo()` / `#game-meta`). The served package and
> `/health` are 1.0.1, and the running game shows the `v1.0.1` badge. This is a
> simulator metadata limitation, not a package problem.

### Run B — fresh 1.0.1 page + exact 1.0.0 payload (`logs/09-save-compat-replay.log`)

To remove the stale-header caveat, the same simulator was loaded fresh (header
`c21-invalid@1.0.1`), the **exact** `save-1.0.0.json` payload was written into
the fake Runtime's store (the simulator has no disk persistence, so the captured
payload had to be re-injected), then `Reload game`:

- hint `检测到未完成的存档，按空格继续` (Continue offered), badge `v1.0.1`, payload byte-identical;
- Space → `← → / A D 移动…` (playing); after ~1.2 s + pause:
  `score 20 → 32`, `elapsed 6.5477 → 7.7476`, `lives 2 → 1`, `saveVersion 1 → 1`, same keys.

All 14 checks `true` (`save-compat-replay-evidence.json`, `failedChecks: []`,
script exit 0); screenshots `shots/06-…png`, `shots/07-…png`.

### The demo really ran the packed 1.0.1 artifact

After Run A, `npm run build` on the updated demo project produced
`4d6e30b691feeeb90f1a79d39e7fc637a86e7f70ea7c9ddb20d206ba21c29d49` (108,589
bytes) — **byte-identical** to the canonical packed `c21-invalid-1.0.1.html`
(`diff -q` clean, `logs/10-demo-update-build.log`). Source trees of `c22-demo`
and `c22-update` are identical except `dist/` and `CHANGELOG.md`.

## 4. Classification

- **Independently verified.** 1.0.1 manifest/version bump, build, shared
  validator, pack, SHA-256 and the 1.0.0/1.0.1 artifact difference.
- **Locally simulated.** Save/Continue restoration on 1.0.1: real package code,
  real gameplay-generated save, but a *fake* Runtime with an in-memory store.
- **Not verified.** Real DSH Host install/launch, real Runtime storage
  persistence across app updates, real update delivery, any publish/release/PR,
  cross-device save migration, maintainer review.

## 5. Evidence index (`<tmp>/dsh-c21-c22/evidence-c22/`)

- `save-compat-demo.mjs`, `save-compat-replay.mjs`, `tools/cdp.mjs` — exact test code.
- `save-compat-evidence.json`, `save-compat-replay-evidence.json` — step-by-step JSON with all checks.
- `save-1.0.0.json`, `save-1.0.1-after-continue.json` — the compared save payloads.
- `shots/*.png` — Continue-offered and post-continue screenshots (both runs).
- `logs/commands.tsv` + `logs/00-…` … `logs/13-…` — raw build/validate/pack/dev-run logs.
- `artifacts/c21-invalid-1.0.1.html` (+ `.sha256`) — final 1.0.1 package.

## 6. Skill / toolchain gaps hit

1. `references/verification.md` item 6 says "For updates: increment version, test
   old save restoration and changelog", but neither the Skill nor
   `presentation.md`/`package-and-sdk.md` explains how to keep an old save in
   the Local Runtime Simulator. The simulator's save store is in-memory only, so
   a clean old-save test needs either one page kept open across the update
   (Run A) or manual re-injection of a captured payload (Run B). This should be
   documented, or the simulator should support seeding/exporting a save.
2. The simulator page's game metadata (`CONFIG.game.version`, shown in the
   header) is captured at page load and does not refresh after an in-place
   source update, while `/game` and `/health` do. Evidence screenshots therefore
   show a stale version label next to an updated game.
3. Continuing a save with `lives: 1` can reach game-over within ~2 s of play,
   which makes naive "reload and play" save tests flaky; the test had to require
   ≥2 lives for a stable continuation. Not a product bug, but worth a Skill tip.
