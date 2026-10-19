# Ember Drift — author-side verification report

- **Date:** 2026-10-19 (Asia/Shanghai)
- **Skill under evaluation:** `dsh-game-developer` v1.0.0
  (`skills/dsh-game-developer/SKILL.md` + all four `references/`)
- **Platform checkout:** `/Users/orange/Orange Field/Matterhorn/dsh-game-market-worktrees/community-publishing`.
  The toolchain used for all builds was `c1c16a06dc45391c525d6b4681d892027371e7cc`
  (clean at the start). During the final check the worktree HEAD had moved to
  `f00a28cbd10b517f3b0928499bd4d3d559356988` (external commit, author `heswy`,
  2026-10-19 16:13:12 +08:00), adding an `artifacts/skill-eval/` mirror of this
  evaluation's QA files and editing `skill-evaluation.md`; no CLI/template files
  changed. This session issued no git write command against the platform
  checkout. The worktree was clean at both observed states, and a final
  `npm run validate` at `f00a28c` still returns the same package hash.
- **Environment:** macOS, Node `v24.14.0`, npm `11.9.0`, Google Chrome
  `155.0.8059.85` (headless, CDP-driven). The game project has no npm
  dependencies and no `npm install` step.
- **Isolation:** every game/QA/submission file is under
  `/tmp/dsh-skill-eval-ember-drift-20261019/` (realpath
  `/private/tmp/dsh-skill-eval-ember-drift-20261019/`). Nothing inside the
  platform checkout was modified; nothing was published.

## 1. Result at a glance

| Area | Result |
| --- | --- |
| Deterministic single-file build | **PASS** — two builds byte-identical, 156,912 bytes |
| `npm run validate` | **PASS** — exit 0, shared package/manifest/security validator |
| `npm run pack` + `.sha256` check | **PASS** — exit 0, `shasum -c` OK |
| CLI validation of the packed `<id>-<version>.html` | **PASS** — exit 0 |
| Runtime gameplay / HUD / score / lives / end / restart | **PASS** in the Local Runtime Simulator |
| Platform pause/resume freezes the game clock | **PASS** |
| `before-save` + reload + Continue | **PASS** |
| Keyboard `←`/`→`/`A`/`D` and local `P` pause | **PASS** |
| Light/dark theme, 1280×720, 640×360, 375×667 | **PASS** (visual + measured) |
| No console errors / no external network from the game | **PASS** with injected error hooks and Network capture |
| Real game-over (lost) + restart | **PASS** |
| Two-minute **time-up completion** | **PASS via accelerated Continue save** (0.6 s remaining injected through the simulator's storage); not a full real-time 120 s wait |
| `submission.json` schema | **NOT YET VALID** by design: all non-pending fields pass; the 10 errors are exclusively the deliberately pending GitHub identity, public source URL, and public media/package URLs |
| Publish / release / catalog PR / approval | **NOT DONE** (out of scope and prohibited by the task) |

The game is playable and looks like the requested game. The package is a real
game, not a demo screen. This report is not maintainer approval.

## 2. Scaffolding and toolchain

### 2.1 The Skill's exact `--id` scaffold command fails

`SKILL.md` §1 shows (line 37):

```bash
node <platform>/scripts/cli/create-dsh-game.mjs --dir /tmp/dsh-game-projects --id <game-id> --template vanilla
```

The actual CLI is `create <id>` and has no `--id` option:

```text
$ node <platform>/scripts/cli/create-dsh-game.mjs --dir /tmp/dsh-skill-eval-... --id scaffold-check --template vanilla
error: create: Unknown option '--id'.
  hint: Run `dsh-game create --help`.
EXIT=2
```

Evidence: `submission/evidence/logs/scaffold-documented-command.log`.

### 2.2 Working scaffold command

The positional form was used and succeeded:

```bash
node "$PLATFORM/scripts/cli/create-dsh-game.mjs" ember-drift \
  --dir /tmp/dsh-skill-eval-ember-drift-20261019 \
  --template vanilla \
  --name "Ember Drift" \
  --description "A two-minute hand-painted space dodge: weave through falling asteroids, gather ember stars, chase a high score." \
  --author "DSH Skill Evaluation"
# Created ember-drift (vanilla) at /private/tmp/.../ember-drift
# CREATE_EXIT=0
```

A dry run of the positional form was also attempted. The advertised `--dry-run`
option itself crashes after listing files:

```text
internal error: result.nextSteps is not iterable
TypeError: result.nextSteps is not iterable
  at commandCreate (.../scripts/cli/lib/cli.mjs:182:31)
EXIT=3
```

No directory was created (verified). This is a platform CLI defect independent of
the Skill. Evidence: `submission/evidence/logs/scaffold-dry-run.log`.

### 2.3 Template baseline before implementation

```text
npm run build     -> exit 0, dist/index.html 108,285 bytes
                     sha256 8881cf4d6305dee675a02a73dfacccfd14d1a4b75322b4aba279e8c326d9698a
npm run validate  -> exit 0, OK (108,285 bytes)
```

This establishes that the template flow worked before the game code was added.

## 3. Package and determinism

- **Package:** `dist/ember-drift-1.0.0.html`
- **Absolute path:** `/tmp/dsh-skill-eval-ember-drift-20261019/ember-drift/dist/ember-drift-1.0.0.html`
- **Size:** `156,912` bytes
- **SHA-256:** `f882e1159f7f2b3f73373793d4a6297b0c7a148d8472299b1f1193b72b38dfd9`
- **Sidecar:** `dist/ember-drift-1.0.0.html.sha256`
  (`f882e115…  ember-drift-1.0.0.html`)
- **Manifest:** `ember-drift@1.0.0` / “Ember Drift”
- **One file:** yes; no external runtime resources.
- **Static scan** (`submission/evidence/logs/static-scan.txt`): exactly one
  inline manifest, no external `<link>`, no `<iframe>`, no CSS `@import`, no
  `fetch`/XHR/WebSocket/EventSource/beacon/serviceWorker text, first bytes
  `3c2164` (no BOM). The only `https://` string in the package is the inlined
  SDK's unused default registry constant
  (`https://raw.githubusercontent.com/heswy/dsh-game-registry/main/registry/games.json`);
  the game never requests it, and the Network capture in §4.8 contains no such
  request.

### 3.1 Determinism (build twice)

```text
npm run build #1 -> EXIT=0, 156,912 bytes,
                   sha256 f882e1159f7f2b3f73373793d4a6297b0c7a148d8472299b1f1193b72b38dfd9
npm run build #2 -> EXIT=0, 156,912 bytes,
                   sha256 f882e1159f7f2b3f73373793d4a6297b0c7a148d8472299b1f1193b72b38dfd9
cmp -s build1 build2 -> BYTE_IDENTICAL=yes
```

### 3.2 Validate and pack

```text
npm run validate -> EXIT=0
  OK  .../dist/index.html (156912 bytes)
  manifest: ember-drift@1.0.0 (Ember Drift)

npm run pack -> EXIT=0
  packed .../dist/ember-drift-1.0.0.html (156912 bytes)
  sha256: f882e115…
  digest: .../dist/ember-drift-1.0.0.html.sha256

(cd dist && shasum -a 256 -c ember-drift-1.0.0.html.sha256) -> OK, EXIT=0

node <platform>/scripts/cli/dsh-game.mjs validate <packed file> -> EXIT=0
  OK  .../ember-drift-1.0.0.html (156912 bytes)
  manifest: ember-drift@1.0.0 (Ember Drift)

# after the external platform HEAD moved to f00a28c:
npm run validate -> EXIT=0, same 156,912 bytes and
                   sha256 f882e1159f7f2b3f73373793d4a6297b0c7a148d8472299b1f1193b72b38dfd9
```

Exact logs: `submission/evidence/logs/{build-1,build-2,validate,pack,sha-check,
cli-validate-packed,determinism,validate-after-platform-head-change}.log`.

## 4. Runtime evidence

The Local Runtime Simulator (`npm run dev`) served
`http://127.0.0.1:4321/` and loaded the game in
`<iframe sandbox="allow-scripts">`. The game is an OOPIF, so QA attached to the
iframe target and drove real key/pointer events with Chrome DevTools Protocol.

### 4.1 Gameplay

- Start screen, live HUD (`SCORE`, `BEST`, hull hearts, `TIME`, `STREAK`),
  stars, asteroids, shield after a hit, particle bursts, score, difficulty
  ramp, two-minute countdown.
- Stars add `10 × streak`; asteroid hits cost a hull and reset the streak.
- Real runs produced score 10 (1 star), 90 (5 stars, streak ×4), 150 and 200
  (streak ×5), with visible HUD updates and a real best score.
- The `GM-4006` score-range path is implemented and visibly toasted, but was not
  triggered at runtime because all test scores were inside the declared range
  (`0…1,000,000`). Code-inspected only.

### 4.2 Pause / resume

Using the Runtime “Pause” and “Resume” controls:

```text
saved timeLeft at pause:        114.90459999999925
after a 2.2 s wait (paused):    114.90459999999925   -> frozen
after Resume + 2.7 s play:      112.20480599999921   -> advanced
```

Local keyboard `P` also paused and resumed:

```text
P -> hint "P or Resume to continue"
P -> hint "← → or A D drift · P pause · gather stars, dodge the emberfall"
```

### 4.3 `before-save`, reload and Continue

```text
before-save -> saved timeLeft 111.90480599999921
Reload       -> hint "Space continue · N new drift · P pause"  (Continue offered)
Space        -> hint "← → or A D drift · P pause · gather stars, dodge the emberfall"
after 2.6 s  -> saved timeLeft 109.38829599999917  (progress resumed)
```

A finished run removes `current`; reloading after game over does **not** offer
Continue. A save with `gameOver: true`, zero hull, or an expired clock is
rejected by `deserializeState`.

### 4.4 Keyboard

- `ArrowLeft` held 0.8 s: saved `shipX` `0.5 → 0` (clamped at the left edge).
- `A` held 0.7 s: saved `shipX` `0.23502002491706406 → 0`.
- `D` held 0.7 s: saved `shipX` `0 → 0.7068441680000002`.
- `Space` starts/continues/restarts; `P` pauses; `N` starts fresh when a save
  exists. `Escape`/`Tab` are not intercepted.

### 4.5 Game over and restart (real run)

A real run ended by hull loss at 86 s:

```text
hint: "Space — drift again"
best: { score: 10, meta: { stars: 1, bestStreak: 2, outcome: "lost", seconds: 86 } }
scoreHistory: [{ score: 10, achievedAt: ... }]
session: { outcome: "lost", score: 10, endedAt: ... }
save: null
Space -> hint "← → or A D drift · P pause · …" (new run, best 10 retained)
```

Screenshot: `submission/evidence/screens/08-game-over-dark-960x540.png`.

### 4.6 Two-minute completion (accelerated final seconds)

The timer was observed counting down in real runs (e.g. `2:00 → 1:56 → 1:44 →
1:26`). To exercise the exact `timeLeft <= 0 → finish('complete')` branch without
a two-minute real-time wait, the simulator-held save was rewritten to
`timeLeft: 0.6`, `elapsed: 119.4`, score 240, 12 stars, two lives, no entities;
the game was then reloaded and continued with Space.

```text
continue screen: hint "Space continue · N new drift · P pause", saved timeLeft 0.6
after continue:   hint "Space — drift again"
best:            { score: 240, meta: { stars: 12, bestStreak: 4,
                   outcome: "complete", seconds: 120 } }
scoreHistory:    … { score: 240 }  (submitted with outcome complete)
session:         { outcome: "completed", score: 240 }
save:            null
```

Screenshot: `submission/evidence/screens/12-drift-complete-dark-960x540.png`.
This is **not** a full 120 s real-time run; it is an accelerated exercise of the
real finish path through the simulator's storage. That distinction is repeated
in the pending items.

### 4.7 Light/dark and viewports

- Theme toggled via the Runtime control; the game followed from `data-theme`
  and repainted the CSS-variable palette.
- Captured at **1280×720**, **640×360**, **375×667**, plus the initial
  **960×540** simulator stage.
- The canvas backing size equals the iframe viewport at DPR 1 in every measured
  case (1280×720, 640×360, 375×667; the initial simulator stage content area was
  958×538 because of the harness's 1 px frame border). There is no letterbox,
  outer frame, or fixed stage.
- HUD begins at `y = 127` (below the top 112 px Runtime zone). The bottom-right
  96×96 area has no HUD or controls. At 1280×720 the hint pill’s right edge was
  far from the bottom-right zone (`hintRightGap = 892.25`), and its
  `max-width: calc(100% - 128px)` keeps at least 112 px clear on the right. At
  375×667 the pill wraps to two lines; the ≤520 px rule (`right: 104px`,
  `max-width: calc(100% - 116px)`) keeps its right edge at or left of
  `width - 104px`, and the 375×667 capture shows the full pill left of the
  Agent zone.
- Screenshots:
  `submission/media/screenshot-1-ready.png`,
  `screenshot-2-action-light.png`,
  `screenshot-3-paused.png`,
  `screenshot-4-continue.png`,
  and evidence `qa-640x360-playing-light.png`, `qa-375x667-playing-light.png`.

### 4.8 Errors and network

An error hook was injected into the game iframe on a fresh document load,
covering `error`, `unhandledrejection`, and `console.error`; the simulator page
collected them. After boot, Continue and keyboard play:

```text
hook installed: true
hook errors: []
Runtime exceptions/console.error: []
game iframe network requests: only
  http://127.0.0.1:4321/game?instance=…&nonce=…
external requests: []
```

This is strong evidence of no runtime console error and no external network
request from the game. The local simulator's own favicon request is outside the
game iframe. The inlined SDK's unused registry URL string (see §3) produced no
request.

### 4.9 Not verified

- Real DSH desktop Host install/launch (only the Local Runtime Simulator was
  used).
- Reduced-motion mode: the code reads `game.runtime.reducedMotion` and disables
  shake/particle density/flicker/twinkle, but the simulator exposes no
  reduced-motion toggle, so this was not visually verified.
- `GM-4006`: implemented and visibly handled, but not triggered (scores in
  range).
- A full real-time 120 s completion (see §4.6).
- Physical keyboard/hardware; events were synthesized through CDP.

## 5. Submission media

All files are real gameplay captures at 1280×720 (PNG), captured with the
simulator chrome hidden. They are well below the 2 MiB preview limit.

| File | SHA-256 | Bytes |
| --- | --- | --- |
| `submission/media/cover.png` | `0e7530362d9e2d6e3a0ca7f390f852d8d874b1e7af646b2d9e64ec5cb89bfbbe` | 817,894 |
| `submission/media/screenshot-1-ready.png` | `357452d390e03102123323c4b15bcaa76f37a96e42f998a75b96771de3cc9591` | 719,827 |
| `submission/media/screenshot-2-action-light.png` | `6efab26d299b18ea0bc674c1b43b5bc5b7342180ddd6a274fecceb169d6f468f` | 787,954 |
| `submission/media/screenshot-3-paused.png` | `5ab63564d2d39d3dbc67374f1a02abc38511e5b48ccfbabcf58ed9d17fcf226e` | 735,584 |
| `submission/media/screenshot-4-continue.png` | `4ccd0aa1a092d4b463fdfa9add797d5cd199be5b7281febe971fc2c767c916b4` | 733,639 |

The cover shows a real run at score 200, three hull hearts, streak ×5, with
stars and asteroids. The game-over and drift-complete screens are kept in
`submission/evidence/screens/` and are not presented as marketing media; the
complete screen comes from the accelerated final-seconds test.

## 6. `submission.json` and pending fields

File: `submission/submission.json` (schema version 1, `submissionType: "new"`).

All non-pending fields are filled with real local values:

- game identity, description, categories, tags, capabilities, SDK/runtime
  ranges, MIT license;
- real package SHA-256 and byte size;
- real cover/screenshot SHA-256, size and PNG type;
- real local source commit `f51033ce7f3a2fcb5aa60738f493c7509a48d853`;
- licensing + `archivePermission: true`;
- all ten `selfTest` flags `true`;
- an explicit `pending` array and a `notes` explanation.

The following fields are deliberately `null` (pending), not fabricated:

```text
author.login
author.githubUserId
author.sourceRepo
package.url
package.sha256Url
media.cover.url
media.screenshots[0..3].url
```

Running the platform's `validateSubmission` on this file returns exactly those
10 field errors and nothing else:

```text
E_SUBMISSION_AUTHOR  author.login
E_SUBMISSION_AUTHOR  author.githubUserId
E_SUBMISSION_URL     author.sourceRepo
E_SUBMISSION_PACKAGE package.url
E_SUBMISSION_PACKAGE package.sha256Url
E_SUBMISSION_MEDIA   media.cover.url
E_SUBMISSION_MEDIA   media.screenshots[0].url
E_SUBMISSION_MEDIA   media.screenshots[1].url
E_SUBMISSION_MEDIA   media.screenshots[2].url
E_SUBMISSION_MEDIA   media.screenshots[3].url
```

Output saved at `submission/evidence/submission-validation.json`. This is
intentionally **not** a schema-valid submission because the Skill forbids
inventing the missing identity/hosting URLs. It must be completed by the real
author before a maintainer can review it.

## 7. Pending items

1. Real GitHub `login` + numeric `githubUserId`, and ownership evidence for the
   source commit.
2. Public HTTPS `sourceRepo`; push the local source commit
   `f51033ce7f3a2fcb5aa60738f493c7509a48d853` to it.
3. Public HTTPS package URL ending `ember-drift-1.0.0.html` and `.sha256`
   sidecar URL (e.g. a GitHub Release; none was created).
4. Public HTTPS cover and screenshot URLs.
5. Public release/hosting evidence.
6. A portable CLI configuration for a public source repository; the generated
   `dsh-game.config.json` records the evaluator's platform checkout path. A
   public author should regenerate or document a `DSH_GAME_CLI` override.
7. Rightsholder/author license confirmation (MIT is recorded locally, but the
   public identity is pending).
8. Maintainer review and catalog approval; **not** performed or implied.
9. Optional deeper verification: a full real-time 120 s completion, reduced
   motion, `GM-4006`, and installation in the real DSH desktop Host.

## 8. Where the Skill and toolchain were unclear or insufficient

1. **Scaffold command mismatch (blocking documentation bug).** The exact
   `SKILL.md` command uses `--id`; the actual CLI rejects it with exit 2. The
   working form is positional (`create <id>`). The Skill should be corrected or
   show both.
2. **Broken `--dry-run`.** The CLI advertises `--dry-run`, but `create --dry-run`
   exits 3 with `result.nextSteps is not iterable` after listing the files. This
   is a platform toolchain bug (no files written). The Skill does not mention it.
3. **Pending vs schema-valid submission.** The Skill says missing author
   identity/source commit/URLs/license/media “must be listed as pending, never
   fabricated”, but `validateSubmission` has no pending representation. A real
   `submission.json` cannot be simultaneously schema-valid and honest when the
   public identity/hosting is unknown. I used `null` + a top-level `pending`
   array and recorded the resulting field errors. A documented draft/pending
   contract would resolve this.
4. **Machine-specific CLI path in generated projects.** `create-dsh-game`
   writes an evaluator-local relative CLI path into `dsh-game.config.json`. The
   Skill says the template records the local CLI and can be overridden, but does
   not say what a public source repository should commit for reproducible
   builds. This matters for the `sourceRepo`/`sourceCommit` evidence.
5. **Packed-file validation ambiguity.** `npm run validate` rebuilds and
   validates `dist/index.html`, not the packed `<id>-<version>.html`; the
   filename rule is only exercised if the packed file is validated separately.
   The Skill’s “verify sha matches” step does not spell this out. I ran the CLI
   validator on the packed file explicitly.
6. **Simulator lacks the checklist viewports/controls.** The Skill asks for a
   375 px narrow-window check and reduced-motion/light/dark checks, but the
   Simulator only offers 960/640/1280 stage presets and has no reduced-motion
   toggle. I resized the iframe through the page DOM for 375×667 and could not
   visually test reduced motion.
7. **Full two-minute evidence.** The Skill says the session length is part of
   the request but does not define how to verify a long time-up path. I used a
   real countdown plus an accelerated final-0.6-s Continue save, and label it as
   such rather than claiming a full real-time run.
8. **Media URLs vs author-side files.** `references/submission.md` requires each
   media entry to have an HTTPS URL, but an author who has only local cover/
   screenshots cannot produce a valid entry without hosting. The pending
   mechanism is again unspecified.

## 9. Compliance and absolute paths

**Compliance**

- Only read the platform checkout from this session; no git write command was
  issued against it. At the start and throughout the toolchain runs the worktree
  was at `c1c16a06` (clean). The final observation was `f00a28c` (clean), an
  external commit created at 16:13:12 that mirrors this evaluation's QA files
  under `artifacts/skill-eval/` and edits `skill-evaluation.md`; it did not
  change the CLI/template code used for the build. Evidence:
  `logs/platform-checkout.txt` (start) and `logs/platform-checkout-final.txt`
  (final); package validation was rerun at the final HEAD (exit 0).
- Did not publish, create releases/issues/PRs, or run
  `scripts/registry/prepare.mjs --execute`.
- Did not create a catalog entry, Registry merge, reviewer approval, or fake
  URLs/identity.
- Used the platform's local `scripts/cli/create-dsh-game.mjs` / `dsh-game`
  CLI and generated vanilla template; no public npm package assumptions.
- All game files are under `/tmp/dsh-skill-eval-ember-drift-20261019/`, outside
  the platform repository.

**Absolute paths**

- Source project: `/tmp/dsh-skill-eval-ember-drift-20261019/ember-drift`
- Package: `/tmp/dsh-skill-eval-ember-drift-20261019/ember-drift/dist/ember-drift-1.0.0.html`
- Package SHA sidecar: `/tmp/dsh-skill-eval-ember-drift-20261019/ember-drift/dist/ember-drift-1.0.0.html.sha256`
- Build output: `/tmp/dsh-skill-eval-ember-drift-20261019/ember-drift/dist/index.html`
- Submission: `/tmp/dsh-skill-eval-ember-drift-20261019/ember-drift/submission/submission.json`
- Media: `/tmp/dsh-skill-eval-ember-drift-20261019/ember-drift/submission/media/`
- Evidence: `/tmp/dsh-skill-eval-ember-drift-20261019/ember-drift/submission/evidence/`
- QA scripts: `/tmp/dsh-skill-eval-ember-drift-20261019/qa/`
- Local source commit: `f51033ce7f3a2fcb5aa60738f493c7509a48d853`
- Platform checkout HEAD used for the toolchain: `c1c16a06dc45391c525d6b4681d892027371e7cc`
- Platform checkout final observed HEAD (external commit; clean):
  `f00a28cbd10b517f3b0928499bd4d3d559356988`

**Honest label:** this is an author-side evaluation artifact. It is not hosted,
not submitted to the Game Market, and not reviewed or approved.
