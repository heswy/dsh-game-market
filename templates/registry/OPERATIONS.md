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
The catalog PR is the only production switch.
