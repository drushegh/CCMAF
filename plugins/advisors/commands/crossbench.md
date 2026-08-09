---
description: Three-stage cross-reviewed advisor consultation ending in one consolidated design document
---

Run a **Crossbench** — a three-stage, cross-reviewed advisor consultation that ends in ONE
consolidated design/decision document. Where `/advisors:consult` (bare `/consult` resolves only
where the bundled CCMAF commands are installed) runs several advisors once and reports the
*divergence*, `/crossbench` goes further: after the independent round it has each advisor
**cross-review the others'** answers, then a fresh synthesizer **converges** everything into a single
buildable document. Reach for it on a hard design/architecture fork you intend to ACT on — the
cross-review kills plausible-but-wrong positions, and the synthesis hands you a spec, not a menu.

`$ARGUMENTS` = `[<advisors>] <task>`. `<advisors>` is an optional comma-list (default **`fable,sol`**
— the canonical pair: one Claude-attested seat + one codex seat, so the cross-review is a true
cross-MODEL check, not one model wearing two hats). Advisors are rows in `advisors.toml` (project `.claude/` override, else `~/.claude/`). If
`$ARGUMENTS` lacks a task, ask for it. The roster needs **≥2 seats and at least one `fable` seat**
(fable is the synthesizer in Stage 3); for a genuine cross-MODEL check, pair `fable` with ≥1 codex
seat. A single-advisor question is `/advisors:fable` or `/advisors:sol`; a one-round
multi-advisor compare with no cross/synthesis is `/advisors:consult`.

This burns advisor quota **multiplicatively** — a 2-seat crossbench is **5 seats** (2 diverge + 2
cross + 1 synth), each codex seat one codex-plan consult. Typing the roster IS the spend consent (as
with `/advisors:consult`); if the caller passed `all` or a large roster, confirm via **AskUserQuestion** first
(the cross round is O(N²) in seats).

Read `${CLAUDE_PLUGIN_ROOT}/scripts/PROTOCOL.md` for the attestation footnote + the fail-handling
contract — this runbook implements them across three stages.

## Stage 0 — Workbench + preflight
- Ensure the shared workbench exists: **execute `/advisors:fable` Step 0** (idempotent — `_advisors/`
  gitignored, `_advisors/verify-turn.sh` present).
- If any codex seat is in the roster, run `bash "${CLAUDE_PLUGIN_ROOT}/scripts/codex-preflight.sh"` once;
  heed the A5 opt-out gate (this brief is sent to codex/ChatGPT — stage NO repo secrets in it).
- Pick a short kebab **`<topic>`** slug from the task. Every stage lives under `_advisors/<topic>*`.
  If `_advisors/<topic>` (or `<topic>-x-*` / `<topic>-final`) already exists from earlier work,
  pick a fresh unused slug — the stage paths below assume this crossbench starts at round `001`.

## Stage 1 — Diverge (independent answers, verified)
**Execute `/advisors:consult <advisors> <task>` by reference** (the runbook at
`${CLAUDE_PLUGIN_ROOT}/commands/consult.md`) — it stages the brief ONCE to
`_advisors/<topic>/conversation.md`, runs every seat against the byte-identical brief, and **verifies
each before reading** (quarantining any that fail). You now have the verified round-1 answers at
`_advisors/<topic>/turns/001-<advisor>.md` (the consult panel it also writes is a bonus; crossbench's
value is Stages 2–3). In the staged brief, tell each seat to end with a short list of its own
**falsifiable claims** — it sharpens the cross round. **Floor: ≥2 seats verified PASS**; if fewer,
report that the crossbench cannot proceed (with per-seat reasons) and stop.

## Stage 2 — Cross (each advisor reviews the others', verified)
For each PASSED seat as **reviewer**, against the OTHER passed seats as **subject(s)**:
- Stage a sub-topic `_advisors/<topic>-x-<reviewer>/conversation.md` containing, in order: the
  original brief's **situation + fixed constraints** (so the reviewer designs within reality); the
  subject's **full Stage-1 answer EMBEDDED verbatim** (a codex reviewer runs in an empty world and
  cannot read repo files — embed, never link; embed for a fable reviewer too, for parity; with N>2
  seats, pool all N−1 other answers here); and the **cross-review task** — a one-paragraph verdict,
  where the subject is wrong / fragile / over-engineered / under-specified (each with the failure it
  causes), where the subject is simply right and should be adopted, and an adjudication of the
  specific divergences (name them). "Adversarial but fair; concrete and falsifiable; do NOT restate
  your own design."
- Run the reviewer seat FRESH against its sub-topic: codex → background
  `bash "${CLAUDE_PLUGIN_ROOT}/scripts/codex-run.sh" <reviewer> <topic>-x-<reviewer> <nonce>`; fable →
  **execute `/advisors:fable` Steps 3-4** for advisor fable against `<topic>-x-fable`. With 2 seats this is the
  clean swap (fable reviews sol, sol reviews fable) → two sub-topics.
- **Verify EVERY reviewer seat before reading** (codex → `verify-sol.sh`; fable → `verify-turn.sh`),
  promote each codex `_advisors/<topic>-x-<reviewer>/.run-<reviewer>/last.txt` →
  `.../turns/001-<reviewer>.md`, and quarantine any failure UNREAD — the same fail-closed discipline
  as Stage 1.

## Stage 3 — Converge (fable synthesis, verified)
Stage `_advisors/<topic>-final/conversation.md`: a synthesis instruction plus the **paths** of every
verified Stage-1 and Stage-2 artifact (the synthesizer is a fable Agent and reads them itself; if you
ever synthesize with a codex seat, embed the artifacts instead of linking). Tell it: fold all
artifacts into ONE consolidated, buildable document; where the cross-reviews converged, state the
resolved position as settled (don't re-argue); fold in each "adopt from the other" correction; flag
only the genuinely-residual disagreements + the empirical questions to settle at build time. Run a
FRESH fable synthesizer (**`/advisors:fable` Steps 3-4** against `<topic>-final`) → verify → the deliverable
is `_advisors/<topic>-final/turns/001-fable.md`.

## Stage 4 — Present
Relay a tight summary of the consolidated document + its path. Surface, in one line each: the
resolved divergences, and any seat absent or quarantined at any stage (name the backfill command).
The raw per-stage turns stay under `_advisors/<topic>*` for audit. Paste the PROTOCOL.md attestation
footnote verbatim.

## Guards recap
1. **Verify-before-read at EVERY stage** — never read, quote, or synthesize an unverified turn;
   quarantine it (`*.UNVERIFIED.md`) and continue.
2. **Fresh spawn/run per seat, every stage** — resuming drops fable to Opus and drifts codex.
3. **Embed for codex reviewers** (empty world); link-by-path only for the fable synthesizer Agent.
4. **≥2 verified seats to cross; a `fable` seat is required** (it synthesizes). Degrade loudly, never
   fake a stage.
5. **Reuse, don't restate** — Stage 1 IS `/advisors:consult`; the fable seats ARE `/advisors:fable`
   Steps 3-4. `/crossbench` adds only the cross + converge stages, so the shared drivers never drift.
