#!/usr/bin/env bash
# verify-deps.sh — PostToolUse hook for dependency hallucination defense.
#
# Trigger: Write|Edit|MultiEdit on a dependency manifest (package.json,
# pyproject.toml, requirements.txt, requirements-*.txt, Cargo.toml,
# *.csproj, go.mod).
#
# Behaviour:
#   1. Diff the file against its committed version to find newly added
#      dependency names + versions.
#   2. For supported ecosystems (npm, PyPI), best-effort registry ping
#      with a short timeout to verify each new package exists.
#   3. Findings (unverifiable packages, registry misses, or unsupported
#      ecosystems flagged for manual review) are written to
#      `.claude/.dep-verification-issues.md` for the cold start / next
#      agent turn to surface.
#   4. Always exits 0 — this hook informs, it doesn't block.
#
# Opt-out: set CLAUDE_DEP_VERIFY=0 to skip network checks (detection still
# runs and a "manual verification needed" entry is written). On hosts
# without curl or with no network reach, network checks degrade to the
# same outcome silently.
#
# Retro-audit mode: set VERIFY_DEPS_RETRO=1 to treat the whole manifest
# as if every dependency were newly added (skips the git-diff stage).
# Use this to bulk-audit existing manifests on a project that pre-dates
# this hook — see .claude/framework/docs/RETRO-AUDIT.md for the driver.
#
# Rationale: package hallucination is the single most-reported AI
# failure mode in current research (commercial-model rates ≥5.2%,
# open-source ≥21.7%; >205k unique hallucinated package names observed).
# A best-effort registry check on every manifest write catches a
# meaningful fraction of slopsquatting / fabricated-package risks for
# zero cognitive overhead.

set -euo pipefail

# Dispatcher fast path (TASK-035): see post-edit-dispatch.sh. Presence of
# CLAUDE_POSTEDIT_FILE (even empty) = trust it, skip stdin/jq/normalize.
_dispatched=0
if [ -n "${CLAUDE_POSTEDIT_FILE+x}" ]; then
  _dispatched=1
  file="$CLAUDE_POSTEDIT_FILE"
else
  input=$(cat)
fi

# --- Profile / opt-out gate (TASK-011) -------------------------------
_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/hook-common.sh"
[ -f "$_lib" ] && . "$_lib"
command -v hook_enabled >/dev/null 2>&1 && { hook_enabled verify-deps normal || exit 0; }

# --- Tool input parsing ----------------------------------------------
if [ "$_dispatched" = "0" ]; then
  if ! command -v jq >/dev/null 2>&1; then
    exit 0  # No jq → can't parse input. Silent no-op (consistent with other hooks).
  fi
  # `|| true` is load-bearing: under `set -euo pipefail`, jq exits non-zero on
  # a non-JSON event payload, which would otherwise abort the hook with jq's
  # code (not fail-open). Swallow it → empty file → clean exit 0.
  # One jq spawn: file path + telemetry correlation ids (contract:telemetry-schema).
  _sid="" _tuid="" file=""
  {
    IFS= read -r _sid
    IFS= read -r _tuid
    IFS= read -r file
  } < <(echo "$input" | jq -r '(.session_id // ""), (.tool_use_id // ""), (.tool_input.file_path // .tool_input.path // "")' 2>/dev/null) || true
  # git-bash jq emits CRLF on -r; `read` keeps the \r — strip it.
  export CLAUDE_HOOK_SESSION_ID="${_sid%$'\r'}"
  export CLAUDE_HOOK_TOOL_USE_ID="${_tuid%$'\r'}"
fi
[ -z "$file" ] && exit 0

# Normalise to repo-relative path. normalize_tool_path (hook-common.sh)
# converts Windows-native F:\x paths to /f/x first — without it the /*
# branch never matched on Windows and the hook was a silent no-op (DA-H1).
# Dispatcher path arrives pre-normalized.
if [ "$_dispatched" = "0" ]; then
  command -v normalize_tool_path >/dev/null 2>&1 && file=$(normalize_tool_path "$file")
fi
if [ -n "${CLAUDE_POSTEDIT_ROOT:-}" ]; then
  PROJECT_ROOT="$CLAUDE_POSTEDIT_ROOT"
else
  PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
fi
# Normalise PROJECT_ROOT to the same POSIX form as $file (DA-H1 class,
# mirrors node_project_dir_for in hook-common.sh): git rev-parse
# --show-toplevel and CLAUDE_POSTEDIT_ROOT can both come back as a
# drive-colon Windows path (C:/...) while $file is always normalized to
# /c/... above. Without this, the prefix-strip below never matches on
# Windows and rel_path silently stays the full absolute path — a
# same-repo garbage double-path once re-joined with PROJECT_ROOT further
# down, which makes the untracked-manifest branch a silent no-op.
command -v normalize_tool_path >/dev/null 2>&1 && PROJECT_ROOT=$(normalize_tool_path "$PROJECT_ROOT")
case "$file" in
  /*) rel_path="${file#$PROJECT_ROOT/}" ;;
  *)  rel_path="$file" ;;
esac

# --- File-type filter ------------------------------------------------
basename=$(basename "$rel_path")
ecosystem=""
case "$basename" in
  package.json)        ecosystem="npm" ;;
  pyproject.toml)      ecosystem="pypi" ;;
  requirements.txt)    ecosystem="pypi" ;;
  requirements-*.txt)  ecosystem="pypi" ;;
  Cargo.toml)          ecosystem="cargo" ;;
  go.mod)              ecosystem="go" ;;
  *.csproj)            ecosystem="nuget" ;;
esac
[ -z "$ecosystem" ] && exit 0

# --- Telemetry helper ------------------------------------------------
# Schema-v2 emit via hook-common.sh (contract:telemetry-schema). Lib
# absent → no event; telemetry is best-effort, dep verification never is.
# $ecosystem is a fixed enum from the case table above — safe to inline.
_log_event() {
  local outcome="$1"
  command -v telemetry_emit >/dev/null 2>&1 || return 0
  local class="ok"; [ "$outcome" = "findings" ] && class="flagged"
  telemetry_emit "$PROJECT_ROOT" "verify-deps" "$outcome" "$class" ",\"ecosystem\":\"$ecosystem\""
}

# --- Findings sink ---------------------------------------------------
FINDINGS_FILE="$PROJECT_ROOT/.claude/.dep-verification-issues.md"
findings=()
add_finding() { findings+=("$1"); }

# --- Diff extraction --------------------------------------------------
# Get added lines from the most recent change. For a tracked file, this
# is diff against HEAD. For a new file not yet committed, treat all
# non-blank lines as added. In retro-audit mode (VERIFY_DEPS_RETRO=1),
# always treat the whole file as added so every dep gets checked.
get_added_lines() {
  # tr -d '\r': manifests authored on Windows are often CRLF; without the
  # strip, requirements-style versions capture a trailing \r that leaks
  # into findings text. \r is never legitimate in a dep name/version.
  if [ "${VERIFY_DEPS_RETRO:-0}" = "1" ]; then
    cat "$PROJECT_ROOT/$rel_path" 2>/dev/null | tr -d '\r'
    return
  fi
  if git -C "$PROJECT_ROOT" ls-files --error-unmatch -- "$rel_path" >/dev/null 2>&1; then
    # `|| true` guards the no-added-lines case: under pipefail, grep's
    # exit 1 on no match otherwise kills the subshell (DA-H7 — the
    # repo's thrice-shipped set -e/grep bug class).
    git -C "$PROJECT_ROOT" diff HEAD -- "$rel_path" 2>/dev/null \
      | { grep -E '^\+[^+]' || true; } | sed 's/^+//' | tr -d '\r'
  else
    cat "$PROJECT_ROOT/$rel_path" 2>/dev/null | tr -d '\r'
  fi
}

# --- Per-ecosystem dependency extraction -----------------------------
# Each emits one "name|version" per line for newly-added deps.
extract_npm() {
  # package.json — extract added "name": "version" pairs, then keep ONLY the
  # ones that actually live in a dependency section of the working file.
  #
  # The diff grep alone cannot tell a dependency line from a "scripts" /
  # "engines" / config entry — all share the `"k": "v"` shape — so it used to
  # fire bogus registry lookups for script names ("build", "lint", …). Scope
  # to the real dependency sections with jq: intersect the diff's candidate
  # names against the keys under dependencies / devDependencies /
  # peerDependencies / optionalDependencies. If jq is unavailable or the file
  # does not parse (a mid-edit / invalid JSON), fall back to the old
  # exclusion-list filter so detection still degrades gracefully.
  local candidates depnames="" manifest
  candidates=$(get_added_lines \
    | grep -oE '"[a-zA-Z0-9_./@-]+"[[:space:]]*:[[:space:]]*"[^"]+"' \
    | sed -E 's/"([^"]+)"[[:space:]]*:[[:space:]]*"([^"]+)"/\1|\2/') || true
  [ -z "$candidates" ] && return 0
  # Resolve the manifest to a path that actually exists on disk for jq:
  # $PROJECT_ROOT/$rel_path in the normal case, but if the repo-relative
  # strip did not apply (a POSIX-vs-Windows path-form mismatch left rel_path
  # absolute — the DA-H1 class), fall back to the already-normalised absolute
  # $file. If neither resolves, depnames stays empty → exclusion-list fallback.
  manifest="$PROJECT_ROOT/$rel_path"
  [ -f "$manifest" ] || manifest="$file"
  if command -v jq >/dev/null 2>&1 && [ -f "$manifest" ]; then
    # tr -d '\r': git-bash jq emits CRLF on -r, so each key would carry a
    # trailing \r while the candidate names (get_added_lines already strips
    # \r) do not — the intersection would then silently drop every dep.
    depnames=$(jq -r '
        (.dependencies // {}) + (.devDependencies // {})
        + (.peerDependencies // {}) + (.optionalDependencies // {})
        | keys[]' "$manifest" 2>/dev/null | tr -d '\r' | sort -u) || true
  fi
  if [ -n "$depnames" ]; then
    printf '%s\n' "$candidates" | awk -F'|' -v names="$depnames" '
      BEGIN { n = split(names, a, "\n"); for (i = 1; i <= n; i++) keep[a[i]] = 1 }
      $1 != "" && ($1 in keep) { print }
    ' | sort -u
  else
    printf '%s\n' "$candidates" \
      | grep -vE '^(name|version|description|main|module|types|license|author|repository|homepage|scripts|engines|keywords|funding|bugs|contributors|volta|resolutions|overrides|peerDependenciesMeta|files|bin|browser|exports|publishConfig|workspaces|packageManager|type|private|sideEffects)\|' \
      | sort -u || true
  fi
}

extract_pypi() {
  # pyproject.toml / requirements.txt — extract package names.
  # pyproject: lines like `"requests>=2.0"` or `requests = "^2.0"` in a deps array/table.
  # requirements.txt: `package==1.2.3` or `package>=1.0` per line.
  get_added_lines | awk '
    # Strip comments and trim whitespace
    { sub(/[ \t]*#.*$/, ""); gsub(/^[ \t]+|[ \t]+$/, "") }
    # requirements.txt style:  name==version  or  name>=version  or just `name`
    /^[a-zA-Z0-9_.-]+[[:space:]]*[<>=!~]/ {
      n=$0; sub(/[[:space:]]*[<>=!~].*$/, "", n)
      v=$0; sub(/^[^<>=!~]*/, "", v); gsub(/^[<>=!~ ]+/, "", v)
      print n "|" v; next
    }
    # pyproject.toml deps-array style:  "requests>=2.0"  or  "requests"
    /"[a-zA-Z0-9_.-]+[<>=!~]/ {
      match($0, /"[a-zA-Z0-9_.-]+[<>=!~][^"]*"/)
      if (RSTART > 0) {
        s=substr($0, RSTART+1, RLENGTH-2)
        n=s; sub(/[<>=!~].*$/, "", n)
        v=s; sub(/^[^<>=!~]*/, "", v); gsub(/^[<>=!~ ]+/, "", v)
        print n "|" v
      }
      next
    }
    # pyproject.toml table style:  requests = "^2.0"
    /^[a-zA-Z0-9_.-]+[[:space:]]*=[[:space:]]*"[^"]+"/ {
      n=$0; sub(/[[:space:]]*=.*$/, "", n)
      v=$0; sub(/^[^"]*"/, "", v); sub(/".*$/, "", v)
      print n "|" v; next
    }
  ' | sort -u
}

extract_cargo() {
  # get_added_lines yields ONLY added diff lines, so the [section] header a dep
  # sits under is usually NOT in scope — section-tracking would drop real deps
  # added under an existing [dependencies]. Instead, mirror extract_npm: emit
  # candidates, then filter known non-dep string keys from [package]/[profile.*]/
  # [workspace]/[[bin]] (edition, version, resolver, panic, path, …) that the
  # naive `key = "string"` shape otherwise reports as MANUAL findings.
  get_added_lines | awk '
    /^[a-zA-Z0-9_-]+[[:space:]]*=[[:space:]]*"[^"]+"/ {
      n=$0; sub(/[[:space:]]*=.*$/, "", n)
      v=$0; sub(/^[^"]*"/, "", v); sub(/".*$/, "", v)
      print n "|" v
    }
  ' \
    | grep -vE '^(name|version|edition|rust-version|description|license|license-file|repository|homepage|documentation|readme|keywords|categories|build|links|publish|default-run|workspace|resolver|authors|exclude|include|panic|path|opt-level|lto|strip|split-debuginfo)\|' \
    | sort -u
}

extract_go() {
  get_added_lines | awk '
    /^[[:space:]]*[a-zA-Z0-9_./-]+[[:space:]]+v[0-9]/ {
      n=$1; v=$2
      print n "|" v
    }
  ' | sort -u
}

extract_nuget() {
  get_added_lines \
    | grep -oE '<PackageReference[[:space:]]+Include="[^"]+"[[:space:]]+Version="[^"]+"' \
    | sed -E 's/.*Include="([^"]+)"[[:space:]]+Version="([^"]+)".*/\1|\2/' \
    | sort -u
}

# --- Registry pingers (best-effort, short timeout) ------------------
# Returns 0 if package exists, 1 if confirmed missing, 2 if check skipped/inconclusive.
HAS_CURL=$(command -v curl >/dev/null 2>&1 && echo 1 || echo 0)
VERIFY_ENABLED="${CLAUDE_DEP_VERIFY:-1}"

# Cap the number of live registry checks per hook run. Each check is a serial
# curl with a 5s ceiling, so a manifest edit adding 30 deps could otherwise
# stall this PostToolUse hook for minutes. Deps past the cap are flagged
# MANUAL rather than checked. The cap only engages when network checks are
# actually possible; offline, every dep already degrades to UNVERIFIED with no
# network time spent, so capping there would only add noise.
DEP_CHECK_CAP="${CLAUDE_DEP_VERIFY_MAX:-20}"
case "$DEP_CHECK_CAP" in ''|*[!0-9]*) DEP_CHECK_CAP=20 ;; esac
NET_CHECKS_POSSIBLE=0
{ [ "$HAS_CURL" = "1" ] && [ "$VERIFY_ENABLED" != "0" ]; } && NET_CHECKS_POSSIBLE=1
checks_done=0

check_npm() {
  local pkg="$1"
  [ "$HAS_CURL" = "0" ] && return 2
  [ "$VERIFY_ENABLED" = "0" ] && return 2
  # URL-encode @scope/name → @scope%2Fname for the registry endpoint
  local enc="${pkg//\//%2F}"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://registry.npmjs.org/$enc" 2>/dev/null || echo "000")
  case "$code" in
    200) return 0 ;;
    404) return 1 ;;
    *)   return 2 ;;  # network error / timeout / rate limit
  esac
}

check_pypi() {
  local pkg="$1"
  [ "$HAS_CURL" = "0" ] && return 2
  [ "$VERIFY_ENABLED" = "0" ] && return 2
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://pypi.org/pypi/$pkg/json" 2>/dev/null || echo "000")
  case "$code" in
    200) return 0 ;;
    404) return 1 ;;
    *)   return 2 ;;
  esac
}

# --- Main per-ecosystem flow ----------------------------------------
case "$ecosystem" in
  npm)
    while IFS='|' read -r name version; do
      [ -z "$name" ] && continue
      if [ "$NET_CHECKS_POSSIBLE" = "1" ] && [ "$checks_done" -ge "$DEP_CHECK_CAP" ]; then
        add_finding "- **MANUAL** (npm) \`$name@$version\` — registry check capped at ${DEP_CHECK_CAP}/run (many new deps this edit); verify it exists manually before commit."
        continue
      fi
      checks_done=$((checks_done + 1))
      if check_npm "$name"; then
        :  # exists
      elif [ $? -eq 1 ]; then
        add_finding "- **MISSING** (npm) \`$name@$version\` — not found on registry.npmjs.org. Likely hallucinated; verify before commit."
      else
        add_finding "- **UNVERIFIED** (npm) \`$name@$version\` — registry check skipped (offline or CLAUDE_DEP_VERIFY=0). Verify manually."
      fi
    done < <(extract_npm)
    ;;
  pypi)
    while IFS='|' read -r name version; do
      [ -z "$name" ] && continue
      if [ "$NET_CHECKS_POSSIBLE" = "1" ] && [ "$checks_done" -ge "$DEP_CHECK_CAP" ]; then
        add_finding "- **MANUAL** (PyPI) \`$name==$version\` — registry check capped at ${DEP_CHECK_CAP}/run (many new deps this edit); verify it exists manually before commit."
        continue
      fi
      checks_done=$((checks_done + 1))
      if check_pypi "$name"; then
        :
      elif [ $? -eq 1 ]; then
        add_finding "- **MISSING** (PyPI) \`$name==$version\` — not found on pypi.org. Likely hallucinated; verify before commit."
      else
        add_finding "- **UNVERIFIED** (PyPI) \`$name==$version\` — registry check skipped. Verify manually."
      fi
    done < <(extract_pypi)
    ;;
  cargo|go|nuget)
    # Detection only for these ecosystems (registry verification not yet
    # automated). Surface the deps so the agent at least sees them.
    extractor="extract_${ecosystem}"
    deps=$($extractor || true)
    if [ -n "$deps" ]; then
      add_finding "- **MANUAL** ($ecosystem) — new dependencies in \`$rel_path\` not auto-verified by this hook. Verify each exists on its registry before commit:"
      while IFS='|' read -r name version; do
        [ -z "$name" ] && continue
        add_finding "    - \`$name $version\`"
      done <<<"$deps"
    fi
    ;;
esac

# --- Write findings file (or remove stale) --------------------------
if [ ${#findings[@]} -eq 0 ]; then
  # Nothing to flag this run. Don't touch an existing findings file —
  # prior runs' issues remain visible until resolved/cleared by the agent.
  _log_event "clean"
  exit 0
fi

now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Plugin copy: deliver the findings to the MODEL directly via PostToolUse
# additionalContext. The file sink below is only reachable in repos that
# already have .claude/, and only CCMAF's cold-start runbook ever surfaces
# it — the plugin's scaffold-free audience would otherwise never see a
# MISSING (hallucinated-package) advisory: the write failed and was silently
# swallowed by the || rm -f cleanup under exit 0. Stdout is safe to use for
# this: on the dispatched path (post-edit-dispatch.sh) it is relayed to the
# harness, and neither auto-format nor auto-lint prints to stdout for
# manifest file types, so this JSON is the hook invocation's only stdout.
_ctx="Dependency verification findings for \`$rel_path\` ($ecosystem):"
for f in "${findings[@]}"; do
  _ctx="$_ctx"$'\n'"$f"
done
if command -v jq >/dev/null 2>&1; then
  printf '%s' "$_ctx" \
    | jq -Rs '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:.}}' 2>/dev/null \
    || true
else
  # No jq: escape by hand (backslash first). Finding text is template-shaped
  # with extraction-regex-constrained names/versions, so backslash / quote /
  # tab / newline cover it. The replacement strings live in a VARIABLE
  # because bash backslash-processes literal replacements in ${var//pat/repl}
  # — a literal '\\' replacement silently collapses to one backslash
  # (verified live; variables pass through untouched).
  _bs='\'
  _esc=${_ctx//"$_bs"/"$_bs$_bs"}
  _esc=${_esc//'"'/"$_bs"'"'}
  _esc=${_esc//$'\t'/"$_bs"t}
  _esc=${_esc//$'\r'/}
  _esc=${_esc//$'\n'/"$_bs"n}
  printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "$_esc"
fi

# File sink: only where .claude/ already exists — never create .claude in a
# scaffold-free repo (matches the telemetry gate in hook-common.sh).
if [ -d "$PROJECT_ROOT/.claude" ]; then
  # Unique tmp path per write (Audtor 2026-07-02 minor): a fixed
  # "${FINDINGS_FILE}.tmp" name let two concurrent PostToolUse fires (two
  # manifest edits close together) race on the SAME temp file — the loser's
  # write silently clobbered the winner's, which can drop a hallucinated-
  # package advisory the agent never sees.
  _ftmp="${FINDINGS_FILE}.tmp"
  command -v unique_tmp >/dev/null 2>&1 && _ftmp=$(unique_tmp "$FINDINGS_FILE")
  {
    if [ -f "$FINDINGS_FILE" ]; then
      cat "$FINDINGS_FILE"
      echo
    else
      echo "# Dependency Verification Issues"
      echo
      echo "Findings from the devhooks plugin's verify-deps hook after manifest edits."
      echo "Resolve each before commit, then delete this file."
      echo
    fi
    echo "## $now_iso — $rel_path ($ecosystem)"
    echo
    for f in "${findings[@]}"; do
      echo "$f"
    done
  } > "$_ftmp" && mv -f "$_ftmp" "$FINDINGS_FILE" 2>/dev/null || rm -f "$_ftmp" 2>/dev/null
fi

_log_event "findings"
exit 0
