#!/usr/bin/env bats
# Audit U5: migrate-v2.sh retires CLAUDE.framework.md and comments out the
# @import, but prose links/mentions of the deleted file in CLAUDE.md used to
# survive silently. It now WARNS with line numbers (dry-run and real run).
# Fixture shape mirrors migrate_v2.bats (kept self-contained here).

load update_helpers

_build() {
  build_upstream
  build_consumer
  cp "$UPDATE_SRC/migrate-v2.sh" "$CONSUMER/.claude/framework/update/"
  cat > "$CONSUMER/.claude/framework/update/retired-paths.txt" <<'EOF'
.claude/framework/owned/
.claude/framework/update/
.claude/hooks/sample-hook.sh
.claude/commands/wrapup.md
CLAUDE.framework.md
EOF
  printf '{ "permissions": { "allow": [] } }\n' > "$CONSUMER/.claude/settings.json"
  # line 3 = bare import (handled by the rewrite, NOT warned);
  # line 5 = markdown link; line 7 = prose mention (both warned).
  printf '%s\n' '# My project' '' '@CLAUDE.framework.md' '' \
    'Rules: see [the framework rules](CLAUDE.framework.md).' '' \
    'Agents read CLAUDE.framework.md first.' 'Project notes.' > "$CONSUMER/CLAUDE.md"
  git -C "$CONSUMER" add -A
  git -C "$CONSUMER" commit -qm "migration-ready baseline"
  SHIM="$BATS_TEST_TMPDIR/shim"; mkdir -p "$SHIM"
  cat > "$SHIM/claude" <<'EOF'
#!/usr/bin/env bash
echo '[{"id":"ccmaf-kernel@ccmaf","version":"0.2.0","scope":"user","enabled":true},{"id":"ccmaf@ccmaf","version":"0.1.0","scope":"user","enabled":true}]'
EOF
  chmod +x "$SHIM/claude"
  PATH="$SHIM:$PATH"
}
migrate() { ( cd "$CONSUMER" && bash .claude/framework/update/migrate-v2.sh "$@" ); }

@test "U5: dry-run lists leftover CLAUDE.framework.md prose mentions with line numbers" {
  _build
  run migrate --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" == *"still mentions CLAUDE.framework.md"* ]]
  [[ "$output" == *"CLAUDE.md:5:Rules: see [the framework rules](CLAUDE.framework.md)."* ]]
  [[ "$output" == *"CLAUDE.md:7:Agents read CLAUDE.framework.md first."* ]]
  [[ "$output" != *"CLAUDE.md:3:"* ]]          # the bare import is the rewrite's job
  [ -z "$(git -C "$CONSUMER" status --porcelain)" ]
}

@test "U5: real run warns about the same lines after rewriting the import" {
  _build
  run migrate --yes
  [ "$status" -eq 0 ]
  [[ "$output" == *"commented out the @CLAUDE.framework.md import"* ]]
  [[ "$output" == *"CLAUDE.md:5:"* ]]
  [[ "$output" == *"CLAUDE.md:7:"* ]]
  [[ "$output" != *"CLAUDE.md:3:"* ]]          # now a retirement marker → skipped
  grep -q "retired by migrate-v2" "$CONSUMER/CLAUDE.md"
}

@test "U5: no warning when CLAUDE.md has only the import" {
  _build
  printf '# My project\n\n@CLAUDE.framework.md\n\nProject notes.\n' > "$CONSUMER/CLAUDE.md"
  git -C "$CONSUMER" commit -qam "import only"
  run migrate --dry-run
  [ "$status" -eq 0 ]
  [[ "$output" != *"still mentions"* ]]
}
