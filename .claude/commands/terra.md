Run an **advisory Terra consultation** — the **`gpt-5.6-terra`** model via the OpenAI `codex`
CLI on your **ChatGPT subscription** (not the metered API). Terra is a codex-family advisor
sibling of `/sol`; use it for a second independent take, or when its profile suits the question.

> **Step 0 — v2 self-route (read this first):** if `.claude/.framework-version` contains a
> `FRAMEWORK_LINE=v2` line, this project runs the CCMAF v2 plugins — invoke the
> `advisors:terra` skill (Skill tool) and follow IT instead of this file; stop reading
> here. This bare command is the v1-line copy, kept as authored source.

`$ARGUMENTS` is the consultation topic / question (free text; if empty, ask the user first).

**This is a thin wrapper over the shared codex driver.** Follow the exact runbook in
`.claude/commands/sol.md`, with ONE substitution: the advisor is **`terra`** (not `sol`) — the
model + effort come from `[advisors.terra]` in `.claude/advisors.toml`. Concretely:

1. **Ensure workbench** — `_advisors/` git-ignored (Step 0 of sol.md).
2. **Preflight** — `bash .claude/framework/advisors/codex-preflight.sh` (same env check; fail loud, no silent downgrade; heed the A5 training-opt-out gate before staging repo internals).
3. **Stage** — write the question + all context into `_advisors/<topic>/conversation.md`.
4. **Run (FRESH, background)** — `bash .claude/framework/advisors/codex-run.sh terra <topic> <NONCE>` via your Bash tool with `run_in_background: true`. Never `codex exec resume`.
5. **Verify + promote (fail-closed)** — `bash .claude/framework/advisors/verify-sol.sh terra <topic> <NONCE>`. PASS → promote `.run-terra/last.txt` to `_advisors/<topic>/turns/<NNN>-terra.md`, append to `conversation.md`, relay Terra's take **with the client-attestation caveat**. FAIL → discard, disclose, never relay.

Same guards as `/sol`: fresh-run-only · registry-driven model+effort pinned per-invocation ·
advisory / OS-read-only · fail-closed · client-attestation ceiling always disclosed.
