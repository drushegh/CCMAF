# Pacing parallel work

The parent SKILL gives the rule — throttle the fan-out, default to ≈3–5 workers,
prefer fewer larger tasks. This file is the *why* and *how*: how a wide swarm
drains the budget, why each teammate boots cold, how to checkpoint durably, and
which wait mechanism to reach for. Claude Code "agent teams" are **experimental**
and gated behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`; the docs state token use
scales linearly per teammate and recommend ≈3–5 teammates with a handful of tasks
each (verified June 2026; re-verify at code.claude.com/docs/en/agent-teams).

## 1. Wave throttling — linear cost, and which cap blows

Per-worker token cost scales roughly **linearly** with the number of workers: ten
teammates is ~10× the spend of one, with no shared-context discount. The trap is
*which* limit you blow. A wide swarm finishes fast on the wall clock, so the
5-hour session window often survives — but the same burst can drain a **weekly**
cap (or the model-specific weekly sub-limit) in a single afternoon, and that locks
you out for *days*, not hours. Pace against the binding window, not the session
clock (`usage-signals.md`).

Two heuristics follow from linearity: **default to a small wave (≈3–5 workers)**
unless the user asks for more (width buys latency, not throughput-per-token); and
**prefer fewer, larger, self-contained tasks** over many tiny ones, since each
worker pays a fixed prompt/boot overhead (the brief in §2).

```
3 workers × 20 min   →  3 boot-prompts of overhead, one weekly dent
12 workers × 5 min   →  12 boot-prompts, ~4× the boot overhead, same work, weekly-cap risk
```

## 2. Teammates boot cold — every brief is self-contained

Parallel teammates do **not** inherit the lead's conversation history. Each has
its own context window and starts from nothing but the spawn prompt. A brief that
says "continue the migration we discussed" produces a confused worker that
re-derives (and pays for) context the lead already had. Every worker/spawn prompt
must therefore carry, in full:

- [ ] **The task** — one concrete, bounded objective.
- [ ] **Absolute file paths** — exact files to read and to write (e.g.
      `f:\repo\src\auth\login.ts`); never "the auth file".
- [ ] **Acceptance criteria** — how the worker knows it is done (tests pass, lint
      clean, the named function exists with this signature).
- [ ] **A pointer to the checkpoint file** — where shared state lives on disk, so
      the worker reads the manifest rather than guessing the plan
      (`pause-and-resume.md` has the template).

The lead's job is to *compile* its rich context into N self-contained briefs. This
is harness-design work — context budgeting, the spawn contract, safety gates on
what a worker may touch — and the depth lives in `llm-development`.

## 3. Model choice per worker — cheapest adequate, reserve the expensive one

Choose the **cheapest model that clears the task's acceptance criteria**, per
worker, not one model for the whole wave. The model-specific weekly sub-limit
(the Opus-class cap) is usually the *first* to bind on heavy reasoning work — so
spending it on mechanical edits (rename, mechanical refactor, boilerplate, test
scaffolding) is how a fan-out trips that sub-limit while the all-model weekly cap
still has headroom.

Reserve the expensive model for the waves your **evals** show actually need it —
gnarly design, ambiguous specs, subtle bug hunts. "It might help" is not evidence;
measure. Mixed-model waves (cheap workers, one expensive lead or reviewer) stretch
the binding sub-limit furthest. Model ids, relative pricing, and the
choose-a-model logic → `llm-development`.

## 4. git as the durable per-wave checkpoint

Conversation state and prompt cache are **volatile** — a lockout, a long sleep
across a reset, or a crashed worker can lose them. The code output must survive
independently, so checkpoint to **git**, not to memory:

- **Commit per wave.** Each completed wave ends in a commit (or a tagged commit)
  so the tree is a known-good restore point. The manifest records the SHA.
- **Worktree per parallel worker.** Give each concurrent worker its own
  `git worktree` so they write to separate working directories and never collide
  on the index — then the lead merges. This makes parallel writes safe and makes a
  half-finished worker's output inspectable and discardable.

```
lead compiles briefs ─┬─→ worktree A ─┐
                      ├─→ worktree B ─┼─→ lead merges + commits wave ─→ manifest records SHA
                      └─→ worktree C ─┘
```

Git mechanics (worktree add/remove, merge strategy, commit hygiene) →
`bash-development` / `powershell-development`.

## 5. Choosing the wait mechanism

When a wave finishes and you must wait — for a budget reset, a timer, or an
external event — match the mechanism to the need:

| Need | Mechanism | Why |
|---|---|---|
| Resume must carry instructions to its future self | **wake / resume** tool | The work to do on wake is attached to the schedule, not re-derived |
| Fixed timer, or something a process can directly observe | background **sleep** / watcher | No instructions needed; the process just blocks or polls a file/handle it owns |
| Recurring **fresh-session** work (nightly batch, weekly sweep) | **cron** / recurring schedule | Each run starts clean; no state carried between runs |

Decision order: *resume needs a brief attached?* → wake/resume. *Fixed delay or
observable signal?* → sleep/watcher. *Recurs from a clean slate?* → cron. A budget
pause across a weekly reset is a **wake/resume** — it must re-check usage and
reschedule if the window hasn't cleared (`pause-and-resume.md`). Scheduler
specifics (`at`/`systemd` timers vs Task Scheduler/`schtasks`) →
`bash-development`, `powershell-development`; CI-side recurrence →
`devops-development`.

## 6. Don't poll for what the host will tell you

Short-interval polling burns budget on questions the host already answers. If the
platform **notifies** you when a background task or sub-agent completes, wait for
that signal — do not loop every few seconds asking "done yet?". Each poll is a
real prompt that draws down the same budget you are trying to protect.

The one acceptable degradation: for a **budget pause**, a long sleep across a reset
will miss the 5-minute prompt-cache TTL and force an uncached re-read on wake. Take
that hit — preserving the limit matters more than the cache. Structure the resume
to re-read a *compact manifest* from disk, not the whole transcript, so the cache
miss is cheap (cache-TTL economics → `pause-and-resume.md`).
