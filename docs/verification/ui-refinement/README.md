# Game Market UI refinement · 2026-10-19

Base: PR #1 (`feat/ui-polish@401f678`). Implementation: `feat/ui-refinement`.
General development rules remain in `PROJECT_MEMORY.md`; this is a scoped design and verification record.

## Direction

A quiet game gallery within DSH: first-party illustrations, one blue action accent,
clear grouping and short utility copy. Keep the host's typography and theme tokens,
work offline, and introduce no dependencies or remote font/image requests.

- Four original inline vector covers replace letter placeholders for first-party games.
  Explicit Registry cover images still take precedence; third-party games keep their image/fallback behavior.
- Small catalogs show a resume entry and one complete catalog, avoiding repeated New/Popular rows.
  Category controls list available types and retain an active filter after refresh.
- Detail retains a compact cover/title composition; the single primary action sits beside the title.
  Instructions, game information and permissions are distinct; destructive actions live in an expandable management section.
- Library rows have a consistent artwork/title/action rhythm and no online freshness footer.
- Dates and categories follow the host UI language rather than an unrelated browser language.
  Updates within a minute use "刚刚" / "just now".
- Menus toggle closed correctly, accept ArrowDown, return focus on Escape, and can open upward near the scroll boundary.
- Page fades, cover hover feedback and menu entrance share restrained timing; reduced motion disables cover transforms.

## Verification

Environment: macOS, Node 24.14.0; actual installed DSH runtime extracted to a temporary directory,
started with a separate `DSH_HOME` and profile. Chromium through Playwright.
The preview uses fresh installation data and a 2048 session created by playing through the real iframe.
No daily DSH profile or user game storage was modified.

| Check | Actual result |
|---|---|
| `npm run verify` | Build/check/full tests passed: 784/784, 0 failed, 0 cancelled; CHECK OK (23) |
| Host language / relative time regression | Chinese host labels produce Chinese dates/categories; fresh relative times localized |
| Search "Breakout" | One matching game after debounce |
| Puzzle category | One result, resume entry hidden while filtering |
| Menu trigger | Second click closes; ArrowDown focuses a menu item; Escape returns focus |
| Online library footer | No freshness footer or mixed English relative time |
| Real 2048 run | Start, move, return to market, save and resume entry displayed |
| Narrow layouts | 375px panel and 375px browser viewport (319px panel) without horizontal overflow |
| Landscape | 812 × 430 viewport; open menu remains inside content bounds |
| Dark theme | Host tokens followed; detail and library inspected |
| Reduced motion | Computed animation duration reduced; cover transforms disabled |

The existing Node-only timeout and retry tests could be cancelled because production background timers
are unref'd while mocked requests have no socket handle. The base branch reproduced 9 cancellations.
Only the test harness owns the missing lifetime now: a referenced scheduler for retry tests and an
explicitly cleaned-up handle for the fake pending-fetch test. Production API/retry behavior is unchanged.

Expected first-run `GET /save` 404 was observed for a game with no save; it was followed by successful
startup and save. No UI exception or white screen was observed in these flows.

## Screenshots

These are isolated-host UI evidence, not a replacement for the v1.0.0 acceptance set.

- [Market with resume](./market.png)
- [Compact 2048 detail](./detail.png)
- [Library](./library.png)
- [375px detail](./detail-375.png)
- [Dark detail](./detail-dark.png)
- [375px dark library](./library-dark-375.png)

Desktop window chrome and OS text scaling were not revalidated. No release, merge or push is part of this work.
