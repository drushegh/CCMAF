#!/usr/bin/env bats
# U10 regression tests (2026-09-26 deep-review fixes):
#   - profile-hooks report counts spaced-JSON (Python emitter) events
#   - profile-hooks bench runs the hook exactly once per iteration
#   - instinct-miner picks the EXACT mangled project dir, and refuses on an
#     ambiguous basename-suffix match instead of mining another project

load helpers

setup() {
  init_repo
}

PROF="$FW_REPO_ROOT/.claude/framework/telemetry/profile-hooks.sh"
MINER="$FW_REPO_ROOT/.claude/framework/insights/instinct-miner.sh"

@test "profile-hooks report: spaced JSON (bash-guard) events are counted" {
  printf '%s\n' \
    '{"ts": "x", "hook": "bash-guard", "outcome": "allowed", "outcome_class": "ok"}' \
    '{"hook":"lint","outcome":"noop","outcome_class":"skipped"}' \
    > "$REPO/.claude/telemetry/events.jsonl"
  run bash -c 'cd "$1" && bash "$2" report' _ "$REPO" "$PROF"
  [ "$status" -eq 0 ]
  [[ "$output" == *"bash-guard"* ]]
  [[ "$output" == *"lint"* ]]
}

@test "profile-hooks bench: a blocking hook runs exactly once per iteration" {
  cnt="$BATS_TEST_TMPDIR/count"
  : > "$cnt"
  printf '#!/usr/bin/env bash\necho x >> "%s"\nexit 2\n' "$cnt" > "$BATS_TEST_TMPDIR/hook.sh"
  run bash -c 'cd "$1" && bash "$2" bench "$3" "{}" 4' _ "$REPO" "$PROF" "$BATS_TEST_TMPDIR/hook.sh"
  [ "$status" -eq 0 ]
  [ "$(grep -c . "$cnt")" -eq 4 ]
}

_mangle() { printf '%s' "$1" | sed 's/[^A-Za-z0-9]/-/g'; }

@test "instinct-miner: exact mangled project dir wins over a basename lookalike" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  [ "${BASH_VERSINFO[0]}" -ge 4 ] || skip "bash 4 required"
  root="$(cd "$REPO" && git rev-parse --show-toplevel)"
  name="$(_mangle "$root")"
  if command -v cygpath >/dev/null 2>&1; then name="$(_mangle "$(cygpath -m "$root")")"; fi
  proj="$BATS_TEST_TMPDIR/home/.claude/projects"
  mkdir -p "$proj/$name" "$proj/X-other-$(basename "$root")-v2"
  printf '%s\n' '{"type":"user","message":{"content":"actually never do that"}}' > "$proj/$name/s.jsonl"
  run env HOME="$BATS_TEST_TMPDIR/home" bash -c 'cd "$1" && bash "$2"' _ "$REPO" "$MINER"
  [ "$status" -eq 0 ]
  [[ "$output" != *"no transcript found"* ]]
  [[ "$output" != *"ambiguous"* ]]
}

@test "instinct-miner: two basename-suffix matches (no exact dir) → refuse, don't guess" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  [ "${BASH_VERSINFO[0]}" -ge 4 ] || skip "bash 4 required"
  base="$(_mangle "$(basename "$REPO")")"
  proj="$BATS_TEST_TMPDIR/home/.claude/projects"
  mkdir -p "$proj/A-one-$base" "$proj/B-two-$base"
  run env HOME="$BATS_TEST_TMPDIR/home" bash -c 'cd "$1" && bash "$2"' _ "$REPO" "$MINER"
  [ "$status" -eq 0 ]
  [[ "$output" == *"ambiguous"* ]]
}
