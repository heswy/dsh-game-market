# Package formats, manifest and SDK (author-facing summary)

Authoritative sources in the platform checkout (read them when this summary is
not enough — do not fork their rules):

- `docs/V1.5-CONTRACTS.md` §1, §3, §4, §7 (frozen package/archive/resource contract)
- `packages/shared/src/manifest.js` — V1 manifest/package validation
- `packages/shared/src/package-v2.js` — `asset-zip-v2` policy (descriptor, paths, types, content scan)
- `packages/host/src/zip.js` — real archive validation (the same code the Host
  install path and the CLI `validate`/`pack` use)
- `packages/sdk/src/index.d.ts` — public SDK types (the authoritative API surface)
- `packages/shared/src/errors.js` — GM error codes/messages
- `packages/shared/src/constants.js` — limits and timings
- `docs/developer-guide.md` — step-by-step tutorial

## 1. Which format?

V1.5 has **two package formats**. The format is part of the package identity:
it is never inferred from the version number and a given `<id>/<version>` can
never switch format.

| | `html-v1` | `asset-zip-v2` |
|---|---|---|
| Ship artifact | one self-contained `<id>-<version>.html` | one ZIP `<id>-<version>.dshgame.zip` |
| Content | HTML + inline script/style (SDK is inlined at build time) | real files: entry HTML + external `scripts/`, `styles/`, `assets/`, `levels/`, `audio/` |
| Store limits | single file ≤ 20 MiB | ZIP ≤ 20 MiB, unpacked ≤ 100 MiB, ≤ 512 entries |
| Inline script/style | allowed (single file) | **forbidden** (`GM-4283`) |
| Registry | v1 `/registry/games.json` | v2 `/registry/v2/games.json` (`package.format` required) |
| Choose when | tiny game, one file is enough, widest old-client reach | the game really uses separate JS/CSS/images/levels/audio files |

Decision rule for an AI author: **default to `asset-zip-v2` for any game with
more than a few hundred lines of JS, real art/audio or level data**; use
`html-v1` only when the user explicitly wants one file or the game is genuinely
small. A game cannot be half-inline: ZIP packages must externalize everything.

Environment prerequisite: ZIP `validate`/`pack` use the Host archive reader
(`yauzl@3.4.0` + `pend@1.2.0`), so run `npm install` in the platform checkout
first (see `SKILL.md` "Before you start"). On a clean checkout without
`node_modules`, ZIP `validate` and `pack` both exit 2 with the CLI error
`Missing toolchain dependency: …` and hint `Run npm install (or npm ci) at the
repository root, then retry.`; `--json` exposes
`error.code: "E_TOOLCHAIN_DEPS_MISSING"`. The toolchain never uses the network
at run time, and `html-v1` commands need no install.

Version rules:

- Game semantic version lives in `game.json.version` (strict semver subset, no
  `+build`); the package filename must be `<id>-<version>`.
- Package-envelope version is the descriptor's `formatVersion: 2`; it is NOT
  the game version and the two must never be used interchangeably.
- Switching `html-v1` → `asset-zip-v2` (or back) **requires a version bump**;
  the same `<id>/<version>` bytes are immutable forever.

## 2. `asset-zip-v2` package layout

```text
<id>-<version>.dshgame.zip
├── dsh-package.json        # descriptor (formatVersion: 2), NOT listed in files[]
├── game.json               # the only authoritative manifest (V1 manifest semantics)
├── index.html              # entry (path comes from descriptor "entry")
├── dsh-sdk.js              # SDK bundle placed by `pack`; load it before game code
├── scripts/main.js
├── styles/styles.css
├── assets/ship.webp
├── assets/pickup.ogg
├── levels/level-01.json
└── audio/…
```

Hard rules:

- `dsh-package.json` sits **only at the ZIP root**; it is never listed in
  `files[]` (its integrity is bound by the outer ZIP digest).
- No directory entries in the ZIP (directories are implied by paths).
- No `package.json`/build scripts/`node_modules`/nested archives/executables/
  symlinks/devices. The package is static front-end assets only.
- Exactly one manifest authority: `game.json`. Any HTML that also carries
  `<script type="application/json" id="dsh-game-manifest">` is rejected
  (`GM-4279`). `html-v1` keeps its inline manifest; ZIP never does.

### 2.1 `dsh-package.json` (descriptor)

```json
{
  "formatVersion": 2,
  "entry": "index.html",
  "gameManifest": "game.json",
  "files": [
    { "path": "dsh-sdk.js",   "size": 12345, "sha256": "<64 lowercase hex>" },
    { "path": "game.json",    "size":   612, "sha256": "<64 lowercase hex>" },
    { "path": "index.html",   "size":  1234, "sha256": "<64 lowercase hex>" },
    { "path": "scripts/main.js", "size": 8000, "sha256": "<64 lowercase hex>" }
  ]
}
```

- `formatVersion` MUST be `2`.
- `entry` MUST be a normalized relative POSIX path, end in `.html`, and appear
  in `files[]`.
- `gameManifest` MUST be exactly `game.json` (root only in V1.5).
- `files[]` MUST:
  - be ≥1 and ≤**511** entries (the descriptor itself is the 512th ZIP entry),
  - list every package file except the descriptor (missing or extra → `GM-4278`),
  - have `size` (unpacked bytes) and `sha256` matching the real bytes,
  - be sorted strictly ascending by path **UTF-8 byte order**,
  - never contain directories or `dsh-package.json` itself,
  - never contain `../`, absolute paths, drive letters, backslashes, empty
    segments, control characters, NUL, trailing spaces/dots, or Windows device
    names (`con`, `nul`, `aux`, `prn`, `com1`…).
- Unknown fields are allowed with an `x-` prefix; other unknown fields only
  warn (`W_DESCRIPTOR_UNKNOWN_FIELD`), they are not a rejection.
- Descriptor ≤ 256 KiB, UTF-8 without BOM.

Do not hand-edit `dsh-package.json`: `dsh-game build` writes it and
`dsh-game pack` zips it. A stale descriptor is the most common author error
(`GM-4278` missing/extra/size/sha mismatch).

### 2.2 Project layout and `dsh-game.config.json`

The generated project (not the package) keeps sources and build settings; only
`dist/` is what `pack` zips:

```text
<game-id>/
├── manifest.json          # manifest source (copied to dist/game.json; version bumped here)
├── index.html             # entry source (external <link>/<script> references)
├── dsh-game.config.json   # format + paths (generated by create)
├── src/                   # JS/CSS sources (built into dist/scripts, dist/styles, dsh-sdk.js)
├── assets/  levels/  audio/   # optional resource folders copied into dist/
├── scripts/               # local CLI wrappers: build/validate/pack/publish/dev
└── dist/                  # generated: package tree, descriptor, zip, .sha256, publish outputs
```

`dsh-game.config.json` is authoritative for the format when `--format` is not
passed. A vanilla ZIP project looks like:

```json
{
  "format": "asset-zip-v2",
  "manifest": "manifest.json",
  "template": "index.html",
  "entry": "src/main.js",
  "outDir": "dist",
  "resources": ["assets", "levels", "audio"]
}
```

- `resources` lists the top-level source folders copied verbatim into `dist/`
  (default `assets`, `levels`, `audio`). Files outside `src/`, `resources`,
  the manifest and the entry template are not packaged.
- The build rewrites entry references: `src/styles.css` → `styles/styles.css`
  (source CSS basename preserved), `src/main.js` → `scripts/main.js`, with
  `dsh-sdk.js` injected before game code. The generated README documents this
  and the wrapper CLI resolution order.
- Optional `"cli"` is a path to `dsh-game.mjs` used by the wrappers when
  `DSH_GAME_CLI` is not exported; the wrapper resolves `DSH_GAME_CLI` →
  `config.cli` → repository-template fallback. `create` deliberately writes no
  absolute `cli` path (portable projects), so export `DSH_GAME_CLI` (see
  `SKILL.md`).
- Do not commit `dist/`; it is generated. Re-running `create` over an existing
  project needs an explicit `--force` (check the template README).

## 3. `game.json` (manifest)

Same semantics as the V1 manifest (`manifestVersion: 1`), just stored as a file
instead of an inline script. Required: `manifestVersion`, `id`, `name`,
`version`, `author.name`, `description`, 1–3 `categories`, `capabilities`,
`sdkVersion`, `runtimeVersion`. Conditional: `save` when `storage` is declared;
`score` when `score` is declared. Optional: `preferredTheme`, `viewport`,
`repository`, `homepage`, `license`, `icon` (data URI png/webp/jpeg).

- Capabilities in V1.5 are exactly `storage` and `score`; there is no network,
  file-system or DSH API capability.
- `save.schemaVersion` is an integer ≥1; it is the author's save-schema
  contract, not the game version. Required when `storage` is declared
  (`save: { schemaVersion: 1 }`). The Host records it with every save:
  loading a save whose recorded schema is **newer** than the installed game's
  rejects with `GM-4099`; older/equal saves are passed to the game unchanged
  (the platform never migrates — your `deserialize` must). See
  `references/verification.md` §5 and `SKILL.md` §6.
- `score` is required when `score` is a capability: `{ min, max, direction?
  ("higher"|"lower"), integer? }`. Submitting outside the range rejects with
  `GM-4006` — handle it visibly.
- When `storage`/`score` is declared, the corresponding capability must be
  listed; capabilities are exactly `storage` and `score` in V1.5.
- `sdkVersion`/`runtimeVersion` must be satisfied by the platform the user is
  running (`^1.0.0` is the current V1/V1.5 range).
- The manifest must not contain `entry`/`cover`/`screenshots`: the entry comes
  from the descriptor, cover/screenshots live in the submission/registry.

## 4. SDK delivery in a ZIP package

A ZIP package has no "single file" carrier, so the SDK is shipped as **one file
inside the package**:

1. `pack` adds the platform SDK bundle as `dsh-sdk.js` (listed in `files[]` and
   covered by sha256) and guarantees it matches `game.json.sdkVersion`.
2. The entry HTML loads it with a package-relative script **before** game code:

   ```html
   <script src="dsh-sdk.js"></script>
   <script type="module" src="scripts/main.js"></script>
   ```

3. Platform and resource server never rewrite package bytes: the served entry
   is exactly the reviewed/sha256-bound file.
4. `game.runtime.assetUrl(relativePath)` exists for `asset-zip-v2` instances:
   it returns an absolute instance-resource URL for a package-relative path
   (e.g. `http://127.0.0.1:<port>/res/<instance>/<token>/levels/level-01.json`).
   Use it for assets loaded dynamically (or use relative `fetch('./levels/x.json')`,
   which also stays package-relative). Calling it from `html-v1` rejects with
   `GM-4043` (assets have no resource route there); a path escaping the
   instance resource prefix rejects with `GM-4039`.
5. `game.runtime.packageFormat` is `'asset-zip-v2'`/`'html-v1'`; on legacy
   Runtime builds it is `null`. `game.runtime.resourceBase` is the instance
   resource prefix (also `null` for `html-v1`). In the Simulator you can confirm
   they work by watching `/res/<instance>/<token>/…` requests return 200 in the
   network panel.

Typical dynamic resource loading in a ZIP game:

```js
const game = DSH_GAME_SDK.createGameSDK();
await game.ready();

// Relative fetch stays inside the package (served from the instance resource origin).
const level = await (await fetch('./levels/level-01.json')).json();

// assetUrl() is the supported way to build a URL you pass to APIs that need an
// absolute URL (Audio, Image, fetch with a computed name).
const audio = new Audio(game.runtime.assetUrl(`audio/${level.audio}.wav`));
audio.play().catch(() => {}); // play after a user gesture; handle rejection visibly
```

The SDK lifecycle (`ready`, `pause`/`resume`, `before-save`, storage/score) is
unchanged between the two formats.

## 5. Forbidden content (validator-enforced; CSP is the real runtime boundary)

Everything below is a **creator-time rule** (`GM-4280` / `GM-4283`). It exists
so a package is portable and auditable; the actual network boundary is the
Runtime CSP (see §7). Never treat static scanning as a security guarantee.

All package HTML/CSS/JS/SVG:

- No `<base>`, no `<iframe>`.
- No external URL in `src`/`href`/`@import`/`url()`: `http:`, `https:`,
  protocol-relative `//host/…`.
- No absolute package paths (`/assets/x.png`) — use relative `./x`/`x/y`.
- No `eval(`, no `new Function(`, no `serviceWorker`, no `window.open(`.
- No remote or `data:` `fetch()` / dynamic `import()`; package-relative
  `fetch('./x.json')`, `import('./mod.js')` are allowed.

`asset-zip-v2` additionally (`GM-4283`, stricter than `html-v1`):

- No inline `<script>` block (every script needs `src`), no inline `<style>`
  block, no inline event handler attribute (`onclick=`, `onerror=`…), no
  `javascript:` URL.
- Style attributes (`style="…"`) are fine; only inline `<style>` blocks and
  handlers are forbidden.
- SVG is authorized as an **image** but is still an executable document if
  navigated to: inline SVG must not contain `<script>`, `javascript:` or `on*=`.

## 6. Limits (`asset-zip-v2`)

| Item | Limit | Violation |
|---|---|---|
| Outer ZIP bytes | ≤ 20 MiB (20,971,520) | `GM-4272` |
| Unpacked total | ≤ 100 MiB | `GM-4272` |
| ZIP entries (descriptor included) | ≤ 512 → `files[]` ≤ 511 | `GM-4272` |
| One file, unpacked | ≤ 20 MiB | `GM-4272` |
| One file, compressed | ≤ 20 MiB | `GM-4272` |
| Compression ratio | ≤ 100:1 whole and per entry | `GM-4272` |
| Path length / depth | ≤ 240 code points / ≤ 12 segments | `GM-4273` |
| Descriptor / `game.json` | ≤ 256 KiB / ≤ 64 KiB | `GM-4277` / `GM-4228` |
| Archive methods | only Stored (0) and Deflate (8) | `GM-4271` |
| Encryption, multi-disk, ZIP64, nested archives, symlinks, devices | not supported | `GM-4271` |

`html-v1` keeps its V1 limits: one UTF-8 HTML file ≤ 20 MiB, inline manifest
≤ 64 KiB.

### 6.1 Allowed resource files and MIME types

Only these extensions are accepted in an `asset-zip-v2` package
(`ALLOWED_ZIP_EXTENSIONS` in `packages/shared/src/package-v2.js`); anything else
is rejected as an unsupported asset type (`GM-4280`/`GM-4271`):

| Type | Extensions | Notes |
|---|---|---|
| document | `.html` | every HTML file is validated with the same rules |
| script | `.js`, `.mjs` | external only; no inline script blocks |
| style | `.css` | external only; no inline `<style>` blocks |
| image | `.png`, `.webp`, `.jpeg`, `.jpg`, `.gif`, `.svg` | SVG is an executable document: no `<script>`, `on*=`, `javascript:` |
| audio | `.ogg`, `.mp3`, `.wav`, `.m4a` | must be triggered by a user gesture where the runtime requires it |
| font | `.woff2`, `.woff` | bundle locally; no web-font CDNs |
| data | `.json`, `.txt`, `.csv` | levels/config/manifests; fetched relatively |

There is **no level-JSON schema**: `levels/*.json` is author-defined data
(the template shows `level`, `spawnIntervalMs`, `speed` fields only as an
example). The platform validates extension, size, path and content-scan rules,
not your schema; keep the game robust when a level file is missing/corrupt.

### 6.2 Reading package data

Prefer package-relative `fetch('./levels/level-01.json')` or
`game.runtime.assetUrl('levels/level-01.json')` when the API needs an absolute
URL. Do not hard-code `http://127.0.0.1:<port>/…`: ports/tokens are per instance
and absolute resource URLs are rejected by the author-time validator. `data:`
URLs are allowed only for whitelisted image/audio locations, never for `fetch`.

## 7. Runtime CSP and resource origin (what "no network" really means)

- The platform loads a ZIP game from an isolated loopback **resource origin**;
  the entry document is served with a strict CSP whose `connect-src`,
  `script-src`, `style-src`, `img-src`, `media-src` and `font-src` only allow
  that resource origin. Any other origin/scheme is blocked by the browser.
- Package-relative reads are normal `fetch`/`import`/`<img>`/`<audio>` between
  package files on that origin; this is allowed and expected for multi-resource
  games. "No network" means **no package-external network** — not "no fetches".
- Do not rely on absolute resource-origin URLs: they are tied to one instance
  and rejected by the author-time validator. Always use relative paths (or
  `assetUrl()` for dynamic URLs).
- Opening a second package-relative HTML document is allowed, but that document
  must follow the same rules (all HTML files are validated); do not use a
  "second page" to smuggle external references.
- `html-v1` keeps its V1 CSP (`'unsafe-inline'` for the single file, no
  external resources); its package is validated by the V1 self-contained check.

## 8. SDK API surface and error handling (author-facing)

`packages/sdk/src/index.d.ts` is authoritative; the template shows the usage
pattern. In V1.5 the public surface is:

- `const game = DSH_GAME_SDK.createGameSDK(); await game.ready();` — resolves
  with `game.runtime` (`sdkVersion`, `runtimeVersion`, `gameId`, `gameVersion`,
  `locale`, `theme: 'light'|'dark'`, `reducedMotion`, `capabilities`,
  `launchMode: 'start'|'resume-paused'`, `viewport{width,height,dpr}`,
  `packageFormat`, `resourceBase`, `assetUrl()`). Before `ready()` resolves,
  `runtimeVersion` is `null`.
- `game.storage.save(key, value)` → `{key, bytes, revision, updatedAt}`;
  `load` → `{key, data, revision, updatedAt} | null`; `remove` →
  `{key, removed, revision}`. Limits: 32 keys, 256 KiB/value, 1 MiB total;
  values must be JSON-serializable (`GM-4131/4132/4133/4134`). Concurrent writes
  may reject with `GM-4092` (revision conflict) — reload/retry, do not assume.
- `game.session.start()` → `{playSessionId, startedAt, adopted}`;
  `end({outcome, score})` → `{playSessionId, startedAt, endedAt, outcome, score,
  ignored}` (`GM-4033` if no Agent Session is bound).
- `game.score.submit(score, meta)` → `{best, isBest, submittedAt}`;
  `getBest()` → `{score, achievedAt, meta} | null`. Out-of-range rejects with
  `GM-4006`; handle it visibly (do not swallow).
- `game.lifecycle.on('pause'|'resume'|'hidden'|'visible'|'before-save', handler)`;
  `before-save` carries `{reason, deadlineMs}` — finish/answer quickly
  (production deadline 1500 ms; the Simulator advertises 800 ms) and never
  throw; a timeout is treated as a save failure (`GM-5021/5022`).
- `game.agent.getStatus()` / `on('status', …)` — Agent state feed; display it,
  do not parse localized labels.
- `game.onError(handler)` / `game.isGameError(value)` — every rejected SDK
  promise rejects with `GameError {code, message, retryable, details}`.
- Capability/package errors are visible: `GM-4031` (not ready), `GM-4032`
  (capability denied — missing manifest capability), `GM-4041` (save not
  found), `GM-4043` (asset not found on html-v1), `GM-4099` (save schema too
  new: platform shows the save-corrupt card; authors must not create this by
  decreasing `save.schemaVersion`). The platform's own runtime error card covers
  package/load/iframe failures; the game is responsible for its own error
  state (ready failure must never be a white screen) and for not swallowing
  rejections.
