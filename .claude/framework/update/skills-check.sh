#!/usr/bin/env bash
# skills-check.sh — checks the skills upstream for newer content than the
# project's pinned SHA, and notifies if the project's selected skills are
# behind (TASK-043). Completes the skills-sync loop: skills-sync.sh pulls,
# this tells you when there's something to pull.
#
# Runs as part of cold start (alongside check-updates.sh). Silent when the
# project hasn't opted into skills (no .skills-version), is in bundle mode,
# or is up to date.
# When behind, writes .claude/.skills-update-available.md for the session
# to surface and offer to run skills-sync.sh.
#
# Mirrors check-updates.sh deliberately — same throttle, same DA-C4 flag
# discipline (the flag is a pending notification: never deleted up front,
# survives throttled runs and network failures, cleared only by a live
# up-to-date check).
#
# Exit codes:
#   0  — up to date / behind (flag written) / throttled / not opted in
#   2  — .skills-version present but malformed
#   3  — network failure (ls-remote unreachable) — flag left intact
#
# Dependencies: git, date. No jq, no curl.

set -uo pipefail

# Portable timeout (review P1): stock macOS ships no GNU `timeout` (only
# Homebrew coreutils' `gtimeout`) and a bare `timeout` there is exit 127 for
# EVERY call.
# (Same helper as the plugin copy / boot/cold-start.sh — keep in sync.)
# Resolve once: timeout -> gtimeout -> a perl fork/alarm
# fallback (kills the child, exits 124 like GNU) -> unbounded.
# (Canonical: hooks/lib/hook-common.sh — sourced when present.)
_hc="$(dirname "${BASH_SOURCE[0]}")/../../hooks/lib/hook-common.sh"
# shellcheck source=/dev/null
[ -f "$_hc" ] && . "$_hc"
if ! declare -F run_tmo >/dev/null 2>&1; then  # standalone: inline copy
# >>> run_tmo
_TMO_BIN=""
if command -v timeout >/dev/null 2>&1; then _TMO_BIN=timeout
elif command -v gtimeout >/dev/null 2>&1; then _TMO_BIN=gtimeout
fi
run_tmo() { # <secs> <cmd> [args...] — exit 124 when killed at the budget
  local secs="$1"; shift
  if [ -n "$_TMO_BIN" ]; then "$_TMO_BIN" "$secs" "$@"; return $?; fi
  if command -v perl >/dev/null 2>&1; then
    # fork+wait (not alarm+exec: an alarm does not survive exec on every
    # platform); the child leads its own process group so on expiry TERM
    # then KILL reach grandchildren too (a surviving grandchild would hold a
    # $(...) pipe open past the budget), and exit 124 like GNU timeout.
    perl -e 'my $t = shift; my $pid = fork; defined $pid or exit 127;
      if (!$pid) { setpgrp(0, 0); exec { $ARGV[0] } @ARGV or exit 127 }
      setpgrp($pid, $pid);
      $SIG{ALRM} = sub { kill "TERM", -$pid; sleep 1; kill "KILL", -$pid; exit 124 };
      alarm $t; waitpid($pid, 0);
      exit(($? & 127) ? 128 + ($? & 127) : $? >> 8)' "$secs" "$@"
    return $?
  fi
  "$@"
}
# <<< run_tmo
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
VERSION_FILE="$PROJECT_ROOT/.claude/.skills-version"
FLAG_FILE="$PROJECT_ROOT/.claude/.skills-update-available.md"
SUGGEST_FLAG="$PROJECT_ROOT/.claude/.skills-suggestion.md"
DECLINED_MARKER="$PROJECT_ROOT/.claude/.skills-declined"
SUGGEST_THROTTLE="$PROJECT_ROOT/.claude/telemetry/.last-skills-suggest"
SKILLS_SUGGEST_INTERVAL_DAYS="${SKILLS_SUGGEST_INTERVAL_DAYS:-7}"

# --- Non-adopter discovery (TASK-044, contract:skills-sync) ------------
# A project that has never opted into skills sync would otherwise NEVER
# learn the skills tier exists (--suggest was gated on .skills-version).
# Once per throttle interval, stack-detect and raise a suggestion flag
# the cold start can surface. Declining permanently is one committed
# marker file; "not now" just deletes the flag.
suggest_discovery() {
  [ -f "$DECLINED_MARKER" ] && return 0   # permanent project-level opt-out
  [ -f "$SUGGEST_FLAG" ] && return 0      # pending notification (DA-C4 discipline)
  if [ -f "$SUGGEST_THROTTLE" ]; then
    local now_e last_e
    now_e=$(date -u +%s)
    last_e=$(date -u -r "$SUGGEST_THROTTLE" +%s 2>/dev/null \
      || stat -c '%Y' "$SUGGEST_THROTTLE" 2>/dev/null || echo 0)
    [ $((now_e - last_e)) -lt $((SKILLS_SUGGEST_INTERVAL_DAYS * 86400)) ] && return 0
  fi
  [ -f "$SCRIPT_DIR/skills-sync.sh" ] || return 0
  local suggest_out names
  suggest_out=$(bash "$SCRIPT_DIR/skills-sync.sh" --suggest 2>/dev/null) || return 0
  names=$(printf '%s\n' "$suggest_out" \
    | sed -n 's/^skills-sync: detected stack suggests skills: //p')
  mkdir -p "$PROJECT_ROOT/.claude/telemetry" 2>/dev/null
  touch "$SUGGEST_THROTTLE" 2>/dev/null || true
  [ -n "$names" ] || return 0             # no detectable stack → stay silent
  cat > "$SUGGEST_FLAG" <<EOF
# Skills Available for This Project

This project's stack matches skills in the CCMAF skills catalogue, but
skills sync is not set up here. Skills give the agent senior-level,
domain-specific engineering standards (loaded only when relevant).

- **Detected stack suggests:** $names
- **Cross-cutting (always worth considering):** secure-development, accessibility-development, read-the-damn-docs

## To set up

Create \`.claude/.skills-version\` listing the ones you want:

    SKILLS_SELECTED="$names"

then run: \`bash .claude/framework/update/skills-sync.sh\` — it fetches the selected
skills from the public CCMAF catalogue into \`.claude/skills/\`.

## Not now

Delete this file: \`rm .claude/.skills-suggestion.md\`
(Re-suggested after $SKILLS_SUGGEST_INTERVAL_DAYS days.)

## Never for this project

\`touch .claude/.skills-declined\` and COMMIT it (it's a project
decision every clone should see), then delete this file.
EOF
  echo "skills-check: this project's stack matches available skills. See $SUGGEST_FLAG."
  return 0
}

# Not opted into skills sync → run discovery (throttled), then done.
if [ ! -f "$VERSION_FILE" ]; then
  suggest_discovery
  exit 0
fi

# DA-C4: do NOT remove the flag up front — an existing flag is a pending,
# unactioned notification. Cleared only by a live up-to-date check below.

# Parsed without sourcing (DA-M12: never execute a config file as shell —
# .skills-version is project-owned and committed, so sourcing it would run
# arbitrary shell from any clone at session start). Pull only the known
# KEY=VALUE fields via kv_file_get (CRLF-safe; quoted values and trailing
# `# comments` handled as its header describes). A key absent from the file leaves any existing
# value (e.g. an env override) untouched.
if ! declare -F kv_file_get >/dev/null 2>&1; then  # standalone: inline copy
# >>> kv_file_get
kv_file_get() { # <file> <KEY> — print KEY's value from a KEY=VALUE file; 1 if absent
  # Never sources the file (it may be project-owned and committed — sourcing
  # would execute arbitrary shell from any clone). CRLF-safe; the LAST
  # assignment wins; an optional `export ` prefix is accepted. A value that
  # starts with a quote runs to its matching close quote (so `KEY="a b"  #
  # note` is `a b`); an unquoted value ends at the first whitespace followed
  # by `#` (`KEY=x   # OPTIONAL` is `x`), trailing whitespace trimmed.
  local _line _val
  _line=$(tr -d '\r' < "$1" 2>/dev/null \
    | grep -E "^[[:space:]]*(export[[:space:]]+)?$2=" | tail -1)
  [ -n "$_line" ] || return 1
  _val="${_line#*=}"
  case "$_val" in
    \"*) _val="${_val#\"}"; _val="${_val%%\"*}" ;;
    \'*) _val="${_val#\'}"; _val="${_val%%\'*}" ;;
    *) _val="${_val%%[[:space:]]#*}"
       _val="${_val%"${_val##*[![:space:]]}"}" ;;
  esac
  printf '%s' "$_val"
}
# <<< kv_file_get
fi
for _sv_key in SKILLS_UPSTREAM_URL SKILLS_UPSTREAM_BRANCH SKILLS_PINNED_SHA \
               SKILLS_SELECTED SKILLS_SECTIONS SKILLS_CHECK_INTERVAL_HOURS SKILLS_LAST_CHECKED; do
  if _sv_val=$(kv_file_get "$VERSION_FILE" "$_sv_key"); then
    printf -v "$_sv_key" '%s' "$_sv_val"
  fi
done
unset _sv_key _sv_val
# A non-numeric interval would break the throttle arithmetic — default 24.
case "${SKILLS_CHECK_INTERVAL_HOURS:-}" in
  ''|*[!0-9]*) SKILLS_CHECK_INTERVAL_HOURS=24 ;;
esac

# No SKILLS_UPSTREAM_URL is a FIRST-CLASS valid state, not a malformed file.
# Resolve the mode exactly as skills-sync.sh does (contract:skills-sync):
#   * BUNDLE mode (a vendored skills/*/SKILL.md tree) — no remote to poll, so
#     stay SILENT and clear any flag left from a prior clone-mode config (this
#     early exit returns before the normal clear-on-up-to-date path below).
#   * DEFAULT mode (neither) — skills-sync pulls the public CCMAF catalogue
#     and pins its real HEAD sha, so poll THAT remote. (This used to stay silent
#     too, so default-mode adopters — the documented default — never got an
#     update notice.)
BUNDLED_SKILLS="$PROJECT_ROOT/skills"
if [ -z "${SKILLS_UPSTREAM_URL:-}" ]; then
  if [ -d "$BUNDLED_SKILLS" ] && compgen -G "$BUNDLED_SKILLS/*/SKILL.md" >/dev/null 2>&1; then
    rm -f "$FLAG_FILE"
    exit 0
  fi
  SKILLS_UPSTREAM_URL="${SKILLS_DEFAULT_UPSTREAM_URL:-https://github.com/drushegh/CCMAF---Skills.git}"
  : "${SKILLS_UPSTREAM_BRANCH:=main}"
fi
if [ -z "${SKILLS_UPSTREAM_BRANCH:-}" ]; then
  echo "skills-check: SKILLS_UPSTREAM_URL is set but SKILLS_UPSTREAM_BRANCH is missing — skipping." >&2
  exit 2
fi
SKILLS_PINNED_SHA="${SKILLS_PINNED_SHA:-}"
SKILLS_SELECTED="${SKILLS_SELECTED:-}"
SKILLS_CHECK_INTERVAL_HOURS="${SKILLS_CHECK_INTERVAL_HOURS:-24}"
SKILLS_LAST_CHECKED="${SKILLS_LAST_CHECKED:-1970-01-01T00:00:00Z}"
# Throttle marker lives in GITIGNORED telemetry, not in .skills-version: the
# pin file is committed, and rewriting SKILLS_LAST_CHECKED there on every
# daily check dirtied the working tree. A legacy SKILLS_LAST_CHECKED line is
# still honoured on read (the later of the two wins) but never written.
CHECK_THROTTLE="$PROJECT_ROOT/.claude/telemetry/.last-skills-check"

# Throttle: skip if checked recently.
now_epoch=$(date -u +%s)
# GNU `date -d` and BSD/macOS `date -j -f` parse an ISO ts differently — try
# both so the throttle works off-GNU (else it never throttles → ls-remote every
# cold start).
last_epoch=$(date -u -d "$SKILLS_LAST_CHECKED" +%s 2>/dev/null \
  || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$SKILLS_LAST_CHECKED" +%s 2>/dev/null \
  || echo 0)
if [ -f "$CHECK_THROTTLE" ]; then
  marker_epoch=$(date -u -r "$CHECK_THROTTLE" +%s 2>/dev/null \
    || stat -c '%Y' "$CHECK_THROTTLE" 2>/dev/null || echo 0)
  [ "$marker_epoch" -gt "$last_epoch" ] && last_epoch="$marker_epoch"
fi
interval_seconds=$((SKILLS_CHECK_INTERVAL_HOURS * 3600))
if [ $((now_epoch - last_epoch)) -lt "$interval_seconds" ]; then
  exit 0
fi

# Resolve latest remote SHA (no working tree needed; works for public HTTPS
# + authenticated SSH + local paths).
if ! latest_sha=$(run_tmo 10 git ls-remote "$SKILLS_UPSTREAM_URL" "refs/heads/$SKILLS_UPSTREAM_BRANCH" 2>/dev/null | awk '{print $1}'); then
  echo "skills-check: unable to reach $SKILLS_UPSTREAM_URL (offline?) — continuing." >&2
  exit 3
fi
if [ -z "$latest_sha" ]; then
  echo "skills-check: branch $SKILLS_UPSTREAM_BRANCH not found on skills upstream — skipping." >&2
  exit 3
fi

# Bump the last-checked marker regardless of the comparison outcome below
# (gitignored telemetry — never the committed .skills-version).
mkdir -p "$(dirname "$CHECK_THROTTLE")" 2>/dev/null
touch "$CHECK_THROTTLE" 2>/dev/null || true

if [ "$latest_sha" = "$SKILLS_PINNED_SHA" ]; then
  rm -f "$FLAG_FILE"   # up to date — clear any stale flag
  exit 0
fi

pinned_short="${SKILLS_PINNED_SHA:0:7}"
[ -z "$pinned_short" ] && pinned_short="(unsynced)"
latest_short="${latest_sha:0:7}"

cat > "$FLAG_FILE" <<EOF
# Skills Update Available

The skills upstream has new content since this project last synced.

- **Pinned:** \`$pinned_short\`
- **Latest:** \`$latest_short\`
- **Upstream:** $SKILLS_UPSTREAM_URL ($SKILLS_UPSTREAM_BRANCH)
- **Selected skills:** ${SKILLS_SELECTED:-(none selected)}${SKILLS_SECTIONS:+ (+ packs: $SKILLS_SECTIONS)}

## To update

Run: \`bash .claude/framework/update/skills-sync.sh\`

This re-syncs the skills named in \`SKILLS_SELECTED\` (in
\`.claude/.skills-version\`) from the upstream above. Skills you have NOT
selected are untouched; local skill dirs are never touched.

To add a skill that's new upstream, add its dir name to \`SKILLS_SELECTED\`
first — \`skills-sync.sh --list\` prints the FULL live catalogue (ground truth;
\`--suggest\` only lists names matching this project's detected stack) — then run
the sync.

## To skip

Delete this file: \`rm .claude/.skills-update-available.md\`
The next cold start re-checks after the throttle interval
(\`SKILLS_CHECK_INTERVAL_HOURS\`, default 24h).
EOF

echo "skills-check: skills update available ($pinned_short → $latest_short). See $FLAG_FILE."
exit 0
