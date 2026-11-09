#!/usr/bin/env bash
# Build SchoolHub with forge, one PRD per run, committing after each.
# Usage: ./run.sh <workspace-dir> [start-index=0] [end-index=18] [extra forge flags...]
# Example: ./run.sh ~/schoolhub            # everything, with approval gates
#          ./run.sh ~/schoolhub 7 7        # just PRD-07
#          ./run.sh ~/schoolhub 3 18 --autonomous
set -euo pipefail

WS="${1:?workspace dir required}"; START="${2:-0}"; END="${3:-18}"; shift $(( $# < 3 ? $# : 3 ))
PRD_DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$WS"
WS="$(cd "$WS" && pwd)"
[ -d "$WS/.git" ] || git -C "$WS" init -q

for i in $(seq "$START" "$END"); do
  n=$(printf '%02d' "$i")
  prd=$(ls "$PRD_DIR"/"$n"-*.md)
  mode=$([ "$i" -eq 0 ] && echo --greenfield || echo --brownfield)
  echo "=== SCH-0$n  $(basename "$prd") ==="
  (cd "$WS" && forge run --prd "$prd" --ticket "SCH-0$n" --workspace "$WS" --tech-stack react "$mode" "$@")
  git -C "$WS" add -A
  git -C "$WS" commit -qm "SCH-0$n: $(head -1 "$prd" | sed 's/^# //')" || echo "(nothing to commit)"
done
