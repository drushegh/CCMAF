#!/usr/bin/env bash
# migrate-v2.sh — one-shot v1 → v2 consumer crossover (TASK-166).
#
# CCMAF v2 ships as plugins from the `ccmaf` marketplace (kernel = safety
# floor, ccmaf = core, plus capability siblings). This script retires the
# bundled v1 copies from a consumer project and flips it to the v2 line.
# Design: docs/tiering/DESIGN.md "The migration bridge" (two-release
# ladder) + CORE-DESIGN.md §1/§7 in the framework dev repo.
# Reviewed 2026-08-21 (fable + sol panel — _advisors/migrate-bridge-review).
#
# What it does, in order (each step gated on the previous):
#   0. Preflight — refuse on: framework dev repo, not a git repo, dirty
#      working tree (git IS the undo mechanism; tombstone present = resume),
#      missing/unsafe retired-paths.txt. Already-v2 → no-op, or FINALIZE an
#      interrupted run (v2 line written but update/ still present or
#      uncommitted).
#   1. --dry-run exits here with the full plan (no plugin floor needed —
#      this is the "show the plan" path for people DECIDING to migrate).
#   2. Plugin gate — verify ccmaf-kernel AND ccmaf are installed+enabled
#      via `claude plugin list --json`. FAIL-SAFE: no verified kernel →
#      nothing is deleted (the bundled guard stays). Prints usage-detected
#      sibling suggestions.
#   3. Confirm (tty-guarded), then create the tombstone header FIRST —
#      every later crash window lands in the resume path.
#   4. settings.json + settings.local.json rewrite — strip hook
#      registrations + permission entries referencing retired paths
#      (path-boundary matching, not raw substrings), retarget statusLine,
#      atomic replace, VALIDATE before anything is deleted.
#   5. Tombstone every retired path (present or not), move statusline to
#      .claude/statusline.sh, comment out CLAUDE.md's dangling
#      @CLAUDE.framework.md import, delete retired paths — update/ (this
#      script's own dir) deliberately deferred.
#   6. Write the v2 line (FRAMEWORK_LINE=v2 + SCAFFOLD_REV=1) — atomic
#      rewrite, existing fields preserved, duplicate keys upserted.
#   7. Delete .claude/framework/update/ (self-delete, the final destructive
#      act) and commit the whole migration as ONE revertible commit.
#
# After it finishes: RESTART the session, then run /ccmaf:init — its
# missing-piece flow scaffolds the bare command aliases (/build, /plan, …).
#
# Flags: --dry-run (print the full plan, change nothing) · --yes (skip the
# confirmation prompt; REQUIRED when stdin is not a tty) · --no-commit
# (stage the migration, let the human make the commit).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
RETIRED_LIST="$SCRIPT_DIR/retired-paths.txt"
TOMBSTONE="$PROJECT_ROOT/.claude/.migrate-v2-tombstone"
FRAMEWORK_VERSION_FILE="$PROJECT_ROOT/.claude/.framework-version"

DRY=0; YES=0; NO_COMMIT=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY=1 ;;
    --yes)       YES=1 ;;
    --no-commit) NO_COMMIT=1 ;;
    *) echo "migrate-v2: unknown flag '$arg' (known: --dry-run --yes --no-commit)" >&2; exit 2 ;;
  esac
done

say()  { echo "migrate-v2: $*"; }
fail() { echo "migrate-v2: ERROR — $1" >&2; exit "${2:-2}"; }

# python resolution with a RUN-probe — `command -v` alone accepts the
# Windows Store python.exe app-execution alias, which resolves on PATH but
# exits non-zero without running anything (the kernel guard-wrapper's
# documented class). Probe each candidate with a real execution.
PYBIN=""
for cand in python3 python py; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c 'import sys' >/dev/null 2>&1; then
    PYBIN="$cand"; break
  fi
done
[ -n "$PYBIN" ] || fail "no working python interpreter found (python3/python/py all absent or stubs) — needed for the settings.json rewrite. Install Python, then re-run."

_has_v2_line() {
  [ -f "$FRAMEWORK_VERSION_FILE" ] \
    && grep -Eq '^[[:space:]]*FRAMEWORK_LINE=v2[[:space:]]*$' "$FRAMEWORK_VERSION_FILE"
}

_tombstone_add() {
  if [ ! -f "$TOMBSTONE" ]; then
    {
      echo "# CCMAF v2 migration tombstone — paths retired by migrate-v2.sh."
      echo "# Existence of this file = the migration has BEGUN; it is the"
      echo "# migration marker the v2 updater's drop-refusal gate requires."
      echo "# The v2 updater never resurrects or re-prunes a path listed here."
      echo "# Grammar = framework-manifest.txt (trailing slash = directory)."
    } > "$TOMBSTONE"
  fi
  grep -qxF "$1" "$TOMBSTONE" 2>/dev/null || echo "$1" >> "$TOMBSTONE"
}

# Optional sibling plugins — ONE paste-able block, never auto-installed.
# Ids MUST match marketplace.json plugin names: siblings are UNPREFIXED
# (only ccmaf / ccmaf-kernel carry the prefix) — FS-005. Installs are
# user-scope (machine-level) and inert until used, so pasting the whole
# block is safe; the notes flag what THIS project was detected using.
print_sibling_block() {
  local adv_note="fable/sol/terra/luna advisor workbench (needs the codex CLI)"
  local con_note="bridge to the ccmaf-console web dashboard (npm server, project opt-in)"
  if [ -f "$PROJECT_ROOT/.claude/advisors.toml" ]; then
    adv_note="DETECTED IN USE: this project has an advisor registry (.claude/advisors.toml)"
  fi
  if [ -f "$PROJECT_ROOT/.claude/.console-version" ] || [ -f "$PROJECT_ROOT/.claude/.console-enabled" ]; then
    con_note="DETECTED IN USE: this project is Console-opted-in; tools/console.mjs is being retired"
  fi
  echo ""
  say "optional sibling plugins — paste the whole block in any terminal (user-scope; unused ones stay inert):"
  echo "    claude plugin install devhooks@ccmaf --scope user   # format/lint/test-QoL hooks v1 always ran (recommended)"
  echo "    claude plugin install advisors@ccmaf --scope user   # $adv_note"
  echo "    claude plugin install council@ccmaf --scope user    # /council five-advisor deliberations"
  echo "    claude plugin install media@ccmaf --scope user      # /image generation (needs the codex CLI)"
  echo "    claude plugin install console@ccmaf --scope user    # $con_note"
  echo ""
}

# --- Step 0: preflight ------------------------------------------------
[ -f "$PROJECT_ROOT/.claude/.framework-dev-repo" ] \
  && fail "this is the framework's own dev repo — it never migrates (it IS the upstream)."

git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || fail "not a git repository. The migration's undo mechanism is git — init/commit the project first."
git -C "$PROJECT_ROOT" rev-parse --verify -q HEAD >/dev/null 2>&1 \
  || fail "repository has no commits yet — make an initial commit first (git is the undo mechanism)."

# Hardened dirty check: a git-status FAILURE must refuse, never read as clean.
status_out="$(git -C "$PROJECT_ROOT" status --porcelain)" \
  || fail "git status failed — refusing to run destructive work without a working undo mechanism."

if _has_v2_line; then
  if [ -f "$TOMBSTONE" ] && { [ -d "$PROJECT_ROOT/.claude/framework/update" ] || [ -n "$status_out" ]; }; then
    if [ "$DRY" = 1 ]; then
      say "DRY RUN — an interrupted migration would be FINALIZED (delete update/, commit). No changes made."
      exit 0
    fi
    say "FINALIZE: v2 line present but the migration did not finish (update/ still on disk and/or uncommitted changes)."
    FINALIZE=1
  else
    say "already on the v2 line (FRAMEWORK_LINE=v2 present) — nothing to migrate."
    exit 0
  fi
else
  FINALIZE=0
fi

# (Checked AFTER the already-v2 branch, and not at all in FINALIZE mode —
# a completed/finalizing migration has legitimately deleted the list.)
if [ "$FINALIZE" = 0 ]; then
  [ -f "$RETIRED_LIST" ] || fail "retired-paths.txt not found beside this script — corrupt v2.0 update?"
fi

if [ -n "$status_out" ] && [ "$FINALIZE" = 0 ]; then
  if [ -f "$TOMBSTONE" ]; then
    # Tombstone + dirty tree = an interrupted earlier run. Resuming IS the
    # fix — every step is idempotent and the final commit sweeps the whole
    # migration into one revert unit. NOTE: any unrelated edits made since
    # the interruption will be swept into that migration commit too.
    say "RESUME: tombstone found with a dirty tree — continuing the interrupted migration."
    say "  (any unrelated uncommitted edits will land in the migration commit — abort now if that matters)"
  elif [ "$DRY" = 1 ]; then
    say "note: working tree is dirty — a real run will refuse until it is clean."
  else
    fail "working tree is not clean. Commit or stash everything first — the migration must be one revertible commit."
  fi
fi

# Parse + validate the retired list. Same escape-guard arms as
# apply-update.sh's _is_unsafe_manifest_path (absolute, parent-escape,
# tilde, drive-letter, backslash, empty).
_is_unsafe_path() {  # <path> → 0 (true) if unsafe
  case "$1" in
    /*|*..*|*'~'*|[A-Za-z]:*|*\\*|'') return 0 ;;
  esac
  return 1
}
retired_dirs=(); retired_files=(); ordered_dirs=()
if [ "$FINALIZE" = 0 ]; then
  while IFS= read -r line; do
    line="${line%$'\r'}"
    # Trim surrounding whitespace so the bash and python parsers agree.
    line="${line#"${line%%[![:space:]]*}"}"; line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    if _is_unsafe_path "${line%/}"; then
      fail "retired-paths.txt entry escapes the project root: '$line'. Refusing before touching anything."
    fi
    if [[ "$line" == */ ]]; then retired_dirs+=("${line%/}"); else retired_files+=("$line"); fi
  done < "$RETIRED_LIST"
  [ ${#retired_dirs[@]} -gt 0 ] || fail "retired-paths.txt lists no directories — corrupt list?"

  # Deletion order: everything else first; .claude/framework/update (this
  # script's own directory) is REMOVED from the general pass and handled as
  # the provably-final destructive action, AFTER the v2 line is written —
  # so every crash window before it still has this script on disk to resume.
  for d in "${retired_dirs[@]}"; do
    [ "$d" = ".claude/framework/update" ] || ordered_dirs+=("$d")
  done
fi

# --- Step 1: dry run (BEFORE the plugin gate — the "show the plan" path
# must work on machines still deciding whether to install anything) ------
if [ "$DRY" = 1 ] && [ "$FINALIZE" = 0 ]; then
  say "DRY RUN — would delete:"
  for f in "${retired_files[@]}"; do [ -e "$PROJECT_ROOT/$f" ] && echo "    $f"; done
  for d in "${ordered_dirs[@]}"; do [ -e "$PROJECT_ROOT/$d" ] && echo "    $d/ (recursive)"; done
  [ -d "$PROJECT_ROOT/.claude/framework/update" ] && echo "    .claude/framework/update/ (recursive, last — self-delete)"
  [ -f "$PROJECT_ROOT/.claude/hooks/statusline.sh" ] && echo "    (move) .claude/hooks/statusline.sh → .claude/statusline.sh"
  echo "    (rewrite) .claude/settings.json (+ settings.local.json if present): strip retired hook/permission refs, retarget statusLine"
  echo "    (rewrite) .claude/.framework-version: FRAMEWORK_LINE=v2 + SCAFFOLD_REV=1"
  [ -f "$PROJECT_ROOT/CLAUDE.md" ] && grep -q "@CLAUDE.framework.md" "$PROJECT_ROOT/CLAUDE.md" 2>/dev/null \
    && echo "    (rewrite) CLAUDE.md: comment out the @CLAUDE.framework.md import"
  say "DRY RUN — no changes made. Plugin-floor check is skipped in dry-run; a real run requires ccmaf-kernel + ccmaf installed."
  exit 0
fi

# --- Step 2: plugin gate (FAIL-SAFE — guard is never orphaned) --------
if [ "$FINALIZE" = 0 ]; then
  say "checking the plugin floor (ccmaf-kernel + ccmaf) ..."
  plugin_json=""
  if command -v claude >/dev/null 2>&1; then
    if command -v timeout >/dev/null 2>&1; then
      plugin_json="$(timeout 20 claude plugin list --json 2>/dev/null || true)"
    else
      plugin_json="$(claude plugin list --json 2>/dev/null || true)"
    fi
  fi

  _plugin_active() {  # <name> → 0 if installed AND enabled per the probe output
    [ -n "$plugin_json" ] || return 1
    # JSON travels via env, not stdin — `python -` already consumes stdin
    # for the program text. Pessimistic on shape: enabled must be literal
    # true; malformed entries are ignored, not trusted.
    PLUGIN_JSON="$plugin_json" "$PYBIN" - "$1" <<'PYEOF'
import json, os, sys
name = sys.argv[1]
try:
    plugins = json.loads(os.environ.get("PLUGIN_JSON", ""))
except Exception:
    sys.exit(1)
if isinstance(plugins, dict):  # tolerate {"plugins": [...]} wrappers
    plugins = plugins.get("plugins", [])
if not isinstance(plugins, list):
    sys.exit(1)
for p in plugins:
    if not isinstance(p, dict):
        continue
    pid = str(p.get("id", p.get("name", "")))
    if (pid == name or pid.startswith(name + "@")) and p.get("enabled") is True:
        sys.exit(0)
sys.exit(1)
PYEOF
  }

  missing=()
  _plugin_active "ccmaf-kernel" || missing+=("ccmaf-kernel")
  _plugin_active "ccmaf"        || missing+=("ccmaf")
  if [ ${#missing[@]} -gt 0 ]; then
    echo "migrate-v2: REFUSING — cannot verify these plugins are installed + enabled: ${missing[*]}" >&2
    echo "" >&2
    echo "  The migration deletes the bundled dangerous-command guard and every bundled" >&2
    echo "  command/hook; their plugin replacements MUST be active first (fail-safe)." >&2
    echo "  (If they ARE installed, the probe itself failed — check that the \`claude\`" >&2
    echo "  CLI runs and that \`claude plugin list --json\` works in this shell.)" >&2
    echo "" >&2
    echo "  Install them, restart the session, then re-run this script:" >&2
    echo "    claude plugin marketplace add drushegh/CCMAF" >&2
    echo "    claude plugin install ccmaf-kernel@ccmaf --scope user   # the safety floor" >&2
    echo "    claude plugin install ccmaf@ccmaf --scope user          # the core" >&2
    exit 4
  fi
  say "plugin floor verified: ccmaf-kernel + ccmaf active."

  print_sibling_block


  # Ignored/untracked content under retired dirs is OUTSIDE git's undo
  # reach — surface it before the human confirms. (Framework-owned dirs
  # were always replaced wholesale by the v1 updater, so anything here was
  # already living dangerously — but say it, don't assume it.)
  ignored_hits="$(git -C "$PROJECT_ROOT" status --ignored --porcelain -- "${ordered_dirs[@]}" ".claude/framework/update" 2>/dev/null | grep '^!!' | head -10 || true)"
  if [ -n "$ignored_hits" ]; then
    say "WARNING — git-IGNORED content exists under retired directories; deletion is NOT undoable by git revert:"
    printf '%s\n' "$ignored_hits" | sed 's/^!!/    /'
    say "  Copy anything you need out of these paths before confirming."
  fi

  # --- Step 3: confirm (tty-guarded), then arm the resume path ----------
  say "plan: tombstone → rewrite settings → move statusline → delete ${#retired_files[@]} files + $(( ${#ordered_dirs[@]} + 1 )) dirs → v2 line → self-delete update/ → one commit."
  if [ "$YES" != 1 ]; then
    if [ ! -t 0 ]; then
      fail "non-interactive session without --yes — refusing (nothing changed). Re-run with --yes." 4
    fi
    printf 'migrate-v2: proceed? Type "migrate" to continue: '
    read -r reply
    [ "$reply" = "migrate" ] || fail "aborted by user (nothing changed)." 4
  fi

  # Arm the resume path BEFORE the first mutation: a header-only tombstone
  # is harmless to the updater (comments → zero exclusions) and routes
  # every later crash window into RESUME instead of the generic refusal.
  _tombstone_add ".claude/framework/update/"

  # --- Step 4: settings rewrite (validate + atomic, BEFORE any deletion) -
  for sf in "$PROJECT_ROOT/.claude/settings.json" "$PROJECT_ROOT/.claude/settings.local.json"; do
    [ -f "$sf" ] || continue
    say "rewriting ${sf#"$PROJECT_ROOT"/} (strip retired hook/permission refs, retarget statusLine) ..."
    "$PYBIN" - "$sf" "$RETIRED_LIST" <<'PYEOF'
import json, os, re, sys

settings_path, retired_path = sys.argv[1], sys.argv[2]

retired = []
with open(retired_path, encoding="utf-8") as f:
    for line in f:
        line = line.strip().rstrip("\r").strip()
        if not line or line.startswith("#"):
            continue
        retired.append(line.rstrip("/"))
retired.append(".claude/hooks/statusline.sh")  # moved, old path is dead

# Path-BOUNDARY matching, not raw substrings: the retired path must not be
# followed by a path-continuation character, so `.claude/commands/test.md`
# never matches a consumer's `.claude/commands/test.md.backup`, while a
# retired DIR still matches its children (`/` is a boundary char).
patterns = [re.compile(re.escape(r) + r"(?![A-Za-z0-9._-])") for r in retired]

def refs_retired(s):
    s = str(s).replace("\\", "/")
    return any(p.search(s) for p in patterns)

with open(settings_path, encoding="utf-8") as f:
    data = json.load(f)

stripped_hooks = 0
hooks = data.get("hooks")
if isinstance(hooks, dict):
    for event in list(hooks.keys()):
        groups = hooks[event]
        if not isinstance(groups, list):
            continue
        new_groups = []
        for g in groups:
            inner = g.get("hooks") if isinstance(g, dict) else None
            if isinstance(inner, list):
                kept = [h for h in inner if not refs_retired(h.get("command", ""))]
                stripped_hooks += len(inner) - len(kept)
                if kept:
                    g["hooks"] = kept
                    new_groups.append(g)
            else:
                new_groups.append(g)
        if new_groups:
            hooks[event] = new_groups
        else:
            del hooks[event]
    if not hooks:
        del data["hooks"]

stripped_perms = 0
perms = data.get("permissions")
if isinstance(perms, dict):
    for key in ("allow", "ask", "deny"):
        vals = perms.get(key)
        if isinstance(vals, list):
            kept = [v for v in vals if not refs_retired(v)]
            stripped_perms += len(vals) - len(kept)
            perms[key] = kept

# statusLine: retarget ONLY the retired path token (both separator
# spellings) — never normalise the rest of the command string.
sl = data.get("statusLine")
if isinstance(sl, dict) and isinstance(sl.get("command"), str):
    cmd = sl["command"]
    for old in (".claude/hooks/statusline.sh", ".claude\\hooks\\statusline.sh"):
        cmd = cmd.replace(old, ".claude/statusline.sh")
    sl["command"] = cmd

out = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
json.loads(out)  # validate the exact bytes we are about to persist
tmp = settings_path + ".migrate-tmp"
with open(tmp, "w", encoding="utf-8", newline="\n") as f:
    f.write(out)
os.replace(tmp, settings_path)  # atomic — no truncate-then-die window
print(f"migrate-v2:   {os.path.basename(settings_path)} — stripped {stripped_hooks} hook registration(s), "
      f"{stripped_perms} permission entry/entries; statusLine retargeted where present.")
PYEOF
  done
  [ -f "$PROJECT_ROOT/.claude/settings.json" ] \
    || say "no .claude/settings.json — skipping the rewrite (nothing registered the v1 hooks here)."

  # --- Step 5: statusline move, CLAUDE.md import, deletions -------------
  if [ -f "$PROJECT_ROOT/.claude/hooks/statusline.sh" ]; then
    _tombstone_add ".claude/hooks/statusline.sh"
    if [ -e "$PROJECT_ROOT/.claude/statusline.sh" ]; then
      # Consumer already owns a .claude/statusline.sh — theirs wins.
      rm -f "$PROJECT_ROOT/.claude/hooks/statusline.sh"
      say "  .claude/statusline.sh already exists (kept); retired the hook copy."
    else
      mv "$PROJECT_ROOT/.claude/hooks/statusline.sh" "$PROJECT_ROOT/.claude/statusline.sh"
      say "  moved .claude/hooks/statusline.sh → .claude/statusline.sh"
    fi
  fi

  # CLAUDE.framework.md is retired below; CLAUDE.md's @import of it would
  # dangle forever (/ccmaf:init never edits an existing CLAUDE.md).
  if [ -f "$PROJECT_ROOT/CLAUDE.md" ] && grep -q "@CLAUDE\.framework\.md" "$PROJECT_ROOT/CLAUDE.md"; then
    "$PYBIN" - "$PROJECT_ROOT/CLAUDE.md" <<'PYEOF'
import os, sys
p = sys.argv[1]
with open(p, encoding="utf-8") as f:
    lines = f.read().split("\n")
out = []
for l in lines:
    if "@CLAUDE.framework.md" in l and not l.lstrip().startswith("<!--"):
        out.append("<!-- retired by migrate-v2: @CLAUDE.framework.md import — always-on rules now live in the ccmaf plugin digest -->")
    else:
        out.append(l)
tmp = p + ".migrate-tmp"
with open(tmp, "w", encoding="utf-8", newline="\n") as f:
    f.write("\n".join(out))
os.replace(tmp, p)
print("migrate-v2:   CLAUDE.md — commented out the @CLAUDE.framework.md import.")
PYEOF
  fi

  # Tombstone EVERY retired path — present or already absent — so the
  # tombstone is the canonical retirement set, then delete what exists.
  deleted=0
  for f in "${retired_files[@]}"; do
    _tombstone_add "$f"
    if [ -e "$PROJECT_ROOT/$f" ]; then
      # A file entry that exists as a directory on disk still retires.
      if [ -d "$PROJECT_ROOT/$f" ]; then rm -rf "${PROJECT_ROOT:?}/${f:?}"; else rm -f "${PROJECT_ROOT:?}/${f:?}"; fi
      deleted=$((deleted + 1))
    fi
  done
  for d in "${ordered_dirs[@]}"; do
    _tombstone_add "$d/"
    if [ -e "$PROJECT_ROOT/$d" ]; then
      rm -rf "${PROJECT_ROOT:?}/${d:?}"
      deleted=$((deleted + 1))
    fi
  done
  say "deleted $deleted retired path(s); tombstone records the full retirement set."

  # --- Step 6: the activation switch — the v2 line ----------------------
  # Atomic rewrite (build + rename), upserting the two keys so no duplicate
  # or partially-written state can read as migrated.
  fv_tmp="$FRAMEWORK_VERSION_FILE.migrate-tmp"
  mkdir -p "$PROJECT_ROOT/.claude"
  {
    if [ -f "$FRAMEWORK_VERSION_FILE" ]; then
      grep -Ev '^[[:space:]]*(FRAMEWORK_LINE|SCAFFOLD_REV)=' "$FRAMEWORK_VERSION_FILE" || true
    else
      echo "# CCMAF framework version (v2 line — written by migrate-v2.sh)"
    fi
    echo ""
    echo "# --- v2 line (written by migrate-v2.sh $(date -u +%Y-%m-%dT%H:%M:%SZ)) ---"
    echo "FRAMEWORK_LINE=v2"
    echo "SCAFFOLD_REV=1"
  } > "$fv_tmp"
  mv -f "$fv_tmp" "$FRAMEWORK_VERSION_FILE"
  say "v2 line written (FRAMEWORK_LINE=v2, SCAFFOLD_REV=1)."
fi  # end of the non-FINALIZE path

# --- Step 7: self-delete update/ (final destructive act) + commit ------
if [ -d "$PROJECT_ROOT/.claude/framework/update" ]; then
  _tombstone_add ".claude/framework/update/"
  rm -rf "${PROJECT_ROOT:?}/.claude/framework/update"
  say "retired .claude/framework/update/ (this script's own directory — the final deletion)."
fi

git -C "$PROJECT_ROOT" add -A
if [ -z "$(git -C "$PROJECT_ROOT" status --porcelain)" ]; then
  # A finalize run whose only work was deleting never-committed strays can
  # end on an already-clean tree — success, nothing left to commit.
  say "tree is clean — nothing left to commit."
elif [ "$NO_COMMIT" = 1 ]; then
  say "--no-commit: the full migration is STAGED — review with 'git diff --cached', then commit it as ONE commit."
else
  git -C "$PROJECT_ROOT" commit -q -m "chore: migrate to CCMAF v2 (plugins) — retire bundled v1 copies (migrate-v2.sh)" \
    || fail "git commit failed — the tree still holds the migration; commit manually as one commit." 5
  commit_sha="$(git -C "$PROJECT_ROOT" rev-parse --short HEAD)"
  say "committed as $commit_sha. Revert with: git revert $commit_sha"
fi

echo ""
say "DONE. Next steps:"
echo "  1. CLOSE AND REOPEN whatever hosts this Claude Code session — the VS Code"
echo "     window, the terminal, the app. That IS the 'restart'; nothing else is."
echo "     ⚠ Until then, further Bash calls in THIS session may be DENIED by the"
echo "     stale guard-hook registration (it points at a deleted file and fails"
echo "     closed). Expected — do NOT try to fix or revert it; just close and reopen."
echo "  2. In the new session, tell Claude: 'migration done — finish the setup'."
echo "     Claude runs /ccmaf:init ITSELF (it is a plugin command Claude can invoke);"
echo "     its missing-piece flow scaffolds the bare command aliases (/build, /plan,"
echo "     …) and anything else absent. You never run /ccmaf:init by hand."
echo "  3. Optional: paste the sibling-plugin block below (any terminal, any time)."
echo "  4. Deleted v1 files (including any you had customised) remain in git"
echo "     history: git show '<commit>^:<path>' recovers any of them."
print_sibling_block
