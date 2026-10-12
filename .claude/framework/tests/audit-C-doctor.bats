#!/usr/bin/env bats
# audit-C-doctor.bats — fleet audit 2026-10-12, Unit C (WP3): coverage for the
# PLUGIN doctor (plugins/ccmaf/doctor/doctor.sh) additions —
#   C14 clean-run line, C8a verify-seed schema, C8b archive-aware orphans,
#   C8c task headings inside HTML comments, C18 duplicate contract anchors,
#   C13 hook-admission budget, A16 project agents lacking the Skill tool.
#
# Fixture: the shared doctor-clean consumer (update_helpers.bash) switched to
# the v2 line, driven by a throwaway plugin root that carries ONLY doctor/ —
# so Check 2 never scans the real plugin's agent docs and a clean run is
# genuinely clean.

load update_helpers

PLUGIN_SRC="$FW_REPO_ROOT/plugins/ccmaf"

setup() {
  [ -f "$PLUGIN_SRC/doctor/doctor.sh" ] || skip "plugins/ccmaf not present"
  build_doctor_consumer
  seed_doctor_state_files
  printf 'FRAMEWORK_LINE=v2\nSCAFFOLD_REV=1\n' > "$DOC/.claude/.framework-version"
  PR="$BATS_TEST_TMPDIR/plugin-root"
  mkdir -p "$PR/doctor"
  cp "$PLUGIN_SRC/doctor/doctor.sh" "$PLUGIN_SRC/doctor/state-budgets.conf" "$PR/doctor/"
}

run_pdoctor() {
  ( cd "$DOC" && CLAUDE_PROJECT_DIR="$DOC" CLAUDE_PLUGIN_ROOT="$PR" bash "$PR/doctor/doctor.sh" )
}

_write_board() { cat > "$DOC/.claude/TASKS.md"; }

# Board with TASK-010 in Verify (Feature lane) — the seed tests' base.
_verify_board() {
  _write_board <<'EOF'
# Task Board

## Feature Lane

### Verify

#### [TASK-010] Delivered feature awaiting acceptance [P1]

### Done

## Bug-Fix Lane

### Done
EOF
}

_valid_seed() {  # <id> [dir]
  local d="${2:-$DOC/.claude/console/verify}"
  mkdir -p "$d"
  printf '{"schemaVersion":1,"task":"%s","status":"in-review","items":[{"id":"a","kind":"use-case","title":"t","verdict":"pending","severity":null}]}\n' "$1" > "$d/$1.json"
}

# --- C14: clean run prints one line ---------------------------------------

@test "C14: a clean run prints 'doctor: clean (N checks)' and leaves no flag file" {
  run run_pdoctor
  [ "$status" -eq 0 ]
  [[ "$output" =~ ^doctor:\ clean\ \([0-9]+\ checks\)$ ]]
  [ ! -f "$DOCFLAG" ]
}

# --- C8a: verify-seed schema -----------------------------------------------

@test "C8a: a valid seed raises no schema finding" {
  _verify_board
  _valid_seed TASK-010
  run run_pdoctor
  [ "$status" -eq 0 ]
  if [ -f "$DOCFLAG" ]; then ! grep -q 'contract:verify-handback' "$DOCFLAG" || false; fi
}

@test "C8a: a malformed seed (no schemaVersion, wrong task, bad verdict, item without id) is flagged" {
  _verify_board
  mkdir -p "$DOC/.claude/console/verify"
  printf '{"task":"TASK-999","status":"in-review","items":[{"kind":"use-case","title":"t","verdict":"ok"}]}\n' \
    > "$DOC/.claude/console/verify/TASK-010.json"
  run run_pdoctor
  [ "$status" -eq 0 ]
  grep -q 'contract:verify-handback' "$DOCFLAG"
  grep -q 'TASK-010 (schemaVersion must be 1' "$DOCFLAG"
  grep -q 'task must equal' "$DOCFLAG"
  grep -q '+1 more' "$DOCFLAG"   # 4 errors, 3 shown
}

@test "C8a: bad status enum, missing items array and duplicate item ids are each flagged" {
  _verify_board
  mkdir -p "$DOC/.claude/console/verify"
  printf '{"schemaVersion":1,"task":"TASK-010","status":"open"}\n' > "$DOC/.claude/console/verify/TASK-010.json"
  printf '{"schemaVersion":1,"task":"TASK-011","status":"done","items":[{"id":"a","kind":"k","title":"t","verdict":"pass"},{"id":"a","kind":"k","title":"u","verdict":"fail"}]}\n' \
    > "$DOC/.claude/console/verify/TASK-011.json"
  run run_pdoctor
  grep -q 'TASK-010 (status not in-review|processing-fixes|done; items must be an array)' "$DOCFLAG"
  grep -q 'TASK-011 (duplicate item ids)' "$DOCFLAG"
}

@test "C8a: an unparseable seed is flagged without aborting the other seeds' validation" {
  _verify_board
  mkdir -p "$DOC/.claude/console/verify"
  printf '{"schemaVersion":1, broken\n' > "$DOC/.claude/console/verify/TASK-010.json"
  printf '{"schemaVersion":2,"task":"TASK-012","status":"done","items":[]}\n' > "$DOC/.claude/console/verify/TASK-012.json"
  run run_pdoctor
  [ "$status" -eq 0 ]
  grep -q 'TASK-010 (not valid JSON)' "$DOCFLAG"
  grep -q 'TASK-012 (schemaVersion must be 1)' "$DOCFLAG"
}

@test "C8a: a multi-line pretty-printed valid seed passes" {
  _verify_board
  mkdir -p "$DOC/.claude/console/verify"
  printf '{\r\n  "schemaVersion": 1,\r\n  "task": "TASK-010",\r\n  "status": "processing-fixes",\r\n  "items": [\r\n    { "id": "x", "kind": "use-case", "title": "a b", "verdict": "warn" }\r\n  ]\r\n}\r\n' \
    > "$DOC/.claude/console/verify/TASK-010.json"
  run run_pdoctor
  if [ -f "$DOCFLAG" ]; then ! grep -q 'contract:verify-handback' "$DOCFLAG" || false; fi
}

# --- C8b: archive-aware orphan seeds ----------------------------------------

@test "C8b: a seed whose ID is in .claude/archive/*.md is NOT an orphan" {
  _verify_board
  _valid_seed TASK-010
  _valid_seed TASK-050
  mkdir -p "$DOC/.claude/archive"
  printf '# Tasks archive\n\n#### [TASK-050] Shipped long ago\n' > "$DOC/.claude/archive/TASKS-archive.md"
  run run_pdoctor
  if [ -f "$DOCFLAG" ]; then ! grep -q 'no matching board entry' "$DOCFLAG" || false; fi
}

@test "C8b: seeds under verify/archive/ are ignored (not orphans, not schema-checked)" {
  _verify_board
  _valid_seed TASK-010
  mkdir -p "$DOC/.claude/console/verify/archive"
  printf 'not json\n' > "$DOC/.claude/console/verify/archive/TASK-060.json"
  run run_pdoctor
  if [ -f "$DOCFLAG" ]; then
    ! grep -q 'TASK-060' "$DOCFLAG" || false
  fi
}

@test "C8b control: a seed absent from board AND archive is still an orphan" {
  _verify_board
  _valid_seed TASK-010
  _valid_seed TASK-070
  mkdir -p "$DOC/.claude/archive"
  printf '# Tasks archive\n\n#### [TASK-050] Shipped long ago\n' > "$DOC/.claude/archive/TASKS-archive.md"
  run run_pdoctor
  grep -q 'no matching board entry.*TASK-070' "$DOCFLAG"
}

@test "C8b: a bare mention in an archive (not a heading) does not excuse an orphan seed" {
  _verify_board
  _valid_seed TASK-010
  _valid_seed TASK-080
  mkdir -p "$DOC/.claude/archive"
  printf '# Decisions archive\n\n## 2026-01-01 — something (supersedes TASK-080)\n- TASK-080 was folded in\n' > "$DOC/.claude/archive/DECISIONS-archive.md"
  run run_pdoctor
  grep -q 'no matching board entry.*TASK-080' "$DOCFLAG"
}

# --- C8c: task headings inside HTML comments --------------------------------

@test "C8c: a numeric task heading typed inside a multi-line comment is flagged" {
  cat >> "$DOC/.claude/TASKS.md" <<'EOF'

<!-- Template:
#### [TASK-XXX] Placeholder title
#### [TASK-077] Real entry typed into the template
-->
<!-- #### [BUG-078] inline commented entry -->
EOF
  run run_pdoctor
  grep -q 'INSIDE an HTML comment' "$DOCFLAG"
  grep -q 'TASK-077 BUG-078' "$DOCFLAG"
  ! grep -q 'TASK-XXX' "$DOCFLAG" || false
}

@test "C8c control: a comment with only template placeholders is silent" {
  cat >> "$DOC/.claude/TASKS.md" <<'EOF'

<!-- Template (note: level-4 #### + bracketed ID):
#### [BUG-XXX] Short description
- **Source:** TASK-XXX
-->
EOF
  run run_pdoctor
  [[ "$output" =~ ^doctor:\ clean ]]
}

# --- C18: duplicate contract anchor IDs -------------------------------------

@test "C18: a contract anchor ID declared twice in ECOSYSTEM.md is a WARNING" {
  cat >> "$DOC/.claude/ECOSYSTEM.md" <<'EOF'

### Some contract (again)

<!-- contract:some-thing status:draft -->

    type Foo2 = {}
EOF
  run run_pdoctor
  grep -q 'same contract anchor ID more than once: contract:some-thing' "$DOCFLAG"
}

@test "C18 control: distinct anchor IDs are silent" {
  cat >> "$DOC/.claude/ECOSYSTEM.md" <<'EOF'

<!-- contract:other-thing status:stable -->
EOF
  run run_pdoctor
  [[ "$output" =~ ^doctor:\ clean ]]
}

# --- C13: hook-admission budget ---------------------------------------------

_events() {  # <count> <hook> <reason>
  mkdir -p "$DOC/.claude/telemetry"
  local i
  for ((i = 0; i < $1; i++)); do
    printf '{"ts":"2026-10-12T00:00:00Z","schema":2,"hook":"%s","outcome":"skipped","outcome_class":"skipped","reason":"%s"}\n' "$2" "$3"
  done >> "$DOC/.claude/telemetry/events.jsonl"
}

@test "C13: >100 tool-ineligible skips → WARNING naming the hook's registration" {
  _events 150 lint tool-ineligible
  run run_pdoctor
  # shellcheck disable=SC2016  # literal backticks in the expected text
  grep -q 'WARNING\*\* — \[hook-admission\] Hook `lint` skipped 150' "$DOCFLAG"
  grep -q 'matcher' "$DOCFLAG"
}

@test "C13: ~100% no-tool over >=500 admissions → two-branch NAG (never auto-diagnosed)" {
  _events 600 format no-tool
  run run_pdoctor
  # shellcheck disable=SC2016  # literal backticks in the expected text
  grep -q 'NAG\*\* — \[hook-admission\] Hook `format` skipped 600 of its last 600' "$DOCFLAG"
  grep -q 'CLAUDE_DISABLED_HOOKS' "$DOCFLAG"
  grep -q 'FRAMEWORK-SUGGESTIONS' "$DOCFLAG"
}

@test "C13 control: ext / not-test-cmd skips and a mixed no-tool share are silent" {
  _events 600 lint ext
  _events 600 test-filter not-test-cmd
  _events 100 format no-tool
  _events 500 format ext
  run run_pdoctor
  [[ "$output" =~ ^doctor:\ clean ]]
}

# --- A16: project agents lacking the Skill tool ----------------------------

@test "A16: a project agent whose tools: allowlist omits Skill → INFO" {
  mkdir -p "$DOC/.claude/agents"
  printf -- '---\nname: my-agent\ntools: Read, Grep, Glob\n---\nbody\n' > "$DOC/.claude/agents/my-agent.md"
  run run_pdoctor
  grep -q 'INFO\*\* — \[agent-skills\].*\.claude/agents/my-agent\.md' "$DOCFLAG"
}

@test "A16 control: Skill present (inline or YAML list), no tools: line, or framework/council copies → silent" {
  mkdir -p "$DOC/.claude/agents/framework" "$DOC/.claude/agents/council"
  printf -- '---\nname: a\ntools: Read, Skill\n---\n' > "$DOC/.claude/agents/a.md"
  printf -- '---\nname: b\ntools:\n  - Read\n  - Skill\n---\n' > "$DOC/.claude/agents/b.md"
  printf -- '---\nname: c\n---\nno tools line - inherits all\n' > "$DOC/.claude/agents/c.md"
  printf -- '---\nname: d\ntools: Read\n---\n' > "$DOC/.claude/agents/framework/d.md"
  printf -- '---\nname: e\ntools: Read\n---\n' > "$DOC/.claude/agents/council/e.md"
  run run_pdoctor
  [[ "$output" =~ ^doctor:\ clean ]]
}

@test "A16: a YAML-list tools: without Skill is flagged" {
  mkdir -p "$DOC/.claude/agents"
  printf -- '---\nname: f\ntools:\n  - Read\n  - Bash\ndescription: x\n---\n' > "$DOC/.claude/agents/f.md"
  run run_pdoctor
  grep -q '\[agent-skills\].*f\.md' "$DOCFLAG"
}
