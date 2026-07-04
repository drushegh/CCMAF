# Orchestrator State — the post-compaction boot set

**Framework-owned (shipped + overwritten on update).** This describes an OPTIONAL pattern:
three small files that together let an orchestrating session recover its working state after
compaction without either losing it or re-reading everything.

## Why this exists

Compaction (a manual `/compact` or an automatic one) replaces the live context window with a
model-generated summary. For an orchestrating session — one juggling delegated subagents,
gates, and in-flight facts across many turns — that creates three failure modes:

- **Lost state.** Anything that lived only in the conversation (which subagent owns what
  right now, a SHA quoted several turns ago, a count that was never written down) doesn't
  survive the summary and has to be reconstructed — sometimes wrong.
- **Paraphrase drift.** Even a recovered fact tends to come back in the summary's own words.
  A SHA, a port number, a row count re-typed from memory rather than read off a command's
  actual output is how a wrong baseline enters the session — now confidently wrong instead
  of visibly uncertain.
- **Over-recovery.** The alternative — re-read the full Cold Start stack (see "Cold Start
  Sequence" in `CLAUDE.framework.md`) on every recovery — reloads tens of KB of mostly-cold
  content (the full board, every contract, progress history) to answer a question that only
  needed a few KB: what's in flight *right now*.

The fix is a small, purpose-built recovery set, read first and in a fixed order, ahead of
(and distinct from) the full Cold Start stack.

## The three files

Three files, siblings of `.claude/TASKS.md`, `.claude/STATUS.md`, etc. under `.claude/` —
committed like the other state files, read by the same session-lifecycle conventions.

| File | Captures | Updated | Not to be confused with |
| ---- | -------- | ------- | ------------------------ |
| `.claude/NOW.md` | What's in flight *this minute*: delegated subagents and what each owns, the immediate next actions in order, open asks to the human. | **Event cadence** — a subagent launches or returns, a gate passes, a decision gets taken. Not session cadence, not "whenever it's convenient." | `.claude/STATUS.md` (session-level "who's working on what," updated at session start/end) |
| `.claude/GROUND-TRUTH.md` | Bare facts only: SHAs, paths, ports, counts, IDs, schema/contract pointers. No narrative, no rationale. | The moment a new fact exists — don't batch it for later. | `.claude/DECISIONS.md` (the *why*, not the *what*) |
| `.claude/PLAYBOOK.md` | Orchestration technique: delegation-brief patterns that worked, mistakes not to repeat. About HOW THIS PROJECT'S ORCHESTRATION runs well. | Append-mostly — when a technique proves out, or a mistake costs something. | `.claude/GOTCHAS.md` (project/code behaviour — a library quirk, not a briefing pattern) |

`NOW.md` is the first thing a recovered session reads. It answers "what was I doing" before
anything else loads.

## The quote-don't-paraphrase rule

`GROUND-TRUTH.md` exists so a recovered session can **cite a fact instead of reconstructing
it from summary memory**. State this rule at the top of the file itself, in its header, so
it travels with the file:

> Quote every value here verbatim — the SHA, the path, the port, the count — never
> paraphrase it and never re-derive it from a compaction summary. If you're about to write a
> fact into this file from memory rather than from a command's actual output, re-run the
> command first.

A paraphrased SHA is worse than a missing one: a missing fact is visibly a `[GAP]`; a
paraphrased one looks authoritative and is silently wrong.

## Boot order after compaction

Read the boot set in this order, before anything else:

1. `.claude/NOW.md` — what's in flight, right now.
2. `.claude/GROUND-TRUTH.md` — the facts that in-flight work depends on.
3. The 10 newest `.claude/DECISIONS.md` entries — the same window Cold Start step 6 already
   reads, so this isn't extra work, just done earlier.
4. `.claude/PLAYBOOK.md` + `.claude/GOTCHAS.md` — technique and traps, orchestration-level
   and code-level respectively.

Everything else — the full `TASKS.md` board, `claude-progress.txt` history beyond the last
few entries, the complete contract set — is **load-on-demand**: read it when a specific task
actually needs it, not on every recovery. The boot set above is a few KB; the full Cold Start
stack is tens of KB, most of it cold for the immediate next action.

## Why three files, not one

The split tracks two axes that don't move together: **volatility** (how often the file
changes — `NOW.md` churns on every event, `GROUND-TRUTH.md` grows steadily but never rewrites
old facts, `PLAYBOOK.md` is nearly static) and **recall purpose** (`NOW.md` answers "what was
I doing," `GROUND-TRUTH.md` answers "what's true," `PLAYBOOK.md` answers "what's worked
before"). Collapsing them into one file forces every read to wade through the other two
purposes' content, and collapsing the volatility levels means recording one new fact also
means rewriting the in-flight task list around it. Separate files let each be read (and
skipped) independently, and let the event-cadence file get rewritten constantly without
disturbing the append-mostly ones.

## How this composes with the Session Lifecycle

The pattern plugs into the four named moments in `CLAUDE.framework.md`'s "Session Lifecycle"
without adding a fifth:

- **Checkpoint** — `/pre-compact` is a deliberate Checkpoint. When the project uses this
  pattern, flushing the working-set now also means bringing `NOW.md` and `GROUND-TRUTH.md`
  current, not just the `## WIP` section of `claude-progress.txt`.
- **Re-anchor / Reconcile** — `/post-compact` (and the `session-reanchor` hook, on an
  automatic compaction) is where the boot set gets read. `NOW.md` and `GROUND-TRUTH.md` are
  what a Checkpoint just wrote, so they're the freshest committed record of in-flight work —
  read them before falling back to the broader state-file reconcile.
- **Handoff** (`/wrapup`) and **Rehydrate** (cold start) don't change: a cold start already
  reads `DECISIONS.md`/`TASKS.md`/`STATUS.md`/`claude-progress.txt` in full per the Cold Start
  Sequence, and an empty window has nothing to reconcile against. The boot set earns its keep
  specifically on the SUMMARY-in-window case — mid-session compaction — where something
  competes with disk and reading the smallest reliable set first matters.

## Worked shape (illustrative)

`NOW.md`, rewritten the instant a subagent is dispatched:

```markdown
# Now

## In flight
- Developer — dispatched 14:02 on TASK-042, owns `src/auth/session.ts` — not yet returned.
- reconciler — dispatched 14:05, running `scoped` mode on the TASK-039/TASK-041 wave boundary — not yet returned.

## Next actions (in order)
1. On Developer's return: route TASK-042 to Reviewer.
2. On reconciler's return: resolve any horizontal finding before either task moves to Ready
   for Test.

## Open asks
- None.
```

`GROUND-TRUTH.md`, appended the moment a fact is established:

```markdown
# Ground Truth

<!-- Quote every value verbatim. Never paraphrase, never re-derive from a compaction summary. -->

- Project HEAD at session start: `a1b2c3d` (verified via `git rev-parse HEAD`)
- Dev server port: `5173` (from the `npm run dev` output, not re-derived from memory)
- `contract:session-token` → `.claude/ECOSYSTEM.md` (status:stable)
```

`PLAYBOOK.md`, appended when a technique proves out or a mistake gets found:

```markdown
# Playbook

## Delegation-brief patterns that work
- Give the verifier the doer's claim AND the instruction to try to refute it — a verifier
  briefed neutrally tends to confirm by default. A doer's green self-report is a defect gate,
  never the acceptance gate (CLAUDE.framework.md "Agent Rules").

## Mistakes not to repeat
- Don't brief two agents to write the same file — last-write-wins silently drops one agent's
  work. Split by file ownership before dispatch, not after.
```

## Optional, zero-coupling

None of this is required. For a project that doesn't create these three files, `/post-compact`
behaves **exactly as it does today** (its new reading behaviour gates on `NOW.md` existing and
falls straight through otherwise). `/pre-compact` has exactly one non-adopter delta: a one-time
suggestion to create `NOW.md`, made only when a session's in-flight orchestration state would
otherwise be lost to compaction — it never writes anything unasked, never forces the pattern,
and never repeats the suggestion. Don't create the files speculatively on a project that isn't
using the pattern.

`.claude/DECISIONS.md`, `.claude/GOTCHAS.md`, `.claude/TASKS.md`, and `.claude/STATUS.md`
continue to own everything they already cover — rationale, code-level gotchas, the task
board, session-level status. This pattern is additive, not a replacement for any of them.
