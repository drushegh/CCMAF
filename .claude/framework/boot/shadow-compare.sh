#!/usr/bin/env bash
set -uo pipefail
# shadow-compare.sh — validate the boot-view against an INDEPENDENT ground truth
# before the cold-start read-strategy is ever flipped (OPT P2, TASK-138).
#
# The round-2 cross-review's demand: the semantic policy change (a filtered view
# replacing full-file reads) ships ONLY after the filter is shown, on real
# sessions, to select EXACTLY what the spec's partial-read language promises.
# This computes the ground-truth selections a SECOND, structurally-different way
# (grep/sed pipelines, not the boot-view's awk) and diffs the ID sets. Appends
# PASS/FAIL to .claude/telemetry/boot-shadow.log. Run it each session during the
# soak; flip only after >=5 consecutive PASS.

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" \
  || ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
S="$ROOT/.claude"; FW="$S/framework"
LOG="$S/telemetry/boot-shadow.log"; mkdir -p "$S/telemetry" 2>/dev/null

# 1) Boot-view's selection (exit 2 = it declined → that's a PASS-by-fallback: the
#    caller reads full files, no wrong content is ever shown).
bv=$(bash "$FW/boot/boot-view.sh" 2>/dev/null); bvrc=$?
stamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
if [ "$bvrc" -eq 2 ]; then
  echo "$stamp PASS(fallback) boot-view declined (fail-closed) — full reads used" >> "$LOG"
  echo "shadow-compare: PASS (boot-view fail-closed → full reads; nothing to diff)"
  exit 0
fi
bv_task_ids=$(printf '%s\n' "$bv" | grep -oE '^#### \[(TASK|BUG)-[0-9]+\]' | grep -oE '(TASK|BUG)-[0-9]+' | sort -u)

# 2) Independent ground truth: all task IDs MINUS Done-section IDs, via a
#    different (sed/awk-lite) pipeline than boot-view's block parser.
all_ids=$(grep -oE '^#### \[(TASK|BUG)-[0-9]+\]' "$S/TASKS.md" | grep -oE '(TASK|BUG)-[0-9]+' | sort -u)
done_ids=$(awk '
  /^## / { sec=""; next }
  /^### / { sec=$0; next }
  /^#### \[(TASK|BUG)-[0-9]+\]/ { if (index(sec,"Done")>0) { match($0,/(TASK|BUG)-[0-9]+/); print substr($0,RSTART,RLENGTH) } }
' "$S/TASKS.md" | sort -u)
gt_task_ids=$(comm -23 <(printf '%s\n' "$all_ids") <(printf '%s\n' "$done_ids"))

# 3) Diff the two independent derivations.
if diff <(printf '%s\n' "$bv_task_ids") <(printf '%s\n' "$gt_task_ids") >/dev/null; then
  n=$(printf '%s\n' "$gt_task_ids" | grep -c .)
  echo "$stamp PASS non-Done task IDs match ($n)" >> "$LOG"
  echo "shadow-compare: PASS — boot-view non-Done task IDs == independent ground truth ($n)"
  exit 0
else
  echo "$stamp FAIL non-Done task ID set differs" >> "$LOG"
  echo "shadow-compare: FAIL — boot-view selection differs from ground truth:" >&2
  diff <(printf '%s\n' "$bv_task_ids") <(printf '%s\n' "$gt_task_ids") >&2 || true
  exit 1
fi
