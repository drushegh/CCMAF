#!/usr/bin/env bats
# doctor_board_coherence.bats — dedicated coverage for doctor.sh Check 15
# (board <-> reality coherence, contract:board-coherence) and the Check 13
# suffixed-ID flag, added with the board-vs-reality hardening wave (TASK-112).
# Check 15 is DETECT-ONLY: the final case asserts it never mutates TASKS.md or
# the seeds. Mirrors the fixture proof run manually during the build.
#
# Reuses build_doctor_consumer / run_doctor / $DOC / $DOCFLAG /
# seed_doctor_state_files from update_helpers.bash (the shared doctor fixture
# tier), same technique as doctor_reconcile_cadence.bats.

load update_helpers

# --- helpers --------------------------------------------------------------

# Opt this consumer into the Console (so the seed invariants are live).
_opt_in_console() { mkdir -p "$DOC/.claude/console/verify"; }

# Write a minimal VALID seed for <TASK-ID> (contract:verify-handback shape).
_write_seed() {  # <id>
  mkdir -p "$DOC/.claude/console/verify"
  printf '{"schemaVersion":1,"task":"%s","status":"in-review","items":[{"id":"a","kind":"use-case","title":"t","verdict":"pending","severity":null}]}\n' "$1" \
    > "$DOC/.claude/console/verify/$1.json"
}

# Full TASKS.md from stdin.
_write_board() { cat > "$DOC/.claude/TASKS.md"; }

# --- Control: a clean board is silent -------------------------------------

@test "doctor Check 15: clean seeded board (no console dir) → no board-coherence finding" {
  build_doctor_consumer
  seed_doctor_state_files
  run run_doctor
  [ "$status" -eq 0 ]
  if [ -f "$DOCFLAG" ]; then ! grep -q '\[board-coherence\]' "$DOCFLAG"; fi
}

# --- Invariant 1: Verify/Ready-for-Test tasks missing a seed (opt-in gated) -

@test "doctor Check 15: Verify task with no seed (console opted in) → WARNING naming the task" {
  build_doctor_consumer
  _opt_in_console
  _write_board <<'EOF'
# Task Board

## Feature Lane

### Verify

#### [TASK-010] Delivered feature awaiting acceptance [P1]

### Done

## Bug-Fix Lane

### Done
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q '\[board-coherence\]' "$DOCFLAG"
  grep -q 'TASK-010' "$DOCFLAG"
}

@test "doctor Check 15: missing seed but NO console dir → silent (zero coupling)" {
  build_doctor_consumer
  # no _opt_in_console → .claude/console/ absent → the seed invariant is dormant
  _write_board <<'EOF'
# Task Board

## Feature Lane

### Verify

#### [TASK-010] Delivered feature awaiting acceptance [P1]

### Done

## Bug-Fix Lane

### Done
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  if [ -f "$DOCFLAG" ]; then ! grep -q '\[board-coherence\]' "$DOCFLAG"; fi
}

@test "doctor Check 15: a Ready-for-Test task with no seed is SILENT (Verify-only; regression for the CRITICAL fix)" {
  build_doctor_consumer
  _opt_in_console
  _write_board <<'EOF'
# Task Board

## Feature Lane

### Ready for Test

#### [TASK-012] Queued for the Tester — has no seed BY DESIGN [P1]

### Verify

### Done

## Bug-Fix Lane

### Done
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  # A task legitimately awaiting the Tester must NOT be flagged (the Tester
  # emits its seed on PASS as it moves to Verify — seeding it here would
  # permanently lock out the authoritative one via WRITE-ONCE).
  if [ -f "$DOCFLAG" ]; then ! grep -qi 'no verify seed' "$DOCFLAG"; fi
}

@test "doctor Check 15: Verify task WITH a seed → no missing-seed finding" {
  build_doctor_consumer
  _write_seed TASK-010
  _write_board <<'EOF'
# Task Board

## Feature Lane

### Verify

#### [TASK-010] Delivered feature awaiting acceptance [P1]

### Done

## Bug-Fix Lane

### Done
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  # case-insensitive: the finding text reads "NO verify seed"
  if [ -f "$DOCFLAG" ]; then ! grep -qi 'no verify seed' "$DOCFLAG"; fi
}

# --- Invariant 2: orphan seed (seed with no board entry) ------------------

@test "doctor Check 15: seed with no board entry → orphan WARNING" {
  build_doctor_consumer
  _write_seed TASK-999
  seed_doctor_state_files   # board has TASK-001 / BUG-001, not TASK-999
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q '\[board-coherence\]' "$DOCFLAG"
  grep -q 'TASK-999' "$DOCFLAG"
}

# --- Invariant 4: base ID spanning >1 lifecycle column --------------------

@test "doctor Check 15: base ID in two columns (TASK-007 + TASK-007a) → collision WARNING" {
  build_doctor_consumer
  _write_board <<'EOF'
# Task Board

## Feature Lane

### In Progress

#### [TASK-007a] suffixed subtask [P1]

### Ready for Review

#### [TASK-007] numeric parent [P1]

### Verify

### Done

## Bug-Fix Lane

### Done
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  grep -qE 'board-coherence.*spans multiple lifecycle columns' "$DOCFLAG"
  grep -q 'TASK-007' "$DOCFLAG"
}

# --- Invariant 5: Ready-for-Review pile-up (NAG) --------------------------

@test "doctor Check 15: >= RFR_STALL_THRESHOLD tasks in Ready for Review → NAG" {
  build_doctor_consumer
  {
    echo "# Task Board"; echo; echo "## Feature Lane"; echo
    echo "### Ready for Review"; echo
    for i in $(seq 1 8); do printf '#### [TASK-%03d] filler %d [P2]\n' "$i" "$i"; done
    echo; echo "### Verify"; echo; echo "### Done"; echo
    echo "## Bug-Fix Lane"; echo; echo "### Done"
  } > "$DOC/.claude/TASKS.md"
  run run_doctor
  [ "$status" -eq 0 ]
  grep -qE 'NAG.*\[board-coherence\].*Ready for Review' "$DOCFLAG"
}

@test "doctor Check 15: below RFR_STALL_THRESHOLD is silent (control)" {
  build_doctor_consumer
  {
    echo "# Task Board"; echo; echo "## Feature Lane"; echo
    echo "### Ready for Review"; echo
    for i in $(seq 1 3); do printf '#### [TASK-%03d] filler %d [P2]\n' "$i" "$i"; done
    echo; echo "### Verify"; echo; echo "### Done"; echo
    echo "## Bug-Fix Lane"; echo; echo "### Done"
  } > "$DOC/.claude/TASKS.md"
  run run_doctor
  [ "$status" -eq 0 ]
  if [ -f "$DOCFLAG" ]; then ! grep -qE 'NAG.*Ready for Review' "$DOCFLAG"; fi
}

# --- Check 13: suffixed-ID flag -------------------------------------------

@test "doctor Check 13: a bracketed suffixed sub-ID → SUFFIXED state-structure WARNING" {
  build_doctor_consumer
  _write_board <<'EOF'
# Task Board

## Feature Lane

### Ready for Review

#### [TASK-017b] a suffixed subtask [P1]

### Verify

### Done

## Bug-Fix Lane

### Done
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q 'SUFFIXED' "$DOCFLAG"
  grep -q 'TASK-017b' "$DOCFLAG"
}

@test "doctor Check 13: a bare suffixed sub-ID → SUFFIXED WARNING" {
  build_doctor_consumer
  _write_board <<'EOF'
# Task Board

## Feature Lane

### Ready for Review

#### TASK-017b a bare suffixed subtask

### Verify

### Done

## Bug-Fix Lane

### Done
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q 'SUFFIXED' "$DOCFLAG"
}

# --- DETECT-ONLY: Check 15 never mutates the board or seeds ----------------

@test "doctor Check 15 is DETECT-ONLY: TASKS.md and seeds are byte-identical after a run" {
  build_doctor_consumer
  _write_seed TASK-010
  _write_board <<'EOF'
# Task Board

## Feature Lane

### Verify

#### [TASK-011] no seed → flagged, but nothing is written [P1]

### Done

## Bug-Fix Lane

### Done
EOF
  local before_tasks before_seed
  before_tasks=$(md5sum "$DOC/.claude/TASKS.md" | cut -d' ' -f1)
  before_seed=$(md5sum "$DOC/.claude/console/verify/TASK-010.json" | cut -d' ' -f1)
  run run_doctor
  [ "$status" -eq 0 ]
  [ "$(md5sum "$DOC/.claude/TASKS.md" | cut -d' ' -f1)" = "$before_tasks" ]
  [ "$(md5sum "$DOC/.claude/console/verify/TASK-010.json" | cut -d' ' -f1)" = "$before_seed" ]
}
