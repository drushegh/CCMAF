#!/bin/bash
# pattern-scan.sh — Scan framework-owned shell scripts for known
# anti-patterns documented in GOTCHAS.md.
#
# Advisory: always exits 0 (even with findings). Meant to be called
# by /healthcheck or run on demand. Each check is self-contained —
# add new ones by appending a check_* function and calling it in main.
#
# Each pattern here represents a bug class that has bitten us at
# least once. Adding a new pattern when you find a repeat offender
# is the discipline this tool formalises — see GOTCHAS.md entries
# and FRAMEWORK-SUGGESTIONS.md 2026-04-18 "Audit discipline" for
# the rationale.
#
# Exit code: always 0. Finding count is reported on stdout.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

# Scope: framework-owned shell scripts. Hooks + .claude/framework/.
SCAN_PATHS=(".claude/hooks" ".claude/framework" ".claude/skills")

FINDINGS=0

_print_header() {
  echo ""
  echo "=== $1 ==="
}

_report() {
  local file="$1"
  local line="$2"
  local msg="$3"
  echo "  $file:$line — $msg"
  FINDINGS=$((FINDINGS + 1))
}

# Find all *.sh files in scope. Used by every check.
# Excludes pattern-scan.sh itself — the script's regex literals would
# otherwise match as their own findings. If you edit this script and
# suspect a pattern bug inside it, run the check manually.
_sh_files() {
  local paths=("${SCAN_PATHS[@]}")
  local found=()
  for p in "${paths[@]}"; do
    [ -d "$p" ] || continue
    while IFS= read -r f; do
      [[ "$f" == *".claude/framework/audit/pattern-scan.sh" ]] && continue
      found+=("$f")
    done < <(find "$p" -name "*.sh" -type f 2>/dev/null)
  done
  printf '%s\n' "${found[@]}"
}

# ------------------------------------------------------------------
# Check 1 — while-read without CRLF strip (GOTCHAS Windows/CRLF entry)
#
# Any `while IFS= read -r <var>` loop reading a file must strip
# trailing \r on the next (or very near next) line, or values will
# carry a \r on Windows with core.autocrlf=true. Silent failure —
# no match in filesystem, no error.
# ------------------------------------------------------------------
check_crlf_strip() {
  _print_header "while-read loops missing CRLF strip (file reads only)"
  local file line_num varname
  while IFS= read -r file; do
    # Extract each while-read line with its line number and captured variable.
    while IFS=: read -r line_num content; do
      [ -z "$line_num" ] && continue
      varname=$(echo "$content" | sed -nE 's/.*read -r[[:space:]]+([A-Za-z_][A-Za-z0-9_]*).*/\1/p')
      [ -z "$varname" ] && continue

      # Find the matching `done` line (first line starting with `done`
      # after this `while`). Inspect its redirection: process
      # substitution `< <(...)`, heredoc string `<<<`, and piped
      # input are all safe — only file redirects `< "$path"` or
      # `< file` are CRLF-prone.
      # Note: portable awk — \b is a gawk extension that mawk (Git
      # Bash's default) silently mishandles, so we use an explicit
      # non-word-character class.
      local done_line
      done_line=$(awk -v start="$line_num" 'NR > start && /^[[:space:]]*done([^a-zA-Z0-9_]|$)/ { print; exit }' "$file" 2>/dev/null)
      if echo "$done_line" | grep -qE '(< <\(|<<<)'; then
        continue  # process substitution or heredoc — not a file read
      fi
      # If there's no `done <` at all, the while is fed by a pipe
      # upstream (`cmd | while ...`). Pipes from commands don't carry
      # \r on Windows checkouts, so CRLF isn't a concern here either.
      if ! echo "$done_line" | grep -qE 'done[^a-zA-Z0-9_].*<'; then
        continue
      fi

      # This is a real file-redirected read. Check for CRLF strip in
      # the first 3 lines of the loop body.
      local found=0
      local probe next_content
      for probe in 1 2 3; do
        next_content=$(sed -n "$((line_num + probe))p" "$file" 2>/dev/null || true)
        if echo "$next_content" | grep -qE "${varname}=.*%\\\$'\\\\r'"; then
          found=1
          break
        fi
      done
      [ "$found" -eq 0 ] && _report "$file" "$line_num" \
        "\`while IFS= read -r $varname\` reads from a file without CRLF strip — on Windows (core.autocrlf=true) \\r survives. Fix: add \`${varname}=\"\${${varname}%\$'\\\\r'}\"\` on the next line."
    done < <(grep -nE '^[[:space:]]*while IFS= read -r' "$file" 2>/dev/null)
  done < <(_sh_files)
}

# ------------------------------------------------------------------
# Check 2 — grep -c with || echo "0" fallback (GOTCHAS entry)
#
# Pattern: $(grep -c ... || echo "0") produces "0\n0" in the no-match
# case (grep prints its 0, fallback also prints 0). Breaks downstream
# integer comparison. Fix: drop the fallback — grep -c already
# prints 0 on no match.
# ------------------------------------------------------------------
check_grep_c_fallback() {
  _print_header "grep -c with || echo fallback (double-zero bug)"
  while IFS= read -r file; do
    while IFS=: read -r line_num content; do
      [ -z "$line_num" ] && continue
      _report "$file" "$line_num" \
        "\`grep -c\` with \`|| echo 0\` fallback — produces \"0\\n0\" on no match, breaking integer comparisons. Fix: drop \`|| echo 0\` (grep -c already prints 0) OR use \`\${var:-0}\` on the result instead."
    done < <(grep -nE '\$\([^)]*grep -c[^)]*\|\|[[:space:]]*echo[[:space:]]+"?0' "$file" 2>/dev/null || true)
  done < <(_sh_files)
}

# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------
echo "pattern-scan: scanning $(printf '%s ' "${SCAN_PATHS[@]}") for known anti-patterns..."

check_crlf_strip
check_grep_c_fallback

echo ""
if [ "$FINDINGS" -eq 0 ]; then
  echo "pattern-scan: clean. 0 finding(s)."
else
  echo "pattern-scan: $FINDINGS finding(s). Review above."
fi
exit 0
