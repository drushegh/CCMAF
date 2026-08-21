# Framework Metrics

<!-- Updated every ~10 sessions (same cadence as the Rolling Summary in claude-progress.txt). -->
<!-- Raw counters are in .claude/telemetry/.hook-metrics (gitignored, written by .claude/framework/insights/rollup.sh). -->
<!-- This file is the human-readable summary. -->

## Cold Start Efficiency

| Period | Sessions | Avg Turns to First Tool Call | Notes |
| ------ | -------- | ---------------------------- | ----- |

<!-- "Turns to first tool call" = how many Cold Start file reads before the agent starts actual work. -->
<!-- Ideal: 9 (the 9-step sequence). Higher means the agent is re-reading or getting confused. -->

## Drift Guard

| Period | Times Fired | Fire Rate (per session) | Top Trigger | Notes |
| ------ | ----------- | ----------------------- | ----------- | ----- |

<!-- Fire rate = times fired / total prompts processed. -->
<!-- If fire rate is >30%, the framework instructions may need strengthening. -->
<!-- If fire rate is 0% over 10+ sessions, the guard might not be needed (or not working). -->
<!-- Top trigger: which indicator fires most (stale state files, no task claimed, periodic reminder). -->

## Stop Hook

| Period | Times Blocked | Block Rate (per session) | Missing File | Notes |
| ------ | ------------- | ------------------------ | ------------ | ----- |

<!-- Block rate = times the hook returned exit 2 / total session ends. -->
<!-- If block rate is high, agents aren't updating state files — investigate why. -->
<!-- If block rate is 0% over 20+ sessions, the hook is earning its keep silently (or agents are well-trained). -->

## Review Findings

| Period | Total Findings | Acted On | Ignored | Wontfix | Act Rate | Notes |
| ------ | -------------- | -------- | ------- | ------- | -------- | ----- |

<!-- Act rate = (acted on + wontfix with reason) / total findings. -->
<!-- If act rate is <50%, reviews may be too noisy or findings too minor. -->
<!-- Track by severity: are CRITICAL findings always acted on? -->

## Bug-Fix Lane

| Period | Bugs Reported | Bugs Fixed | Avg Cycle (sessions) | P0 Response | Notes |
| ------ | ------------- | ---------- | -------------------- | ----------- | ----- |

<!-- Avg cycle = sessions from Reported to Done. -->
<!-- P0 response = how quickly P0 bugs move from Reported to Fixing. -->

## Contract Drift

| Period | Drift Events | Breaking | Additive | Cosmetic | Notes |
| ------ | ------------ | -------- | -------- | -------- | ----- |

<!-- From Tester and Reviewer CONTRACT DRIFT reports. -->
<!-- High breaking drift = contracts are stale or developers aren't reading them. -->

## AI-Authored Defect Escape

| Period | AI Commits | Hallucinated Deps Caught Pre-commit | Hallucinated Deps Found Post-commit | Broad-catch Introduced | Smell Findings | Post-merge Bugs |
| ------ | ---------- | ----------------------------------- | ----------------------------------- | ---------------------- | -------------- | --------------- |

<!-- Tracks the cost of generation reaching production despite the framework's gates. -->
<!-- AI commits = commits whose author/co-author is an AI assistant (count via `git log --grep="Co-Authored-By.*Claude" --oneline`). -->
<!-- Hallucinated Deps Caught Pre-commit = count of MISSING/UNVERIFIED entries from .claude/.dep-verification-issues.md per period (verify-deps.sh hook output). -->
<!-- Hallucinated Deps Found Post-commit = count of dependency-removal commits where the rationale is "package doesn't exist" or similar. Hard to automate; populate by interpretation. -->
<!-- Broad-catch Introduced = count of `except:`/`except Exception:`/`catch (_)` patterns added in AI commits per period (review-findings CRITICAL 5b). -->
<!-- Smell Findings = total newly-introduced smells per period (review-findings CRITICAL section under "Code Smells"). -->
<!-- Post-merge Bugs = bugs in the Bug-Fix Lane whose Source commit is on an AI commit. -->

**Interpretation:**
- High pre-commit / low post-commit = gates are working. Target state.
- Low pre-commit / high post-commit = gates are bypassed or weak; reviewer/tester not catching.
- High both = generation quality regression; consider tightening prompts, smaller batches, or escalating to architect review.
- Track delta over time, not just absolute numbers. A spike after a model/agent change is a regression signal.

## Framework Overhead

| Period | Sessions | Avg Tool Calls / Session | State File Update Time (% of session) | Ceremony Complaints | Notes |
| ------ | -------- | ------------------------ | ------------------------------------- | ------------------- | ----- |

<!-- If agents spend >15% of a session on state file maintenance, the framework is too heavy. -->
<!-- "Ceremony complaints" = times the user said "skip this" or "that's overkill". -->
<!-- Avg Tool Calls / Session: auto-source. The cost-tracker sub-feature in
     enforce-state-update.sh emits one `{"hook":"cost-tracker","tool_uses":N,
     "transcript_lines":L}` event per session end into telemetry/events.jsonl.
     Average tool_uses across the period's cost-tracker events is a cost proxy;
     rising tool-calls-per-session with flat output suggests churn/overhead. -->
<!-- compaction nudges: drift-guard Indicator 5 fires every
     CLAUDE_SUGGEST_COMPACT_TURNS prompts (telemetry trigger "compaction-nudge").
     A high compaction-nudge rate means sessions routinely run long. -->

---

## How to Update This File

The tables above are the framework's metric-reading guidance — populate
them by interpretation when you regenerate the Rolling Summary in
claude-progress.txt (every ~10 sessions).

For machine-generated snapshots from the telemetry pipeline, run:

```bash
bash .claude/framework/insights/update-metrics.sh
```

That reads `.claude/telemetry/.hook-metrics` (raw event rollup) and
prepends a timestamped snapshot to the **Auto-Generated Snapshots**
section below. Snapshots are append-only so you get a trend over time.
The tables above remain hand-curated — the framework author's
interpretation of trends, not raw data.

---

## Auto-Generated Snapshots

<!-- Machine-written by .claude/framework/insights/update-metrics.sh. -->
<!-- Do NOT edit by hand — reruns of the script may overwrite.    -->
<!-- Newest at top. Older snapshots preserved for trend-reading.  -->

_(no snapshots yet — run `bash .claude/framework/insights/update-metrics.sh` to append one)_
