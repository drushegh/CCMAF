Run a **multi-advisor panel** — one task, several advisors, one comparison. `/consult` stages
the brief ONCE and runs each named advisor against the **byte-identical** brief (that input
constancy is the whole point — it's why this beats running `/sol` then `/terra` by hand, which
restages and drifts). Then it verifies each seat and compiles an **extractive divergence map**.

> **Step 0 — v2 self-route (read this first):** if `.claude/.framework-version` contains a
> `FRAMEWORK_LINE=v2` line, this project runs the CCMAF v2 plugins — invoke the
> `advisors:consult` skill (Skill tool) and follow IT instead of this file; stop reading
> here. This bare command is the v1-line copy, kept as authored source.

`$ARGUMENTS` = `<advisors> <task>` where `<advisors>` is a comma-list (`sol,terra,fable`) or
`all`. Advisors are the rows in `.claude/advisors.toml` (`fable`=Claude/server-attested;
`sol`/`terra`/`luna`=codex/client-attested). If `$ARGUMENTS` lacks a task, ask for it.

Read `.claude/framework/advisors/PROTOCOL.md` "Comparative consultation" for the report template,
the attestation footnote, and the fail-handling contract — this runbook implements it.

## Step 1 — Parse the roster (fail-closed)
- Split the first token on commas → the roster. Lowercase.
- **Reject** any id not present as `[advisors.<id>]` in `.claude/advisors.toml`, and reject the
  reserved id **`panel`** — stop and tell the user.
- `all` → resolve to every advisor row, then **AskUserQuestion** to confirm (list the resolved
  seats + count; `all` grows silently with the registry). An explicit comma-list needs NO
  confirm — typing the names IS the spend consent. (A panel burns codex plan quota
  multiplicatively — one consult per codex seat.)

## Step 2 — Allocate up front (one round, shared)
- Pick a kebab `<topic>` slug from the task.
- Choose ONE zero-padded round `NNN` (next after existing `_advisors/<topic>/turns/`).
- For each seat: output path `_advisors/<topic>/turns/<NNN>-<advisor>.md`, a FRESH unique nonce.
- Panel report path: `_advisors/<topic>/turns/<NNN>-panel.md`.

## Step 3 — Stage ONCE
Write the task + all context into `_advisors/<topic>/conversation.md` (one brief, shared by every
seat). Never restage per advisor. Ensure `_advisors/` is git-ignored and (if a fable seat)
`_advisors/verify-turn.sh` exists — see `/fable` Step 0.

## Step 4 — Launch all seats CONCURRENTLY
For a **codex** seat (`provider=codex`): run in the BACKGROUND (Bash `run_in_background: true`)
`bash .claude/framework/advisors/codex-run.sh <advisor> <topic> <nonce>`.
For the **fable** seat: **execute `/fable` Steps 3-4 by reference** (do NOT restate them) — a FRESH
`Agent(model: fable)` spawn writing `_advisors/<topic>/turns/<NNN>-fable.md`, guard clause + nonce.
Also run the codex preflight once (`codex-preflight.sh`) if any codex seat is in the roster; heed
the A5 opt-out gate if the task stages repo internals.
Launch them all, then wait for every seat to finish.

## Step 5 — Verify EVERY seat BEFORE reading ANY content (fail-closed)
For each seat, in isolation:
- codex → `bash .claude/framework/advisors/verify-sol.sh <advisor> <topic> <nonce>`.
- fable → `FABLE_MODEL=claude-fable-5 bash _advisors/verify-turn.sh <topic> <nonce> _advisors/<topic>/turns/<NNN>-fable.md`.

Classify each:
- **PASS** → a trusted seat.
- **Absent** (codex status TIMEOUT/ERROR/UNAVAILABLE, or a spawn failure): note as "did not answer".
- **Verify FAILED** (content exists but untrusted): **quarantine** — rename its turn to
  `<NNN>-<advisor>.UNVERIFIED.md`. Its content MUST NOT be read, quoted, or summarized.

Do not read any turn's body until this whole step is done. Floor: ≥1 PASS → proceed; 0 → report the
consult failed (with per-seat reasons) and stop.

## Step 6 — Compile the divergence map + present
For each PASSED **codex** seat, promote its answer into the workbench so every seat's raw turn
lives in `turns/`: copy `_advisors/<topic>/.run-<advisor>/last.txt` → `_advisors/<topic>/turns/<NNN>-<advisor>.md`
(the fable seat already wrote there directly). Then read ONLY the PASSED turns. Write
`_advisors/<topic>/turns/<NNN>-panel.md` in the exact
PROTOCOL.md template — **quote-don't-paraphrase**: verdict table (verbatim one-liners + the
registry-derived attestation label per seat) → **disagreements first** (attributed) → agreements →
unique points → your own read LAST, labelled as an (N+1)th opinion under your own name (you did not
author the seats, but you are often not neutral about the design under review — so argue openly,
never blend it into the panel). Paste the attestation footnote verbatim. List absent/quarantined
seats loudly, and name the backfill command (`/sol`, `/fable`, … on the same topic writes the next
round). Relay the map to the user with the raw-turn paths.

## Guards recap
1. **Stage once** (input constancy — the reason `/consult` exists). 2. **Verify-before-read +
quarantine** — never present unverified content. 3. **Degrade loudly**, never fail the whole panel
for one bad seat. 4. **Extractive, not synthetic** — preserve disagreement; attest identity, not
argument weight. 5. **Fresh spawn/run per seat**, never resume. 6. Single-advisor `/sol`/`/fable`/…
remain the fast path for one advisor.
