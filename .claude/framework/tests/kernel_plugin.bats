#!/usr/bin/env bats
# Tests for the ccmaf-kernel Tier 0 plugin (TASK-148/149).
#
# The plugin must (a) carry a byte-identical copy of the canonical
# dangerous-command guard, (b) self-defer in full-CCMAF projects,
# (c) enforce the tool-call budget nag at the kernel thresholds, and
# (d) never create .claude scaffolding in a Tier 0 repo.

load helpers

KERNEL="$FW_REPO_ROOT/plugins/ccmaf-kernel"

setup() {
  # The tests/ dir-mirror ships to consumer projects, which do NOT carry
  # kernel/ (it's publish-manifest-only). Skip rather than fail there — keyed
  # on the plugin's own manifest, so a consumer repo's unrelated plugins/
  # tree can't un-skip us. (NOT on .claude/.framework-dev-repo: the public
  # CCMAF repo ships plugins/ + tests but not the dev marker, and the tests
  # must still run there.)
  [ -f "$KERNEL/.claude-plugin/plugin.json" ] || skip "kernel plugin not present (consumer checkout)"
  init_repo
  export CLAUDE_PLUGIN_ROOT="$KERNEL"
  export HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$HOME"
}

# --- sync invariant ---------------------------------------------------------

@test "kernel: bundled guard is byte-identical to canonical block-dangerous-commands.py" {
  cmp "$KERNEL/scripts/block-dangerous-commands.py" \
      "$HOOKS/block-dangerous-commands.py"
}

# --- guard behaviour through the plugin wrapper -----------------------------

@test "kernel guard: blocks rm -rf / (exit 2, BLOCKED)" {
  [ -n "$PYTHON" ] || skip "python not available"
  run hookrun "$KERNEL/scripts/guard-wrapper.sh" \
    '{"tool_input":{"command":"rm -rf /"}}'
  [ "$status" -eq 2 ]
  [[ "$output" == *BLOCKED* ]]
}

@test "kernel guard: allows a benign command (exit 0)" {
  [ -n "$PYTHON" ] || skip "python not available"
  run hookrun "$KERNEL/scripts/guard-wrapper.sh" \
    '{"tool_input":{"command":"ls -la"}}'
  [ "$status" -eq 0 ]
}

@test "kernel guard: writes NO telemetry in a repo with .claude but no .framework-version" {
  BARE="$BATS_TEST_TMPDIR/nonccmaf"
  mkdir -p "$BARE/.claude"
  git -C "$BARE" init -q
  printf '%s' '{"tool_input":{"command":"ls -la"}}' > "$BARE/event.json"
  ( cd "$BARE" && bash "$KERNEL/scripts/guard-wrapper.sh" < "$BARE/event.json" )
  [ ! -d "$BARE/.claude/telemetry" ]
}

@test "kernel guard: degraded mode is loud — broken interpreter yields exit 1 + NOT screened" {
  FAKEBIN="$BATS_TEST_TMPDIR/fakebin"
  mkdir -p "$FAKEBIN"
  printf '#!/bin/sh\nexit 9\n' > "$FAKEBIN/python3"
  printf '#!/bin/sh\nexit 9\n' > "$FAKEBIN/python"
  chmod +x "$FAKEBIN/python3" "$FAKEBIN/python"
  printf '%s' '{"tool_input":{"command":"ls"}}' > "$REPO/event.json"
  BASH_ABS="$(command -v bash)"
  run bash -c "cd '$REPO' && PATH='$FAKEBIN' '$BASH_ABS' '$KERNEL/scripts/guard-wrapper.sh' < '$REPO/event.json'"
  [ "$status" -eq 1 ]
  [[ "$output" == *"NOT screened"* ]]
}

@test "kernel guard: creates NO .claude dir in a scaffold-free repo" {
  [ -n "$PYTHON" ] || skip "python not available"
  BARE="$BATS_TEST_TMPDIR/bare"
  mkdir -p "$BARE"
  git -C "$BARE" init -q
  printf '%s' '{"tool_input":{"command":"ls -la"}}' > "$BARE/event.json"
  ( cd "$BARE" && bash "$KERNEL/scripts/guard-wrapper.sh" < "$BARE/event.json" )
  [ ! -d "$BARE/.claude" ]
}

# --- context injection ------------------------------------------------------

@test "kernel context: emits KERNEL.md in a plain repo" {
  run bash -c "cd '$REPO' && bash '$KERNEL/scripts/kernel-context.sh'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"CCMAF KERNEL (Tier 0)"* ]]
  [[ "$output" == *"RECEIPT"* ]]
}

@test "kernel context: self-defers in a full-CCMAF project (empty output)" {
  touch "$REPO/.claude/.framework-version"
  run bash -c "cd '$REPO' && bash '$KERNEL/scripts/kernel-context.sh'"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# --- budget counter ---------------------------------------------------------

budget() {  # budget <n-times> — invoke the counter n times for one session
  local i rc=0
  for ((i = 0; i < $1; i++)); do
    printf '%s' '{"session_id":"batstest","tool_name":"Bash"}' \
      | ( cd "$REPO" && bash "$KERNEL/scripts/budget-counter.sh" ) 2>"$BATS_TEST_TMPDIR/nag" \
      || rc=$?
  done
  return $rc
}

@test "kernel budget: silent for the first 29 calls" {
  run budget 29
  [ "$status" -eq 0 ]
  [ "$(cat "$HOME/.ccmaf-kernel/budget-batstest.count")" = "29" ]
}

@test "kernel budget: nags with exit 2 at call 30" {
  budget 29 || true
  printf '%s' '{"session_id":"batstest","tool_name":"Bash"}' > "$REPO/event.json"
  run bash -c "cd '$REPO' && bash '$KERNEL/scripts/budget-counter.sh' < '$REPO/event.json'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"30 tool calls"* ]]
}

@test "kernel budget: call 31 is silent again (nag fires only at thresholds)" {
  budget 30 || true
  printf '%s' '{"session_id":"batstest","tool_name":"Bash"}' > "$REPO/event.json"
  run bash -c "cd '$REPO' && bash '$KERNEL/scripts/budget-counter.sh' < '$REPO/event.json'"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ "$(cat "$HOME/.ccmaf-kernel/budget-batstest.count")" = "31" ]
}

@test "kernel budget: self-defers in a full-CCMAF project (no count written)" {
  touch "$REPO/.claude/.framework-version"
  run budget 3
  [ "$status" -eq 0 ]
  [ ! -f "$HOME/.ccmaf-kernel/budget-batstest.count" ]
}
