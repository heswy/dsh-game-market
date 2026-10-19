# C-21 — Invalid package repair loop (independent evidence)

**Status: independently verified locally** (zero-dependency `dsh-game` CLI from the
platform checkout, used read-only; no DSH Host install, no network, no publish).

Evidence root: `<tmp>/dsh-c21-c22/`
Machine summary: `<tmp>/dsh-c21-c22/evidence-summary.json`

## Environment

| Fact | Value |
| --- | --- |
| Node / npm | v24.14.0 / 11.9.0 |
| Platform checkout | `<repo>` |
| Checkout HEAD when evidence was captured | `dc646d84d5bd9ac8e5e9c119002a6537ad9ad5ae` (`feat/community-publishing`) |
| CLI | `<checkout>/scripts/cli/dsh-game.mjs`, CLI version `0.1.0`, sha256 `f07e6b58a183bb7126850fc60c654fea604d9254ea1f31122549f32e9f7948df` |
| Skill | `skills/dsh-game-developer` VERSION `1.0.0`, SKILL.md sha256 `9f9dadbfad37737c6f866b7ad990502af223df0f9b3979bfe440a4d52870b449` |
| Raw env log | `evidence-c21/logs/15-environment.log` |

The checkout was **not modified**. One unrelated file
(`scripts/registry/test/cli.test.js`) was already dirty in the worktree and was
not touched by this evaluation.

## 1. Project creation (exact command)

```bash
export DSH_GAME_CLI="<repo>/scripts/cli/dsh-game.mjs"
node "$DSH_GAME_CLI" create c21-invalid --dir <tmp>/dsh-c21-c22 --template vanilla
```

Exit `0`. Project: `<tmp>/dsh-c21-c22/c21-invalid` (id `c21-invalid`, vanilla
template, `manifest.json` + `src/` + local wrappers + `sdk/`).

Baseline before breaking (logs `00-baseline-*`): `npm run build` 0,
`npm run validate` 0, `npm run pack` 0.

> Toolchain note: `dsh-game create` does **not** record the CLI path in
> `dsh-game.config.json`, so `DSH_GAME_CLI` must be exported in every shell that
> runs the wrappers. A first attempt without it exited `2`
> ("cannot find the dsh-game CLI"); those raw logs are kept in
> `evidence-c21/logs/env-note/` and are not part of the result.

## 2. Deliberate breakages and observed failures

### Breakage A — invalid manifest (`score.min` > `score.max`)

`manifest.json`: `score.min: 900`, `score.max: 100` (was `0` / `1000000`).

```bash
cd <tmp>/dsh-c21-c22/c21-invalid && npm run build
```

Exit **1**, log `logs/01-break-manifest-build.log`:

```text
FAIL  <tmp>/dsh-c21-c22/c21-invalid/manifest.json (0 bytes)
  1. E_PKG_SCORE_RANGE (GM-4243) score: score range is invalid
     hint: Set score.min < score.max with a span of at most 1e9, and a valid direction/integer.
```

### Breakage B — non-self-contained package (external script)

`index.html`: added `<script src="https://cdn.example.com/x.js"></script>`
(manifest fixed first, so this is an independent failure).

```bash
cd <tmp>/dsh-c21-c22/c21-invalid && npm run build
```

Exit **1**, log `logs/02-break-external-script-build.log`:

```text
FAIL  <tmp>/dsh-c21-c22/c21-invalid (108335 bytes)
  1. E_PKG_ENTRY_NOT_SELF_CONTAINED (GM-4225) entry: package is not self-contained: external script resource (https://cdn.example.com/x.js)
     hint: Inline every script/style/image/font (data: URI) and remove network APIs. Run `dsh-game build` from the official template.
```

Two extra independent package-level checks were run on copies of the **built**
package (so the `validate <path>` path itself is exercised):

| Artifact | Command | Exit | Code |
| --- | --- | --- | --- |
| `artifacts/c21-invalid-1.0.0.duplicate-manifest.html` (second inline manifest appended) | `node "$DSH_GAME_CLI" validate <file>` | 1 | `E_PKG_MANIFEST_DUPLICATE` (GM-4221), path `manifest` |
| `artifacts/c21-invalid-1.0.0.external-script.html` (external `<script src>` injected) | `node "$DSH_GAME_CLI" validate <file>` | 1 | `E_PKG_ENTRY_NOT_SELF_CONTAINED` (GM-4225), path `entry` |

Logs: `logs/04-break-duplicate-manifest-validate.log`,
`logs/05-break-external-script-validate.log`.

The two source-level breakages were captured live; because `npm run build`
stops at the first failing stage, they had to be repaired one at a time.
Reconstructed copies of both broken sources are kept as
`artifacts/manifest.broken-score.reconstructed.json` and
`artifacts/index.broken-external-script.reconstructed.html`; they were replayed
on a scratch copy and reproduced exactly the same codes/exit codes
(`logs/18a-*.log`, `logs/18b-*.log`).

## 3. Fix (Skill-guided only) and green rebuild

Fixes were limited to what the Skill/references prescribe:
`references/package-and-sdk.md` (self-contained HTML, no external resources) and
the validator's own field-path hint for `score.min < score.max`.

1. removed the external `<script src="https://cdn.example.com/x.js">` from `index.html`;
2. restored `score.min: 0`, `score.max: 1000000` in `manifest.json`.

```bash
cd <tmp>/dsh-c21-c22/c21-invalid
npm run build      # exit 0  (06-fixed-build.log)
npm run validate   # exit 0  (07-fixed-validate.log)
npm run pack       # exit 0  (08-fixed-pack.log)
```

Final validation output (`logs/07-fixed-validate.log`):

```text
OK  .../dist/index.html (108202 bytes)
    manifest: c21-invalid@1.0.0 (C21 Invalid)
OK  .../dist/c21-invalid-1.0.0.html (108202 bytes)
    manifest: c21-invalid@1.0.0 (C21 Invalid)
```

`--json` reports: `logs/10-validate-json.log`,
`logs/11-validate-packed-json.log`, `logs/12-pack-json.log` (all `"ok": true`,
`errors: []`, `warnings: []`).

### Final packed artifact

| Field | Value |
| --- | --- |
| File | `<tmp>/dsh-c21-c22/evidence-c21/artifacts/c21-invalid-1.0.0.html` (copy of `c21-invalid/dist/c21-invalid-1.0.0.html`) |
| Size | **108,202 bytes** |
| SHA-256 | **`6af1eb530dce0a5b9f4cee8269ddf5c740c3b2e1e3ca6c85814c10948bda7cb9`** |
| Sidecar | `c21-invalid-1.0.0.html.sha256` |

Digest verification (exit 0):

```text
$ shasum -a 256 -c c21-invalid-1.0.0.html.sha256
c21-invalid-1.0.0.html: OK
```

Determinism: three independent builds (baseline, post-fix, re-confirmation
after the checkout moved to `dc646d84`) all produced the same sha256 above
(`logs/00-baseline-build.log`, `06-fixed-build.log`, `09-determinism-rebuild.log`,
`16-reconfirm-build-validate-pack.log`).

### Repair-loop exit-code summary

| # | Step | Exit |
| --- | --- | --- |
| 1 | broken manifest → `npm run build` | 1 |
| 2 | fix manifest, external script present → `npm run build` | 1 |
| 3 | duplicate inline manifest in package copy → `validate` | 1 |
| 4 | external script in package copy → `validate` | 1 |
| 5 | fixed package → `npm run build` / `validate` / `pack` | 0 / 0 / 0 |
| 6 | `shasum -a 256 -c` | 0 |

## 4. Evidence index (all under `<tmp>/dsh-c21-c22/evidence-c21/`)

- `logs/commands.tsv` — every command with its recorded exit code.
- `logs/00-…` … `logs/18b-…` — raw stdout+stderr per command (see filenames).
- `logs/env-note/` — the initial missing-`DSH_GAME_CLI` attempt (documented toolchain note).
- `artifacts/c21-invalid-1.0.0.html` + `.sha256` — final package.
- `artifacts/*.duplicate-manifest.html`, `*.external-script.html` — broken packages used for validate-path evidence.
- `artifacts/manifest.good-1.0.0.json`, `*.reconstructed.*` — sources before/after deliberate breaks.

## 5. What this does and does not prove

- **Verified:** `build`/`validate`/`pack` detect the two deliberate defects with
  the exact `E_*`/`GM-*` codes above and exit 1; after a Skill-guided fix they
  exit 0; the packed SHA-256 matches a `shasum -c` check and reproduces across rebuilds.
- **Not verified here:** Host install/launch validation, maintainer review,
  registry/publish, or any real Runtime behavior (that belongs to C-22).

## 6. Skill / toolchain gaps hit

1. `create` leaves `dsh-game.config.json` without a `cli` path; the wrappers
   therefore fail with exit 2 in any shell where `DSH_GAME_CLI` is not exported.
   The generated README documents this, but the Skill's §5 command block does
   not restate it, and the `create` step does not persist it — easy to trip on.
2. `npm run build` short-circuits at the first failing stage (manifest before
   package self-containment), so a package with two independent defects hides
   the second one until the first is fixed. Not a validator bug, but the Skill's
   "fix the cause and rerun" loop gives no hint that N defects need N rounds.
3. `npm run validate` only validates the packed `<id>-<version>.html` when it
   already exists (`scripts/validate.mjs`); otherwise only `dist/index.html` is
   checked. A first-time author who never packed gets no filename-check coverage.
