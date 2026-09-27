#!/usr/bin/env bats
# fix-U42.bats — skills-check default-mode polling + gitignored throttle
# (deep-review U42), for BOTH the v1 copy and the v2 plugin twin. Offline:
# the "default" catalogue is redirected to a local fixture upstream via
# SKILLS_DEFAULT_UPSTREAM_URL.

load update_helpers

PLUGIN_SC="$BATS_TEST_DIRNAME/../../../plugins/ccmaf/update/skills-check.sh"

_default_mode_consumer() {
  build_skills_upstream
  build_skills_consumer "python"
  printf 'SKILLS_SELECTED="python"\n' > "$SVERSION"   # no URL, no bundle = DEFAULT mode
  export SKILLS_DEFAULT_UPSTREAM_URL="$SKILLS_UPSTREAM"
}

@test "U42 v1: default mode (no URL, no bundle) polls the default upstream and flags" {
  _default_mode_consumer
  run skills_check
  [ "$status" -eq 0 ]
  [ -f "$(SFLAG)" ]
  grep -q "Skills Update Available" "$(SFLAG)"
}

@test "U42 v1: default mode up to date clears the flag" {
  _default_mode_consumer
  echo "stale" > "$(SFLAG)"
  echo "SKILLS_PINNED_SHA=$SKILLS_UPSTREAM_SHA" >> "$SVERSION"
  run skills_check
  [ "$status" -eq 0 ]
  [ ! -f "$(SFLAG)" ]
}

@test "U42 v1: a live check never rewrites the committed .skills-version" {
  _default_mode_consumer
  before="$(cat "$SVERSION")"
  run skills_check
  [ "$status" -eq 0 ]
  [ "$(cat "$SVERSION")" = "$before" ]
  [ -f "$SCONSUMER/.claude/telemetry/.last-skills-check" ]
}

@test "U42 v1: the telemetry marker throttles the next run" {
  _default_mode_consumer
  mkdir -p "$SCONSUMER/.claude/telemetry"
  touch "$SCONSUMER/.claude/telemetry/.last-skills-check"
  export SKILLS_DEFAULT_UPSTREAM_URL="$BATS_TEST_TMPDIR/does-not-exist"
  run skills_check
  [ "$status" -eq 0 ]          # throttled: never reached the (dead) remote
  [ ! -f "$(SFLAG)" ]
}

@test "U42 v1: bundle mode stays silent" {
  _default_mode_consumer
  mkdir -p "$SCONSUMER/skills/python"
  printf 'x\n' > "$SCONSUMER/skills/python/SKILL.md"
  run skills_check
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ ! -f "$(SFLAG)" ]
}

@test "U42 plugin: default mode polls, flags, and leaves .skills-version untouched" {
  _default_mode_consumer
  before="$(cat "$SVERSION")"
  run env CLAUDE_PROJECT_DIR="$SCONSUMER" bash "$PLUGIN_SC"
  [ "$status" -eq 0 ]
  [ -f "$(SFLAG)" ]
  [ "$(cat "$SVERSION")" = "$before" ]
  [ -f "$SCONSUMER/.claude/telemetry/.last-skills-check" ]
}

@test "U42 plugin: run_tmo is defined and bounds the ls-remote" {
  grep -q '^run_tmo()' "$PLUGIN_SC"
  grep -q 'run_tmo 10 git ls-remote' "$PLUGIN_SC"
  ! grep -qE '\$\(timeout 10' "$PLUGIN_SC" || false
}
