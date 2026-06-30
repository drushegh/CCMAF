// @vitest-environment node
/**
 * tasks-writeback.test.ts — Unit and route-level tests for TASK-010.
 *
 * Coverage:
 *   A. extractTaskBlock / getTaskDetail (pure string functions)
 *      - finds a task by id (feature + bug lane)
 *      - returns not-found for unknown id
 *      - returns correct lane, status, body
 *
 *   B. moveTaskStatus (pure string function — surgical block move)
 *      - moves a task across statuses (feature lane)
 *      - moves a task across statuses (bug lane)
 *      - all other bytes outside the moved block are preserved (byte-preservation)
 *      - idempotent: moving to the current status is a no-op (content unchanged)
 *      - not_found: unknown id returns { ok:false, code:'not_found' }
 *      - target_missing: non-existent target status returns { ok:false, code:'target_missing' }
 *      - ambiguous: duplicate id returns { ok:false, code:'ambiguous' }
 *      - BUG vs TASK lane routing: BUG-* stays in bug lane, TASK-* in feature lane
 *
 *   C. Route-level tests (fastify.inject with pass-through writeGuard)
 *      - GET /api/tasks/:id → 200 with correct detail
 *      - GET /api/tasks/:id → 400 on bad id (regex guard)
 *      - GET /api/tasks/:id → 404 on unknown id
 *      - PUT /api/tasks/:id/status → 200 + updated board on valid move
 *      - PUT /api/tasks/:id/status → 400 on missing status in body
 *      - PUT /api/tasks/:id/status → 400 on bad id
 *      - PUT /api/tasks/:id/status → 404 on unknown id
 *      - PUT /api/tasks/:id/status → 409 on target_missing
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

// ── Temp dir & mock ───────────────────────────────────────────────────────────

let tempRoot: string;

beforeAll(() => {
  tempRoot = join(tmpdir(), `ccmaf-tasks-writeback-test-${Date.now()}`);
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

// Deferred imports (after vi.mock)
const { extractTaskBlock, getTaskDetail, moveTaskStatus, setTaskArchived, createBug } = await import(
  "../src/server/tasks/writeback.js"
);
const { tasksWriteRoutes } = await import(
  "../src/server/routes/tasks-write-routes.js"
);
const { parseTasksMd } = await import("../src/server/parsers/tasks-parser.js");

// ── Sample TASKS.md fixture ───────────────────────────────────────────────────

const FIXTURE = `# Task Board

## Feature Lane

<!-- lifecycle comment -->

### In Progress

#### [TASK-001] Build the thing
- First bullet
- Second bullet

#### [TASK-002] Another task
- Only bullet

### Done

#### [TASK-003] Completed task
- Done bullet

### Todo

_(none yet)_

---

## Bug-Fix Lane

<!-- bug lane comment -->

### Reported

#### [BUG-001] Something is broken
- Symptom: crash
- Expected: no crash

### Fixing

### Done

`;

// ── A. Pure string function tests ─────────────────────────────────────────────

describe("getTaskDetail", () => {
  it("returns full detail for a feature lane task", () => {
    const detail = getTaskDetail(FIXTURE, "TASK-001");
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe("TASK-001");
    expect(detail!.title).toBe("Build the thing");
    expect(detail!.lane).toBe("feature");
    expect(detail!.status).toBe("In Progress");
    expect(detail!.body).toContain("- First bullet");
    expect(detail!.body).toContain("- Second bullet");
  });

  it("returns full detail for a bug lane task", () => {
    const detail = getTaskDetail(FIXTURE, "BUG-001");
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe("BUG-001");
    expect(detail!.title).toBe("Something is broken");
    expect(detail!.lane).toBe("bug");
    expect(detail!.status).toBe("Reported");
    expect(detail!.body.some((l) => l.includes("Symptom"))).toBe(true);
  });

  it("returns null for an unknown id", () => {
    const detail = getTaskDetail(FIXTURE, "TASK-999");
    expect(detail).toBeNull();
  });

  it("correctly handles a task in the Done section", () => {
    const detail = getTaskDetail(FIXTURE, "TASK-003");
    expect(detail).not.toBeNull();
    expect(detail!.status).toBe("Done");
  });

  it("reports archived:false by default and strips no real body", () => {
    const detail = getTaskDetail(FIXTURE, "TASK-001");
    expect(detail!.archived).toBe(false);
  });

  it("reports archived:true and excludes the marker from the body", () => {
    const archivedFixture = FIXTURE.replace(
      "#### [TASK-003] Completed task\n",
      "#### [TASK-003] Completed task\n<!-- archived -->\n",
    );
    const detail = getTaskDetail(archivedFixture, "TASK-003");
    expect(detail!.archived).toBe(true);
    expect(detail!.body.some((l) => l.includes("archived"))).toBe(false);
    expect(detail!.body).toContain("- Done bullet");
  });
});

// ── setTaskArchived ───────────────────────────────────────────────────────────

describe("setTaskArchived", () => {
  it("adds the marker after the heading and is detected as archived", () => {
    const result = setTaskArchived(FIXTURE, "TASK-001", true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const detail = getTaskDetail(result.content, "TASK-001");
    expect(detail!.archived).toBe(true);
    // Other tasks untouched.
    expect(getTaskDetail(result.content, "TASK-002")!.archived).toBe(false);
  });

  it("removes the marker on unarchive", () => {
    const archived = setTaskArchived(FIXTURE, "TASK-001", true);
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    const restored = setTaskArchived(archived.content, "TASK-001", false);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(getTaskDetail(restored.content, "TASK-001")!.archived).toBe(false);
    // Round-trip preserves the original content exactly.
    expect(restored.content).toBe(FIXTURE);
  });

  it("is idempotent (archiving twice changes nothing the second time)", () => {
    const once = setTaskArchived(FIXTURE, "TASK-001", true);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = setTaskArchived(once.content, "TASK-001", true);
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    expect(twice.content).toBe(once.content);
  });

  it("returns not_found for an unknown id", () => {
    const result = setTaskArchived(FIXTURE, "TASK-999", true);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_found");
  });

  it("the parsed board reflects the archived flag", () => {
    const result = setTaskArchived(FIXTURE, "TASK-003", true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const board = parseTasksMd(result.content);
    const item = board.columns
      .flatMap((c) => c.items)
      .find((i) => i.id === "TASK-003")!;
    expect(item.archived).toBe(true);
  });
});

describe("extractTaskBlock", () => {
  it("finds a task block (feature lane)", () => {
    const result = extractTaskBlock(FIXTURE, "TASK-001");
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.lane).toBe("feature");
    expect(result.status).toBe("In Progress");
    expect(result.blockLines[0]).toMatch(/####\s+\[TASK-001\]/);
  });

  it("finds a task block (bug lane)", () => {
    const result = extractTaskBlock(FIXTURE, "BUG-001");
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.lane).toBe("bug");
  });

  it("returns found:false for unknown id", () => {
    const result = extractTaskBlock(FIXTURE, "TASK-777");
    expect(result.found).toBe(false);
  });
});

// ── B. moveTaskStatus tests ───────────────────────────────────────────────────

describe("moveTaskStatus — feature lane", () => {
  it("moves TASK-001 from In Progress to Done", () => {
    const result = moveTaskStatus(FIXTURE, "TASK-001", "Done");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.content;

    // TASK-001 should now be in Done section
    const detail = getTaskDetail(after, "TASK-001");
    expect(detail).not.toBeNull();
    expect(detail!.status).toBe("Done");

    // TASK-002 and TASK-003 should still be in their original sections
    const d2 = getTaskDetail(after, "TASK-002");
    expect(d2!.status).toBe("In Progress");
    const d3 = getTaskDetail(after, "TASK-003");
    expect(d3!.status).toBe("Done");
  });

  it("moves TASK-002 from In Progress to Todo", () => {
    const result = moveTaskStatus(FIXTURE, "TASK-002", "Todo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const detail = getTaskDetail(result.content, "TASK-002");
    expect(detail!.status).toBe("Todo");
  });

  it("preserves all other content byte-by-byte (non-moved lines)", () => {
    const result = moveTaskStatus(FIXTURE, "TASK-001", "Done");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.content;

    // The comment line should still be present
    expect(after).toContain("<!-- lifecycle comment -->");
    // TASK-002 heading and bullet should be preserved verbatim
    expect(after).toContain("#### [TASK-002] Another task");
    expect(after).toContain("- Only bullet");
    // TASK-003 content preserved
    expect(after).toContain("#### [TASK-003] Completed task");
    expect(after).toContain("- Done bullet");
    // Bug lane content preserved
    expect(after).toContain("## Bug-Fix Lane");
    expect(after).toContain("#### [BUG-001] Something is broken");
    expect(after).toContain("<!-- bug lane comment -->");
    // The task board heading preserved
    expect(after).toContain("# Task Board");
    // The divider preserved
    expect(after).toContain("---");
    // The "(none yet)" placeholder preserved
    expect(after).toContain("_(none yet)_");
  });

  it("moved block preserves the task's own body lines", () => {
    const result = moveTaskStatus(FIXTURE, "TASK-001", "Done");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.content;
    // Body bullets should survive the move
    expect(after).toContain("- First bullet");
    expect(after).toContain("- Second bullet");
  });
});

describe("moveTaskStatus — bug lane", () => {
  it("moves BUG-001 from Reported to Fixing", () => {
    const result = moveTaskStatus(FIXTURE, "BUG-001", "Fixing");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const detail = getTaskDetail(result.content, "BUG-001");
    expect(detail!.status).toBe("Fixing");
    expect(detail!.lane).toBe("bug");
  });

  it("BUG-* stays in bug lane (not moved into feature lane sections)", () => {
    // Attempt to move to a status that exists in BOTH lanes (Done appears in both).
    // The BUG task should land in the Bug-Fix Lane's Done section.
    const result = moveTaskStatus(FIXTURE, "BUG-001", "Done");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const detail = getTaskDetail(result.content, "BUG-001");
    expect(detail!.status).toBe("Done");
    expect(detail!.lane).toBe("bug");
  });
});

describe("moveTaskStatus — idempotent no-op", () => {
  it("moving to the current status returns ok:true with unchanged content", () => {
    const result = moveTaskStatus(FIXTURE, "TASK-001", "In Progress");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Content should be identical (the idempotent path returns the input unchanged)
    expect(result.content).toBe(FIXTURE);
  });
});

describe("moveTaskStatus — error cases", () => {
  it("returns not_found for an unknown id", () => {
    const result = moveTaskStatus(FIXTURE, "TASK-999", "Done");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("not_found");
  });

  it("returns target_missing when the target status section does not exist", () => {
    const result = moveTaskStatus(FIXTURE, "TASK-001", "Ready for Review");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("target_missing");
  });

  it("returns ambiguous when the same id appears twice", () => {
    const ambiguousContent = FIXTURE + "\n#### [TASK-001] Duplicate heading\n- extra\n";
    const result = moveTaskStatus(ambiguousContent, "TASK-001", "Done");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("ambiguous");
  });
});

// ── B2. Block-boundary regression (body containing subheadings) ──────────────

describe("moveTaskStatus — body subheadings do NOT end the block", () => {
  // Regression test for the ANY_HEADING_RE bug: a task body containing lines
  // that start with ### or #### (but are NOT structural boundaries) must NOT
  // end the block early, causing truncation or content stranding.
  const FIXTURE_WITH_SUBHEADINGS = `# Task Board

## Feature Lane

### In Progress

#### [TASK-010] Task with body subheadings
- First bullet
- e.g. #### Subtask heading in body
- ### Example sub-section in body
- Last bullet

### Done

#### [TASK-011] Another task
- Bullet

### Todo

_(none yet)_

---

## Bug-Fix Lane

### Reported

### Done

`;

  it("moves a task whose body contains #### lines without truncation", () => {
    const result = moveTaskStatus(FIXTURE_WITH_SUBHEADINGS, "TASK-010", "Done");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const detail = getTaskDetail(result.content, "TASK-010");
    expect(detail).not.toBeNull();
    expect(detail!.status).toBe("Done");

    // ALL body lines must survive the move — nothing truncated
    expect(detail!.body).toContain("- First bullet");
    expect(detail!.body).toContain("- e.g. #### Subtask heading in body");
    expect(detail!.body).toContain("- ### Example sub-section in body");
    expect(detail!.body).toContain("- Last bullet");
  });

  it("body subheadings do not strand content — TASK-011 remains intact", () => {
    const result = moveTaskStatus(FIXTURE_WITH_SUBHEADINGS, "TASK-010", "Done");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // TASK-011 must not be disturbed
    const d11 = getTaskDetail(result.content, "TASK-011");
    expect(d11).not.toBeNull();
    expect(d11!.status).toBe("Done");
    expect(d11!.body).toContain("- Bullet");
  });

  it("extractTaskBlock collects body lines with ### without premature termination", () => {
    const result = extractTaskBlock(FIXTURE_WITH_SUBHEADINGS, "TASK-010");
    expect(result.found).toBe(true);
    if (!result.found) return;

    const blockText = result.blockLines.join("\n");
    expect(blockText).toContain("- e.g. #### Subtask heading in body");
    expect(blockText).toContain("- ### Example sub-section in body");
    expect(blockText).toContain("- Last bullet");
  });
});

// ── C. Route-level tests ──────────────────────────────────────────────────────

// Pass-through writeGuard (always calls done() — no security enforcement in tests)
function passThroughGuard(
  _req: FastifyRequest,
  _reply: FastifyReply,
  done: () => void
): void {
  done();
}

async function buildTestServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(tasksWriteRoutes, { writeGuard: passThroughGuard });
  await app.ready();
  return app;
}

describe("GET /api/tasks/:id — route", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Write a TASKS.md into our temp project root.
    writeFileSync(join(tempRoot, ".claude", "TASKS.md"), FIXTURE, "utf8");
    app = await buildTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 200 with task detail for a valid known id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tasks/TASK-001" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string; title: string; lane: string; status: string; body: string[]; comments: number }>();
    expect(body.id).toBe("TASK-001");
    expect(body.title).toBe("Build the thing");
    expect(body.lane).toBe("feature");
    expect(body.status).toBe("In Progress");
    expect(Array.isArray(body.body)).toBe(true);
    expect(typeof body.comments).toBe("number");
    expect(body.comments).toBe(0); // no comments file yet
  });

  it("returns 400 for a bad id format", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tasks/not-a-task" });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/invalid task id/i);
  });

  it("rejects traversal attempt in id — no 200 returned", async () => {
    // URL "/api/tasks/TASK-../evil": Fastify's router sees "TASK-.." as :id and
    // "/evil" as an extra segment — no route matches, so it returns 404.
    // Either 400 (bad id) or 404 (no route) is safe; we assert NOT 200.
    const res = await app.inject({ method: "GET", url: "/api/tasks/TASK-../evil" });
    expect(res.statusCode).not.toBe(200);
  });

  it("returns 404 for an unknown valid id", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tasks/TASK-999" });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/not found/i);
  });
});

describe("PUT /api/tasks/:id/status — route", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Reset TASKS.md to the fixture before each route suite.
    writeFileSync(join(tempRoot, ".claude", "TASKS.md"), FIXTURE, "utf8");
    app = await buildTestServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 200 + updated board on a valid move", async () => {
    // Reset TASKS.md to fixture first.
    writeFileSync(join(tempRoot, ".claude", "TASKS.md"), FIXTURE, "utf8");

    const res = await app.inject({
      method: "PUT",
      url: "/api/tasks/TASK-001/status",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ status: "Done" }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; board: { columns: unknown[] } }>();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.board.columns)).toBe(true);
    // TASK-001 should now appear in the Done column
    const done = body.board.columns.find(
      (c: unknown) => (c as { status: string; lane: string }).status === "Done" &&
                      (c as { status: string; lane: string }).lane === "feature"
    ) as { items: { id: string }[] } | undefined;
    expect(done).toBeDefined();
    expect(done!.items.some((item) => item.id === "TASK-001")).toBe(true);
  });

  it("returns 400 for bad id format", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/tasks/bad-id/status",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ status: "Done" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing status in body", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/tasks/TASK-001/status",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/status/i);
  });

  it("returns 400 for invalid lane value", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/tasks/TASK-001/status",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ status: "Done", lane: "invalid" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for unknown task id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/tasks/TASK-999/status",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ status: "Done" }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 when target status section does not exist", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/tasks/TASK-001/status",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ status: "Ready for Review" }),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/no write performed/i);
  });

  it("idempotent: moving to current status returns 200 + board", async () => {
    // Reset to fixture.
    writeFileSync(join(tempRoot, ".claude", "TASKS.md"), FIXTURE, "utf8");

    const res = await app.inject({
      method: "PUT",
      url: "/api/tasks/TASK-001/status",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ status: "In Progress" }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ ok: boolean; board: unknown }>();
    expect(body.ok).toBe(true);
  });
});

describe("PUT /api/tasks/:id/archived — route", () => {
  let app: FastifyInstance;

  type BoardReply = {
    ok: boolean;
    board: { columns: { items: { id: string; archived: boolean }[] }[] };
  };
  const findItem = (body: BoardReply, id: string) =>
    body.board.columns.flatMap((c) => c.items).find((i) => i.id === id);

  beforeAll(async () => {
    writeFileSync(join(tempRoot, ".claude", "TASKS.md"), FIXTURE, "utf8");
    app = await buildTestServer();
  });
  afterAll(async () => {
    await app.close();
  });

  it("archives a task (200, board reflects archived:true)", async () => {
    writeFileSync(join(tempRoot, ".claude", "TASKS.md"), FIXTURE, "utf8");
    const res = await app.inject({
      method: "PUT",
      url: "/api/tasks/TASK-001/archived",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ archived: true }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<BoardReply>();
    expect(findItem(body, "TASK-001")!.archived).toBe(true);
    expect(findItem(body, "TASK-002")!.archived).toBe(false);
  });

  it("unarchives a task (200, board reflects archived:false)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/tasks/TASK-001/archived",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ archived: false }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<BoardReply>();
    expect(findItem(body, "TASK-001")!.archived).toBe(false);
  });

  it("returns 400 when archived is not a boolean", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/tasks/TASK-001/archived",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ archived: "yes" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/tasks/TASK-999/archived",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ archived: true }),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── TASK-033: bare-ID house style (framework's `#### TASK-N — title`) ──────────
// The Console is the liberal reader (CHANNEL [11]): it parses + round-trips both
// bracketed `[TASK-N]` and bare `TASK-N` headings, preserving the on-disk form.

const BARE_FIXTURE = `# Task Board

## Feature Lane

### In Progress

#### TASK-101 — Build the bare thing
- a bullet

#### TASK-102 — Second bare task
- another bullet

### Done

#### TASK-100 — Done bare task

## Bug-Fix Lane

### Reported

_(none)_

### Done
`;

describe("TASK-033 — bare-ID tasks (framework house style)", () => {
  it("parses bare `#### TASK-N — title` headings (id + title)", () => {
    const board = parseTasksMd(BARE_FIXTURE);
    const inProg = board.columns.find(
      (c) => c.status === "In Progress" && c.lane === "feature"
    );
    expect(inProg).toBeDefined();
    expect(inProg!.items.map((i) => i.id)).toEqual(["TASK-101", "TASK-102"]);
    expect(inProg!.items[0].title).toBe("Build the bare thing");
  });

  it("getTaskDetail finds a bare task", () => {
    const detail = getTaskDetail(BARE_FIXTURE, "TASK-101");
    expect(detail).not.toBeNull();
    expect(detail!.title).toBe("Build the bare thing");
    expect(detail!.status).toBe("In Progress");
  });

  it("moveTaskStatus preserves the bare form and does not swallow the next bare task", () => {
    const result = moveTaskStatus(BARE_FIXTURE, "TASK-101", "Done", "feature");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Still bare — not re-bracketed.
    expect(result.content).toContain("#### TASK-101 — Build the bare thing");
    expect(result.content).not.toContain("[TASK-101]");
    // TASK-102 stayed in In Progress (the block boundary respected the bare heading).
    const board = parseTasksMd(result.content);
    const inProg = board.columns.find(
      (c) => c.status === "In Progress" && c.lane === "feature"
    );
    expect(inProg!.items.map((i) => i.id)).toEqual(["TASK-102"]);
    const done = board.columns.find((c) => c.status === "Done" && c.lane === "feature");
    expect(done!.items.map((i) => i.id)).toEqual(expect.arrayContaining(["TASK-100", "TASK-101"]));
  });

  it("setTaskArchived works on a bare task", () => {
    const res = setTaskArchived(BARE_FIXTURE, "TASK-102", true);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(getTaskDetail(res.content, "TASK-102")!.archived).toBe(true);
  });

  it("createBug emits a BARE heading on a bare board (preserve on-disk form)", () => {
    const res = createBug(BARE_FIXTURE, { title: "Flagged thing", date: "2026-06-26" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain("#### BUG-001 Flagged thing — Reported 2026-06-26");
    expect(res.content).not.toContain("[BUG-001]");
    const board = parseTasksMd(res.content);
    const reported = board.columns.find((c) => c.status === "Reported" && c.lane === "bug");
    expect(reported!.items.map((i) => i.id)).toContain("BUG-001");
  });

  it("createBug keeps the BRACKETED heading on a bracketed board (regression)", () => {
    const res = createBug(FIXTURE, { title: "X", date: "2026-06-26" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // FIXTURE already has BUG-001 → next is BUG-002, bracketed.
    expect(res.content).toContain("#### [BUG-002] X — Reported 2026-06-26");
  });
});
