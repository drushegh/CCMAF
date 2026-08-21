#!/usr/bin/env bats
# v2 migration bridge tier (TASK-166): migrate-v2.sh + the v2 updater's
# drop-refusal and tombstone honour + the doctor legacy-layout check.
# Fully offline; synthetic upstream/consumer fixtures in $BATS_TEST_TMPDIR
# (see update_helpers.bash). The `claude` CLI is SHIMMED per test — the
# real one must never be consulted.

load update_helpers

# Synthetic retired list matching the fixture layout. Deliberately includes
# the update/ self-delete entry (ordered last by the script) and leaves
# project-hook.sh + statusline.sh unlisted (survivor + move cases).
_write_retired_list() {
  cat > "$CONSUMER/.claude/framework/update/retired-paths.txt" <<'EOF'
# synthetic retired list (test fixture)
.claude/framework/owned/
.claude/framework/update/
.claude/hooks/sample-hook.sh
.claude/commands/wrapup.md
CLAUDE.framework.md
EOF
}

# Consumer settings.json: one framework hook reg (retired), one consumer
# hook reg (survives), one retired permission + one consumer permission,
# statusLine pointing at the old hook path.
_write_settings() {
  cat > "$CONSUMER/.claude/settings.json" <<'EOF'
{
  "permissions": {
    "allow": ["Bash(bash .claude/hooks/sample-hook.sh:*)", "Bash(npm test:*)"],
    "deny": ["Read(./.env)"]
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "bash .claude/hooks/sample-hook.sh" },
          { "type": "command", "command": "bash .claude/hooks/project-hook.sh" }
        ]
      }
    ]
  },
  "statusLine": { "type": "command", "command": "bash .claude/hooks/statusline.sh" }
}
EOF
}

# Build the migration-ready consumer on top of the shared fixture:
# migrate-v2.sh + retired list + settings + a statusline hook file.
build_migration_consumer() {
  build_upstream
  build_consumer
  cp "$UPDATE_SRC/migrate-v2.sh" "$CONSUMER/.claude/framework/update/"
  _write_retired_list
  _write_settings
  echo "statusline v1" > "$CONSUMER/.claude/hooks/statusline.sh"
  printf '# My project\n\n@CLAUDE.framework.md\n\nProject notes.\n' > "$CONSUMER/CLAUDE.md"
  git -C "$CONSUMER" add -A
  git -C "$CONSUMER" commit -qm "migration-ready baseline"
}

# `claude` shim: good = kernel + core installed and enabled.
shim_claude_good() {
  SHIM="$BATS_TEST_TMPDIR/shim"
  mkdir -p "$SHIM"
  cat > "$SHIM/claude" <<'EOF'
#!/usr/bin/env bash
echo '[{"id":"ccmaf-kernel@ccmaf","version":"0.2.0","scope":"user","enabled":true},{"id":"ccmaf@ccmaf","version":"0.1.0","scope":"user","enabled":true}]'
EOF
  chmod +x "$SHIM/claude"
  PATH="$SHIM:$PATH"
}

# `claude` shim: broken/absent probe (empty output, exit 1).
shim_claude_broken() {
  SHIM="$BATS_TEST_TMPDIR/shim"
  mkdir -p "$SHIM"
  printf '#!/usr/bin/env bash\nexit 1\n' > "$SHIM/claude"
  chmod +x "$SHIM/claude"
  PATH="$SHIM:$PATH"
}

migrate() { ( cd "$CONSUMER" && bash .claude/framework/update/migrate-v2.sh "$@" ); }

# --- migrate-v2.sh: refusals (fail-safe floor) ------------------------

@test "migrate-v2: refuses when the plugin floor cannot be verified — guard survives" {
  build_migration_consumer
  shim_claude_broken
  run migrate --yes
  [ "$status" -eq 4 ]
  [[ "$output" == *"REFUSING"* ]]
  [[ "$output" == *"claude plugin install ccmaf-kernel@ccmaf"* ]]
  # Nothing was deleted, nothing tombstoned.
  [ -f "$CONSUMER/.claude/hooks/sample-hook.sh" ]
  [ -f "$CONSUMER/CLAUDE.framework.md" ]
  [ ! -f "$CONSUMER/.claude/.migrate-v2-tombstone" ]
}

@test "migrate-v2: refuses on the framework dev repo" {
  build_migration_consumer
  shim_claude_good
  touch "$CONSUMER/.claude/.framework-dev-repo"
  run migrate --yes
  [ "$status" -ne 0 ]
  [[ "$output" == *"dev repo"* ]]
  [ -f "$CONSUMER/.claude/hooks/sample-hook.sh" ]
}

@test "migrate-v2: refuses on a dirty tree (no tombstone yet)" {
  build_migration_consumer
  shim_claude_good
  echo "uncommitted" > "$CONSUMER/scratch.txt"
  run migrate --yes
  [ "$status" -ne 0 ]
  [[ "$output" == *"not clean"* ]]
  [ -f "$CONSUMER/.claude/hooks/sample-hook.sh" ]
}

@test "migrate-v2: dry-run works WITHOUT the plugin floor and changes nothing" {
  build_migration_consumer
  shim_claude_broken   # the "show the plan" path must not require installs
  run migrate --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"DRY RUN"* ]]
  [[ "$output" == *".claude/hooks/sample-hook.sh"* ]]
  [[ "$output" == *".claude/framework/owned/ (recursive)"* ]]
  [[ "$output" == *"statusline.sh"* ]]
  [ -f "$CONSUMER/.claude/hooks/sample-hook.sh" ]
  [ -f "$CONSUMER/.claude/hooks/statusline.sh" ]
  [ ! -f "$CONSUMER/.claude/.migrate-v2-tombstone" ]
  [ -z "$(git -C "$CONSUMER" status --porcelain)" ]
}

# --- migrate-v2.sh: the crossover -------------------------------------

@test "migrate-v2: happy path — deletes, tombstones, rewrites settings, moves statusline, writes the v2 line, commits" {
  build_migration_consumer
  shim_claude_good
  run migrate --yes
  [ "$status" -eq 0 ]
  # Retired paths gone (incl. the update/ self-delete).
  [ ! -f "$CONSUMER/.claude/hooks/sample-hook.sh" ]
  [ ! -f "$CONSUMER/.claude/commands/wrapup.md" ]
  [ ! -f "$CONSUMER/CLAUDE.framework.md" ]
  [ ! -d "$CONSUMER/.claude/framework/owned" ]
  [ ! -d "$CONSUMER/.claude/framework/update" ]
  # Survivors intact.
  [ -f "$CONSUMER/.claude/hooks/project-hook.sh" ]
  # Statusline moved to the scaffold slot.
  [ ! -f "$CONSUMER/.claude/hooks/statusline.sh" ]
  grep -q "statusline v1" "$CONSUMER/.claude/statusline.sh"
  # Tombstone records every retirement in manifest grammar.
  grep -qxF ".claude/framework/owned/" "$CONSUMER/.claude/.migrate-v2-tombstone"
  grep -qxF ".claude/hooks/sample-hook.sh" "$CONSUMER/.claude/.migrate-v2-tombstone"
  grep -qxF ".claude/hooks/statusline.sh" "$CONSUMER/.claude/.migrate-v2-tombstone"
  # settings.json: retired refs stripped, consumer entries kept, valid JSON.
  # bash opens the file (MSYS-path-aware); python reads stdin — a
  # Windows-native python cannot open /tmp/... MSYS paths itself.
  python -c "
import json, sys
s = json.load(sys.stdin)
cmds = [h['command'] for g in s.get('hooks', {}).get('PostToolUse', []) for h in g['hooks']]
assert not any('sample-hook' in c for c in cmds), cmds
assert any('project-hook' in c for c in cmds), cmds
assert 'Bash(npm test:*)' in s['permissions']['allow']
assert not any('sample-hook' in a for a in s['permissions']['allow'])
assert s['permissions']['deny'] == ['Read(./.env)']
assert s['statusLine']['command'] == 'bash .claude/statusline.sh', s['statusLine']
" < "$CONSUMER/.claude/settings.json"
  # CLAUDE.md's dangling import was commented out, project notes survive.
  ! grep -Eq '^@CLAUDE\.framework\.md' "$CONSUMER/CLAUDE.md"
  grep -q "retired by migrate-v2" "$CONSUMER/CLAUDE.md"
  grep -q "Project notes." "$CONSUMER/CLAUDE.md"
  # v2 line written exactly once (upsert, no duplicates); one clean commit.
  [ "$(grep -cE '^FRAMEWORK_LINE=' "$CONSUMER/.claude/.framework-version")" -eq 1 ]
  grep -Eq '^FRAMEWORK_LINE=v2$' "$CONSUMER/.claude/.framework-version"
  grep -Eq '^SCAFFOLD_REV=1' "$CONSUMER/.claude/.framework-version"
  [ -z "$(git -C "$CONSUMER" status --porcelain)" ]
  git -C "$CONSUMER" log -1 --format=%s | grep -q "migrate to CCMAF v2"
}

@test "migrate-v2: clean v2 tree without a tombstone is a plain no-op" {
  build_migration_consumer
  shim_claude_good
  echo "FRAMEWORK_LINE=v2" >> "$CONSUMER/.claude/.framework-version"
  git -C "$CONSUMER" add -A && git -C "$CONSUMER" commit -qm "hand-v2"
  run migrate --yes
  [ "$status" -eq 0 ]
  [[ "$output" == *"already on the v2 line"* ]]
  [ -f "$CONSUMER/.claude/hooks/sample-hook.sh" ]   # nothing touched
}

@test "migrate-v2: FINALIZE — a v2 tree with a stray update/ + tombstone is finished, not re-migrated" {
  build_migration_consumer
  shim_claude_good
  run migrate --yes
  [ "$status" -eq 0 ]
  # Simulate the crash-after-v2-line window: update/ back on disk (dirty).
  mkdir -p "$CONSUMER/.claude/framework/update"
  cp "$UPDATE_SRC/migrate-v2.sh" "$CONSUMER/.claude/framework/update/"
  run migrate --yes
  [ "$status" -eq 0 ]
  [[ "$output" == *"FINALIZE"* ]]
  [ ! -d "$CONSUMER/.claude/framework/update" ]
  [ -z "$(git -C "$CONSUMER" status --porcelain)" ]
}

@test "migrate-v2: resumes an interrupted run (tombstone + dirty tree)" {
  build_migration_consumer
  shim_claude_good
  # Simulate a crash mid-deletion: tombstone written, one path already gone,
  # tree dirty, v2 line absent.
  printf '# tombstone\n.claude/hooks/sample-hook.sh\n' > "$CONSUMER/.claude/.migrate-v2-tombstone"
  rm "$CONSUMER/.claude/hooks/sample-hook.sh"
  run migrate --yes
  [ "$status" -eq 0 ]
  [[ "$output" == *"RESUME"* ]]
  grep -Eq '^FRAMEWORK_LINE=v2' "$CONSUMER/.claude/.framework-version"
  # No duplicate tombstone entries from the resume.
  [ "$(grep -cxF '.claude/hooks/sample-hook.sh' "$CONSUMER/.claude/.migrate-v2-tombstone")" -eq 1 ]
  [ -z "$(git -C "$CONSUMER" status --porcelain)" ]
}

# --- apply-update.sh: the two-release ladder ---------------------------

@test "apply-update: refuses a drop release on an un-migrated project" {
  build_upstream
  # Turn upstream v2 into a DROP release: marker + retired entries removed.
  cat > "$UPSTREAM/.claude/framework/update/framework-manifest.txt" <<'EOF'
# synthetic manifest (test fixture)
# FRAMEWORK-RELEASE-LINE: drop
.claude/framework/owned/
EOF
  git -C "$UPSTREAM" add -A
  git -C "$UPSTREAM" commit -qm "v2.1: drop release"
  build_consumer
  run apply_update
  [ "$status" -eq 6 ]
  [[ "$output" == *"REFUSING"* ]]
  [[ "$output" == *"migrate-v2.sh"* ]]
  # Nothing was pruned by the refused run.
  [ -f "$CONSUMER/.claude/hooks/sample-hook.sh" ]
  [ -f "$CONSUMER/CLAUDE.framework.md" ]
}

@test "apply-update: a HAND-WRITTEN v2 line (no tombstone) does NOT disarm the drop gate" {
  # Panel-converged finding (fable S2 + sol B2): the activation line alone
  # is forgeable; the tombstone is the migration marker the gate requires.
  build_upstream
  cat > "$UPSTREAM/.claude/framework/update/framework-manifest.txt" <<'EOF'
# synthetic manifest (test fixture)
# FRAMEWORK-RELEASE-LINE: drop
.claude/framework/owned/
EOF
  git -C "$UPSTREAM" add -A
  git -C "$UPSTREAM" commit -qm "v2.1: drop release"
  build_consumer
  echo "FRAMEWORK_LINE=v2" >> "$CVERSION"
  git -C "$CONSUMER" add -A && git -C "$CONSUMER" commit -qm "hand-written v2 line"
  run apply_update
  [ "$status" -eq 6 ]
  [[ "$output" == *"REFUSING"* ]]
  # The v1 tree survived intact — the prune never ran.
  [ -f "$CONSUMER/.claude/hooks/sample-hook.sh" ]
  [ -f "$CONSUMER/CLAUDE.framework.md" ]
}

@test "apply-update: applies a drop release once BOTH v2 markers exist" {
  build_upstream
  cat > "$UPSTREAM/.claude/framework/update/framework-manifest.txt" <<'EOF'
# synthetic manifest (test fixture)
# FRAMEWORK-RELEASE-LINE: drop
.claude/framework/owned/
EOF
  git -C "$UPSTREAM" add -A
  git -C "$UPSTREAM" commit -qm "v2.1: drop release"
  build_consumer
  echo "FRAMEWORK_LINE=v2" >> "$CVERSION"
  rm "$CONSUMER/.claude/hooks/sample-hook.sh"
  printf '# tombstone\n.claude/hooks/sample-hook.sh\n' > "$CONSUMER/.claude/.migrate-v2-tombstone"
  git -C "$CONSUMER" add -A && git -C "$CONSUMER" commit -qm "migrated (both markers)"
  run apply_update
  [ "$status" -eq 0 ]
  # The tombstoned retirement stayed retired through the drop update.
  [ ! -f "$CONSUMER/.claude/hooks/sample-hook.sh" ]
}

@test "apply-update: structural backstop — guard entry vanishing upstream refuses even WITHOUT the drop marker" {
  # Panel finding (sol B3): a mis-authored drop release could forget the
  # header marker; the guard's manifest entry disappearing is itself proof.
  build_upstream
  # Upstream: NO drop marker, but the guard entry is absent (fixture
  # manifest never lists it).
  build_consumer
  echo ".claude/hooks/block-dangerous-commands.py" >> "$CONSUMER/.claude/framework/update/framework-manifest.txt"
  echo "guard v1" > "$CONSUMER/.claude/hooks/block-dangerous-commands.py"
  git -C "$CONSUMER" add -A && git -C "$CONSUMER" commit -qm "guard present"
  run apply_update
  [ "$status" -eq 6 ]
  [[ "$output" == *"REFUSING"* ]]
  [ -f "$CONSUMER/.claude/hooks/block-dangerous-commands.py" ]
}

@test "apply-update: never resurrects or prunes a tombstoned path" {
  build_upstream
  build_consumer
  # The consumer retired sample-hook.sh via migration; upstream (bridge
  # line) still ships it. Without the tombstone this update would
  # resurrect it.
  rm "$CONSUMER/.claude/hooks/sample-hook.sh"
  printf '# tombstone\n.claude/hooks/sample-hook.sh\n' > "$CONSUMER/.claude/.migrate-v2-tombstone"
  git -C "$CONSUMER" add -A && git -C "$CONSUMER" commit -qm "retired + tombstoned"
  run apply_update
  [ "$status" -eq 0 ]
  [[ "$output" == *"tombstoned path"* ]]
  [ ! -f "$CONSUMER/.claude/hooks/sample-hook.sh" ]
  # Un-tombstoned paths still update normally.
  grep -q "rules v2" "$CONSUMER/CLAUDE.framework.md"
}

@test "migrate-v2: non-interactive without --yes refuses before mutating" {
  build_migration_consumer
  shim_claude_good
  run migrate   # bats stdin is not a tty; no --yes
  [ "$status" -eq 4 ]
  [[ "$output" == *"non-interactive"* ]]
  [ -f "$CONSUMER/.claude/hooks/sample-hook.sh" ]
  [ ! -f "$CONSUMER/.claude/.migrate-v2-tombstone" ]
}

@test "migrate-v2: invalid settings.json aborts BEFORE any deletion, resume-armed" {
  build_migration_consumer
  shim_claude_good
  echo "{ this is not json" > "$CONSUMER/.claude/settings.json"
  git -C "$CONSUMER" add -A && git -C "$CONSUMER" commit -qm "broken settings"
  run migrate --yes
  [ "$status" -ne 0 ]
  # Nothing was deleted; the tombstone header exists so a re-run (after the
  # human fixes settings.json) lands in the RESUME path, not a refusal.
  [ -f "$CONSUMER/.claude/hooks/sample-hook.sh" ]
  [ -f "$CONSUMER/CLAUDE.framework.md" ]
  [ -f "$CONSUMER/.claude/.migrate-v2-tombstone" ]
}

@test "migrate-v2: consumer's own .claude/statusline.sh wins; hook copy retired" {
  build_migration_consumer
  shim_claude_good
  echo "consumer statusline" > "$CONSUMER/.claude/statusline.sh"
  git -C "$CONSUMER" add -A && git -C "$CONSUMER" commit -qm "own statusline"
  run migrate --yes
  [ "$status" -eq 0 ]
  grep -q "consumer statusline" "$CONSUMER/.claude/statusline.sh"
  [ ! -f "$CONSUMER/.claude/hooks/statusline.sh" ]
}

@test "retired-paths.txt partitions the REAL v1 manifest exactly (no orphans either way)" {
  # Every real manifest entry is either retired or in the documented
  # keep-set; every retired entry is a real manifest entry. A drift here
  # means a path the migration would miss — or delete without authority.
  keeps=".claude/hooks/statusline.sh .gitattributes docs/README.md docs/inspiration/.gitkeep docs/research/.gitkeep docs/images/.gitkeep docs/diagrams/.gitkeep .claude/framework/docs/specs/.gitkeep"
  manifest="$UPDATE_SRC/framework-manifest.txt"
  retired="$UPDATE_SRC/retired-paths.txt"
  while IFS= read -r line; do
    line="${line%$'\r'}"
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    if grep -qxF "$line" "$retired"; then continue; fi
    case " $keeps " in *" $line "*) continue ;; esac
    echo "manifest entry neither retired nor kept: $line"
    return 1
  done < "$manifest"
  while IFS= read -r line; do
    line="${line%$'\r'}"
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    if ! grep -qxF "$line" "$manifest"; then
      echo "retired entry not in the manifest (no authority to delete): $line"
      return 1
    fi
  done < "$retired"
}

# --- doctor: legacy-layout (the two broken states) ---------------------

@test "doctor legacy-layout: tombstone without the v2 line is CRITICAL" {
  build_upstream
  build_consumer
  mkdir -p "$CONSUMER/.claude/framework/doctor"
  cp "$DOCTOR_SRC/doctor.sh" "$CONSUMER/.claude/framework/doctor/"
  printf '# tombstone\n.claude/hooks/sample-hook.sh\n' > "$CONSUMER/.claude/.migrate-v2-tombstone"
  ( cd "$CONSUMER" && bash .claude/framework/doctor/doctor.sh ) || true
  grep -q "CRITICAL.*legacy-layout\|legacy-layout" "$CONSUMER/.claude/.framework-doctor-findings.md"
  grep -q "interrupted" "$CONSUMER/.claude/.framework-doctor-findings.md"
}

@test "doctor legacy-layout: v2 line with the bundled v1 doctor still present is WARNING" {
  build_upstream
  build_consumer
  mkdir -p "$CONSUMER/.claude/framework/doctor"
  cp "$DOCTOR_SRC/doctor.sh" "$CONSUMER/.claude/framework/doctor/"
  echo "FRAMEWORK_LINE=v2" >> "$CVERSION"
  ( cd "$CONSUMER" && bash .claude/framework/doctor/doctor.sh ) || true
  grep -q "legacy-layout" "$CONSUMER/.claude/.framework-doctor-findings.md"
  grep -q "BOTH active" "$CONSUMER/.claude/.framework-doctor-findings.md"
}
