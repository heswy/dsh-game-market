# SUPERSEDED RUNBOOK (task-12): prefer docs/verification/v1.5/plugin-update-m3.md §7/§8 and
# `node scripts/verification/v1.5/m3/run-m3-serial.mjs`. Kept for reference only.
#!/usr/bin/env bash
# M3 V1/V2 execution runbook (verification-owned; no git writes).
#
# Usage (after Lead confirms R_A / R_B / R_final2 + P_final2 and the feature
# branch is pushed; values are the ones Lead handed over):
#
#   cd dsh-game-market-worktrees/v1.5-platform-update
#   A=2e2c1fc86dff365d0acf08c6e53a97c86da6a1e6            # R_A 1.2.1
#   B=70aacee9444f16bc2df1ffbcc71155f2a509e16e            # R_B 1.2.2
#   PF=p_final2_sha                                        # P_final2
#   FINAL=r_final2_sha                                     # R_final2 1.3.0
#
#   # 0) structural acceptance (temp clone; exact-SHA fetch like pnpm)
#   node scripts/verification/v1.5/m3/verify-probe-releases.mjs \
#     --a "$A" --b "$B" --final "$FINAL" \
#     --pa 694f521f3abe82e607c271076175ec1a770a8d5c \
#     --pb 8bef927d9355bd3a788047acf384398239fea022 \
#     --pfinal "$PF" --write-evidence
#
#   # 1) V1 HMR chain: install R_A -> UI update R_B -> UI update R_final2
#   node scripts/verification/v1.5/m3/run-v1-hmr-chain.mjs --a "$A" --b "$B" --final "$FINAL"
#
#   # 2) V1 non-HMR: install R_A -> UI update R_B -> pending-restart -> restart -> updated
#   node scripts/verification/v1.5/m3/run-v1-nonhmr-restart.mjs --a "$A" --b "$B" --final "$FINAL"
#
#   # 3) V2 (after V1 evidence is written)
#   node scripts/verification/v1.5/m3/run-v2-windows-idempotency.mjs --a "$A" --b "$B" --final "$FINAL"
#   node scripts/verification/v1.5/m3/run-v2-save-coordination.mjs --a "$A" --b "$B" --final "$FINAL"
#   node scripts/verification/v1.5/m3/run-v2-edges-index.mjs --a "$A" --b "$B" --final "$FINAL"
#
# Notes:
# - every runner writes sanitised evidence under docs/verification/v1.5/raw/m3/,
#   fails non-zero on any required failure, and proves cleanup (ports/PIDs/homes);
# - all DSH_HOME/profile/chrome state lives under /tmp/dsh-v15/m3/**; never
#   ~/.dsh, the App install dir, or any production index;
# - installs use the isolated host's pnpm with the M0 proxy env; the fixed
#   official index URL is answered by the audited transport fixture only.
set -euo pipefail
: "${A:?set A=R_A sha}"; : "${B:?set B=R_B sha}"; : "${FINAL:?set FINAL=R_final2 sha}"; : "${PF:?set PF=P_final2 sha}"
cd "$(dirname "$0")/../../../.."
echo "A=$A B=$B FINAL=$FINAL PF=$PF"
node scripts/verification/v1.5/m3/verify-probe-releases.mjs --a "$A" --b "$B" --final "$FINAL" \
  --pa 694f521f3abe82e607c271076175ec1a770a8d5c --pb 8bef927d9355bd3a788047acf384398239fea022 \
  --pfinal "$PF" --write-evidence
node scripts/verification/v1.5/m3/run-v1-hmr-chain.mjs --a "$A" --b "$B" --final "$FINAL"
node scripts/verification/v1.5/m3/run-v1-nonhmr-restart.mjs --a "$A" --b "$B" --final "$FINAL"
