# M4 controlled public loop (real GitHub)

Executed after explicit user authorization for a **controlled test author**.
No platform PR was merged by this worktree; content-repo PRs listed below were
merged as part of the authorized controlled test. No platform tag/release was
created.

## Test author (public)

| Item | Value |
|---|---|
| Author repo | https://github.com/heswy/dsh-game-test-author (public, controlled test) |
| 1.0.0 source commit | `63873f2f7cb4406bd9ef2be6edd88ea0814b37c2` |
| 1.0.0 release | https://github.com/heswy/dsh-game-test-author/releases/tag/ember-drift-v1.0.0 |
| 1.0.1 source commit | `50bf4bf79ce598049099795b6efd7e30d36daccc` |
| 1.0.1 release | https://github.com/heswy/dsh-game-test-author/releases/tag/ember-drift-v1.0.1 |

The author submission/review records used are archived under `artifacts/m4/`.
Author identity: `heswy` / `174761563`. Game: Ember Drift, MIT, Vanilla, single-file.

## Content repository PRs / CI (all success)

| Step | PR | Main merge | CI evidence |
|---|---|---|---|
| Publish 1.0.0 | https://github.com/heswy/dsh-game-registry/pull/3 | `3211605` | PR run 39236876858; main 39237144242 |
| Update 1.0.1 | https://github.com/heswy/dsh-game-registry/pull/4 | `78ce20a` | PR run 39238282143; main 39238385001 |
| Withdraw (controlled) | https://github.com/heswy/dsh-game-registry/pull/5 | `61e662a` | PR run 39238475283; main 39238650451 |

- 1.0.0 package: 156,897 B, sha256 `cb2c5a6f…`; content release `ember-drift-v1.0.0`.
- 1.0.1 package: 156,897 B, sha256 `b0ce0ef6…`; save schema unchanged; content release `ember-drift-v1.0.1`.
- Withdrawal removed only `catalog/ember-drift.json` and the index; `owners/ember-drift.json`,
  `reviews/ember-drift/1.0.0.json`, `reviews/ember-drift/1.0.1.json` remain as audit records.
- Final git/API main index is `{"registryVersion":1,"generatedAt":"1970-01-01T00:00:00.000Z","games":[]}`.
  The `raw.githubusercontent.com` CDN may serve the previous index for its cache TTL;
  GitHub API / a fresh clone is authoritative. Users refresh after CDN convergence.

## Real Host install + redirect host

Installing from a Registry entry whose package URL is a GitHub Release asset
redirects to `release-assets.githubusercontent.com`. That host was missing from
`DEFAULT_ALLOWED_HOSTS`; it is now added (with tests). Real-network Host evidence
(using the pre-withdraw commit `3211605` index because the catalog is now
withdrawn):

- registry: HTTPS source fresh, count 1 (`ember-drift@1.0.0`);
- install: sha256 `cb2c5a6f769111d8d1ac7c22cbbe360b79ea95416edb340b992964f4a18ab283`;
- launch: `x-entry-sha256` matches the installed package.

Evidence: `artifacts/m4/host-install.log`, `artifacts/m4/release-redirect.log`
(final URL host `release-assets.githubusercontent.com`, downloaded bytes hash matches).

## Platform release status

The follow-up platform PR #5 was reviewed and merged as `e247b93`. Its fixes and
this evidence are included in platform `v1.2.0`; this platform tag does not update
the content repository toolchain pin, which still requires a separate PR.

## Remaining (not claimed as production-ready)

- Production author identities/source repos and maintainer review identities.
- Promotion of the content repository toolchain pin to the v1.2.0 platform
  release commit through a separately verified PR.
- Full real-time 120 s playthrough and cross-machine save persistence / real Host
  update delivery.
- M4 production loop with a real external author (this was a controlled test).
