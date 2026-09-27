#!/usr/bin/env python3
"""PreToolUse guard: refuse to run a command that would irreversibly destroy
the machine or its data.

Design — why it looks the way it does:

  This guard reasons about the *structure* of a command, never about
  substrings of its raw text. It splits the command line into simple
  commands with a quote-aware lexer, finds the program actually being run
  in each, and asks one question: "is a data-destroying tool being pointed,
  in a destructive mode, at a protected location?"

  It deliberately holds NO catalogue of example bad commands. It knows only
  two things, kept as small tables below:
    * PROTECTED locations worth guarding: filesystem / drive roots; the home
      directory and every ancestor of it (`/home`, `/Users`, `C:\\Users`);
      the core system directories AT the root (`/etc` `/usr` `/bin` `/sbin`
      `/lib` `/lib64` `/var` `/boot` `/opt`, macOS `/System` `/Library`
      `/Applications` `/private`, `C:\\Windows`, `C:\\Program Files*`,
      `C:\\ProgramData` — never deeper paths such as `/usr/local/src/x`);
      and whole block devices (`/dev/sd*`, `/dev/nvme*`, `/dev/disk*`,
      `\\\\.\\PhysicalDrive*`); and
    * the TOOLS that can wipe them: recursive delete (rm -r, Remove-Item
      -Recurse, rd /s, find -delete, rsync --delete); moving a protected
      location anywhere (mv, Move-Item); recursive permission / ownership
      rewrites (chmod/chown/chgrp -R, icacls … /T with a modifying switch,
      Set-Acl -Recurse, takeown /r); raw-disk writers (dd, cp, truncate,
      tee, shred, wipefs, mkfs, format, Format-Volume, Clear-Disk); plus the
      shell shapes that are destructive on their own (redirecting into a
      block device; a self-referential fork bomb).
  Deliberately NOT blocked: git history operations (`git push --force`,
  `git reset --hard`, `git clean -fdx`) and project-level deletes
  (`rm -rf build`) — recoverable or intentional, and the review / receipt
  discipline covers them, not this guard.
  Judging the *program position* rather than the raw text is what stops it
  from blocking an innocent command that merely mentions a scary phrase in a
  commit message, a heredoc body, or a quoted argument. It judges every
  shell-running tool it is registered for: POSIX shell (Bash, Monitor) and
  PowerShell (the PowerShell tool — Remove-Item, Format-Volume, Clear-Disk).
  Ordinary control flow (`if …; then rm …`, subshells, brace groups, `!`,
  `exec`) and unquoted `$( … )` / backtick bodies are split into their own
  simple commands, so the program inside them is still the one judged.
  A string re-parsed as a command line — `eval`, `Invoke-Expression`,
  `bash -c`, `pwsh -Command`, `cmd /c` — is judged in its own dialect; a
  pipeline or subexpression that feeds a protected listing into a target-less
  recursive delete (`ls / | xargs rm -rf`) is judged as that delete; and a
  heredoc body is skipped ONLY when provably data — a real (unquoted,
  uncommented) `<<` whose consumer is an allowlisted sink (a commit / PR
  message, `cat`/`tee` into a file or the terminal); every other body,
  including anything fed to a shell, eval, source or xargs, is judged.

  Scope and honesty: this is DEFENCE IN DEPTH, not a security boundary. It
  is heuristic and can be defeated by deliberate obfuscation (variable
  indirection, encoded commands, quoted command substitution, interpreters
  it does not know) — those are out of scope by design. It also fails
  OPEN on input it cannot parse, because a guard that crashed the tool loop
  on a harness hiccup would be worse than the risk it mitigates. Its OWN
  errors are handled more strictly: a failure in heredoc skipping judges every
  body instead; any other unexpected exception is retried once with heredoc
  skipping off; and if that fails too, the guard says loudly on stderr that
  the command was NOT screened (exit 1, non-blocking) — never silently.
  Out of scope: content reused LATER by another tool (a commit message read
  back by `git log | …` in a separate command) is judged only when an
  executor (eval, a shell, source, xargs, an interpreter) appears on the same
  command line. Widen the
  two tables over time; keep concrete adversarial cases in the test
  fixtures, never in this file.
"""
import json
import os
import posixpath
import re
import shlex
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# --- Opt-out gate (safety tier) -------------------------------------------
# This guard runs in every profile (minimal/standard/strict); lowering the
# profile must not silence it. Only an explicit CLAUDE_DISABLED_HOOKS entry
# naming "block-dangerous" turns it off — the user's deliberate override.
_disabled = os.environ.get("CLAUDE_DISABLED_HOOKS", "")
if "block-dangerous" in [t.strip() for t in _disabled.replace(",", " ").split()]:
    sys.exit(0)

# --- Read the event, failing open on anything we cannot judge -------------
# The event JSON is harness-generated, not model-craftable, so a malformed
# shape is a harness hiccup, not a bypass surface: don't crash, don't block.
try:
    data = json.load(sys.stdin)
except (ValueError, json.JSONDecodeError):
    sys.exit(0)
if not isinstance(data, dict):
    sys.exit(0)
tool_input = data.get("tool_input")
cmd = tool_input.get("command", "") if isinstance(tool_input, dict) else ""
if not isinstance(cmd, str) or not cmd.strip():
    sys.exit(0)
# Which shell dialect the command is written in. The hook is registered for
# every tool that runs a shell command (Bash, PowerShell, Monitor); only the
# PowerShell tool speaks PowerShell (backtick escapes, `\` as a plain path
# separator, Remove-Item semantics) — everything else is POSIX-shell.
_POWERSHELL = str(data.get("tool_name", "") or "").lower() == "powershell"


# --- What we protect: locations a destructive tool must never wipe wholesale
def _norm(token: str) -> str:
    """Strip surrounding quotes and normalise separators for comparison."""
    return token.strip().strip("\"'").replace("\\", "/")


# A Windows raw physical disk (`\\.\PhysicalDrive0`), in any separator form.
_PHYSICAL_DRIVE = re.compile(r"(^|/)physicaldrive\d+$", re.IGNORECASE)


def _canon(token: str) -> str:
    """Canonical comparison form of a path argument: separators unified,
    interior `/./` segments and repeated slashes collapsed, trailing `/` and
    `/.` dropped but never below the root `/` — so `~//`, `/*/`, `/./*`,
    `~/./*`, `/.`, `C:\\` and `$HOME/.` all compare equal to their base
    spelling."""
    t = _norm(token)
    if _PHYSICAL_DRIVE.search(t):
        return t
    prev = None
    while prev != t:                    # until stable: `/././/./` -> `/`
        prev = t
        t = re.sub(r"/{2,}", "/", t.replace("/./", "/"))
    while len(t) > 1 and (t.endswith("/") or t.endswith("/.")):
        if t == "/.":
            return "/"
        t = t[:-2] if t.endswith("/.") else t[:-1]
    if re.search(r"(^|/)\.\.(/|$)", t):
        t = _resolve_dotdot(t)
    return t


# A leading home-directory spelling (`~`, `$HOME`, `${env:USERPROFILE}` …)
# anchoring a path, so `~/..` can be resolved against the real home.
_HOME_PREFIX = re.compile(
    r"^(~|\$home|\$\{home\}|\$userprofile|\$\{userprofile\}|%userprofile%"
    r"|\$env:userprofile|\$\{env:userprofile\}|\$env:home|\$\{env:home\})(?=/|$)",
    re.IGNORECASE)


def _resolve_dotdot(t: str) -> str:
    """Resolve `..` segments in an ABSOLUTE or home-anchored path with
    posixpath.normpath semantics, so `/usr/..`, `/..`, `~/..` and
    `~/.claude/..` compare as the root / home-parent / home they name. A
    relative path (`../x`) depends on an unknown cwd and is left alone."""
    m = _HOME_PREFIX.match(t)
    if m:
        home = _HOME_ABS[0] if _HOME_ABS else ""
        if not home:
            return t
        t = home + t[m.end():]
    dm = re.match(r"^([A-Za-z]:)(/.*)?$", t)
    if dm:
        return dm.group(1) + posixpath.normpath(dm.group(2) or "/")
    if t.startswith("/"):
        n = posixpath.normpath(t)
        return "/" if n == "//" else n
    return t


# The home directory's canonical absolute spelling (filled in once below;
# a list so _resolve_dotdot can read it before it is computed).
_HOME_ABS: list = []


_ROOTS = (
    re.compile(r"/+\*?$"),            # filesystem root: a lone slash, opt. glob
    re.compile(r"[A-Za-z]:/?\*?$"),   # a Windows drive root (C:\, F:/ …)
    # Git Bash / WSL / Cygwin drive mounts — the drive roots' NATURAL spelling
    # on this framework's primary platform (`/c`, `/mnt/c`, `/cygdrive/c`, and
    # their `/c/`, `/c/*` glob forms). Single-letter first component only, so a
    # real multi-char top-level dir (`/home`, `/etc`) is never matched; a bare
    # `/c` can theoretically be a real Linux dir → accepted defense-in-depth
    # over-block, per the module's fail-toward-blocking stance.
    re.compile(r"/(mnt/|cygdrive/)?[A-Za-z]/?\*?$"),
)
# Spellings of the home directory, compared case-insensitively (PowerShell and
# cmd variables are case-insensitive; over-matching a bash `$home` is harmless).
_HOME = {"~", "$home", "${home}", "$userprofile", "${userprofile}",
         "%userprofile%", "%homedrive%%homepath%", "$env:userprofile",
         "${env:userprofile}", "$env:home", "${env:home}"}


def _home_literals():
    """The home directory's EXPANDED absolute spellings on this machine (an
    agent often writes `/c/Users/me` or `C:\\Users\\me`, not `~`), including
    the Git Bash / WSL / Cygwin mount forms of a Windows drive path."""
    out = set()
    for raw in (os.path.expanduser("~"), os.environ.get("HOME", ""),
                os.environ.get("USERPROFILE", "")):
        c = _canon(raw).lower() if raw else ""
        if not c or c in ("/", "~") or c.startswith("~"):
            continue
        out.add(c)
        m = re.match(r"^([a-z]):/(.+)$", c)
        if m:
            d, rest = m.groups()
            out.update({f"/{d}/{rest}", f"/mnt/{d}/{rest}", f"/cygdrive/{d}/{rest}"})
        m = re.match(r"^/(?:mnt/|cygdrive/)?([a-z])/(.+)$", c)
        if m:
            out.add(f"{m.group(1)}:/{m.group(2)}")
    return out


_HOME_ABS.append(next((_canon(h) for h in (os.path.expanduser("~"),
                                           os.environ.get("HOME", ""),
                                           os.environ.get("USERPROFILE", ""))
                       if h and not h.startswith("~")), ""))
_HOME |= _home_literals()


def _home_ancestors():
    """Every path-prefix ANCESTOR of an absolute home spelling (`/c/Users`
    for `/c/Users/me`, `C:/Users`, `/mnt/c` …): wiping one wipes the home
    directory with it. The drive roots among them are already roots."""
    out = set()
    for h in _HOME:
        if not (h.startswith("/") or re.match(r"^[a-z]:/", h)):
            continue
        parts = h.split("/")
        for k in range(1, len(parts)):
            a = "/".join(parts[:k])
            if a and a != "/":
                out.add(a)
    return out


_HOME_ANCESTORS = _home_ancestors()
# The directories that hold every user's home, on any machine: `/home`,
# `/Users`, and a Windows `Users` dir in its drive / Git Bash / WSL spellings.
_USERS_DIR = re.compile(r"^(/home|((/(mnt/|cygdrive/)?[a-z])|[a-z]:)?/users)$",
                        re.IGNORECASE)
# Drive-root spellings through environment variables (PowerShell, cmd, bash).
_DRIVE_VARS = {"$env:homedrive", "${env:homedrive}", "$env:systemdrive",
               "${env:systemdrive}", "%homedrive%", "%systemdrive%",
               "$homedrive", "${homedrive}", "$systemdrive", "${systemdrive}"}
# Windows system folders through environment variables (PowerShell and cmd
# spellings; bash sees the same names in Git Bash's environment).
_WIN_SYSTEM_VARS = set()
for _v in ("windir", "systemroot", "programfiles", "programfiles(x86)",
           "programdata", "commonprogramfiles", "commonprogramfiles(x86)"):
    _WIN_SYSTEM_VARS |= {"${env:%s}" % _v, "%%%s%%" % _v}
    if "(" not in _v:
        _WIN_SYSTEM_VARS |= {"$env:" + _v, "$" + _v, "${%s}" % _v}
# One level of brace expansion with a comma list (`~/{,.}*`, `/{*,.*}`,
# `~/{build,dist}`): each alternative is judged as the path it expands to.
_BRACE_LIST = re.compile(r"\{([^{}]*,[^{}]*)\}")
# Whole block devices (raw disks / partitions), never individual files under them.
_BLOCK_DEVICE = re.compile(
    r"^/dev/(sd[a-z]+\d*|nvme\d+n\d+(p\d+)?|hd[a-z]+\d*|vd[a-z]+\d*|xvd[a-z]+\d*"
    r"|disk\d+(s\d+)?|mmcblk\d+(p\d+)?)$"
)
# Set while judging a command line once an earlier segment has `cd`-ed INTO a
# protected location, so a relative wildcard there (`cd / && rm -rf *`) is
# judged as the protected location it expands to.
_STATE = {"cwd_protected": False}
_CWD_RELATIVE = {"*", ".", "./*", ".*"}


def _is_block_device(token: str) -> bool:
    t = _canon(token)
    return bool(_BLOCK_DEVICE.match(t) or _PHYSICAL_DRIVE.search(t))


# Core OS directories, protected only AT the root (`/usr`, never
# `/usr/local/src/proj`): POSIX / macOS system trees, and Windows' system
# folders in drive, Git Bash and WSL spellings.
_SYSTEM_DIRS = {"/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64", "/var",
                "/boot", "/opt", "/system", "/library", "/applications",
                "/private"}
_WIN_SYSTEM_DIR = re.compile(
    r"^(?:[a-z]:|/(?:mnt/|cygdrive/)?[a-z])"
    r"/(?:windows|program files(?: \(x86\))?|programdata)$", re.IGNORECASE)


def _is_home_or_above(t: str) -> bool:
    low = t.lower()
    return (low in _HOME or low in _HOME_ANCESTORS or low in _DRIVE_VARS
            or bool(_USERS_DIR.match(t)) or low in _SYSTEM_DIRS
            or bool(_WIN_SYSTEM_DIR.match(t)) or low in _WIN_SYSTEM_VARS)


def _is_protected_target(token: str) -> bool:
    t = _canon(token)
    if _STATE["cwd_protected"] and t in _CWD_RELATIVE:
        return True
    if _is_home_or_above(t):
        return True
    # Home-directory glob wipe: `rm -rf ~/*`, `$HOME/*`, `${HOME}/*` destroy the
    # home directory's entire contents exactly as `rm -rf ~` would. Strip one
    # trailing `*` (and the `/` before it) and re-check the HOME set so the glob
    # forms normalise to their base — the `~` entry already blocks the bare form.
    if t.endswith("*"):
        base = t[:-1]
        if base.endswith("/"):
            base = base[:-1]
        # `~/.*` (every dotfile) normalises through `~/.` to `~`.
        if base and (_is_home_or_above(base) or _is_home_or_above(_canon(base))):
            return True
    m = _BRACE_LIST.search(t)
    if m:
        return any(_is_protected_target(t[:m.start()] + alt + t[m.end():] or "/")
                   for alt in m.group(1).split(","))
    if any(r.match(t) for r in _ROOTS):
        return True
    return _is_block_device(t)


# --- Parsing: split into simple commands, quote-aware -----------------------
# Any token made only of shell punctuation ends a simple command — `;` `&`
# `&&` `|` `||` `;;` `|&`, and the grouping / substitution delimiters `(` `)`
# `$(` and backtick — except a redirect (anything containing `<`/`>`), which
# stays in its command for _redirects_into_device. A standalone `{` / `}`
# (brace group, PowerShell script block) is a boundary too.
_PUNCT_SH = "();<>|&`"
_PUNCT_PS = "();<>|&"


def _is_boundary(tok: str, punct: str) -> bool:
    if tok in ("{", "}"):
        return True
    return (bool(tok) and all(c in punct for c in tok)
            and "<" not in tok and ">" not in tok)


def _quote_ps_braced_vars(line: str) -> str:
    """Single-quote each UNQUOTED PowerShell `${…}` variable so the lexer keeps
    it whole — `${env:ProgramFiles(x86)}` would otherwise split at `(`."""
    out, i, n, q = [], 0, len(line), None
    while i < n:
        c = line[i]
        if q:
            q = None if c == q else q
        elif c in "'\"":
            q = c
        elif line.startswith("${", i) and line.find("}", i) > 0:
            e = line.find("}", i)
            out.append("'" + line[i:e + 1] + "'")
            i = e + 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _split_ps_braces(tok: str):
    """PowerShell script blocks are idiomatically written brace-attached
    (`{Remove-Item -Recurse ~}`, `% {rm -r C:\\}`), so a leading `{` / an
    unbalanced trailing `}` would otherwise glue onto the program or target.
    Peel them off as standalone boundary tokens. A balanced `${env:X}` /
    `@{k=v}` keeps its braces — only an unmatched trailing `}` is peeled."""
    head = []
    while len(tok) > 1 and tok.startswith("{"):
        head.append("{")
        tok = tok[1:]
    tail = []
    while len(tok) > 1 and tok.endswith("}") and tok.count("}") > tok.count("{"):
        tail.append("}")
        tok = tok[:-1]
    return head + [tok] + tail


# Shell reserved words / prefixes that may precede the real program in a
# simple command (`if rm …`, `then rm …`, `do rm …`, `! rm …`). Skipped
# plainly — they take no arguments of their own.
_KEYWORDS = {"if", "then", "else", "elif", "do", "while", "until", "!"}
# Env-assignment prefixes and privilege/scheduling/exec wrappers to see past,
# so the real program in `cd /x && sudo rm ...` (or `timeout 5 rm ...`,
# `xargs rm ...`) is still the one we judge. Some of these take their own
# leading arguments (a `timeout` duration, a `stdbuf`/`nice` option) before
# the wrapped program — _program_and_args skips those too.
_WRAPPERS = {"sudo", "doas", "command", "env", "nice", "nohup", "time",
             "timeout", "stdbuf", "setsid", "xargs", "exec", "builtin",
             "coproc", "busybox", "toybox"}
# Wrapper options that consume the NEXT token as their value — without this,
# `sudo -u root rm -rf /` would name `root` as the program.
_WRAPPER_VALUE_OPTS = {
    "sudo": {"-u", "-g", "-C", "-h", "-p", "-U", "-r", "-t", "-D", "-T",
             "--user", "--group", "--host", "--prompt", "--other-user",
             "--role", "--type", "--chdir", "--close-from", "--command-timeout"},
    "doas": {"-u", "-C"},
    "timeout": {"-s", "-k", "--signal", "--kill-after"},
    "env": {"-u", "-C", "--unset", "--chdir"},
    "nice": {"-n", "--adjustment"},
    "stdbuf": {"-i", "-o", "-e", "--input", "--output", "--error"},
    "xargs": {"-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a",
              "--max-args", "--max-procs", "--max-lines", "--delimiter",
              "--eof", "--max-chars", "--arg-file"},
    "exec": {"-a"},
}


# Shells whose stdin IS a script: a heredoc fed to one of these is code.
_SHELLS = {"bash", "sh", "zsh", "dash", "ksh", "ash", "mksh"}

# --- Heredocs: skip a body ONLY when it is provably data (an ALLOWLIST) -----
# A heredoc body is judged like any other script line UNLESS (a) its `<<`
# operator is a real, unquoted, uncommented token — found by _scan_heredocs,
# which lexes quotes, `#` comments, `$( … )`, backticks and `$(( … ))` the way
# bash does — AND (b) the heredoc's consumer is a known data sink. Every
# divergence from bash's own lexing would fail OPEN (text we wrongly call data
# is never judged), so anything not positively recognised stays judged.

# Pipeline members that only read / transform data — never execute it.
_DATA_PIPE = {"cat", "tee", "grep", "egrep", "fgrep", "wc", "sort", "uniq",
              "head", "tail", "less", "more", "jq", "yq", "tr", "cut",
              "column", "base64", "gzip", "gunzip", "diff"}
_KUBECTL_DATA = {"apply", "create", "replace", "diff"}
# File targets that are really a stream another process may execute.
_STREAM_ALIAS = re.compile(r"^(/dev/(stdout|stderr|stdin|tty|fd/\d+)|/proc/[^/]+/fd/\d+)$")
# A program anywhere on the line that can execute text it is handed.
_EXECUTOR = re.compile(
    r"(?:^|[\s;&|(`\"'])(?:eval|source|bash|sh|zsh|dash|ksh|ash|mksh|xargs|"
    r"python[\d.]*|perl|ruby|node|php|pwsh|powershell|iex|invoke-expression)"
    r"(?=$|[\s;&|)`\"'])|(?:^|[\s;&|(])\.\s", re.IGNORECASE)
# The command a `$(cat <<EOF …)` substitution is an argument OF, when that
# argument is a literal message: `git commit/tag/notes -m`, `gh … --body`.
_MSG_SINK = re.compile(
    r"^\s*(?:[A-Za-z_]\w*=\S*\s+)*(?:"
    r"git\s+(?:-C\s+\S+\s+)?(?:commit|tag|notes(?:\s+\w+)?)\b[^;&|`]*"
    r"\s(?:-m|-am|--message[= ]?)"
    r"|gh\s+(?:pr|issue|release)\s+\w+\b[^;&|`]*"
    r"\s(?:--body|-b|--title|-t|--notes|-n)[= ]?"
    r")\s*\"?$")


def _read_heredoc_word(cmd: str, j: int):
    """Unquote the delimiter word starting at `j`; return (word, end)."""
    n = len(cmd)
    word = []
    while j < n and cmd[j] not in " \t\n;&|()<>":
        ch = cmd[j]
        if ch in "'\"":
            e = cmd.find(ch, j + 1)
            e = n if e < 0 else e
            word.append(cmd[j + 1:e])
            j = e + 1
        elif ch == "\\" and j + 1 < n:
            word.append(cmd[j + 1])
            j += 2
        else:
            word.append(ch)
            j += 1
    return "".join(word), j


def _scan_heredocs(cmd: str):
    """Find every REAL heredoc operator with a bash-faithful lexer: `<<`
    inside quotes, after a word-initial `#`, inside `$(( … ))`, or as `<<<`
    is not one. Returns dicts with the operator's pipeline start (`pstart`),
    the newline its body follows (`nl`), the body span (`body`, `end`),
    whether the terminator was found, and — for an operator inside `$( … )`
    — the substitution's position (`open`) and its parent pipeline start."""
    docs, pending = [], []
    stack = [{"kind": "top", "pstart": 0, "open": None, "ppstart": None,
              "depth": 0}]
    i, n, word_start = 0, len(cmd), True

    def unquoted_parent():
        for c in reversed(stack):
            if c["kind"] in ("top", "subst", "bq"):
                return c
        return stack[0]

    while i < n:
        ctx = stack[-1]
        k = ctx["kind"]
        c = cmd[i]
        if k == "sq":
            if c == "'":
                stack.pop()
            i += 1
            continue
        if k == "ansi":
            if c == "\\":
                i += 2
                continue
            if c == "'":
                stack.pop()
            i += 1
            continue
        if k == "arith":
            if c == "(":
                ctx["depth"] += 1
            elif c == ")":
                if ctx["depth"] == 0:
                    stack.pop()
                    i += 2 if cmd.startswith("))", i) else 1
                    continue
                ctx["depth"] -= 1
            i += 1
            continue
        if k == "dq":
            if c == "\\":
                i += 2
            elif c == '"':
                stack.pop()
                i += 1
                word_start = False
            elif cmd.startswith("$((", i):
                stack.append({"kind": "arith", "depth": 0})
                i += 3
            elif cmd.startswith("$(", i):
                stack.append({"kind": "subst", "pstart": i + 2, "open": i,
                              "ppstart": unquoted_parent()["pstart"], "depth": 0})
                i += 2
                word_start = True
            elif c == "`":
                stack.append({"kind": "bq", "pstart": i + 1, "open": i,
                              "ppstart": unquoted_parent()["pstart"], "depth": 0})
                i += 1
                word_start = True
            else:
                i += 1
            continue
        # Unquoted contexts: top level, $( … ), backticks.
        if c == "\\":
            i += 2
            word_start = False
        elif cmd.startswith("$'", i):
            stack.append({"kind": "ansi"})
            i += 2
            word_start = False
        elif c == "'":
            stack.append({"kind": "sq"})
            i += 1
            word_start = False
        elif c == '"' or cmd.startswith('$"', i):
            stack.append({"kind": "dq"})
            i += 1 if c == '"' else 2
            word_start = False
        elif c == "`" and k == "bq":
            stack.pop()
            i += 1
            word_start = False
        elif c == "`":
            stack.append({"kind": "bq", "pstart": i + 1, "open": i,
                          "ppstart": ctx["pstart"], "depth": 0})
            i += 1
            word_start = True
        elif cmd.startswith("$((", i) or (word_start and cmd.startswith("((", i)):
            stack.append({"kind": "arith", "depth": 0})
            i += 3 if c == "$" else 2
            word_start = False
        elif cmd.startswith("$(", i):
            stack.append({"kind": "subst", "pstart": i + 2, "open": i,
                          "ppstart": ctx["pstart"], "depth": 0})
            i += 2
            word_start = True
        elif c == "#" and word_start:
            e = cmd.find("\n", i)
            i = n if e < 0 else e           # a comment runs to end of line
        elif c == "\n":
            j = i + 1
            for d in pending:               # bodies follow this newline, in order
                d["nl"], d["body"] = i, j
                found = False
                while j < n:
                    e = cmd.find("\n", j)
                    e = n if e < 0 else e
                    line = cmd[j:e].rstrip("\r")
                    if (line.lstrip("\t") if d["strip"] else line) == d["delim"]:
                        found = True
                        j = e + 1
                        break
                    j = e + 1
                d["end"], d["terminated"] = min(j, n), found
                docs.append(d)
            pending = []
            i = j
            ctx["pstart"] = i
            word_start = True
        elif c == ")" and k == "subst" and ctx["depth"] == 0:
            stack.pop()
            i += 1
            word_start = False
        elif c == "(":
            if k == "subst":
                ctx["depth"] += 1
            ctx["pstart"] = i + 1
            i += 1
            word_start = True
        elif c == ")":
            if k == "subst":
                ctx["depth"] -= 1
            i += 1
            word_start = False
        elif cmd.startswith("<<", i) and not cmd.startswith("<<<", i):
            j = i + 2
            strip = j < n and cmd[j] == "-"
            j += 1 if strip else 0
            while j < n and cmd[j] in " \t":
                j += 1
            delim, j = _read_heredoc_word(cmd, j)
            if delim:
                pending.append({"op": i, "pstart": ctx["pstart"], "kind": k,
                                "open": ctx.get("open"), "ppstart": ctx.get("ppstart"),
                                "delim": delim, "strip": strip})
            i = j
            word_start = False
        elif c in ";&" or cmd.startswith("||", i):
            if c == "&" and cmd.startswith("&>", i):
                i += 2
                word_start = True
                continue
            step = 2 if cmd[i:i + 2] in (";;", "&&", "||") else 1
            i += step
            ctx["pstart"] = i
            word_start = True
        elif c in " \t|<>":
            i += 1
            word_start = True
        else:
            i += 1
            word_start = False
    for d in pending:                       # operator with no body line at all
        d.update(nl=n, body=n, end=n, terminated=False)
        docs.append(d)
    return docs


def _heredoc_is_data(cmd: str, d) -> bool:
    """Is heredoc `d` consumed by a known DATA sink (see the section note)?"""
    if not d["terminated"] or d["kind"] == "bq":
        return False
    try:
        lexer = shlex.shlex(cmd[d["pstart"]:d["nl"]], posix=True,
                            punctuation_chars=_PUNCT_SH)
        lexer.whitespace_split = True
        tokens = list(lexer)
    except ValueError:
        return False
    # The pipeline that owns the operator: cut at the first non-pipe boundary.
    pipeline, cur = [], []
    for t in tokens:
        if t in ("|", "|&"):
            pipeline.append(cur)
            cur = []
        elif _is_boundary(t, _PUNCT_SH):
            break
        else:
            cur.append(t)
    pipeline.append(cur)
    owner = next((k for k, seg in enumerate(pipeline) if "<<" in seg or "<<-" in seg), None)
    if owner is None:
        return False
    files = []

    def plain(seg):
        """Split a command's redirect targets (-> files) from its words."""
        words, k = [], 0
        while k < len(seg):
            t = seg[k]
            if t in (">", ">>", ">|", "&>", "&>>") and k + 1 < len(seg):
                files.append(seg[k + 1])
                k += 2
            elif t in ("<<", "<<-") and k + 1 < len(seg):
                k += 2
            else:
                words.append(t)
                k += 1
        return words

    prog, args = _program_and_args(plain(pipeline[owner]), False)
    if prog == "tee":
        files.extend(a for a in args if not a.startswith("-"))
    elif prog == "git":
        sub = args[0] if args else ""
        if not (sub in ("commit", "tag", "notes") and (
                "-F-" in args or "--file=-" in args
                or any(a in ("-F", "--file") and b == "-" for a, b in zip(args, args[1:])))):
            return False
    elif prog == "gh":
        if not ("--body-file=-" in args or any(
                a in ("--body-file", "-F") and b == "-" for a, b in zip(args, args[1:]))):
            return False
    elif prog != "cat":
        return False
    for seg in pipeline[owner + 1:]:
        p, a = _program_and_args(plain(seg), False)
        if p == "kubectl" and a and a[0] in _KUBECTL_DATA:
            continue
        if p not in _DATA_PIPE:
            return False
        if p == "tee":
            files.extend(x for x in a if not x.startswith("-"))
    # A file the body is written to must not be used again elsewhere in the
    # command (`cat <<EOF >x.sh; bash x.sh`), be a raw disk, or be an alias of
    # a stream / process that may execute it (`>(sh)`, `/dev/stdout`,
    # `/dev/fd/N`, `/proc/self/fd/N`).
    rest = cmd[:d["body"]] + "\n" + cmd[d["end"]:]
    if re.search(r"[<>]\(", cmd[d["pstart"]:d["nl"]]):
        return False
    for f in files:
        if (_is_block_device(f) or not f or rest.count(f) > 1
                or _STREAM_ALIAS.match(f)):
            return False
    # Any command elsewhere on the line that can run text (`eval`, a shell,
    # `source`, xargs, an interpreter) may re-run the "data" — e.g. `git commit
    # -m "$(cat <<EOF …)"; eval "$(git log -1 --format=%B)"`. Judge the body.
    if _EXECUTOR.search(rest):
        return False
    if d["kind"] == "subst":
        # `$(cat <<EOF …)` is data only as the literal message argument of a
        # known message sink (git commit -m, gh pr create --body …).
        if files or d["ppstart"] is None or d["open"] is None:
            return False
        return bool(_MSG_SINK.match(cmd[d["ppstart"]:d["open"]]))
    return True


_HEREDOC_SKIP = {"on": True}


def _strip_heredocs(command: str) -> str:
    """Drop the bodies (and terminators) of heredocs that are provably DATA
    (_heredoc_is_data) — a commit message via `git commit -m "$(cat <<'EOF'
    …)"`, a file written with `cat > f <<EOF` — so text that merely discusses
    a dangerous command is not judged as one. Everything else — a heredoc fed
    to a shell, `source /dev/stdin`, eval, xargs, an unknown consumer, an
    unterminated body — stays in and is judged line by line.

    Fail-closed: ANY exception while scanning or classifying (a guard bug, an
    input shape the scanner never anticipated) returns the command unchanged,
    so every body is judged rather than silently skipped. _HEREDOC_SKIP off
    (the top-level retry below) disables skipping entirely."""
    if not _HEREDOC_SKIP["on"]:
        return command
    try:
        docs = _scan_heredocs(command)
        cut = sorted((d["body"], d["end"]) for d in docs
                     if _heredoc_is_data(command, d))
    except Exception:
        return command
    if not cut:
        return command
    out, pos = [], 0
    for s, e in cut:
        if s >= pos:
            out.append(command[pos:s])
            pos = e
    out.append(command[pos:])
    return "".join(out)


def _simple_commands(command: str, ps: bool):
    """Yield (tokens, separator) pairs, one per simple command, respecting
    shell quoting; `separator` is the boundary token that ended the command
    (`|`, `;`, `(` …) or None at the end of a line.

    A quote-aware lexer means a scary phrase living *inside* a quoted string
    stays part of one argument and is never mistaken for a new command. Each
    physical line is lexed separately so a newline reliably ends a command —
    shlex treats a newline as ordinary whitespace, which would otherwise
    merge a second-line command into the first. Line continuations (`\\` +
    newline in POSIX shells, backtick + newline in PowerShell) are joined
    first, so a command split across lines is still judged whole. POSIX
    heredoc bodies that are plain data are skipped (_strip_heredocs); a
    heredoc fed to a shell is judged line by line like any other script.
    """
    if ps:
        command = re.sub(r"`\r?\n", " ", command)
        punct = _PUNCT_PS
    else:
        command = _strip_heredocs(re.sub(r"\\\r?\n", "", command))
        punct = _PUNCT_SH
    for line in command.split("\n"):
        if not line.strip():
            continue
        if ps:
            line = _quote_ps_braced_vars(line)
        lexer = shlex.shlex(line, posix=True, punctuation_chars=punct)
        lexer.whitespace_split = True
        if ps:
            # PowerShell's escape is the backtick; `\` is a path separator
            # (`C:\`) and must survive lexing untouched.
            lexer.escape = "`"
        try:
            tokens = list(lexer)
        except ValueError:
            # Unbalanced quotes etc. — degrade to a coarse split rather than crash.
            tokens = line.split()
        if ps:
            tokens = [p for t in tokens for p in _split_ps_braces(t)]
        segment: list[str] = []
        for tok in tokens:
            if _is_boundary(tok, punct):
                if segment:
                    yield segment, tok
                    segment = []
            else:
                segment.append(tok)
        if segment:
            yield segment, None


def _program_and_args(tokens, ps=False):
    i = 0
    n = len(tokens)
    while i < n:
        tok = tokens[i]
        if re.match(r"^[A-Za-z_]\w*=", tok):     # inline env assignment
            i += 1
            continue
        if tok in _KEYWORDS or (ps and tok == "."):
            # (PowerShell `. <cmd>` dot-sources / invokes, like `& <cmd>`.)
            i += 1
            continue
        if tok in _WRAPPERS:
            value_opts = _WRAPPER_VALUE_OPTS.get(tok, set())
            i += 1
            # Skip the wrapper's OWN leading arguments before the real
            # program: option flags (`stdbuf -oL`, `nice -n 10`), the value
            # of an option that takes one (`sudo -u root`, `timeout -s KILL`)
            # and a bare duration/priority (`timeout 5`, `timeout 1.5s`).
            # Without this, `timeout 5 rm -rf /` would name `5` as the
            # program and never reach the rm rule. A clustered short-flag
            # group whose LAST flag takes a value (`sudo -iu root`) consumes
            # the next token as that value too.
            while i < n and (
                tokens[i].startswith("-")
                or re.match(r"^\d+(\.\d+)?[smhd]?$", tokens[i])
            ):
                t = tokens[i]
                takes_value = t in value_opts or (
                    not t.startswith("--") and len(t) > 2
                    and "-" + t[-1] in value_opts)
                i += 2 if takes_value else 1
            continue
        break
    if i >= n:
        return None, []
    program = _norm(tokens[i]).rsplit("/", 1)[-1].lower()
    # Windows executable suffixes name the same program (`rm.exe`, `format.com`).
    program = re.sub(r"\.(exe|com|cmd|bat)$", "", program)
    return program, tokens[i + 1:]


# --- Per-tool destructiveness rules ----------------------------------------
def _rm_wipes_protected(args) -> bool:
    """A recursive delete aimed at a protected location.

    Force (`-f`) is deliberately NOT required: `rm -r /` already recurses
    into and destroys a protected root, and the confirmation prompt that
    `-f` would suppress is not a safety net we can rely on (a non-tty, a
    piped `yes`, or `--interactive=never` removes it anyway). Requiring
    both flags let `rm -r /` (recursive, no force) slip through.
    """
    recursive = False
    targets = []
    for tok in args:
        if tok.startswith("--") and len(tok) > 2:
            # GNU accepts any unambiguous abbreviation (`--recu`); `--r` is
            # already unique among rm's long options.
            if "--recursive".startswith(tok):
                recursive = True
            continue                       # any other long option (incl. --force)
        elif tok.startswith("-") and len(tok) > 1:
            if "r" in tok[1:].lower():     # -r, -R, -rf, -fr …
                recursive = True
        elif tok != "--":
            targets.append(tok)
    return recursive and any(_is_protected_target(t) for t in targets)


def _rmdir_wipes_protected(args) -> bool:
    """Windows rd/rmdir removing a protected root recursively."""
    recursive = any(a.lower() in ("/s", "-r", "--recursive") for a in args)
    return recursive and any(_is_protected_target(a) for a in args)


def _ps_remove_wipes_protected(args) -> bool:
    """PowerShell Remove-Item (and its aliases rm/ri/del/erase/rd/rmdir), or
    cmd `del /s`, recursively removing a protected location. `-Recurse` may be
    abbreviated to any prefix (`-r`, `-rec`); `-Force` is NOT recursion."""
    recursive = False
    targets = []
    for tok in args:
        low = tok.lower()
        name, _, value = low.partition(":")
        if low in ("/s", "--recursive") or (
                name.startswith("-r") and "-recurse".startswith(name)):
            recursive = recursive or value not in ("$false", "false")
            continue
        if re.match(r"^-[rf]*r[rf]*$", low):   # POSIX-style `-rf` / `-fr`
            recursive = True
            continue
        if name in ("-path", "-literalpath", "-lp", "-pspath") and value:
            targets.append(tok.split(":", 1)[1])
            continue
        if tok.startswith("-") or (tok.startswith("/") and len(tok) == 2
                                   and tok[1].isalpha() and tok[1] != "/"):
            continue                        # other switches / cmd `/q`
        targets.extend(t for t in tok.split(",") if t)
    return recursive and any(_is_protected_target(t) for t in targets)


def _targets_block_device(args) -> bool:
    """A low-level tool (disk writer / formatter) aimed at a whole device."""
    for tok in args:
        value = _norm(tok)
        if value.startswith("of="):   # dd-style output-file argument
            value = value[3:]
        if _is_block_device(value):
            return True
    return False


def _format_targets_root(args) -> bool:
    """Windows `format` aimed at a drive root."""
    return any(_is_protected_target(a) for a in args)


def _always(args) -> bool:
    """A tool whose every use wipes a whole volume/disk (PowerShell
    Format-Volume, Clear-Disk, Remove-Partition)."""
    return True


# find options that only steer traversal — a `find` whose expression holds
# nothing BUT these (plus -delete / -exec rm) deletes everything it walks.
# `-type` is DELIBERATELY neutral even though it filters: `-type f` / `-type d`
# still wipe essentially the whole tree, and a narrower type (`-type l`, only
# symlinks) is rare enough against a protected root that erring toward
# blocking (`find ~ -maxdepth 1 -type l -delete` exits 2) is accepted.
_FIND_NEUTRAL = {"-depth", "-xdev", "-mount", "-noleaf", "-ignore_readdir_race",
                 "-mindepth", "-maxdepth", "-type", "-delete", "-print",
                 "-print0", "-L", "-H", "-P"}
_FIND_VALUE = {"-mindepth", "-maxdepth", "-type"}


def _find_wipes_protected(args) -> bool:
    """`find <protected> -delete` / `-exec rm …` with no selective test —
    a whole-tree wipe spelled without rm (`find ~ -delete`)."""
    paths = []
    i = 0
    while i < len(args) and args[i] in ("-L", "-H", "-P"):
        i += 1
    while i < len(args) and not args[i].startswith(("-", "(", "!")):
        paths.append(args[i])
        i += 1
    if not paths:
        paths = ["."]                       # GNU find's default start point
    if not any(_is_protected_target(p) for p in paths):
        return False
    destructive = False
    rest = args[i:]
    j = 0
    while j < len(rest):
        tok = rest[j]
        if tok == "-delete":
            destructive = True
        elif tok in ("-exec", "-execdir", "-ok", "-okdir"):
            prog = _norm(rest[j + 1]).rsplit("/", 1)[-1].lower() if j + 1 < len(rest) else ""
            if prog in ("rm", "shred", "unlink", "rmdir"):
                destructive = True
            # skip the exec'd command up to its terminator
            while j < len(rest) and rest[j] not in (";", "+", "\\;"):
                j += 1
        elif tok not in _FIND_NEUTRAL:
            return False                    # a selective test (-name, -mtime …)
        elif tok in _FIND_VALUE:
            j += 1
        j += 1
    return destructive


def _rsync_wipes_protected(args) -> bool:
    """`rsync --delete <src> <protected>` mirrors src onto the protected
    location, deleting everything there that src lacks (an empty src wipes
    it)."""
    if not any(a.startswith("--del") or a == "--remove-source-files"
               for a in args):
        return False
    positional = [a for a in args if not a.startswith("-")]
    return len(positional) >= 2 and _is_protected_target(positional[-1])


def _is_dest_opt(low: str) -> bool:
    """`-t` / `--target-directory` (cp/mv) or PowerShell `-Destination`
    (any unambiguous prefix, `-de` or longer)."""
    return low in ("-t", "--target-directory") or (
        len(low) >= 3 and "-destination".startswith(low))


def _split_sources_dest(args):
    """(sources, destination) of a cp/mv-style argument list, honouring an
    explicit destination option (`-t DIR`, `--target-directory=DIR`,
    `-Destination X`) and PowerShell `-Path` / `-LiteralPath` values."""
    pos, sources, dest = [], [], None
    k = 0
    while k < len(args):
        a = args[k]
        low = a.lower()
        name, sep, val = low.partition(":") if low.startswith("-") and not low.startswith("--") else (low, "", "")
        if low.startswith("--target-directory="):
            dest = a.split("=", 1)[1]
        elif _is_dest_opt(name):
            if sep:
                dest = a.split(":", 1)[1]
            elif k + 1 < len(args):
                dest = args[k + 1]
                k += 1
        elif name in ("-path", "-literalpath", "-lp"):
            if sep:
                sources.append(a.split(":", 1)[1])
            elif k + 1 < len(args):
                sources.append(args[k + 1])
                k += 1
        elif not a.startswith("-") and a != "--":
            pos.append(a)
        k += 1
    if dest is None and len(pos) >= 2:
        dest = pos[-1]
        pos = pos[:-1]
    return sources + pos, dest


def _move_protected(args) -> bool:
    """`mv` / Move-Item of a protected location (a root, home or one of its
    ancestors, a core system dir) to ANY destination: the source vanishes
    from where the system expects it, as surely as a delete."""
    sources, _ = _split_sources_dest(args)
    return any(_is_protected_target(s) for s in sources)


def _copy_onto_device(args) -> bool:
    """`cp <src> <block-device>` / Copy-Item … -Destination <device>: the
    destination is a whole raw disk (reading FROM a device stays allowed)."""
    _, dest = _split_sources_dest(args)
    return dest is not None and _is_block_device(dest)


def _without_cmd_switches(rule):
    """cmd.exe `move` / `copy` take `/y`-style switches, which would
    otherwise read as the Git Bash drive mount `/y`."""
    return lambda args: rule([a for a in args
                              if not re.fullmatch(r"/-?[A-Za-z]", a)])


def _perm_recursive_protected(args) -> bool:
    """chmod / chown / chgrp -R on a protected location: recursively
    rewriting the permissions or owner of `/`, home or a system dir leaves the
    machine unusable. (Only `-R` / `--recursive` — chmod's `-r` is a mode.)"""
    recursive = any(a == "--recursive" or (
        a.startswith("-") and not a.startswith("--") and "R" in a[1:])
        for a in args)
    return recursive and any(_is_protected_target(a) for a in args
                             if not a.startswith("-"))


_ICACLS_MODIFY = ("/grant", "/deny", "/remove", "/reset", "/setowner",
                  "/inheritance", "/setintegritylevel", "/substitute",
                  "/restore")


def _icacls_recursive_protected(args) -> bool:
    """`icacls <protected> … /T` with an ACL-modifying switch (`/reset`,
    `/grant`, `/setowner` …). A recursive DISPLAY (`icacls C:\\ /T`) is fine."""
    if not args:
        return False
    low = [a.lower().replace("//", "/", 1) for a in args]
    return ("/t" in low and any(x.startswith(_ICACLS_MODIFY) for x in low)
            and _is_protected_target(args[0]))


def _setacl_recursive_protected(args) -> bool:
    """PowerShell Set-Acl with a -Recurse switch on a protected path."""
    recursive = False
    for a in args:
        name, _, val = a.lower().partition(":")
        if name.startswith("-r") and "-recurse".startswith(name):
            recursive = val not in ("$false", "false")
    return recursive and any(
        _is_protected_target(a.split(":", 1)[1] if a.lower().startswith(("-path:", "-literalpath:")) else a)
        for a in args if not a.startswith("-") or ":" in a)


def _takeown_recursive_protected(args) -> bool:
    """`takeown /f <protected> /r` — recursively seizes ownership."""
    low = [a.lower().replace("//", "/", 1) for a in args]
    return "/r" in low and any(
        _is_protected_target(args[k + 1])
        for k, x in enumerate(low) if x == "/f" and k + 1 < len(args))


# program name -> predicate over its parsed arguments
_TOOL_RULES = {
    "rm": _rm_wipes_protected,
    "rmdir": _rmdir_wipes_protected,
    "rd": _rmdir_wipes_protected,
    "dd": _targets_block_device,
    "mkfs": _targets_block_device,   # also mkfs.ext4 etc. (see dispatch below)
    "mke2fs": _targets_block_device,
    "mkswap": _targets_block_device,
    "shred": _targets_block_device,
    "wipefs": _targets_block_device,
    "blkdiscard": _targets_block_device,
    "tee": _targets_block_device,    # tee's targets are all outputs
    "truncate": _targets_block_device,
    "cp": _copy_onto_device,
    "install": _copy_onto_device,
    "copy-item": _copy_onto_device,
    "cpi": _copy_onto_device,
    "copy": _without_cmd_switches(_copy_onto_device),
    "mv": _move_protected,
    "move-item": _move_protected,
    "mi": _move_protected,
    "move": _without_cmd_switches(_move_protected),
    "chmod": _perm_recursive_protected,
    "chown": _perm_recursive_protected,
    "chgrp": _perm_recursive_protected,
    "icacls": _icacls_recursive_protected,
    "set-acl": _setacl_recursive_protected,
    "takeown": _takeown_recursive_protected,
    "format": _format_targets_root,
    "find": _find_wipes_protected,
    "rsync": _rsync_wipes_protected,
    # PowerShell (any shell can launch pwsh cmdlets by name via the tool).
    "remove-item": _ps_remove_wipes_protected,
    "ri": _ps_remove_wipes_protected,
    "del": _ps_remove_wipes_protected,
    "erase": _ps_remove_wipes_protected,
    "format-volume": _always,
    "clear-disk": _always,
    "remove-partition": _always,
}
# In PowerShell rm/rd/rmdir are aliases of Remove-Item, with its syntax.
_PS_TOOL_RULES = dict(_TOOL_RULES)
for _alias in ("rm", "rd", "rmdir"):
    _PS_TOOL_RULES[_alias] = _ps_remove_wipes_protected
_CD = {"cd", "chdir", "pushd", "set-location", "sl", "push-location"}
_REMOVERS = (_rm_wipes_protected, _ps_remove_wipes_protected, _rmdir_wipes_protected)
# Programs whose output is a list of paths they were pointed at — the upstream
# half of `ls / | xargs rm -rf` or `Get-ChildItem C:\ | Remove-Item -Recurse`.
_LISTERS = {"echo", "printf", "ls", "dir", "find", "get-childitem", "gci",
            "get-item", "gi", "write-output", "resolve-path", "rvpa"}
# Tokens that stand for "the piped-in object", not a named target.
_PIPE_ITEM = {"$", "@", "$_", "$psitem", "--"}


def _lists_protected(program, args) -> bool:
    return program in _LISTERS and any(
        _is_protected_target(a) for a in args if not a.startswith("-"))


def _targetless_recursive_remove(program, args, rules) -> bool:
    """A recursive remover given NO target of its own (`xargs rm -rf`,
    `Remove-Item -Recurse` at the end of a pipeline, `Remove-Item -Recurse
    (…)`): its targets arrive from the pipe / subexpression."""
    rule = rules.get(program)
    if rule not in _REMOVERS or not rule(list(args) + ["/"]):
        return False
    return not [a for a in args
                if a.lower() not in _PIPE_ITEM and not a.startswith("-")
                and not re.fullmatch(r"/[A-Za-z]", a)]


def _interpreter_payload(program, args, ps):
    """(command-string, is_powershell) for a program that re-parses a string
    argument as a command line — eval / Invoke-Expression, `bash -c`,
    `powershell -Command`, `cmd /c` — else (None, ps)."""
    if program == "eval" or (ps and program in ("invoke-expression", "iex")):
        # (Drop Invoke-Expression's own `-Command` parameter name.)
        return " ".join(a for a in args if not (
            len(a) > 2 and "-command".startswith(a.lower()))), ps
    if program in _SHELLS:
        for k, a in enumerate(args):
            if a.startswith("-") and not a.startswith("--") and "c" in a[1:]:
                rest = [x for x in args[k + 1:] if x != "--"]
                return (rest[0] if rest else ""), False
        return None, ps
    if program in ("powershell", "pwsh"):
        for k, a in enumerate(args):
            low = a.lower()
            if len(low) >= 2 and "-command".startswith(low):
                return " ".join(args[k + 1:]), True
        return None, ps
    if program == "cmd":
        for k, a in enumerate(args):
            if a.lower() in ("/c", "/k", "//c", "//k"):
                # cmd syntax: `\` is a path separator, `/s` a switch — lex it
                # PowerShell-style (backtick escape), whose rules read rd/del.
                return " ".join(args[k + 1:]), True
        return None, ps
    return None, ps


# --- Whole-line shell shapes that are destructive regardless of program ----
def _redirects_into_device(tokens) -> bool:
    """`> <block-device>` / `>> <block-device>` / `&> <block-device>` — the
    shell writes onto the raw disk. Append (`>>`) is as destructive here as
    truncate: either one hands the shell a whole block device as its output
    file."""
    for a, b in zip(tokens, tokens[1:]):
        if a in (">", ">|", ">>", "&>", "&>>", ">&") and _is_block_device(b):
            return True
    return False


# A fork bomb is structurally a shell function that pipes into itself in the
# background then invokes itself. Match that shape for ANY function name
# rather than hard-coding the traditional one-character name — in both the
# `f() { … }` and the `function f { … }` definition forms.
_FORK_BOMB = re.compile(r"([^\s(){}|&;]+)\s*\(\)\s*\{[^}]*\|\s*\1[^}]*&")
_FORK_BOMB_KW = re.compile(
    r"\bfunction\s+([^\s(){}|&;]+)\s*(\(\))?\s*\{[^}]*\|\s*\1[^}]*&")
_QUOTED = re.compile(r"'[^']*'|\"[^\"]*\"")


def _is_fork_bomb(command: str) -> bool:
    # Strip quoted spans first so a command that merely *mentions* a fork bomb
    # in a message/argument isn't blocked — only an actual unquoted one is.
    bare = _QUOTED.sub(" ", command)
    return bool(_FORK_BOMB.search(bare) or _FORK_BOMB_KW.search(bare))


def _is_catastrophic(command: str, ps: bool = _POWERSHELL) -> bool:
    if _is_fork_bomb(command if ps else _strip_heredocs(command)):
        return True
    rules = _PS_TOOL_RULES if ps else _TOOL_RULES
    feeds_next = False        # previous segment piped a protected listing here
    awaits_listing = False    # previous segment was `remove (…)` of a subexpr
    for tokens, sep in _simple_commands(command, ps):
        fed, feeds_next = feeds_next, False
        wants, awaits_listing = awaits_listing, False
        if _redirects_into_device(tokens):
            return True
        program, args = _program_and_args(tokens, ps)
        if program is None:
            continue
        if wants and _lists_protected(program, args):
            return True       # `Remove-Item -Recurse (Get-Item ~)`
        if _targetless_recursive_remove(program, args, rules):
            if fed:
                return True   # `ls / | xargs rm -rf`
            awaits_listing = sep in ("(", "$(")
        if sep in ("|", "|&") and _lists_protected(program, args):
            feeds_next = True
        if fed and program in ("foreach-object", "%", "foreach"):
            feeds_next = True     # `… | % { Remove-Item -Recurse $_ }`
        inner, inner_ps = _interpreter_payload(program, args, ps)
        if inner is not None:
            # eval / iex / `bash -c` / `pwsh -c` / `cmd /c` re-parse a string
            # as a command line: judge that string in its own dialect.
            if _is_catastrophic(inner, inner_ps):
                return True
            continue
        if program in _CD:
            # A bare `cd` goes home (protected); `cd -` returns to $OLDPWD,
            # which is unknown here, so it counts as a positional, unprotected
            # destination rather than as a bare cd.
            positional = [a for a in args if a == "-" or not a.startswith("-")]
            _STATE["cwd_protected"] = (not positional
                                       or _is_protected_target(positional[0]))
            continue
        rule = rules.get("mkfs" if program.startswith("mkfs") else program)
        if rule and rule(args):
            return True
    return False


# --- The decision: an unexpected guard error must not silently fail open ---
# A crash here would exit non-2 and let the command run with no word said.
# So: on an unexpected exception, retry ONCE with heredoc skipping disabled
# (every heredoc body judged). If that also raises, say LOUDLY on stderr that
# this command was NOT screened and exit 1 — the same non-blocking "guard
# SKIPPED" convention guard-wrapper.sh uses — rather than block every command
# on a guard bug.
guard_error = None
try:
    blocked = _is_catastrophic(cmd)
except Exception:
    _HEREDOC_SKIP["on"] = False
    _STATE["cwd_protected"] = False
    try:
        blocked = _is_catastrophic(cmd)
    except Exception as exc:
        blocked = False
        guard_error = f"{type(exc).__name__}: {exc}"

# --- Telemetry (best-effort; never affects the decision) -------------------
try:
    root = subprocess.check_output(
        ["git", "rev-parse", "--show-toplevel"],
        text=True, stderr=subprocess.DEVNULL,
    ).strip()
    # Only record telemetry in a CCMAF project, marked by the update-system
    # pin .claude/.framework-version (every consumer carries it). A bare
    # .claude dir is NOT the marker — any Claude Code repo has one — and this
    # same file also ships inside the ccmaf-kernel plugin, which runs in
    # arbitrary repos that must stay scaffold-free (no surprise
    # .claude/telemetry growth where no insights tooling will ever read it).
    if not (Path(root) / ".claude" / ".framework-version").is_file():
        raise RuntimeError("not a CCMAF project - skip telemetry")
    tdir = Path(root) / ".claude" / "telemetry"
    tdir.mkdir(parents=True, exist_ok=True)
    event = {
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "schema": 2,
        "event_id": uuid.uuid4().hex[:16],
        "session_id": str(data.get("session_id", "") or ""),
        "hook": "bash-guard",
        "outcome": "blocked" if blocked else ("error" if guard_error else "allowed"),
        "outcome_class": "blocked" if blocked else ("error" if guard_error else "ok"),
    }
    tool_use_id = str(data.get("tool_use_id", "") or "")
    if tool_use_id:
        event["tool_use_id"] = tool_use_id
    with (tdir / "events.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(event) + "\n")
except Exception:
    pass

if blocked:
    # Truncate the echo: the command may embed credentials (auth headers,
    # connection strings) that would otherwise surface to the user/transcript.
    shown = cmd if len(cmd) <= 200 else cmd[:200] + "…[truncated]"
    print(f"BLOCKED: refusing an irreversibly destructive command: {shown}",
          file=sys.stderr)
    sys.exit(2)
if guard_error:
    print("block-dangerous-commands guard ERROR: the guard failed internally "
          f"({guard_error}) - this command was NOT screened for destructive "
          "patterns. Treat it as unscreened and report the guard bug.",
          file=sys.stderr)
    sys.exit(1)
