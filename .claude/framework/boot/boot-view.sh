#!/usr/bin/env bash
set -uo pipefail
# boot-view.sh — stateless cold-start view generator (OPT P2, TASK-138).
#
# Emits (to STDOUT ONLY, never a file) the exact slices the cold-start spec
# already mandates — non-Done tasks (with their lifecycle sections), current
# STATUS, the 10 newest decisions, and the progress head — so the model reads ONE
# compact view instead of paging 4 large files. Regenerated every boot; NEVER
# persisted → no staleness surface, no second source of truth (the round-2
# cross-review's rule: a stateless view kills staleness; extraction-completeness
# verification kills silent omission — you need BOTH).
#
# FAIL-CLOSED completeness: for TASKS, two INDEPENDENT counts (entries in the
# emitted view + Done entries counted by a separate pass) must sum to the file's
# total; IDs must be unique. Any anomaly prints ONE line to stderr and exits 2 —
# the caller then falls back to the full-file reads. Dependency-light (awk/grep/
# sed only — runs every cold start). CRLF-tolerant.
#
# SHADOW MODE: built, but the cold-start (CLAUDE.framework.md) is NOT switched to
# it — the flip needs a multi-session shadow soak (see shadow-compare.sh).

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" \
  || ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
S="$ROOT/.claude"

fail() { printf 'BOOT VIEW INCOMPLETE (%s) — fall back to full-file reads.\n' "$1" >&2; exit 2; }
_sha()   { { sha256sum "$1" 2>/dev/null || shasum -a 256 "$1" 2>/dev/null; } | awk '{print $1; exit}'; }
_bytes() { wc -c < "$1" 2>/dev/null | tr -d ' '; }
_cat()   { tr -d '\r' < "$1"; }   # CRLF-tolerant read to stdout

TASKS="$S/TASKS.md"; STATUS="$S/STATUS.md"; DEC="$S/DECISIONS.md"; PROG="$S/claude-progress.txt"

# ---------------- PROVENANCE ----------------
printf '## BOOT VIEW — generated %s (stateless; the disk files remain canonical)\n\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '## PROVENANCE\n'
for f in "$TASKS" "$STATUS" "$DEC" "$PROG"; do
  [ -f "$f" ] && printf -- '- %s  %sB  sha256:%s\n' "${f#"$ROOT"/}" "$(_bytes "$f")" "$(_sha "$f")"
done
printf '\n'

# ---------------- TASKS: all non-Done entries (with sections), verbatim ----------------
if [ -f "$TASKS" ]; then
  total=$(grep -cE '^#### \[' "$TASKS" 2>/dev/null); total=${total:-0}
  # Emit: keep every frame line + heading + non-Done entry block; drop Done-section
  # entry blocks. Block-end stops at #### / ### / ## (so a ## lane heading is never
  # swallowed — same fix rotate-state.sh needed).
  out=$(_cat "$TASKS" | awk '
    function isentry(l){ return l ~ /^#### \[/ }
    function ish4(l){ return l ~ /^#### / }
    function ish3(l){ return l ~ /^### / }
    function ish2(l){ return l ~ /^## / }
    { lines[NR]=$0 }
    END{
      n=NR; sec=""
      for(i=1;i<=n;i++){
        l=lines[i]
        if(ish2(l)){ sec=""; print l; continue }
        if(ish3(l)){ sec=l;  print l; continue }
        if(isentry(l)){
          j=i+1; while(j<=n && !ish4(lines[j]) && !ish3(lines[j]) && !ish2(lines[j])) j++
          if(index(sec,"Done")==0){ for(k=i;k<j;k++) print lines[k] }
          i=j-1; continue
        }
        print l
      }
    }')
  sel=$(printf '%s\n' "$out" | grep -cE '^#### \['); sel=${sel:-0}
  # Independent Done-entry count (a second derivation — must reconcile with total).
  exc=$(_cat "$TASKS" | awk '
    function isentry(l){ return l ~ /^#### \[/ }
    function ish3(l){ return l ~ /^### / }
    function ish2(l){ return l ~ /^## / }
    { if(ish2($0)){sec="";next} if(ish3($0)){sec=$0;next} if(isentry($0) && index(sec,"Done")>0) c++ }
    END{ print c+0 }')
  exc=${exc:-0}
  [ $((sel + exc)) -eq "$total" ] || fail "TASKS count: view $sel + Done $exc != total $total"
  # Duplicate-HEADING check only (a prose body reference like "supersedes
  # [TASK-071]" is NOT a duplicate — match the heading-scoped form, as doctor Check 6 does).
  dupe=$(grep -oE '^#### \[(TASK|BUG)-[0-9]+\]' "$TASKS" | grep -oE '\[(TASK|BUG)-[0-9]+\]' | sort | uniq -d | head -1)
  [ -z "$dupe" ] || fail "duplicate task heading id $dupe"
  printf '## TASKS (%d non-Done of %d entries; %d Done omitted — see .claude/archive)\n\n' "$sel" "$total" "$exc"
  printf '%s\n\n' "$out"
fi

# ---------------- STATUS: current snapshot (whole file) ----------------
if [ -f "$STATUS" ]; then
  printf '## STATUS (current, verbatim)\n\n'; _cat "$STATUS"; printf '\n\n'
fi

# ---------------- DECISIONS: the 10 newest (newest-at-top), verbatim ----------------
if [ -f "$DEC" ]; then
  total=$(grep -cE '^## (2[0-9]{3}-|DEC-)' "$DEC" 2>/dev/null); total=${total:-0}
  out=$(_cat "$DEC" | awk '
    function isentry(l){ return l ~ /^## (2[0-9]{3}-|DEC-)/ }
    function ish2(l){ return l ~ /^## / }
    BEGIN{ seen=0 }
    { lines[NR]=$0 }
    END{
      n=NR
      for(i=1;i<=n;i++){
        if(isentry(lines[i])){
          if(seen>=10) break
          seen++; j=i+1; while(j<=n && !ish2(lines[j])) j++
          for(k=i;k<j;k++) print lines[k]; i=j-1
        }
      }
    }')
  printf '## DECISIONS (10 newest of %d, verbatim — older in .claude/archive)\n\n' "$total"
  printf '%s\n\n' "$out"
fi

# ---------------- PROGRESS: WIP + rolling summary + recent entries ----------------
if [ -f "$PROG" ]; then
  printf '## PROGRESS (head: WIP + rolling summary + recent entries)\n\n'
  _cat "$PROG" | awk '/^### / { h++; if (h>3) exit } { print }'
  printf '\n'
fi

exit 0
