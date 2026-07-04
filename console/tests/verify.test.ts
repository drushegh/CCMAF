// @vitest-environment node
/**
 * verify.test.ts — Unit tests for TASK-004.
 *
 * Coverage:
 *   A. Schema validation (validateVerifyFile)
 *      - valid minimal file
 *      - valid file with all optional fields
 *      - bad schemaVersion
 *      - bad verdict enum
 *      - severity on pass/pending/blocked (must be null/absent)
 *      - severity on fail/cr (allowed)
 *      - missing required fields
 *
 *   B. VerdictPatch validation (validateVerdictPatch)
 *      - valid patch
 *      - non-null severity on pass → reject
 *
 *   C. Reconcile-by-ID (reconcile)
 *      - carry-forward: human verdict + notes preserved when unchanged
 *      - changed-reset: verdict → pending + changed:true when subject/expected changes
 *      - retire: dropped items appended with changed:true
 *      - new items kept as-is
 *      - rollup derived (computeRollup)
 *
 *   D. Read / write round-trip (via temp dir, using a mock project root)
 *      - write then read returns the same file
 *      - list returns the written file as a VerifyRef
 *      - write invalid file throws
 *      - applyPatches: updates verdict, clears severity on pass change, preserves notes
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, unlinkSync, readFileSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Temp dir setup ─────────────────────────────────────────────────────────────

let tempRoot: string;
let tempVerifyDir: string;

beforeAll(() => {
  tempRoot = join(tmpdir(), `ccmaf-verify-test-${Date.now()}`);
  tempVerifyDir = join(tempRoot, ".claude", "console", "verify");
  mkdirSync(tempVerifyDir, { recursive: true });
  // Also create a .claude marker so project-root walk-up resolves correctly.
  mkdirSync(join(tempRoot, ".claude"), { recursive: true });
});

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

// ── Mock project-root to point at our temp dir ────────────────────────────────
// Must be registered BEFORE any module import that depends on project-root.

vi.mock("../src/server/project-root.js", () => {
  return {
    findProjectRoot: (_: string) => tempRoot,
    getProjectRoot: () => tempRoot,
    dotClaudePath: (...segments: string[]) =>
      [tempRoot, ".claude", ...segments].join("/"),
  };
});

// Now import the modules under test (after vi.mock is set up).
const { validateVerifyFile, validateVerdictPatch, assertVerifyFile, normalizeLegacyVerdicts } = await import(
  "../src/server/verify/schema.js"
);
const { reconcile, computeRollup } = await import(
  "../src/server/verify/reconcile.js"
);
const { readVerifyFile, readVerifyFileWithMeta, writeVerifyFile, listVerifyRefs, applyPatches } = await import(
  "../src/server/verify/io.js"
);

import type { VerifyFile, VerifyItem } from "../src/server/verify/schema.js";
import { normalizeVerifyFile } from "../src/server/verify/schema.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMinimalFile(overrides: Partial<VerifyFile> = {}): VerifyFile {
  return {
    schemaVersion: 1,
    task: "TASK-001",
    status: "in-review",
    items: [],
    ...overrides,
  };
}

function makeItem(overrides: Partial<VerifyItem> = {}): VerifyItem {
  return {
    id: "item-1",
    kind: "test-plan-item",
    title: "Should render the dashboard",
    verdict: "pending",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// A. Schema validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("validateVerifyFile — schema validation", () => {
  it("accepts a minimal valid file", () => {
    const result = validateVerifyFile(makeMinimalFile());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts a fully-populated valid file", () => {
    const file: VerifyFile = {
      schemaVersion: 1,
      task: "TASK-042",
      branch: "feat/dashboard",
      build: "2026-06-24",
      status: "processing-fixes",
      items: [
        makeItem({
          id: "item-a",
          kind: "test-plan-item",
          group: "Dashboard",
          title: "Renders heading",
          subject: "Dashboard renders H1",
          expected: "H1 with text 'Console'",
          verdict: "pass",
          severity: null,
          notes: "Looks good",
          changed: false,
          provenance: { author: "tester" },
        }),
        makeItem({
          id: "item-b",
          verdict: "fail",
          severity: "P1",
          notes: "Button missing",
        }),
        makeItem({ id: "item-c", verdict: "cr", severity: "P3" }),
      ],
    };
    const result = validateVerifyFile(file);
    expect(result.valid).toBe(true);
  });

  it("rejects schemaVersion !== 1", () => {
    const bad = { ...makeMinimalFile(), schemaVersion: 2 };
    const result = validateVerifyFile(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("rejects missing schemaVersion", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bad = { ...makeMinimalFile() } as any;
    delete bad.schemaVersion;
    const result = validateVerifyFile(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("rejects invalid task pattern", () => {
    const result = validateVerifyFile({ ...makeMinimalFile(), task: "001" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("task"))).toBe(true);
  });

  it("accepts BUG- task ids", () => {
    const result = validateVerifyFile({ ...makeMinimalFile(), task: "BUG-007" });
    expect(result.valid).toBe(true);
  });

  it("rejects invalid status", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = validateVerifyFile({ ...makeMinimalFile(), status: "open" as any });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("status"))).toBe(true);
  });

  it("rejects bad verdict enum on an item", () => {
    const file = makeMinimalFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: [makeItem({ verdict: "approved" as any })],
    });
    const result = validateVerifyFile(file);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("verdict"))).toBe(true);
  });

  it("rejects non-null severity on verdict=pass", () => {
    const file = makeMinimalFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: [makeItem({ verdict: "pass", severity: "P1" as any })],
    });
    const result = validateVerifyFile(file);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("severity"))).toBe(true);
  });

  it("rejects non-null severity on verdict=pending", () => {
    const file = makeMinimalFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: [makeItem({ verdict: "pending", severity: "P0" as any })],
    });
    const result = validateVerifyFile(file);
    expect(result.valid).toBe(false);
  });

  it("rejects non-null severity on verdict=blocked", () => {
    const file = makeMinimalFile({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: [makeItem({ verdict: "blocked", severity: "P2" as any })],
    });
    const result = validateVerifyFile(file);
    expect(result.valid).toBe(false);
  });

  it("accepts null severity on verdict=fail (explicit null allowed)", () => {
    const file = makeMinimalFile({
      items: [makeItem({ verdict: "fail", severity: null })],
    });
    const result = validateVerifyFile(file);
    expect(result.valid).toBe(true);
  });

  it("accepts non-null severity on verdict=fail", () => {
    const file = makeMinimalFile({
      items: [makeItem({ verdict: "fail", severity: "P0" })],
    });
    const result = validateVerifyFile(file);
    expect(result.valid).toBe(true);
  });

  it("accepts non-null severity on verdict=cr", () => {
    const file = makeMinimalFile({
      items: [makeItem({ verdict: "cr", severity: "P3" })],
    });
    const result = validateVerifyFile(file);
    expect(result.valid).toBe(true);
  });

  it("rejects non-object root", () => {
    const result = validateVerifyFile("not an object");
    expect(result.valid).toBe(false);
  });

  it("assertVerifyFile throws on invalid input", () => {
    expect(() => assertVerifyFile({ schemaVersion: 99 })).toThrow(/Invalid verify file/);
  });
});

describe("normalizeLegacyVerdicts — legacy `warn` verdict aliases to `cr`", () => {
  it("aliases a legacy warn verdict to cr", () => {
    const file = makeMinimalFile({
      items: [makeItem({ verdict: "warn" as unknown as "cr", severity: "P2" })],
    });
    const out = normalizeLegacyVerdicts(file) as VerifyFile;
    expect(out.items[0].verdict).toBe("cr");
    // severity and every other field pass through untouched.
    expect(out.items[0].severity).toBe("P2");
  });

  it("leaves current verdicts (including cr) unchanged", () => {
    const file = makeMinimalFile({
      items: [
        makeItem({ id: "a", verdict: "pass" }),
        makeItem({ id: "b", verdict: "cr" }),
      ],
    });
    const out = normalizeLegacyVerdicts(file) as VerifyFile;
    expect(out.items.map((i) => i.verdict)).toEqual(["pass", "cr"]);
  });

  it("is defensive against malformed shapes (no items array, non-object) — returns input unchanged", () => {
    expect(normalizeLegacyVerdicts("not an object")).toBe("not an object");
    expect(normalizeLegacyVerdicts(null)).toBeNull();
    expect(normalizeLegacyVerdicts({ schemaVersion: 1 })).toEqual({ schemaVersion: 1 });
  });

  it("a file normalized this way then validates successfully (the read-path behaviour)", () => {
    const raw = { ...makeMinimalFile(), items: [{ id: "x", kind: "usecase", title: "t", verdict: "warn" }] };
    const normalized = normalizeLegacyVerdicts(raw);
    const result = validateVerifyFile(normalized);
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. VerdictPatch validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("validateVerdictPatch", () => {
  it("accepts a valid patch (pass, no severity)", () => {
    const err = validateVerdictPatch({ id: "item-1", verdict: "pass" }, 0);
    expect(err).toBeNull();
  });

  it("accepts a valid fail patch with severity", () => {
    const err = validateVerdictPatch({ id: "item-1", verdict: "fail", severity: "P1" }, 0);
    expect(err).toBeNull();
  });

  it("accepts explicit null severity on fail", () => {
    const err = validateVerdictPatch({ id: "item-1", verdict: "fail", severity: null }, 0);
    expect(err).toBeNull();
  });

  it("rejects non-null severity on pass", () => {
    const err = validateVerdictPatch({ id: "item-1", verdict: "pass", severity: "P1" }, 0);
    expect(err).not.toBeNull();
    expect(err).toMatch(/severity/);
  });

  it("rejects missing verdict", () => {
    const err = validateVerdictPatch({ id: "item-1" }, 0);
    expect(err).not.toBeNull();
    expect(err).toMatch(/verdict/);
  });

  it("rejects empty id", () => {
    const err = validateVerdictPatch({ id: "", verdict: "pass" }, 0);
    expect(err).not.toBeNull();
    expect(err).toMatch(/id/);
  });

  it("rejects non-object input", () => {
    const err = validateVerdictPatch("bad", 0);
    expect(err).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. Reconcile-by-ID
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeRollup", () => {
  it("returns empty counts for empty items", () => {
    expect(computeRollup([])).toEqual({});
  });

  it("counts verdicts correctly", () => {
    const items: VerifyItem[] = [
      makeItem({ id: "a", verdict: "pass" }),
      makeItem({ id: "b", verdict: "pass" }),
      makeItem({ id: "c", verdict: "fail" }),
      makeItem({ id: "d", verdict: "pending" }),
    ];
    const counts = computeRollup(items);
    expect(counts).toEqual({ pass: 2, fail: 1, pending: 1 });
  });
});

describe("reconcile — carry-forward", () => {
  it("preserves verdict + notes when subject/expected unchanged", () => {
    const oldFile: VerifyFile = makeMinimalFile({
      items: [
        makeItem({
          id: "item-1",
          subject: "renders heading",
          expected: "H1 present",
          verdict: "pass",
          notes: "Looks great",
        }),
      ],
    });

    const newItems: VerifyItem[] = [
      makeItem({
        id: "item-1",
        subject: "renders heading",
        expected: "H1 present",
        verdict: "pending", // regenerated as pending — but human said pass
      }),
    ];

    const result = reconcile({ oldFile, newItems });
    const item = result.items[0];
    expect(item.verdict).toBe("pass");      // carried forward
    expect(item.notes).toBe("Looks great"); // carried forward
    expect(item.changed).toBe(false);
  });

  it("resets verdict to pending and sets changed:true when subject changes", () => {
    const oldFile: VerifyFile = makeMinimalFile({
      items: [
        makeItem({
          id: "item-1",
          subject: "old subject",
          verdict: "pass",
          notes: "prior note",
        }),
      ],
    });

    const newItems: VerifyItem[] = [
      makeItem({
        id: "item-1",
        subject: "NEW subject", // changed
        verdict: "pending",
      }),
    ];

    const result = reconcile({ oldFile, newItems });
    const item = result.items[0];
    expect(item.verdict).toBe("pending");   // reset
    expect(item.changed).toBe(true);        // flagged
    expect(item.notes).toBe("prior note");  // preserved
  });

  it("resets verdict to pending and sets changed:true when expected changes", () => {
    const oldFile: VerifyFile = makeMinimalFile({
      items: [
        makeItem({
          id: "item-1",
          expected: "old expected",
          verdict: "pass",
          notes: "prior note",
        }),
      ],
    });

    const newItems: VerifyItem[] = [
      makeItem({
        id: "item-1",
        expected: "NEW expected",
        verdict: "pending",
      }),
    ];

    const result = reconcile({ oldFile, newItems });
    const item = result.items[0];
    expect(item.verdict).toBe("pending");
    expect(item.changed).toBe(true);
    expect(item.notes).toBe("prior note");
  });

  it("appends retired items (in old, absent in new) with changed:true", () => {
    const oldFile: VerifyFile = makeMinimalFile({
      items: [
        makeItem({ id: "item-1", verdict: "pass", notes: "done" }),
        makeItem({ id: "item-2", verdict: "fail", notes: "broken" }),
      ],
    });

    // item-2 dropped from new list
    const newItems: VerifyItem[] = [makeItem({ id: "item-1" })];

    const result = reconcile({ oldFile, newItems });
    expect(result.items).toHaveLength(2);

    const retired = result.items.find((i) => i.id === "item-2");
    expect(retired).toBeDefined();
    expect(retired!.changed).toBe(true);
    expect(retired!.verdict).toBe("fail");  // preserved
    expect(retired!.notes).toBe("broken");  // preserved
  });

  it("keeps new items as-is when not in old file", () => {
    const oldFile: VerifyFile = makeMinimalFile({ items: [] });

    const newItems: VerifyItem[] = [
      makeItem({ id: "brand-new", verdict: "pending", title: "New check" }),
    ];

    const result = reconcile({ oldFile, newItems });
    const item = result.items[0];
    expect(item.id).toBe("brand-new");
    expect(item.verdict).toBe("pending");
  });

  it("preserves top-level file metadata", () => {
    const oldFile: VerifyFile = {
      schemaVersion: 1,
      task: "TASK-099",
      branch: "feat/x",
      build: "2026-01-01",
      status: "in-review",
      items: [],
    };
    const result = reconcile({ oldFile, newItems: [] });
    expect(result.task).toBe("TASK-099");
    expect(result.branch).toBe("feat/x");
    expect(result.build).toBe("2026-01-01");
  });

  it("does not mutate the oldFile", () => {
    const item = makeItem({ id: "item-1", verdict: "pass" });
    const oldFile: VerifyFile = makeMinimalFile({ items: [item] });
    const newItems: VerifyItem[] = [makeItem({ id: "item-1", verdict: "pending" })];
    reconcile({ oldFile, newItems });
    // oldFile must not be mutated
    expect(oldFile.items[0].verdict).toBe("pass");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// D. Read / write round-trip (via temp dir)
// ═══════════════════════════════════════════════════════════════════════════════

describe("writeVerifyFile / readVerifyFile — round-trip", () => {
  it("write then read returns equal file", () => {
    const file: VerifyFile = {
      schemaVersion: 1,
      task: "TASK-001",
      status: "in-review",
      items: [
        makeItem({ id: "item-1", verdict: "pass", notes: "OK" }),
        makeItem({ id: "item-2", verdict: "fail", severity: "P2", notes: "Bad" }),
      ],
    };
    writeVerifyFile(file);
    const read = readVerifyFile("TASK-001");
    // readVerifyFile normalises to the retest-loop shape (round/noteRounds/bugId)
    // and reconciles against TASKS.md; with no flagged bugs it's just normalised.
    expect(read).toEqual(normalizeVerifyFile(file));
  });

  it("write invalid file throws before touching disk", () => {
    const bad = {
      schemaVersion: 1,
      task: "TASK-002",
      status: "in-review",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items: [makeItem({ verdict: "approved" as any })],
    };
    // Cast to VerifyFile to bypass TS; the runtime validator must reject it.
    expect(() => writeVerifyFile(bad as unknown as VerifyFile)).toThrow(
      /Refusing to write invalid/
    );
  });

  it("readVerifyFile throws ENOENT for missing task", () => {
    expect(() => readVerifyFile("TASK-999")).toThrow(/not found/i);
    // Also check the error has code ENOENT
    try {
      readVerifyFile("TASK-999");
    } catch (e) {
      expect((e as { code?: string }).code).toBe("ENOENT");
    }
  });
});

describe("listVerifyRefs — queue listing", () => {
  it("returns a VerifyRef for each valid written file", () => {
    // TASK-001 was written by the round-trip test above.
    const refs = listVerifyRefs();
    const ref = refs.find((r) => r.task === "TASK-001");
    expect(ref).toBeDefined();
    expect(ref!.title).toBe("TASK-001");
    expect(typeof ref!.counts).toBe("object");
    // Should have pass:1 and fail:1 from the round-trip write.
    expect(ref!.counts["pass"]).toBe(1);
    expect(ref!.counts["fail"]).toBe(1);
  });
});

describe("applyPatches", () => {
  it("updates verdict and notes for matched ids", () => {
    const file: VerifyFile = makeMinimalFile({
      items: [
        makeItem({ id: "item-1", verdict: "pending" }),
        makeItem({ id: "item-2", verdict: "pending" }),
      ],
    });
    const updated = applyPatches(file, [
      { id: "item-1", verdict: "pass", notes: "Checked" },
    ]);
    const item1 = updated.items.find((i) => i.id === "item-1")!;
    const item2 = updated.items.find((i) => i.id === "item-2")!;
    expect(item1.verdict).toBe("pass");
    expect(item1.notes).toBe("Checked");
    expect(item2.verdict).toBe("pending"); // unchanged
  });

  it("clears severity when verdict changes from fail to pass", () => {
    const file: VerifyFile = makeMinimalFile({
      items: [makeItem({ id: "item-1", verdict: "fail", severity: "P0" })],
    });
    const updated = applyPatches(file, [{ id: "item-1", verdict: "pass" }]);
    expect(updated.items[0].severity).toBeNull();
  });

  it("applies severity when patching to fail", () => {
    const file: VerifyFile = makeMinimalFile({
      items: [makeItem({ id: "item-1", verdict: "pending" })],
    });
    const updated = applyPatches(file, [
      { id: "item-1", verdict: "fail", severity: "P1", notes: "regression" },
    ]);
    expect(updated.items[0].severity).toBe("P1");
    expect(updated.items[0].notes).toBe("regression");
  });

  it("ignores unknown ids (no error)", () => {
    const file: VerifyFile = makeMinimalFile({
      items: [makeItem({ id: "item-1", verdict: "pending" })],
    });
    const updated = applyPatches(file, [{ id: "does-not-exist", verdict: "pass" }]);
    expect(updated.items[0].verdict).toBe("pending"); // unaffected
  });

  it("throws on invalid patch (non-null severity on pass)", () => {
    const file: VerifyFile = makeMinimalFile({
      items: [makeItem({ id: "item-1", verdict: "pending" })],
    });
    expect(() =>
      applyPatches(file, [{ id: "item-1", verdict: "pass", severity: "P0" }])
    ).toThrow(/severity/);
  });

  it("throws on invalid patch (bad verdict)", () => {
    const file: VerifyFile = makeMinimalFile({ items: [makeItem()] });
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      applyPatches(file, [{ id: "item-1", verdict: "approved" as any }])
    ).toThrow(/verdict/);
  });

  it("does not mutate the input file", () => {
    const file: VerifyFile = makeMinimalFile({
      items: [makeItem({ id: "item-1", verdict: "pending" })],
    });
    applyPatches(file, [{ id: "item-1", verdict: "pass" }]);
    expect(file.items[0].verdict).toBe("pending"); // input untouched
  });

  it("aliases a legacy warn patch verdict to cr (defensive back-compat for a stale cached client)", () => {
    const file: VerifyFile = makeMinimalFile({
      items: [makeItem({ id: "item-1", verdict: "pending" })],
    });
    const updated = applyPatches(file, [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "item-1", verdict: "warn" as any, severity: "P2" },
    ]);
    expect(updated.items[0].verdict).toBe("cr");
    expect(updated.items[0].severity).toBe("P2");
  });

  it("carries an existing crTaskId forward across a save, unmodified", () => {
    const file: VerifyFile = makeMinimalFile({
      items: [
        { ...makeItem({ id: "item-1", verdict: "cr" }), crTaskId: "TASK-777" },
      ],
    });
    const updated = applyPatches(file, [{ id: "item-1", verdict: "cr", notes: "still relevant" }]);
    expect(updated.items[0].crTaskId).toBe("TASK-777");
  });
});

// Title-join: the queue shows the real feature title from TASKS.md, not the bare
// id (TASK-036; surfaced rendering babynamey's 20-seed board). Runs LAST so the
// TASKS.md it writes doesn't affect the earlier "title === id (no board)" test.
describe("listVerifyRefs — joins the feature title from TASKS.md", () => {
  const tasksMd = () => join(tempRoot, ".claude", "TASKS.md");

  afterAll(() => {
    try {
      unlinkSync(tasksMd());
    } catch {
      /* already gone */
    }
  });

  it("uses the TASKS.md title when present, verbatim (keeps internal em-dashes)", () => {
    // TASK-001 was written by the round-trip test earlier in this file.
    writeFileSync(
      tasksMd(),
      [
        "# Task Board",
        "",
        "## Feature Lane",
        "",
        "### Verify",
        "",
        "#### [TASK-001] /names index — paginated, filterable (FEAT-02)",
        "- body",
        "",
      ].join("\n"),
      "utf8"
    );

    const ref = listVerifyRefs().find((r) => r.task === "TASK-001");
    expect(ref).toBeDefined();
    expect(ref!.title).toBe("/names index — paginated, filterable (FEAT-02)");
  });

  it("falls back to the id when the task isn't on the board", () => {
    // A board WITHOUT TASK-001 → no title to join → id fallback.
    writeFileSync(
      tasksMd(),
      "# Task Board\n\n## Feature Lane\n\n### Verify\n\n#### [TASK-999] Something else\n",
      "utf8"
    );
    const ref = listVerifyRefs().find((r) => r.task === "TASK-001");
    expect(ref).toBeDefined();
    expect(ref!.title).toBe("TASK-001");
  });
});

// Queue filter (change 5): the Verify tab means "awaiting human verification" —
// a task/bug whose board status is already Done drops out of listVerifyRefs
// entirely, regardless of what its pass-file says.
describe("listVerifyRefs — filters out tasks/bugs already Done on the board", () => {
  const tasksMd = () => join(tempRoot, ".claude", "TASKS.md");

  afterAll(() => {
    try {
      unlinkSync(tasksMd());
    } catch {
      /* already gone */
    }
  });

  it("excludes a task whose board status is Done, but keeps one still in Verify", () => {
    writeVerifyFile({
      schemaVersion: 1,
      task: "TASK-640",
      status: "in-review",
      items: [makeItem({ id: "item-1", verdict: "pass" })],
    });
    writeVerifyFile({
      schemaVersion: 1,
      task: "TASK-641",
      status: "in-review",
      items: [makeItem({ id: "item-1", verdict: "pending" })],
    });

    writeFileSync(
      tasksMd(),
      [
        "# Task Board",
        "",
        "## Feature Lane",
        "",
        "### Verify",
        "",
        "#### [TASK-641] Still awaiting verification",
        "- body",
        "",
        "### Done",
        "",
        "#### [TASK-640] Already accepted",
        "- body",
        "",
      ].join("\n"),
      "utf8"
    );

    const refs = listVerifyRefs();
    expect(refs.find((r) => r.task === "TASK-640")).toBeUndefined();
    expect(refs.find((r) => r.task === "TASK-641")).toBeDefined();
  });

  it("excludes a Done BUG the same way as a Done TASK", () => {
    writeVerifyFile({
      schemaVersion: 1,
      task: "BUG-095",
      status: "in-review",
      items: [makeItem({ id: "item-1", verdict: "pass" })],
    });

    writeFileSync(
      tasksMd(),
      ["# Task Board", "", "## Bug-Fix Lane", "", "### Done", "", "#### [BUG-095] Fixed and accepted", "- body", ""].join(
        "\n"
      ),
      "utf8"
    );

    const refs = listVerifyRefs();
    expect(refs.find((r) => r.task === "BUG-095")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// E. M4 — optimistic concurrency on verify-file writes
// ═══════════════════════════════════════════════════════════════════════════════

describe("writeVerifyFile — optimistic concurrency (M4)", () => {
  it("rejects a write when the interleaved write has a DIFFERENT mtime (fast-path)", () => {
    const file: VerifyFile = {
      schemaVersion: 1,
      task: "TASK-501",
      status: "in-review",
      items: [makeItem({ id: "item-1", verdict: "pending" })],
    };
    writeVerifyFile(file);
    const { mtimeMs, contentHash } = readVerifyFileWithMeta("TASK-501");

    // Simulate a concurrent external writer (e.g. the agent/Tester writing the
    // pass-file directly) landing between our read and our write, with an
    // unambiguously different mtime — the cheap stat-only reject branch.
    const filePath = join(tempVerifyDir, "TASK-501.json");
    writeFileSync(
      filePath,
      JSON.stringify({ ...file, status: "processing-fixes" }, null, 2),
      "utf8"
    );
    const bumped = new Date(statSync(filePath).mtimeMs + 5000);
    utimesSync(filePath, bumped, bumped);

    const result = writeVerifyFile({ ...file, status: "done" }, { mtimeMs, contentHash });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("conflict");

    // The external writer's content must survive untouched — no clobber.
    const onDisk = JSON.parse(readFileSync(filePath, "utf8")) as VerifyFile;
    expect(onDisk.status).toBe("processing-fixes");
  });

  it("rejects a write when the interleaved write keeps the SAME mtime (sub-tick collision)", () => {
    // NTFS mtime resolution is coarse enough that a measurable share of
    // back-to-back writes land on an identical mtimeMs, so an interleaved
    // write can be invisible to a stat-only check. Pin both writes to one
    // whole-second mtime to reproduce that collision deterministically.
    const file: VerifyFile = {
      schemaVersion: 1,
      task: "TASK-505",
      status: "in-review",
      items: [makeItem({ id: "item-1", verdict: "pending" })],
    };
    const filePath = join(tempVerifyDir, "TASK-505.json");
    const pin = new Date(Math.floor(Date.now() / 1000) * 1000);

    writeVerifyFile(file);
    utimesSync(filePath, pin, pin);
    const { mtimeMs, contentHash } = readVerifyFileWithMeta("TASK-505");

    writeFileSync(
      filePath,
      JSON.stringify({ ...file, status: "processing-fixes" }, null, 2),
      "utf8"
    );
    utimesSync(filePath, pin, pin);
    // Precondition: the mtimes really do collide — the stat fast-path passes.
    expect(statSync(filePath).mtimeMs).toBe(mtimeMs);

    // The content hash must still catch the interleaved write.
    const result = writeVerifyFile({ ...file, status: "done" }, { mtimeMs, contentHash });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("conflict");

    const onDisk = JSON.parse(readFileSync(filePath, "utf8")) as VerifyFile;
    expect(onDisk.status).toBe("processing-fixes");
  });

  it("allows a normal write when the file is unchanged since read", () => {
    const file: VerifyFile = {
      schemaVersion: 1,
      task: "TASK-502",
      status: "in-review",
      items: [makeItem({ id: "item-1", verdict: "pending" })],
    };
    writeVerifyFile(file);
    const { mtimeMs, contentHash } = readVerifyFileWithMeta("TASK-502");
    const result = writeVerifyFile({ ...file, status: "done" }, { mtimeMs, contentHash });
    expect(result.ok).toBe(true);
    expect(readVerifyFile("TASK-502").status).toBe("done");
  });

  it("skips the concurrency check when the expected token is omitted (back-compat)", () => {
    const file: VerifyFile = {
      schemaVersion: 1,
      task: "TASK-503",
      status: "in-review",
      items: [],
    };
    const result = writeVerifyFile(file);
    expect(result.ok).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F. M5 — GET-reachable reads are side-effect-free
// ═══════════════════════════════════════════════════════════════════════════════

describe("listVerifyRefs / readVerifyFile — side-effect-free reads (M5)", () => {
  it("readVerifyFile does not write to disk even when the retest-loop reconcile would change the file", () => {
    // item-1 is failing with a linked bug that IS Done in TASKS.md — a
    // reconcile that flips it to pending would apply if it were persisted.
    writeFileSync(
      join(tempRoot, ".claude", "TASKS.md"),
      ["# Task Board", "", "## Bug-Fix Lane", "", "### Done", "", "#### [BUG-060] Fixed bug", ""].join(
        "\n"
      ),
      "utf8"
    );
    const file: VerifyFile = {
      schemaVersion: 1,
      task: "TASK-504",
      status: "processing-fixes",
      items: [
        makeItem({ id: "item-1", verdict: "fail", severity: "P1", bugId: "BUG-060", round: 1 }),
      ],
    };
    writeVerifyFile(file);
    const filePath = join(tempVerifyDir, "TASK-504.json");
    const mtimeBefore = statSync(filePath).mtimeMs;
    const rawBefore = readFileSync(filePath, "utf8");

    const reconciled = readVerifyFile("TASK-504");
    // The CALLER sees the reconciled (flipped-to-pending) view...
    expect(reconciled.items[0].verdict).toBe("pending");
    // ...but the file on disk must be UNTOUCHED — no write on a read path.
    expect(statSync(filePath).mtimeMs).toBe(mtimeBefore);
    expect(readFileSync(filePath, "utf8")).toBe(rawBefore);
  });

  it("listVerifyRefs does not write to disk even when a reconcile would apply", () => {
    const filePath = join(tempVerifyDir, "TASK-504.json");
    const mtimeBefore = statSync(filePath).mtimeMs;

    const refs = listVerifyRefs();
    const ref = refs.find((r) => r.task === "TASK-504");
    expect(ref).toBeDefined();
    // The reconciled view shows pending (item-1 flipped) in the rollup.
    expect(ref!.counts["pending"]).toBe(1);
    expect(statSync(filePath).mtimeMs).toBe(mtimeBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// G. Minor fix — schema-invalid / unreadable verify files are surfaced, not dropped
// ═══════════════════════════════════════════════════════════════════════════════

describe("listVerifyRefs — surfaces invalid verify files instead of silently dropping them", () => {
  it("a schema-invalid file appears as an `invalid` entry (by filename)", () => {
    writeFileSync(
      join(tempVerifyDir, "TASK-777.json"),
      JSON.stringify({ schemaVersion: 1, task: "TASK-777", status: "bogus-status", items: [] }),
      "utf8"
    );
    const refs = listVerifyRefs();
    const ref = refs.find((r) => r.task === "TASK-777");
    expect(ref).toBeDefined();
    expect(ref!.invalid).toBe(true);
    expect(ref!.invalidReason).toBeTruthy();
  });

  it("an unreadable (malformed JSON) file also appears as an `invalid` entry", () => {
    writeFileSync(join(tempVerifyDir, "TASK-778.json"), "{ not valid json", "utf8");
    const refs = listVerifyRefs();
    const ref = refs.find((r) => r.task === "TASK-778");
    expect(ref).toBeDefined();
    expect(ref!.invalid).toBe(true);
    expect(ref!.invalidReason).toBeTruthy();
  });
});
