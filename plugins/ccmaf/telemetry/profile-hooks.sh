#!/usr/bin/env bash
set -uo pipefail
# profile-hooks.sh — hook cost measurement (OPT P0, M1).
#
# Two modes, both self-contained (no live instrumentation, no trap juggling):
#
#   report              Aggregate the ALREADY-collected telemetry
#                       (.claude/telemetry/events.jsonl) into per-hook counts:
#                       invocations, ran, skipped, skip-ratio. This is the count
#                       data the optimization brief was built from — a >90% skip
#                       ratio means the hook's filter is in the wrong layer
#                       (belongs in the settings.json matcher, not a spawned
#                       process). No timing (counts only).
#
#   bench <hook> <json> [K=50]
#                       Time K invocations of a hook script with a representative
#                       stdin payload. Reports total + mean ms — the real
#                       per-invocation cost (spawn + the hook's own work) on THIS
#                       host, so the P5 dispatcher work is ranked on evidence, not
#                       the ~50-200ms Windows-spawn estimate. Runs in a scratch
#                       dir so any state the hook writes does not touch the repo.
#
# Usage:
#   bash profile-hooks.sh report
#   bash profile-hooks.sh bench .claude/hooks/auto-lint.sh '{"tool_input":{"file_path":"x.ts"}}' 100

# v2 adaptation: v1 defined SCRIPT_DIR (BASH_SOURCE-relative) solely to
# derive ROOT via a "$SCRIPT_DIR/../../.." climb — broken under the plugin
# layout (fixed-depth assumption). This script has no sibling-file lookup, so
# SCRIPT_DIR is dropped entirely; CLAUDE_PROJECT_DIR (harness-provided) is
# now ROOT's primary source, with git/cwd as fallbacks for a manual,
# non-hook invocation.
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

# Hardened: 13-digit epoch-millis only (uutils %3N emits ns — see cold-start.sh).
now_ms() { local t; t=$(date +%s%3N 2>/dev/null); case "$t" in
  [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) printf '%s\n' "$t" ;;
  *) { command -v python3 >/dev/null 2>&1 && python3 -c 'import time;print(int(time.time()*1000))' \
       || python -c 'import time;print(int(time.time()*1000))'; } ;; esac; }

cmd="${1:-report}"

case "$cmd" in
  report)
    EV="$ROOT/.claude/telemetry/events.jsonl"
    [ -f "$EV" ] || { echo "profile-hooks: no telemetry at $EV (nothing collected yet)."; exit 0; }
    echo "per-hook telemetry (from events.jsonl) — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '%-22s %8s %8s %8s %8s\n' "hook" "invocs" "ran" "skipped" "skip%"
    echo "----------------------------------------------------------------"
    # outcome_class distinguishes ran vs skipped; be liberal about which class
    # strings count as "ran" so a schema tweak doesn't silently zero the table.
    grep -oE '"hook":"[^"]*"[^}]*"outcome_class":"[^"]*"' "$EV" 2>/dev/null \
      | sed -E 's/.*"hook":"([^"]*)".*"outcome_class":"([^"]*)".*/\1 \2/' \
      | awk '
        { inv[$1]++; if ($2 ~ /skip/) sk[$1]++ }
        END {
          for (h in inv) {
            s = (h in sk) ? sk[h] : 0
            printf "%-22s %8d %8d %8d %7d%%\n", h, inv[h], inv[h]-s, s, (inv[h] ? s*100/inv[h] : 0)
          }
        }' | sort
    echo "----------------------------------------------------------------"
    echo "rule: skip% > 90 → the filter belongs in the settings.json matcher, not the hook."
    ;;
  bench)
    hook="${2:-}"; payload="${3:-}"; K="${4:-50}"
    [ -n "$hook" ] && [ -f "$hook" ] || { echo "usage: profile-hooks.sh bench <hook.sh> <json-payload> [K]" >&2; exit 2; }
    case "$K" in ''|*[!0-9]*) K=50 ;; esac
    scratch="$(mktemp -d)"; trap 'rm -rf "$scratch"' EXIT
    ( cd "$scratch" && git init -q 2>/dev/null; mkdir -p .claude/telemetry )
    s=$(now_ms)
    for _ in $(seq 1 "$K"); do
      printf '%s' "$payload" | ( cd "$scratch" && bash "$ROOT/$hook" >/dev/null 2>&1 || bash "$hook" >/dev/null 2>&1 ) || true
    done
    e=$(now_ms)
    total=$((e - s))
    printf 'bench %s\n  runs=%s  total=%s ms  mean=%s ms/invocation\n' "$hook" "$K" "$total" "$((total / (K>0?K:1)))"
    ;;
  *)
    echo "usage: profile-hooks.sh report | bench <hook.sh> <json> [K]" >&2
    exit 2
    ;;
esac
