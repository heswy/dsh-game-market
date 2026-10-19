#!/usr/bin/env bash
# Record one command run: exact command, stdout+stderr, exit code.
# Usage: run.sh <label> <workdir> <command...>
set -u
label="$1"; shift
workdir="$1"; shift
logdir="$(dirname "$0")"
out="$logdir/$label.log"
{
  echo "\$ (cd $(printf '%q' "$workdir") && $(printf '%q ' "$@"))"
  echo "--- output ---"
} > "$out"
( cd "$workdir" && "$@" ) >> "$out" 2>&1
code=$?
echo "--- exit: $code ---" >> "$out"
printf '%s\t%s\t%s\n' "$label" "$code" "$(cd "$workdir" && printf '%q ' "$@")" >> "$logdir/commands.tsv"
echo "[$label] exit=$code log=$out"
exit 0
