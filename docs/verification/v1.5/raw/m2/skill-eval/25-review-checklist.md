# Review checklist — Token Trail (token-trail@1.0.1)

## Automated checks (run by `dsh-game publish`)

- [x] Package validates as a single-file, self-contained HTML package.
- [x] Inline manifest parses and matches manifest v1.
- [x] `id` / `version` are valid and match the package file name (`token-trail-1.0.1.dshgame.zip`).
- [x] Runtime/SDK ranges are compatible with the current platform (1.0.0).
- [x] Size 147769 bytes is within the 20 MiB limit.
- [x] SHA-256 matches the `.sha256` sidecar: `29a3f8a5361946c3e2ce7bca77b56f61f4c4fab57e1333a3e1000f67fa1d167a`.
- [x] Registry entry validates against the V1 Registry schema.
- [x] No manifest warnings.
- [x] SHA-256 sidecar file name matches the package.

## Manual review

- [ ] I have the rights to publish all code, art, audio and names in this package.
- [ ] Gameplay works with keyboard only and with a pointer where applicable.
- [ ] `ready` failure shows a visible error state (no white screen).
- [ ] Pause / resume / hidden / visible / before-save are handled and autosave restores state (Continue).
- [ ] Score submission handles `GM-4006` (out of range) visibly.
- [ ] Canvas focus, `Tab` leaving the canvas and window resize behave (actual canvas size, DPR ≤ 2).
- [ ] The background fills the viewport without an outer frame; critical HUD/controls avoid the top 112px band and bottom-right 96×96 button area.
- [ ] Expanded Agent messages (bottom-right 254×184) cannot hide the only required control.
- [ ] No network access, external fonts, CDNs or remote images are used.
- [ ] Text is available in `zh` and `en`; `src/i18n.js` covers all visible strings.
- [ ] The description and categories are accurate; the cover image is licensed and https.
- [ ] Light and dark themes and reduced motion were checked inside DSH.
- [ ] The package was installed from the Market in a clean profile and played for 5 minutes.
- [ ] Uninstall keeps saves unless data deletion was explicitly requested.

## Entry under review

```json
{
  "id": "token-trail",
  "name": "Token Trail",
  "version": "1.0.1",
  "description": "Collect glowing tokens while dodging rocks. A short keyboard arcade run.",
  "author": {
    "name": "Independent Author"
  },
  "categories": [
    "arcade"
  ],
  "capabilities": [
    "storage",
    "score"
  ],
  "sdkVersion": "^1.0.0",
  "runtimeVersion": "^1.0.0",
  "preferredTheme": "game-defined",
  "package": {
    "url": "https://github.com/independent-author/token-trail/releases/download/token-trail-v1.0.1/token-trail-1.0.1.dshgame.zip",
    "sha256": "29a3f8a5361946c3e2ce7bca77b56f61f4c4fab57e1333a3e1000f67fa1d167a",
    "size": 147769,
    "releasedAt": "2026-10-20T07:37:52Z",
    "format": "asset-zip-v2",
    "filesDigest": "def50059c425af29fb02b68b87d70140cef8f04c352ddb5879feb8f2b3ae94e1"
  },
  "cover": "https://raw.githubusercontent.com/independent-author/token-trail/main/media/cover-1.0.1.png",
  "publishedAt": "2026-10-20T07:37:52Z",
  "updatedAt": "2026-10-20T07:37:52Z"
}
```
