#!/usr/bin/env bats
# Audit U8: init-framework-version.sh must exit 0 on success — including a
# re-run where every ephemera entry is already in .gitignore (added=0), the
# case a trailing `[ "$added" -gt 0 ] && echo …` used to turn into exit 1.

load update_helpers

_init_consumer() {
  build_upstream
  IC="$BATS_TEST_TMPDIR/init-consumer"
  mkdir -p "$IC/.claude/framework/update"
  cp "$UPDATE_SRC/init-framework-version.sh" "$IC/.claude/framework/update/"
}
init_fv() { ( cd "$IC" && bash .claude/framework/update/init-framework-version.sh --url "$UPSTREAM" --branch main "$@" ); }

@test "U8: first run exits 0 and writes the pin + ephemera" {
  _init_consumer
  run init_fv
  [ "$status" -eq 0 ]
  grep -q "^FRAMEWORK_PINNED_SHA=$UPSTREAM_V2_SHA" "$IC/.claude/.framework-version"
  [[ "$output" == *"added"*"ephemera"* ]]
}

@test "U8: --force re-run with all ephemera already ignored (added=0) still exits 0" {
  _init_consumer
  run init_fv
  [ "$status" -eq 0 ]
  run init_fv --force
  [ "$status" -eq 0 ]
  [[ "$output" != *"ephemera entr"* ]]
}

@test "U8: no top-level '[ … ] && …' short-circuit left in the script" {
  run grep -nE '^\[ .* \] && ' "$UPDATE_SRC/init-framework-version.sh"
  [ "$status" -eq 1 ]                 # grep: no match
}
