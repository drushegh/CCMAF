#!/usr/bin/env bash
set -euo pipefail
# verify-sol.sh <advisor> <topic> <nonce>
#
# FAIL-CLOSED verification of a codex advisory consult produced by codex-run.sh (TASK-131,
# Fable amendment A4). Analog of /fable's verify-turn.sh, but for the codex provider. PASSES
# only if EVERY check passes; ANY unexpected / missing / unparseable state → FAIL. Reads
# `_advisors/<topic>/.run-<advisor>/{status,session.jsonl,last.txt}`.
#
# HONEST CEILING (Fable): codex's session log records the model the CLIENT requested
# (client-attestation), NOT a server-attested model id like /fable's `.message.model`. A PASS
# means "the pinned CLI ran and the session confirms this model+nonce were REQUESTED and a
# response was produced" — it does NOT prove the server served that exact model. Weight
# Sol/Terra/Luna opinions accordingly on high-stakes calls.

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/advisors-lib.sh"
# shellcheck source=.claude/framework/advisors/advisors-lib.sh disable=SC1091
. "$LIB"

advisor="${1:?usage: verify-sol.sh <advisor> <topic> <nonce>}"
topic="${2:?missing <topic>}"
nonce="${3:?missing <nonce>}"

repo="$(advisors_repo_root)"
run_dir="$repo/_advisors/$topic/.run-$advisor"
session="$run_dir/session.jsonl"
last="$run_dir/last.txt"

expected_model="$(registry_get "advisors.$advisor" model)"
pin="$(registry_get providers.codex version_pin)"
CODEX="${CODEX_BIN:-$(command -v codex || true)}"

fail() { printf 'verify-sol: FAIL — %s\n' "$1" >&2; exit 1; }

# 1) The run itself must have reported OK.
[[ -f "$run_dir/status" ]] || fail "no status file — codex-run.sh did not complete for $advisor/$topic"
run_status="$(cat "$run_dir/status")"
[[ "$run_status" == OK* ]] || fail "run status is not OK: $run_status"

# 2) Artifacts must exist and be non-empty.
[[ -s "$session" ]] || fail "session.jsonl missing/empty ($session) — cannot attest the model"
[[ -s "$last" ]]    || fail "last.txt missing/empty — no response to promote"

# 3) Model pin known (fail-closed: a blank pin is not a pass).
[[ -n "$expected_model" ]] || fail "no expected model in registry for advisor '$advisor'"
[[ -n "$pin" ]] || fail "providers.codex version_pin is BLANK — pin the proven codex version before trusting a consult"

# 4) codex version must still match the pin (A4 — drift → fail).
[[ -n "$CODEX" ]] || fail "codex binary not resolvable (CODEX_BIN unset + not on PATH)"
ver="$("$CODEX" --version 2>/dev/null | head -1 | tr -d '\r')"
[[ -n "$ver" && "$ver" == *"$pin"* ]] || fail "codex version '$ver' != pinned '$pin' — re-run the smoke test + re-pin"

# 5) Model attestation: EVERY "model":"…" in the session must be the expected model; any other
#    (or none) → FAIL. This catches the Fable→Opus analog (wrong model requested / config drift).
mapfile -t models < <(grep -oE '"model"[[:space:]]*:[[:space:]]*"[^"]*"' "$session" \
                        | sed -E 's/.*"([^"]*)"$/\1/' | sort -u)
[[ "${#models[@]}" -ge 1 ]] || fail "no model field found in the session — cannot attest"
for m in "${models[@]}"; do
  [[ "$m" == "$expected_model" ]] || fail "session contains an UNEXPECTED model '$m' (expected only '$expected_model')"
done

# 6) Nonce binding: the staged nonce must appear in the session (prompt→session→response chain).
grep -qF "$nonce" "$session" || fail "nonce '$nonce' not found in the session — cannot bind this response to the staged brief"

printf 'verify-sol: PASS — %s ran on %s (pin %s).\n' "$advisor" "$expected_model" "$pin"
printf '  ceiling: CLIENT-attestation (the session proves the model was REQUESTED, not server-served — see header).\n'
printf '  response: %s\n' "$last"
printf '  session:  %s\n' "$session"
exit 0
