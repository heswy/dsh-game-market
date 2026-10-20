# Author submission contract (V1.5, both formats)

Validator: `<platform-checkout>/packages/shared/src/community.js`
(`validateSubmission`, `validateReview`). Example shapes:
`<platform-checkout>/templates/registry/examples/submission.example.json`
(HTML) and `submission-zip.example.json` (ZIP, validates in the current
checkout in both draft and final modes). Full contract:
`docs/community-publishing-contracts.md` §2, plus `docs/V1.5-CONTRACTS.md` §5
for the two-generation registry.

## 0. How to generate and validate it (executable)

`SKILL.md` §7 contains a runnable generator that reads
`dist/publish.json` (`publish --dry-run --json`), `manifest.json` and
`media/cover.png` + `media/screenshot-*.png`, writes `submission.draft.json`,
and a one-liner that calls the shared validator. Minimal workflow:

1. `pack --json` and `publish --dry-run --json` (no files written by dry-run;
   redirect the JSON to `dist/publish.json`).
2. Capture real media files; the generator computes `sha256`/`size`/`type`.
3. Generate the draft with `pending[]` for the remote-only fields.
4. Validate with `validateSubmission(doc, { mode: 'draft' })`.
5. Replace placeholders + remove `pending[]`; validate again with
   `{ mode: 'final' }`; then hand it to the maintainer flow.

Draft mode only tolerates these pending field paths (everything else must be
real): `author.login`, `author.githubUserId`, `author.sourceRepo`,
`package.url`, `package.sha256Url`, `media.cover.url`,
`media.screenshots[0..4].url` (aggregate token `media.screenshots[].url` also
works), plus free-text notes. `author.sourceCommit`, all media
`sha256`/`size`/`type` and every `selfTest` flag cannot be pending.

## 1. `submission.json` (schemaVersion 1)

Common fields (both formats):

- `submissionType`: `new` | `update`.
- `game`: `id`, `name` (≤64), `version` (strict semver subset), `description`
  (≤280), 1–3 `categories`, optional `tags` (≤8), `capabilities` (exactly
  `storage`/`score`), `sdkVersion`, `runtimeVersion`, optional
  `license`/`repository`/`homepage` (https).
- `author`: GitHub `login`, **numeric** `githubUserId`, public `sourceRepo`
  (https), fixed `sourceCommit` (7–40 hex, the commit that built the bytes),
  `buildInstructions` (≤4000), optional `contact`.
- `media`: one `cover` + 1–5 `screenshots`; each needs public HTTPS `url`,
  `sha256` (64 lowercase hex), `size` (≤ preview limit) and `type`
  (`png|webp|jpeg`). Real gameplay imagery only; cover recommended 16:9.
- `licensing`: `codeLicense`, `assetLicense`, `archivePermission: true`,
  optional `notes` (≤2000).
- `selfTest` (exactly these keys, all `true` after really testing): `ready`,
  `pauseResume`, `beforeSave`, `continuePlay`, `keyboard`, `narrowWindow`,
  `theme`, `fullBleed`, `safeArea`, `noNetwork`. Unknown keys are rejected.
- `update` (required when `submissionType` is `update`): `changelog` (≤2000),
  `saveCompatibility` (`compatible` | `incompatible` | `not-applicable`),
  optional `breakingChanges` (string; `breakingNotes` is not a field).

Package block per format:

```jsonc
// html-v1
"package": {
  "format": "html-v1",                        // optional; absent means html-v1
  "url": "https://…/<id>-<version>.html",     // MUST end with <id>-<version>.html
  "sha256": "<64 lowercase hex>",
  "size": 123783,
  "sha256Url": "https://…/<id>-<version>.html.sha256"
}

// asset-zip-v2
"package": {
  "format": "asset-zip-v2",                   // REQUIRED for ZIP
  "url": "https://…/<id>-<version>.dshgame.zip", // MUST end with .dshgame.zip
  "sha256": "<64 lowercase hex>",             // outer ZIP bytes
  "size": 640000,                             // outer ZIP bytes; ≤ 20 MiB
  "sha256Url": "https://…/<id>-<version>.dshgame.zip.sha256",
  "filesDigest": "<64 lowercase hex>"         // canonical files[] digest (required for ZIP)
}
```

- `sha256`/`size` always describe the **outer artifact** (HTML bytes or ZIP
  bytes), never an unpacked directory.
- `filesDigest` is the canonical digest of the descriptor `files[]` array (the
  same value the Host installation record stores). Take it from `dsh-game pack`
  output or `publish --json` → `entry.package.filesDigest`; do not compute it by
  hand. Public documents use the name **`filesDigest`**; the Host reader's
  internal return field `fileManifestDigest` is a legacy internal name for the
  same value — never use it in a submission.
- URL checks: submission validation requires absolute https URLs and the exact
  `<id>-<version>.<ext>` / `.sha256` suffixes. `publish` (both formats) also
  enforces the Registry package-host allowlist — defaults `github.com`,
  `raw.githubusercontent.com`, `objects.githubusercontent.com`,
  `release-assets.githubusercontent.com`; repeatable `--allowed-host <host>`
  adds hosts; a disallowed host fails with `E_REGISTRY_INVALID (GM-5032)`.
  The content-repo/maintainer flow re-validates and is authoritative.
- `publish --registry-dir` is not wired for ZIP (exit 2); hand
  `registry-entry.json` to the maintainer flow instead of writing the content
  repository yourself.
- ZIP `submission.json` shape is identical to
  `templates/registry/examples/submission-zip.example.json`.

## 2. Draft vs final

If GitHub identity or public HTTPS hosting is not available yet, deliver
`submission.draft.json`: leave remote fields empty/placeholder and list the
field paths in `pending[]`. Validate with
`validateSubmission(draft, { mode: 'draft' })`. A **final** submission must
resolve every pending field (final validation also rejects any remaining
free-text pending note). Do not invent URLs, identity or media hashes; use
`pending[]` until they are real.

## 3. Review record (maintainer-owned, author must not fabricate)

Publishing requires `reviews/<id>/<version>.json` with `decision: "approved"`
bound to the exact `gameId`, `version`, `sourceCommit`, `package.sha256` +
`package.size`, `media.coverSha256` + `media.screenshotSha256s[]`, reviewer
GitHub identity (`login`/`githubUserId`), `reviewedAt` and at least one
`testEvidence` entry (optionally `source.issueUrl`/`source.prUrl`). For ZIP
releases the review binds the outer archive; if ANY package or media byte
changes, the approval is invalid and review must be repeated. Authors never
write approvals.

## 4. Catalog v2 release (maintainer publishing; author-facing shape)

Content-repo `catalog/<id>.json` is `schemaVersion: 2` with append-only
`releases[]`:

```jsonc
{
  "schemaVersion": 2,
  "gameId": "<id>",
  "owner": { "login": "…", "githubUserId": 123456 },
  "game": { /* display/compat fields, same as V1 catalog */ },
  "releases": [{
    "version": "1.0.1",
    "format": "asset-zip-v2",                 // required: html-v1 | asset-zip-v2
    "tag": "<id>-v1.0.1",
    "package": {
      "url": "https://…/<id>-1.0.1.dshgame.zip",
      "sha256": "<64 lowercase hex>",
      "size": 640000,
      "filesDigest": "<64 lowercase hex>"     // asset-zip-v2 only (expected)
    },
    "media": { "cover": { "url": "https://…" }, "screenshots": [ { "url": "https://…" } ] },
    "sourceCommit": "<7–40 hex>",
    "reviewSha256": "<64 lowercase hex>",
    "releasedAt": "2026-10-20T00:00:00.000Z"
  }],
  "withdrawnAt": null,
  "createdAt": "…",
  "updatedAt": "…"
}
```

Projection (done by maintainer tooling, not the author):

- `/registry/games.json` (`registryVersion: 1`): only `html-v1` releases; the
  highest such version. A game whose newest release is ZIP keeps its last HTML
  version in the v1 index, or is absent from v1 if it never had an HTML release.
- `/registry/v2/games.json` (`registryVersion: 2`): the highest version of any
  format, each entry explicitly carries `package.format` and (ZIP) optional
  `filesDigest`.
- Withdrawing (`withdrawnAt`) removes the game from both indexes; catalog,
  reviews and published assets stay as immutable audit history.
- Immutability: a published `<id>/<version>` byte set can never change; a
  format switch requires a version bump; versions never go backwards.
- Old content repos with `schemaVersion: 1` catalogs are still read (upgraded
  in memory), so authors of existing HTML games keep working.

## 5. Hand-off boundary

Author-side: package + `.sha256`, `publish` outputs (`registry-entry.json`,
`upload-plan.md`, `review-checklist.md`), submission JSON (final or draft with
`pending[]`), real cover/screenshots, public source repo + fixed commit,
reproducible build instructions, verification report.

Maintainer-only: content-repo writes, catalog/review files, release creation,
catalog PR, `scripts/registry/prepare.mjs --execute`.
