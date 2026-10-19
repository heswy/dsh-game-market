# Author submission contract

Validator: `<platform>/packages/shared/src/community.js`
(`validateSubmission`, `validateReview`). Production example shape:
`<platform>/templates/registry/examples/submission.example.json`.

## `submission.json` (schemaVersion 1)

- `submissionType`: `new` or `update`.
- `game`: `id`, `name`, `version`, `description`, 1–3 `categories`, optional
  `tags`, `capabilities`, `sdkVersion`, `runtimeVersion`, license/repo/homepage.
- `author`: GitHub `login`, **numeric** `githubUserId`, public `sourceRepo`,
  fixed `sourceCommit` (7–40 hex), `buildInstructions`, optional contact.
- `package`: public HTTPS URL ending `<id>-<version>.html`, SHA-256, byte size,
  and `.sha256` URL.
- `media`: `cover` + 1–5 screenshots; each has HTTPS URL, SHA-256, byte size and
  type `png|webp|jpeg`. Cover is recommended 16:9; use real gameplay imagery.
- `licensing`: code license, asset license/source, `archivePermission: true`.
- `selfTest`: every flag must be `true` (ready, pauseResume, beforeSave,
  continuePlay, keyboard, narrowWindow, theme, fullBleed, safeArea, noNetwork).
- `update` (required for updates): changelog, save compatibility, breaking notes.

Missing fields are field-level errors. Do not include reviewer approval in the
submission; approval is a separate maintainer review bound to the exact hashes.

## Author-side output

Provide the package + `.sha256`, submission JSON, real cover/screenshots, source
commit and a verification report. If public hosting/identity/license is missing,
mark it pending. Maintainer review and catalog publishing are out of scope for
the author.
