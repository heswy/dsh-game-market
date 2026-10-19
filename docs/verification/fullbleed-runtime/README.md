# Full-bleed Runtime stage (V1.1)

UX review found the black frame around games ugly and underspecified for third
parties. Root cause: the Runtime stage reserved `8px + top clearance` / `16px`
padding around a dark `#0B0C0E` stage, and the developer guide/template never
defined whether games should fill the viewport or leave platform safe areas.

Changes on this branch:

- Runtime stage is edge-to-edge: no dark stage background, no padding, no
  rounded letterbox frame; the iframe fills the main panel.
- `manifest.viewport` is now documented as a recommended design size only;
  `fit` is a compatibility field and no longer drives platform scaling.
- Developer guide §4.4 defines the game presentation contract:
  fill the viewport, paint background in both themes, respond to resize,
  and keep the top-left 112×48 / bottom-right 96×96 platform safe areas clear.
- `templates/vanilla` is now a full-bleed reference (no fake outer stage frame).

`2048-fullbleed.png` is the isolated-host check for the same game/window that
showed the black frame in the report; console errors were 0 and computed
`.dgm-runtime-stage-wrap` padding was `0px` (stage radius `0px`).
