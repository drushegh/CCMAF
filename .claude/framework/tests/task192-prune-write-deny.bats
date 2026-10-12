#!/usr/bin/env bats
# task192-prune-write-deny.bats — TASK-192 (BUG-033): prune-write-deny.sh
# removes "Write(X)" deny rules that have an exact "Edit(X)" twin, and the
# wiring around it (doctor Check 19 WARNING, apply-update fail-soft call,
# update-nudge scaffold-rev lag line, v1/v2 copies identical).

load update_helpers

PLUGIN_SRC="$FW_REPO_ROOT/plugins/ccmaf"
PRUNE="$PLUGIN_SRC/update/prune-write-deny.sh"

setup() {
  [ -f "$PRUNE" ] || skip "plugins/ccmaf not present"
  W="$BATS_TEST_TMPDIR/w"
  mkdir -p "$W"
  S="$W/settings.json"
}

# Canonical pre-bd6d8ca shape (LF): Read + Edit + Write twins, one orphan
# Write, a Write in allow (must survive), hooks block (must survive).
_fixture() {
  cat > "$S" <<'EOF'
{
  "permissions": {
    "allow": [
      "Write(docs/**)",
      "Edit(docs/**)"
    ],
    "deny": [
      "Read(.env)",
      "Edit(.env)",
      "Edit(**/id_rsa*)",
      "Write(.env)",
      "Write(orphan/**)",
      "Write(**/id_rsa*)"
    ]
  },
  "hooks": {}
}
EOF
}

_to_crlf() { sed 's/$/\r/' "$S" > "$S.crlf" && mv "$S.crlf" "$S"; }

_valid_json() { # jq if present, else node
  if command -v jq >/dev/null 2>&1; then jq empty < "$1"; else node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))' < "$1"; fi
}

@test "v1 copy is byte-identical to the plugin copy" {
  cmp "$PRUNE" "$FW_REPO_ROOT/.claude/framework/update/prune-write-deny.sh"
}

@test "LF: twins removed, orphan Write + allow list kept, last-entry comma fixed" {
  _fixture
  run bash "$PRUNE" "$S"
  [ "$status" -eq 0 ]
  [[ "$output" == *"removed 2 redundant"* ]]
  [[ "$output" == *'"Write(.env)"'* ]]
  [[ "$output" == *'"Write(**/id_rsa*)"'* ]]
  ! grep -q '"Write(.env)"' "$S"
  ! grep -q '"Write(\*\*/id_rsa\*)"' "$S"
  grep -q '"Write(orphan/\*\*)"$' "$S"      # new last entry: dangling comma stripped
  grep -q '"Write(docs/\*\*)",' "$S"        # allow list untouched
  grep -q '"Edit(.env)",' "$S"
  ! grep -q $'\r' "$S"
  _valid_json "$S"
}

@test "CRLF: line endings preserved, result valid, comma fix keeps the CR" {
  _fixture; _to_crlf
  run bash "$PRUNE" "$S"
  [ "$status" -eq 0 ]
  [[ "$output" == *"removed 2 redundant"* ]]
  # every line still CRLF (no bare LF lines)
  [ "$(grep -c $'\r$' "$S")" -eq "$(wc -l < "$S")" ]
  grep -q $'"Write(orphan/\\*\\*)"\r$' "$S"
  _valid_json "$S"
}

@test "middle removal leaves the original last entry untouched" {
  cat > "$S" <<'EOF'
{
  "permissions": {
    "deny": [
      "Edit(a)",
      "Write(a)",
      "Read(b)"
    ]
  }
}
EOF
  run bash "$PRUNE" "$S"
  [ "$status" -eq 0 ]
  printf '{\n  "permissions": {\n    "deny": [\n      "Edit(a)",\n      "Read(b)"\n    ]\n  }\n}\n' > "$W/expect"
  cmp "$S" "$W/expect"
}

@test "no trailing newline in the original is preserved" {
  printf '{\n  "permissions": {\n    "deny": [\n      "Edit(a)",\n      "Write(a)"\n    ]\n  }\n}' > "$S"
  run bash "$PRUNE" "$S"
  [ "$status" -eq 0 ]
  printf '{\n  "permissions": {\n    "deny": [\n      "Edit(a)"\n    ]\n  }\n}' > "$W/expect"
  cmp "$S" "$W/expect"
}

@test "idempotent: second run says nothing to prune and changes nothing" {
  _fixture
  bash "$PRUNE" "$S"
  cp "$S" "$W/after1"
  run bash "$PRUNE" "$S"
  [ "$status" -eq 0 ]
  [[ "$output" == *"nothing to prune"* ]]
  cmp "$S" "$W/after1"
}

@test "--dry-run lists the twins and writes nothing (no temp left in the dir)" {
  _fixture
  cp "$S" "$W/orig"
  run bash "$PRUNE" --dry-run "$S"
  [ "$status" -eq 0 ]
  [[ "$output" == *"would remove 2"* ]]
  cmp "$S" "$W/orig"
  [ "$(find "$W" -name '.settings.json.prune.*' | wc -l)" -eq 0 ]
}

@test "non-JSON file is refused byte-identical, exit 1, manual instruction printed" {
  printf '{\n  "permissions": {\n    "deny": [\n      "Edit(a)",\n      "Write(a)",\n    ]\n  \n' > "$S"
  cp "$S" "$W/orig"
  run bash "$PRUNE" "$S"
  [ "$status" -eq 1 ]
  [[ "$output" == *"not valid JSON"* ]]
  [[ "$output" == *"Manual fix"* ]]
  cmp "$S" "$W/orig"
}

@test "compact one-line deny array is refused byte-identical" {
  printf '{"permissions": {"deny": ["Edit(a)", "Write(a)"]}}\n' > "$S"
  cp "$S" "$W/orig"
  run bash "$PRUNE" "$S"
  [ "$status" -eq 1 ]
  [[ "$output" == *"not one entry per line"* ]]
  [[ "$output" == *'"Write(a)"'* ]]
  cmp "$S" "$W/orig"
}

@test "two entries on one line inside a multi-line deny array is refused" {
  printf '{\n  "permissions": {\n    "deny": [\n      "Edit(a)", "Write(a)",\n      "Read(b)"\n    ]\n  }\n}\n' > "$S"
  cp "$S" "$W/orig"
  run bash "$PRUNE" "$S"
  [ "$status" -eq 1 ]
  cmp "$S" "$W/orig"
}

@test "twins only outside permissions.deny: nothing to prune, file untouched" {
  printf '{\n  "permissions": {\n    "allow": [\n      "Edit(a)",\n      "Write(a)"\n    ],\n    "deny": [\n      "Read(b)"\n    ]\n  }\n}\n' > "$S"
  cp "$S" "$W/orig"
  run bash "$PRUNE" "$S"
  [ "$status" -eq 0 ]
  [[ "$output" == *"nothing to prune"* ]]
  cmp "$S" "$W/orig"
}

@test "missing settings file: exit 0, silent" {
  run bash "$PRUNE" "$W/does-not-exist.json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  ( cd "$W" && bash "$PRUNE" ) # default .claude/settings.json absent
}

@test "the real pre-BUG-033 shipped settings prune to the current shipped settings" {
  git -C "$FW_REPO_ROOT" cat-file -e b12168a^:.claude/settings.json 2>/dev/null || skip "history not available"
  git -C "$FW_REPO_ROOT" show b12168a^:.claude/settings.json > "$S"
  git -C "$FW_REPO_ROOT" show b12168a:.claude/settings.json > "$W/expect"
  run bash "$PRUNE" "$S"
  [ "$status" -eq 0 ]
  [[ "$output" == *"removed 13 redundant"* ]]
  cmp "$S" "$W/expect"
}

# --- doctor Check 19 ---------------------------------------------------------

_doctor_setup() {
  build_doctor_consumer
  seed_doctor_state_files
  printf 'FRAMEWORK_LINE=v2\nSCAFFOLD_REV=1\n' > "$DOC/.claude/.framework-version"
  PR="$BATS_TEST_TMPDIR/plugin-root"
  mkdir -p "$PR/doctor"
  cp "$PLUGIN_SRC/doctor/doctor.sh" "$PLUGIN_SRC/doctor/state-budgets.conf" "$PR/doctor/"
}
_run_pdoctor() { ( cd "$DOC" && CLAUDE_PROJECT_DIR="$DOC" CLAUDE_PLUGIN_ROOT="$PR" bash "$PR/doctor/doctor.sh" ); }

_doctor_settings() { # <deny entries as JSON lines>
  cat > "$DOC/.claude/settings.json" <<EOF
{
  "permissions": {
    "deny": [
$1
    ]
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "bash -c 'cd \"\$CLAUDE_PROJECT_DIR\" && bash .claude/hooks/sample-hook.sh'" }
        ]
      }
    ]
  }
}
EOF
}

@test "doctor: WARNING when deny has Write(X) with an Edit(X) twin (counts twins only)" {
  _doctor_setup
  _doctor_settings '      "Edit(.env)",
      "Edit(**/id_rsa*)",
      "Write(.env)",
      "Write(**/id_rsa*)",
      "Write(orphan)"'
  run _run_pdoctor
  [ "$status" -eq 0 ]
  grep -q 'settings-write-deny' "$DOCFLAG"
  grep -q '2 redundant Write(...) deny rules cause Claude Code startup warnings' "$DOCFLAG"
  grep -q '/ccmaf:update' "$DOCFLAG"
}

@test "doctor: no Check-19 finding when only orphan Write rules (or none) remain" {
  _doctor_setup
  _doctor_settings '      "Edit(.env)",
      "Write(orphan)"'
  run _run_pdoctor
  [ "$status" -eq 0 ]
  if [ -f "$DOCFLAG" ]; then ! grep -q 'settings-write-deny' "$DOCFLAG"; fi
  [[ "$output" =~ ^doctor:\ clean ]]
}

# --- apply-update wiring (stub level) ---------------------------------------

_extract_prune_block() {
  awk '/^_prune_helper=/{f=1} f{print} f && /^fi$/{exit}' \
    "$FW_REPO_ROOT/.claude/framework/update/apply-update.sh"
}

@test "apply-update: calls prune-write-deny after the hook-merge step" {
  local a
  a="$FW_REPO_ROOT/.claude/framework/update/apply-update.sh"
  local merge prune
  merge=$(grep -n 'bash "\$_merge_helper"' "$a" | head -1 | cut -d: -f1)
  prune=$(grep -n 'bash "\$_prune_helper"' "$a" | head -1 | cut -d: -f1)
  [ -n "$merge" ] && [ -n "$prune" ]
  [ "$prune" -gt "$merge" ]
}

@test "apply-update: a failing prune helper warns and the update continues (fail-soft)" {
  PROJECT_ROOT="$BATS_TEST_TMPDIR/proj"
  mkdir -p "$PROJECT_ROOT/.claude/framework/update"
  printf '{}\n' > "$PROJECT_ROOT/.claude/settings.json"
  printf '#!/usr/bin/env bash\necho "stub refused" >&2\nexit 1\n' \
    > "$PROJECT_ROOT/.claude/framework/update/prune-write-deny.sh"
  _extract_prune_block > "$BATS_TEST_TMPDIR/block.sh"
  grep -q 'prune-write-deny.sh' "$BATS_TEST_TMPDIR/block.sh"
  run bash -c 'set -euo pipefail; PROJECT_ROOT="$1"; . "$2"; echo "CONTINUED"' _ \
    "$PROJECT_ROOT" "$BATS_TEST_TMPDIR/block.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"could not prune settings.json"* ]]
  [[ "$output" == *"CONTINUED"* ]]
}

@test "apply-update: real helper prunes twins through the wired block" {
  PROJECT_ROOT="$BATS_TEST_TMPDIR/proj2"
  mkdir -p "$PROJECT_ROOT/.claude/framework/update"
  cp "$FW_REPO_ROOT/.claude/framework/update/prune-write-deny.sh" "$PROJECT_ROOT/.claude/framework/update/"
  S="$PROJECT_ROOT/.claude/settings.json"; _fixture
  _extract_prune_block > "$BATS_TEST_TMPDIR/block.sh"
  run bash -c 'set -euo pipefail; PROJECT_ROOT="$1"; . "$2"' _ "$PROJECT_ROOT" "$BATS_TEST_TMPDIR/block.sh"
  [ "$status" -eq 0 ]
  ! grep -q '"Write(.env)"' "$S"
}

# --- v2 wiring: scaffold rev + nudge ----------------------------------------

@test "scaffold rev is 3 in both the shipped .scaffold-rev and the template fallback" {
  [ "$(tr -d '\r\n' < "$PLUGIN_SRC/templates/.scaffold-rev")" = 3 ]
  grep -qx 'SCAFFOLD_REV=3' "$PLUGIN_SRC/templates/framework-version"
  grep -q 'prune-write-deny.sh' "$PLUGIN_SRC/commands/update.md"
}

@test "update-nudge: prints the scaffold-rev lag line when the project is behind" {
  local P="$BATS_TEST_TMPDIR/nudge"
  mkdir -p "$P/.claude"
  printf 'FRAMEWORK_LINE=v2\r\nSCAFFOLD_REV=2\r\n' > "$P/.claude/.framework-version"
  run env CLAUDE_PROJECT_DIR="$P" PATH="/usr/bin:/bin" bash "$PLUGIN_SRC/update/update-nudge.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"scaffold rev 2"*"ships rev 3"*"/ccmaf:update"* ]]
  printf 'FRAMEWORK_LINE=v2\nSCAFFOLD_REV=3\n' > "$P/.claude/.framework-version"
  run env CLAUDE_PROJECT_DIR="$P" PATH="/usr/bin:/bin" bash "$PLUGIN_SRC/update/update-nudge.sh"
  [[ "$output" != *"scaffold update available"* ]]
}

@test "no jq/node: structural fallback still prunes valid files and refuses broken ones" {
  local shim="$BATS_TEST_TMPDIR/shim" t
  mkdir -p "$shim"
  for t in bash awk grep sed head tail mktemp cp mv rm dirname wc tr cmp cat; do
    ln -s "$(command -v "$t")" "$shim/$t"
  done
  env PATH="$shim" bash -c true 2>/dev/null || skip "symlinked tool shim not runnable here (Git Bash on Windows)"
  _fixture
  run env PATH="$shim" bash "$PRUNE" "$S"
  [ "$status" -eq 0 ]
  [[ "$output" == *"removed 2 redundant"* ]]
  _valid_json "$S"
  printf '{\n  "permissions": {\n    "deny": [\n      "Edit(a)",\n      "Write(a)"\n    ]\n  }\n' > "$S"
  cp "$S" "$W/orig"
  run env PATH="$shim" bash "$PRUNE" "$S"
  [ "$status" -eq 1 ]
  cmp "$S" "$W/orig"
}
