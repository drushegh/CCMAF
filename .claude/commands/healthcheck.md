Deep audit across framework integrity, code quality, contracts, state
files, and tests. On-demand companion to the always-on self-checks
(doctor.sh per cold start, insights/analyse.sh weekly). Use this when:

- Significant framework or project changes have landed
- Before a major merge
- The cold-start nudge said it's time
- On a user-chosen schedule

Takes 5-15 minutes. Writes findings to `.claude/review-findings.md`
as each part completes — same file reviewer uses. **Context is
ephemeral: persist findings between parts, never hold them in
memory waiting for the end.**

## Invocation modes

- `/healthcheck` — single audit pass (default). Use most of the time.
- `/healthcheck --verify N` — **determinism mode.** Run the audit N
  times (typically 3) on an unchanged tree and report variance.
  Required before building any automation that consumes /healthcheck's
  output (contract-drift detectors, doctor-time aggregators, dashboards,
  etc.). Add `--perturb` to test robustness to *semantics-preserving*
  input changes (formatting, comment reflow) on a throwaway copy — the
  stronger gate, since a finding that flips on a cosmetic edit is fragile.
  Add `--pin` to *freeze* detector input across runs, isolating model
  nondeterminism from environmental drift when plain `--verify` shows
  variance. See "Determinism mode" section at the end for full protocol.
  Lesson learned: the 2026-04-26 stability experiment uncovered BUG-001
  (44→34→30 monotonic decay on unchanged tree) — the historical
  drift-count trend that motivated proposed automation could not be
  trusted as decision input. Determinism mode is the standard test
  before any consumer goes in.

Below is a runbook. Follow in order.

---

## Part 0 — Detect project shape (no config required)

Figure out what this project is BEFORE running expensive reviews.
Auto-detect and adapt — don't require the user to configure anything
unless truly ambiguous.

**0.0. Rotate prior findings (FIRST STEP — DO THIS BEFORE ANYTHING
ELSE).** If `.claude/review-findings.md` exists, move it to
`.claude/review-findings/<ISO-timestamp>.md` (creating the
`review-findings/` directory if needed). Start this run with no
`.claude/review-findings.md` file at all — Part 1.4 will create it
fresh on first append.

This rotation is non-negotiable. If the file persists across runs,
subagents in subsequent runs will read it (to find an insertion
point or just for context) and anchor on prior runs' findings,
producing monotonically decaying counts that look like
convergence but are actually self-suppression. Document case:
2026-04-26 detector-stability experiment, 44→34→30 across 3
unchanged-tree runs, with the run-2 subagent writing literal
*"Alignment with Run 1... confirming detector stability"* — that is
the failure mode this step prevents.

**0.1. Load optional overrides.** If `.claude/healthcheck.conf` exists,
source it. It may set any of:
`HEALTHCHECK_SOURCE_DIRS`, `HEALTHCHECK_TEST_DIRS`, `HEALTHCHECK_TEST_CMD`,
`HEALTHCHECK_LINT_CMD`, `HEALTHCHECK_FW_WINDOW`, `HEALTHCHECK_REVIEW_FOCUS`,
`HEALTHCHECK_REMIND_DAYS`. Unset values fall through to auto-detect.

**0.2. Auto-detect source + test dirs (only where not overridden).**

Priority order:
1. Parse `CLAUDE.md` "Commands" section for `cd <dir>` patterns —
   that's the canonical project root.
2. Common layouts to probe: `01_Project/`, `01_Project/src/`,
   `01_Project/tests/`, `02_src/`, `02_src/*/`, `03_tests/`,
   `src/`, `tests/`, `app/`, `lib/`.
3. If two or more plausible layouts exist and it's genuinely ambiguous,
   use AskUserQuestion to confirm with the detected options as choices.
   Offer to save the confirmed selection to `.claude/healthcheck.conf`
   so future runs skip this step.

**0.3. Detect test + lint commands (only where not overridden).**

Read `CLAUDE.md` "Commands" section. Match common patterns:
`npm test`, `pytest`, `go test`, `cargo test`, `dotnet test`,
`npm run lint`, `ruff check`, `eslint`, `golangci-lint`.

If neither found, Parts 4 auto-skip with a note in the findings.

**0.4. Detect contracts.**

- ECOSYSTEM.md contains `<!-- contract:ID` blocks → contracts live in
  ECOSYSTEM.md.
- `contracts/` directory at project root → per-file contracts.
- Neither → Part 3 (contract verification) auto-skips.

**0.5. Detect if there's any project code at all.**

If 0.2 returned no source dirs AND no test dirs, the framework instance
holds no project (e.g., fresh clone before code arrives, or the
upstream framework repo itself). Parts 1, 2, and 4 auto-skip —
framework integrity and state-file consistency still run.

**0.6. Tell the user what was detected.** Before running any
expensive step, summarise the detected shape (mode, project name,
source/test dirs, test/lint cmds, contracts strategy, what gets
skipped) and ask for confirmation via AskUserQuestion:

- Proceed with detected shape
- Proceed but let me override (open `healthcheck.conf` discussion)
- Cancel

Once confirmed, continue.

---

## Part 1 — Framework integrity

**1.1. Fast invariants.** Run `bash .claude/framework/doctor/doctor.sh`.
Capture any findings from `.framework-doctor-findings.md`.

**1.2. Behavioural drift.** Run `bash .claude/framework/insights/analyse.sh --force`
and `bash .claude/framework/insights/report.sh`. Capture `.framework-insight-alert.md`
if it appears; include the report summary either way.

**1.3. Recent framework change detection.** Check for changes in the
last `HEALTHCHECK_FW_WINDOW` commits (default 10):

```bash
git diff --name-only HEAD~${HEALTHCHECK_FW_WINDOW:-10} -- \
  .claude/agents/framework/ .claude/hooks/ .claude/commands/ \
  .claude/framework/ CLAUDE.framework.md 2>/dev/null
```

**If changes detected → deep framework audit via reviewer subagent:**

Spawn a reviewer subagent with this prompt. Prepend the shape detected
in Part 0 so the subagent doesn't re-derive it (scoped-anchor rule —
shape context only, never findings):

> **Detected shape (from Part 0):** source dirs: `<HEALTHCHECK_SOURCE_DIRS
> or "none — framework-only">`; state root: `.claude/`; contracts:
> `<ECOSYSTEM.md | contracts/ | none>`.
>
> **Independence rule.** Do NOT read `.claude/review-findings.md`
> before forming your audit. That file is write-only for you. The
> orchestrator handles deduplication and aggregation. Form your
> findings independently from the source files alone.
>
> Perform a complete integrity audit of the framework. The goal is to
> verify that every reference resolves, nothing is orphaned, nothing
> contradicts, and nothing is redundant. Treat the framework as a
> connected graph — if any node is unreachable, dangling, or in
> conflict, flag it.
>
> **Reference integrity.** Every pointer must resolve:
> - CLAUDE.md Cold Start paths → files/dirs exist?
> - CLAUDE.framework.md references → resolve?
> - ECOSYSTEM.md contract blocks → cross-references valid? Contracts
>   referenced by TASKS.md actually exist in ECOSYSTEM.md?
> - DECISIONS.md index entries → resolve?
> - Commands referencing framework paths (.claude/framework/docs/, agent_docs/,
>   contracts/) → paths exist?
> - Agent definitions referencing agent_docs/ files → those files exist?
> - settings.json hook commands → scripts exist at the referenced paths?
> - framework-manifest.txt entries → paths exist? Also run
>   `bash .claude/framework/doctor/doctor.sh` if not already run and fold
>   its findings in.
>
> **Conflict and contradiction detection.**
> - Agent scope boundaries — does any agent's scope overlap with another's?
>   (e.g., two agents both claim to write contracts)
> - Agent tool lists vs descriptions — does any agent have tools it
>   shouldn't? (e.g., reviewer with Write)
> - Command instructions — do any contradict CLAUDE.framework.md rules?
> - Hook behaviour vs command expectations — do hooks enforce rules
>   that commands assume won't be enforced?
> - Contract markers — does any command or agent reference a
>   `status:draft` contract as if it's stable?
> - GOTCHAS.md items marked FIXED — does the fix actually exist in
>   the code/config, or is it stale?
>
> **Redundancy detection.**
> - Duplicate files covering the same concern (old reference files
>   superseded by agent_docs)?
> - Commands duplicating each other's behaviour?
> - Hooks overlapping in what they check?
> - agent_docs entries repeating information already in CLAUDE.md
>   or ECOSYSTEM.md?
>
> **Security and hygiene.**
> - settings.json deny rules cover .env, .ssh, .aws, secrets, credentials?
> - .gitignore covers .env, .env.*, settings.local.json, worktrees/,
>   .drift-state, telemetry/, flag files?
> - No secrets or API keys in agent definitions, commands, hooks, or skills?
> - Hook scripts don't execute untrusted input or download from URLs?
>
> Return findings categorised as:
> - **BROKEN** (blocks work or produces incorrect behaviour)
> - **CONFLICT** (two parts of the framework contradict each other)
> - **ORPHANED** (exists but nothing references it)
> - **REDUNDANT** (duplicates something else — note what it duplicates)
> - **STALE** (exists and is referenced but content is outdated)
> - **OK** (checked, no issues)

**If no framework changes detected → skip the deep audit.** Doctor +
insights output alone is sufficient — the framework hasn't moved.

**1.4. PERSIST.** Append findings to `.claude/review-findings.md`
with a timestamped header. Use this shape:

```markdown
## /healthcheck — Part 1 Framework Integrity — <ISO timestamp>
<findings>
```

Release from context before moving to Part 2.

---

## Part 2 — Project code review (skip if no project code)

Reviewer subagent. Prompt template (fill in the detected sources):

> **Independence rule.** Do NOT read `.claude/review-findings.md`
> before forming your audit. That file is write-only for you. Audit
> the source from scratch.
>
> Review `<HEALTHCHECK_SOURCE_DIRS>` and `<HEALTHCHECK_TEST_DIRS>` for:
> bugs, dead code, edge cases, concurrency / async correctness, test
> gaps, and any stack-specific correctness (framework/library usage,
> security surface, performance red flags).
>
> Additional focus areas: `<HEALTHCHECK_REVIEW_FOCUS>` (from config,
> optional).
>
> Do NOT load state files. Return findings grouped by severity
> (CRITICAL / HIGH / MEDIUM / LOW) with file:line, issue, impact,
> and suggested fix. If a suggested fix names a specific API, library,
> flag, or value, mark it VERIFIED or UNVERIFIED (behavioral-principles §4)
> — a quick-read guess must not read as a decision to a later session.

**PERSIST** to `.claude/review-findings.md`. Release from context.

---

## Part 3 — Contract verification (skip if no contracts)

Reviewer subagent. Prompt:

> **Independence rule.** Do NOT read `.claude/review-findings.md`
> before forming your audit. That file is write-only for you. Verify
> contracts against source files alone.
>
> For each contract in ECOSYSTEM.md (blocks tagged
> `<!-- contract:ID status:stable -->`) OR in `contracts/` directory:
> read the contract, find the source file(s) implementing it, and
> verify signatures, params, return types, and behaviour match.
>
> Also verify ECOSYSTEM.md module boundaries — all modules listed,
> paths correct. Check contract markers — `status:draft` only where
> work is in flight; `status:stable` only where implementation exists.
>
> Return:
> - **MISMATCH** (contract says X, code does Y)
> - **MISSING** (code exists, no contract)
> - **DRIFT** (contract exists but signature changed unannounced)

**PERSIST** to `.claude/review-findings.md`. Release from context.

---

## Part 4 — State file consistency

Reviewer subagent. Prompt:

> **Independence rule.** Do NOT read `.claude/review-findings.md`
> before forming your audit. That file is write-only for you.
> Cross-check from the state files themselves.
>
> Cross-check the project's state files (do NOT load source code):
> - `TASKS.md` — valid statuses, no stuck tasks, Done entries have commit refs
> - `STATUS.md` — matches TASKS.md board; if "tests passing" is claimed,
>   does the project have a passing test run?
> - `DECISIONS.md` — no contradictions between entries
> - `ECOSYSTEM.md` — module boundary section matches project layout
> - `GOTCHAS.md` — items marked FIXED have evidence in code/config
> - `CLAUDE.md` — referenced paths and folder structure match reality
> - `claude-progress.txt` — rolling summary reflects recent session log
>
> Return:
> - **MISALIGNMENT** (must fix — state files disagree with each other
>   or with reality)
> - **STALE** (should update — item is old enough to be revised)

**PERSIST** to `.claude/review-findings.md`. Release from context.

---

## Part 5 — Automated checks (skip if commands not detected)

Runs after Part 4's PERSIST completes (the parts are sequential —
persist-and-release means there is no concurrent window). To save a
round-trip, issue these shell commands in the same turn as Part 4's
persist step:

- Test command (from `HEALTHCHECK_TEST_CMD` or CLAUDE.md Commands section).
- Lint command (from `HEALTHCHECK_LINT_CMD` or CLAUDE.md Commands section).

Capture non-zero exits and append the relevant output to
`.claude/review-findings.md`. Keep it compact — paste failure lines
only, not entire test logs.

---

## Part 6 — Checkpoint

Before proceeding to fixes, ask the user via AskUserQuestion:

- Commit the audit file as a checkpoint, then continue with fixes
- Continue with fixes but don't commit yet
- Stop here — I want to review findings manually first

Creating a checkpoint commit means if the fix phase runs out of context
or crashes, the audit survives. This is the most valuable disk write
the command produces.

---

## Part 7 — Act on findings

**Read from `.claude/review-findings.md` now — not from conversation
memory.** The ephemeral-context rule applies to YOU as much as to any
other agent.

1. **CRITICAL / BROKEN / MISMATCH / MISALIGNMENT** → create P0 tasks
   in `TASKS.md` (feature lane or Bug-Fix Lane as appropriate).
   Each task includes a reference back to the findings file entry.
2. **STALE** → fix state files directly, commit separately.
3. **ORPHANED / REDUNDANT** → flag for the next architect session;
   log entries in `FRAMEWORK-SUGGESTIONS.md` if they're
   framework-level, otherwise in `GOTCHAS.md`.
4. After each batch of fixes, update `TASKS.md` and `STATUS.md` —
   do not defer state updates. Hooks will block session end otherwise.
5. If fixes touch more than 10 files, suggest a commit checkpoint to
   the user before continuing.
6. Update `.claude/telemetry/.last-healthcheck` with the current ISO
   timestamp — this is what the cold-start nudge reads.
7. Report summary to the user. Include: counts per severity, new
   tasks filed, files touched, commit hashes of any checkpoints made.
8. Update `claude-progress.txt` with the session summary.

---

## Edge cases

- **No project code (upstream framework repo dogfooding, or fresh
  clone pre-code).** Parts 2, 3, 5 skip with a note. Parts 1 and 4
  still produce value.
- **No state files populated yet (brand-new project).** Part 4 notes
  "state files contain only templates" and skips deeper consistency
  checks.
- **jq missing.** Parts 1.1-1.2 may produce reduced output. Flag and
  continue.
- **Reviewer subagent returns truncated or empty.** Treat as a
  soft-failure: note "subagent review unavailable for Part X" in
  findings and continue. Don't halt the whole run.

## Known limitation

This command is linear (parts in sequence, though subagents within
a part may parallelise). A 10-minute audit isn't cheap. The
cold-start nudge only prompts every `HEALTHCHECK_REMIND_DAYS` days
(default 14), so it shouldn't become ritual. For tighter cadences,
wire `/loop` or the `schedule` skill around this command directly.

---

## Determinism mode (`/healthcheck --verify N`)

**Purpose.** Verify the audit produces stable findings on an unchanged
tree. This is the standard test BEFORE any framework code is written
to consume /healthcheck output (drift detectors, aggregators, doctor
invariants, alerting). Without it, you risk shipping automation
against a non-deterministic input — exactly the trap BUG-001 caught
on 2026-04-26.

**N.** Default 3. Lower is statistically weak; higher is overkill for
most cases. Use 5+ only if early runs show small variance you want to
characterise more precisely.

**Protocol.**

1. **Lock the tree.** Confirm `git status` shows clean. If not, stash
   or commit first — variance between runs must be attributable to the
   detector, not edits.
2. **Run N audits sequentially.** Each run is a full /healthcheck pass.
   Critically, the orchestrator (you) must NOT prime subagents with
   stability-experiment language. Forbidden phrases in any subagent
   prompt: "RUN N of M", "stability test", "insert before existing
   block", "compare against prior", "consistency check". Each subagent
   should believe it's running a standalone /healthcheck. (Reason: the
   2026-04-26 experiment proved that priming language causes anchoring
   even when the file-rotation defense is in place.)
3. **Rotation is non-negotiable.** Part 0.0 already rotates
   `.claude/review-findings.md` → `.claude/review-findings/<ISO>.md`
   at the start of every run. Each of the N runs starts from a clean
   `review-findings.md`. Confirm this is happening before run 2 starts.
4. **Capture per-run counts.** After each run, snapshot the finding
   counts by category (CRITICAL / WARNING / SUGGESTION / by part) to
   a temp summary. Note: you (the orchestrator) WILL hold prior runs'
   results in context by the comparison step — that is expected and
   unavoidable. The anchoring defenses that actually work are the
   file rotation (step 3) and keeping every subagent prompt identical
   to a standalone run; do not rely on orchestrator amnesia.
5. **Compare after all runs complete.** Report:
   - Total findings per run.
   - Count variance: max - min, and stddev if N ≥ 3.
   - Category variance: for each category, max - min.
   - Item-level overlap: of unique findings across runs, how many
     appeared in every run? In ≥N-1? In only one?
6. **Interpret.**
   - **Stable** (variance ≤ 10% of total, item overlap ≥ 80%):
     /healthcheck output is consumable by automation. Proceed with
     building consumers.
   - **Unstable** (variance > 10% OR item overlap < 80%): output is
     NOT consumable. Either fix the determinism gap (likely candidates:
     subagent priming, file-rotation slip, subagent context leakage) or
     declare the metric intrinsically noisy and drop any consumer plans.
   - **Decaying or growing** (monotonic trend across runs on unchanged
     tree): this is the BUG-001 failure mode. There's a feedback channel
     between runs. Investigate before consuming.

**Output.** Write the comparison to
`.claude/review-findings/_determinism-<ISO>.md` (underscore prefix to
sort it visibly at top). Format:

```markdown
# /healthcheck --verify N=<N> — <ISO>

## Per-run totals
| Run | CRITICAL | WARNING | SUGGESTION | TOTAL |
| --- | -------- | ------- | ---------- | ----- |
| 1   | …        | …       | …          | …     |
| 2   | …        | …       | …          | …     |
| N   | …        | …       | …          | …     |

## Variance
- Total max-min: …
- Stddev (N≥3): …
- Item overlap (in all runs): …%

## Verdict
- Stable / Unstable / Decaying-or-Growing

## Consumer guidance
- (one paragraph: is it safe to build automation against this output?)
```

### Perturbation variant (`/healthcheck --verify N --perturb`)

**Why.** Plain `--verify` repeats *identical* input and measures variance —
it catches feedback channels and priming (BUG-001), but it does NOT catch
the failure you most care about for a detector: **a finding that flips when
the input changes cosmetically**. A reviewer that flags a bug only when a
file has trailing whitespace, or that loses a finding when a comment is
reworded, is fragile regardless of how stable it looks under repetition.
Perturbation mode tests robustness to semantics-preserving input changes
(the LLM-as-judge "perturbation suite" technique), which is the real
determinism property.

**Safety — never touch the real tree.** All perturbation happens on a
throwaway copy. Create a worktree or copy first:

```bash
git worktree add ../_verify-perturb HEAD   # or: cp -r the tree to a tempdir
```

Run every perturbed audit there; remove it when done
(`git worktree remove ../_verify-perturb`). The real working tree is never
modified.

**Protocol (replaces step 2 of the base protocol; keeps 1, 3–6).**

2p. **Run 1 = baseline** on the unperturbed copy. For runs 2…N, apply ONE
   semantics-preserving transform to the copy before auditing, each
   chosen to change text without changing meaning:
   - reflow whitespace / re-indent (no logic change)
   - reword or rewrap comments and docstrings
   - insert blank lines between blocks
   - rename a handful of *local* variables (not public API)
   - reorder independent imports / independent top-level declarations
   Apply formatters where available (prettier/ruff/gofmt) for run 2 — a
   format-only diff is the canonical "should change nothing" perturbation.

**Added comparison dimension — fragile findings.** Beyond the base
variance/overlap report, compute: of the findings on the baseline, which
**disappeared** under a perturbation that changed no semantics, and which
**new** findings appeared? Those are *fragile* — they depend on incidental
text, not real defects.

**Added verdict.**
- **Robust** — finding set is invariant (≤1 fragile finding across all
  perturbations). Safe to consume.
- **Fragile** — findings flip under cosmetic change. Do NOT build
  automation on this check; the finding is an artifact of formatting, not
  the code. Fix the check (anchor it to AST/structure, not text) or drop it.

**Output.** Extend the `_determinism-<ISO>.md` report with a section:

```markdown
## Perturbation robustness (--perturb)
| Run | Perturbation         | Findings vs baseline | Fragile (vanished/new) |
| --- | -------------------- | -------------------- | ---------------------- |
| 1   | none (baseline)      | —                    | —                      |
| 2   | format-only          | …                    | …                      |
| N   | comment reflow       | …                    | …                      |

Robust / Fragile — <one line: are findings invariant to cosmetic change?>
```

### Input-pinning variant (`/healthcheck --verify N --pin`)

**Why.** Plain `--verify` repeats on an "unchanged tree" — but an
*unchanged tree* is not the same as *identical detector input*. An
LLM-driven check (the Reviewer, a healthcheck subagent) also consumes
things that can drift between runs even on a clean tree: `git` output
ordering, file mtimes, tool results, directory-listing order, a freshly
re-read file. So when plain `--verify` shows variance, you cannot tell
**model nondeterminism** (the LLM gave different findings for the same
input) from **environmental drift** (the input the LLM saw actually
differed). They need opposite fixes. `--pin` separates them.

`--perturb` and `--pin` are mirror images: `--perturb` deliberately
*varies* input to test robustness; `--pin` deliberately *freezes* input to
isolate the model.

**Mechanism (what we can and can't do).** We don't control Claude Code's
model client, so we can't stub the LLM and replay it token-for-token. What
we CAN do is **pin the input half**: snapshot the exact bytes the detector
consumed on run 1 — the diff, the contract text, the file contents, any
tool output embedded in the subagent prompt — to a fixture, then feed that
*same frozen snapshot* to runs 2…N instead of letting each run re-derive
its input from the live tree.

**Protocol (replaces step 2; keeps 1, 3–6).**

2pin. **Run 1 — capture.** Run the check; as you assemble each subagent's
   prompt, also write the full input it received (embedded file contents,
   diff, contract blocks, tool results) verbatim to
   `.claude/review-findings/_pinned-input-<ISO>/`. This is the snapshot.
2pin-b. **Runs 2…N — replay the snapshot.** Feed each subagent the pinned
   snapshot as its input verbatim. Do NOT let it re-read the live tree or
   re-run tools — the whole point is byte-identical input. (No priming
   language, same as base protocol.)

**Attribution verdict (this is the payoff).**
- **Findings stable on pinned input** → the model is effectively
  deterministic here; any variance plain `--verify` showed was
  **environmental drift**. Fix the environment, not the prompt: pin tool
  outputs, sort directory listings, freeze timestamps, snapshot git state.
- **Findings still vary on pinned input** → **pure model nondeterminism**.
  No environment fix will help. Reach for the per-criterion analytic
  rubric + seeded multi-sample aggregation (the LLM-as-judge stability
  techniques) before building any consumer on this check.

**Output.** Add to `_determinism-<ISO>.md`:

```markdown
## Input-pinning attribution (--pin)
- Snapshot: .claude/review-findings/_pinned-input-<ISO>/
- Findings on pinned input across runs: stable / varying
- Attribution: model-nondeterministic / environmental-drift
- Recommended fix: <per-criterion+ensemble | pin the drifting input source>
```

**When NOT to run.** Don't make these modes a periodic cadence. They're
expensive (N× the cost of /healthcheck) and only matter as a gate before
automation. Plain `--verify` is the minimum gate. Add `--perturb` when the
consumer treats findings as ground truth (drift trendlines, auto-filed
tasks). Add `--pin` when plain `--verify` showed variance and you need to
know whether to fix the model layer or the environment before proceeding.
Once a consumer ships against verified output, you don't re-run unless
/healthcheck itself changes.

**Doctor pairs with this.** When a new framework file is added that
references `.claude/review-findings.md` or its rotated archive, doctor
should warn if /healthcheck hasn't been run in `--verify` mode
recently — see doctor.sh Check 9.
