# Claude Code Multi-Agent Development Framework

## Template Repo Guide — v4

> **Purpose:** This is a **template repository** containing everything needed to run a multi-agent Claude Code project: nine framework agents, a deliberation council, slash commands, enforcement hooks, state-file templates, a self-updating mechanism, and a self-audit pipeline. Clone it into a project, customise the templates, and a new session with zero prior context can read the state files and pick up exactly where the last one left off.
>
> **How to use this document:** It explains the concepts and how the pieces fit. The *operational* detail lives next to the code it describes — `CLAUDE.framework.md` holds the session rules, each machinery directory has its own README, and the agent/command/hook files are self-documenting. When this guide and a component README disagree, the component README wins (it ships with the code it describes).
>
> **v4 (2026-06-10):** rewritten for the `.claude/` layout, the update system, and verified Claude Code platform behaviour. Replaces the v3 document, which described the retired `00_framework/` root layout.

---

## 1. THE CORE PRINCIPLE

**The project's state must be fully externalised into files on disk.** Context windows are temporary. Sessions end. Compaction loses nuance. The only thing that survives is what's written to the filesystem.

This means:

- A fresh session reads a defined set of state files and knows exactly what's happening, what's been decided, what's next, and why.
- Every session updates those files before it finishes. The three most critical (`TASKS.md`, `STATUS.md`, `claude-progress.txt`) are enforced by a Stop hook. The others are updated when relevant.
- No decision, no task status change, no architectural choice lives only in a conversation. If it's not on disk, it doesn't exist.

### Three Pillars

**Agents** — map to real human roles (Architect, Developer, Tester, Reviewer). Nuances within a role are handled by Skills, not by splitting into more agents.

**Contracts** — shared interface agreements (API shapes, types, module boundaries) stored in `.claude/ECOSYSTEM.md` (or per-file `contracts/` for larger projects). Contracts change *before* implementation, not after.

**State Files** — the project's living memory, all under `.claude/`:

| File | Purpose | Updated by |
| --- | --- | --- |
| `TASKS.md` | Two-lane task board (feature + bug-fix) | Every agent, every session |
| `DECISIONS.md` | Why we did what we did — rationale, rejected alternatives | Any agent making a significant choice |
| `STATUS.md` | Who's doing what right now, blockers, next up | Every agent on start and stop |
| `ECOSYSTEM.md` | Contracts, shared types, module boundaries | Architect; any agent changing an interface |
| `claude-progress.txt` | Session log with Rolling Summary | Every agent at session end |
| `GOTCHAS.md` | Lessons learned, with encounter counts | Any agent that discovers one |
| `FRAMEWORK-SUGGESTIONS.md` | Ideas for improving the framework itself | Any agent; reviewed upstream |
| `framework-metrics.md` | Human-readable framework-effectiveness rollup | Every ~10 sessions via `/housekeeping` |

**Self-measurement:** hooks emit telemetry to `.claude/telemetry/events.jsonl`; `insights/` aggregates it; `/housekeeping` rolls it up into `framework-metrics.md`. The framework answers "are the guardrails working?" with numbers, not vibes.

---

## 2. THE COLD START

The single most important pattern: a new session with zero prior context follows a fixed reading order and is fully productive within a few minutes.

**The authoritative Cold Start sequence lives in `CLAUDE.framework.md`** — it is not duplicated here, because that file is framework-owned and updated mechanically; a stale copy in this guide would drift. In outline: framework self-checks first (update check → insights → doctor → healthcheck nudge), then state files in **prompt-cache order** (stable content first: contracts, decisions; volatile content last: tasks, status, progress), then `init.sh`, then pick the highest-priority unblocked task.

**Why the order matters:** stable-first maximises prompt-cache hits across sessions. Contracts and decisions rarely change; tasks and status change every session. Reading them in that order means the expensive prefix of every session is cheap.

**How the rules reach the session — the @import:** Claude Code auto-loads **only** `CLAUDE.md` and `CLAUDE.local.md`. There is no `CLAUDE*.md` wildcard, and markdown links are *not* followed. `CLAUDE.md` therefore contains an `@CLAUDE.framework.md` import line — the `@path` syntax inlines the file at session start. Removing or rewording that line into a plain link silently drops every framework rule out of the session. Doctor Check 3 enforces its presence.

**If `TASKS.md` has no remaining work:** report it, suggest running `/review` and `/test` to validate, then ask whether to plan the next batch with `/analyse` + `/plan`.

---

## 3. AGENTS

### The Framework Roster (`.claude/agents/framework/`)

The core four map directly to human roles and form the inner build loop; five supporting roles add cross-cutting capabilities (horizontal audit, research, UI design/critique, claim verification) without joining that inner loop.

| Role | Model | Responsibility | Key feature |
| --- | --- | --- | --- |
| **Architect** | opus | Design, contracts, task breakdown, decisions. Never writes production code (shared types excepted). | Contracts must carry machine-readable blocks with `draft`/`stable` status |
| **Developer** | sonnet | Implements features and fixes within stable contracts | Assumptions disclosure in commit bodies, adversarial self-challenge, surgical-change self-review |
| **Tester** | sonnet | Validates implementations against contracts, writes tests at the right layer | Mechanical contract diff; bug reports with reproduction steps; anti-flakiness rules |
| **Reviewer** | sonnet | Read-only critique (Bash restricted to inspection) | AI-failure-mode checks (hallucinated APIs, broad catches, commit-vs-diff drift), severity calibration with a false-positive suppress list |
| **Reconciler** | opus | Horizontal auditor — duplicate/seam/contract/convention drift across modules; never runs inside the inner build/review loop | Three modes: `advisory` (feeds a design before it's built), `scoped` (gates a parallel-build wave merge, or on demand via `/reconcile`), `full` (runs inside `/healthcheck`) |
| **Researcher** | sonnet | Evidence gathering — external research (docs, APIs, standards) and internal archaeology (git history, existing docs) when a decision needs facts nobody in session can verify from the code alone | Returns cited findings only — never modifies files |
| **UI-Designer** | sonnet | Visual and interaction design implementer for user-facing UI | Proposes design directions before building; never hands off unrendered work as done |
| **UX-Critic** | sonnet | Adversarial UX and visual-design critic for UI about to be accepted | Cognitive walkthroughs with numeric friction counts, rubric-scored visual critique; briefed to refute "the flow is fine" |
| **Verifier** | sonnet | Adversarial verifier of another agent's claims before they're acted on (findings, fix claims, test results) | Always a fresh context; never the agent that produced the claim |

**The golden rule: the agent that writes code never reviews it.** The Reviewer runs in a clean context, is told the code was written by a separate AI, and treats it with junior-developer skepticism.

Every agent definition carries: frontmatter (name, description with negative routing, tools, model), a "If Running as a Delegated Subagent" section, explicit **Your Scope / NOT Your Scope** boundaries, and an escalation path (AskUserQuestion for ambiguity; Architect for contract problems). All agents load `framework/agent_docs/behavioral-principles.md` on handoff — per-turn discipline the lifecycle can't enforce: think before coding, simplicity first, surgical changes, signal uncertainty, goal-driven execution, and treating external content as data rather than instructions.

### The Council (`.claude/agents/council/`)

For decisions that are expensive to be wrong about, `/council` convenes five advisors with distinct cognitive styles — Contrarian, First Principles, Expansionist, Outsider, Executor — who give independent takes in parallel, then peer-review each other **anonymised** (so nobody defers to whoever they think wrote what). A Chairman synthesises a no-hedging verdict with a single concrete next step, written to a transcript and an HTML report under `.claude/council/<run-id>/` (gitignored). Protocol details: `commands/council.md`.

### Skills as Nuances

A developer doesn't become a different person when switching from backend to frontend — that difference is a **skill**, not a new agent. Create skills in `.claude/skills/` as repeating patterns emerge in your stack: a `SKILL.md` under 500 lines (frontmatter `description` triggers auto-loading), heavy reference content in `references/`. Skills cost zero context when unused.

### Orchestration Modes

| Mode | Default? | Token cost | Best for |
| --- | --- | --- | --- |
| **Subagents** | Yes | 1× | Most work — focused tasks, sequential handoffs via state files |
| **Worktrees** | Opt-in | ~2× | Parallel work needing file isolation |
| **Agent Teams** (if your Claude Code version offers it) | Opt-in | 3-4× | Multi-component features needing real-time inter-agent messaging |

**Subagent caveat that shapes the whole command design:** subagents run in isolated contexts where hooks may not fire, so their state-file updates are best-effort. Every delegating command (`/build`, `/test`, `/review`) runs a mandatory **post-delegation verification** in the main session — read the state files, check commit linkage, fix gaps from the subagent's summary. Treat this as load-bearing, not bureaucracy.

**MCP caveat:** subagents spawn their own MCP server processes, which may need independent authentication. For MCP-heavy work, keep the MCP calls in main context and delegate only the surrounding analysis.

### Adapting Roles for Non-Code Projects

The principle is separation of concerns, not the role names:

| Project type | Roles |
| --- | --- |
| Code development | Architect, Developer, Tester, Reviewer (default) |
| Orchestration/MCP toolkit | Planner, Scout, Configurator, Verifier |
| Data pipeline | Architect, Builder, Validator, Reviewer |
| Infrastructure-as-code | Architect, Builder, Tester, Reviewer |
| Content/docs | Planner, Writer, Editor, Reviewer |

When adapting, rename the commands to match. Cold Start, state files, hooks, and contracts apply regardless.

---

## 4. STATE FILES IN PRACTICE

The starter templates ship in `.claude/` and document their own format in header comments. The essentials:

### Two task lanes

**Feature lane** (planned work): `Todo → In Progress → Ready for Review → In Review → Ready for Test → Testing → Done`, with `Blocked` available at any stage. **Solo collapse:** for one-person projects, `Todo → In Progress → Verify → Done` — record the choice in `DECISIONS.md`.

**Bug-fix lane** (defects, regressions, hotfixes): `Reported → Fixing → Verify → Done` — one verification stage, no ceremony tax on a one-line fix. Bugs get `[BUG-XXX]` IDs, a severity (P0 blocking / P1 major / P2 minor / P3 cosmetic), a source reference, and **reproduction steps** so the next session doesn't re-derive them. If a "bug" turns out to need design work, promote it to a feature task.

**Task sizing:** completable in one session, touching ≤5-7 files. Bigger → split before starting. Priority ties break by fewest unmet dependencies, then smallest size, then age.

### Commit ↔ task linkage (non-negotiable)

Every commit message includes its ID: `type: description (TASK-XXX)` or `(BUG-XXX)`. `git log --grep="TASK-XXX"` gives instant traceability; the delegating commands verify linkage before allowing a task to move to Ready for Review or Done. For non-trivial changes the Developer adds an `Assumptions:` section to the commit body — the meta-defence against silently-wrong inferences, which the Reviewer challenges (check 5c).

### DECISIONS.md vs ECOSYSTEM.md

`DECISIONS.md` records **why** (rationale, rejected alternatives — without them future sessions re-litigate). `ECOSYSTEM.md` records **what** (the interface that choice created). Decisions are append-only, newest first; supersede rather than delete. Log dependency choices only when they shape architecture — "would a new session need to know we chose this and why?" If no, skip.

### Archiving thresholds

State files are read at every Cold Start — bloat is a per-session tax. `/housekeeping` archives to `framework/docs/archives/` when: TASKS.md Done > ~20, DECISIONS.md > ~50 entries, claude-progress.txt > ~30 detailed entries (regenerating the Rolling Summary — 5 bullets covering trajectory), or a findings cycle fully resolves. It **distils before archiving**: one forward-looking line into live state per theme, so lessons survive the archive.

### GOTCHAS.md

The highest-signal file in the project. Non-obvious behaviour, workarounds, "things I wish I'd known" — with encounter counts. Hit a known gotcha again → increment, don't duplicate. At 5+ encounters, consider fixing the cause and log a task. Read during Cold Start only for entries relevant to the task at hand.

### Error recovery

- **Broken build after implementation:** find the last good commit (`git log --oneline -5`), prefer fix-forward, else `git revert`. Move the task back with a note; log the lesson in GOTCHAS.md.
- **Corrupted state files:** restore from git (`git checkout <commit> -- .claude/TASKS.md …`), reconcile from `claude-progress.txt`, commit the fix.
- **Task too large mid-flight:** save state, split into subtasks in TASKS.md, start fresh.
- **Agent went off track:** Esc to stop, `/rewind` to a checkpoint, review with `git diff`, redirect with a tighter prompt. If the agent misread a contract, fix the contract's clarity, not just the code.

### init.sh

`.claude/framework/init.sh` is the Cold Start environment check: stack-detected dependency install and dev-server boot (dispatches on `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml` / `*.csproj`). It is **diagnostic, not blocking** — it reports status and continues, so a failed smoke test never prevents the agent from starting work.

---

## 5. CONTRACTS

Every task references the contract it implements, so agents know exactly what shapes and boundaries to work within. Each contract has two parts:

1. **Prose** — business rules, edge cases, context.
2. **A machine-readable block** — fenced code (TypeScript, JSON Schema, OpenAPI, SQL, GraphQL — whatever fits) anchored with a stable ID:

```markdown
<!-- contract:user-registration status:draft -->
```

**Draft vs stable is the handoff signal.** The Architect designs at `status:draft`; once confirmed, it moves to `status:stable`. **The Developer refuses to implement against draft contracts** — this prevents building on half-baked designs. The machine-readable block is the enforceable spec; if prose and block conflict, the block wins (and both get fixed).

**How agents use them:** the Architect writes the block (their most load-bearing output — without it, downstream validation degrades into prose interpretation). The Developer implements against stable blocks and diffs their work in self-review. The Tester mechanically validates types, status codes, and error shapes, reporting drift as `breaking | additive | cosmetic`. The Reviewer flags drift first, before anything else.

**Contract edits — know the boundary:** tightening or clarifying an underspecified contract → the Developer edits inline and logs the decision. Widening, breaking, or adding contracts → escalate to the Architect. If the contract itself is the bug → flag it; never silently work around a broken spec.

**Scaling:** under ~15 endpoints a single `ECOSYSTEM.md` is fine. Past ~300 lines, split into per-module files in a `contracts/` directory at the project root (the layout every command and agent looks for — `contracts/` is project-owned, never touched by the update system) and keep `ECOSYSTEM.md` as a summary with pointers. Tasks then reference `contract:ID (in contracts/orders-api.md)` and agents read only what they need. Not every contract needs a block on day one — add one whenever you touch a contract area, and coverage grows.

---

## 6. COORDINATION

### Handoffs

State files are the coordination mechanism: Developer finishes TASK-003 → updates TASKS.md (Done unblocks TASK-004) → updates STATUS.md → Tester picks up from the board. No direct messaging required.

### Findings files (separate, with a lifecycle)

- `.claude/review-findings.md` — written by the **main session** on the read-only Reviewer's behalf.
- `.claude/test-findings.md` — written by the Tester directly.

Each finding is a checkbox: `- [ ]` open, `- [x]` fixed (with commit), `- [~]` wontfix (with reason; significant tradeoffs also go to DECISIONS.md). Fully-resolved cycles are archived. **Anchoring warning:** commands that re-run audits rotate these files first and tell subagents the file is write-only — subagents who read prior findings anchor on them and "converge" by forgetting (this was BUG-001; see GOTCHAS).

### Git branch strategy

Pick one at setup and record it in DECISIONS.md:

- **Trunk-based** (default for solo + agents): everything on `main`, agents commit directly. Simple; relies on review/test discipline.
- **Feature branches** (for parallel work/worktrees): `feature/TASK-XXX-description`, merge when review + test pass.

The framework assumes **solo developer + sequential agent sessions** by default; state files don't conflict because one session writes at a time. For multiple humans, use feature branches and treat `main`'s state files as canonical.

### CI/CD boundary

Deploy from `01_Project/` (or `02_solution/`), never from the repo root. Don't gate merges on state files, don't have CI write them, don't ship them (see §11). State files are development tooling for sessions, not pipeline inputs.

---

## 7. HOOKS — ENFORCEMENT, NOT SUGGESTION

The Stop hook catches end-of-session discipline; the drift guard catches **mid-session drift** — the bigger risk, because long conversations erode instruction-following. All scripts ship in `.claude/hooks/` and are wired in `.claude/settings.json`.

| Hook | Event | What it does |
| --- | --- | --- |
| `framework-drift-guard.sh` | UserPromptSubmit | Injects targeted reminders when drift indicators fire: project files changing without state-file updates, no claimed task, periodic check-ins, a strategic compaction nudge. Counters are per-session (keyed on the payload `session_id`). Silent when clean. |
| `enforce-state-update.sh` | Stop | Blocks session exit until TASKS.md, STATUS.md, claude-progress.txt were touched (uncommitted or in recent commits). Skips on a virgin repo; honours `stop_hook_active` so it never block-loops a session with nothing to update. Also emits the session-end cost marker. |
| `block-dangerous-commands.py` | PreToolUse (Bash) | Catches `rm -rf /`, `DROP TABLE`, fork bombs. Advisory, **not a security boundary** (see below). Safety tier — runs in every profile. |
| `filter-test-output.sh` | PreToolUse (Bash) | Rewrites recognised test commands (`npm test`, `pytest`, `go test`, `dotnet test`, `cargo test` — anywhere in a compound command) to filter output to PASS/FAIL/ERROR lines, preserving the original exit code. |
| `auto-format.sh` / `auto-lint.sh` | PostToolUse (Write/Edit) | Format and lint the changed file, dispatching by extension and tool availability. Lint output returns to Claude for same-session self-correction. Always exit 0 — feedback, not blockers (exit 2 would reject the edit itself). |
| `verify-deps.sh` | PostToolUse (manifest files) | Dependency-hallucination defence: diffs newly added packages and pings the registry (npm/PyPI automated; cargo/go/nuget detection-only). Findings to `.claude/.dep-verification-issues.md`; never blocks. |
| `statusline.sh` | statusLine | Renders `ctx:N% \| model \| branch` from the stdin JSON Claude Code provides. |

**Profiles and opt-outs** (resolved by `hooks/lib/hook-common.sh`): `CLAUDE_HOOK_PROFILE=minimal|standard|strict` (minimal keeps only the destructive-command guard) and `CLAUDE_DISABLED_HOOKS="id1,id2"` (explicit disable always wins). Stable IDs and legacy per-hook switches are documented in CLAUDE.framework.md.

**Authoring rules:** precise matchers (`"Write|Edit|MultiEdit"`, not `""` — omitting MultiEdit silently skips bulk edits); under 2 seconds; exit 2 only for genuine blockers; hooks are pure functions of (stdin JSON + env) → (exit code + stdout), which is what makes them testable (§8, tests). On Windows, prefer the `bash -c 'cd "$CLAUDE_PROJECT_DIR" && …'` invocation pattern — `$(…)` substitution silently fails to evaluate for PostToolUse on Windows VS Code (see GOTCHAS for the diagnostic).

### Security — hooks are UX, permissions are defence

The dangerous-command hook cannot stop `cat .env` or exfiltration via curl. Real defence in depth:

- **Deny rules** (pre-built in settings.json) block the Read/Edit/Write tools from `.env*`, `~/.ssh`, `~/.aws`, and `*secret*`/`*credential*` paths. They do **not** cover Bash — that needs sandboxing.
- **Sandboxing** (`/sandbox`) restricts Bash filesystem/network access at the OS level.
- **Config-surface audits:** `framework/audit/config-security.sh` (wired into `/security`) scans settings.json permission breadth, hook scripts for injection patterns, agent prompts, and MCP configs; exit 2 on CRITICAL makes it CI-gateable.
- Checklist: deny rules verified, sandbox on, never `--dangerously-skip-permissions` outside disposable containers, audit MCP servers, run untrusted repos in a container.
- **Agent scope is honor-system** (the Architect has Write but is told not to write production code). Claude Code has no per-agent permission profiles; for compliance-grade enforcement, run roles in separate sessions with separate settings.

---

## 8. FRAMEWORK MACHINERY (`.claude/framework/`)

Each component has a README that is its authoritative doc. One paragraph each:

**Update system** (`framework/update/`) — `.claude/.framework-version` pins the upstream SHA. Cold Start runs `check-updates.sh` (throttled, silent when current); on changes you get a commit summary and a yes/no. `apply-update.sh` overwrites **only** the paths in `framework-manifest.txt` — the ownership boundary between framework-owned (overwritten, including deletions propagating) and project-owned (never touched: state files, CLAUDE.md, settings.json). Consumers predating the system bootstrap via `framework/update/MIGRATION.md`; the old root layout migrates automatically.

**Doctor** (`framework/doctor/`) — point-in-time integrity invariants on every Cold Start: hooks ↔ settings consistency, doc cross-references, the CLAUDE.md @import, manifest paths, version-file fields, duplicate task IDs, untracked self-flag, detector-consumer determinism, statusline correctness. CRITICAL findings must be resolved before continuing (the script itself always exits 0 — the cold-start runbook, not the shell, is what stops on them). Doctor is also the **propagation channel for fixes to project-owned files**: when a fix can't ship via the manifest (CLAUDE.md, settings.json), a doctor check detects the stale pattern downstream and prescribes the one-line fix.

**Insights** (`framework/insights/`) — longitudinal efficacy: hooks emit one JSONL event per firing; `rollup.sh` aggregates; `analyse.sh` compares against `thresholds.conf` and alerts on anomalies (a hook with zero events, a spiking block rate). `instinct-miner.sh` scans session transcripts for repeated corrections and successes and **proposes** GOTCHAS/SUGGESTIONS candidates — never auto-writes.

**Audit** (`framework/audit/`) — `pattern-scan.sh` greps the framework's own shell for known anti-patterns (CRLF-unsafe loops, the `grep -c || echo` double-zero); `config-security.sh` audits the harness config surface (§7).

**Tests** (`framework/tests/`) — bats behavioural tests + fault-injection tier (malformed stdin must fail open) + golden fixtures for deterministic detectors, plus shellcheck. Run: `bash .claude/framework/tests/run-tests.sh`. The harness has caught real shipped bugs every time it gained a new tier; when you fix a hook bug, add the case that would have caught it.

**Commands** beyond the core loop: `/healthcheck` (deep audit with determinism modes `--verify N`, `--perturb`, `--pin`), `/security` (stack-agnostic SAST/secrets/SCA sweep), `/wrapup` (session-close context flush: uncommitted work, unlogged decisions, memory candidates, a paste-ready next-session prompt), `/housekeeping` (rolling summary, metrics, archiving), `/council` (§3).

---

## 9. CONTEXT & TOKEN DISCIPLINE

### The pre-task safety check

Auto-compaction summarises silently and drops nuance — the single biggest threat to continuity. Before any task: estimate the task's token cost against the current context window; if the projection reaches ~90%, **stop and ask the user** — proceed / prepare-then-compact / fresh session. When preparing: update all state files, commit (`checkpoint: pre-compaction state save`), and give the user a `/compact preserve: …` suggestion listing the current task, modified files, and recent decisions. Above ~60% with multiple tasks remaining, a fresh session usually beats a compact cycle — Cold Start exists precisely to make fresh sessions cheap.

Rough cost intuition: small edit ~2-5K tokens; single function ~5-15K; multi-file feature ~15-40K; full-stack feature or broad refactor ~40-100K; research ~20-60K. Costs drop with clear contracts and a code graph; they rise with unfamiliar code and verbose test output.

### Subagents vs compaction

If the cost is mostly *reading* (investigation, test runs, find-all-callers), don't compact — delegate to a subagent and keep only the summary. Compaction is for when the cost is mostly *writing* in main context.

### Session design

1-3 tasks per session is the sweet spot (Cold Start overhead ~5-10% of context; ten tasks risks compaction). Start fresh when context exceeds ~60% with work remaining, when switching roles, or when switching codebase areas. Every session ends with state files updated and a "next session should" directive in the progress log — `/wrapup` automates the checklist.

### Model selection

Defaults in the shipped agents: `opus` for the Architect (design quality is worth the premium), `sonnet` for Developer/Tester/Reviewer. These are aliases — they track current models without edits. Principles rather than price tables (pricing and plan inclusions change; check current docs): reasoning-heavy planning gets the strongest model; implementation and review run well one tier down; switch a Reviewer up a tier for critical boundary reviews. In API mode add: prompt-cache stable content first, batch non-urgent work, and instrument cost per role — you can't optimise what you don't measure.

### Hygiene

Scope prompts tightly; pipe verbose output (`git log --oneline -10`); reference files by path rather than pasting; batch related edits; prefer a code-graph MCP query over repo-wide grep when configured (`/mcp` shows token costs per server — disable what you're not using; prefer CLI tools where they exist).

---

## 10. ANALYSIS & PLANNING — BEFORE CODE

```
Requirements → /analyse → Spec → /plan → Contracts + Tasks + Decisions → /build → /review → /test
```

Analysis ("what and why" — exploratory, interactive) and planning ("how to slice it" — structural, mechanical) are separate on purpose; merging them yields shallow specs or premature task lists.

**Inputs:** drop whatever exists — PRDs, mockups, partner API specs, meeting notes — into `framework/docs/requirements/` with a small README index. Convert PDFs/images to markdown first (3-10× token tax otherwise); agents read sources once and work from summaries.

**`/analyse`** reads the requirements (subagents for bulk), explores existing code for brownfield projects, then runs the **Structured Interview**: batched AskUserQuestion calls (≤4 questions, concrete options, recommended option first, multiSelect where applicable) across four phases — Scope & Stories, Functional, Non-Functional, Integration — skipping phases the requirements already answer. The modal tool beats free-form chat because each answer is a deliberate choice, not a conversational fragment. Output: a spec in `framework/docs/specs/SPEC-<name>.md` containing source references, user stories, functional + non-functional requirements, edge cases with resolutions, out-of-scope, and — for existing projects — a **gap analysis** (exists / needs building / needs modification).

**`/plan`** turns the spec into stable contracts, sized tasks with dependencies and contract references, decision entries, and a plan in `framework/docs/plans/`. Lightweight, stays in main context, writes no production code.

---

## 11. PROJECT STRUCTURE & DEPLOYMENT

```
PROJECT_ROOT/
  CLAUDE.md              # project-owned: stack, commands, domain rules + the @import
  CLAUDE.framework.md    # framework-owned: cold start + session rules (update-managed)
  .gitignore
  .claude/               # everything else framework-related lives here
    agents/  commands/  hooks/  skills/  settings.json
    framework/           # machinery: update, doctor, insights, audit, tests, docs, agent_docs, init.sh
    TASKS.md  STATUS.md  DECISIONS.md  ECOSYSTEM.md  GOTCHAS.md
    FRAMEWORK-SUGGESTIONS.md  claude-progress.txt  framework-metrics.md
    .framework-version   # pinned upstream SHA
  01_Project/            # your application source and tests
  02_solution/           # deployable artifacts when distinct from source
```

The full canonical tree is maintained upstream as the `framework-layout` contract; the summary above plus the README's structure section is what a consumer project needs. In YOUR project, `01_Project/` is the application and `02_solution/` holds shipped output when it differs from source (Power Platform solutions, bundled builds, IaC artifacts) and stays empty otherwise.

**Deployment exclusions** — one directory and two files:

```
.claude/
CLAUDE.md
CLAUDE.framework.md
```

Add to `.dockerignore` / `.vercelignore` / CI packaging excludes as appropriate. Deploy from `01_Project/` or `02_solution/`, never the root. (Vercel gotcha: don't set Root Directory to `01_Project` *and* deploy from inside it — the path doubles.)

---

## 12. SETUP

Setup **customises pre-built templates** — nothing is created from scratch. The non-code adaptation (§3) applies to every scenario.

### Scenario A — new project

1. **Install the framework into your project.** Pick the clone URL: if the user uses SSH for GitHub prefer `git@github.com:drushegh/CCMAF.git` (or their own host alias on a multi-account machine, e.g. `git@github.com-personal:...`, to avoid the wrong-key prompt); otherwise use HTTPS `https://github.com/drushegh/CCMAF.git`. Clone to a scratch dir and copy the framework files into the project: `.claude/`, `CLAUDE.md`, `CLAUDE.framework.md`, `.gitignore`, `.gitattributes`, `tools/` (the Console driver), and **keep `console/` + `skills/`** (the bundled Console and skill catalogue — steps 5–6 decide whether to use them). Skip the framework repo's own `.github/` and `01_Project/` (the user's code goes in their own `01_Project/`). **On Windows:** a fresh *clone* is already LF (via `.gitattributes`), but a *copy* can pick up CRLF — normalize any copied `.sh`/`.py`/`.md` to LF. Discard the scratch clone, open the project in the IDE with Claude Code.
2. **Settings first:** review `.claude/settings.json` (permissions, hooks — on Windows confirm `python` resolves, else use `py`). Put any **per-machine** config — e.g. `CLAUDE_CONTEXT_WINDOW_TOKENS=1000000` on a 1M-context model — in **`.claude/settings.local.json`** (untracked, per-machine), **never `settings.json`** (editing settings.json trips the self-modification guard). Restart the IDE so it loads.
3. **Customise:** fill `CLAUDE.md` placeholders (name, stack, commands — keep the `@CLAUDE.framework.md` line); adapt `framework/init.sh` if stack auto-detect needs help.
4. **Bootstrap updates:** `bash .claude/framework/update/init-framework-version.sh` (uses the step-1 URL; defaults to public CCMAF). Pins the framework version so cold-start update checks work.
5. **Skills — recommend them (tiered).** Skills give the agent senior-level, stack-specific standards; *recommend* taking them rather than treating them as optional. Run `bash .claude/framework/update/skills-check.sh --suggest` (detects the stack, lists stack-direct + cross-cutting matches against the bundled `skills/`), then offer the user a tiered choice and **recommend Base**:
   - **Base (recommended)** — the skills that directly fit this project's stack (e.g. a React site → `typescript-development`, `react-development`, `frontend-development`).
   - **Enhanced** — Base plus high-value adjacent/cross-cutting skills (e.g. `read-the-damn-docs`, `secure-development`, `stay-within-limits`, `accessibility-development`).
   - **All** · **None.**
   Write the chosen set to `.claude/.skills-version` (`SKILLS_SELECTED="..."`) and run `bash .claude/framework/update/skills-sync.sh` — it copies them from the bundled `skills/` into `.claude/skills/`.
6. **Console — recommend it, and set it up *for* the user.** The Project Console (a localhost cockpit over `.claude/` state) is opt-in but *recommended*. If the user wants it: `echo main > .claude/.console-version`, then run `node tools/console.mjs start`. The driver **builds and runs it itself** (first run is slow) and **starts the machine-global tray Hub if none is running** — do NOT hand the user raw `npm` commands or leave it for them to start. Then report based on what happened: **no Hub was running** → "Console is up at `http://127.0.0.1:<port>`, and I started your tray Hub"; **a Hub was already running** (another project) → "Console is up and now visible in your existing tray Hub."
7. **Seed contracts so the Console is populated.** As the design firms up, add real `<!-- contract:ID status:stable -->` anchors to `ECOSYSTEM.md` (the template shows the format) so the Console's Contracts tab is populated — don't leave it prose-only. Seed the board (`/plan`) so Kanban/Verify aren't empty either.
8. Record stack choices in `DECISIONS.md`, then `/analyse` → `/plan` → `/build`. **Desired end state when setup finishes: the Console is running and *populated*, the recommended skills are installed, and contracts are anchored — nothing left for the user to go back and fix.**

A paste-ready prompt:

```
This project was scaffolded from the CCMAF framework
(github.com/drushegh/CCMAF). Read .claude/claude-code-dev-framework.md completely,
then customise the pre-built templates per Section 12 Scenario A (the install
step is already done). Our stack: [STACK]. The project: [DESCRIPTION].
Start with settings verification and ask me to restart the IDE; after I
confirm, proceed unattended: recommend a Base/Enhanced/All/None skill set for
our stack and sync it, set up and RUN the Console (start the Hub if none is
running) unless I decline, then run /analyse to interview me about what we're
building. When you finish, the Console should be running and populated.
```

### Scenario B — existing project

As Scenario A, plus a **discovery phase** (use subagents to keep main context clean): document the existing architecture, conventions, and build/test commands into `framework/agent_docs/`; capture existing interfaces as contracts in `ECOSYSTEM.md`; record historical tech choices in `DECISIONS.md` (ask the user when the why is unclear); seed `GOTCHAS.md` with known quirks. Move source into `01_Project/` if it isn't already shaped that way.

**Artifact rescue (do not skip):** for pre-existing agents, docs, or config that overlap the framework — read them, merge unique domain knowledge into `agent_docs/`/GOTCHAS/skills, keep genuine *product* agents (they coexist with framework agents), and only then delete legacy duplicates. Deleting before rescuing loses domain knowledge permanently.

`/analyse` then produces its spec **with the gap analysis section**.

### Lightweight mode

For small projects (under ~10 tasks, solo): keep `CLAUDE.md` + the @import, `TASKS.md`, `claude-progress.txt`, and settings; collapse the lifecycle to `Todo → In Progress → Done`; skip the rest until the project earns it. The framework is modular — add pieces when their absence hurts.

### Upgrading

Handled by the update system (§8) — Cold Start offers upstream changes automatically; `apply-update.sh` respects the manifest ownership boundary. No manual diffing. Projects from the pre-update-system era follow `framework/update/MIGRATION.md` once.

---

## 13. DAILY CHEAT SHEET

| What | How |
| --- | --- |
| Start a session | Cold Start (auto via CLAUDE.framework.md) → pick task |
| New feature | requirements into `framework/docs/requirements/` → `/analyse` → `/plan` → `/build` |
| Implement / review / test | `/build` → `/review` → `/test` (each verifies state + commit linkage after) |
| Hard decision | `/council` |
| Deep audit | `/healthcheck` (add `--verify N` before trusting its output programmatically) |
| Security sweep | `/security` |
| End of session | `/wrapup` — flushes context to disk, emits next-session prompt |
| Periodic maintenance | `/housekeeping` — rolling summary, metrics, archiving |
| Check for framework updates | automatic at Cold Start; manual: `bash .claude/framework/update/check-updates.sh` |
| Framework self-tests | `bash .claude/framework/tests/run-tests.sh` |
| Checkpoint state | update state files → commit with task ID |
| Compact safely | checkpoint first → `/compact preserve: current task, modified files, decisions` |
| Undo / redirect | `Esc` to stop; `/rewind` to checkpoint |
| Record a lesson | `GOTCHAS.md` (increment if known) |
| Improve the framework | `.claude/FRAMEWORK-SUGGESTIONS.md` → upstream PR |

---

## 14. ANTI-PATTERNS

| Don't | Why | Do instead |
| --- | --- | --- |
| Bloated CLAUDE.md (200+ lines) | Costs tokens every session | Keep it a dashboard; details in `framework/agent_docs/` |
| Removing the @import line | Framework rules silently vanish (links are NOT loaded) | Leave `@CLAUDE.framework.md` intact; doctor enforces |
| Same agent writes and reviews | No separation of concerns | Developer implements, Reviewer reviews |
| Splitting Developer into backend/frontend agents | Too granular | One Developer, skills for domains |
| Coding before contracts | Agents build incompatible pieces | Stable contract first, code second |
| Implementing against `status:draft` | Building on half-baked design | Architect stabilises first; Developer refuses drafts |
| No decision log / no rejected alternatives | Future sessions re-decide and re-litigate | DECISIONS.md with rationale and what lost |
| Skipping post-delegation verification | Subagent state updates are best-effort | `/build`/`/test`/`/review` verify and fix in main context |
| Letting auto-compaction happen | Drops nuance unpredictably | Pre-task check; prepare and compact on your terms |
| Research in main context | File reads fill the window | Subagents — their tokens are separate |
| Agent Teams by default | 3-4× cost | Subagents default; teams only for real-time coordination |
| All MCP servers always on | Each costs context just by existing | `/mcp`, disable unused, prefer CLI tools |
| Ingesting PDFs/images raw | 3-10× token tax | Convert to markdown once, work from the summary |
| Tasks touching 10+ files | Context risk, untrackable | One session, ≤5-7 files; split bigger |
| Fixing framework problems in-project | Lost to the next project | FRAMEWORK-SUGGESTIONS.md → upstream |
| Append-only shared output files for repeated audits | Subagents anchor on prior findings (BUG-001) | Rotate per run; subagent prompts mark the file write-only |
| Trusting a detector before checking its determinism | Automation built on noise | `/healthcheck --verify N` (and `--perturb`/`--pin`) first |
| Stating platform behaviour from memory | This doc's v3 carried a false auto-load claim for two months | Verify against current Claude Code docs before relying on it |
| No deny rules / no sandbox | Secrets exposed via file tools or Bash | §7 security checklist |
| Grinding one long session | Repeated compaction degradation | Fresh session after ~60%; Cold Start makes it cheap |

---

## 15. SOURCES

- Anthropic: *Effective Harnesses for Long-Running Agents*; Claude Code docs (subagents, hooks, memory/@imports, statusline, settings); *Skill Authoring Best Practices*; *Manage Costs Effectively*
- Karpathy LLM-coding observations (via forrestchang/andrej-karpathy-skills, MIT) — basis of `behavioral-principles.md`
- ECC harness-optimisation repo — hook profiles, config-surface audit, instinct mining (mechanism-only adoptions)
- bats-core; Judge Reliability Harness (perturbation testing); ReasoningBank (dual-source distillation); Beads (semantic decay) — see DECISIONS for adopt/reject rationale per sweep
- ChatGPT deep-research report on AI-written code defects (`framework/docs/deep-research-report.md`) — basis of the reviewer/tester AI-failure-mode checks
