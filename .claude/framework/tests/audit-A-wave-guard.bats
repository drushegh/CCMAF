#!/usr/bin/env bats
# Tests for the ccmaf-kernel opt-in wave-mode guard (fleet audit 2026-10-12,
# unit A — K3/C1): with CCMAF_WAVE_GUARD=1 and >1 build dispatch marker
# armed, tree-sweeping git commands are denied (exit 2); otherwise no-op.

load helpers

KERNEL="$FW_REPO_ROOT/plugins/ccmaf-kernel"
WG="$KERNEL/scripts/wave-guard.sh"

setup() {
  [ -f "$WG" ] || skip "kernel plugin not present (consumer checkout)"
  init_repo
  export CLAUDE_PROJECT_DIR="$REPO"
  export CCMAF_WAVE_GUARD=1
}

arm() { for id in "$@"; do printf 'class=M\n' > "$REPO/.claude/telemetry/.task-dispatch.$id"; done; }
ev() { jq -cn --arg c "$1" '{session_id:"s1",tool_input:{command:$c}}' 2>/dev/null \
       || printf '{"session_id":"s1","tool_input":{"command":"%s"}}' "$1"; }
guard() { run hookrun "$WG" "$(ev "$1")"; }

@test "wave-guard: chained from the guard wrapper only (no second hook process per call)" {
  grep -q 'scripts/wave-guard.sh' "$KERNEL/scripts/guard-wrapper.sh"
  ! grep -q 'wave-guard.sh' "$KERNEL/hooks/hooks.json"
}

@test "wave-guard: denies the tree-sweeping git commands while 2 markers are armed" {
  arm TASK-1 TASK-2
  for c in "git stash" "git stash push -m wip" "git checkout -- ." "git checkout -- src/a.ts" \
           "git checkout ." "git reset --hard" "git reset --hard HEAD~1" "git add -A" "git add --all" \
           "git add ." "git add -u" "git -C sub add -A" "npm test && git stash" "cd x; git reset --hard origin/main"; do
    guard "$c"
    [ "$status" -eq 2 ] || { echo "not blocked: $c (status $status)"; return 1; }
    [[ "$output" == *"wave mode"* ]]
  done
}

@test "wave-guard: allows read-only git and explicit-path staging during a wave" {
  arm TASK-1 TASK-2
  for c in "git status --short" "git diff HEAD" "git stash list" "git stash show -p" "git log --oneline" \
           "git add -- src/a.ts" "git add src/a.ts src/b.ts" "git commit -m 'never git stash here' -- src/a.ts" \
           "git reset -- src/a.ts" "git checkout main" "echo git add -A"; do
    guard "$c"
    [ "$status" -eq 0 ] || { echo "wrongly blocked: $c"; return 1; }
  done
}

@test "wave-guard: a single armed marker is not a wave (allowed)" {
  arm TASK-1
  guard "git stash"
  [ "$status" -eq 0 ]
}

@test "wave-guard: opt-in only — unset flag is a no-op even with markers armed" {
  arm TASK-1 TASK-2
  unset CCMAF_WAVE_GUARD
  guard "git add -A"
  [ "$status" -eq 0 ]
}

@test "wave-guard: orphan markers older than 2 days are not counted" {
  arm TASK-1 TASK-2
  touch -d '5 days ago' "$REPO/.claude/telemetry/.task-dispatch.TASK-2" 2>/dev/null \
    || skip "touch -d unsupported"
  guard "git reset --hard"
  [ "$status" -eq 0 ]
}

@test "wave-guard: no-jq fallback still extracts the command" {
  arm TASK-1 TASK-2
  FAKEBIN="$BATS_TEST_TMPDIR/nojq"; mkdir -p "$FAKEBIN"
  for t in bash cat find wc tr sed grep; do ln -s "$(command -v $t)" "$FAKEBIN/$t"; done
  printf '%s' '{"session_id":"s1","tool_input":{"command":"git add -A","description":"stage"}}' > "$REPO/event.json"
  run bash -c "cd '$REPO' && PATH='$FAKEBIN' bash '$WG' < '$REPO/event.json'"
  [ "$status" -eq 2 ]
}

# --- review P3 follow-ups ------------------------------------------------------

@test "wave-guard: also denies git restore (worktree), git clean, git commit -a" {
  arm TASK-1 TASK-2
  for c in "git restore ." "git restore src/a.ts" "git restore --staged --worktree ." "git clean -fd" \
           "git clean -f" "git commit -a -m wip" "git commit -am wip" "git commit --all -m wip"; do
    guard "$c"
    [ "$status" -eq 2 ] || { echo "not blocked: $c (status $status)"; return 1; }
  done
}

@test "wave-guard: allows restore --staged, clean -n, and commit messages that merely mention -a" {
  arm TASK-1 TASK-2
  for c in "git restore --staged src/a.ts" "git clean -n" "git clean --dry-run -d" \
           "git commit -m 'drop the -a flag' -- src/a.ts" "git commit --amend --no-edit -- src/a.ts"; do
    guard "$c"
    [ "$status" -eq 0 ] || { echo "wrongly blocked: $c"; return 1; }
  done
}

@test "wave-guard: heredoc bodies are data, not commands; code after the terminator is still screened" {
  arm TASK-1 TASK-2
  guard "$(printf 'git commit -F - -- src/a.ts <<'"'"'EOF'"'"'\nfix: never git stash or git add -A here\ngit reset --hard is banned\nEOF')"
  [ "$status" -eq 0 ]
  guard "$(printf 'cat <<-EOF > notes.txt\n\tgit clean -fd\n\tEOF\ngit stash')"
  [ "$status" -eq 2 ]
}

@test "wave-guard: the block message names the marker files to clear when stale" {
  arm TASK-1 TASK-2
  guard "git stash"
  [ "$status" -eq 2 ]
  [[ "$output" == *".claude/telemetry/.task-dispatch."* ]]
}

@test "wave-guard via guard-wrapper: flag on blocks a sweep; flag off never runs it" {
  [ -n "${PYTHON:-}" ] || skip "python not available"
  arm TASK-1 TASK-2
  run env CLAUDE_PLUGIN_ROOT="$KERNEL" bash -c "bash '$KERNEL/scripts/guard-wrapper.sh' <<< '$(ev 'git add -A')'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"wave mode"* ]]
  run env -u CCMAF_WAVE_GUARD CLAUDE_PLUGIN_ROOT="$KERNEL" bash -c "bash '$KERNEL/scripts/guard-wrapper.sh' <<< '$(ev 'git add -A')'"
  [ "$status" -eq 0 ]
  # the dangerous-command guard still runs first in wave mode
  run env CLAUDE_PLUGIN_ROOT="$KERNEL" bash -c "bash '$KERNEL/scripts/guard-wrapper.sh' <<< '$(ev 'rm -rf /')'"
  [ "$status" -eq 2 ]
  [[ "$output" == *BLOCKED* ]]
}
