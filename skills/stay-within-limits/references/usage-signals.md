# Usage signals

The limit model in depth and the exact signals to read. The parent SKILL.md
names the two limits and the relative-multiplier rule; this file gives the field
shapes, the OAuth endpoint the figures actually come from, and the burn-down
pacing maths. **No usage numbers are hard-coded — read the live signal.**

## The two overlapping limits (verified June 2026; re-verify)

Re-verify at support.claude.com ("Models, usage, and limits in Claude Code").
Subscription usage is bounded by *two* mechanisms; the binding one shifts.

1. **5-hour rolling session window.** Anchored to your **first prompt**, not a
   wall-clock boundary and not your last activity. First prompt at 10:00 → window
   resets at 15:00 regardless of what happens between. A burst at the very start
   of a window therefore has 5 hours to amortise; a burst near the end has minutes.
2. **Two weekly caps, each resetting every 7 days** — one across **all models**,
   one **model-specific** (Sonnet/Opus-class). Each carries its **own reset time**,
   shown per model group. A wave can sit comfortably inside the 5-hour window yet
   trip a weekly cap; always read all three utilisations before launching.

```text
first prompt 10:00 ──────────── 5h window ──────────── resets 15:00
weekly (all models)   ▓▓▓▓▓░░░░░░░  resets Thu 09:00
weekly (model-class)  ▓▓▓▓▓▓▓▓▓░░░  resets Sat 14:00   ← binds first here
```

## Capacity is relative, not absolute

Anthropic publishes capacity only as **relative multipliers** — Pro = 1×,
Max = 5×, Max = 20× — and **stopped publishing absolute prompts-per-window
figures**. The support docs state allowances are relative and depend on
conversation length, model, features and effort. Two consequences:

- **Never hard-code a numeric budget.** The same "5 prompts" costs wildly
  different fractions depending on context length and model.
- **The only trustworthy number is the live utilisation %** the signal reports now.

Note the **6 May 2026** change (promo/dated — re-verify at anthropic.com/news):
5-hour limits were **doubled** and the previous peak-hours reduction was
**removed**. Treat any remembered figure as stale.

## The signals, compared

| Signal | Surface | What it gives | Authority |
|---|---|---|---|
| `/usage` | in-product slash command | 5h **and** both weekly utilisations + resets, **per model group** | **Authoritative** — first-party |
| `/cost` | in-product slash command | running **session** spend | Most meaningful on **API-key / pay-as-you-go** billing |
| Settings → Usage | web dashboard | historical usage over time | First-party, lags the live window |
| `ccusage` | community CLI | local-JSONL aggregation, active-block projection | **Guide only** — see below |
| status-line JSON | hook stdin | session cost + context % | Carries **no** limit figures |

`/usage` is the one to trust for the pacing decision because it is the only
signal that reports **all three** utilisations with their resets in one place.

## ccusage (community, unaffiliated)

`npx ccusage` / `bunx ccusage` — an **MIT-licensed, NOT-Anthropic-affiliated**
CLI by ryoppippi that reads the **local usage JSONL** the agent CLIs write and
aggregates daily / weekly / monthly / session / blocks. It infers blocks and
applies published price tables, so its cost and limit maths are **a guide, not
Anthropic's accounting**. Re-verify field names against the installed version —
the surface changes between releases.

`ccusage blocks --active --json` returns the active 5-hour block:

```json
{
  "id": "...", "startTime": "...", "endTime": "...", "actualEndTime": "...",
  "isActive": true,
  "tokenCounts": { "inputTokens": 0, "outputTokens": 0,
                   "cacheCreationInputTokens": 0, "cacheReadInputTokens": 0 },
  "costUSD": 0.0, "models": ["..."],
  "burnRate":   { "tokensPerMinute": 0 },
  "projection": { "totalTokens": 0, "totalCost": 0.0 }
}
```

`burnRate` and `projection` appear only on **active** blocks. Useful flags:
`--token-limit <n|max>` (sets the budget the projection is compared against;
`max` uses your highest observed block), `--since` / `--until`, `--breakdown`
(per-model split), `--offline` (no price-table fetch), `--mode`, `--timezone`.

**WARN:** the built-in live view `blocks --live` was **removed in v18.0.0** — use
the status-line command instead for a continuous read.

## The status-line JSON contract

The status-line hook receives JSON on stdin carrying `cost.total_cost_usd` and
`context_window.used_percentage` — but it does **NOT** contain the 5h / 7d limit
figures. Those come from a **separate, undocumented OAuth usage endpoint**
(re-verify; subject to change without notice):

```text
GET https://api.anthropic.com/api/oauth/usage
→ five_hour.utilization   five_hour.resets_at
  seven_day.utilization   seven_day.resets_at
```

So a status line that shows context % is reading the contract; one that shows
"window left" is calling that endpoint (or shelling out to `/usage`). Don't
expect the limit figures to arrive via the documented hook payload.

## Burn-down pacing method

The goal is **even consumption**, not exhausting the window with hours left.
Compare the **elapsed fraction of the window** against the **consumed fraction
of the binding limit**:

```text
elapsed_frac  = (now - window_start) / window_length
consumed_frac = binding_limit_utilisation        # from /usage, the highest of 5h + 2 weekly

if consumed_frac > elapsed_frac:  ahead of pace → throttle wave size or wait
if consumed_frac ≈ elapsed_frac:  on pace       → continue
if consumed_frac < elapsed_frac:  behind pace   → headroom to spare
```

Always pace against the **binding** limit — highest utilisation *or* nearest
reset, whichever bites first. Being on pace against the 5-hour window is
irrelevant if the weekly model-class cap is about to trip. When ahead of pace, the
lever is **wave size** (`orchestration.md`), not interrupting in-flight work.
Stopping cleanly on a soft threshold and waking from the real `resets_at` →
`pause-and-resume.md`; wiring the probe into a scheduler →
`bash-development` / `powershell-development`.
