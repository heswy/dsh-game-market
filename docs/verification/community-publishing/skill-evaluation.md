# Independent Skill evaluation · `dsh-game-developer`

Evaluator: an independent AI subagent that received only the Skill directory and
the platform checkout path (no prior project conversation, no implementation
hints beyond the user gameplay request).

## Input request

> Make a two-minute space dodge game. Keyboard controls, spaceship moves left/right,
> dodge falling asteroids, collect stars for score. Warm hand-painted feeling,
> light/dark theme support, pause/continue and Continue after reload.

## Produced by the evaluator

- Game: **Ember Drift** (`ember-drift@1.0.0`), Vanilla template.
- Project: `/tmp/dsh-skill-eval-ember-drift-20261019/ember-drift` (outside the
  platform checkout; platform repo unmodified).
- Package: `dist/ember-drift-1.0.0.html`, **156,912 bytes**, sha256
  `f882e1159f7f2b3f73373793d4a6297b0c7a148d8472299b1f1193b72b38dfd9`;
  matching `.sha256` file.
- Build/validate/pack commands and exit codes are in the evaluator QA artifacts;
  simulation and browser QA evidence are under
  `artifacts/skill-eval/{qa,screenshots}/`.

## Observed QA (browser, Local Runtime Simulator)

- real gameplay progression: ship movement, asteroids, stars, score/lives/time,
  game over and restart (playtest/longrun evidence);
- pause → continue with saved state, light/dark themes, 375px narrow window and
  960×540 viewport (playtest/media evidence);
- injected near-time-up Continue → completed session/score (timeup-injected);
- no console errors recorded in the QA evidence steps (`"errors"` empty);
- errorcheck hook recorded **no external network requests** from the game (only its
  own Runtime iframe URL) and no console errors;
- final QA: restore existing save → pause/continue, light/dark, and a near-time-up
  injected save completes correctly (finalqa/errorcheck evidence);
- HUD/canvas sizes followed the actual iframe viewport, not a fixed stage.

## Evaluator submission materials (archived)

The evaluator also produced `submission/submission.json` + `verification-report.md`
and media under `artifacts/skill-eval/submission/`. All package/media hashes are
real; only public hosting and GitHub identity are null. The original JSON used a
free-form `pending[]` list. This PR now supports an explicit **draft** mode:

- `validateSubmission(submission, {mode:'draft'})` → `ok:true`, with the ten remote
  fields normalized to `pending[]` and non-field notes kept separately;
- default/final validation still rejects the same fields and the non-empty pending
  list (`draft-validation.json` records both results).

## Gaps found by the evaluator and disposition

| # | Finding | Disposition |
|---|---|---|
| 1 | Skill scaffold used `--id`, CLI requires positional id | **Fixed** in SKILL.md/docs; positional examples now match the CLI |
| 2 | `create --dry-run` crashed (`nextSteps` not iterable) | **Fixed**; non-JSON dry-run prints files and writes nothing; regression test added |
| 3 | No honest representation for missing identity/URLs | **Fixed contract**: draft mode + normalized `pending[]`; final/publish still requires all fields; test added |
| 4 | Generated `dsh-game.config.json` embedded checkout path | **Fixed**: config is portable/no `cli` path; generated scripts require `DSH_GAME_CLI`; template README/docs updated; Vanilla+React portable projects rebuilt and validated |
| 5 | `npm run validate` did not validate packed filename | **Fixed**: generated validate script checks packed `<id>-<version>.html` when present |
| 6 | Simulator lacked 375px preset/reduced-motion toggle | **Added** 375×667 preset + reduced-motion toggle; test added. GM-4006 not triggered (scores in range), full real DSH Host install still pending |

## Independently verified vs pending

- Verified: Skill guidance produced a real playable single-file Vanilla package,
  build/validate/pack succeeded, browser behavior/theme/narrow/Continue tested,
  evaluator-authored submission materials archived.
- Pending before this can be called a submitted game:
  - real public HTTPS package/media URLs and GitHub identity/ownership evidence;
  - maintainer review/approval and catalog publish;
  - independent AI update evaluation (1.0.0 → 1.0.1) is not covered here;
  - independent AI invalid-package repair loop is not covered here;
  - independent AI React generation remains pending (React template itself verified);
  - full real-time 120 s completion was not waited (accelerated save used).

## Why this is evidence, not approval

The evaluator never received publish credentials and did not run
`prepare.mjs --execute`, create a Release/Issue/PR, or modify the platform. A green
local QA is author-side evidence only; maintainer review is still required.
