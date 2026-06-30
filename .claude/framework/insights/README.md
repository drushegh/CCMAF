# Framework Insights

Longitudinal efficacy tracking for the framework itself: are the hooks
earning their keep, are agents drifting from the rules, are some rules
being violated often enough that they should be promoted into
automation?

Complementary to [.claude/framework/update/](../update/) (pulls framework
improvements) and [.claude/framework/doctor/](../doctor/) (point-in-time
health check). Insights answers *"is the framework WORKING?"* over time.

## Data flow

```
Every session
  └─ each hook fires → appends 1 line to .claude/telemetry/events.jsonl

On demand (or cold-start, throttled)
  └─ rollup.sh  → .claude/telemetry/.hook-metrics    (aggregate counters)
  └─ analyse.sh → .claude/.framework-insight-alert.md        (flag file, only when findings)
  └─ report.sh  → stdout                              (human-readable snapshot)
```

## Files

| File | Role |
| --- | --- |
| [thresholds.conf](thresholds.conf) | Tunable thresholds. Shell-sourceable. Each threshold documented with its reasoning. |
| [rollup.sh](rollup.sh) | Aggregates `events.jsonl` into `.hook-metrics` JSON. Idempotent, safe to rerun. |
| [analyse.sh](analyse.sh) | Reads counters, compares to thresholds, writes flag file when findings exist. Throttled; silent when clean. |
| [report.sh](report.sh) | On-demand human-readable summary. Use this to inspect current state. |
| [scrape-review-findings.sh](scrape-review-findings.sh) | Parses `.claude/review-findings.md` on session end and emits `review-scraper` telemetry events. Wired into `enforce-state-update.sh` (Stop hook). |
| [update-metrics.sh](update-metrics.sh) | Refreshes the auto-generated snapshot block in [framework-metrics.md](../../framework-metrics.md). Run on demand or at session end. |
| [instinct-miner.sh](instinct-miner.sh) | Mines the session transcript for user corrections / confirmed strategies and PROPOSES candidates (`.claude/.instinct-candidates.md`) — never writes state files. Wired into `/wrapup` step 2. |
| [session-summary.sh](session-summary.sh) | One-line "Session efficacy" telemetry read-back for the current session window (events after the last `cost-tracker` marker). Wired into the `/wrapup` final verdict. Fail-soft, read-only. |
| [push-state.sh](push-state.sh) | Canonical one-line push state (branch, ahead/behind upstream, uncommitted count) computed from git — never hand-write this as prose in STATUS.md. Wired into the `/wrapup` final verdict. Read-only, no network. |

## Event format

One JSON object per line in `.claude/telemetry/events.jsonl`. Schema v2
(TASK-021, `contract:telemetry-schema` in ECOSYSTEM) — OTel-GenAI-style
correlation without any OTel dependency:

```json
{"ts":"2026-06-12T20:00:00Z","schema":2,"event_id":"20260612T200000Z-1234-28461",
 "session_id":"<uuid>","tool_use_id":"<id>","hook":"drift-guard",
 "outcome":"drift-detected","outcome_class":"flagged","trigger":"stale-state"}
```

- `session_id` (trace root) and `tool_use_id` (tool-call span) come from
  the hook payload; `event_id` is unique per line (dedup/replay anchor).
- `outcome` keeps the per-hook vocabulary; `outcome_class` is the
  canonical cross-hook enum: `ok | flagged | blocked | skipped`.
- Bash hooks emit via `telemetry_emit()` in `.claude/hooks/lib/hook-common.sh`.
- v1 lines (no `schema` field) remain valid forever; readers tolerate
  both and derive `outcome_class` for v1 (legacy mapping lives in
  rollup.sh). `task_id` / `agent_id` are reserved correlation levels,
  not yet emitted.

## What each hook logs

| Hook | Outcomes |
| --- | --- |
| `drift-guard` | `drift-detected` (+ `trigger`) or `clean`, per UserPromptSubmit |
| `stop` | `passed` or `blocked`, per session end |
| `bash-guard` | `allowed` or `blocked`, per bash invocation |
| `format` | `formatted` or `skipped`, per Write/Edit |
| `lint` | `ran` or `skipped`, per Write/Edit |
| `test-filter` | `filtered` or `passthrough`, per matching test command |

## Alert behaviour

`analyse.sh` only produces `.claude/.framework-insight-alert.md` when at least
one finding exceeds its threshold AND the sample size is above
`INSIGHTS_MIN_EVENTS` (default 50). Cold start surfaces the alert via
AskUserQuestion. Dismiss with `rm .framework-insight-alert.md`.

## Gitignore boundary

- `.claude/telemetry/` is **gitignored** — raw events and rollups stay
  local to each machine. Event logs may contain file paths, task IDs,
  or command strings you'd rather not commit.
- [framework-metrics.md](../../framework-metrics.md) at project root
  is **committed** — it's the human-readable rollup, updated every
  ~10 sessions and shared across the team.

## Manual operations

```bash
# See current state any time
bash .claude/framework/insights/report.sh

# Force an analysis regardless of throttle
bash .claude/framework/insights/analyse.sh --force

# Rollup only (no thresholds check)
bash .claude/framework/insights/rollup.sh

# Dismiss a current alert
rm .framework-insight-alert.md

# Tune thresholds for your workflow
$EDITOR .claude/framework/insights/thresholds.conf
```

## Dependencies

`jq`, `awk`, `date`, `bash`. All already required elsewhere in the
framework.
