#!/usr/bin/env bats
# Behavioural tests for console-heartbeat.sh (TASK-066 AC3). The hook is a pure
# function of (stdin JSON event + env + opt-in flag + Console registry) →
# (exit code + stdout + registry-file mtime touch). Each test runs inside a
# throwaway git repo ($REPO) with a temp Console state dir wired via
# CCMAF_CONSOLE_STATE_DIR, so nothing touches the real per-user registry.

load helpers

setup() {
  init_repo
  STATE="$BATS_TEST_TMPDIR/state"
  REG="$STATE/registry"
  mkdir -p "$REG"
  # A reference file timestamped BETWEEN the back-dated registry (2020) and now,
  # so "touched" == "registry now newer than the reference" — second-granularity
  # safe (no same-second mtime ambiguity). `-t` is portable (GNU + BSD touch).
  touch -t 202101010000 "$REPO/.ref"
}

# Write a registry entry whose rootPath == this repo, in the native path form
# the Console would store (Windows backslash via cygpath when present; the git
# toplevel posix form otherwise — both are what a real Console writes per OS).
_write_match_entry() {
  local port="$1" rootg rp
  rootg=$(git -C "$REPO" rev-parse --show-toplevel)
  if command -v cygpath >/dev/null 2>&1; then rp=$(cygpath -w "$rootg"); else rp="$rootg"; fi
  jq -n --arg rp "$rp" --argjson port "$port" \
    '{schemaVersion:1,project:"repo",rootPath:$rp,port:$port,pid:1,autoStart:true}' \
    > "$REG/$port.json"
  touch -t 202001010000 "$REG/$port.json"   # back-date so a touch is detectable
}

_write_other_entry() {
  local port="$1"
  jq -n --argjson port "$port" \
    '{schemaVersion:1,project:"other",rootPath:"/some/other/project",port:$port,pid:2}' \
    > "$REG/$port.json"
  touch -t 202001010000 "$REG/$port.json"
}

# hookrun with the Console state dir pointed at our temp registry.
hbrun() {
  CCMAF_CONSOLE_STATE_DIR="$STATE" hookrun "$HOOKS/console-heartbeat.sh" "$1"
}

@test "heartbeat: NOT opted in → no-op, registry untouched, UPS emits {}" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  _write_match_entry 6201
  run hbrun '{"hook_event_name":"UserPromptSubmit","session_id":"s1"}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
  [ ! "$REG/6201.json" -nt "$REPO/.ref" ]   # untouched (still 2020 < ref)
}

@test "heartbeat: opted in (.console-enabled) → matching entry touched, non-match untouched" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  touch "$REPO/.claude/.console-enabled"
  _write_match_entry 6201
  _write_other_entry 6202
  run hbrun '{"hook_event_name":"PostToolUse","session_id":"s1"}'
  [ "$status" -eq 0 ]
  [ "$REG/6201.json" -nt "$REPO/.ref" ]      # matched → touched to now
  [ ! "$REG/6202.json" -nt "$REPO/.ref" ]    # non-match → still 2020
}

@test "heartbeat: opted in via .console-version pin also triggers" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  echo "main" > "$REPO/.claude/.console-version"
  _write_match_entry 6201
  run hbrun '{"hook_event_name":"PostToolUse"}'
  [ "$status" -eq 0 ]
  [ "$REG/6201.json" -nt "$REPO/.ref" ]
}

@test "heartbeat: throttle — immediate second fire does not re-touch" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  touch "$REPO/.claude/.console-enabled"
  _write_match_entry 6201
  run hbrun '{"hook_event_name":"PostToolUse"}'     # 1st: touches, writes marker
  [ "$REG/6201.json" -nt "$REPO/.ref" ]
  [ -f "$REPO/.claude/.console-heartbeat" ]          # throttle marker created
  touch -t 202001010000 "$REG/6201.json"             # re-age the entry
  run hbrun '{"hook_event_name":"PostToolUse"}'       # 2nd: marker < 1min → skip scan
  [ "$status" -eq 0 ]
  [ ! "$REG/6201.json" -nt "$REPO/.ref" ]            # NOT re-touched
}

@test "heartbeat: disabled via CLAUDE_DISABLED_HOOKS → no touch, exit 0" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  touch "$REPO/.claude/.console-enabled"
  _write_match_entry 6201
  CLAUDE_DISABLED_HOOKS=console-heartbeat run hbrun '{"hook_event_name":"PostToolUse"}'
  [ "$status" -eq 0 ]
  [ ! "$REG/6201.json" -nt "$REPO/.ref" ]
}

@test "heartbeat: minimal profile silences it (no touch)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  touch "$REPO/.claude/.console-enabled"
  _write_match_entry 6201
  CLAUDE_HOOK_PROFILE=minimal run hbrun '{"hook_event_name":"PostToolUse"}'
  [ "$status" -eq 0 ]
  [ ! "$REG/6201.json" -nt "$REPO/.ref" ]
}

@test "heartbeat: opted in but no Console state dir → clean no-op, {} on UPS" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  touch "$REPO/.claude/.console-enabled"
  CCMAF_CONSOLE_STATE_DIR="$BATS_TEST_TMPDIR/nope" \
    run hookrun "$HOOKS/console-heartbeat.sh" '{"hook_event_name":"UserPromptSubmit"}'
  [ "$status" -eq 0 ]
  [ "$output" = "{}" ]
}

@test "heartbeat: opted in, Console running but no matching project entry → no-op" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  touch "$REPO/.claude/.console-enabled"
  _write_other_entry 6202                            # a different project's console
  run hbrun '{"hook_event_name":"PostToolUse"}'
  [ "$status" -eq 0 ]
  [ ! "$REG/6202.json" -nt "$REPO/.ref" ]
}

@test "heartbeat: garbage stdin → fail-open (exit 0)" {
  touch "$REPO/.claude/.console-enabled"
  run hbrun 'not json {{{'
  [ "$status" -eq 0 ]
}
