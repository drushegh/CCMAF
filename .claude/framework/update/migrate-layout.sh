#!/usr/bin/env bash
# migrate-layout.sh — One-time layout migration for consumers upgrading from
# the 00_framework/ layout to the .claude/framework/ layout (commit 9663226).
#
# Safe to run multiple times (idempotent).
#
# Usage (from project root):
#   bash .claude/framework/update/migrate-layout.sh [--yes|-y] [--stage-only]
#     --yes / -y     skip the pre-commit confirmation prompt (for automation —
#                    e.g. apply-update.sh auto-invokes this script and
#                    propagates --yes when it was itself given --yes).
#     --stage-only   perform the FULL migration (moves + reference rewrites)
#                    and stage it, but do NOT commit — review with
#                    `git diff --staged`, then commit yourself. Takes
#                    precedence over --yes if both are given. This is also
#                    exactly the state an interactive decline leaves behind.
#
# Or, if the framework hasn't been updated yet, download and run directly:
#   curl -fsSL https://raw.githubusercontent.com/drushegh/CCMAF/main/.claude/framework/update/migrate-layout.sh | bash
#
# Exit codes:
#   0 — already migrated (no-op) OR migration committed with no CRITICAL
#       doctor findings OR --stage-only completed (staged, not committed)
#   1 — migration succeeded but doctor found CRITICAL issues (fix before continuing)
#   2 — git error during mv or commit, OR the adopter declined the
#       interactive pre-commit confirmation. On decline the COMPLETE,
#       coherent migration (mv relocations + reference rewrites — they
#       belong together: restoring the rewrites while the dirs have moved
#       would leave references pointing at paths that no longer exist) is
#       left STAGED and uncommitted for review.
#   4 — non-interactive session without --yes/--stage-only: refused at
#       entry, before ANY mutation — the tree is untouched.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$PROJECT_ROOT" || exit 2

AUTO_YES=0
STAGE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) AUTO_YES=1 ;;
    --stage-only) STAGE_ONLY=1 ;;
    *)
      echo "migrate-layout: unknown argument: $arg" >&2
      echo "Usage: migrate-layout.sh [--yes|-y] [--stage-only]" >&2
      exit 2
      ;;
  esac
done

# --- Detection -----------------------------------------------------------
OLD_LAYOUT=false
[ -d "00_framework" ]  && OLD_LAYOUT=true
[ -f "TASKS.md" ]      && OLD_LAYOUT=true

if [ "$OLD_LAYOUT" = "false" ]; then
  echo "migrate-layout: already on new layout (.claude/framework/) — nothing to do."
  exit 0
fi

# --- Entry gate: non-interactive needs explicit consent ------------------
# The migration mutates the adopter's real project (git mv + reference
# rewrites + optionally a commit). A non-interactive session cannot answer
# the pre-commit prompt, so without an explicit flag we refuse HERE —
# before any mutation — rather than mid-run with the tree half-migrated.
# --yes consents to migrate-and-commit; --stage-only consents to
# migrate-without-commit.
if [ "$AUTO_YES" != 1 ] && [ "$STAGE_ONLY" != 1 ] && [ ! -t 0 ]; then
  echo "migrate-layout: non-interactive session and no --yes/--stage-only flag —" >&2
  echo "                refusing to run the migration. Nothing was changed." >&2
  echo "                Re-run with --yes (migrate and commit), --stage-only" >&2
  echo "                (migrate and stage, commit yourself), or interactively" >&2
  echo "                to review and confirm." >&2
  exit 4
fi

echo "migrate-layout: old layout detected — migrating to .claude/framework/ ..."
echo ""

# Best-effort cleanup of the pre-rewrite snapshots Steps 4-6 create (to
# detect whether a sed pass actually changed anything) in case the script
# is interrupted between creating one and removing it.
trap 'rm -f "$PROJECT_ROOT/.gitignore.migrate-pre.tmp" "$PROJECT_ROOT/CLAUDE.md.migrate-pre.tmp" "$PROJECT_ROOT/CLAUDE.framework.md.migrate-pre.tmp"' EXIT

# --- Require clean working tree in framework-owned paths ----------------
# Porcelain v1 lines are "XY PATH" — two status chars, a space, then the
# path. The pattern must consume that space (BUG-002: without it the
# alternation tried to match at the space and never fired, so migration
# proceeded over uncommitted framework-path changes).
#
# CLAUDE.md, CLAUDE.framework.md and .gitignore are included here (audit
# M3): Steps 5-6 below rewrite them with sed and Step 7 auto-commits the
# result. Before this fix those three files were rewritten/committed
# UNCHECKED — a customised CLAUDE.md with uncommitted edits could have
# those edits swept into the automated migration commit.
DIRTY=$(git status --porcelain 2>/dev/null | grep -E "^.. \"?(00_framework/|TASKS\.md|STATUS\.md|DECISIONS\.md|ECOSYSTEM\.md|GOTCHAS\.md|FRAMEWORK-SUGGESTIONS\.md|claude-progress\.txt|framework-metrics\.md|\.framework-version|CLAUDE\.md|CLAUDE\.framework\.md|\.gitignore)" || true)
if [ -n "$DIRTY" ]; then
  echo "migrate-layout: ERROR — uncommitted changes in framework-owned paths:" >&2
  echo "$DIRTY" >&2
  echo "Commit or stash your work first, then re-run." >&2
  exit 2
fi

# --- Step 1: Move framework directory ------------------------------------
if [ -d "00_framework" ]; then
  if [ -d ".claude/framework" ]; then
    # .claude/framework/ already exists (e.g., migrate-layout.sh was manually placed there).
    # git mv with a pre-existing target puts src INSIDE target — move subdirs individually.
    echo "  git mv 00_framework/* → .claude/framework/ (merge into existing dir)"
    for entry in 00_framework/*/; do
      [ -e "$entry" ] || continue
      name="${entry%$'\r'}"
      name="$(basename "$name")"
      if [ ! -e ".claude/framework/$name" ]; then
        git mv "00_framework/$name" ".claude/framework/$name" 2>&1 \
          || { echo "ERROR: git mv 00_framework/$name failed" >&2; exit 2; }
      fi
    done
    # Move any top-level files in 00_framework/
    for f in 00_framework/*; do
      [ -f "$f" ] || continue
      name="$(basename "$f")"
      [ ! -f ".claude/framework/$name" ] && \
        git mv "$f" ".claude/framework/$name" 2>&1
    done
    # Remove any remaining 00_framework/ content from git index and disk
    git rm -r --cached 00_framework/ 2>/dev/null || true
    rm -rf 00_framework/ 2>/dev/null || true
  else
    echo "  git mv 00_framework/ → .claude/framework/"
    git mv 00_framework/ .claude/framework/ 2>&1 \
      || { echo "ERROR: git mv 00_framework/ failed" >&2; exit 2; }
  fi
fi

# --- Step 2: Move root state files --------------------------------------
_mv_if_exists() {
  local src="$1" dst="$2"
  if [ -f "$src" ]; then
    echo "  git mv $src → $dst"
    git mv "$src" "$dst" 2>&1 || { echo "ERROR: git mv $src failed" >&2; exit 2; }
  fi
}

_mv_if_exists TASKS.md              .claude/TASKS.md
_mv_if_exists STATUS.md             .claude/STATUS.md
_mv_if_exists DECISIONS.md          .claude/DECISIONS.md
_mv_if_exists ECOSYSTEM.md          .claude/ECOSYSTEM.md
_mv_if_exists GOTCHAS.md            .claude/GOTCHAS.md
_mv_if_exists FRAMEWORK-SUGGESTIONS.md .claude/FRAMEWORK-SUGGESTIONS.md
_mv_if_exists claude-progress.txt   .claude/claude-progress.txt
_mv_if_exists framework-metrics.md  .claude/framework-metrics.md
_mv_if_exists review-findings.md    .claude/review-findings.md

# --- Step 3: Move framework config files --------------------------------
_mv_if_exists .framework-version    .claude/.framework-version
_mv_if_exists claude-code-dev-framework.md .claude/claude-code-dev-framework.md

# Files actually rewritten below get staged individually at commit time
# (Step 7) — never a blanket `git add -A` (DA-H5). `.claude` (the mv
# destinations above) is always staged; CLAUDE.md / CLAUDE.framework.md /
# .gitignore are staged ONLY if Steps 4-6 below actually changed them
# (audit M3: "never git add a user-owned file the migration didn't rewrite").
_files_to_add=(".claude")

# --- Step 4: Update .gitignore ------------------------------------------
if [ -f ".gitignore" ]; then
  # Move temp flag gitignore entries to new paths (idempotent via check)
  if grep -q "^\.framework-update-available\.md" .gitignore 2>/dev/null; then
    cp .gitignore .gitignore.migrate-pre.tmp
    sed -i \
      -e 's|^\.framework-update-available\.md$|.claude/.framework-update-available.md|' \
      -e 's|^\.framework-insight-alert\.md$|.claude/.framework-insight-alert.md|' \
      -e 's|^\.framework-doctor-findings\.md$|.claude/.framework-doctor-findings.md|' \
      .gitignore 2>/dev/null || true
    # Update the 00_framework/self/README.md comment if present
    sed -i 's|see 00_framework/self/README\.md|see .claude/framework/self/README.md|g' \
      .gitignore 2>/dev/null || true
    if ! cmp -s .gitignore.migrate-pre.tmp .gitignore; then
      _files_to_add+=(".gitignore")
      echo "  updated: .gitignore (temp flag paths)"
    fi
    rm -f .gitignore.migrate-pre.tmp
  fi
fi

# --- Step 5: Update CLAUDE.md references --------------------------------
# Token-boundary matching (audit M3, corrected): rewrite EVERY
# `00_framework/...` path reference, backticked or bare — old-layout files
# predate any backtick convention and real content carries both shapes, so
# a backtick-anchored sed under-matches and leaves stale references in a
# file the agent loads at cold start. `\b` (GNU sed word boundary) stops
# substrings of longer tokens (e.g. my00_framework/) from matching. sed
# cannot semantically distinguish a bare path reference from prose that
# merely names the path — that safety comes from Step 7's shown diff +
# explicit confirmation gate before anything is COMMITTED: the audit's
# requirement is that nothing is SILENTLY rewritten or committed.
if [ -f "CLAUDE.md" ]; then
  cp CLAUDE.md CLAUDE.md.migrate-pre.tmp
  sed -i \
    -e 's|\b00_framework/self/|.claude/framework/self/|g' \
    -e 's|\b00_framework/|.claude/framework/|g' \
    CLAUDE.md 2>/dev/null || true
  if ! cmp -s CLAUDE.md.migrate-pre.tmp CLAUDE.md; then
    _files_to_add+=("CLAUDE.md")
    echo "  updated: CLAUDE.md (path references)"
  fi
  rm -f CLAUDE.md.migrate-pre.tmp
fi

# --- Step 6: Update CLAUDE.framework.md if still at root ----------------
# (Normally framework-owned and updated via apply-update, but update it here
#  in case the consumer is doing a one-shot manual migration.) Same
# token-boundary rationale as Step 5 for the two 00_framework/
# substitutions — bare and backticked references both rewrite; the
# file-specific rules below were backtick-anchored on both sides upstream
# and stay as-is.
if [ -f "CLAUDE.framework.md" ]; then
  cp CLAUDE.framework.md CLAUDE.framework.md.migrate-pre.tmp
  sed -i \
    -e 's|\b00_framework/self/|.claude/framework/self/|g' \
    -e 's|\b00_framework/|.claude/framework/|g' \
    -e 's|`\.framework-update-available\.md`|`.claude/.framework-update-available.md`|g' \
    -e 's|`\.framework-insight-alert\.md`|`.claude/.framework-insight-alert.md`|g' \
    -e 's|`\.framework-doctor-findings\.md`|`.claude/.framework-doctor-findings.md`|g' \
    -e 's|Read `TASKS\.md`|Read `.claude/TASKS.md`|g' \
    -e 's|Read `STATUS\.md`|Read `.claude/STATUS.md`|g' \
    -e 's|Read `DECISIONS\.md`|Read `.claude/DECISIONS.md`|g' \
    -e 's|Read `claude-progress\.txt`|Read `.claude/claude-progress.txt`|g' \
    -e 's|Default: ECOSYSTEM\.md|Default: `.claude/ECOSYSTEM.md`|g' \
    -e 's|Default: DECISIONS\.md|Default: `.claude/DECISIONS.md`|g' \
    CLAUDE.framework.md 2>/dev/null || true
  if ! cmp -s CLAUDE.framework.md.migrate-pre.tmp CLAUDE.framework.md; then
    _files_to_add+=("CLAUDE.framework.md")
    echo "  updated: CLAUDE.framework.md (path references)"
  fi
  rm -f CLAUDE.framework.md.migrate-pre.tmp
fi

# --- Step 7: Commit -------------------------------------------------------
echo ""
echo "migrate-layout: staging migration changes..."
git add "${_files_to_add[@]}" 2>/dev/null || true

# The staged-but-uncommitted notice shared by --stage-only and an
# interactive decline. Both leave the COMPLETE migration staged: the mv
# relocations and the reference rewrites belong together — undoing only
# the rewrites would leave references pointing at directories that have
# physically moved, an internally broken tree.
_print_staged_notice() {
  echo "migrate-layout: nothing was committed. The full migration (file moves +" >&2
  echo "                reference rewrites) is STAGED for your review:" >&2
  echo "                  git diff --staged" >&2
  echo "                Commit it when satisfied. To discard a single file:" >&2
  echo "                  git restore --staged <file> && git checkout -- <file>" >&2
}

# Only commit if there are staged changes
if git diff --cached --quiet 2>/dev/null; then
  echo "migrate-layout: nothing new to commit (all changes already staged)."
else
  echo ""
  echo "migrate-layout: the following will be committed:"
  echo ""
  git diff --cached --stat
  echo ""
  # Confirmation gate (audit M3): the gate protects the COMMIT, not the
  # rewrite. The diff above is shown, and nothing lands in history without
  # the adopter's explicit go-ahead (--yes, or answering the prompt) — that
  # is what satisfies the audit's "no silent rewrite/auto-commit of
  # user-owned files": a decline leaves a reviewable, coherent staged tree
  # and an untouched history. The entry gate at the top of this script
  # already guaranteed we are either interactive here or were passed an
  # explicit flag.
  if [ "$STAGE_ONLY" = 1 ]; then
    _print_staged_notice
  else
    if [ "$AUTO_YES" != 1 ]; then
      reply=""
      read -r -p "Commit these changes? [y/N] " reply || true
      case "$reply" in
        [Yy]|[Yy][Ee][Ss]) : ;;
        *)
          echo "migrate-layout: declined." >&2
          _print_staged_notice
          exit 2
          ;;
      esac
    fi
    git commit -m "chore: framework layout migration — 00_framework/ → .claude/framework/" \
      2>&1 || { echo "ERROR: git commit failed" >&2; exit 2; }
    echo "migrate-layout: committed."
  fi
fi

# --- Step 8: Run doctor ---------------------------------------------------
echo ""
echo "migrate-layout: running doctor check..."
DOCTOR="$PROJECT_ROOT/.claude/framework/doctor/doctor.sh"
if [ -x "$DOCTOR" ]; then
  bash "$DOCTOR" 2>&1
  FINDINGS_FILE="$PROJECT_ROOT/.claude/.framework-doctor-findings.md"
  if [ -f "$FINDINGS_FILE" ]; then
    # Doctor's finding format: "- **CRITICAL** — [check] message"
    # (The `|| echo "0"` antipattern is avoided — grep -c prints 0 on no match.)
    CRIT=$(grep -c '^- \*\*CRITICAL\*\*' "$FINDINGS_FILE" 2>/dev/null)
    CRIT="${CRIT:-0}"
    if [ "$CRIT" -gt 0 ]; then
      echo ""
      echo "migrate-layout: ⚠ Doctor found $CRIT CRITICAL issue(s) — review .claude/.framework-doctor-findings.md"
      echo "Fix these before running apply-update.sh."
      exit 1
    fi
  fi
else
  echo "migrate-layout: doctor not found at $DOCTOR — skipping check."
fi

echo ""
echo "migrate-layout: ✓ Migration complete."
echo ""
echo "Next step: sync framework content to the new layout:"
echo "  bash .claude/framework/update/apply-update.sh"
exit 0
