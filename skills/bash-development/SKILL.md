---
name: bash-development
description: >-
  Production Bash/shell scripting: defensive strict-mode patterns, quoting
  discipline, ShellCheck compliance, security (injection/path-traversal/
  temp-file safety), cross-platform portability (Linux/macOS/WSL/Git Bash/
  containers), and BATS testing, with detailed topic references loaded on
  demand. Use this skill whenever any shell script is created, edited,
  reviewed, or debugged — even one-liners destined for CI. Triggers
  include: .sh/.bash files, shebang lines, CI/CD pipeline script blocks,
  cron jobs, "convert these commands to a script", shell errors, ShellCheck
  warnings, scripts that fail on macOS/Windows but work on Linux.
---

# Bash Development

Consolidated Bash engineering for agents. The rules here always apply;
load `references/` files only when the task touches that topic. Scope is
**Bash** (and POSIX `sh` where targeted) — PowerShell is a different
language, not covered here.

## The Mandatory Preamble

Every script opens with:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail   # -E inherit ERR trap; -e exit on error;
                     # -u unset vars are errors; pipefail catches mid-pipe failures
IFS=$'\n\t'

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
trap 'rm -rf -- "${TMPDIR_WORK:-}"' EXIT     # cleanup always runs
```

POSIX-targeted scripts (`#!/bin/sh`) get the portable subset: no `[[ ]]`,
no arrays, no process substitution — see
[references/portability.md](references/portability.md).

## Quoting — the #1 bug class

```bash
process "$file_path"          # always quote expansions
cp -- "$src" "$dest"          # -- stops option injection from filenames
"${files[@]}"                 # arrays expand element-wise, quoted
"${name:-default}"            # defaults for possibly-unset vars under set -u
: "${REQUIRED_VAR:?REQUIRED_VAR is not set}"   # fail fast on required vars
```

Unquoted `$var` word-splits and globs. `"${arr[*]}"` joins into one
string — almost always wrong where `"${arr[@]}"` was meant. Iterate
command output with `while IFS= read -r` or `mapfile -t`, **never**
`for x in $(cmd)`.

## ShellCheck — non-negotiable

Every script passes `shellcheck` with zero warnings. The fix-first
discipline applies (as with every linter in this framework): fix the
code; suppress only with an inline justification —
`# shellcheck disable=SC2086 reason: intentional word splitting`. Pair
with `bash -n script.sh` for a parse check.

## Critical Pitfalls — always check

- **`set -e` blind spots**: doesn't fire inside `if cmd`, `cmd || true`,
  or `local var=$(cmd)` (the `local` masks the exit code — declare and
  assign separately).
- **`[[ ]]` vs `[ ]`**: `[[ ]]` in Bash scripts (safer, no quoting traps
  in conditionals, regex via `=~`); `[ ]` only for POSIX `sh`.
- **Predictable temp files**: `/tmp/app-$$.tmp` is a symlink-attack race
  — `mktemp`/`mktemp -d` + `trap ... EXIT`, always.
- **Unvalidated input reaching commands**: validate pattern/length/
  emptiness first; pass user values after `--`; **never `eval` user
  data**. Details: [references/security.md](references/security.md).
- **cron/CI failures of working scripts**: minimal `PATH` — set it
  explicitly, use absolute paths, redirect output.
- **GNU-isms on macOS**: `sed -i` (needs `''`), `date` flags,
  `readlink -f` — see portability.md before claiming macOS support.
- **Git Bash path mangling** (Windows): MSYS converts `/foo` arguments to
  Windows paths — `MSYS_NO_PATHCONV=1`, `cygpath`, or `//double-slash`
  flags.
- **Alpine containers have no bash** — `/bin/sh` (BusyBox); write POSIX
  or install bash explicitly.

## Structure Rules

Functions: one concern each; `local -r` declarations first (assign
command substitutions on a separate line); validate inputs; return
non-zero on failure; errors to stderr. Constants `UPPER_CASE` and
`readonly`; locals `lower_case`. Argument parsing via `getopts` or a
`case` loop with `usage()` on `-h`/bad input. Leveled logging functions
writing to stderr. Full templates:
[references/patterns.md](references/patterns.md).

## Agent Workflow Rules

1. **Identify the target platforms first** (Linux only? macOS? Git Bash?
   container base image?) — it changes shebang, flags, and tools.
   In this framework's own scripts, assume Git Bash/WSL quirks exist on
   Windows hosts.
2. **Verification loop**: `bash -n` → `shellcheck` → run with test
   inputs → `DEBUG=1`/`set -x` if behaviour surprises. For non-trivial
   logic, BATS tests
   ([references/testing-debugging.md](references/testing-debugging.md)).
3. **Destructive operations** (rm -rf, DROP, force-push) take a
   `--dry-run` mode and echo what they'll do; variables feeding `rm -rf`
   are validated non-empty and absolute
   (`rm -rf "${BUILD_DIR:?}/"` pattern).
4. **Long scripts are a smell** — past ~200 lines of logic, consider
   whether Python (python-development) serves better; Bash excels at
   orchestration, not data manipulation.
5. **Before completion**: shellcheck clean, help text present, traps
   clean up, exit codes meaningful, tested on (or explicitly scoped
   away from) each claimed platform.

## Success Criteria (per script)

Passes shellcheck → strict-mode preamble → all expansions quoted →
`--help` works → testable functions → handles empty/missing/hostile
input → cleans up on exit → runs on every claimed platform.

## Reference Index

| Load when the task involves... | File |
|---|---|
| Function/arg-parsing/logging/temp/array/trap templates | [references/patterns.md](references/patterns.md) |
| Input validation, injection, path traversal, secrets | [references/security.md](references/security.md) |
| macOS/BSD, Git Bash/MSYS, WSL, containers, POSIX sh | [references/portability.md](references/portability.md) |
| BATS tests, debugging, performance, cron issues | [references/testing-debugging.md](references/testing-debugging.md) |
| Bash 5.x features and when to use them | [references/modern-bash.md](references/modern-bash.md) |
