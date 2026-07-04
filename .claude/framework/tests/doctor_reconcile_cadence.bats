#!/usr/bin/env bats
# doctor_reconcile_cadence.bats — dedicated coverage for doctor.sh Check 14
# (reconcile cadence, .claude/framework/doctor/doctor.sh:639-732), added
# alongside the reconciler agent (commit 5c88c5b) with zero bats coverage of
# its own — every other doctor check (1-13) has dedicated cases in
# update_system.bats; this file closes that gap (audit finding F4).
#
# The check's own commit message documents two bugs found only by manual,
# one-off testing, never captured as regressions: a bare-return-under-
# pipefail crash on a deletion-commit baseline, and a silent never-nag when
# the watermark predates all TASKS.md history. Both get dedicated regression
# cases below (both already fixed in doctor.sh — these guard reintroduction).
#
# Reuses build_doctor_consumer / run_doctor / $DOC / $DOCFLAG from
# update_helpers.bash (the shared doctor fixture tier), same technique as
# update_system.bats's own Check 12/13 tests.

load update_helpers

# --- fixtures -------------------------------------------------------------

# Writes $DOC/.claude/TASKS.md with a Feature-lane Done section holding N
# sequential bracketed TASK-* IDs (TASK-001..TASK-00N). N=0 is a lane with
# no entries — still valid grammar (Check 13 accepts an empty Done section).
_write_tasks_done() {  # <n>
  local n="$1" i
  {
    echo "# Task Board"
    echo
    echo "## Feature Lane"
    echo
    echo "### Verify"
    echo
    echo "### Done"
    echo
    for ((i = 1; i <= n; i++)); do
      printf '#### [TASK-%03d] task number %d\n' "$i" "$i"
    done
    echo
    echo "## Bug-Fix Lane"
    echo
    echo "### Done"
  } > "$DOC/.claude/TASKS.md"
}

# Commits whatever's currently on disk in $DOC.
_commit_doc() {  # <message>
  git -C "$DOC" add -A
  git -C "$DOC" commit -qm "$1"
}

# Sets .claude/telemetry/.last-reconcile's mtime to <epoch seconds>,
# creating the watermark (and its parent dir) if absent.
_set_watermark_epoch() {  # <epoch>
  mkdir -p "$DOC/.claude/telemetry"
  local wm="$DOC/.claude/telemetry/.last-reconcile"
  : > "$wm"
  touch -d "@$1" "$wm"
}

# --- Check 14: Reconcile cadence ------------------------------------------

@test "doctor Check 14: below-threshold new-Done count is silent (control)" {
  build_doctor_consumer
  _write_tasks_done 1
  _commit_doc "baseline: 1 done task"
  _set_watermark_epoch "$(($(date +%s) + 5))"   # after the baseline commit
  _write_tasks_done 4                            # +3 new vs. baseline, working tree only
  run run_doctor
  [ "$status" -eq 0 ]
  if [ -f "$DOCFLAG" ]; then ! grep -q '\[reconcile\]' "$DOCFLAG"; fi
}

@test "doctor Check 14: at-threshold new-Done count fires NAG [reconcile]" {
  build_doctor_consumer
  _write_tasks_done 0
  _commit_doc "baseline: 0 done tasks"
  _set_watermark_epoch "$(($(date +%s) + 5))"   # after the baseline commit
  _write_tasks_done 5                            # +5 new vs. baseline (default threshold)
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q '\*\*NAG\*\* — \[reconcile\]' "$DOCFLAG"
  grep -q 'reconcile due (5 tasks entered Done' "$DOCFLAG"
}

@test "doctor Check 14: no /reconcile has ever run (watermark absent) — silent, no crash" {
  build_doctor_consumer
  _write_tasks_done 9   # comfortably over threshold if the guard clause were missing
  run run_doctor
  [ "$status" -eq 0 ]
  if [ -f "$DOCFLAG" ]; then ! grep -q '\[reconcile\]' "$DOCFLAG"; fi
}

@test "doctor Check 14: watermark present but TASKS.md absent — silent, no crash" {
  build_doctor_consumer
  _set_watermark_epoch "$(date +%s)"
  # deliberately no TASKS.md at all
  run run_doctor
  [ "$status" -eq 0 ]
  if [ -f "$DOCFLAG" ]; then ! grep -q '\[reconcile\]' "$DOCFLAG"; fi
}

@test "doctor Check 14: watermark predates all TASKS.md history — still NAGs, no crash (regression: silent-never-nag)" {
  build_doctor_consumer
  _set_watermark_epoch 946684800   # 2000-01-01 — before any commit in this fixture
  _write_tasks_done 5              # working-tree only; no commit before the watermark exists at all
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q '\[reconcile\]' "$DOCFLAG"
  grep -q 'reconcile due (5 tasks entered Done' "$DOCFLAG"
}

@test "doctor Check 14: deletion-commit baseline — still NAGs, no crash (regression: bare-return-under-pipefail)" {
  build_doctor_consumer
  _write_tasks_done 2
  _commit_doc "add tasks"
  git -C "$DOC" rm -q .claude/TASKS.md
  _commit_doc "delete tasks (this deletion commit becomes the resolved baseline)"
  _set_watermark_epoch "$(($(date +%s) + 5))"   # after the deletion commit
  _write_tasks_done 5                            # recreated working-tree file, uncommitted
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q '\[reconcile\]' "$DOCFLAG"
}
