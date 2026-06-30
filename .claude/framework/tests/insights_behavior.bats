#!/usr/bin/env bats
# Behavioural tests for the insights scripts. These derive PROJECT_ROOT from
# their own location (SCRIPT_DIR/../../..), so each test copies them into the
# throwaway repo at the canonical depth before running.

load helpers

setup() {
  init_repo
  mkdir -p "$REPO/.claude/framework/insights"
  cp "$FW_REPO_ROOT/.claude/framework/insights/update-metrics.sh" \
     "$FW_REPO_ROOT/.claude/framework/insights/rollup.sh" \
     "$REPO/.claude/framework/insights/"
  # One valid event so the snapshot path (not the no-events short-circuit) runs.
  printf '{"ts":"2026-06-11T00:00:00Z","hook":"bash-guard","outcome":"allowed"}\n' \
    > "$REPO/.claude/telemetry/events.jsonl"
}

@test "update-metrics: consumer mode writes .claude/framework-metrics.md, not project root" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  # Regression: the consumer-mode branch targeted $PROJECT_ROOT/framework-metrics.md,
  # scattering a state file outside .claude/ (2026-06-11 healthcheck, finding B1).
  run bash "$REPO/.claude/framework/insights/update-metrics.sh"
  [ "$status" -eq 0 ]
  [ -f "$REPO/.claude/framework-metrics.md" ]
  [ ! -f "$REPO/framework-metrics.md" ]
}

@test "scrape-review-findings: blank-separated bullets are all counted (DA-C5 regression)" {
  # The old awk ended a section at the first blank line; the reviewer
  # format blank-separates bullets, so 3 findings counted as 1.
  cp "$FW_REPO_ROOT/.claude/framework/insights/scrape-review-findings.sh" \
     "$REPO/.claude/framework/insights/"
  printf 'TASK: x\nVERDICT: issues-found\n\nCRITICAL (must fix before merge):\n- one\n\n- two\n\n- three\n\nWARNING (should fix):\n- warn one\n\nFRAMEWORK HYGIENE:\n- not a finding\n' \
    > "$REPO/.claude/review-findings.md"
  rm -f "$REPO/.claude/telemetry/events.jsonl"
  run bash "$REPO/.claude/framework/insights/scrape-review-findings.sh"
  [ "$status" -eq 0 ]
  grep -q '"critical":3' "$REPO/.claude/telemetry/events.jsonl"
  grep -q '"warning":1' "$REPO/.claude/telemetry/events.jsonl"
  grep -q '"suggestion":0' "$REPO/.claude/telemetry/events.jsonl"
}

@test "instinct-miner: mines only genuine human turns — tool results, meta, sidechain, injected context all excluded (TASK-033)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  cp "$FW_REPO_ROOT/.claude/framework/insights/instinct-miner.sh" \
     "$REPO/.claude/framework/insights/"
  # Synthetic transcript: 2 real corrections buried in every noise class
  # the 2026-06-11 sessions observed being mined as user corrections.
  cat > "$REPO/transcript.jsonl" <<'EOF'
{"type":"user","toolUseResult":{"ok":true},"message":{"content":[{"type":"tool_result","content":[{"type":"text","text":"NEVER bypass the doctor check. Always run tests before committing."}]}]}}
{"type":"user","isMeta":true,"message":{"content":[{"type":"text","text":"Run the wrapup sequence. Do not skip state updates. Never end a session without the stop hook. Always update the board."}]}}
{"type":"user","isSidechain":true,"message":{"content":[{"type":"text","text":"you must never use grep directly in audits"}]}}
{"type":"user","message":{"content":[{"type":"text","text":"<ide_opened_file>The user opened foo.sh which says never hardcode paths</ide_opened_file>"}]}}
{"type":"user","message":{"content":[{"type":"text","text":"here is the log:\n```\nERROR: never reuse a stale lock file\n```\nthanks"}]}}
{"type":"user","message":{"content":[{"type":"text","text":"ok proceed\n<system-reminder>\nAlways stop and never continue without approval.\n</system-reminder>"}]}}
{"type":"user","message":{"content":[{"type":"text","text":"actually use the helper instead of duplicating it"}]}}
{"type":"user","message":{"content":[{"type":"text","text":"no, don't commit directly to main please"}]}}
EOF
  # instinct-miner resolves its root via `git rev-parse` on the CWD (not
  # SCRIPT_DIR) — run from inside $REPO or the flag lands in the real repo.
  run bash -c "cd '$REPO' && INSTINCT_MIN_SIGNALS=2 bash .claude/framework/insights/instinct-miner.sh --transcript ./transcript.jsonl"
  [ "$status" -eq 0 ]
  FLAG="$REPO/.claude/.instinct-candidates.md"
  [ -f "$FLAG" ]
  # Exactly the 2 genuine corrections (snippets are normalized: lowercase,
  # punctuation stripped).
  grep -q "2 correction + 0 strategy candidate" "$FLAG"
  grep -q "actually use the helper instead" "$FLAG"
  grep -q "don t commit directly to main" "$FLAG"
  # None of the noise classes leaked through.
  ! grep -qi "doctor" "$FLAG"            # tool_result
  ! grep -qi "stop hook" "$FLAG"         # isMeta skill expansion
  ! grep -qi "grep directly" "$FLAG"     # sidechain
  ! grep -qi "hardcode" "$FLAG"          # ide-injected item
  ! grep -qi "stale lock" "$FLAG"        # fenced paste
  ! grep -qi "without approval" "$FLAG"  # system-reminder range
}

@test "session-summary: counts only events after the last cost-tracker marker (TASK-034)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  cp "$FW_REPO_ROOT/.claude/framework/insights/session-summary.sh" \
     "$REPO/.claude/framework/insights/"
  # Two sessions: marker bounds them. Pre-marker events must NOT count.
  # Post-marker: 1 blocked guard, 2 drift fires (one trigger x2), 1 stop
  # block, 1 format ran + 1 skipped, python-style spaced JSON, and a
  # malformed line that must be tolerated.
  cat > "$REPO/.claude/telemetry/events.jsonl" <<'EOF'
{"ts":"2026-06-12T00:00:01Z","hook":"bash-guard","outcome":"allowed"}
{"ts":"2026-06-12T00:00:02Z","hook":"drift-guard","outcome":"drift-detected","trigger":"old-session-noise"}
{"ts":"2026-06-12T00:00:03Z","hook":"cost-tracker","outcome":"session-end","tool_uses":311,"transcript_lines":99}
{"ts": "2026-06-12T01:00:01Z", "hook": "bash-guard", "outcome": "blocked"}
not-json garbage line
{"ts":"2026-06-12T01:00:02Z","hook":"drift-guard","outcome":"drift-detected","trigger":"no-task-claimed"}
{"ts":"2026-06-12T01:00:03Z","hook":"drift-guard","outcome":"drift-detected","trigger":"no-task-claimed"}
{"ts":"2026-06-12T01:00:04Z","hook":"drift-guard","outcome":"clean"}
{"ts":"2026-06-12T01:00:05Z","hook":"stop","outcome":"blocked"}
{"ts":"2026-06-12T01:00:06Z","hook":"format","outcome":"formatted"}
{"ts":"2026-06-12T01:00:07Z","hook":"format","outcome":"skipped"}
{"ts":"2026-06-12T01:00:08Z","hook":"lint","outcome":"skipped"}
{"ts":"2026-06-12T01:00:09Z","hook":"verify-deps","outcome":"clean"}
EOF
  run bash -c "cd '$REPO' && bash .claude/framework/insights/session-summary.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"9 hook events this window"* ]]
  [[ "$output" == *"bash-guard 0 allowed / 1 blocked"* ]]
  [[ "$output" == *"drift-guard 2 fire(s) (no-task-claimed x2)"* ]]
  [[ "$output" == *"stop-hook 1 block(s)"* ]]
  [[ "$output" == *"format 1 ran / 1 skipped"* ]]
  [[ "$output" == *"verify-deps 1 check(s)"* ]]
  [[ "$output" == *"prev session 311 tool calls"* ]]
  # Pre-marker trigger must not leak into the window.
  [[ "$output" != *"old-session-noise"* ]]
}

@test "session-summary: fail-soft — no events file and no jq both yield one advisory line, exit 0" {
  cp "$FW_REPO_ROOT/.claude/framework/insights/session-summary.sh" \
     "$REPO/.claude/framework/insights/"
  rm -f "$REPO/.claude/telemetry/events.jsonl"
  run bash -c "cd '$REPO' && bash .claude/framework/insights/session-summary.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"telemetry unavailable"* ]]
}

@test "session-summary: no cost-tracker marker — whole file is the window, prev cost n/a" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  cp "$FW_REPO_ROOT/.claude/framework/insights/session-summary.sh" \
     "$REPO/.claude/framework/insights/"
  printf '{"ts":"2026-06-12T01:00:01Z","hook":"bash-guard","outcome":"allowed"}\n' \
    > "$REPO/.claude/telemetry/events.jsonl"
  run bash -c "cd '$REPO' && bash .claude/framework/insights/session-summary.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"1 hook events this window"* ]]
  [[ "$output" == *"prev session cost n/a (no marker)"* ]]
}

@test "session-summary: v2 stream windows by session_id — mid-session marker does NOT split (TASK-021)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  cp "$FW_REPO_ROOT/.claude/framework/insights/session-summary.sh" \
     "$REPO/.claude/framework/insights/"
  # Session A ends with its marker (tool_uses 100). Session B has a
  # MID-SESSION Stop (marker tool_uses 50) and continues — the old
  # marker heuristic would have cut B's window there; session_id
  # windowing must keep all 4 B events together and report A's 100 as
  # the previous session's cost (most recent marker from a DIFFERENT sid).
  cat > "$REPO/.claude/telemetry/events.jsonl" <<'EOF'
{"ts":"2026-06-12T00:00:01Z","schema":2,"event_id":"e1","session_id":"sess-A","hook":"bash-guard","outcome":"allowed","outcome_class":"ok"}
{"ts":"2026-06-12T00:00:02Z","schema":2,"event_id":"e2","session_id":"sess-A","hook":"cost-tracker","outcome":"session-end","outcome_class":"ok","tool_uses":100,"transcript_lines":9}
{"ts":"2026-06-12T01:00:01Z","schema":2,"event_id":"e3","session_id":"sess-B","hook":"drift-guard","outcome":"drift-detected","outcome_class":"flagged","trigger":"no-task-claimed"}
{"ts":"2026-06-12T01:00:02Z","schema":2,"event_id":"e4","session_id":"sess-B","hook":"cost-tracker","outcome":"session-end","outcome_class":"ok","tool_uses":50,"transcript_lines":5}
{"ts":"2026-06-12T01:00:03Z","schema":2,"event_id":"e5","session_id":"sess-B","hook":"bash-guard","outcome":"blocked","outcome_class":"blocked"}
{"ts":"2026-06-12T01:00:04Z","schema":2,"event_id":"e6","session_id":"sess-B","hook":"format","outcome":"formatted","outcome_class":"ok"}
EOF
  run bash -c "cd '$REPO' && bash .claude/framework/insights/session-summary.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"4 hook events this window"* ]]
  [[ "$output" == *"drift-guard 1 fire(s) (no-task-claimed x1)"* ]]
  [[ "$output" == *"bash-guard 0 allowed / 1 blocked"* ]]
  [[ "$output" == *"prev session 100 tool calls"* ]]
}

@test "rollup: v2 session structure — sessions, schema_mix, by_session; malformed line tolerated (TASK-021)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  # Mixed v1 + v2 stream with a garbage line: v1 events count in by_hook
  # but contribute nothing to by_session; the garbage line is dropped,
  # not fatal (the old jq -s aborted the whole rollup on it).
  cat > "$REPO/.claude/telemetry/events.jsonl" <<'EOF'
{"ts":"2026-06-11T00:00:01Z","hook":"format","outcome":"skipped"}
garbage \x00 not json
{"ts":"2026-06-12T00:00:01Z","schema":2,"event_id":"e1","session_id":"s1","hook":"stop","outcome":"blocked","outcome_class":"blocked","missing":"TASKS.md"}
{"ts":"2026-06-12T00:00:02Z","schema":2,"event_id":"e2","session_id":"s1","hook":"drift-guard","outcome":"drift-detected","outcome_class":"flagged","trigger":"stale-state"}
{"ts":"2026-06-12T01:00:01Z","schema":2,"event_id":"e3","session_id":"s2","hook":"stop","outcome":"passed","outcome_class":"ok"}
EOF
  run bash "$REPO/.claude/framework/insights/rollup.sh"
  [ "$status" -eq 0 ]
  M="$REPO/.claude/telemetry/.hook-metrics"
  jq -e '.total_events == 4' "$M"
  jq -e '.schema_mix.v1 == 1 and .schema_mix.v2 == 3' "$M"
  jq -e '.sessions == 2' "$M"
  jq -e '.by_session["s1"].total == 2 and .by_session["s1"].stop_blocked == 1 and .by_session["s1"].blocked == 1 and .by_session["s1"].drift_fires == 1' "$M"
  jq -e '.by_session["s2"].stop_blocked == 0' "$M"
  # v1 events still aggregate in by_hook (back-compat for analyse.sh thresholds).
  jq -e '.by_hook.format.outcomes.skipped == 1' "$M"
}

@test "push-state: no upstream → branch + advisory line, exit 0 (TASK-040)" {
  cp "$FW_REPO_ROOT/.claude/framework/insights/push-state.sh" \
     "$REPO/.claude/framework/insights/" 2>/dev/null || {
    mkdir -p "$REPO/.claude/framework/insights"
    cp "$FW_REPO_ROOT/.claude/framework/insights/push-state.sh" "$REPO/.claude/framework/insights/"
  }
  ( cd "$REPO" && git commit -q --allow-empty -m base )
  run bash -c "cd '$REPO' && bash .claude/framework/insights/push-state.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"no upstream configured"* ]]
}

@test "push-state: ahead/behind computed from tracking ref; uncommitted counted (TASK-040)" {
  mkdir -p "$REPO/.claude/framework/insights"
  cp "$FW_REPO_ROOT/.claude/framework/insights/push-state.sh" "$REPO/.claude/framework/insights/"
  ( cd "$REPO" \
    && git commit -q --allow-empty -m base \
    && git init -q --bare "$BATS_TEST_TMPDIR/origin.git" \
    && git remote add origin "$BATS_TEST_TMPDIR/origin.git" \
    && git push -q -u origin HEAD 2>/dev/null \
    && git commit -q --allow-empty -m "ahead-1" \
    && echo wip > untracked-wip.txt )
  run bash -c "cd '$REPO' && bash .claude/framework/insights/push-state.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"1 ahead / 0 behind"* ]]
  # 2 = untracked-wip.txt + the untracked .claude/ fixture dir (porcelain
  # collapses an untracked dir to one line).
  [[ "$output" == *"2 uncommitted change(s)"* ]]
}

@test "update-metrics: writes to root .claude/framework-metrics.md (no self redirect, TASK-054)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  run bash "$REPO/.claude/framework/insights/update-metrics.sh"
  [ "$status" -eq 0 ]
  [ -f "$REPO/.claude/framework-metrics.md" ]
  [ ! -f "$REPO/.claude/framework/self/framework-metrics.md" ]
}
