#!/usr/bin/env bash
# check-updates.sh — Checks upstream framework for new commits.
#
# Runs as part of cold start. Silent when up-to-date. When behind, writes
# .framework-update-available.md at project root for the session to read
# and offer to the user via AskUserQuestion.
#
# Exit codes:
#   0  — up to date, OR update available (flag file written), OR skipped
#        (recently checked). All of these are "cold start continues".
#   2  — .framework-version missing or malformed (setup issue, not fatal).
#   3  — network failure (can't reach upstream — offline mode, continue).
#
# Dependencies: git, date (coreutils). No gh, no jq, no curl.

set -euo pipefail

# Resolve project root (two levels up from this script).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
VERSION_FILE="$PROJECT_ROOT/.claude/.framework-version"
FLAG_FILE="$PROJECT_ROOT/.claude/.framework-update-available.md"
MANIFEST_FILE="$SCRIPT_DIR/framework-manifest.txt"

# NOTE (DA-C4): the flag file is NOT removed up front. An existing flag is
# a pending, unactioned update notification — deleting it before the
# throttle check below silently erased it for up to a full interval. It is
# cleared only when a live check proves we're up to date, and overwritten
# when a live check finds an update. On network failure it is left alone.

if [ ! -f "$VERSION_FILE" ]; then
  echo "check-updates: no .claude/.framework-version found — skipping." >&2
  echo "check-updates: run .claude/framework/update/init-framework-version.sh to bootstrap." >&2
  exit 2
fi

# shellcheck disable=SC1090
source "$VERSION_FILE"

: "${FRAMEWORK_UPSTREAM_URL:?FRAMEWORK_UPSTREAM_URL missing in .framework-version}"
: "${FRAMEWORK_UPSTREAM_BRANCH:?FRAMEWORK_UPSTREAM_BRANCH missing in .framework-version}"
: "${FRAMEWORK_PINNED_SHA:?FRAMEWORK_PINNED_SHA missing in .framework-version}"
FRAMEWORK_CHECK_INTERVAL_HOURS="${FRAMEWORK_CHECK_INTERVAL_HOURS:-24}"
FRAMEWORK_LAST_CHECKED="${FRAMEWORK_LAST_CHECKED:-1970-01-01T00:00:00Z}"
# FRAMEWORK_SOURCE_SUBDIR (default empty = repo root). When set, the canonical
# framework lives under <subdir>/ upstream, so commit/file filtering must use the
# subdir-prefixed paths. Empty/absent => repo root (backward-compatible).
FRAMEWORK_SOURCE_SUBDIR="${FRAMEWORK_SOURCE_SUBDIR:-}"
FRAMEWORK_SOURCE_SUBDIR="${FRAMEWORK_SOURCE_SUBDIR%/}"

# Throttle: skip if checked recently.
now_epoch=$(date -u +%s)
last_epoch=$(date -u -d "$FRAMEWORK_LAST_CHECKED" +%s 2>/dev/null || echo 0)
interval_seconds=$((FRAMEWORK_CHECK_INTERVAL_HOURS * 3600))
if [ $((now_epoch - last_epoch)) -lt "$interval_seconds" ]; then
  exit 0
fi

# Resolve latest remote SHA. git ls-remote works for public HTTPS and
# authenticated SSH URLs; needs no working tree.
if ! latest_sha=$(git ls-remote "$FRAMEWORK_UPSTREAM_URL" "refs/heads/$FRAMEWORK_UPSTREAM_BRANCH" 2>/dev/null | awk '{print $1}'); then
  echo "check-updates: unable to reach $FRAMEWORK_UPSTREAM_URL (offline?) — continuing." >&2
  exit 3
fi

if [ -z "$latest_sha" ]; then
  echo "check-updates: branch $FRAMEWORK_UPSTREAM_BRANCH not found on upstream — skipping." >&2
  exit 3
fi

# Update last-checked timestamp regardless of outcome below.
# mktemp -p alongside the destination (audit minor a): see apply-update.sh
# for the same fix and rationale — a cross-filesystem mktemp+mv is not an
# atomic rename and can leave .framework-version truncated on interruption.
now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp_version="$(mktemp -p "$(dirname "$VERSION_FILE")")"
awk -v now="$now_iso" '
  BEGIN { set = 0 }
  /^FRAMEWORK_LAST_CHECKED=/ { print "FRAMEWORK_LAST_CHECKED=" now; set = 1; next }
  { print }
  END { if (!set) print "FRAMEWORK_LAST_CHECKED=" now }
' "$VERSION_FILE" > "$tmp_version"
mv "$tmp_version" "$VERSION_FILE"

if [ "$latest_sha" = "$FRAMEWORK_PINNED_SHA" ]; then
  # Up to date — clear any stale flag from a previous check.
  rm -f "$FLAG_FILE"
  exit 0
fi

# Update available. Clone upstream to a temp dir for commit inspection.
tmp_clone="$(mktemp -d)"
trap 'rm -rf "$tmp_clone"' EXIT

if ! git clone --quiet --branch "$FRAMEWORK_UPSTREAM_BRANCH" "$FRAMEWORK_UPSTREAM_URL" "$tmp_clone" >/dev/null 2>&1; then
  echo "check-updates: clone failed — continuing without commit detail." >&2
  exit 3
fi

if ! git -C "$tmp_clone" cat-file -e "$FRAMEWORK_PINNED_SHA" 2>/dev/null; then
  git -C "$tmp_clone" fetch --unshallow --quiet 2>/dev/null || true
fi

# Build manifest path args for git log filtering.
# CRLF strip: see apply-update.sh — same bug, same fix.
#
# F2 fix: union local + upstream manifest paths, mirroring apply-update.sh's
# "Build final set" approach (apply-update.sh:272-278) — using upstream's
# manifest too, not just the adopter's local (possibly-stale) copy, means a
# brand-new upstream-only path shows up in this preview instead of being
# under-reported (or, in the BUG-004 edge case below, suppressing the whole
# notification when the only changed paths are ones the local manifest
# doesn't know about yet). Upstream's manifest lives in the clone made
# above; read it if present, falling back to local-only if it's missing
# (very old upstream / corrupt clone — same fallback apply-update.sh takes,
# loudly there too).
manifest_paths=()
while IFS= read -r line; do
  line="${line%$'\r'}"
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  manifest_paths+=("${line%/}")
done < "$MANIFEST_FILE"

UPSTREAM_MANIFEST="$tmp_clone${FRAMEWORK_SOURCE_SUBDIR:+/$FRAMEWORK_SOURCE_SUBDIR}/.claude/framework/update/framework-manifest.txt"
if [ -f "$UPSTREAM_MANIFEST" ]; then
  while IFS= read -r line; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    manifest_paths+=("${line%/}")
  done < "$UPSTREAM_MANIFEST"
else
  echo "check-updates: WARNING — upstream clone has no framework-manifest.txt; preview may under-report new paths." >&2
fi

# Clone-side paths: when canonical lives in a subdir, framework files are at
# <subdir>/<path> in upstream history — prefix so log/diff filters match.
# (Duplicates between local and upstream entries are harmless here — git
# log/diff accept repeated pathspecs — so this skips a bash-4 dedupe step
# and keeps the script running on bash 3.2, unlike apply-update.sh, which
# needs bash 4 for its associative arrays.)
clone_paths=()
for p in "${manifest_paths[@]}"; do
  clone_paths+=("${FRAMEWORK_SOURCE_SUBDIR:+$FRAMEWORK_SOURCE_SUBDIR/}$p")
done

# Commit list restricted to framework-owned paths.
if git -C "$tmp_clone" cat-file -e "$FRAMEWORK_PINNED_SHA" 2>/dev/null; then
  commit_range="$FRAMEWORK_PINNED_SHA..$latest_sha"
  commits=$(git -C "$tmp_clone" log --oneline "$commit_range" -- "${clone_paths[@]}" 2>/dev/null || true)
else
  commits="(pinned SHA $FRAMEWORK_PINNED_SHA not found upstream — showing recent commits instead)"$'\n'
  commits+=$(git -C "$tmp_clone" log --oneline -20 -- "${clone_paths[@]}" 2>/dev/null || true)
fi

# Files changed, restricted to manifest paths.
if git -C "$tmp_clone" cat-file -e "$FRAMEWORK_PINNED_SHA" 2>/dev/null; then
  files=$(git -C "$tmp_clone" diff --name-only "$FRAMEWORK_PINNED_SHA..$latest_sha" -- "${clone_paths[@]}" 2>/dev/null || true)
else
  files="(diff unavailable — pinned SHA not found upstream)"
fi

pinned_short="${FRAMEWORK_PINNED_SHA:0:7}"
latest_short="${latest_sha:0:7}"

# BUG-004: the upstream branch advanced, but if NO framework-owned (manifest) paths
# changed between the pin and HEAD — e.g. upstream committed only non-shipped state
# (its dev board, docs) to the same branch consumers track — there is nothing to
# apply. Treat as up to date instead of writing an empty "update available" flag that
# nags the consumer on every cold start. Only suppress when the pinned SHA WAS found
# upstream (otherwise "$files" is the non-empty "not found" fallback and we still notify).
if git -C "$tmp_clone" cat-file -e "$FRAMEWORK_PINNED_SHA" 2>/dev/null && [ -z "$files" ]; then
  rm -f "$FLAG_FILE"
  echo "check-updates: upstream advanced to $latest_short but no framework-owned files changed since $pinned_short — up to date (no shipped paths affected)."
  exit 0
fi

cat > "$FLAG_FILE" <<EOF
# Framework Update Available

- **Current:** \`$pinned_short\`
- **Latest:** \`$latest_short\`
- **Upstream:** $FRAMEWORK_UPSTREAM_URL ($FRAMEWORK_UPSTREAM_BRANCH)
- **Latest SHA (full):** $latest_sha

## Commits since your pinned version (framework paths only)

\`\`\`
${commits:-(no commits touched framework paths — unusual; this flag file is stale)}
\`\`\`

## Files that will be overwritten on update

\`\`\`
${files:-(none)}
\`\`\`

## To apply

Run: \`bash .claude/framework/update/apply-update.sh\` — it will list the
paths it's about to touch and ask for confirmation (pass \`--yes\`/\`-y\` to
skip the prompt, e.g. from automation).

This will overwrite only the paths listed above (and only those covered
by .claude/framework/update/framework-manifest.txt). Project state files
(TASKS.md, STATUS.md, ECOSYSTEM.md, CLAUDE.md, etc.) are never touched.

## To skip

Delete this file: \`rm .claude/.framework-update-available.md\`

The next cold start will check again after the throttle interval
(\`FRAMEWORK_CHECK_INTERVAL_HOURS\` in .framework-version, default 24h).
EOF

echo "check-updates: update available ($pinned_short → $latest_short). See $FLAG_FILE."
exit 0
