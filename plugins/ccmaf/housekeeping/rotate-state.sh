#!/usr/bin/env bash
set -uo pipefail
# rotate-state.sh — mechanical, VERIFYING state-file rotation (OPT P1, TASK-137).
#
# Turns /housekeeping's "archive old entries" from prose into a checked operation.
# Moves whole entry BLOCKS VERBATIM (never rewrites/summarises) from the live
# state files into append-only archives under .claude/archive/, with a
# heading-multiset CONSERVATION check that ABORTS on any mismatch — so an entry
# can never be silently lost or altered.
#
# Rotations (this pass):
#   TASKS.md      — Done-lane entries beyond the newest KEEP_TASKS_DONE, per Done
#                   section (feature + bug), → archive/TASKS-archive.md.
#   DECISIONS.md  — entries beyond the newest KEEP_DECISIONS (newest-at-top) →
#                   archive/DECISIONS-archive.md.
# NOT rotated: ECOSYSTEM.md (all contracts are live canonical); GOTCHAS.md,
#   STATUS.md, claude-progress.txt (own grammars — a later pass).
#
# Safety: verbatim only (no rewrite path); heading-multiset conserved or ABORT;
#   writes to temps then os.replace (atomic); archive written BEFORE live is
#   trimmed (a crash duplicates an entry — recoverable — never loses it).
#
# Usage:
#   bash rotate-state.sh --dry-run   # classify + conservation counts, write nothing
#   bash rotate-state.sh             # perform the rotation
#
# Deps: python3 (occasional maintenance tool — python is far safer than awk for
#   block parsing + multiset conservation; guarded below).

KEEP_TASKS_DONE="${KEEP_TASKS_DONE:-10}"
KEEP_DECISIONS="${KEEP_DECISIONS:-30}"

DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

# v2 adaptation: this script now ships as ${CLAUDE_PLUGIN_ROOT}/housekeeping/
# rotate-state.sh — the old BASH_SOURCE-relative fallback (.../../../..) assumed
# a fixed depth under a consumer's own .claude/framework/ tree and would resolve
# into the plugin cache instead of the project when git is unavailable. Root now
# resolves via the harness-provided CLAUDE_PROJECT_DIR first, then git, then cwd.
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

PY="$(command -v python3 || command -v python || true)"
[ -n "$PY" ] && "$PY" -c 'import sys' >/dev/null 2>&1 || {
  echo "rotate-state: python3 required (block-parsing + conservation) — not found." >&2
  exit 2
}

mkdir -p "$ROOT/.claude/archive" 2>/dev/null

ROOT="$ROOT" DRY="$DRY" KEEP_TASKS_DONE="$KEEP_TASKS_DONE" KEEP_DECISIONS="$KEEP_DECISIONS" \
"$PY" - "$@" <<'PYEOF'
import os, re, io, sys, datetime

ROOT = os.environ["ROOT"]
DRY  = os.environ.get("DRY") == "1"
KEEP_TASKS_DONE = int(os.environ.get("KEEP_TASKS_DONE", "10"))
KEEP_DECISIONS  = int(os.environ.get("KEEP_DECISIONS", "30"))
STAMP = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def read(p):
    with io.open(p, encoding="utf-8") as f:
        return f.read().splitlines(keepends=True)

def atomic_write(path, text):
    tmp = path + ".rot.tmp"
    with io.open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    os.replace(tmp, path)

def append_archive(path, header, blocks_text):
    # Archive is append-only; create with a header on first use.
    existing = ""
    if os.path.exists(path):
        with io.open(path, encoding="utf-8") as f:
            existing = f.read()
    else:
        existing = header
    if not existing.endswith("\n"):
        existing += "\n"
    atomic_write(path, existing + blocks_text)

def ensure_pointer(lines, archive_rel):
    # Idempotent: add a pointer line right after the H1 title if absent.
    joined = "".join(lines)
    if ("Archived entries: %s" % archive_rel) in joined:
        return lines
    for i, l in enumerate(lines):
        if l.startswith("# "):
            ptr = "\n> Archived entries: %s (rotated %s)\n" % (archive_rel, STAMP)
            return lines[:i+1] + [ptr] + lines[i+1:]
    return lines

report = []

# ---------- TASKS.md : archive Done entries beyond the newest KEEP ----------
def rotate_tasks():
    live = os.path.join(ROOT, ".claude", "TASKS.md")
    arch = os.path.join(ROOT, ".claude", "archive", "TASKS-archive.md")
    arch_rel = ".claude/archive/TASKS-archive.md"
    lines = read(live)
    is_entry = lambda l: l.startswith("#### [")
    is_h4    = lambda l: l.startswith("#### ")
    is_h3    = lambda l: l.startswith("### ")
    is_h2    = lambda l: l.startswith("## ")   # lane heading (## Feature/Bug-Fix Lane)
    orig_headings = sorted(l for l in lines if is_entry(l))

    kept, arch_blocks = [], []
    i, n = 0, len(lines)
    section = ""
    done_seen = 0
    while i < n:
        l = lines[i]
        if is_h2(l):
            section = ""   # lane boundary — a stale ### Done must not leak across lanes
            kept.append(l); i += 1; continue
        if is_h3(l):
            section = l.strip()
            kept.append(l); i += 1; continue
        if is_entry(l):
            j = i + 1
            while j < n and not is_h4(lines[j]) and not is_h3(lines[j]) and not is_h2(lines[j]):
                j += 1
            block = lines[i:j]
            if "Done" in section:
                done_seen += 1
                (kept if done_seen <= KEEP_TASKS_DONE else arch_blocks).extend(block)
            else:
                kept.extend(block)
            i = j; continue
        kept.append(l); i += 1

    new_headings = sorted([l for l in kept if is_entry(l)] + [l for l in arch_blocks if is_entry(l)])
    assert new_headings == orig_headings, "TASKS conservation FAILED (heading multiset changed)"

    archived_ct = sum(1 for l in arch_blocks if is_entry(l))
    kept_ct     = sum(1 for l in kept if is_entry(l))
    report.append("TASKS.md: %d entries total, %d Done seen -> keep %d inline, archive %d Done"
                  % (len(orig_headings), done_seen, kept_ct, archived_ct))
    report.append("  conservation: OK (%d headings preserved)" % len(orig_headings))
    if not DRY and archived_ct:
        header = "# TASKS Archive (verbatim, append-only) - rotated out of .claude/TASKS.md\n"
        append_archive(arch, header, "\n" + "".join(arch_blocks))
        atomic_write(live, "".join(ensure_pointer(kept, arch_rel)))
    return archived_ct

# ---------- DECISIONS.md : archive entries beyond the newest KEEP ----------
def rotate_decisions():
    live = os.path.join(ROOT, ".claude", "DECISIONS.md")
    arch = os.path.join(ROOT, ".claude", "archive", "DECISIONS-archive.md")
    arch_rel = ".claude/archive/DECISIONS-archive.md"
    lines = read(live)
    is_entry = lambda l: bool(re.match(r'^## (?:2\d{3}-|DEC-)', l))
    is_h2    = lambda l: l.startswith("## ")
    orig_headings = sorted(l for l in lines if is_entry(l))

    kept, arch_blocks = [], []
    i, n = 0, len(lines)
    seen = 0
    while i < n:
        l = lines[i]
        if is_entry(l):
            j = i + 1
            while j < n and not is_h2(lines[j]):
                j += 1
            block = lines[i:j]
            seen += 1
            (kept if seen <= KEEP_DECISIONS else arch_blocks).extend(block)
            i = j; continue
        kept.append(l); i += 1

    new_headings = sorted([l for l in kept if is_entry(l)] + [l for l in arch_blocks if is_entry(l)])
    assert new_headings == orig_headings, "DECISIONS conservation FAILED (heading multiset changed)"

    archived_ct = sum(1 for l in arch_blocks if is_entry(l))
    kept_ct     = sum(1 for l in kept if is_entry(l))
    report.append("DECISIONS.md: %d entries total -> keep %d newest inline, archive %d oldest"
                  % (len(orig_headings), kept_ct, archived_ct))
    report.append("  conservation: OK (%d headings preserved)" % len(orig_headings))
    if not DRY and archived_ct:
        header = "# DECISIONS Archive (verbatim, append-only) - rotated out of .claude/DECISIONS.md\n"
        append_archive(arch, header, "\n" + "".join(arch_blocks))
        atomic_write(live, "".join(ensure_pointer(kept, arch_rel)))
    return archived_ct

try:
    t = rotate_tasks()
    d = rotate_decisions()
except AssertionError as e:
    print("rotate-state: ABORT — %s. Nothing written." % e, file=sys.stderr)
    sys.exit(3)

print(("DRY RUN - " if DRY else "") + "rotate-state summary:")
for r in report:
    print("  " + r)
print("  total archived: %d TASKS Done + %d DECISIONS" % (t, d))
if DRY:
    print("  (dry run - no files changed)")
PYEOF
rc=$?
[ "$rc" -eq 0 ] && [ "$DRY" -eq 0 ] && echo "rotate-state: done. Review 'git diff' + the new .claude/archive/ files, then commit."
exit $rc
