#!/usr/bin/env bats
# Golden-fixture regression for the config-security auditor (TASK-019).
# A fixed fixture tree (tests/fixtures/cfgsec-sample) has a known, stable set
# of issues; the recorded golden (tests/golden/cfgsec-sample.findings) is the
# expected finding identity set (severity|surface|location — NOT message text,
# so wording changes don't break it). If a change to config-security.sh alters
# what it finds on fixed input, this catches it — the integration tier above
# the per-behaviour bats tests. This is the achievable form of "golden-trace
# replay" for a deterministic detector: record input + expected output, assert
# it still matches on a new version. (We can't replay the LLM detectors — we
# don't own the model client — so replay applies to the shell auditors only.)

load helpers

FIXTURE="$FW_REPO_ROOT/.claude/framework/tests/fixtures/cfgsec-sample"
GOLDEN="$FW_REPO_ROOT/.claude/framework/tests/golden/cfgsec-sample.findings"

@test "config-security: fixture findings match recorded golden" {
  command -v jq >/dev/null 2>&1 || skip "jq needed for json golden comparison"

  # Run on a NON-git copy so config-security's `git rev-parse || pwd` falls
  # back to the copy dir (a git repo would resolve to the wrong toplevel).
  work="$BATS_TEST_TMPDIR/cfgsec"
  mkdir -p "$work"
  cp -r "$FIXTURE/." "$work/"

  run bash -c "cd '$work' && bash '$AUDIT/config-security.sh' --format json"
  [ "$status" -eq 2 ]   # fixture has 2 CRITICAL → exit 2

  # tr -d '\r': the Git-Bash jq build emits CRLF on -r output; strip it so
  # the comparison is line-ending agnostic (our standard CRLF discipline).
  actual="$(echo "$output" | jq -r '.findings[] | "\(.severity)|\(.surface)|\(.location)"' | tr -d '\r' | LC_ALL=C sort)"
  golden="$(tr -d '\r' < "$GOLDEN" | LC_ALL=C sort)"

  if [ "$actual" != "$golden" ]; then
    echo "--- ACTUAL ---"; echo "$actual"
    echo "--- GOLDEN ---"; echo "$golden"
    echo "(If this change to config-security.sh is intentional, update"
    echo " tests/golden/cfgsec-sample.findings to match.)"
  fi
  [ "$actual" = "$golden" ]
}
