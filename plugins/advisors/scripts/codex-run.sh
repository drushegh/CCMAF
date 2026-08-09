#!/usr/bin/env bash
set -euo pipefail
# codex-run.sh <advisor> <topic> <nonce>
#
# Runs ONE advisory consult for a codex-provider advisor (sol / terra / luna) from the staged
# brief `_advisors/<topic>/conversation.md`, into `_advisors/<topic>/.run-<advisor>/`.
#
# Design (Fable-reviewed, TASK-131): the codex agent gets an EMPTY WORLD — a dedicated,
# ephemeral CODEX_HOME (minimal config + a FRESH copy of the sub auth.json, always current),
# a read-only sandbox, an empty working dir, and the brief inlined via STDIN so it needs zero
# file access. Model + effort are pinned PER-INVOCATION from the registry (never the shared
# ~/.codex/config.toml). The ephemeral home (which holds a token copy) is SCRUBBED on exit by
# a trap. This NEVER mutates the owner's ~/.codex. Writes:
#   .run-<advisor>/{last.txt (the answer), events.jsonl (--json), session.jsonl (for verify),
#                   status (OK|TIMEOUT|ERROR|UNAVAILABLE + rc)}
#
# Meant to be launched in the BACKGROUND by the /sol runbook (an xhigh consult can exceed the
# Bash tool's 600s cap — Fable amendment A1); the script's own `timeout` is the hard kill.

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/advisors-lib.sh"
# shellcheck source=plugins/advisors/scripts/advisors-lib.sh disable=SC1091
. "$LIB"
CODEX_PREFLIGHT="$(dirname "${BASH_SOURCE[0]}")/codex-preflight.sh"

advisor="${1:?usage: codex-run.sh <advisor> <topic> <nonce>}"
topic="${2:?missing <topic>}"
nonce="${3:?missing <nonce>}"

repo="$(advisors_repo_root)"
topic_dir="$repo/_advisors/$topic"
run_dir="$topic_dir/.run-$advisor"
conversation="$topic_dir/conversation.md"

status() { printf '%s\n' "$1" > "$run_dir/status"; printf 'codex-run: %s\n' "$1"; }

mkdir -p "$run_dir"

# ── Registry bootstrap (first use) + resolution ─────────────────────────────────────────
# Standalone repos start with NO registry anywhere; create the live one from the shipped
# template at the resolved path (project .claude/ if present, else ~/.claude/) before reading.
advisors_ensure_registry >/dev/null || { status "ERROR could not create the advisors registry (see stderr)"; exit 2; }
provider="$(registry_get "advisors.$advisor" provider)"
model="$(registry_get "advisors.$advisor" model)"
effort="$(registry_get "advisors.$advisor" effort)"
timeout_min="$(registry_get providers.codex timeout_min)"; timeout_min="${timeout_min:-20}"
if [[ "$provider" != "codex" ]]; then
  status "ERROR advisor '$advisor' is provider '$provider', not codex — check [advisors.$advisor] in $(advisors_registry_path)"; exit 2
fi
if [[ -z "$model" ]]; then
  status "ERROR no model for advisor '$advisor' in the registry"; exit 2
fi
if [[ ! -f "$conversation" ]]; then
  status "ERROR staged brief missing: $conversation"; exit 2
fi

# ── Preflight (A3/A4/A5/A7) — fail loud, do not silently proceed ─────────────────────────
if ! bash "$CODEX_PREFLIGHT" > "$run_dir/preflight.txt" 2>&1; then
  cat "$run_dir/preflight.txt"
  status "UNAVAILABLE preflight FAILED — see $run_dir/preflight.txt (codex not ready)"; exit 3
fi
# Resolve the binary the same way the preflight just did (CODEX_BIN wins, else PATH).
CODEX="${CODEX_BIN:-$(command -v codex)}"

# ── Empty world: ephemeral CODEX_HOME (scrubbed on exit) + empty cwd ─────────────────────
home="$run_dir/home"
cwd="$run_dir/cwd"
rm -rf "$home" "$cwd"; mkdir -p "$home" "$cwd"
# Trap GUARANTEES the token copy is removed even on error/timeout.
trap 'rm -rf "$home"' EXIT
printf 'model = "%s"\n' "$model" > "$home/config.toml"
# Same CODEX_HOME resolution the preflight uses — a green preflight must never precede a
# status-less death here on a non-default CODEX_HOME.
auth_src="${CODEX_HOME:-$HOME/.codex}/auth.json"
if [[ ! -f "$auth_src" ]]; then
  status "ERROR codex auth missing: $auth_src (run 'codex login')"; exit 2
fi
cp "$auth_src" "$home/auth.json"

# ── Build the prompt: guard clause + the staged brief, inlined via stdin ─────────────────
prompt="$(cat <<GUARD
You are an advisory design / architecture consultant. Read the CONSULTATION BRIEF below and
respond with your analysis ONLY. This is NOT a coding task: do not run shell commands and do
not create or edit any files (your workspace is read-only by design). Write nothing but your
response. The VERY FIRST LINE of your response MUST be exactly this nonce, on its own line:
$nonce

=== CONSULTATION BRIEF ===
GUARD
)"
prompt+=$'\n'"$(cat "$conversation")"

# ── Run: background-safe, hard timeout, per-invocation pins, read-only, empty cwd ────────
: > "$run_dir/last.txt"
rc=0
printf '%s' "$prompt" | timeout "${timeout_min}m" env CODEX_HOME="$home" "$CODEX" exec \
  -m "$model" \
  -c "model_reasoning_effort=$effort" \
  -s read-only \
  -C "$cwd" \
  --skip-git-repo-check \
  --json \
  -o "$run_dir/last.txt" \
  - > "$run_dir/events.jsonl" 2>"$run_dir/err.txt" || rc=$?

# ── Copy the session OUT of the ephemeral home before the trap scrubs it ─────────────────
sess="$(find "$home/sessions" -name '*.jsonl' -type f 2>/dev/null | sort | tail -1)"
if [[ -n "$sess" && -f "$sess" ]]; then
  cp "$sess" "$run_dir/session.jsonl"
fi

# ── Classify outcome ─────────────────────────────────────────────────────────────────────
if [[ "$rc" -eq 124 ]]; then
  status "TIMEOUT after ${timeout_min}m (rc=124) — killed; do not trust partial output"
  exit 4
elif [[ "$rc" -ne 0 ]]; then
  status "ERROR codex exec rc=$rc — see $run_dir/err.txt / events.jsonl"
  exit 5
elif [[ ! -s "$run_dir/last.txt" ]]; then
  status "ERROR empty response (rc=0 but no last message captured)"
  exit 5
fi
status "OK rc=0 — response in $run_dir/last.txt, session in $run_dir/session.jsonl"
exit 0
