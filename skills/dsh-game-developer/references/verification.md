# Verification before submitting

Record exact commands, exit codes, artifact SHA-256/size and what was
simulated vs real. A green local check is not maintainer approval and not a
published game.

## 0. Environment prerequisites

```bash
cd <platform-checkout>
npm install        # or: npm ci --ignore-scripts
node -v            # need >= 20
export DSH_GAME_CLI="<platform-checkout>/scripts/cli/dsh-game.mjs"
```

- V1.5 ZIP validation/packing uses the Host archive reader, which needs
  `yauzl@3.4.0` (+ `pend@1.2.0`). Verified behaviour on a simulated clean clone
  (module resolution blocked):
  - `html-v1` create/build/validate/pack/publish-dry-run: all exit 0;
  - ZIP `create`/`build`: exit 0; ZIP `validate` **and** ZIP `pack`: both exit 2
    with `error: Missing toolchain dependency: asset-zip-v2 validation/packing
    needs the repository dependencies (the Host archive reader uses "yauzl")`
    and hint `Run npm install (or npm ci) at the repository root, then retry.`;
    `--json` reports `error.code: "E_TOOLCHAIN_DEPS_MISSING"` (human output does
    not print the token).
  So run `npm install` before ZIP work; the commands themselves are offline.
- Generated projects do not store the CLI path. Use the `DSH_GAME_CLI`
  environment variable (or a `"cli"` entry in `dsh-game.config.json`). Quote the
  path if it contains spaces. A wrapper without it exits 2 with
  `[dsh-game] cannot find the dsh-game CLI.`

## 1. Per-format artifact gate

Run from the generated project directory:

```bash
npm run build      # HTML: dist/index.html — ZIP: dist/ tree + dist/dsh-package.json
npm run validate   # same shared/host validators the platform uses
npm run pack       # HTML: dist/<id>-<version>.html — ZIP: dist/<id>-<version>.dshgame.zip
npm run validate   # run again: validates the packed artifact too
```

Direct-CLI equivalents (the same commands the wrappers run):

```bash
node "$DSH_GAME_CLI" build . --format asset-zip-v2
node "$DSH_GAME_CLI" validate . --format asset-zip-v2     # project dir (in-memory build + real ZIP validation)
node "$DSH_GAME_CLI" pack . --format asset-zip-v2
node "$DSH_GAME_CLI" validate dist                         # built dist dir (auto-detected)
node "$DSH_GAME_CLI" validate dist/<id>-<version>.dshgame.zip   # packed archive
node "$DSH_GAME_CLI" pack dist/<id>-<version>.dshgame.zip --out <dir>  # repack/round-trip (byte-identical)
```

- Format is auto-detected from `dsh-game.config.json` for projects,
  `dsh-package.json` for a built `dist/` and the `.dshgame.zip` suffix for
  archives; `--format` is only needed to force a reading.
- `pack` prints `sha256`, bytes, `fileCount`, `filesDigest`, the `.sha256`
  sidecar path and a self-test that re-extracts the ZIP (0444 mode) and checks
  the digest. `pack --json` adds `permissions[]` (`path`, `mode`).
- `pack <packed .dshgame.zip>` is allowed and reproduces the same outer sha256
  and `filesDigest` (deterministic ZIP round-trip).
- `validate --json` exposes `ok`, `errors[]` (`code`, `gm`, `path`, `message`,
  `hint`, `value`), `warnings`, `manifest`, `bytes`, `source`, `format`,
  `entry`, `fileCount`, `filesDigest`.
- `publish --dry-run` prints the registry entry/upload plan/checklist paths and
  `(dry run: no files written)`; it writes no files and makes no remote calls.
  A normal publish writes `registry-entry.json` (ZIP: `package.format` +
  `package.filesDigest`), `upload-plan.md` and `review-checklist.md` next to
  the package. `publish --dry-run --json > dist/publish.json` captures the entry
  and hashes for submission generation.
- `publish` validates the generated registry entry for both formats: absolute
  https `--url`, exact package file name, and the package-host allowlist
  (default GitHub hosts; repeatable `--allowed-host` adds hosts). A disallowed
  host fails with `E_REGISTRY_INVALID (GM-5032)`; http/wrong suffix exits 2.
- Known boundary: `publish --format asset-zip-v2 --registry-dir <dir>` exits 2
  with a pointer to the maintainer content-repo tooling; do not work around it.

What `validate` must prove for `asset-zip-v2`:

- descriptor schema (`formatVersion`, `entry`, `gameManifest`, sorted `files[]`);
- every `files[]` entry exists, no extra/missing files, real size+sha256;
- path rules (relative POSIX, no traversal/absolute/drive/UNC/backslash/NUL);
- Stored/Deflate only; no encryption/ZIP64/symlinks/devices/nested archives;
- per-entry and total limits (see `package-and-sdk.md` §6);
- `game.json` manifest validity and `<id>/<version>` consistency;
- content scan: inline script/style/handler/`javascript:` → `GM-4283`;
  external/absolute URLs, `eval`, `new Function`, `serviceWorker`,
  `window.open` → `GM-4280`; second inline manifest → `GM-4279`;
- the packed ZIP is validated with the Host archive reader (not just the dist
  directory), i.e. it would actually install.

Do not bypass or edit validator rules. Build/validate stops at the first
failing stage; fix one defect and re-run to surface the next.

## 2. Determinism and digest

- Build twice and compare bytes (`sha256sum` / `shasum -a 256`): the same source
  must produce byte-identical builds.
- ZIP `pack` must be deterministic too: two packs of the same build produce the
  same outer sha256 and the same `filesDigest`; repacking the packed ZIP must
  reproduce it as well.
- Verify the `.sha256` sidecar matches the artifact for this exact version;
  never reuse a digest from an earlier version.
- Keep `filesDigest` (from `pack`/`publish --json`, or
  `registry-entry.json` → `package.filesDigest`) for the submission JSON and
  catalog v2 release. `filesDigest` is the public field name everywhere
  (submission, registry entry, catalog, upload plan); the Host reader's
  internal return field `fileManifestDigest` is the same value under a legacy
  internal name — do not use it in author documents.

## 3. Illegal package → fix → re-validate (required when validation fails)

Real examples from the V1.5 toolchain (exit code 1 unless noted):

1. **External resource** in a ZIP document (build stage, no GM code):

   ```text
   error: External stylesheet is not allowed in asset-zip-v2: https://cdn.example.com/x.css
     hint: Ship the CSS inside the package.
   ```

2. **Inline script** in a ZIP document (build stage):

   ```text
   error: asset-zip-v2 packages must not contain inline <script> blocks (contract D-C)
     hint: Move the code to the project entry file; the CLI emits scripts/main.js.
   ```

   Fix both: bundle the file into the package and reference it relatively; move
   JS to `src/main.js` (external `scripts/main.js`), CSS to `src/styles.css`
   (external `styles/styles.css`), replace `on*=` with `addEventListener`,
   remove `javascript:` URLs; rebuild.

3. **Inline content caught by the archive validator** after `dist/index.html`
   was edited and the descriptor updated consistently:

   ```text
   FAIL  <project>/dist (<actual bytes>)
     1. E_ASSET_INLINE_FORBIDDEN (GM-4283) entry: HTML is not package-safe: index.html
   ```

4. **Stale descriptor** after editing the built `dist/` (the FAIL header prints
   the real byte count, not `0 bytes`):

   ```text
   FAIL  <project>/dist (124914 bytes)
     1. E_DESCRIPTOR_MISMATCH (GM-4278) files: descriptor file manifest does not match the package
     2. E_DESCRIPTOR_MISMATCH (GM-4278) files: size mismatch for scripts/main.js
   ```

   `validate dist --json` reports the same errors with `gm: "GM-4278"` and
   `value.path`. Fix: re-run `build`/`pack` (the descriptor is generated), then
   `validate` again. Never hand-edit `dsh-package.json`.

Common GM codes and causes (archive/validate stage):

| GM code | Meaning | Typical author fix |
|---|---|---|
| `GM-4283` | inline script/style/handler/`javascript:` in a ZIP | externalize code/styles, use `addEventListener` |
| `GM-4278` | descriptor `files[]` mismatch (missing/extra/size/sha) | rebuild + repack; don't edit `dist/` or descriptor by hand |
| `GM-4273` | invalid archive path | package-relative POSIX path; no `..`/absolute/backslash/reserved names |
| `GM-4280` | external/absolute URL or forbidden API | bundle assets, use relative paths, remove `eval`/`new Function`/`serviceWorker`/`window.open` |
| `GM-4279` | second inline manifest | remove the inline V1 manifest from HTML; `game.json` is the only manifest |
| `GM-4272` | limit exceeded | reduce entries/bytes/ratio, remove unused assets |
| `GM-4277` | descriptor invalid | fix `formatVersion`/`entry`/`gameManifest`/`files[]` shape; regenerate by building |
| `GM-4271` | unsupported archive feature | store/deflate only; no ZIP64/encryption/nested archives/symlinks |

A build-stage CLI error may be reported without a GM code (with a human hint);
the archive-level `validate` reports the GM code. Record both. Missing
toolchain dependencies are **not** a GM code: the CLI exits 2 with
`E_TOOLCHAIN_DEPS_MISSING` (`--json` only); `GM-5000` is the Host
install-side/internal code, not a CLI validation result.

After the fix, re-run the whole gate (not only the last command): a fix can
change `files[]` size/sha and shift the failure to a later stage.

## 4. Run it in the local Simulator (`npm run dev` / `dev`)

Start with the wrapper or the CLI (both are long-running; Ctrl+C / SIGTERM shuts
the server down cleanly, so there is no "natural" exit code):

```bash
npm run dev
# or, direct:
node "$DSH_GAME_CLI" dev . --format asset-zip-v2 --port 4321
node "$DSH_GAME_CLI" dev . --format asset-zip-v2 --port 0          # free port, printed on start
node "$DSH_GAME_CLI" dev . --format asset-zip-v2 --no-build        # serve existing dist without rebuilding
```

Options: `--port` (default 4321), `--host` (default 127.0.0.1), `--format`,
`--no-build`, `--seed-save <file>`, `--save-out <file>`. Readiness:
`curl -s http://127.0.0.1:<port>/health` →

```json
{"ok":true,"simulator":true,"build":true,"format":"asset-zip-v2","saveApi":true,"hasSeedSave":false,"saveOut":null,"fileCount":8,"game":{"id":"…","name":"…","version":"…"}}
```

Entry points and structure:

- `/` — harness UI (fake Host controls, bridge log, theme/locale, agent state).
- html-v1: `/game` serves the built document.
- `asset-zip-v2`: `/game` returns 404; the game loads through
  `/wrapper?src=/res/<instance>/<token>/index.html`. The platform wrapper is an
  outer iframe (not sandboxed) that embeds the game document in a second iframe
  with `sandbox="allow-scripts"`; package files are served under
  `/res/<instance>/<token>/<path>`. Expect two frames: debug/console inside the
  game frame, and remember CSP is enforced on the game document while the
  wrapper is dev scaffolding.
- `/dev/save/export` — GET latest fake save JSON
  (`{ok, game:{id,version}, savedAt, save}`).
- `/dev/save/import` — POST `{"save": {…}}` to import a save.
- `/health` — status JSON above.

Verify real behavior (record what you actually did):

- the game progresses (score/state changes — not only the outer Runtime saying
  "playing"); start/pause/resume; `before-save` (pause triggers it; answer
  within 1500 ms in production / 800 ms in the Simulator) and Continue;
  restart; keyboard, 375px narrow window, light/dark theme,
  `prefers-reduced-motion`;
- full-bleed background and platform safe areas (top 112px, bottom-right
  96×96), no white screen on `ready()` failure;
- ZIP packages: external JS/CSS/levels load as `/res/<instance>/<token>/…`
  requests returning 200 (check the game frame's network panel), no console
  errors, no package-external requests; `/health.fileCount` matches the pack;
- no `GM-*` error overlay; `GM-4006` (score out of range) and other SDK
  rejections you intentionally trigger are handled visibly, not swallowed.

Limits to report honestly: the Simulator is a browser harness with an
in-memory fake save; it does not prove real DSH Desktop install/persistence,
cross-window behavior, CSP in the real Runtime, or maintainer review. Real
Desktop verification is a separate step.

## 5. Update flow (1.0.0 → 1.0.1), old-save compatibility and platform semantics

1. Bump the game version in both declarations: `manifest.json` (authoritative;
   build copies it into `game.json`) and `package.json` (project/npm metadata).
   Keep `id`, platform ranges and capabilities unchanged.
2. Re-run `build → validate → pack → validate`; `pack` must produce
   `<id>-1.0.1.dshgame.zip` with a new sha256/`filesDigest`. Published
   `<id>-1.0.0` bytes stay immutable: never replace or re-sign them. Copy
   `dist/registry-entry.json` to a versioned name before publishing 1.0.1
   (publish overwrites it).
3. Save schema semantics (platform-observable, from the Host save service):
   - A save records the installed manifest's `save.schemaVersion`.
   - Loading/Continue rejects only when the recorded schema is **newer** than
     the current game: `GM-4099 "Save needs a newer game version"` with
     `details.savedSchemaVersion` / `details.gameSchemaVersion`; the platform
     error card treats it as a save-corrupt failure.
   - Older/equal schemas are **not** rejected and are not migrated: the game's
     `deserialize` receives the stored values unchanged.
   - Update install adds hints: `save-schema-upgrade` (new manifest raises the
     schema vs the previously installed manifest) and `save-schema-too-new`
     (the installed save is newer than the new manifest). Do not decrease
     `save.schemaVersion` in a newer release.
   - Same serialized shape: keep `save.schemaVersion` and the code's
     `SAVE_VERSION` unchanged. Changed shape: bump both and write an explicit
     migration that accepts old and new `saveVersion`, fills defaults and keeps
     old keys. Return `null` only for genuinely unrecoverable payloads.
   - Respect save limits (32 keys, 256 KiB per value, 1 MiB total) and the
     30 s autosave cadence; never rename/remove existing keys.
4. Old-save test with the dev-only save bridge (executable, no UI import/export
   required):
   - 1.0.0 build:
     `node "$DSH_GAME_CLI" dev . --format asset-zip-v2 --save-out /tmp/<id>-1.0.0.save.json`,
     play, pause (or trigger before-save). The file (and
     `GET /dev/save/export`) contains `{game, savedAt, save}`; record the values.
   - 1.0.1 build:
     `node "$DSH_GAME_CLI" dev . --format asset-zip-v2 --seed-save /tmp/<id>-1.0.0.save.json`.
     `/health` reports `"hasSeedSave": true`; launch the game, confirm
     Continue/autoload restores the recorded values and play on. The UI's
     Export/Import save buttons and `POST /dev/save/import` use the same JSON.
   - Also test a truncated/unknown payload: it must start fresh without
     crashing.
5. Submission for an update adds `submissionType: "update"` and
   `update.changelog` / `update.saveCompatibility` (`compatible` only if old
   saves really load; `incompatible` otherwise; `not-applicable` when no
   storage). See `references/submission.md`.

## 6. Report checklist

Provide, in the hand-off to the user/maintainer:

- environment prerequisites actually satisfied (`npm install` for ZIP, Node
  version, checkout version) and the exact `DSH_GAME_CLI` used;
- commands + exit codes + artifact sha256/size for **both** build and pack;
- determinism evidence (two hashes equal, same `filesDigest`, repack
  round-trip);
- `validate --json` / `pack --json` evidence (fileCount, filesDigest,
  permissions);
- simulation results (what was checked, on which viewport/theme, `/health`
  values, `/res` requests, save export/import files);
- old-save compatibility evidence for updates (payload + restore result);
- pending items (public URLs, GitHub identity, license confirmation, media,
  reviewer approval) — never fabricate.
