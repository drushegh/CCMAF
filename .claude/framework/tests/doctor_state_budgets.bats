#!/usr/bin/env bats
# doctor Check 16 — state-file size budgets (OPT P3, TASK-139). Uses the shared
# doctor-consumer fixture + a .claude/state-budgets.local.conf override to drive
# the thresholds deterministically (independent of real file sizes).
load update_helpers

@test "doctor Check 16: state file OVER budget -> WARNING (never CRITICAL) state-budget finding" {
  build_doctor_consumer
  seed_doctor_state_files
  printf '.claude/TASKS.md=10\n' > "$DOC/.claude/state-budgets.local.conf"
  run run_doctor
  [ -f "$DOCFLAG" ]
  grep -q "state-budget" "$DOCFLAG"
  grep -q "OVER its" "$DOCFLAG"
  grep 'OVER its' "$DOCFLAG" | grep -q "WARNING"
  ! grep -q 'CRITICAL.*state-budget' "$DOCFLAG" || false
}

@test "PLUGIN doctor Check 16: OVER budget -> WARNING (not CRITICAL) with the per-file remedy" {
  local plugin="$FW_REPO_ROOT/plugins/ccmaf"
  [ -f "$plugin/doctor/doctor.sh" ] || skip "plugins/ccmaf not present"
  build_doctor_consumer
  seed_doctor_state_files
  printf '# gotchas\n' > "$DOC/.claude/GOTCHAS.md"
  printf '.claude/TASKS.md=10\n.claude/GOTCHAS.md=1\n' > "$DOC/.claude/state-budgets.local.conf"
  run bash -c "cd '$DOC' && CLAUDE_PROJECT_DIR='$DOC' CLAUDE_PLUGIN_ROOT='$plugin' bash '$plugin/doctor/doctor.sh'"
  [ -f "$DOCFLAG" ]
  grep -q 'OVER its' "$DOCFLAG"
  ! grep -q 'CRITICAL.*state-budget' "$DOCFLAG" || false
  # TASKS.md: WARNING whose remedy is the plugin's rotate-state.sh.
  grep 'state-budget.*TASKS.md.*OVER its' "$DOCFLAG" | grep -q 'WARNING'
  grep 'state-budget.*TASKS.md' "$DOCFLAG" | grep -qF "$plugin/housekeeping/rotate-state.sh"
  # GOTCHAS.md: WARNING with its own remedy (rotate-state.sh does not rotate it).
  grep 'state-budget.*GOTCHAS.md.*OVER its' "$DOCFLAG" | grep -q 'WARNING'
  grep 'state-budget.*GOTCHAS.md' "$DOCFLAG" | grep -q 'does not rotate this file'
}

@test "doctor Check 16: state file well under budget -> no state-budget finding" {
  build_doctor_consumer
  seed_doctor_state_files
  printf '.claude/TASKS.md=100000000\n' > "$DOC/.claude/state-budgets.local.conf"
  run run_doctor
  if [ -f "$DOCFLAG" ]; then ! grep -q "state-budget" "$DOCFLAG" || false; fi
}

@test "doctor Check 16: >=80% of budget -> WARNING (not CRITICAL)" {
  build_doctor_consumer
  seed_doctor_state_files
  sz=$(wc -c < "$DOC/.claude/TASKS.md" | tr -d ' ')
  budget=$(( sz * 100 / 85 ))
  printf '.claude/TASKS.md=%s\n' "$budget" > "$DOC/.claude/state-budgets.local.conf"
  run run_doctor
  grep -q "state-budget" "$DOCFLAG"
  grep -q "approaching the ceiling" "$DOCFLAG"
}
