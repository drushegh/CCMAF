#!/usr/bin/env bats
# Audit U3 + U4 for check-updates.sh:
#   U3 — a failed inspection clone surfaces git's real error (last stderr line)
#        plus an SSH-alias hint, and exits 4 (distinct from 3 = offline).
#   U4 — --force bypasses the FRAMEWORK_CHECK_INTERVAL_HOURS throttle.

load update_helpers

check_updates_args() { ( cd "$CONSUMER" && bash .claude/framework/update/check-updates.sh "$@" ); }

# A git shim on PATH: ls-remote etc. pass through to the real git; `clone`
# fails with a canned two-line error so the "last line" pick is observable.
_install_failing_clone_shim() {
  local real_git; real_git="$(command -v git)"
  SHIM="$BATS_TEST_TMPDIR/shim"
  mkdir -p "$SHIM"
  cat > "$SHIM/git" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = clone ]; then
  echo "Cloning into 'x'..." >&2
  echo "git@github.com: Permission denied (publickey)." >&2
  echo "fatal: Could not read from remote repository." >&2
  exit 128
fi
exec "$real_git" "\$@"
EOF
  chmod +x "$SHIM/git"
}

@test "U4: --force ignores a fresh throttle and runs the live check" {
  build_upstream
  build_consumer
  set_version_field FRAMEWORK_LAST_CHECKED "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  run check_updates_args            # throttled → silent, no flag
  [ "$status" -eq 0 ]
  [ ! -f "$CFLAG" ]
  run check_updates_args --force    # forced → live check finds v2
  [ "$status" -eq 0 ]
  [ -f "$CFLAG" ]
  grep -q "${UPSTREAM_V2_SHA:0:7}" "$CFLAG"
}

@test "U4: --force against an unreachable upstream reports offline (proves no throttle short-circuit)" {
  build_upstream
  build_consumer
  set_version_field FRAMEWORK_UPSTREAM_URL "$BATS_TEST_TMPDIR/does-not-exist"
  set_version_field FRAMEWORK_LAST_CHECKED "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  run check_updates_args --force
  [ "$status" -eq 3 ]
}

@test "U3: clone failure after ls-remote → exit 4, last git error line + SSH hint" {
  build_upstream
  build_consumer
  _install_failing_clone_shim
  echo "PENDING-789" > "$CFLAG"
  run bash -c "cd '$CONSUMER' && PATH='$SHIM':\"\$PATH\" bash .claude/framework/update/check-updates.sh"
  [ "$status" -eq 4 ]
  [[ "$output" == *"clone failed"* ]]
  [[ "$output" == *"git: fatal: Could not read from remote repository."* ]]
  [[ "$output" != *"Cloning into"* ]]          # only the LAST line is surfaced
  [[ "$output" == *"SSH hint"* ]]              # publickey in the error → hint
  grep -q "PENDING-789" "$CFLAG"               # DA-C4: pending flag untouched
}

@test "U3: non-SSH clone failure → exit 4 with git's message, no SSH hint" {
  build_upstream
  build_consumer
  local real_git; real_git="$(command -v git)"
  SHIM="$BATS_TEST_TMPDIR/shim2"; mkdir -p "$SHIM"
  cat > "$SHIM/git" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = clone ]; then echo "fatal: No space left on device" >&2; exit 128; fi
exec "$real_git" "\$@"
EOF
  chmod +x "$SHIM/git"
  run bash -c "cd '$CONSUMER' && PATH='$SHIM':\"\$PATH\" bash .claude/framework/update/check-updates.sh"
  [ "$status" -eq 4 ]
  [[ "$output" == *"git: fatal: No space left on device"* ]]
  [[ "$output" != *"SSH hint"* ]]
}

@test "U3: cold-start.sh treats check-updates exit 4 as non-fatal" {
  grep -Eq '^[[:space:]]+0\|2\|3\|4\) ;;' "$FW_REPO_ROOT/.claude/framework/boot/cold-start.sh"
}

@test "check-updates: credentials in an https upstream URL are redacted in output (review P3)" {
  build_upstream
  build_consumer
  set_version_field FRAMEWORK_UPSTREAM_URL "https://someone:s3cr3t-token@127.0.0.1:9/x.git"
  run bash -c "cd '$CONSUMER' && GIT_TERMINAL_PROMPT=0 bash .claude/framework/update/check-updates.sh --force"
  [ "$status" -eq 3 ]
  [[ "$output" == *"https://***@127.0.0.1:9/x.git"* ]]
  [[ "$output" != *"s3cr3t-token"* ]]
}
