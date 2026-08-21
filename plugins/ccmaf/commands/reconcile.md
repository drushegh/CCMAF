## Context check

This command runs only in a **CCMAF v2** project. Check
`.claude/.framework-version` before doing anything else:

- **Missing** → say so in one line ("no `.claude/.framework-version` — this
  isn't a CCMAF-scaffolded project") and stop.
- **Present without `FRAMEWORK_LINE=v2`** → say "this is a v1-line CCMAF
  project — use the bundled /reconcile or migrate" and stop.
- **Present with `FRAMEWORK_LINE=v2`** → continue.

---

Cold start runs automatically via the core plugin's SessionStart hook
(`core-context.sh`) — CLAUDE.framework.md is retired in v2; the always-on rules now
live in `${CLAUDE_PLUGIN_ROOT}/DIGEST.md`, with cross-cutting reference detail in
`${CLAUDE_PLUGIN_ROOT}/agent_docs/OPERATIONS.md`.

Then:

1. **Pick the mode from the invocation.**
   - `/reconcile` (no flags) — **default: scoped**, delta = `<last watermark>..HEAD`.
     Read `.claude/telemetry/.last-reconcile` (ISO timestamp). If missing,
     this is the first run — treat the delta as the whole repo (there is
     no prior watermark to diff from) and say so in the report.
   - `/reconcile --advisory <design-file>` — **advisory mode**. `<design-file>`
     must exist; if it doesn't, tell the user and stop.
   - `/reconcile --full` — **full mode**, whole-repo sweep (the same sweep
     `/healthcheck` Part 3 triggers — see that command if you're running
     inside a healthcheck pass rather than standalone).

2. Do the pre-task context check. If projected >= 90%, ask the user.

3. **Gather the delta (scoped mode only).** Before delegating, resolve what
   changed:
   ```bash
   git log --oneline --name-only HEAD -- .claude/telemetry/.last-reconcile   # confirm watermark file itself isn't the only diff
   git diff --name-only <watermark-commit-or-first-commit>..HEAD -- . ':(exclude).claude'   # excludes framework bookkeeping paths
   ```
   If `.last-reconcile` holds a timestamp rather than a commit SHA, resolve
   the nearest commit at or before it: `git log -1 --before="@<epoch-of-watermark-mtime>" --format=%H`.
   Pass the resulting file list to the subagent — do not make it re-derive
   the delta itself.

4. Delegate to the **`ccmaf:reconciler`** subagent (fall back to the bare
   `reconciler` name if the namespaced type does not resolve) using the Task tool:

   **Advisory:**
   > "Reconcile in `advisory` mode against `<design-file>`.
   > Read the design, then report what already exists in the codebase that
   > it would duplicate or conflict with — existing utilities, existing
   > `contract:ID` blocks, existing conventions. Deterministic tools first
   > (jscpd if present, export inventories, name-similarity greps) — spend
   > judgment only on the candidate list they surface.
   > This cannot fail anything; you are feeding the plan, not gating it.
   > Do NOT touch `.claude/telemetry/.last-reconcile`.
   > Mark anything you couldn't verify inline: [GAP] / [ASSUMED] / [INFERRED].
   > RETURN: ~350 words per your Return Format section — mode, scope, tools
   > run, candidate/finding counts, JSON path, gaps."

   **Scoped (default):**
   > "Reconcile in `scoped` mode. Delta: [the file list or ref range from
   > step 3]. Compare against the existing inventory (rest of the reachable
   > codebase) for: semantic duplicates, cross-module/cross-agent seam
   > mismatches, contract drift against ECOSYSTEM.md and architecture.md,
   > convention drift. Deterministic tools first — spend judgment only on
   > the candidate list. Findings here can fail the feature.
   > On success, write `.claude/console/reconcile/<scope-id>.json` (gated
   > on `.claude/console/` existing) and touch
   > `.claude/telemetry/.last-reconcile` with this run's ISO timestamp
   > (`mkdir -p .claude/telemetry` first).
   > Mark anything you couldn't verify inline: [GAP] / [ASSUMED] / [INFERRED].
   > RETURN: ~350 words per your Return Format section."

   **Full:**
   > "Reconcile in `full` mode — whole-repo sweep, no delta. Same four
   > categories, deterministic tools first, judgment only on the candidate
   > list. On success, write the findings JSON and touch
   > `.claude/telemetry/.last-reconcile`.
   > Mark anything you couldn't verify inline: [GAP] / [ASSUMED] / [INFERRED].
   > RETURN: ~350 words per your Return Format section."

5. **POST-DELEGATION VERIFICATION** (mandatory — subagents may not update
   state files reliably):
   a. **Watermark check (scoped/full only):** confirm
      `.claude/telemetry/.last-reconcile` now holds an ISO timestamp at or
      after this run's start. If missing and the run reported `status:
      complete`, write it yourself.
   b. **JSON check:** if `.claude/console/` exists, confirm
      `.claude/console/reconcile/<scope-id>.json` was written. If missing
      and the subagent's return claims success, this is an anomaly — treat
      per the anomaly-escalation rule (investigate before trusting the
      claimed counts), not a silent pass-through.
   c. **Verdict handling (scoped/full only):** if the reconciler reported
      `fail`, do NOT advance the feature/wave. Route each finding back to
      its owning module/builder the same way `/build`'s seam-checker step
      used to — bounded to 2 rounds, then fall through to `/review`
      regardless, same convention as the retired seam-checker step.
      Advisory findings never block; hand them to whichever agent is about
      to consume the design (usually the Architect).
   d. If findings are P0/P1, consider routing them through the
      **`ccmaf:verifier`** subagent (fall back to the bare `verifier` name
      if the namespaced type does not resolve) before acting, same as
      `/review` step 5 does for reviewer findings — a horizontal-audit
      false positive is exactly as costly as a vertical-review one.

6. Report to the user: mode, scope, verdict, finding counts by severity,
   JSON path (if written), and any [GAP]/[ASSUMED]/[INFERRED] markers.

## When to run

- **advisory** — before/during `/plan`, whenever a new design is drafted,
  to catch duplication before it's built.
- **scoped** — two triggers only, neither automatic inside `/review` or
  `/test`: (a) after a multi-builder wave in `/build` completes (the
  wave-merge invocation passes each builder's own file manifest directly
  rather than going through the watermark diff in step 3 — this is the
  old seam-checker slot); (b) a human or the orchestrator runs
  `/reconcile` directly, typically nudged by doctor Check 14 (the
  reconcile-due nag) once enough tasks have entered Done since the last
  pass. This project does not wire an automatic scoped-mode call into
  `/review` or `/test` — the cadence gap that would otherwise create is
  what Check 14 surfaces instead.
- **full** — only inside `/healthcheck`; don't run it standalone on a
  cadence tighter than that (it's a whole-repo sweep, not cheap).

## Non-goals

- Not a substitute for `/review` — this checks four specific horizontal
  properties, not general code quality, security, or logic correctness.
- Not part of the inner build loop — it does not run after every task,
  only at the checkpoints above.
