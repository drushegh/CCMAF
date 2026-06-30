#!/usr/bin/env bats
# Fault-injection tests (TASK-018): the adversarial tier above the
# happy-path behavioural tests. Feed hooks malformed / garbage / truncated
# input and assert they FAIL OPEN — i.e. they degrade gracefully (no crash,
# no false block) rather than break the tool loop. Fail-open is a promise
# these hooks make; this is where that promise silently breaks if it's going
# to. Pattern borrowed from ToolMisuseBench (deterministic fault injection).

load helpers

setup() {
  init_repo
}

# --- block-dangerous-commands.py (safety hook) -----------------------

@test "block-dangerous: garbage (non-JSON) stdin → fails open, does not block" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" 'this is not json at all'
  # Must NOT block (exit 2 is the block signal). Fail-open = exit 0.
  [ "$status" -ne 2 ]
  [ "$status" -eq 0 ]
}

@test "block-dangerous: empty stdin → fails open" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" ''
  [ "$status" -eq 0 ]
}

@test "block-dangerous: JSON of the wrong shape (array) → fails open" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '[1,2,3]'
  [ "$status" -eq 0 ]
}

@test "block-dangerous: still blocks a real danger inside otherwise-odd JSON" {
  [ -n "$PYTHON" ] || skip "python not available"
  run pyrun "$HOOKS/block-dangerous-commands.py" '{"tool_input":{"command":"rm -rf /"},"extra":null}'
  [ "$status" -eq 2 ]
}

# --- filter-test-output.sh -------------------------------------------

@test "filter-test-output: garbage stdin → passthrough, no crash" {
  run hookrun "$HOOKS/filter-test-output.sh" 'not json'
  [ "$status" -eq 0 ]
}

# --- auto-format / auto-lint -----------------------------------------

@test "auto-format: garbage stdin → clean no-op exit 0" {
  run hookrun "$HOOKS/auto-format.sh" 'garbage{{{'
  [ "$status" -eq 0 ]
}

@test "auto-lint: garbage stdin → clean no-op exit 0" {
  run hookrun "$HOOKS/auto-lint.sh" 'garbage{{{'
  [ "$status" -eq 0 ]
}

# --- verify-deps.sh (PostToolUse, must never break a save) -----------

@test "verify-deps: half-written / malformed manifest → exit 0 (informs, never blocks)" {
  mkdir -p "$REPO/sub"
  printf '{ "dependencies": { "react": "^18.0.0", ' > "$REPO/sub/package.json"  # truncated JSON
  run hookrun "$HOOKS/verify-deps.sh" "{\"tool_input\":{\"file_path\":\"$REPO/sub/package.json\"}}"
  [ "$status" -eq 0 ]
}

@test "verify-deps: garbage stdin → exit 0" {
  run hookrun "$HOOKS/verify-deps.sh" 'not even json'
  [ "$status" -eq 0 ]
}

# --- enforce-state-update.sh (Stop) ----------------------------------

@test "enforce-state: garbage stdin → does not crash (no commits → exit 0)" {
  run hookrun "$HOOKS/enforce-state-update.sh" 'garbage not json'
  [ "$status" -eq 0 ]
}

# --- config-security.sh: SHOULD flag (not fail open) on bad config ----
# An auditor reaching invalid config must surface it, not stay silent —
# the opposite of a hook's fail-open. Malformed settings.json = CRITICAL.

@test "config-security: malformed settings.json → CRITICAL, exit 2 (correctly NOT silent)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  mkdir -p "$REPO/.claude"
  printf '{ "permissions": { "allow": [ ' > "$REPO/.claude/settings.json"  # truncated JSON
  run bash -c "cd '$REPO' && bash '$AUDIT/config-security.sh'"
  [ "$status" -eq 2 ]
  [[ "$output" == *"not valid JSON"* ]]
}
