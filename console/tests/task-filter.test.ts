/**
 * task-filter.test.ts — the shared filter/sort model (TASK-023).
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_FILTER,
  taskMatchesFilter,
  compareTasks,
  filterAndSortTasks,
  statusRank,
  type FilterState,
  type FilterableTask,
} from "../src/app/lib/taskFilter";

const items: FilterableTask[] = [
  { id: "TASK-2", title: "Build server", status: "In Progress", archived: false },
  { id: "TASK-10", title: "Ship it", status: "Done", archived: false },
  { id: "TASK-1", title: "Scaffold app", status: "Todo", archived: false },
  { id: "TASK-9", title: "Archive me", status: "Done", archived: true },
];

function f(overrides: Partial<FilterState> = {}): FilterState {
  return { ...DEFAULT_FILTER, ...overrides };
}

describe("taskMatchesFilter — archived gate", () => {
  it("hides archived by default", () => {
    expect(taskMatchesFilter({ id: "X", title: "x", archived: true }, f())).toBe(false);
  });
  it("shows archived when the toggle is on", () => {
    expect(
      taskMatchesFilter({ id: "X", title: "x", archived: true }, f({ showArchived: true })),
    ).toBe(true);
  });
  it("always shows non-archived", () => {
    expect(taskMatchesFilter({ id: "X", title: "x", archived: false }, f())).toBe(true);
  });
});

describe("taskMatchesFilter — search", () => {
  it("matches id or title, case-insensitively", () => {
    const t = { id: "TASK-42", title: "Wire the Kanban", archived: false };
    expect(taskMatchesFilter(t, f({ search: "kanban" }))).toBe(true);
    expect(taskMatchesFilter(t, f({ search: "task-42" }))).toBe(true);
    expect(taskMatchesFilter(t, f({ search: "nope" }))).toBe(false);
  });
});

describe("compareTasks / filterAndSortTasks", () => {
  it("sorts by id numerically (TASK-2 before TASK-10)", () => {
    const out = filterAndSortTasks(items, f({ sortKey: "id", sortDir: "asc" }));
    expect(out.map((t) => t.id)).toEqual(["TASK-1", "TASK-2", "TASK-10"]);
  });

  it("respects descending direction", () => {
    const out = filterAndSortTasks(items, f({ sortKey: "id", sortDir: "desc" }));
    expect(out.map((t) => t.id)).toEqual(["TASK-10", "TASK-2", "TASK-1"]);
  });

  it("sorts by title alphabetically", () => {
    const out = filterAndSortTasks(items, f({ sortKey: "title", sortDir: "asc" }));
    expect(out.map((t) => t.title)).toEqual(["Build server", "Scaffold app", "Ship it"]);
  });

  it("sorts by status using the lifecycle rank (Todo < In Progress < Done)", () => {
    const out = filterAndSortTasks(items, f({ sortKey: "status", sortDir: "asc" }));
    expect(out.map((t) => t.status)).toEqual(["Todo", "In Progress", "Done"]);
  });

  it("excludes archived items from the result by default", () => {
    const out = filterAndSortTasks(items, f());
    expect(out.some((t) => t.id === "TASK-9")).toBe(false);
    expect(out).toHaveLength(3);
  });

  it("includes archived when showArchived is on", () => {
    const out = filterAndSortTasks(items, f({ showArchived: true }));
    expect(out).toHaveLength(4);
  });

  it("combines search + archived gate", () => {
    const out = filterAndSortTasks(items, f({ search: "archive", showArchived: true }));
    expect(out.map((t) => t.id)).toEqual(["TASK-9"]);
  });

  it("does not mutate the input array", () => {
    const before = items.map((t) => t.id);
    filterAndSortTasks(items, f({ sortKey: "id", sortDir: "desc" }));
    expect(items.map((t) => t.id)).toEqual(before);
  });
});

describe("statusRank", () => {
  it("ranks the lifecycle backlog→done with Test before Verify, Done last", () => {
    // Full pipeline order the board lays out left→right.
    const order = [
      "Todo",
      "In Progress",
      "Blocked",
      "Ready for Review",
      "Ready for Test",
      "Verify",
      "Done",
    ];
    for (let i = 1; i < order.length; i++) {
      expect(statusRank(order[i - 1])).toBeLessThan(statusRank(order[i]));
    }
    // Bug-lane statuses map onto the shared backlog/in-progress slots.
    expect(statusRank("Reported")).toBe(statusRank("Todo"));
    expect(statusRank("Fixing")).toBe(statusRank("In Progress"));
    // Test and Verify are now DISTINCT slots — Verify lands after Test.
    expect(statusRank("Verify")).toBeGreaterThan(statusRank("Ready for Test"));
    expect(statusRank("Testing")).toBe(statusRank("Ready for Test"));
  });
});
