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
#   SKILLS_UPSTREAM_URL=git@github.com:you/your-skills.git   # any git-clonable URL or local path
#   SKILLS_UPSTREAM_BRANCH=main
#   SKILLS_PINNED_SHA=<rewritten by this script on successful sync>
#   SKILLS_SELECTED="python rust"                            # skill dir names, space-separated
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
    _pkg_has react    && suggestions+="react-development frontend-development "
    _pkg_has electron && suggestions+="electron-development "
    _pkg_has three    && suggestions+="threejs-development "
    _pkg_has remotion && suggestions+="remotion-development "
  fi
  { _have "build.gradle" || _have "build.gradle.kts" || _have "settings.gradle*"; } \
    && suggestions+="android-development "
  { _have "*.xcodeproj" || _have "Package.swift"; } && suggestions+="ios-development "
  # Shell/script stacks: probe root, project dir, and scripts/ — but NOT
  # .claude/ (every framework consumer carries framework hooks; those
  # must not make every project "a bash project").
  { _have "*.sh" || _have "scripts/*.sh"; }   && suggestions+="bash-development "
  { _have "*.ps1" || _have "*.psm1" || _have "scripts/*.ps1"; } \
    && suggestions+="powershell-development "
  # Engines / 3D
  _have "project.godot"                        && suggestions+="godot-development "
  _have "ProjectSettings/ProjectVersion.txt"   && suggestions+="unity-development "
  _have "*.uproject"                           && suggestions+="unreal-engine-development "
  # Cloud / pipelines
  { _have "azure.yaml" || _have "*.bicep" || _have "infra/*.bicep"; } \
    && suggestions+="azure-development "
  { _have ".github/workflows/*.yml" || _have ".github/workflows/*.yaml" || _have "azure-pipelines.yml"; } \
    && suggestions+="devops-development "
  # Microsoft business platform
  { _have "*.pbip" || _have "*.tmdl" || _have "*/*.tmdl"; } && suggestions+="power-bi-development "
  { _have "*.mcs.yml" || _have "*/*.mcs.yml"; }             && suggestions+="copilot-studio-development "
  { _have "*.pcfproj" || _have "*/*.pcfproj"; }             && suggestions+="dynamics-365-development "
  # Diagrams as code
  { _have "*.drawio" || _have "*/*.drawio" || _have "docs/*.drawio"; } && suggestions+="drawio-development "

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
  echo "skills-sync: cross-cutting (not stack-detected, always worth considering): secure-development, accessibility-development, read-the-damn-docs."
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
for this project. The skills catalogue ships BUNDLED in this repo at skills/.
To opt in, create .claude/.skills-version listing the skills you want:

  SKILLS_SELECTED="python-development rust-development"

then re-run: bash .claude/framework/update/skills-sync.sh
(Tip: `--suggest` lists skills matching this project's detected stack.)
(No bundled skills/ — e.g. you copied only the framework into a project? Then
also set SKILLS_UPSTREAM_URL=<your skills repo> + SKILLS_UPSTREAM_BRANCH and it
will clone the catalogue instead. Multi-account machine? use your SSH host alias
in the URL, e.g. git@github.com-personal:..., to avoid the wrong-key prompt.)
EOF
  exit 2
fi

# CRLF-safe source (the file is project-owned; a Windows editor may save CRLF).
# shellcheck disable=SC1090
source <(tr -d '\r' < "$VERSION_FILE")
SKILLS_SELECTED="${SKILLS_SELECTED:-}"

if [ -z "${SKILLS_SELECTED// /}" ]; then
  echo "skills-sync: SKILLS_SELECTED is empty — nothing to sync." >&2
  echo "skills-sync: add skill names (e.g. SKILLS_SELECTED=\"python\") to .claude/.skills-version." >&2
  exit 0
fi

# --- Resolve the source catalogue ---------------------------------------
# Prefer the BUNDLED catalogue shipped in this repo at skills/ (the consolidated repo
# ships every skill there). Fall back to cloning a separate skills upstream only when
# there is no bundle — e.g. the framework was copied into a project WITHOUT skills/.
BUNDLED_SKILLS="$PROJECT_ROOT/skills"
if [ -d "$BUNDLED_SKILLS" ] && compgen -G "$BUNDLED_SKILLS/*/" >/dev/null 2>&1; then
  SRC_ROOT="$BUNDLED_SKILLS"
  upstream_sha="bundled"
  echo "skills-sync: sourcing from the bundled catalogue at skills/ (in-repo)."
else
  : "${SKILLS_UPSTREAM_URL:?no bundled skills/ found and SKILLS_UPSTREAM_URL missing in .skills-version}"
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
fi

# --- Per-skill selective copy -------------------------------------------
synced=0
refused=0
for name in $SKILLS_SELECTED; do
  name="${name%$'\r'}"
  [ -z "$name" ] && continue
  # Defensive: a skill name is a plain dir name, never a path.
  case "$name" in
    */*|.*)
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
if [ "$synced" -gt 0 ]; then
  tmp_version="$(mktemp)"
  awk -v sha="$upstream_sha" '
    BEGIN { set = 0 }
    /^SKILLS_PINNED_SHA=/ { print "SKILLS_PINNED_SHA=" sha; set = 1; next }
    { print }
    END { if (!set) print "SKILLS_PINNED_SHA=" sha }
  ' "$VERSION_FILE" > "$tmp_version" && mv "$tmp_version" "$VERSION_FILE"

  # --- Companion advisory (contract:skills-sync) ----------------------
  # Skills cross-reference siblings by name (the skills repo's boundary
  # convention: "React owns behaviour, frontend owns styling"). A synced
  # skill that routes to an unsynced sibling still works — the agent just
  # lacks that depth. Surface the gap once per sync; never an error.
  companions=""
  for name in $SKILLS_SELECTED; do
    name="${name%$'\r'}"
    [ -d "$SKILLS_DIR/$name" ] || continue
    for ref in $(grep -rhoE '\b[a-z0-9]+(-[a-z0-9]+)*-development\b' "$SKILLS_DIR/$name" 2>/dev/null | sort -u); do
      [ "$ref" = "$name" ] && continue
      [ -d "$SRC_ROOT/$ref" ] || continue              # real catalogue skill only
      case " $SKILLS_SELECTED " in *" $ref "*) continue ;; esac
      case " $companions " in *" $ref "*) ;; *) companions+="$ref " ;; esac
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
