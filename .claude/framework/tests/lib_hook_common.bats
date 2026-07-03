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

# --- resolve_python (M1 residual (a), Audtor 2026-07-02) ----------------
# `command -v` alone proves a name resolves on PATH, not that it can run —
# a Windows Store python3.exe app-execution-alias stub is the real case
# that resolves via `command -v` and then fails to actually execute.

@test "resolve_python: picks the first candidate that actually executes" {
  [ -n "$PYTHON" ] || skip "python not available"
  result=$(resolve_python nonexistent-interpreter-xyz123 "$PYTHON")
  [ "$result" = "$PYTHON" ]
}

@test "resolve_python: a PATH-resolvable but non-functional candidate is rejected" {
  # Simulates the Store-alias-stub scenario: on PATH, but running it fails.
  mkdir -p "$BATS_TEST_TMPDIR/fakebin"
  cat > "$BATS_TEST_TMPDIR/fakebin/brokenpython" <<'EOF'
#!/bin/sh
exit 9
EOF
  chmod +x "$BATS_TEST_TMPDIR/fakebin/brokenpython"
  PATH="$BATS_TEST_TMPDIR/fakebin:$PATH" run resolve_python brokenpython
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "resolve_python: no candidate resolves at all → failure, empty output" {
  run resolve_python this-does-not-exist-anywhere-xyz123
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "resolve_python: skips a non-functional candidate and falls through to a working one" {
  [ -n "$PYTHON" ] || skip "python not available"
  mkdir -p "$BATS_TEST_TMPDIR/fakebin"
  cat > "$BATS_TEST_TMPDIR/fakebin/brokenpython" <<'EOF'
#!/bin/sh
exit 9
EOF
  chmod +x "$BATS_TEST_TMPDIR/fakebin/brokenpython"
  result=$(resolve_python brokenpython "$PYTHON")
  [ "$result" = "$PYTHON" ]
}

# --- unique_tmp (concurrent-write clobber fix, Audtor 2026-07-02 minor) --

@test "unique_tmp: two calls for the same destination return DIFFERENT paths" {
  a=$(unique_tmp "$BATS_TEST_TMPDIR/state.json")
  b=$(unique_tmp "$BATS_TEST_TMPDIR/state.json")
  [ "$a" != "$b" ]
}

@test "unique_tmp: the returned path is in the SAME directory as the destination (same-fs atomic rename)" {
  mkdir -p "$BATS_TEST_TMPDIR/statedir"
  result=$(unique_tmp "$BATS_TEST_TMPDIR/statedir/state.json")
  [ "$(dirname "$result")" = "$BATS_TEST_TMPDIR/statedir" ]
}

# --- nearest_package_json_dir / node_project_dir_for (auto-format/lint --
# nested npm root fix, Audtor 2026-07-02 minor) --------------------------

@test "nearest_package_json_dir: finds a package.json in a parent directory" {
  mkdir -p "$BATS_TEST_TMPDIR/proj/src/deep"
  echo '{}' > "$BATS_TEST_TMPDIR/proj/package.json"
  result=$(nearest_package_json_dir "$BATS_TEST_TMPDIR/proj/src/deep")
  [ "$result" = "$BATS_TEST_TMPDIR/proj" ]
}

@test "nearest_package_json_dir: none found within the ceiling → empty, failure status" {
  mkdir -p "$BATS_TEST_TMPDIR/noproj/src"
  run nearest_package_json_dir "$BATS_TEST_TMPDIR/noproj/src" "$BATS_TEST_TMPDIR/noproj"
  [ "$status" -eq 1 ]
  [ -z "$output" ]
}

@test "nearest_package_json_dir: a package.json ABOVE the ceiling is not used" {
  mkdir -p "$BATS_TEST_TMPDIR/outer/inner/src"
  echo '{}' > "$BATS_TEST_TMPDIR/outer/package.json"
  run nearest_package_json_dir "$BATS_TEST_TMPDIR/outer/inner/src" "$BATS_TEST_TMPDIR/outer/inner"
  [ "$status" -eq 1 ]
}

@test "node_project_dir_for: resolves a relative file path against \$PWD, then walks up" {
  mkdir -p "$BATS_TEST_TMPDIR/nproj/console/src"
  echo '{}' > "$BATS_TEST_TMPDIR/nproj/console/package.json"
  ( cd "$BATS_TEST_TMPDIR/nproj" && result=$(node_project_dir_for "console/src/app.ts") \
    && [ "$result" = "$BATS_TEST_TMPDIR/nproj/console" ] )
}
