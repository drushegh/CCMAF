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
# Safety: verbatim only (no rewrite path); BOTH rotations are planned and
#   conservation-checked before ANY write (line multiset conserved or ABORT);
#   after writing, live + archive are re-read from disk and re-verified;
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

# Probe each candidate by EXECUTING it — on Windows `python3` often resolves to the
# Microsoft Store stub (exits 49), so `command -v` alone would pick a dead one (BUG-032).
PY=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import sys' >/dev/null 2>&1; then
    PY="$cand"; break
  fi
done
[ -n "$PY" ] || {
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

# Each plan_* only PLANS (reads + classifies, never writes) so that BOTH
# conservation checks pass before ANY file is touched — an abort in the second
# rotation can then truthfully say "Nothing written".

def entries(lines, is_entry):
    return sorted(l for l in lines if is_entry(l))

# ---------- TASKS.md : archive Done entries beyond the newest KEEP ----------
def plan_tasks():
    live = os.path.join(ROOT, ".claude", "TASKS.md")
    arch = os.path.join(ROOT, ".claude", "archive", "TASKS-archive.md")
    arch_rel = ".claude/archive/TASKS-archive.md"
    lines = read(live)
    is_entry = lambda l: l.startswith("#### [")
    is_h4    = lambda l: l.startswith("#### ")
    is_h3    = lambda l: l.startswith("### ")
    is_h2    = lambda l: l.startswith("## ")   # lane heading (## Feature/Bug-Fix Lane)
    orig_headings = entries(lines, is_entry)

    kept, arch_blocks = [], []
    i, n = 0, len(lines)
    section = ""
    done_seen = 0      # Done entries seen in the CURRENT Done section (keep window is per section)
    done_total = 0
    while i < n:
        l = lines[i]
        if is_h2(l):
            section = ""   # lane boundary — a stale ### Done must not leak across lanes
            done_seen = 0
            kept.append(l); i += 1; continue
        if is_h3(l):
            section = l.strip()
            done_seen = 0  # each Done section (feature lane, bug lane) keeps its own newest KEEP
            kept.append(l); i += 1; continue
        if is_entry(l):
            j = i + 1
            while j < n and not is_h4(lines[j]) and not is_h3(lines[j]) and not is_h2(lines[j]):
                j += 1
            block = lines[i:j]
            if "Done" in section:
                done_seen += 1; done_total += 1
                (kept if done_seen <= KEEP_TASKS_DONE else arch_blocks).extend(block)
            else:
                kept.extend(block)
            i = j; continue
        kept.append(l); i += 1

    # Pre-write conservation: every original LINE (not just headings) lands in
    # exactly one of kept/archive. apply_and_verify() re-checks from disk.
    assert sorted(kept + arch_blocks) == sorted(lines), "TASKS conservation FAILED (line multiset changed)"

    archived_ct = sum(1 for l in arch_blocks if is_entry(l))
    kept_ct     = sum(1 for l in kept if is_entry(l))
    report.append("TASKS.md: %d entries total, %d Done seen -> keep %d inline, archive %d Done"
                  % (len(orig_headings), done_total, kept_ct, archived_ct))
    report.append("  conservation: OK (%d headings preserved)" % len(orig_headings))
    return dict(name="TASKS", live=live, arch=arch, arch_rel=arch_rel, kept=kept,
                arch_blocks=arch_blocks, is_entry=is_entry, orig=orig_headings,
                archived_ct=archived_ct,
                header="# TASKS Archive (verbatim, append-only) - rotated out of .claude/TASKS.md\n")

# ---------- DECISIONS.md : archive entries beyond the newest KEEP ----------
def plan_decisions():
    live = os.path.join(ROOT, ".claude", "DECISIONS.md")
    arch = os.path.join(ROOT, ".claude", "archive", "DECISIONS-archive.md")
    arch_rel = ".claude/archive/DECISIONS-archive.md"
    lines = read(live)
    is_entry = lambda l: bool(re.match(r'^## (?:2\d{3}-|DEC-)', l))
    is_h2    = lambda l: l.startswith("## ")
    orig_headings = entries(lines, is_entry)

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

    assert sorted(kept + arch_blocks) == sorted(lines), "DECISIONS conservation FAILED (line multiset changed)"

    archived_ct = sum(1 for l in arch_blocks if is_entry(l))
    kept_ct     = sum(1 for l in kept if is_entry(l))
    report.append("DECISIONS.md: %d entries total -> keep %d newest inline, archive %d oldest"
                  % (len(orig_headings), kept_ct, archived_ct))
    report.append("  conservation: OK (%d headings preserved)" % len(orig_headings))
    return dict(name="DECISIONS", live=live, arch=arch, arch_rel=arch_rel, kept=kept,
                arch_blocks=arch_blocks, is_entry=is_entry, orig=orig_headings,
                archived_ct=archived_ct,
                header="# DECISIONS Archive (verbatim, append-only) - rotated out of .claude/DECISIONS.md\n")

def apply_and_verify(p):
    # Archive BEFORE live (a crash duplicates an entry — recoverable — never loses it).
    arch_text = "\n" + "".join(p["arch_blocks"])
    append_archive(p["arch"], p["header"], arch_text)
    atomic_write(p["live"], "".join(ensure_pointer(p["kept"], p["arch_rel"])))
    # Post-write conservation, read back FROM DISK (not from the in-memory
    # partition): live holds exactly the kept entries, the archive ends with
    # exactly the moved blocks, and together they are the original heading multiset.
    with io.open(p["arch"], encoding="utf-8", newline="") as f:
        arch_now = f.read()
    live_heads  = entries(read(p["live"]), p["is_entry"])
    moved_heads = entries(p["arch_blocks"], p["is_entry"])
    if not arch_now.endswith(arch_text):
        raise RuntimeError("%s archive does not end with the rotated blocks" % p["name"])
    if live_heads != entries(p["kept"], p["is_entry"]):
        raise RuntimeError("%s live file headings differ from the planned keep set" % p["name"])
    if sorted(live_heads + moved_heads) != p["orig"]:
        raise RuntimeError("%s live+archive headings != original heading multiset" % p["name"])

try:
    plans = [plan_tasks(), plan_decisions()]
except AssertionError as e:
    print("rotate-state: ABORT — %s. Nothing written." % e, file=sys.stderr)
    sys.exit(3)

if not DRY:
    wrote = False
    for p in plans:
        if not p["archived_ct"]:
            continue
        try:
            apply_and_verify(p)
            wrote = True
        except Exception as e:
            print("rotate-state: POST-WRITE VERIFY FAILED — %s. Inspect 'git diff' on "
                  ".claude/%s.md and %s before committing (archive-first ordering means "
                  "nothing was lost, but an entry may be duplicated)." % (e, p["name"], p["arch_rel"]),
                  file=sys.stderr)
            sys.exit(4)
    if wrote:
        report.append("  post-write verify: OK (live + archive re-read from disk)")

t, d = plans[0]["archived_ct"], plans[1]["archived_ct"]
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
