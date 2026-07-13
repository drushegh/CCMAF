#!/usr/bin/env bash
# skills-check.sh — checks the skills upstream for newer content than the
# project's pinned SHA, and notifies if the project's selected skills are
# behind (TASK-043). Completes the skills-sync loop: skills-sync.sh pulls,
# this tells you when there's something to pull.
#
# Runs as part of cold start (alongside check-updates.sh). Silent when the
# project hasn't opted into skills (no .skills-version) or is up to date.
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

# CRLF-safe source (project-owned file; a Windows editor may save CRLF).
# shellcheck disable=SC1090
source <(tr -d '\r' < "$VERSION_FILE")

# No SKILLS_UPSTREAM_URL is a FIRST-CLASS valid state, not a malformed file: the
# project syncs either from a vendored in-repo skills/ (skills-sync bundle mode)
# or, if none, from the public CCMAF catalogue (skills-sync default mode). Neither
# pins a tracked remote here, so there is nothing to poll — skills-check stays
# SILENT rather than nagging. Set an explicit SKILLS_UPSTREAM_URL to opt into
# update checks.
if [ -z "${SKILLS_UPSTREAM_URL:-}" ]; then
  # Clear any flag left over from a prior clone-mode config (this early exit
  # returns before the normal clear-on-up-to-date path below).
  rm -f "$FLAG_FILE"
  exit 0
fi
if [ -z "${SKILLS_UPSTREAM_BRANCH:-}" ]; then
  echo "skills-check: SKILLS_UPSTREAM_URL is set but SKILLS_UPSTREAM_BRANCH is missing — skipping." >&2
  exit 2
fi
SKILLS_PINNED_SHA="${SKILLS_PINNED_SHA:-}"
SKILLS_SELECTED="${SKILLS_SELECTED:-}"
SKILLS_CHECK_INTERVAL_HOURS="${SKILLS_CHECK_INTERVAL_HOURS:-24}"
SKILLS_LAST_CHECKED="${SKILLS_LAST_CHECKED:-1970-01-01T00:00:00Z}"

# Throttle: skip if checked recently.
now_epoch=$(date -u +%s)
# GNU `date -d` and BSD/macOS `date -j -f` parse an ISO ts differently — try
# both so the throttle works off-GNU (else it never throttles → ls-remote every
# cold start).
last_epoch=$(date -u -d "$SKILLS_LAST_CHECKED" +%s 2>/dev/null \
  || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$SKILLS_LAST_CHECKED" +%s 2>/dev/null \
  || echo 0)
interval_seconds=$((SKILLS_CHECK_INTERVAL_HOURS * 3600))
if [ $((now_epoch - last_epoch)) -lt "$interval_seconds" ]; then
  exit 0
fi

# Resolve latest remote SHA (no working tree needed; works for public HTTPS
# + authenticated SSH + local paths).
if ! latest_sha=$(git ls-remote "$SKILLS_UPSTREAM_URL" "refs/heads/$SKILLS_UPSTREAM_BRANCH" 2>/dev/null | awk '{print $1}'); then
  echo "skills-check: unable to reach $SKILLS_UPSTREAM_URL (offline?) — continuing." >&2
  exit 3
fi
if [ -z "$latest_sha" ]; then
  echo "skills-check: branch $SKILLS_UPSTREAM_BRANCH not found on skills upstream — skipping." >&2
  exit 3
fi

# Bump last-checked regardless of the comparison outcome below. Atomic write:
# mktemp alongside the destination so the final `mv` is a same-filesystem rename
# (portable template form — GNU/BSD both accept a full-path X-suffixed template;
# `mktemp -p` is GNU-only).
now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp_version="$(mktemp "$(dirname "$VERSION_FILE")/.skills-version.XXXXXX")"
awk -v now="$now_iso" '
  BEGIN { set = 0 }
  /^SKILLS_LAST_CHECKED=/ { print "SKILLS_LAST_CHECKED=" now; set = 1; next }
  { print }
  END { if (!set) print "SKILLS_LAST_CHECKED=" now }
' "$VERSION_FILE" > "$tmp_version" && mv "$tmp_version" "$VERSION_FILE"

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
- **Selected skills:** ${SKILLS_SELECTED:-(none selected)}

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
