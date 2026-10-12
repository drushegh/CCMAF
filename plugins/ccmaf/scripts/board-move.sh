#!/usr/bin/env bash
# board-move.sh — move ONE task block between `###` status sections of
# .claude/TASKS.md, non-interactively and safely (fleet audit 2026-10-12, C2/C11).
#
#   board-move.sh <ID> <section> [--file PATH] [--lane NAME] [--bottom]
#
#   <ID>       TASK-N / BUG-N (the bracketed heading id: `#### [TASK-N] ...`)
#   <section>  target `###` heading text, e.g. "Ready for Review". Exact match
#              first; else a UNIQUE prefix match ("Todo" -> "Todo (Priority Order)").
#   --file     board path (default: $CLAUDE_PROJECT_DIR/.claude/TASKS.md, else ./.claude/TASKS.md)
#   --lane     `##` lane to search for <section> (heading-text prefix, e.g. "Bug").
#              Default: the lane the block currently sits in — section names like
#              "Verify"/"Done" repeat across lanes, so the search never leaves it.
#   --bottom   insert after the section's last block (default: top of section)
#
# Why a parser and not sed/slicing: in-place line edits keyed on an empty
# variable wiped a whole board; `index('### Verify')` slicing hit the wrong
# lane; regex/heredoc rewrites mangled CRLF boards. This script parses blocks
# by ID (skipping HTML comments and code fences), re-emits the skeleton
# untouched, keeps every line's original ending, and REFUSES (non-zero, file
# untouched) on a missing/duplicate ID, a missing/ambiguous section, a board
# shape it cannot bound safely (unclosed fence/comment at EOF; a non-task ####
# heading, or body text after a --- rule, right behind the block), or any
# post-move integrity mismatch (block count, non-blank line multiset, landing
# section). The write is atomic (temp file in the same dir + mv).
#
# Exit: 0 moved (or already there), 2 usage, 3 id not found/duplicate,
#       4 section not found/ambiguous, 5 unsafe board shape or integrity
#       check failed (no write).
set -euo pipefail

usage() { sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; }
die() { local code="$1"; shift; echo "board-move: $*" >&2; exit "$code"; }

id="" target="" file="" lane="" position="top"
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --file) [ $# -ge 2 ] || die 2 "--file needs a value"; file="$2"; shift 2 ;;
    --lane) [ $# -ge 2 ] || die 2 "--lane needs a value"; lane="$2"; shift 2 ;;
    --bottom) position="bottom"; shift ;;
    --top) position="top"; shift ;;
    -*) die 2 "unknown option: $1" ;;
    *)
      if [ -z "$id" ]; then id="$1"
      elif [ -z "$target" ]; then target="$1"
      else die 2 "unexpected argument: $1"; fi
      shift ;;
  esac
done
[ -n "$id" ] && [ -n "$target" ] || { usage >&2; exit 2; }
case "$id" in
  TASK-[0-9]*|BUG-[0-9]*) ;;
  *) die 2 "id must look like TASK-N or BUG-N (got '$id')" ;;
esac
case "$id" in *[!A-Za-z0-9._-]*) die 2 "id has invalid characters: '$id'" ;; esac

[ -n "$file" ] || file="${CLAUDE_PROJECT_DIR:-.}/.claude/TASKS.md"
[ -f "$file" ] || die 2 "board not found: $file"

# Line ending for the separator lines this script inserts (moved lines keep
# their own bytes). Passed to awk as an escape string: a literal newline in
# a -v assignment is not portable across awks.
eol='\n'
if head -n 1 "$file" | grep -q $'\r$'; then eol='\r\n'; fi

# The parser. mode=where prints "<lane>\t<section>" of the id's block;
# mode=move prints the rewritten board on stdout and one status line on
# stderr ("STATUS:<code>:<msg>"). POSIX awk only (mawk/gawk/busybox).
# shellcheck disable=SC2016 # awk program, not shell expansion
AWK_PROG='
function trimcr(s) { sub(/\r$/, "", s); return s }
function isblank(s) { return s ~ /^[ \t]*$/ }
# badtail(k): "" when block k is cleanly bounded, else why it is not. Past the
# block (blanks and column-0 comment spans skipped) must come a heading, EOF,
# or a --- rule that is itself followed by a heading/EOF. A non-task ####
# heading, or body text after a ---, means the block was cut short mid-body:
# moving it would strand the rest in the old section while every integrity
# check still passes.
function badtail(k,   j, d) {
  j = blkend[k] + 1; d = 0
  while (j <= n) {
    if (isblank(c[j])) { j++; continue }
    if (cstart[j]) { j = cend[j] + 1; continue }
    if (lvl[j] == -1 && !d) { d = 1; j++; continue }
    break
  }
  if (j > n || lvl[j] == -1 || (lvl[j] >= 1 && lvl[j] <= 3)) return ""
  if (lvl[j] == 4 && c[j] ~ /^#### \[(TASK|BUG)-[^]]+\]/) return ""
  if (lvl[j] == 4) return "a non-task heading (line " j ": " c[j] ") follows " blkid[k] " - it would be cut off the block"
  return "body text (line " j ") follows a --- rule after " blkid[k] " - the block looks cut short"
}
{ raw[NR] = $0; c[NR] = trimcr($0) }
END {
  n = NR; inc = 0; inf = 0; curlane = ""; cursec = ""; cursecline = 0
  nsec = 0; nblk = 0; hit = 0
  for (i = 1; i <= n; i++) {
    s = c[i]; lvl[i] = 0; cstart[i] = 0
    if (inc) { if (index(s, "-->")) inc = 0; continue }
    if (inf) { if (s ~ /^[ \t]*(```|~~~)/) inf = 0; continue }
    if (s ~ /^[ \t]*(```|~~~)/) { inf = 1; continue }
    if (s ~ /^<!--/) {
      cstart[i] = 1
      rest = substr(s, 5)
      if (!index(rest, "-->")) inc = 1
      cend[i] = i
      if (inc) { for (k = i + 1; k <= n; k++) if (index(c[k], "-->")) { cend[i] = k; break } }
      continue
    }
    if (s ~ /^---[ \t]*$/) { lvl[i] = -1; continue }
    if (s ~ /^##? /) { lvl[i] = (s ~ /^# /) ? 1 : 2; if (lvl[i] == 2) curlane = substr(s, 4); cursec = ""; cursecline = 0; continue }
    if (s ~ /^### /) {
      lvl[i] = 3; cursec = substr(s, 5); cursecline = i
      nsec++; secline[nsec] = i; secname[nsec] = cursec; seclane[nsec] = curlane
      continue
    }
    if (s ~ /^#### /) {
      lvl[i] = 4
      if (s ~ /^#### \[(TASK|BUG)-[^]]+\]/) {
        bid = substr(s, 7); bid = substr(bid, 1, index(bid, "]") - 1)
        nblk++; blkline[nblk] = i; blkid[nblk] = bid; blksec[nblk] = cursecline; blklane[nblk] = curlane
        if (bid == ID) { hit++; hitk = nblk }
      }
      continue
    }
  }
  if (inc || inf) { print "STATUS:5:unclosed " (inf ? "code fence" : "HTML comment") " runs to end of board - it hides every heading after it; close it first" > "/dev/stderr"; exit 5 }
  if (hit == 0) { print "STATUS:3:id " ID " not found" > "/dev/stderr"; exit 3 }
  if (hit > 1) { print "STATUS:3:id " ID " appears " hit " times - fix the duplicate first" > "/dev/stderr"; exit 3 }

  # block extent: heading .. before next heading(level 1-4) or hr; trim
  # trailing blanks and trailing column-0 comment spans (section notes).
  for (k = 1; k <= nblk; k++) {
    s0 = blkline[k]; e = n
    for (j = s0 + 1; j <= n; j++) if (lvl[j] != 0) { e = j - 1; break }
    changed = 1
    while (changed) {
      changed = 0
      while (e > s0 && isblank(c[e])) { e--; changed = 1 }
      if (e > s0 && index(c[e], "-->")) {
        for (j = e; j > s0; j--) if (cstart[j] && cend[j] == e) break
        if (j > s0 && isblank(c[j - 1])) { e = j - 1; changed = 1 }
      }
    }
    blkend[k] = e
  }

  if (MODE == "where") { printf "%s\t%s\n", blklane[hitk], (blksec[hitk] ? substr(c[blksec[hitk]], 5) : ""); exit 0 }

  wantlane = (LANE != "") ? LANE : blklane[hitk]
  tsec = 0; tcount = 0
  for (k = 1; k <= nsec; k++) {
    if (LANE != "") { if (index(seclane[k], LANE) != 1) continue }
    else if (seclane[k] != wantlane) continue
    if (secname[k] == TARGET) { if (!exact) { tcount = 0; exact = 1 } tsec = k; tcount++ }
    else if (!exact && index(secname[k], TARGET) == 1) {
      nx = substr(secname[k], length(TARGET) + 1, 1)
      if (nx == " " || nx == "(") { tsec = k; tcount++ }
    }
  }
  if (tcount == 0) { print "STATUS:4:section \"### " TARGET "\" not found in lane \"" wantlane "\" (use --lane to pick another)" > "/dev/stderr"; exit 4 }
  if (tcount > 1) { print "STATUS:4:section \"### " TARGET "\" is ambiguous in lane \"" wantlane "\" (" tcount " matches)" > "/dev/stderr"; exit 4 }
  h = secline[tsec]
  if (blksec[hitk] == h) { print "STATUS:0:" ID " already in \"### " secname[tsec] "\" - nothing to do" > "/dev/stderr"; exit 10 }
  why = badtail(hitk)
  if (why != "") { print "STATUS:5:" why " (refusing: fix the board shape first)" > "/dev/stderr"; exit 5 }

  # insertion point p (insert AFTER line p)
  p = h; q = h + 1
  while (q <= n) {
    if (isblank(c[q])) { q++; continue }
    if (cstart[q]) { p = cend[q]; q = cend[q] + 1; continue }
    break
  }
  if (POS == "bottom") {
    anc = 0
    for (k = 1; k <= nblk; k++) if (blksec[k] == h && k != hitk) { p = blkend[k]; anc = k }
    if (anc) { why = badtail(anc); if (why != "") { print "STATUS:5:" why " (refusing: fix the board shape first)" > "/dev/stderr"; exit 5 } }
  }

  rs = blkline[hitk]; re = blkend[hitk]
  while (re + 1 <= n && isblank(c[re + 1])) re++
  for (i = 1; i <= n; i++) {
    if (i >= rs && i <= re) continue
    print raw[i]
    if (i == p) {
      printf "%s", EOL
      for (j = blkline[hitk]; j <= blkend[hitk]; j++) print raw[j]
      if (!(i + 1 <= n && isblank(c[i + 1]) && !(i + 1 >= rs && i + 1 <= re))) printf "%s", EOL
    }
  }
  print "STATUS:0:moved " ID " -> \"### " secname[tsec] "\"" > "/dev/stderr"
}'

run_awk() { # run_awk <mode> <file>
  # BINMODE=3: Git Bash/MSYS gawk otherwise strips CR on read and rewrites a
  # CRLF board as LF (other awks treat it as an unused variable).
  awk -v BINMODE=3 -v ID="$id" -v TARGET="$target" -v LANE="$lane" -v POS="$position" \
      -v EOL="$eol" -v MODE="$1" -v ORS="\n" "$AWK_PROG" "$2"
}

dir=$(dirname -- "$file")
tmp=$(mktemp "$dir/.TASKS.board-move.XXXXXX") || die 5 "cannot create temp file in $dir"
trap 'rm -f -- "$tmp" "$tmp.err"' EXIT

set +e
run_awk move "$file" > "$tmp" 2> "$tmp.err"
rc=$?
set -e
msg=$(sed -n 's/^STATUS:[0-9]*://p' "$tmp.err" | head -n 1)
if [ "$rc" -eq 10 ]; then echo "board-move: $msg"; exit 0; fi
if [ "$rc" -ne 0 ]; then
  [ -n "$msg" ] || msg="parser failed: $(head -n 3 "$tmp.err")"
  case "$rc" in 3|4) ;; *) rc=5 ;; esac
  die "$rc" "$msg (no write)"
fi

# A board without a trailing newline gains one from awk; keep the original
# form (command substitution strips the trailing LF; drop a CR before it).
if [ -n "$(tail -c 1 "$file")" ]; then
  body=$(cat "$tmp")
  printf '%s' "${body%$'\r'}" > "$tmp"
fi

# --- integrity checks: nothing lost, nothing duplicated, landed where asked --
count_blocks() { tr -d '\r' < "$1" | grep -cE '^#### \[(TASK|BUG)-[^]]+\]' || true; }
nonblank_sig() { tr -d '\r' < "$1" | grep -v '^[[:space:]]*$' | LC_ALL=C sort | cksum; }
b0=$(count_blocks "$file"); b1=$(count_blocks "$tmp")
[ "$b0" = "$b1" ] || die 5 "block count changed ($b0 -> $b1) - refusing to write"
[ "$(nonblank_sig "$file")" = "$(nonblank_sig "$tmp")" ] || die 5 "non-blank content changed - refusing to write"
landed=$(run_awk where "$tmp" 2>/dev/null | cut -f2)
case "$landed" in
  "$target"|"$target "*|"$target("*) ;;
  *) die 5 "post-move check: $id landed in '### $landed', expected '### $target' - refusing to write" ;;
esac

mv -f -- "$tmp" "$file"
trap - EXIT
rm -f -- "$tmp.err"
echo "board-move: $msg"
