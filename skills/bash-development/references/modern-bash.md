# Modern Bash Features

Feature-gate anything beyond Bash 3.2 if macOS default shell is a
target, and beyond 4.x for older enterprise Linux. Check at runtime:

```bash
(( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )) \
    || { echo "ERROR: bash >= 5.1 required" >&2; exit 1; }
```

## Worth Knowing by Version

| Since | Feature | Use |
|---|---|---|
| 4.0 | associative arrays `declare -A` | lookups, config maps, dispatch tables |
| 4.0 | `mapfile`/`readarray` | command output → array safely |
| 4.0 | `${var,,}` `${var^^}` case conversion | replaces `tr` calls |
| 4.2 | `printf -v var` | format into a variable, no subshell |
| 4.3 | namerefs `declare -n` | "return" values from functions cleanly |
| 4.4 | `${var@Q}` quoting expansion | safe re-quoting for logs/eval-free codegen |
| 5.0 | `$EPOCHSECONDS` / `$EPOCHREALTIME` | timestamps without `date` forks |
| 5.1 | `SRANDOM` | 32-bit random (better than `$RANDOM`) |

```bash
# Namerefs: out-parameters without echo-capture subshells
get_config() {
    declare -n out="$1"
    out=([host]=db1 [port]=5432)
}
declare -A cfg; get_config cfg

# Dispatch table over case-cascades
declare -A handlers=([start]=cmd_start [stop]=cmd_stop [status]=cmd_status)
"${handlers[${1:?command required}]:-cmd_usage}" "${@:2}"
```

## Bash 5.3 (2025) Highlights

Genuinely useful when you can require 5.3+ (verify availability on your
targets first — distros lag):

```bash
# In-shell command substitution — no subshell fork, side effects persist
${ cmd; }            # captures output like $(cmd), runs in current shell

# REPLY-style substitution
${| cmd; }           # cmd sets REPLY; expansion is REPLY's value

# GLOBSORT — control glob ordering without ls|sort pipelines
GLOBSORT=mtime; files=(*.log)        # newest-first by mtime
GLOBSORT=-size                        # reverse size order

# read with readline completion in interactive scripts
read -e -p "path: " -i "$PWD/" target
```

Treat 5.3 features as an optimisation layer: scripts should degrade or
gate, not mysteriously break, on 5.2 hosts. The fork-free substitution
matters in hot loops (each `$(...)` fork costs ~1ms+ — thousands of
iterations add seconds); elsewhere, prefer the portable form.

## When NOT to Reach for Modern Bash

If the solution needs associative-array gymnastics, namerefs, and
5.3-only substitutions to stay readable, that's the signal to write
Python (python-development) or use jq/awk for the data work and keep
Bash for orchestration. Cleverness budgets are smaller in shell than
anywhere else — the next reader debugs at 3am with `set -x`.
