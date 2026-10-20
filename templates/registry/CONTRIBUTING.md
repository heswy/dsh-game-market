# Contributing a game

1. Build a package and a matching `.sha256`, plus a real cover (16:9
   recommended) and 1–5 real screenshots. Two package formats are accepted:
   - `html-v1`: a single self-contained `<id>-<version>.html` (V1 behaviour); or
   - `asset-zip-v2`: a `<id>-<version>.dshgame.zip` with `dsh-package.json`,
     root `game.json`, static assets and the SDK file (no inline scripts/styles,
     no external URLs, no installation scripts).
   Declare the format in the submission; changing an already published game
   from HTML to ZIP requires a **new version** (never the same one).
2. Self-test (ready, pause/resume, before-save, Continue, keyboard, narrow window,
   light/dark theme, full-bleed + safe areas, no external network).
3. Open the “Submit a game” Issue Form, or a profiling PR with the same data.
4. A maintainer downloads and validates your exact bytes, plays it in an
   isolated environment, and records an approval bound to package/media hashes.
5. Only the maintainer publishing PR changes the market catalog. Merging the
   catalog PR is what makes the game visible.

You do not need write access to this repository for a normal submission. Never
upload a different file after review: the approval is bound to the exact SHA-256
and byte size. A changed package requires a new version and a new review.
