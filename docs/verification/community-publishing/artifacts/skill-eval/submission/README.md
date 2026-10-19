# Ember Drift — author-side bundle

Status: **author-side verified, not submittable yet.** The package passes the
shared validator; `submission.json` intentionally has `null` for the real
GitHub identity and public HTTPS URLs and therefore fails `validateSubmission`
with exactly those pending fields (see `evidence/submission-validation.json`).
No URL, identity or review approval has been invented.

## Contents

- `submission.json` — schemaVersion 1 author record; non-pending fields real,
  pending fields listed in its `pending` array.
- `verification-report.md` — commands, exit codes, package hash/size,
  determinism, runtime evidence, pending items, Skill gaps.
- `media/cover.png` — 1280×720 real gameplay at score 200, three hearts,
  streak ×5.
- `media/screenshot-1-ready.png` — 1280×720 start screen, dark.
- `media/screenshot-2-action-light.png` — 1280×720 gameplay, light theme.
- `media/screenshot-3-paused.png` — 1280×720 pause panel, light theme.
- `media/screenshot-4-continue.png` — 1280×720 Continue panel, light theme.
- `evidence/` — raw QA JSON (pause/Continue values, keyboard, A/D, game-over,
  time-up, viewports, network/error hook), key proof screenshots, and exact logs
  for build/validate/pack, determinism, static scan, source commit and platform
  checkout state.

## Package

`dist/ember-drift-1.0.0.html` · `156,912` bytes ·
`sha256 f882e1159f7f2b3f73373793d4a6297b0c7a148d8472299b1f1193b72b38dfd9`

## Pending before a real submission

Real GitHub login + numeric user id, public source repo containing commit
`f51033ce7f3a2fcb5aa60738f493c7509a48d853`, public package + `.sha256` URLs,
public cover/screenshot URLs, a portable `dsh-game.config.json` CLI path, and
maintainer review. Nothing was published.
