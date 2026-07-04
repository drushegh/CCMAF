#!/usr/bin/env bash
# init-framework-version.sh — Bootstrap .framework-version for a project.
#
# Creates .framework-version at the project root so check-updates.sh can
# start tracking upstream. Safe to re-run: refuses to overwrite an
# existing .framework-version unless --force is passed.
#
# Usage:
#   bash .claude/framework/update/init-framework-version.sh
#   bash .claude/framework/update/init-framework-version.sh \
#     --url https://github.com/USER/REPO.git --branch main
#   bash .claude/framework/update/init-framework-version.sh --force
#
# Flags:
#   --url URL            Upstream framework repo URL. Defaults to the
#                        public HTTPS URL of the canonical framework.
#   --branch NAME        Upstream branch. Defaults to main.
#   --interval HOURS     Throttle for update checks. Defaults to 24.
#   --force              Overwrite an existing .framework-version.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
VERSION_FILE="$PROJECT_ROOT/.claude/.framework-version"
GITIGNORE="$PROJECT_ROOT/.gitignore"

DEFAULT_URL="https://github.com/drushegh/CCMAF.git"
url="$DEFAULT_URL"
branch="main"
interval=24
subdir=""
force=0

while [ $# -gt 0 ]; do
  case "$1" in
    --url) url="$2"; shift 2 ;;
    --branch) branch="$2"; shift 2 ;;
    --interval) interval="$2"; shift 2 ;;
    --subdir) subdir="${2%/}"; shift 2 ;;
    --force) force=1; shift ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

if [ -f "$VERSION_FILE" ] && [ $force -eq 0 ]; then
  echo "init-framework-version: $VERSION_FILE already exists. Use --force to overwrite." >&2
  exit 1
fi

echo "init-framework-version: resolving latest SHA for $url ($branch)..."
if ! latest_sha=$(git ls-remote "$url" "refs/heads/$branch" 2>/dev/null | awk '{print $1}'); then
  echo "init-framework-version: failed to reach $url. Check URL/network." >&2
  exit 1
fi
if [ -z "$latest_sha" ]; then
  echo "init-framework-version: branch $branch not found on $url." >&2
  exit 1
fi

now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)

cat > "$VERSION_FILE" <<EOF
# .framework-version — tracks this project's pinned framework version.
# Managed by .claude/framework/update/. Committed to git (so every clone knows
# where upstream is and what SHA they're on).
FRAMEWORK_UPSTREAM_URL=$url
FRAMEWORK_UPSTREAM_BRANCH=$branch
FRAMEWORK_PINNED_SHA=$latest_sha
FRAMEWORK_LAST_CHECKED=$now_iso
FRAMEWORK_CHECK_INTERVAL_HOURS=$interval
# FRAMEWORK_SOURCE_SUBDIR — subdir within upstream that holds the canonical
# framework (e.g. 02_solution). Empty = repo root. Set via --subdir.
FRAMEWORK_SOURCE_SUBDIR=$subdir
EOF

echo "init-framework-version: wrote $VERSION_FILE (pinned at ${latest_sha:0:7})."

# Ensure ALL framework ephemera are gitignored (DA-M6 — the old block
# covered only the update flag; fresh bootstraps then saw doctor/insight/
# instinct flags and the review archive as untracked noise, committable
# by accident). Idempotent per-entry.
ephemera=(
  '.claude/.framework-update-available.md'
  '.claude/.framework-insight-alert.md'
  '.claude/.framework-doctor-findings.md'
  '.claude/.skills-update-available.md'
  '.claude/.skills-suggestion.md'
  '.claude/.instinct-candidates.md'
  '.claude/.dep-verification-issues.md'
  '.claude/.drift-state'
  '.claude/.update-staging.*'
  '.claude/review-findings/'
  '.claude/telemetry/'
  # F3 fix: 9 patterns this bootstrap list had fallen behind on (this repo's
  # own .gitignore carries them; a fresh adopter running this script did
  # not get them). Each is written by a manifest-tracked hook or command:
  # session-lifecycle hooks (precompact-snapshot.sh, postcompact-archive.sh,
  # checkpoint-watermark.sh, session-start-marker.sh — the last added to
  # framework-manifest.txt in this same fix pass), the console-heartbeat.sh
  # hook, and the /security and /council commands.
  '.claude/.last-compaction'
  '.claude/.precompact-snapshot/'
  '.claude/.compaction-archive/'
  '.claude/.checkpoint-state*'
  '.claude/.session-start-commit*'
  '.claude/.console-heartbeat'
  '.claude/security-findings/'
  '.claude/security-findings.md'
  '.claude/council/'
)
# NOTE: .claude/.skills-declined is deliberately NOT in this list — it's a
# committed project decision (contract:skills-sync), not ephemera.
added=0
for entry in "${ephemera[@]}"; do
  if [ ! -f "$GITIGNORE" ] || ! grep -qxF "$entry" "$GITIGNORE"; then
    if [ "$added" -eq 0 ]; then
      { echo ""; echo "# Framework ephemera (flag files, telemetry, staging — never commit)."; } >> "$GITIGNORE"
    fi
    echo "$entry" >> "$GITIGNORE"
    added=$((added + 1))
  fi
done
[ "$added" -gt 0 ] && echo "init-framework-version: added $added framework ephemera entr(y/ies) to .gitignore."

# Context-window notice (scaffold-time). The checkpoint-watermark hook can't read
# the live window, so it assumes a default; a 1M-context model must opt in or the
# checkpoint nudge fires far too early. Inform here rather than flip the default
# (200k is correct for the majority of consumers).
echo ""
echo "init-framework-version: NOTE — the context checkpoint nudge assumes a"
echo "  200,000-token window. On a 1M-context model (e.g. Opus [1m]), set"
echo "  CLAUDE_CONTEXT_WINDOW_TOKENS=1000000 in .claude/settings.local.json"
echo "  (the untracked, per-machine override) — NOT settings.json, whose"
echo "  permission rules make the agent's self-modification guard fire on edits."
echo "  Per-machine calibration belongs in the local file anyway."
echo "  (To register/replace framework hooks, run merge-hook-registrations.sh via"
echo "   Bash — the same guard blocks hand-editing settings.json directly.)"
