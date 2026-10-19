# External content repository setup (M4 step 1)

Created with explicit user authorization on 2026-10-19 (no merge/tag/release yet).

| Item | Value |
|---|---|
| Repository | [heswy/dsh-game-registry](https://github.com/heswy/dsh-game-registry) (public) |
| Bootstrap commit | `18b6580` — "chore: initialise community catalog repository" |
| Toolchain lock | `heswy/dsh-game-market@c93a85a4…` (feature-branch toolchain; move to the release commit after PR #4 merges) |
| Raw default source | https://raw.githubusercontent.com/heswy/dsh-game-registry/main/registry/games.json |
| Live index (verified) | `{"registryVersion":1,"generatedAt":"1970-01-01T00:00:00.000Z","games":[]}` |
| CI | `validate-catalog` run [39233399862](https://github.com/heswy/dsh-game-registry/actions/runs/39233399862) — **success** (job `validate`) |
| Branch ruleset | `main-protection`: no deletion/force-push, PR required, required status check `validate` |
| Tag ruleset | `release-tag-protection`: `refs/tags/*-v*` deletion/non-fast-forward/update blocked |
| Immutable releases | enabled (`{"enabled":true}`) |
| License | MIT (`LICENSE` copied from the platform repository) |
| Topics | `dsh-game-market`, `catalog`, `registry` |

## What is still pending

1. Real submission → Release → catalog PR → merge → update → withdraw loop. This
   needs either a real author identity/source repo + media/package URLs, or an
   explicit authorization to run a controlled maintainer test release.
2. `templates/registry/CODEOWNERS` still has the template placeholder; fill in
   the real maintainer(s).
3. After PR #4 merges, update `toolchain.lock.json` in the content repo to the
   merged platform release commit and re-run CI.
4. Optional hardening: raise required approving review count on `main-protection`.
5. GitHub Release redirect host verification after the first real Release; the
   current Host allowlist is `github.com`, `raw.githubusercontent.com`,
   `objects.githubusercontent.com`.
