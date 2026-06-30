#!/usr/bin/env bats
# Behavioural tests for the hooks: simulated event in, (exit code + stdout) out.
# All executions run inside a throwaway git repo (see helpers.bash).

load helpers

setup() {
  init_repo
}

# --- block-dangerous-commands.py (PreToolUse, safety tier) -----------

@test "block-dangerous: blocks rm -rf / with exit 2" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"rm -rf /"}}'
  [ "$status" -eq 2 ]
}

@test "block-dangerous: allows a safe command (exit 0)" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"ls -la"}}'
  [ "$status" -eq 0 ]
}

@test "block-dangerous: explicit disable lets a dangerous command through" {
  [ -n "$PYTHON" ] || skip "python not available"
  CLAUDE_DISABLED_HOOKS=block-dangerous run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"rm -rf /"}}'
  [ "$status" -eq 0 ]
}

@test "block-dangerous: rm -rf of an absolute SUBPATH is allowed (DA-C2 false-positive regression)" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"rm -rf /tmp/build"}}'
  [ "$status" -eq 0 ]
}

@test "block-dangerous: rm -rf of a relative path is allowed" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"rm -rf ./dist node_modules"}}'
  [ "$status" -eq 0 ]
}

@test "block-dangerous: split flags rm -r -f / is blocked (DA-C2 bypass regression)" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"rm -r -f /"}}'
  [ "$status" -eq 2 ]
}

@test "block-dangerous: long flags rm --recursive --force / is blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"rm --recursive --force /"}}'
  [ "$status" -eq 2 ]
}

@test "block-dangerous: sudo rm -rf / is blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"sudo rm -rf /"}}'
  [ "$status" -eq 2 ]
}

@test "block-dangerous: rm -rf ~ (home wipe) is blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"rm -rf ~"}}'
  [ "$status" -eq 2 ]
}

@test "block-dangerous: chained command ending in rm -rf / is blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"cd /x && rm -rf /"}}'
  [ "$status" -eq 2 ]
}

# --- filter-test-output.sh (PreToolUse) ------------------------------

@test "filter-test-output: rewrites a test command" {
  run hookrun "$HOOKS/filter-test-output.sh" '{"tool_input":{"command":"npm test"}}'
  [ "$status" -eq 0 ]
  [[ "$output" == *updatedInput* ]]
}

@test "filter-test-output: passes a non-test command through unchanged" {
  run hookrun "$HOOKS/filter-test-output.sh" '{"tool_input":{"command":"ls -la"}}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "filter-test-output: disabled → passthrough" {
  CLAUDE_DISABLED_HOOKS=filter-test-output run hookrun "$HOOKS/filter-test-output.sh" '{"tool_input":{"command":"npm test"}}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "filter-test-output: rewrites the documented 'cd 01_Project && npm test' form" {
  # Regression: the old ^-anchored regex never matched the invocation the
  # framework's own CLAUDE.md documents — the filter was dead code in the
  # standard flow (found in the 2026-06-10 external audit).
  run hookrun "$HOOKS/filter-test-output.sh" '{"tool_input":{"command":"cd 01_Project && npm test"}}'
  [ "$status" -eq 0 ]
  [[ "$output" == *updatedInput* ]]
}

@test "filter-test-output: rewrites dotnet test (stack-agnostic runner set)" {
  run hookrun "$HOOKS/filter-test-output.sh" '{"tool_input":{"command":"dotnet test"}}'
  [ "$status" -eq 0 ]
  [[ "$output" == *updatedInput* ]]
}

@test "filter-test-output: 'npm testify' is NOT mistaken for a test command" {
  run hookrun "$HOOKS/filter-test-output.sh" '{"tool_input":{"command":"npm testify --watch"}}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

# --- auto-format.sh / auto-lint.sh (PostToolUse) ---------------------

@test "auto-format: no file path → clean no-op exit 0" {
  run hookrun "$HOOKS/auto-format.sh" '{}'
  [ "$status" -eq 0 ]
}

@test "auto-format: minimal profile → skipped, exit 0" {
  CLAUDE_HOOK_PROFILE=minimal run hookrun "$HOOKS/auto-format.sh" '{"tool_input":{"file_path":"x.ts"}}'
  [ "$status" -eq 0 ]
}

@test "auto-lint: markdown file is skipped, exit 0" {
  run hookrun "$HOOKS/auto-lint.sh" '{"tool_input":{"file_path":"README.md"}}'
  [ "$status" -eq 0 ]
}

# --- post-edit-dispatch.sh (PostToolUse, TASK-035) --------------------
# The dispatcher reads the event once and runs format/lint/verify-deps
# with precomputed env (CLAUDE_POSTEDIT_FILE/_ROOT). The three hooks'
# direct stdin paths stay covered by the per-hook tests above and in
# fault_injection.bats.

dispatchrun() {  # <json>
  printf '%s' "$1" > "$REPO/event.json"
  ( cd "$REPO" && bash "$HOOKS/post-edit-dispatch.sh" < "$REPO/event.json" )
}

@test "post-edit-dispatch: one invocation drives format AND lint (telemetry from both)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  run dispatchrun '{"tool_input":{"file_path":"src/app.xyz"}}'
  [ "$status" -eq 0 ]
  grep -q '"hook":"format"' "$REPO/.claude/telemetry/events.jsonl"
  grep -q '"hook":"lint"'   "$REPO/.claude/telemetry/events.jsonl"
}

@test "post-edit-dispatch: ≤2 git spawns per edit (AC3 regression — was 1 per hook)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  REAL_GIT=$(command -v git)
  mkdir -p "$BATS_TEST_TMPDIR/fakebin"
  cat > "$BATS_TEST_TMPDIR/fakebin/git" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$BATS_TEST_TMPDIR/git-calls.log"
exec "$REAL_GIT" "\$@"
EOF
  chmod +x "$BATS_TEST_TMPDIR/fakebin/git"
  PATH="$BATS_TEST_TMPDIR/fakebin:$PATH" run dispatchrun '{"tool_input":{"file_path":"src/app.ts"}}'
  [ "$status" -eq 0 ]
  calls=$(grep -c . "$BATS_TEST_TMPDIR/git-calls.log")
  [ "$calls" -le 2 ]
}

@test "post-edit-dispatch: per-hook disable gates still honoured (AC2)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  CLAUDE_DISABLED_HOOKS=format run dispatchrun '{"tool_input":{"file_path":"src/app.xyz"}}'
  [ "$status" -eq 0 ]
  ! grep -q '"hook":"format"' "$REPO/.claude/telemetry/events.jsonl"
  grep -q '"hook":"lint"' "$REPO/.claude/telemetry/events.jsonl"
}

@test "post-edit-dispatch: garbage stdin → fail-open exit 0" {
  run dispatchrun 'garbage{{{'
  [ "$status" -eq 0 ]
}

@test "auto-format: dispatcher env path matches stdin path behaviour" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  # Same event delivered both ways → same telemetry outcome, twice.
  run hookrun "$HOOKS/auto-format.sh" '{"tool_input":{"file_path":"a.xyz"}}'
  [ "$status" -eq 0 ]
  ( cd "$REPO" && CLAUDE_POSTEDIT_FILE="a.xyz" CLAUDE_POSTEDIT_ROOT="$REPO" \
      bash "$HOOKS/auto-format.sh" </dev/null )
  [ "$(grep -c '"hook":"format","outcome":"skipped"' "$REPO/.claude/telemetry/events.jsonl")" -eq 2 ]
}

# --- framework-drift-guard.sh (UserPromptSubmit) ---------------------

@test "drift-guard: disabled → emits empty object, exit 0" {
  CLAUDE_DISABLED_HOOKS=drift-guard run hookrun "$HOOKS/framework-drift-guard.sh" '{}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "drift-guard: empty In Progress section fires the no-task-claimed nudge" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  # Regression: the old grep matched the '### In Progress' heading itself,
  # so the count was never 0 and this indicator never fired (2026-06-10
  # external audit / self STATUS Known Issues).
  printf '## Feature Lane\n\n### In Progress\n\n### Todo (Priority Order)\n\n#### [TASK-001] queued work\n' > "$REPO/.claude/TASKS.md"
  printf '{"prompt_count":5,"last_reminder":5,"last_suggestions_reminder":5,"last_compact_reminder":5,"session_id":"s1"}' > "$REPO/.claude/.drift-state"
  run hookrun "$HOOKS/framework-drift-guard.sh" '{"session_id":"s1"}'
  [ "$status" -eq 0 ]
  [[ "$output" == *"No task is marked"* ]]
}

@test "drift-guard: claimed In Progress task → no no-task nudge" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  printf '## Feature Lane\n\n### In Progress\n\n#### [TASK-002] active work\n\n### Todo (Priority Order)\n' > "$REPO/.claude/TASKS.md"
  printf '{"prompt_count":5,"last_reminder":5,"last_suggestions_reminder":5,"last_compact_reminder":5,"session_id":"s1"}' > "$REPO/.claude/.drift-state"
  run hookrun "$HOOKS/framework-drift-guard.sh" '{"session_id":"s1"}'
  [ "$status" -eq 0 ]
  [[ "$output" != *"No task is marked"* ]]
}

@test "drift-guard: new session_id resets per-session prompt counters" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  # Lifetime-style stale state: with carry-over, prompt 101 vs reminder at
  # 92 would fire the every-8-prompts check-in. A new session_id must reset
  # the counters → first prompt of the new session stays quiet.
  printf '## Feature Lane\n\n### In Progress\n\n#### [TASK-002] active work\n' > "$REPO/.claude/TASKS.md"
  printf '{"prompt_count":100,"last_reminder":92,"last_suggestions_reminder":92,"last_compact_reminder":92,"session_id":"old"}' > "$REPO/.claude/.drift-state"
  run hookrun "$HOOKS/framework-drift-guard.sh" '{"session_id":"new"}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
  grep -qE '"session_id": ?"new"' "$REPO/.claude/.drift-state"
}

# --- enforce-state-update.sh (Stop) ----------------------------------

@test "enforce-state: disabled → exit 0 (no block)" {
  CLAUDE_DISABLED_HOOKS=enforce-state run hookrun "$HOOKS/enforce-state-update.sh" '{}'
  [ "$status" -eq 0 ]
}

@test "enforce-state: cost-tracker marker written on session end" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  # Fresh repo with no commits and no state-file changes: the state-enforce
  # path is short-circuited (COMMIT_COUNT=0 → exit 0), but the cost-tracker
  # marker still fires first. Assert the marker landed in temp telemetry.
  run hookrun "$HOOKS/enforce-state-update.sh" '{"transcript_path":"/nonexistent.jsonl"}'
  [ "$status" -eq 0 ]
  grep -q '"hook":"cost-tracker"' "$REPO/.claude/telemetry/events.jsonl"
}

@test "enforce-state: blocks when state files untouched (control for the yield test)" {
  # A commit exists and no state file was touched → exit 2 (block).
  ( cd "$REPO" && touch code.txt && git add -A && git commit -qm seed )
  run hookrun "$HOOKS/enforce-state-update.sh" '{}'
  [ "$status" -eq 2 ]
}

@test "enforce-state: stop_hook_active → yields instead of re-blocking" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  # Same repo state as the control above WOULD block — but when Claude Code
  # re-fires the Stop hook after a block (stop_hook_active:true), the hook
  # must yield or a session with nothing to update loops forever.
  ( cd "$REPO" && touch code.txt && git add -A && git commit -qm seed )
  run hookrun "$HOOKS/enforce-state-update.sh" '{"stop_hook_active":true}'
  [ "$status" -eq 0 ]
}

@test "enforce-state: similarly-named file does NOT satisfy the check (DA-H7 regression)" {
  # Old unanchored grep let DEPLOY-STATUS.md satisfy "STATUS.md", and the
  # --oneline haystack let a commit MESSAGE mentioning TASKS.md count too.
  ( cd "$REPO" && touch DEPLOY-STATUS.md MY-TASKS.md the-claude-progress.txt \
    && git add -A && git commit -qm 'updates TASKS.md STATUS.md claude-progress.txt (message only)' )
  run hookrun "$HOOKS/enforce-state-update.sh" '{}'
  [ "$status" -eq 2 ]
}

@test "enforce-state: real state-file paths satisfy the check (DA-H7 control)" {
  ( cd "$REPO" && mkdir -p .claude && touch .claude/TASKS.md .claude/STATUS.md .claude/claude-progress.txt \
    && git add -A && git commit -qm seed )
  run hookrun "$HOOKS/enforce-state-update.sh" '{}'
  [ "$status" -eq 0 ]
}

# --- telemetry schema v2 (TASK-021, contract:telemetry-schema) --------
# session_id (trace root) / tool_use_id (tool-call span) from the hook
# payload; event_id + outcome_class on every line; v1 readers unaffected.

@test "telemetry v2: drift-guard event carries session_id, event_id, outcome_class" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  printf '## Feature Lane\n\n### In Progress\n\n#### [TASK-002] active work\n' > "$REPO/.claude/TASKS.md"
  run hookrun "$HOOKS/framework-drift-guard.sh" '{"session_id":"sess-21"}'
  [ "$status" -eq 0 ]
  line=$(grep '"hook":"drift-guard"' "$REPO/.claude/telemetry/events.jsonl" | tail -1)
  echo "$line" | jq -e '.schema == 2 and .session_id == "sess-21" and (.event_id | length > 0) and (.outcome_class | IN("ok","flagged"))'
}

@test "telemetry v2: dispatcher propagates session_id AND tool_use_id to dispatched hooks" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  run dispatchrun '{"session_id":"sess-d","tool_use_id":"tu-1","tool_input":{"file_path":"src/app.xyz"}}'
  [ "$status" -eq 0 ]
  line=$(grep '"hook":"format"' "$REPO/.claude/telemetry/events.jsonl" | tail -1)
  echo "$line" | jq -e '.session_id == "sess-d" and .tool_use_id == "tu-1" and .outcome_class == "skipped"'
}

@test "telemetry v2: bash-guard block carries session_id and outcome_class blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"session_id":"sess-py","tool_input":{"command":"rm -rf /"}}'
  [ "$status" -eq 2 ]
  grep -E '"session_id": ?"sess-py"' "$REPO/.claude/telemetry/events.jsonl" \
    | grep -qE '"outcome_class": ?"blocked"'
}

@test "telemetry v2: stop block event carries session_id and outcome_class blocked" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  ( cd "$REPO" && touch code.txt && git add -A && git commit -qm seed )
  run hookrun "$HOOKS/enforce-state-update.sh" '{"session_id":"sess-s"}'
  [ "$status" -eq 2 ]
  line=$(grep '"hook":"stop"' "$REPO/.claude/telemetry/events.jsonl" | tail -1)
  echo "$line" | jq -e '.session_id == "sess-s" and .outcome_class == "blocked" and (.missing | length > 0)'
}

@test "telemetry v2: emitted lines parse strictly — no raw CR in JSON strings (CRLF regression)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  # git-bash jq emits CRLF on -r; unstripped, the \r landed INSIDE the
  # session_id/tool_use_id JSON strings and made the line unparseable
  # (caught live on the first v2 emit). Strict whole-file parse is the pin.
  run dispatchrun '{"session_id":"sess-crlf","tool_use_id":"tu-crlf","tool_input":{"file_path":"src/app.xyz"}}'
  [ "$status" -eq 0 ]
  jq -se 'length >= 1' "$REPO/.claude/telemetry/events.jsonl"
}
