#!/usr/bin/env bash
# advisors-lib.sh — shared helpers for the advisor workbench (TASK-131).
#
# SOURCED by codex-preflight.sh and the per-provider drivers; defines functions only and
# sets NO shell options (a sourced lib must not mutate the caller's `set -e`/pipefail). The
# CALLER owns strict mode. Registry is TOML, parsed with awk — no jq / no TOML dependency,
# per framework convention (see tools/console.mjs / verify-turn.sh lineage).
#
# Code resolves relative to THIS script ($BASH_SOURCE); state (the live registry) resolves
# to the project via git — the same code-vs-state split the hooks use, so the advisor code
# could later be homed elsewhere without moving the registry.

# Absolute dir of this lib (works when sourced).
advisors_code_dir() {
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
}

# Project root (where the live registry + markers live). git first, sensible fallback.
advisors_repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || {
    # Fallback: walk up from the code dir past .claude/framework/advisors → repo root.
    cd "$(advisors_code_dir)/../../.." && pwd
  }
}

advisors_template_path() { printf '%s/advisors.template.toml' "$(advisors_code_dir)"; }
advisors_registry_path() { printf '%s/.claude/advisors.toml' "$(advisors_repo_root)"; }

# Ensure the consumer-owned live registry exists; create from the shipped template on first
# use (the .console-version bootstrap pattern). Prints a one-line notice to stderr on create.
advisors_ensure_registry() {
  local live template
  live="$(advisors_registry_path)"
  template="$(advisors_template_path)"
  if [[ ! -f "$live" ]]; then
    if [[ ! -f "$template" ]]; then
      printf 'advisors-lib: ERROR — template missing at %s\n' "$template" >&2
      return 1
    fi
    cp "$template" "$live"
    printf 'advisors-lib: created consumer registry %s from template (edit it, not the template)\n' "$live" >&2
  fi
  printf '%s\n' "$live"
}

# registry_get <section> <key> [registry-file]
# Reads a scalar from a TOML [section] (e.g. "advisors.sol" or "providers.codex").
# Strips surrounding quotes, trailing comments, and whitespace. Empty output = not found.
registry_get() {
  local section="$1" key="$2" file="${3:-}"
  [[ -n "$file" ]] || file="$(advisors_registry_path)"
  [[ -f "$file" ]] || return 0
  awk -v section="$section" -v key="$key" '
    { sub(/\r$/, "") }   # CRLF-proof: strip a trailing CR before any matching
    /^[[:space:]]*\[/ {
      line = $0
      sub(/^[[:space:]]*\[[[:space:]]*/, "", line)
      sub(/[[:space:]]*\][[:space:]]*$/, "", line)
      in_section = (line == section)
      next
    }
    in_section {
      # match:  key = ...
      if ($0 ~ "^[[:space:]]*" key "[[:space:]]*=") {
        val = $0
        sub(/^[[:space:]]*[^=]*=[[:space:]]*/, "", val)   # drop "key ="
        sub(/[[:space:]]*#.*$/, "", val)                   # drop trailing comment
        gsub(/^["'"'"']|["'"'"']$/, "", val)               # drop surrounding quotes
        sub(/[[:space:]]+$/, "", val)                      # drop trailing ws
        print val
        exit
      }
    }
  ' "$file"
}

# ── Modes (TASK-132: "watcher mode") ─────────────────────────────────────────────────────
# The active mode name (the [modes] active key). Default "normal" (all-Claude, nothing added)
# when unset or the registry has no [modes] table — so a registry that predates modes behaves
# exactly as before.
mode_active() {
  local m; m="$(registry_get modes active)"
  printf '%s' "${m:-normal}"
}

# mode_watcher_advisor <role>   role ∈ {reviewer, verifier}
# Resolve the codex advisor that WATCHES <role> under the active mode, VALIDATED and fail-closed:
#   - role MUST be reviewer|verifier. There is deliberately NO doer role here — a codex seat can
#     never be routed to developer/tester (the panel's "developer=<codex> is a hard error",
#     enforced by construction, not a late check).
#   - active mode "normal", or a mode that leaves this role unset → prints nothing, returns 0
#     (the role stays on the Claude agent only; augment adds nothing).
#   - a set slot naming an UNKNOWN advisor, or a NON-codex advisor → FAIL CLOSED: warn to stderr,
#     return 3, print nothing (never silently review/verify with a bad seat).
#   - a valid codex advisor → print its name, return 0.
mode_watcher_advisor() {
  local role="${1:-}" mode adv provider
  case "$role" in
    reviewer|verifier) ;;
    *) printf 'advisors-lib: mode_watcher_advisor: role must be reviewer|verifier, got %q\n' "$role" >&2; return 3 ;;
  esac
  mode="$(mode_active)"
  [[ "$mode" == "normal" ]] && return 0
  adv="$(registry_get "modes.$mode" "$role")"
  [[ -n "$adv" ]] || return 0
  provider="$(registry_get "advisors.$adv" provider)"
  if [[ -z "$provider" ]]; then
    printf 'advisors-lib: mode %q assigns UNKNOWN advisor %q to %s — FAILING CLOSED (no watcher)\n' "$mode" "$adv" "$role" >&2
    return 3
  fi
  if [[ "$provider" != "codex" ]]; then
    printf 'advisors-lib: mode %q assigns %q (provider %q) to %s; only codex advisors may watch — FAILING CLOSED\n' "$mode" "$adv" "$provider" "$role" >&2
    return 3
  fi
  printf '%s' "$adv"
}

# List the mode names defined in the registry (the [modes.<name>] sections). Used by /mode to
# validate a requested mode before switching. "normal" is always implicitly valid (no section).
# (Always reads the live registry; tests override advisors_registry_path rather than pass a file.)
registry_modes() {
  local file; file="$(advisors_registry_path)"
  [[ -f "$file" ]] || return 0
  awk '
    { sub(/\r$/, "") }   # CRLF-proof
    /^[[:space:]]*\[[[:space:]]*modes\./ {
      line = $0
      sub(/^[[:space:]]*\[[[:space:]]*modes\./, "", line)
      sub(/[[:space:]]*\][[:space:]]*$/, "", line)
      print line
    }
  ' "$file"
}

# mode_validate <name> — validate a mode WITHOUT making it active (the /mode switch guard).
# Returns 0 if valid: "normal", or a defined [modes.<name>] whose populated reviewer/verifier
# slots each name a codex advisor. On invalid, prints the reason to stderr and returns non-zero
# (1 = unknown mode, 3 = bad/non-codex seat). Fail-closed, so /mode never switches into a mode
# that would then fail-closed at review time.
mode_validate() {
  local name="${1:-}" adv provider role found m
  [[ "$name" == "normal" ]] && return 0
  found=0
  while IFS= read -r m; do [[ "$m" == "$name" ]] && found=1; done < <(registry_modes)
  if [[ "$found" -ne 1 ]]; then
    printf 'advisors-lib: mode %q is not defined ([modes.%s] missing)\n' "$name" "$name" >&2
    return 1
  fi
  for role in reviewer verifier; do
    adv="$(registry_get "modes.$name" "$role")"
    [[ -n "$adv" ]] || continue
    provider="$(registry_get "advisors.$adv" provider)"
    if [[ -z "$provider" ]]; then
      printf 'advisors-lib: mode %q assigns UNKNOWN advisor %q to %s\n' "$name" "$adv" "$role" >&2; return 3
    fi
    if [[ "$provider" != "codex" ]]; then
      printf 'advisors-lib: mode %q assigns %q (provider %q) to %s; only codex advisors may watch\n' "$name" "$adv" "$provider" "$role" >&2; return 3
    fi
  done
  return 0
}

# List advisor names defined in the registry (the [advisors.<name>] sections).
registry_advisors() {
  local file="${1:-}"
  [[ -n "$file" ]] || file="$(advisors_registry_path)"
  [[ -f "$file" ]] || return 0
  awk '
    { sub(/\r$/, "") }   # CRLF-proof: strip a trailing CR before any matching
    /^[[:space:]]*\[[[:space:]]*advisors\./ {
      line = $0
      sub(/^[[:space:]]*\[[[:space:]]*advisors\./, "", line)
      sub(/[[:space:]]*\][[:space:]]*$/, "", line)
      print line
    }
  ' "$file"
}
