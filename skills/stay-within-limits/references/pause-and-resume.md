# Pause and resume

Stop a wave cleanly, pick the wake delay from the real reset, survive the cache-TTL
trap, and resume cold from a manifest. The parent skill names the rules; this file
is the mechanics. Signal field shapes: `usage-signals.md`; wave sizing and the
scheduler choice: `orchestration.md`.

## 1. Soft-threshold stopping

Pause with headroom so the in-flight wave *finishes and checkpoints* rather than
being killed mid tool-call — a half-written tool call is unrecoverable; a wave that
landed its git commit is not. Trigger the stop when **either** crosses your line,
evaluated only at a quiescent checkpoint (between waves):

- ccusage's active-block `projection` for the binding window would exceed **100%**
  of that window's limit, or
- the binding limit's *current* utilisation crosses your headroom line (e.g. 95%).

Size headroom against the next wave, not a fixed percentage — it must absorb one
more wave's burn *plus* the checkpoint write, so a 5-worker wave needs more slack
than a 1-worker tail. Never shrink the running wave to fit (parent rule 4).

## 2. Choosing the wake delay from the reset timestamp

Schedule against the **absolute reset time**, never a guessed sleep duration.

1. Read the binding window's reset — `five_hour.resets_at` or `seven_day.resets_at`
   from the usage signal, or the ccusage active-block `endTime` plus the weekly
   reset from `/usage` (field shapes: `usage-signals.md`).
2. Add a small margin **past** the reset (e.g. +2–5 min) for clock skew and rounding.
3. Hand that absolute time to the OS scheduler — `at`/systemd timer
   (`bash-development`) or Task Scheduler/`schtasks` (`powershell-development`).

**If the runtime clamps wake delays** (some clamp to, e.g., 60–3600 s) you cannot
sleep until tomorrow in one call. **Chain** wakeups — each re-reads the live signal
and, if the window has not cleared, reschedules the next bounded wake, converging
on the reset rather than sleeping blind:

```
target = max(reset_at) + margin
loop: delay = clamp(target - now, MIN, MAX)   # MAX e.g. 3600 s; schedule wake
  on wake: re-read signal; if cleared → resume; else recompute target, loop
```

## 3. The cache-TTL trap

Prompt caching changes the economics of *how long* you sleep
(verified June 2026; re-verify at platform.claude.com prompt-caching):

| Event | Cost vs base input | Notes |
|---|---|---|
| Cache **write**, 5-min TTL | ~1.25× | default |
| Cache **write**, 1-hour TTL | ~2× | opt-in via `cache_control` `ttl` |
| Cache **read** (hit) | ~0.1× | and **refreshes the TTL timer for free** |
| Cache **miss** (cold) | 1× input **+ a fresh write** | full uncached price |

Hits are **not** counted against the rate limit — only writes and uncached input
are. On expiry the next request is cold: full input *and* a fresh write. So:

- **Never sleep just past the 5-minute TTL** — you forfeit the warm prefix and pay
  a cold re-read plus fresh write for nothing. Either stay *inside* the TTL, or
  sleep long enough that one cold rebuild is irrelevant against the work saved.
- **A long sleep across a reset forfeits the cache regardless** — so don't try to
  preserve it. Make the resume cheap: re-read a **compact manifest** from disk
  (section 5), not the whole transcript — kilobytes of plan, not megabytes.

> Cache behaviour has changed silently before: in early March 2026 Claude Code's
> effective cache TTL regressed from 1h to 5m (issue #46829, closed "as not
> planned"), quietly inflating cache-creation cost. Treat the table as a snapshot;
> **re-verify TTL and quota-counting** before relying on it.

## 4. The idempotent, re-checking wake

A wake must **verify usage first**, then decide — never burn the freshly-reset
budget assuming elapsed wall-clock means the window cleared. Clock skew, ccusage
estimate drift, and peak-hour effects all mean it may still be over threshold when
the timer fires. The wake is therefore a pure function of the live signal:

```
on wake: probe = read live signal (exact command from manifest)
  if binding window still ≥ headroom: recompute target from probe.resets_at,
     reschedule (section 2), exit
  else: load manifest; launch next wave at the recorded size/throttle
```

This is what makes chained wakes (section 2) safe to repeat — a too-early fire
costs one cheap probe, not a lockout.

## 5. The self-contained resume manifest

Checkpoint to disk *before* pausing. The manifest is the entire resume context — a
cold boot reconstructs the plan from it with zero conversation history. Keep it
compact: it is what you re-read after the cache is forfeited.

```json
{
  "binding_limit": "seven_day_opus",
  "observed_reset_at": "2026-06-22T19:00:00Z",
  "usage_command": "npx ccusage blocks --active --json",
  "headroom_pct": 95,
  "wave_throttle": 4,
  "next_wave_size": 4,
  "recheck_rule": "re-probe; if binding >= headroom_pct, reschedule from resets_at; else proceed",
  "completed_tasks": ["migrate:auth", "migrate:billing"],
  "task_queue": ["migrate:reports", "migrate:exports"],
  "next_verification": ["pytest tests/reports", "npm run typecheck"],
  "handoff_packets": [
    { "scope": "src/reports/** only", "verify": ["pytest tests/reports"],
      "stop_when": ["tests green", "projection >= 100% of binding window"] }
  ]
}
```

Every key above is load-bearing: task queue and done-markers, binding-limit name
and observed reset, the next wave's size and throttle, the headroom threshold, the
**exact** usage command, the verification steps, and one `handoff_packets` entry
per next-wave worker (scope, verification commands, stop conditions) — each boots
cold (`orchestration.md`). The **wake prompt** itself stays tiny: the manifest path
and the re-check-then-reschedule rule (section 4); everything else it reads from
disk.
