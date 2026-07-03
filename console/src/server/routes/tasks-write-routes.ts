/**
 * tasks-write-routes.ts — Fastify plugin for task write-back + card detail (TASK-010).
 *
 * Registers:
 *   GET /api/tasks/:id          → TaskDetail + comments count (read; no guard)
 *   PUT /api/tasks/:id/status   → surgical block move in TASKS.md (write-guarded)
 *
 * Plugin design mirrors verify-routes.ts:
 *   - writeGuard is injected from server.ts so security config stays in one place.
 *   - TASKS.md is read fresh on every request (no-state-projection, DEC-002).
 *   - Writes are atomic: temp-file + rename pattern (writeFileSync on the same FS
 *     is atomic on POSIX; on Windows we write to a temp path then rename).
 *
 * contract:console-task-writeback
 */

import type { FastifyInstance, FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dotClaudePath } from "../project-root.js";
import { parseTasksMd } from "../parsers/tasks-parser.js";
import { getTaskDetail, moveTaskStatus, setTaskArchived, createBug, TASK_ID_RE } from "../tasks/writeback.js";
import type { TaskBoard } from "../types.js";
import type { Lane } from "../types.js";

// ── Local types (not in types.ts per task brief) ─────────────────────────────

interface TaskDetailReply {
  id: string;
  title: string;
  lane: Lane;
  status: string;
  body: string[];
  comments: number;
  archived: boolean;
}

interface TaskArchivedBody {
  archived: boolean;
}

interface TaskStatusBody {
  status: string;
  lane?: "feature" | "bug";
}

interface TaskStatusReply {
  ok: true;
  board: TaskBoard;
}

interface CreateBugBody {
  title: string;
  severity?: "P0" | "P1" | "P2" | "P3";
  sourceTask?: string;
  sourceItem?: string;
  round?: number;
  note?: string;
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface TasksWriteRoutesOptions {
  /** The write-guard preHandler from server.ts (token + origin check). */
  writeGuard: preHandlerHookHandler;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Absolute path to the canonical TASKS.md. */
function tasksFilePath(): string {
  return dotClaudePath("TASKS.md");
}

/** SHA-256 of file content — the authoritative half of the M4 write token. */
function contentHashOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** The optimistic-concurrency token captured at read time (M4). */
export interface TasksWriteToken {
  mtimeMs: number;
  contentHash: string;
}

/** TASKS.md content plus the write token captured at read time (M4). */
export interface TasksReadResult extends TasksWriteToken {
  content: string;
}

/**
 * Read TASKS.md content + its write token (mtime + content hash). Returns
 * null if the file does not exist (graceful empty-state per the
 * project-specific note in CLAUDE.md).
 * Exported for the M4 optimistic-concurrency unit tests.
 */
export function readTasksContentWithMeta(): TasksReadResult | null {
  const p = tasksFilePath();
  if (!existsSync(p)) return null;
  // Stat before read: if a writer lands between these two calls, mtimeMs
  // still reflects a state at-or-before what we're about to read — the
  // recheck in atomicWriteTasksMd below is what actually guards the write.
  const mtimeMs = statSync(p).mtimeMs;
  const content = readFileSync(p, "utf8");
  return { content, mtimeMs, contentHash: contentHashOf(content) };
}

export type TasksWriteResult = { ok: true } | { ok: false; code: "conflict" };

/**
 * Atomic write: write to a temp file in the same directory, then rename.
 * On Windows, renameSync replaces atomically when src and dst are on the
 * same volume (which they always are here).
 *
 * Optimistic concurrency (M4): the Console is the sole Console-side writer,
 * but the agent and Tester also write TASKS.md directly, uncoordinated
 * (CLAUDE.framework.md). Re-check the file immediately before the rename and
 * refuse to overwrite if it changed since `expected` was captured at read —
 * a lightweight guard against clobbering a concurrent external write, not a
 * lock (heavy file locking was explicitly rejected as over-engineering for a
 * single-user tool — FIX-PLAN M4).
 *
 * The check is two-stage: a differing mtime is a cheap reject without reading
 * the file, but an EQUAL mtime is not proof of no interleaved write — NTFS
 * mtime resolution is coarse enough that ~2% of back-to-back writes land on
 * an identical mtimeMs (measured on this class of host) — so the content hash
 * is the authoritative check for that sub-tick window.
 *
 * A same-client request that fires again right after this one naturally
 * passes: it does its own fresh read (capturing the token THIS write just
 * produced) before its own recheck.
 * Exported for the M4 optimistic-concurrency unit tests.
 */
export function atomicWriteTasksMd(content: string, expected: TasksWriteToken): TasksWriteResult {
  const target = tasksFilePath();
  try {
    if (statSync(target).mtimeMs !== expected.mtimeMs) {
      return { ok: false, code: "conflict" };
    }
    if (contentHashOf(readFileSync(target, "utf8")) !== expected.contentHash) {
      // Sub-tick interleaved write: mtime unchanged but content moved.
      return { ok: false, code: "conflict" };
    }
  } catch {
    // Target vanished since our read — nothing safe to overwrite.
    return { ok: false, code: "conflict" };
  }

  const tmp = target + ".tmp-" + process.pid;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, target);
  return { ok: true };
}

/**
 * Read the comments count for a task from its sidecar file.
 * Tolerant: returns 0 on any error (missing file, parse error, etc.).
 * Does NOT hard-depend on the comments module (built by a sibling agent).
 */
function readCommentsCount(taskId: string): number {
  try {
    const commentsPath = dotClaudePath("console", "comments", `${taskId}.json`);
    if (!existsSync(commentsPath)) return 0;
    const raw = readFileSync(commentsPath, "utf8");
    const parsed = JSON.parse(raw) as { comments?: unknown[] };
    if (Array.isArray(parsed.comments)) return parsed.comments.length;
    return 0;
  } catch {
    return 0;
  }
}

// ── Plugin ────────────────────────────────────────────────────────────────────

/**
 * Fastify plugin that registers task write-back endpoints.
 *
 * Wire into server.ts:
 *   import { tasksWriteRoutes } from "./routes/tasks-write-routes.js";
 *   await fastify.register(tasksWriteRoutes, { writeGuard });
 */
export const tasksWriteRoutes: FastifyPluginAsync<TasksWriteRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: TasksWriteRoutesOptions
) => {
  const { writeGuard } = opts;

  // ── GET /api/tasks/:id — card detail ────────────────────────────────────────
  fastify.get<{
    Params: { id: string };
    Reply: TaskDetailReply | { error: string };
  }>("/api/tasks/:id", async (req, reply) => {
    const { id } = req.params;

    if (!TASK_ID_RE.test(id)) {
      void reply.code(400).send({ error: `Invalid task id '${id}'. Must match (TASK|BUG)-[0-9]+.` });
      return;
    }

    const read = readTasksContentWithMeta();
    if (read === null) {
      void reply.code(404).send({ error: `TASKS.md not found` });
      return;
    }

    const detail = getTaskDetail(read.content, id);
    if (detail === null) {
      void reply.code(404).send({ error: `Task '${id}' not found` });
      return;
    }

    const comments = readCommentsCount(id);

    return {
      id: detail.id,
      title: detail.title,
      lane: detail.lane,
      status: detail.status,
      body: detail.body,
      comments,
      archived: detail.archived,
    };
  });

  // ── PUT /api/tasks/:id/status — surgical block move ──────────────────────────
  fastify.put<{
    Params: { id: string };
    Body: TaskStatusBody;
    Reply: TaskStatusReply | { error: string; reload?: boolean };
  }>(
    "/api/tasks/:id/status",
    { preHandler: [writeGuard] },
    async (req, reply) => {
      const { id } = req.params;

      // Validate id.
      if (!TASK_ID_RE.test(id)) {
        void reply.code(400).send({ error: `Invalid task id '${id}'. Must match (TASK|BUG)-[0-9]+.` });
        return;
      }

      // Validate body.
      const body = req.body;
      if (
        typeof body !== "object" ||
        body === null ||
        typeof body.status !== "string" ||
        body.status.trim() === ""
      ) {
        void reply.code(400).send({ error: "Request body must include { status: string, lane?: 'feature' | 'bug' }" });
        return;
      }
      if (
        body.lane !== undefined &&
        body.lane !== "feature" &&
        body.lane !== "bug"
      ) {
        void reply.code(400).send({ error: "lane must be 'feature' or 'bug' (or omitted)" });
        return;
      }

      // Normalise the caller-supplied status the same way section headings are
      // normalised in writeback.ts (strip trailing parenthetical group(s), trim)
      // so a display-label like "Todo (Priority Order)" matches a normalised heading.
      const targetStatus = body.status.trim().replace(/(\s*\([^)]*\))+\s*$/, "").trim();
      const requestedLane = body.lane;

      // Read TASKS.md.
      const read = readTasksContentWithMeta();
      if (read === null) {
        void reply.code(404).send({ error: `TASKS.md not found` });
        return;
      }

      // Perform the surgical move.
      const result = moveTaskStatus(read.content, id, targetStatus, requestedLane);

      if (!result.ok) {
        // Map error codes → HTTP status.
        switch (result.code) {
          case "not_found":
            void reply.code(404).send({ error: `Task '${id}' not found in TASKS.md` });
            return;
          case "target_missing":
            void reply.code(409).send({
              error: `Target status '${targetStatus}' does not exist as a ### section in the task's lane. No write performed.`,
            });
            return;
          case "ambiguous":
            void reply.code(409).send({
              error: `Task '${id}' appears more than once in TASKS.md — shape is ambiguous. No write performed.`,
            });
            return;
        }
      }

      // Atomic write (idempotent no-op also lands here with unchanged content).
      // M4: reject + signal reload if TASKS.md changed on disk since we read it.
      const writeResult = atomicWriteTasksMd(result.content, read);
      if (!writeResult.ok) {
        void reply.code(409).send({
          error: `TASKS.md changed on disk since it was read. Reload and retry.`,
          reload: true,
        });
        return;
      }

      // Re-parse and return the updated board.
      const board = parseTasksMd(result.content);
      return { ok: true, board };
    }
  );

  // ── PUT /api/tasks/:id/archived — set/clear the archived marker ──────────────
  fastify.put<{
    Params: { id: string };
    Body: TaskArchivedBody;
    Reply: TaskStatusReply | { error: string; reload?: boolean };
  }>(
    "/api/tasks/:id/archived",
    { preHandler: [writeGuard] },
    async (req, reply) => {
      const { id } = req.params;

      if (!TASK_ID_RE.test(id)) {
        void reply.code(400).send({ error: `Invalid task id '${id}'. Must match (TASK|BUG)-[0-9]+.` });
        return;
      }

      const body = req.body;
      if (typeof body !== "object" || body === null || typeof body.archived !== "boolean") {
        void reply.code(400).send({ error: "Request body must include { archived: boolean }" });
        return;
      }

      const read = readTasksContentWithMeta();
      if (read === null) {
        void reply.code(404).send({ error: `TASKS.md not found` });
        return;
      }

      const result = setTaskArchived(read.content, id, body.archived);
      if (!result.ok) {
        switch (result.code) {
          case "not_found":
            void reply.code(404).send({ error: `Task '${id}' not found in TASKS.md` });
            return;
          case "ambiguous":
            void reply.code(409).send({
              error: `Task '${id}' appears more than once in TASKS.md — shape is ambiguous. No write performed.`,
            });
            return;
          default:
            void reply.code(409).send({ error: `Could not archive '${id}'. No write performed.` });
            return;
        }
      }

      const writeResult = atomicWriteTasksMd(result.content, read);
      if (!writeResult.ok) {
        void reply.code(409).send({
          error: `TASKS.md changed on disk since it was read. Reload and retry.`,
          reload: true,
        });
        return;
      }
      const board = parseTasksMd(result.content);
      return { ok: true, board };
    }
  );

  // ── POST /api/bugs — create a bug in the Bug-Fix lane's Reported column ──────
  fastify.post<{
    Body: CreateBugBody;
    Reply: { ok: true; bugId: string; board: TaskBoard } | { error: string; reload?: boolean };
  }>(
    "/api/bugs",
    { preHandler: [writeGuard] },
    async (req, reply) => {
      const body = req.body;
      if (
        typeof body !== "object" ||
        body === null ||
        typeof body.title !== "string" ||
        body.title.trim() === ""
      ) {
        void reply.code(400).send({
          error:
            "Request body must include { title: string, severity?, sourceTask?, sourceItem?, round?, note? }",
        });
        return;
      }
      if (
        body.severity !== undefined &&
        !["P0", "P1", "P2", "P3"].includes(body.severity)
      ) {
        void reply.code(400).send({ error: "severity must be P0|P1|P2|P3 (or omitted)" });
        return;
      }
      if (body.sourceTask !== undefined && !TASK_ID_RE.test(body.sourceTask)) {
        void reply.code(400).send({ error: "sourceTask must match (TASK|BUG)-[0-9]+" });
        return;
      }

      const read = readTasksContentWithMeta();
      if (read === null) {
        void reply.code(404).send({ error: `TASKS.md not found` });
        return;
      }

      const date = new Date().toISOString().slice(0, 10);
      const result = createBug(read.content, {
        title: body.title,
        severity: body.severity,
        sourceTask: body.sourceTask,
        sourceItem: body.sourceItem,
        round: body.round,
        note: body.note,
        date,
      });

      if (!result.ok) {
        void reply.code(409).send({
          error: "Bug-Fix lane has no '### Reported' section. No write performed.",
        });
        return;
      }

      const writeResult = atomicWriteTasksMd(result.content, read);
      if (!writeResult.ok) {
        void reply.code(409).send({
          error: `TASKS.md changed on disk since it was read. Reload and retry.`,
          reload: true,
        });
        return;
      }
      const board = parseTasksMd(result.content);
      return { ok: true, bugId: result.bugId, board };
    }
  );
};
