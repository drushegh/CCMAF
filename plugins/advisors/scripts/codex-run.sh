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
# ~/.codex/config.toml). The ephemeral home (which holds a token copy) lives in a private
# `mktemp -d` dir OUTSIDE the repo tree and is SCRUBBED by a trap on EXIT and on INT/TERM/HUP.
# This NEVER mutates the owner's ~/.codex. Writes:
#   .run-<advisor>/{last.txt (the answer), events.jsonl (--json), session.jsonl (for verify),
#                   status (RUNNING while in flight, then OK|TIMEOUT|ERROR|UNAVAILABLE + rc)}
# `status` is reset to RUNNING before anything can fail, and an ERR trap records any unexpected
# strict-mode death — a previous run's OK can never be mistaken for this run's result.
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
# Reset FIRST — a stale OK from an earlier run must never survive a run that dies early.
status "RUNNING started $(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)"
# Any unexpected strict-mode death still leaves a truthful, non-OK status behind.
# shellcheck disable=SC2154  # _rc is assigned inside the trap body itself
trap '_rc=$?; status "ERROR unexpected failure (rc=$_rc) near line $LINENO — see stderr"' ERR
# Signals from here on (registry/preflight included) leave a non-RUNNING status; the EXIT
# trap installed below still scrubs the token home because these handlers call exit.
trap 'status "ERROR interrupted (SIGHUP) — consult aborted"; exit 129' HUP
trap 'status "ERROR interrupted (SIGINT) — consult aborted"; exit 130' INT
trap 'status "ERROR interrupted (SIGTERM) — consult aborted"; exit 143' TERM

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
# Resolve the binary EXACTLY as the preflight just did: CODEX_BIN → PATH → the ~/.codex cache
# copy (the preflight passes, with a WARN, on the cache copy alone — so must we).
CODEX="${CODEX_BIN:-}"
[[ -n "$CODEX" ]] || CODEX="$(command -v codex 2>/dev/null || true)"
if [[ -z "$CODEX" && -x "${CODEX_HOME:-$HOME/.codex}/.sandbox-bin/codex.exe" ]]; then
  CODEX="${CODEX_HOME:-$HOME/.codex}/.sandbox-bin/codex.exe"
fi
if [[ -z "$CODEX" ]]; then
  status "UNAVAILABLE codex binary not resolvable (CODEX_BIN unset, not on PATH, no cache copy)"; exit 3
fi
# The hard kill: GNU `timeout` (Linux, Git Bash) or coreutils' `gtimeout` (Homebrew macOS —
# stock macOS ships neither). Refuse an unbounded consult rather than die without a status.
TIMEOUT_BIN="$(command -v timeout 2>/dev/null || command -v gtimeout 2>/dev/null || true)"
if [[ -z "$TIMEOUT_BIN" ]]; then
  status "UNAVAILABLE no 'timeout' or 'gtimeout' on PATH (macOS: brew install coreutils)"; exit 3
fi
# Native Windows: codex's sandbox blocks every command ("blocked by policy") until
# windows.sandbox is set, and the ephemeral CODEX_HOME below carries no user config — so pin it
# per-invocation. Override with CODEX_WINDOWS_SANDBOX=<value>; set it empty to pass nothing.
win_sandbox=()
case "$(uname -s 2>/dev/null || true)" in
  MINGW*|MSYS*|CYGWIN*)
    if [[ -n "${CODEX_WINDOWS_SANDBOX-unelevated}" ]]; then
      win_sandbox=(-c "windows.sandbox=\"${CODEX_WINDOWS_SANDBOX-unelevated}\"")
    fi ;;
esac

# ── Empty world: ephemeral CODEX_HOME + empty cwd, OUTSIDE the repo tree ─────────────────
# The home holds a copy of the OAuth token, so it must never sit where git (or a sync tool)
# could pick it up: a private mktemp dir, scrubbed on EXIT and on INT/TERM/HUP.
eph_root="$(mktemp -d "${TMPDIR:-/tmp}/codex-run.XXXXXX")"
chmod 700 "$eph_root" 2>/dev/null || true
_scrub() { rm -rf "$eph_root"; }
trap _scrub EXIT
home="$eph_root/home"
cwd="$eph_root/cwd"
mkdir -p "$home" "$cwd"
# codex is a native binary on Windows: hand it Windows-form paths (Git Bash's cygpath).
if command -v cygpath >/dev/null 2>&1; then
  home="$(cygpath -m "$home")"; cwd="$(cygpath -m "$cwd")"
fi
printf 'model = "%s"\n' "$model" > "$home/config.toml"
# Same CODEX_HOME resolution the preflight uses — a green preflight must never precede a
# status-less death here on a non-default CODEX_HOME.
auth_src="${CODEX_HOME:-$HOME/.codex}/auth.json"
if [[ ! -f "$auth_src" ]]; then
  status "ERROR codex auth missing: $auth_src (run 'codex login')"; exit 2
fi
cp "$auth_src" "$home/auth.json"
chmod 600 "$home/auth.json" 2>/dev/null || true

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
rm -f "$run_dir/session.jsonl"
rc=0
printf '%s' "$prompt" | "$TIMEOUT_BIN" "${timeout_min}m" env CODEX_HOME="$home" "$CODEX" exec \
  -m "$model" \
  -c "model_reasoning_effort=$effort" \
  ${win_sandbox[@]+"${win_sandbox[@]}"} \
  -s read-only \
  -C "$cwd" \
  --skip-git-repo-check \
  --json \
  -o "$run_dir/last.txt" \
  - > "$run_dir/events.jsonl" 2>"$run_dir/err.txt" || rc=$?

# ── Copy the session OUT of the ephemeral home before the trap scrubs it ─────────────────
sess="$(find "$home/sessions" -name '*.jsonl' -type f 2>/dev/null | sort | tail -1 || true)"
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
