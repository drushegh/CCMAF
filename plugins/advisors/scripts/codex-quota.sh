#!/usr/bin/env bash
set -euo pipefail
# codex-quota.sh [--max <percent>] [rollout.jsonl]
#
# READ-ONLY ChatGPT-sub quota check for the codex provider. codex's session rollouts
# ($CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl) carry `rate_limits.primary` (the 5-hour
# window) and `rate_limits.secondary` (the weekly window), each with `used_percent` and
# `resets_at` (epoch seconds). This prints the latest reading from the newest rollout (or the
# file given) — record it before/after a consult, or gate a heavy run on it with --max.
#
# Exit: 0 = reading printed (and under --max, if given); 1 = primary used_percent >= --max;
#       2 = no reading (no rollout, no parseable rate_limits line, or jq missing).
# Never runs a model, never touches auth.json / config.toml.

max=""
file=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --max) max="${2:?--max needs a percent}"; shift 2 ;;
    *) file="$1"; shift ;;
  esac
done

command -v jq >/dev/null 2>&1 || { printf 'codex-quota: jq not on PATH — cannot read rollouts\n' >&2; exit 2; }

if [[ -z "$file" ]]; then
  sessions="${CODEX_HOME:-$HOME/.codex}/sessions"
  # Paths sort chronologically (YYYY/MM/DD dirs + timestamped file names).
  file="$(find "$sessions" -name 'rollout-*.jsonl' -type f 2>/dev/null | sort | tail -1 || true)"
fi
[[ -n "$file" && -f "$file" ]] || { printf 'codex-quota: no codex rollout found (looked under %s)\n' "${sessions:-$file}" >&2; exit 2; }

# Newest PARSEABLE reading: a live codex may be mid-write on the last line, so
# unparseable lines are skipped (fromjson?) rather than failing the read —
# which under set -e exited 1, indistinguishable from "over --max".
vals="$(grep '"rate_limits"' "$file" | jq -rR '
  fromjson? | (.payload.rate_limits // .rate_limits) as $r | select($r != null)
  | [($r.primary.used_percent // "?"), ($r.primary.resets_at // 0),
     ($r.secondary.used_percent // "?"), ($r.secondary.resets_at // 0)] | @tsv' 2>/dev/null \
  | tail -1 | tr -d '\r' || true)"
[[ -n "$vals" ]] || { printf 'codex-quota: no readable rate_limits reading in %s\n' "$file" >&2; exit 2; }
read -r p_used p_reset s_used s_reset <<< "$vals"

when() { [[ "$1" -gt 0 ]] 2>/dev/null && date -u -d "@$1" +%Y-%m-%dT%H:%MZ 2>/dev/null || printf '%s' "$1"; }
printf 'codex quota: 5h %s%% (resets %s) · weekly %s%% (resets %s) · from %s\n' \
  "$p_used" "$(when "$p_reset")" "$s_used" "$(when "$s_reset")" "$(basename "$file")"

if [[ -n "$max" && "$p_used" != "?" ]]; then
  # Compare on the integer part (used_percent is a float like 11.0).
  if [[ "${p_used%%.*}" -ge "${max%%.*}" ]]; then
    printf 'codex-quota: 5h window at %s%% >= --max %s%% — hold heavy consults until the reset.\n' "$p_used" "$max" >&2
    exit 1
  fi
fi
exit 0
