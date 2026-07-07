#!/usr/bin/env bats
# skills-sync.sh tests (TASK-036): selective sync from a synthetic local-path
# skills upstream (see update_helpers.bash — same technique as the
# update-system tier). Fully offline; everything lives in $BATS_TEST_TMPDIR.

load update_helpers

@test "skills-sync: selected skill synced with its reference files, pin rewritten" {
  build_skills_upstream
  build_skills_consumer "python"
  run skills_sync
  [ "$status" -eq 0 ]
  grep -q "python skill v1" "$SCONSUMER/.claude/skills/python/SKILL.md"
  [ -f "$SCONSUMER/.claude/skills/python/reference.md" ]
  grep -q "^SKILLS_PINNED_SHA=$SKILLS_UPSTREAM_SHA" "$SVERSION"
}

@test "skills-sync: unselected upstream skill is NOT copied" {
  build_skills_upstream
  build_skills_consumer "python"
  run skills_sync
  [ "$status" -eq 0 ]
  [ ! -e "$SCONSUMER/.claude/skills/rust" ]
}

@test "skills-sync: consumer-local skill dir is never touched" {
  build_skills_upstream
  build_skills_consumer "python"
  mkdir -p "$SCONSUMER/.claude/skills/my-local-skill"
  echo "local content" > "$SCONSUMER/.claude/skills/my-local-skill/SKILL.md"
  run skills_sync
  [ "$status" -eq 0 ]
  grep -q "local content" "$SCONSUMER/.claude/skills/my-local-skill/SKILL.md"
}

@test "skills-sync: idempotent re-run before committing (identical untracked dir allowed)" {
  build_skills_upstream
  build_skills_consumer "python"
  run skills_sync
  [ "$status" -eq 0 ]
  run skills_sync
  [ "$status" -eq 0 ]
  [[ "$output" == *"python: synced"* ]]
}

@test "skills-sync: tracked skill with uncommitted edits is refused; others still sync (exit 1)" {
  build_skills_upstream
  build_skills_consumer "python rust"
  run skills_sync
  [ "$status" -eq 0 ]
  git -C "$SCONSUMER" add .claude/skills .claude/.skills-version
  git -C "$SCONSUMER" commit -qm "commit synced skills"
  echo "local tweak" >> "$SCONSUMER/.claude/skills/python/SKILL.md"
  run skills_sync
  [ "$status" -eq 1 ]
  [[ "$output" == *"python: REFUSED"* ]]
  [[ "$output" == *"rust: synced"* ]]
  grep -q "local tweak" "$SCONSUMER/.claude/skills/python/SKILL.md"
}

@test "skills-sync: uncommitted previous sync that differs from incoming is refused" {
  build_skills_upstream
  build_skills_consumer "python"
  run skills_sync
  [ "$status" -eq 0 ]
  # Skill dir is untracked (not committed) — local edit makes it differ.
  echo "uncommitted local edit" >> "$SCONSUMER/.claude/skills/python/SKILL.md"
  run skills_sync
  [ "$status" -eq 1 ]
  [[ "$output" == *"REFUSED"* ]]
  grep -q "uncommitted local edit" "$SCONSUMER/.claude/skills/python/SKILL.md"
}

@test "skills-sync: selected skill missing upstream → warn + skip, exit 0 (empty-repo case)" {
  build_skills_upstream
  build_skills_consumer "nextjs"
  run skills_sync
  [ "$status" -eq 0 ]
  [[ "$output" == *"nextjs: not in upstream yet"* ]]
  [ ! -e "$SCONSUMER/.claude/skills/nextjs" ]
}

@test "skills-sync: no .skills-version → setup template + exit 2" {
  build_skills_upstream
  build_skills_consumer "python"
  rm "$SVERSION"
  run skills_sync
  [ "$status" -eq 2 ]
  [[ "$output" == *"SKILLS_UPSTREAM_URL"* ]]
}

@test "skills-sync: unreachable upstream → exit 3, nothing changed" {
  build_skills_upstream
  build_skills_consumer "python"
  sed -i "s|^SKILLS_UPSTREAM_URL=.*|SKILLS_UPSTREAM_URL=$BATS_TEST_TMPDIR/nope|" "$SVERSION"
  run skills_sync
  [ "$status" -eq 3 ]
  [ ! -e "$SCONSUMER/.claude/skills/python" ]
}

@test "skills-sync: path-like skill name is rejected, not resolved" {
  build_skills_upstream
  build_skills_consumer "../evil"
  run skills_sync
  [ "$status" -eq 0 ]
  [[ "$output" == *"plain directory names"* ]]
  [ ! -e "$BATS_TEST_TMPDIR/evil" ]
}

@test "skills-sync: --suggest detects stack and respects SKILLS_SELECTED; never edits files" {
  build_skills_upstream
  build_skills_consumer "python"
  echo "[project]" > "$SCONSUMER/pyproject.toml"
  echo "{}" > "$SCONSUMER/package.json"
  before=$(cat "$SVERSION")
  run skills_sync --suggest
  [ "$status" -eq 0 ]
  [[ "$output" == *"python"* ]]
  [[ "$output" == *"typescript"* ]]
  [[ "$output" == *"not in SKILLS_SELECTED yet:"*"typescript"* ]]
  [ "$(cat "$SVERSION")" = "$before" ]
  [ ! -e "$SCONSUMER/.claude/skills/python" ]
}

@test "skills-sync: --suggest covers shell/engine/pipeline/MS-platform stacks (TASK-044 map)" {
  build_skills_upstream
  build_skills_consumer "python"
  touch "$SCONSUMER/deploy.sh" "$SCONSUMER/tools.ps1" "$SCONSUMER/project.godot" \
        "$SCONSUMER/azure.yaml" "$SCONSUMER/report.pbip"
  mkdir -p "$SCONSUMER/.github/workflows"
  touch "$SCONSUMER/.github/workflows/ci.yml"
  run skills_sync --suggest
  [ "$status" -eq 0 ]
  [[ "$output" == *"bash-development"* ]]
  [[ "$output" == *"powershell-development"* ]]
  [[ "$output" == *"godot-development"* ]]
  [[ "$output" == *"azure-development"* ]]
  [[ "$output" == *"devops-development"* ]]
  [[ "$output" == *"power-bi-development"* ]]
  # Cross-cutting skills mentioned but never stack-claimed.
  [[ "$output" == *"secure-development"* ]]
}

@test "skills-sync: --suggest does NOT count .claude/ framework scripts as a bash project" {
  build_skills_upstream
  build_skills_consumer "python"
  # Consumer fixture already carries .claude/framework/update/*.sh — that
  # alone must not suggest bash-development.
  run skills_sync --suggest
  [ "$status" -eq 0 ]
  [[ "$output" != *"bash-development"* ]]
}

@test "skills-sync: companion advisory lists referenced-but-unselected catalogue skills (TASK-044)" {
  # Upstream with -development names where alpha references beta.
  SKILLS_UPSTREAM="$BATS_TEST_TMPDIR/skills-upstream-comp"
  mkdir -p "$SKILLS_UPSTREAM/alpha-development" "$SKILLS_UPSTREAM/beta-development"
  _init_fixture_repo "$SKILLS_UPSTREAM"
  printf -- '---\nname: alpha-development\n---\nStyling concerns route to beta-development (sibling).\nNot-a-skill mention: gamma-development.\n' \
    > "$SKILLS_UPSTREAM/alpha-development/SKILL.md"
  printf -- '---\nname: beta-development\n---\nbeta skill v1\n' \
    > "$SKILLS_UPSTREAM/beta-development/SKILL.md"
  git -C "$SKILLS_UPSTREAM" add -A
  git -C "$SKILLS_UPSTREAM" commit -qm "companion fixture"
  build_skills_consumer "alpha-development"
  run skills_sync
  [ "$status" -eq 0 ]
  [[ "$output" == *"companion skills not in SKILLS_SELECTED"* ]]
  [[ "$output" == *"beta-development"* ]]
  # gamma-development isn't a real catalogue dir — must not be advertised.
  [[ "$output" != *"gamma-development"* ]]
}

@test "skills-sync: bundle mode (no upstream URL) sources in-repo skills/ and pins 'bundled' (Phase-B)" {
  build_skills_upstream
  build_skills_consumer "python"
  # Convert to bundle mode: drop the URL, add an in-repo bundled catalogue.
  mkdir -p "$SCONSUMER/skills/python"
  printf -- '---\nname: python\n---\nbundled python v1\n' > "$SCONSUMER/skills/python/SKILL.md"
  printf 'SKILLS_SELECTED="python"\n' > "$SVERSION"
  run skills_sync
  [ "$status" -eq 0 ]
  [[ "$output" == *"bundle mode"* ]]
  grep -q "bundled python v1" "$SCONSUMER/.claude/skills/python/SKILL.md"
  grep -q '^SKILLS_PINNED_SHA=bundled' "$SVERSION"
}

@test "skills-sync: clone mode wins even when a bundle also exists (Phase-B seam)" {
  build_skills_upstream
  build_skills_consumer "python"          # .skills-version HAS SKILLS_UPSTREAM_URL
  # A bundled skills/ is ALSO present, but the configured URL must win → real sha pin.
  mkdir -p "$SCONSUMER/skills/python"
  printf 'bundled (should NOT be used)\n' > "$SCONSUMER/skills/python/SKILL.md"
  run skills_sync
  [ "$status" -eq 0 ]
  grep -q "python skill v1" "$SCONSUMER/.claude/skills/python/SKILL.md"   # from the clone
  grep -q "^SKILLS_PINNED_SHA=$SKILLS_UPSTREAM_SHA" "$SVERSION"           # real sha, not "bundled"
}

@test "skills-sync: no URL, no bundle → DEFAULT mode syncs the (overridable) public catalogue (Phase-B)" {
  build_skills_upstream
  build_skills_consumer "python"
  printf 'SKILLS_SELECTED="python"\n' > "$SVERSION"   # no URL, and $SCONSUMER has no skills/
  export SKILLS_DEFAULT_UPSTREAM_URL="$SKILLS_UPSTREAM"   # point the public default at the fixture
  run skills_sync
  [ "$status" -eq 0 ]
  grep -q "python skill v1" "$SCONSUMER/.claude/skills/python/SKILL.md"   # default-mode clone
  grep -q "^SKILLS_PINNED_SHA=$SKILLS_UPSTREAM_SHA" "$SVERSION"           # real sha, not "bundled"
}

@test "skills-sync: --suggest detects containers/kubernetes/sql/CI (Phase-B map additions)" {
  build_skills_upstream
  build_skills_consumer "python"
  touch "$SCONSUMER/Dockerfile" "$SCONSUMER/Chart.yaml" "$SCONSUMER/schema.sql" "$SCONSUMER/Jenkinsfile"
  run skills_sync --suggest
  [ "$status" -eq 0 ]
  [[ "$output" == *"containers-development"* ]]
  [[ "$output" == *"kubernetes-development"* ]]
  [[ "$output" == *"sql-development"* ]]
  [[ "$output" == *"devops-development"* ]]
  # rtdd is now in the cross-cutting line.
  [[ "$output" == *"read-the-damn-docs"* ]]
}

@test "skills-sync: partial sync (one refused) does NOT advance the pin (Phase-B)" {
  build_skills_upstream
  build_skills_consumer "python rust"
  run skills_sync                                     # both sync, pin → v1 sha
  [ "$status" -eq 0 ]
  git -C "$SCONSUMER" add -A
  git -C "$SCONSUMER" commit -qm "committed synced skills + pin"
  # python now tracked+dirty → refused next sync.
  echo "local tweak" >> "$SCONSUMER/.claude/skills/python/SKILL.md"
  # Upstream advances so a CLEAN sync WOULD move the pin.
  printf 'rust v2\n' >> "$SKILLS_UPSTREAM/rust/SKILL.md"
  git -C "$SKILLS_UPSTREAM" add -A
  git -C "$SKILLS_UPSTREAM" commit -qm "rust v2"
  local new_sha
  new_sha=$(git -C "$SKILLS_UPSTREAM" rev-parse HEAD)
  run skills_sync
  [ "$status" -eq 1 ]
  [[ "$output" == *"python: REFUSED"* ]]
  [[ "$output" == *"rust: synced"* ]]
  # Pin must NOT have advanced to the new sha (a refused skill is behind).
  ! grep -q "^SKILLS_PINNED_SHA=$new_sha" "$SVERSION"
  grep -q "^SKILLS_PINNED_SHA=$SKILLS_UPSTREAM_SHA" "$SVERSION"
}

@test "skills-sync: backslash path-like skill name is rejected (Phase-B name guard)" {
  build_skills_upstream
  # No leading dot and no forward slash, so ONLY the backslash guard can catch it.
  build_skills_consumer 'sub\evil'
  run skills_sync
  [ "$status" -eq 0 ]
  [[ "$output" == *"plain directory names"* ]]
}

@test "skills-sync: no companion advisory when all referenced siblings are selected" {
  SKILLS_UPSTREAM="$BATS_TEST_TMPDIR/skills-upstream-comp2"
  mkdir -p "$SKILLS_UPSTREAM/alpha-development" "$SKILLS_UPSTREAM/beta-development"
  _init_fixture_repo "$SKILLS_UPSTREAM"
  printf -- '---\nname: alpha-development\n---\nRoutes to beta-development.\n' \
    > "$SKILLS_UPSTREAM/alpha-development/SKILL.md"
  printf -- '---\nname: beta-development\n---\nbeta skill v1\n' \
    > "$SKILLS_UPSTREAM/beta-development/SKILL.md"
  git -C "$SKILLS_UPSTREAM" add -A
  git -C "$SKILLS_UPSTREAM" commit -qm "companion fixture 2"
  build_skills_consumer "alpha-development beta-development"
  run skills_sync
  [ "$status" -eq 0 ]
  [[ "$output" != *"companion skills"* ]]
}
