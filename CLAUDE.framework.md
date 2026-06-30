# CLAUDE.framework.md — Framework-shipped instructions

This file is FRAMEWORK-OWNED. The update system (.claude/framework/update/)
will overwrite it when a new framework version is pulled. Do not edit
it directly — make project-specific changes in CLAUDE.md instead.

`CLAUDE.md` includes this file via the pointer at its top. Both files
are loaded into the session context on cold start.

---

## Cold Start Sequence (MANDATORY for every new session)

<!-- Steps 5-9 are ordered for prompt-cache optimisation: stable content
     (contracts, decisions) before volatile (tasks, status, progress).
     Steps 1-4 emit session-varying output and sit first for a different
     reason: broken state must surface before any content is read. -->

1. **Framework update check** — Run `bash .claude/framework/update/check-updates.sh`
   (silent if up-to-date). If `.claude/.framework-update-available.md` exists
   afterwards, read it, summarise the new commits to the user via
   AskUserQuestion, and ask whether to update. On *yes*: run
   `bash .claude/framework/update/apply-update.sh` and then RESTART the cold
   start from step 1 (agent definitions may have changed). On *no*:
   delete `.claude/.framework-update-available.md` for this session and continue.

   Then run `bash .claude/framework/update/skills-check.sh` (usually silent).
   Two flags it may raise:
   - `.claude/.skills-update-available.md` (project opted into skills via
     `.claude/.skills-version` and is behind upstream): read it and tell the
     user their selected skills are behind; on their go-ahead run
     `bash .claude/framework/update/skills-sync.sh`, else delete the flag for
     this session.
   - `.claude/.skills-suggestion.md` (project has NOT opted in but its stack
     matches catalogue skills; throttled to once per
     `SKILLS_SUGGEST_INTERVAL_DAYS`): read it and ask via AskUserQuestion:
     *set up skills sync now* (create `.claude/.skills-version` from the
     flag's template, run skills-sync, delete the flag) / *not now* (delete
     the flag; re-suggested after the interval) / *never for this project*
     (create `.claude/.skills-declined`, COMMIT it, delete the flag).
   (Skills are separate from the framework update above — a different
   upstream, different pin.)
2. **Framework insights check** — Run `bash .claude/framework/insights/analyse.sh`
   (silent if nothing to report; throttled by `INSIGHTS_CHECK_INTERVAL_DAYS`).
   If `.claude/.framework-insight-alert.md` exists afterwards, read it, summarise
   the findings to the user via AskUserQuestion with three options:
   *file as `.claude/FRAMEWORK-SUGGESTIONS.md` entry* / *show full report and
   discuss* / *dismiss (delete flag file)*. Findings always represent
   patterns worth considering, not always bugs.
3. **Framework doctor check** — Run `bash .claude/framework/doctor/doctor.sh`
   (silent if clean; no throttle — broken state needs surfacing immediately).
   If `.claude/.framework-doctor-findings.md` exists afterwards, read it. CRITICAL
   findings must be resolved before continuing (broken hooks, missing
   CLAUDE.framework.md include, missing manifest paths will cause silent
   session failures). WARNING findings should be triaged. Surface via
   AskUserQuestion: *fix now* / *file as task* / *dismiss for this session*.
4. **Healthcheck reminder (deep audit)** — Check
   `.claude/telemetry/.last-healthcheck` (ISO timestamp of last successful
   run). If missing OR older than `HEALTHCHECK_REMIND_DAYS` (from
   `.claude/healthcheck.conf` if set, else default 14), ask the user
   via AskUserQuestion: "No healthcheck in N days. Run /healthcheck now?
   (takes 5-15 minutes)". Options: *run now* / *skip — remind in N days*.
   On *run now*: follow the `/healthcheck` command runbook, then touch
   `.claude/telemetry/.last-healthcheck` with the current timestamp when
   it finishes.
   On *skip*: touch `.claude/telemetry/.last-healthcheck` with the current
   timestamp — the nudge waits another full interval. Throttle: only one healthcheck
   prompt per cold start, even if multiple reasons to nudge exist.

   4.5 **Sync to remote (Rehydrate)** — `git pull --ff-only` the project repo to
   pick up a `/wrapup` Handoff committed on another machine. Essential for the
   PC ↔ laptop handoff; a harmless no-op on the same machine, and it doubles as a
   remote-drift check. On a non-fast-forward or conflict, STOP and surface it to
   the user — don't merge or rebase blind. (Separate from step 1's *framework*
   update check: this syncs the project's own committed state, not the framework
   upstream.)
5. Read contracts — types, boundaries, interface agreements (stable — high cache hit rate). Default: `.claude/ECOSYSTEM.md` (monolithic); projects using per-file contracts read `contracts/` instead. Project CLAUDE.md specifies which layout applies.
6. Read recent decisions — top 10, newest first (mostly stable). Default: `.claude/DECISIONS.md`; per-file layouts read `decisions/`. Project CLAUDE.md specifies which layout applies.
7. Read `.claude/TASKS.md` → task board with lifecycle statuses (changes each session)
8. Read `.claude/STATUS.md` → current state, who's doing what (changes each session)
9. Read `.claude/claude-progress.txt` → Rolling Summary + last 3 detailed entries (newest first)
10. Run `.claude/framework/init.sh` → start dev server, verify nothing is broken

    10.5 **Project Console (opt-in)** — If the project is opted in to the Console
    (presence of `.claude/.console-version`, or the legacy boolean `.claude/.console-enabled`),
    bring its Console up and surface the URL: run `node tools/console.mjs start` (via your Bash
    tool so it's Git Bash, not WSL). The Console is BUNDLED in this repo at `console/`; the driver
    builds it in place on first run (`npm install && npm run build && npm run build:server` — slow,
    one-time) and then drives the Console's own launcher, which spawns the server DETACHED and
    prints `http://127.0.0.1:<port>` — report that URL to the user. The command returns once the
    server is up (no need to background it). `start` is idempotent (already running → reprints the
    URL) and respects a prior manual tray "End" (`autoStart:false` → it skips the respin). It also
    sets `CONSOLE_REAP_GRACE_MIN` so the tray Hub reaps this project's entry if the session dies
    ungracefully — the `console-heartbeat` hook keeps the entry fresh while you work (see
    `contract:console-lifecycle`). `/wrapup` runs `console stop` at session end; after a Console
    update, use `node tools/console.mjs restart` (not `start`) so the rebuilt server is picked up.
    Not opted in → skip silently. To opt a project in: `echo main > .claude/.console-version` (any
    content marks opt-in) and commit it.
11. Pick the highest-priority unblocked task from `.claude/TASKS.md`
12. Check `.claude/GOTCHAS.md` → entries relevant to the task area
13. Pre-task check: estimate context cost against the current window, ask user if projected >= 90%

## State File Rules (NON-NEGOTIABLE)

- Update `.claude/TASKS.md` whenever a task status changes (feature lane or bug-fix lane)
- Update `.claude/STATUS.md` at session start (claim work) and end (record results)
- Update `.claude/claude-progress.txt` at session end with summary
- Add significant decisions to `.claude/DECISIONS.md` with rationale
- If you change a contract, update `.claude/ECOSYSTEM.md` FIRST — both prose AND machine-readable blocks
- TASKS.md, STATUS.md, and claude-progress.txt updates are enforced by the
  Stop hook — you cannot end a session without them. DECISIONS.md and
  ECOSYSTEM.md updates are convention-only (no hook can judge whether a
  decision was made) — treat them as equally non-negotiable discipline,
  precisely BECAUSE nothing will catch you skipping them

## Commit Convention (NON-NEGOTIABLE)

- Every commit MUST include the task/bug ID: `type: description (TASK-XXX)` or `(BUG-XXX)`
- A task cannot move to Ready for Review or Done without a linked commit
- Verify with: `git log --oneline --grep="TASK-XXX"`

## Agent Rules

- Architect plans, Developer implements, Tester tests, Reviewer reviews
- The agent that writes code does NOT review it
- If you discover a contract mismatch — STOP and flag it
- Developers may tighten/clarify contracts inline; widening → escalate to Architect
- `.claude/TASKS.md` has two lanes: **Feature** (Todo → In Progress → Ready for Review → Ready for Test → **Verify** → Done) and **Bug-fix** (Reported → Fixing → Verify → Done). `Verify` is the human-acceptance stage after Ready for Test.
- Log bugs with [BUG-XXX] IDs, severity (P0-P3), and source reference
- **Board entries are machine-read.** Task/bug entries are BRACKETED level-4 headings — `#### [TASK-N] Title` / `#### [BUG-N] Title`. The bracketed ID is canonical: downstream board tooling reads AND writes it, and a bare (`#### TASK-N`) or level-3 (`### [TASK-N]`) entry is silently dropped. Preserve heading levels, the bracketed IDs, the `**Field:**` markers, and the `·` (U+00B7) separators in DECISIONS/GOTCHAS exactly — the `state-structure` doctor check (`.claude/framework/doctor/`) enforces this.

## Verify Handback (NON-NEGOTIABLE)

Delivered work is not reviewable until the human can verify it **one feature at a time**.
Two rules close that loop — they are what turn a finished build into per-feature
acceptance stories instead of a pile of code:

- **One board task per user story / feature** — never bundle multiple features under a
  single umbrella task. The 1:1 story→task mapping is what makes each feature its own
  Verify story. (`/plan` step 4 sets this at task creation; `/build` step 1 guards it.)
- **On Ready for Test, the Tester emits a verify-handback seed** — one
  `.claude/console/verify/<TASK-ID>.json` per task, `items[]` = that feature's use-cases
  (`contract:verify-handback`). GATED on `.claude/console/` existing (absent → skip, zero
  coupling); WRITE-ONCE (never clobber a recorded human verdict). The human reviews these
  in the **Verify** lifecycle stage; passing → Done. (`/test` does this.)
- **Retroactive (batch / autonomous builds):** if many features were delivered under one
  umbrella task (e.g. an overnight build), decompose AFTER THE FACT — create one board
  task per delivered feature in the **Verify** section, then emit one seed each. This is
  what turns "20 features" into 20 reviewable Verify stories. Do NOT leave delivered
  features bundled under one task.

Full contract + the forward and retroactive step-by-step:
`.claude/framework/agent_docs/verify-handback.md`.

## Code Quality Rules

- **Check before creating:** Read code-conventions.md and check for existing shared helpers first
- **Reuse over duplication:** Only create new abstractions when there is clear duplication
- **Domain language:** Use existing terminology from `.claude/ECOSYSTEM.md` — no new names for existing concepts
- **Machine-readable contracts:** `.claude/ECOSYSTEM.md` contracts must include fenced code blocks
  anchored with `<!-- contract:ID status:stable -->`. Add one when you touch a contract area.
- **Update conventions as you go:** New stable pattern → update code-conventions.md same commit
- **Simplicity ladder + safety floor:** before adding code, a dependency, or a file,
  apply *Simplicity First* (behavioral-principles §2) — take the smallest step that
  solves the problem, and prefer reusing or removing over adding — but never weaken the
  validation / error-handling / security floor in §2 or the prompt-injection / secrets /
  no-autonomous-commit floor in §6–7.

## Code Navigation

- If a code graph MCP server is configured (check /mcp), use it BEFORE grep/glob
- Prefer targeted searches over full-codebase scans

## Reference Documents (read when relevant)

- Requirements → .claude/framework/docs/requirements/
- Specs (from `/analyse` → `/plan`; versioned/extended over the project's life) → .claude/framework/docs/specs/
- Supplementary docs (inspiration / research / images / diagrams) → `docs/` — **deposit
  material here as you work** (the Console surfaces the `docs/` tree under its Docs tab);
  don't leave research / inspiration / diagrams only in chat. See `docs/README.md`.
- Building → .claude/framework/agent_docs/building.md
- Testing → .claude/framework/agent_docs/testing.md
- Verify handback (per-feature review stories + the `contract:verify-handback` schema; forward + retroactive/batch procedure) → .claude/framework/agent_docs/verify-handback.md
- Conventions → .claude/framework/agent_docs/code-conventions.md
- Architecture → .claude/framework/agent_docs/architecture.md
- Behavioral principles → .claude/framework/agent_docs/behavioral-principles.md
  (per-turn discipline — think before coding, simplicity, surgical
  changes, goal-driven execution — loaded by each agent on handoff)
- Gotchas → `.claude/GOTCHAS.md` | Framework metrics → `.claude/framework-metrics.md`

## Hook Configuration (consumer-tunable)

Hooks honour two environment variables (resolved by `.claude/hooks/lib/hook-common.sh`):

- `CLAUDE_HOOK_PROFILE=minimal|standard|strict` (default `standard`).
  - **minimal** — only the destructive-command guard (`block-dangerous`) runs. Everything else is silenced. For low-context/local-model setups or quick throwaway work.
  - **standard** — all shipped hooks run. This is the default; behaviour is unchanged from before the profile system existed.
  - **strict** — standard plus any hooks declared at the `strict` tier (reserved for future opt-in extra-strict checks).
- `CLAUDE_DISABLED_HOOKS="format,lint"` — comma/space-separated list of stable hook IDs to turn off regardless of profile. An explicit disable always wins, even for safety-tier hooks.

Stable hook IDs: `block-dangerous` (safety), `enforce-state`, `filter-test-output`, `drift-guard`, `format`, `lint`, `verify-deps`, `suggest-compact`, `cost-tracker`, `reanchor`, `precompact-snapshot`, `postcompact-archive`, `checkpoint-watermark`, `console-heartbeat` (`reanchor`/`precompact-snapshot`/`postcompact-archive`/`checkpoint-watermark` are the TASK-052 session-lifecycle hooks; see "Session Lifecycle" below and `contract:session-lifecycle`. `console-heartbeat` is the TASK-066 Console-integration hook — fires on UserPromptSubmit + PostToolUse to refresh this project's Console registry-entry mtime so the tray Hub never reaps a live session; instant no-op unless the project is opted in to the Console via `.console-version`/`.console-enabled`).

Legacy per-hook opt-outs still work and compose with the above: `CLAUDE_DEP_VERIFY=0` (skip dependency registry checks), `CLAUDE_DOTNET_FORMAT=1` / `CLAUDE_DOTNET_LINT=1` (opt into slow .NET tooling), `CLAUDE_SUGGEST_COMPACT_TURNS=N` (compaction-nudge cadence). Session-lifecycle knobs: `CLAUDE_CONTEXT_WINDOW_TOKENS=N` (window size for the watermark % estimate; default 200000 — **set 1000000 on a [1m]-context session** or the checkpoint nudge fires immediately), `CLAUDE_CHECKPOINT_WATERMARK_PCT=N` (nudge threshold %, default 75).

## Permission Gating (consumer-tunable)

`settings.json` already denies reads/writes of secret paths and the
`block-dangerous` hook guards destructive commands. To require an interactive
confirm before a *specific* risky-but-allowed operation, tune the harness's own
`permissions.ask` matrix — there is no need for a custom gate hook (the harness
provides the approve/edit/deny prompt; the framework only feeds it patterns).
Add an `ask` array alongside `allow`/`deny` in `.claude/settings.json`:

    "permissions": {
      "allow": [ ... ],
      "ask": [
        "Bash(git push --force:*)",
        "Bash(git push --force-with-lease:*)",
        "Bash(rm -rf:*)",
        "Edit(**/migrations/**)",
        "Write(**/migrations/**)"
      ],
      "deny": [ ... ]
    }

Each pattern prompts before that operation; everything else stays on the
`allow`/`deny` decision. Prefer this over a bespoke `PreToolUse` gate hook,
which would duplicate the harness permission engine for marginal gain. The
safety floor stays in `block-dangerous` (non-tunable); `ask` is for
project-specific "make me confirm this" cases.

**Confirm the syntax for your version (UNVERIFIED here, per §4):** the
permission lists (`allow`/`ask`/`deny`) are the harness's mechanism, but the
exact matcher forms (`Bash(<cmd>:*)`, the `**/…` globs) are Claude Code-
version-specific — check the Claude Code permissions documentation for your
version before relying on the patterns above; treat them as illustrative.
(`settings.json` is strict JSON — no comments; keep this matrix documented
here, not inline.)

## MCP Servers

- Only enable servers you're actively using — check /mcp for token costs
- Prefer CLI tools over MCP when available — lower token overhead

## Framework Feedback

- Log framework improvement ideas in `.claude/FRAMEWORK-SUGGESTIONS.md`. If you
  adopted this framework, those ideas only help if they reach its maintainers —
  this file is local to your project. Contribute them back upstream (open an
  issue/PR at the `FRAMEWORK_UPSTREAM_URL` in `.claude/.framework-version`) so
  every project benefits; see that file's header.

## Context Awareness (NON-NEGOTIABLE)

- Before implementation tasks: estimate token cost against the current context window
- If projected >= 90%: STOP and ask user (proceed / prepare for compaction / fresh session)
- If context > 60% with tasks remaining: suggest a fresh session
- When compacting: preserve modified files, task status, current decisions
- Use subagents for research-heavy work (their context is separate)

## Session Lifecycle (NON-NEGOTIABLE)

Disk is the source of truth. The job at every session boundary is to make sure
nothing important lives only in the volatile context window. There are four
named moments — and the rule depends on **what is in the window when you
re-ground**: an EMPTY window (cold start, `/clear`) means disk is canonical
automatically (nothing competes); a SUMMARY window (auto-compaction) means
competing in-context state exists, so you must **reconcile**, not blindly trust
either side.

- **Checkpoint** (during a run) — at natural breakpoints, or when context is
  large, flush your in-flight working-set to a `## WIP` section in
  `claude-progress.txt`: current task, what's done, what's next, key decisions.
  This is the load-bearing habit — it keeps disk close to your working memory so
  a compaction can't eat much. The `checkpoint-watermark` hook nudges you as the
  window fills, but the discipline is yours; the hook only reminds.
- **Handoff** (`/wrapup`) — externalise everything important to the state files,
  commit, and **push**. The push is what makes a cold start on another machine
  correct: no push = no handoff.
- **Rehydrate** (cold start) — empty window, new machine or fresh session.
  `git pull` first (cold-start step 4.5), then rebuild entirely from disk per the
  Cold Start Sequence. EMPTY context → disk is canonical, nothing competes.
- **Re-anchor / Reconcile** (after an auto-compaction, same session) — a
  model-generated SUMMARY is now in your context and **may be lossy or wrong**.
  Treat the state files as canonical for *committed* facts (decisions, contracts,
  task lifecycle); the summary is the *only* record of *in-flight* work since
  your last Checkpoint, and may be fresher than disk. So **reconcile**: re-read
  the state files (including any `## WIP`), run `git status` / `git diff` to see
  actual in-flight work, and trust files + the live repo over the summary where
  they disagree. **Do not** discard the summary ("disk wins") and **do not**
  trust it blindly. The `session-reanchor` hook injects this directive on
  `SessionStart(source=compact)`, but this standing rule is the authority — act
  on it whenever a compaction summary is present, hook or no hook.
- **Manual compaction** (`/pre-compact` → `/compact` → `/post-compact`) — a deliberate
  mid-session window clear (you want a clean window before a long build *without* ending the
  session). `/pre-compact` is a deliberate **Checkpoint** — flush the working-set to `## WIP`;
  no commit (the session continues); it does NOT stop the Console. `/post-compact` is the
  **Re-anchor/Reconcile** above, run explicitly after the compact (re-read disk, `git diff`,
  reconcile against the lossy summary). The `session-reanchor` hook covers AUTO-compaction;
  these two commands are the manual counterpart (no copy-paste prompt — the command IS the
  rehydrate).
