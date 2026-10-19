# Full-bleed Runtime stage (V1.1)

UX review found the black frame around games ugly and underspecified for third
parties. Root cause: the Runtime stage reserved `8px + top clearance` / `16px`
padding around a dark `#0B0C0E` stage, and the developer guide/template never
defined whether games should fill the viewport or leave platform safe areas.

Included in `v1.1.0` (PR #2):

- Runtime stage is edge-to-edge: no dark stage background, no padding, no
  rounded letterbox frame; the iframe fills the main panel.
- `manifest.viewport` is now documented as a recommended design size only;
  `fit` is a compatibility field and no longer drives platform scaling.
- Developer guide §4.4 defines the game presentation contract:
  fill the viewport, paint background in both themes, respond to resize,
  and keep the top 112px across the viewport / bottom-right 96×96 platform safe areas clear.
- `templates/vanilla` is now a full-bleed reference (no fake outer stage frame).

`2048-fullbleed.png` is the isolated-host check for the same game/window that
showed the black frame in the report; console errors were 0 and computed
`.dgm-runtime-stage-wrap` padding was `0px` (stage radius `0px`).

## PR #2 review fixes

The original 112×48 top-left reservation did not contain the actual controls.
The corrected contract reserves the **top 112px across the viewport** for critical
UI, covering controls, save status and macOS clearance. Platform clearance is
clamped to 0–48px. The bottom-right 96×96 covers the permanent Agent button;
expanded messages can temporarily extend to 254×184. Games use iframe CSS pixels
and do not need access to parent CSS variables.

Both templates now use an edge-to-edge canvas with HUD below that band and footer
copy away from the Agent corner. The manifest design size is distinguished from
the measured init/ready SDK viewport. CLI publish checklists include these manual
presentation checks; static package validation does not claim to prove layout.

React template generation also exposed an existing build-chain issue: Vite's
module-preload polyfill inserted `fetch`, so the generated package failed the
self-contained validator. The unnecessary polyfill is disabled; the build now
runs `tsc --noEmit` before Vite. Nullable captured references and ref mutation
narrowing in the template were corrected, with Node config typings included in
the template development dependencies. No production dependency was added.

Verification on 2026-10-19:

- `npm run verify`: **787/787**, 0 failed/cancelled, **CHECK OK (23)**.
- Regression tests were first observed failing for the HUD and forced minimum
  logical size, then passing. A Runtime test pins measured init/ready viewport
  independently of manifest design size.
- Fresh CLI projects: Vanilla and React **build → validate → pack → publish**
  completed. Publish only generated local metadata with placeholder URLs; no
  external artifact upload or release occurred. React build includes typecheck.
- Both projects rebuilt byte-identically:
  - Vanilla: `cc5503014b0e7b894d8f6e705fd1743238464e010daca46f9d580c0827ba8501`
  - React: `238b83723281d1ec1dd457b296653ddfb4cd9d0f94291c01029affa8ed1dddf4`
- Real installed DSH runtime, isolated `DSH_HOME`, Chromium: both generated packages
  installed and rendered; canvas bounds match stage bounds. Vanilla was checked
  at 920×675 and 640×620; React at 375×620 without horizontal overflow. The final
  React installed entry SHA was verified against the packed artifact.
- Browser probes of actual control CSS: clearance 0 → y12–54; 48 → y60–102;
  96 → y60–102 (clamped). **48px was simulated via the host CSS variable**, not
  a new native macOS window-chrome acceptance run. Both HUD renderers draw their
  labels/values at y128/y148. React gameplay canvas changed during a live run.
- First-run missing-save 404s were expected. Reinstalling changed bytes with the
  same version was correctly rejected with GM-4094; the isolated test package
  was uninstalled preserving data, then the final artifact installed successfully.

Screenshots: [Vanilla runtime](review-fix/vanilla-runtime.png),
[React 375px runtime](review-fix/react-375.png). These supplement the original
2048 check; they do not replace the v1 release acceptance evidence.
