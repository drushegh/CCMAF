#!/usr/bin/env bash
# check-updates.sh — Checks upstream framework for new commits.
#
# Runs as part of cold start. Silent when up-to-date. When behind, writes
# .claude/.framework-update-available.md for the session to read
# and offer to the user via AskUserQuestion.
#
# Usage: check-updates.sh [--force]
#   --force  ignore the FRAMEWORK_CHECK_INTERVAL_HOURS throttle and check now
#            (a throttled run exits 0 silently, even when the pin is behind).
#
# Exit codes:
#   0  — up to date, OR update available (flag file written), OR skipped
#        (recently checked). All of these are "cold start continues".
#   2  — .framework-version missing or malformed (setup issue, not fatal).
#   3  — network failure (can't reach upstream — offline mode, continue).
#   4  — upstream answered ls-remote but the inspection clone failed (auth,
#        branch, disk...); the real git error is printed. Not fatal.
#
# Dependencies: git, date (coreutils). No gh, no jq, no curl.

set -euo pipefail

FORCE=0
if [ "${1:-}" = "--force" ]; then FORCE=1; fi

# Portable timeout (review P1): stock macOS ships no GNU `timeout` (only
# Homebrew coreutils' `gtimeout`) and a bare `timeout` there is exit 127 for
# EVERY call.
# (Same helper as skills-check.sh / boot/cold-start.sh — keep in sync.)
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

# Resolve project root (three levels up from this script).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
VERSION_FILE="$PROJECT_ROOT/.claude/.framework-version"
FLAG_FILE="$PROJECT_ROOT/.claude/.framework-update-available.md"
MANIFEST_FILE="$SCRIPT_DIR/framework-manifest.txt"

# Reject a manifest entry that escapes the project root before it reaches any
# git pathspec (defence-in-depth; apply-update uses the same guard before rm/cp).
# Unsafe = absolute (^/), Windows drive (^[A-Za-z]:), any `..` path segment, or
# any backslash (a Windows-style `..\evil` / `a\..\evil` traversal — the
# forward-slash `..` arms above don't catch it; same guard class as
# skills-sync.sh's skill-name check). The backslash arm uses the QUOTED form
# `*'\'*`, as apply-update.sh does — see the note there on why it is preferred
# over the backslash-halving-fragile unquoted `*\\*`.
_is_unsafe_manifest_path() {  # <path> → 0 (true) if unsafe
  case "$1" in
    /*|[A-Za-z]:*|../*|*/../*|*/..|..|*'\'*) return 0 ;;
  esac
  return 1
}

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

# CRLF-safe source (DA-M12): `.framework-version` is extensionless and, on a
# Windows clone with core.autocrlf=true, checks out CRLF — sourcing it raw
# leaves a trailing \r on every value (e.g. `ls-remote "url\r"` fails → false
# "offline"). Strip \r via process substitution, matching the sibling skills-*
# scripts. (.gitattributes also pins these files eol=lf as the first line of
# defence; this stays as belt-and-suspenders for files that rule can't reach.)
# shellcheck disable=SC1090
source <(tr -d '\r' < "$VERSION_FILE")

: "${FRAMEWORK_UPSTREAM_URL:?FRAMEWORK_UPSTREAM_URL missing in .framework-version}"
: "${FRAMEWORK_UPSTREAM_BRANCH:?FRAMEWORK_UPSTREAM_BRANCH missing in .framework-version}"
: "${FRAMEWORK_PINNED_SHA:?FRAMEWORK_PINNED_SHA missing in .framework-version}"
FRAMEWORK_CHECK_INTERVAL_HOURS="${FRAMEWORK_CHECK_INTERVAL_HOURS:-24}"
# Display form of the upstream URL: credentials embedded in an
# https://user:token@host URL are never echoed or written to the flag file.
redact_url() { printf "%s" "$1" | sed -E "s#(://)[^/@[:space:]]+@#\1***@#g"; }
UPSTREAM_SHOWN="$(redact_url "$FRAMEWORK_UPSTREAM_URL")"
FRAMEWORK_LAST_CHECKED="${FRAMEWORK_LAST_CHECKED:-1970-01-01T00:00:00Z}"
# FRAMEWORK_SOURCE_SUBDIR (default empty = repo root). When set, the canonical
# framework lives under <subdir>/ upstream, so commit/file filtering must use the
# subdir-prefixed paths. Empty/absent => repo root (backward-compatible).
FRAMEWORK_SOURCE_SUBDIR="${FRAMEWORK_SOURCE_SUBDIR:-}"
FRAMEWORK_SOURCE_SUBDIR="${FRAMEWORK_SOURCE_SUBDIR%/}"

# Throttle: skip if checked recently.
now_epoch=$(date -u +%s)
# GNU `date -d` and BSD/macOS `date -j -f` parse an ISO ts differently — try
# both so the throttle works off-GNU (else it never throttles → ls-remote every
# cold start).
last_epoch=$(date -u -d "$FRAMEWORK_LAST_CHECKED" +%s 2>/dev/null \
  || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$FRAMEWORK_LAST_CHECKED" +%s 2>/dev/null \
  || echo 0)
interval_seconds=$((FRAMEWORK_CHECK_INTERVAL_HOURS * 3600))
if [ "$FORCE" -eq 0 ] && [ $((now_epoch - last_epoch)) -lt "$interval_seconds" ]; then
  exit 0
fi

# Resolve latest remote SHA. git ls-remote works for public HTTPS and
# authenticated SSH URLs; needs no working tree.
# Time-bounded (10s): an unresponsive remote must not stall cold start.
if ! latest_sha=$(run_tmo 10 git ls-remote "$FRAMEWORK_UPSTREAM_URL" "refs/heads/$FRAMEWORK_UPSTREAM_BRANCH" 2>/dev/null | awk '{print $1}'); then
  echo "check-updates: unable to reach $UPSTREAM_SHOWN (offline?) — continuing." >&2
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
tmp_version="$(mktemp "$(dirname "$VERSION_FILE")/.framework-version.XXXXXX")"
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
# depth-1 mirrors apply-update.sh: fast common case, then unshallow ON DEMAND
# below only when the pinned SHA isn't reachable within the shallow slice (the
# non-shallow clone here made the unshallow that follows dead code).
tmp_clone="$(mktemp -d)"
trap 'rm -rf "$tmp_clone"' EXIT

# Capture stderr (discard stdout) so the REAL clone error reaches the user —
# a bare "clone failed" hid auth/branch problems behind a generic message.
if ! clone_err="$(git clone --quiet --depth 1 --branch "$FRAMEWORK_UPSTREAM_BRANCH" "$FRAMEWORK_UPSTREAM_URL" "$tmp_clone" 2>&1 >/dev/null)"; then
  echo "check-updates: clone failed — continuing without commit detail." >&2
  clone_last="$(printf '%s\n' "$clone_err" | tr -d '\r' | sed '/^[[:space:]]*$/d' | tail -1)"
  clone_last="$(redact_url "$clone_last")"
  if [ -n "$clone_last" ]; then echo "check-updates: git: $clone_last" >&2; fi
  case "$FRAMEWORK_UPSTREAM_URL|$clone_err" in
    git@*|ssh://*|*"Permission denied (publickey)"*|*"Host key verification failed"*)
      echo "check-updates: SSH hint — on a machine with multiple GitHub accounts, plain" >&2
      echo "            github.com can pick the wrong key. Set FRAMEWORK_UPSTREAM_URL to your" >&2
      echo "            SSH host alias (e.g. git@github.com-personal:owner/repo.git) and confirm" >&2
      echo "            with: git ls-remote \"\$FRAMEWORK_UPSTREAM_URL\"." >&2
      ;;
  esac
  exit 4
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
  if _is_unsafe_manifest_path "${line%/}"; then
    echo "check-updates: WARNING — skipping unsafe local manifest entry: '$line'." >&2
    continue
  fi
  manifest_paths+=("${line%/}")
done < "$MANIFEST_FILE"

UPSTREAM_MANIFEST="$tmp_clone${FRAMEWORK_SOURCE_SUBDIR:+/$FRAMEWORK_SOURCE_SUBDIR}/.claude/framework/update/framework-manifest.txt"
if [ -f "$UPSTREAM_MANIFEST" ]; then
  while IFS= read -r line; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if _is_unsafe_manifest_path "${line%/}"; then
      echo "check-updates: WARNING — skipping unsafe upstream manifest entry: '$line'." >&2
      continue
    fi
    manifest_paths+=("${line%/}")
  done < "$UPSTREAM_MANIFEST"
else
  echo "check-updates: WARNING — upstream clone has no framework-manifest.txt; preview may under-report new paths." >&2
fi

# --- v2 migration ladder: mirror apply-update.sh's drop-release gate. -----
# apply-update REFUSES (exit 6) a v2 "drop" release on a project that has not
# completed migrate-v2.sh — both by the manifest header marker and by the
# structural backstop (the dangerous-command guard's manifest entry vanished
# upstream). Without the same check here, every un-migrated project was told
# "update available — run apply-update" on every cold start, forever, for an
# update that can never apply. Same predicates as apply-update's
# _v2_migrated / drop checks (keep them in step). On a refused drop: clear
# any stale apply-offer flag and print ONE informational line — staying on
# the current version is harmless, so this is not a nag.
_v2_migrated() {
  [ -f "$PROJECT_ROOT/.claude/.migrate-v2-tombstone" ] \
    && grep -Eq '^[[:space:]]*FRAMEWORK_LINE=v2[[:space:]]*$' "$VERSION_FILE" 2>/dev/null
}
_GUARD_ENTRY='.claude/hooks/block-dangerous-commands.py'
_manifest_lists() {  # <manifest> <entry> → 0 if listed (CRLF-safe, whole line)
  # No -q: grep must drain the pipe — an early -q exit can SIGPIPE `tr`, and
  # under pipefail that turns a MATCH into a non-zero pipeline status.
  tr -d '\r' < "$1" 2>/dev/null | grep -xF "$2" >/dev/null
}
if [ -f "$UPSTREAM_MANIFEST" ] && ! _v2_migrated; then
  _drop_reason=""
  if grep -Eq '^#[[:space:]]*FRAMEWORK-RELEASE-LINE:[[:space:]]*drop' "$UPSTREAM_MANIFEST"; then
    _drop_reason="upstream is a v2 DROP release"
  elif _manifest_lists "$MANIFEST_FILE" "$_GUARD_ENTRY" \
       && ! _manifest_lists "$UPSTREAM_MANIFEST" "$_GUARD_ENTRY"; then
    _drop_reason="upstream no longer ships the dangerous-command guard (a v2 drop release)"
  fi
  if [ -n "$_drop_reason" ]; then
    rm -f "$FLAG_FILE"
    echo "check-updates: ${latest_sha:0:7} available, but $_drop_reason and this project has not completed the v2 migration — apply-update would refuse."
    if [ -f "$PROJECT_ROOT/.claude/.framework-dev-repo" ]; then
      # The framework's own dev repo never migrates (migrate-v2 refuses it)
      # — past the drop release, public changes sync via the production clone.
      echo "check-updates: framework dev repo — expected; sync public changes through the production clone, not apply-update."
    else
      echo "check-updates: staying on ${FRAMEWORK_PINNED_SHA:0:7} is harmless; to move to v2, preview with: bash .claude/framework/update/migrate-v2.sh --dry-run"
    fi
    exit 0
  fi
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

# Hook-registration gap (BUG-029 — close the notify blind spot). A framework
# hook's REGISTRATION lives in the consumer-owned settings.json (see
# merge-hook-registrations.sh), which is NOT a manifest path — so a settings-only
# registration change (a hook registered without a manifest change, or the tail
# of a split file-then-registration release, e.g. BUG-028) is invisible to the
# manifest diff above, and the consumer would never be prompted to apply-update
# (the thing that runs the registration merge). Detect it jq-free — the same
# `grep -oE '\.claude/hooks/…'` the doctor's hook check uses: a framework-hook
# FILE the upstream canonical settings.json registers that the consumer's does
# NOT. The upstream clone already exists here, so this costs no extra network.
# grep -Fxvf over REAL temp files (not comm — collation-fragile; not a
# process-substitution pattern file — a Git-Bash grep can't open /dev/fd/N).
#
# Only registrations NEW since the pinned version count: a hook the PINNED
# canonical already registered, but the consumer's settings.json lacks, was
# deliberately removed by the consumer — flagging it made this check never go
# quiet (every upstream advance re-raised the same "gap"). Subtract the
# pinned canonical's set when the pinned SHA is reachable in the clone (same
# rule merge-hook-registrations.sh applies when it is handed the pinned
# settings). Pinned SHA unavailable → fall back to the full gap.
_canon_settings="$tmp_clone${FRAMEWORK_SOURCE_SUBDIR:+/$FRAMEWORK_SOURCE_SUBDIR}/.claude/settings.json"
_consumer_settings="$PROJECT_ROOT/.claude/settings.json"
hook_reg_gap=""
if [ -f "$_canon_settings" ] && [ -f "$_consumer_settings" ]; then
  _hrg_canon="$(mktemp)"; _hrg_consumer="$(mktemp)"
  grep -oE '\.claude/hooks/[A-Za-z0-9_.-]+\.(sh|py)' "$_canon_settings"    2>/dev/null | sort -u > "$_hrg_canon"    || true
  grep -oE '\.claude/hooks/[A-Za-z0-9_.-]+\.(sh|py)' "$_consumer_settings" 2>/dev/null | sort -u > "$_hrg_consumer" || true
  if git -C "$tmp_clone" cat-file -e "$FRAMEWORK_PINNED_SHA" 2>/dev/null; then
    git -C "$tmp_clone" show "$FRAMEWORK_PINNED_SHA:${FRAMEWORK_SOURCE_SUBDIR:+$FRAMEWORK_SOURCE_SUBDIR/}.claude/settings.json" 2>/dev/null \
      | grep -oE '\.claude/hooks/[A-Za-z0-9_.-]+\.(sh|py)' 2>/dev/null >> "$_hrg_consumer" || true  # union: consumer ∪ pinned
  fi
  hook_reg_gap="$(grep -Fxvf "$_hrg_consumer" "$_hrg_canon" 2>/dev/null || true)"
  rm -f "$_hrg_canon" "$_hrg_consumer"
fi

pinned_short="${FRAMEWORK_PINNED_SHA:0:7}"
latest_short="${latest_sha:0:7}"

# BUG-004: the upstream branch advanced, but if NO framework-owned (manifest) paths
# changed between the pin and HEAD — e.g. upstream committed only non-shipped state
# (its dev board, docs) to the same branch consumers track — there is nothing to
# apply. Treat as up to date instead of writing an empty "update available" flag that
# nags the consumer on every cold start. Only suppress when the pinned SHA WAS found
# upstream (otherwise "$files" is the non-empty "not found" fallback and we still notify).
if git -C "$tmp_clone" cat-file -e "$FRAMEWORK_PINNED_SHA" 2>/dev/null && [ -z "$files" ] && [ -z "$hook_reg_gap" ]; then
  rm -f "$FLAG_FILE"
  echo "check-updates: upstream advanced to $latest_short but no framework-owned files changed since $pinned_short — up to date (no shipped paths affected)."
  exit 0
fi

# A hook-registration-only update (no manifest files changed, but the canonical
# registers a framework hook the consumer's settings.json is missing) — surface
# it in the flag so the "Files" section isn't a bare "(none)".
hook_reg_note=""
if [ -n "$hook_reg_gap" ]; then
  hook_reg_note="
## Framework hook registration(s) to add to your settings.json

This update registers framework hook(s) your \`.claude/settings.json\` is missing
(their files are already present; only the registration is new — see BUG-028/029).
\`apply-update\` wires them in additively — your permissions and your own hooks are
untouched:

$(printf '%s\n' "$hook_reg_gap" | sed 's/^/    /')
"
fi

cat > "$FLAG_FILE" <<EOF
# Framework Update Available

- **Current:** \`$pinned_short\`
- **Latest:** \`$latest_short\`
- **Upstream:** $UPSTREAM_SHOWN ($FRAMEWORK_UPSTREAM_BRANCH)
- **Latest SHA (full):** $latest_sha

## Commits since your pinned version (framework paths only)

\`\`\`
${commits:-(no commits touched framework paths — unusual; this flag file is stale)}
\`\`\`

## Files that will be overwritten on update

\`\`\`
${files:-(none)}
\`\`\`
${hook_reg_note}
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
