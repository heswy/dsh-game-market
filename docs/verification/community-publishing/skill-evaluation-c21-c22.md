# Independent Skill evaluation · C-21 / C-22

Evaluator: independent subagent `d2119578-6f1d-46f6-9fbc-1e1346981507` (read-only
platform checkout, work confined to `/tmp/dsh-c21-c22`). Raw evidence is archived
under `artifacts/skill-eval/c21-c22/`.

## C-21 · invalid package → repair → re-validate

Project: `c21-invalid` (Vanilla, generated through the Skill's documented
positional-id CLI; `DSH_GAME_CLI` used). Two independent breakages were applied:

1. duplicate inline manifest → validator exit 1:
   `E_PKG_MANIFEST_DUPLICATE (GM-4221)`.
2. external `<script src="https://cdn.example.com/x.js">` → validator exit 1:
   `E_PKG_ENTRY_NOT_SELF_CONTAINED (GM-4225)` with inline-all-resources hint.

Repair using Skill guidance only: `npm run build` → `npm run validate` → `npm run
pack` all exit 0; second build byte-identical; packed
`c21-invalid-1.0.0.html` = 108,202 bytes, sha256
`6af1eb530dce0a5b9f4cee8269ddf5c740c3b2e1e3ca6c85814c10948bda7cb9`;
`shasum -a 256 -c` OK; packed-file validation OK.

Evidence: `artifacts/skill-eval/c21-c22/c21/logs/` (commands.tsv + logs) and
`.../c21/artifacts/*.html` (the two rejected packages).

## C-22 · 1.0.0 → 1.0.1 update with save compatibility

Update: `c21-invalid@1.0.1` with a small UI/badge change, same `saveVersion`/save
schema. `npm run build` / `validate` / `pack` exit 0; packed 1.0.1 = 108,589 bytes,
sha256 `4d6e30b691feeeb90f1a79d39e7fc637a86e7f70ea7c9ddb20d206ba21c29d49`;
`.sha256` check OK, packed-file validation OK.

Save compatibility (Local Runtime Simulator + headless Chrome, classification
**locally-simulated**, not a real DSH Host install): inject the exact 1.0.0 save
into the 1.0.1 build → Continue offered → save survived with the same score/lives,
time advanced, saveVersion/shape stable; no console errors and no external
requests. All checks in `save-compat-replay-evidence.json` are true.

Evidence: `artifacts/skill-eval/c21-c22/c22/logs/`, `save-1.0.0.json`,
`save-1.0.1-after-continue.json`, `save-compat-evidence.json`,
`save-compat-replay-evidence.json`, `shots/`.

## Honest limits

- Both scenarios are independent and use the real CLI/validator/simulator, but
  they are still local: no real public hosting, GitHub identity, maintainer
  review, Release or DSH Host install happened.
- The full real-time 120 s finish path and the Host's GM-4006 install-rejection
  path are still not independently exercised here.
- M4 external configuration remains pending (see the main verification README).
