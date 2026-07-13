#!/usr/bin/env bats
# rotate-state.sh tests (OPT P1 / TASK-137). Hermetic: ROOT resolves from cwd.
load helpers

setup() { init_repo; mkdir -p "$REPO/.claude/archive"; }

rotate() { ( cd "$REPO" && KEEP_TASKS_DONE="${K1:-2}" KEEP_DECISIONS="${K2:-2}" \
             bash "$FW_REPO_ROOT/.claude/framework/housekeeping/rotate-state.sh" "$@" ); }

seed() {
  cat > "$REPO/.claude/TASKS.md" <<'EOF'
# Task Board
## Feature Lane
### In Progress
#### [TASK-100] active
x
### Done
#### [TASK-1] a
1
#### [TASK-2] b
2
#### [TASK-3] c
3
## Bug-Fix Lane
### Reported
#### [BUG-9] open bug
z
### Done
#### [BUG-1] fixed bug
q
EOF
  cat > "$REPO/.claude/DECISIONS.md" <<'EOF'
# Decision Log
---
## 2026-01-03 - three
c
## 2026-01-02 - two
b
## 2026-01-01 - one
a
EOF
}

@test "rotate-state: dry-run writes nothing, reports conservation OK" {
  seed
  run rotate --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"conservation: OK"* ]]
  [ ! -f "$REPO/.claude/archive/TASKS-archive.md" ]
}

@test "rotate-state: real run conserves every id verbatim across live+archive" {
  seed
  run rotate
  [ "$status" -eq 0 ]
  # TASK-100 (non-Done) + newest 2 Done kept; the 3rd Done archived
  grep -q "TASK-100" "$REPO/.claude/TASKS.md"
  grep -q '\[TASK-1\]' "$REPO/.claude/TASKS.md"
  grep -q '\[TASK-3\]' "$REPO/.claude/archive/TASKS-archive.md"
  ! grep -q '\[TASK-3\]' "$REPO/.claude/TASKS.md"
  grep -q "2026-01-01" "$REPO/.claude/archive/DECISIONS-archive.md"
  ! grep -q "2026-01-01" "$REPO/.claude/DECISIONS.md"
  grep -q "Archived entries" "$REPO/.claude/TASKS.md"
}

@test "rotate-state: a ## lane heading between Done entries is NOT swallowed into the archive (regression)" {
  seed
  run rotate
  [ "$status" -eq 0 ]
  # The lane heading must stay in the LIVE board, never migrate into an archived block.
  grep -q '^## Bug-Fix Lane' "$REPO/.claude/TASKS.md"
  ! grep -q '^## Bug-Fix Lane' "$REPO/.claude/archive/TASKS-archive.md"
  # And the non-Done bug entry under it stays live; the old bug-Done goes to archive.
  grep -q '\[BUG-9\]' "$REPO/.claude/TASKS.md"
  grep -q '\[BUG-1\]' "$REPO/.claude/archive/TASKS-archive.md"
}

@test "rotate-state: second run is a no-op (nothing left beyond the keep window)" {
  seed
  run rotate
  [ "$status" -eq 0 ]
  before=$(cat "$REPO/.claude/TASKS.md")
  run rotate
  [ "$status" -eq 0 ]
  after=$(cat "$REPO/.claude/TASKS.md")
  [ "$before" = "$after" ]
}
