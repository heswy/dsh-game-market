---
name: dsh-game-developer
description: Build, adapt, validate, pack and prepare a DSH Game Market game submission (html-v1 single file or asset-zip-v2 multi-file resource package) from a gameplay idea. Use when creating a game, porting a small game, choosing between package formats, fixing validator/GM-* failures, running the local Runtime Simulator, testing 1.0.1 save upgrades, or preparing a new/update community submission. Do not use for maintaining the Game Market platform itself or performing maintainer catalog publishing.
---

# DSH Game Developer

Turn a gameplay request into a real, playable DSH Game Market game and a
verified author-side submission package. This Skill covers **authoring,
author-side validation and submission materials**, not maintainer review or
catalog publishing.

## Before you start

1. Locate a **platform checkout**: the public `dsh-game-market` repository at
   the version the user targets (https://github.com/heswy/dsh-game-market).
   Every build/validate/pack command comes from that checkout; never
   reimplement the validator or package format. If you only have this Skill
   archive and no checkout, stop and ask the user for one.
2. Install the checkout's one runtime dependency package **before ZIP work**:

   ```bash
   cd <platform-checkout>
   npm install        # or: npm ci --ignore-scripts   (package-lock.json is committed)
   ```

   V1.5's `asset-zip-v2` ZIP reading/writing needs `yauzl@3.4.0` (+ `pend@1.2.0`).
   On a clean checkout without `node_modules`, ZIP `validate` and ZIP `pack`
   both **exit 2** with
   `error: Missing toolchain dependency: asset-zip-v2 validation/packing needs
   the repository dependencies (the Host archive reader uses "yauzl")` and the
   hint `Run npm install (or npm ci) at the repository root, then retry.
   html-v1 commands work without it.` `--json` exposes
   `error.code: "E_TOOLCHAIN_DEPS_MISSING"` (human output does not print the
   token). This is a CLI-side toolchain error, not a package validation
   failure. `html-v1`-only work does not need the install. The toolchain itself
   never uses the network at runtime: `build`/`validate`/`pack`/`publish`/`dev`
   are offline, but ZIP validation/packing need these already-installed modules.
   React-template projects additionally need their own `npm install` (Vite/
   TypeScript/React dev dependencies) before `npm run build`.
3. Use **Node.js ≥ 20**. The CLI is plain JavaScript in the checkout; its only
   third-party runtime dependency is the archive reader's `yauzl` (see step 2).
4. Set `DSH_GAME_CLI` in every shell that runs a **generated project's local
   wrappers**. `create` deliberately does **not** record an absolute CLI path
   (projects stay portable); the `dsh-game.config.json` `"cli"` field is an
   optional manual override:

   ```bash
   export DSH_GAME_CLI="<platform-checkout>/scripts/cli/dsh-game.mjs"
   ```

   The path often contains spaces: always quote it (`node "$DSH_GAME_CLI" …`).
   Without the variable a wrapper exits 2 with
   `[dsh-game] cannot find the dsh-game CLI.` The fallback
   `../../scripts/cli/dsh-game.mjs` only works for projects scaffolded inside
   the checkout's `templates/` tree.
5. Create an isolated game project **outside** the platform checkout (a scratch
   directory). Never edit the platform checkout, the user's DSH profile, or an
   installed plugin to make a game pass.
6. Read only the references you need:
   - `references/package-and-sdk.md` — the two formats, `dsh-package.json` /
     `game.json`, SDK delivery/API, forbidden content, limits, allowed resource
     types, CSP/resource-origin semantics.
   - `references/presentation.md` — full-bleed Runtime, themes, viewport, safe areas.
   - `references/verification.md` — build/validate/pack determinism, JSON output,
     illegal package → fix → re-validate, Simulator checks, 1.0.0 → 1.0.1 and
     save-compatibility testing.
   - `references/submission.md` — author-side submission JSON, draft/pending,
     review record, catalog v2 release (`format` / `filesDigest`).
7. Know the commands: `node "$DSH_GAME_CLI" --help` and `<command> --help`
   (`dev --help` has dev-specific options). If a flag named below is missing,
   stop and report the checkout version mismatch instead of guessing.

## 0. Command contract (verified on the V1.5 dual-format toolchain)

All commands are `node <platform-checkout>/scripts/cli/dsh-game.mjs <command>`.
Format resolution: explicit `--format html-v1|asset-zip-v2` > the project's
`dsh-game.config.json.format` > default `html-v1`. Omitting `--format` keeps
pre-V1.5 single-file behavior byte-identical. `create/build/validate/pack/
publish/dev` all accept `--format`; `build/validate/pack/publish` also accept
`--json` for machine-readable output.

| Step | `html-v1` | `asset-zip-v2` |
|---|---|---|
| `create <id> --dir <parent> [--template vanilla\|react] [--name … --description … --author …]` | verified exit 0 | add `--format asset-zip-v2`; verified exit 0 |
| `build [project]` | verified; writes `dist/index.html` | verified; writes `dist/` tree + `dist/dsh-package.json` |
| `validate <path>` | project dir / `dist/index.html` / packed `.html` | project dir / built `dist` dir / packed `.dshgame.zip` (auto-detected; `--format` only needed to force); **ZIP needs `npm install`** (else exit 2, `E_TOOLCHAIN_DEPS_MISSING`) |
| `pack [project]` | verified; `.html` + `.sha256` | verified; `.dshgame.zip` + `.sha256` + sha256/bytes/fileCount/filesDigest/0444/self-test report; input may be project dir, built `dist/`, packed `.html` or packed `.dshgame.zip` (round-trips byte-identically); **requires `npm install`** |
| `publish [project] --url … --cover …` | verified, offline, writes `registry-entry.json` + `upload-plan.md` + `review-checklist.md`; validates package URL/host (`GM-5032`) | add `--format asset-zip-v2` (or config/packed-suffix decides); verified; writes the same three files (ZIP: `package.format` + `package.filesDigest`) |
| `publish … --dry-run` | verified: prints the plan, **writes no files, no remote calls** | verified, same guarantee |
| `publish --json` | verified: prints the entry + files + hashes; `--dry-run --json > dist/publish.json` is the clean way to capture it | same |
| `pack/validate --json` | verified: `sha256`, `bytes`, `fileCount`, `filesDigest`, `permissions`, `errors[].gm`, `source`, `manifest` | same |
| `dev [project]` | verified local Runtime Simulator | verified; serves `/wrapper?src=…` + `/res/<instance>/<token>/…` (`/game` intentionally 404s) |

Known toolchain boundaries:
- `publish --format asset-zip-v2 --registry-dir <dir>` is not wired yet: exits 2
  with a pointer to `scripts/registry/prepare.mjs` (maintainer content-repo
  tooling). For ZIP submissions write `registry-entry.json` and hand it to the
  maintainer flow; never edit the content repository yourself.
- `publish` (both formats) enforces: absolute https URL, exact
  `<id>-<version>.<ext>` file name (`.dshgame.zip` for ZIP), and the Registry
  package-host allowlist. Default allowed hosts: `github.com`,
  `raw.githubusercontent.com`, `objects.githubusercontent.com`,
  `release-assets.githubusercontent.com`; add more with repeatable
  `--allowed-host <host>`. A disallowed host fails with
  `E_REGISTRY_INVALID (GM-5032)`. The content-repo/maintainer flow remains the
  final authority.

If the checkout predates V1.5 (`--format` missing), only the `html-v1` column is
executable. Report the version mismatch and continue with `html-v1` or wait for
a newer checkout.

## 1. Understand the request and choose the package format

Extract: gameplay loop, controls, session length, visual style, language,
whether progress must survive Continue, and whether the request explicitly
wants one file. Use sensible defaults for non-blocking gaps; ask only when a
missing decision changes the game.

Default to **`asset-zip-v2`** when the game has more than a few hundred lines of
JS, real art/audio, or level data: it ships separate `scripts/`, `styles/`,
`assets/`, `levels/`, `audio/` files. Use **`html-v1`** only for genuinely tiny
single-file games or when the user explicitly asks for one HTML file. The
decision and trade-offs are in `references/package-and-sdk.md` §1.

## 2. Scaffold and implement

```bash
cd <work-dir>
node "<platform-checkout>/scripts/cli/dsh-game.mjs" create <game-id> \
  --dir . --template vanilla --format <html-v1|asset-zip-v2> \
  [--name "<Display Name>" --description "<one sentence>" --author "<name>"]
cd <game-id>
```

- `--name` feeds both the manifest `name` and the template i18n `title`;
  `--description`/`--author` land in the manifest. The id must be 3–48
  lowercase letters/digits/hyphens (not reserved); `--force` allows a non-empty
  target, `--dry-run` lists files without writing.
- The generated project contains `manifest.json` (authoritative manifest source,
  built to `game.json`), `index.html` entry template, `src/`, optional
  `assets/ levels/ audio/`, a `dsh-game.config.json`
  (`format`/paths/`resources`/outDir or out file; optional `"cli"` override),
  local CLI wrappers (`scripts/build|validate|pack|publish|dev.mjs`) and SDK
  typings (`sdk/`, `vendor/`). **Read the generated `README.md` once**: it
  documents the actual layout, including that `<src basename>.css` is emitted as
  `dist/styles/<basename>.css` (e.g. `src/styles.css` →
  `dist/styles/styles.css`) and the wrapper CLI resolution order. Images become
  `assets/<file>`; the `resources` list in `dsh-game.config.json` controls which
  folders are copied.
- Vanilla templates need no **project-level** `npm install` for
  build/validate/pack (the platform-checkout `npm install` above is still
  required for ZIP validation/packing); React templates need their own
  `npm install` for build-time dev dependencies.
- A complete real multi-file example ships at `games/orbit-courier/` in the
  checkout; read it when you need a concrete `asset-zip-v2` project.

Implementation requirements (both formats):

- start, play, end/restart, input feedback, visible HUD; recognizable as the
  requested game, not a static cover or one success dialog;
- real art direction; no placeholder letters as final cover/screenshots;
- Continue only when `storage` is declared; follow the template's
  `serialize`/`deserialize` + `before-save` pattern; keep
  `save.schemaVersion` consistent with the serialized shape;
- `await game.ready()` before the loop; handle `pause`/`resume`, `before-save`
  (respond within the Runtime deadline: production `saveTimeoutMs` is 1500 ms;
  the Simulator advertises 800 ms), `visibilitychange`, and (if declared) score
  submission;
- use the actual SDK API: `game.storage.save/load/remove` (returns revision),
  `game.session.start/end`, `game.score.submit/getBest`,
  `game.lifecycle.on`, `game.agent.getStatus/on`, `game.runtime.*`, `game.onError`;
  never replace platform save with `localStorage`, and never swallow
  `GameError`s (codes/messages are in the SDK typings and
  `references/package-and-sdk.md` §8);
- i18n: the template ships `src/i18n.js` with `zh`/`en`; there is **no enforced
  key set**, but every visible string must be translated and the submission
  checklist expects both languages tested;
- levels/audio/images are author-defined data; there is no level-JSON schema,
  only extension/type/size rules. Read them with package-relative URLs or
  `game.runtime.assetUrl('levels/level-01.json')` (absolute URL; throws
  `GM-4043` on html-v1/legacy instances and `GM-4039` for a path escaping the
  resource prefix). A relative `fetch('./levels/level-01.json')` is allowed in
  ZIP packages.

Format-specific:

- `asset-zip-v2`: keep all JS/CSS external (inline blocks are rejected); put
  code in `src/main.js` (built to `scripts/main.js`); load assets relatively or
  via `assetUrl`; trust the build to inject `dsh-sdk.js`; never hand-write
  `dsh-package.json`.
- `html-v1`: everything is inlined by the build; do not add external
  scripts/styles/images/fonts/network calls.

## 3. Fit the Runtime presentation

The Runtime is **full-bleed** in both formats. The game must paint the whole
viewport, react to window resize, and keep platform overlays clear: top 112px
across the viewport (back/pause/save controls + macOS clearance) and
bottom-right 96×96 (Agent presence). No inner letterbox, outer frame, fixed
960×540 canvas chrome, or padding that assumes a platform stage. Light/dark and
`prefers-reduced-motion` must work (read `game.runtime.theme/reducedMotion` or
the values from `ready()`). See `references/presentation.md`.

## 4. Validate, pack, publish (dry-run) and run the local Simulator

From the generated project (export `DSH_GAME_CLI` first; the wrappers exit 2
without it):

```bash
export DSH_GAME_CLI="<platform-checkout>/scripts/cli/dsh-game.mjs"
npm run build
npm run validate
npm run pack
npm run validate   # run again: also validates the packed artifact
npm run dev        # Local Runtime Simulator (long-running; Ctrl+C to stop)
```

Direct CLI equivalents for the same steps:

```bash
node "$DSH_GAME_CLI" build . --format asset-zip-v2
node "$DSH_GAME_CLI" validate . --format asset-zip-v2      # project: in-memory build + real ZIP validation
node "$DSH_GAME_CLI" pack . --format asset-zip-v2
node "$DSH_GAME_CLI" validate dist                          # built dist dir (auto-detected)
node "$DSH_GAME_CLI" validate dist/<id>-<version>.dshgame.zip   # packed archive
node "$DSH_GAME_CLI" publish . --format asset-zip-v2 --dry-run \
  --url https://github.com/<owner>/<repo>/releases/download/<id>-v<version>/<id>-<version>.dshgame.zip \
  --cover https://github.com/<owner>/<repo>/releases/download/<id>-v<version>/cover.png
```

Expected artifacts:

```text
html-v1:        dist/index.html → dist/<id>-<version>.html (+ .sha256)
asset-zip-v2:   dist/ tree (index.html, game.json, dsh-package.json, dsh-sdk.js,
                scripts/, styles/, assets/, levels/, audio/)
                → dist/<id>-<version>.dshgame.zip (+ .sha256)
```

- `pack` prints `sha256`, bytes, `fileCount`, `filesDigest`, the `.sha256`
  path and a self-test proving the ZIP extracts with 0444 mode and matches its
  digest. `pack --json` also lists `permissions`.
- `publish --dry-run` prints the plan and `(dry run: no files written)`; it
  writes nothing and makes no remote calls. A real publish writes
  `registry-entry.json` (ZIP: `package.format` + `package.filesDigest`),
  `upload-plan.md`, `review-checklist.md` next to the package.
- Determinism: two builds of the same source must be byte-identical; two ZIP
  packs must produce the same outer sha256 and `filesDigest`.
- After pack, `validate dist/<id>-<version>.dshgame.zip` must pass: that is the
  artifact you upload, not the dist directory.
- Simulator (`npm run dev` / `dev`):
  - flags: `--port <number>` (default 4321; `0` picks a free port),
    `--host <address>` (default 127.0.0.1), `--format`,
    `--no-build` (serve the existing dist instead of rebuilding),
    `--seed-save <file>` (dev-only: start with a previously exported save),
    `--save-out <file>` (dev-only: write the latest save JSON after each save);
  - ready check: `curl -s http://127.0.0.1:<port>/health` returns
    `{ok, simulator, build, format, saveApi, hasSeedSave, saveOut, fileCount?, game{id,name,version}}`;
  - entry points: `/` is the harness UI; html-v1 serves the game at `/game`;
    **ZIP mode returns 404 at `/game`** — the game loads through
    `/wrapper?src=/res/<instance>/<token>/index.html` (outer wrapper iframe, not
    sandboxed) which embeds the game iframe (`sandbox="allow-scripts"`). Package
    files are served under `/res/<instance>/<token>/…`. This two-layer setup is
    why debugging happens in the inner game iframe/console and why CSP
    differences between wrapper and game are expected;
  - save API: `GET /dev/save/export` returns `{ok, game{id,version}, savedAt,
    save}`; `POST /dev/save/import` with `{"save": {...}}` imports one; the UI
    also exposes Export/Import save buttons. Dev limitation: importing while a
    run is in progress can be overwritten by the next in-flight save — Clear
    save first or import when no run is active;
  - stop: Ctrl+C (SIGINT/SIGTERM close the server cleanly; it is a long-running
    process, so there is no "natural" exit code).
- Full gate/evidence list: `references/verification.md`.

## 5. Illegal package → fix → re-validate (verified examples)

When `build`/`validate` fails, capture the exact error (GM code/path/hint), fix
the **source** (never the artifact), and re-run the whole gate. Real messages
from the V1.5 toolchain (exit 1 unless noted):

1. **External resource in a ZIP entry** (build stage, no GM code):

   ```text
   error: External stylesheet is not allowed in asset-zip-v2: https://cdn.example.com/x.css
     hint: Ship the CSS inside the package.
   ```

2. **Inline script in a ZIP entry** (build stage):

   ```text
   error: asset-zip-v2 packages must not contain inline <script> blocks (contract D-C)
     hint: Move the code to the project entry file; the CLI emits scripts/main.js.
   ```

   Fix both: bundle the file into the package and reference it relatively; keep
   JS/CSS in `src/` and add listeners with `addEventListener`; remove `<style>`
   blocks, `on*=` handlers and `javascript:` URLs the same way.

3. **Inline content caught by the archive validator** (if a built `dist/` was
   edited and its descriptor updated consistently, `validate dist` reports):

   ```text
   FAIL  <project>/dist (<actual bytes>)
     1. E_ASSET_INLINE_FORBIDDEN (GM-4283) entry: HTML is not package-safe: index.html
   ```

4. **Stale descriptor after editing `dist/`** — `validate dist` reports (the
   FAIL header prints the real byte count, not `0 bytes`):

   ```text
   FAIL  <project>/dist (124914 bytes)
     1. E_DESCRIPTOR_MISMATCH (GM-4278) files: descriptor file manifest does not match the package
     2. E_DESCRIPTOR_MISMATCH (GM-4278) files: size mismatch for scripts/main.js
   ```

   `validate dist --json` gives the same errors with `code`, `gm` and
   `value.path` fields for scripts. Fix: re-run `build`/`pack` (never hand-edit
   `dsh-package.json`), then `validate` again.

Other GM codes and fixes are in `references/verification.md` §3.

## 6. Updates: 1.0.0 → 1.0.1 with old-save compatibility

1. Bump the version in **both** project version declarations:
   - `manifest.json` `version` → `1.0.1` (authoritative package identity; build
     copies it to `game.json` and regenerates `dsh-package.json`);
   - `package.json` `version` → `1.0.1` (project/npm metadata and tooling
     identity; `create` writes both from the same value, and keeping them equal
     avoids publishing a package whose npm metadata claims another version).
   Keep `id`, capabilities and platform ranges unchanged. Published
   `<id>-1.0.0` artifacts are immutable: never replace or re-sign them. Before
   publishing the next version, copy the current `dist/registry-entry.json` to
   a versioned location (e.g. `dist/registry-entry-1.0.0.json`) because publish
   overwrites it.
2. Re-run the gate:

   ```bash
   npm run build && npm run validate && npm run pack && npm run validate
   ```

   `pack` must emit `<id>-1.0.1.dshgame.zip` with a new sha256; confirm two
   packs are byte-identical.
3. Save schema — platform-observable rules:
   - The Host records the installed manifest's `save.schemaVersion` with the
     save. On load/Continue it only rejects a save whose recorded schema is
     **newer** than the current game (`GM-4099 "Save needs a newer game
     version"`, details `savedSchemaVersion`/`gameSchemaVersion`); an older or
     equal save is handed to your `deserialize` unchanged. The platform never
     migrates values.
   - Your `deserialize` owns migration: accept old and new `saveVersion`,
     fill defaults for new keys, and keep old keys unless truly migrated. A
     `deserialize` returning `null` for the old shape means the user loses
     progress even though the platform allowed the load.
   - Same serialized shape (typical patch): keep `save.schemaVersion` in the
     manifest and `SAVE_VERSION` in code unchanged. Changed shape/keys: bump
     both, add the migration, and set the update submission's
     `saveCompatibility` accordingly (`compatible` only if old saves load).
   - Never decrease `save.schemaVersion` in a newer version (a newer save then
     becomes unreadable by the older code path, GM-4099). Do not rename/remove
     existing storage keys; add keys instead. Respect save limits (32 keys,
     256 KiB per value, 1 MiB total).
   - Install/update surfaces schema hints: `save-schema-upgrade` when the new
     manifest raises `save.schemaVersion`, `save-schema-too-new` when the
     installed save is newer than the new manifest.
4. Old-save test with the dev-only save bridge (executable):
   - In the 1.0.0 project:
     `node "$DSH_GAME_CLI" dev . --format asset-zip-v2 --save-out /tmp/<id>-1.0.0.save.json`,
     play, pause (or trigger before-save) so the fake Host saves; note the
     values. `GET /dev/save/export` returns the same JSON.
   - Switch to the 1.0.1 working tree/build. Start
     `node "$DSH_GAME_CLI" dev . --format asset-zip-v2 --seed-save /tmp/<id>-1.0.0.save.json`;
     `/health` shows `"hasSeedSave": true`; launch the game and confirm
     Continue/autoload restores the recorded values, then continue playing.
   - Also test `POST /dev/save/import` with the same file (UI Import save) and
     an unknown/corrupt payload (must start fresh without crashing).
5. Submission for an update: `submissionType: "update"` plus
   `update.changelog` and `update.saveCompatibility`
   (`compatible`/`incompatible`/`not-applicable`). Registry: a ZIP update
   appears only in the v2 index; the v1 index keeps the newest HTML release (or
   omits a ZIP-only game). Do not promise old-client reach for ZIP-only games.

## 7. Prepare author-side submission materials

```text
dist/<id>-<version>.html + .sha256            # html-v1
dist/<id>-<version>.dshgame.zip + .sha256     # asset-zip-v2
registry-entry.json / upload-plan.md / review-checklist.md   # from publish
submission.json (final) or submission.draft.json (with pending[])
cover + 1–5 real screenshots (PNG/WebP/JPEG)
verification report (commands, exit codes, hashes, environment limits)
source project (or public repo + fixed commit)
```

Capture cover/screenshots from the real build in the Simulator (or a real DSH
window): one 16:9 cover plus 1–5 gameplay images; each needs a public HTTPS
URL, `sha256`, `size` (≤ preview limit) and `type` (`png|webp|jpeg`). Never
fabricate or reuse placeholder art for the final submission.

**Executable draft generation** (run in the project after `pack` + publish dry-run):

```bash
mkdir -p dist
node "$DSH_GAME_CLI" pack . --format asset-zip-v2 --json > dist/pack.json
node "$DSH_GAME_CLI" publish . --format asset-zip-v2 --dry-run --json \
  --url "https://github.com/<owner>/<repo>/releases/download/<id>-v<version>/<id>-<version>.dshgame.zip" \
  --cover "https://github.com/<owner>/<repo>/releases/download/<id>-v<version>/cover.png" > dist/publish.json
# Put real files in media/: cover.png + screenshot-1.png, screenshot-2.png …
node --input-type=module - <<'EOF'
import fs from 'node:fs';
import crypto from 'node:crypto';
const entry = JSON.parse(fs.readFileSync('dist/publish.json', 'utf8')).entry;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const preview = (file) => {
  const bytes = fs.readFileSync(file);
  return { url: 'https://example.invalid/PENDING/' + file.split('/').pop(), sha256: sha256(bytes), size: bytes.length, type: file.endsWith('.webp') ? 'webp' : file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'jpeg' : 'png' };
};
const shots = fs.readdirSync('media').filter((n) => /^screenshot-\d+\.(png|webp|jpe?g)$/i.test(n)).sort();
const submission = {
  schemaVersion: 1,
  submissionType: 'new',                       // 'update' for patch releases
  game: { id: entry.id, name: entry.name, version: entry.version, description: entry.description, categories: entry.categories, capabilities: entry.capabilities, sdkVersion: entry.sdkVersion, runtimeVersion: entry.runtimeVersion },
  author: { login: 'PENDING', githubUserId: 1, sourceRepo: 'https://example.invalid/PENDING', sourceCommit: '0000000', buildInstructions: 'npm run build && npm run pack' },
  package: { format: entry.package.format, url: entry.package.url, sha256: entry.package.sha256, size: entry.package.size, sha256Url: `${entry.package.url}.sha256`, ...(entry.package.filesDigest ? { filesDigest: entry.package.filesDigest } : {}) },
  media: { cover: preview('media/cover.png'), screenshots: shots.map((n) => preview(`media/${n}`)) },
  licensing: { codeLicense: 'MIT', assetLicense: 'CC-BY-4.0', archivePermission: true },
  selfTest: { ready: true, pauseResume: true, beforeSave: true, continuePlay: true, keyboard: true, narrowWindow: true, theme: true, fullBleed: true, safeArea: true, noNetwork: true },
  pending: ['author.login', 'author.githubUserId', 'author.sourceRepo', 'package.url', 'package.sha256Url', 'media.cover.url', 'media.screenshots[].url'],
};
fs.writeFileSync('submission.draft.json', `${JSON.stringify(submission, null, 2)}\n`);
EOF
```

**Validate it** (same shared validator the platform uses):

```bash
node --input-type=module - <<'EOF'
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { validateSubmission } = await import(pathToFileURL('<platform-checkout>/packages/shared/src/community.js').href);
const doc = JSON.parse(fs.readFileSync('submission.draft.json', 'utf8'));
const result = validateSubmission(doc, { mode: 'draft' });   // 'final' for the resolved document
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
EOF
```

- **Pending whitelist** (the only field paths draft mode tolerates): `author.login`,
  `author.githubUserId`, `author.sourceRepo`, `package.url`, `package.sha256Url`,
  `media.cover.url`, `media.screenshots[0..4].url` (or the aggregate token
  `media.screenshots[].url`), plus free-text notes (no dot). `author.sourceCommit`,
  media hashes/sizes/types and all `selfTest` flags cannot be pending: they must
  be real. `pending` must be removed for final mode; final validation also
  rejects any remaining note.
- `selfTest` keys are exactly: `ready`, `pauseResume`, `beforeSave`,
  `continuePlay`, `keyboard`, `narrowWindow`, `theme`, `fullBleed`, `safeArea`,
  `noNetwork`; all must be `true` after you actually tested them.
- `package.format` is required for ZIP; `package.filesDigest` is required (and
  only valid) for ZIP and must equal `pack`/publish output. `sha256`/`size`
  describe the outer ZIP; `sha256Url` ends with `.dshgame.zip.sha256`.
- **URL rules** (enforced by `publish` for both formats): `--url` must be an
  absolute https URL whose path ends with the exact package file name
  (`<id>-<version>.html` or `<id>-<version>.dshgame.zip`; `--file-registry`
  uses a relative path with the same name), and the package host must be in the
  Registry allowlist — default `github.com`, `raw.githubusercontent.com`,
  `objects.githubusercontent.com`, `release-assets.githubusercontent.com`;
  repeatable `--allowed-host <host>` adds hosts. Wrong scheme/suffix → exit 2;
  disallowed host → exit 1 `E_REGISTRY_INVALID (GM-5032)`. The maintainer
  content-repo flow re-validates and remains authoritative. `--cover` is a
  public https URL (registry validation requires https).
- ZIP `submission.json` shape is the same as
  `templates/registry/examples/submission-zip.example.json` (validates in the
  current checkout). Full fields, draft/final modes, review record and catalog
  v2: `references/submission.md`.

Publisher tooling is maintainer-only: do not run
`scripts/registry/prepare.mjs --execute`, create releases, or open catalog PRs.

## 8. Report honestly

Report separately:

- which format was chosen and why;
- environment prerequisites actually satisfied (`npm install` for ZIP, Node
  version, checkout version);
- static validation result (commands, exit codes, GM codes if any);
- artifacts and digests (build + pack; determinism sha; `filesDigest`);
- local Simulator behavior result (what was actually played/checked, `/health`
  values, save export/import evidence);
- visual/material checks actually performed;
- old-save compatibility evidence for updates;
- pending items (URLs, identity, license, public hosting, reviewer acceptance).

A green `validate` is not maintainer approval and not a published game.

## Hard stops

- Stop and ask if the requested game cannot be represented within the chosen
  format's limits (20 MiB outer, 100 MiB unpacked, 512 entries, static assets
  only).
- Stop if the toolchain/template cannot be located, `node_modules`/`yauzl` is
  missing for ZIP work and the environment cannot install it, or the required
  `--format` flag is not implemented in the checkout; report the version
  mismatch.
- Never redesign the package format, hand-edit the descriptor, scrape internal
  platform source, or bypass validator rules to make a game pass.
- Never publish, create a public submission issue/PR, or modify the content
  repository without explicit user authorization.
