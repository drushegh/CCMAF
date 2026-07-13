#!/usr/bin/env bats
# boot-view.sh tests (OPT P2 / TASK-138). Hermetic: ROOT resolves from cwd.
load helpers

setup() { init_repo; }

bootview() { ( cd "$REPO" && bash "$FW_REPO_ROOT/.claude/framework/boot/boot-view.sh" ); }

seed_board() {
  cat > "$REPO/.claude/TASKS.md" <<'EOF'
# Task Board
## Feature Lane
### In Progress
#### [TASK-100] active thing
work
### Done
#### [TASK-1] shipped thing
old
## Bug-Fix Lane
### Reported
#### [BUG-9] a bug
z
EOF
  printf '# Status\ncurrent state\n' > "$REPO/.claude/STATUS.md"
  printf '# Decision Log\n## 2026-01-01 - d\nwhy\n' > "$REPO/.claude/DECISIONS.md"
  printf '## WIP\nnow\n### entry\nx\n' > "$REPO/.claude/claude-progress.txt"
}

@test "boot-view: emits non-Done tasks (with sections), omits Done, exit 0" {
  seed_board
  run bootview
  [ "$status" -eq 0 ]
  [[ "$output" == *"TASK-100"* ]]   # In Progress kept
  [[ "$output" == *"BUG-9"* ]]      # Reported (non-Done) kept
  ! [[ "$output" == *"TASK-1]"* ]]  # Done entry omitted
  [[ "$output" == *"## Bug-Fix Lane"* ]]   # lane heading preserved (not swallowed)
  [[ "$output" == *"BOOT VIEW"* ]]
}

@test "boot-view: fail-closed exit 2 on a duplicate task heading" {
  seed_board
  # inject a duplicate heading
  printf '#### [TASK-100] duplicate\nx\n' >> "$REPO/.claude/TASKS.md"
  run bootview
  [ "$status" -eq 2 ]
  [[ "$output" == *"INCOMPLETE"* ]] || [[ "${lines[*]}" == *"INCOMPLETE"* ]]
}

@test "boot-view: stateless — writes no files (stdout only)" {
  seed_board
  before=$(find "$REPO/.claude" -type f | sort)
  run bootview
  [ "$status" -eq 0 ]
  after=$(find "$REPO/.claude" -type f | sort)
  [ "$before" = "$after" ]
}
