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
6. For updates: increment version, test old save restoration and changelog.

Never fabricate screenshots/URLs/reviews. Record what was simulated vs real and
what remains pending (public hosting, reviewer approval, catalog merge).
