#!/usr/bin/env bats
# Audit 2026-10-12, unit E (advisors + media): watcher PASS path (P1) + commit-pinned
# evidence (P7), Windows codex sandbox flag + preflight warning (P4), Fable nonce FAIL
# message (P2), codex-quota.sh (P6). All against a fake codex — no model is ever run.
load helpers

setup() {
  # The tests/ dir-mirror ships to consumers that do not carry the plugin family.
  [ -f "$FW_REPO_ROOT/plugins/advisors/.claude-plugin/plugin.json" ] || skip "no plugins/ tree"
  init_repo
  mkdir -p "$BATS_TEST_TMPDIR/bin" "$BATS_TEST_TMPDIR/codexhome"
  # Fake codex: records its argv, echoes the brief's nonce (the line after the guard's
  # "nonce, on its own line:"), writes a session carrying the requested model + nonce.
  cat > "$BATS_TEST_TMPDIR/bin/codex" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then echo "codex-cli 0.144.1"; exit 0; fi
printf '%s\n' "$@" > "$BATS_TEST_TMPDIR/codex-args"
out=""; model=""; cwd=""
while [[ $# -gt 0 ]]; do
  case "$1" in -o) out="$2"; shift;; -m) model="$2"; shift;; -C) cwd="$2"; shift;; esac; shift
done
prompt="$(cat)"
nonce="$(printf '%s\n' "$prompt" | grep -A1 'nonce, on its own line:' | tail -1)"
mkdir -p "$CODEX_HOME/sessions/x"
printf '{"model":"%s","text":"%s"}\n' "$model" "$nonce" > "$CODEX_HOME/sessions/x/s.jsonl"
printf '%s\nNo issues found in the evidence provided.\n' "$nonce" > "$out"
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
[modes]
active = "watcher-test"
[modes.watcher-test]
reviewer = "sol"
verifier = "sol"
EOF
  touch "$REPO/.claude/.codex-training-optout-confirmed"
  export PATH="$BATS_TEST_TMPDIR/bin:$PATH" CODEX_HOME="$BATS_TEST_TMPDIR/codexhome" BATS_TEST_TMPDIR
  unset CODEX_BIN CODEX_WINDOWS_SANDBOX
}

fake_windows() {  # make `uname -s` report native Windows (Git Bash)
  printf '#!/usr/bin/env bash\necho MINGW64_NT-10.0-26200\n' > "$BATS_TEST_TMPDIR/bin/uname"
  chmod +x "$BATS_TEST_TMPDIR/bin/uname"
}

@test "P1+P7 watcher (v1 + plugin): the PASS path writes RESULT.md, citing the evidence commit" {
  echo 'x' > "$REPO/app.txt"
  git -C "$REPO" add app.txt
  git -C "$REPO" commit -qm "feat: add app (TASK-7)"
  sha="$(git -C "$REPO" rev-parse --short HEAD)"
  for w in .claude/framework/advisors/watcher.sh plugins/advisors/scripts/watcher.sh; do
    rm -rf "$REPO/_advisors"
    run bash -c "cd '$REPO' && bash '$FW_REPO_ROOT/$w' reviewer TASK-7"
    [ "$status" -eq 0 ]
    [[ "${lines[${#lines[@]}-1]}" == "WATCHER reviewer sol PASS "* ]]
    res="$REPO/_advisors/watch-task-7-reviewer/RESULT.md"
    grep -q '^# Watcher finding' "$res"
    grep -q '^- advisor: `sol`' "$res"
    grep -q '^- augment:' "$res"
    grep -q "^- evidence: commits \`$sha\`" "$res"
    grep -q 'No issues found' "$res"
    grep -q "## Evidence commits" "$REPO/_advisors/watch-task-7-reviewer/conversation.md"
  done
}

@test "P4 codex-run (v1 + plugin): passes windows.sandbox=unelevated on native Windows only" {
  mkdir -p "$REPO/_advisors/t1"; echo brief > "$REPO/_advisors/t1/conversation.md"
  for r in .claude/framework/advisors/codex-run.sh plugins/advisors/scripts/codex-run.sh; do
    rm -f "$BATS_TEST_TMPDIR/bin/uname"
    run bash -c "cd '$REPO' && bash '$FW_REPO_ROOT/$r' sol t1 NONCE-a"
    [ "$status" -eq 0 ]
    ! grep -q 'windows.sandbox' "$BATS_TEST_TMPDIR/codex-args" || false
    fake_windows
    run bash -c "cd '$REPO' && bash '$FW_REPO_ROOT/$r' sol t1 NONCE-b"
    [ "$status" -eq 0 ]
    grep -qx 'windows.sandbox="unelevated"' "$BATS_TEST_TMPDIR/codex-args"
    run bash -c "cd '$REPO' && CODEX_WINDOWS_SANDBOX= bash '$FW_REPO_ROOT/$r' sol t1 NONCE-c"
    [ "$status" -eq 0 ]
    ! grep -q 'windows.sandbox' "$BATS_TEST_TMPDIR/codex-args" || false
  done
}

@test "P4 codex-image-run (v1 + media): respects an owner windows.sandbox, else passes unelevated" {
  fake_windows
  echo "a hero" > "$REPO/brief.txt"
  for r in .claude/framework/advisors/codex-image-run.sh plugins/media/scripts/codex-image-run.sh; do
    rm -f "$BATS_TEST_TMPDIR/codexhome/config.toml"
    run bash -c "cd '$REPO' && CLAUDE_IMAGE_NO_WEBP=1 FAKE_IMG=hero.png bash '$FW_REPO_ROOT/$r' sol out hero brief.txt"
    [ "$status" -eq 0 ]
    grep -qx 'windows.sandbox="unelevated"' "$BATS_TEST_TMPDIR/codex-args"
    printf '[windows]\nsandbox = "elevated"\n' > "$BATS_TEST_TMPDIR/codexhome/config.toml"
    run bash -c "cd '$REPO' && CLAUDE_IMAGE_NO_WEBP=1 FAKE_IMG=hero.png bash '$FW_REPO_ROOT/$r' sol out hero brief.txt"
    [ "$status" -eq 0 ]
    ! grep -q 'windows.sandbox' "$BATS_TEST_TMPDIR/codex-args" || false
  done
}

@test "P4 codex-preflight (v1 + advisors + media): warns on Windows when windows.sandbox is unset" {
  fake_windows
  for p in .claude/framework/advisors/codex-preflight.sh plugins/advisors/scripts/codex-preflight.sh plugins/media/scripts/codex-preflight.sh; do
    rm -f "$BATS_TEST_TMPDIR/codexhome/config.toml"
    run bash -c "cd '$REPO' && bash '$FW_REPO_ROOT/$p'"
    [ "$status" -eq 0 ]
    [[ "$output" == *"windows sandbox: not set"* ]]
    printf 'model = "x"\n[windows]\nsandbox = "unelevated"\n' > "$BATS_TEST_TMPDIR/codexhome/config.toml"
    run bash -c "cd '$REPO' && bash '$FW_REPO_ROOT/$p'"
    [ "$status" -eq 0 ]
    [[ "$output" == *"windows sandbox: set in"* ]]
  done
}

@test "P2 verify-turn (v1 + plugin): a missing nonce says it was expected in the RESPONSE FILE" {
  for v in .claude/framework/fable/verify-turn.sh plugins/advisors/fable/verify-turn.sh; do
    wb="$BATS_TEST_TMPDIR/wb"; rm -rf "$wb"; mkdir -p "$wb/t/turns"
    cp "$FW_REPO_ROOT/$v" "$wb/verify-turn.sh"
    echo "an answer without the token" > "$wb/t/turns/001-fable.md"
    run bash "$wb/verify-turn.sh" t NONCE-zz "$wb/t/turns/001-fable.md"
    [ "$status" -eq 1 ]
    [[ "$output" == *"expected in the RESPONSE FILE (its first line)"* ]]
  done
}

@test "P6 codex-quota: reports the newest rollout reading and gates on --max" {
  d="$BATS_TEST_TMPDIR/codexhome/sessions/2026/10/10"; mkdir -p "$d"
  printf '%s\n' '{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":42.0,"resets_at":1791604617},"secondary":{"used_percent":7.0,"resets_at":1792084992}}}}' > "$d/rollout-2026-10-10T02-53-16-a.jsonl"
  q="$FW_REPO_ROOT/plugins/advisors/scripts/codex-quota.sh"
  run bash "$q"
  [ "$status" -eq 0 ]
  [[ "$output" == *"5h 42.0%"* && "$output" == *"weekly 7.0%"* ]]
  run bash "$q" --max 40
  [ "$status" -eq 1 ]
  run bash "$q" --max 90
  [ "$status" -eq 0 ]
  # a truncated (mid-write) last line is skipped: the previous reading wins
  printf '%s' '{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_pe' >> "$d/rollout-2026-10-10T02-53-16-a.jsonl"
  run bash "$q" --max 90
  [ "$status" -eq 0 ]
  [[ "$output" == *"5h 42.0%"* ]]
  # only a truncated line -> no reading (exit 2), never the over-max exit 1
  printf '%s' '{"payload":{"rate_limits":{"primary":{"used_pe' > "$d/rollout-2026-10-10T02-53-16-a.jsonl"
  run bash "$q" --max 1
  [ "$status" -eq 2 ]
  rm -rf "$BATS_TEST_TMPDIR/codexhome/sessions"
  run bash "$q"
  [ "$status" -eq 2 ]
}
