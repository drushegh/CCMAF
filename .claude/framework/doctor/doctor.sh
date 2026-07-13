#!/usr/bin/env bash
# doctor.sh — point-in-time framework integrity check.
#
# Complementary to:
#   - .claude/framework/update/ (pulls improvements)
#   - .claude/framework/insights/ (longitudinal efficacy)
#
# Doctor answers "is the framework intact RIGHT NOW?" — static state
# that should always hold. Runs on cold start (cheap, instantaneous;
# no throttle) and on demand. Silent when clean; writes
# .framework-doctor-findings.md when issues are detected. Cold start
# surfaces findings via AskUserQuestion.
#
# Invariants checked:
#   1. Hook scripts referenced in settings.json exist on disk,
#      and every hook file on disk is referenced in settings.json.
#   2. Cross-references (markdown links to local paths) in CLAUDE.md,
#      CLAUDE.framework.md, and framework-shipped docs point at files
#      that exist.
#   3. CLAUDE.md @imports CLAUDE.framework.md (a plain link is NOT
#      enough — Claude Code only inlines @path imports).
#   4. Every path in .claude/framework/update/framework-manifest.txt exists
#      locally. Missing paths mean apply-update.sh will fail mid-copy.
#   5. .framework-version (if present) has all required fields set.
#   6. TASKS.md has no duplicate TASK-NNN heading IDs.
#   9. Detector-consumer determinism: if any framework code added in
#      recent commits references .claude/review-findings.md or its
#      rotated archive as INPUT (not just output), warn unless
#      /healthcheck --verify has been run since.
#  10. statusLine.command reads stdin, not the nonexistent
#      $CLAUDE_STATUS_JSON env var.
#  11. GNU toolchain capabilities present (find -printf, date -d, sed -i).
#  12. No upstream framework-dev content leaked into consumer state files.
#  13. State-file structural grammar (TASKS / DECISIONS / GOTCHAS /
#      ECOSYSTEM): lane headings, status-section placement, lane routing,
#      the `·` (U+00B7) middot separator, the **Confidence:** marker, and
#      the contract status enum. Drift here SILENTLY drops entries from
#      downstream machine-readers (board projections, dashboards, the
#      framework's own scripts). Settled, shared shapes only — the
#      bracketed task-ID (`#### [TASK-N]`) and DEC-N decision-ID
#      conventions are under cross-repo discussion and are NOT enforced.
#  14. Reconcile cadence: warn (NAG) when >=RECONCILE_DUE_THRESHOLD tasks
#      have entered Done since .claude/telemetry/.last-reconcile's mtime —
#      the horizontal /reconcile pass is falling behind the vertical build
#      cadence. Silent (no baseline yet) until /reconcile has run once.
#  15. Board <-> reality coherence (contract:board-coherence): the board can
#      drift from demonstrable reality while passing the Stop hook (which
#      checks state files were TOUCHED, not truthful). Flags the drift class
#      /board-heal restores — tasks in Verify with no verify seed (when opted
#      into the Console; a task still queued in Ready-for-Test has no seed by
#      design), orphan seeds, a base ID spanning
#      >1 lifecycle column, and a Ready-for-Review pile-up (NAG). DETECT-only:
#      never mutates TASKS.md or the seeds. (Check 13 gained a companion flag
#      for NON-CANONICAL suffixed sub-IDs, which older board tools drop/mis-parse.)
#  16. State-file size budgets (OPT P3): each live state file vs a ceiling in
#      framework/doctor/state-budgets.conf (or .claude/state-budgets.local.conf).
#      >=80% -> WARNING, >=100% -> CRITICAL; finding names rotate-state.sh. This
#      is the missing half of the enforcement asymmetry (Stop defends freshness;
#      nothing defended bounds). Never blocks — enforce at boot, remediate at will.
#
# Exit codes:
#   0 — all checks pass OR findings written to flag file (cold start continues)
#   1 — fatal script error
#
# Dependencies: jq, grep, awk, find.

set -euo pipefail

# Bash 4+ guard (DA-C8): this script uses mapfile, which bash 3.2 (stock
# macOS) lacks — without the guard it dies mid-run with a confusing error
# and NO checks execute. Fail loudly and early instead.
if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then
  echo "doctor: bash >= 4 required (found ${BASH_VERSION:-unknown})." >&2
  echo "doctor: on macOS: brew install bash, then re-run. No checks were performed." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
FLAG_FILE="$PROJECT_ROOT/.claude/.framework-doctor-findings.md"
MANIFEST_FILE="$PROJECT_ROOT/.claude/framework/update/framework-manifest.txt"
SETTINGS_FILE="$PROJECT_ROOT/.claude/settings.json"
VERSION_FILE="$PROJECT_ROOT/.claude/.framework-version"

# Always remove stale flag — we recompute fresh each run.
rm -f "$FLAG_FILE"

# --- Finding collection ----------------------------------------------
# Each element: "SEVERITY|CHECK|MESSAGE". Severity is CRITICAL|WARNING|INFO|NAG.
findings=()
add_finding() { findings+=("$1|$2|$3"); }

# --- Per-check profiling (OPT round-2 P0): `doctor.sh --profile` times each
# check to stderr and exits 0. Measurement-first, per both advisors — pin down
# which checks own the cold-start wall time before repairing (round-2 P2).
DOCTOR_PROFILE=0; [ "${1:-}" = "--profile" ] && DOCTOR_PROFILE=1
_dnow_ms() { date +%s%3N 2>/dev/null | grep -qE '^[0-9]+$' && date +%s%3N || echo 0; }
_run() {
  if [ "$DOCTOR_PROFILE" = 1 ]; then
    local s e; s=$(_dnow_ms); "$1"; e=$(_dnow_ms)
    printf 'PROFILE %-26s %6s ms\n' "$1" "$((e - s))" >&2
  else
    "$1"
  fi
}

# --- Check 1: Hook ↔ settings.json consistency -----------------------
check_hooks() {
  if [ ! -f "$SETTINGS_FILE" ]; then
    add_finding "WARNING" "hooks" "No .claude/settings.json found — hooks will not run. Fix: restore settings.json or run Claude Code init."
    return
  fi

  if ! command -v jq >/dev/null 2>&1; then
    add_finding "INFO" "hooks" "jq missing — cannot introspect settings.json for hook consistency. Install jq: https://jqlang.github.io/jq/download/"
    return
  fi

  # Extract every `.hooks[...].hooks[...].command` string from settings.json
  # (plus statusLine.command — the statusline reader also lives under
  # .claude/hooks/ and must not be flagged as dead code), then pull the hook
  # path out of commands like `bash .claude/hooks/foo.sh` or
  # `python .claude/hooks/foo.py`.
  mapfile -t referenced_paths < <(
    jq -r '(.hooks // {} | to_entries | .[] | .value[]? | .hooks[]? | .command // empty), (.statusLine.command // empty)' "$SETTINGS_FILE" \
      | grep -oE '\.claude/hooks/[A-Za-z0-9_.-]+\.(sh|py)' \
      | sort -u
  )

  # Every referenced path should exist on disk.
  for p in "${referenced_paths[@]}"; do
    if [ ! -f "$PROJECT_ROOT/$p" ]; then
      add_finding "CRITICAL" "hooks" "\`.claude/settings.json\` references \`$p\` but the file is missing. The hook will silently not fire. Fix: restore the script, or remove the entry from settings.json."
    fi
  done

  # Every hook file on disk should be referenced in settings.json.
  # maxdepth 1 so sourced helper libraries under .claude/hooks/lib/ are
  # NOT treated as registerable hooks — they're included via `source`,
  # never wired into settings.json directly.
  if [ -d "$PROJECT_ROOT/.claude/hooks" ]; then
    mapfile -t on_disk < <(
      find "$PROJECT_ROOT/.claude/hooks" -maxdepth 1 -type f \( -name '*.sh' -o -name '*.py' \) -printf '.claude/hooks/%f\n' | sort -u
    )
    # O(1) membership set for the "directly referenced?" test — replaces a
    # `printf | grep -qxF` spawn per on-disk hook.
    local -A _ref_set=()
    for r in "${referenced_paths[@]}"; do _ref_set["$r"]=1; done
    # Existing registered-hook files, gathered ONCE — the dispatcher-indirect
    # check greps ALL of them in a single spawn per candidate rather than
    # looping (and recomputing basename) per referenced path.
    local ref_files=()
    for r in "${referenced_paths[@]}"; do
      [ -f "$PROJECT_ROOT/$r" ] && ref_files+=("$PROJECT_ROOT/$r")
    done
    for p in "${on_disk[@]}"; do
      [ -n "${_ref_set[$p]:-}" ] && continue   # directly referenced
      # Dispatcher-driven hooks (TASK-035): a hook invoked by a hook that IS
      # registered (post-edit-dispatch.sh runs auto-format / auto-lint /
      # verify-deps) is wired, just indirectly. Treat "basename appears in a
      # registered hook's file" as referenced. One multi-file grep, not a loop.
      if [ ${#ref_files[@]} -gt 0 ] && grep -qF "${p##*/}" "${ref_files[@]}" 2>/dev/null; then
        continue
      fi
      add_finding "WARNING" "hooks" "\`$p\` exists on disk but isn't referenced in \`.claude/settings.json\` (directly, or via a registered dispatcher hook). Either wire it up or delete the file (dead code)."
    done
  fi
}

# --- Check 2: Cross-references in core docs --------------------------
# Parse markdown links [text](path) in framework-shipped docs. If the
# path looks like a local file (no http/https/mailto, no pure anchor)
# and doesn't exist relative to the link's containing file OR the
# project root, flag it.
check_cross_refs() {
  local scan_files=()
  for f in "$PROJECT_ROOT/CLAUDE.md" "$PROJECT_ROOT/CLAUDE.framework.md"; do
    [ -f "$f" ] && scan_files+=("$f")
  done
  while IFS= read -r f; do
    scan_files+=("$f")
  done < <(find "$PROJECT_ROOT/.claude/agents/framework" "$PROJECT_ROOT/.claude/framework/agent_docs" -maxdepth 3 -type f -name '*.md' 2>/dev/null)

  for f in "${scan_files[@]}"; do
    local f_dir
    f_dir="${f%/*}"   # dirname (all scan_files are absolute paths) — no spawn
    # Extract markdown link targets: [...](path). grep emits the whole `](path)`
    # match; strip the `](` prefix and `)` suffix in-shell instead of piping
    # each file's matches through a per-file `sed` (16 files ≈ 16 saved spawns).
    while IFS= read -r target; do
      target="${target#](}"; target="${target%)}"
      # Skip external URLs, mailto, pure anchors, code-block paths.
      case "$target" in
        http://*|https://*|mailto:*|'#'*|'') continue ;;
      esac
      # Strip any trailing #anchor or ?query.
      local clean_target="${target%%#*}"
      clean_target="${clean_target%%\?*}"
      [ -z "$clean_target" ] && continue

      # Resolve relative to the containing file first, then project root.
      local resolved=""
      if [ -e "$f_dir/$clean_target" ]; then
        resolved="$f_dir/$clean_target"
      elif [ -e "$PROJECT_ROOT/$clean_target" ]; then
        resolved="$PROJECT_ROOT/$clean_target"
      else
        # Absolute paths (Unix /... or Windows drive-letter F:/...) resolve on
        # their own, not relative to the file or project root. Git Bash's test
        # understands the drive-letter form, so a real F:/... target exists here
        # — without this arm a valid absolute cross-ref false-WARNs every run.
        case "$clean_target" in
          /*|[A-Za-z]:/*) [ -e "$clean_target" ] && resolved="$clean_target" ;;
        esac
      fi

      if [ -z "$resolved" ]; then
        # Skip paths that are obviously meant as placeholders or shell commands.
        case "$clean_target" in
          *'$'*|*'{{'*|*'...'*) continue ;;
        esac
        local rel_f="${f#$PROJECT_ROOT/}"
        add_finding "WARNING" "cross-refs" "\`$rel_f\` links to \`$clean_target\` but the target doesn't exist. Fix: restore the file, update the link, or remove the reference."
      fi
    done < <(grep -oE '\]\([^)]+\)' "$f")
  done
}

# --- Check 3: CLAUDE.md has include pointer --------------------------
check_claude_include() {
  local claude="$PROJECT_ROOT/CLAUDE.md"
  local framework="$PROJECT_ROOT/CLAUDE.framework.md"

  # If CLAUDE.framework.md doesn't exist, this project may predate the
  # split — that's a separate migration concern, not a doctor finding.
  if [ ! -f "$framework" ]; then
    return
  fi

  if [ ! -f "$claude" ]; then
    add_finding "CRITICAL" "claude-md" "CLAUDE.framework.md exists but CLAUDE.md is missing. Every project needs a CLAUDE.md with project-specific content and a pointer to CLAUDE.framework.md."
    return
  fi

  # The pointer must be an @import. Claude Code auto-loads ONLY CLAUDE.md
  # and CLAUDE.local.md (no CLAUDE*.md wildcard), and plain markdown links
  # are NOT followed — only the `@path` import syntax inlines a file into
  # session context (verified against the code.claude.com memory docs,
  # 2026-06-10). A link-style pointer means the framework rules reach the
  # session only if the model volunteers to read the file.
  if grep -qE '(^|[[:space:]])@(\./)?CLAUDE\.framework\.md' "$claude"; then
    return
  fi
  if grep -qF "CLAUDE.framework.md" "$claude"; then
    add_finding "CRITICAL" "claude-md" "CLAUDE.md mentions CLAUDE.framework.md but does not @import it — Claude Code does not follow markdown links, so the framework rules are NOT reaching sessions. Fix: replace the pointer with an import line: \`@CLAUDE.framework.md\`."
  else
    add_finding "CRITICAL" "claude-md" "CLAUDE.md does not reference CLAUDE.framework.md. Framework-shipped instructions (cold start, agent rules, state file rules) will be missing from sessions. Fix: add \`@CLAUDE.framework.md\` near the top of CLAUDE.md."
  fi
}

# --- Check 4: framework-manifest.txt paths exist ---------------------
check_manifest_paths() {
  if [ ! -f "$MANIFEST_FILE" ]; then
    add_finding "INFO" "manifest" ".claude/framework/update/framework-manifest.txt not found. If this project hasn't adopted the update system, see .claude/framework/update/MIGRATION.md."
    return
  fi

  while IFS= read -r line; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    local path="${line%/}"
    if [ ! -e "$PROJECT_ROOT/$path" ]; then
      add_finding "CRITICAL" "manifest" "framework-manifest.txt lists \`$path\` but the path doesn't exist locally. apply-update.sh will fail mid-copy when it tries to mirror this path. Fix: restore the path, or remove the entry from the manifest."
    fi
  done < "$MANIFEST_FILE"
}

# --- Check 5: .framework-version validity ----------------------------
check_framework_version() {
  if [ ! -f "$VERSION_FILE" ]; then
    # Not all projects have opted in yet — not a failure.
    return
  fi

  # Parsed without sourcing (DA-M12: never execute a config file as shell —
  # a subshell only stops variable leakage into doctor's environment, it
  # does not stop a malicious .framework-version's content from running
  # arbitrary commands). Pull only the 3 required KEY=VALUE fields.
  # mktemp, not a predictable /tmp path (DA-H8): on a restricted /tmp the
  # old redirect failed silently and the check always passed.
  local missing_tmp
  missing_tmp=$(mktemp 2>/dev/null) || missing_tmp="$PROJECT_ROOT/.claude/.doctor-missing.$$"
  _ver_get() {
    sed -n "s/^[[:space:]]*$1=\\(.*\\)\$/\\1/p" "$VERSION_FILE" 2>/dev/null | tail -1
  }
  (
    _url="$(_ver_get FRAMEWORK_UPSTREAM_URL)";    _url="${_url%$'\r'}"
    _branch="$(_ver_get FRAMEWORK_UPSTREAM_BRANCH)"; _branch="${_branch%$'\r'}"
    _sha="$(_ver_get FRAMEWORK_PINNED_SHA)";      _sha="${_sha%$'\r'}"
    [ -z "$_url" ]    && echo "FRAMEWORK_UPSTREAM_URL"
    [ -z "$_branch" ] && echo "FRAMEWORK_UPSTREAM_BRANCH"
    [ -z "$_sha" ]    && echo "FRAMEWORK_PINNED_SHA"
  ) > "$missing_tmp" 2>/dev/null || true

  if [ -s "$missing_tmp" ]; then
    local missing_csv
    missing_csv=$(tr '\n' ',' < "$missing_tmp" | sed 's/,$//')
    add_finding "CRITICAL" "framework-version" ".framework-version is missing required fields: $missing_csv. Updates will not work. Fix: re-run \`bash .claude/framework/update/init-framework-version.sh --force\`."
  fi
  rm -f "$missing_tmp"
}

# --- Check 6: (retired) ----------------------------------------------
# Check 6 (multi-project mode consistency) was removed 2026-06-10 along
# with multi-project mode itself (TASK-023). Number retained so later
# check numbers stay stable across docs and findings history.

# --- Check 7: No duplicate TASK-NNN heading IDs ----------------------
check_task_duplicates() {
  # State files live at .claude/ (framework-self redirect retired, TASK-054).
  local tasks="$PROJECT_ROOT/.claude/TASKS.md"
  [ ! -f "$tasks" ] && return

  # Only match task IDs that appear as ENTRY headings: a `#### [TASK-NNN]`
  # bracketed heading, or a `- **TASK-NNN**` list-item entry (the bullet-board
  # style). Both arms are LINE-ANCHORED (`^`) so a bold `**TASK-NNN**` mention
  # sitting mid-PROSE (a description referencing another task) is NOT counted —
  # the old unanchored `\*\*…\*\*` arm miscounted those, mis-flagging any task
  # whose ID appears bolded in another entry's prose as a duplicate (the known
  # Check-7 FP on every cold start). `[[:space:]]` not `\s` (BSD grep lacks
  # `\s`). `-oE` prints only the matched prefix, so a heading line that also
  # references another ID in trailing prose contributes just its own ID.
  mapfile -t dups < <(
    grep -oE '^(#+[[:space:]]*\[(TASK|BUG)-[0-9]+\]|[[:space:]]*[-*][[:space:]]+\*\*(TASK|BUG)-[0-9]+\*\*)' "$tasks" \
      | grep -oE '(TASK|BUG)-[0-9]+' \
      | sort \
      | uniq -d
  )

  for id in "${dups[@]}"; do
    add_finding "WARNING" "tasks" "TASKS.md contains duplicate heading entries for \`$id\`. Task IDs must be unique — commit linkage and status tracking break with duplicates. Fix: rename one, merge them, or move one to Done with a ✓."
  done
}

# Check 8 (framework-self.flag must not be committed) was removed in TASK-054
# along with framework-self mode itself. Number retained so later check numbers
# stay stable across docs and findings history.

# --- Check 9: Detector-consumer determinism --------------------------
# If any framework script/hook/agent has been recently added or modified
# to READ .claude/review-findings.md (or its rotated archive) — i.e.,
# build automation on top of /healthcheck output — warn unless
# /healthcheck --verify has run since the introducing commit. This is
# the BUG-001 defense: don't ship consumers against a detector that
# hasn't had its determinism verified.
#
# Heuristic: search framework-owned paths for files modified in the
# last 30 commits that grep for `review-findings` and look like they
# READ the file (cat, head, grep, jq, parse) rather than just APPEND
# (the rotation case and the normal write pattern).
check_detector_consumers() {
  # Files to scan: framework code only (not docs, not the runbook itself).
  # `.claude/framework/doctor/` is intentionally EXCLUDED — doctor.sh is
  # the checker for this invariant and its check pattern necessarily
  # contains the string "review-findings", which would cause a self-match.
  local scan_paths=(
    "$PROJECT_ROOT/.claude/hooks"
    "$PROJECT_ROOT/.claude/framework/insights"
    "$PROJECT_ROOT/.claude/framework/audit"
  )
  # The runbook itself (healthcheck.md) is the producer, not a consumer.
  # The scrape-review-findings.sh script is a known legitimate consumer
  # (insights pipeline) — it's older than this check and pre-existed
  # BUG-001's surfacing.
  local known_consumers="scrape-review-findings.sh"

  local recently_changed=""
  recently_changed=$(git -C "$PROJECT_ROOT" log --name-only --pretty=format: -30 -- \
    "${scan_paths[@]}" 2>/dev/null \
    | sort -u | grep -v '^$' || true)
  [ -z "$recently_changed" ] && return

  # Collect existing, non-known-consumer candidates (pure-bash filter — no
  # per-item basename/grep spawns; the old loop spawned basename + up to two
  # greps PER changed file, ~29 files ≈ 3.9s on Windows). `${f##*/}` is basename.
  local candidates=()
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    [ -f "$PROJECT_ROOT/$f" ] || continue
    case "${f##*/}" in "$known_consumers") continue ;; esac
    candidates+=("$PROJECT_ROOT/$f")
  done <<<"$recently_changed"

  # Does the file READ review-findings? One multi-file `grep -l` over ALL
  # candidates in a SINGLE spawn (both read-like patterns alternated), instead
  # of two greps per file. `grep -l` prints the (absolute) paths that matched;
  # strip the root prefix back to the relative form the rest of the check uses.
  local suspect_files=()
  if [ ${#candidates[@]} -gt 0 ]; then
    while IFS= read -r hit; do
      [ -z "$hit" ] && continue
      suspect_files+=("${hit#"$PROJECT_ROOT"/}")
    done < <(grep -lE '(cat|head|tail|jq|grep|awk|sed)[[:space:]][^|]*review-findings|<[[:space:]]*[^|<>]*review-findings' "${candidates[@]}" 2>/dev/null || true)
  fi

  [ ${#suspect_files[@]} -eq 0 ] && return

  # Has /healthcheck --verify been run since the most recent of these
  # files was last touched? The marker is a determinism summary under
  # .claude/review-findings/_determinism-*.md.
  # Portable mtime (DA-H8): GNU stat -c, BSD stat -f, GNU date -r, else 0.
  # The old bare `date -r` is a different flag on BSD date (epoch display,
  # not file mtime) so the check silently degraded off-GNU.
  _mtime() {
    stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null \
      || date -r "$1" +%s 2>/dev/null || echo 0
  }

  local newest_consumer_mtime=0
  for f in "${suspect_files[@]}"; do
    local m
    m=$(_mtime "$PROJECT_ROOT/$f")
    [ "$m" -gt "$newest_consumer_mtime" ] && newest_consumer_mtime="$m"
  done

  local newest_verify_mtime=0
  if [ -d "$PROJECT_ROOT/.claude/review-findings" ]; then
    local v vf
    # Portable replacement for `find -printf '%T@'` (GNU-only, DA-H8).
    while IFS= read -r vf; do
      v=$(_mtime "$vf")
      [ "$v" -gt "$newest_verify_mtime" ] && newest_verify_mtime="$v"
    done < <(find "$PROJECT_ROOT/.claude/review-findings" -name '_determinism-*.md' 2>/dev/null)
  fi

  if [ "$newest_verify_mtime" -lt "$newest_consumer_mtime" ]; then
    local files_csv
    files_csv=$(printf '%s, ' "${suspect_files[@]}")
    files_csv="${files_csv%, }"
    add_finding "WARNING" "detector-consumer" "Recent framework changes ($files_csv) appear to READ \`.claude/review-findings.md\` — i.e., consume /healthcheck output. No \`/healthcheck --verify\` run found since these files were modified. Run \`/healthcheck --verify 3\` and confirm output is stable before relying on these consumers. Rationale: BUG-001 (2026-04-26) — consumers built on non-deterministic detector output silently shipped against unreliable data."
  fi
}

# --- Check 10: statusline reads stdin, not a phantom env var ----------
# Claude Code delivers statusline data as JSON on STDIN. There is no
# CLAUDE_STATUS_JSON env var — a command that reads it renders permanent
# "?" placeholders. Consumers' settings.json is project-owned (not
# manifest-updated), so this check is how the fix reaches existing clones.
check_statusline() {
  [ ! -f "$SETTINGS_FILE" ] && return
  command -v jq >/dev/null 2>&1 || return
  local cmd
  cmd=$(jq -r '.statusLine.command // empty' "$SETTINGS_FILE" 2>/dev/null || true)
  [ -z "$cmd" ] && return
  if [[ "$cmd" == *CLAUDE_STATUS_JSON* ]]; then
    add_finding "WARNING" "statusline" "settings.json statusLine reads \$CLAUDE_STATUS_JSON, which Claude Code never sets — the status line has been rendering placeholders. Status data arrives as JSON on stdin. Fix: set statusLine.command to \`bash .claude/hooks/statusline.sh\` (shipped stdin reader)."
  fi
}

# --- Check 11: GNU toolchain capabilities ------------------------------
# Several framework scripts depend on GNU extensions that BSD/macOS stock
# tools silently lack: find -printf (doctor Checks 1/9, instinct-miner
# discovery), date -d (update/insights throttles), sed -i without ''
# (migrate-layout rewrites). On BSD tools these don't error visibly — the
# features just go dead. Say so loudly once instead (DA-C8).
check_gnu_toolchain() {
  local missing=()
  find /dev/null -maxdepth 0 -printf '' >/dev/null 2>&1 \
    || missing+=("find -printf (doctor hook/mtime checks, instinct-miner discovery)")
  date -u -d '1970-01-01T00:00:00Z' +%s >/dev/null 2>&1 \
    || missing+=("GNU date -d (update/insights throttles never engage)")
  sed --version 2>/dev/null | grep -q GNU \
    || missing+=("GNU sed -i (migrate-layout path rewrites silently skip)")

  [ ${#missing[@]} -eq 0 ] && return
  local list
  list=$(printf '%s; ' "${missing[@]}")
  list="${list%; }"
  add_finding "WARNING" "gnu-toolchain" "Non-GNU userland detected — these framework features are silently degraded: $list. Fix on macOS: \`brew install coreutils findutils gnu-sed grep\` and put the gnubin dirs on PATH, or accept the listed degradations."
}

# --- Check 12: upstream framework-dev content leaked into state files --
# Clones made before the 2026-06-10 clean-template switch (TASK-027)
# inherited the upstream repo's own framework-development GOTCHAS /
# FRAMEWORK-SUGGESTIONS content in their root .claude/ state files. Those
# entries describe building the framework itself, not the consumer's
# project — noise for every session that reads them. State files are
# consumer-owned (never manifest-updated), so this doctor warning is the
# propagation channel (TASK-024 principle). Fingerprints are entry titles
# unique to the leaked upstream content; the clean templates ship none of
# them. The framework's OWN dev repo (identified by a committed
# `.claude/.framework-dev-repo` marker, TASK-089) legitimately carries dev
# content in its dirty root board, so it is skipped here (TASK-054 retired
# the framework-self redirect; the dirty root IS the dev board now).
check_state_file_leak() {
  # Skip in the framework's own dev repo — its root board is the real dev board,
  # not a leaked consumer template. Signal: a committed .claude/.framework-dev-repo
  # marker (TASK-089 — replaced the old "02_solution/.claude/framework exists"
  # signal once 02_solution/ was retired as a separate dev-build copy).
  [ -f "$PROJECT_ROOT/.claude/.framework-dev-repo" ] && return
  local f hits=""
  for f in "$PROJECT_ROOT/.claude/GOTCHAS.md" "$PROJECT_ROOT/.claude/FRAMEWORK-SUGGESTIONS.md"; do
    [ -f "$f" ] || continue
    if grep -qE "SCRIPT_DIR depth is move-sensitive|Bulk sed on paths can create double-prefix|00_framework/ → \.claude/framework/ restructure" "$f" 2>/dev/null; then
      hits+="${f##*/} "
    fi
  done
  [ -z "$hits" ] && return
  add_finding "WARNING" "state-files" "${hits% }contains upstream framework-development entries (pre-2026-06-10 template leak, TASK-027). They describe the framework's OWN development, not this project — prune them (keep anything genuinely about this project). /housekeeping's adopted-feedback step is a good moment."
}

# --- Check 13: State-file structural grammar -------------------------
# The .claude/ state files are a MACHINE-READ interface: downstream tooling
# (board projections, dashboards, the framework's own scripts) parses
# TASKS.md / DECISIONS.md / GOTCHAS.md / ECOSYSTEM.md by exact heading
# levels, bold "**Field:**" markers, the `·` (U+00B7) middot separator, and a
# fixed contract status enum. When a shape drifts these parsers don't error —
# they SILENTLY drop the malformed entry (a task vanishes from a board, a
# decision's Status won't parse, a contract goes undetected). This check
# validates the grammars whose breakage causes SILENT loss and flags drift
# before a human hits a degraded surface.
#
# Canonical board grammar (agreed cross-repo, CHANNEL round 2, 2026-06-26 — the
# Console both READS and WRITES this board):
#   - Task/bug entries are BRACKETED level-4 headings: `#### [TASK-N]` /
#     `#### [BUG-N]`. Enforced — the Console writes `#### [BUG-n]` into the board
#     (flag-as-bug), so a bare entry makes a flagged board MIXED. Bare entries
#     still parse (the reader is widened) but are flagged (WARNING, aggregated).
#   - The lifecycle includes a human `Verify` stage after Ready for Test; the
#     Feature lane needs a `### Verify` section or board writeback to Verify
#     fails (target_missing).
#   - DECISIONS headings are date-headed (`## YYYY-MM-DD — Title`) OR DEC-N
#     (`## DEC-N — Title`) — both are read; a heading that is neither is dropped.
#     The `**Date:** · **Status:**` meta line (when present) needs the middot.
#
# Comment-aware: <!-- … --> blocks are stripped before matching the prose
# files, so commented-out templates don't trip the checks. ECOSYSTEM.md is
# matched RAW because its contract anchors ARE html comments.
check_state_structure() {
  local sd="$PROJECT_ROOT/.claude"
  local tmps=() bad fl fs k
  _ss_cleanup() { if [ ${#tmps[@]} -gt 0 ]; then rm -f "${tmps[@]}"; fi; }

  # Blank out <!-- … --> comment blocks (inline + multi-line). Byte-safe.
  _strip_html_comments() {  # <file> → stdout
    awk '
      { s=$0; out=""
        if (inc) { i=index(s,"-->"); if(i){ s=substr(s,i+3); inc=0 } else { print ""; next } }
        while ((o=index(s,"<!--"))>0) {
          out=out substr(s,1,o-1); s=substr(s,o+4)
          i=index(s,"-->"); if(i){ s=substr(s,i+3) } else { inc=1; s=""; break }
        }
        print out s
      }
    ' "$1"
  }

  # ---- TASKS.md ----
  local tasks="$sd/TASKS.md"
  if [ -f "$tasks" ]; then
    local t; t=$(mktemp 2>/dev/null) || t="$sd/.doctor-tasks.$$"; tmps+=("$t")
    _strip_html_comments "$tasks" > "$t"

    grep -qiE '^##[[:space:]]+Feature[[:space:]]+Lane' "$t" \
      || add_finding "WARNING" "state-structure" "TASKS.md has no \`## Feature Lane\` heading — board parsers collect tasks under the two lane headings; without it the entire Feature lane is invisible to them. Fix: restore the \`## Feature Lane\` heading."
    grep -qiE '^##[[:space:]]+Bug[-[:space:]]+Fix[[:space:]]+Lane' "$t" \
      || add_finding "WARNING" "state-structure" "TASKS.md has no \`## Bug-Fix Lane\` heading — bug entries can't route. Fix: restore the \`## Bug-Fix Lane\` heading."

    # A '### Status' section before ANY '## …Lane' heading → its tasks never
    # parse (status sections are only collected inside a lane).
    fl=$(grep -nE '^##[[:space:]]+(Feature|Bug)' "$t" | head -1 | cut -d: -f1 || true)
    fs=$(grep -nE '^###[[:space:]]' "$t" | head -1 | cut -d: -f1 || true)
    if [ -n "$fs" ] && { [ -z "$fl" ] || [ "$fs" -lt "$fl" ]; }; then
      add_finding "WARNING" "state-structure" "TASKS.md has a \`### …\` status section before the first \`## …Lane\` heading — tasks under it are silently dropped (status sections must sit inside a lane). Fix: put both lane headings above all status sections."
    fi

    # A task-looking ID at heading level 3 → parsers read '###' as a status
    # column and '####' as the entry, so the entry silently vanishes.
    while IFS= read -r bad; do
      [ -z "$bad" ] && continue
      add_finding "WARNING" "state-structure" "TASKS.md: \`$bad\` is a task ID at heading level 3 — board parsers read \`###\` as a status column and \`####\` as the entry, so this entry is silently dropped. Fix: make it a level-4 heading (\`#### …\`)."
    done < <(grep -oE '^###[[:space:]]+\[?(TASK|BUG)-[0-9]+' "$t")

    # Lane routing: BUG-* under Feature, or TASK-* under Bug-Fix. The ID
    # prefix is authoritative, so a wrong-lane entry breaks status writeback.
    # Matches bracketed AND bare IDs (bracket convention pending discussion).
    while IFS= read -r bad; do
      [ -z "$bad" ] && continue
      add_finding "WARNING" "state-structure" "TASKS.md: $bad — the ID prefix is authoritative for lane routing, so a wrong-lane entry breaks status writeback in board tools. Fix: move it to the matching lane."
    done < <(
      awk '
        /^##[[:space:]]+[Ff]eature[[:space:]]+[Ll]ane/                { lane="F"; next }
        /^##[[:space:]]+[Bb]ug[-[:space:]]+[Ff]ix[[:space:]]+[Ll]ane/ { lane="B"; next }
        /^####[[:space:]]+\[?(TASK|BUG)-[0-9]+/ {
          match($0,/(TASK|BUG)-[0-9]+/); id=substr($0,RSTART,RLENGTH)
          if (id ~ /^BUG-/  && lane=="F") print id " sits under the Feature lane"
          if (id ~ /^TASK-/ && lane=="B") print id " sits under the Bug-Fix lane"
        }
      ' "$t"
    )

    # Bracket enforcement (agreed canonical, CHANNEL r2): task/bug entries are
    # bracketed `#### [TASK-N]` / `#### [BUG-N]`. A bare `#### TASK-N` still
    # parses on the widened Console reader, but the Console WRITES bracketed bug
    # IDs (flag-as-bug), so a bare board goes mixed once a bug is flagged. One
    # aggregated finding (a whole board of bare entries shouldn't shout per-line).
    local bare_n bare_eg
    bare_n=$(grep -cE '^####[[:space:]]+(TASK|BUG)-[0-9]+' "$t" || true)
    if [ "${bare_n:-0}" -gt 0 ]; then
      bare_eg=$(grep -oE '^####[[:space:]]+(TASK|BUG)-[0-9]+' "$t" | grep -oE '(TASK|BUG)-[0-9]+' | head -1 || true)
      add_finding "WARNING" "state-structure" "TASKS.md has $bare_n task/bug entries with BARE IDs (e.g. \`$bare_eg\`) — the canonical board form is bracketed \`#### [TASK-N]\` / \`#### [BUG-N]\`. Downstream board tools WRITE bracketed IDs (flag-as-bug), so a bare board goes mixed once a bug is flagged. Fix: bracket the IDs."
    fi

    # Suffixed sub-IDs (TASK-111 #4): a `#### [TASK-Na]` / bare `#### TASK-Na`
    # heading. The canonical board ID is NUMERIC (^(TASK|BUG)-[0-9]+$); a trailing
    # alpha suffix is an unsanctioned wave-prep improvisation and NON-CANONICAL.
    # Current Console builds (ccmaf-console 0.2.3+, TASK-117) surface it flagged;
    # older builds dropped a bracketed `[TASK-Na]` / folded a bare `TASK-Na` into
    # its numeric parent (collision). Either way it's off-grammar. One aggregated finding.
    local sfx_n sfx_eg
    sfx_n=$(grep -cE '^####[[:space:]]+\[?(TASK|BUG)-[0-9]+[a-z]+' "$t" || true)
    if [ "${sfx_n:-0}" -gt 0 ]; then
      sfx_eg=$(grep -oE '^####[[:space:]]+\[?(TASK|BUG)-[0-9]+[a-z]+' "$t" | grep -oE '(TASK|BUG)-[0-9]+[a-z]+' | head -1 || true)
      add_finding "WARNING" "state-structure" "TASKS.md has $sfx_n task/bug entries with SUFFIXED IDs (e.g. \`$sfx_eg\`) — the canonical board ID is numeric \`(TASK|BUG)-[0-9]+\`. A trailing alpha suffix is NON-CANONICAL: current Console builds (ccmaf-console 0.2.3+) surface it flagged, older builds dropped/mis-parsed it — either way it's off-grammar. Fix: run \`/board-heal\` to renumber them to distinct numeric IDs, or allocate numeric IDs for sub-tasks up front."
    fi

    # Verify-stage section in the FEATURE lane specifically: the canonical
    # lifecycle is `… Ready for Test → Verify → Done`; board writeback that moves
    # a task to Verify needs the section to exist (else target_missing).
    if grep -qiE '^##[[:space:]]+Feature[[:space:]]+Lane' "$t"; then
      local has_verify
      has_verify=$(awk '
        /^##[[:space:]]/ { infeat = ($0 ~ /[Ff]eature[[:space:]]+[Ll]ane/) ? 1 : 0; next }
        infeat && /^###[[:space:]]+[Vv]erify([[:space:]]|$)/ { print "yes"; exit }
      ' "$t")
      if [ -z "$has_verify" ]; then
        add_finding "WARNING" "state-structure" "TASKS.md Feature lane has no \`### Verify\` section — the canonical lifecycle includes a human Verify stage (Ready for Test → Verify → Done) and board tools that move a task to Verify need the section to exist. Fix: add a \`### Verify\` section to the Feature lane."
      fi
    fi
  fi

  # ---- DECISIONS.md ----
  # Entry headings may be date-headed (`## YYYY-MM-DD — Title`) OR DEC-N
  # (`## DEC-N — Title`); both are read. A `##` entry heading that is neither is
  # dropped. The `**Date:** · **Status:**` meta line (when present) needs the middot.
  local dec="$sd/DECISIONS.md"
  if [ -f "$dec" ]; then
    local d; d=$(mktemp 2>/dev/null) || d="$sd/.doctor-dec.$$"; tmps+=("$d")
    _strip_html_comments "$dec" > "$d"
    while IFS= read -r bad; do
      [ -z "$bad" ] && continue
      add_finding "WARNING" "state-structure" "DECISIONS.md meta line lacks the \`·\` (U+00B7) middot between \`**Date:**\` and \`**Status:**\` — parsers need it to read the Status (a hyphen/pipe drops it):${bad#*:}. Fix: \`**Date:** <date> · **Status:** <status>\`."
    done < <(awk '/^\*\*Date:\*\*.*\*\*Status:\*\*/ && index($0,"·")==0 {print NR": "$0}' "$d")
    # A `##` entry heading that is neither an ISO date nor a DEC-N id → dropped.
    while IFS= read -r bad; do
      [ -z "$bad" ] && continue
      add_finding "WARNING" "state-structure" "DECISIONS.md:${bad#*:} is a decision heading that is neither date-headed (\`## YYYY-MM-DD — …\`) nor \`## DEC-N — …\` — readers parse one of those two forms, so this entry is dropped. Fix: start the heading with an ISO date or a DEC-N id."
    done < <(awk '
      /^##[[:space:]]/ {
        h=$0; sub(/^##[[:space:]]+/,"",h)
        if (h ~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/) next
        if (h ~ /^DEC-[0-9]+/) next
        print NR": "$0
      }
    ' "$d")
  fi

  # ---- GOTCHAS.md ----
  local got="$sd/GOTCHAS.md"
  if [ -f "$got" ]; then
    local g; g=$(mktemp 2>/dev/null) || g="$sd/.doctor-got.$$"; tmps+=("$g")
    _strip_html_comments "$got" > "$g"
    # A Confidence marker not in the exact **Confidence:** bold form → value won't read.
    while IFS= read -r bad; do
      [ -z "$bad" ] && continue
      add_finding "WARNING" "state-structure" "GOTCHAS.md:${bad#*:} is a Confidence marker but not the exact \`**Confidence:**\` bold form parsers require — its value won't read. Fix: \`**Confidence:** <value>\`."
    done < <(awk '/^[[:space:]]*\**[Cc]onfidence:/ && $0 !~ /^\*\*Confidence:\*\*/ {print NR": "$0}' "$g")
    # A Count line missing the middot before First seen.
    while IFS= read -r bad; do
      [ -z "$bad" ] && continue
      add_finding "WARNING" "state-structure" "GOTCHAS.md:${bad#*:} is a Count line missing the \`·\` middot between the count and \`First seen:\` — it won't parse. Fix: \`Count: N · First seen: <date>\`."
    done < <(awk '/^Count:/ && /First seen:/ && index($0,"·")==0 {print NR": "$0}' "$g")
  fi

  # ---- ECOSYSTEM.md contract anchors (RAW — anchors ARE html comments) ----
  # Only an anchor ATTEMPT (a comment carrying both `contract:` and `status:`
  # in order) is validated — a prose comment that merely mentions "contract:"
  # is not an anchor and the parser ignores it, so it must not false-positive.
  local eco="$sd/ECOSYSTEM.md"
  if [ -f "$eco" ]; then
    while IFS= read -r bad; do
      [ -z "$bad" ] && continue
      case "$bad" in *"status:draft"*|*"status:stable"*) continue ;; esac
      add_finding "WARNING" "state-structure" "ECOSYSTEM.md contract anchor has an out-of-enum status (parsers accept ONLY \`status:draft\`/\`status:stable\`, case-sensitive — anything else means the contract is silently undetected): \`${bad#*:}\`. Fix: use \`status:draft\` or \`status:stable\`."
    done < <(grep -nE '<!--[^>]*contract:[^>]*status:[^>]*-->' "$eco")
  fi

  # ---- Telemetry frozen keys (INFO; hook-generated) ----
  local hm="$sd/telemetry/.hook-metrics"
  if [ -f "$hm" ] && command -v jq >/dev/null 2>&1 && jq -e . "$hm" >/dev/null 2>&1; then
    for k in generated_at total_events by_hook by_session; do
      jq -e "has(\"$k\")" "$hm" >/dev/null 2>&1 \
        || add_finding "INFO" "state-structure" "telemetry/.hook-metrics is missing the frozen snake_case key \`$k\` — dashboards key tiles off these names; a rename or re-case zeroes the tile. (Hook-generated — usually means an emitter changed.)"
    done
  fi

  _ss_cleanup
}

# --- Check 14: Reconcile cadence ---------------------------------------
# The reconciler (horizontal auditor — duplicate/seam/contract/convention
# drift) is a STABILIZER, not part of the inner build loop: it runs on
# demand (/reconcile), not per-task. That means it can silently fall behind
# a fast build cadence with nothing to notice. This check counts tasks that
# entered TASKS.md's Done section(s) since the last successful /reconcile
# (the .last-reconcile watermark's mtime) and nags once the count clears a
# threshold — the same "state doesn't get less broken over time, surface
# it" reasoning as every other doctor check, applied to a cadence gap
# instead of a structural break.
#
# Threshold is a variable, not a hardcoded number: RECONCILE_DUE_THRESHOLD
# (default 5), consistent with the framework's other env-tunable knobs
# (HEALTHCHECK_REMIND_DAYS, CLAUDE_CHECKPOINT_WATERMARK_PCT, etc.).
#
# Method: resolve the git commit nearest-before the watermark's mtime,
# diff TASKS.md's Done-section task/bug IDs at that commit against Done at
# HEAD (set difference via awk — no new tool dependency; `comm` was
# considered and rejected to keep this check on the same jq/grep/awk/find(+git)
# toolchain the rest of doctor.sh already assumes). [ASSUMED]: identifies
# "Done" purely by the nearest preceding `###` heading matching /Done/,
# same technique check_state_structure already uses — it does not
# distinguish Feature-lane Done from Bug-Fix-lane Done (the task counts
# either as "entered Done"), and per the task's own wording ("Done
# columns", plural) that's the intended scope.
#
# Known limitation (documented, not fixed here): if /housekeeping archives
# Done entries to tasks-archive.md inside the same window this check
# looks at, an archived task disappears from "Done at HEAD" and is
# undercounted. This is a conservative miss (undercounts, never
# overcounts) and matches the risk tolerance check_detector_consumers
# (Check 9) already accepts for its own git-log heuristic.
check_reconcile_due() {
  local wm="$PROJECT_ROOT/.claude/telemetry/.last-reconcile"
  local tasks="$PROJECT_ROOT/.claude/TASKS.md"
  [ -f "$wm" ] || return 0    # no reconcile has ever run — no baseline, not a failure (same pattern as Check 5)
  [ -f "$tasks" ] || return 0
  command -v git >/dev/null 2>&1 || return 0

  local threshold="${RECONCILE_DUE_THRESHOLD:-5}"

  # Portable mtime — same fallback chain as Check 9's _mtime, defined
  # locally (not reused across functions) so this check has no hidden
  # ordering dependency on Check 9 running first.
  local wm_epoch
  wm_epoch=$(stat -c %Y "$wm" 2>/dev/null || stat -f %m "$wm" 2>/dev/null \
    || date -r "$wm" +%s 2>/dev/null || echo 0)
  [ "$wm_epoch" = 0 ] && return

  # Nearest commit at or before the watermark's mtime that touched TASKS.md.
  # Git's approxidate accepts a raw "@<unix-epoch>" token directly.
  local base_commit
  base_commit=$(git -C "$PROJECT_ROOT" log -1 --before="@$wm_epoch" --format=%H -- .claude/TASKS.md 2>/dev/null || true)

  # Extract Done-section task/bug IDs from a given ref (empty ref = working tree).
  _rd_done_ids() {
    local content
    if [ -z "$1" ]; then
      content=$(cat "$tasks" 2>/dev/null)
    else
      # `|| true`: an unreadable baseline (deletion commit, shallow clone)
      # yields an empty ID set — fail toward nagging, never toward crashing.
      content=$(git -C "$PROJECT_ROOT" show "$1:.claude/TASKS.md" 2>/dev/null || true)
    fi
    printf '%s\n' "$content" | awk '
      /^##[[:space:]]/  { sect=""; next }
      /^###[[:space:]]/ { sect=$0; next }
      sect ~ /Done/ && /^####/ {
        match($0,/(TASK|BUG)-[0-9]+/)
        if (RSTART) print substr($0,RSTART,RLENGTH)
      }
    '
  }

  local current_ids base_ids new_count
  current_ids=$(_rd_done_ids "" | sort -u)
  if [ -n "$base_commit" ]; then
    base_ids=$(_rd_done_ids "$base_commit" | sort -u)
  else
    # No resolvable baseline (squashed/shallow history): an empty base set
    # makes every current Done ID count as new. Passing "" to _rd_done_ids
    # would read the working tree and compare it to itself — never nag.
    base_ids=""
  fi

  new_count=$(awk '
    NR==FNR { base[$0]=1; next }
    $0 != "" && !($0 in base) { n++ }
    END { print n+0 }
  ' <(printf '%s\n' "$base_ids") <(printf '%s\n' "$current_ids"))

  [ "${new_count:-0}" -ge "$threshold" ] || return 0
  add_finding "NAG" "reconcile" "reconcile due ($new_count tasks entered Done since the last /reconcile pass, threshold $threshold). The horizontal auditor (duplicate/seam/contract/convention drift) hasn't run since \`.claude/telemetry/.last-reconcile\` was last written. Fix: run \`/reconcile\` (defaults to scoped mode since that watermark)."
}

# --- Check 15: Board <-> reality coherence (contract:board-coherence) -
# DETECT-ONLY. The board (TASKS.md) can drift from demonstrable reality while
# passing the Stop hook (which checks state files were TOUCHED, not truthful).
# Flags the drift class /board-heal restores: Verify tasks with no verify seed
# (when opted into the Console), orphan seeds, a base ID in two
# lifecycle columns, and a Ready-for-Review pile-up. Never writes TASKS.md or the
# seeds. Comment-aware (a commented-out task block never counts). Bash-4 assoc
# arrays are guaranteed by the top-of-file bash>=4 guard.
check_board_coherence() {
  local tasks="$PROJECT_ROOT/.claude/TASKS.md"
  [ -f "$tasks" ] || return 0
  local console_dir="$PROJECT_ROOT/.claude/console"
  local verify_dir="$console_dir/verify"
  local threshold="${RFR_STALL_THRESHOLD:-8}"

  local t; t=$(mktemp 2>/dev/null) || t="$PROJECT_ROOT/.claude/.doctor-bc.$$"
  # Multi-line-comment-aware strip (same technique as check_state_structure).
  awk '
    { s=$0; out=""
      if (inc) { i=index(s,"-->"); if(i){ s=substr(s,i+3); inc=0 } else { next } }
      while ((o=index(s,"<!--"))>0) {
        out=out substr(s,1,o-1); s=substr(s,o+4)
        i=index(s,"-->"); if(i){ s=substr(s,i+3) } else { inc=1; s=""; break }
      }
      print out s
    }
  ' "$tasks" > "$t"

  # One awk pass -> "lane<TAB>status<TAB>fullId" per task/bug heading (suffix kept).
  # status normalised: `### Ready for Test (foo)` -> `Ready for Test`.
  local rows
  rows=$(awk '
    /^##[[:space:]]+[Ff]eature[[:space:]]+[Ll]ane/                 { lane="feature"; status=""; next }
    /^##[[:space:]]+[Bb]ug[-[:space:]]+[Ff]ix[[:space:]]+[Ll]ane/ { lane="bug";     status=""; next }
    /^###[[:space:]]/ {
      status=$0; sub(/^###[[:space:]]+/,"",status)
      # Strip trailing parenthetical group(s) only — parity with the Console
      # parser (tasks-parser.ts normaliseStatus: /(\s*\([^)]*\))+\s*$/). A
      # strip-from-first-paren would diverge on a mid-string paren heading.
      while (status ~ /\([^)]*\)[[:space:]]*$/) sub(/[[:space:]]*\([^)]*\)[[:space:]]*$/,"",status)
      sub(/[[:space:]]+$/,"",status); next
    }
    /^####[[:space:]]+\[?(TASK|BUG)-[0-9]+[a-z]*/ {
      if (match($0,/(TASK|BUG)-[0-9]+[a-z]*/))
        print lane "\t" status "\t" substr($0,RSTART,RLENGTH)
    }
  ' "$t")
  rm -f "$t"

  # --- Invariant 5: Ready-for-Review pile-up (NAG) ---
  # Feature lane only ($1=="feature") — the pile-up symptom is a Feature-lane
  # build that never walked the lifecycle; a customised Bug-Fix lane column of
  # the same name must not inflate the count.
  local rfr_count
  rfr_count=$(printf '%s\n' "$rows" | awk -F'\t' '$1=="feature" && tolower($2)=="ready for review"{n++} END{print n+0}')
  if [ "${rfr_count:-0}" -ge "$threshold" ]; then
    add_finding "NAG" "board-coherence" "TASKS.md has $rfr_count tasks stalled in Ready for Review (threshold $threshold, RFR_STALL_THRESHOLD) — an autonomous/batch build that never walked the per-task review->test->Verify lifecycle looks exactly like this. Fix: run \`/board-heal\` to advance each to its truthful status (evidence-driven) and backfill verify seeds."
  fi

  # --- Invariant 4: same base ID in >1 lifecycle column ---
  # base = full id minus any trailing alpha suffix (TASK-007a -> TASK-007). Flag
  # only when a base has >1 DISTINCT full id AND >1 distinct column (the suffix-
  # fold case); an exact-duplicate id is Check 7's job, not this one.
  local lane status id base
  declare -A _bc_cols _bc_fulls
  while IFS=$'\t' read -r lane status id; do
    [ -n "$id" ] || continue
    base="$id"; while [[ "$base" == *[a-z] ]]; do base="${base%?}"; done   # strip suffix (pure bash — was sed/row, OPT r2-P2)
    case "|${_bc_cols[$base]:-}|"  in *"|$status|"*) : ;; *) _bc_cols[$base]="${_bc_cols[$base]:+${_bc_cols[$base]}|}$status" ;; esac
    case "|${_bc_fulls[$base]:-}|" in *"|$id|"*)     : ;; *) _bc_fulls[$base]="${_bc_fulls[$base]:+${_bc_fulls[$base]}|}$id" ;; esac
  done <<< "$rows"
  local b ncols nfull _s
  for b in "${!_bc_cols[@]}"; do
    # Count |-separated fields in pure bash (was 2 awk spawns/base ID — the
    # dominant ~26s pathology on a large board, OPT r2-P2): strip non-pipes,
    # field count = pipe count + 1.
    _s="${_bc_cols[$b]//[^|]/}";  ncols=$(( ${#_s} + 1 ))
    _s="${_bc_fulls[$b]//[^|]/}"; nfull=$(( ${#_s} + 1 ))
    if [ "${ncols:-0}" -gt 1 ] && [ "${nfull:-0}" -gt 1 ]; then
      add_finding "WARNING" "board-coherence" "TASKS.md: base task ID \`$b\` spans multiple lifecycle columns — entries [$(printf '%s' "${_bc_fulls[$b]}" | tr '|' ' ')] across [$(printf '%s' "${_bc_cols[$b]}" | tr '|' '/')]. A task can't be in two columns, and a suffixed sub-ID (\`${b}a\`) collides with its numeric parent in board tools. Fix: \`/board-heal\` renumbers suffixed IDs to distinct numeric IDs."
    fi
  done

  # --- Invariant 1: Verify tasks missing a seed (opt-in gated) ---
  # VERIFY ONLY — a task still queued in Ready-for-Test has NO seed by design:
  # the Tester emits the seed AND moves the task to Verify atomically, only on
  # PASS (commands/test.md, agents/framework/tester.md). Including Ready-for-Test
  # here false-positives on every healthy board AND would make /board-heal write
  # a premature approximated seed that, being WRITE-ONCE, permanently locks out
  # the Tester's authoritative one.
  if [ -d "$console_dir" ]; then
    local missing_seeds="" slc
    while IFS=$'\t' read -r lane status id; do
      [ -n "$id" ] || continue
      [ "$lane" = "feature" ] || continue
      slc="${status,,}"                                # bash lowercase (was tr/row)
      case "$slc" in verify) ;; *) continue ;; esac
      # Only a numeric-canonical id can have a seed file (contract:verify-handback).
      [[ "$id" =~ ^(TASK|BUG)-[0-9]+$ ]] || continue   # bash regex (was grep/row)
      [ -f "$verify_dir/$id.json" ] || missing_seeds="${missing_seeds:+$missing_seeds, }$id"
    done <<< "$rows"
    if [ -n "$missing_seeds" ]; then
      add_finding "WARNING" "board-coherence" "TASKS.md has Verify tasks with NO verify seed in .claude/console/verify/ — the Console renders the Verify tab from these seeds, so those stories are invisible there: $missing_seeds. Fix: run \`/board-heal\` to backfill a write-once seed per task."
    fi

    # --- Invariant 2: orphan seeds (seed with no board entry) ---
    if [ -d "$verify_dir" ]; then
      local board_ids orphans="" f sid
      board_ids=$(printf '%s\n' "$rows" | awk -F'\t' '$3!=""{print $3}')
      local _bids=$'\n'"$board_ids"$'\n'
      for f in "$verify_dir"/*.json; do
        [ -f "$f" ] || continue
        sid="${f##*/}"; sid="${sid%.json}"                       # pure-bash basename (was basename/seed)
        case "$_bids" in *$'\n'"$sid"$'\n'*) : ;; *) orphans="${orphans:+$orphans, }$sid" ;; esac  # membership (was grep/seed)
      done
      if [ -n "$orphans" ]; then
        add_finding "WARNING" "board-coherence" "Verify seeds exist in .claude/console/verify/ with no matching board entry in TASKS.md (a renamed/renumbered/deleted task leaves a stale story in the Verify tab): $orphans. Fix: run \`/board-heal\` to reconcile, or remove the stale seed."
      fi
    fi
  fi
}

# --- Check 16: State-file size budgets (OPT P3, TASK-139) ------------
# The missing half of the enforcement asymmetry: the Stop hook defends state
# FRESHNESS, but nothing defended state SIZE — so files grew unbounded until
# TASKS.md became "too large to include". This warns before that, never blocks.
check_state_budgets() {
  local conf="$PROJECT_ROOT/.claude/framework/doctor/state-budgets.conf"
  local override="$PROJECT_ROOT/.claude/state-budgets.local.conf"
  [ -f "$override" ] && conf="$override"
  [ -f "$conf" ] || return 0
  local line rel budget path sz pct
  while IFS= read -r line; do
    line="${line%$'\r'}"
    case "$line" in ''|'#'*) continue ;; esac
    rel="${line%%=*}"; budget="${line##*=}"
    case "$budget" in ''|*[!0-9]*) continue ;; esac
    [ "$budget" -gt 0 ] || continue
    path="$PROJECT_ROOT/$rel"
    [ -f "$path" ] || continue
    sz=$(wc -c < "$path" 2>/dev/null | tr -d ' '); case "$sz" in ''|*[!0-9]*) continue ;; esac
    pct=$(( sz * 100 / budget ))
    if [ "$pct" -ge 100 ]; then
      add_finding "CRITICAL" "state-budget" "\`$rel\` is ${sz}B, OVER its ${budget}B budget (${pct}%) — boot reads and board loading are at risk. Fix: run /housekeeping (\`bash .claude/framework/housekeeping/rotate-state.sh\`) to archive old entries."
    elif [ "$pct" -ge 80 ]; then
      add_finding "WARNING" "state-budget" "\`$rel\` is ${sz}B, ${pct}% of its ${budget}B budget — approaching the ceiling. Fix: run /housekeeping soon (\`bash .claude/framework/housekeeping/rotate-state.sh\`)."
    fi
  done < "$conf"
}

# --- Run all checks --------------------------------------------------
_DOCTOR_START=$(_dnow_ms)
_run check_hooks
_run check_cross_refs
_run check_claude_include
_run check_manifest_paths
_run check_framework_version
_run check_task_duplicates
_run check_detector_consumers
_run check_statusline
_run check_gnu_toolchain
_run check_state_file_leak
_run check_state_structure
_run check_reconcile_due
_run check_board_coherence
_run check_state_budgets

if [ "$DOCTOR_PROFILE" = 1 ]; then
  printf 'PROFILE %-26s %6s ms (total)\n' "ALL-CHECKS" "$(( $(_dnow_ms) - _DOCTOR_START ))" >&2
  exit 0
fi

# --- Write flag file if any findings ---------------------------------
if [ ${#findings[@]} -eq 0 ]; then
  exit 0
fi

# Sort findings by severity: CRITICAL first, WARNING next, INFO next, NAG last.
sorted_findings=()
for sev in CRITICAL WARNING INFO NAG; do
  for f in "${findings[@]}"; do
    [[ "$f" == "$sev|"* ]] && sorted_findings+=("$f")
  done
done

now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
crit_count=$(printf '%s\n' "${findings[@]}" | grep -c '^CRITICAL|' || true)
warn_count=$(printf '%s\n' "${findings[@]}" | grep -c '^WARNING|' || true)
info_count=$(printf '%s\n' "${findings[@]}" | grep -c '^INFO|' || true)
nag_count=$(printf '%s\n' "${findings[@]}" | grep -c '^NAG|' || true)

{
  echo "# Framework Doctor — Issues Detected"
  echo
  echo "**Scan time:** $now_iso"
  echo "**Findings:** $crit_count CRITICAL, $warn_count WARNING, $info_count INFO, $nag_count NAG"
  echo
  echo "## Findings"
  echo
  for f in "${sorted_findings[@]}"; do
    local_sev="${f%%|*}"
    rest="${f#*|}"
    check_name="${rest%%|*}"
    msg="${rest#*|}"
    echo "- **$local_sev** — [$check_name] $msg"
    echo
  done
  echo "## What to do"
  echo
  echo "CRITICAL findings should be resolved before continuing — they"
  echo "indicate broken framework state that will cause silent failures."
  echo
  echo "WARNING findings should be triaged; some may be intentional"
  echo "(e.g., a hook kept around but not wired yet)."
  echo
  echo "INFO findings are informational only — no action required unless"
  echo "a related feature is relevant to you."
  echo
  echo "NAG findings are cadence reminders, not broken state — run the"
  echo "named command when convenient; they will not resolve themselves"
  echo "on the next scan the way a fixed WARNING would."
  echo
  echo "To dismiss for this session: \`rm .claude/.framework-doctor-findings.md\`."
  echo "Doctor re-scans on every cold start (no throttle — state issues"
  echo "don't get less broken over time)."
} > "$FLAG_FILE"

echo "doctor: ${#findings[@]} finding(s) ($crit_count CRITICAL, $warn_count WARNING, $info_count INFO, $nag_count NAG) — see $FLAG_FILE"
exit 0
