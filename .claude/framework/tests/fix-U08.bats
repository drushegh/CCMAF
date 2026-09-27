#!/usr/bin/env bats
# U08 regression tests: pattern-scan always-exit-0, boot-view sub-heading leak,
# cold-start run_check script detection, codex runner status/backup/pin behaviour.
load helpers

setup() { init_repo; }

PS_V1() { ( cd "$REPO" && bash "$FW_REPO_ROOT/.claude/framework/audit/pattern-scan.sh" ); }
PS_PLUGIN() { ( cd "$REPO" && env -u CLAUDE_PLUGIN_ROOT bash "$FW_REPO_ROOT/plugins/ccmaf/audit/pattern-scan.sh" ); }

seed_correct_last_loop() {
  mkdir -p "$REPO/.claude/hooks"
  cat > "$REPO/.claude/hooks/x.sh" <<'EOF'
#!/bin/bash
while IFS= read -r line; do
  line="${line%$'\r'}"
  echo "$line"
done < "somefile"
EOF
}

@test "U08 pattern-scan (v1): exits 0 when the last scanned loop is correct" {
  seed_correct_last_loop
  run PS_V1
  [ "$status" -eq 0 ]
  [[ "$output" == *"0 finding(s)"* ]]
}

@test "U08 pattern-scan (plugin): exits 0 when the last scanned loop is correct" {
  seed_correct_last_loop
  run PS_PLUGIN
  [ "$status" -eq 0 ]
  [[ "$output" == *"0 finding(s)"* ]]
}

seed_subheading_board() {
  cat > "$REPO/.claude/TASKS.md" <<'EOF'
# Task Board
## Feature Lane
### In Progress
#### [TASK-100] active thing
work
#### Notes
active notes
### Done
#### [TASK-1] shipped thing
old
#### Retro
DONE-BODY-LEAK
## Bug-Fix Lane
### Reported
#### [BUG-9] a bug
z
EOF
}

@test "U08 boot-view (v1 + plugin): a #### sub-heading inside a Done entry does not leak" {
  seed_subheading_board
  for bv in .claude/framework/boot/boot-view.sh plugins/ccmaf/boot/boot-view.sh; do
    run bash -c "cd '$REPO' && CLAUDE_PROJECT_DIR='$REPO' bash '$FW_REPO_ROOT/$bv'"
    [ "$status" -eq 0 ]
    [[ "$output" != *"DONE-BODY-LEAK"* ]]
    [[ "$output" == *"active notes"* ]]   # a non-Done entry keeps its own sub-heading
    [[ "$output" == *"BUG-9"* ]]
  done
}

@test "U08 cold-start (v1): wrapped checks are run, not reported (missing)" {
  run grep -n '\[ -f "${2:-}" \]' "$FW_REPO_ROOT/.claude/framework/boot/cold-start.sh"
  [ "$status" -eq 0 ]
  run grep -nE '"\$rc" -ge 10' "$FW_REPO_ROOT/.claude/framework/boot/cold-start.sh"
  [ "$status" -ne 0 ]
}

# ---- codex runners, against a fake codex ----
seed_codex() {
  mkdir -p "$BATS_TEST_TMPDIR/bin" "$BATS_TEST_TMPDIR/codexhome"
  cat > "$BATS_TEST_TMPDIR/bin/codex" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then echo "codex-cli ${FAKE_VER:-0.144.1}"; exit 0; fi
out=""; model=""; cwd=""
while [[ $# -gt 0 ]]; do
  case "$1" in -o) out="$2"; shift;; -m) model="$2"; shift;; -C) cwd="$2"; shift;; esac; shift
done
prompt="$(cat)"
nonce="$(printf '%s\n' "$prompt" | grep -oE 'NONCE-[A-Za-z0-9]+' | head -1)"
[[ "${FAKE_FAIL:-0}" == 1 ]] && exit 7
mkdir -p "$CODEX_HOME/sessions/x"
printf '{"model":"%s","text":"%s"}\n' "$model" "$nonce" > "$CODEX_HOME/sessions/x/s.jsonl"
printf '%s\nanswer\n' "$nonce" > "$out"
if [[ -n "${FAKE_IMG:-}" ]]; then printf 'NEWPNG' > "$cwd/$FAKE_IMG"; fi
exit 0
EOF
  chmod +x "$BATS_TEST_TMPDIR/bin/codex"
  printf '{"tokens":{"access_token":"abc"}}\n' > "$BATS_TEST_TMPDIR/codexhome/auth.json"
  cat > "$REPO/.claude/advisors.toml" <<'EOF'
[providers.codex]
version_pin = "0.144.1"
timeout_min = 1
[advisors.sol]
provider = "codex"
model = "gpt-test"
effort = "high"
EOF
  touch "$REPO/.claude/.codex-training-optout-confirmed"
  mkdir -p "$REPO/_advisors/t1"; echo brief > "$REPO/_advisors/t1/conversation.md"
  export PATH="$BATS_TEST_TMPDIR/bin:$PATH" CODEX_HOME="$BATS_TEST_TMPDIR/codexhome"
  unset CODEX_BIN
}

@test "U08 codex-run (v1 + plugin): a failing run replaces a stale OK; no token home left in the repo" {
  seed_codex
  for r in .claude/framework/advisors/codex-run.sh plugins/advisors/scripts/codex-run.sh; do
    run bash -c "cd '$REPO' && bash '$FW_REPO_ROOT/$r' sol t1 NONCE-abc"
    [ "$status" -eq 0 ]
    grep -q '^OK' "$REPO/_advisors/t1/.run-sol/status"
    [ ! -e "$REPO/_advisors/t1/.run-sol/home" ]
    run bash -c "cd '$REPO' && FAKE_FAIL=1 bash '$FW_REPO_ROOT/$r' sol t1 NONCE-abc"
    [ "$status" -ne 0 ]
    ! grep -q '^OK' "$REPO/_advisors/t1/.run-sol/status" || false
  done
}

@test "U08 preflight (v1 + plugin): the pin is an exact semver match, not a substring" {
  seed_codex
  for p in .claude/framework/advisors/codex-preflight.sh plugins/advisors/scripts/codex-preflight.sh; do
    run bash -c "cd '$REPO' && bash '$FW_REPO_ROOT/$p'"
    [ "$status" -eq 0 ]
    run bash -c "cd '$REPO' && FAKE_VER=10.144.19 bash '$FW_REPO_ROOT/$p'"
    [ "$status" -eq 1 ]
  done
}

@test "U08 codex-image-run (v1 + media): an existing master survives a failed run" {
  seed_codex
  echo "a hero" > "$REPO/brief.txt"
  for r in .claude/framework/advisors/codex-image-run.sh plugins/media/scripts/codex-image-run.sh; do
    mkdir -p "$REPO/out"; printf 'OLDPNG' > "$REPO/out/hero.png"
    run bash -c "cd '$REPO' && FAKE_FAIL=1 bash '$FW_REPO_ROOT/$r' sol out hero brief.txt"
    [ "$status" -ne 0 ]
    [ "$(cat "$REPO/out/hero.png")" = OLDPNG ]
    run bash -c "cd '$REPO' && CLAUDE_IMAGE_NO_WEBP=1 FAKE_IMG=hero.png bash '$FW_REPO_ROOT/$r' sol out hero brief.txt"
    [ "$status" -eq 0 ]
    [ "$(cat "$REPO/out/hero.png")" = NEWPNG ]
  done
}

@test "U08 codex-image-run (v1 + media): an orphaned previous-<slug>.png from a killed run is restored, never stranded" {
  seed_codex
  echo "a hero" > "$REPO/brief.txt"
  for r in .claude/framework/advisors/codex-image-run.sh plugins/media/scripts/codex-image-run.sh; do
    # Simulate a SIGKILLed run: master moved aside, target absent, no EXIT-trap restore.
    rm -rf "$REPO/out" "$REPO/_advisors/.imageruns/hero"
    mkdir -p "$REPO/out" "$REPO/_advisors/.imageruns/hero"
    printf 'OLDPNG' > "$REPO/_advisors/.imageruns/hero/previous-hero.png"
    run bash -c "cd '$REPO' && FAKE_FAIL=1 bash '$FW_REPO_ROOT/$r' sol out hero brief.txt"
    [ "$status" -ne 0 ]
    [ "$(cat "$REPO/out/hero.png")" = OLDPNG ]
    [ ! -e "$REPO/_advisors/.imageruns/hero/previous-hero.png" ]
  done
}

@test "U08 codex-image-run (v1 + media): the timestamped move-aside never overwrites an earlier orphan" {
  seed_codex
  echo "a hero" > "$REPO/brief.txt"
  for r in .claude/framework/advisors/codex-image-run.sh plugins/media/scripts/codex-image-run.sh; do
    rm -rf "$REPO/out" "$REPO/_advisors/.imageruns/hero"
    mkdir -p "$REPO/out" "$REPO/_advisors/.imageruns/hero"
    printf 'ORPHAN' > "$REPO/_advisors/.imageruns/hero/previous-hero.png"
    printf 'CURRENT' > "$REPO/out/hero.png"
    run bash -c "cd '$REPO' && FAKE_FAIL=1 bash '$FW_REPO_ROOT/$r' sol out hero brief.txt"
    [ "$status" -ne 0 ]
    [ "$(cat "$REPO/out/hero.png")" = CURRENT ]
    [ "$(cat "$REPO/_advisors/.imageruns/hero/previous-hero.png")" = ORPHAN ]
  done
}
