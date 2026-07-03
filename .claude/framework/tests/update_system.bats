#!/usr/bin/env bats
# Update-system test tier (TASK-032): apply-update / check-updates /
# migrate-layout / doctor against synthetic local-path upstream + consumer
# fixtures (see update_helpers.bash). Fully offline; everything lives in
# $BATS_TEST_TMPDIR.

load update_helpers

# --- apply-update.sh --------------------------------------------------

@test "apply-update: happy path — file overwrite, dir mirror, project sibling survives" {
  build_upstream
  build_consumer
  run apply_update
  [ "$status" -eq 0 ]
  grep -q "owned v2" "$CONSUMER/.claude/framework/owned/file.txt"
  [ -f "$CONSUMER/.claude/framework/owned/new-in-v2.txt" ]
  grep -q "hook v2"  "$CONSUMER/.claude/hooks/sample-hook.sh"
  grep -q "rules v2" "$CONSUMER/CLAUDE.framework.md"
  # Project-owned sibling in the shared hooks dir is untouched.
  grep -q "must survive" "$CONSUMER/.claude/hooks/project-hook.sh"
  [[ "$output" == *"path(s) updated"* ]]
}

@test "apply-update: file nested under a dir-mirror entry updates cleanly, no cannot-stat (BUG-003)" {
  # The fixture manifest lists owned/nested.sh as a FILE under the owned/
  # dir-mirror — the shape of the real migrate-layout.sh-under-update/ entry.
  # Pre-fix, the dir's `mv` moved the staged subtree first, so the nested
  # file entry's `mv` hit "cannot stat" and aborted with a half-applied tree.
  build_upstream
  build_consumer
  run apply_update
  [ "$status" -eq 0 ]
  [[ "$output" != *"cannot stat"* ]]
  [[ "$output" != *"failed swapping"* ]]
  # The nested file still ships (via the dir mirror) and is updated to v2.
  grep -q "nested v2" "$CONSUMER/.claude/framework/owned/nested.sh"
  # And the rest of the mirror landed too (not left half-applied).
  grep -q "owned v2" "$CONSUMER/.claude/framework/owned/file.txt"
}

@test "apply-update: FRAMEWORK_SOURCE_SUBDIR sources canonical from the subdir (TASK-054)" {
  build_upstream_subdir "02_solution"     # canonical under 02_solution/
  build_consumer                          # consumer root has no subdir
  set_version_field FRAMEWORK_SOURCE_SUBDIR "02_solution"
  run apply_update
  [ "$status" -eq 0 ]
  # Files mirror from upstream 02_solution/.claude/... INTO consumer .claude/... (no subdir).
  grep -q "owned v2" "$CONSUMER/.claude/framework/owned/file.txt"
  [ -f "$CONSUMER/.claude/framework/owned/new-in-v2.txt" ]
  grep -q "rules v2" "$CONSUMER/CLAUDE.framework.md"
  [ ! -d "$CONSUMER/02_solution" ]        # subdir is a SOURCE concept, not copied verbatim
  grep -q "FRAMEWORK_PINNED_SHA=$UPSTREAM_V2_SHA" "$CVERSION"
}

@test "apply-update: empty FRAMEWORK_SOURCE_SUBDIR behaves as repo root (back-compat)" {
  build_upstream                          # canonical at root
  build_consumer
  set_version_field FRAMEWORK_SOURCE_SUBDIR ""
  run apply_update
  [ "$status" -eq 0 ]
  grep -q "owned v2" "$CONSUMER/.claude/framework/owned/file.txt"
  grep -q "rules v2" "$CONSUMER/CLAUDE.framework.md"
}

@test "apply-update: FRAMEWORK_SOURCE_SUBDIR absent upstream fails cleanly (no half-update)" {
  build_upstream                          # canonical at ROOT — no 02_solution subdir
  build_consumer
  set_version_field FRAMEWORK_SOURCE_SUBDIR "02_solution"
  run apply_update
  [ "$status" -eq 2 ]
  [[ "$output" == *"not found in upstream clone"* ]]
  # Tree untouched: still v1.
  grep -q "owned v1" "$CONSUMER/.claude/framework/owned/file.txt"
}

@test "apply-update: subdir-sourcing consumer pulls from the subdir canonical" {
  build_upstream_subdir "02_solution"
  build_consumer
  set_version_field FRAMEWORK_SOURCE_SUBDIR "02_solution"
  run apply_update
  [ "$status" -eq 0 ]
  grep -q "owned v2" "$CONSUMER/.claude/framework/owned/file.txt"
}

@test "apply-update: pin + LAST_CHECKED rewritten, pending flag cleared" {
  build_upstream
  build_consumer
  echo "stale notification" > "$CFLAG"
  run apply_update
  [ "$status" -eq 0 ]
  grep -q "^FRAMEWORK_PINNED_SHA=$UPSTREAM_V2_SHA" "$CVERSION"
  ! grep -q "1970-01-01" "$CVERSION"
  [ ! -f "$CFLAG" ]
}

@test "apply-update: upstream-removal path deletes local-only manifest entry" {
  build_upstream
  build_consumer
  mkdir -p "$CONSUMER/.claude/framework/retired"
  echo "old feature" > "$CONSUMER/.claude/framework/retired/feature.sh"
  echo ".claude/framework/retired/" >> "$CONSUMER/.claude/framework/update/framework-manifest.txt"
  git -C "$CONSUMER" add -A
  git -C "$CONSUMER" commit -qm "consumer has a path upstream no longer ships"
  run apply_update
  [ "$status" -eq 0 ]
  [[ "$output" == *"removed upstream"* ]]
  [ ! -e "$CONSUMER/.claude/framework/retired" ]
}

@test "apply-update: dirty tree (modified file) refuses with tree untouched" {
  build_upstream
  build_consumer
  echo "local edit" >> "$CONSUMER/.claude/framework/owned/file.txt"
  run apply_update
  [ "$status" -eq 1 ]
  [[ "$output" == *"refusing"* ]]
  [[ "$output" == *".claude/framework/owned"* ]]
  grep -q "local edit" "$CONSUMER/.claude/framework/owned/file.txt"
  grep -q "hook v1" "$CONSUMER/.claude/hooks/sample-hook.sh"
  grep -q "^FRAMEWORK_PINNED_SHA=$UPSTREAM_V1_SHA" "$CVERSION"
}

@test "apply-update: dirty tree (staged change) refuses" {
  build_upstream
  build_consumer
  echo "staged edit" >> "$CONSUMER/CLAUDE.framework.md"
  git -C "$CONSUMER" add CLAUDE.framework.md
  run apply_update
  [ "$status" -eq 1 ]
  [[ "$output" == *"refusing"* ]]
  grep -q "^FRAMEWORK_PINNED_SHA=$UPSTREAM_V1_SHA" "$CVERSION"
}

@test "apply-update: dirty tree (untracked file in framework path) refuses" {
  build_upstream
  build_consumer
  echo "wip" > "$CONSUMER/.claude/framework/owned/untracked-wip.txt"
  run apply_update
  [ "$status" -eq 1 ]
  [[ "$output" == *"refusing"* ]]
  [[ "$output" == *"untracked-wip.txt"* ]]
  [ -f "$CONSUMER/.claude/framework/owned/untracked-wip.txt" ]
  grep -q "owned v1" "$CONSUMER/.claude/framework/owned/file.txt"
}

@test "apply-update: untracked content at a path NEW in this update refuses, content intact (audit C1)" {
  build_upstream
  build_consumer
  # Upstream introduces a brand-new manifest path in a v3 commit — NOT
  # present in the consumer's LOCAL manifest (pinned at v1, which only
  # lists the original fixture entries). Pre-fix, the pre-flight
  # dirty-check iterated only the local manifest built BEFORE the fetch,
  # so a path new-in-this-update got zero dirty-check at all: Phase 2
  # would rm -rf whatever sat there with no warning.
  mkdir -p "$UPSTREAM/.claude/framework/new-feature"
  echo "new feature content" > "$UPSTREAM/.claude/framework/new-feature/file.txt"
  echo ".claude/framework/new-feature/" >> "$UPSTREAM/.claude/framework/update/framework-manifest.txt"
  git -C "$UPSTREAM" add -A
  git -C "$UPSTREAM" commit -qm "v3: introduce a new framework-owned dir"

  # Consumer has pre-existing UNTRACKED content sitting at that exact
  # brand-new path (e.g. their own scratch notes, never committed).
  mkdir -p "$CONSUMER/.claude/framework/new-feature"
  echo "my untracked notes" > "$CONSUMER/.claude/framework/new-feature/mine.txt"

  run apply_update
  [ "$status" -eq 1 ]
  [[ "$output" == *"refusing"* ]]
  [[ "$output" == *"new-feature"* ]]
  # Untracked content survives — the run aborted before Phase 1/2 ever ran.
  grep -q "my untracked notes" "$CONSUMER/.claude/framework/new-feature/mine.txt"
  # Nothing else changed either — still pinned at v1.
  grep -q "^FRAMEWORK_PINNED_SHA=$UPSTREAM_V1_SHA" "$CVERSION"
}

@test "apply-update: refuses in a non-git project unless --no-git is passed (audit minor d)" {
  build_upstream
  build_consumer
  rm -rf "$CONSUMER/.git"
  run apply_update_noconfirm
  [ "$status" -eq 1 ]
  [[ "$output" == *"not a git repository"* ]]
  # Nothing touched.
  grep -q "owned v1" "$CONSUMER/.claude/framework/owned/file.txt"
}

@test "apply-update: --no-git proceeds (with warning) in a non-git project" {
  build_upstream
  build_consumer
  rm -rf "$CONSUMER/.git"
  run apply_update_noconfirm --yes --no-git
  [ "$status" -eq 0 ]
  [[ "$output" == *"WARNING"* ]]
  [[ "$output" == *"WITHOUT git"* ]]
  grep -q "owned v2" "$CONSUMER/.claude/framework/owned/file.txt"
}

@test "apply-update: non-interactive run without --yes refuses, nothing changed (audit minor e)" {
  build_upstream
  build_consumer
  run apply_update_noconfirm   # no --yes, bats stdin is not a tty
  [ "$status" -eq 4 ]
  [[ "$output" == *"--yes"* ]]
  grep -q "owned v1" "$CONSUMER/.claude/framework/owned/file.txt"
  grep -q "^FRAMEWORK_PINNED_SHA=$UPSTREAM_V1_SHA" "$CVERSION"
}

@test "apply-update: missing upstream manifest warns loudly and falls back to local (DA-M5)" {
  build_upstream --no-manifest
  build_consumer
  run apply_update
  [ "$status" -eq 0 ]
  [[ "$output" == *"no framework-manifest.txt"* ]]
  [[ "$output" == *"LOCAL manifest"* ]]
  # Local-manifest fallback still applies entries that exist upstream.
  grep -q "owned v2" "$CONSUMER/.claude/framework/owned/file.txt"
  grep -q "rules v2" "$CONSUMER/CLAUDE.framework.md"
}

@test "apply-update: staging failure aborts with working tree fully intact (DA-C3)" {
  build_upstream
  build_consumer
  # Force phase-1 staging to fail by shadowing `cp` on PATH (chmod-based
  # unwritable dirs are not reliable on Windows git-bash). git clone does
  # not shell out to cp, so the failure lands exactly at the staging copy.
  mkdir -p "$BATS_TEST_TMPDIR/fakebin"
  printf '#!/bin/sh\nexit 1\n' > "$BATS_TEST_TMPDIR/fakebin/cp"
  chmod +x "$BATS_TEST_TMPDIR/fakebin/cp"
  PATH="$BATS_TEST_TMPDIR/fakebin:$PATH" run apply_update
  [ "$status" -eq 3 ]
  [[ "$output" == *"staging"* ]]
  [[ "$output" == *"No changes were made"* ]]
  grep -q "owned v1" "$CONSUMER/.claude/framework/owned/file.txt"
  grep -q "hook v1"  "$CONSUMER/.claude/hooks/sample-hook.sh"
  grep -q "^FRAMEWORK_PINNED_SHA=$UPSTREAM_V1_SHA" "$CVERSION"
  # trap cleanup removed the staging dir
  ! ls "$CONSUMER/.claude"/.update-staging.* 2>/dev/null
}

@test "apply-update: customised command file → loud collision notice (TASK-039)" {
  build_upstream
  build_consumer
  # Consumer replaced the framework command with their OWN version (committed
  # — so the dirty-check passes and it would be silently destroyed).
  echo "MY CUSTOM healthcheck-style command" > "$CONSUMER/.claude/commands/wrapup.md"
  git -C "$CONSUMER" add -A
  git -C "$CONSUMER" commit -qm "local custom command"
  run apply_update
  [ "$status" -eq 0 ]
  [[ "$output" == *"FILE COLLISION"* ]]
  [[ "$output" == *".claude/commands/wrapup.md"* ]]
  # Overwrite still happened (manifest paths are framework-owned).
  grep -q "wrapup command v2" "$CONSUMER/.claude/commands/wrapup.md"
}

@test "apply-update: customised CLAUDE.framework.md → loud collision notice (TASK-045)" {
  build_upstream
  build_consumer
  # Consumer edited the framework rulebook directly (committed) instead of
  # putting project rules in CLAUDE.md — would be silently overwritten.
  echo "MY CUSTOM framework rules" > "$CONSUMER/CLAUDE.framework.md"
  git -C "$CONSUMER" add -A
  git -C "$CONSUMER" commit -qm "local custom framework rules"
  run apply_update
  [ "$status" -eq 0 ]
  [[ "$output" == *"FILE COLLISION"* ]]
  [[ "$output" == *"CLAUDE.framework.md"* ]]
  # Overwrite still happened (manifest paths are framework-owned).
  grep -q "rules v2" "$CONSUMER/CLAUDE.framework.md"
}

@test "apply-update: customised hook file → loud collision notice (audit M2)" {
  build_upstream
  build_consumer
  # Consumer hardened a hook (e.g. exactly the kind of fix M1 in the audit
  # recommends for block-dangerous-commands.py) and committed it — the
  # dirty-check passes, so pre-fix this was silently reverted with NO
  # warning at all (the collision `case` excluded .claude/hooks/*).
  echo "MY HARDENED hook logic" > "$CONSUMER/.claude/hooks/sample-hook.sh"
  git -C "$CONSUMER" add -A
  git -C "$CONSUMER" commit -qm "local hook hardening"
  run apply_update
  [ "$status" -eq 0 ]
  [[ "$output" == *"FILE COLLISION"* ]]
  [[ "$output" == *".claude/hooks/sample-hook.sh"* ]]
  # Overwrite still happens (manifest paths are framework-owned) — the fix
  # is the WARNING, not preventing the overwrite (that's the collision
  # model already accepted for commands/CLAUDE.framework.md).
  grep -q "hook v2" "$CONSUMER/.claude/hooks/sample-hook.sh"
}

@test "apply-update: rollback handler restores a half-applied tree (audit minor f, unit-level)" {
  build_upstream
  build_consumer
  # Simulate a mid-Phase-2 interruption: one dir-mirror file overwritten,
  # one extra file landed inside the mirror (present upstream, absent at
  # HEAD), one shared-dir file entry overwritten. Live signal delivery is
  # not reliable in this environment, so invoke the shipped
  # _rollback_framework_paths function VERBATIM (extracted from
  # apply-update.sh) — the same code path both swap_fail and the INT/TERM
  # trap execute.
  echo "half-applied v2"  > "$CONSUMER/.claude/framework/owned/file.txt"
  echo "new upstream file" > "$CONSUMER/.claude/framework/owned/new-in-v2.txt"
  echo "half-applied hook" > "$CONSUMER/.claude/hooks/sample-hook.sh"
  run bash -c '
    cd "'"$CONSUMER"'" || exit 1
    set -uo pipefail
    PROJECT_ROOT="$PWD"
    declare -A final_type=(
      [".claude/framework/owned"]="dir"
      [".claude/hooks/sample-hook.sh"]="file"
    )
    final_paths=(".claude/framework/owned" ".claude/hooks/sample-hook.sh")
    source <(sed -n "/^_rollback_framework_paths()/,/^}/p" .claude/framework/update/apply-update.sh)
    declare -F _rollback_framework_paths >/dev/null || { echo "extract failed"; exit 1; }
    _rollback_framework_paths
  '
  [ "$status" -eq 0 ]
  # Tracked content restored to HEAD...
  grep -q "owned v1" "$CONSUMER/.claude/framework/owned/file.txt"
  grep -q "hook v1"  "$CONSUMER/.claude/hooks/sample-hook.sh"
  # ...the mirror-only stray file is cleaned (dir mirrors are 100%
  # framework-owned)...
  [ ! -e "$CONSUMER/.claude/framework/owned/new-in-v2.txt" ]
  # ...and the project-owned sibling in the SHARED hooks dir is untouched
  # (git clean must never run on file entries / shared dirs).
  grep -q "must survive" "$CONSUMER/.claude/hooks/project-hook.sh"
}

@test "apply-update: stock command file evolving upstream → NO collision noise (TASK-039)" {
  build_upstream
  build_consumer
  run apply_update
  [ "$status" -eq 0 ]
  [[ "$output" != *"FILE COLLISION"* ]]
  grep -q "wrapup command v2" "$CONSUMER/.claude/commands/wrapup.md"
}

@test "apply-update: missing .framework-version exits 2" {
  build_upstream
  build_consumer
  rm "$CVERSION"
  run apply_update
  [ "$status" -eq 2 ]
}

# --- check-updates.sh -------------------------------------------------

@test "check-updates: throttle honoured — recently checked, no network attempt" {
  build_upstream
  build_consumer
  # An unreachable URL proves the throttle short-circuits before any
  # network use: a live check against this URL would exit 3.
  set_version_field FRAMEWORK_UPSTREAM_URL "$BATS_TEST_TMPDIR/does-not-exist"
  set_version_field FRAMEWORK_LAST_CHECKED "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  run check_updates
  [ "$status" -eq 0 ]
  [ ! -f "$CFLAG" ]
}

@test "check-updates: pending flag survives a throttled run (DA-C4 regression)" {
  build_upstream
  build_consumer
  echo "PENDING-MARKER-123" > "$CFLAG"
  set_version_field FRAMEWORK_LAST_CHECKED "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  run check_updates
  [ "$status" -eq 0 ]
  grep -q "PENDING-MARKER-123" "$CFLAG"
}

@test "check-updates: pending flag survives a network failure (DA-C4 regression)" {
  build_upstream
  build_consumer
  echo "PENDING-MARKER-456" > "$CFLAG"
  set_version_field FRAMEWORK_UPSTREAM_URL "$BATS_TEST_TMPDIR/does-not-exist"
  run check_updates
  [ "$status" -eq 3 ]
  grep -q "PENDING-MARKER-456" "$CFLAG"
}

@test "check-updates: live up-to-date clears stale flag and bumps LAST_CHECKED" {
  build_upstream
  build_consumer
  echo "stale flag from an old check" > "$CFLAG"
  set_version_field FRAMEWORK_PINNED_SHA "$UPSTREAM_V2_SHA"
  run check_updates
  [ "$status" -eq 0 ]
  [ ! -f "$CFLAG" ]
  ! grep -q "1970-01-01" "$CVERSION"
}

@test "check-updates: update available writes a sane flag file" {
  build_upstream
  build_consumer
  run check_updates
  [ "$status" -eq 0 ]
  [ -f "$CFLAG" ]
  grep -q "${UPSTREAM_V1_SHA:0:7}" "$CFLAG"
  grep -q "${UPSTREAM_V2_SHA:0:7}" "$CFLAG"
  grep -q "v2: framework changes" "$CFLAG"
  grep -q "## To apply" "$CFLAG"
}

@test "check-updates: SHA advanced but no framework paths changed — up to date, no flag (BUG-004)" {
  build_upstream
  # v3: a commit touching ONLY a non-manifest (non-shipped) path — mirrors an
  # upstream that commits its own dev board / docs to the branch consumers track.
  echo "dev board note" > "$UPSTREAM/DEV-NOTES.md"
  git -C "$UPSTREAM" add -A
  git -C "$UPSTREAM" commit -qm "v3: non-shipped dev-board change only"
  build_consumer
  set_version_field FRAMEWORK_PINNED_SHA "$UPSTREAM_V2_SHA"   # pinned current on all framework files
  run check_updates
  [ "$status" -eq 0 ]
  [ ! -f "$CFLAG" ]                                           # no spurious "update available" flag
  [[ "$output" == *"no framework-owned files changed"* ]]
}

@test "check-updates: empty-diff suppression also clears a STALE flag (BUG-004)" {
  build_upstream
  echo "dev board note" > "$UPSTREAM/DEV-NOTES.md"
  git -C "$UPSTREAM" add -A
  git -C "$UPSTREAM" commit -qm "v3: non-shipped dev-board change only"
  build_consumer
  set_version_field FRAMEWORK_PINNED_SHA "$UPSTREAM_V2_SHA"
  echo "stale flag from an old check" > "$CFLAG"             # a flag left over from before
  run check_updates
  [ "$status" -eq 0 ]
  [ ! -f "$CFLAG" ]                                           # suppression must also clear it
}

# --- migrate-layout.sh ------------------------------------------------

@test "migrate-layout: detects old layout via 00_framework/ alone" {
  build_old_layout_consumer dir-only
  run migrate_layout
  [ "$status" -eq 0 ]
  [[ "$output" == *"old layout detected"* ]]
  [ ! -d "$OLDC/00_framework" ]
  [ -f "$OLDC/.claude/framework/insights/notes.txt" ]
}

@test "migrate-layout: detects old layout via root TASKS.md alone" {
  build_old_layout_consumer tasks-only
  run migrate_layout
  [ "$status" -eq 0 ]
  [[ "$output" == *"old layout detected"* ]]
  [ ! -f "$OLDC/TASKS.md" ]
  [ -f "$OLDC/.claude/TASKS.md" ]
}

@test "migrate-layout: full migration invariants — moves, rewrites, commit" {
  build_old_layout_consumer full
  run migrate_layout
  [ "$status" -eq 0 ]
  # Framework dir merged into .claude/framework/
  [ ! -d "$OLDC/00_framework" ]
  [ -f "$OLDC/.claude/framework/insights/notes.txt" ]
  # State + config files moved
  [ ! -f "$OLDC/TASKS.md" ];           [ -f "$OLDC/.claude/TASKS.md" ]
  [ ! -f "$OLDC/STATUS.md" ];          [ -f "$OLDC/.claude/STATUS.md" ]
  [ ! -f "$OLDC/.framework-version" ]; [ -f "$OLDC/.claude/.framework-version" ]
  # Reference rewrites
  grep -q ".claude/framework/" "$OLDC/CLAUDE.md"
  ! grep -q "00_framework" "$OLDC/CLAUDE.md"
  grep -q ".claude/.framework-update-available.md" "$OLDC/.gitignore"
  grep -q ".claude/framework/self/README.md" "$OLDC/.gitignore"
  # Migration commit exists
  git -C "$OLDC" log -1 --format=%s | grep -q "layout migration"
}

@test "migrate-layout: idempotent — second run is a no-op" {
  build_old_layout_consumer full
  run migrate_layout
  [ "$status" -eq 0 ]
  local head_after_first
  head_after_first=$(git -C "$OLDC" rev-parse HEAD)
  run migrate_layout
  [ "$status" -eq 0 ]
  [[ "$output" == *"already on new layout"* ]]
  [ "$(git -C "$OLDC" rev-parse HEAD)" = "$head_after_first" ]
}

@test "migrate-layout: stray .env.local is NOT swept into the migration commit (DA-H5)" {
  build_old_layout_consumer full
  echo "SECRET=hunter2" > "$OLDC/.env.local"
  run migrate_layout
  [ "$status" -eq 0 ]
  # Not in the migration commit, not tracked, still on disk.
  ! git -C "$OLDC" show --name-only --format= HEAD | grep -q ".env.local"
  ! git -C "$OLDC" ls-files | grep -q ".env.local"
  [ -f "$OLDC/.env.local" ]
}

@test "migrate-layout: refuses with uncommitted framework-path changes (BUG-002 regression)" {
  build_old_layout_consumer full
  echo "uncommitted work" >> "$OLDC/TASKS.md"
  run migrate_layout
  [ "$status" -eq 2 ]
  [[ "$output" == *"uncommitted changes"* ]]
  # Migration did not proceed.
  [ -f "$OLDC/TASKS.md" ]
  [ -d "$OLDC/00_framework" ]
}

@test "migrate-layout: dirty-check also covers CLAUDE.md / CLAUDE.framework.md / .gitignore (audit M3a)" {
  build_old_layout_consumer full
  echo "uncommitted CLAUDE.md edit" >> "$OLDC/CLAUDE.md"
  run migrate_layout
  [ "$status" -eq 2 ]
  [[ "$output" == *"uncommitted changes"* ]]
  [ -d "$OLDC/00_framework" ]
}

@test "migrate-layout: BARE and backticked 00_framework/ references BOTH rewritten on confirm; diff lists the file (audit M3, corrected)" {
  build_old_layout_consumer full
  # Fixture CLAUDE.md (see update_helpers.bash) is legacy ground truth:
  # one BARE reference, one backticked, one plain-prose mention. The
  # regression being pinned: a backtick-anchored sed under-matched and
  # silently left the bare shapes stale in a file the agent loads at cold
  # start. Token-boundary matching must rewrite all three.
  run migrate_layout   # --yes (helper default) = the confirmed path
  [ "$status" -eq 0 ]
  # Bare reference rewritten (no backtick added — content otherwise intact).
  grep -q '^See .claude/framework/self/README.md$' "$OLDC/CLAUDE.md"
  # Backticked reference rewritten, backticks preserved.
  grep -q 'Read `.claude/framework/insights/notes.txt`' "$OLDC/CLAUDE.md"
  # Prose mention rewritten too — by design: sed cannot tell it apart, and
  # the adopter explicitly confirmed after seeing the diff.
  grep -q 'the .claude/framework/ layout held these files' "$OLDC/CLAUDE.md"
  ! grep -q "00_framework" "$OLDC/CLAUDE.md"
  # The pre-commit diff listed CLAUDE.md as a change (shown before the gate).
  [[ "$output" == *"CLAUDE.md"* ]]
  [[ "$output" == *"will be committed"* ]]
}

@test "migrate-layout: word-boundary sed does not rewrite substrings of longer tokens (audit M3, corrected)" {
  build_old_layout_consumer full
  # A longer token CONTAINING "00_framework/" must not be corrupted: the
  # boundary anchor only fires when 00_framework starts its own token.
  printf 'See 00_framework/self/README.md\nKeep my00_framework/ and legacy00_framework/ verbatim.\n' > "$OLDC/CLAUDE.md"
  git -C "$OLDC" add CLAUDE.md
  git -C "$OLDC" commit -qm "seed CLAUDE.md with embedded-token mentions"
  run migrate_layout
  [ "$status" -eq 0 ]
  grep -q '^See .claude/framework/self/README.md$' "$OLDC/CLAUDE.md"
  grep -q 'Keep my00_framework/ and legacy00_framework/ verbatim.' "$OLDC/CLAUDE.md"
}

@test "migrate-layout: non-interactive without --yes/--stage-only refuses at ENTRY, tree untouched (audit M3/e)" {
  build_old_layout_consumer full
  cp "$OLDC/CLAUDE.md" "$BATS_TEST_TMPDIR/claude-md.orig"
  # No flag, and bats' stdin is not a tty → the entry gate must refuse
  # BEFORE any mutation: no mvs, no seds, nothing staged. (An earlier
  # design gated only the commit, which left a non-interactive caller with
  # a half-consented, mutated tree.)
  run migrate_layout_noconfirm
  [ "$status" -eq 4 ]
  [[ "$output" == *"Nothing was changed"* ]]
  [[ "$output" == *"--yes"* ]]
  # Tree byte-for-byte untouched: old layout still in place...
  [ -d "$OLDC/00_framework" ]
  [ -f "$OLDC/TASKS.md" ]
  cmp -s "$BATS_TEST_TMPDIR/claude-md.orig" "$OLDC/CLAUDE.md"
  # ...and the index/worktree entirely clean (fixture starts committed-clean).
  [ -z "$(git -C "$OLDC" status --porcelain)" ]
  ! git -C "$OLDC" log --oneline | grep -q "layout migration"
}

@test "migrate-layout: decline semantics via --stage-only — coherent migration staged, references rewritten, nothing committed (audit M3, corrected)" {
  build_old_layout_consumer full
  # --stage-only shares the exact no-commit code path (_print_staged_notice
  # + skip-commit) that an interactive decline takes; only the read/case of
  # the prompt itself is untestable here (no pty tool in this environment:
  # winpty refuses piped stdin; script/socat/expect absent). The declined
  # tree must be INTERNALLY COHERENT: moves AND rewrites together — never
  # restored references pointing at directories that have physically moved.
  run migrate_layout_noconfirm --stage-only
  [ "$status" -eq 0 ]
  # Dirs moved...
  [ ! -d "$OLDC/00_framework" ]
  [ -f "$OLDC/.claude/framework/insights/notes.txt" ]
  [ ! -f "$OLDC/TASKS.md" ]; [ -f "$OLDC/.claude/TASKS.md" ]
  # ...references REWRITTEN (bare + backticked; no stale refs anywhere)...
  grep -q '^See .claude/framework/self/README.md$' "$OLDC/CLAUDE.md"
  grep -q 'Read `.claude/framework/insights/notes.txt`' "$OLDC/CLAUDE.md"
  ! grep -q "00_framework" "$OLDC/CLAUDE.md"
  # ...everything staged, including the rewritten CLAUDE.md...
  git -C "$OLDC" diff --cached --name-only | grep -qx "CLAUDE.md"
  ( cd "$OLDC" && ! git diff --cached --quiet )
  # ...nothing committed, and the staged-review notice was printed.
  ! git -C "$OLDC" log --oneline | grep -q "layout migration"
  [[ "$output" == *"nothing was committed"* ]]
  [[ "$output" == *"git diff --staged"* ]]
}

# --- doctor.sh --------------------------------------------------------

@test "doctor: clean tree is silent (exit 0, no findings flag)" {
  build_doctor_consumer
  run run_doctor
  [ "$status" -eq 0 ]
  # On GNU userland with jq present the flag must be entirely absent.
  # Tolerate environment-dependent findings (gnu-toolchain WARNING on
  # BSD/macOS, jq-missing INFO) — but never a CRITICAL.
  if [ -f "$DOCFLAG" ]; then
    ! grep -q "CRITICAL" "$DOCFLAG"
  fi
  if command -v jq >/dev/null 2>&1 && sed --version 2>/dev/null | grep -q GNU; then
    [ ! -f "$DOCFLAG" ]
  fi
}

@test "doctor: dispatcher-driven hook (unregistered but invoked by a registered hook) is NOT flagged (TASK-035)" {
  command -v jq >/dev/null 2>&1 || skip "jq required for the hooks check"
  build_doctor_consumer
  # child-hook.sh isn't in settings.json, but the registered sample-hook.sh
  # invokes it — indirect wiring, not dead code.
  printf '#!/usr/bin/env bash\nbash "$(dirname "$0")/child-hook.sh"\n' > "$DOC/.claude/hooks/sample-hook.sh"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$DOC/.claude/hooks/child-hook.sh"
  run run_doctor
  [ "$status" -eq 0 ]
  if [ -f "$DOCFLAG" ]; then
    ! grep -q "child-hook.sh" "$DOCFLAG"
  fi
}

@test "doctor: truly unwired hook on disk IS still flagged (control for indirect-wiring pass)" {
  command -v jq >/dev/null 2>&1 || skip "jq required for the hooks check"
  build_doctor_consumer
  printf '#!/usr/bin/env bash\nexit 0\n' > "$DOC/.claude/hooks/orphan-hook.sh"
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q "orphan-hook.sh" "$DOCFLAG"
}

@test "doctor: missing hook file referenced in settings.json → CRITICAL [hooks]" {
  command -v jq >/dev/null 2>&1 || skip "jq required for the hooks check"
  build_doctor_consumer
  rm "$DOC/.claude/hooks/sample-hook.sh"
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q '\*\*CRITICAL\*\* — \[hooks\]' "$DOCFLAG"
  grep -q "sample-hook.sh" "$DOCFLAG"
}

@test "doctor: link-style CLAUDE.md pointer (no @import) → CRITICAL [claude-md]" {
  build_doctor_consumer
  printf '# Project\n\nSee [framework rules](CLAUDE.framework.md).\n' > "$DOC/CLAUDE.md"
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q '\*\*CRITICAL\*\* — \[claude-md\]' "$DOCFLAG"
  grep -q "does not @import" "$DOCFLAG"
}

@test "doctor: manifest entry with no local path → CRITICAL [manifest]" {
  build_doctor_consumer
  echo ".claude/framework/ghost-dir/" >> "$DOC/.claude/framework/update/framework-manifest.txt"
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q '\*\*CRITICAL\*\* — \[manifest\]' "$DOCFLAG"
  grep -q "ghost-dir" "$DOCFLAG"
}

@test "doctor: empty .framework-version field → CRITICAL [framework-version]" {
  build_doctor_consumer
  cat > "$DOC/.claude/.framework-version" <<'EOF'
FRAMEWORK_UPSTREAM_URL=https://example.invalid/repo.git
FRAMEWORK_UPSTREAM_BRANCH=main
FRAMEWORK_PINNED_SHA=
FRAMEWORK_LAST_CHECKED=1970-01-01T00:00:00Z
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q '\*\*CRITICAL\*\* — \[framework-version\]' "$DOCFLAG"
  grep -q "FRAMEWORK_PINNED_SHA" "$DOCFLAG"
}

@test "doctor: leaked upstream framework-dev GOTCHAS content → WARNING [state-files] (Check 12)" {
  build_doctor_consumer
  cat >> "$DOC/.claude/GOTCHAS.md" <<'GOTCHA'

### SCRIPT_DIR depth is move-sensitive — add one `..` per extra directory level

Leaked upstream entry from a pre-2026-06-10 clone.
GOTCHA
  run run_doctor
  [ "$status" -eq 0 ]
  [ -f "$DOCFLAG" ]
  grep -q "state-files" "$DOCFLAG"
  grep -q "framework-development entries" "$DOCFLAG"
}

@test "doctor: clean consumer GOTCHAS template does NOT trigger Check 12 (control)" {
  build_doctor_consumer
  run run_doctor
  [ "$status" -eq 0 ]
  if [ -f "$DOCFLAG" ]; then
    ! grep -q "state-files" "$DOCFLAG"
  fi
}

# --- doctor Check 13: state-file structural grammar -------------------

@test "doctor Check 13: valid framework-convention state files are silent (control)" {
  build_doctor_consumer
  seed_doctor_state_files
  run run_doctor
  [ "$status" -eq 0 ]
  if [ -f "$DOCFLAG" ]; then ! grep -q "state-structure" "$DOCFLAG"; fi
}

@test "doctor Check 13: bracketed IDs in their lane are clean (control)" {
  build_doctor_consumer
  cat > "$DOC/.claude/TASKS.md" <<'EOF'
# Task Board
## Feature Lane
### Verify
### Done
#### [TASK-1] bracketed feature
## Bug-Fix Lane
### Done
#### [BUG-1] bracketed bug
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  if [ -f "$DOCFLAG" ]; then ! grep -q "state-structure" "$DOCFLAG"; fi
}

@test "doctor Check 13: bare (unbracketed) IDs → WARNING [state-structure]" {
  build_doctor_consumer
  cat > "$DOC/.claude/TASKS.md" <<'EOF'
# Task Board
## Feature Lane
### Verify
### Done
#### TASK-2 — bare feature
## Bug-Fix Lane
### Done
#### BUG-2 — bare bug
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q 'BARE IDs' "$DOCFLAG"
  grep -q 'task/bug entries with BARE IDs' "$DOCFLAG"
}

@test "doctor Check 13: Feature lane without a ### Verify section → WARNING" {
  build_doctor_consumer
  cat > "$DOC/.claude/TASKS.md" <<'EOF'
# Task Board
## Feature Lane
### Ready for Test
### Done
#### [TASK-1] a feature
## Bug-Fix Lane
### Verify
### Done
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q 'no .### Verify. section' "$DOCFLAG"
}

@test "doctor Check 13: a ### Verify in the BUG lane does NOT satisfy the Feature-lane check" {
  build_doctor_consumer
  # Verify exists, but only in the bug lane — the feature lane still lacks it.
  cat > "$DOC/.claude/TASKS.md" <<'EOF'
# Task Board
## Feature Lane
### Done
#### [TASK-1] a feature
## Bug-Fix Lane
### Verify
### Done
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q 'Feature lane has no .### Verify' "$DOCFLAG"
}

@test "doctor Check 13: BUG-* under the Feature lane → WARNING [state-structure]" {
  build_doctor_consumer
  cat > "$DOC/.claude/TASKS.md" <<'EOF'
# Task Board
## Feature Lane
### In Progress
### Verify
#### [BUG-009] misfiled bug under the feature lane [P1]
## Bug-Fix Lane
### Done
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q '\[state-structure\]' "$DOCFLAG"
  grep -q 'BUG-009 sits under the Feature lane' "$DOCFLAG"
}

@test "doctor Check 13: TASK-* under the Bug-Fix lane → WARNING [state-structure]" {
  build_doctor_consumer
  cat > "$DOC/.claude/TASKS.md" <<'EOF'
# Task Board
## Feature Lane
### Verify
### Done
## Bug-Fix Lane
### Verify
#### [TASK-009] misfiled task under the bug lane [P1]
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q 'TASK-009 sits under the Bug-Fix lane' "$DOCFLAG"
}

@test "doctor Check 13: DECISIONS heading neither ISO-date nor DEC-N → WARNING" {
  build_doctor_consumer
  printf '# Decision Log\n\n## Some prose title with no id or date\n\nbody\n' > "$DOC/.claude/DECISIONS.md"
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q 'neither date-headed' "$DOCFLAG"
}

@test "doctor Check 13: DECISIONS DEC-N and ISO-date headings are both accepted (control)" {
  build_doctor_consumer
  printf '# Decision Log\n\n## DEC-007 — a dec-n decision\n\nbody\n\n## 2026-06-26 — a date-headed decision\n\nbody\n' > "$DOC/.claude/DECISIONS.md"
  run run_doctor
  [ "$status" -eq 0 ]
  if [ -f "$DOCFLAG" ]; then ! grep -q "state-structure" "$DOCFLAG"; fi
}

@test "doctor Check 13: task ID at heading level 3 → WARNING (entry would vanish)" {
  build_doctor_consumer
  cat > "$DOC/.claude/TASKS.md" <<'EOF'
# Task Board
## Feature Lane
### In Progress
### [TASK-5] this should be a level-4 heading
## Bug-Fix Lane
### Done
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q 'heading level 3' "$DOCFLAG"
}

@test "doctor Check 13: status section before any lane heading → WARNING" {
  build_doctor_consumer
  cat > "$DOC/.claude/TASKS.md" <<'EOF'
# Task Board
### Todo (Priority Order)
#### TASK-001 — orphan task above the lane
## Feature Lane
### Done
## Bug-Fix Lane
### Done
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q 'before the first' "$DOCFLAG"
}

@test "doctor Check 13: missing Feature Lane heading → WARNING" {
  build_doctor_consumer
  cat > "$DOC/.claude/TASKS.md" <<'EOF'
# Task Board
## Bug-Fix Lane
### Reported
#### BUG-001 — a bug
### Done
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q 'no .## Feature Lane' "$DOCFLAG"
}

@test "doctor Check 13: commented-out template heading is NOT flagged (comment-aware)" {
  build_doctor_consumer
  cat > "$DOC/.claude/TASKS.md" <<'EOF'
# Task Board
## Feature Lane
### Verify
### Done
## Bug-Fix Lane
### Reported
<!--
#### [BUG-XXX] Short description
-->
### Done
EOF
  run run_doctor
  [ "$status" -eq 0 ]
  if [ -f "$DOCFLAG" ]; then ! grep -q "state-structure" "$DOCFLAG"; fi
}

@test "doctor Check 13: DECISIONS meta line with a hyphen instead of the middot → WARNING" {
  build_doctor_consumer
  printf '# Decision Log\n\n## DEC-001 — A decision\n\n**Date:** 2026-06-26 - **Status:** active\n' > "$DOC/.claude/DECISIONS.md"
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q 'middot' "$DOCFLAG"
}

@test "doctor Check 13: DECISIONS meta line WITH the middot is accepted (control)" {
  build_doctor_consumer
  printf '# Decision Log\n\n## DEC-001 — A decision\n\n**Date:** 2026-06-26 · **Status:** active\n' > "$DOC/.claude/DECISIONS.md"
  run run_doctor
  [ "$status" -eq 0 ]
  if [ -f "$DOCFLAG" ]; then ! grep -q "state-structure" "$DOCFLAG"; fi
}

@test "doctor Check 13: GOTCHAS single-asterisk Confidence marker → WARNING" {
  build_doctor_consumer
  printf '# Gotchas\n\n## Cat\n\n### Entry\n\n*Confidence:* Verified\n' > "$DOC/.claude/GOTCHAS.md"
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q 'Confidence marker' "$DOCFLAG"
}

@test "doctor Check 13: GOTCHAS Count line missing the middot → WARNING" {
  build_doctor_consumer
  printf '# Gotchas\n\n## Cat\n\n### Entry\n\n**Confidence:** Verified\n\nCount: 3 - First seen: 2026-06-26\n' > "$DOC/.claude/GOTCHAS.md"
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q 'Count line' "$DOCFLAG"
}

@test "doctor Check 13: ECOSYSTEM contract anchor with out-of-enum status → WARNING" {
  build_doctor_consumer
  printf '# Eco\n\n### C\n\n<!-- contract:foo status:active -->\n' > "$DOC/.claude/ECOSYSTEM.md"
  run run_doctor
  [ "$status" -eq 0 ]
  grep -q 'out-of-enum status' "$DOCFLAG"
}

@test "doctor Check 13: ECOSYSTEM prose comment mentioning 'contract:' is NOT flagged" {
  build_doctor_consumer
  printf '# Eco\n\n<!-- tasks reference contract:user-registration by ID -->\n\n### C\n\n<!-- contract:foo status:stable -->\n' > "$DOC/.claude/ECOSYSTEM.md"
  run run_doctor
  [ "$status" -eq 0 ]
  if [ -f "$DOCFLAG" ]; then ! grep -q "state-structure" "$DOCFLAG"; fi
}
