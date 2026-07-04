import { describe, it, expect } from "vitest";

import {
  normalizeItem,
  type VerifyFile,
  type VerifyItem,
} from "../src/server/verify/schema";
import { applyBugFixes } from "../src/server/verify/reconcile";
import { createBug, nextBugId, createTask, nextTaskId } from "../src/server/tasks/writeback";
import { applyPatches } from "../src/server/verify/io";

function item(partial: Partial<VerifyItem>): VerifyItem {
  return {
    id: "uc-1",
    kind: "usecase",
    title: "A use case",
    verdict: "pending",
    ...partial,
  };
}
function file(items: VerifyItem[]): VerifyFile {
  return { schemaVersion: 1, task: "TASK-040", status: "in-review", items };
}

describe("normalizeItem (retest-loop migration)", () => {
  it("seeds round/noteRounds/bugId/crTaskId for a legacy item", () => {
    const n = normalizeItem(item({ notes: "old note" }));
    expect(n.round).toBe(1);
    expect(n.bugId).toBeNull();
    expect(n.crTaskId).toBeNull();
    expect(n.noteRounds).toEqual([{ round: 1, note: "old note" }]);
    expect(n.notes).toBe("old note");
  });
  it("opens a box for the current round when missing", () => {
    const n = normalizeItem(item({ round: 2, noteRounds: [{ round: 1, note: "r1" }] }));
    expect(n.noteRounds).toEqual([
      { round: 1, note: "r1" },
      { round: 2, note: "" },
    ]);
  });
});

describe("applyBugFixes (bug fixed → use case back to pending)", () => {
  it("flips a fail+linked-bug use case to pending with a new round when the bug is Done", () => {
    const f = file([
      item({
        verdict: "fail",
        severity: "P1",
        bugId: "BUG-012",
        round: 1,
        noteRounds: [{ round: 1, note: "broken" }],
      }),
    ]);
    const { file: out, changed } = applyBugFixes(f, new Set(["BUG-012"]));
    expect(changed).toBe(true);
    const it0 = out.items[0];
    expect(it0.verdict).toBe("pending");
    expect(it0.severity).toBeNull();
    expect(it0.bugId).toBeNull();
    expect(it0.round).toBe(2);
    expect(it0.noteRounds).toEqual([
      { round: 1, note: "broken" },
      { round: 2, note: "" },
    ]);
  });
  it("leaves a use case untouched when its bug is not yet Done", () => {
    const f = file([item({ verdict: "fail", bugId: "BUG-012", round: 1 })]);
    const { changed } = applyBugFixes(f, new Set(["BUG-099"]));
    expect(changed).toBe(false);
  });
  it("does not reset a passed item even if it carries a stale bugId", () => {
    const f = file([item({ verdict: "pass", bugId: "BUG-012" })]);
    const { changed } = applyBugFixes(f, new Set(["BUG-012"]));
    expect(changed).toBe(false);
  });
});

const TASKS = `# Task Board

## Feature Lane

### Done

#### [TASK-001] A feature — Done

## Bug-Fix Lane

### Reported

_(none)_

### Fixing

### Done

#### [BUG-003] An old bug — FIXED
`;

describe("createBug / nextBugId", () => {
  it("assigns the next BUG id (max + 1, zero-padded)", () => {
    expect(nextBugId(TASKS)).toBe("BUG-004");
  });
  it("inserts a bug into Reported, replacing the placeholder, preserving everything else", () => {
    const r = createBug(TASKS, {
      title: "Login breaks",
      severity: "P1",
      sourceTask: "TASK-040",
      sourceItem: "uc-2",
      round: 1,
      note: "500 on submit",
      date: "2026-06-26",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bugId).toBe("BUG-004");
    expect(r.content).toContain("#### [BUG-004] Login breaks — Reported 2026-06-26");
    expect(r.content).toContain("**Source:** TASK-040 verification · use-case `uc-2` (round 1)");
    expect(r.content).not.toContain("_(none)_");
    expect(r.content).toContain("#### [BUG-003] An old bug");
    expect(r.content).toContain("#### [TASK-001] A feature");
  });
});

const TASKS_WITH_TODO = `# Task Board

## Feature Lane

### Todo (Priority Order)

_(none)_

### Verify

#### [TASK-050] Under review

## Bug-Fix Lane

### Reported

_(none)_
`;

describe("createTask / nextTaskId (CR follow-up spawn, change 3)", () => {
  it("assigns the next TASK id (max + 1, zero-padded)", () => {
    expect(nextTaskId(TASKS_WITH_TODO)).toBe("TASK-051");
  });

  it("inserts a follow-up into Todo, replacing the placeholder, preserving everything else", () => {
    const r = createTask(TASKS_WITH_TODO, {
      title: "CR: Rename the export button",
      sourceTask: "TASK-050",
      sourceItem: "uc-1",
      note: "call it Export, not Download",
      date: "2026-06-26",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.taskId).toBe("TASK-051");
    expect(r.content).toContain("#### [TASK-051] CR: Rename the export button");
    expect(r.content).toContain("**Source:** TASK-050 verification · use-case `uc-1`");
    expect(r.content).toContain("**Note:** call it Export, not Download");
    // The Todo section's placeholder is gone (replaced) — but the UNRELATED
    // Reported-section placeholder elsewhere in the fixture is untouched.
    expect(r.content).not.toContain("### Todo (Priority Order)\n\n_(none)_");
    expect(r.content).toContain("_(none)_"); // still present — the Reported section's own placeholder
    expect(r.content).toContain("#### [TASK-050] Under review");
  });

  it("appends after existing Todo entries (no placeholder) rather than replacing them", () => {
    const withExisting = TASKS_WITH_TODO.replace(
      "### Todo (Priority Order)\n\n_(none)_",
      "### Todo (Priority Order)\n\n#### [TASK-049] Existing todo item"
    );
    const r = createTask(withExisting, {
      title: "CR: Something else",
      date: "2026-06-27",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toContain("#### [TASK-049] Existing todo item");
    expect(r.content).toContain("#### [TASK-051] CR: Something else");
    // The existing entry is still present and not clobbered.
    expect(r.content.indexOf("TASK-049")).toBeLessThan(r.content.indexOf("TASK-051"));
  });

  it("returns no_todo_section when the Feature Lane has no Todo section", () => {
    const noTodo = "# Task Board\n\n## Feature Lane\n\n### Verify\n\n#### [TASK-050] Under review\n";
    const r = createTask(noTodo, { title: "CR: x", date: "2026-06-26" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("no_todo_section");
  });
});

describe("applyPatches (bugId + per-round notes)", () => {
  it("links a bug + writes the current round's note on flag", () => {
    const f = file([item({ id: "uc-1", round: 1, noteRounds: [{ round: 1, note: "" }] })]);
    const out = applyPatches(f, [
      { id: "uc-1", verdict: "fail", severity: "P1", notes: "broken on submit", bugId: "BUG-004" },
    ]);
    const it0 = out.items[0];
    expect(it0.verdict).toBe("fail");
    expect(it0.bugId).toBe("BUG-004");
    expect(it0.noteRounds?.[0]).toEqual({ round: 1, note: "broken on submit" });
  });
  it("clears the bug link on a pass and writes the current round's note", () => {
    const f = file([
      item({
        id: "uc-1",
        verdict: "fail",
        bugId: "BUG-004",
        round: 2,
        noteRounds: [
          { round: 1, note: "x" },
          { round: 2, note: "" },
        ],
      }),
    ]);
    const out = applyPatches(f, [{ id: "uc-1", verdict: "pass", notes: "fixed, verified" }]);
    const it0 = out.items[0];
    expect(it0.verdict).toBe("pass");
    expect(it0.bugId).toBeNull();
    expect(it0.noteRounds?.[1]).toEqual({ round: 2, note: "fixed, verified" });
  });
});
