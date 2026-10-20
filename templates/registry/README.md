# DSH Game Market · Community Registry (content repository template)

This repository is the **content and operations repository** for DSH Game Market
community games. The platform repository owns all validators and publishing
tools; this repository owns catalog data, ownership, review records and the
generated runtime index.

- Platform: `__PLATFORM_REPO__`
- Toolchain commit: `__PLATFORM_COMMIT__`
- Initialised for platform version: `__PLATFORM_VERSION__`
- Runtime sources for clients (both generated, do not edit by hand):
  - `registry/games.json` — Registry v1 (`registryVersion: 1`), **HTML only**;
    the only index an old (pre-1.5) client reads;
  - `registry/v2/games.json` — Registry v2 (`registryVersion: 2`), HTML and
    `asset-zip-v2` packages with an explicit `package.format`; the V1.5 Host
    reads this one first and falls back to the v1 index while a content
    repository has not regenerated the v2 projection yet.

Layout:

```text
catalog/<id>.json                 current listed versions (source record)
owners/<id>.json                  stable numeric GitHub owner identity
reviews/<id>/<version>.json       approved review bound to exact package/media hashes
registry/games.json               generated Registry v1 index (commit it)
registry/v2/games.json            generated Registry v2 index (commit it)
toolchain.lock.json               trusted platform tool commit
.github/                          issue form, PR template, read-only CI
```

Catalog records have two shapes; both project into the two indexes:

- `schemaVersion: 1` — V1.2 shape, a single `release` (HTML only). Existing
  repositories keep working unchanged; a publish replaces the record.
- `schemaVersion: 2` — V1.5 shape with an append-only `releases[]` array and an
  optional `withdrawnAt`. Every release carries `format` (`html-v1` |
  `asset-zip-v2`), the package URL/sha256/size (+ optional `filesDigest`),
  media, `sourceCommit` and `reviewSha256`. Old releases are immutable: a fix
  or a format change is a **new version**, never an edit. See
  `examples/catalog-v2.example.json`.

Projection rule (shared by the platform tooling and CI): v2 uses the newest
release of any format; v1 uses the newest **HTML** release, or omits the game
when it has no HTML release at all. Withdrawing a game (`withdrawnAt` set while
keeping owner/review audit files) removes it from both indexes.

Maintainer workflow: see `OPERATIONS.md`. Contributor workflow: see
`CONTRIBUTING.md` and `.github/ISSUE_TEMPLATE/submit-game.yml`.

Generation/validation (run from this repository, with the platform checkout at
the locked commit):

```bash
node <platform>/scripts/registry/generate-catalog.mjs --registry-dir .   # writes both indexes
node <platform>/scripts/registry/validate-catalog.mjs --registry-dir .   # --check + history rules
```
