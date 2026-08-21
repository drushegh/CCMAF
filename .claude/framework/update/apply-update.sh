#!/usr/bin/env bash
# apply-update.sh — Applies a pending framework update.
#
# Overwrites the paths in framework-manifest.txt with the upstream
# version. Project state files are not in the manifest and are never
# touched.
#
# Usage:
#   bash apply-update.sh [--yes|-y] [--no-git]
#     --yes / -y   skip the interactive confirmation prompt (for automation —
#                  e.g. the agent cold-start flow, which already obtained the
#                  human's go-ahead via AskUserQuestion before invoking this).
#     --no-git     proceed even though the project is not a git repository.
#                  There is then NO dirty-check, NO rollback on failure, and
#                  NO recovery path. Only pass this if you accept that risk.
#
# Safety:
#   - Refuses to run if any framework-owned path — including any path that
#     is NEW in this specific update (not just paths already in the local
#     manifest) — has ANY uncommitted state: untracked new files,
#     modifications, or staged changes. Uses `git status`-equivalent
#     plumbing (catches both tracked modifications and untracked files —
#     plain `git diff` misses untracked, which is a destructive blind spot).
#   - Reason: mirroring upstream into a manifest path will remove any
#     local-only file that upstream doesn't have. If those files are
#     uncommitted work-in-progress, they'd be lost unrecoverably. Only
#     committed work can be recovered from git.
#   - Requires a confirmation (interactive prompt, or --yes for automation)
#     before Phase 1/2 touch anything.
#
# Exit codes:
#   0  — update applied successfully.
#   1  — pre-flight safety check failed (uncommitted changes at a
#        framework-owned path, not a git repo and --no-git not passed).
#   2  — .framework-version missing or malformed.
#   3  — network failure fetching upstream, OR a Phase-2 swap failed (rolled
#        back to HEAD when git is available; left as-is under --no-git).
#   4  — user declined the confirmation prompt (or a non-interactive session
#        lacked --yes); nothing was changed.
#   6  — v2 migration-ladder refusal: upstream is a drop release (marked, or
#        detected structurally via the guard entry vanishing) and this
#        project has not completed migrate-v2.sh; nothing was changed.

set -euo pipefail

# Bash 4+ guard (DA-C8): this script uses associative arrays (declare -A),
# which bash 3.2 (stock macOS) lacks — it would die with a cryptic
# "invalid option" mid-run. Fail loudly before touching anything.
if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then
  echo "apply-update: bash >= 4 required (found ${BASH_VERSION:-unknown})." >&2
  echo "apply-update: on macOS: brew install bash, then re-run. Nothing was changed." >&2
  exit 1
fi

AUTO_YES=0
FORCE_NO_GIT=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) AUTO_YES=1 ;;
    --no-git) FORCE_NO_GIT=1 ;;
    *)
      echo "apply-update: unknown argument: $arg" >&2
      echo "Usage: apply-update.sh [--yes|-y] [--no-git]" >&2
      exit 1
      ;;
  esac
done

# Shared interactive-confirmation gate (audit minor e). Automation (the
# agent cold-start flow, CI, etc.) must pass --yes explicitly — we do not
# guess consent from "stdin isn't a tty", which would be silent, not loud.
_confirm() {  # <prompt text>
  [ "$AUTO_YES" = 1 ] && return 0
  if [ ! -t 0 ]; then
    echo "apply-update: refusing to proceed without confirmation in a" >&2
    echo "              non-interactive session. Re-run with --yes (or -y)" >&2
    echo "              to confirm and proceed:" >&2
    echo "                bash .claude/framework/update/apply-update.sh --yes" >&2
    exit 4
  fi
  local reply
  read -r -p "$1 [y/N] " reply
  case "$reply" in
    [Yy]|[Yy][Ee][Ss]) return 0 ;;
    *)
      echo "apply-update: aborted by user — nothing changed." >&2
      exit 4
      ;;
  esac
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Manifest-relative path of the directory THIS script lives in. Always
# ".claude/framework/update" in practice — it is the dir-mirror entry that
# ships apply-update.sh itself (see the self-swap-last note in Phase 2,
# audit minor g).
self_rel="${SCRIPT_DIR#"${PROJECT_ROOT}"/}"

# --- Pre-flight: detect old layout and auto-migrate ---------------------
# Consumers on the pre-9663226 layout still have 00_framework/ at project
# root and state files (TASKS.md etc.) at root. migrate-layout.sh handles
# the one-time git mv + commit + doctor check. Run it before anything else
# so VERSION_FILE resolves to its new .claude/ location.
if [ -d "$PROJECT_ROOT/00_framework" ] || [ -f "$PROJECT_ROOT/TASKS.md" ]; then
  MIGRATE="$SCRIPT_DIR/migrate-layout.sh"
  if [ -x "$MIGRATE" ]; then
    echo "apply-update: old layout detected — running migrate-layout.sh first..."
    # Propagate --yes so an automated apply-update run (the human already
    # confirmed via AskUserQuestion upstream of this) doesn't dead-end on
    # migrate-layout's own confirmation prompt.
    if [ "$AUTO_YES" = 1 ]; then
      bash "$MIGRATE" --yes || exit $?
    else
      bash "$MIGRATE" || exit $?
    fi
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

# CRLF-safe source (DA-M12): `.framework-version` is extensionless and, on a
# Windows clone with core.autocrlf=true, checks out CRLF — sourcing it raw
# leaves a trailing \r on every value. Strip \r via process substitution,
# matching check-updates.sh and the sibling skills-* scripts. (.gitattributes
# also pins these files eol=lf; this is the belt-and-suspenders line.)
# shellcheck disable=SC1090
source <(tr -d '\r' < "$VERSION_FILE")
: "${FRAMEWORK_UPSTREAM_URL:?FRAMEWORK_UPSTREAM_URL missing}"
: "${FRAMEWORK_UPSTREAM_BRANCH:?FRAMEWORK_UPSTREAM_BRANCH missing}"
: "${FRAMEWORK_PINNED_SHA:?FRAMEWORK_PINNED_SHA missing}"

# FRAMEWORK_SOURCE_SUBDIR (default empty = repo root). When set (e.g.
# framework/), the canonical framework lives under <clone>/<subdir>/ and every
# manifest path is relative to it. Empty/absent => repo root, so existing
# consumers are unaffected (backward-compatible). See
# contract:update-source-resolution.
FRAMEWORK_SOURCE_SUBDIR="${FRAMEWORK_SOURCE_SUBDIR:-}"
FRAMEWORK_SOURCE_SUBDIR="${FRAMEWORK_SOURCE_SUBDIR%/}"

# Reject a manifest entry that escapes the project root BEFORE Phase 1/2 use it
# in rm -rf / cp -R. Unsafe = absolute (^/), Windows drive (^[A-Za-z]:), any
# `..` path segment, or any backslash (a Windows-style `..\evil` / `a\..\evil`
# traversal — the forward-slash `..` arms above don't catch it; same guard
# class as skills-sync.sh's skill-name check). A malicious/corrupt upstream
# (or a hand-broken local manifest) must never be able to write outside
# PROJECT_ROOT. NOTE the backslash arm is the QUOTED form `*'\'*`: the unquoted
# `*\\*` collapses to `*\*` (a trailing literal `*`) during shell word-parsing
# and never matches a backslash — so only the quoted form actually rejects a
# Windows-traversal entry (pinned by update_system.bats' backslash-traversal case).
_is_unsafe_manifest_path() {  # <path> → 0 (true) if unsafe
  case "$1" in
    /*|[A-Za-z]:*|../*|*/../*|*/..|..|*'\'*) return 0 ;;
  esac
  return 1
}

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
while IFS= read -r line; do
  line="${line%$'\r'}"
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  if _is_unsafe_manifest_path "${line%/}"; then
    echo "apply-update: ERROR — local manifest entry escapes the project root: '$line'." >&2
    echo "              Refusing before touching anything. Fix framework-manifest.txt." >&2
    exit 2
  fi
  if [[ "$line" == */ ]]; then
    p="${line%/}"
    local_manifest_type[$p]="dir"
  else
    p="$line"
    local_manifest_type[$p]="file"
  fi
done < "$MANIFEST_FILE"

# --- Git-repo requirement (audit minor d) --------------------------------
# Without git there is no dirty-check (uncommitted local content at a
# framework-owned path would be silently destroyed), no automatic rollback
# on a failed swap, and no recovery path afterward. Previously a non-git
# project silently ran Phase 2 with zero protection. Refuse unless the
# adopter explicitly accepts the risk via --no-git.
IS_GIT_REPO=0
if git -C "$PROJECT_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  IS_GIT_REPO=1
elif [ "$FORCE_NO_GIT" != 1 ]; then
  echo "apply-update: refusing — $PROJECT_ROOT is not a git repository." >&2
  echo "" >&2
  echo "Without git there is no dirty-check, no automatic rollback on a" >&2
  echo "failed swap, and no recovery path if this update destroys local" >&2
  echo "content." >&2
  echo "" >&2
  echo "Initialize git in this project (recommended), or re-run with" >&2
  echo "--no-git to proceed anyway with NONE of the above protections." >&2
  exit 1
else
  echo "apply-update: WARNING — proceeding WITHOUT git (--no-git). No dirty-check," >&2
  echo "              no rollback, no recovery path. You asked for this." >&2
fi

# Fetch upstream into a temp dir. Staging lives INSIDE the project root so
# the phase-2 mv below is a same-filesystem rename, not a cross-device copy.
tmp_clone="$(mktemp -d)"
staging="$PROJECT_ROOT/.claude/.update-staging.$$"

# Populated once the final path set is known (below); declared empty here
# so the INT/TERM handler can reference them safely even if a signal
# arrives before that point (nothing to roll back yet in that case).
declare -A final_type=()
final_paths=()
phase2_started=0

# _rollback_framework_paths — restore every final-set framework path to its
# HEAD state. Two cases PER PATH: a single multi-pathspec
# `git checkout HEAD -- "${final_paths[@]}"` aborts WHOLESALE the moment ONE
# pathspec is unknown to HEAD — which happens on the most common interesting
# update: any release that ships a BRAND-NEW manifest path. It then restored
# NOTHING (git exits 1, swallowed by `|| true`) while the caller printed
# "rolled back", leaving a half-applied, mixed-version tree — the exact
# half-applied-tree deadlock BUG-003 fixed, reintroduced through recovery. So
# restore each path individually, branching on HEAD membership:
#   - path exists at HEAD  → `git checkout HEAD -- <path>` restores its
#     tracked content;
#   - path is NEW at HEAD (this update introduced it) → it did not exist
#     before, so REMOVING it (`rm -rf`) is what restores the HEAD state.
# Then `git clean` on dir-mirror entries only (they are 100% framework-owned
# per the manifest contract; a partial mirror may contain files HEAD doesn't
# have that checkout won't remove — but file entries and shared dirs hold
# project content, so clean is never run on those). Shared by swap_fail
# (detected command failure) and the INT/TERM handler; unit-covered by the
# update_system bats tier. Requires: PROJECT_ROOT, final_paths, final_type.
# Always returns 0: this script runs under `set -e`, and a per-path restore
# failing must never abort the INT/TERM handler MID-ROLLBACK.
_rollback_framework_paths() {
  local mp
  for mp in "${final_paths[@]}"; do
    # `HEAD:<path>` resolves to a blob (file) OR a tree (dir) when the path
    # existed at HEAD; `cat-file -e` succeeds for either. The `ls-tree -d`
    # arm is a belt-and-suspenders check for the dir case.
    if git -C "$PROJECT_ROOT" cat-file -e "HEAD:$mp" 2>/dev/null \
       || git -C "$PROJECT_ROOT" ls-tree -d HEAD -- "$mp" 2>/dev/null | grep -q .; then
      git -C "$PROJECT_ROOT" checkout HEAD -- "$mp" 2>/dev/null || true
    else
      # Absent at HEAD → this update newly introduced it; removing IS
      # restoring HEAD. `${PROJECT_ROOT:?}` guards against ever `rm -rf /`.
      rm -rf -- "${PROJECT_ROOT:?}/$mp" 2>/dev/null || true
    fi
  done
  for mp in "${final_paths[@]}"; do
    if [ "${final_type[$mp]:-}" = "dir" ]; then
      git -C "$PROJECT_ROOT" clean -fdq -- "$mp" 2>/dev/null || true
    fi
  done
  return 0
}

# EXIT always cleans the temp clone + staging dir. INT/TERM additionally
# roll back any Phase-2 mutation already applied to the working tree
# before honouring the signal (audit minor f) — previously only a
# DETECTED COMMAND FAILURE triggered rollback (via swap_fail below); a
# SIGINT/SIGTERM mid-Phase-2 left a half-applied, mixed-version tree, and
# the EXIT trap only removed the staging dir (making manual recovery
# harder, not easier, since the staged copies were gone too). Residual
# gap, honestly documented: SIGKILL cannot be trapped by any shell — that
# window cannot be closed here.
_on_interrupt() {
  echo "" >&2
  echo "apply-update: interrupted." >&2
  if [ "$phase2_started" = 1 ] && [ "$IS_GIT_REPO" = 1 ]; then
    echo "apply-update: rolling back the partially-applied update..." >&2
    _rollback_framework_paths
    echo "apply-update: rolled back to HEAD." >&2
  fi
  exit 130
}
trap _on_interrupt INT TERM
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
    if _is_unsafe_manifest_path "${line%/}"; then
      echo "apply-update: ERROR — upstream manifest entry escapes the project root: '$line'." >&2
      echo "              Refusing before staging/swap. Inspect the upstream repo before" >&2
      echo "              trusting this update." >&2
      exit 2
    fi
    if [[ "$line" == */ ]]; then
      p="${line%/}"
      upstream_manifest_type[$p]="dir"
    else
      p="$line"
      upstream_manifest_type[$p]="file"
    fi
  done < "$UPSTREAM_MANIFEST"
fi

# --- v2 migration ladder: refuse the drop release on un-migrated projects.
# v2.1+ ("drop") releases declare themselves in the upstream manifest header
# (# FRAMEWORK-RELEASE-LINE: drop). Applying one to a project that has not
# run migrate-v2.sh would PRUNE every retired bundled path — including the
# dangerous-command guard — before any plugin replacement exists.
# The gate requires BOTH v2 markers (panel finding, fable S2 + sol B2 —
# the v2 line alone is hand-writable/forgeable):
#   1. the tombstone (.claude/.migrate-v2-tombstone) — the MIGRATION marker,
#      created when migrate-v2.sh begins deleting;
#   2. FRAMEWORK_LINE=v2 (anchored — `v20` must not pass) — the ACTIVATION
#      marker, written after deletions.
# A v2 line without a tombstone is always illegitimate on a tree still
# running this bundled updater. (TASK-166; DESIGN.md "two-release ladder".)
MIGRATE_TOMBSTONE="$PROJECT_ROOT/.claude/.migrate-v2-tombstone"
_v2_migrated() {
  [ -f "$MIGRATE_TOMBSTONE" ] \
    && grep -Eq '^[[:space:]]*FRAMEWORK_LINE=v2[[:space:]]*$' "$PROJECT_ROOT/.claude/.framework-version" 2>/dev/null
}
_refuse_drop() {
  echo "apply-update: REFUSING — $1" >&2
  echo "              Applying it would delete the bundled hooks (including the" >&2
  echo "              dangerous-command guard) with no plugin replacement." >&2
  echo "              Run the migration first:  bash .claude/framework/update/migrate-v2.sh" >&2
  echo "              (Un-migrated projects can stay on their current version harmlessly.)" >&2
  exit 6
}
if [ -f "$UPSTREAM_MANIFEST" ] \
  && grep -Eq '^#[[:space:]]*FRAMEWORK-RELEASE-LINE:[[:space:]]*drop' "$UPSTREAM_MANIFEST" \
  && ! _v2_migrated; then
  _refuse_drop "upstream is a v2 DROP release, but this project has not completed the v2 migration."
fi
# Structural backstop (panel finding, sol B3 — a mis-authored drop release
# could omit the marker): if the GUARD's manifest entry vanished upstream
# while this project is un-migrated, that is a drop release regardless of
# what the header says. Safety-tier paths never silently prune.
if [ -f "$UPSTREAM_MANIFEST" ] && ! _v2_migrated \
  && [ -n "${local_manifest_type[.claude/hooks/block-dangerous-commands.py]:-}" ] \
  && [ -z "${upstream_manifest_type[.claude/hooks/block-dangerous-commands.py]:-}" ]; then
  _refuse_drop "upstream's manifest no longer lists the dangerous-command guard (a v2 drop release, marked or not), and this project has not completed the v2 migration."
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
#
# NOTE: `final_type` was `declare -A`'d empty above (before the traps) so
# the INT/TERM handler always has a valid (if empty) array to look at.

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

# --- v2 migration tombstone: never resurrect, never re-prune (TASK-166).
# migrate-v2.sh records every retired path in .claude/.migrate-v2-tombstone
# (each entry written BEFORE its deletion, so even a crashed migration
# leaves accurate tombstones). Excluding those paths here means a
# bridge-window update can neither re-mirror a retired copy back into the
# project nor double-process a half-migrated path. Entries use manifest
# grammar; unsafe entries are SKIPPED (never trusted — the file lives in
# the consumer tree); a tombstoned DIRECTORY also suppresses any manifest
# entry nested under it (future file-level granularity cannot resurrect
# content inside a retired dir).
if [ -f "$MIGRATE_TOMBSTONE" ]; then
  tombstoned_count=0
  while IFS= read -r line; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if _is_unsafe_manifest_path "${line%/}"; then
      echo "apply-update: WARNING — ignoring unsafe tombstone entry: '$line'" >&2
      continue
    fi
    t="${line%/}"
    if [ -n "${final_type[$t]:-}" ]; then
      unset 'final_type[$t]'
      tombstoned_count=$((tombstoned_count + 1))
    fi
    if [[ "$line" == */ ]]; then
      for fp in "${!final_type[@]}"; do
        if [[ "$fp" == "$t"/* ]]; then
          unset 'final_type[$fp]'
          tombstoned_count=$((tombstoned_count + 1))
        fi
      done
    fi
  done < "$MIGRATE_TOMBSTONE"
  [ "$tombstoned_count" -gt 0 ] \
    && echo "apply-update: skipping $tombstoned_count tombstoned path(s) (.claude/.migrate-v2-tombstone — retired by the v2 migration)."
fi

# Deterministic, sorted list of every path this run will touch. This is
# the FINAL set — a strict superset of the local manifest, since it also
# carries any brand-new upstream path this update introduces.
mapfile -t final_paths < <(printf '%s\n' "${!final_type[@]}" | sort)

# --- Pre-flight: refuse if any FINAL-set path has uncommitted state -----
# (audit finding C1) Previously this loop ran over the LOCAL manifest,
# built before upstream was even fetched. Phase 2 processes `final_type`,
# a SUPERSET that includes upstream's brand-new paths — those got NO
# dirty-check at all, so pre-existing untracked content at a
# newly-introduced manifest path was silently rm -rf'd. Running the check
# over `final_paths` closes that gap: every path Phase 2 can touch is
# checked before anything is staged, let alone swapped.
#
# We use plumbing commands rather than `git status --porcelain` because
# on Windows (core.autocrlf=true) status reports CRLF-normalisation
# noise as modifications even when content is byte-identical in git's
# view. Content-based diffing (git diff) + explicit untracked listing
# (ls-files --others) gives us a clean, portable dirty check.
if [ "$IS_GIT_REPO" = 1 ]; then
  # Refresh the stat cache first so diff sees actual content state, not
  # stale mtime from a previous checkout.
  git -C "$PROJECT_ROOT" update-index --refresh >/dev/null 2>&1 || true

  dirty_report=""
  for p in "${final_paths[@]}"; do
    # Tracked modifications — content-level comparison (CRLF-aware on
    # Windows), unlike `diff-index` which compares blob SHAs and falsely
    # flags files that differ only by line-ending normalisation.
    modified=$(git -C "$PROJECT_ROOT" diff --name-only HEAD -- "$p" 2>/dev/null || true)
    # Staged-but-uncommitted.
    staged=$(git -C "$PROJECT_ROOT" diff --name-only --cached HEAD -- "$p" 2>/dev/null || true)
    # Untracked files under the path — this is the case that matters most
    # for C1: pre-existing content at a path upstream has only just
    # claimed.
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
    echo "Framework-owned paths (listed in framework-manifest.txt, plus any path" >&2
    echo "this update newly introduces) get overwritten on every update — custom" >&2
    echo "local content in these paths does not belong here." >&2
    exit 1
  fi
fi

# --- Confirmation gate (audit minor e) -----------------------------------
# apply-update mutates the adopter's real project unattended. Require an
# explicit go-ahead before Phase 1/2 touch anything. --yes/-y bypasses
# this for automation (the cold-start flow already obtained the human's
# go-ahead via AskUserQuestion before invoking this script).
echo ""
echo "apply-update: the following ${#final_paths[@]} framework-owned path(s) will be updated:"
for p in "${final_paths[@]}"; do
  echo "  - $p"
done
echo ""
_confirm "Proceed with the update?"

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
  if [ "$IS_GIT_REPO" = 1 ]; then
    echo "apply-update: rolling back — restoring framework paths to HEAD so the" >&2
    echo "              working tree is NOT left half-updated (BUG-003)..." >&2
    _rollback_framework_paths
    echo "apply-update: rolled back to HEAD — no partial update remains. Fix the" >&2
    echo "              cause above, then re-run apply-update." >&2
  else
    echo "apply-update: no git repo — you ran with --no-git and were warned there" >&2
    echo "              would be no rollback and no recovery path. The working" >&2
    echo "              tree is left as-is; restore it from a backup if you have one." >&2
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

# File-collision detection (TASK-039 + TASK-045, fleet sweep; audit C1/M2): a
# consumer may have a CUSTOM command at a framework-shipped name (e.g. their
# own /healthcheck), have edited CLAUDE.framework.md directly instead of
# using CLAUDE.md, or customised a hook — committed, so the dirty-check
# passes, and silently destroyed by the overwrite. Detect it by comparing
# the local copy against the PINNED upstream version (CRLF-normalised):
# match → stock file, upstream merely evolved, stay silent; mismatch (or
# file absent at the pin) → the local copy was customised, name it loudly
# after the update. Runs over EVERY file-overwrite manifest entry, not a
# hardcoded subset (M2: hooks were previously excluded, so a customised
# hook was reverted with no warning). Needs the pinned SHA present in the
# clone (depth-1 → unshallow on demand; best-effort).
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
changed_count=0

# _swap_one_path <manifest-path> — moves one staged entry (or deletes an
# upstream-removed one) into place. Extracted into a function so Phase 2
# can process the path containing THIS running script last (see below).
_swap_one_path() {
  local p="$1" t src dst
  t="${final_type[$p]}"
  src="$CLONE_SRC/$p"
  dst="$PROJECT_ROOT/$p"

  if [ ! -e "$src" ]; then
    if [ -e "$dst" ]; then
      echo "  - $p (removed upstream)"
      rm -rf "$dst" || swap_fail "$p"
      changed_count=$((changed_count + 1))
    fi
    return
  fi

  if [ "$t" = "dir" ]; then
    echo "  - $p/ (directory mirror)"
    { rm -rf "$dst" && mkdir -p "$(dirname "$dst")" && mv "$staging/$p" "$dst"; } || swap_fail "$p"
  else
    # File entry: check for a customised collision BEFORE overwriting (see
    # the file-collision comment above _is_customised).
    if [ -f "$dst" ] && ! cmp -s "$staging/$p" "$dst" && _is_customised "$p" "$dst"; then
      file_collisions+=("$p")
    fi
    echo "  - $p (file overwrite)"
    # If dst exists as a dir (semantic change from dir to file), remove it
    # first so the mv lands correctly.
    { mkdir -p "$(dirname "$dst")" \
        && { [ ! -d "$dst" ] || rm -rf "$dst"; } \
        && mv "$staging/$p" "$dst"; } || swap_fail "$p"
  fi
  changed_count=$((changed_count + 1))
}

# Phase 2 — swap staged entries into place. `self_rel` (".claude/framework/
# update", computed at the top from SCRIPT_DIR) is processed LAST (audit
# minor g): it is the dir-mirror entry that ships THIS running script, so
# its swap deletes-then-recreates the directory this process is currently
# executing out of.
#
# [TESTED, not just assumed] Empirically verified on this machine — Windows
# 11, Git Bash / MSYS2 bash 5.2.26 — with a ~1MB script padded so parsing
# must keep reading from the file well after the rm-rf+mv point: the
# process continued executing correctly to completion after its own
# containing directory was deleted and replaced (MSYS2's POSIX layer keeps
# the open handle valid, matching plain POSIX unlink-while-open semantics).
# Not verified under every possible Windows configuration (e.g. an AV
# product holding an exclusive lock could behave differently), so
# processing this entry last remains cheap, worthwhile insurance: if it
# ever does misbehave on some other setup, it is provably the FINAL Phase-2
# action, so no other manifest path is left half-swapped because of it.
phase2_started=1
while IFS= read -r p; do
  [ "$p" = "$self_rel" ] && continue
  _swap_one_path "$p"
done < <(printf '%s\n' "${!final_type[@]}" | sort)
if [ -n "${final_type[$self_rel]:-}" ]; then
  _swap_one_path "$self_rel"
fi

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
  # Also hand the merge helper the PINNED (previous) canonical settings so it can
  # spot framework hook registrations the consumer still carries that this update
  # RETIRED or whose command CHANGED — additive-merge alone would leave the old,
  # now-stale registration in place → the hook double-fires. Best-effort: only
  # when the pinned SHA is present in the clone (unshallowed above for the
  # file-collision check); absent → helper falls back to additive-only.
  _pinned_settings=""
  if [ "${pinned_available:-0}" = 1 ]; then
    _pinned_settings="$(mktemp "$PROJECT_ROOT/.claude/.pinned-settings.json.XXXXXX")"
    if ! git -C "$tmp_clone" show "$FRAMEWORK_PINNED_SHA:${SRC_GIT_PREFIX}.claude/settings.json" > "$_pinned_settings" 2>/dev/null; then
      rm -f "$_pinned_settings"
      _pinned_settings=""
    fi
  fi
  bash "$_merge_helper" "$PROJECT_ROOT/.claude/settings.json" "$_canon_settings" "$_pinned_settings" || true
  [ -n "$_pinned_settings" ] && rm -f "$_pinned_settings"
fi

# Update .framework-version: new pinned SHA, refresh last-checked.
# mktemp -p alongside the destination (audit minor a): mktemp's default
# (system temp — C: on Windows) plus `mv` to a project-drive file is a
# cross-filesystem copy+unlink, not an atomic rename — an interruption
# mid-copy can truncate .framework-version. Same-directory mktemp keeps
# the final `mv` a same-filesystem rename.
now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
tmp_version="$(mktemp "$(dirname "$VERSION_FILE")/.framework-version.XXXXXX")"
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
    # Truthful recovery hint per file state (audit minor b): the old text
    # ("your version is still at HEAD") was printed unconditionally, but a
    # file that was never actually tracked at HEAD (e.g. a same-name file
    # the consumer added without committing it — normally caught by the
    # dirty-check above, but this stays honest even if that ever changes)
    # has nothing to `git show`. Check before claiming it.
    if [ "$IS_GIT_REPO" = 1 ] && git -C "$PROJECT_ROOT" cat-file -e "HEAD:$c" 2>/dev/null; then
      echo "                - $c   (your version is still at HEAD: git show \"HEAD:$c\")" >&2
    else
      echo "                - $c   (WARNING: no prior version found at HEAD — it is NOT" >&2
      echo "                  recoverable from git)" >&2
    fi
  done
  echo "              Manifest paths are framework-owned and get overwritten on" >&2
  echo "              every update. Re-home a custom command under a different" >&2
  echo "              name (e.g. .claude/commands/my-healthcheck.md); put" >&2
  echo "              project-specific rules in CLAUDE.md (never framework-owned)" >&2
  echo "              rather than editing CLAUDE.framework.md or a hook directly." >&2
fi

echo "apply-update: review the changes, commit them (e.g., \`chore: update framework to $latest_short\`), and restart the cold start — agent definitions may have changed."
