#!/usr/bin/env bats
# audit-B-hook-noise.bats — fleet audit 2026-10-12, WP2 hook noise (unit B):
#   C3 task-budget-counter: wave-level nags while parallel, telemetry on nags
#   C4 enforce-state-update: untracked state files, no-work / post-compact skip
#   C5 framework-drift-guard: Indicator 1 throttle, dead 01_Project/ default

load helpers

CORE="$FW_REPO_ROOT/plugins/ccmaf"

setup() {
  [ -d "$CORE" ] || skip "plugins/ccmaf not present"
  init_repo
  mark_ccmaf_v2
}

corehook() { # corehook <script-rel-path> <json>
  printf '%s' "$2" > "$BATS_TEST_TMPDIR/event.json"
  ( cd "$REPO" && CLAUDE_PLUGIN_ROOT="$CORE" CLAUDE_PROJECT_DIR="$REPO" \
      bash "$CORE/$1" < "$BATS_TEST_TMPDIR/event.json" )
}

arm() { printf 'class=%s\n' "$2" > "$REPO/.claude/telemetry/.task-dispatch.$1"; }
count() { printf '%s' "$2" > "$REPO/.claude/telemetry/.task-count.$1"; }

# ---------- C3 task-budget-counter ----------

@test "C3: two armed tasks — per-call nags suppressed below 2x budget" {
  arm TASK-1 S; arm TASK-2 S
  count TASK-1 29; count TASK-2 14   # single-task mode would nag at 30 and 15
  run corehook hooks/task-budget-counter.sh '{"session_id":"w1"}'
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ "$(cat "$REPO/.claude/telemetry/.task-count.TASK-1")" = "30" ]
  [ "$(cat "$REPO/.claude/telemetry/.task-count.TASK-2")" = "15" ]
}

@test "C3: one wave-level nag at 2x and one at 4x, each once, with telemetry" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  arm TASK-1 S; arm TASK-2 S
  count TASK-1 59; count TASK-2 5
  run corehook hooks/task-budget-counter.sh '{"session_id":"w1"}'
  [ "$status" -eq 2 ]
  [[ "$output" == *"[wave] 2 tasks in flight; 60 tool calls"* ]]
  [[ "$output" == *"2x"* ]]
  [[ "$output" != *"[TASK-"* ]]
  run corehook hooks/task-budget-counter.sh '{"session_id":"w1"}'
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  count TASK-1 119
  run corehook hooks/task-budget-counter.sh '{"session_id":"w1"}'
  [ "$status" -eq 2 ]
  [[ "$output" == *"4x"* ]]
  run corehook hooks/task-budget-counter.sh '{"session_id":"w1"}'
  [ "$status" -eq 0 ]
  n=$(jq -s '[.[] | select(.hook=="task-budget" and .detail.wave==true)] | length' "$REPO/.claude/telemetry/events.jsonl")
  [ "$n" -eq 2 ]
  jq -s -e '[.[] | select(.hook=="task-budget")][1] | .detail.level==4 and .detail.armed==2 and .session_id=="w1"' "$REPO/.claude/telemetry/events.jsonl"
}

@test "C3: wave state clears when the wave drops to one task; single-task nags resume" {
  arm TASK-1 S; arm TASK-2 S
  count TASK-1 59
  run corehook hooks/task-budget-counter.sh '{"session_id":"w1"}'
  [ "$status" -eq 2 ]
  [ -f "$REPO/.claude/telemetry/.task-wave.w1" ]
  rm -f "$REPO/.claude/telemetry/.task-dispatch.TASK-1"
  count TASK-2 14
  run corehook hooks/task-budget-counter.sh '{"session_id":"w1"}'
  [ "$status" -eq 2 ]
  [[ "$output" == *"[TASK-2] 15 tool calls"* ]]
  [ ! -f "$REPO/.claude/telemetry/.task-wave.w1" ]
}

@test "C3: single-task nag unchanged and emits a task-budget telemetry event" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  arm TASK-9 S; count TASK-9 14
  run corehook hooks/task-budget-counter.sh '{"session_id":"s1"}'
  [ "$status" -eq 2 ]
  [[ "$output" == *"[TASK-9] 15 tool calls against budget S=30"* ]]
  jq -s -e '[.[] | select(.hook=="task-budget")][0] | .detail.task=="TASK-9" and .detail.count==15 and .detail.budget==30 and .outcome=="nagged" and .outcome_class=="flagged"' \
    "$REPO/.claude/telemetry/events.jsonl"
}

# ---------- C4 enforce-state-update ----------

seed() { # tracked code + (optionally) tracked state files, one commit
  ( cd "$REPO" && touch code.txt && { [ "${1:-}" = nostate ] || touch .claude/TASKS.md .claude/STATUS.md .claude/claude-progress.txt; } \
    && git add code.txt .claude && git commit -qm seed )
}

@test "C4a: brand-new UNTRACKED state files satisfy the gate" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  seed nostate
  corehook hooks/session-start-marker.sh '{"session_id":"u1"}' >/dev/null
  printf 'work\n' >> "$REPO/code.txt"
  run corehook hooks/enforce-state-update.sh '{"session_id":"u1"}'
  [ "$status" -eq 2 ]
  touch "$REPO/.claude/TASKS.md" "$REPO/.claude/STATUS.md" "$REPO/.claude/claude-progress.txt"
  run corehook hooks/enforce-state-update.sh '{"session_id":"u1"}'
  [ "$status" -eq 0 ]
}

@test "C4a: a wholly-untracked dir costs one freshness stat, not one per file (review P2-3)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  seed
  corehook hooks/session-start-marker.sh '{"session_id":"d1"}' >/dev/null
  mkdir -p "$REPO/build-out"
  for i in $(seq 1 60); do : > "$REPO/build-out/f$i.o"; done
  FAKEBIN="$BATS_TEST_TMPDIR/statlog"; mkdir -p "$FAKEBIN"
  real_stat=$(command -v stat)
  printf '#!/usr/bin/env bash\necho x >> "%s/calls"\nexec "%s" "$@"\n' "$FAKEBIN" "$real_stat" > "$FAKEBIN/stat"
  chmod +x "$FAKEBIN/stat"
  PATH="$FAKEBIN:$PATH" run corehook hooks/enforce-state-update.sh '{"session_id":"d1"}'
  [ "$status" -eq 2 ]   # build-out/ is new work; state files untouched
  [ "$(wc -l < "$FAKEBIN/calls")" -lt 5 ]
}

@test "C4a: untracked state files inside a wholly-untracked dir still satisfy the gate" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  seed nostate
  corehook hooks/session-start-marker.sh '{"session_id":"d2"}' >/dev/null
  printf 'work\n' >> "$REPO/code.txt"
  mkdir -p "$REPO/newproj/.claude"
  touch "$REPO/newproj/.claude/TASKS.md" "$REPO/newproj/.claude/STATUS.md" "$REPO/newproj/.claude/claude-progress.txt"
  run corehook hooks/enforce-state-update.sh '{"session_id":"d2"}'
  [ "$status" -eq 0 ]
}

@test "C4b: read-only turn (no change this session) is not blocked; telemetry says skipped" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  seed
  corehook hooks/session-start-marker.sh '{"session_id":"r1"}' >/dev/null
  run corehook hooks/enforce-state-update.sh '{"session_id":"r1"}'
  [ "$status" -eq 0 ]
  [[ "$output" != *"STATE FILES NOT UPDATED"* ]]
  jq -s -e '[.[] | select(.hook=="stop")][-1] | .outcome=="skipped" and .outcome_class=="skipped" and .detail.reason=="no-work"' "$REPO/.claude/telemetry/events.jsonl"
}

@test "C4b: bookkeeping-only changes under .claude/ do not count as work, code under .claude/ does" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  seed
  corehook hooks/session-start-marker.sh '{"session_id":"b1"}' >/dev/null
  printf '{}' > "$REPO/.claude/.drift-state"
  printf 'x\n' > "$REPO/.claude/DECISIONS.md"
  run corehook hooks/enforce-state-update.sh '{"session_id":"b1"}'
  [ "$status" -eq 0 ]
  mkdir -p "$REPO/.claude/hooks" && printf 'echo\n' > "$REPO/.claude/hooks/x.sh"
  run corehook hooks/enforce-state-update.sh '{"session_id":"b1"}'
  [ "$status" -eq 2 ]
}

@test "C4b: right after a compaction, pre-compaction uncommitted work does not block" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  seed
  printf 'pre-compact work\n' >> "$REPO/code.txt"
  touch -d '2 hours ago' "$REPO/code.txt"
  # The compact SessionStart re-stamps this session's marker.
  corehook hooks/session-start-marker.sh '{"session_id":"c1","source":"compact"}' >/dev/null
  run corehook hooks/enforce-state-update.sh '{"session_id":"c1"}'
  [ "$status" -eq 0 ]
  # New work after the compaction is enforced again.
  printf 'post-compact work\n' >> "$REPO/code.txt"
  run corehook hooks/enforce-state-update.sh '{"session_id":"c1"}'
  [ "$status" -eq 2 ]
}

@test "C4: one-block-per-cycle guard still holds (stop_hook_active)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  seed
  corehook hooks/session-start-marker.sh '{"session_id":"g1"}' >/dev/null
  printf 'work\n' >> "$REPO/code.txt"
  run corehook hooks/enforce-state-update.sh '{"session_id":"g1","stop_hook_active":true}'
  [ "$status" -eq 0 ]
}

# ---------- C5 framework-drift-guard ----------

dirty_tree() { # dirty_tree <dir> — 4 tracked files, then modify all
  mkdir -p "$REPO/$1"
  for f in a b c d; do printf '1\n' > "$REPO/$1/$f.txt"; done
  ( cd "$REPO" && git add -A && git commit -qm seed )
  for f in a b c d; do printf '2\n' >> "$REPO/$1/$f.txt"; done
}

@test "C5: Indicator 1 is throttled (prompt 1, then every 8 prompts), not every prompt" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  dirty_tree 01_Project
  local fired=0 i
  for i in $(seq 1 9); do
    run corehook hooks/framework-drift-guard.sh '{"session_id":"d1"}'
    [[ "$output" == *"uncommitted project file changes"* ]] && fired=$((fired + 1))
  done
  [ "$fired" -eq 2 ]
}

@test "C5: dead 01_Project/ default warns once and falls back to any non-.claude path" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  dirty_tree src
  run corehook hooks/framework-drift-guard.sh '{"session_id":"l1"}'
  [[ "$output" == *"Shown once"* ]]
  [[ "$output" == *"4 uncommitted project file changes"* ]]
  run corehook hooks/framework-drift-guard.sh '{"session_id":"l2"}'
  [[ "$output" != *"Shown once"* ]]
  [[ "$output" == *"4 uncommitted project file changes"* ]]   # new session, throttle reset, fallback still live
}

@test "C5: no layout warning when 01_Project/ is tracked or the pattern is configured" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  dirty_tree 01_Project
  run corehook hooks/framework-drift-guard.sh '{"session_id":"n1"}'
  [[ "$output" != *"Shown once"* ]]
  rm -rf "$REPO/01_Project" "$REPO/.claude/.drift-state"
  ( cd "$REPO" && git add -A && git commit -qm rm )
  printf 'HEALTHCHECK_SOURCE_DIRS="app/"\n' > "$REPO/.claude/healthcheck.conf"
  dirty_tree src
  run corehook hooks/framework-drift-guard.sh '{"session_id":"n2"}'
  [[ "$output" != *"Shown once"* ]]
  [[ "$output" != *"uncommitted project file changes"* ]]   # src/ is outside the configured app/
}
