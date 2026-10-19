# Verification before submitting

Run and record exact commands + exit codes + package SHA/size:

1. `npm run build` → deterministic single-file build.
2. `npm run validate` → shared package/manifest/security validation.
3. `npm run pack` → `<id>-<version>.html` + `.sha256`; verify sha matches file.
4. Rebuild twice and compare bytes (determinism).
5. `npm run dev` in an isolated environment:
   - game actually progresses (score/state changes, not only Runtime `playing`);
   - pause/resume, before-save, reload Continue, restart;
   - keyboard, 375px narrow window, light/dark theme;
   - full-bleed background, top 112px / bottom-right 96×96 overlays clear;
   - no console errors and no external network requests.
6. For updates: increment version, keep `SAVE_VERSION`/`save.schemaVersion` and the
   serialized keys compatible, then test old-save restoration in the simulator:
   - run `npm run dev <project> --port <free>`, start a run, press pause (creates
     a save) or use the Runtime `before-save` control; record the exact save
     payload (score/lives/elapsed/saveVersion);
   - apply the update in place or serve the new build, reload `/` (the harness
     refreshes its header from `/health`), then confirm Continue is offered and
     the payload is restored byte-identically before continuing;
   - avoid naive tests on a 1-life save: a continued run can game-over within
     ~2 s; pause immediately or test with more lives;
   - the simulator keeps saves in memory only; cross-page/cross-machine
     persistence and real Host installs remain unverified until tested there.
   Record changelog and what remains simulated vs real.

Never fabricate screenshots/URLs/reviews. Record what was simulated vs real and
what remains pending (public hosting, reviewer approval, catalog merge).
