---
description: Scaffold this project onto the CCMAF v2 framework (state files, settings, aliases, feature opt-ins)
---
# /ccmaf:init — scaffold a CCMAF v2 project

Turns the current repo into a CCMAF v2 project: writes the per-project STATE
scaffold (the plugin already carries all code and prose), asks ONE batched
feature question, and reports every file it created, merged, or skipped.
Idempotent: a re-run repairs missing scaffold pieces and never overwrites
consumer content.

## Step 0 — context checks (all three, in order)

1. **Kernel present (D1-a, NON-NEGOTIABLE):** the `ccmaf-kernel` plugin must
   be active. Primary check — your own session context: if the CCMAF kernel
   rules (the "CCMAF kernel" SessionStart injection) are NOT visible in this
   session's context, treat kernel as absent. Secondary machine check:
   `timeout 10 claude plugin list --json` and look for `"ccmaf-kernel@ccmaf"`
   with `"enabled": true`. If absent by both: print
   `claude plugin install ccmaf-kernel@ccmaf --scope user`, tell the user to
   run it and start a new session (plugin installs load at session start),
   and STOP. Init never scaffolds an unguarded project.
2. **v1 refusal:** if `.claude/.framework-version` exists WITHOUT a
   `FRAMEWORK_LINE=v2` line, STOP: "this is a v1-line CCMAF project — run the
   v2 migration (migrate-v2.sh ships with the v2.0 update), not /ccmaf:init.
   Init on a live v1 project would strand its bundled hook registrations."
   **Dev-repo refusal:** if `.claude/.framework-dev-repo` exists, STOP —
   this is the framework's own dev repo (it IS the upstream); its
   `.framework-version` carries publish-lifecycle pin fields the template
   write in Step 4.5 would clobber. The dev repo's v2 crossover is
   hand-crafted (TASK-176), never scaffolded.
3. **Git:** if the directory is not a git repo, ask the user whether to
   `git init` (a board without history has no provenance); proceed only on
   yes. (Unattended: log and proceed with `git init` — a defensible minimum.)
4. **CWD sanity — init operates on the session's working directory ONLY.**
   If the cwd is plainly not a project (a system directory like
   `C:\Windows\*`, a home directory root, a drive root), STOP and tell the
   user to `cd` into the project and relaunch. NEVER scan other
   directories, additional working directories, or drives for candidate
   projects — no probing, however read-only. (Live acceptance-test finding
   2026-08-10: an init launched from System32 went hunting through the
   user's OneDrive for `.claude` folders.)

## Step 1 — write the scaffold (report every path as CREATED / SKIPPED / MERGED)

Templates live at `${CLAUDE_PLUGIN_ROOT}/templates/`. Rules: existing files
are never overwritten (SKIPPED, except the two MERGE cases below); a path
listed in `.claude/.scaffold-removed` (one path per line) is a deliberate
consumer deletion — do NOT recreate it, report it as TOMBSTONED.

**RE-RUN semantics (round-2 review fix):** if `.claude/.framework-version`
already carries the v2 line, this is a REPAIR run on a previously-scaffolded
project — an ABSENT piece that is not tombstoned gets the missing-piece
flow, exactly as in `/ccmaf:update` Step 2 (attended: ask restore vs keep-
removed → tombstone; unattended: report PENDING, log the question, recreate
nothing). Silent recreation is only for a FRESH init (no v2 line yet), where
absence just means "not created yet".

1. `mkdir -p .claude/telemetry` (and `.claude/specs/` — /ccmaf:plan writes
   acceptance specs there; drop a `.gitkeep` in `.claude/specs/` so this
   committed-content directory survives a fresh clone).
2. State files from templates, replacing `{{date}}`/`{{agent}}`/`{{project-name}}`
   placeholders: `TASKS.md`, `STATUS.md`, `DECISIONS.md`, `ECOSYSTEM.md`,
   `GOTCHAS.md`, `FRAMEWORK-SUGGESTIONS.md`, `claude-progress.txt`,
   `framework-metrics.md`, `review-findings.md`, `test-findings.md` →
   `.claude/`. `{{agent}}` = the invoking agent's name (`orchestrator` when
   unnamed). Angle-bracket tokens such as `<date>`/`<agent>` inside template
   comment blocks are LITERAL examples for future entries — only `{{…}}`
   placeholders are ever substituted.
3. `.claude/settings.json`: absent → copy the template (CREATED). Present →
   **MERGE the permissions block**: add each template `deny`/`ask` entry the
   consumer file lacks (preserve every consumer entry); add the `statusLine`
   key only if absent; VALIDATE the result parses as JSON before writing
   (python `json.load` — on failure, write nothing and report the conflict).
4. `.claude/statusline.sh` from the template (the settings statusLine key
   points at it).
5. `CLAUDE.md`: absent → from template. Present → SKIP (consumer-owned; do
   not append anything).
6. `docs/` scaffold: `docs/README.md` from `templates/docs-README.md` +
   `docs/{inspiration,research,images,diagrams}/.gitkeep`
   — only the pieces that don't exist. Then `docs/code-conventions.md` and
   `docs/architecture.md` from `templates/code-conventions.md` /
   `templates/architecture.md` (CREATED if absent, else SKIPPED —
   consumer-owned once populated).
7. `.gitignore` entries — probe each with `git check-ignore -q <probe-path>`
   and append only what's missing (create `.gitignore` if absent):
   `.claude/telemetry/`, `.claude/console/`, `_advisors/`,
   `.claude/unattended-log.md`, `.claude/unattended-halt.md`,
   `.claude/.drift-state`, `.claude/.checkpoint-state*`,
   `.claude/.session-start-commit.*`, `.claude/.last-compaction`,
   `.claude/.precompact-snapshot/`, `.claude/.compaction-archive/`,
   `.claude/.dep-verification-issues.md`, `.claude/.framework-doctor-findings.md`,
   `.claude/.framework-insight-alert.md`, `.claude/.instinct-candidates.md`,
   `.claude/.console-suggestion.md`, `.claude/.skills-update-available.md`,
   `.claude/review-findings/`, `.claude/security-findings*`,
   `.claude/settings.local.json`. (`.claude/specs/` is committed content —
   never add it here.)
8. The **activation switch is NOT written here** — it is the last write of
   the whole run (Step 4.5, after features and aliases). Acceptance-walk
   finding 2026-08-10: writing it at the end of this step still left the
   Step-2 feature markers and Step-4 aliases AFTER activation, so a crash
   mid-init could produce a v2-marked project with no aliases. "Written
   last" must span the entire init.

## Step 2 — ONE feature question (features, not plugins)

Ask ONE AskUserQuestion (multiSelect). **Unattended means `CLAUDE_UNATTENDED=1`
is set — nothing else.** A human who typed `/ccmaf:init` is attended even
under a general autonomy directive (acceptance-walk finding 2026-08-10: the
question was wrongly skipped on such a directive). Unattended: skip, log
"features not configured — re-run /ccmaf:init attended to opt in", continue:

- **Console for this project?** → `echo latest > .claude/.console-version`
  (+ commit note). Needs the `console` plugin + the `ccmaf-console` npm
  server.
- **Watcher mode (codex cross-checks on review/verify)?** → needs the
  `advisors` plugin; on yes, after the gap check below, set the registry
  `[modes]` per its PROTOCOL (the advisors plugin's `/advisors:mode` command
  does this — invoke it by name if it resolves, else leave a one-line TODO
  in STATUS).
- **Skills sync?** → create `.claude/.skills-version` per the CCMAF---Skills
  repo's pin format (the cold-start chain then keeps it current).
- **CodeQL CI** (only if `.github/workflows/codeql.yml` exists): private
  free-tier repo → rename to `codeql.yml.disabled`; public or GHAS → keep.
  Either way `touch .claude/.ci-configured`.

Feature markers are written even when the matching plugin isn't installed
yet — the cold-start chain nudges until it is.

## Step 3 — plugin gap check

`timeout 10 claude plugin list --json`. For each feature chosen above whose
plugin is missing, and for any sibling the user asks about, print the exact
command: `claude plugin install <name>@ccmaf --scope user`
(advisors · council · media · devhooks · console). Never install plugins
yourself — installs are the user's machine-level choice.

## Step 4 — bare aliases (owner ruling D2, mechanism S7-verified)

From `templates/alias.md`, write `.claude/commands/<command>.md` for every
CORE command (init excepted): plan, build, test, review, analyse, security,
wrapup, pre-compact, post-compact, reconcile, healthcheck, board-heal, bug,
housekeeping, update — `{{plugin}}` = `ccmaf`. For each INSTALLED sibling
plugin, alias its commands too (advisors: fable/sol/terra/luna/consult/
crossbench/mode; media: image; council: council). Respect
`.claude/.scaffold-removed`; never overwrite an existing project command
(SKIPPED — it may be a consumer customisation that shadows the plugin).

## Step 4.5 — LAST WRITE: the activation switch

`.claude/.framework-version` from `templates/framework-version`, then REWRITE
its `SCAFFOLD_REV=` line to the value in
`${CLAUDE_PLUGIN_ROOT}/templates/.scaffold-rev` (the single source of truth —
the template's own number is only a fallback; stamping from `.scaffold-rev`
means the two can never diverge and a fresh project is never born "behind").
This is the FINAL write of the run — after features and aliases — so a failed
init never leaves a half-scaffolded project claiming to be v2. Fire-time
consequence to state honestly in the report: the moment this file lands, the
core's tool-time and turn-time hooks (all gated by `core_active()`) go LIVE
in the CURRENT session; only the SessionStart digest/check chain waits for
the restart.

## Step 5 — commit + report

1. `git add` the scaffold; commit: `chore: CCMAF v2 scaffold (ccmaf:init)`.
2. Print the full CREATED / MERGED / SKIPPED / TOMBSTONED report. To
   deliberately remove a scaffolded file for good, delete it and add its
   path to `.claude/.scaffold-removed` (one path per line, create the file
   if it doesn't exist) — otherwise a later `/ccmaf:init` or `/ccmaf:update`
   run will ask whether to restore it (see `/ccmaf:update` Step 2).
3. Print next steps: restart the session (the SessionStart digest + check
   chain activate now that the v2 line exists — the tool/turn-time hooks are
   ALREADY live, per Step 4.5), then `/ccmaf:plan` or `/ccmaf:bug` to seed
   the board.
