# DSH Game Market · Community Registry (content repository template)

This repository is the **content and operations repository** for DSH Game Market
community games. The platform repository owns all validators and publishing
tools; this repository owns catalog data, ownership, review records and the
generated runtime index.

- Platform: `__PLATFORM_REPO__`
- Toolchain commit: `__PLATFORM_COMMIT__`
- Initialised for platform version: `__PLATFORM_VERSION__`
- Runtime source for clients: `registry/games.json` (generated, do not edit by hand)

Layout:

```text
catalog/<id>.json                 current listed version (source record)
owners/<id>.json                  stable numeric GitHub owner identity
reviews/<id>/<version>.json       approved review bound to exact package/media hashes
registry/games.json               generated runtime index (commit it)
toolchain.lock.json               trusted platform tool commit
.github/                          issue form, PR template, read-only CI
```

Maintainer workflow: see `OPERATIONS.md`. Contributor workflow: see
`CONTRIBUTING.md` and `.github/ISSUE_TEMPLATE/submit-game.yml`.

Generation/validation (run from this repository, with the platform checkout at
the locked commit):

```bash
node <platform>/scripts/registry/generate-catalog.mjs --registry-dir .
node <platform>/scripts/registry/validate-catalog.mjs --registry-dir .
```
