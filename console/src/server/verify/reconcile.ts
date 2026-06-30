/**
 * reconcile.ts — Reconcile-by-ID logic for verify pass-files.
 *
 * Contract (ECOSYSTEM.md §console-verify-file):
 *   - Human `verdict` + `notes` carry forward when id matches and subject/expected
 *     are unchanged.
 *   - An item whose `subject` OR `expected` changed resets verdict to `pending`
 *     with `changed: true`; prior note is preserved.
 *   - Dropped items (present in old, absent in new) are retired: appended to
 *     the end of the output with `changed: true` and their prior verdict/notes.
 *   - The rollup (counts by verdict) is ALWAYS derived — recomputed from items,
 *     never stored.
 *
 * Pure module: no I/O, no side effects.
 */

import type { VerifyFile, VerifyItem, Verdict } from "./schema.js";
import { normalizeItem } from "./schema.js";

// ── Rollup (derived) ──────────────────────────────────────────────────────────

/**
 * Compute verdict counts from an item list. The rollup is derived and must
 * never be treated as a source of truth (recomputed on every read/write).
 */
export function computeRollup(items: VerifyItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.verdict] = (counts[item.verdict] ?? 0) + 1;
  }
  return counts;
}

// ── Reconcile ─────────────────────────────────────────────────────────────────

/**
 * ReconcileInput — the two states to merge.
 *   `oldFile`: the existing pass-file on disk (contains human verdicts/notes).
 *   `newItems`: the regenerated item list from the framework Tester (fresh claims).
 */
export interface ReconcileInput {
  oldFile: VerifyFile;
  newItems: VerifyItem[];
}

/**
 * Reconcile a regenerated item list against an existing pass-file.
 *
 * Returns a new VerifyFile with:
 *   - Items whose id matches and subject/expected are unchanged: verdict + notes
 *     carried forward from oldFile.
 *   - Items whose id matches but subject OR expected changed: verdict reset to
 *     `pending`, `changed: true`, prior notes preserved.
 *   - New items (id not in oldFile): kept as-is from newItems.
 *   - Retired items (id in oldFile but not in newItems): appended at the end
 *     with `changed: true` and their human verdict/notes intact.
 *
 * The returned file is a new object (pure — oldFile is not mutated).
 */
export function reconcile(input: ReconcileInput): VerifyFile {
  const { oldFile, newItems } = input;

  // Build lookup of old items by id for O(1) access.
  const oldById = new Map<string, VerifyItem>();
  for (const item of oldFile.items) {
    oldById.set(item.id, item);
  }

  // Build the reconciled new list.
  const reconciledItems: VerifyItem[] = [];
  const seenNewIds = new Set<string>();

  for (const newItem of newItems) {
    seenNewIds.add(newItem.id);
    const old = oldById.get(newItem.id);

    if (old === undefined) {
      // Brand new item — keep as-is (no prior human input).
      reconciledItems.push({ ...newItem });
    } else {
      // Existing id — check whether subject/expected changed.
      const subjectChanged = (old.subject ?? "") !== (newItem.subject ?? "");
      const expectedChanged = (old.expected ?? "") !== (newItem.expected ?? "");

      if (subjectChanged || expectedChanged) {
        // Content changed — reset verdict, flag it, preserve notes.
        reconciledItems.push({
          ...newItem,
          verdict: "pending" as Verdict,
          severity: null,
          notes: old.notes,
          changed: true,
        });
      } else {
        // Unchanged content — carry forward human input.
        reconciledItems.push({
          ...newItem,
          verdict: old.verdict,
          severity: old.severity ?? null,
          notes: old.notes,
          changed: false,
        });
      }
    }
  }

  // Retire items present in oldFile but absent from newItems.
  for (const old of oldFile.items) {
    if (!seenNewIds.has(old.id)) {
      reconciledItems.push({
        ...old,
        changed: true,
        // verdict and notes preserved as-is from the old human input
      });
    }
  }

  return {
    schemaVersion: 1,
    task: oldFile.task,
    branch: oldFile.branch,
    build: oldFile.build,
    status: oldFile.status,
    items: reconciledItems,
  };
}

// ── Bug-fixed reset (the retest loop) ──────────────────────────────────────────

/**
 * The retest loop: a use case the author flagged as a bug carries that bug's id
 * (`bugId`) while it sits as `fail`/`blocked`. When that BUG-XXX reaches Done in
 * TASKS.md (the agent fixed it), the use case must come BACK to the author for a
 * retest — flipped to `pending`, with a NEW notes round opened (prior rounds'
 * notes preserved) and the `round` count bumped.
 *
 * `doneBugIds` is the set of bug ids that are currently in the bug-lane Done
 * column. Pure: returns a new file + whether anything changed (so the caller can
 * decide to persist).
 */
export function applyBugFixes(
  file: VerifyFile,
  doneBugIds: Set<string>
): { file: VerifyFile; changed: boolean } {
  let changed = false;
  const items = file.items.map((raw): VerifyItem => {
    const item = normalizeItem(raw);
    const stillFailing = item.verdict === "fail" || item.verdict === "blocked";
    if (item.bugId && stillFailing && doneBugIds.has(item.bugId)) {
      changed = true;
      const round = (item.round ?? 1) + 1;
      const noteRounds = [...(item.noteRounds ?? []), { round, note: "" }];
      return {
        ...item,
        verdict: "pending" as Verdict,
        severity: null,
        bugId: null,
        round,
        noteRounds,
        notes: "",
        changed: true,
      };
    }
    return item;
  });
  return { file: { ...file, items }, changed };
}
