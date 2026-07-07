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
    * PROTECTED locations worth guarding (filesystem/drive roots, the home
      directory, whole block devices); and
    * the TOOLS that can wipe them (recursive-force delete, low-level disk
      writers, filesystem formatters), plus the shell shapes that are
      destructive on their own (redirecting into a block device; a
      self-referential fork bomb).
  Judging the *program position* rather than the raw text is what stops it
  from blocking an innocent command that merely mentions a scary phrase in a
  commit message, a heredoc body, or a quoted argument.

  Scope and honesty: this is DEFENCE IN DEPTH, not a security boundary. It
  is heuristic and can be defeated by deliberate obfuscation (running the
  destructive command through another interpreter, variable indirection,
  command substitution) — those are out of scope by design. It also fails
  OPEN on input it cannot parse, because a guard that crashed the tool loop
  on a harness hiccup would be worse than the risk it mitigates. Widen the
  two tables over time; keep concrete adversarial cases in the test
  fixtures, never in this file.
"""
import json
import os
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


# --- What we protect: locations a destructive tool must never wipe wholesale
def _norm(token: str) -> str:
    """Strip surrounding quotes and normalise separators for comparison."""
    return token.strip().strip("\"'").replace("\\", "/")


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
_HOME = {"~", "~/", "$HOME", "${HOME}", "$HOME/", "${HOME}/"}
# Whole block devices (raw disks / partitions), never individual files under them.
_BLOCK_DEVICE = re.compile(
    r"^/dev/(sd[a-z]+\d*|nvme\d+n\d+(p\d+)?|hd[a-z]+\d*|vd[a-z]+\d*"
    r"|disk\d+(s\d+)?|mmcblk\d+(p\d+)?)$"
)


def _is_block_device(token: str) -> bool:
    return bool(_BLOCK_DEVICE.match(_norm(token)))


def _is_protected_target(token: str) -> bool:
    t = _norm(token)
    if t in _HOME:
        return True
    # Home-directory glob wipe: `rm -rf ~/*`, `$HOME/*`, `${HOME}/*` destroy the
    # home directory's entire contents exactly as `rm -rf ~` would. Strip one
    # trailing `*` (and the `/` before it) and re-check the HOME set so the glob
    # forms normalise to their base — the `~` entry already blocks the bare form.
    if t.endswith("*"):
        base = t[:-1]
        if base.endswith("/"):
            base = base[:-1]
        if base in _HOME:
            return True
    if any(r.match(t) for r in _ROOTS):
        return True
    return _is_block_device(t)


# --- Parsing: split into simple commands, quote-aware -----------------------
_OPERATORS = {";", "&", "&&", "|", "||"}
# Env-assignment prefixes and privilege/scheduling/exec wrappers to see past,
# so the real program in `cd /x && sudo rm ...` (or `timeout 5 rm ...`,
# `xargs rm ...`) is still the one we judge. Some of these take their own
# leading arguments (a `timeout` duration, a `stdbuf`/`nice` option) before
# the wrapped program — _program_and_args skips those too.
_WRAPPERS = {"sudo", "doas", "command", "env", "nice", "nohup", "time",
             "timeout", "stdbuf", "setsid", "xargs"}


def _simple_commands(command: str):
    """Yield token lists, one per simple command, respecting shell quoting.

    A quote-aware lexer means a scary phrase living *inside* a quoted string
    stays part of one argument and is never mistaken for a new command. Each
    physical line is lexed separately so a newline reliably ends a command —
    shlex treats a newline as ordinary whitespace, which would otherwise
    merge a second-line command into the first. (Heredoc bodies are lexed as
    if they were commands: a known, accepted limitation — real heredoc
    tracking is out of scope — that can only ever over-block a script written
    via heredoc, never under-block a real one.)
    """
    for line in command.split("\n"):
        if not line.strip():
            continue
        lexer = shlex.shlex(line, posix=True, punctuation_chars=True)
        lexer.whitespace_split = True
        try:
            tokens = list(lexer)
        except ValueError:
            # Unbalanced quotes etc. — degrade to a coarse split rather than crash.
            tokens = line.split()
        segment: list[str] = []
        for tok in tokens:
            if tok in _OPERATORS:
                if segment:
                    yield segment
                    segment = []
            else:
                segment.append(tok)
        if segment:
            yield segment


def _program_and_args(tokens):
    i = 0
    n = len(tokens)
    while i < n:
        tok = tokens[i]
        if re.match(r"^[A-Za-z_]\w*=", tok):     # inline env assignment
            i += 1
            continue
        if tok in _WRAPPERS:
            i += 1
            # Skip the wrapper's OWN leading arguments before the real
            # program: option flags (`stdbuf -oL`, `nice -n 10`) and a bare
            # duration/priority (`timeout 5`, `timeout 1.5s`). Without this,
            # `timeout 5 rm -rf /` would name `5` as the program and never
            # reach the rm rule.
            while i < n and (
                tokens[i].startswith("-")
                or re.match(r"^\d+(\.\d+)?[smhd]?$", tokens[i])
            ):
                i += 1
            continue
        break
    if i >= n:
        return None, []
    program = _norm(tokens[i]).rsplit("/", 1)[-1].lower()
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
        if tok == "--recursive":
            recursive = True
        elif tok.startswith("--"):
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


# program name -> predicate over its parsed arguments
_TOOL_RULES = {
    "rm": _rm_wipes_protected,
    "rmdir": _rmdir_wipes_protected,
    "rd": _rmdir_wipes_protected,
    "dd": _targets_block_device,
    "mkfs": _targets_block_device,   # also mkfs.ext4 etc. (see dispatch below)
    "shred": _targets_block_device,
    "wipefs": _targets_block_device,
    "blkdiscard": _targets_block_device,
    "tee": _targets_block_device,    # tee's targets are all outputs
    "format": _format_targets_root,
}


# --- Whole-line shell shapes that are destructive regardless of program ----
def _redirects_into_device(tokens) -> bool:
    """`> <block-device>` / `>> <block-device>` — the shell writes onto the raw
    disk. Append (`>>`) is as destructive here as truncate: either one hands
    the shell a whole block device as its output file."""
    for a, b in zip(tokens, tokens[1:]):
        if a in (">", ">|", ">>") and _is_block_device(b):
            return True
    return False


# A fork bomb is structurally a shell function that pipes into itself in the
# background then invokes itself. Match that shape for ANY function name
# rather than hard-coding the traditional one-character name.
_FORK_BOMB = re.compile(r"([^\s(){}|&;]+)\(\)\s*\{[^}]*\|\s*\1[^}]*&")
_QUOTED = re.compile(r"'[^']*'|\"[^\"]*\"")


def _is_fork_bomb(command: str) -> bool:
    # Strip quoted spans first so a command that merely *mentions* a fork bomb
    # in a message/argument isn't blocked — only an actual unquoted one is.
    return bool(_FORK_BOMB.search(_QUOTED.sub(" ", command)))


def _is_catastrophic(command: str) -> bool:
    if _is_fork_bomb(command):
        return True
    for tokens in _simple_commands(command):
        if _redirects_into_device(tokens):
            return True
        program, args = _program_and_args(tokens)
        if program is None:
            continue
        rule = _TOOL_RULES.get("mkfs" if program.startswith("mkfs") else program)
        if rule and rule(args):
            return True
    return False


blocked = _is_catastrophic(cmd)

# --- Telemetry (best-effort; never affects the decision) -------------------
try:
    root = subprocess.check_output(
        ["git", "rev-parse", "--show-toplevel"],
        text=True, stderr=subprocess.DEVNULL,
    ).strip()
    tdir = Path(root) / ".claude" / "telemetry"
    tdir.mkdir(parents=True, exist_ok=True)
    event = {
        "ts": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "schema": 2,
        "event_id": uuid.uuid4().hex[:16],
        "session_id": str(data.get("session_id", "") or ""),
        "hook": "bash-guard",
        "outcome": "blocked" if blocked else "allowed",
        "outcome_class": "blocked" if blocked else "ok",
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
