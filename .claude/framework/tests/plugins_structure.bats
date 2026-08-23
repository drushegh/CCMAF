#!/usr/bin/env bats
# Structural tests for the v2 plugin family (TASK-163..165/168/169).
# Every plugin: valid manifests, syntax-clean scripts, marketplace listed.
# Cross-plugin drift guards: the deliberately duplicated libs must stay
# byte-identical between their plugin copies.

load helpers

PLUGINS_DIR="$FW_REPO_ROOT/plugins"

setup() {
  # The tests/ dir-mirror ships to consumer projects, which do NOT carry the
  # plugin family (publish-manifest-only). Key the skip on the kernel's own
  # plugin manifest — a bare `plugins/` dir-name test would false-un-skip on
  # any consumer repo with its own plugins/ tree. (NOT keyed on
  # .claude/.framework-dev-repo: the public CCMAF repo ships plugins/ + tests
  # but not the dev marker, and the tests must still run there.)
  [ -f "$PLUGINS_DIR/ccmaf-kernel/.claude-plugin/plugin.json" ] \
    || skip "CCMAF plugin family not present (consumer checkout)"
}

@test "plugins: every plugin has a valid plugin.json with a name" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  local p
  for p in "$PLUGINS_DIR"/*/; do
    run jq -er '.name' "$p/.claude-plugin/plugin.json"
    [ "$status" -eq 0 ]
  done
}

@test "plugins: marketplace.json is valid and lists every plugin dir" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  local mp="$FW_REPO_ROOT/.claude-plugin/marketplace.json"
  run jq -er '.name' "$mp"
  [ "$status" -eq 0 ]
  local p name src
  for p in "$PLUGINS_DIR"/*/; do
    name="$(jq -r '.name' "$p/.claude-plugin/plugin.json")"
    # (v2.0, 2026-08-21: the core plugin's UNRELEASED exception is gone —
    # every plugin dir, core included, must be marketplace-listed.)
    run jq -e --arg n "$name" '.plugins[] | select(.name == $n)' "$mp"
    [ "$status" -eq 0 ]
  done
  # Reverse direction: every marketplace entry's .source must resolve to an
  # existing plugin dir whose plugin.json name matches — a rename/delete
  # that leaves a stale entry must go red, not ship a dangling pointer.
  while IFS=$'\t' read -r name src; do
    src="${src%$'\r'}"  # git-bash jq emits CRLF on -r, and `read` keeps the \r
    [ -d "$FW_REPO_ROOT/${src#./}" ]
    [ "$(jq -r '.name' "$FW_REPO_ROOT/${src#./}/.claude-plugin/plugin.json")" = "$name" ]
  done < <(jq -r '.plugins[] | [.name, .source] | @tsv' "$mp")
}

@test "plugins: every hooks.json is valid JSON and its script paths exist" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  local h ref
  for h in "$PLUGINS_DIR"/*/hooks/hooks.json; do
    [ -f "$h" ] || continue
    run jq -e '.hooks' "$h"
    [ "$status" -eq 0 ]
    # Every ${CLAUDE_PLUGIN_ROOT}-anchored script a command string references
    # must exist inside the plugin — a typo'd/moved path passes jq but dies
    # silently in a consumer session running from the plugin cache.
    while IFS= read -r ref; do
      [ -f "${h%/hooks/hooks.json}${ref#\$\{CLAUDE_PLUGIN_ROOT\}}" ]
    done < <(jq -r '.. | .command? // empty' "$h" \
             | grep -o '\${CLAUDE_PLUGIN_ROOT}[^"]*\.sh')
  done
}

@test "plugins: every shell script passes bash -n" {
  local s
  while IFS= read -r s; do
    run bash -n "$s"
    [ "$status" -eq 0 ]
  done < <(find "$PLUGINS_DIR" -name '*.sh')
}

@test "plugins drift-guard: media's advisors-lib == advisors' advisors-lib" {
  cmp "$PLUGINS_DIR/advisors/scripts/advisors-lib.sh" \
      "$PLUGINS_DIR/media/scripts/advisors-lib.sh"
}

@test "plugins drift-guard: media's codex-preflight == advisors' codex-preflight (modulo shellcheck directive)" {
  diff <(grep -v '^# shellcheck source=' "$PLUGINS_DIR/advisors/scripts/codex-preflight.sh") \
       <(grep -v '^# shellcheck source=' "$PLUGINS_DIR/media/scripts/codex-preflight.sh")
}

@test "plugins drift-guard: console's hook-common == devhooks' hook-common" {
  cmp "$PLUGINS_DIR/devhooks/hooks/lib/hook-common.sh" \
      "$PLUGINS_DIR/console/hooks/lib/hook-common.sh"
}

@test "advisors rehome: bare dir resolves registry+marker to ~/.claude, root to pwd" {
  BARE="$BATS_TEST_TMPDIR/bare-adv"
  mkdir -p "$BARE"
  # Isolate from any enclosing repo: without a ceiling, a BATS_TEST_TMPDIR
  # inside a git checkout would make the lib's rev-parse resolve THAT repo
  # instead of exercising the non-git pwd fallback under test.
  export GIT_CEILING_DIRECTORIES="$BATS_TEST_TMPDIR"
  unset GIT_DIR
  run bash -c "cd '$BARE' && source '$PLUGINS_DIR/advisors/scripts/advisors-lib.sh' && advisors_registry_path && advisors_optout_marker && advisors_repo_root"
  [ "$status" -eq 0 ]
  [[ "$output" == *"$HOME/.claude/advisors.toml"* ]]
  [[ "$output" == *"$HOME/.claude/.codex-training-optout-confirmed"* ]]
  [[ "$output" == *"bare-adv"* ]]
}

@test "advisors rehome: project registry overrides user-level" {
  init_repo
  mkdir -p "$REPO/.claude"
  printf '[advisors.test]\nprovider = "codex"\n' > "$REPO/.claude/advisors.toml"
  run bash -c "cd '$REPO' && source '$PLUGINS_DIR/advisors/scripts/advisors-lib.sh' && advisors_registry_path"
  [ "$status" -eq 0 ]
  [[ "$output" == *"/repo/.claude/advisors.toml" ]]
}

@test "devhooks: gated hook-common never creates .claude in a bare repo" {
  BARE="$BATS_TEST_TMPDIR/bare-dh"
  mkdir -p "$BARE"
  git -C "$BARE" init -q
  run bash -c "cd '$BARE' && source '$PLUGINS_DIR/devhooks/hooks/lib/hook-common.sh' && telemetry_emit '$BARE' test-hook ok ok"
  [ "$status" -eq 0 ]
  [ ! -d "$BARE/.claude" ]
}

@test "devhooks + console hooks.json gates are CONTENT-aware, never presence-only (BUG-030)" {
  # A presence-only gate ([ -f .framework-version ] || run) defers in MIGRATED
  # v2 consumers too — they keep the file, now carrying FRAMEWORK_LINE=v2, and
  # migrate-v2 has deleted the bundled copies the deferral assumed. Shipped
  # broken once (babynamey 2026-08-22): devhooks + console silently dead in
  # every migrated project. Every hooks.json command that checks the file's
  # PRESENCE must also check its CONTENT for the v2 line.
  for p in devhooks console; do
    jq -r '.. | .command? // empty' "$PLUGINS_DIR/$p/hooks/hooks.json" | while IFS= read -r cmd; do
      case "$cmd" in
        *".framework-version"*)
          case "$cmd" in
            *"FRAMEWORK_LINE=v2"*) : ;;
            *) echo "presence-only gate in $p hooks.json: $cmd"; exit 1 ;;
          esac ;;
      esac
    done
  done
}
