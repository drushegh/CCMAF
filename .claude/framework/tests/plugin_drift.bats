#!/usr/bin/env bats
# Normalized-diff drift guards for the interim dual-copy window (TASK-170).
#
# Until v2.0, the five capability plugins (advisors/council/media/devhooks/
# console) coexist with their bundled .claude/ (and tools/console.*)
# originals — see docs/tiering/DESIGN.md "Interim dual-copy rule" and
# docs/tiering/CORE-DESIGN.md §10. plugins/PAIRS.md is the machine-readable
# manifest of every such pair and the mode (identical/normalized/diverged)
# it's guarded at; this file reads that manifest and enforces it, plus a
# completeness meta-test so the manifest can't rot silently.

load helpers

PLUGINS_DIR="$FW_REPO_ROOT/plugins"
PAIRS_MD="$PLUGINS_DIR/PAIRS.md"

# The five extracted capability plugins TASK-170 scopes (per the board entry
# and DESIGN.md's dual-copy rule). Deliberately NOT a `plugins/*/` glob:
# `ccmaf-kernel` has its own byte-identical guard in kernel_plugin.bats
# already; `ccmaf` (core, TASK-171) is a heavily-diverged-by-design v2
# rebuild still mid-flight — CORE-DESIGN.md §10 frames folding its pairs in
# here as a later extension of this same guard, once core ships, not part
# of this build.
CAPABILITY_PLUGINS="advisors council media devhooks console"

setup() {
  # Same skip idiom as plugins_structure.bats / kernel_plugin.bats: the
  # tests/ dir-mirror ships to every consumer via framework-manifest.txt,
  # but plugins/ is publish-manifest-only (this dev repo + the public
  # canonical repo). Key the skip on the kernel's manifest so a consumer
  # repo's own unrelated plugins/ tree can't false-un-skip us.
  [ -f "$PLUGINS_DIR/ccmaf-kernel/.claude-plugin/plugin.json" ] \
    || skip "CCMAF plugin family not present (consumer checkout)"
  [ -f "$PAIRS_MD" ] || skip "plugins/PAIRS.md not present"
}

# --- PAIRS.md parsing helpers -----------------------------------------------

# Every data row starts with "plugins/" in column 1 (no leading pipe) — this
# lets header prose, the two `plugin-path | bundled-path | mode | note`
# header lines, and the `--- | --- | --- | ---` separator rows all coexist
# in the same file without a special comment-marker convention.
_trim() { local s="$1"; s="${s#"${s%%[![:space:]]*}"}"; s="${s%"${s##*[![:space:]]}"}"; printf '%s' "$s"; }

# pairs_for_mode <mode> — prints "plugin-path<TAB>bundled-path" per matching row.
pairs_for_mode() {
  local want="$1" line p b m
  while IFS='|' read -r p b m _rest; do
    p="$(_trim "$p")"; b="$(_trim "$b")"; m="$(_trim "$m")"
    [ "$m" = "$want" ] || continue
    printf '%s\t%s\n' "$p" "$b"
  done < <(grep '^plugins/' "$PAIRS_MD")
}

# strip_adaptations <file> — the ONE shared normalized-mode filter: drop
# lines naming the plugin root, a v2-adaptation marker, or a shellcheck
# source directive, plus blank lines. CRLF-tolerant (Windows checkouts).
strip_adaptations() {
  tr -d '\r' < "$1" \
    | grep -v '\${CLAUDE_PLUGIN_ROOT}' \
    | grep -v '# v2 adaptation' \
    | grep -v '# shellcheck source=' \
    | grep -v '^[[:space:]]*$'
}

# --- mode enforcement --------------------------------------------------------

@test "plugin drift: PAIRS.md mode column uses only known values" {
  local bad
  bad="$(grep '^plugins/' "$PAIRS_MD" | awk -F'|' '{print $3}' \
        | sed -E 's/^[[:space:]]+|[[:space:]]+$//g' \
        | grep -vE '^(identical|normalized|diverged)$' || true)"
  [ -z "$bad" ]
}

@test "plugin drift: identical-mode pairs are byte-identical" {
  local p b
  while IFS=$'\t' read -r p b; do
    [ -n "$p" ] || continue
    run cmp -s "$FW_REPO_ROOT/$p" "$FW_REPO_ROOT/$b"
    [ "$status" -eq 0 ]
  done < <(pairs_for_mode identical)
}

@test "plugin drift: normalized-mode pairs match after stripping documented adaptation lines" {
  local p b
  while IFS=$'\t' read -r p b; do
    [ -n "$p" ] || continue
    run diff <(strip_adaptations "$FW_REPO_ROOT/$p") <(strip_adaptations "$FW_REPO_ROOT/$b")
    [ "$status" -eq 0 ]
  done < <(pairs_for_mode normalized)
}

@test "plugin drift: diverged-mode pairs both still exist (no silent delete/rename)" {
  local p b
  while IFS=$'\t' read -r p b; do
    [ -n "$p" ] || continue
    [ -f "$FW_REPO_ROOT/$p" ]
    [ -f "$FW_REPO_ROOT/$b" ]
  done < <(pairs_for_mode diverged)
}

# --- completeness meta-test --------------------------------------------------

@test "plugin drift: no unlisted twins — every plugin file with a same-basename .claude/ counterpart is in PAIRS.md" {
  local listed f bn rel
  listed="$(grep '^plugins/' "$PAIRS_MD" | awk -F'|' '{print $1}' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
  while IFS= read -r f; do
    bn="$(basename "$f")"
    # Scope matches the manifest note: only .claude/ counterparts are
    # required to be listed here (plugin twins outside .claude/, e.g. the
    # console driver's tools/console.* originals, are still listed above,
    # but this mechanical check can't discover those non-.claude/ twins by
    # basename alone without false-positiving on unrelated same-named
    # files elsewhere in the repo).
    find "$FW_REPO_ROOT/.claude" -type f -name "$bn" 2>/dev/null | grep -q . || continue
    rel="${f#"$FW_REPO_ROOT"/}"
    echo "$listed" | grep -Fxq "$rel"
  done < <(
    for name in $CAPABILITY_PLUGINS; do
      for d in hooks scripts commands agents; do
        [ -d "$PLUGINS_DIR/$name/$d" ] && find "$PLUGINS_DIR/$name/$d" -type f
      done
    done
  )
}
