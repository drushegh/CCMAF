---
name: stay-within-limits
description: >-
  Keep long-running or parallel multi-agent work inside the platform's usage
  limits: budget against them as a first-class resource, check usage BETWEEN waves
  of work, stop on a soft threshold BEFORE the cap (never crash into a mid-task
  lockout), checkpoint resumable state to disk, and schedule a self-contained wake
  only once the binding window has demonstrably cleared. Use whenever running
  sustained or multi-wave agent work — large migrations, fan-out across many
  files, overnight/batch jobs, parallel sub-agents or agent teams, or any task at
  risk of exhausting the 5-hour or weekly window. Triggers: "don't blow my
  limits/quota", "run this overnight", "process all N of these", "pause when I'm
  near the cap", repeated long parallel runs. Built on open primitives — ccusage,
  the first-party /usage and /cost commands, an OS scheduler. Multi-agent harness
  design → llm-development; the wake/checkpoint scripting → bash-development /
  powershell-development; CI budget → devops-development.
---

# Stay Within Limits

Sustained or parallel agent work can exhaust a usage window mid-task — and a
lockout that lands during a parallel fan-out leaves half-finished tool calls and
an unrecoverable in-memory plan. This skill treats usage limits as a **budget to
pace against**: read the signal between waves, stop *before* the cap with enough
headroom to checkpoint cleanly, persist resumable state to disk, and resume only
once the limiting window has actually reset.

It is vendor-neutral and built on open primitives: a usage probe (the community
`ccusage`, or the first-party `/usage`), an OS scheduler for the wake, and a
plain on-disk manifest for resume state. **No usage numbers are hard-coded here**
— the platform publishes capacity as relative multipliers and adjusts limits over
time, so the only reliable number is the one the live signal reports now.

## The limit model (date-stamped — re-verify)

As of **June 2026**, Anthropic subscription usage is governed by *two overlapping*
limits, and the binding one shifts between them:

- A **5-hour rolling session window**, anchored to your first prompt (first prompt
  at 10:00 → resets 15:00, regardless of activity in between).
- **Weekly caps** that reset every 7 days — one across all models and one
  model-specific (Sonnet/Opus-class), each with its own reset time.

Capacity is published only as **relative multipliers** (Pro = 1×, Max 5×, Max
20×), not fixed prompts-per-window — Anthropic stopped publishing absolute figures.
*Never hard-code limit numbers; read the live signal.* These mechanics change
(e.g. 5-hour limits were doubled on 6 May 2026) — **re-verify** at
support.claude.com ("Models, usage, and limits in Claude Code") and
anthropic.com/news before relying on specifics. Details and field shapes:
`references/usage-signals.md`.

## Non-negotiables

1. **Find which limit binds first.** Check the 5-hour window *and* both weekly
   caps; pace against whichever has the highest utilisation or nearest reset. A
   wave can be safe on the session window yet about to trip the weekly cap. A
   one-number budget check is the classic failure.
2. **Probe between waves, never mid-wave.** Read usage at a quiescent checkpoint —
   after a wave finishes, before the next launches. Probing inside an in-flight
   fan-out reads a moving target.
3. **Stop on a soft threshold, not the hard cap.** Pause with headroom (e.g. when
   the binding limit is high, or ccusage's `projection` for the active block would
   exceed 100%) so the in-flight wave finishes and checkpoints cleanly instead of
   being killed mid tool-call.
4. **Never interrupt in-flight work to save budget.** Cancelling a running
   sub-agent usually loses the work; let the wave complete, then decide.
5. **Throttle the fan-out.** Per-worker token cost scales roughly linearly, and
   parallel teammates each have their own context window that does *not* inherit
   history. Default to a small wave (≈3–5 workers) unless told otherwise; prefer
   fewer larger self-contained tasks over a wide swarm that drains the weekly cap
   in one go (`references/orchestration.md`).
6. **Checkpoint to disk before pausing.** Write a small machine-readable manifest
   — remaining task queue, done-markers, the binding-limit name, the observed
   reset timestamp, the next wave size — so a cold resume reconstructs the plan
   with zero conversation context. Commit code output to git per wave.
7. **Wake from the reset timestamp, and re-verify on resume.** Schedule the wake
   from the real `resets_at` (plus a safety margin), not a guess. The wake must be
   idempotent: re-check usage first, and **reschedule** if the window hasn't
   actually cleared (clock skew, estimate drift) rather than blindly burning the
   freshly-reset budget. Don't trust elapsed wall-clock alone.
8. **Self-contained wake and worker prompts.** Each must carry the task, absolute
   paths, acceptance criteria, the re-check-then-reschedule rule, the threshold and
   wave throttle, the exact usage command, and the checkpoint path — because every
   worker boots cold.
9. **Report the pause.** Tell the user which window is over threshold, the observed
   usage, when the next check is scheduled, and what work remains.

## Usage signals

Prefer the first-party signal; fall back to the community probe.

| Signal | What it gives | Note |
|---|---|---|
| `/usage` (in Claude Code) | 5-hour + weekly utilisation and resets, per model group | Authoritative in-product view |
| `/cost` | running session spend | Most meaningful on API-key billing |
| `npx ccusage blocks --active --json` | active 5-hour block: `startTime`/`endTime`, `costUSD`, token counts, `burnRate`, `projection` | Community, unaffiliated tool; `--live` removed in v18.0.0; re-verify fields |
| status-line JSON | `cost.total_cost_usd`, `context_window.used_percentage` | Does **not** contain the 5h/7d limits |

`ccusage` infers blocks from local JSONL and published price tables — treat it as
a guide, not Anthropic's accounting (verified June 2026; CLI surface changes
between versions). Full field reference and the burn-down pacing method:
`references/usage-signals.md`.

## The core loop

1. Run a bounded wave (≈3–5 workers).
2. Wait for it to finish — don't interrupt to save budget.
3. Probe the 5-hour and weekly signals; find the binding limit.
4. If over the soft threshold: checkpoint, then schedule a self-contained wake from
   the reset timestamp.
5. On wake: re-check the real window; reschedule if still over; otherwise continue.

## Wake economics (the cache-TTL trap)

Sleeping interacts with prompt caching. The cache TTL is 5 minutes by default
(1 hour opt-in); a hit refreshes the timer for free and doesn't count against the
rate limit (verified June 2026 — re-verify at platform.claude.com, as TTL/quota
behaviour has regressed silently before). So:

- **Don't sleep *just past* 5 minutes** — you forfeit the warm prefix and pay a
  full uncached re-read plus a fresh write for nothing. Either stay inside the TTL
  or sleep long enough that the loss is irrelevant.
- A long sleep across a reset **will** forfeit the cache — so structure the resume
  to re-read a *compact manifest* from disk, not the whole transcript.

Wake-delay math, chaining short wakes, and the resume-packet template:
`references/pause-and-resume.md`.

## Reference index

Load on demand:

- `references/usage-signals.md` — the limit model in depth (date-stamped,
  re-verify), `/usage` and `/cost`, the ccusage `blocks --active --json` fields,
  the status-line JSON contract and what it omits, and burn-down pacing.
- `references/pause-and-resume.md` — soft-threshold stopping, choosing the wake
  delay from the reset timestamp, the cache-TTL economics, the idempotent
  re-checking wake, and the self-contained resume/checkpoint manifest template.
- `references/orchestration.md` — wave throttling and linear per-worker cost,
  per-worker model choice (cheapest adequate, reserve the model-class cap),
  self-contained worker prompts (no inherited context), git/worktree checkpoints,
  choosing wake vs sleep vs cron vs OS scheduler, and avoiding needless polling.

## Boundaries

- **Designing the multi-agent harness itself** (context management, sub-agents,
  safety gates) → `llm-development`; this skill is the *budget-pacing* layer on top.
- **Writing the wake/checkpoint scripts** → `bash-development` (cron/`at`/systemd
  timers) and `powershell-development` (Task Scheduler/`schtasks`).
- **Usage budgets in CI/CD** (pipeline minutes, cost gates) → `devops-development`.
- **Model/spend pricing facts and the Claude API itself** → `llm-development`;
  this skill consumes a usage signal, it doesn't define the billing model.
