# Operations — cross-cutting reference

The digest (`plugins/ccmaf/DIGEST.md`) covers always-loaded standing rules.
This file is the on-demand reference it points to: hook tuning, permission
gating, MCP guidance, framework-feedback routing, code-quality rules, code
navigation, the reference-documents index, and the unattended profile. Read
it when one of these areas comes up — not preemptively on every session.

Ported from the v1 `CLAUDE.framework.md` (retired at v2.1 — see
`docs/tiering/CORE-DESIGN.md` §1). Mechanisms are updated to the v2 shape
where the design calls for it; anything still describing v1-only machinery
is marked inline.

## Hook Configuration (consumer-tunable)

Hooks honour two environment variables (resolved by each plugin's own
`hooks/lib/hook-common.sh` — core carries its own copy, drift-guarded
against the kernel/devhooks/console copies):

- `CLAUDE_HOOK_PROFILE=minimal|standard|strict` (default `standard`).
  - **minimal** — only safety-tier hooks run (the kernel's dangerous-command
    guard and its health monitor). Everything else is silenced. For
    low-context/local-model setups or quick throwaway work.
  - **standard** — all shipped hooks run. This is the default.
  - **strict** — standard plus any hooks declared at the `strict` tier
    (reserved for future opt-in extra-strict checks).
- `CLAUDE_DISABLED_HOOKS="format,lint"` — comma/space-separated list of
  stable hook IDs to turn off regardless of profile. An explicit disable
  always wins, even for safety-tier hooks.

Legacy per-hook opt-outs still work and compose with the above:
`CLAUDE_DEP_VERIFY=0` (skip dependency registry checks), `CLAUDE_DOTNET_FORMAT=1`
/ `CLAUDE_DOTNET_LINT=1` (opt into slow .NET tooling), `CLAUDE_SUGGEST_COMPACT_TURNS=N`
(compaction-nudge cadence). Session-lifecycle knobs: `CLAUDE_CONTEXT_WINDOW_TOKENS=N`
(window size for the watermark % estimate; default 200000 — **set 1000000 on
a [1m]-context session** or the checkpoint nudge fires immediately),
`CLAUDE_CHECKPOINT_WATERMARK_PCT=N` (nudge threshold %, default 75).

## Permission Gating (consumer-tunable)

In v2, `.claude/settings.json` SHRINKS to permissions + `statusLine` — no
hook registrations (hooks arrive via plugins), which makes this section
more load-bearing than it was in v1. The project's own settings already
deny reads/writes of secret paths, and the kernel's guard blocks destructive
commands. To require an interactive confirm before a *specific*
risky-but-allowed operation, tune the harness's own `permissions.ask`
matrix — no custom gate hook needed (the harness provides the
approve/edit/deny prompt; the framework only feeds it patterns). Add an
`ask` array alongside `allow`/`deny`:

    "permissions": {
      "allow": [ ... ],
      "ask": [
        "Bash(git push --force:*)",
        "Bash(git push --force-with-lease:*)",
        "Bash(rm -rf:*)",
        "Edit(**/migrations/**)"
      ],
      "deny": [ ... ]
    }

Each pattern prompts before that operation; everything else stays on the
`allow`/`deny` decision. The safety floor stays in the kernel's guard
(non-tunable; heuristic defense-in-depth, not a security boundary); `ask`
is for project-specific "make me confirm this" cases.

**Confirm the syntax for your version (UNVERIFIED here):** the permission
lists (`allow`/`ask`/`deny`) are the harness's mechanism, but the exact
matcher forms (`Bash(<cmd>:*)`, the `**/…` globs) are Claude Code
version-specific — check the Claude Code permissions documentation for your
version before relying on the patterns above; treat them as illustrative.
(`settings.json` is strict JSON — no comments; keep this matrix documented
here, not inline.)

## MCP Servers

- Only enable servers you're actively using — check `/mcp` for token costs.
- Prefer CLI tools over MCP when available — lower token overhead.

## Framework Feedback

- Log framework improvement ideas in `.claude/FRAMEWORK-SUGGESTIONS.md`. If
  you adopted this framework, those ideas only help if they reach its
  maintainers — this file is local to your project. Contribute them back
  upstream (open an issue/PR at the `FRAMEWORK_UPSTREAM_URL` in
  `.claude/.framework-version`) so every project benefits; see that file's
  header.

## Code Quality Rules

- **Check before creating:** read `docs/code-conventions.md` (project-owned;
  scaffolded by `/ccmaf:init`) and check for existing shared helpers first.
- **Reuse over duplication:** only create new abstractions when there is
  clear duplication.
- **Domain language:** use existing terminology from the project's
  contracts source (`.claude/ECOSYSTEM.md` by default) — no new names for
  existing concepts.
- **Machine-readable contracts:** contracts must include fenced code
  blocks anchored with `<!-- contract:ID status:stable -->`. Add one when
  you touch a contract area.
- **Update conventions as you go:** a new stable pattern → update
  `docs/code-conventions.md` in the same commit.
- **Simplicity ladder + safety floor:** before adding code, a dependency,
  or a file, apply *Simplicity First* (`behavioral-principles.md` §2) —
  take the smallest step that solves the problem, and prefer reusing or
  removing over adding — but never weaken the validation / error-handling
  / security floor in §2 or the prompt-injection / secrets /
  no-autonomous-commit floor in §6–7.

## Code Navigation

- If a code graph MCP server is configured (check `/mcp`), use it before
  grep/glob.
- Prefer targeted searches over full-codebase scans.

## Reference Documents (read when relevant)

`agent_docs/*` paths below live inside the ccmaf plugin's install
directory, not this project — `${CLAUDE_PLUGIN_ROOT}` only substitutes
inside command/agent markdown at load time, not when this file (a plain
reference doc) is read directly, and it is not set in a shell. To resolve
it yourself: `claude plugin list --json` → the `ccmaf` entry's
`installPath`.

- Building → the ccmaf plugin's `agent_docs/building.md`
- Testing → the ccmaf plugin's `agent_docs/testing.md`
- Verify handback (per-feature review stories + the `contract:verify-handback`
  schema; forward + retroactive/batch procedure) → the ccmaf plugin's
  `agent_docs/verify-handback.md`
- Orchestrator state (optional `NOW.md` / `GROUND-TRUTH.md` / `PLAYBOOK.md`
  — the post-compaction boot set; quote-don't-paraphrase rule) → the
  ccmaf plugin's `agent_docs/orchestrator-state.md`
- Conventions → `docs/code-conventions.md` (project-owned; scaffolded by
  `/ccmaf:init`)
- Architecture → `docs/architecture.md` (project-owned; scaffolded by
  `/ccmaf:init`)
- Behavioral principles (per-turn discipline — think before coding,
  simplicity, surgical changes, goal-driven execution — loaded by each
  agent on handoff) → the ccmaf plugin's `agent_docs/behavioral-principles.md`
- Retro-audit checklist / adopted-feedback registry (used by
  `/ccmaf:healthcheck` and `/ccmaf:housekeeping`) → the ccmaf plugin's
  `agent_docs/RETRO-AUDIT.md` / `agent_docs/ADOPTED-FEEDBACK.md`
- Attestation snippet (opt-in model-integrity check for a dispatch brief) →
  the ccmaf plugin's `agent_docs/attestation.md`
- Requirements / specs / plans (project-owned, versioned with the project)
  → `docs/requirements/`, `docs/specs/`, `docs/plans/`
- Supplementary docs (inspiration / research / images / diagrams) →
  `docs/` — deposit material here as you work (the Console surfaces the
  `docs/` tree under its Docs tab); don't leave research or diagrams only
  in chat. See `docs/README.md`.
- Gotchas → `.claude/GOTCHAS.md` · Framework metrics →
  `.claude/framework-metrics.md`

## Unattended profile (`CLAUDE_UNATTENDED=1`)

Per-run scope, four layers (full detail: `docs/tiering/CORE-DESIGN.md` §8):

1. **Digest banner policies** — at 90% context: checkpoint + compact
   without asking. On ambiguity with a defensible minimum: take it, log to
   `.claude/unattended-log.md`, continue. On ambiguity with no defensible
   minimum: mark the task Blocked with a written question and move to the
   next task — never end the run because a question arose.
2. **Machine gates** (`unattended-guard`, PreToolUse) — deny
   `AskUserQuestion` when unattended, with the policy text as the deny
   reason. When unattended AND doctor reports a CRITICAL finding: the gate
   **inverts to an allowlist** — deny every tool except a known read-only
   set (Read/Grep/Glob and equivalents, across Bash/PowerShell/MCP tool
   names alike, not a blocklist of just Write/Edit/Bash) with "resolve
   CRITICAL findings; run halted", and write `.claude/unattended-halt.md`
   once as the supervisor-visible signal. **Precedence rule: the CRITICAL
   halt beats "never end the run."**
   **Halt-file lifecycle:** while `.claude/unattended-halt.md` exists AND
   doctor still reports a live CRITICAL finding, the Stop hook's
   NON-NEGOTIABLE state-file enforcement (TASKS/STATUS/progress) is
   suspended too — deadlock prevention, since a halted run cannot Write to
   satisfy that gate. The file is not permanent: the next session's cold
   start clears it automatically once doctor no longer reports CRITICAL, so
   the exemption cannot outlive the condition that justified it. A
   supervisor may also delete it by hand after triage to re-arm full
   enforcement immediately, without waiting for the automatic clear.
3. **Cold start** — flags are logged, not asked (the batched
   AskUserQuestion is skipped); doctor-CRITICAL halts per layer 2.
4. **Run summary** — `/ccmaf:wrapup` (or the run's end) emits one line:
   "N tasks done, M Blocked with questions, K defaults logged" — one place
   for a human reviewing an overnight run to look.
