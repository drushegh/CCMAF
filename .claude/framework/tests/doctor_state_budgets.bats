#!/usr/bin/env bats
# doctor Check 16 — state-file size budgets (OPT P3, TASK-139). Uses the shared
# doctor-consumer fixture + a .claude/state-budgets.local.conf override to drive
# the thresholds deterministically (independent of real file sizes).
load update_helpers

@test "doctor Check 16: state file OVER budget -> CRITICAL state-budget finding" {
  build_doctor_consumer
  seed_doctor_state_files
  printf '.claude/TASKS.md=10\n' > "$DOC/.claude/state-budgets.local.conf"
  run run_doctor
  [ -f "$DOCFLAG" ]
  grep -q "state-budget" "$DOCFLAG"
  grep -q "OVER its" "$DOCFLAG"
  grep -q "CRITICAL" "$DOCFLAG"
}

@test "doctor Check 16: state file well under budget -> no state-budget finding" {
  build_doctor_consumer
  seed_doctor_state_files
  printf '.claude/TASKS.md=100000000\n' > "$DOC/.claude/state-budgets.local.conf"
  run run_doctor
  if [ -f "$DOCFLAG" ]; then ! grep -q "state-budget" "$DOCFLAG"; fi
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
