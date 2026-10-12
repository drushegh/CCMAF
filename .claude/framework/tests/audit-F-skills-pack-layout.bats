#!/usr/bin/env bats
# TASK-181 / audit U1: skills-sync.sh resolves BOTH upstream layouts —
#   flat:  <root>/<name>/SKILL.md                    (old upstreams, bundled skills/)
#   packs: <root>/plugins/<pack>/skills/<name>/SKILL.md  (CCMAF---Skills since TASK-180)
# and SKILLS_SECTIONS expands whole packs. Every case runs against BOTH copies
# (v1 bundled .claude/framework/update/ and the ccmaf plugin's update/) so the
# drift-unguarded core pair stays behaviourally identical. Fully offline.

load update_helpers

PLUGIN_SYNC="$FW_REPO_ROOT/plugins/ccmaf/update/skills-sync.sh"

# Pack-layout upstream: core pack {alpha, beta}, web pack {gamma}; alpha
# references gamma (companion). Also carries non-skill top-level dirs.
build_pack_upstream() {
  SKILLS_UPSTREAM="$BATS_TEST_TMPDIR/pack-upstream"
  local p
  mkdir -p "$SKILLS_UPSTREAM/plugins/ccmaf-skills-core/skills/alpha" \
           "$SKILLS_UPSTREAM/plugins/ccmaf-skills-core/skills/beta" \
           "$SKILLS_UPSTREAM/plugins/ccmaf-skills-web/skills/gamma" \
           "$SKILLS_UPSTREAM/scripts"
  _init_fixture_repo "$SKILLS_UPSTREAM"
  p="$SKILLS_UPSTREAM/plugins"
  printf -- '---\nname: alpha\n---\nalpha pack v1; styling routes to gamma.\n' > "$p/ccmaf-skills-core/skills/alpha/SKILL.md"
  printf 'alpha reference\n' > "$p/ccmaf-skills-core/skills/alpha/reference.md"
  printf -- '---\nname: beta\n---\nbeta pack v1\n' > "$p/ccmaf-skills-core/skills/beta/SKILL.md"
  printf -- '---\nname: gamma\n---\ngamma pack v1\n' > "$p/ccmaf-skills-web/skills/gamma/SKILL.md"
  printf '# pack\n' > "$p/ccmaf-skills-core/README.md"
  printf 'echo build\n' > "$SKILLS_UPSTREAM/scripts/build.sh"
  git -C "$SKILLS_UPSTREAM" add -A
  git -C "$SKILLS_UPSTREAM" commit -qm "pack layout v1"
  SKILLS_UPSTREAM_SHA=$(git -C "$SKILLS_UPSTREAM" rev-parse HEAD)
}

# <copy: v1|plugin> [args...] — run the chosen copy inside the consumer.
sync_copy() {
  local copy="$1"; shift
  if [ "$copy" = plugin ]; then
    ( cd "$SCONSUMER" && CLAUDE_PROJECT_DIR="$SCONSUMER" bash "$PLUGIN_SYNC" "$@" )
  else
    ( cd "$SCONSUMER" && bash .claude/framework/update/skills-sync.sh "$@" )
  fi
}

_pack_sync_selected() {
  build_pack_upstream
  build_skills_consumer "alpha gamma"
  run sync_copy "$1"
  [ "$status" -eq 0 ]
  grep -q "alpha pack v1" "$SCONSUMER/.claude/skills/alpha/SKILL.md"
  [ -f "$SCONSUMER/.claude/skills/alpha/reference.md" ]
  grep -q "gamma pack v1" "$SCONSUMER/.claude/skills/gamma/SKILL.md"
  [ ! -e "$SCONSUMER/.claude/skills/beta" ]
  grep -q "^SKILLS_PINNED_SHA=$SKILLS_UPSTREAM_SHA" "$SVERSION"
}
@test "pack layout: selected skills resolve under plugins/*/skills/ (v1)"     { _pack_sync_selected v1; }
@test "pack layout: selected skills resolve under plugins/*/skills/ (plugin)" { _pack_sync_selected plugin; }

_non_skill_dir_not_resolved() {
  build_pack_upstream
  build_skills_consumer "plugins scripts"
  run sync_copy "$1"
  [ "$status" -eq 0 ]
  [[ "$output" == *"plugins: not in upstream"* ]]
  [[ "$output" == *"scripts: not in upstream"* ]]
  [ ! -e "$SCONSUMER/.claude/skills/plugins" ]
  [ ! -e "$SCONSUMER/.claude/skills/scripts" ]
  ! grep -q "^SKILLS_PINNED_SHA=$SKILLS_UPSTREAM_SHA" "$SVERSION"
}
@test "pack layout: top-level non-skill dirs never resolve as skills (v1)"     { _non_skill_dir_not_resolved v1; }
@test "pack layout: top-level non-skill dirs never resolve as skills (plugin)" { _non_skill_dir_not_resolved plugin; }

_flat_still_works() {
  build_skills_upstream            # flat python/ rust/
  build_skills_consumer "python"
  run sync_copy "$1"
  [ "$status" -eq 0 ]
  grep -q "python skill v1" "$SCONSUMER/.claude/skills/python/SKILL.md"
  run sync_copy "$1" --list
  [ "$status" -eq 0 ]
  [[ "$output" == *"python"* ]]
  [[ "$output" == *"rust"* ]]
}
@test "flat layout: still syncs and lists (v1)"     { _flat_still_works v1; }
@test "flat layout: still syncs and lists (plugin)" { _flat_still_works plugin; }

_list_pack() {
  build_pack_upstream
  build_skills_consumer "alpha"
  run sync_copy "$1" --list
  [ "$status" -eq 0 ]
  local names
  names=$(sync_copy "$1" --list 2>/dev/null)
  [ "$names" = "$(printf 'alpha\nbeta\ngamma')" ]
}
@test "--list: enumerates pack-layout skills only, no plugins/scripts noise (v1)"     { _list_pack v1; }
@test "--list: enumerates pack-layout skills only, no plugins/scripts noise (plugin)" { _list_pack plugin; }

_companion_pack() {
  build_pack_upstream
  build_skills_consumer "alpha"
  run sync_copy "$1"
  [ "$status" -eq 0 ]
  [[ "$output" == *"companion skills not in SKILLS_SELECTED"* ]]
  [[ "$output" == *"gamma"* ]]
}
@test "companion advisory: sees pack-layout siblings (v1)"     { _companion_pack v1; }
@test "companion advisory: sees pack-layout siblings (plugin)" { _companion_pack plugin; }

_sections() {
  build_pack_upstream
  build_skills_consumer
  set_skills_field SKILLS_SELECTED ""      # packs only — no individual names
  printf 'SKILLS_SECTIONS="core, ccmaf-skills-web"\n' >> "$SVERSION"
  run sync_copy "$1"
  [ "$status" -eq 0 ]
  [ -f "$SCONSUMER/.claude/skills/alpha/SKILL.md" ]
  [ -f "$SCONSUMER/.claude/skills/beta/SKILL.md" ]
  [ -f "$SCONSUMER/.claude/skills/gamma/SKILL.md" ]
  grep -q "^SKILLS_PINNED_SHA=$SKILLS_UPSTREAM_SHA" "$SVERSION"
  # Everything is selected via packs → no companion nag.
  [[ "$output" != *"companion skills"* ]]
}
@test "SKILLS_SECTIONS: short and full pack ids expand to every skill in the pack (v1)"     { _sections v1; }
@test "SKILLS_SECTIONS: short and full pack ids expand to every skill in the pack (plugin)" { _sections plugin; }

_sections_unknown() {
  build_pack_upstream
  build_skills_consumer "beta"
  printf 'SKILLS_SECTIONS="nope ../core"\n' >> "$SVERSION"
  run sync_copy "$1"
  [ "$status" -eq 0 ]
  [[ "$output" == *"section nope: no such pack upstream"* ]]
  [[ "$output" == *"SKIP section '../core'"* ]]
  [ -f "$SCONSUMER/.claude/skills/beta/SKILL.md" ]
  [ ! -e "$SCONSUMER/.claude/skills/alpha" ]
  ! grep -q "^SKILLS_PINNED_SHA=$SKILLS_UPSTREAM_SHA" "$SVERSION"   # pin held
}
@test "SKILLS_SECTIONS: unknown pack warns + holds pin; path-like id rejected (v1)"     { _sections_unknown v1; }
@test "SKILLS_SECTIONS: unknown pack warns + holds pin; path-like id rejected (plugin)" { _sections_unknown plugin; }

_flat_wins() {
  build_pack_upstream
  mkdir -p "$SKILLS_UPSTREAM/alpha"
  printf -- '---\nname: alpha\n---\nalpha FLAT\n' > "$SKILLS_UPSTREAM/alpha/SKILL.md"
  git -C "$SKILLS_UPSTREAM" add -A
  git -C "$SKILLS_UPSTREAM" commit -qm "flat alpha too"
  build_skills_consumer "alpha"
  run sync_copy "$1"
  [ "$status" -eq 0 ]
  grep -q "alpha FLAT" "$SCONSUMER/.claude/skills/alpha/SKILL.md"
}
@test "resolution order: flat <root>/<name> wins over the pack copy (v1)"     { _flat_wins v1; }
@test "resolution order: flat <root>/<name> wins over the pack copy (plugin)" { _flat_wins plugin; }
