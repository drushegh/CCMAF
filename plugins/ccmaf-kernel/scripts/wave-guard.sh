#!/usr/bin/env bash
# ccmaf-kernel PreToolUse(Bash|PowerShell|Monitor) hook — OPT-IN "wave mode"
# (fleet audit 2026-10-12, K3/C1).
#
# Parallel build waves share ONE working tree. A worker's `git stash` once
# wiped three agents' uncommitted work; `git add -A` swept sibling workers'
# files into the wrong commit. While MORE THAN ONE /ccmaf:build dispatch
# marker is armed (.claude/telemetry/.task-dispatch.<ID>, the same markers
# the core task-budget-counter reads), this hook denies the tree-sweeping
# git commands — a SUBSET of the shared-tree rules in behavioral-principles §8
# (the doctrine is the full list; this screens the commonest sweeps):
#   git stash (except `stash list` / `stash show`), git checkout with a `--`
#   pathspec or `.`, git restore (except `--staged`-only), git reset --hard,
#   git clean (except `-n` / `--dry-run`), git add -A / --all / -u /
#   --update / ., git commit -a / --all (incl. bundled short flags: -am)
# The hook cannot tell a worker's call from the orchestrator's — the
# orchestrator must not sweep the tree mid-wave either (it stages explicit
# paths and commits with `git add -- <paths> && git commit -- <paths>`).
#
# Opt-in: CCMAF_WAVE_GUARD=1 in the environment (e.g. the project's
# .claude/settings.json "env" block). Unset/other -> silent no-op, stdin
# unread. Markers older than 2 days are orphans (the core counter sweeps
# them) and are not counted. Heuristic defence in depth, not a security
# boundary: it screens each `;`/`&&`/`||`/`|`/newline segment that starts
# with `git`, so a git command hidden inside `bash -c` or a script runs.
# Heredoc bodies (`<<EOF` ... `EOF`, e.g. a commit message fed on stdin) are
# dropped before screening: they are data, not commands.
set -u

[ "${CCMAF_WAVE_GUARD:-}" = "1" ] || exit 0

tdir="${CLAUDE_PROJECT_DIR:-.}/.claude/telemetry"
[ -d "$tdir" ] || exit 0
armed=$(find "$tdir" -maxdepth 1 -name '.task-dispatch.*' ! -mtime +2 2>/dev/null | wc -l | tr -d ' ')
[ "${armed:-0}" -gt 1 ] 2>/dev/null || exit 0

payload=$(cat)
cmd=""
if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null) || cmd=""
fi
if [ -z "$cmd" ]; then
  # No jq (or it failed): pull the JSON string value of "command" and undo
  # the common escapes. Good enough for a heuristic token match.
  cmd=$(printf '%s' "$payload" | tr '\n' ' ' \
    | sed -nE 's/.*"command"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)".*/\1/p')
  cmd=${cmd//\\n/$'\n'}
  cmd=${cmd//\\\"/\"}
fi
[ -n "$cmd" ] || exit 0

# Drop heredoc bodies: after a line carrying `<<WORD` / `<<-WORD` (quoted or
# not; `<<<` here-strings excluded), skip lines up to the closing WORD line.
# No awk -> screen the command unstripped (fail closed, not open).
# shellcheck disable=SC2016 # awk program, not shell expansion
stripped=$(printf '%s\n' "$cmd" | awk '
  hd != "" { t = $0; if (strip) sub(/^\t+/, "", t); if (t == hd) hd = ""; next }
  { print
    if (match($0, /(^|[^<])<<-?[ \t]*[\047"\\]?[A-Za-z_][A-Za-z0-9_]*/)) {
      tok = substr($0, RSTART, RLENGTH); sub(/^[^<]/, "", tok)
      strip = (tok ~ /^<<-/); sub(/^<<-?[ \t]*[\047"\\]?/, "", tok); hd = tok
    }
  }' 2>/dev/null) && cmd=$stripped

# One segment per line; normalise `git <global opts> sub` to `git sub`.
segments=$(printf '%s\n' "$cmd" | tr ';&|' '\n' \
  | sed -E 's/^[[:space:]]+//; s/^\(+//' \
  | sed -E 's/^git(\.exe)?(([[:space:]]+(-C|-c)[[:space:]]+[^[:space:]]+)|([[:space:]]+--[A-Za-z-]+(=[^[:space:]]*)?))*[[:space:]]+/git /')

hit=""
while IFS= read -r seg; do
  seg=${seg%$'\r'}
  case "$seg" in git\ *) ;; *) continue ;; esac
  if printf '%s' "$seg" | grep -Eq '^git stash([[:space:]]|$)' \
     && ! printf '%s' "$seg" | grep -Eq '^git stash[[:space:]]+(list|show)([[:space:]]|$)'; then
    hit="git stash"
  elif printf '%s' "$seg" | grep -Eq '^git checkout([[:space:]]+[^[:space:]]+)*[[:space:]]+(--|\.)([[:space:]]|$)'; then
    hit="git checkout -- <paths> / git checkout ."
  elif printf '%s' "$seg" | grep -Eq '^git restore([[:space:]]|$)' \
     && ! { printf '%s' "$seg" | grep -Eq '[[:space:]](--staged|-S)([[:space:]]|$)' \
            && ! printf '%s' "$seg" | grep -Eq '[[:space:]](--worktree|-W)([[:space:]]|$)'; }; then
    hit="git restore (worktree)"
  elif printf '%s' "$seg" | grep -Eq '^git reset([[:space:]]+[^[:space:]]+)*[[:space:]]+--hard([[:space:]]|$)'; then
    hit="git reset --hard"
  elif printf '%s' "$seg" | grep -Eq '^git clean([[:space:]]|$)' \
     && ! printf '%s' "$seg" | grep -Eq '[[:space:]](-[A-Za-z]*n[A-Za-z]*|--dry-run)([[:space:]]|$)'; then
    hit="git clean"
  elif printf '%s' "$seg" | grep -Eq '^git add([[:space:]]+[^[:space:]]+)*[[:space:]]+(-A|--all|-u|--update|\.)([[:space:]]|$)'; then
    hit="git add -A / --all / -u / ."
  elif printf '%s' "$seg" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g" \
       | grep -Eq '^git commit([[:space:]]+[^[:space:]]+)*[[:space:]]+(-[A-Za-z]*a[A-Za-z]*|--all)([[:space:]]|$)'; then
    hit="git commit -a / --all"
  fi
  [ -n "$hit" ] && break
done <<EOF
$segments
EOF

[ -n "$hit" ] || exit 0
echo "BLOCKED by ccmaf-kernel wave mode: '$hit' sweeps the shared working tree while $armed build dispatches are armed (CCMAF_WAVE_GUARD=1). Other agents' uncommitted work lives in this tree. Use read-only git (status/diff/log/show), stage explicit paths (git add -- <file>), and leave commits to the orchestrator (git add -- <paths> && git commit -- <paths>). No wave actually running? Stale markers are the cause: remove the finished tasks' $tdir/.task-dispatch.* files." >&2
exit 2
