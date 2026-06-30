# Portability

Declare your targets, then verify on each. The portability matrix:

| Environment | Reality |
|---|---|
| Linux | GNU coreutils, `/proc`, full Bash |
| macOS | **BSD** coreutils (different flags), Bash 3.2 default (ancient — target `/usr/bin/env bash` for Homebrew Bash, or zsh-aware) |
| WSL | Effectively Linux; Windows FS at `/mnt/c` |
| Git Bash / MSYS2 | Most of Bash; path auto-conversion quirks; no systemd/proc parity |
| Containers | Depends on image — **Alpine ships BusyBox `/bin/sh`, no Bash** |

```bash
detect_platform() {
    case "$OSTYPE" in
        linux-gnu*)    echo "linux" ;;
        darwin*)       echo "macos" ;;
        msys*|cygwin*) echo "windows" ;;
        *)             echo "unknown" ;;
    esac
}
# WSL: grep -qi microsoft /proc/version
# Container: [ -f /.dockerenv ] || [ -n "${KUBERNETES_SERVICE_HOST:-}" ]
```

## macOS (BSD vs GNU)

| Command | GNU (Linux) | BSD (macOS) |
|---|---|---|
| in-place sed | `sed -i 's/a/b/' f` | `sed -i '' 's/a/b/' f` |
| canonical path | `readlink -f path` | not available — `greadlink -f` (coreutils) or pure-bash fallback |
| date maths | `date -d '1 day ago'` | `date -v-1d` |
| stat format | `stat -c '%s'` | `stat -f '%z'` |

```bash
# Prefer GNU tools when installed (brew install coreutils gnu-sed)
if command -v gsed >/dev/null 2>&1; then SED=gsed; else SED=sed; fi
"$SED" -i.bak 's/old/new/' "$file"     # -i.bak works on both as a fallback
```

macOS's default `/bin/bash` is 3.2 — no associative arrays, no
`mapfile`. Scripts using Bash 4+ features must require Homebrew bash or
degrade.

## Git Bash / MSYS2 (Windows)

MSYS **auto-converts Unix-looking arguments to Windows paths** —
`/foo` becomes `C:/Program Files/Git/usr/foo`. The biggest single source
of Windows shell bugs:

```bash
# Disable conversion per command
MSYS_NO_PATHCONV=1 docker run -v /host/path:/container/path image

# Convert explicitly
unix_path=$(cygpath -u "C:\Windows\System32")
win_path=$(cygpath -w "/c/Users/me")

# Flags that look like paths: double-slash escapes conversion
cmd //e //s        # instead of /e /s

# Detect
[[ "$OSTYPE" == "msys" || "$OSTYPE" == mingw* ]] && in_git_bash=true
```

Other Git Bash realities: no systemd, `/proc` is partial, some tools are
MSYS builds with subtle flag differences; line endings — enforce LF via
`.gitattributes` (`*.sh text eol=lf`) or CRLF shebangs break with
`bad interpreter: /bin/bash^M`.

## POSIX `sh` (containers, init scripts, maximum reach)

When targeting `#!/bin/sh`:

| Bash-only (avoid) | POSIX replacement |
|---|---|
| `[[ ]]`, `=~` | `[ ]`, `case`, `expr`/`grep` |
| arrays, `mapfile` | positional params, `set --`, files |
| `<(cmd)` process substitution | temp files, pipes |
| `${var//x/y}` (some expansions) | `sed`/`tr` |
| `local` (strictly) | widely supported but not POSIX — acceptable in practice |
| `echo -e/-n` portability mess | `printf '%s\n'` always |

Verify with `checkbashisms script.sh` and run under `dash` (strict
POSIX-ish) as a smoke test. In Dockerfiles: either `apk add bash` and
shebang bash, or stay genuinely POSIX — don't pretend.

## Container Notes

PID 1 must handle signals and reap zombies — use `tini`/
`--init`, or `exec` your main process so it receives signals directly
(`exec "$@"` as the entrypoint's last line). Minimal images lack
`curl`/`procps`/etc. — check with `command -v` and fail with a clear
message rather than mid-script surprises.

## Version/Feature Gating

```bash
# Require a minimum Bash where features demand it
if (( BASH_VERSINFO[0] < 4 )); then
    echo "ERROR: bash >= 4 required (found $BASH_VERSION)" >&2
    exit 1
fi

# Tool presence
require() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 not installed" >&2; exit 1; }; }
require jq
```
