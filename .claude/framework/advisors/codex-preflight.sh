#!/usr/bin/env bash
set -euo pipefail
# codex-preflight.sh — one-shot ENVIRONMENT-INTEGRITY check for the codex advisor provider
# (Sol / Terra / Luna). Run once per session before spending a real consult.
#
# Implements the Fable amendments, READ-ONLY:
#   A3  resolve a deliberate codex binary (CODEX_BIN env → PATH → warn on the ~/.codex cache
#       copy → FAIL if none). Reports `codex --version` (a LOCAL call — no model, no sub spend).
#   A4  compare the version to the registry's [providers.codex] version_pin; mismatch → FAIL.
#   A5  warn unless the ChatGPT training opt-out has been attested (a one-time human action).
#   A7  warn if an API key still sits in ~/.codex/auth.json (sub-only is then a *preference*,
#       not forced); FAIL if the ChatGPT sub tokens are absent (not logged in).
#
# NEVER runs a model consult and NEVER mutates auth.json / config.toml. Exit 0 = OK to
# consult; exit 1 = FAIL (do not consult). WARN lines are advisory and do not fail.

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/advisors-lib.sh"
# shellcheck source=.claude/framework/advisors/advisors-lib.sh disable=SC1091
. "$LIB"

FAIL=0
WARN=0
say()  { printf '%s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$*"; WARN=$((WARN + 1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL + 1)); }

CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
AUTH_JSON="$CODEX_HOME_DIR/auth.json"
CACHE_BIN="$CODEX_HOME_DIR/.sandbox-bin/codex.exe"

say "codex preflight (advisor provider)"
say "──────────────────────────────────"

# ── A3: resolve the codex binary ─────────────────────────────────────────────────────────
CODEX=""
if [[ -n "${CODEX_BIN:-}" ]]; then
  if [[ -x "$CODEX_BIN" ]] || command -v "$CODEX_BIN" >/dev/null 2>&1; then
    CODEX="$CODEX_BIN"; ok "A3 binary: CODEX_BIN → $CODEX"
  else
    bad "A3 binary: CODEX_BIN set but not executable: $CODEX_BIN"
  fi
elif command -v codex >/dev/null 2>&1; then
  CODEX="$(command -v codex)"; ok "A3 binary: codex on PATH → $CODEX"
elif [[ -x "$CACHE_BIN" ]]; then
  CODEX="$CACHE_BIN"
  warn "A3 binary: only the ~/.codex cache copy found ($CACHE_BIN). This is a SMELL — likely a"
  warn "   helper/cache artifact, not a deliberate install, and a codex housekeeping pass may"
  warn "   delete it. Do a real install (npm/winget) and set CODEX_BIN to the resolved path."
else
  bad "A3 binary: no codex found (CODEX_BIN unset, not on PATH, no cache copy). Install codex + set CODEX_BIN."
fi

# ── A4: version + pin (LOCAL --version call only) ────────────────────────────────────────
VERSION=""
if [[ -n "$CODEX" ]]; then
  if VERSION="$("$CODEX" --version 2>/dev/null | head -1 | tr -d '\r')"; then
    ok "A4 version: $VERSION"
  else
    bad "A4 version: '$CODEX --version' failed — binary present but not runnable."
  fi
  PIN="$(registry_get providers.codex version_pin || true)"
  if [[ -z "$PIN" ]]; then
    warn "A4 pin: [providers.codex] version_pin is BLANK. Record '$VERSION' in .claude/advisors.toml"
    warn "   once you have proven a consult, so the verifier can fail-closed on future drift."
  elif [[ -n "$VERSION" && "$VERSION" != *"$PIN"* ]]; then
    bad "A4 pin: version '$VERSION' != pinned '$PIN' — codex drifted. Re-run the smoke test + re-pin before trusting a consult."
  elif [[ -n "$VERSION" ]]; then
    ok "A4 pin: matches version_pin ($PIN)"
  fi
fi

# ── A7: auth is the ChatGPT sub, not the API key ─────────────────────────────────────────
if [[ -f "$AUTH_JSON" ]]; then
  if grep -Eq '"(access_token|id_token|refresh_token|account_id)"[[:space:]]*:[[:space:]]*"[^"]' "$AUTH_JSON"; then
    ok "A7 auth: ChatGPT sub tokens present (OAuth)."
  else
    bad "A7 auth: no ChatGPT sub tokens in auth.json — not logged in. Run 'codex login' (ChatGPT), do NOT use an API key."
  fi
  if grep -Eq '"OPENAI_API_KEY"[[:space:]]*:[[:space:]]*"[^"]' "$AUTH_JSON"; then
    warn "A7 auth: an OPENAI_API_KEY is STILL in auth.json → sub-only is a preference, not forced. If codex's"
    warn "   OAuth refresh fails mid-run it can silently bill the API. Strip the key (owner action) for a hard guarantee."
  else
    ok "A7 auth: no API key in auth.json — sub is the only representable auth (forced)."
  fi
else
  bad "A7 auth: no auth.json at $AUTH_JSON — codex is not authenticated. Run 'codex login'."
fi

# ── A5: ChatGPT training opt-out attestation (one-time human action) ─────────────────────
OPTOUT_MARK="$(advisors_repo_root)/.claude/.codex-training-optout-confirmed"
if [[ -f "$OPTOUT_MARK" ]]; then
  ok "A5 data-governance: training opt-out attested ($(basename "$OPTOUT_MARK"))."
else
  warn "A5 data-governance: a consumer ChatGPT sub may TRAIN on your traffic, and consults stage repo"
  warn "   internals. Verify the account's data-controls opt-out at chatgpt.com, then attest once:"
  warn "   touch .claude/.codex-training-optout-confirmed"
fi

say "──────────────────────────────────"
if [[ "$FAIL" -gt 0 ]]; then
  say "codex preflight: FAIL ($FAIL blocking, $WARN warning) — do NOT run a consult until resolved."
  exit 1
fi
if [[ "$WARN" -gt 0 ]]; then
  say "codex preflight: OK with $WARN warning(s) — consults can run, but address the warnings."
else
  say "codex preflight: OK — environment integrity verified."
fi
exit 0
