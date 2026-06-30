#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# --- Profile / opt-out gate (TASK-011) -------------------------------
# Tier: safety. Runs in every profile (minimal/standard/strict) — a
# destructive-command guard should not be silenced by lowering the
# profile. Only an explicit disable wins: CLAUDE_DISABLED_HOOKS listing
# "block-dangerous" turns it off (the user's explicit override).
_disabled = os.environ.get("CLAUDE_DISABLED_HOOKS", "")
if "block-dangerous" in [t.strip() for t in _disabled.replace(",", " ").split()]:
    sys.exit(0)

# Fail open on a malformed/empty event payload: if we can't parse the
# event, we can't judge the command, so don't block (and don't crash with
# a traceback). A guard that errored on garbage input would break the tool
# loop on a harness hiccup. The event JSON is harness-generated, not
# model-craftable, so this isn't a bypass surface.
try:
    data = json.load(sys.stdin)
except (ValueError, json.JSONDecodeError):
    sys.exit(0)
if not isinstance(data, dict):
    sys.exit(0)
cmd = data.get("tool_input", {}).get("command", "")


def _is_catastrophic_rm(command: str) -> bool:
    # Tokenise per simple-command segment so `cd /x && rm -rf /` is seen.
    # A plain substring regex is wrong in both directions here (DA-C2):
    # it matched any absolute-path rm (`rm -rf /tmp/build`) and missed
    # split flags (`rm -r -f /`), long flags, sudo, and home targets.
    for seg in re.split(r"[;|&\n]+", command):
        tokens = seg.strip().split()
        i = 0
        # Skip env-var prefixes and privilege wrappers.
        while i < len(tokens) and (
            re.match(r"^[A-Za-z_][A-Za-z_0-9]*=", tokens[i])
            or tokens[i] in ("sudo", "doas", "command", "env")
        ):
            i += 1
        if i >= len(tokens):
            continue
        prog = tokens[i].replace("\\", "/").rsplit("/", 1)[-1].lower()
        if prog != "rm":
            continue
        recursive = force = False
        targets = []
        for tok in tokens[i + 1:]:
            if tok == "--":
                continue
            if tok.startswith("--"):
                if tok == "--recursive":
                    recursive = True
                elif tok == "--force":
                    force = True
                continue
            if tok.startswith("-") and len(tok) > 1:
                flags = tok[1:].lower()
                recursive = recursive or "r" in flags
                force = force or "f" in flags
                continue
            targets.append(tok.strip("\"'"))
        if not (recursive and force):
            continue
        for t in targets:
            # Filesystem root: /, //, /* …
            if re.fullmatch(r"/+\*?", t):
                return True
            # Home directory wholesale.
            if t in ("~", "~/", "$HOME", "${HOME}", "$HOME/", "${HOME}/"):
                return True
            # Windows drive root: C:\, C:/, C:
            if re.fullmatch(r"[A-Za-z]:[\\/]?\*?", t):
                return True
    return False


# Non-rm catastrophes stay regex-based: SQL table drops, drive formats,
# fork bombs, raw writes to block devices.
dangerous = re.compile(
    r"DROP\s+TABLE|format\s+[A-Za-z]:|:[(][)][{]|>\s*/dev/sd",
    re.IGNORECASE,
)
blocked = _is_catastrophic_rm(cmd) or bool(dangerous.search(cmd))

try:
    root = subprocess.check_output(
        ["git", "rev-parse", "--show-toplevel"],
        text=True, stderr=subprocess.DEVNULL,
    ).strip()
    tdir = Path(root) / ".claude" / "telemetry"
    tdir.mkdir(parents=True, exist_ok=True)
    # Schema-v2 shape (contract:telemetry-schema) built natively — this
    # hook is Python, so it can't source hooks/lib/hook-common.sh.
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
    # Truncate the echo (DA-M13): the command may embed credentials
    # (auth headers, connection strings); stderr can surface to the user
    # and transcripts. 200 chars is plenty to identify what was blocked.
    shown = cmd if len(cmd) <= 200 else cmd[:200] + "…[truncated]"
    print(f"BLOCKED: Dangerous command: {shown}", file=sys.stderr)
    sys.exit(2)
