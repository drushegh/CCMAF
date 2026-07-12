Run an **advisory Fable consultation** — a design / architecture / workflow second opinion
from a `claude-fable-5` subagent — with guaranteed model integrity (fresh-spawn-only +
transcript verification), through the git-ignored shared **`_advisors/`** workbench (the same
workbench `/sol`, `/terra`, `/luna` use — so the SAME staged brief can be run past Fable AND a
codex model and their answers compared; `/consult` orchestrates that).

Fable here is **advisory only**: it critiques and designs; it never enters the build/review
loop and never edits code or state. Reach for it on hard design forks, architecture
reviews, and workflow decisions — NOT to write or review production code.

`$ARGUMENTS` is the consultation topic / question (free text). If empty, ask the user what
they want Fable's take on before proceeding.

## Config
- `FABLE_MODEL` = `claude-fable-5` — the required model id (matches `[advisors.fable]` in
  `.claude/advisors.toml`). A config value, not a literal to hardcode in logic; `verify-turn.sh`
  honours it via the env. Fable is the `provider=claude-agent` advisor — **server-attested**
  (`verify-turn.sh` reads the model the API returned), the strong end of the attestation scale.

## Step 0 — Ensure the workbench
If `_advisors/verify-turn.sh` does not exist, instantiate the shared workbench:
- Append `_advisors/` to the repo's **committed** `.gitignore` if absent (idempotent).
- Copy `.claude/framework/fable/verify-turn.sh` → `_advisors/verify-turn.sh` (`chmod +x`) — the
  script is used byte-unchanged; it just needs to live in the workbench root it verifies.
Never commit `_advisors/` contents. **Grandfather rule:** an in-flight consultation already
living under `_fable/` finishes its life there (verify it with `_fable/verify-turn.sh` as
before); **new** topics — and every `/consult` seat — go to `_advisors/`. Never migrate a
topic mid-conversation.

## Step 1 — Model-availability probe (NEVER silently downgrade)
Spawn a FRESH throwaway agent with `model: fable` and a trivial prompt carrying a nonce
(e.g. `Reply with exactly: READY <nonce>`), telling it to write
`_advisors/_probe/turns/001-fable.md`. Then verify:
`FABLE_MODEL=claude-fable-5 bash _advisors/verify-turn.sh _probe <nonce> _advisors/_probe/turns/001-fable.md`.
- **PASS** → Fable is available; continue.
- **FAIL** (spawn error, or the transcript shows Opus / anything ≠ `claude-fable-5`) → STOP
  and tell the user plainly that Fable is unavailable right now. Offer two explicit
  choices: (a) proceed on **Opus, clearly disclosed** as "NOT Fable — Opus standing in", or
  (b) abort. NEVER present Opus output as Fable's, and never downgrade silently.

## Step 2 — Stage
Pick a short kebab `<topic>` slug from `$ARGUMENTS`. Write the question + all needed context
into `_advisors/<topic>/conversation.md`. If continuing a prior consultation, include the
earlier turns — the fresh agent has no memory of them.

<!-- FABLE-DRIVER: Steps 3-4 below are the single definition of "run a Fable seat". /consult
     invokes them BY REFERENCE ("execute /fable Steps 3-4 for advisor fable against <topic>,
     round NNN") — it must NOT restate them, or the two copies drift. -->

## Step 3 — Run one turn (FRESH spawn)  ⟵ the Fable "driver" (by-reference from /consult)
Spawn a FRESH Fable agent (`model: fable`) with a prompt that:
- pastes the **mandatory guard clause** from `.claude/framework/fable/PROTOCOL.md` (skip cold
  start; make no STATE/BOARD edits — but DO use the Skill tool; write ONLY the one response
  file; echo the nonce),
- points it at `_advisors/<topic>/conversation.md`,
- names its output `_advisors/<topic>/turns/<NNN>-fable.md` (zero-padded next N; when invoked by
  `/consult`, use the panel round's shared NNN),
- embeds a fresh NONCE.
Do NOT resume a prior Fable agent — resuming drops the model to Opus. Every turn is a new spawn.

## Step 4 — Verify + promote  ⟵ the Fable "driver" (by-reference from /consult)
Run `FABLE_MODEL=claude-fable-5 bash _advisors/verify-turn.sh <topic> <NONCE> _advisors/<topic>/turns/<NNN>-fable.md`.
- **PASS** → append the response into `_advisors/<topic>/conversation.md` (promote) and relay
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
