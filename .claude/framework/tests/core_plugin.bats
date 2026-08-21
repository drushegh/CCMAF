#!/usr/bin/env bats
# core_plugin.bats — the ccmaf CORE plugin (TASK-171).
#
# Covers the v2-content activation gate (§0), the SessionStart digest with
# its 10KB inline ceiling (S1), the per-task budget counter (§6), the
# unattended machine gates (§8), and the kernel-side coverage-blackout
# warning + liveness markers (§0/D1-a). Hermetic per helpers.bash: every
# hook runs inside a throwaway git repo.

load helpers

CORE="$FW_REPO_ROOT/plugins/ccmaf"
KERNEL="$FW_REPO_ROOT/plugins/ccmaf-kernel"

setup() {
  [ -d "$CORE" ] || skip "plugins/ccmaf not present"
  init_repo
}

# Run a core hook with CLAUDE_PLUGIN_ROOT/CLAUDE_PROJECT_DIR set, JSON on stdin.
corehook() { # corehook <script-rel-path> <json>
  printf '%s' "$2" > "$REPO/event.json"
  ( cd "$REPO" && CLAUDE_PLUGIN_ROOT="$CORE" CLAUDE_PROJECT_DIR="$REPO" \
      bash "$CORE/$1" < "$REPO/event.json" )
}

kernelhook() { # kernelhook <json>
  printf '%s' "$1" > "$REPO/event.json"
  ( cd "$REPO" && CLAUDE_PLUGIN_ROOT="$KERNEL" CLAUDE_PROJECT_DIR="$REPO" \
      bash "$KERNEL/scripts/kernel-context.sh" < "$REPO/event.json" )
}

STARTUP='{"session_id":"s1","source":"startup"}'

# ---------- activation gate (§0) ----------

@test "core-context: silent in a non-CCMAF repo" {
  run corehook hooks/core-context.sh "$STARTUP"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "core-context: silent in a v1-marked repo (presence, no v2 line) — the §0 regression test" {
  mark_ccmaf
  run corehook hooks/core-context.sh "$STARTUP"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "core-context: emits the digest in a v2 repo and touches .core-present" {
  mark_ccmaf_v2
  run corehook hooks/core-context.sh "$STARTUP"
  [ "$status" -eq 0 ]
  [[ "$output" == *"CCMAF v2"* ]]
  [[ "$output" == *"State files"* ]]
  [ -f "$REPO/.claude/telemetry/.core-present" ]
}

@test "core-context: resume source is silent (context already holds the digest)" {
  mark_ccmaf_v2
  run corehook hooks/core-context.sh '{"session_id":"s1","source":"resume"}'
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "core-context: payload stays under the 10KB inline ceiling (S1)" {
  mark_ccmaf_v2
  run corehook hooks/core-context.sh "$STARTUP"
  [ "$status" -eq 0 ]
  [ "${#output}" -lt 10000 ]
}

@test "core-context: unattended banner appears only with CLAUDE_UNATTENDED=1" {
  mark_ccmaf_v2
  printf '%s' "$STARTUP" > "$REPO/event.json"
  run bash -c "cd '$REPO' && CLAUDE_PLUGIN_ROOT='$CORE' CLAUDE_PROJECT_DIR='$REPO' CLAUDE_UNATTENDED=1 bash '$CORE/hooks/core-context.sh' < '$REPO/event.json'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"UNATTENDED RUN"* ]]
  run corehook hooks/core-context.sh "$STARTUP"
  [[ "$output" != *"UNATTENDED RUN"* ]]
}

# ---------- per-task budget counter (§6) ----------

@test "budget counter: no-op in a v1 repo even with a dispatch marker" {
  mark_ccmaf
  printf 'class=S\n' > "$REPO/.claude/telemetry/.task-dispatch.TASK-1"
  run corehook hooks/task-budget-counter.sh "$STARTUP"
  [ "$status" -eq 0 ]
  [ ! -f "$REPO/.claude/telemetry/.task-count.TASK-1" ]
}

@test "budget counter: no-op in a v2 repo without a dispatch marker" {
  mark_ccmaf_v2
  run corehook hooks/task-budget-counter.sh "$STARTUP"
  [ "$status" -eq 0 ]
  run bash -c "ls '$REPO/.claude/telemetry/'.task-count.* 2>/dev/null"
  [ -z "$output" ]
}

@test "budget counter: nags at half and at budget for class S (15, 30)" {
  mark_ccmaf_v2
  printf 'class=S\n' > "$REPO/.claude/telemetry/.task-dispatch.TASK-9"
  printf '14' > "$REPO/.claude/telemetry/.task-count.TASK-9"
  run corehook hooks/task-budget-counter.sh "$STARTUP"
  [ "$status" -eq 2 ]
  [[ "$output" == *"[TASK-9] 15 tool calls"* ]]
  printf '29' > "$REPO/.claude/telemetry/.task-count.TASK-9"
  run corehook hooks/task-budget-counter.sh "$STARTUP"
  [ "$status" -eq 2 ]
  [[ "$output" == *"blocked-return protocol"* ]]
}

@test "budget counter: silent between thresholds; counts tasks independently" {
  mark_ccmaf_v2
  printf 'class=M\n' > "$REPO/.claude/telemetry/.task-dispatch.TASK-2"
  printf 'class=M\n' > "$REPO/.claude/telemetry/.task-dispatch.TASK-3"
  printf '10' > "$REPO/.claude/telemetry/.task-count.TASK-2"
  printf '28' > "$REPO/.claude/telemetry/.task-count.TASK-3"
  run corehook hooks/task-budget-counter.sh "$STARTUP"
  [ "$status" -eq 0 ]
  [ "$(cat "$REPO/.claude/telemetry/.task-count.TASK-2")" = "11" ]
  [ "$(cat "$REPO/.claude/telemetry/.task-count.TASK-3")" = "29" ]
}

# ---------- unattended machine gates (§8) ----------

unatt() { # unatt <json>
  printf '%s' "$1" > "$REPO/event.json"
  ( cd "$REPO" && CLAUDE_PLUGIN_ROOT="$CORE" CLAUDE_PROJECT_DIR="$REPO" CLAUDE_UNATTENDED=1 \
      bash "$CORE/hooks/unattended-guard.sh" < "$REPO/event.json" )
}

@test "unattended-guard: attended sessions are a no-op even for AskUserQuestion" {
  mark_ccmaf_v2
  run corehook hooks/unattended-guard.sh '{"session_id":"s","tool_name":"AskUserQuestion","tool_input":{}}'
  [ "$status" -eq 0 ]
}

@test "unattended-guard: denies AskUserQuestion with the default-policy message" {
  mark_ccmaf_v2
  run unatt '{"session_id":"s","tool_name":"AskUserQuestion","tool_input":{}}'
  [ "$status" -eq 2 ]
  [[ "$output" == *"UNATTENDED RUN"* ]]
  [[ "$output" == *"MOVE TO THE NEXT TASK"* ]]
}

@test "unattended-guard: mutating tools pass with no doctor-CRITICAL flag" {
  mark_ccmaf_v2
  run unatt '{"session_id":"s","tool_name":"Write","tool_input":{}}'
  [ "$status" -eq 0 ]
  [ ! -f "$REPO/.claude/unattended-halt.md" ]
}

@test "unattended-guard: doctor-CRITICAL halts mutating tools and writes the halt file" {
  mark_ccmaf_v2
  printf '# Framework Doctor — Issues Detected\n\n**Scan time:** now\n**Findings:** 2 CRITICAL, 0 WARNING, 0 INFO, 0 NAG\n' \
    > "$REPO/.claude/.framework-doctor-findings.md"
  run unatt '{"session_id":"s","tool_name":"Bash","tool_input":{}}'
  [ "$status" -eq 2 ]
  [[ "$output" == *"UNATTENDED HALT"* ]]
  [ -f "$REPO/.claude/unattended-halt.md" ]
}

@test "unattended-guard: zero-CRITICAL findings file does not halt" {
  mark_ccmaf_v2
  printf '**Findings:** 0 CRITICAL, 3 WARNING, 0 INFO, 0 NAG\n' \
    > "$REPO/.claude/.framework-doctor-findings.md"
  run unatt '{"session_id":"s","tool_name":"Edit","tool_input":{}}'
  [ "$status" -eq 0 ]
}

@test "unattended-guard: a spoofed tool_name inside tool_input cannot win (first-match rule)" {
  mark_ccmaf_v2
  run unatt '{"session_id":"s","tool_name":"Read","tool_input":{"note":"\"tool_name\": \"AskUserQuestion\""}}'
  [ "$status" -eq 0 ]
}

crit_flag() {
  printf '# Framework Doctor — Issues Detected\n\n**Scan time:** now\n**Findings:** 1 CRITICAL, 0 WARNING, 0 INFO, 0 NAG\n' \
    > "$REPO/.claude/.framework-doctor-findings.md"
}

@test "unattended-guard halt: PowerShell and mcp__ tools are denied (allowlist inversion)" {
  mark_ccmaf_v2
  crit_flag
  run unatt '{"session_id":"s","tool_name":"PowerShell","tool_input":{}}'
  [ "$status" -eq 2 ]
  [[ "$output" == *"UNATTENDED HALT"* ]]
  run unatt '{"session_id":"s","tool_name":"mcp__filesystem__write_file","tool_input":{}}'
  [ "$status" -eq 2 ]
}

@test "unattended-guard halt: read-only tools stay allowed for triage" {
  mark_ccmaf_v2
  crit_flag
  run unatt '{"session_id":"s","tool_name":"Read","tool_input":{}}'
  [ "$status" -eq 0 ]
  run unatt '{"session_id":"s","tool_name":"Grep","tool_input":{}}'
  [ "$status" -eq 0 ]
}

@test "core-context: clears a STALE unattended halt (findings no longer CRITICAL)" {
  mark_ccmaf_v2
  printf 'halt\n' > "$REPO/.claude/unattended-halt.md"
  printf '**Findings:** 0 CRITICAL, 1 WARNING, 0 INFO, 0 NAG\n' > "$REPO/.claude/.framework-doctor-findings.md"
  run corehook hooks/core-context.sh "$STARTUP"
  [ "$status" -eq 0 ]
  [[ "$output" == *"cleared a stale"* ]]
  [ ! -f "$REPO/.claude/unattended-halt.md" ]
}

@test "core-context: keeps the halt while CRITICAL findings are live (genuine doctor verdict)" {
  # The halt-clear runs AFTER the chain re-runs doctor (round-2 ordering
  # fix), so a hand-planted flag gets recomputed away — the CRITICAL must be
  # GENUINE: old version file + no kernel marker + a fake plugin-list CLI
  # reporting no kernel -> doctor's kernel-absent CRITICAL keeps the halt.
  mark_ccmaf_v2
  old_version_file
  fake_claude '[{"id":"advisors@ccmaf","enabled":true}]'
  printf 'halt\n' > "$REPO/.claude/unattended-halt.md"
  printf '%s' "$STARTUP" > "$REPO/event.json"
  run bash -c "cd '$REPO' && PATH='$REPO/fakebin:$PATH' CLAUDE_PLUGIN_ROOT='$CORE' CLAUDE_PROJECT_DIR='$REPO' bash '$CORE/hooks/core-context.sh' < '$REPO/event.json'"
  [ "$status" -eq 0 ]
  [ -f "$REPO/.claude/unattended-halt.md" ]
  grep -q 'kernel-absent' "$REPO/.claude/.framework-doctor-findings.md"
}

# ---------- doctor kernel-absent check (D1-a compensating control) ----------

# A fake `claude` CLI on PATH makes the plugin-list probe deterministic.
fake_claude() { # fake_claude <json-body>
  mkdir -p "$REPO/fakebin"
  printf '#!/usr/bin/env bash\nprintf %%s '"'"'%s'"'"'\n' "$1" > "$REPO/fakebin/claude"
  chmod +x "$REPO/fakebin/claude"
}

old_version_file() { touch -t 202601010000 "$REPO/.claude/.framework-version"; }

@test "doctor: CRITICAL kernel-absent when probe says the kernel is not installed" {
  mark_ccmaf_v2
  old_version_file
  fake_claude '[{"id":"advisors@ccmaf","enabled":true}]'
  ( cd "$REPO" && PATH="$REPO/fakebin:$PATH" CLAUDE_PLUGIN_ROOT="$CORE" bash "$CORE/doctor/doctor.sh" >/dev/null 2>&1 ) || true
  [ -f "$REPO/.claude/.framework-doctor-findings.md" ]
  grep -q 'CRITICAL.*kernel-absent' "$REPO/.claude/.framework-doctor-findings.md"
}

@test "doctor: silent kernel check when probe confirms the kernel enabled" {
  mark_ccmaf_v2
  old_version_file
  fake_claude '[{"id":"ccmaf-kernel@ccmaf","version":"0.2.0","scope":"user","enabled":true}]'
  ( cd "$REPO" && PATH="$REPO/fakebin:$PATH" CLAUDE_PLUGIN_ROOT="$CORE" bash "$CORE/doctor/doctor.sh" >/dev/null 2>&1 ) || true
  if [ -f "$REPO/.claude/.framework-doctor-findings.md" ]; then
    ! grep -q 'kernel-absent' "$REPO/.claude/.framework-doctor-findings.md"
  fi
}

@test "doctor: a KILLED run never erases the previous verdict flag (completion-gated lifecycle)" {
  mark_ccmaf_v2
  printf '# Framework Doctor — Issues Detected\n\n**Scan time:** old\n**Findings:** 3 CRITICAL, 0 WARNING, 0 INFO, 0 NAG\nSENTINEL-OLD-VERDICT\n' \
    > "$REPO/.claude/.framework-doctor-findings.md"
  # Kill doctor DETERMINISTICALLY mid-run — a bare `timeout 0.2` was a race
  # the doctor started WINNING on fast CI runners (tiny fixture repo →
  # completed + legitimately replaced the flag before the kill; the flake
  # shipped in the v2.0 release CI). A PATH-shimmed `grep` that blocks
  # guarantees the run is still in flight when the timeout fires; with the
  # old delete-first lifecycle the flag would already be ABSENT (fail-open);
  # completion-gated must leave it intact.
  mkdir -p "$REPO/slowbin"
  printf '#!/usr/bin/env bash\nsleep 5\nexit 1\n' > "$REPO/slowbin/grep"
  chmod +x "$REPO/slowbin/grep"
  ( cd "$REPO" && PATH="$REPO/slowbin:$PATH" CLAUDE_PLUGIN_ROOT="$CORE" timeout 0.5 bash "$CORE/doctor/doctor.sh" >/dev/null 2>&1 ) || true
  [ -f "$REPO/.claude/.framework-doctor-findings.md" ]
  command grep -q 'SENTINEL-OLD-VERDICT' "$REPO/.claude/.framework-doctor-findings.md"
}

@test "doctor: a COMPLETED findings run atomically replaces the old flag" {
  mark_ccmaf_v2
  printf 'SENTINEL-OLD-VERDICT\n' > "$REPO/.claude/.framework-doctor-findings.md"
  # Fresh version file (kernel-check grace) but no settings.json etc. — the
  # fixture reliably yields findings, so a completed run must REPLACE.
  ( cd "$REPO" && CLAUDE_PLUGIN_ROOT="$CORE" bash "$CORE/doctor/doctor.sh" >/dev/null 2>&1 ) || true
  [ -f "$REPO/.claude/.framework-doctor-findings.md" ]
  ! grep -q 'SENTINEL-OLD-VERDICT' "$REPO/.claude/.framework-doctor-findings.md"
  grep -q '## Findings' "$REPO/.claude/.framework-doctor-findings.md"
}

@test "doctor: fresh .kernel-present marker satisfies the check without any probe" {
  mark_ccmaf_v2
  old_version_file
  touch "$REPO/.claude/telemetry/.kernel-present"
  ( cd "$REPO" && CLAUDE_PLUGIN_ROOT="$CORE" bash "$CORE/doctor/doctor.sh" >/dev/null 2>&1 ) || true
  if [ -f "$REPO/.claude/.framework-doctor-findings.md" ]; then
    ! grep -q 'kernel-absent' "$REPO/.claude/.framework-doctor-findings.md"
  fi
}

# ---------- kernel-side §0/D1-a changes ----------

@test "kernel: touches .kernel-present in a marked repo with a telemetry dir" {
  mark_ccmaf
  run kernelhook "$STARTUP"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ -f "$REPO/.claude/telemetry/.kernel-present" ]
}

@test "kernel: v1-marked repo stays silent (no blackout warning without the v2 line)" {
  mark_ccmaf
  run kernelhook "$STARTUP"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "kernel: v2 repo with stale version file and no .core-present warns about the blackout" {
  mark_ccmaf_v2
  touch -t 202601010000 "$REPO/.claude/.framework-version"
  run kernelhook "$STARTUP"
  [ "$status" -eq 0 ]
  [[ "$output" == *"core plugin shows no recent activity"* ]]
}

@test "kernel: fresh v2 migration (version file <1 day old) gets the grace period — no warning" {
  mark_ccmaf_v2
  run kernelhook "$STARTUP"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "kernel: v2 repo with a fresh .core-present marker stays silent" {
  mark_ccmaf_v2
  touch -t 202601010000 "$REPO/.claude/.framework-version"
  touch "$REPO/.claude/telemetry/.core-present"
  run kernelhook "$STARTUP"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "integration-gate: scaffolded statusline.sh does not shadow the deeper-manifest NO-OP notice" {
  # Round-3 live-reproduced false green: every scaffold has .claude/statusline.sh,
  # which fired the shell-syntax branch and hid the subdir-app gap.
  mark_ccmaf_v2
  mkdir -p "$REPO/01_Project"
  cp "$CORE/templates/statusline.sh" "$REPO/.claude/statusline.sh"
  printf '{"scripts":{"test":"exit 1"}}' > "$REPO/01_Project/package.json"
  run bash -c "cd '$REPO' && CLAUDE_PROJECT_DIR='$REPO' bash '$CORE/scripts/integration-gate.sh'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"NO-OP"* ]]
  [[ "$output" == *"proves NOTHING"* ]]
}

# ---------- structure ----------

@test "core plugin: manifests parse and every registered hook file exists" {
  # Pure-bash path handling: a Windows python cannot open /f/Git-style paths,
  # so JSON parses read from stdin and file checks use bash test -f.
  [ -n "$PYTHON" ] || skip "no python available"
  "$PYTHON" -c "import json,sys; json.load(sys.stdin)" < "$CORE/.claude-plugin/plugin.json"
  "$PYTHON" -c "import json,sys; json.load(sys.stdin)" < "$CORE/hooks/hooks.json"
  while IFS= read -r rel; do
    [ -f "$CORE/$rel" ] || { echo "missing hook file: $rel"; return 1; }
  done < <(grep -o 'CLAUDE_PLUGIN_ROOT}/[^"]*\.sh' "$CORE/hooks/hooks.json" | sed 's|CLAUDE_PLUGIN_ROOT}/||' | sort -u)
}
