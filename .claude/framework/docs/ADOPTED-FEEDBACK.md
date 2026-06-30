# Adopted Feedback Registry

Framework-owned (manifest-shipped; overwritten on update). Newest first.

When the upstream framework adopts a fix or feature that originated in a
consumer project's `.claude/GOTCHAS.md` or `.claude/FRAMEWORK-SUGGESTIONS.md`,
the adoption is recorded here. The flow this closes: upstream sweeps
consumer feedback files (e.g. via /fleet), builds the fix, ships it in an
update — but the consumer's local entry that prompted it stays behind,
stale, describing a problem the update already solved.

**How consumers use this file:** `/housekeeping` reads it (see the
"Adopted-feedback reconciliation" step). For each entry below, if your
project's GOTCHAS.md or FRAMEWORK-SUGGESTIONS.md still carries the
matching item AND you have pulled a framework version at or past the
listed commit, remove the local entry (or annotate it
`✅ adopted upstream <TASK>`). Match on the topic, not exact wording —
your local entry is in your own words.

**How upstream maintains it:** when a consumer-reported item lands, add a
row in the same commit (or the close-out commit). Origin names the
project when known, else "fleet sweep".

---

| Adopted | Upstream task / commit | What was adopted | Origin | Consumer entry now stale |
| ------- | ---------------------- | ---------------- | ------ | ------------------------ |
| 2026-06-28 | TASK-059 / 72d3767 | Portable cross-platform Console launcher (`tools/console.mjs`): SSH-alias-first → HTTPS-fallback clone (avoids the multi-account credential prompt that breaks unattended runs), project-local gitignored cache, no machine-path default; opt-in cold-start auto-run (step 10.5 via `.claude/.console-enabled`) | babynamey overnight build (FS-001) | any suggestion that the Console isn't auto-run / the launcher points at a local sibling / the SSH alias only resolves on the author's machine |
| 2026-06-12 | TASK-043 / 60eca69 | skills-check.sh — cold-start notice when synced skills lag the catalogue | upstream roadmap (listed for completeness) | any suggestion asking "how do we know skills are behind?" |
| 2026-06-12 | TASK-042 / e99097f | /fleet — read-only consumer status sweep | upstream roadmap (listed for completeness) | any suggestion asking for a cross-project status view |
| 2026-06-12 | TASK-041 / e9db2d7 | Council self-preference fix — advisors exclude own response from "Strongest"; chairman re-weights | fleet sweep 2026-06-12 | suggestions about /council advisors favouring their own answers |
| 2026-06-12 | TASK-040 / 2be7ede | Computed push-state in /wrapup (insights/push-state.sh) — no hand-written push prose | fleet sweep 2026-06-12 | gotchas/suggestions about STATUS.md push-state lines going stale or being wrong |
| 2026-06-12 | TASK-039 / 9557d81 | apply-update warns loudly before overwriting a CUSTOMISED command file | fleet sweep 2026-06-12 (reqtool's local /healthcheck collision was the known case) | gotchas warning "apply-update will silently overwrite my customised command" |
| 2026-06-12 | TASK-038 / 07660ae | Subagent RED-LINES — no commit/push/lifecycle transitions without an explicit by-name grant | fleet sweep 2026-06-12 (harvey's coordinator pattern was prior art) | gotchas about delegated subagents committing or moving board items on their own |
| 2026-06-12 | TASK-037 / 296809b | Reviewer/tester findings persistence — tester writes test-findings.md; /review step 5 makes orchestrator persistence mandatory | fleet sweep 2026-06-12 | suggestions that reviewer/tester output vanishes at session end |
| 2026-06-12 | TASK-033 / 01a3140 | instinct-miner mines only genuine human turns (was also mining the skill-prompt text echoed into the transcript) — 34→0 noise | harvey, 2026-06-06 | suggestions that /wrapup's instinct-miner surfaces noise from echoed skill-prompt / command text |
| 2026-06-11 | TASK-029..031 / a2ad224, 28c184a | Deep-analysis HIGH+MEDIUM sweep incl. Windows path normalization in hooks (DA-H1), git add -A removal (DA-H5), enforce-state anchored matching (DA-H7) | upstream deep analysis (consumer-visible fixes) | gotchas about hooks being silent no-ops on Windows paths, or migrate/wrapup sweeping unrelated files |

<!-- Template for new rows:
| YYYY-MM-DD | TASK-XXX / <short-sha> | <what shipped> | <project or "fleet sweep YYYY-MM-DD"> | <what local entry this makes stale> |
-->
