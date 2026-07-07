#!/usr/bin/env bash
# skills-sync.sh — selectively sync language/topic skills from a separate
# skills repo into .claude/skills/ (TASK-036; contract:skills-sync).
#
# A SECOND upstream, independent of the framework upstream: the skills
# repo has one directory per skill (SKILL.md + optional reference files).
# A project declares which skills it wants in .claude/.skills-version;
# this script clones the skills upstream and copies ONLY those dirs.
# Ownership is per-directory: selected dirs belong to the skills repo
# (overwritten on sync, after a dirty-check); everything else under
# .claude/skills/ is consumer-local and never read, written, or deleted.
# Neither apply-update.sh nor framework-manifest.txt touches skills.
#
# Usage:
#   bash .claude/framework/update/skills-sync.sh             # sync selected skills
#   bash .claude/framework/update/skills-sync.sh --suggest   # stack-detect suggestions only
#
# .claude/.skills-version (project-owned, sourceable shell):
#   SKILLS_UPSTREAM_URL=git@github.com:you/your-skills.git   # OPTIONAL — set to track
#                                                            # a specific repo (clone mode);
#                                                            # omit → vendored skills/ or the
#                                                            # public CCMAF default
#   SKILLS_UPSTREAM_BRANCH=main                              # required in clone mode
#   SKILLS_PINNED_SHA=<rewritten by this script on successful sync; "bundled" in bundle mode>
#   SKILLS_SELECTED="python-development rust-development"    # skill dir names, space-separated
#
# Exit codes:
#   0 — synced (or nothing to do / --suggest)
#   1 — one or more selected skills refused (uncommitted local changes)
#   2 — setup issue (.skills-version missing or malformed)
#   3 — network/clone failure
#
# Dependencies: git. No jq, no curl.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
VERSION_FILE="$PROJECT_ROOT/.claude/.skills-version"
SKILLS_DIR="$PROJECT_ROOT/.claude/skills"

# --- Stack-detect suggestions (suggest-only — never installs) ---------
# Probes both the project root and 01_Project/ (the documented project
# code home — init.sh detects stacks there). Suggested names match the
# upstream catalogue's REAL dir names (they're meant to be pasted into
# SKILLS_SELECTED verbatim) — the <stack>-development naming convention.
suggest_skills() {
  local suggestions=""
  _have() {
    compgen -G "$PROJECT_ROOT/$1" >/dev/null 2>&1 \
      || compgen -G "$PROJECT_ROOT/01_Project/$1" >/dev/null 2>&1
  }
  _pkg_has() {  # <dep> — is the dep named in a package.json?
    grep -q "\"$1\"" "$PROJECT_ROOT/package.json" 2>/dev/null \
      || grep -q "\"$1\"" "$PROJECT_ROOT/01_Project/package.json" 2>/dev/null
  }
  { _have "pyproject.toml" || _have "requirements*.txt"; } && suggestions+="python-development "
  { _have "*.csproj" || _have "*/*.csproj"; }              && suggestions+="dotnet-development "
  if _have "tauri.conf.json" || _have "src-tauri/tauri.conf.json"; then
    suggestions+="tauri-development rust-development "
  elif _have "Cargo.toml"; then
    suggestions+="rust-development "
  fi
  if _have "package.json"; then
    suggestions+="typescript-development "
    _pkg_has react    && suggestions+="react-development frontend-development design-taste "
    _pkg_has electron && suggestions+="electron-development "
    _pkg_has three    && suggestions+="threejs-development "
    _pkg_has remotion && suggestions+="remotion-development "
    # Frontend beyond React (the catalogue's frontend-development skill is
    # framework-agnostic styling/markup, not React-specific).
    { _pkg_has vue || _pkg_has svelte || _pkg_has '@angular/core'; } \
      && suggestions+="frontend-development design-taste "
  fi
  { _have "build.gradle" || _have "build.gradle.kts" || _have "settings.gradle*"; } \
    && suggestions+="android-development "
  { _have "*.xcodeproj" || _have "Package.swift"; } && suggestions+="ios-development "
  # Shell/script stacks: probe root, project dir, scripts/, and tools/ — but
  # NOT .claude/ (every framework consumer carries framework hooks; those must
  # not make every project "a bash project").
  { _have "*.sh" || _have "scripts/*.sh" || _have "tools/*.sh"; } \
    && suggestions+="bash-development "
  { _have "*.ps1" || _have "*.psm1" || _have "scripts/*.ps1"; } \
    && suggestions+="powershell-development "
  # Engines / 3D
  _have "project.godot"                        && suggestions+="godot-development "
  _have "ProjectSettings/ProjectVersion.txt"   && suggestions+="unity-development "
  _have "*.uproject"                           && suggestions+="unreal-engine-development "
  # Containers / orchestration
  { _have "Dockerfile" || _have "*/Dockerfile" || _have "docker-compose.yml" \
      || _have "docker-compose.yaml" || _have "compose.yml" || _have "compose.yaml"; } \
    && suggestions+="containers-development "
  { _have "Chart.yaml" || _have "*/Chart.yaml" || _have "kustomization.yaml" \
      || _have "kustomization.yml" || _have "k8s/*.yaml" || _have "k8s/*.yml"; } \
    && suggestions+="kubernetes-development "
  # Cloud / pipelines
  { _have "azure.yaml" || _have "*.bicep" || _have "infra/*.bicep"; } \
    && suggestions+="azure-development "
  { _have ".github/workflows/*.yml" || _have ".github/workflows/*.yaml" \
      || _have "azure-pipelines.yml" || _have "bitbucket-pipelines.yml" \
      || _have ".gitlab-ci.yml" || _have "Jenkinsfile" || _have "*/Jenkinsfile"; } \
    && suggestions+="devops-development "
  # Databases
  { _have "*.sql" || _have "*/*.sql" || _have "migrations/*.sql" || _have "db/*.sql"; } \
    && suggestions+="sql-development "
  # Microsoft business platform
  { _have "*.pbip" || _have "*.tmdl" || _have "*/*.tmdl"; } && suggestions+="power-bi-development "
  { _have "*.mcs.yml" || _have "*/*.mcs.yml"; }             && suggestions+="copilot-studio-development "
  { _have "*.pcfproj" || _have "*/*.pcfproj"; }             && suggestions+="dynamics-365-development "
  # Diagrams as code
  { _have "*.drawio" || _have "*/*.drawio" || _have "docs/*.drawio"; } && suggestions+="drawio-development "

  # --- catalogue expansion (waves 1+2, 2026-07): new stack-detectable skills ---
  _pyhas() {  # <dep> — named in pyproject.toml or a requirements*.txt?
    grep -qi "$1" "$PROJECT_ROOT/pyproject.toml" "$PROJECT_ROOT"/requirements*.txt 2>/dev/null
  }
  _csproj_has() { grep -rqi "$1" "$PROJECT_ROOT" --include='*.csproj' 2>/dev/null; }
  _have "go.mod"                                                     && suggestions+="go-development "
  { _have "*.tf" || _have "*/*.tf" || _have ".terraform.lock.hcl"; } && suggestions+="terraform-development "
  { _have "dbt_project.yml" || _have "*/dbt_project.yml" || _pyhas "pyspark" || _pyhas "apache-airflow" || _pyhas "dagster" || _pyhas "prefect"; } && suggestions+="data-engineering-development "
  { _pyhas "scikit-learn" || _pyhas "mlflow" || _pyhas "tensorflow" || _pyhas "torch"; } && suggestions+="machine-learning-development "
  { _have "*.graphql" || _have "*.gql" || _have "schema.graphql" || _pkg_has "graphql" || _pyhas "strawberry-graphql" || _pyhas "graphene"; } && suggestions+="graphql-development "
  { _csproj_has "UseWPF" || _csproj_has "UseWindowsForms" || _csproj_has "WindowsAppSDK"; } && suggestions+="windows-desktop-development "
  { _have "manifest.webmanifest" || _have "*/manifest.webmanifest" || _have "sw.js" || _have "service-worker.js" || _have "lighthouserc*"; } && suggestions+="web-performance-development "
  { _have "asyncapi.yaml" || _have "asyncapi.yml"; }                 && suggestions+="event-driven-development "

  if [ -z "$suggestions" ]; then
    echo "skills-sync: no stack manifests detected — no skill suggestions."
    echo "skills-sync: cross-cutting skills are always worth considering: secure-development, accessibility-development, read-the-damn-docs."
    return 0
  fi
  # De-dup while preserving order.
  local seen="" s out=""
  for s in $suggestions; do
    case " $seen " in *" $s "*) continue ;; esac
    seen+=" $s"; out+="$s "
  done
  echo "skills-sync: detected stack suggests skills: ${out% }"
  echo "skills-sync: cross-cutting (not stack-detected, always worth considering): secure-development, accessibility-development, read-the-damn-docs, git-workflow, systematic-debugging, technical-writing."
  if [ -f "$VERSION_FILE" ]; then
    # shellcheck disable=SC1090
    source <(tr -d '\r' < "$VERSION_FILE") 2>/dev/null || true
    local missing=""
    for s in $out; do
      case " ${SKILLS_SELECTED:-} " in *" $s "*) ;; *) missing+="$s " ;; esac
    done
    [ -n "$missing" ] && echo "skills-sync: not in SKILLS_SELECTED yet: ${missing% } — add to .claude/.skills-version and re-run sync."
  else
    echo "skills-sync: no .claude/.skills-version — run this script without --suggest for a setup template."
  fi
  return 0
}

if [ "${1:-}" = "--suggest" ]; then
  suggest_skills
  exit 0
fi

# --- Setup / config ----------------------------------------------------
if [ ! -f "$VERSION_FILE" ]; then
  cat >&2 <<'EOF'
skills-sync: no .claude/.skills-version found — skills sync is not set up
for this project. Skills are pulled on demand from the public CCMAF catalogue.
To opt in, create .claude/.skills-version listing the skills you want:

  SKILLS_SELECTED="python-development rust-development"

then re-run: bash .claude/framework/update/skills-sync.sh
(Tip: `--suggest` lists skills matching this project's detected stack.)
(By default skills come from the official public catalogue over HTTPS — no auth
needed. To track your own skills repo instead, add SKILLS_UPSTREAM_URL=<url> +
SKILLS_UPSTREAM_BRANCH. Multi-account machine? use your SSH host alias in the
URL, e.g. git@github.com-personal:..., to avoid the wrong-key prompt.)
EOF
  exit 2
fi

# CRLF-safe source (the file is project-owned; a Windows editor may save CRLF).
# shellcheck disable=SC1090
source <(tr -d '\r' < "$VERSION_FILE")
SKILLS_SELECTED="${SKILLS_SELECTED:-}"

if [ -z "${SKILLS_SELECTED// /}" ]; then
  echo "skills-sync: SKILLS_SELECTED is empty — nothing to sync." >&2
  echo "skills-sync: add skill names (e.g. SKILLS_SELECTED=\"python-development\") to .claude/.skills-version." >&2
  exit 0
fi

# --- Resolve the source catalogue ---------------------------------------
# Modes, in precedence order (contract:skills-sync):
#   * CLONE MODE (SKILLS_UPSTREAM_URL set) — clone that upstream and pin its
#     real HEAD sha, so skills-check can compare pins and later syncs can pull
#     newer content. An explicit URL always wins.
#   * BUNDLE MODE (a vendored skills/ tree exists) — source that in-repo
#     catalogue and pin the marker "bundled". For consumers who vendor their own
#     skills/; skills-check stays silent (no upstream to poll).
#   * DEFAULT (neither set) — fall back to the official PUBLIC CCMAF skills
#     catalogue over anonymous HTTPS (no SSH/token). The framework no longer
#     bundles skills/, so this is what a fresh consumer gets from SKILLS_SELECTED
#     alone. Override with SKILLS_UPSTREAM_URL (your own fork, or your SSH host
#     alias on a multi-account machine).
BUNDLED_SKILLS="$PROJECT_ROOT/skills"
if [ -z "${SKILLS_UPSTREAM_URL:-}" ] \
   && ! { [ -d "$BUNDLED_SKILLS" ] && compgen -G "$BUNDLED_SKILLS/*/" >/dev/null 2>&1; }; then
  SKILLS_UPSTREAM_URL="${SKILLS_DEFAULT_UPSTREAM_URL:-https://github.com/drushegh/CCMAF---Skills.git}"
  : "${SKILLS_UPSTREAM_BRANCH:=main}"
  echo "skills-sync: no upstream configured — defaulting to the public CCMAF catalogue ($SKILLS_UPSTREAM_URL)."
fi
if [ -n "${SKILLS_UPSTREAM_URL:-}" ]; then
  : "${SKILLS_UPSTREAM_BRANCH:?SKILLS_UPSTREAM_BRANCH missing in .skills-version}"
  tmp_clone="$(mktemp -d)"
  trap 'rm -rf "$tmp_clone"' EXIT
  echo "skills-sync: fetching $SKILLS_UPSTREAM_URL ($SKILLS_UPSTREAM_BRANCH)..."
  # Capture stderr (discard stdout) so a publickey denial becomes an actionable hint.
  if ! clone_err="$(git clone --quiet --depth 1 --branch "$SKILLS_UPSTREAM_BRANCH" "$SKILLS_UPSTREAM_URL" "$tmp_clone" 2>&1 >/dev/null)"; then
    echo "skills-sync: clone failed (network/auth/branch?). Nothing was changed." >&2
    case "$clone_err" in
      *"Permission denied (publickey)"*)
        echo "skills-sync: SSH auth was denied. On a machine with multiple GitHub" >&2
        echo "            accounts, plain github.com can pick the wrong key — set" >&2
        echo "            SKILLS_UPSTREAM_URL to your SSH host alias (e.g." >&2
        echo "            git@github.com-personal:you/your-skills.git) and confirm" >&2
        echo "            with: git ls-remote \"\$SKILLS_UPSTREAM_URL\"." >&2
        ;;
    esac
    exit 3
  fi
  upstream_sha=$(git -C "$tmp_clone" rev-parse HEAD)
  SRC_ROOT="$tmp_clone"
elif [ -d "$BUNDLED_SKILLS" ] && compgen -G "$BUNDLED_SKILLS/*/" >/dev/null 2>&1; then
  SRC_ROOT="$BUNDLED_SKILLS"
  upstream_sha="bundled"
  echo "skills-sync: sourcing from the bundled catalogue at skills/ (in-repo bundle mode)."
else
  echo "skills-sync: no SKILLS_UPSTREAM_URL set and no bundled skills/ catalogue found." >&2
  echo "skills-sync: either set SKILLS_UPSTREAM_URL (+ SKILLS_UPSTREAM_BRANCH) in" >&2
  echo "            .claude/.skills-version to clone a skills repo, or provide a bundled" >&2
  echo "            skills/ tree. Nothing was changed." >&2
  exit 2
fi

# --- Per-skill selective copy -------------------------------------------
synced=0
refused=0
for name in $SKILLS_SELECTED; do
  name="${name%$'\r'}"
  [ -z "$name" ] && continue
  # Defensive: a skill name is a plain dir name, never a path. Reject forward
  # AND back slashes (a Windows-style `..\evil` would otherwise reach rm -rf/cp)
  # and any leading dot (`.`, `..`, hidden).
  case "$name" in
    */*|*\\*|.*)
      echo "skills-sync: SKIP '$name' — skill names must be plain directory names." >&2
      continue
      ;;
  esac

  src="$SRC_ROOT/$name"
  dst="$SKILLS_DIR/$name"

  if [ ! -d "$src" ]; then
    echo "  - $name: not in upstream yet — skipped."
    continue
  fi

  # Dirty-check: refuse to overwrite uncommitted local state in THIS
  # skill dir. Two cases (contract:skills-sync):
  #   - dir has tracked files → any porcelain line scoped to it = dirty.
  #     Porcelain v1 lines are "XY PATH" — consume the space (BUG-002
  #     pattern class).
  #   - dir entirely untracked (previous sync not yet committed) → allow
  #     only if byte-identical to the incoming copy (idempotent re-run);
  #     any difference means local edits or an upstream bump over an
  #     uncommitted sync — refuse until the user commits.
  if git -C "$PROJECT_ROOT" rev-parse --git-dir >/dev/null 2>&1 && [ -d "$dst" ]; then
    if git -C "$PROJECT_ROOT" ls-files --error-unmatch -- ".claude/skills/$name" >/dev/null 2>&1; then
      dirty=$(git -C "$PROJECT_ROOT" status --porcelain -- ".claude/skills/$name" 2>/dev/null | grep -E '^.. ' || true)
      if [ -n "$dirty" ]; then
        echo "  - $name: REFUSED — uncommitted local changes:" >&2
        printf '%s\n' "$dirty" | sed 's/^/      /' >&2
        echo "    Commit or discard them, then re-run skills-sync." >&2
        refused=$((refused + 1))
        continue
      fi
    elif ! diff -rq "$src" "$dst" >/dev/null 2>&1; then
      echo "  - $name: REFUSED — previous sync is uncommitted and differs from incoming." >&2
      echo "    Commit .claude/skills/$name (or delete it), then re-run skills-sync." >&2
      refused=$((refused + 1))
      continue
    fi
  fi

  mkdir -p "$SKILLS_DIR"
  rm -rf "$dst"
  if cp -R "$src" "$dst"; then
    echo "  - $name: synced."
    synced=$((synced + 1))
  else
    echo "  - $name: copy failed (disk/permissions?)." >&2
    refused=$((refused + 1))
  fi
done

# --- Rewrite pin on success ----------------------------------------------
# Advance the pin ONLY when EVERY selected skill synced cleanly (refused == 0).
# A partial sync that skipped one or more refused skills must NOT move the pin
# forward — that would hide the staleness of the refused skills (skills-check
# would then report "up to date" while they sit behind upstream). Atomic write:
# mktemp alongside the destination so the final `mv` is a same-filesystem rename
# (a bare mktemp in the system temp + cross-drive mv can truncate on interrupt).
if [ "$synced" -gt 0 ] && [ "$refused" -eq 0 ]; then
  tmp_version="$(mktemp "$(dirname "$VERSION_FILE")/.skills-version.XXXXXX")"
  awk -v sha="$upstream_sha" '
    BEGIN { set = 0 }
    /^SKILLS_PINNED_SHA=/ { print "SKILLS_PINNED_SHA=" sha; set = 1; next }
    { print }
    END { if (!set) print "SKILLS_PINNED_SHA=" sha }
  ' "$VERSION_FILE" > "$tmp_version" && mv "$tmp_version" "$VERSION_FILE"
fi

# --- Companion advisory (contract:skills-sync) --------------------------
# Skills cross-reference siblings by name (the skills repo's boundary
# convention: "React owns behaviour, frontend owns styling"). A synced skill
# that routes to an unsynced sibling still works — the agent just lacks that
# depth. Surface the gap once per sync; never an error. Runs whenever anything
# synced, independent of the pin advance above. References are matched against
# the REAL catalogue dir names (not a `*-development` regex) so non-development
# siblings (ui-verification, read-the-damn-docs, academic-research, …) surface
# too.
if [ "$synced" -gt 0 ]; then
  catalogue_dirs=()
  for d in "$SRC_ROOT"/*/; do
    [ -d "$d" ] || continue
    catalogue_dirs+=("$(basename "$d")")
  done
  companions=""
  for name in $SKILLS_SELECTED; do
    name="${name%$'\r'}"
    [ -d "$SKILLS_DIR/$name" ] || continue
    for ref in "${catalogue_dirs[@]}"; do
      [ "$ref" = "$name" ] && continue
      case " $SKILLS_SELECTED " in *" $ref "*) continue ;; esac   # already selected
      case " $companions " in *" $ref "*) continue ;; esac        # already noted
      # -F fixed string, -w whole word: the hyphenated skill name must appear as
      # a bounded token, not a substring of a longer identifier.
      if grep -rqFw -- "$ref" "$SKILLS_DIR/$name" 2>/dev/null; then
        companions+="$ref "
      fi
    done
  done
  if [ -n "$companions" ]; then
    echo ""
    echo "skills-sync: your synced skills reference companion skills not in SKILLS_SELECTED:"
    echo "  ${companions% }"
    echo "  (Optional — they only add depth on those adjacent topics. Add the names to"
    echo "   SKILLS_SELECTED in .claude/.skills-version and re-run sync to include them.)"
  fi
fi

echo ""
echo "skills-sync: $synced skill(s) synced, $refused refused/failed (upstream ${upstream_sha:0:7})."
[ "$refused" -gt 0 ] && exit 1
exit 0
