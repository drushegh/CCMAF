#!/usr/bin/env bats
# Regression tier for the U11 deep-review fixes (2026-09-26) to the v1
# update system: old-layout detection, subdirectory-project rollback,
# check-updates drop-release awareness + backslash guard + deliberate hook
# removals, migrate-layout piping/portability, migrate-v2 FINALIZE staging
# and import rewrite, init-framework-version flag values. Fully offline;
# synthetic fixtures in $BATS_TEST_TMPDIR (see update_helpers.bash).

load update_helpers

# --- apply-update / migrate-layout: old-layout detection ---------------

@test "U11 apply-update: root TASKS.md next to .claude/TASKS.md is NOT the old layout" {
  build_upstream
  build_consumer
  cp "$UPDATE_SRC/migrate-layout.sh" "$CONSUMER/.claude/framework/update/"
  echo "# project-owned root tasks" > "$CONSUMER/TASKS.md"
  echo "# board" > "$CONSUMER/.claude/TASKS.md"
  git -C "$CONSUMER" add -A && git -C "$CONSUMER" commit -qm "root + board TASKS.md"
  run apply_update
  [ "$status" -eq 0 ]
  [[ "$output" != *"old layout detected"* ]]
  [ -f "$CONSUMER/TASKS.md" ]
  grep -q "owned v2" "$CONSUMER/.claude/framework/owned/file.txt"
}

@test "U11 migrate-layout: root TASKS.md with an existing .claude/TASKS.md is a no-op" {
  build_old_layout_consumer tasks-only
  mkdir -p "$OLDC/.claude"
  echo "# board" > "$OLDC/.claude/TASKS.md"
  git -C "$OLDC" add -A && git -C "$OLDC" commit -qm "board exists"
  run migrate_layout
  [ "$status" -eq 0 ]
  [[ "$output" == *"already on new layout"* ]]
  [ -f "$OLDC/TASKS.md" ]
}

@test "U11 migrate-layout: an old-layout move onto an existing destination skips instead of dead-ending" {
  build_old_layout_consumer full
  mkdir -p "$OLDC/.claude"
  echo "# already-migrated status" > "$OLDC/.claude/STATUS.md"
  git -C "$OLDC" add -A && git -C "$OLDC" commit -qm "partial earlier migration"
  run migrate_layout
  [ "$status" -eq 0 ]
  [[ "$output" == *"skip: STATUS.md"* ]]
  [ -f "$OLDC/.claude/TASKS.md" ]
  grep -q "already-migrated status" "$OLDC/.claude/STATUS.md"
}

@test "U11 migrate-layout: works when piped (no BASH_SOURCE) from the project root" {
  build_old_layout_consumer full
  run bash -c "cd '$OLDC' && cat .claude/framework/update/migrate-layout.sh | bash -s -- --yes"
  [ "$status" -eq 0 ]
  [[ "$output" != *"unbound variable"* ]]
  [ ! -d "$OLDC/00_framework" ]
  [ -f "$OLDC/.claude/TASKS.md" ]
  git -C "$OLDC" log -1 --format=%s | grep -q "layout migration"
}

@test "U11 migrate-layout: no sed temp files left behind; rewrite used the portable boundary" {
  build_old_layout_consumer full
  run migrate_layout
  [ "$status" -eq 0 ]
  [ -z "$(find "$OLDC" -name '*.migrate-sed.tmp' -print)" ]
  grep -q '^See .claude/framework/self/README.md$' "$OLDC/CLAUDE.md"
}

# --- apply-update: rollback in a subdirectory project ------------------

@test "U11 apply-update rollback: restores (never deletes) tracked files in a SUBDIRECTORY project" {
  REPO="$BATS_TEST_TMPDIR/mono"
  PROJECT_ROOT="$REPO/app"
  mkdir -p "$PROJECT_ROOT/.claude/hooks"
  _init_fixture_repo "$REPO"
  echo "tracked v1" > "$PROJECT_ROOT/.claude/hooks/sample-hook.sh"
  git -C "$REPO" add -A && git -C "$REPO" commit -qm "mono baseline"
  echo "half-swapped" > "$PROJECT_ROOT/.claude/hooks/sample-hook.sh"
  mkdir -p "$PROJECT_ROOT/.claude/newdir" && echo x > "$PROJECT_ROOT/.claude/newdir/f"
  # Pull the real rollback function out of apply-update.sh and drive it.
  eval "$(sed -n '/^_rollback_framework_paths() {/,/^}/p' "$UPDATE_SRC/apply-update.sh")"
  # shellcheck disable=SC2034  # both consumed by the eval'd _rollback_framework_paths
  declare -A final_type=([.claude/hooks/sample-hook.sh]=file [.claude/newdir]=dir)
  # shellcheck disable=SC2034
  final_paths=(.claude/hooks/sample-hook.sh .claude/newdir)
  _rollback_framework_paths
  [ -f "$PROJECT_ROOT/.claude/hooks/sample-hook.sh" ]
  grep -q "tracked v1" "$PROJECT_ROOT/.claude/hooks/sample-hook.sh"
  [ ! -e "$PROJECT_ROOT/.claude/newdir" ]
}

# --- check-updates -------------------------------------------------------

_make_drop_upstream() {
  cat > "$UPSTREAM/.claude/framework/update/framework-manifest.txt" <<'EOF'
# synthetic manifest (test fixture)
# FRAMEWORK-RELEASE-LINE: drop
.claude/framework/owned/
EOF
  git -C "$UPSTREAM" add -A
  git -C "$UPSTREAM" commit -qm "v2.1: drop release"
}

@test "U11 check-updates: a drop release on an un-migrated project writes NO apply flag" {
  build_upstream
  _make_drop_upstream
  build_consumer
  echo "stale flag" > "$CFLAG"
  run check_updates
  [ "$status" -eq 0 ]
  [ ! -f "$CFLAG" ]
  [[ "$output" == *"apply-update would refuse"* ]]
  [[ "$output" == *"migrate-v2.sh"* ]]
}

@test "U11 check-updates: structural backstop — guard entry vanishing upstream also suppresses the flag" {
  build_upstream
  echo ".claude/hooks/block-dangerous-commands.py" >> "$UPSTREAM/.claude/framework/update/framework-manifest.txt"
  git -C "$UPSTREAM" add -A && git -C "$UPSTREAM" commit -qm "v2 lists the guard"
  build_consumer
  echo ".claude/hooks/block-dangerous-commands.py" >> "$CONSUMER/.claude/framework/update/framework-manifest.txt"
  git -C "$CONSUMER" add -A && git -C "$CONSUMER" commit -qm "local manifest lists the guard"
  # Unmarked drop: the guard entry disappears upstream.
  write_fixture_manifest "$UPSTREAM/.claude/framework/update/framework-manifest.txt"
  git -C "$UPSTREAM" add -A && git -C "$UPSTREAM" commit -qm "guard entry gone, no marker"
  run check_updates
  [ "$status" -eq 0 ]
  [ ! -f "$CFLAG" ]
  [[ "$output" == *"dangerous-command guard"* ]]
}

@test "U11 check-updates: a MIGRATED project still gets the flag for a drop release" {
  build_upstream
  _make_drop_upstream
  build_consumer
  printf '# tombstone\n' > "$CONSUMER/.claude/.migrate-v2-tombstone"
  echo "FRAMEWORK_LINE=v2" >> "$CVERSION"
  run check_updates
  [ "$status" -eq 0 ]
  [ -f "$CFLAG" ]
}

@test "U11 check-updates: backslash manifest entry is skipped as unsafe" {
  build_upstream
  printf '%s\n' 'a\..\evil' >> "$UPSTREAM/.claude/framework/update/framework-manifest.txt"
  git -C "$UPSTREAM" add -A && git -C "$UPSTREAM" commit -qm "backslash entry"
  build_consumer
  run check_updates
  [ "$status" -eq 0 ]
  [[ "$output" == *"skipping unsafe upstream manifest entry"* ]]
}

_canon_with() {  # <hook-file>... → canonical settings.json registering each
  local first=1 h
  printf '{ "hooks": { "PostToolUse": [ { "hooks": ['
  for h in "$@"; do
    [ "$first" = 1 ] || printf ','
    printf '{ "type": "command", "command": "bash .claude/hooks/%s" }' "$h"
    first=0
  done
  printf '] } ] } }\n'
}

@test "U11 check-updates: a hook the consumer deliberately removed does not keep the flag alive" {
  build_upstream
  _canon_with sample-hook.sh > "$UPSTREAM/.claude/settings.json"
  git -C "$UPSTREAM" add -A && git -C "$UPSTREAM" commit -qm "v3: registers sample-hook"
  V3=$(git -C "$UPSTREAM" rev-parse HEAD)
  echo "dev note" > "$UPSTREAM/DEV-NOTES.md"
  git -C "$UPSTREAM" add -A && git -C "$UPSTREAM" commit -qm "v4: non-shipped only"
  build_consumer
  set_version_field FRAMEWORK_PINNED_SHA "$V3"
  # Consumer removed the sample-hook registration on purpose.
  echo '{ "hooks": {} }' > "$CONSUMER/.claude/settings.json"
  run check_updates
  [ "$status" -eq 0 ]
  [ ! -f "$CFLAG" ]
  [[ "$output" == *"no framework-owned files changed"* ]]
}

@test "U11 check-updates: a registration NEW since the pin is still surfaced" {
  build_upstream
  _canon_with sample-hook.sh > "$UPSTREAM/.claude/settings.json"
  git -C "$UPSTREAM" add -A && git -C "$UPSTREAM" commit -qm "v3: registers sample-hook"
  build_consumer
  set_version_field FRAMEWORK_PINNED_SHA "$UPSTREAM_V2_SHA"
  echo '{ "hooks": {} }' > "$CONSUMER/.claude/settings.json"
  run check_updates
  [ "$status" -eq 0 ]
  [ -f "$CFLAG" ]
  grep -q "sample-hook.sh" "$CFLAG"
}

# --- merge-hook-registrations -----------------------------------------

@test "U11 merge: a registration the PINNED version shipped and the consumer removed is not re-added" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  local d="$BATS_TEST_TMPDIR/m"; mkdir -p "$d"
  _canon_with a.sh b.sh > "$d/pinned.json"
  _canon_with a.sh b.sh c.sh > "$d/canon.json"
  _canon_with a.sh > "$d/consumer.json"
  run bash "$UPDATE_SRC/merge-hook-registrations.sh" "$d/consumer.json" "$d/canon.json" "$d/pinned.json"
  [ "$status" -eq 0 ]
  [[ "$output" == *"registered 1 new"* ]]
  grep -q "c.sh" "$d/consumer.json"
  # -F + the hooks/ prefix: an unanchored regex "b.sh" also matches "bash" in every entry.
  ! grep -qF "hooks/b.sh" "$d/consumer.json" || false
  # Without the pinned canonical: additive-all (back-compat).
  _canon_with a.sh > "$d/consumer2.json"
  run bash "$UPDATE_SRC/merge-hook-registrations.sh" "$d/consumer2.json" "$d/canon.json"
  [[ "$output" == *"registered 2 new"* ]]
}

# --- init-framework-version -------------------------------------------

@test "U11 init-framework-version: a flag missing its value fails cleanly (no unbound-variable crash)" {
  build_upstream
  build_consumer
  cp "$UPDATE_SRC/init-framework-version.sh" "$CONSUMER/.claude/framework/update/"
  rm -f "$CVERSION"
  run bash "$CONSUMER/.claude/framework/update/init-framework-version.sh" --subdir
  [ "$status" -eq 1 ]
  [[ "$output" == *"--subdir requires a value"* ]]
  [[ "$output" != *"unbound variable"* ]]
  run bash "$CONSUMER/.claude/framework/update/init-framework-version.sh" --url --force
  [ "$status" -eq 1 ]
  [[ "$output" == *"--url requires a value"* ]]
  run bash "$CONSUMER/.claude/framework/update/init-framework-version.sh" --help
  [[ "$output" == *"--subdir"* ]]
}

# --- migrate-v2 ----------------------------------------------------------

_u11_migration_consumer() {
  build_upstream
  build_consumer
  cp "$UPDATE_SRC/migrate-v2.sh" "$CONSUMER/.claude/framework/update/"
  cat > "$CONSUMER/.claude/framework/update/retired-paths.txt" <<'EOF'
.claude/framework/owned/
.claude/framework/update/
.claude/hooks/sample-hook.sh
CLAUDE.framework.md
EOF
  printf '# My project\n\nRules: @CLAUDE.framework.md plus my notes\n\nSee `@CLAUDE.framework.md` docs.\n' > "$CONSUMER/CLAUDE.md"
  echo "tracked notes v1" > "$CONSUMER/notes.txt"
  git -C "$CONSUMER" add -A
  git -C "$CONSUMER" commit -qm "migration-ready baseline"
  SHIM="$BATS_TEST_TMPDIR/shim"; mkdir -p "$SHIM"
  printf '#!/usr/bin/env bash\necho %s\n' "'[{\"id\":\"ccmaf-kernel@ccmaf\",\"enabled\":true},{\"id\":\"ccmaf@ccmaf\",\"enabled\":true}]'" > "$SHIM/claude"
  chmod +x "$SHIM/claude"
  PATH="$SHIM:$PATH"
}
_u11_migrate() { ( cd "$CONSUMER" && bash .claude/framework/update/migrate-v2.sh "$@" ); }

@test "U11 migrate-v2: inline @import is retired without deleting the rest of the line" {
  _u11_migration_consumer
  run _u11_migrate --yes
  [ "$status" -eq 0 ]
  grep -q "^Rules: .*plus my notes$" "$CONSUMER/CLAUDE.md"
  ! grep -q "Rules: @CLAUDE.framework.md" "$CONSUMER/CLAUDE.md" || false
  # A code-span mention is not an import and is left alone.
  grep -qF 'See `@CLAUDE.framework.md` docs.' "$CONSUMER/CLAUDE.md"
}

@test "U11 migrate-v2: FINALIZE commits only migration paths; unrelated edits stay uncommitted" {
  _u11_migration_consumer
  run _u11_migrate --yes
  [ "$status" -eq 0 ]
  # Crash-after-v2-line window + an unrelated edit made meanwhile.
  mkdir -p "$CONSUMER/.claude/framework/update"
  cp "$UPDATE_SRC/migrate-v2.sh" "$CONSUMER/.claude/framework/update/"
  echo "unrelated WIP" >> "$CONSUMER/notes.txt"
  echo "scratch" > "$CONSUMER/scratch.txt"
  run _u11_migrate --yes
  [ "$status" -eq 0 ]
  [[ "$output" == *"FINALIZE"* ]]
  [[ "$output" == *"unrelated"* ]]
  [ ! -d "$CONSUMER/.claude/framework/update" ]
  ! git -C "$CONSUMER" show --name-only --format= HEAD | grep -qx "notes.txt" || false
  ! git -C "$CONSUMER" show --name-only --format= HEAD | grep -qx "scratch.txt" || false
  git -C "$CONSUMER" status --porcelain | grep -q "notes.txt"
  git -C "$CONSUMER" status --porcelain | grep -q "scratch.txt"
  grep -q "unrelated WIP" "$CONSUMER/notes.txt"
}
