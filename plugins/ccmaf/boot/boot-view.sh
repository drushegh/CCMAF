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
# FAIL-CLOSED completeness: for TASKS, the entry headings in the emitted view must
# EQUAL (same headings, same order) the non-Done entry headings derived by a
# SEPARATE pass (a heading-only shell scan, not the awk emitter), and that pass's
# non-Done + Done counts must sum to the file's total; IDs must be unique. Any
# anomaly prints ONE line to stderr and exits 2 —
# the caller then falls back to the full-file reads. Dependency-light (awk/grep/
# sed only — runs every cold start). CRLF-tolerant.
#
# PROMOTED to primary (v2, CORE-DESIGN §2): core-context.sh's cold-start.sh calls
# this directly. Its fail-closed exit-2 contract is unchanged — cold-start.sh
# converts a non-zero exit into printed content rather than propagating it (the
# SessionStart hook must always exit 0).

# v2 adaptation: the old fallback (git rev-parse, else a BASH_SOURCE-relative
# .../../../..) assumed a fixed depth under a consumer's .claude/framework/
# tree — under the plugin layout that no longer lands on the project.
# CLAUDE_PROJECT_DIR (harness-provided) is now the primary source of truth;
# git/cwd remain fallbacks for a manual, non-hook invocation.
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
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
  # entry blocks. Block-end stops at the next ENTRY heading (#### [) / ### / ## (so
  # a ## lane heading is never swallowed — same fix rotate-state.sh needed). A plain
  # `#### Notes` sub-heading INSIDE an entry is part of that entry, never a boundary —
  # otherwise a Done entry's sub-section body would leak into the view as frame lines.
  out=$(_cat "$TASKS" | awk '
    function isentry(l){ return l ~ /^#### \[/ }
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
          j=i+1; while(j<=n && !isentry(lines[j]) && !ish3(lines[j]) && !ish2(lines[j])) j++
          if(index(sec,"Done")==0){ for(k=i;k<j;k++) print lines[k] }
          i=j-1; continue
        }
        print l
      }
    }')
  sel=$(printf '%s\n' "$out" | grep -cE '^#### \['); sel=${sel:-0}
  # INDEPENDENT derivation (a heading-only shell scan — shares no code with the awk
  # emitter above): the expected non-Done entry headings, in order, and the Done count.
  # The view is then checked against it by IDENTITY, not just by a count that the
  # emitter's own partition would satisfy by construction.
  expected=""; exp_n=0; exc=0; hsec=""
  while IFS= read -r h; do
    case "$h" in
      '#### ['*)
        case "$hsec" in
          *Done*) exc=$((exc + 1)) ;;
          *)      expected="$expected$h"$'\n'; exp_n=$((exp_n + 1)) ;;
        esac ;;
      '### '*) hsec="$h" ;;
      '## '*)  hsec="" ;;
    esac
  done < <(_cat "$TASKS" | grep -E '^(## |### |#### \[)')
  [ $((exp_n + exc)) -eq "$total" ] || fail "TASKS count: non-Done $exp_n + Done $exc != total $total"
  got="$(printf '%s\n' "$out" | grep -E '^#### \[')"$'\n'
  [ "$sel" -eq "$exp_n" ] || fail "TASKS count: view $sel != expected non-Done $exp_n"
  [ "$got" = "$expected" ] || [ "$exp_n" -eq 0 ] || fail "TASKS view entry headings differ from the independent non-Done scan"
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
