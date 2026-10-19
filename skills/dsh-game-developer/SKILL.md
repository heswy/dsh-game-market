---
name: dsh-game-developer
description: Build, adapt, validate, pack and prepare a DSH Game Market game submission from a gameplay idea. Use when creating a new game, porting an existing small game, fixing validator/runtime failures, or preparing a 1.0.0/update submission for the community catalog. Do not use for maintaining the Game Market platform itself or performing maintainer catalog publishing.
---

# DSH Game Developer

Turn a gameplay request into a real, playable, single-file DSH Game Market game
plus a verified submission package. This Skill covers **authoring and author-side
validation**, not maintainer review or publishing.

## Before you start

1. Locate a **platform checkout** (the `dsh-game-market` repository at the version
   the user targets). All commands below are paths inside that checkout.
2. Read only the references you need:
   - `references/package-and-sdk.md` — package/manifest/SDK/lifecycle rules.
   - `references/presentation.md` — full-bleed Runtime, themes, viewport, safe areas.
   - `references/submission.md` — exact `submission.json` / review fields and author limits.
   - `references/verification.md` — required tests, evidence and failure handling.
3. Create an **isolated game project**; never edit the platform checkout, the
   user's DSH profile, or an installed plugin to make a game pass.

## Workflow

### 1. Understand the request and choose a template

Extract: gameplay loop, controls, session length, visual style, language, and
whether progress must survive Continue. Use sensible defaults for non-blocking
gaps; ask only when a missing decision changes the game.

Default to the Vanilla template. Use React only when the user asks for it or the
existing project is already React.

```bash
mkdir -p /tmp/dsh-game-projects
node <platform>/scripts/cli/create-dsh-game.mjs --dir /tmp/dsh-game-projects --id <game-id> --template vanilla
```

The generated project contains `manifest.json`, `src/`, the local `dsh-game`
CLI wrappers, and SDK typings. Do not invent npm package names: the V1 toolchain
is the platform checkout/template until a public npm package exists.

### 2. Implement real gameplay

- The game must have start, play, end/restart, input feedback, and visible HUD.
- It must be recognizable as the requested game, not a static cover or a single
  success dialog. Use real art direction; do not use placeholder letters as the
  final cover/screenshots.
- Include Continue only when the game declares `storage`; follow the template's
  `serialize`/`deserialize` and `before-save` pattern.
- Do not silently swallow SDK/validation errors.

### 3. Respect the package and SDK contract

Read `references/package-and-sdk.md`. Key points:

- exactly one self-contained HTML file, one inline manifest script, UTF-8 no BOM;
- no external scripts/styles/images/fonts/network requests at runtime;
- only `storage`/`score` capabilities, with their required `save`/`score` fields;
- `await game.ready()` before the main loop; handle `pause`/`resume`,
  `before-save`, `visibilitychange`, Continue and (if declared) score submission;
- use the actual SDK API; do not invent viewport subscriptions or replace the
  platform save with `localStorage`.

### 4. Fit the Runtime presentation

The Runtime is **full-bleed**. The game must paint the whole viewport, react to
window resize, and keep platform overlays clear:

- top 112px across the viewport (back/pause/save controls + macOS clearance);
- bottom-right 96×96 (Agent presence); expanded bubble may cover 254×184;
- no internal letterbox, outer frame, fixed 960×540 canvas chrome, or padding
  that assumes a platform stage.

See `references/presentation.md` for the detailed checklist and light/dark rules.

### 5. Validate before showing the user

Run from the generated project:

```bash
npm run build
npm run validate
npm run pack
```

Read the **exit code and full output**; never assume success. Then verify in the
local Runtime Simulator (`npm run dev`):

- actual gameplay progresses (not only the outer Runtime says `playing`);
- pause/resume, `before-save`, save/Continue and restart;
- keyboard, narrow window, light/dark theme, full-bleed + safe areas;
- no console error and no network request.

If a check fails, fix the cause and rerun the affected checks. Do not edit or
bypass validator rules.

### 6. Prepare author-side submission materials

Produce:

```text
dist/<id>-<version>.html
dist/<id>-<version>.html.sha256
submission.json
cover.png/webp/jpeg + screenshots
verification report (commands, exit codes, hashes, environment limits)
source project (or public repo + fixed commit)
```

The submission schema is in `references/submission.md` and is validated by
`<platform>/packages/shared/src/community.js`. Missing author identity, source
commit, public HTTPS URLs, license confirmation or real media must be listed as
**pending**, never fabricated. Publisher tooling is maintainer-only: do not run
`scripts/registry/prepare.mjs --execute`, create releases, or open catalog PRs.

### 7. Report honestly

Report separately:

- static package validation result;
- local Runtime behavior result;
- visual/material checks you actually performed;
- pending items (URLs, identity, license, public hosting, reviewer acceptance).

A green `validate` is not maintainer approval and not a published game.

## Hard stops

- Stop and ask if the requested game cannot be represented within the single-file
  package limits.
- Stop if the toolchain/template cannot be located; do not redesign the package
  format or scrape internal platform source to bypass validation.
- Never publish, create a public submission issue/PR, or modify the content
  repository without explicit user authorization.
