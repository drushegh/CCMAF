#!/usr/bin/env bash
# run-tests.sh — framework self-test harness.
#
# Two layers, both opt-in by tool availability (the framework's standard
# pattern — a missing tool is a skip with an install hint, never a hard
# failure, unless you pass --require):
#
#   1. bats behavioural tests (*.bats) — feed each hook a simulated event
#      (stdin JSON + env) and assert (exit code + stdout). bats is run
#      directly if installed, else via `npx bats` if Node is present.
#   2. shellcheck static analysis over hooks + framework shell scripts.
#
# Exit codes:
#   0 — all present tools passed (or were skipped because absent)
#   1 — a present tool reported a failure, OR --require and a tool is absent
#
# Use it as a pre-commit gate ON THE FRAMEWORK ITSELF, or in CI:
#   bash .claude/framework/tests/run-tests.sh            # local: skip absent tools
#   bash .claude/framework/tests/run-tests.sh --require  # CI: absent tool = fail

set -uo pipefail

# Bash 4+ guard (DA-C8): mapfile below needs bash 4; stock macOS ships 3.2.
if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then
  echo "run-tests: bash >= 4 required (found ${BASH_VERSION:-unknown}). On macOS: brew install bash." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

REQUIRE=0
[ "${1:-}" = "--require" ] && REQUIRE=1

rc=0

# --- Layer 1: bats behavioural tests ---------------------------------
BATS=""
if command -v bats >/dev/null 2>&1; then
  BATS="bats"
elif command -v npx >/dev/null 2>&1; then
  # Pinned (DA-M8): an unpinned `npx --yes bats` floats to whatever npm
  # serves that day — non-deterministic CI and a wider supply-chain
  # surface. Bump deliberately, with a test run, like any dependency.
  BATS="npx --yes bats@1.13.0"
fi

if [ -n "$BATS" ]; then
  echo "== bats: behavioural hook tests =="
  # shellcheck disable=SC2086
  $BATS "$SCRIPT_DIR"/*.bats || rc=1
else
  echo "== bats: not installed — skipping behavioural tests."
  echo "   Install: npm i -g bats   (or just have Node present for 'npx bats')"
  [ "$REQUIRE" = 1 ] && rc=1
fi

echo

# --- Layer 2: shellcheck static analysis -----------------------------
if command -v shellcheck >/dev/null 2>&1; then
  echo "== shellcheck: hooks + framework shell scripts =="
  mapfile -t sh_files < <(
    find "$REPO_ROOT/.claude/hooks" "$REPO_ROOT/.claude/framework" \
      -type f -name '*.sh' -not -path '*/tests/fixtures/*' 2>/dev/null | sort
  )
  if [ ${#sh_files[@]} -gt 0 ]; then
    shellcheck -S warning "${sh_files[@]}" && echo "shellcheck: clean" || rc=1
  fi
else
  echo "== shellcheck: not installed — skipping static analysis."
  echo "   Install: scoop install shellcheck | choco install shellcheck | apt install shellcheck"
  [ "$REQUIRE" = 1 ] && rc=1
fi

echo
if [ "$rc" -eq 0 ]; then
  echo "self-test: PASS"
else
  echo "self-test: FAIL"
fi
exit "$rc"
