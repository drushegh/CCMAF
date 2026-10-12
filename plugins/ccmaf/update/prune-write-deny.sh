#!/usr/bin/env bash
# prune-write-deny.sh — remove redundant Write(...) permission deny rules
# (TASK-192, BUG-033).
#
# Claude Code prints one startup warning per "Write(path)" permission rule:
# only Edit(path) rules are matched by file permission checks, and Edit rules
# already cover every file-editing tool (Write included). Older CCMAF
# scaffolds shipped 13 Write(...) deny rules, each with an exact Edit(...)
# twin. settings.json is project-owned, so this script is the update path's
# ONE narrow exception to "updates never write settings.json" (DECISIONS
# 2026-10-13): it removes ONLY entries "Write(X)" inside permissions.deny
# whose exact twin "Edit(X)" is in the same deny list. It never adds
# anything and never touches orphan Write rules, allow/ask, hooks, or any
# other key.
#
# Usage: prune-write-deny.sh [--dry-run] [path/to/settings.json]
#        (default: .claude/settings.json, relative to the current directory)
#
# Edit model: line-based, preserving the file's formatting and line endings
# (LF or CRLF). The deny array must be one entry per line; a compact or
# irregular array is REFUSED with a manual instruction rather than guessed
# at. The original and the result are validated as JSON (jq, else node, else
# a conservative structural check); when jq/node is present the parsed
# .permissions.deny must also match exactly what the line scan found. The
# write is atomic (temp file in the same dir + mv). On ANY doubt the file is
# left byte-identical and the script exits 1.
#
# Exit codes: 0 pruned / nothing to prune / settings file missing (silent);
#             1 refused (file untouched); 2 usage error.
# Dependencies: bash + awk/grep; jq or node optional (stronger validation).

set -euo pipefail

usage() {
  sed -n '16,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

DRY_RUN=0
FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "prune-write-deny: unknown option: $1" >&2; usage >&2; exit 2 ;;
    *)
      [ -z "$FILE" ] || { echo "prune-write-deny: only one settings path allowed" >&2; exit 2; }
      FILE="$1" ;;
  esac
  shift
done
FILE="${FILE:-.claude/settings.json}"

# Missing settings.json: nothing to do, silently.
[ -e "$FILE" ] || exit 0

TOK_RE='"(Write|Edit)\(([^"\\]|\\.)*\)"'

# Whole-file twin scan (superset of the deny list) — used as the cheap
# "anything to do?" gate and to name the entries in a manual instruction.
twin_scan() {
  { grep -oE "$TOK_RE" "$FILE" 2>/dev/null || true; } | awk '
    /^"Edit\(/  { e[substr($0, 7)] = 1; next }
    /^"Write\(/ { w[substr($0, 8)] = 1 }
    END { for (k in w) if (k in e) print "\"Write(" k }'
}

TWINS="$(twin_scan)"
if [ -z "$TWINS" ]; then
  echo "prune-write-deny: nothing to prune ($FILE)"
  exit 0
fi

refuse() { # <reason>
  {
    echo "prune-write-deny: $1 — left $FILE untouched."
    echo "  Manual fix: in permissions.deny, delete each \"Write(X)\" entry that has a"
    echo "  matching \"Edit(X)\" entry (Edit rules already cover Write). Candidates:"
    printf '%s\n' "$TWINS" | sed 's/^/    /'
  } >&2
  exit 1
}

if [ ! -f "$FILE" ] || [ -L "$FILE" ]; then
  refuse "not a regular file (symlink or special)"
fi

# json_ok <file>: 0 when the file parses as JSON.
json_ok() {
  if command -v jq >/dev/null 2>&1; then
    jq empty < "$1" >/dev/null 2>&1
    return $?
  fi
  if command -v node >/dev/null 2>&1; then
    node -e 'let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s.replace(/^﻿/,""));}catch(e){process.exit(1)}})' < "$1" >/dev/null 2>&1
    return $?
  fi
  # Conservative structural check: balanced {} / [] outside strings, an
  # object/array at top level with nothing after it, no ",]" / ",}".
  awk '
    BEGIN { d = 0; ins = 0; esc = 0; pend = 0; first = 1; closed = 0; bad = 0 }
    {
      n = length($0)
      for (i = 1; i <= n; i++) {
        c = substr($0, i, 1)
        if (ins) { if (esc) esc = 0; else if (c == "\\") esc = 1; else if (c == "\"") ins = 0; continue }
        if (c == " " || c == "\t" || c == "\r") continue
        if (closed) { bad = 1; continue }
        if (first) { if (c != "{" && c != "[") bad = 1; first = 0 }
        if (pend && (c == "]" || c == "}")) bad = 1
        pend = 0
        if (c == "\"") ins = 1
        else if (c == "{" || c == "[") st[++d] = c
        else if (c == "}") { if (d < 1 || st[d] != "{") bad = 1; else d-- ; if (d == 0) closed = 1 }
        else if (c == "]") { if (d < 1 || st[d] != "[") bad = 1; else d-- ; if (d == 0) closed = 1 }
        else if (c == ",") pend = 1
      }
    }
    END { exit (bad || d != 0 || ins || first) ? 1 : 0 }' "$1"
}

# deny_tokens <file>: the parsed .permissions.deny entries, one JSON-encoded
# string per line. Exit 3 when neither jq nor node is available.
deny_tokens() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.permissions.deny | .[] | tojson' < "$1" 2>/dev/null | tr -d '\r'
    return "${PIPESTATUS[0]}"
  fi
  if command -v node >/dev/null 2>&1; then
    node -e 'let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s.replace(/^﻿/,"")).permissions.deny;if(!Array.isArray(d))process.exit(1);for(const x of d)console.log(JSON.stringify(x))})' < "$1" 2>/dev/null
    return $?
  fi
  return 3
}

json_ok "$FILE" || refuse "the file is not valid JSON"

DIR="$(dirname -- "$FILE")"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/prune-write-deny.XXXXXX")"
OUT=""

trap 'rm -rf -- "$WORK"; [ -z "$OUT" ] || rm -f -- "$OUT"' EXIT

if [ "$DRY_RUN" = 1 ]; then
  OUT_PATH="$WORK/out.json"
else
  # Same-directory temp keeps the final mv an atomic rename; cp -p carries
  # the original file mode over to it.
  OUT="$(mktemp "$DIR/.settings.json.prune.XXXXXX")"
  cp -p -- "$FILE" "$OUT"
  OUT_PATH="$OUT"
fi

endnl=0
[ -n "$(tail -c 1 -- "$FILE")" ] || endnl=1

set +e
# BINMODE=3: gawk on Windows (Git Bash/MSYS) otherwise strips the CR of CRLF
# input lines, silently converting the file to LF. Other awks ignore it.
awk -v BINMODE=3 -v endnl="$endnl" -v rmfile="$WORK/removed" -v tokfile="$WORK/tokens" '
  function trimcr(s) { sub(/\r$/, "", s); return s }
  function fail(msg) { print msg > "/dev/stderr"; rc = 3; exit }
  # ---- pass 1: locate the single deny array and collect its entries ----
  FNR == NR {
    line = trimcr($0)
    if (line ~ /"deny"[ \t]*:/) {
      ndeny++
      if (ndeny > 1) next
      rest = line; sub(/.*"deny"[ \t]*:[ \t]*/, "", rest)
      if (rest == "[") indeny = 1
      else bad = "the deny array is not one entry per line"
      next
    }
    if (indeny) {
      if (line ~ /^[ \t]*\][ \t]*,?[ \t]*$/) { indeny = 0; closed = 1; next }
      if (line ~ /^[ \t]*$/) next
      if (line ~ /^[ \t]*"([^"\\]|\\.)*"[ \t]*,?[ \t]*$/) {
        tok = line; sub(/^[ \t]*/, "", tok); sub(/[ \t]*,?[ \t]*$/, "", tok)
        ent[FNR] = tok; order[++n] = FNR
        if (tok ~ /^"Edit\(/) edit[substr(tok, 7)] = 1
        next
      }
      bad = "the deny array is not one entry per line"
    }
    next
  }
  # ---- decide once, on the first line of pass 2 ----
  !decided {
    decided = 1
    if (ndeny == 0) fail("no \"deny\" array found")
    if (ndeny > 1) fail("more than one \"deny\" key in the file (ambiguous)")
    if (bad != "") fail(bad)
    if (!closed) fail("the deny array is not terminated by its own \"]\" line")
    for (i = 1; i <= n; i++) {
      print ent[order[i]] > tokfile
      t = ent[order[i]]
      if (t ~ /^"Write\(/ && (substr(t, 8) in edit)) { rm[order[i]] = 1; nrm++ }
    }
    close(tokfile)
    if (!nrm) { rc = 4; exit }
    lastkeep = 0
    for (i = n; i >= 1; i--) if (!(order[i] in rm)) { lastkeep = order[i]; break }
    if (lastkeep == order[n]) lastkeep = 0   # original last entry kept: no comma fix
  }
  # ---- pass 2: emit, dropping twins and fixing a now-dangling comma ----
  {
    if (FNR in rm) { print ent[FNR] > rmfile; next }
    out = $0
    if (FNR == lastkeep) {
      cr = ($0 ~ /\r$/) ? "\r" : ""
      out = trimcr($0); sub(/,[ \t]*$/, "", out); out = out cr
    }
    printf "%s%s", (emitted ? "\n" : ""), out
    emitted = 1
  }
  END {
    if (rc) exit rc
    if (!decided) { print "empty file" > "/dev/stderr"; exit 3 }
    if (endnl && emitted) printf "\n"
  }
' "$FILE" "$FILE" > "$OUT_PATH" 2> "$WORK/err"
awk_rc=$?
set -e

case "$awk_rc" in
  0) ;;
  4) echo "prune-write-deny: nothing to prune ($FILE)"; exit 0 ;;
  *) refuse "$(head -n 1 "$WORK/err" 2>/dev/null || echo "line scan failed")" ;;
esac

# Cross-check: when a real parser is available, the entries the line scan
# found must be exactly the parsed .permissions.deny (else we edited the
# wrong array, or the text uses escapes we did not account for).
set +e
deny_tokens "$FILE" > "$WORK/parsed"
dt_rc=$?
set -e
if [ "$dt_rc" -ne 3 ]; then
  [ "$dt_rc" -eq 0 ] || refuse "permissions.deny is missing or not an array"
  cmp -s "$WORK/parsed" "$WORK/tokens" \
    || refuse "the line scan does not match the parsed permissions.deny"
fi

json_ok "$OUT_PATH" || refuse "the edited result would not be valid JSON"

nrm="$(wc -l < "$WORK/removed" | tr -d ' ')"
if [ "$DRY_RUN" = 1 ]; then
  echo "prune-write-deny: would remove $nrm redundant Write(...) deny rule(s) from $FILE (dry run, nothing written):"
  sed 's/^/  - /' "$WORK/removed"
  exit 0
fi

mv -f -- "$OUT" "$FILE"
OUT=""
echo "prune-write-deny: removed $nrm redundant Write(...) deny rule(s) from $FILE (each has an identical Edit(...) twin, which already covers Write):"
sed 's/^/  - /' "$WORK/removed"
exit 0
