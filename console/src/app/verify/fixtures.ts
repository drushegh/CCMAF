import type { VerifyFile } from "../api/verify";

/**
 * A representative pass-file used to render the populated viewer for the
 * ui-verification screenshot and as shared test data. Mirrors the kind of file
 * the framework Tester writes (contract:console-verify-file). Not shipped to
 * users — it is a dev/test fixture only.
 */
export const MOCK_VERIFY_FILE: VerifyFile = {
  schemaVersion: 1,
  task: "TASK-005",
  branch: "worktree-agent-verify-viewer",
  build: "2026-06-24",
  status: "in-review",
  items: [
    {
      id: "TP-01",
      kind: "test-plan-item",
      group: "Verdict controls",
      title: "Segmented verdict control sets the item verdict",
      subject:
        "Clicking a segment (pending/pass/fail/cr/blocked) updates the item and re-colours the row.",
      expected:
        "Selected segment is visually distinct and announced as the checked radio.",
      verdict: "pass",
      severity: null,
      notes: "",
    },
    {
      id: "TP-02",
      kind: "test-plan-item",
      group: "Verdict controls",
      title: "Severity is enabled only for fail / cr",
      subject:
        "The severity selector is disabled for pending/pass/blocked and enabled for fail and cr.",
      expected: "Disabled control cannot be changed and is visually dimmed.",
      verdict: "fail",
      severity: "P1",
      notes: "Caught a case where switching pass→fail left severity unset.",
    },
    {
      id: "TP-03",
      kind: "test-plan-item",
      group: "Rollup",
      title: "Progress rollup recomputes on every edit",
      subject: "Counts by verdict and the proportional bar track draft edits live.",
      expected: "reviewed/total updates immediately when a verdict changes.",
      verdict: "cr",
      severity: "P3",
      notes: "Bar segment widths look right; legend totals match.",
    },
    {
      id: "TP-04",
      kind: "test-plan-item",
      group: "Rollup",
      title: "Changed items reset to pending and surface a chip",
      subject:
        "When the Tester regenerates an item whose subject/expected changed, it resets to pending with changed:true.",
      expected: "A 'Changed' chip is shown and the prior note is preserved.",
      verdict: "pending",
      severity: null,
      notes: "Prior note carried forward by id.",
      changed: true,
    },
    {
      id: "TP-05",
      kind: "test-plan-item",
      group: "Save",
      title: "Save sends VerdictPatch[] with the token header",
      subject:
        "PUT /api/verify/:task carries X-Console-Token and the patch array; the reconciled file is returned.",
      expected: "Server is the sole writer; the viewer re-syncs to the response.",
      verdict: "blocked",
      severity: null,
      notes: "Blocked on the live endpoint — verified against the stub for now.",
    },
    {
      id: "TP-06",
      kind: "test-plan-item",
      group: "Save",
      title: "Empty / loading / error states are deliberate (DEC-010)",
      subject: "Queue empty-state, file loading skeleton, and a fetch-error panel.",
      expected: "No raw stack traces; clear, on-brand messaging.",
      verdict: "pending",
      severity: null,
      notes: "",
    },
  ],
};
