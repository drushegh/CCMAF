#!/usr/bin/env bash
# checkpoint-watermark.sh — context-watermark CHECKPOINT nudge (TASK-052).
#
# Fires on UserPromptSubmit (interactive) AND PostToolUse (the autonomous
# mid-run gap, where no user prompt fires for many tool calls). No hook payload
# carries context % (verified — only the statusline payload has
# .context_window.used_percentage), so this DERIVES an estimate from
# transcript_path: the last assistant usage =
#   input_tokens + cache_creation_input_tokens + cache_read_input_tokens.
# When that estimate >= the watermark % of the window, nudge the model to flush
# its in-flight working-set to claude-progress.txt's `## WIP` section BEFORE
# auto-compaction. The text is benign + framework-attributed (a coercive hook
# injection is refused by the model — verified, see the design doc).
#
# Knobs:
#   CLAUDE_CONTEXT_WINDOW_TOKENS   window size (default 200000; set 1000000 for
#                                  a [1m] session or the nudge never fires)
#   CLAUDE_CHECKPOINT_WATERMARK_PCT  nudge threshold % (default 75)
# Throttle: PostToolUse parses usage only every 5th fire; nudges at most once
#   per session (state resets on session_id change). UserPromptSubmit evaluates
#   every turn (it is already a once-per-turn event — cheap).
# Fail-open: emit the event-appropriate empty output and exit 0 on any gap.

INPUT=$(cat 2>/dev/null || true)

# v2 adaptation: source the core plugin's OWN copy of the shared lib via
# CLAUDE_PLUGIN_ROOT (devhooks/console precedent). Inline fallback
# definition of core_active covers the lib failing to load — same shape as
# the sibling core-plugin hooks (core-context.sh / task-budget-counter.sh /
# unattended-guard.sh).
_lib="${CLAUDE_PLUGIN_ROOT:-}/hooks/lib/hook-common.sh"
# shellcheck source=/dev/null
[ -f "$_lib" ] && . "$_lib" 2>/dev/null
if ! command -v core_active >/dev/null 2>&1; then
  core_active() {
    local f="${CLAUDE_PROJECT_DIR:-.}/.claude/.framework-version"
    [ -f "$f" ] && grep -q '^FRAMEWORK_LINE=v2' "$f" 2>/dev/null
  }
fi

# UserPromptSubmit expects a JSON object on stdout; PostToolUse tolerates empty.
_emit_empty() { case "$1" in UserPromptSubmit) echo "{}" ;; *) : ;; esac; }

EVENT=""
if command -v jq >/dev/null 2>&1; then
  EVENT=$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null || true)
  EVENT="${EVENT%$'\r'}"
fi

# v2 adaptation: core activates on the v2 line in .framework-version
# (CORE-DESIGN §0), never bare presence. Gated here (right after the
# minimal EVENT-type parse above, needed so the no-op output matches this
# hook's own UserPromptSubmit-vs-PostToolUse contract) rather than the
# sibling hooks' bare `core_active || exit 0` — it still runs before every
# substantive step below (ROOT resolution, throttle-state reads, transcript
# parsing) so core stays a true no-op in v1 projects and non-CCMAF repos.
core_active || { _emit_empty "$EVENT"; exit 0; }

if command -v hook_enabled >/dev/null 2>&1 && ! hook_enabled checkpoint-watermark normal; then
  _emit_empty "$EVENT"; exit 0
fi
command -v jq >/dev/null 2>&1 || { _emit_empty "$EVENT"; exit 0; }

TPATH=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || true); TPATH="${TPATH%$'\r'}"
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true); SID="${SID%$'\r'}"
ROOT=$(git rev-parse --show-toplevel 2>/dev/null)

# --- per-session throttle state (best-effort; absence never blocks) ----------
# Parsed without sourcing (DA-M12: never execute a state file as shell).
STATEF=""; [ -n "$ROOT" ] && STATEF="$ROOT/.claude/.checkpoint-state"
FIRES=0 NUDGED=0 LAST_SID=""
if [ -n "$STATEF" ] && [ -f "$STATEF" ]; then
  FIRES=$(sed -n 's/^CKPT_FIRES=//p'  "$STATEF" 2>/dev/null | tail -1); FIRES="${FIRES%$'\r'}"
  NUDGED=$(sed -n 's/^CKPT_NUDGED=//p' "$STATEF" 2>/dev/null | tail -1); NUDGED="${NUDGED%$'\r'}"
  LAST_SID=$(sed -n 's/^CKPT_SID=//p'  "$STATEF" 2>/dev/null | tail -1); LAST_SID="${LAST_SID%$'\r'}"
fi
case "$FIRES"  in ''|*[!0-9]*) FIRES=0  ;; esac
case "$NUDGED" in ''|*[!0-9]*) NUDGED=0 ;; esac
[ "$SID" = "$LAST_SID" ] || { FIRES=0; NUDGED=0; }
FIRES=$((FIRES + 1))

_save_state() {
  [ -n "$STATEF" ] || return 0
  # Unique tmp path per write (Audtor 2026-07-02 minor): a fixed
  # "$STATEF.tmp" name let two concurrent fires (UserPromptSubmit racing a
  # PostToolUse) clobber each other's write.
  local _tmp="$STATEF.tmp"
  command -v unique_tmp >/dev/null 2>&1 && _tmp=$(unique_tmp "$STATEF")
  { echo "CKPT_SID=$SID"; echo "CKPT_FIRES=$FIRES"; echo "CKPT_NUDGED=$NUDGED"; } > "$_tmp" 2>/dev/null \
    && mv -f "$_tmp" "$STATEF" 2>/dev/null || rm -f "$_tmp" 2>/dev/null
}

# Already nudged this session → stay quiet (cheap fast-path).
[ "$NUDGED" = "1" ] && { _save_state; _emit_empty "$EVENT"; exit 0; }

# Cost throttle: on PostToolUse, only parse usage every 5th fire.
if [ "$EVENT" = "PostToolUse" ] && [ $((FIRES % 5)) -ne 0 ]; then
  _save_state; _emit_empty "$EVENT"; exit 0
fi

# --- context usage estimate --------------------------------------------------
WIN="${CLAUDE_CONTEXT_WINDOW_TOKENS:-200000}"; WIN="${WIN%$'\r'}"
case "$WIN" in ''|*[!0-9]*) WIN=200000 ;; esac
WM="${CLAUDE_CHECKPOINT_WATERMARK_PCT:-75}"; WM="${WM%$'\r'}"
case "$WM" in ''|*[!0-9]*) WM=75 ;; esac

# --- prefer the REAL context signal persisted by statusline.sh (TASK-134) -----
# statusline caches context_window.used_percentage (+ a 1M-derived window) to
# .claude/telemetry/.context-pct; a fresh cache lets this hook use the true %
# instead of estimating against a guessed window. An explicit
# CLAUDE_CONTEXT_WINDOW_TOKENS still wins the estimate path.
PCT_REAL=""
PCTF=""; [ -n "$ROOT" ] && PCTF="$ROOT/.claude/telemetry/.context-pct"
if [ -n "$PCTF" ] && [ -f "$PCTF" ]; then
  P_PCT=$(sed -n 's/^PCT=//p' "$PCTF" 2>/dev/null | tail -1); P_PCT="${P_PCT%$'\r'}"
  P_WIN=$(sed -n 's/^WIN=//p' "$PCTF" 2>/dev/null | tail -1); P_WIN="${P_WIN%$'\r'}"
  P_TS=$(sed -n  's/^TS=//p'  "$PCTF" 2>/dev/null | tail -1); P_TS="${P_TS%$'\r'}"
  case "$P_TS" in ''|*[!0-9]*) P_TS=0 ;; esac
  NOW_E=$(date +%s 2>/dev/null || echo 0)
  if [ $((NOW_E - P_TS)) -lt 600 ]; then     # fresh (<10 min) → trust it
    case "$P_PCT" in ''|-|*[!0-9.]*) : ;; *) PCT_REAL="${P_PCT%%.*}" ;; esac
    if [ -z "${CLAUDE_CONTEXT_WINDOW_TOKENS:-}" ]; then
      case "$P_WIN" in ''|-|*[!0-9]*) : ;; *) WIN="$P_WIN" ;; esac
    fi
  fi
fi

PCT=""
if [ -n "$PCT_REAL" ]; then
  PCT="$PCT_REAL"
elif [ -n "$TPATH" ] && [ -f "$TPATH" ] && [ "$WIN" -gt 0 ] 2>/dev/null; then
  # Read only the tail — the last assistant usage is near the end, so this is
  # bounded regardless of transcript size. The leading quote in the pattern
  # anchors "input_tokens" so it does NOT match cache_*_input_tokens. The three
  # last-occurrences come from the same (final) usage object. This is an
  # ESTIMATE for a nudge, not exact accounting.
  CHUNK=$(tail -c 200000 "$TPATH" 2>/dev/null)
  IN_T=$(printf '%s' "$CHUNK" | grep -oE '"input_tokens":[0-9]+' | tail -1 | grep -oE '[0-9]+$')
  CC_T=$(printf '%s' "$CHUNK" | grep -oE '"cache_creation_input_tokens":[0-9]+' | tail -1 | grep -oE '[0-9]+$')
  CR_T=$(printf '%s' "$CHUNK" | grep -oE '"cache_read_input_tokens":[0-9]+' | tail -1 | grep -oE '[0-9]+$')
  USED=$(( ${IN_T:-0} + ${CC_T:-0} + ${CR_T:-0} ))
  [ "$USED" -gt 0 ] && PCT=$(( USED * 100 / WIN ))
fi

if [ -z "$PCT" ] || [ "$PCT" -lt "$WM" ]; then
  _save_state; _emit_empty "$EVENT"; exit 0
fi

# --- over the watermark → nudge once, mark, emit -----------------------------
NUDGED=1; _save_state
if command -v telemetry_emit >/dev/null 2>&1 && [ -n "$ROOT" ]; then
  export CLAUDE_HOOK_SESSION_ID="$SID"
  telemetry_emit "$ROOT" "checkpoint-watermark" "nudged" "flagged" ",\"pct\":${PCT}"
fi

MSG="🧭 Context at ~${PCT}% of the window — approaching auto-compaction. At the next natural breakpoint, CHECKPOINT now: flush your in-flight working-set (current task, what is done, what is next, key decisions) to the \`## WIP\` section of claude-progress.txt, per the CCMAF session digest \"Session lifecycle\". Compaction summarises lossily; disk does not."

# Default the event for output if the payload lacked hook_event_name.
OUT_EVENT="${EVENT:-UserPromptSubmit}"
printf '%s' "$MSG" | jq -Rs --arg ev "$OUT_EVENT" \
  '{hookSpecificOutput:{hookEventName:$ev,additionalContext:.}}' 2>/dev/null || _emit_empty "$EVENT"
exit 0
