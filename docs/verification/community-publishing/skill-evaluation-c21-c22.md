# Independent Skill evaluation · C-21 / C-22

Evaluator: independent subagent `d2119578-6f1d-46f6-9fbc-1e1346981507` (read-only
platform checkout, work confined to `/tmp/dsh-c21-c22`). Raw evidence is archived
under `artifacts/skill-eval/c21-c22/`.

## C-21 · invalid package → repair → re-validate

Project: `c21-invalid` (Vanilla, generated through the Skill's documented
positional-id CLI; `DSH_GAME_CLI` used). Independent breakages were applied:

1. invalid manifest `score.min=900 > score.max=100` → build exit 1:
   `E_PKG_SCORE_RANGE (GM-4243)`.
2. external `<script src="https://cdn.example.com/x.js">` → build/validate exit 1:
   `E_PKG_ENTRY_NOT_SELF_CONTAINED (GM-4225)` with inline-all-resources hint.
3. duplicate inline manifest in the built package → validate exit 1:
   `E_PKG_MANIFEST_DUPLICATE (GM-4221)`.

Repair using Skill guidance only: `npm run build` → `npm run validate` → `npm run
pack` all exit 0; three consecutive builds byte-identical; packed
`c21-invalid-1.0.0.html` = 108,202 bytes, sha256
`6af1eb530dce0a5b9f4cee8269ddf5c740c3b2e1e3ca6c85814c10948bda7cb9`;
`shasum -a 256 -c` OK; packed-file validation OK.

Evidence: `artifacts/skill-eval/c21-c22/c21/logs/` (commands.tsv + logs) and
`.../c21/artifacts/*.html` (the two rejected packages).

## C-22 · 1.0.0 → 1.0.1 update with save compatibility

Update: `c21-invalid@1.0.1` (manifest+package version bump, visible v1.0.1 badge,
score values 10→12 / 25→30) with the same `saveVersion`/save schema. `npm run build`
/ `validate` / `pack` exit 0; packed 1.0.1 = 108,589 bytes, sha256
`4d6e30b691feeeb90f1a79d39e7fc637a86e7f70ea7c9ddb20d206ba21c29d49`;
`.sha256` check OK, packed-file validation OK; demo build byte-equals the packed
1.0.1 package.

Save compatibility (Local Runtime Simulator + headless Chrome, classification
**locally-simulated**, not a real DSH Host install): inject the exact 1.0.0 save
(score 20, lives 2, saveVersion 1) into the 1.0.1 build → Continue offered → the
save survived, time advanced, lives preserved, saveVersion/shape stable, and the
continued run used the new scoring (44 after the star-value change); no console
errors and no external requests. All 15 checks in
`save-compat-replay-evidence.json` are true, including `codeIs101` and
`freshHeaderIs101`.

Evidence: `artifacts/skill-eval/c21-c22/c22/logs/`, `save-1.0.0.json`,
`save-1.0.1-after-continue.json`, `save-compat-evidence.json`,
`save-compat-replay-evidence.json`, `shots/`, plus the packaged
1.0.1 `.html`/`.sha256`.

Machine summary: `artifacts/skill-eval/c21-c22/evidence-summary.json`;
C-21 report: `.../C-21-REPORT.md`; C-22 report: `.../C-22-REPORT.md`. The evaluator recorded the platform HEAD as
`dc646d8` and did not modify the checkout.

## Honest limits

- Both scenarios are independent and use the real CLI/validator/simulator, but
  they are still local: no real public hosting, GitHub identity, maintainer
  review, Release or DSH Host install happened.
- The full real-time 120 s finish path and the Host's GM-4006 install-rejection
  path are still not independently exercised here.
- M4 external configuration remains pending (see the main verification README).
