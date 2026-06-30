# Core Patterns

## Script Skeleton

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SCRIPT_NAME="$(basename -- "${BASH_SOURCE[0]}")"

trap 'log_error "failed at line $LINENO"' ERR
trap 'cleanup' EXIT

cleanup() {
    [[ -n "${TMP_WORK:-}" ]] && rm -rf -- "$TMP_WORK"
}

main() {
    parse_args "$@"
    TMP_WORK=$(mktemp -d)
    # ... orchestrate functions ...
}

main "$@"
```

## Functions

```bash
# One concern; locals first; validate; stderr for errors; non-zero on failure
validate_file() {
    local -r file="$1"
    local -r message="${2:-File not found: $file}"

    if [[ ! -f "$file" ]]; then
        echo "ERROR: $message" >&2
        return 1
    fi
}

process_files() {
    local -r input_dir="$1"
    local -r output_dir="$2"

    [[ -d "$input_dir" ]] || { echo "ERROR: not a directory: $input_dir" >&2; return 1; }
    mkdir -p -- "$output_dir"

    # NUL-delimited find loop — survives spaces/newlines in names
    while IFS= read -r -d '' file; do
        handle_one "$file" "$output_dir"
    done < <(find "$input_dir" -maxdepth 1 -type f -print0)
}
```

**`local` + command substitution trap**: `local out=$(cmd)` swallows
`cmd`'s exit status (the `local` succeeds regardless). Split it:

```bash
local out
out=$(cmd)        # set -e now sees a failure here
```

## Argument Parsing

```bash
VERBOSE=false
DRY_RUN=false
OUTPUT_FILE=""

usage() {
    cat <<EOF
Usage: $SCRIPT_NAME [OPTIONS]

Options:
    -v, --verbose       Verbose output
    -d, --dry-run       Show actions without performing them
    -o, --output FILE   Output file (required)
    -h, --help          This help
EOF
    exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -v|--verbose) VERBOSE=true; shift ;;
        -d|--dry-run) DRY_RUN=true; shift ;;
        -o|--output)  OUTPUT_FILE="$2"; shift 2 ;;
        -h|--help)    usage 0 ;;
        --)           shift; break ;;
        *)            echo "ERROR: unknown option: $1" >&2; usage 1 ;;
    esac
done

[[ -n "$OUTPUT_FILE" ]] || { echo "ERROR: -o/--output is required" >&2; usage 1; }
```

(`getopts` is the lighter alternative for short options only.)

## Logging

```bash
log()       { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1: ${*:2}" >&2; }
log_info()  { log INFO "$@"; }
log_warn()  { log WARN "$@"; }
log_error() { log ERROR "$@"; }
log_debug() { [[ "${DEBUG:-0}" == "1" ]] && log DEBUG "$@" || true; }
```

Logs to stderr — stdout stays clean for actual output (pipelines depend
on it).

## Arrays

```bash
declare -a items=("item 1" "item 2")
for item in "${items[@]}"; do process "$item"; done

mapfile -t lines < <(some_command)        # command output → array, safely
declare -A config=([host]=db1 [port]=5432)   # associative
args+=(--flag "$value")                    # build command lines as arrays,
some_tool "${args[@]}"                     # then expand — no eval, no quoting hell
```

## Temp Files

```bash
readonly TMP_DIR=$(mktemp -d)
trap 'rm -rf -- "$TMP_DIR"' EXIT INT TERM
chmod 700 "$TMP_DIR"
```

Always `mktemp`, always trap-cleaned, never predictable names (see
security.md for why).

## Traps and Signals

```bash
trap 'echo "Error on line $LINENO (exit $?)" >&2' ERR
trap 'cleanup; exit 130' INT          # Ctrl-C: clean up, conventional code
trap 'log_info "received TERM"; cleanup; exit 143' TERM
```

`set -E` makes ERR traps fire inside functions. EXIT trap is the one
cleanup guarantee — early returns, errors, signals all pass through it.

## Retries with Backoff

```bash
retry() {
    local -r max_attempts="$1"; shift
    local attempt=1 delay=1
    until "$@"; do
        if (( attempt >= max_attempts )); then
            log_error "failed after $attempt attempts: $*"
            return 1
        fi
        log_warn "attempt $attempt failed; retrying in ${delay}s"
        sleep "$delay"
        (( attempt++ )); (( delay *= 2 ))
    done
}

retry 5 curl -fsS --max-time 10 "$ENDPOINT"
```

## Dry-Run Pattern for Destructive Scripts

```bash
run() {
    if [[ "$DRY_RUN" == true ]]; then
        echo "[dry-run] $*"
    else
        "$@"
    fi
}

run rm -rf -- "${BUILD_DIR:?BUILD_DIR not set}/dist"
```

`${VAR:?}` makes `rm -rf "$VAR/"` impossible to run with an empty
variable — the classic deleted-the-filesystem bug.
