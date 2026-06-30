/**
 * tasks-write.ts — typed write-side client for the task endpoints.
 *
 * Mirrors contract:console-task-writeback and contract:console-comments-file
 * in .claude/ECOSYSTEM.md. The server is the sole writer; this module covers:
 *
 *   GET  /api/tasks/:id          -> TaskDetail
 *   PUT  /api/tasks/:id/status   -> TaskBoard (re-parsed)
 *   GET  /api/tasks/:id/comments -> CommentThread
 *   POST /api/tasks/:id/comments -> CommentThread (appended)
 *
 * Token plumbing: reuses the same x-console-token meta tag pattern from
 * api/verify.ts. The helper `readConsoleToken` is factored here and
 * re-exported so verify.ts callers can migrate if needed (they are not
 * changed — this is additive only).
 *
 * Imports ONLY from src/app/api/* — no server code.
 */

import type { TaskBoard, Lane } from "./state.js";

// ── Domain types (contract:console-task-writeback) ─────────────────────────

/** Full task detail returned by GET /api/tasks/:id */
export interface TaskDetail {
  id: string;
  title: string;
  lane: Lane;
  status: string;
  body: string[];
  comments: number;
  archived: boolean;
}

/** Body sent to PUT /api/tasks/:id/status */
export interface TaskStatusPatch {
  status: string;
  lane?: Lane;
}

/** Reply from PUT /api/tasks/:id/status */
export interface TaskStatusReply {
  ok: true;
  board: TaskBoard;
}

/** Body sent to POST /api/bugs (the verify-loop "flag as bug" action). */
export interface CreateBugBody {
  title: string;
  severity?: "P0" | "P1" | "P2" | "P3";
  sourceTask?: string;
  sourceItem?: string;
  round?: number;
  note?: string;
}

/** Reply from POST /api/bugs — the new bug id + the re-parsed board. */
export interface CreateBugReply {
  ok: true;
  bugId: string;
  board: TaskBoard;
}

// ── Domain types (contract:console-comments-file) ──────────────────────────

export interface Comment {
  id: string;
  author: string;
  ts: string;
  body: string;
  statusAtComment?: string;
}

export interface CommentThread {
  schemaVersion: 1;
  taskId: string;
  comments: Comment[];
}

export interface PostCommentBody {
  body: string;
  author?: string;
}

// ── Token plumbing ─────────────────────────────────────────────────────────

const TOKEN_META_NAME = "x-console-token";

/**
 * Read the per-launch write token from the injected meta tag.
 * Returns "" when the tag is absent (e.g. Vite dev without injection, or
 * jsdom tests) — the server's write guard rejects empty tokens (fail-closed).
 */
export function readConsoleToken(): string {
  if (typeof document === "undefined") return "";
  const el = document.querySelector(`meta[name="${TOKEN_META_NAME}"]`);
  return el?.getAttribute("content") ?? "";
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

/** Error thrown when a tasks-write request fails; carries the HTTP status. */
export class TasksApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TasksApiError";
    this.status = status;
  }
}

async function parseOrThrow<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      detail = body?.error ? ` — ${body.error}` : "";
    } catch {
      /* non-JSON error body; status is the signal */
    }
    throw new TasksApiError(`${what} failed (${res.status})${detail}`, res.status);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new TasksApiError(`Malformed JSON from ${what}`, res.status);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * GET /api/tasks/:id — fetch full task detail (id, title, lane, status, body lines, comment count).
 * Read endpoint; no token required.
 */
export async function fetchTaskDetail(id: string): Promise<TaskDetail> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  return parseOrThrow<TaskDetail>(res, `GET /api/tasks/${id}`);
}

/**
 * PUT /api/tasks/:id/status — move the task to a new status column.
 * Write endpoint; requires the X-Console-Token header.
 *
 * On 401/403 the error surfaces with a meaningful message so the UI can
 * display it rather than silently swallowing auth failures.
 */
export async function putTaskStatus(
  id: string,
  status: string,
  lane?: Lane,
): Promise<TaskStatusReply> {
  const body: TaskStatusPatch = lane !== undefined ? { status, lane } : { status };
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/status`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Console-Token": readConsoleToken(),
    },
    body: JSON.stringify(body),
  });
  return parseOrThrow<TaskStatusReply>(res, `PUT /api/tasks/${id}/status`);
}

/**
 * PUT /api/tasks/:id/archived — set/clear the task's archived flag.
 * Write endpoint; requires the X-Console-Token header. Returns the re-parsed board.
 */
export async function putTaskArchived(
  id: string,
  archived: boolean,
): Promise<TaskStatusReply> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/archived`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Console-Token": readConsoleToken(),
    },
    body: JSON.stringify({ archived }),
  });
  return parseOrThrow<TaskStatusReply>(res, `PUT /api/tasks/${id}/archived`);
}

/**
 * POST /api/bugs — create a bug in the Bug-Fix lane's Reported column.
 * The verify-loop "flag as bug" action. Write endpoint; requires X-Console-Token.
 * Returns the new BUG id + the re-parsed board.
 */
export async function createBug(body: CreateBugBody): Promise<CreateBugReply> {
  const res = await fetch(`/api/bugs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Console-Token": readConsoleToken(),
    },
    body: JSON.stringify(body),
  });
  return parseOrThrow<CreateBugReply>(res, `POST /api/bugs`);
}

/**
 * GET /api/tasks/:id/comments — fetch the comment thread (empty thread if none).
 * Read endpoint; no token required.
 */
export async function fetchComments(id: string): Promise<CommentThread> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/comments`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  return parseOrThrow<CommentThread>(res, `GET /api/tasks/${id}/comments`);
}

/**
 * POST /api/tasks/:id/comments — append a comment to the thread.
 * Write endpoint; requires the X-Console-Token header.
 * Returns the updated CommentThread (with the new comment appended).
 * Rejects with TasksApiError if body is empty (400), token bad (401), cross-origin (403).
 */
export async function postComment(
  id: string,
  body: string,
  author?: string,
): Promise<CommentThread> {
  const payload: PostCommentBody = author !== undefined ? { body, author } : { body };
  const res = await fetch(`/api/tasks/${encodeURIComponent(id)}/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Console-Token": readConsoleToken(),
    },
    body: JSON.stringify(payload),
  });
  return parseOrThrow<CommentThread>(res, `POST /api/tasks/${id}/comments`);
}
