Run an **advisory Sol consultation** — a design / architecture / workflow second opinion from
the **`gpt-5.6-sol`** model via the OpenAI **`codex` CLI**, billed to your **ChatGPT
subscription (NOT the metered API)**. This is the codex-provider sibling of `/fable`, for when
Fable is unavailable or when you want a second, independent advisor.

`$ARGUMENTS` is the consultation topic / question (free text). If empty, ask the user what they
want Sol's take on before proceeding.

Sol is **advisory only** here: it critiques and designs; it never enters the build/review loop
and never edits code or state. The codex agent runs OS-sandboxed read-only in an empty
directory, so its agency is caged by construction.

## Config
The advisor is defined in the **consumer-owned** registry `.claude/advisors.toml` (row
`[advisors.sol]` → `provider="codex"`, `model="gpt-5.6-sol"`, `effort`). `.claude/framework/advisors/`
ships the driver + verifier + preflight. See `.claude/framework/advisors/PROTOCOL.md`.

## Step 0 — Ensure the workbench
If `_advisors/` is not git-ignored, append `_advisors/` to the repo's **committed** `.gitignore`
(idempotent — check first). Never commit `_advisors/` contents.

## Step 1 — Preflight (NEVER silently downgrade)
Run `bash .claude/framework/advisors/codex-preflight.sh`.
- **exit 0** → codex is ready. Note any WARNINGs; in particular, if **A5** (training opt-out)
  warns and this consult will stage **repository internals**, STOP and tell the user to verify
  their ChatGPT account's training opt-out at chatgpt.com, then `touch .claude/.codex-training-optout-confirmed`.
  A trivial/generic question with no repo internals may proceed.
- **exit 1 (FAIL)** → tell the user Sol is unavailable and why (paste the failing lines).
  Do NOT fall back to another model silently. Offer: fix the blocker, or use `/fable` instead.

## Step 2 — Stage
Pick a short kebab `<topic>` slug from `$ARGUMENTS`. Write the question + ALL needed context
into `_advisors/<topic>/conversation.md` (the advisor has no memory and no file access — inline
everything). If continuing a prior consultation, include the earlier turns.

## Step 3 — Run one turn (FRESH, background)
Pick a fresh unique NONCE (e.g. `SOL-<topic>-<something>`). Run the driver **in the background**
(an `xhigh` consult can exceed the Bash tool's 600s cap — Fable A1):

    bash .claude/framework/advisors/codex-run.sh sol <topic> <NONCE>

(via your Bash tool with `run_in_background: true`). It stages the brief into a dedicated,
ephemeral `CODEX_HOME` (minimal config + a fresh, scrubbed-on-exit copy of the sub auth),
inlines the brief via stdin, pins model+effort per-invocation, runs read-only in an empty cwd,
and writes `_advisors/<topic>/.run-sol/{last.txt, session.jsonl, status, …}`. Do NOT use
`codex exec resume` — every turn is a fresh run (continuity lives in `conversation.md`).

When it completes, read `_advisors/<topic>/.run-sol/status` (OK / TIMEOUT / ERROR / UNAVAILABLE).

## Step 4 — Verify + promote (fail-closed)
Run `bash .claude/framework/advisors/verify-sol.sh sol <topic> <NONCE>`.
- **PASS** → promote `.run-sol/last.txt` to `_advisors/<topic>/turns/<NNN>-sol.md` (zero-padded
  next N), append it into `conversation.md`, and relay Sol's take to the user. **Always relay the
  verifier's client-attestation caveat** — a Sol PASS proves the model was *requested* + a
  response produced, not that the server *served* `gpt-5.6-sol` (weaker than Fable's
  server-attested verify).
- **FAIL** → discard the turn, tell the user it could not be verified as `gpt-5.6-sol`, paste the
  FAIL reason, and offer to retry or use `/fable`. NEVER promote or relay an unverified turn.

## Step 5 — Continue or close
For another turn, repeat Steps 3–4 with a NEW background run + NEW nonce (continuity lives in
`conversation.md`). The `.run-sol/` scratch (incl. the ephemeral token copy) is scrubbed by the
driver on exit; the workbench stays (git-ignored) for the next `/sol`.

## Guards recap
1. **Fresh-run-only** (no `codex exec resume`). 2. **Model + effort are registry config**, pinned
per-invocation, not hardcoded and not from the shared `~/.codex/config.toml`. 3. **Advisory /
read-only** — never in the build/review loop; OS-sandboxed. 4. **Fail-closed + no silent
downgrade.** 5. **Client-attestation ceiling** — always disclosed.
