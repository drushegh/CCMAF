#!/usr/bin/env bash
# scrape-review-findings.sh — parse .claude/review-findings.md and emit
# one telemetry event per scrape, capturing findings delta since last run.
#
# Why this exists: the Reviewer agent is not a hook and can't emit
# telemetry directly. Its output is structured markdown in
# .claude/review-findings.md. This scraper runs from the Stop hook
# (once per session end) and translates new review output into events.
#
# Event shape:
#   {"ts":"...","hook":"review-scraper","outcome":"scraped",
#    "critical":N,"warning":M,"suggestion":K}
#
# Where N/M/K are findings *added* since the last scrape (delta), not
# cumulative totals. This gives per-session signal.
#
# No event is emitted if review-findings.md hasn't changed since last
# scrape — avoids noisy no-op events.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
FINDINGS="$PROJECT_ROOT/.claude/review-findings.md"
TELEMETRY_DIR="$PROJECT_ROOT/.claude/telemetry"
STATE_FILE="$TELEMETRY_DIR/.review-scrape-state"
EVENTS="$TELEMETRY_DIR/events.jsonl"

# Nothing to scrape if the findings file doesn't exist yet.
[ ! -f "$FINDINGS" ] && exit 0

mkdir -p "$TELEMETRY_DIR" 2>/dev/null

# Compare mtime against last scrape. Skip if unchanged.
file_mtime=$(date -u -r "$FINDINGS" +%s 2>/dev/null || stat -c '%Y' "$FINDINGS" 2>/dev/null || echo 0)
last_scrape_mtime=0
last_critical=0
last_warning=0
last_suggestion=0
if [ -f "$STATE_FILE" ]; then
  # shellcheck disable=SC1090
  source "$STATE_FILE"
  last_scrape_mtime="${LAST_SCRAPE_MTIME:-0}"
  last_critical="${LAST_CRITICAL:-0}"
  last_warning="${LAST_WARNING:-0}"
  last_suggestion="${LAST_SUGGESTION:-0}"
fi

if [ "$file_mtime" -le "$last_scrape_mtime" ]; then
  # Unchanged — nothing to do.
  exit 0
fi

# --- Count current totals --------------------------------------------
# Each severity section in the reviewer's output is headed like:
#   CRITICAL (must fix before merge ...):
#   WARNING (should fix ...):
#   SUGGESTION (consider ...):
# Followed by bullet items (- something) until the next section heading,
# markdown heading, or horizontal rule. "(none)" entries mean zero
# findings. Blank lines do NOT end a section (DA-C5): the reviewer format
# separates bullets with blank lines, so the old blank-line sentinel made
# a 3-finding section count as 1 — every delta in telemetry was
# systematically low.
#
# Count bullets per section across the whole file (multiple review
# cycles are newest-first and we want the running total).

count_section() {
  local section="$1"
  awk -v section="$section" '
    BEGIN { in_section = 0; count = 0 }
    # Match section header: "CRITICAL (..."
    $0 ~ "^"section"[[:space:]]*\\(" {
      in_section = 1
      next
    }
    # Exit section on the next section header, markdown heading, or rule.
    # Blank lines stay inside the section (bullets are blank-separated).
    in_section && /^(CRITICAL|WARNING|SUGGESTION|CONTRACT DRIFT|FRAMEWORK HYGIENE|TASK:|VERDICT:|#{1,6}[[:space:]]|---)/ {
      in_section = 0
    }
    in_section {
      # Only count top-level bullets. Exclude "(none)" placeholders.
      if ($0 ~ /^[[:space:]]*-[[:space:]]/ && $0 !~ /\(none\)/) {
        count++
      }
    }
    END { print count }
  ' "$FINDINGS"
}

current_critical=$(count_section "CRITICAL")
current_warning=$(count_section "WARNING")
current_suggestion=$(count_section "SUGGESTION")

# --- Compute delta vs last scrape ------------------------------------
delta_critical=$((current_critical - last_critical))
delta_warning=$((current_warning - last_warning))
delta_suggestion=$((current_suggestion - last_suggestion))

# Guard against negatives (file may have been archived/reset — treat
# as a fresh baseline rather than emitting a bogus negative event).
if [ "$delta_critical" -lt 0 ] || [ "$delta_warning" -lt 0 ] || [ "$delta_suggestion" -lt 0 ]; then
  # File was reset — re-baseline without emitting.
  cat > "$STATE_FILE" <<EOF
LAST_SCRAPE_MTIME=$file_mtime
LAST_CRITICAL=$current_critical
LAST_WARNING=$current_warning
LAST_SUGGESTION=$current_suggestion
EOF
  exit 0
fi

# No findings added — skip emitting.
if [ "$delta_critical" -eq 0 ] && [ "$delta_warning" -eq 0 ] && [ "$delta_suggestion" -eq 0 ]; then
  # Still update the state so we don't keep rechecking unchanged mtime.
  cat > "$STATE_FILE" <<EOF
LAST_SCRAPE_MTIME=$file_mtime
LAST_CRITICAL=$current_critical
LAST_WARNING=$current_warning
LAST_SUGGESTION=$current_suggestion
EOF
  exit 0
fi

# --- Emit event -----------------------------------------------------
# Schema-v2 via hook-common.sh (contract:telemetry-schema); session_id
# arrives via CLAUDE_HOOK_SESSION_ID exported by the Stop hook that runs
# this scraper. Emitting is this script's sole purpose, so unlike the
# hooks it falls back to a v1 line when the lib is absent (v1 lines stay
# valid forever per the contract's back-compat rule).
_lib="$PROJECT_ROOT/.claude/hooks/lib/hook-common.sh"
# shellcheck disable=SC1090
[ -f "$_lib" ] && . "$_lib" || true
if command -v telemetry_emit >/dev/null 2>&1; then
  telemetry_emit "$PROJECT_ROOT" "review-scraper" "scraped" "flagged" \
    ",\"critical\":$delta_critical,\"warning\":$delta_warning,\"suggestion\":$delta_suggestion"
else
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '{"ts":"%s","hook":"review-scraper","outcome":"scraped","critical":%d,"warning":%d,"suggestion":%d}\n' \
    "$ts" "$delta_critical" "$delta_warning" "$delta_suggestion" \
    >> "$EVENTS" 2>/dev/null || true
fi

# Update state.
cat > "$STATE_FILE" <<EOF
LAST_SCRAPE_MTIME=$file_mtime
LAST_CRITICAL=$current_critical
LAST_WARNING=$current_warning
LAST_SUGGESTION=$current_suggestion
EOF
