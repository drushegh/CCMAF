# /council — Convene a Council of Agents

Run a high-stakes decision through five independent advisors who deliberate, peer-review each other anonymously, and produce a synthesised verdict plus a scannable HTML report.

## When to Invoke

**Mandatory triggers** (user said any of these — run `/council` immediately):
- "council this"
- "run the council"
- "war room this"
- "pressure-test this" / "stress-test this"
- "debate this"

**Strong triggers** (genuine tradeoffs, expensive-to-be-wrong decisions):
- "should I X or Y" with real stakes
- "which option" / "which approach"
- "is this the right move"
- "validate this"
- "I can't decide"

In strong-trigger cases, **proactively suggest** `/council` once: "This sounds like a council-worthy decision. Run /council? (y/n)" — don't auto-invoke.

**Do NOT invoke for:**
- Factual questions ("how does X work")
- Creation tasks ("write me an X")
- Casual "should I" without meaningful stakes
- Anything where being wrong is cheap and reversible

## The Five Advisors

- **Contrarian** — hunts for what will fail
- **First Principles** — strips assumptions, often reframes the question
- **Expansionist** — finds upside others miss
- **Outsider** — fresh eyes, catches insider blind spots
- **Executor** — Monday-morning feasibility

A sixth agent, the **Chairman**, synthesises the council's output and writes the transcript and HTML report.

## Protocol (run in this exact order)

### Phase 0 — Frame the question

You (the orchestrator) do this in main context. The advisors don't.

1. Read the user's question. If it's a one-liner with implicit context, enrich it:
   - Read project `CLAUDE.md` for stakes, constraints, in-flight work
   - Read `MEMORY.md` for relevant user context
   - Read any files the user cited
2. Restate the question with: **what's being decided, what's at stake, the relevant constraints, the cited context**. Aim for one short paragraph.
3. Pick a slug from the question (e.g. "council-vs-drift", "framework-restructure"). Sluggify: lowercase, hyphens, ≤40 chars.
4. Compute the run id: `YYYY-MM-DD-HHMM-<slug>` (use `date +%Y-%m-%d-%H%M`).
5. Create the output directory: `.claude/council/<run-id>/`.
6. Write the framed question to `.claude/council/<run-id>/question.md` so all phases reference the same artefact.

### Phase 1 — Independent takes (parallel)

Send **a single message with five Task tool calls** to:
- `council-contrarian`
- `council-first-principles`
- `council-expansionist`
- `council-outsider`
- `council-executor`

Each prompt has the shape:

```
You are operating in **Mode 1 (Initial Take)**.

## Framed question
<paste the framed question from question.md>

## Cited files (read only if helpful)
<list paths the user referenced; advisors should NOT go fishing>

## Your task
Per your agent definition, produce 150-300 words of independent analysis. End with a clear verdict in your voice. Do not hedge.
```

Wait for all five responses. Save each to `.claude/council/<run-id>/phase1-<advisor>.md` (verbatim, no edits).

### Phase 2 — Peer review (parallel, anonymised)

1. **Anonymise.** Build a randomised mapping of the five advisors to letters A-E. Pick any non-alphabetical assignment — it need not be reproducible across runs; what matters is that the mapping is saved so the chairman can de-anonymise. Save the mapping to `.claude/council/<run-id>/anon-map.json` for the chairman.
2. Concatenate the five phase-1 responses into a single `responses-anon.md` block:
   ```
   ## Response A
   <phase-1 text of advisor mapped to A>

   ## Response B
   ...
   ```
   Do **not** include advisor names anywhere in this block.
3. Send **a single message with five Task tool calls** — one to each advisor agent, but with a Mode 2 prompt:

```
You are operating in **Mode 2 (Peer Review)**.

## Framed question (for context)
<paste framed question>

## Five anonymised responses
<paste responses-anon.md>

## Your task
One of these five responses is yours, even though they are anonymised —
and reviewers reliably rate their own framing as "strongest" (observed in
the field: advisors self-identified and self-preferred). Counter this
deliberately:
- First, privately identify which response is most likely YOURS (closest
  to your own framing). You may not select it as Strongest.
- Strongest: of the OTHER responses, which makes the case that most
  convincingly argues AGAINST your own framing, and why
- Biggest blind spot: which response has the worst hole, and what it is
- What everyone missed: something none of the five caught
```

Save each review to `.claude/council/<run-id>/phase2-<advisor>.md`.

### Phase 3 — Chairman synthesis (single call)

Send **one Task tool call** to `council-chairman`:

```
## Framed question
<paste>

## Phase 1 — Independent Takes (with attribution)
### Contrarian
<phase1-contrarian.md content>

### First Principles
<phase1-first-principles.md content>

### Expansionist
<phase1-expansionist.md content>

### Outsider
<phase1-outsider.md content>

### Executor
<phase1-executor.md content>

## Phase 2 — Peer Reviews (anonymised)
### Anonymisation map
A = <advisor>, B = <advisor>, C = <advisor>, D = <advisor>, E = <advisor>
(advisors saw the responses without these labels)

### Contrarian's review
<phase2-contrarian.md content>

### First Principles' review
<phase2-first-principles.md content>

### Expansionist's review
<phase2-expansionist.md content>

### Outsider's review
<phase2-outsider.md content>

### Executor's review
<phase2-executor.md content>

## Output
Per your agent definition, write two files:
- `.claude/council/<run-id>/transcript.md`
- `.claude/council/<run-id>/report.html`

Both must include the synthesis (agree / clash / blind spots / recommendation / single next step).
```

Wait for the chairman to confirm both files were written.

### Phase 4 — Surface to the user

Print to the user:
- One-line summary: the chairman's recommendation
- The single next step
- Paths to `transcript.md` and `report.html`

Suggest opening the HTML report: `start .claude/council/<run-id>/report.html` (Windows) or equivalent.

## Output Layout

```
.claude/council/<run-id>/
├── question.md            # framed question (orchestrator wrote it)
├── phase1-contrarian.md
├── phase1-first-principles.md
├── phase1-expansionist.md
├── phase1-outsider.md
├── phase1-executor.md
├── responses-anon.md      # input for phase 2
├── anon-map.json          # A-E → advisor mapping
├── phase2-contrarian.md
├── phase2-first-principles.md
├── phase2-expansionist.md
├── phase2-outsider.md
├── phase2-executor.md
├── transcript.md          # chairman wrote this
└── report.html            # chairman wrote this
```

The whole `.claude/council/` tree is gitignored — deliberations stay local.

## Constraints

- Phase 1 and Phase 2 advisor calls **must** be issued as parallel Task tool calls in a single message each. Sequential is wrong — it lets later advisors anchor on earlier output.
- Do not pass project paths (the `## Project paths` block used by framework subagents). Council advisors reason about decisions, not file layouts.
- Do not let the council touch state files (TASKS.md, STATUS.md, DECISIONS.md). The orchestrator may, after the fact, ask the user whether the verdict should be recorded.
- If the user later runs `/council` again on a related question, treat it as a fresh run (new directory, no shared context with the previous run).

## Failure Modes

- **Advisor returns >300 words for phase 1:** truncate when feeding to phase 2; note in transcript that response was truncated.
- **Advisor refuses or returns empty:** retry once with a sharpened prompt; if still empty, note "no response" in the transcript and proceed with four advisors.
- **Chairman fails to write either file:** retry the Task call once; if still failing, write a minimal verdict yourself from the phase 1 + 2 artefacts and flag the failure.
