#!/usr/bin/env bats
# Unit tests for the hook profile / opt-out resolver (TASK-011).
# Pure logic — no side effects.

load helpers

setup() {
  . "$HOOKS/lib/hook-common.sh"
}

@test "standard profile (default): normal-tier hook runs" {
  run hook_enabled format normal
  [ "$status" -eq 0 ]
}

@test "minimal profile: normal-tier hook is skipped" {
  CLAUDE_HOOK_PROFILE=minimal run hook_enabled format normal
  [ "$status" -eq 1 ]
}

@test "minimal profile: safety-tier hook still runs" {
  CLAUDE_HOOK_PROFILE=minimal run hook_enabled block-dangerous safety
  [ "$status" -eq 0 ]
}

@test "disable list: listed id is skipped, unlisted runs" {
  CLAUDE_DISABLED_HOOKS="format,lint" run hook_enabled format normal
  [ "$status" -eq 1 ]
  CLAUDE_DISABLED_HOOKS="format,lint" run hook_enabled verify-deps normal
  [ "$status" -eq 0 ]
}

@test "disable list overrides safety tier (explicit user choice wins)" {
  CLAUDE_DISABLED_HOOKS="block-dangerous" run hook_enabled block-dangerous safety
  [ "$status" -eq 1 ]
}

@test "strict-tier hook: skipped under standard, runs under strict" {
  run hook_enabled future strict
  [ "$status" -eq 1 ]
  CLAUDE_HOOK_PROFILE=strict run hook_enabled future strict
  [ "$status" -eq 0 ]
}

@test "unknown profile value falls back to standard" {
  CLAUDE_HOOK_PROFILE=bogus run hook_enabled format normal
  [ "$status" -eq 0 ]
}

# --- normalize_tool_path (DA-H1) --------------------------------------

@test "normalize_tool_path: Windows backslash drive path → POSIX" {
  . "$HOOKS/lib/hook-common.sh"
  result=$(normalize_tool_path 'F:\Git\proj\package.json')
  [ "$result" = "/f/Git/proj/package.json" ]
}

@test "normalize_tool_path: Windows forward-slash drive path → POSIX" {
  . "$HOOKS/lib/hook-common.sh"
  result=$(normalize_tool_path 'C:/Users/dev/x.py')
  [ "$result" = "/c/Users/dev/x.py" ]
}

@test "normalize_tool_path: POSIX path passes through unchanged" {
  . "$HOOKS/lib/hook-common.sh"
  result=$(normalize_tool_path '/home/dev/proj/x.ts')
  [ "$result" = "/home/dev/proj/x.ts" ]
}

@test "normalize_tool_path: relative path passes through unchanged" {
  . "$HOOKS/lib/hook-common.sh"
  result=$(normalize_tool_path 'src/x.ts')
  [ "$result" = "src/x.ts" ]
}
