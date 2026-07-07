#!/usr/bin/env bats
# Behavioural tests for merge-hook-registrations.sh (TASK-069) — the additive
# settings.json hook-registration merge that closes the propagation gap
# (FRAMEWORK-SUGGESTIONS 2026-06-29). Uses a fixed minimal synthetic "canonical"
# settings so the tests exercise the merge LOGIC, not the live canonical file.

load helpers

setup() {
  init_repo
  MERGE="$FW_REPO_ROOT/.claude/framework/update/merge-hook-registrations.sh"
  CANON="$REPO/canonical-settings.json"
  CONSUMER="$REPO/settings.json"
  _write_canonical
}

# A minimal framework settings covering the shapes that matter: a no-matcher
# multi-hook group (UserPromptSubmit), a no-matcher group alongside a matchered
# one (PostToolUse), and a single matchered group (PreToolUse Bash).
_write_canonical() {
  cat > "$CANON" <<'JSON'
{
  "permissions": { "allow": ["Read"], "deny": [] },
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [
        { "type": "command", "command": "bash .claude/hooks/drift-guard.sh" },
        { "type": "command", "command": "bash .claude/hooks/console-heartbeat.sh" }
      ] }
    ],
    "PostToolUse": [
      { "matcher": "Write|Edit", "hooks": [
        { "type": "command", "command": "bash .claude/hooks/post-edit-dispatch.sh" }
      ] },
      { "hooks": [
        { "type": "command", "command": "bash .claude/hooks/console-heartbeat.sh" }
      ] }
    ],
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [
        { "type": "command", "command": "bash .claude/hooks/block-dangerous.sh" }
      ] }
    ]
  }
}
JSON
}

# Total registered hook commands across all events (the merge only ever adds).
_cmd_total() { jq '[.hooks // {} | .[][]? | (.hooks // [])[] | .command] | length' "$1"; }

@test "merge: consumer missing console-heartbeat → exactly 2 added, one per event" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  # consumer = canonical with every console-heartbeat registration stripped + a
  # consumer-owned hook and an extra permission.
  jq '(.hooks[][].hooks) |= map(select(.command | test("console-heartbeat") | not))
      | .permissions.allow += ["WebFetch"]
      | .hooks.UserPromptSubmit[0].hooks += [{"type":"command","command":"bash my-hook.sh"}]' \
     "$CANON" > "$CONSUMER"
  before=$(_cmd_total "$CONSUMER")
  run bash "$MERGE" "$CONSUMER" "$CANON"
  [ "$status" -eq 0 ]
  [[ "$output" == *"registered 2 new"* ]]
  after=$(_cmd_total "$CONSUMER")
  [ "$after" -eq $((before + 2)) ]
  # one heartbeat under each of the two events
  [ "$(jq '[.hooks.UserPromptSubmit[].hooks[].command | select(test("console-heartbeat"))] | length' "$CONSUMER")" -eq 1 ]
  [ "$(jq '[.hooks.PostToolUse[].hooks[].command | select(test("console-heartbeat"))] | length' "$CONSUMER")" -eq 1 ]
  jq -e . "$CONSUMER" >/dev/null   # still valid JSON
}

@test "merge: preserves consumer permissions + consumer-owned hooks" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  jq '(.hooks[][].hooks) |= map(select(.command | test("console-heartbeat") | not))
      | .permissions.allow += ["WebFetch"]
      | .hooks.UserPromptSubmit[0].hooks += [{"type":"command","command":"bash my-hook.sh"}]' \
     "$CANON" > "$CONSUMER"
  bash "$MERGE" "$CONSUMER" "$CANON"
  [ "$(jq '.permissions.allow | index("WebFetch") != null' "$CONSUMER")" = "true" ]
  [ "$(jq '[.hooks.UserPromptSubmit[].hooks[].command | select(test("my-hook"))] | length' "$CONSUMER")" -eq 1 ]
}

@test "merge: idempotent — second run reports no change, file byte-identical" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  jq '(.hooks[][].hooks) |= map(select(.command | test("console-heartbeat") | not))' "$CANON" > "$CONSUMER"
  bash "$MERGE" "$CONSUMER" "$CANON"
  cp "$CONSUMER" "$REPO/snap.json"
  run bash "$MERGE" "$CONSUMER" "$CANON"
  [ "$status" -eq 0 ]
  [[ "$output" == *"already present"* ]]
  diff -q "$CONSUMER" "$REPO/snap.json"
}

@test "merge: already-complete consumer → no change (file untouched)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  cp "$CANON" "$CONSUMER"
  cp "$CONSUMER" "$REPO/snap.json"
  run bash "$MERGE" "$CONSUMER" "$CANON"
  [[ "$output" == *"already present"* ]]
  diff -q "$CONSUMER" "$REPO/snap.json"
}

@test "merge: missing matchered hook → added INTO the matching group, not a new one" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  # strip the PreToolUse Bash block-dangerous hook (group kept, hook removed)
  jq '(.hooks.PreToolUse[0].hooks) |= map(select(.command | test("block-dangerous") | not))' "$CANON" > "$CONSUMER"
  run bash "$MERGE" "$CONSUMER" "$CANON"
  [[ "$output" == *"registered 1 new"* ]]
  # still exactly ONE PreToolUse group, and it carries block-dangerous
  [ "$(jq '.hooks.PreToolUse | length' "$CONSUMER")" -eq 1 ]
  [ "$(jq '.hooks.PreToolUse[0].matcher' "$CONSUMER")" = '"Bash"' ]
  [ "$(jq '[.hooks.PreToolUse[0].hooks[].command | select(test("block-dangerous"))] | length' "$CONSUMER")" -eq 1 ]
}

@test "merge: consumer missing a whole event → event created with the hook" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  jq 'del(.hooks.PreToolUse)' "$CANON" > "$CONSUMER"
  run bash "$MERGE" "$CONSUMER" "$CANON"
  [[ "$output" == *"registered 1 new"* ]]
  [ "$(jq '.hooks.PreToolUse[0].matcher' "$CONSUMER")" = '"Bash"' ]
}

@test "merge: invalid-JSON consumer → fail-soft, exit 0, file unchanged" {
  printf 'not json {{{' > "$CONSUMER"
  cp "$CONSUMER" "$REPO/snap.json"
  run bash "$MERGE" "$CONSUMER" "$CANON"
  [ "$status" -eq 0 ]
  diff -q "$CONSUMER" "$REPO/snap.json"
}

@test "merge: missing args → exit 0, no action" {
  run bash "$MERGE"
  [ "$status" -eq 0 ]
}

@test "merge: retired framework command still registered → STALE warning (pinned canonical, Phase-B)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  # PINNED (previous) canonical shipped a hook the CURRENT canonical no longer
  # does (retired outright, or its command string changed).
  PINNED="$REPO/pinned-settings.json"
  jq '.hooks.PreToolUse[0].hooks += [{"type":"command","command":"bash .claude/hooks/retired.sh"}]' "$CANON" > "$PINNED"
  # Consumer = current canonical + still carries that retired registration.
  jq '.hooks.PreToolUse[0].hooks += [{"type":"command","command":"bash .claude/hooks/retired.sh"}]' "$CANON" > "$CONSUMER"
  run bash "$MERGE" "$CONSUMER" "$CANON" "$PINNED"
  [ "$status" -eq 0 ]
  [[ "$output" == *"STALE"* ]]
  [[ "$output" == *"retired.sh"* ]]
}

@test "merge: no STALE warning when pinned == current canonical (control)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  # Pinned identical to current canonical → nothing retired. Consumer even
  # carries an extra CONSUMER-OWNED hook (never in either canonical) — that must
  # NOT be reported as stale (it was never a framework registration).
  PINNED="$REPO/pinned-settings.json"
  cp "$CANON" "$PINNED"
  jq '.hooks.UserPromptSubmit[0].hooks += [{"type":"command","command":"bash my-own-hook.sh"}]' "$CANON" > "$CONSUMER"
  run bash "$MERGE" "$CONSUMER" "$CANON" "$PINNED"
  [ "$status" -eq 0 ]
  [[ "$output" != *"STALE"* ]]
}

@test "merge: no pinned-canonical arg → additive-only, no STALE check (back-compat)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  # Consumer carries a registration absent from current canonical, but with NO
  # 3rd arg the script can't know it was framework's — must stay silent on it.
  jq '.hooks.PreToolUse[0].hooks += [{"type":"command","command":"bash .claude/hooks/retired.sh"}]' "$CANON" > "$CONSUMER"
  run bash "$MERGE" "$CONSUMER" "$CANON"
  [ "$status" -eq 0 ]
  [[ "$output" != *"STALE"* ]]
}

@test "merge: matcher-aware dedup — an upstream matcher change for an existing hook propagates (audit minor c)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  # Consumer already has block-dangerous.sh registered, but under NO
  # matcher — as if upstream used to ship it unmatched and $CANON has
  # since moved it under "Bash". Pre-fix, dedup keyed on the command
  # string ALONE (any matcher), so the existing wrong-matcher registration
  # made the tuple look "already registered" and the matcher change never
  # propagated — 0 added, no Bash-matchered group ever created.
  jq '.hooks.PreToolUse = [ { "hooks": [ { "type": "command", "command": "bash .claude/hooks/block-dangerous.sh" } ] } ]' \
     "$CANON" > "$CONSUMER"
  run bash "$MERGE" "$CONSUMER" "$CANON"
  [ "$status" -eq 0 ]
  [[ "$output" == *"registered 1 new"* ]]
  # The new Bash-matchered group now carries block-dangerous.sh...
  [ "$(jq '[.hooks.PreToolUse[] | select(.matcher=="Bash") | .hooks[].command | select(test("block-dangerous"))] | length' "$CONSUMER")" -eq 1 ]
  # ...while the old unmatched registration is untouched (additive-only, never removes/rewrites).
  [ "$(jq '[.hooks.PreToolUse[] | select(.matcher==null) | .hooks[].command | select(test("block-dangerous"))] | length' "$CONSUMER")" -eq 1 ]
}
