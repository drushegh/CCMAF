#!/usr/bin/env bats
# Behavioural tests for the TASK-052 session-lifecycle hooks. Each runs inside a
# throwaway git repo (helpers.bash); hooks are pure (stdin JSON + env) →
# (exit code + stdout + local files).

load helpers

setup() {
  init_repo
}

# A transcript whose last assistant usage sums to 210,000 context tokens
# (10k input + 0 cache-creation + 200k cache-read). Against the 200k default
# window that is ~105% → over the 75% watermark.
_write_hot_transcript() {
  printf '%s\n' \
    '{"type":"user","message":{"role":"user","content":"hi"}}' \
    '{"type":"assistant","message":{"usage":{"input_tokens":10000,"cache_creation_input_tokens":0,"cache_read_input_tokens":200000,"output_tokens":50}}}' \
    > "$REPO/transcript.jsonl"
}

# A cold transcript: ~2k tokens → ~1% → under the watermark.
_write_cold_transcript() {
  printf '%s\n' \
    '{"type":"assistant","message":{"usage":{"input_tokens":1000,"cache_creation_input_tokens":0,"cache_read_input_tokens":1000,"output_tokens":50}}}' \
    > "$REPO/transcript.jsonl"
}

# --- session-reanchor.sh (SessionStart) ------------------------------------

@test "reanchor: source=compact injects the RECONCILE directive on the SessionStart channel" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  run hookrun "$HOOKS/session-reanchor.sh" '{"source":"compact","session_id":"s1"}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"RECONCILE"* ]]
  [[ "$output" == *"git status"* ]]
  # Pin the load-bearing channel: the injection only works on SessionStart
  # (PostCompact has no additionalContext handler — verified).
  echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "SessionStart"'
}

@test "reanchor: source=startup stays silent (no injection on normal start)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  run hookrun "$HOOKS/session-reanchor.sh" '{"source":"startup","session_id":"s1"}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "reanchor: source=resume and source=clear stay silent" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  run hookrun "$HOOKS/session-reanchor.sh" '{"source":"resume"}'
  [ "$output" = "{}" ]
  run hookrun "$HOOKS/session-reanchor.sh" '{"source":"clear"}'
  [ "$output" = "{}" ]
}

@test "reanchor: disabled → empty object, exit 0" {
  CLAUDE_DISABLED_HOOKS=reanchor run hookrun "$HOOKS/session-reanchor.sh" '{"source":"compact"}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "reanchor: minimal profile silences it" {
  CLAUDE_HOOK_PROFILE=minimal run hookrun "$HOOKS/session-reanchor.sh" '{"source":"compact"}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "reanchor: garbage stdin → fail-open empty object" {
  run hookrun "$HOOKS/session-reanchor.sh" 'not json {{{'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

# --- precompact-snapshot.sh (PreCompact) -----------------------------------

@test "precompact: writes the .last-compaction marker with the trigger" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  run hookrun "$HOOKS/precompact-snapshot.sh" '{"trigger":"auto","session_id":"s1"}'
  [ "$status" -eq 0 ]
  [ -f "$REPO/.claude/.last-compaction" ]
  grep -q "trigger=auto" "$REPO/.claude/.last-compaction"
}

@test "precompact: makes NO git mutation (no commit, nothing staged)" {
  ( cd "$REPO" && touch code.txt && git add -A && git commit -qm seed && echo dirty >> code.txt )
  before=$( cd "$REPO" && git rev-list --count HEAD )
  run hookrun "$HOOKS/precompact-snapshot.sh" '{"trigger":"manual"}'
  [ "$status" -eq 0 ]
  after=$( cd "$REPO" && git rev-list --count HEAD )
  [ "$before" = "$after" ]                 # no new commit
  ( cd "$REPO" && git diff --cached --quiet )   # nothing staged
}

@test "precompact: records WHICH files are dirty (filenames only, never a content patch)" {
  ( cd "$REPO" && touch code.txt && git add -A && git commit -qm seed && echo dirty >> code.txt )
  run hookrun "$HOOKS/precompact-snapshot.sh" '{"trigger":"manual"}'
  [ "$status" -eq 0 ]
  grep -q "code.txt" "$REPO"/.claude/.precompact-snapshot/status-*.txt
  # Security pin: NO content patch is ever written (a diff could carry a secret
  # out of a tracked file into a model-readable path).
  ! ls "$REPO"/.claude/.precompact-snapshot/*.patch >/dev/null 2>&1
}

@test "precompact: clean committed tree → marker still written, exit 0" {
  ( cd "$REPO" && touch code.txt && git add -A && git commit -qm seed )
  run hookrun "$HOOKS/precompact-snapshot.sh" '{"trigger":"auto"}'
  [ "$status" -eq 0 ]
  [ -f "$REPO/.claude/.last-compaction" ]
}

@test "precompact: disabled → no marker, exit 0" {
  CLAUDE_DISABLED_HOOKS=precompact-snapshot run hookrun "$HOOKS/precompact-snapshot.sh" '{"trigger":"manual"}'
  [ "$status" -eq 0 ]
  [ ! -f "$REPO/.claude/.last-compaction" ]
}

@test "precompact: garbage stdin → fail-open exit 0 (still writes a marker)" {
  run hookrun "$HOOKS/precompact-snapshot.sh" 'garbage{{{'
  [ "$status" -eq 0 ]
  [ -f "$REPO/.claude/.last-compaction" ]
}

# --- postcompact-archive.sh (PostCompact) ----------------------------------

@test "postcompact: archives the compact_summary text" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  run hookrun "$HOOKS/postcompact-archive.sh" '{"trigger":"manual","compact_summary":"SUMMARY-MARKER-XYZ","session_id":"s1"}'
  [ "$status" -eq 0 ]
  grep -rq "SUMMARY-MARKER-XYZ" "$REPO/.claude/.compaction-archive/"
}

@test "postcompact: missing compact_summary → still exit 0, records placeholder" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  run hookrun "$HOOKS/postcompact-archive.sh" '{"trigger":"auto"}'
  [ "$status" -eq 0 ]
  grep -rq "no compact_summary" "$REPO/.claude/.compaction-archive/"
}

@test "postcompact: disabled → no archive, exit 0" {
  CLAUDE_DISABLED_HOOKS=postcompact-archive run hookrun "$HOOKS/postcompact-archive.sh" '{"compact_summary":"x"}'
  [ "$status" -eq 0 ]
  [ ! -d "$REPO/.claude/.compaction-archive" ]
}

@test "postcompact: garbage stdin → fail-open exit 0" {
  run hookrun "$HOOKS/postcompact-archive.sh" 'garbage{{{'
  [ "$status" -eq 0 ]
}

# --- checkpoint-watermark.sh (UserPromptSubmit + PostToolUse) ---------------

@test "watermark: over the threshold injects the checkpoint nudge" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  _write_hot_transcript
  run hookrun "$HOOKS/checkpoint-watermark.sh" '{"hook_event_name":"UserPromptSubmit","session_id":"s1","transcript_path":"transcript.jsonl"}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"Context at"* ]]
  [[ "$output" == *"## WIP"* ]]
}

@test "watermark: under the threshold stays silent" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  _write_cold_transcript
  run hookrun "$HOOKS/checkpoint-watermark.sh" '{"hook_event_name":"UserPromptSubmit","session_id":"s1","transcript_path":"transcript.jsonl"}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "watermark: a larger window override drops the same usage under threshold" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  _write_hot_transcript   # 210k tokens → 21% of a 1M window → under 75
  CLAUDE_CONTEXT_WINDOW_TOKENS=1000000 run hookrun "$HOOKS/checkpoint-watermark.sh" '{"hook_event_name":"UserPromptSubmit","session_id":"s1","transcript_path":"transcript.jsonl"}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "watermark: missing transcript → silent (no estimate possible)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  run hookrun "$HOOKS/checkpoint-watermark.sh" '{"hook_event_name":"UserPromptSubmit","session_id":"s1","transcript_path":"nope.jsonl"}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "watermark: nudges at most once per session" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  _write_hot_transcript
  run hookrun "$HOOKS/checkpoint-watermark.sh" '{"hook_event_name":"UserPromptSubmit","session_id":"s9","transcript_path":"transcript.jsonl"}'
  [[ "$output" == *"Context at"* ]]
  # Second fire, same session → already nudged → silent.
  run hookrun "$HOOKS/checkpoint-watermark.sh" '{"hook_event_name":"UserPromptSubmit","session_id":"s9","transcript_path":"transcript.jsonl"}'
  [ "$output" = "{}" ]
}

@test "watermark: PostToolUse is throttled (1st fire does not parse/nudge)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  _write_hot_transcript
  # Fresh session: FIRES becomes 1 → 1%5 != 0 → emit nothing even though hot.
  run hookrun "$HOOKS/checkpoint-watermark.sh" '{"hook_event_name":"PostToolUse","session_id":"p1","transcript_path":"transcript.jsonl"}'
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  # 'silent' must mean 'throttled', not 'broken': the fire counter advanced.
  grep -q "CKPT_FIRES=1" "$REPO/.claude/.checkpoint-state"
}

@test "watermark: PostToolUse nudges on the 5th fire, on the PostToolUse channel" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  _write_hot_transcript
  # Seed the throttle state so this fire is the 5th (FIRES 4 → 5, 5%5==0).
  printf 'CKPT_SID=p2\nCKPT_FIRES=4\nCKPT_NUDGED=0\n' > "$REPO/.claude/.checkpoint-state"
  run hookrun "$HOOKS/checkpoint-watermark.sh" '{"hook_event_name":"PostToolUse","session_id":"p2","transcript_path":"transcript.jsonl"}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"Context at"* ]]
  # The emitted event name must match the firing event, not a hard-coded one.
  echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "PostToolUse"'
}

@test "watermark: correct grep-anchoring keeps a sum UNDER threshold (anchor regression)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  # 1000 + 1000 + 100000 = 102000 → 51% of the 200k default → UNDER 75 → silent.
  # A regression dropping the leading-quote anchor on the "input_tokens" grep
  # would pick the LAST *_input_tokens match (cache_read=100000), double-count it
  # (201000 → 100%) and wrongly nudge. Silence is the pin for the anchor.
  printf '%s\n' \
    '{"type":"assistant","message":{"usage":{"input_tokens":1000,"cache_creation_input_tokens":1000,"cache_read_input_tokens":100000,"output_tokens":50}}}' \
    > "$REPO/transcript.jsonl"
  run hookrun "$HOOKS/checkpoint-watermark.sh" '{"hook_event_name":"UserPromptSubmit","session_id":"anc","transcript_path":"transcript.jsonl"}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "watermark: a new session_id resets the throttle and re-nudges" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  _write_hot_transcript
  # Prior session A already nudged; a DIFFERENT session_id must reset + nudge.
  # (A regression that keyed the throttle globally instead of per-session would
  # stay silent here.)
  printf 'CKPT_SID=A\nCKPT_FIRES=3\nCKPT_NUDGED=1\n' > "$REPO/.claude/.checkpoint-state"
  run hookrun "$HOOKS/checkpoint-watermark.sh" '{"hook_event_name":"UserPromptSubmit","session_id":"B","transcript_path":"transcript.jsonl"}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"Context at"* ]]
}

@test "watermark: transcript present but no usage object → silent" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  printf '%s\n' '{"type":"user","message":{"role":"user","content":"hi"}}' > "$REPO/transcript.jsonl"
  run hookrun "$HOOKS/checkpoint-watermark.sh" '{"hook_event_name":"UserPromptSubmit","session_id":"nou","transcript_path":"transcript.jsonl"}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "watermark: malformed transcript content → fail-open silent" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  printf 'not json at all {{{ garbage no usage here' > "$REPO/transcript.jsonl"
  run hookrun "$HOOKS/checkpoint-watermark.sh" '{"hook_event_name":"UserPromptSubmit","session_id":"mal","transcript_path":"transcript.jsonl"}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "watermark: disabled → silent on UserPromptSubmit" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  _write_hot_transcript
  CLAUDE_DISABLED_HOOKS=checkpoint-watermark run hookrun "$HOOKS/checkpoint-watermark.sh" '{"hook_event_name":"UserPromptSubmit","session_id":"s1","transcript_path":"transcript.jsonl"}'
  [ "$output" = "{}" ]
}

@test "watermark: minimal profile silences it" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  _write_hot_transcript
  CLAUDE_HOOK_PROFILE=minimal run hookrun "$HOOKS/checkpoint-watermark.sh" '{"hook_event_name":"UserPromptSubmit","session_id":"s1","transcript_path":"transcript.jsonl"}'
  [ "$output" = "{}" ]
}

@test "watermark: garbage stdin → fail-open exit 0" {
  run hookrun "$HOOKS/checkpoint-watermark.sh" 'garbage{{{'
  [ "$status" -eq 0 ]
}

# --- telemetry: session-lifecycle hooks emit schema-v2 lines ----------------

@test "telemetry: reanchor emits an injected event with session_id" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  run hookrun "$HOOKS/session-reanchor.sh" '{"source":"compact","session_id":"sess-ra"}'
  [ "$status" -eq 0 ]
  line=$(grep '"hook":"reanchor"' "$REPO/.claude/telemetry/events.jsonl" | tail -1)
  echo "$line" | jq -e '.schema == 2 and .session_id == "sess-ra" and .outcome_class == "flagged"'
}
