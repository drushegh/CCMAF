#!/usr/bin/env bash
# migrate-layout.sh — One-time layout migration for consumers upgrading from
# the 00_framework/ layout to the .claude/framework/ layout (commit 9663226).
#
# Safe to run multiple times (idempotent).
#
# Usage (from project root):
#   bash .claude/framework/update/migrate-layout.sh
#
# Or, if the framework hasn't been updated yet, download and run directly:
#   curl -fsSL https://raw.githubusercontent.com/drushegh/CCMAF/main/.claude/framework/update/migrate-layout.sh | bash
#
# Exit codes:
#   0 — already migrated (no-op) OR migration succeeded with no CRITICAL doctor findings
#   1 — migration succeeded but doctor found CRITICAL issues (fix before continuing)
#   2 — git error during mv or commit

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$PROJECT_ROOT"

# --- Detection -----------------------------------------------------------
OLD_LAYOUT=false
[ -d "00_framework" ]  && OLD_LAYOUT=true
[ -f "TASKS.md" ]      && OLD_LAYOUT=true

if [ "$OLD_LAYOUT" = "false" ]; then
  echo "migrate-layout: already on new layout (.claude/framework/) — nothing to do."
  exit 0
fi

echo "migrate-layout: old layout detected — migrating to .claude/framework/ ..."
echo ""

# --- Require clean working tree in framework-owned paths ----------------
# Porcelain v1 lines are "XY PATH" — two status chars, a space, then the
# path. The pattern must consume that space (BUG-002: without it the
# alternation tried to match at the space and never fired, so migration
# proceeded over uncommitted framework-path changes).
DIRTY=$(git status --porcelain 2>/dev/null | grep -E "^.. \"?(00_framework/|TASKS\.md|STATUS\.md|DECISIONS\.md|ECOSYSTEM\.md|GOTCHAS\.md|FRAMEWORK-SUGGESTIONS\.md|claude-progress\.txt|framework-metrics\.md|\.framework-version)" || true)
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

# --- Step 4: Update .gitignore ------------------------------------------
if [ -f ".gitignore" ]; then
  # Move temp flag gitignore entries to new paths (idempotent via check)
  if grep -q "^\.framework-update-available\.md" .gitignore 2>/dev/null; then
    sed -i \
      -e 's|^\.framework-update-available\.md$|.claude/.framework-update-available.md|' \
      -e 's|^\.framework-insight-alert\.md$|.claude/.framework-insight-alert.md|' \
      -e 's|^\.framework-doctor-findings\.md$|.claude/.framework-doctor-findings.md|' \
      .gitignore 2>/dev/null || true
    # Update the 00_framework/self/README.md comment if present
    sed -i 's|see 00_framework/self/README\.md|see .claude/framework/self/README.md|g' \
      .gitignore 2>/dev/null || true
    git add .gitignore 2>/dev/null || true
    echo "  updated: .gitignore (temp flag paths)"
  fi
fi

# --- Step 5: Update CLAUDE.md references --------------------------------
if [ -f "CLAUDE.md" ]; then
  sed -i \
    -e 's|00_framework/self/|.claude/framework/self/|g' \
    -e 's|00_framework/|.claude/framework/|g' \
    CLAUDE.md 2>/dev/null || true
  echo "  updated: CLAUDE.md (path references)"
fi

# --- Step 6: Update CLAUDE.framework.md if still at root ----------------
# (Normally framework-owned and updated via apply-update, but update it here
#  in case the consumer is doing a one-shot manual migration.)
if [ -f "CLAUDE.framework.md" ]; then
  sed -i \
    -e 's|00_framework/self/|.claude/framework/self/|g' \
    -e 's|00_framework/|.claude/framework/|g' \
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
fi

# --- Step 7: Commit -------------------------------------------------------
echo ""
echo "migrate-layout: committing migration..."
# Enumerated paths, not `git add -A` (DA-H5): migration only touches these;
# -A would sweep in unrelated untracked files (worst case: secrets a weak
# consumer .gitignore misses) into an automated commit.
git add .claude CLAUDE.md CLAUDE.framework.md .gitignore 2>/dev/null || true

# Only commit if there are staged changes
if git diff --cached --quiet 2>/dev/null; then
  echo "migrate-layout: nothing new to commit (all changes already staged)."
else
  git commit -m "chore: framework layout migration — 00_framework/ → .claude/framework/" \
    2>&1 || { echo "ERROR: git commit failed" >&2; exit 2; }
  echo "migrate-layout: committed."
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
