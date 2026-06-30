#!/usr/bin/env bash
# apply-update.sh — Applies a pending framework update.
#
# Overwrites the paths in framework-manifest.txt with the upstream
# version. Project state files are not in the manifest and are never
# touched.
#
# Safety:
#   - Refuses to run if any framework-owned path has ANY uncommitted
#     state: untracked new files, modifications, or staged changes.
#     Uses `git status --porcelain` for detection (catches both
#     tracked modifications and untracked files — plain `git diff`
#     misses untracked, which is a destructive blind spot).
#   - Reason: mirroring upstream into a manifest path will remove any
#     local-only file that upstream doesn't have. If those files are
#     uncommitted work-in-progress, they'd be lost unrecoverably. Only
#     committed work can be recovered from git.
#
# Exit codes:
#   0  — update applied successfully.
#   1  — pre-flight safety check failed (uncommitted changes, missing deps).
#   2  — .framework-version missing or malformed.
#   3  — network failure fetching upstream.

set -euo pipefail

# Bash 4+ guard (DA-C8): this script uses associative arrays (declare -A),
# which bash 3.2 (stock macOS) lacks — it would die with a cryptic
# "invalid option" mid-run. Fail loudly before touching anything.
if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then
  echo "apply-update: bash >= 4 required (found ${BASH_VERSION:-unknown})." >&2
  echo "apply-update: on macOS: brew install bash, then re-run. Nothing was changed." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# --- Pre-flight: detect old layout and auto-migrate ---------------------
# Consumers on the pre-9663226 layout still have 00_framework/ at project
# root and state files (TASKS.md etc.) at root. migrate-layout.sh handles
# the one-time git mv + commit + doctor check. Run it before anything else
# so VERSION_FILE resolves to its new .claude/ location.
if [ -d "$PROJECT_ROOT/00_framework" ] || [ -f "$PROJECT_ROOT/TASKS.md" ]; then
  MIGRATE="$SCRIPT_DIR/migrate-layout.sh"
  if [ -x "$MIGRATE" ]; then
    echo "apply-update: old layout detected — running migrate-layout.sh first..."
    bash "$MIGRATE" || exit $?
    echo ""
  else
    echo "apply-update: ERROR — old layout detected but migrate-layout.sh not found." >&2
    echo "Download and run it manually:" >&2
    echo "  curl -fsSL https://raw.githubusercontent.com/drushegh/CCMAF/main/.claude/framework/update/migrate-layout.sh | bash" >&2
    exit 1
  fi
fi

VERSION_FILE="$PROJECT_ROOT/.claude/.framework-version"
FLAG_FILE="$PROJECT_ROOT/.claude/.framework-update-available.md"
MANIFEST_FILE="$SCRIPT_DIR/framework-manifest.txt"

if [ ! -f "$VERSION_FILE" ]; then
  echo "apply-update: .claude/.framework-version missing. Run init-framework-version.sh first." >&2
  exit 2
fi

# shellcheck disable=SC1090
source "$VERSION_FILE"
: "${FRAMEWORK_UPSTREAM_URL:?FRAMEWORK_UPSTREAM_URL missing}"
: "${FRAMEWORK_UPSTREAM_BRANCH:?FRAMEWORK_UPSTREAM_BRANCH missing}"
: "${FRAMEWORK_PINNED_SHA:?FRAMEWORK_PINNED_SHA missing}"

# FRAMEWORK_SOURCE_SUBDIR (default empty = repo root). When set (e.g.
# 02_solution), the canonical framework lives under <clone>/<subdir>/ and every
# manifest path is relative to it. Empty/absent => repo root, so existing
# consumers are unaffected (backward-compatible). See contract:framework-update.
FRAMEWORK_SOURCE_SUBDIR="${FRAMEWORK_SOURCE_SUBDIR:-}"
FRAMEWORK_SOURCE_SUBDIR="${FRAMEWORK_SOURCE_SUBDIR%/}"

# Parse local manifest, preserving whether each entry is a dir (trailing
# slash → mirror the whole directory) or a file (no slash → overwrite
# just that file). The distinction matters because some directories are
# SHARED (framework + project content coexist); those use file-level
# entries so customs survive.
#
# CRLF strip: on Windows with autocrlf, lines end with \r\n. `read -r`
# consumes the \n but leaves the \r, which silently breaks path resolution
# (a directory "foo/" becomes "foo\r" which matches nothing).
declare -A local_manifest_type=()
manifest_paths=()  # flat list for the safety check below
while IFS= read -r line; do
  line="${line%$'\r'}"
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  if [[ "$line" == */ ]]; then
    p="${line%/}"
    local_manifest_type[$p]="dir"
  else
    p="$line"
    local_manifest_type[$p]="file"
  fi
  manifest_paths+=("$p")
done < "$MANIFEST_FILE"

# Pre-flight: refuse if any framework-owned path has uncommitted state.
# We use plumbing commands rather than `git status --porcelain` because
# on Windows (core.autocrlf=true) status reports CRLF-normalisation
# noise as modifications even when content is byte-identical in git's
# view. Content-based diffing (diff-index) + explicit untracked listing
# (ls-files --others) gives us a clean, portable dirty check.
#
# Refresh the stat cache first so diff-index sees actual content state,
# not stale mtime from a previous checkout.
if git -C "$PROJECT_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$PROJECT_ROOT" update-index --refresh >/dev/null 2>&1 || true

  dirty_report=""
  for p in "${manifest_paths[@]}"; do
    # Tracked modifications — `git diff --name-only HEAD` does
    # content-level comparison (CRLF-aware on Windows), unlike
    # `diff-index` which compares blob SHAs and falsely flags files
    # that differ only by line-ending normalisation.
    modified=$(git -C "$PROJECT_ROOT" diff --name-only HEAD -- "$p" 2>/dev/null || true)
    # Staged-but-uncommitted.
    staged=$(git -C "$PROJECT_ROOT" diff --name-only --cached HEAD -- "$p" 2>/dev/null || true)
    # Untracked files under the path.
    untracked=$(git -C "$PROJECT_ROOT" ls-files --others --exclude-standard -- "$p" 2>/dev/null || true)

    path_dirty=""
    [ -n "$modified" ]  && path_dirty+="$modified"$'\n'
    [ -n "$staged" ]    && path_dirty+="$staged"$'\n'
    [ -n "$untracked" ] && path_dirty+="$untracked"$'\n'

    if [ -n "$path_dirty" ]; then
      dirty_report+="  ${p}:"$'\n'
      # De-dup (a file can appear in both modified and staged).
      while IFS= read -r f; do
        [ -z "$f" ] && continue
        dirty_report+="    - $f"$'\n'
      done <<< "$(printf '%s' "$path_dirty" | sort -u)"
    fi
  done

  if [ -n "$dirty_report" ]; then
    echo "apply-update: refusing to overwrite framework-owned paths with uncommitted state." >&2
    echo "" >&2
    echo "The following paths have changes that would be destroyed:" >&2
    echo "" >&2
    printf '%s' "$dirty_report" >&2
    echo "" >&2
    echo "Resolve by one of:" >&2
    echo "  1. Commit the changes (if they are meant to be upstreamed, open a PR)." >&2
    echo "  2. Stash them (\`git stash -u\` includes untracked)." >&2
    echo "  3. Delete them (\`git clean\` for untracked; \`git restore\` for modified)." >&2
    echo "" >&2
    echo "Framework-owned paths (listed in framework-manifest.txt) get" >&2
    echo "overwritten on every update — custom local content in these paths" >&2
    echo "does not belong here." >&2
    exit 1
  fi
fi

# Fetch upstream into a temp dir. Staging lives INSIDE the project root so
# the phase-2 mv below is a same-filesystem rename, not a cross-device copy.
tmp_clone="$(mktemp -d)"
staging="$PROJECT_ROOT/.claude/.update-staging.$$"
trap 'rm -rf "$tmp_clone" "$staging"' EXIT

echo "apply-update: fetching $FRAMEWORK_UPSTREAM_URL ($FRAMEWORK_UPSTREAM_BRANCH)..."
if ! git clone --quiet --depth 1 --branch "$FRAMEWORK_UPSTREAM_BRANCH" "$FRAMEWORK_UPSTREAM_URL" "$tmp_clone" >/dev/null 2>&1; then
  echo "apply-update: clone failed." >&2
  exit 3
fi

latest_sha=$(git -C "$tmp_clone" rev-parse HEAD)
latest_short="${latest_sha:0:7}"
pinned_short="${FRAMEWORK_PINNED_SHA:0:7}"

# Resolve the canonical source within the clone. CLONE_SRC is the filesystem
# root we copy FROM; SRC_GIT_PREFIX is the in-repo path prefix for git show.
# Both empty when SOURCE_SUBDIR is unset (= repo root), preserving old behaviour.
CLONE_SRC="$tmp_clone${FRAMEWORK_SOURCE_SUBDIR:+/$FRAMEWORK_SOURCE_SUBDIR}"
SRC_GIT_PREFIX="${FRAMEWORK_SOURCE_SUBDIR:+$FRAMEWORK_SOURCE_SUBDIR/}"
if [ -n "$FRAMEWORK_SOURCE_SUBDIR" ] && [ ! -d "$CLONE_SRC" ]; then
  echo "apply-update: ERROR — FRAMEWORK_SOURCE_SUBDIR='$FRAMEWORK_SOURCE_SUBDIR' not found in upstream clone." >&2
  echo "              (upstream may not have a canonical subdir at that path)." >&2
  exit 2
fi

echo "apply-update: updating $pinned_short → $latest_short${FRAMEWORK_SOURCE_SUBDIR:+ (source: $FRAMEWORK_SOURCE_SUBDIR/)}"

# Parse upstream's manifest (authoritative description of the incoming
# version). Using upstream's manifest + upstream's types means:
# - New upstream paths propagate in a single pass (no chicken-and-egg).
# - If upstream has dissolved a dir entry into file-level entries
#   (e.g., .claude/commands/ → individual framework command files),
#   we respect that and don't dir-mirror the parent dir (which would
#   destroy project-owned siblings in shared dirs).
declare -A upstream_manifest_type=()
UPSTREAM_MANIFEST="$CLONE_SRC/.claude/framework/update/framework-manifest.txt"
if [ ! -f "$UPSTREAM_MANIFEST" ]; then
  # Loud, not silent (DA-M5): falling back to the local manifest means new
  # upstream paths will NOT propagate and upstream removals will NOT clean
  # up — an update that "succeeds" while quietly applying the wrong set.
  echo "apply-update: WARNING — upstream clone has no framework-manifest.txt" >&2
  echo "              (corrupt/partial clone, or a very old upstream)." >&2
  echo "              Falling back to the LOCAL manifest: new upstream paths" >&2
  echo "              will not propagate this run. Inspect the upstream repo" >&2
  echo "              before trusting this update." >&2
fi
if [ -f "$UPSTREAM_MANIFEST" ]; then
  while IFS= read -r line; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" == */ ]]; then
      p="${line%/}"
      upstream_manifest_type[$p]="dir"
    else
      p="$line"
      upstream_manifest_type[$p]="file"
    fi
  done < "$UPSTREAM_MANIFEST"
fi

# Build final set of (path → type) to process:
# - All upstream entries (authoritative for current framework layout).
# - Plus local entries that are NOT in upstream AND NOT superseded by
#   upstream children. Superseded = upstream has one or more file-level
#   entries inside what local treats as a dir entry (e.g., local has
#   `.claude/commands/` dir but upstream lists `.claude/commands/foo.md`
#   files). In that case, the local dir entry's semantic has been
#   retired; the individual upstream files handle framework-owned
#   content, and project-owned siblings stay untouched.
declare -A final_type=()

# 1. All upstream entries win outright.
for p in "${!upstream_manifest_type[@]}"; do
  final_type[$p]="${upstream_manifest_type[$p]}"
done

# 2. Local-only entries — only process if truly removed (not superseded).
for p in "${!local_manifest_type[@]}"; do
  [ -n "${final_type[$p]:-}" ] && continue  # covered by upstream

  # Check supersession: does upstream have any path under this one?
  is_superseded=0
  for u in "${!upstream_manifest_type[@]}"; do
    if [[ "$u" == "$p"/* ]]; then
      is_superseded=1
      break
    fi
  done
  [ $is_superseded -eq 1 ] && continue  # upstream dissolved this dir

  final_type[$p]="${local_manifest_type[$p]}"
done

# 3. Prune file entries nested under a dir-mirror entry in the final set
# (BUG-003). A dir mirror replaces the WHOLE directory, so a file listed
# individually inside it is redundant — and harmful: in the two-phase swap
# the dir's `mv` moves the staged subtree (the nested file included) into
# place first, leaving the nested file entry's `mv` with no staged source
# → "cannot stat" abort + a half-applied tree + a re-run deadlock. Pruning
# here also closes the gap where a consumer's stale LOCAL manifest still
# lists such a file even after upstream removed it (the supersession check
# above only retires a LOCAL DIR superseded by upstream FILES, not the
# reverse). The dir mirror still ships the file, so nothing is lost.
for p in "${!final_type[@]}"; do
  [ "${final_type[$p]}" = "file" ] || continue
  d="${p%/*}"
  [ "$d" = "$p" ] && continue   # no slash → top-level file, no ancestor dir
  while : ; do
    if [ "${final_type[$d]:-}" = "dir" ]; then
      unset 'final_type[$p]'
      break
    fi
    nd="${d%/*}"
    [ "$nd" = "$d" ] && break    # reached the top with no mirror ancestor
    d="$nd"
  done
done

# Apply in two phases (DA-C3). The old single pass did rm-then-cp per
# entry, so a mid-update failure (disk full, permissions) left the tree
# half-updated with the old files already deleted and no recovery path.
#
# Phase 1 — STAGE: copy every incoming entry from the clone into a staging
# dir inside the project. Nothing in the working tree is touched; any
# failure here aborts with the tree fully intact.
#
# Phase 2 — SWAP: same-filesystem mv of each staged entry into place
# (plus upstream-removal deletes). The destructive window shrinks from
# "every byte copied over the network clone" to "a sequence of renames";
# if a swap still fails, we print the exact git restore command.

swap_fail() {
  echo "" >&2
  echo "apply-update: ERROR — failed swapping '$1' into place." >&2
  if git -C "$PROJECT_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    echo "apply-update: rolling back — restoring framework paths to HEAD so the" >&2
    echo "              working tree is NOT left half-updated (BUG-003)..." >&2
    # Restore tracked framework content to its committed state.
    git -C "$PROJECT_ROOT" checkout HEAD -- "${manifest_paths[@]}" 2>/dev/null || true
    # Dir-mirror entries are 100% framework-owned (manifest contract): a
    # partial mirror may have added files HEAD doesn't have, and `checkout`
    # restores tracked content but won't remove those. `git clean` is safe
    # ONLY on mirror dirs — never on file entries or shared dirs (project
    # content lives there).
    for mp in "${manifest_paths[@]}"; do
      [ "${final_type[$mp]:-}" = "dir" ] \
        && git -C "$PROJECT_ROOT" clean -fdq -- "$mp" 2>/dev/null || true
    done
    echo "apply-update: rolled back to HEAD — no partial update remains. Fix the" >&2
    echo "              cause above, then re-run apply-update." >&2
  else
    echo "The working tree may be partially updated (no git repo for auto-" >&2
    echo "rollback). Restore the framework paths from your last good state:" >&2
    echo "  git checkout HEAD -- ${manifest_paths[*]}" >&2
    echo "then re-run apply-update." >&2
  fi
  exit 3
}

# Phase 1 — stage everything that exists upstream.
mkdir -p "$staging"
while IFS= read -r p; do
  src="$CLONE_SRC/$p"
  [ -e "$src" ] || continue
  if ! { mkdir -p "$staging/$(dirname "$p")" && cp -R "$src" "$staging/$p"; }; then
    echo "apply-update: ERROR — staging '$p' failed (disk full / permissions?)." >&2
    echo "No changes were made to your working tree." >&2
    exit 3
  fi
done < <(printf '%s\n' "${!final_type[@]}" | sort)

# File-collision detection (TASK-039 + TASK-045, fleet sweep): a consumer may
# have a CUSTOM command at a framework-shipped name (e.g. their own
# /healthcheck), or have edited CLAUDE.framework.md directly instead of using
# CLAUDE.md — committed, so the dirty-check passes, and silently destroyed by
# the overwrite. Detect it by comparing the local copy against the PINNED
# upstream version (CRLF-normalised): match → stock file, upstream merely
# evolved, stay silent; mismatch (or file absent at the pin) → the local
# copy was customised, name it loudly after the update. Needs the pinned
# SHA present in the clone (depth-1 → unshallow on demand; best-effort).
if ! git -C "$tmp_clone" cat-file -e "$FRAMEWORK_PINNED_SHA" 2>/dev/null; then
  git -C "$tmp_clone" fetch --unshallow --quiet 2>/dev/null || true
fi
pinned_available=0
git -C "$tmp_clone" cat-file -e "$FRAMEWORK_PINNED_SHA" 2>/dev/null && pinned_available=1

# _is_customised <manifest-path> <dst> — 0 if the local file differs from
# the pinned upstream version (i.e. carries consumer changes).
_is_customised() {
  local p="$1" dst="$2"
  [ "$pinned_available" = 1 ] || return 0  # can't prove stock → warn
  local pinned_tmp
  pinned_tmp=$(mktemp)
  if ! git -C "$tmp_clone" show "$FRAMEWORK_PINNED_SHA:${SRC_GIT_PREFIX}$p" 2>/dev/null | tr -d '\r' > "$pinned_tmp"; then
    rm -f "$pinned_tmp"
    return 0  # not in pinned version → local same-name file is consumer's own
  fi
  if tr -d '\r' < "$dst" | cmp -s - "$pinned_tmp"; then
    rm -f "$pinned_tmp"
    return 1  # byte-identical to pinned → stock
  fi
  rm -f "$pinned_tmp"
  return 0
}

file_collisions=()

# Phase 2 — swap staged entries into place.
changed_count=0
while IFS= read -r p; do
  t="${final_type[$p]}"
  src="$CLONE_SRC/$p"
  dst="$PROJECT_ROOT/$p"

  if [ ! -e "$src" ]; then
    if [ -e "$dst" ]; then
      echo "  - $p (removed upstream)"
      rm -rf "$dst" || swap_fail "$p"
      changed_count=$((changed_count + 1))
    fi
    continue
  fi

  if [ "$t" = "dir" ]; then
    echo "  - $p/ (directory mirror)"
    { rm -rf "$dst" && mkdir -p "$(dirname "$dst")" && mv "$staging/$p" "$dst"; } || swap_fail "$p"
  else
    # File entry: overwrite just this file. If dst exists as a dir
    # (semantic change from dir to file), remove it first so the mv
    # lands correctly.
    case "$p" in
      .claude/commands/*|CLAUDE.framework.md)
        if [ -f "$dst" ] && ! cmp -s "$staging/$p" "$dst" && _is_customised "$p" "$dst"; then
          file_collisions+=("$p")
        fi
        ;;
    esac
    echo "  - $p (file overwrite)"
    { mkdir -p "$(dirname "$dst")" \
        && { [ ! -d "$dst" ] || rm -rf "$dst"; } \
        && mv "$staging/$p" "$dst"; } || swap_fail "$p"
  fi
  changed_count=$((changed_count + 1))
done < <(printf '%s\n' "${!final_type[@]}" | sort)

# Sanity check: if we pulled in a new SHA but no paths changed, something
# is wrong (classic symptom: CRLF-broken manifest parsing makes every
# path miss). Flag it loudly so silent failure modes surface.
if [ "$changed_count" -eq 0 ]; then
  echo "" >&2
  echo "apply-update: WARNING — pinned SHA changed ($pinned_short → $latest_short)" >&2
  echo "              but 0 paths were updated. This usually indicates a" >&2
  echo "              manifest parsing problem (e.g., CRLF line endings)." >&2
  echo "              Inspect: bash .claude/framework/doctor/doctor.sh" >&2
  echo "" >&2
fi

# Ensure framework hook registrations are present in the consumer's settings.json.
# settings.json is consumer-owned (permissions + their own hooks) and so is NOT
# manifest-carried — a newly-shipped hook would otherwise land its FILE here but
# never get registered, and silently never fire. This additively merges any
# missing framework hook registration (keyed by event+matcher+command) using the
# canonical settings.json from the clone as the source of truth. Idempotent,
# preserves consumer permissions + consumer hooks, fail-soft (TASK-069). Uses the
# just-updated merge helper; the doctor's "unregistered hook" check is the backstop.
_merge_helper="$PROJECT_ROOT/.claude/framework/update/merge-hook-registrations.sh"
_canon_settings="$CLONE_SRC/.claude/settings.json"
if [ -f "$_merge_helper" ] && [ -f "$_canon_settings" ] && [ -f "$PROJECT_ROOT/.claude/settings.json" ]; then
  bash "$_merge_helper" "$PROJECT_ROOT/.claude/settings.json" "$_canon_settings" || true
fi

# Update .framework-version: new pinned SHA, refresh last-checked.
now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp_version="$(mktemp)"
awk -v sha="$latest_sha" -v now="$now_iso" '
  BEGIN { sha_set = 0; ts_set = 0 }
  /^FRAMEWORK_PINNED_SHA=/ { print "FRAMEWORK_PINNED_SHA=" sha; sha_set = 1; next }
  /^FRAMEWORK_LAST_CHECKED=/ { print "FRAMEWORK_LAST_CHECKED=" now; ts_set = 1; next }
  { print }
  END {
    if (!sha_set) print "FRAMEWORK_PINNED_SHA=" sha
    if (!ts_set)  print "FRAMEWORK_LAST_CHECKED=" now
  }
' "$VERSION_FILE" > "$tmp_version"
mv "$tmp_version" "$VERSION_FILE"

# Clear the flag.
rm -f "$FLAG_FILE"

echo ""
echo "apply-update: done. $changed_count path(s) updated."

if [ ${#file_collisions[@]} -gt 0 ]; then
  echo "" >&2
  echo "apply-update: ⚠ FILE COLLISION — these framework-owned files carried" >&2
  echo "              LOCAL CUSTOMISATIONS (they differed from the pinned" >&2
  echo "              framework version) and have just been overwritten:" >&2
  for c in "${file_collisions[@]}"; do
    echo "                - $c   (your version is still at HEAD: git show \"HEAD:$c\")" >&2
  done
  echo "              Manifest paths are framework-owned and get overwritten on" >&2
  echo "              every update. Re-home a custom command under a different" >&2
  echo "              name (e.g. .claude/commands/my-healthcheck.md); put" >&2
  echo "              project-specific rules in CLAUDE.md (never framework-owned)" >&2
  echo "              rather than editing CLAUDE.framework.md directly." >&2
fi

echo "apply-update: review the changes, commit them (e.g., \`chore: update framework to $latest_short\`), and restart the cold start — agent definitions may have changed."
