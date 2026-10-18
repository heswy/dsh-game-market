# `scripts/cli` — zero-dependency developer CLI

```bash
node scripts/cli/dsh-game.mjs --help
node scripts/cli/create-dsh-game.mjs my-game --template vanilla
```

| File | Responsibility |
|---|---|
| `dsh-game.mjs` | CLI entry (`create/build/validate/pack/publish/dev`) |
| `create-dsh-game.mjs` | `create` alias entry (PRD §4.4) |
| `dev-server.mjs` | Local Runtime Simulator HTTP server |
| `lib/cli.mjs` | command parsing, help, exit codes, output |
| `lib/project.mjs` | deterministic single-file build (manifest/SDK/assets inline) |
| `lib/validator.mjs` | validate a package or project dir (shared validator + compatibility) |
| `lib/pack.mjs` | `<id>-<version>.html` + shasum-compatible `.sha256` |
| `lib/publish.mjs` | offline registry entry + upload plan + review checklist |
| `lib/create.mjs` | project generator (vanilla / react) |
| `lib/dev-harness.mjs` | fake Runtime page used by the simulator |
| `lib/issues.mjs` | `E_* → GM-*`, hints, human/JSON reports |
| `test/` | `node --test` coverage for the commands |

Design constraints:

- **Zero third-party dependencies**, Node ≥ 20 built-ins only.
- **Offline**: no fetch/HTTP calls (the dev server only listens on loopback).
- **Deterministic build**: fixed ordering/serialization, no timestamps, machine
  paths, random ids or sourcemaps; two builds → identical sha256.
- **Shared rules**: file/manifest/self-containment validation comes from
  `packages/shared/src/manifest.js`; Registry schema from
  `packages/shared/src/registry.js`; compatibility uses the Host semver helper.
- **Exit codes**: 0 ok · 1 validation/compat · 2 usage/config · 3 internal ·
  4 network (unused).

The root `package.json` `bin` entry for `npx dsh-game` is intentionally not
added here (root config is owned by the Lead); use the `node scripts/cli/...`
entry points in the meantime.

See `docs/developer-cli.md` for the full command reference and
`docs/developer-guide.md` for the tutorial.
