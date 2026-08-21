#!/usr/bin/env bash
# ccmaf core SessionStart hook — the v2 cold start: standing digest + batched
# check chain + boot view, injected as plain stdout (documented SessionStart
# context mechanism).
#
# Size discipline (S1 probe, 2026-08-10): additionalContext is inline up to a
# 10KB ceiling; beyond it the WHOLE payload is spilled to a preview file. So
# this hook self-caps at 8KB: the digest always ships inline; the check table
# + boot view join while under budget, else they are truncated with an
# explicit "run boot-view yourself" line.
#
# Activation (CORE-DESIGN §0): v2 CONTENT line, never bare file presence —
# presence would light core up in every pre-migration v1 project.
# Always exits 0 (SessionStart contract; failures become content).
set -u

_lib="${CLAUDE_PLUGIN_ROOT:-}/hooks/lib/hook-common.sh"
# shellcheck source=/dev/null
[ -f "$_lib" ] && . "$_lib" 2>/dev/null
if ! command -v core_active >/dev/null 2>&1; then
  core_active() {
    local f="${CLAUDE_PROJECT_DIR:-.}/.claude/.framework-version"
    [ -f "$f" ] && grep -Eq '^[[:space:]]*FRAMEWORK_LINE=v2' "$f" 2>/dev/null
  }
fi
core_active || exit 0

# Source filter (kernel pattern): `resume` keeps the prior context, which
# already contains this digest — re-emitting would duplicate it.
src=""
if [ ! -t 0 ]; then
  src=$(head -c 4096 2>/dev/null | sed -n 's/.*"source"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
fi
[ "$src" = "resume" ] && exit 0

root="${CLAUDE_PROJECT_DIR:-.}"

# Liveness marker: the kernel's coverage-blackout warning (CORE-DESIGN §0)
# keys on this. Never create .claude/ — touch only where the scaffold exists.
[ -d "$root/.claude/telemetry" ] && touch "$root/.claude/telemetry/.core-present" 2>/dev/null

tdir="${TMPDIR:-/tmp}"
digest_f="$tdir/ccmaf-ctx-digest.$$"
chain_f="$tdir/ccmaf-ctx-chain.$$"
trap 'rm -f "$digest_f" "$chain_f"' EXIT

{
  # ${CLAUDE_PLUGIN_ROOT} inside the digest is literal text to the model —
  # substitute the real install path at emission time. Bash parameter
  # substitution, not sed: an install path containing sed metacharacters
  # (|, &, \) must not corrupt the replacement (review swarm P3).
  if [ -f "${CLAUDE_PLUGIN_ROOT}/DIGEST.md" ]; then
    _digest="$(cat "${CLAUDE_PLUGIN_ROOT}/DIGEST.md" 2>/dev/null)"
    printf '%s\n' "${_digest//\$\{CLAUDE_PLUGIN_ROOT\}/${CLAUDE_PLUGIN_ROOT}}"
  else
    echo "CCMAF v2 core: DIGEST.md missing from the plugin install — reinstall the ccmaf plugin."
  fi
  if [ "${CLAUDE_UNATTENDED:-}" = "1" ]; then
    printf '\nUNATTENDED RUN (CLAUDE_UNATTENDED=1): never ask — apply written defaults and log them to .claude/unattended-log.md; no defensible default -> mark the task Blocked with the question and MOVE ON; doctor-CRITICAL halts mutating tools (machine-enforced). Full policies: agent_docs/OPERATIONS.md.\n'
  fi
} > "$digest_f"

# The batched check chain + boot view (plugin copy; always exits 0, network
# calls timeout-bounded, boot-view failures already converted to content).
bash "${CLAUDE_PLUGIN_ROOT}/boot/cold-start.sh" > "$chain_f" 2>/dev/null || true

# Stale-halt cleanup — AFTER the chain, so the decision reads the flag
# doctor just refreshed, not last session's (round-2 review ordering fix).
# Doctor's flag lifecycle is completion-gated (a killed run leaves the last
# completed verdict in place), so flag-absent / no-CRITICAL here genuinely
# means the halt's findings are resolved; the guard re-writes the halt if
# the condition recurs.
_halt="$root/.claude/unattended-halt.md"
_flag="$root/.claude/.framework-doctor-findings.md"
if [ -f "$_halt" ]; then
  if [ ! -f "$_flag" ] || ! head -n 10 "$_flag" | grep -Eq '\*\*Findings:\*\*[[:space:]]+[1-9][0-9]*[[:space:]]+CRITICAL'; then
    rm -f "$_halt" 2>/dev/null && printf '(cleared a stale .claude/unattended-halt.md — its CRITICAL findings are resolved)\n' >> "$chain_f"
  fi
fi

budget=8000
dsize=$(wc -c < "$digest_f" 2>/dev/null || echo 0)
csize=$(wc -c < "$chain_f" 2>/dev/null || echo 0)

cat "$digest_f"
if [ $((dsize + csize)) -le "$budget" ]; then
  cat "$chain_f"
else
  # Clamp (round-4 P3): if the digest alone ever exceeds the budget, a
  # negative -c count would mean "all but the last N bytes" to GNU head and
  # blow through the inline ceiling.
  rem=$((budget - dsize))
  [ "$rem" -gt 0 ] && head -c "$rem" "$chain_f" 2>/dev/null
  printf '\n[check-chain/boot view truncated for the SessionStart size ceiling — run: bash %s/boot/cold-start.sh]\n' "${CLAUDE_PLUGIN_ROOT}"
fi
exit 0
