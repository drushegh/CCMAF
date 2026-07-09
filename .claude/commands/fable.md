Run an **advisory Fable consultation** — a design / architecture / workflow second opinion
from a `claude-fable-5` subagent — with guaranteed model integrity (fresh-spawn-only +
transcript verification), through a git-ignored `_fable/` workbench.

Fable here is **advisory only**: it critiques and designs; it never enters the build/review
loop and never edits code or state. Reach for it on hard design forks, architecture
reviews, and workflow decisions — NOT to write or review production code.

`$ARGUMENTS` is the consultation topic / question (free text). If empty, ask the user what
they want Fable's take on before proceeding.

## Config
- `FABLE_MODEL` = `claude-fable-5` — the required model id. This is a config value, not a
  literal to hardcode in logic; change it here (and it is honoured by `verify-turn.sh` via
  the env) if the Fable model id ever changes.

## Step 0 — Ensure the workbench
If `_fable/` does not exist, instantiate it:
- Copy `.claude/framework/fable/PROTOCOL.md` → `_fable/PROTOCOL.md` and
  `.claude/framework/fable/verify-turn.sh` → `_fable/verify-turn.sh` (`chmod +x` it).
- Append `_fable/` to the repo's **committed** `.gitignore` (idempotent — check it isn't
  already there first; use the committed `.gitignore`, NOT `.git/info/exclude`, so the
  convention travels with the repo).
Never commit `_fable/` contents.

## Step 1 — Model-availability probe (NEVER silently downgrade)
Spawn a FRESH throwaway agent with `model: fable` and a trivial prompt carrying a nonce
(e.g. `Reply with exactly: READY <nonce>`), telling it to write
`_fable/_probe/turns/001-response.md`. Then verify:
`FABLE_MODEL=claude-fable-5 bash _fable/verify-turn.sh _probe <nonce>`.
- **PASS** → Fable is available; continue.
- **FAIL** (spawn error, or the transcript shows Opus / anything ≠ `claude-fable-5`) → STOP
  and tell the user plainly that Fable is unavailable right now. Offer two explicit
  choices: (a) proceed on **Opus, clearly disclosed** as "NOT Fable — Opus standing in", or
  (b) abort. NEVER present Opus output as Fable's, and never downgrade silently.

## Step 2 — Stage
Pick a short kebab `<topic>` slug from `$ARGUMENTS`. Write the question + all needed context
into `_fable/<topic>/conversation.md`. If continuing a prior consultation, include the
earlier turns — the fresh agent has no memory of them.

## Step 3 — Run one turn (FRESH spawn)
Spawn a FRESH Fable agent (`model: fable`) with a prompt that:
- pastes the **mandatory guard clause** from `_fable/PROTOCOL.md` (skip cold start; touch
  nothing under `.claude/` or `CLAUDE.md`; write ONLY the one response file; echo the nonce),
- points it at `_fable/<topic>/conversation.md`,
- names its output `_fable/<topic>/turns/<NNN>-response.md` (zero-padded next N),
- embeds a fresh NONCE.
Do NOT resume a prior Fable agent — resuming drops the model to Opus. Every turn is new.

## Step 4 — Verify + promote
Run `FABLE_MODEL=claude-fable-5 bash _fable/verify-turn.sh <topic> <NONCE>`.
- **PASS** → append the response into `_fable/<topic>/conversation.md` (promote) and relay
  Fable's take to the user.
- **FAIL** → discard the turn, tell the user it could not be verified as Fable, and offer to
  retry or fall back per Step 1's disclosed-Opus option. NEVER promote an unverified turn.

## Step 5 — Continue or close
For another turn, repeat Steps 3–4 with a NEW spawn + NEW nonce (continuity lives in
`conversation.md`). When done, the workbench stays (git-ignored) for the next `/fable`.

## Guards recap
1. **Fresh-spawn-only** (resume → silent Opus). 2. **`FABLE_MODEL` is config, not a
hardcoded literal.** 3. **Advisory / design-only** — never in the build/review loop, never
edits code or state.
