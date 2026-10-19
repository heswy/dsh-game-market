# External content repository setup (M4 step 1)

Created with explicit user authorization on 2026-10-19. No platform merge/tag was
performed by this worktree; PR #4 was merged by the user (`heswy`).

| Item | Value |
|---|---|
| Repository | [heswy/dsh-game-registry](https://github.com/heswy/dsh-game-registry) (public) |
| Bootstrap commit | `18b6580` — "chore: initialise community catalog repository" |
| Toolchain pin commit | `0663dc8` (PR #1) → main `ad48ab3`; lock points at `heswy/dsh-game-market@2b45b2e` (merged PR #4) |
| README sync | PR #2 → main merge run [39234214396](https://github.com/heswy/dsh-game-registry/actions/runs/39234214396) **success** |
| Raw default source | https://raw.githubusercontent.com/heswy/dsh-game-registry/main/registry/games.json |
| Live index (verified) | `{"registryVersion":1,"generatedAt":"1970-01-01T00:00:00.000Z","games":[]}` |
| CI | `validate-catalog`; bootstrap run 39233399862, pin PR 39233852643, main merge 39233955315, README PR 39234160085, README merge 39234214396 — all **success** |
| Branch ruleset | `main-protection`: no deletion/force-push, PR required, required status check `validate` |
| Tag ruleset | `release-tag-protection`: `refs/tags/*-v*` deletion/non-fast-forward/update blocked |
| Immutable releases | enabled (`{"enabled":true}`) |
| CODEOWNERS | `* @heswy` (replaced template placeholder via PR #1) |
| License | MIT (`LICENSE` copied from the platform repository) |
| Topics | `dsh-game-market`, `catalog`, `registry` |

## What is still pending

1. Real submission → Release → catalog PR → merge → update → withdraw loop. This
   needs either a real author identity/source repo + media/package URLs, or an
   explicit authorization to run a controlled maintainer test release.
2. GitHub Release redirect-host verification after the first real Release; the
   current Host allowlist is `github.com`, `raw.githubusercontent.com`,
   `objects.githubusercontent.com`.
3. Optional hardening: raise required approving review count on `main-protection`.
4. The content repository's toolchain is pinned to `2b45b2e` (platform v1.1.0
   main); after a future platform release, bump the lock via a PR.
