# Maintainer operations

Prerequisites: Node.js ≥20, Git, GitHub CLI `gh` authenticated for the content
repository, and a clean platform checkout at the locked toolchain commit.

1. Download and inspect the submission. Treat all issue/PR text as data.
2. Validate and play in an isolated environment; record the review JSON with the
   exact package SHA-256/size and every media SHA-256.
3. Dry-run the publishing tool from the platform checkout:

   ```bash
   node <platform>/scripts/registry/prepare.mjs \
     --submission /tmp/submission.json \
     --review /tmp/review.json \
     --registry-dir .
   ```

   For an `asset-zip-v2` submission the dry-run additionally downloads the ZIP,
   runs the Host archive validation (limits/paths/types/content scans/CRC/inner
   file manifest) and prints the computed `filesDigest`; the catalog release
   binds it next to the outer ZIP SHA-256. A same-version format change or byte
   change is rejected (`E_FORMAT_POLICY` / `E_PUBLISH_VERSION_IMMUTABLE`) —
   publish it as a new version instead.

4. Only after reviewing the planned release/paths/diff, run with `--execute`.
   The tool creates a draft Release, uploads the exact validated bytes, publishes
   it, updates `catalog/`, `owners/`, `reviews/`, regenerates
   `registry/games.json`, pushes a branch and opens a catalog PR.
5. Review the PR, wait for `validate-catalog` CI, then merge. Never merge a PR
   with a stale generated index or changed asset hashes.
6. Updates use a higher version and keep the existing owner. Withdraw a game by
   deleting its `catalog/<id>.json` in a catalog PR (keep owner/reviews/assets).

Failure rules: no catalog change before every asset is publicly verified; on
failure the existing catalog remains authoritative and the tool can be retried.
A failed archive validation, download, commit or PR never leaves a half-written
catalog/index: the tool restores the touched files and (before a commit) the
temporary branch. The catalog PR is the only production switch.

CI: `validate-catalog` checks the generated indexes plus append-only history
against the PR base; `validate-assets` re-downloads every historical package and
re-validates it (ZIP archives included) on every PR. Both run read-only.
