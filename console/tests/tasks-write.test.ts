/**
 * tasks-write.test.ts — data-layer tests for src/app/api/tasks-write.ts
 *
 * Covers:
 *   - fetchTaskDetail: GET with no token, 404 surfaces cleanly
 *   - putTaskStatus: PUT sends X-Console-Token, 401/403 throws TasksApiError
 *   - fetchComments: GET with no token
 *   - postComment: POST sends X-Console-Token + body, empty-body 400 handled
 *   - readConsoleToken: reads from <meta name="x-console-token">
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchTaskDetail,
  putTaskStatus,
  fetchComments,
  postComment,
  readConsoleToken,
  TasksApiError,
  type TaskDetail,
  type CommentThread,
  type TaskStatusReply,
} from "../src/app/api/tasks-write.js";
import type { TaskBoard } from "../src/app/api/state.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function stubFetch(body: unknown, status = 200) {
  const mock = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

function stubFetchError(body: unknown, status: number) {
  return stubFetch(body, status);
}

const TASK_DETAIL: TaskDetail = {
  id: "TASK-011",
  title: "Interactive Kanban",
  lane: "feature",
  status: "In Progress",
  body: ["- Drag-and-drop columns", "- Card detail panel"],
  comments: 2,
};

const EMPTY_THREAD: CommentThread = {
  schemaVersion: 1,
  taskId: "TASK-011",
  comments: [],
};

const BOARD: TaskBoard = {
  columns: [
    { status: "In Progress", lane: "feature", items: [] },
    { status: "Done", lane: "feature", items: [] },
  ],
};

const STATUS_REPLY: TaskStatusReply = { ok: true, board: BOARD };

// ── readConsoleToken ──────────────────────────────────────────────────────

describe("readConsoleToken", () => {
  beforeEach(() => {
    document.querySelectorAll('meta[name="x-console-token"]').forEach((el) => el.remove());
  });

  it("returns the token from the meta tag", () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "x-console-token");
    meta.setAttribute("content", "tok-abc-123");
    document.head.appendChild(meta);
    expect(readConsoleToken()).toBe("tok-abc-123");
    meta.remove();
  });

  it("returns empty string when the meta tag is absent", () => {
    expect(readConsoleToken()).toBe("");
  });
});

// ── fetchTaskDetail ───────────────────────────────────────────────────────

describe("fetchTaskDetail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("GET /api/tasks/:id returns TaskDetail", async () => {
    const mock = stubFetch(TASK_DETAIL);
    const result = await fetchTaskDetail("TASK-011");
    expect(result).toEqual(TASK_DETAIL);
    expect(mock).toHaveBeenCalledOnce();
    const [url, init] = mock.mock.calls[0];
    expect(String(url)).toBe("/api/tasks/TASK-011");
    expect((init as RequestInit).method).toBe("GET");
  });

  it("does NOT send X-Console-Token header (read endpoint)", async () => {
    const mock = stubFetch(TASK_DETAIL);
    await fetchTaskDetail("TASK-011");
    const [, init] = mock.mock.calls[0];
    expect((init as RequestInit & { headers?: Record<string, string> }).headers?.["X-Console-Token"]).toBeUndefined();
  });

  it("throws TasksApiError on 404", async () => {
    stubFetchError({ error: "unknown task" }, 404);
    await expect(fetchTaskDetail("TASK-999")).rejects.toThrow(TasksApiError);
    await expect(fetchTaskDetail("TASK-999")).rejects.toMatchObject({ status: 404 });
  });

  it("URL-encodes the task id", async () => {
    const mock = stubFetch(TASK_DETAIL);
    await fetchTaskDetail("TASK-011");
    const [url] = mock.mock.calls[0];
    expect(String(url)).toBe("/api/tasks/TASK-011");
  });
});

// ── putTaskStatus ─────────────────────────────────────────────────────────

describe("putTaskStatus", () => {
  beforeEach(() => {
    document.querySelectorAll('meta[name="x-console-token"]').forEach((el) => el.remove());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends PUT with X-Console-Token header", async () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "x-console-token");
    meta.setAttribute("content", "launch-token-xyz");
    document.head.appendChild(meta);

    const mock = stubFetch(STATUS_REPLY);
    await putTaskStatus("TASK-011", "Done", "feature");

    const [url, init] = mock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("/api/tasks/TASK-011/status");
    expect(init.method).toBe("PUT");
    expect(init.headers["X-Console-Token"]).toBe("launch-token-xyz");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ status: "Done", lane: "feature" });

    meta.remove();
  });

  it("omits lane from body when not supplied", async () => {
    const mock = stubFetch(STATUS_REPLY);
    await putTaskStatus("TASK-011", "Done");
    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ status: "Done" });
    expect(body.lane).toBeUndefined();
  });

  it("throws TasksApiError with status 401 on bad token", async () => {
    stubFetchError({ error: "missing or invalid x-console-token" }, 401);
    await expect(putTaskStatus("TASK-011", "Done")).rejects.toThrow(TasksApiError);
    await expect(putTaskStatus("TASK-011", "Done")).rejects.toMatchObject({ status: 401 });
  });

  it("throws TasksApiError with status 403 on cross-origin", async () => {
    stubFetchError({ error: "cross-origin request rejected" }, 403);
    await expect(putTaskStatus("TASK-011", "Done")).rejects.toMatchObject({ status: 403 });
  });

  it("throws TasksApiError with status 409 on ambiguous board shape", async () => {
    stubFetchError({ error: "TASKS.md shape unexpected" }, 409);
    await expect(putTaskStatus("TASK-011", "Done")).rejects.toMatchObject({ status: 409 });
  });

  it("returns the board from the server reply", async () => {
    stubFetch(STATUS_REPLY);
    const result = await putTaskStatus("TASK-011", "Done", "feature");
    expect(result).toEqual(STATUS_REPLY);
  });
});

// ── fetchComments ─────────────────────────────────────────────────────────

describe("fetchComments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("GET /api/tasks/:id/comments returns CommentThread", async () => {
    const mock = stubFetch(EMPTY_THREAD);
    const result = await fetchComments("TASK-011");
    expect(result).toEqual(EMPTY_THREAD);
    const [url, init] = mock.mock.calls[0];
    expect(String(url)).toBe("/api/tasks/TASK-011/comments");
    expect((init as RequestInit).method).toBe("GET");
  });

  it("does NOT send X-Console-Token header (read endpoint)", async () => {
    const mock = stubFetch(EMPTY_THREAD);
    await fetchComments("TASK-011");
    const [, init] = mock.mock.calls[0];
    expect((init as RequestInit & { headers?: Record<string, string> }).headers?.["X-Console-Token"]).toBeUndefined();
  });
});

// ── postComment ───────────────────────────────────────────────────────────

describe("postComment", () => {
  beforeEach(() => {
    document.querySelectorAll('meta[name="x-console-token"]').forEach((el) => el.remove());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const THREAD_WITH_COMMENT: CommentThread = {
    schemaVersion: 1,
    taskId: "TASK-011",
    comments: [
      { id: "c-1", author: "human", ts: "2026-06-24T10:00:00Z", body: "Looks good" },
    ],
  };

  it("sends POST with X-Console-Token, body, and returns updated thread", async () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "x-console-token");
    meta.setAttribute("content", "tok-post");
    document.head.appendChild(meta);

    const mock = stubFetch(THREAD_WITH_COMMENT);
    const result = await postComment("TASK-011", "Looks good");

    const [url, init] = mock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("/api/tasks/TASK-011/comments");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Console-Token"]).toBe("tok-post");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ body: "Looks good" });
    expect(result).toEqual(THREAD_WITH_COMMENT);

    meta.remove();
  });

  it("includes author in body when supplied", async () => {
    const mock = stubFetch(THREAD_WITH_COMMENT);
    await postComment("TASK-011", "LGTM", "alice");
    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ body: "LGTM", author: "alice" });
  });

  it("throws TasksApiError with status 400 on empty body rejection", async () => {
    stubFetchError({ error: "body is required" }, 400);
    await expect(postComment("TASK-011", "")).rejects.toMatchObject({ status: 400 });
  });

  it("throws TasksApiError with status 401 on bad token", async () => {
    stubFetchError({ error: "bad token" }, 401);
    await expect(postComment("TASK-011", "hi")).rejects.toMatchObject({ status: 401 });
  });
});
