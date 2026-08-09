#!/usr/bin/env bash
set -euo pipefail
# watcher.sh <role> <task-id> [claims-file]        role ∈ {reviewer, verifier}
#
# "Watcher mode" (TASK-132): under a `watcher-*` mode, an open (codex) model AUGMENTS the Claude
# reviewer/verifier — a different-provider cross-check on the SAME evidence. This script is the
# single entry point the /review runbook calls once per role. It:
#   1. resolves the codex advisor for <role> under the active mode (fail-closed; NO-OP in normal);
#   2. assembles an EVIDENCE BUNDLE (the task's code diff, + optional claims) into conversation.md
#      — fail-closed if there is no evidence (the "evidence-verifier" rule: no repo access, so it
#      judges ONLY what it is handed, and never guesses);
#   3. runs the caged codex consult (codex-run.sh — read-only sandbox, empty cwd, ephemeral home);
#   4. verifies it FAIL-CLOSED (verify-sol.sh);
#   5. emits RESULT.md — the finding on PASS, a loud DEGRADED banner otherwise (NEVER unverified
#      content). Augment means this can only ADD signal; it must never block the Claude path.
#
# The Claude reviewer/verifier stays the source of truth that moves tasks — a codex-only finding
# is a claim to VERIFY, not an auto task-mover. Launch this in the BACKGROUND from the runbook:
# a codex consult can exceed the Bash tool's 600s cap (codex-run.sh owns the hard timeout).
#
# stdout status line (machine-parseable, last line):
#   WATCHER <role> <advisor|-> <NONE|PASS|DEGRADED> [result-path-or-reason]

CODE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$CODE_DIR/advisors-lib.sh"
# shellcheck source=plugins/advisors/scripts/advisors-lib.sh disable=SC1091
. "$LIB"

role="${1:?usage: watcher.sh <reviewer|verifier> <task-id> [claims-file]}"
task_id="${2:?missing <task-id>}"
claims_file="${3:-}"

repo="$(advisors_repo_root)"

# ── 1) Resolve the watcher for this role under the active mode (fail-closed) ───────────────
mode="$(mode_active)"
set +e
advisor="$(mode_watcher_advisor "$role")"
resolve_rc=$?
set -e
if [[ "$resolve_rc" -eq 3 ]]; then
  # mode_watcher_advisor already warned to stderr with the reason.
  printf 'WATCHER %s - DEGRADED misconfigured-mode(%s)\n' "$role" "$mode"
  exit 3
fi
if [[ -z "$advisor" ]]; then
  printf 'watcher: active mode %q assigns no %s watcher — nothing to do.\n' "$mode" "$role" >&2
  printf 'WATCHER %s - NONE\n' "$role"
  exit 0
fi

# ── 2) Assemble the evidence bundle ───────────────────────────────────────────────────────
# Sanitise the task id into a slug (strip brackets/spaces, lowercase).
slug="$(printf '%s' "$task_id" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed -E 's/^-+|-+$//g')"
topic="watch-$slug-$role"
topic_dir="$repo/_advisors/$topic"
conversation="$topic_dir/conversation.md"
result="$topic_dir/RESULT.md"
mkdir -p "$topic_dir"
: > "$result"

degrade() {  # <reason>
  {
    printf '# Watcher DEGRADED — %s / %s\n\n' "$role" "$task_id"
    printf 'The %s watcher (advisor `%s`, mode `%s`) produced NO trusted finding.\n\n' "$role" "$advisor" "$mode"
    printf '**Reason:** %s\n\n' "$1"
    printf 'Augment mode: proceed on the Claude %s alone — this watcher added no signal this run.\n' "$role"
  } > "$result"
  printf 'WATCHER %s %s DEGRADED %s\n' "$role" "$advisor" "$1"
}

# The task's code diff = the evidence. Exclude .claude/ framework bookkeeping (same filter the
# /review runbook uses to brief the Claude reviewer).
diff="$(cd "$repo" && git log -p --no-color --grep="$task_id" -- . ':(exclude).claude' 2>/dev/null || true)"
files="$(cd "$repo" && git log --name-only --oneline --grep="$task_id" -- . ':(exclude).claude' 2>/dev/null || true)"
if [[ -z "${diff// }" ]]; then
  degrade "no evidence — no commits/diff found for $task_id (excluding .claude/). Cannot review without evidence."
  exit 4
fi

# Role-specific instruction. codex-run.sh wraps this with the generic read-only guard + the
# nonce (first-line requirement) — here we only frame the review/verify task + the evidence.
if [[ "$role" == "reviewer" ]]; then
  instruction="$(cat <<'TXT'
You are an independent CODE REVIEWER giving a second opinion that CROSS-CHECKS a primary
reviewer. Below is the COMPLETE evidence available to you for this task: the diff of the code
changes (the project's own framework-bookkeeping paths under .claude/ are excluded by design).
You have NO repository access — review ONLY what is shown here. Evidence-verifier rule: if the
evidence is insufficient to judge something, say so explicitly ("INSUFFICIENT EVIDENCE: ...") —
do NOT guess, and do NOT assume unseen code is correct or incorrect.

Report findings by severity — P0 (blocker) / P1 (major) / P2 (minor) / P3 (nit) — each with the
file and (where visible) the line, a one-line description, and why it matters. If you find
nothing, say exactly: "No issues found in the evidence provided." Be terse and specific — this is
a cross-check, not a tutorial.
TXT
)"
else
  instruction="$(cat <<'TXT'
You are an adversarial VERIFIER cross-checking a primary verifier. Below are one or more CLAIMS
(findings a reviewer raised), followed by the supporting EVIDENCE (the code diff for this task).
For EACH claim return a verdict: CONFIRMED (the evidence supports it), REFUTED (the evidence
contradicts it), or UNVERIFIABLE (the evidence shown is insufficient to decide — prefer this over
a confident guess). You have NO repository access — judge ONLY from the evidence here; fail loud
on incomplete evidence rather than confirming or refuting on assumption. Be terse: claim ->
verdict -> one-line reason.
TXT
)"
fi

{
  printf '%s\n\n' "$instruction"
  printf '## Task\n%s\n\n' "$task_id"
  if [[ -n "$claims_file" && -f "$claims_file" ]]; then
    printf '## Claims to verify\n\n'
    cat "$claims_file"
    printf '\n\n'
  elif [[ -n "$claims_file" ]]; then
    printf '## Claims to verify\n(none supplied — claims file %q not found)\n\n' "$claims_file"
  fi
  printf '## Changed files\n```\n%s\n```\n\n' "$files"
  printf '## Evidence — full diff\n```diff\n%s\n```\n' "$diff"
} > "$conversation"

# ── 3) Run the caged codex consult ────────────────────────────────────────────────────────
nonce="WATCH-$(printf '%s' "$role" | tr '[:lower:]' '[:upper:]')-$(printf '%s' "$slug" | tr '[:lower:]' '[:upper:]')-$(date +%s)-${RANDOM}"
set +e
bash "$CODE_DIR/codex-run.sh" "$advisor" "$topic" "$nonce" >"$topic_dir/.watcher-run.log" 2>&1
run_rc=$?
set -e

# ── 4) Verify FAIL-CLOSED ─────────────────────────────────────────────────────────────────
set +e
verify_out="$(bash "$CODE_DIR/verify-sol.sh" "$advisor" "$topic" "$nonce" 2>&1)"
verify_rc=$?
set -e

if [[ "$verify_rc" -ne 0 ]]; then
  reason="$(printf '%s' "$verify_out" | tail -1)"
  [[ -n "$reason" ]] || reason="verify-sol failed (rc=$verify_rc); codex-run rc=$run_rc"
  degrade "watcher did not verify — $reason (content NOT used)"
  exit 5
fi

# ── 5) PASS → emit the finding (with a provenance header) ─────────────────────────────────
model="$(registry_get "advisors.$advisor" model)"
last="$topic_dir/.run-$advisor/last.txt"
{
  printf '# Watcher finding — %s / %s\n\n' "$role" "$task_id"
  printf '- advisor: `%s`  ·  model: `%s`  ·  mode: `%s`  ·  attestation: **client**-attested\n' "$advisor" "$model" "$mode"
  printf '- augment: this CROSS-CHECKS the Claude %s; a codex-only finding is a claim to VERIFY, not an auto task-mover.\n\n' "$role"
  printf -- '---\n\n'
  # Drop the first line if it is exactly the nonce echo (codex-run guard asks for it first).
  if [[ -s "$last" ]]; then
    if [[ "$(head -1 "$last")" == "$nonce" ]]; then tail -n +2 "$last"; else cat "$last"; fi
  else
    printf '(empty response)\n'
  fi
} > "$result"

printf 'WATCHER %s %s PASS %s\n' "$role" "$advisor" "$result"
exit 0
