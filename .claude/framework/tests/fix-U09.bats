#!/usr/bin/env bats
# fix-U09 regressions (2026-09-26 deep-review fixes):
#   - rotate-state keeps KEEP_TASKS_DONE PER Done section (feature + bug lanes),
#     not one shared counter that always archived the whole Bug-Fix Done lane.
#   - rotate-state post-write verification line appears on a real run.
#   - doctor Check 16: an OVER-budget state file is a WARNING (never CRITICAL —
#     CRITICAL halts unattended runs) and names a per-file remedy.
load helpers
load update_helpers

rotate() { ( cd "$REPO" && KEEP_TASKS_DONE="${K1:-2}" KEEP_DECISIONS="${K2:-2}" \
             bash "$FW_REPO_ROOT/.claude/framework/housekeeping/rotate-state.sh" "$@" ); }

seed_rot() {
  mkdir -p "$REPO/.claude/archive"
  cat > "$REPO/.claude/TASKS.md" <<'EOF'
# Task Board
## Feature Lane
### Done
#### [TASK-1] a
1
#### [TASK-2] b
2
#### [TASK-3] c
3
## Bug-Fix Lane
### Done
#### [BUG-1] x
q
#### [BUG-2] y
r
#### [BUG-3] z
s
EOF
  cat > "$REPO/.claude/DECISIONS.md" <<'EOF'
# Decision Log
## 2026-01-02 - two
b
## 2026-01-01 - one
a
EOF
}

@test "fix-U09 rotate-state: keep window is per Done section (bug lane keeps its newest too)" {
  init_repo; seed_rot
  run rotate
  [ "$status" -eq 0 ]
  grep -q '\[TASK-2\]' "$REPO/.claude/TASKS.md"
  grep -q '\[BUG-1\]' "$REPO/.claude/TASKS.md"
  grep -q '\[BUG-2\]' "$REPO/.claude/TASKS.md"
  grep -q '\[TASK-3\]' "$REPO/.claude/archive/TASKS-archive.md"
  grep -q '\[BUG-3\]' "$REPO/.claude/archive/TASKS-archive.md"
  ! grep -q '\[BUG-1\]' "$REPO/.claude/archive/TASKS-archive.md" || false
  [[ "$output" == *"post-write verify: OK"* ]]
}

@test "fix-U09 doctor Check 16: OVER budget is WARNING (not CRITICAL) with a per-file remedy" {
  build_doctor_consumer
  seed_doctor_state_files
  printf '.claude/TASKS.md=10\n.claude/GOTCHAS.md=10\n' > "$DOC/.claude/state-budgets.local.conf"
  run run_doctor
  [ -f "$DOCFLAG" ]
  grep -q "OVER its" "$DOCFLAG"
  ! grep -q 'CRITICAL.*\[state-budget\]' "$DOCFLAG" || false
  grep 'state-budget.*TASKS.md' "$DOCFLAG" | grep -q 'rotate-state.sh'
  if grep -q 'state-budget.*GOTCHAS.md' "$DOCFLAG"; then
    grep 'state-budget.*GOTCHAS.md' "$DOCFLAG" | grep -q 'does not rotate this file'
  fi
}
