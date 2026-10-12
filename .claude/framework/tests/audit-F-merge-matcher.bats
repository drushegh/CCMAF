#!/usr/bin/env bats
# Audit U2: merge-hook-registrations.sh treats matcher:"" and an absent matcher
# as ONE key (both mean "match everything"), so a "" group never double-
# registers a hook already present unmatchered (or vice versa); plus --dry-run.

load helpers

setup() {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  MERGE="$FW_REPO_ROOT/.claude/framework/update/merge-hook-registrations.sh"
  D="$BATS_TEST_TMPDIR"
  CANON="$D/canon.json"
  CONSUMER="$D/settings.json"
}

_total() { jq '[.hooks // {} | .[][]? | (.hooks // [])[] | .command] | length' "$1"; }

@test "U2: canonical matcher \"\" vs consumer unmatchered group → no double registration" {
  cat > "$CANON" <<'JSON'
{ "hooks": { "Stop": [ { "matcher": "", "hooks": [ {"type":"command","command":"bash a.sh"} ] } ] } }
JSON
  cat > "$CONSUMER" <<'JSON'
{ "hooks": { "Stop": [ { "hooks": [ {"type":"command","command":"bash a.sh"} ] } ] } }
JSON
  cp "$CONSUMER" "$D/snap.json"
  run bash "$MERGE" "$CONSUMER" "$CANON"
  [ "$status" -eq 0 ]
  [[ "$output" == *"already present"* ]]
  diff -q "$CONSUMER" "$D/snap.json"
}

@test "U2: canonical unmatchered vs consumer matcher \"\" group → no double registration" {
  cat > "$CANON" <<'JSON'
{ "hooks": { "Stop": [ { "hooks": [ {"type":"command","command":"bash a.sh"} ] } ] } }
JSON
  cat > "$CONSUMER" <<'JSON'
{ "hooks": { "Stop": [ { "matcher": "", "hooks": [ {"type":"command","command":"bash a.sh"} ] } ] } }
JSON
  run bash "$MERGE" "$CONSUMER" "$CANON"
  [ "$status" -eq 0 ]
  [[ "$output" == *"already present"* ]]
  [ "$(_total "$CONSUMER")" -eq 1 ]
}

@test "U2: a NEW hook under matcher \"\" lands in the existing unmatchered group" {
  cat > "$CANON" <<'JSON'
{ "hooks": { "Stop": [ { "matcher": "", "hooks": [
  {"type":"command","command":"bash a.sh"}, {"type":"command","command":"bash b.sh"} ] } ] } }
JSON
  cat > "$CONSUMER" <<'JSON'
{ "hooks": { "Stop": [ { "hooks": [ {"type":"command","command":"bash a.sh"} ] } ] } }
JSON
  run bash "$MERGE" "$CONSUMER" "$CANON"
  [ "$status" -eq 0 ]
  [[ "$output" == *"registered 1 new"* ]]
  [ "$(jq '.hooks.Stop | length' "$CONSUMER")" -eq 1 ]          # no second group
  [ "$(jq '.hooks.Stop[0].hooks | length' "$CONSUMER")" -eq 2 ]
}

@test "U2: a real matcher still keys separately from match-all" {
  cat > "$CANON" <<'JSON'
{ "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ {"type":"command","command":"bash a.sh"} ] } ] } }
JSON
  cat > "$CONSUMER" <<'JSON'
{ "hooks": { "PreToolUse": [ { "matcher": "", "hooks": [ {"type":"command","command":"bash a.sh"} ] } ] } }
JSON
  run bash "$MERGE" "$CONSUMER" "$CANON"
  [[ "$output" == *"registered 1 new"* ]]
  [ "$(jq '[.hooks.PreToolUse[] | select(.matcher=="Bash")] | length' "$CONSUMER")" -eq 1 ]
}

@test "U2: --dry-run reports the count + commands and never writes" {
  cat > "$CANON" <<'JSON'
{ "hooks": { "Stop": [ { "hooks": [
  {"type":"command","command":"bash a.sh"}, {"type":"command","command":"bash b.sh"},
  {"type":"command","command":"bash c.sh"} ] } ] } }
JSON
  cat > "$CONSUMER" <<'JSON'
{ "hooks": { "Stop": [ { "matcher": "", "hooks": [ {"type":"command","command":"bash a.sh"} ] } ] } }
JSON
  cp "$CONSUMER" "$D/snap.json"
  run bash "$MERGE" --dry-run "$CONSUMER" "$CANON"
  [ "$status" -eq 0 ]
  [[ "$output" == *"dry run — would register 2 new"* ]]
  [[ "$output" == *"+ bash b.sh"* ]]
  [[ "$output" == *"+ bash c.sh"* ]]
  [[ "$output" != *"+ bash a.sh"* ]]
  diff -q "$CONSUMER" "$D/snap.json"
}

@test "U2: --dry-run on a complete consumer → no-change message" {
  cat > "$CANON" <<'JSON'
{ "hooks": { "Stop": [ { "hooks": [ {"type":"command","command":"bash a.sh"} ] } ] } }
JSON
  cp "$CANON" "$CONSUMER"
  run bash "$MERGE" --dry-run "$CONSUMER" "$CANON"
  [ "$status" -eq 0 ]
  [[ "$output" == *"already present"* ]]
}

@test "U2: --dry-run lists a command being added under a NEW matcher (no undercount)" {
  cat > "$CANON" <<'JSON'
{ "hooks": { "PreToolUse": [ { "matcher": "Bash|PowerShell", "hooks": [ {"type":"command","command":"bash g.sh"} ] } ] } }
JSON
  cat > "$CONSUMER" <<'JSON'
{ "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ {"type":"command","command":"bash g.sh"} ] } ] } }
JSON
  run bash "$MERGE" --dry-run "$CONSUMER" "$CANON"
  [ "$status" -eq 0 ]
  [[ "$output" == *"would register 1 new"* ]]
  [[ "$output" == *"+ bash g.sh  (PreToolUse, matcher Bash|PowerShell)"* ]]
}
