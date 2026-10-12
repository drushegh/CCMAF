#!/usr/bin/env bats
# fix-U14.bats — regression tests for the core-plugin hook fixes from the
# deep review (unit U14): unattended Monitor bypass, `&` in the plugin
# root, one project root (CLAUDE_PROJECT_DIR) across core hooks, the Stop
# gate's dirty-before-session filter, drift-guard Indicator 3, and
# session-scoped budget markers.

load helpers

CORE="$FW_REPO_ROOT/plugins/ccmaf"

setup() {
  [ -d "$CORE" ] || skip "plugins/ccmaf not present"
  init_repo
}

# corehook <script-rel-path> <json> [project-dir] — run a core hook with
# CLAUDE_PLUGIN_ROOT/CLAUDE_PROJECT_DIR set; cwd = project dir.
corehook() {
  local pd="${3:-$REPO}"
  printf '%s' "$2" > "$BATS_TEST_TMPDIR/event.json"
  ( cd "$pd" && CLAUDE_PLUGIN_ROOT="$CORE" CLAUDE_PROJECT_DIR="$pd" \
      bash "$CORE/$1" < "$BATS_TEST_TMPDIR/event.json" )
}

critical_flag() { # critical_flag <project-dir>
  printf '# Doctor\n\n**Findings:** 1 CRITICAL\n' > "$1/.claude/.framework-doctor-findings.md"
}

seed_state_commit() {
  ( cd "$REPO" && touch .claude/TASKS.md .claude/STATUS.md .claude/claude-progress.txt code.txt \
    && git add -A && git commit -qm seed )
}

# ---------- unattended-guard: Monitor is not a read-only tool ----------

@test "U14 unattended-guard halt: Monitor (runs shell commands) is denied" {
  mark_ccmaf_v2
  critical_flag "$REPO"
  printf '%s' '{"session_id":"s","tool_name":"Monitor","tool_input":{"command":"rm -rf x"}}' > "$BATS_TEST_TMPDIR/event.json"
  run bash -c "cd '$REPO' && CLAUDE_PLUGIN_ROOT='$CORE' CLAUDE_PROJECT_DIR='$REPO' CLAUDE_UNATTENDED=1 bash '$CORE/hooks/unattended-guard.sh' < '$BATS_TEST_TMPDIR/event.json'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"UNATTENDED HALT"* ]]
}

# ---------- core-context: `&` in the install path ----------

@test "U14 core-context: an '&' in CLAUDE_PLUGIN_ROOT is substituted literally" {
  mark_ccmaf_v2
  local amp="$BATS_TEST_TMPDIR/a&b"
  mkdir -p "$amp/hooks/lib" "$amp/boot"
  cp "$CORE/hooks/core-context.sh" "$amp/hooks/"
  cp "$CORE/hooks/lib/hook-common.sh" "$amp/hooks/lib/"
  printf 'root=${CLAUDE_PLUGIN_ROOT}/x\n' > "$amp/DIGEST.md"
  printf '%s' '{"source":"startup"}' > "$BATS_TEST_TMPDIR/event.json"
  run bash -c "cd '$REPO' && CLAUDE_PLUGIN_ROOT='$amp' CLAUDE_PROJECT_DIR='$REPO' bash '$amp/hooks/core-context.sh' < '$BATS_TEST_TMPDIR/event.json'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"root=$amp/x"* ]]
  [[ "$output" != *'root=${CLAUDE_PLUGIN_ROOT}'* ]]
}

@test "U14 core-context: substitution under BASH_COMPAT=42 (macOS bash 3.2 quoting) has no stray quotes" {
  mark_ccmaf_v2
  local amp="$BATS_TEST_TMPDIR/a&b"
  mkdir -p "$amp/hooks/lib" "$amp/boot"
  cp "$CORE/hooks/core-context.sh" "$amp/hooks/"
  cp "$CORE/hooks/lib/hook-common.sh" "$amp/hooks/lib/"
  printf 'x ${CLAUDE_PLUGIN_ROOT} y ${CLAUDE_PLUGIN_ROOT}/z\n' > "$amp/DIGEST.md"
  printf '%s' '{"source":"startup"}' > "$BATS_TEST_TMPDIR/event.json"
  run bash -c "cd '$REPO' && CLAUDE_PLUGIN_ROOT='$amp' CLAUDE_PROJECT_DIR='$REPO' BASH_COMPAT=42 bash '$amp/hooks/core-context.sh' < '$BATS_TEST_TMPDIR/event.json'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"x $amp y $amp/z"* ]]
  [[ "$output" != *"\"$amp"* ]]
  [[ "$output" != *'${CLAUDE_PLUGIN_ROOT}'* ]]
}

# ---------- one root: nested project inside a larger git repo ----------

@test "U14 nested project: session marker + halt exemption use CLAUDE_PROJECT_DIR, not the git toplevel" {
  local sub="$REPO/sub"
  mkdir -p "$sub/.claude"
  printf 'FRAMEWORK_LINE=v2\n' > "$sub/.claude/.framework-version"
  ( cd "$REPO" && touch top.txt && git add -A && git commit -qm seed )
  run corehook hooks/session-start-marker.sh '{"session_id":"n1"}' "$sub"
  [ "$status" -eq 0 ]
  [ -f "$sub/.claude/.session-start-commit.n1" ]
  [ ! -f "$REPO/.claude/.session-start-commit.n1" ]
  # marker format: sha, then started=<epoch>
  [ "$(head -n 1 "$sub/.claude/.session-start-commit.n1")" = "$(git -C "$REPO" rev-parse HEAD)" ]
  grep -Eq '^started=[0-9]+$' "$sub/.claude/.session-start-commit.n1"
  # Halt exemption: halt + CRITICAL flag live in the PROJECT's .claude.
  printf 'halt\n' > "$sub/.claude/unattended-halt.md"
  critical_flag "$sub"
  printf '%s' '{"session_id":"n1"}' > "$BATS_TEST_TMPDIR/event.json"
  run bash -c "cd '$sub' && CLAUDE_PLUGIN_ROOT='$CORE' CLAUDE_PROJECT_DIR='$sub' CLAUDE_UNATTENDED=1 bash '$CORE/hooks/enforce-state-update.sh' < '$BATS_TEST_TMPDIR/event.json'"
  [ "$status" -eq 0 ]
}

@test "U14 checkpoint-watermark: throttle state persists without a git repo" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  local nogit="$BATS_TEST_TMPDIR/nogit"
  mkdir -p "$nogit/.claude"
  printf 'FRAMEWORK_LINE=v2\n' > "$nogit/.claude/.framework-version"
  run corehook hooks/checkpoint-watermark.sh '{"hook_event_name":"PostToolUse","session_id":"c1"}' "$nogit"
  [ "$status" -eq 0 ]
  [ -f "$nogit/.claude/.checkpoint-state" ]
  grep -q '^CKPT_SID=c1$' "$nogit/.claude/.checkpoint-state"
}

# ---------- Stop gate: state files dirty from an EARLIER session ----------

@test "U14 enforce-state (plugin): state files left dirty before this session do not satisfy the gate" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  mark_ccmaf_v2
  seed_state_commit
  # Earlier session dirtied the state files and never committed them.
  printf 'x\n' >> "$REPO/.claude/TASKS.md"
  printf 'x\n' >> "$REPO/.claude/STATUS.md"
  printf 'x\n' >> "$REPO/.claude/claude-progress.txt"
  touch -d '2 hours ago' "$REPO/.claude/TASKS.md" "$REPO/.claude/STATUS.md" "$REPO/.claude/claude-progress.txt"
  run corehook hooks/session-start-marker.sh '{"session_id":"d1"}'
  # Real work this session — without it the gate now skips (fleet audit C4b:
  # a session that changed no non-state file has nothing to record).
  printf 'y\n' >> "$REPO/code.txt"
  run corehook hooks/enforce-state-update.sh '{"session_id":"d1"}'
  [ "$status" -eq 2 ]
  [[ "$output" == *"STATE FILES NOT UPDATED"* ]]
  # Touching them THIS session satisfies it.
  touch "$REPO/.claude/TASKS.md" "$REPO/.claude/STATUS.md" "$REPO/.claude/claude-progress.txt"
  run corehook hooks/enforce-state-update.sh '{"session_id":"d1"}'
  [ "$status" -eq 0 ]
}

@test "U14 enforce-state (v1): state files left dirty before this session do not satisfy the gate" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  seed_state_commit
  printf 'x\n' >> "$REPO/.claude/TASKS.md"
  printf 'x\n' >> "$REPO/.claude/STATUS.md"
  printf 'x\n' >> "$REPO/.claude/claude-progress.txt"
  touch -d '2 hours ago' "$REPO/.claude/TASKS.md" "$REPO/.claude/STATUS.md" "$REPO/.claude/claude-progress.txt"
  git -C "$REPO" rev-parse HEAD > "$REPO/.claude/.session-start-commit.v1s"
  run hookrun "$HOOKS/enforce-state-update.sh" '{"session_id":"v1s"}'
  [ "$status" -eq 2 ]
  touch "$REPO/.claude/TASKS.md" "$REPO/.claude/STATUS.md" "$REPO/.claude/claude-progress.txt"
  run hookrun "$HOOKS/enforce-state-update.sh" '{"session_id":"v1s"}'
  [ "$status" -eq 0 ]
}

@test "U14 enforce-state (plugin): Stop refreshes its own marker so the 7-day prune spares a live session" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  mark_ccmaf_v2
  seed_state_commit
  run corehook hooks/session-start-marker.sh '{"session_id":"live"}'
  touch -d '5 days ago' "$REPO/.claude/.session-start-commit.live"
  run corehook hooks/enforce-state-update.sh '{"session_id":"live"}'
  # mtime refreshed (liveness) — find sees it as < 1 day old.
  [ -n "$(find "$REPO/.claude" -maxdepth 1 -name '.session-start-commit.live' -mtime -1)" ]
  # Another session's start does not prune it.
  run corehook hooks/session-start-marker.sh '{"session_id":"other"}'
  [ -f "$REPO/.claude/.session-start-commit.live" ]
}

# ---------- drift-guard Indicator 3 ----------

@test "U14 drift-guard: the commented [BUG-XXX] template on an empty board does not nag" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  mark_ccmaf_v2
  cp "$CORE/templates/TASKS.md" "$REPO/.claude/TASKS.md"
  ( cd "$REPO" && git add -A && git commit -qm seed )
  for _ in 1 2 3 4 5; do
    run corehook hooks/framework-drift-guard.sh '{"session_id":"e1"}'
  done
  [[ "$output" != *"No task is marked"* ]]
}

@test "U14 drift-guard: a bug under ### Fixing counts as claimed" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  mark_ccmaf_v2
  printf '### In Progress\n\n### Todo\n\n#### [TASK-1] a\n\n### Fixing\n\n#### [BUG-7] b\n' > "$REPO/.claude/TASKS.md"
  ( cd "$REPO" && git add -A && git commit -qm seed )
  for _ in 1 2 3 4 5; do
    run corehook hooks/framework-drift-guard.sh '{"session_id":"f1"}'
  done
  [[ "$output" != *"No task is marked"* ]]
}

@test "U14 drift-guard: the no-claim nag is throttled and no longer starves the check-in" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  mark_ccmaf_v2
  printf '### In Progress\n\n### Todo\n\n#### [TASK-1] a\n' > "$REPO/.claude/TASKS.md"
  ( cd "$REPO" && git add -A && git commit -qm seed )
  local nags=0 checkin=0
  for _ in $(seq 1 12); do
    run corehook hooks/framework-drift-guard.sh '{"session_id":"t1"}'
    [[ "$output" == *"No task is marked"* ]] && nags=$((nags + 1))
    [[ "$output" == *"Framework check-in"* ]] && checkin=$((checkin + 1))
  done
  [ "$nags" -eq 2 ]      # prompt 4, then prompt 12 (8-turn throttle)
  [ "$checkin" -ge 1 ]   # Indicator 2 is reachable again
}

# ---------- budget counter: session-scoped markers ----------

@test "U14 budget counter: another session's orphaned marker is neither counted nor nagged" {
  mark_ccmaf_v2
  printf 'class=S\n' > "$REPO/.claude/telemetry/.task-dispatch.TASK-5"
  run corehook hooks/task-budget-counter.sh '{"session_id":"owner","tool_name":"Bash"}'
  [ "$status" -eq 0 ]
  [ "$(cat "$REPO/.claude/telemetry/.task-count.TASK-5")" = "1" ]
  printf '14' > "$REPO/.claude/telemetry/.task-count.TASK-5"
  run corehook hooks/task-budget-counter.sh '{"session_id":"later","tool_name":"Bash"}'
  [ "$status" -eq 0 ]
  [ "$(cat "$REPO/.claude/telemetry/.task-count.TASK-5")" = "14" ]
  # The owning session still counts (and nags at 15).
  run corehook hooks/task-budget-counter.sh '{"session_id":"owner","tool_name":"Bash"}'
  [ "$status" -eq 2 ]
  [[ "$output" == *"[TASK-5] 15 tool calls"* ]]
}

@test "U14 budget counter: owner stamp is dropped once its marker is gone" {
  mark_ccmaf_v2
  printf 'class=S\n' > "$REPO/.claude/telemetry/.task-dispatch.TASK-6"
  run corehook hooks/task-budget-counter.sh '{"session_id":"a"}'
  [ -f "$REPO/.claude/telemetry/.task-owner.TASK-6" ]
  rm -f "$REPO/.claude/telemetry/.task-dispatch.TASK-6"
  run corehook hooks/task-budget-counter.sh '{"session_id":"b"}'
  [ ! -f "$REPO/.claude/telemetry/.task-owner.TASK-6" ]
}

# ---------- publish: exec bit carried across ----------

@test "U14 publish: _copy_normalized keeps the source exec bit" {
  [ -f "$FW_REPO_ROOT/tools/publish.sh" ] || skip "tools/publish.sh is dev-repo only"
  [ "$(uname -s | cut -c1-5)" != "MINGW" ] && [ "$(uname -s | cut -c1-4)" != "MSYS" ] || skip "exec bits not modelled on Git Bash"
  local fn
  fn=$(sed -n '/^_copy_normalized() {/,/^}/p' "$FW_REPO_ROOT/tools/publish.sh")
  eval "$fn"
  printf '#!/bin/sh\necho hi\r\n' > "$BATS_TEST_TMPDIR/src.sh"
  chmod +x "$BATS_TEST_TMPDIR/src.sh"
  _copy_normalized "$BATS_TEST_TMPDIR/src.sh" "$BATS_TEST_TMPDIR/out/dst.sh"
  [ -x "$BATS_TEST_TMPDIR/out/dst.sh" ]
  ! grep -q $'\r' "$BATS_TEST_TMPDIR/out/dst.sh" || false
}

@test "U14 publish: a dir mirror ships only TRACKED files (untracked + ignored are skipped)" {
  [ -f "$FW_REPO_ROOT/tools/publish.sh" ] || skip "tools/publish.sh is dev-repo only"
  local fn PROJECT_ROOT target
  for fn in _copy_normalized _tracked_files _apply_dir _report_dir _files_differ; do
    eval "$(sed -n "/^$fn() {/,/^}/p" "$FW_REPO_ROOT/tools/publish.sh")"
  done
  PROJECT_ROOT="$BATS_TEST_TMPDIR/dev"
  target="$BATS_TEST_TMPDIR/pub"
  mkdir -p "$PROJECT_ROOT/d/__pycache__" "$target"
  git -C "$PROJECT_ROOT" init -q
  git -C "$PROJECT_ROOT" config user.email test@example.com
  git -C "$PROJECT_ROOT" config user.name test
  git -C "$PROJECT_ROOT" config commit.gpgsign false
  printf '__pycache__/\n*.pyc\n' > "$PROJECT_ROOT/.gitignore"
  echo tracked > "$PROJECT_ROOT/d/a.txt"
  git -C "$PROJECT_ROOT" add -A && git -C "$PROJECT_ROOT" commit -qm base
  echo scratch > "$PROJECT_ROOT/d/b.txt"
  echo bytecode > "$PROJECT_ROOT/d/__pycache__/x.pyc"
  echo bytecode > "$PROJECT_ROOT/d/y.pyc"
  run _report_dir d
  [[ "$output" == *"+ d/a.txt"* ]]
  [[ "$output" != *"b.txt"* ]]
  [[ "$output" != *".pyc"* ]]
  _apply_dir d >/dev/null
  [ -f "$target/d/a.txt" ]
  [ ! -e "$target/d/b.txt" ]
  [ ! -e "$target/d/__pycache__" ]
  [ ! -e "$target/d/y.pyc" ]
}
