# helpers.bash — shared setup for framework hook tests (loaded via `load helpers`).
#
# Hooks are pure functions of (stdin JSON event + env) → (exit code + stdout),
# which makes them cleanly fixture-testable. To keep tests hermetic, hook
# executions run inside a throwaway git repo ($REPO) created per-test under
# $BATS_TEST_TMPDIR — so any telemetry the hook writes
# (.claude/telemetry/events.jsonl) and any state mutation lands in the temp
# repo and vanishes with it, never touching the real working tree.

FW_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
HOOKS="$FW_REPO_ROOT/.claude/hooks"
AUDIT="$FW_REPO_ROOT/.claude/framework/audit"
PYTHON="$(command -v python3 || command -v python || true)"

# Create the per-test throwaway git repo. Call from a file's setup().
init_repo() {
  REPO="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$REPO/.claude/telemetry"
  git -C "$REPO" init -q
  git -C "$REPO" config user.email test@example.com
  git -C "$REPO" config user.name test
}

# Run a bash hook: hookrun <abs-script> <json-stdin>
hookrun() {
  printf '%s' "$2" > "$REPO/event.json"
  ( cd "$REPO" && bash "$1" < "$REPO/event.json" )
}

# Run a python hook: pyrun <abs-script> <json-stdin>
pyrun() {
  printf '%s' "$2" > "$REPO/event.json"
  ( cd "$REPO" && "$PYTHON" "$1" < "$REPO/event.json" )
}
