/**
 * taskFilter.ts — shared filter + sort model for task lists (Kanban + Verify).
 *
 * Pure functions only (no React) so they're trivially testable. The Kanban board
 * and the Verify queue both feed their items through `filterAndSortTasks`.
 *
 * `archived` is hidden by default (DEC-016 follow-on / TASK-023); the
 * "Show archived" toggle in TaskFilterBar flips `showArchived`.
 */

export type SortKey = "id" | "status" | "title";
export type SortDir = "asc" | "desc";

export interface FilterState {
  /** Free-text match against id + title (case-insensitive substring). */
  search: string;
  /** When false (default), items with archived === true are filtered out. */
  showArchived: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
}

export const DEFAULT_FILTER: FilterState = {
  search: "",
  showArchived: false,
  sortKey: "id",
  sortDir: "asc",
};

/** Anything with the fields the filter/sort cares about. */
export interface FilterableTask {
  id: string;
  title: string;
  status?: string;
  archived?: boolean;
}

/**
 * Canonical lifecycle rank — the order work actually flows (backlog → done),
 * with the human verify step near the end. Blocked sits right after In Progress
 * (work stalls mid-development). Shared with the Kanban column order so "sort by
 * status" reads the same way the board lays out. Order:
 *   Todo/Reported → In Progress/Fixing → Blocked → Ready for Review/In Review →
 *   Ready for Test/Testing → Verify → Done
 * Test and Verify are DISTINCT slots (Test = automated/tester gate; Verify = the
 * author's human sign-off, which lands later). BOTH lanes carry a Verify slot —
 * the Feature lane's hybrid lifecycle (DEC-029) is Todo → In Progress → Ready
 * for Review → Ready for Test → Verify → Done; the Bug-Fix lane is Reported →
 * Fixing → Verify → Done. TASKS.md's actual section headings are the source of
 * truth for which slots a given board uses — this rank just orders whatever's
 * present.
 */
export function statusRank(status: string): number {
  const s = status.toLowerCase();
  if (s.includes("todo") || s.includes("backlog") || s.includes("reported")) return 0;
  if (s.includes("in progress") || s.includes("fixing")) return 1;
  if (s.includes("blocked")) return 2;
  if (s.includes("ready for review") || s.includes("in review")) return 3;
  if (s.includes("ready for test") || s.includes("testing")) return 4;
  if (s.includes("verify")) return 5;
  if (s.includes("done") || s.includes("complete")) return 6;
  return 2.5; // unknown statuses sit mid-pipeline, order otherwise stable
}

/** Numeric part of a task id so TASK-9 sorts before TASK-10 (natural order). */
function idOrder(id: string): number {
  const m = /-(\d+)\s*$/.exec(id);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/** True if the task passes the current filter (archived gate + search). */
export function taskMatchesFilter(t: FilterableTask, f: FilterState): boolean {
  if (!f.showArchived && t.archived) return false;
  const q = f.search.trim().toLowerCase();
  if (q.length > 0) {
    const hay = `${t.id} ${t.title}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** Comparator honouring sortKey + sortDir; ties break by id for stability. */
export function compareTasks(
  a: FilterableTask,
  b: FilterableTask,
  f: FilterState,
): number {
  let cmp = 0;
  if (f.sortKey === "id") {
    cmp = idOrder(a.id) - idOrder(b.id) || a.id.localeCompare(b.id);
  } else if (f.sortKey === "title") {
    cmp = a.title.localeCompare(b.title) || idOrder(a.id) - idOrder(b.id);
  } else {
    // status
    cmp =
      statusRank(a.status ?? "") - statusRank(b.status ?? "") ||
      idOrder(a.id) - idOrder(b.id);
  }
  return f.sortDir === "asc" ? cmp : -cmp;
}

/** Filter then sort a list of tasks (non-mutating). */
export function filterAndSortTasks<T extends FilterableTask>(
  items: T[],
  f: FilterState,
): T[] {
  return items
    .filter((t) => taskMatchesFilter(t, f))
    .sort((a, b) => compareTasks(a, b, f));
}
