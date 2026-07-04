// @vitest-environment node
/**
 * verify-routes.test.ts — Route-level tests for the M5 fix (GET verify
 * endpoints must be side-effect-free) and the M4 fix (PUT persists the
 * reconciled + patched shape, guarded by an optimistic-concurrency check).
 *
 * Companion to tests/verify.test.ts (io-layer unit tests) and
 * tests/server.test.ts (write-guard security tests) — this file exercises
 * the verify-routes.ts plugin directly via fastify.inject with a
 * pass-through writeGuard (security is covered elsewhere).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, statSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

let tempRoot: string;
let tempVerifyDir: string;

beforeAll(() => {
  tempRoot = join(tmpdir(), `ccmaf-verify-routes-test-${Date.now()}`);
  tempVerifyDir = join(tempRoot, ".claude", "console", "verify");
  mkdirSync(tempVerifyDir, { recursive: true });
  mkdirSync(join(tempRoot, ".claude"), { recursive: true });
});

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

// Must be registered before any import that depends on project-root.
vi.mock("../src/server/project-root.js", () => {
  return {
    findProjectRoot: (_: string) => tempRoot,
    getProjectRoot: () => tempRoot,
    dotClaudePath: (...segments: string[]) =>
      [tempRoot, ".claude", ...segments].join("/"),
  };
});

const verifyRoutes = (await import("../src/server/routes/verify-routes.js")).default;
const { writeVerifyFile } = await import("../src/server/verify/io.js");
const { getTaskDetail } = await import("../src/server/tasks/writeback.js");
import type { VerifyFile } from "../src/server/verify/schema.js";

function passThroughGuard(
  _req: FastifyRequest,
  _reply: FastifyReply,
  done: () => void
): void {
  done();
}

async function buildTestServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(verifyRoutes, { writeGuard: passThroughGuard });
  await app.ready();
  return app;
}

function makeItem(overrides: Partial<VerifyFile["items"][number]> = {}) {
  return {
    id: "item-1",
    kind: "test-plan-item",
    title: "A use case",
    verdict: "fail" as const,
    severity: "P1" as const,
    bugId: "BUG-070",
    round: 1,
    ...overrides,
  };
}

describe("GET /api/verify and /api/verify/:task — side-effect-free (M5)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // BUG-070 is Done in TASKS.md, so the retest-loop reconcile WOULD flip
    // item-1 (which carries bugId BUG-070, still failing) back to pending —
    // exactly the condition that used to trigger a write on the read path.
    writeFileSync(
      join(tempRoot, ".claude", "TASKS.md"),
      ["# Task Board", "", "## Bug-Fix Lane", "", "### Done", "", "#### [BUG-070] Fixed bug", ""].join(
        "\n"
      ),
      "utf8"
    );
    const file: VerifyFile = {
      schemaVersion: 1,
      task: "TASK-610",
      status: "processing-fixes",
      items: [makeItem()],
    };
    writeVerifyFile(file);
    app = await buildTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/verify performs zero disk writes even though a reconcile applies", async () => {
    const filePath = join(tempVerifyDir, "TASK-610.json");
    const mtimeBefore = statSync(filePath).mtimeMs;

    const res = await app.inject({ method: "GET", url: "/api/verify" });
    expect(res.statusCode).toBe(200);
    const refs = res.json<{ task: string; counts: Record<string, number> }[]>();
    const ref = refs.find((r) => r.task === "TASK-610");
    expect(ref).toBeDefined();
    // The reconciled view (pending) is what the caller sees...
    expect(ref!.counts["pending"]).toBe(1);
    // ...but the file on disk must not have moved.
    expect(statSync(filePath).mtimeMs).toBe(mtimeBefore);
  });

  it("GET /api/verify/:task performs zero disk writes even though a reconcile applies", async () => {
    const filePath = join(tempVerifyDir, "TASK-610.json");
    const mtimeBefore = statSync(filePath).mtimeMs;

    const res = await app.inject({ method: "GET", url: "/api/verify/TASK-610" });
    expect(res.statusCode).toBe(200);
    const file = res.json<VerifyFile>();
    expect(file.items[0].verdict).toBe("pending");
    expect(statSync(filePath).mtimeMs).toBe(mtimeBefore);
  });

  it("PUT persists the reconciled + patched shape (reconcile still happens on the write path)", async () => {
    const filePath = join(tempVerifyDir, "TASK-610.json");
    const res = await app.inject({
      method: "PUT",
      url: "/api/verify/TASK-610",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify([{ id: "item-1", verdict: "pass" }]),
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json<VerifyFile>();
    expect(updated.items[0].verdict).toBe("pass");

    const onDisk = JSON.parse(readFileSync(filePath, "utf8")) as VerifyFile;
    // The persisted file reflects the retest-loop reconcile (bugId cleared by
    // the pass, round bumped) — it was NOT stuck at the pre-reconcile shape.
    expect(onDisk.items[0].verdict).toBe("pass");
    expect(onDisk.items[0].bugId).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Changes 1 & 3 — auto-move to Done on all-complete, and the CR follow-up spawn
// ═══════════════════════════════════════════════════════════════════════════════

describe("PUT /api/verify/:task — auto-move to Done (change 1) + CR follow-up spawn (change 3)", () => {
  let app: FastifyInstance;
  const tasksMdPath = () => join(tempRoot, ".claude", "TASKS.md");

  beforeAll(async () => {
    writeFileSync(
      tasksMdPath(),
      [
        "# Task Board",
        "",
        "## Feature Lane",
        "",
        "### Todo (Priority Order)",
        "",
        "_(none)_",
        "",
        "### Verify",
        "",
        "#### [TASK-620] Auto-move candidate (all pass)",
        "- body",
        "",
        "#### [TASK-621] Mixed pass+cr candidate",
        "- body",
        "",
        "#### [TASK-622] Holds while incomplete",
        "- body",
        "",
        "#### [TASK-623] CR spawn target",
        "- body",
        "",
        "### Done",
        "",
        "## Bug-Fix Lane",
        "",
        "### Verify",
        "",
        "#### [BUG-090] Bug auto-move candidate",
        "- body",
        "",
        "### Done",
        "",
      ].join("\n"),
      "utf8"
    );
    app = await buildTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("auto-moves the task to Done when the last pending item is saved as pass", async () => {
    writeVerifyFile({
      schemaVersion: 1,
      task: "TASK-620",
      status: "in-review",
      items: [
        makeItem({ id: "item-1", verdict: "pass", bugId: null, severity: null }),
        makeItem({ id: "item-2", verdict: "pending", bugId: null, severity: null }),
      ],
    });

    const res = await app.inject({
      method: "PUT",
      url: "/api/verify/TASK-620",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify([{ id: "item-2", verdict: "pass" }]),
    });
    expect(res.statusCode).toBe(200);

    const board = readFileSync(tasksMdPath(), "utf8");
    const detail = getTaskDetail(board, "TASK-620");
    expect(detail?.status).toBe("Done");
    expect(detail?.lane).toBe("feature");
  });

  it("auto-moves the task to Done when the item set is a pass+cr mix (cr counts as complete)", async () => {
    writeVerifyFile({
      schemaVersion: 1,
      task: "TASK-621",
      status: "in-review",
      items: [
        makeItem({ id: "item-1", verdict: "pass", bugId: null, severity: null }),
        makeItem({ id: "item-2", verdict: "pending", bugId: null, severity: null }),
      ],
    });

    const res = await app.inject({
      method: "PUT",
      url: "/api/verify/TASK-621",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify([{ id: "item-2", verdict: "cr", notes: "please tweak the copy" }]),
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json<VerifyFile>();
    expect(updated.items.every((it) => it.verdict === "pass" || it.verdict === "cr")).toBe(true);

    const board = readFileSync(tasksMdPath(), "utf8");
    expect(getTaskDetail(board, "TASK-621")?.status).toBe("Done");
  });

  it("holds the task in place (does not move to Done) while a verdict is fail, blocked, or pending", async () => {
    writeVerifyFile({
      schemaVersion: 1,
      task: "TASK-622",
      status: "in-review",
      items: [makeItem({ id: "item-1", verdict: "pending", bugId: null, severity: null })],
    });

    for (const verdict of ["fail", "blocked", "pending"] as const) {
      const res = await app.inject({
        method: "PUT",
        url: "/api/verify/TASK-622",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify([{ id: "item-1", verdict }]),
      });
      expect(res.statusCode).toBe(200);
      const board = readFileSync(tasksMdPath(), "utf8");
      expect(getTaskDetail(board, "TASK-622")?.status).toBe("Verify");
    }
  });

  it("spawns a linked follow-up task in the Feature Lane's Todo column when a verdict is set to cr, and never duplicates it on re-save", async () => {
    writeVerifyFile({
      schemaVersion: 1,
      task: "TASK-623",
      status: "in-review",
      items: [makeItem({ id: "item-1", kind: "usecase", title: "Rename the export button", verdict: "pending", bugId: null, severity: null })],
    });

    const firstRes = await app.inject({
      method: "PUT",
      url: "/api/verify/TASK-623",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify([{ id: "item-1", verdict: "cr", notes: "call it Export, not Download" }]),
    });
    expect(firstRes.statusCode).toBe(200);
    const firstUpdated = firstRes.json<VerifyFile>();
    const spawnedId = firstUpdated.items[0].crTaskId;
    expect(spawnedId).toMatch(/^TASK-\d+$/);

    // The follow-up exists on the board, in the Feature Lane's Todo column.
    let board = readFileSync(tasksMdPath(), "utf8");
    const followUp = getTaskDetail(board, spawnedId!);
    expect(followUp).not.toBeNull();
    expect(followUp?.lane).toBe("feature");
    expect(followUp?.status).toBe("Todo");
    expect(followUp?.title).toContain("Rename the export button");
    expect(board).toContain("TASK-623 verification");
    expect(board).toContain("use-case `item-1`");

    // Re-saving the SAME cr verdict (e.g. an unrelated field edit, or the
    // client resending full state) must NOT spawn a second follow-up.
    const secondRes = await app.inject({
      method: "PUT",
      url: "/api/verify/TASK-623",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify([{ id: "item-1", verdict: "cr", notes: "call it Export, not Download — confirmed" }]),
    });
    expect(secondRes.statusCode).toBe(200);
    const secondUpdated = secondRes.json<VerifyFile>();
    expect(secondUpdated.items[0].crTaskId).toBe(spawnedId);

    board = readFileSync(tasksMdPath(), "utf8");
    // Exactly one follow-up heading references this source item — no duplicate.
    const occurrences = board.split("use-case `item-1`").length - 1;
    expect(occurrences).toBe(1);
  });

  it("F3 regression: a pre-existing cr item with no crTaskId does NOT get a retroactive follow-up spawned by an unrelated save, but a genuine cr transition still spawns exactly one", async () => {
    // item-1 simulates a legacy/pre-existing `cr` item that predates the
    // crTaskId feature (no crTaskId field at all). item-2 is the item this
    // save actually targets (unrelated to item-1). item-3 starts pending and
    // is used in step 2 to prove a REAL cr transition still spawns normally.
    writeVerifyFile({
      schemaVersion: 1,
      task: "TASK-624",
      status: "in-review",
      items: [
        makeItem({ id: "f3-item-1", kind: "usecase", title: "Old CR item", verdict: "cr", severity: "P2", bugId: null, notes: "pre-existing, no crTaskId" }),
        makeItem({ id: "f3-item-2", kind: "usecase", title: "Unrelated failing item", verdict: "fail", severity: "P1", bugId: null }),
        makeItem({ id: "f3-item-3", kind: "usecase", title: "Will become a CR", verdict: "pending", severity: null, bugId: null }),
      ],
    });

    // Step 1: save a patch that ONLY touches f3-item-2 (fail -> pass).
    // f3-item-1's pre-existing cr verdict is untouched by this request.
    const step1 = await app.inject({
      method: "PUT",
      url: "/api/verify/TASK-624",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify([{ id: "f3-item-2", verdict: "pass" }]),
    });
    expect(step1.statusCode).toBe(200);
    const afterStep1 = step1.json<VerifyFile>();
    const item1AfterStep1 = afterStep1.items.find((it) => it.id === "f3-item-1")!;
    // Zero follow-ups spawned for the untouched pre-existing cr item.
    expect(item1AfterStep1.crTaskId ?? null).toBeNull();

    const boardAfterStep1 = readFileSync(tasksMdPath(), "utf8");
    expect(boardAfterStep1).not.toContain("use-case `f3-item-1`");

    // Step 2: a patch that genuinely transitions f3-item-3 to cr must still
    // spawn exactly one follow-up (the fix must not disable spawning
    // outright, only the retroactive/untouched-item case).
    const step2 = await app.inject({
      method: "PUT",
      url: "/api/verify/TASK-624",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify([{ id: "f3-item-3", verdict: "cr", notes: "needs a follow-up" }]),
    });
    expect(step2.statusCode).toBe(200);
    const afterStep2 = step2.json<VerifyFile>();
    const item3AfterStep2 = afterStep2.items.find((it) => it.id === "f3-item-3")!;
    expect(item3AfterStep2.crTaskId).toMatch(/^TASK-\d+$/);
    // f3-item-1 still has no follow-up — this save didn't touch it either.
    const item1AfterStep2 = afterStep2.items.find((it) => it.id === "f3-item-1")!;
    expect(item1AfterStep2.crTaskId ?? null).toBeNull();

    const boardAfterStep2 = readFileSync(tasksMdPath(), "utf8");
    expect(boardAfterStep2).not.toContain("use-case `f3-item-1`");
    const item3Occurrences = boardAfterStep2.split("use-case `f3-item-3`").length - 1;
    expect(item3Occurrences).toBe(1);
  });

  it("auto-moves a BUG (bug-fix lane) to Done the same way as a TASK", async () => {
    writeVerifyFile({
      schemaVersion: 1,
      task: "BUG-090",
      status: "in-review",
      items: [makeItem({ id: "item-1", verdict: "pending", bugId: null, severity: null })],
    });

    const res = await app.inject({
      method: "PUT",
      url: "/api/verify/BUG-090",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify([{ id: "item-1", verdict: "pass" }]),
    });
    expect(res.statusCode).toBe(200);

    const board = readFileSync(tasksMdPath(), "utf8");
    const detail = getTaskDetail(board, "BUG-090");
    expect(detail?.status).toBe("Done");
    expect(detail?.lane).toBe("bug");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Legacy wire-format alias — verdict:"warn" on disk reads as "cr"
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/verify/:task — legacy `warn` verdict reads as `cr`", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestServer();
    // Written directly (bypassing writeVerifyFile's validation, which no
    // longer accepts "warn") to simulate a pre-existing on-disk file from
    // before the rename — exactly the legacy shape this alias must handle.
    writeFileSync(
      join(tempVerifyDir, "TASK-630.json"),
      JSON.stringify({
        schemaVersion: 1,
        task: "TASK-630",
        status: "in-review",
        items: [
          { id: "item-1", kind: "usecase", title: "Legacy item", verdict: "warn", severity: "P3" },
        ],
      }),
      "utf8"
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it("normalizes a legacy warn verdict to cr on GET /api/verify/:task", async () => {
    const res = await app.inject({ method: "GET", url: "/api/verify/TASK-630" });
    expect(res.statusCode).toBe(200);
    const file = res.json<VerifyFile>();
    expect(file.items[0].verdict).toBe("cr");
  });

  it("normalizes a legacy warn verdict to cr in the GET /api/verify queue rollup", async () => {
    const res = await app.inject({ method: "GET", url: "/api/verify" });
    expect(res.statusCode).toBe(200);
    const refs = res.json<{ task: string; counts: Record<string, number> }[]>();
    const ref = refs.find((r) => r.task === "TASK-630");
    expect(ref).toBeDefined();
    expect(ref!.counts["cr"]).toBe(1);
    expect(ref!.counts["warn"]).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F4 — a verify file whose own `task` field doesn't match the :task route
// param it's addressed by must be rejected explicitly, not produce a
// misleading conflict / silently-discarded edit.
// ═══════════════════════════════════════════════════════════════════════════════

describe("PUT /api/verify/:task — rejects a file whose internal task field mismatches the route param (F4)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestServer();
    // Written directly (bypassing writeVerifyFile, which always writes to
    // resolveVerifyPath(file.task) and so can never produce this shape
    // itself) to simulate an externally hand-edited / renamed file: the
    // filename says TASK-640 but the file's own `task` field says TASK-999.
    writeFileSync(
      join(tempVerifyDir, "TASK-640.json"),
      JSON.stringify({
        schemaVersion: 1,
        task: "TASK-999",
        status: "in-review",
        items: [{ id: "item-1", kind: "usecase", title: "Mismatched file", verdict: "pending" }],
      }),
      "utf8"
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it("PUT rejects with a clear diagnostic (not a misleading 409 'changed on disk') and leaves the file untouched", async () => {
    const before = readFileSync(join(tempVerifyDir, "TASK-640.json"), "utf8");

    const res = await app.inject({
      method: "PUT",
      url: "/api/verify/TASK-640",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify([{ id: "item-1", verdict: "pass" }]),
    });

    // Not a 409 "reload and retry" — that response would be actively
    // misleading here (reloading and retrying can never fix a structural
    // filename/task-field mismatch).
    expect(res.statusCode).not.toBe(409);
    expect(res.statusCode).toBe(422);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/mismatch/i);
    expect(body.error).toContain("TASK-640");
    expect(body.error).toContain("TASK-999");

    // The edit must be silently discarded nowhere: TASK-640.json is
    // untouched, and no TASK-999.json was created either.
    expect(readFileSync(join(tempVerifyDir, "TASK-640.json"), "utf8")).toBe(before);
    expect(existsSync(join(tempVerifyDir, "TASK-999.json"))).toBe(false);
  });

  it("GET also rejects the mismatched file with a diagnostic (422) rather than silently serving it", async () => {
    const res = await app.inject({ method: "GET", url: "/api/verify/TASK-640" });
    expect(res.statusCode).toBe(422);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/mismatch/i);
  });
});
