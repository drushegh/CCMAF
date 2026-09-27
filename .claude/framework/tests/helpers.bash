# helpers.bash — shared setup for framework hook tests (loaded via `load helpers`).
#
# Hooks are pure functions of (stdin JSON event + env) → (exit code + stdout),
# which makes them cleanly fixture-testable. To keep tests hermetic, hook
# executions run inside a throwaway git repo ($REPO) created per-test under
# $BATS_TEST_TMPDIR — so any telemetry the hook writes
# (.claude/telemetry/events.jsonl) and any state mutation lands in the temp
# repo and vanishes with it, never touching the real working tree.

FW_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# shellcheck disable=SC2034  # consumed by the .bats files that load this helper
HOOKS="$FW_REPO_ROOT/.claude/hooks"
# shellcheck disable=SC2034  # consumed by the .bats files that load this helper
AUDIT="$FW_REPO_ROOT/.claude/framework/audit"
# Probe each candidate by EXECUTING it — on Windows `python3` often resolves to
# the Microsoft Store stub (exits 49), so `command -v` alone picks a dead one
# and python-gated tests fail instead of running/skipping (BUG-032).
PYTHON=""
for _py_cand in python3 python; do
  if command -v "$_py_cand" >/dev/null 2>&1 && "$_py_cand" -c 'import sys' >/dev/null 2>&1; then
    PYTHON="$(command -v "$_py_cand")"; break
  fi
done
unset _py_cand

# Create the per-test throwaway git repo. Call from a file's setup().
init_repo() {
  REPO="$BATS_TEST_TMPDIR/repo"
  mkdir -p "$REPO/.claude/telemetry"
  git -C "$REPO" init -q
  git -C "$REPO" config user.email test@example.com
  git -C "$REPO" config user.name test
}

# Mark the fixture repo as a CCMAF project (the update-system pin every real
# consumer carries). The canonical guard's telemetry gate keys on this marker
# (2026-08-10) — call this in tests that assert telemetry WRITES. Tests that
# need a non-CCMAF repo (kernel plugin deference/budget) simply don't call it.
mark_ccmaf() {
  touch "$REPO/.claude/.framework-version"
}

# Mark the fixture repo as a CCMAF **v2** project (the core plugin's
# activation key is the FRAMEWORK_LINE=v2 CONTENT line — CORE-DESIGN §0).
# mark_ccmaf above stays the v1 shape (bare presence, no v2 line).
mark_ccmaf_v2() {
  printf 'FRAMEWORK_LINE=v2\nSCAFFOLD_REV=1\n' > "$REPO/.claude/.framework-version"
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
