# Testing and Debugging

## BATS (Bash Automated Testing System)

TAP-compliant tests for shell scripts (`bats-core`; assertion helpers via
`bats-assert`/`bats-support`).

```bats
#!/usr/bin/env bats

setup() {
    TEST_TMP=$(mktemp -d)
    PATH="$BATS_TEST_DIRNAME/../bin:$PATH"   # put the script under test on PATH
}

teardown() {
    rm -rf -- "$TEST_TMP"
}

@test "succeeds with valid input" {
    run my_script.sh --output "$TEST_TMP/out.txt" valid-input
    [ "$status" -eq 0 ]
    [ -f "$TEST_TMP/out.txt" ]
}

@test "fails with helpful message on missing argument" {
    run my_script.sh
    [ "$status" -eq 1 ]
    [[ "$output" == *"--output is required"* ]]
}

@test "dry run performs no changes" {
    run my_script.sh --dry-run --output "$TEST_TMP/out.txt" input
    [ "$status" -eq 0 ]
    [ ! -f "$TEST_TMP/out.txt" ]
}
```

`run` captures `$status` and `$output`; `setup`/`teardown` bracket every
test; fixtures live beside the tests
(`tests/{fixtures,helpers}/`). Test functions directly by `source`-ing
the script with a guard:

```bash
# In the script — makes it sourceable for tests
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
```

```bats
# In tests
source "$BATS_TEST_DIRNAME/../bin/my_script.sh"
@test "validate_input rejects empty" {
    run validate_input "" '^[a-z]+$'
    [ "$status" -eq 1 ]
}
```

What to test: argument handling (missing/invalid/help), happy path,
hostile input (spaces, globs, leading dashes in filenames), dry-run
inertness, exit codes. CI: `bats tests/` after `shellcheck` and
`bash -n` in the lint stage.

## Static Verification

```bash
bash -n script.sh          # parse without executing
shellcheck script.sh       # the linter — zero warnings is the bar
checkbashisms script.sh    # POSIX targets only
```

## Runtime Debugging

```bash
bash -x script.sh                          # trace everything
set -x; risky_section; set +x              # trace a region

# Readable traces: file:line:function prefix
export PS4='+ ${BASH_SOURCE##*/}:${LINENO}:${FUNCNAME[0]:-main}: '

# Conditional debug without re-editing
[[ "${DEBUG:-0}" == "1" ]] && set -x
```

`trap '...' ERR` with `$LINENO`/`$BASH_COMMAND` pinpoints failures under
`set -e`. `set +x` around secret-touching sections — traces leak.

## "Works for me" Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| Fails in cron, fine in terminal | Minimal PATH, no profile, different cwd | Explicit `PATH=...`, absolute paths, `cd "$SCRIPT_DIR"`, redirect `>>log 2>&1` |
| Fails in CI, fine locally | Non-interactive shell, missing tools, different sh | `require` checks, pin the shell in the job, no profile assumptions |
| Fails on macOS | BSD utils / Bash 3.2 | portability.md |
| `bad interpreter: ^M` | CRLF line endings | `.gitattributes` `*.sh text eol=lf`; `dos2unix` |
| Hangs in pipeline | Command waiting on stdin | `</dev/null` for commands that mustn't read stdin |
| Different output piped vs terminal | Tool detects tty (colour, paging) | Force flags (`--no-color`, `--batch`) in scripts |

## Performance

Profile first (`time ./script.sh`, `set -x` to find slow steps), then:

```bash
# Built-ins beat subshell+external by orders of magnitude in loops
name="${path##*/}"            # not $(basename "$path")
dir="${path%/*}"              # not $(dirname "$path")
upper="${var^^}"              # not $(tr a-z A-Z)
content=$(<file)              # not $(cat file)

# One process over per-line loops
grep -c pattern file          # not while read; do ((n++)); done
awk '{sum+=$1} END{print sum}' file

# Parallel independent work
xargs -P "$(nproc)" -n1 -- process_one < items.txt
# (GNU parallel where available and licensing acceptable)
```

The principle: every `$(...)` forks; every external command execs. In
hot loops, expansions and built-ins win. But if you're optimising bash
loops over data, the real answer is usually awk/jq — or Python.
