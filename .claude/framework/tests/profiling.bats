#!/usr/bin/env bats
# profile-hooks.sh tests (TASK-136 / OPT P0). ROOT resolves from cwd, so these
# run hermetically inside the throwaway repo.
load helpers

setup() { init_repo; }

profhooks() { ( cd "$REPO" && bash "$FW_REPO_ROOT/.claude/framework/telemetry/profile-hooks.sh" "$@" ); }

@test "profile-hooks report: no telemetry → exit 0 with a message" {
  run profhooks report
  [ "$status" -eq 0 ]
  [[ "$output" == *"no telemetry"* ]]
}

@test "profile-hooks report: aggregates skip counts from events.jsonl" {
  ev="$REPO/.claude/telemetry/events.jsonl"
  printf '%s\n' \
    '{"hook":"lint","outcome":"noop","outcome_class":"skipped"}' \
    '{"hook":"lint","outcome":"noop","outcome_class":"skipped"}' \
    '{"hook":"format","outcome":"ran","outcome_class":"ran"}' > "$ev"
  run profhooks report
  [ "$status" -eq 0 ]
  [[ "$output" == *"lint"* ]]
  [[ "$output" == *"100%"* ]]
}

@test "profile-hooks bench: missing args → exit 2" {
  run profhooks bench
  [ "$status" -eq 2 ]
}
