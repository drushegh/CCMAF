# Advisor Workbench — shared PROTOCOL (TASK-131)

One protocol, per-provider drivers. `/fable`, `/sol`, `/terra`, `/luna` are advisory
consultations that share the pillars below; only the **driver** (how a turn is run + verified)
differs per provider. This is a *convention*, not an engine — each provider's driver is a
self-contained runbook (Fable-reviewed: a generic if/else engine executed by a model is a
wrong-path risk).

## The advisors

Defined in the **consumer-owned** live registry `advisors.toml` — the project's
`.claude/advisors.toml` if present, else `~/.claude/advisors.toml` (created there on first use
from the plugin's shipped `advisors.template.toml`; consumer-owned, so edits survive plugin
updates). One row per advisor: `provider` · `model` · `effort` (provider-native vocabulary —
no unified scale).

| provider | how a turn runs | verification | attestation |
| --- | --- | --- | --- |
| `claude-agent` (fable) | in-process `Agent(model, effort)` | `verify-turn.sh` — transcript `.message.model` | **server**-attested |
| `codex` (sol/terra/luna) | external `codex exec` (ChatGPT sub, not API) | `verify-sol.sh` — session-log model + version pin | **client**-attested |

## Two codex surfaces — keep them separate

The codex provider has **two** distinct runners; they must never be conflated (one is read-only
and pure, the other writes to the workspace):

| surface | runner | command | sandbox | CODEX_HOME | output |
| --- | --- | --- | --- | --- | --- |
| **advisory text** | `codex-run.sh` | `/sol` `/terra` `/luna` `/consult` `/crossbench` | `read-only` | **ephemeral** (scrubbed; token copy) | promoted `last.txt` (text) |
| **image gen** | `codex-image-run.sh` | `/image` | `workspace-write` (scoped to `<outdir>`) | **real** `~/.codex` (the `imagegen` skill lives there) | the saved image path |

Both run on the ChatGPT **subscription** (zero metered spend) and pin the model per-invocation
from the same registry rows. But image gen needs the REAL codex home (skill discovery), write
access (to save the asset), and a long backgrounded run with a **tree-scoped** straggler reap
(gen takes ~1.5–3 min); the advisory path stays read-only, text-only, empty-world. Do NOT try to
image-gen through `codex-run.sh`, and do NOT relax `codex-run.sh` toward workspace-write. `/image`
defaults to **terra**; `fable` cannot image-gen (no `image_gen` tool — Claude text advisor only).

## The seven pillars (shared)

1. **Workbench** — `_advisors/<topic>/conversation.md` (staged brief) + `turns/NNN-<advisor>.md`
   (each promoted response; advisor-tagged so the SAME brief can be run past multiple advisors
   and their answers diffed — comparative consultation). Git-ignored. (A pre-existing
   in-flight `_fable/` topic finishes its life there — the `/fable` Step 0 grandfather rule;
   new topics all live in `_advisors/`.)
2. **Probe / preflight** — confirm the advisor is usable before spending a consult; fail LOUD,
   never silently downgrade. (codex: `codex-preflight.sh` = env integrity A3/A4/A5/A7. There is
   no cheap "is the model reachable" codex probe — the first real consult IS the probe, and
   fail-closed verify discards a bad one.)
3. **Stage** — the full question + context goes into `conversation.md`; the advisor has no
   memory between turns and (for codex) no file access — everything it sees is the staged brief.
4. **Run one turn — FRESH.** A new invocation every time; NEVER resume (`Agent` resume drops the
   model to Opus; `codex exec resume` is the same class of footgun — banned). Continuity lives in
   `conversation.md`.
5. **Verify + promote.** Run the provider's verifier; PASS → promote the response to
   `turns/NNN-<advisor>.md`, append to `conversation.md`, relay to the human. FAIL → discard,
   disclose, never relay.
6. **Fail-closed.** Any unexpected / missing / unparseable state is a FAIL, not a pass.
7. **Advisory-only.** Advisors design and critique; they never edit code or state. (codex is
   additionally caged by an OS read-only sandbox + an empty working dir — better-caged than the
   `claude-agent` advisor, whose only boundary is the prompt-level guard clause.)

## Honest verification confidence (do not conflate)

- **`claude-agent` (fable): server-attested.** `.message.model` is the model id the Anthropic
  API *returned*. A PASS proves the server served `claude-fable-5`.
- **`codex` (sol/terra/luna): client-attested.** The session log records the model the CLI
  *requested*. A PASS proves the pinned CLI ran and the session confirms this model + nonce were
  requested and a response was produced — it does NOT prove the server served that exact model.
  A server-side substitution would still PASS. Weight codex opinions accordingly on high-stakes
  calls; this ceiling is irreducible from the client.

**Attestation footnote (paste VERBATIM wherever attestation labels appear):**
> *client-attested = the session proves which model was requested and pinned; a provider-side
> substitution would not be detected. server-attested = the transcript records the model that
> actually served the response. Attestation calibrates IDENTITY confidence (am I getting the
> model I chose), NOT argument weight — a correct client-attested answer beats a wrong
> server-attested one.*

## Comparative consultation — the `/consult` panel (TASK-131, Fable-reviewed)

`/consult <advisors> <task>` runs ONE staged brief past several advisors for a one-shot
comparison. Its whole methodological value is **input constancy** — every seat answers the
*byte-identical* brief (stage once; never restage per advisor). It is a runbook the orchestrator
executes over the existing per-advisor drivers, NOT a new engine.

**Non-negotiable ordering — verify BEFORE you read.** Verify every seat's turn (its provider
verifier, fail-closed) before reading ANY turn's content. Reading an unverified turn contaminates
the comparison.

**Partial failure — degrade loudly, never fail the whole panel, never show unverified content:**
- **Absent** (timeout / launch error / unavailable): the seat did not answer; proceed with the
  passers; state it plainly in the header.
- **Verification FAILED** (nonce / model / version): content exists but is UNTRUSTED → **quarantine
  it**: rename `turns/NNN-<advisor>.UNVERIFIED.md`, and it NEVER enters the report (not quoted,
  not summarized, not shown-with-a-warning); report the failure + reason loudly.
- Floor: ≥1 verified seat → present, labelled "degraded to single-advisor" if only one; 0 → the
  consult failed. No quorum config. Backfill a failed seat with its single-advisor command
  (`/sol`, `/fable`, …) on the SAME topic — it writes the next-round turn; no retry machinery here.

**Execution:** concurrent (codex seats = background jobs with per-invocation ephemeral homes; the
Fable seat = a background `Agent` spawn). The orchestrator allocates ONE round `NNN` shared by all
seats (`NNN-sol.md`, `NNN-fable.md`, …) and a fresh per-seat nonce, up front. Presentation order =
roster order as typed. **Spend consent = the explicit roster** (typing `sol,terra,fable` IS the
consent — no confirm); ONLY `all` gets an AskUserQuestion confirm listing the resolved seats +
count (it grows silently with the registry). `panel` is a **reserved, illegal advisor id** — the
report file is `turns/NNN-panel.md` and must never masquerade as a seat.

**The panel report = an EXTRACTIVE DIVERGENCE MAP, never free-form synthesis.** Synthesis launders
the independent signal you paid N models for; quote, attribute, preserve disagreement. Write it to
`turns/NNN-panel.md` in this exact shape, and obey **quote-don't-paraphrase** (the
orchestrator-state rule — cite verbatim, never reconstruct):

```
# Panel: <topic> (round NNN) — requested <roster>; answered <passers>; <failures noted>

## Verdicts (verbatim)
| advisor | attestation | model | verdict (quoted one-liner) |
| sol   | client-attested | gpt-5.6-sol    | "…" |
| fable | server-attested | claude-fable-5 | "…" |

## Disagreements (the expensive information — first)
- <point>: sol says "…" ; fable says "…" (why they differ)

## Agreements
- <point> — sol, fable (quoted/attributed briefly)

## Unique points (raised by only one seat)
- <advisor>: "…"

## Orchestrator's read (an (N+1)th opinion — NOT a summary of the panel)
<the main model's own recommendation, clearly separated and labelled; it did not author the seats
but is often not neutral about the design under review — so it argues under its own name here.>

<attestation footnote, verbatim>
Raw turns: turns/NNN-sol.md · turns/NNN-fable.md · …
```

## Cross-review consultation — the `/crossbench` three-stage panel

`/crossbench [<advisors>] <task>` extends `/consult` from one round into three: **Diverge** (Stage 1
IS a `/consult` run — independent, verified answers), **Cross** (each advisor cross-reviews the
others' answers — a fresh reviewer seat per pairing, staged with the subject's answer embedded so a
codex reviewer's empty world still sees it), and **Converge** (a fresh `fable` synthesizer folds
every turn into ONE buildable document). Default roster `fable,sol` — a Claude seat + a codex seat,
so the cross-review is a true cross-MODEL check, not one model wearing two hats. Same non-negotiables
as the panel: **verify-before-read at EVERY stage**, fresh spawn/run per seat, quarantine the
unverified unread. It reuses the existing drivers — Stage 1 is `/consult`, the fable seats are
`/fable` Steps 3-4 — so nothing is restated and the drivers never drift. Cost scales
multiplicatively: a 2-seat crossbench is 5 seats (2 + 2 + 1).

**Why `/crossbench` may SYNTHESIZE when the `/consult` panel must not.** The panel bans free-form
synthesis because it launders the independent signal *before it has been tested*. `/crossbench` earns
the synthesis: Converge runs only AFTER Cross has each model adversarially stress-test the other's
positions, so the synthesizer consolidates claims that already survived cross-examination — not raw
divergence. Rule of thumb: `/consult` when you want a divergence map to decide from yourself;
`/crossbench` when you want a single consolidated design to ACT on.

## Watcher mode — open models AUGMENT review + verify (TASK-132)

The advisors above are *pull* (you invoke `/sol`, `/consult`). **Watcher mode** is *push*: a
framework **mode** wires a codex advisor in as a standing cross-check on the two ADVISORY roles a
model can safely fill — **reviewer** and **verifier**. It is the narrow, safe first cut of
multi-model modes (the fable+sol panel's verdict, TASK-132): reassign advisory roles only; keep
every repository-writing role on native Claude agents.

**Config** — `[modes]` in the live `advisors.toml` (project `.claude/` override, else `~/.claude/`):

```toml
[modes]
active = "normal"          # normal = all-Claude, nothing added (default)
[modes.watcher-low]
reviewer = "terra"
verifier = "terra"
[modes.watcher-medium]
reviewer = "sol"
verifier = "terra"
[modes.watcher-high]
reviewer = "sol"
verifier = "sol"
```

The tiers are **cost/rigour dials**, not independence dials. Any `[modes.<name>]` is legal; only
`reviewer`/`verifier` slots are honoured. Switch with `/mode <name>`.

**Four load-bearing rules:**

1. **Augment, never replace.** The Claude reviewer/verifier ALWAYS still runs and stays the source
   of truth that moves tasks. The codex watcher is an *added* signal. A **codex-only** finding is a
   **claim to VERIFY**, never an auto task-mover — Claude + the hooks remain the enforcement plane.
   (The panel's core point: a non-Claude writer runs *outside* that plane; a non-Claude *watcher*
   never touches it.)
2. **Advisory roles only — by construction.** The resolver (`mode_watcher_advisor`) accepts
   `reviewer|verifier` and nothing else; there is no doer role to route to, so
   `developer = "<codex>"` is impossible, not merely rejected. Codex-as-doer is a separate, gated,
   patch-emission project (deferred — TASK-132).
3. **Evidence-verifier, fail-closed.** The watcher runs in the same read-only cage as any codex
   consult — no repo access. It judges ONLY the bundle it is handed (`watcher.sh` stages the task's
   diff, plus the reviewer's claims for a verify pass). Empty/insufficient evidence → **DEGRADE**,
   never guess. A codex seat that is unknown or non-codex → **fail closed** (no watcher), never a
   silent wrong-model review.
4. **Client-attested, and degrade loudly.** A watcher finding carries the same client-attestation
   ceiling as `/sol` (see the table above) and is verified fail-closed (`verify-sol.sh`) before it
   is ever read. A watcher that times out / errors / fails verification produces a **DEGRADED**
   banner and the review proceeds on the Claude role alone — augment can only add, never block.

**Mechanism.** `watcher.sh <role> <task-id> [claims-file]` is the one entry point: resolve (mode →
advisor, fail-closed) → assemble the evidence bundle → `codex-run.sh` (caged) → `verify-sol.sh`
(fail-closed) → emit `_advisors/watch-<task>-<role>/RESULT.md` (the finding on PASS; a DEGRADED
banner otherwise — never unverified content). `/review` launches it in the BACKGROUND (a consult
can exceed the Bash 600s cap) and, on PASS, compiles a **cross-check**: both-flagged / only-Claude
/ only-codex. `/build` inherits all of this by calling `/review`.
