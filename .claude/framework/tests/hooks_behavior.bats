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

# --- block-dangerous: structural-guard coverage added by the hardening ---
# (d8c7f13 replaced raw-text substring checks with quote-aware, program-
# position matching). Audtor 2026-07-02 M1 residual (b): the fixtures
# above already covered the `rm` program-position logic that predates
# d8c7f13; these pin d8c7f13's two directions: (1) a scary PHRASE living in
# text that is never actually run as a command must NOT block, and (2) the
# new non-rm destructive-tool coverage (disk writers, formatters, fork
# bombs) must block.

@test "block-dangerous: a commit message merely MENTIONING a dangerous phrase is allowed" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"git commit -m \"fix: never run rm -rf / again\""}}'
  [ "$status" -eq 0 ]
}

@test "block-dangerous: a heredoc writing a SQL file containing DROP TABLE is allowed" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"cat <<SQL > migration.sql\nDROP TABLE users;\nSQL"}}'
  [ "$status" -eq 0 ]
}

@test "block-dangerous: a quoted argument containing a dangerous phrase is allowed" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"echo \"format C: is destructive\" > notes.txt"}}'
  [ "$status" -eq 0 ]
}

@test "block-dangerous: rm -rf on a path merely containing a drive-root-like SUBSTRING is allowed" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"rm -rf /home/dev/C:-backup-notes"}}'
  [ "$status" -eq 0 ]
}

@test "block-dangerous: dd writing to a whole block device is blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"dd if=/dev/zero of=/dev/sda"}}'
  [ "$status" -eq 2 ]
}

@test "block-dangerous: dd writing to a partition WITHIN a file (not the whole disk) is allowed" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"dd if=/dev/zero of=disk-image.img bs=1M count=10"}}'
  [ "$status" -eq 0 ]
}

@test "block-dangerous: mkfs.ext4 on a whole device is blocked (mkfs.* dispatch)" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"mkfs.ext4 /dev/sda1"}}'
  [ "$status" -eq 2 ]
}

@test "block-dangerous: wipefs on a whole device is blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"wipefs -a /dev/sda"}}'
  [ "$status" -eq 2 ]
}

@test "block-dangerous: blkdiscard on a whole device is blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"blkdiscard /dev/nvme0n1"}}'
  [ "$status" -eq 2 ]
}

@test "block-dangerous: shred targeting a whole device is blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"shred -u /dev/sda"}}'
  [ "$status" -eq 2 ]
}

@test "block-dangerous: tee targeting a whole device is blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"echo hi | tee /dev/sda"}}'
  [ "$status" -eq 2 ]
}

@test "block-dangerous: a shell redirect straight into a whole block device is blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"echo hi > /dev/sda"}}'
  [ "$status" -eq 2 ]
}

@test "block-dangerous: Windows format aimed at a drive root is blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"format C:"}}'
  [ "$status" -eq 2 ]
}

@test "block-dangerous: Windows rd /s on a drive root is blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"rd /s /q C:\\"}}'
  [ "$status" -eq 2 ]
}

@test "block-dangerous: a fork bomb (arbitrary function name, structural match) is blocked" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"bomb(){ bomb|bomb& }; bomb"}}'
  [ "$status" -eq 2 ]
}

@test "block-dangerous: text merely MENTIONING a fork bomb in a quoted string is allowed" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"echo \"never write :(){ :|:& };: in prod\""}}'
  [ "$status" -eq 0 ]
}

# --- guard-interpreter-check.sh (SessionStart, M1 residual (a)) ---------
# The safety-net promise: when NO working Python interpreter is on PATH,
# block-dangerous-commands.py cannot run at all (settings.json's PreToolUse
# wrapper selects it), so this must warn LOUDLY instead of silently no-op.

@test "guard-interpreter-check: a working interpreter on PATH → silent, exit 0" {
  [ -n "$PYTHON" ] || skip "python not available"
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  run hookrun "$HOOKS/guard-interpreter-check.sh" '{"source":"startup"}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "guard-interpreter-check: no working interpreter on PATH → loud systemMessage + additionalContext warning" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  # A PATH with no python3/python at all, but jq/git/bash/mktemp still
  # present (the Windows-Store-alias-with-no-real-Python-installed scenario
  # this hook exists to catch).
  run env -i PATH="/c/Users/drushe/bin:/mingw64/bin:/usr/local/bin:/usr/bin:/bin" HOME="$HOME" \
    bash -c "cd '$REPO' && bash '$HOOKS/guard-interpreter-check.sh' <<< '{\"source\":\"startup\"}'"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '(.systemMessage | length > 0) and (.hookSpecificOutput.additionalContext | length > 0) and .hookSpecificOutput.hookEventName == "SessionStart"'
}

@test "guard-interpreter-check: disabled → empty object, exit 0 regardless of interpreter availability" {
  CLAUDE_DISABLED_HOOKS=guard-interpreter-check run hookrun "$HOOKS/guard-interpreter-check.sh" '{"source":"startup"}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "guard-interpreter-check: minimal profile does NOT silence it (safety tier)" {
  [ -n "$PYTHON" ] || skip "python not available"
  CLAUDE_HOOK_PROFILE=minimal run hookrun "$HOOKS/guard-interpreter-check.sh" '{"source":"startup"}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "guard-interpreter-check: garbage stdin → fail-open, no crash" {
  run hookrun "$HOOKS/guard-interpreter-check.sh" 'not json {{{'
  [ "$status" -eq 0 ]
}

# --- session-start-marker.sh (SessionStart) ------------------------------
# The marker is keyed per session (.session-start-commit.<session_id>) —
# a fixed repo-global name would let two CONCURRENT sessions on the same
# working directory overwrite each other's mark. No session_id in the
# payload → the legacy unsuffixed name (the coherent no-jq path).

@test "session-start-marker: writes the current HEAD sha, keyed by the payload's session_id" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  ( cd "$REPO" && touch code.txt && git add -A && git commit -qm seed )
  run hookrun "$HOOKS/session-start-marker.sh" '{"source":"startup","session_id":"sess-m1"}'
  [ "$status" -eq 0 ]
  head_sha=$( cd "$REPO" && git rev-parse HEAD )
  [ "$(tr -d '\r\n' < "$REPO/.claude/.session-start-commit.sess-m1")" = "$head_sha" ]
}

@test "session-start-marker: two different session_ids get DISTINCT markers (concurrent-session isolation)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  ( cd "$REPO" && touch code.txt && git add -A && git commit -qm seed )
  run hookrun "$HOOKS/session-start-marker.sh" '{"source":"startup","session_id":"sess-A"}'
  [ "$status" -eq 0 ]
  ( cd "$REPO" && touch more.txt && git add -A && git commit -qm second )
  run hookrun "$HOOKS/session-start-marker.sh" '{"source":"startup","session_id":"sess-B"}'
  [ "$status" -eq 0 ]
  [ -f "$REPO/.claude/.session-start-commit.sess-A" ]
  [ -f "$REPO/.claude/.session-start-commit.sess-B" ]
  # B started one commit later than A — the markers must differ, proving B
  # did not overwrite A's mark.
  a=$(tr -d '\r\n' < "$REPO/.claude/.session-start-commit.sess-A")
  b=$(tr -d '\r\n' < "$REPO/.claude/.session-start-commit.sess-B")
  [ "$a" != "$b" ]
}

@test "session-start-marker: no session_id in the payload → legacy unsuffixed marker" {
  ( cd "$REPO" && touch code.txt && git add -A && git commit -qm seed )
  run hookrun "$HOOKS/session-start-marker.sh" '{"source":"startup"}'
  [ "$status" -eq 0 ]
  head_sha=$( cd "$REPO" && git rev-parse HEAD )
  [ "$(tr -d '\r\n' < "$REPO/.claude/.session-start-commit")" = "$head_sha" ]
}

@test "session-start-marker: a hostile session_id is sanitised (marker stays inside .claude)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  ( cd "$REPO" && touch code.txt && git add -A && git commit -qm seed )
  run hookrun "$HOOKS/session-start-marker.sh" '{"source":"startup","session_id":"../../escape/attempt"}'
  [ "$status" -eq 0 ]
  # Path separators are stripped by the [A-Za-z0-9._-] filter — whatever
  # was written must live directly in .claude/, and nothing above it.
  [ ! -e "$REPO/../escape" ]
  ls "$REPO/.claude"/.session-start-commit* >/dev/null 2>&1
}

@test "session-start-marker: stale suffixed markers (>3 days) are pruned at SessionStart" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  ( cd "$REPO" && touch code.txt && git add -A && git commit -qm seed )
  echo stale > "$REPO/.claude/.session-start-commit.dead-session"
  touch -d '10 days ago' "$REPO/.claude/.session-start-commit.dead-session"
  run hookrun "$HOOKS/session-start-marker.sh" '{"source":"startup","session_id":"sess-live"}'
  [ "$status" -eq 0 ]
  [ ! -f "$REPO/.claude/.session-start-commit.dead-session" ]
  [ -f "$REPO/.claude/.session-start-commit.sess-live" ]
}

@test "session-start-marker: no commits yet → no marker written, exit 0" {
  run hookrun "$HOOKS/session-start-marker.sh" '{"source":"startup"}'
  [ "$status" -eq 0 ]
  [ ! -f "$REPO/.claude/.session-start-commit" ]
}

@test "session-start-marker: disabled → no marker written, exit 0" {
  ( cd "$REPO" && touch code.txt && git add -A && git commit -qm seed )
  CLAUDE_DISABLED_HOOKS=session-start-marker run hookrun "$HOOKS/session-start-marker.sh" '{"source":"startup"}'
  [ "$status" -eq 0 ]
  [ ! -f "$REPO/.claude/.session-start-commit" ]
}

@test "session-start-marker: garbage stdin → fail-open, still writes the (legacy) marker" {
  ( cd "$REPO" && touch code.txt && git add -A && git commit -qm seed )
  run hookrun "$HOOKS/session-start-marker.sh" 'not json {{{'
  [ "$status" -eq 0 ]
  [ -f "$REPO/.claude/.session-start-commit" ]
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

@test "auto-format: an edit under console/ (nested npm root) triggers the formatter via the NEAREST package.json (Audtor 2026-07-02 minor)" {
  # Regression: auto-format.sh used to gate on a repo-ROOT package.json,
  # which this framework's own layout never has (the real npm root is
  # console/) — the gate was silently dead for exactly this repo. Prove
  # the fix by intercepting npx with a fake binary that records its cwd.
  mkdir -p "$REPO/console/src"
  echo '{"name":"fixture"}' > "$REPO/console/package.json"
  printf 'const x=1\n' > "$REPO/console/src/app.ts"
  mkdir -p "$BATS_TEST_TMPDIR/fakebin"
  cat > "$BATS_TEST_TMPDIR/fakebin/npx" <<EOF
#!/bin/sh
printf 'cwd=%s args=%s\n' "\$PWD" "\$*" >> "$BATS_TEST_TMPDIR/npx-calls.log"
exit 0
EOF
  chmod +x "$BATS_TEST_TMPDIR/fakebin/npx"
  PATH="$BATS_TEST_TMPDIR/fakebin:$PATH" run hookrun "$HOOKS/auto-format.sh" \
    "{\"tool_input\":{\"file_path\":\"$REPO/console/src/app.ts\"}}"
  [ "$status" -eq 0 ]
  grep -q "cwd=$REPO/console" "$BATS_TEST_TMPDIR/npx-calls.log"
  grep -q "prettier" "$BATS_TEST_TMPDIR/npx-calls.log"
  grep -q "$REPO/console/src/app.ts" "$BATS_TEST_TMPDIR/npx-calls.log"
}

@test "auto-lint: an edit under console/ (nested npm root) triggers eslint via the NEAREST package.json" {
  mkdir -p "$REPO/console/src" "$REPO/console/node_modules/.bin"
  echo '{"name":"fixture"}' > "$REPO/console/package.json"
  printf 'const x=1\n' > "$REPO/console/src/app.ts"
  touch "$REPO/console/node_modules/.bin/eslint"
  mkdir -p "$BATS_TEST_TMPDIR/fakebin"
  cat > "$BATS_TEST_TMPDIR/fakebin/npx" <<EOF
#!/bin/sh
printf 'cwd=%s args=%s\n' "\$PWD" "\$*" >> "$BATS_TEST_TMPDIR/npx-calls.log"
exit 0
EOF
  chmod +x "$BATS_TEST_TMPDIR/fakebin/npx"
  PATH="$BATS_TEST_TMPDIR/fakebin:$PATH" run hookrun "$HOOKS/auto-lint.sh" \
    "{\"tool_input\":{\"file_path\":\"$REPO/console/src/app.ts\"}}"
  [ "$status" -eq 0 ]
  grep -q "cwd=$REPO/console" "$BATS_TEST_TMPDIR/npx-calls.log"
  grep -q "eslint" "$BATS_TEST_TMPDIR/npx-calls.log"
}

@test "auto-format: no package.json anywhere in range → still skips cleanly, exit 0" {
  mkdir -p "$REPO/orphan/src"
  printf 'const x=1\n' > "$REPO/orphan/src/app.ts"
  run hookrun "$HOOKS/auto-format.sh" "{\"tool_input\":{\"file_path\":\"$REPO/orphan/src/app.ts\"}}"
  [ "$status" -eq 0 ]
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

# --- enforce-state: session-scoped gate (Audtor 2026-07-02 minor) -------
# The old check was a blind repo-wide `git log -5` with no session
# boundary — a PRIOR session's state-file commit could silently satisfy
# the CURRENT session's gate if it landed within the last 5 commits.
# session-start-marker.sh (SessionStart) stamps HEAD into
# .claude/.session-start-commit.<session_id>; these pin that only commits
# AFTER OUR OWN session's mark count as "this session"'s work. Tests
# using the unsuffixed marker + a payload with no session_id exercise the
# legacy/no-jq path, which must keep working identically.

@test "enforce-state: a PRIOR session's state commit does NOT satisfy the CURRENT session's gate (per-session marker)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  ( cd "$REPO" && mkdir -p .claude && touch .claude/TASKS.md .claude/STATUS.md .claude/claude-progress.txt \
    && git add -A && git commit -qm "prior session: state update" )
  # SessionStart marker for THIS session (sess-cur) set to HEAD — the
  # session starts here, with nothing done yet.
  git -C "$REPO" rev-parse HEAD > "$REPO/.claude/.session-start-commit.sess-cur"
  ( cd "$REPO" && touch code2.txt && git add -A && git commit -qm "this session: code only" )
  run hookrun "$HOOKS/enforce-state-update.sh" '{"session_id":"sess-cur"}'
  [ "$status" -eq 2 ]
}

@test "enforce-state: session A's gate is NOT satisfied via session B's marker (concurrent-session isolation)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  # Two concurrent sessions, one working directory. Session B started at
  # HEAD after a state commit; a code-only commit followed. Under B's OWN
  # marker the gate must block (nothing state-ish since B began). Under
  # session A — which has NO marker — the hook must NOT borrow B's marker:
  # it falls back to the repo-wide -5 window (which still contains the
  # state commit) and passes. A block here would prove A wrongly read B's
  # scope; a pass proves the isolation plus the documented fail-open.
  ( cd "$REPO" && mkdir -p .claude && touch .claude/TASKS.md .claude/STATUS.md .claude/claude-progress.txt \
    && git add -A && git commit -qm "state update before B started" )
  git -C "$REPO" rev-parse HEAD > "$REPO/.claude/.session-start-commit.sess-B"
  ( cd "$REPO" && touch code.txt && git add -A && git commit -qm "code only after B start" )
  run hookrun "$HOOKS/enforce-state-update.sh" '{"session_id":"sess-B"}'
  [ "$status" -eq 2 ]
  run hookrun "$HOOKS/enforce-state-update.sh" '{"session_id":"sess-A"}'
  [ "$status" -eq 0 ]
}

@test "enforce-state: no marker for THIS session_id → fail-open to the repo-wide window" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  ( cd "$REPO" && mkdir -p .claude && touch .claude/TASKS.md .claude/STATUS.md .claude/claude-progress.txt \
    && git add -A && git commit -qm seed )
  # A different session's marker exists; ours does not.
  git -C "$REPO" rev-parse HEAD > "$REPO/.claude/.session-start-commit.sess-other"
  [ ! -f "$REPO/.claude/.session-start-commit.sess-mine" ]
  run hookrun "$HOOKS/enforce-state-update.sh" '{"session_id":"sess-mine"}'
  [ "$status" -eq 0 ]
}

@test "enforce-state: ZERO commits since a VALID marker must still block (not fall back to the prior-session window)" {
  # Edge case: the session-scoped result (commits since marker) is
  # legitimately EMPTY because this session hasn't committed anything yet
  # — that must NOT be treated the same as "the marker failed to resolve"
  # and fall back to the repo-wide window, which would silently re-admit
  # the prior session's state commit this fix exists to exclude.
  ( cd "$REPO" && mkdir -p .claude && touch .claude/TASKS.md .claude/STATUS.md .claude/claude-progress.txt \
    && git add -A && git commit -qm "prior session: state update" )
  git -C "$REPO" rev-parse HEAD > "$REPO/.claude/.session-start-commit"
  run hookrun "$HOOKS/enforce-state-update.sh" '{}'
  [ "$status" -eq 2 ]
}

@test "enforce-state: a commit AFTER the session marker DOES satisfy the gate" {
  ( cd "$REPO" && touch code.txt && git add -A && git commit -qm seed )
  git -C "$REPO" rev-parse HEAD > "$REPO/.claude/.session-start-commit"
  ( cd "$REPO" && mkdir -p .claude && touch .claude/TASKS.md .claude/STATUS.md .claude/claude-progress.txt \
    && git add -A && git commit -qm "this session: state update" )
  run hookrun "$HOOKS/enforce-state-update.sh" '{}'
  [ "$status" -eq 0 ]
}

@test "enforce-state: an invalid/unrecognisable session marker falls back to the repo-wide window (fail-open)" {
  ( cd "$REPO" && touch code.txt && git add -A && git commit -qm seed )
  echo "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" > "$REPO/.claude/.session-start-commit"
  run hookrun "$HOOKS/enforce-state-update.sh" '{}'
  [ "$status" -eq 2 ]
}

@test "enforce-state: no session marker at all → falls back to the repo-wide window (unchanged legacy behaviour)" {
  ( cd "$REPO" && mkdir -p .claude && touch .claude/TASKS.md .claude/STATUS.md .claude/claude-progress.txt \
    && git add -A && git commit -qm seed )
  [ ! -f "$REPO/.claude/.session-start-commit" ]
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
