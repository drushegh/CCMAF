#!/usr/bin/env bats
# skills-check.sh tests (TASK-043): does a project's selected skills lag the
# upstream? Mirrors check-updates.sh semantics; same local-dir-upstream
# fixtures as the rest of the update-system tier. Fully offline.

load update_helpers

# build_skills_consumer pins SKILLS_PINNED_SHA="" (unsynced) by default, so
# the consumer is "behind" the synthetic upstream out of the box.

@test "skills-check: behind upstream → writes update-available flag" {
  build_skills_upstream
  build_skills_consumer "python"
  run skills_check
  [ "$status" -eq 0 ]
  [ -f "$(SFLAG)" ]
  grep -q "Skills Update Available" "$(SFLAG)"
  grep -q "skills-sync.sh" "$(SFLAG)"
  grep -q "python" "$(SFLAG)"
}

@test "skills-check: up-to-date → clears stale flag, exit 0" {
  build_skills_upstream
  build_skills_consumer "python"
  echo "stale flag" > "$(SFLAG)"
  set_skills_pin "$SKILLS_UPSTREAM_SHA"
  run skills_check
  [ "$status" -eq 0 ]
  [ ! -f "$(SFLAG)" ]
}

@test "skills-check: pending flag survives a throttled run (DA-C4)" {
  build_skills_upstream
  build_skills_consumer "python"
  echo "PENDING-MARKER" > "$(SFLAG)"
  set_skills_field SKILLS_LAST_CHECKED "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  run skills_check
  [ "$status" -eq 0 ]
  grep -q "PENDING-MARKER" "$(SFLAG)"
}

@test "skills-check: pending flag survives a network failure (DA-C4)" {
  build_skills_upstream
  build_skills_consumer "python"
  echo "PENDING-MARKER-2" > "$(SFLAG)"
  set_skills_field SKILLS_UPSTREAM_URL "$BATS_TEST_TMPDIR/does-not-exist"
  run skills_check
  [ "$status" -eq 3 ]
  grep -q "PENDING-MARKER-2" "$(SFLAG)"
}

@test "skills-check: no .skills-version, no detectable stack → silent exit 0" {
  build_skills_upstream
  build_skills_consumer "python"
  rm "$SVERSION"
  run skills_check
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ ! -f "$(SFLAG)" ]
  [ ! -f "$SCONSUMER/.claude/.skills-suggestion.md" ]
}

# --- Non-adopter discovery (TASK-044, contract:skills-sync) ------------

@test "skills-check: discovery — detectable stack, no .skills-version → suggestion flag" {
  build_skills_upstream
  build_skills_consumer "python"
  rm "$SVERSION"
  touch "$SCONSUMER/pyproject.toml"
  run skills_check
  [ "$status" -eq 0 ]
  FLAG="$SCONSUMER/.claude/.skills-suggestion.md"
  [ -f "$FLAG" ]
  grep -q "python-development" "$FLAG"
  grep -q ".skills-version" "$FLAG"
  grep -q ".skills-declined" "$FLAG"
  [[ "$output" == *"matches available skills"* ]]
  # Throttle marker laid down for the re-suggest interval.
  [ -f "$SCONSUMER/.claude/telemetry/.last-skills-suggest" ]
}

@test "skills-check: discovery — .skills-declined → permanently silent" {
  build_skills_upstream
  build_skills_consumer "python"
  rm "$SVERSION"
  touch "$SCONSUMER/pyproject.toml"
  touch "$SCONSUMER/.claude/.skills-declined"
  run skills_check
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ ! -f "$SCONSUMER/.claude/.skills-suggestion.md" ]
}

@test "skills-check: discovery — recent throttle marker → silent, no flag" {
  build_skills_upstream
  build_skills_consumer "python"
  rm "$SVERSION"
  touch "$SCONSUMER/pyproject.toml"
  mkdir -p "$SCONSUMER/.claude/telemetry"
  touch "$SCONSUMER/.claude/telemetry/.last-skills-suggest"
  run skills_check
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ ! -f "$SCONSUMER/.claude/.skills-suggestion.md" ]
}

@test "skills-check: discovery — pending suggestion flag is not rewritten (DA-C4)" {
  build_skills_upstream
  build_skills_consumer "python"
  rm "$SVERSION"
  touch "$SCONSUMER/pyproject.toml"
  echo "PENDING-SUGGESTION" > "$SCONSUMER/.claude/.skills-suggestion.md"
  run skills_check
  [ "$status" -eq 0 ]
  grep -q "PENDING-SUGGESTION" "$SCONSUMER/.claude/.skills-suggestion.md"
}

@test "skills-check: no URL, no bundle (default public mode) is SILENT, exit 0" {
  build_skills_upstream
  build_skills_consumer "python"
  # No URL and no vendored skills/ is DEFAULT mode now (skills-sync pulls from the
  # public catalogue). skills-check has no pinned remote to poll here → silent, exit 0.
  printf 'SKILLS_SELECTED="python"\n' > "$SVERSION"
  run skills_check
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "skills-check: bundle mode (no URL, bundled skills/ present) is SILENT, exit 0 (Phase-B)" {
  build_skills_upstream
  build_skills_consumer "python"
  # Bundle mode: URL-less .skills-version + an in-repo bundled catalogue. This is
  # the exact shape the suggestion flag tells users to create — it must NOT be
  # treated as malformed, and there is no remote to poll → silent.
  mkdir -p "$SCONSUMER/skills/python"
  printf 'x\n' > "$SCONSUMER/skills/python/SKILL.md"
  printf 'SKILLS_SELECTED="python"\n' > "$SVERSION"
  run skills_check
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ ! -f "$(SFLAG)" ]
}

@test "skills-check: bundle mode clears a STALE flag left over from clone mode (Phase-B)" {
  build_skills_upstream
  build_skills_consumer "python"
  # A prior clone-mode config left a pending update flag; switching to bundle
  # mode must not leave it lingering forever — the bundle-mode early exit
  # returns before the normal clear-on-up-to-date path, so it needs its own clear.
  echo "stale flag from clone mode" > "$(SFLAG)"
  mkdir -p "$SCONSUMER/skills/python"
  printf 'x\n' > "$SCONSUMER/skills/python/SKILL.md"
  printf 'SKILLS_SELECTED="python"\n' > "$SVERSION"
  run skills_check
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ ! -f "$(SFLAG)" ]
}

@test "skills-check: live up-to-date run bumps SKILLS_LAST_CHECKED" {
  build_skills_upstream
  build_skills_consumer "python"
  set_skills_pin "$SKILLS_UPSTREAM_SHA"
  run skills_check
  [ "$status" -eq 0 ]
  grep -q "^SKILLS_LAST_CHECKED=" "$SVERSION"
  ! grep -q "1970-01-01" "$SVERSION"
}
