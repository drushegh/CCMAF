---
description: Advisory Terra consultation - gpt-5.6-terra via the codex CLI (ChatGPT sub), verified fail-closed
---

Run an **advisory Terra consultation** — the **`gpt-5.6-terra`** model via the OpenAI `codex`
CLI on your **ChatGPT subscription** (not the metered API). Terra is a codex-family advisor
sibling of `/advisors:sol` (bare `/sol` resolves only where the bundled CCMAF commands are
installed); use it for a second independent take, or when its profile suits the question.

`$ARGUMENTS` is the consultation topic / question (free text; if empty, ask the user first).

**This is a thin wrapper over the shared codex driver.** Follow the exact runbook in
its sibling `${CLAUDE_PLUGIN_ROOT}/commands/sol.md`, with ONE substitution: the advisor is **`terra`** (not `sol`) — the
model + effort come from `[advisors.terra]` in `advisors.toml` (project `.claude/` override, else `~/.claude/`). Concretely:

1. **Ensure workbench + registry** — `_advisors/` git-ignored + the live registry ensured (Step 0 of sol.md).
2. **Preflight** — `bash "${CLAUDE_PLUGIN_ROOT}/scripts/codex-preflight.sh"` (same env check; fail loud, no silent downgrade; heed the A5 training-opt-out gate before staging repo internals).
3. **Stage** — write the question + all context into `_advisors/<topic>/conversation.md`.
4. **Run (FRESH, background)** — `bash "${CLAUDE_PLUGIN_ROOT}/scripts/codex-run.sh" terra <topic> <NONCE>` via your Bash tool with `run_in_background: true`. Never `codex exec resume`.
5. **Verify + promote (fail-closed)** — `bash "${CLAUDE_PLUGIN_ROOT}/scripts/verify-sol.sh" terra <topic> <NONCE>`. PASS → promote `.run-terra/last.txt` to `_advisors/<topic>/turns/<NNN>-terra.md`, append to `conversation.md`, relay Terra's take **with the client-attestation caveat**. FAIL → discard, disclose, never relay.

Same guards as `/advisors:sol`: fresh-run-only · registry-driven model+effort pinned per-invocation ·
advisory / OS-read-only · fail-closed · client-attestation ceiling always disclosed.
