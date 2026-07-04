# Framework Doctor

Point-in-time integrity check for the framework itself. Runs on cold
start (step 3) and on demand. Silent when clean; writes a findings
file when any invariant is broken.

## Complements

- [`.claude/framework/update/`](../update/) — *pulls* new framework versions.
- [`.claude/framework/insights/`](../insights/) — tracks *behavior* over time.
- Doctor — tracks *state* at a moment in time. Answers "is the
  framework intact right now?"

## Invariants checked

| # | Check | Severity if broken | Why it matters |
| --- | --- | --- | --- |
| 1 | Hook scripts in `settings.json` exist on disk | CRITICAL | Missing file = hook silently doesn't fire |
| 1 | Hook scripts on disk are referenced in `settings.json` | WARNING | Dead code — either wire it or delete it |
| 2 | Markdown cross-references in framework docs resolve to real files | WARNING | Dead links are invisible until someone clicks |
| 3 | `CLAUDE.md` `@import`s `CLAUDE.framework.md` (a plain markdown link is NOT loaded) | CRITICAL | Claude Code only inlines `@path` imports — with a link-style pointer the framework rules never reach sessions |
| 4 | Every path in `framework-manifest.txt` exists locally | CRITICAL | `apply-update.sh` would fail mid-copy |
| 5 | `.framework-version` has all required fields | CRITICAL | Updates won't work |
| 6 | *(retired 2026-06-10 — multi-project mode removed, TASK-023)* | — | Number kept so later checks stay stable |
| 7 | No duplicate TASK-ID headings in TASKS.md | WARNING | Breaks commit linkage and status tracking |
| 8 | *(retired 2026-06 — framework-self mode removed, TASK-054)* | — | Number kept so later checks stay stable |
| 9 | Framework code newly consuming `review-findings.md` as input has a `/healthcheck --verify` run since | WARNING | Building on an unvalidated detector repeats the BUG-001 mistake |
| 10 | `statusLine.command` reads stdin, not the nonexistent `$CLAUDE_STATUS_JSON` env var | WARNING | Statusline renders permanent `?` placeholders — context-awareness rules assume the percentage is visible |
| 11 | GNU toolchain capabilities present (`find -printf`, `date -d`, GNU `sed -i`) | WARNING | On BSD/macOS userlands these features go silently dead — throttles never engage, rewrites skip (DA-C8) |
| 12 | Root `GOTCHAS.md` / `FRAMEWORK-SUGGESTIONS.md` free of leaked upstream framework-dev entries | WARNING | Pre-2026-06-10 clones inherited the upstream repo's own dev notes (TASK-027 leak) — noise that misleads every session reading state files |
| 13 | State-file structural grammar (TASKS/DECISIONS/GOTCHAS/ECOSYSTEM: lane headings, status-section placement, lane routing, the middot separator, the Confidence marker, contract status enum) | WARNING (INFO for the telemetry frozen-keys sub-check) | Drift here SILENTLY drops entries from downstream machine-readers — a task vanishes from a board, a decision's Status won't parse, a contract goes undetected |
| 14 | Reconcile cadence: N tasks entered Done since `.last-reconcile`'s mtime, N >= `RECONCILE_DUE_THRESHOLD` (default 5) | NAG | The horizontal auditor (duplicate/seam/contract/convention drift) is falling behind the vertical build cadence — nothing else notices this gap |

## Running it

Automatic on cold start (see step 3 in `CLAUDE.framework.md`). On demand:

```bash
bash .claude/framework/doctor/doctor.sh
```

Silent = clean. If anything's wrong, you'll see a summary line and the
details will be in `.claude/.framework-doctor-findings.md` at the project root.

## What the findings file contains

Findings sorted by severity (CRITICAL → WARNING → INFO → NAG), each with:

- Which check detected it (`[hooks]`, `[cross-refs]`, etc.)
- Specific path/ID that's broken
- Why it matters
- Explicit suggested fix

Claude reads the file during cold start and surfaces findings via
AskUserQuestion. Dismiss a session's findings with:

```bash
rm .framework-doctor-findings.md
```

Doctor re-scans on every cold start — state issues don't get less
broken over time, so there's no throttle.

## Extending

Add new checks as functions in `doctor.sh`. Each check:

1. Accepts no args; reads whatever it needs from disk.
2. Calls `add_finding SEVERITY CHECK_NAME "message with \`backticks\` for paths"`.
3. Registers itself in the "Run all checks" section.

Keep checks fast (no network, no heavy grep over `01_Project/`). Doctor
runs on every cold start — latency here is cold-start latency.

## Non-goals

- **Auto-fix.** Doctor reports; humans and Claude decide how to fix.
  Textual fixes (deleting entries, rewriting links) are too context-
  dependent to automate safely.
- **Contract referential integrity** (e.g., "task references
  `contract:foo` that doesn't exist in ECOSYSTEM.md"). Noisier, more
  false positives, diminishing returns. Can add later if needed.
- **Agent tool-list validation.** The set of Claude Code tools is the
  harness's domain, not ours to enumerate.

## Dependencies

`jq`, `grep`, `awk`, `find`. Same toolchain as the rest of the framework.
