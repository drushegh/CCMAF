# Decision Log

<!-- Newest decisions at the top. During Cold Start, agents read only the last 10 entries. -->
<!-- When this file exceeds ~50 entries, move older decisions to .claude/framework/docs/archives/decisions-archive.md -->

## DEC-029 — Hybrid lane lifecycle (Kanban/Verify integration)

**Date:** 2026-07-04
**Status:** Adopted

**Decision:** This project uses the framework's Console "hybrid collapse" lane
lifecycle (claude-code-dev-framework.md:117's Solo collapse), NOT the full
`Ready for Review → In Review → Ready for Test → Testing` sequence:

- **Feature lane:** `Todo → In Progress → Ready for Review → Ready for Test →
  Verify → Done`, with `Blocked` available at any stage.
- **Bug-Fix lane:** `Reported → Fixing → Verify → Done`, with `Blocked`
  available at any stage.

`Verify` is the single human-acceptance gate for both lanes — the Console's
Verify tab is where the author records a per-use-case verdict
(`pass` / `fail` / `cr` / `blocked`); reaching `Done` requires either every
use case being `pass`/`cr` (auto-moved by the server on save) or an explicit
manual override (Accept & Done, or the Kanban card's status dropdown with its
confirm guard).

**Rationale:** Keeps the ceremony that earns its keep (Ready for Review as a
pre-test gate, Ready for Test as the tester hand-off point) while collapsing
the separate `In Review` and `Testing` micro-stages the full framework
lifecycle defines — this is a small, mostly-solo project where those extra
stages added state-file bookkeeping without a second reviewer to act on them.
Bugs skip the review/test split entirely (`Reported → Fixing → Verify →
Done`) since a bug fix is verified by reproducing the original symptom, not
by a separate design review.

**Rejected alternative:** The framework's full feature-lane sequence (`Todo →
In Progress → Ready for Review → In Review → Ready for Test → Testing →
Done`) — rejected as unnecessary ceremony for a project without a distinct
second-reviewer role occupying `In Review`/`Testing` as their own board slots.

**Consumers:** `.claude/TASKS.md` section headings are the source of truth
for the actual column names; `console/src/app/lib/taskFilter.ts`'s
`statusRank` mirrors this order for sort/filter purposes in the Console UI.
