// @vitest-environment node
/**
 * comments.test.ts — Unit tests for TASK-013 (comments sidecar + endpoints).
 *
 * Coverage:
 *   A. io layer (readComments / appendComment / resolveCommentsPath)
 *      - read absent file → returns empty thread (schemaVersion, taskId, comments:[])
 *      - append then read-back → round-trip equality
 *      - multiple appends → unique UUID ids (not c-1, c-2 sequential)
 *      - empty body rejected → EMPTY_BODY error
 *      - bad task id rejected → Invalid task id
 *      - schema shape: schemaVersion:1, taskId, comments[].{id, author, ts, body}
 *      - statusAtComment included when provided, absent when not
 *      - author defaults to "human" when not supplied
 *      - path-safety: a bad id never escapes the comments dir
 *
 *   B. Route layer (GET + POST via fastify.inject + pass-through guard)
 *      - GET absent file → 200 empty thread
 *      - GET bad id → 400
 *      - POST appends and returns updated thread → 200
 *      - POST empty body → 400
 *      - POST bad id → 400
 *      - POST missing body field → 400
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance, type preHandlerHookHandler } from "fastify";

// ── Temp dir setup ─────────────────────────────────────────────────────────────

let tempRoot: string;

beforeAll(() => {
  tempRoot = join(tmpdir(), `ccmaf-comments-test-${Date.now()}`);
  // Create the .claude sentinel so dotClaudePath resolves correctly.
  mkdirSync(join(tempRoot, ".claude"), { recursive: true });
  // Pre-create the comments directory (io.ts also does this, but keep it clean).
  mkdirSync(join(tempRoot, ".claude", "console", "comments"), { recursive: true });
});

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

// ── Mock project-root ─────────────────────────────────────────────────────────
// Must be registered BEFORE any module import that depends on project-root.

vi.mock("../src/server/project-root.js", () => {
  // tempRoot is in scope via closure — vitest evaluates this lazily.
  return {
    findProjectRoot: (_: string) => tempRoot,
    getProjectRoot: () => tempRoot,
    dotClaudePath: (...segments: string[]) =>
      [tempRoot, ".claude", ...segments].join("/"),
  };
});

// Now import modules under test (after vi.mock is set up).
const { readComments, appendComment, resolveCommentsPath } = await import(
  "../src/server/comments/io.js"
);
const { commentsRoutes } = await import(
  "../src/server/routes/comments-routes.js"
);

import type { CommentThread } from "../src/server/comments/io.js";

// ── Pass-through write guard (for route tests) ────────────────────────────────

const passThroughGuard: preHandlerHookHandler = (_req, _reply, done) => {
  done();
};

// ── Route server ─────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(commentsRoutes, { writeGuard: passThroughGuard });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// ═══════════════════════════════════════════════════════════════════════════════
// A. io layer
// ═══════════════════════════════════════════════════════════════════════════════

describe("readComments — absent file", () => {
  it("returns an empty thread when no file exists", () => {
    const thread = readComments("TASK-900");
    expect(thread.schemaVersion).toBe(1);
    expect(thread.taskId).toBe("TASK-900");
    expect(thread.comments).toEqual([]);
  });
});

describe("appendComment — validation", () => {
  it("rejects empty body string", () => {
    expect(() => appendComment("TASK-901", { body: "" })).toThrow(/empty/i);
  });

  it("rejects whitespace-only body", () => {
    expect(() => appendComment("TASK-901", { body: "   " })).toThrow(/empty/i);
  });

  it("sets EMPTY_BODY error code", () => {
    try {
      appendComment("TASK-901", { body: "" });
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("EMPTY_BODY");
    }
  });

  it("rejects a bad task id (no prefix)", () => {
    expect(() => appendComment("001", { body: "hello" })).toThrow(/Invalid task id/);
  });

  it("rejects a BUG task id that has no number", () => {
    expect(() => appendComment("BUG-", { body: "hello" })).toThrow(/Invalid task id/);
  });
});

describe("appendComment + readComments — round-trip", () => {
  it("appended comment is readable back and has the correct shape", () => {
    const before = new Date().toISOString();
    const thread = appendComment("TASK-910", { body: "First comment" });
    const after = new Date().toISOString();

    expect(thread.schemaVersion).toBe(1);
    expect(thread.taskId).toBe("TASK-910");
    expect(thread.comments).toHaveLength(1);

    const c = thread.comments[0];
    // id is now a UUID (randomUUID) — assert non-empty string, not a specific value
    expect(typeof c.id).toBe("string");
    expect(c.id.length).toBeGreaterThan(0);
    expect(c.author).toBe("human"); // default
    expect(c.body).toBe("First comment");
    expect(typeof c.ts).toBe("string");
    // ts should be between before and after
    expect(c.ts >= before).toBe(true);
    expect(c.ts <= after).toBe(true);
    // statusAtComment should not be present when not supplied
    expect(Object.prototype.hasOwnProperty.call(c, "statusAtComment")).toBe(false);

    // Read back from disk
    const readBack = readComments("TASK-910");
    expect(readBack).toEqual(thread);
  });

  it("sequential appends produce unique UUID ids", () => {
    appendComment("TASK-911", { body: "One" });
    appendComment("TASK-911", { body: "Two" });
    const thread = appendComment("TASK-911", { body: "Three" });

    expect(thread.comments).toHaveLength(3);
    // All ids must be non-empty strings
    for (const c of thread.comments) {
      expect(typeof c.id).toBe("string");
      expect(c.id.length).toBeGreaterThan(0);
    }
    // All ids must be unique (no collision)
    const ids = thread.comments.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("explicit author is stored; not overridden to 'human'", () => {
    const thread = appendComment("TASK-912", { body: "Agent note", author: "agent" });
    expect(thread.comments[0].author).toBe("agent");
  });

  it("statusAtComment is stored when provided", () => {
    const thread = appendComment("TASK-913", {
      body: "Status note",
      statusAtComment: "In Progress",
    });
    expect(thread.comments[0].statusAtComment).toBe("In Progress");
  });

  it("statusAtComment is absent from stored comment when not provided", () => {
    const thread = appendComment("TASK-914", { body: "No status" });
    expect(Object.prototype.hasOwnProperty.call(thread.comments[0], "statusAtComment")).toBe(false);
  });

  it("BUG- prefix works the same as TASK-", () => {
    const thread = appendComment("BUG-100", { body: "bug note" });
    expect(thread.taskId).toBe("BUG-100");
    // id is a UUID — assert non-empty string
    expect(typeof thread.comments[0].id).toBe("string");
    expect(thread.comments[0].id.length).toBeGreaterThan(0);
  });
});

describe("resolveCommentsPath — path safety", () => {
  it("accepts a valid TASK-NNN id", () => {
    const p = resolveCommentsPath("TASK-001");
    expect(p).toContain("TASK-001.json");
    expect(p).toContain("comments");
  });

  it("accepts a valid BUG-NNN id", () => {
    const p = resolveCommentsPath("BUG-007");
    expect(p).toContain("BUG-007.json");
  });

  it("rejects a malformed id (no prefix)", () => {
    expect(() => resolveCommentsPath("001")).toThrow(/Invalid task id/);
  });

  it("rejects a path-traversal attempt (.. in id)", () => {
    expect(() => resolveCommentsPath("TASK-../../../etc/passwd")).toThrow(
      /Invalid task id/
    );
  });

  it("rejects an id with slashes", () => {
    expect(() => resolveCommentsPath("TASK/001")).toThrow(/Invalid task id/);
  });

  it("rejects empty string", () => {
    expect(() => resolveCommentsPath("")).toThrow(/Invalid task id/);
  });

  it("resolves strictly inside the comments directory", () => {
    const p = resolveCommentsPath("TASK-042");
    // Path must contain both 'console' and 'comments' segments (in some form)
    // and end with the task id + .json
    expect(p.endsWith("TASK-042.json")).toBe(true);
    expect(p).toContain("console");
    expect(p).toContain("comments");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. Route layer
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/tasks/:id/comments", () => {
  it("returns 200 with empty thread for a task that has no file", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tasks/TASK-800/comments",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<CommentThread>();
    expect(body.schemaVersion).toBe(1);
    expect(body.taskId).toBe("TASK-800");
    expect(body.comments).toEqual([]);
  });

  it("returns 400 on a bad task id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tasks/badid/comments",
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/Invalid task id/);
  });

  it("returns 400 on id with path traversal characters", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tasks/TASK-..%2F..%2Fetc%2Fpasswd/comments",
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/tasks/:id/comments", () => {
  it("appends a comment and returns the updated thread → 200", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/TASK-700/comments",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ body: "Route test comment" }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<CommentThread>();
    expect(body.schemaVersion).toBe(1);
    expect(body.taskId).toBe("TASK-700");
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].body).toBe("Route test comment");
    // id is a UUID — assert non-empty string shape
    expect(typeof body.comments[0].id).toBe("string");
    expect(body.comments[0].id.length).toBeGreaterThan(0);
    expect(body.comments[0].author).toBe("human");
  });

  it("returns 400 when body field is empty string", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/TASK-701/comments",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ body: "" }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/empty/i);
  });

  it("returns 400 when body field is whitespace only", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/TASK-702/comments",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ body: "   " }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 on a bad task id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/notanid/comments",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ body: "hello" }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/Invalid task id/);
  });

  it("stores the author field when provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/TASK-703/comments",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ body: "Agent reply", author: "agent" }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<CommentThread>();
    expect(body.comments[0].author).toBe("agent");
  });

  it("stores statusAtComment when provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/TASK-704/comments",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ body: "Status note", statusAtComment: "In Progress" }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<CommentThread>();
    expect(body.comments[0].statusAtComment).toBe("In Progress");
  });

  it("second POST appends a second comment with a distinct UUID id", async () => {
    await app.inject({
      method: "POST",
      url: "/api/tasks/TASK-705/comments",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ body: "First" }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/tasks/TASK-705/comments",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ body: "Second" }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<CommentThread>();
    expect(body.comments).toHaveLength(2);
    // Both ids must be non-empty strings and distinct from each other
    expect(typeof body.comments[1].id).toBe("string");
    expect(body.comments[1].id.length).toBeGreaterThan(0);
    expect(body.comments[0].id).not.toBe(body.comments[1].id);
  });
});
