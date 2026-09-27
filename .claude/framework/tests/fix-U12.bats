#!/usr/bin/env bats
# fix-U12 regression pins: devhooks (auto-format / auto-lint / filter-test-output /
# verify-deps), checkpoint-watermark re-arm, per-session statusline cache.
# All hook runs happen inside the throwaway $REPO (helpers.bash).

load helpers

setup() {
  init_repo
  mkdir -p "$BATS_TEST_TMPDIR/fakebin"
}

_fake() {  # _fake <name> <body...> — a fake tool on PATH that logs its argv
  cat > "$BATS_TEST_TMPDIR/fakebin/$1" <<EOF
#!/bin/sh
printf '%s\n' "\$*" >> "$BATS_TEST_TMPDIR/$1.log"
$2
EOF
  chmod +x "$BATS_TEST_TMPDIR/fakebin/$1"
}

# --- auto-format: prettier only when installed locally ------------------------

@test "U12 auto-format: no local prettier -> npx is never invoked (no registry fetch)" {
  mkdir -p "$REPO/web/src"
  echo '{"name":"fixture"}' > "$REPO/web/package.json"
  printf 'const x=1\n' > "$REPO/web/src/app.ts"
  _fake npx 'exit 0'
  PATH="$BATS_TEST_TMPDIR/fakebin:$PATH" run hookrun "$HOOKS/auto-format.sh" \
    "{\"tool_input\":{\"file_path\":\"$REPO/web/src/app.ts\"}}"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ ! -f "$BATS_TEST_TMPDIR/npx.log" ]
}

@test "U12 auto-format: local prettier -> runs via npx --no, stdout stays silent" {
  mkdir -p "$REPO/web/src" "$REPO/web/node_modules/.bin"
  echo '{"name":"fixture"}' > "$REPO/web/package.json"
  touch "$REPO/web/node_modules/.bin/prettier"
  printf 'const x=1\n' > "$REPO/web/src/app.ts"
  _fake npx 'echo chatter; exit 0'
  PATH="$BATS_TEST_TMPDIR/fakebin:$PATH" run hookrun "$HOOKS/auto-format.sh" \
    "{\"tool_input\":{\"file_path\":\"$REPO/web/src/app.ts\"}}"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  grep -q -- '--no prettier --write' "$BATS_TEST_TMPDIR/npx.log"
}

@test "U12 auto-format: a failing formatter logs outcome=failed, not formatted" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  mark_ccmaf
  printf 'x = 1\n' > "$REPO/a.py"
  _fake ruff 'exit 3'
  PATH="$BATS_TEST_TMPDIR/fakebin:$PATH" run hookrun "$HOOKS/auto-format.sh" '{"tool_input":{"file_path":"a.py"}}'
  [ "$status" -eq 0 ]
  grep -q '"hook":"format","outcome":"failed","outcome_class":"flagged"' "$REPO/.claude/telemetry/events.jsonl"
}

# --- auto-lint: findings reach the model as additionalContext ---------------------

@test "U12 auto-lint: linter output is emitted as PostToolUse additionalContext JSON" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  printf 'echo $x\n' > "$REPO/probe.sh"
  _fake shellcheck 'echo "probe.sh:1:6: warning: \"quoted\" [SC2086]"; exit 1'
  PATH="$BATS_TEST_TMPDIR/fakebin:$PATH" run hookrun "$HOOKS/auto-lint.sh" '{"tool_input":{"file_path":"probe.sh"}}'
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.hookSpecificOutput.hookEventName == "PostToolUse"'
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("SC2086")'
}

@test "U12 auto-lint: a clean lint prints nothing" {
  printf 'echo hi\n' > "$REPO/probe.sh"
  _fake shellcheck 'exit 0'
  PATH="$BATS_TEST_TMPDIR/fakebin:$PATH" run hookrun "$HOOKS/auto-lint.sh" '{"tool_input":{"file_path":"probe.sh"}}'
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# --- filter-test-output: runner arguments are allowlisted -------------------------

_ftest() {  # _ftest <command> -> sets $output to the hook's JSON
  run hookrun "$HOOKS/filter-test-output.sh" "$(jq -cn --arg c "$1" '{tool_input:{command:$c}}')"
}

@test "U12 filter-test-output: allowlisted runner args still rewrite + allow" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  local c
  for c in "pytest -xvs tests/test_a.py::test_b" "go test ./... -run TestX -count=1" \
           "cargo test --release -- --nocapture" "npm test -- --run" \
           "dotnet test --filter Category=Unit --no-build"; do
    _ftest "$c"
    [ "$status" -eq 0 ]
    echo "$output" | jq -e '.hookSpecificOutput.permissionDecision == "allow"' || { echo "not allowed: $c"; return 1; }
  done
}

@test "U12 filter-test-output: exec/write-capable runner flags fall to passthrough" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  local c
  for c in "go test -exec evil ./..." "go test -toolexec=x ./..." "pytest --basetemp /" \
           'pytest "--basetemp=/x"' 'pytest \-\-basetemp=/x' "pytest -p evil" \
           "pytest @args.txt" "cargo test --config x" "npm test --script-shell=sh" \
           'go test -run $X' "pytest {--basetemp=x,}" "npm test &" "pytest -k"; do
    _ftest "$c"
    [ "$status" -eq 0 ]
    [ "$output" = "{}" ] || { echo "rewritten: $c -> $output"; return 1; }
  done
}

# --- verify-deps: PyPI extraction ---------------------------------------------------

@test "U12 verify-deps: pyproject -> real deps (bare, extras, single-line array, poetry), no metadata keys" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  mark_ccmaf
  cat > "$REPO/pyproject.toml" <<'EOF'
[build-system]
requires = ["hatchling>=1.20"]
build-backend = "hatchling.build"

[project]
name = "demo"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["requests", "uvicorn[standard]>=0.30"]

[tool.poetry.dependencies]
python = "^3.11"
pydantic = "^2"
EOF
  CLAUDE_DEP_VERIFY=0 VERIFY_DEPS_RETRO=1 run hookrun "$HOOKS/verify-deps.sh" '{"tool_input":{"file_path":"pyproject.toml"}}'
  [ "$status" -eq 0 ]
  local f="$REPO/.claude/.dep-verification-issues.md"
  grep -q '`requests==' "$f"
  grep -q '`uvicorn==0.30' "$f"
  grep -q '`hatchling==1.20' "$f"
  grep -q '`pydantic==' "$f"
  ! grep -qE '`(name|version|requires-python|build-backend|python)==' "$f" || false
}

@test "U12 verify-deps: requirements.txt -> bare names + extras; options/paths skipped" {
  mark_ccmaf
  printf 'requests\nuvicorn[standard]>=0.30\n-r other.txt\n--hash=sha256:abc\n./local/pkg\n' > "$REPO/requirements.txt"
  CLAUDE_DEP_VERIFY=0 VERIFY_DEPS_RETRO=1 run hookrun "$HOOKS/verify-deps.sh" '{"tool_input":{"file_path":"requirements.txt"}}'
  [ "$status" -eq 0 ]
  local f="$REPO/.claude/.dep-verification-issues.md"
  grep -q '`requests==' "$f"
  grep -q '`uvicorn==0.30' "$f"
  ! grep -q 'other.txt\|hash\|local' "$f" || false
}

# --- checkpoint-watermark: re-arm + per-session cache --------------------------------

_ckpt() {  # _ckpt <sid>
  run hookrun "$HOOKS/checkpoint-watermark.sh" "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"$1\",\"transcript_path\":\"\"}"
}

@test "U12 checkpoint-watermark: re-arms after usage drops (compaction) and nudges again" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  local pf="$REPO/.claude/telemetry/.context-pct.s1"
  printf 'PCT=80\nWIN=-\nTS=%s\n' "$(date +%s)" > "$pf"
  _ckpt s1; [[ "$output" == *"Context at"* ]]
  _ckpt s1; [ "$output" = "{}" ]
  printf 'PCT=20\nWIN=-\nTS=%s\n' "$(date +%s)" > "$pf"
  _ckpt s1; [ "$output" = "{}" ]
  printf 'PCT=81\nWIN=-\nTS=%s\n' "$(date +%s)" > "$pf"
  _ckpt s1; [[ "$output" == *"Context at ~81%"* ]]
}

@test "U12 checkpoint-watermark: another session's cached % is not used" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  printf 'PCT=90\nWIN=-\nTS=%s\n' "$(date +%s)" > "$REPO/.claude/telemetry/.context-pct.other"
  _ckpt mine
  [ "$output" = "{}" ]
}

@test "U12 statusline: caches context % per session_id" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  run bash "$FW_REPO_ROOT/.claude/hooks/statusline.sh" <<<"{\"session_id\":\"abc-1\",\"context_window\":{\"used_percentage\":42},\"model\":{\"display_name\":\"Opus\"},\"workspace\":{\"current_dir\":\"$REPO\"}}"
  [ "$status" -eq 0 ]
  [[ "$output" == ctx:42%* ]]
  grep -q '^PCT=42$' "$REPO/.claude/telemetry/.context-pct.abc-1"
  # Legacy unkeyed copy still written for pre-keying readers (the v2 plugin hook).
  grep -q '^PCT=42$' "$REPO/.claude/telemetry/.context-pct"
}

@test "U12 statusline: dev-repo .claude/statusline.sh matches the shipped hooks/statusline.sh" {
  # .claude/statusline.sh is this dev repo's live statusline (not manifest-
  # carried); the shipped v1 source is .claude/hooks/statusline.sh. A fix made
  # in only one copy (the U12 keyed-cache miss) must fail here.
  [ -f "$FW_REPO_ROOT/.claude/statusline.sh" ] || skip ".claude/statusline.sh is dev-repo only"
  cmp -s "$FW_REPO_ROOT/.claude/statusline.sh" "$FW_REPO_ROOT/.claude/hooks/statusline.sh"
}

@test "U12 checkpoint-watermark: unkeyed cache ignored once a keying statusline is in use" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  printf 'PCT=90\nWIN=-\nTS=%s\n' "$(date +%s)" > "$REPO/.claude/telemetry/.context-pct.other"
  printf 'PCT=90\nWIN=-\nTS=%s\n' "$(date +%s)" > "$REPO/.claude/telemetry/.context-pct"
  _ckpt mine
  [ "$output" = "{}" ]
}

@test "U12 checkpoint-watermark: pre-keying statusline (unkeyed file only) is still honoured" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  printf 'PCT=90\nWIN=-\nTS=%s\n' "$(date +%s)" > "$REPO/.claude/telemetry/.context-pct"
  _ckpt mine
  [[ "$output" == *"Context at ~90%"* ]]
}

# --- round 2: hoisted node bins, direct references, reporter paths -------------------

@test "U12 auto-format: prettier hoisted to the repo-root node_modules is used (workspace)" {
  mkdir -p "$REPO/packages/a/src" "$REPO/node_modules/.bin"
  echo '{"name":"a"}' > "$REPO/packages/a/package.json"
  printf 'const x=1\n' > "$REPO/packages/a/src/app.ts"
  printf '#!/bin/sh\nprintf "cwd=%%s args=%%s\\n" "$PWD" "$*" >> "%s"\necho chatter\n' \
    "$BATS_TEST_TMPDIR/prettier.log" > "$REPO/node_modules/.bin/prettier"
  chmod +x "$REPO/node_modules/.bin/prettier"
  _fake npx 'exit 0'
  PATH="$BATS_TEST_TMPDIR/fakebin:$PATH" run hookrun "$HOOKS/auto-format.sh" \
    "{\"tool_input\":{\"file_path\":\"$REPO/packages/a/src/app.ts\"}}"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  grep -q "cwd=$REPO/packages/a" "$BATS_TEST_TMPDIR/prettier.log"
  grep -q -- "--write $REPO/packages/a/src/app.ts" "$BATS_TEST_TMPDIR/prettier.log"
  [ ! -f "$BATS_TEST_TMPDIR/npx.log" ]
}

@test "U12 auto-lint: eslint hoisted to the repo-root node_modules is used (workspace)" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  mkdir -p "$REPO/packages/a/src" "$REPO/node_modules/.bin"
  echo '{"name":"a"}' > "$REPO/packages/a/package.json"
  printf 'const x=1\n' > "$REPO/packages/a/src/app.ts"
  printf '#!/bin/sh\necho "app.ts: line 1, col 7, Error - no-unused-vars"\nexit 1\n' \
    > "$REPO/node_modules/.bin/eslint"
  chmod +x "$REPO/node_modules/.bin/eslint"
  run hookrun "$HOOKS/auto-lint.sh" "{\"tool_input\":{\"file_path\":\"$REPO/packages/a/src/app.ts\"}}"
  [ "$status" -eq 0 ]
  echo "$output" | jq -e '.hookSpecificOutput.additionalContext | test("no-unused-vars")'
}

@test "U12 verify-deps: direct references and git/path inline tables are not registry-checked" {
  mark_ccmaf
  printf 'requests\nmypkg @ git+https://example.com/x/mypkg.git\nother[extra] @ file:///tmp/o\n' \
    > "$REPO/requirements.txt"
  CLAUDE_DEP_VERIFY=0 VERIFY_DEPS_RETRO=1 run hookrun "$HOOKS/verify-deps.sh" '{"tool_input":{"file_path":"requirements.txt"}}'
  [ "$status" -eq 0 ]
  local f="$REPO/.claude/.dep-verification-issues.md"
  grep -q '`requests==' "$f"
  ! grep -q 'mypkg\|other' "$f" || false
  rm -f "$f"
  printf '%s\n' '[tool.poetry.dependencies]' 'python = "^3.11"' 'pydantic = "^2"' \
    'mylib = {git = "https://example.com/mylib.git"}' \
    'locallib = { path = "../locallib", develop = true }' \
    'pinned = {version = "^1.2", optional = true}' > "$REPO/pyproject.toml"
  CLAUDE_DEP_VERIFY=0 VERIFY_DEPS_RETRO=1 run hookrun "$HOOKS/verify-deps.sh" '{"tool_input":{"file_path":"pyproject.toml"}}'
  [ "$status" -eq 0 ]
  grep -q '`pydantic==' "$f"
  grep -q '`pinned==' "$f"
  ! grep -q 'mylib\|locallib' "$f" || false
}

@test "U12 filter-test-output: --reporter accepts bare names only, not module paths" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  local c
  for c in "npm test -- --reporter=dot" "npm test -- --reporter verbose" "npm test -- --reporter=jest-junit"; do
    _ftest "$c"
    echo "$output" | jq -e '.hookSpecificOutput.permissionDecision == "allow"' || { echo "not allowed: $c"; return 1; }
  done
  for c in "npm test -- --reporter=./x.js" "npm test -- --reporter ./x.js" \
           "npm test -- --reporter=/tmp/r" "npm test -- --reporter=@scope/rep" "npm test -- --reporter"; do
    _ftest "$c"
    [ "$output" = "{}" ] || { echo "rewritten: $c -> $output"; return 1; }
  done
}

@test "U12 filter-test-output: expansion chars inside single quotes / literal-prefix globs still rewrite" {
  command -v jq >/dev/null 2>&1 || skip "jq not available"
  local c
  for c in "go test -run 'TestX\$' ./..." "go test -run 'Test.*' ./..." \
           "pytest 'tests/test_a.py::test_b[param]'" "pytest tests/test_a.py::test_b[param]" \
           "pytest -k 'a and not b*'"; do
    _ftest "$c"
    echo "$output" | jq -e '.hookSpecificOutput.permissionDecision == "allow"' || { echo "not allowed: $c"; return 1; }
  done
  for c in "go test -run \$X" "go test -run \"\$X\"" "go test \$'\x2dexec' x" "pytest *" "pytest -*" \
           "pytest '-'*" "pytest {--basetemp=x,}" "pytest 'unbalanced*" "pytest \"a*\"" "pytest a\*" \
           "go test -run 'X'\$Y"; do
    _ftest "$c"
    [ "$output" = "{}" ] || { echo "rewritten: $c -> $output"; return 1; }
  done
}
